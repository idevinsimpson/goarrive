/**
 * useWorkoutTTS — Phrase-driven voice coaching for the Workout Player
 *
 * Audio unlock strategy (Safari/iOS):
 *   On first user touch ANYWHERE on the page, a native DOM 'touchend'
 *   listener fires BEFORE React's synthetic event system. In that handler
 *   we: (1) play a silent MP3 data URI via HTMLAudioElement, (2) resume
 *   the shared AudioContext, (3) create + play a Web Audio buffer.
 *   This unlocks ALL audio APIs for subsequent programmatic playback.
 *   This is the same approach used by Howler.js.
 *
 * Audio pipeline (priority order):
 *   1. Pre-generated OpenAI TTS clips (cached in Firebase Storage)
 *   2. Pre-existing static platform cues (Firebase Storage MP3s)
 *   3. Web Speech API / expo-speech fallback (SHORT cues only, max 80 chars)
 *
 * Scoping:
 *   All audio/speech is gated on an `activeRef` flag that is true only
 *   while the WorkoutPlayer component is mounted. On unmount, all pending
 *   timers are cancelled and speech is stopped. This prevents speech
 *   from leaking to other screens.
 *
 * Cross-platform: HTMLAudioElement on web, expo-av Audio.Sound on native.
 */
import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  generateWorkoutPhrases,
  getPhraseForEvent,
  type TTSEvent,
} from '../utils/ttsPhrase';
import { buildMovementPhrase } from '../utils/normalizeForSpeech';
import { unlockSharedAudioContext } from '../lib/audioCues';

// ── Logging (never swallowed) ───────────────────────────────────────
function ttsLog(msg: string, ...args: any[]): void {
  console.log(`[TTS] ${msg}`, ...args);
}
function ttsError(msg: string, ...args: any[]): void {
  console.error(`[TTS] ${msg}`, ...args);
}

// ── Silent MP3 data URI for Safari audio unlock ─────────────────────
const SILENT_MP3 = 'data:audio/mpeg;base64,SUQzBAAAAAABEVRYWFgAAAAtAAADY29tbWVudABCaWdTb3VuZEJhbmsuY29tIC8gTGFTb25vdGhlcXVlLmNvbQBURU5DAAAAHQAAA1N3aXRjaCBQbHVzIMKpIE5DSCBTb2Z0d2FyZQBUSVQyAAAABgAAAzIyMzUAVFNTRQAAAA8AAANMYXZmNTcuODMuMTAwAAAAAAAAAAAAAAD/80DEAAAAA0gAAAAATEFNRTMuMTAwVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsRbAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ==';

// ── Static platform cue URLs ────────────────────────────────────────
const STORAGE_BASE =
  'https://firebasestorage.googleapis.com/v0/b/goarrive.firebasestorage.app/o/voice_cache%2Fplatform%2F';
const CUE = (name: string) => `${STORAGE_BASE}${name}.mp3?alt=media`;

const STATIC_CUES: Record<string, string> = {
  go: CUE('go'),
  halfway: CUE('halfway'),
  switch_sides: CUE('switch_sides'),
  water_break: CUE('water_break'),
  workout_complete: CUE('workout_complete'),
  workout_complete_long: CUE('workout_complete_long'),
  next_up: CUE('next_up'),
  get_ready: CUE('get_ready'),
  countdown_3: CUE('countdown_3'),
  countdown_3_rest: CUE('countdown_3_rest'),
  nice_work_rest: CUE('nice_work_rest'),
  lets_get_started: CUE('lets_get_started'),
};

const EVENT_STATIC_MAP: Partial<Record<TTSEvent, string>> = {
  GO: 'go',
  HALFWAY: 'halfway',
  SWAP_SIDES: 'switch_sides',
  WATER_BREAK: 'water_break',
  WORKOUT_COMPLETE: 'workout_complete_long',
  DEMO: 'get_ready',
  TRANSITION: 'get_ready',
};

// ── Types ────────────────────────────────────────────────────────────
type Phase = 'ready' | 'work' | 'rest' | 'swap' | 'complete'
  | 'intro' | 'outro' | 'demo' | 'transition' | 'waterBreak' | 'grabEquipment';

interface UseWorkoutTTSOptions {
  phase: Phase;
  current: { name: string; stepType?: string; instructionText?: string; weight?: string | number; [k: string]: any } | null;
  next: { name: string; stepType?: string; weight?: string | number; [k: string]: any } | null;
  isMuted: boolean;
  currentIndex: number;
  total: number;
  timeLeft: number;
  currentDuration: number;
  flatMovements: { name: string; stepType: string; instructionText?: string; weight?: string | number; [k: string]: any }[];
}

// ── Max length for Web Speech fallback ──────────────────────────────
// Never speak arbitrary-length text. If the phrase is too long, it's
// likely coach instruction text or description — not a short cue.
const MAX_SPEECH_LENGTH = 80;

// ── Module-level audio state ────────────────────────────────────────
let audioUnlocked = false;
let currentWebAudio: HTMLAudioElement | null = null;
let currentNativeSound: Audio.Sound | null = null;
let nativeAudioModeReady = false;
const webPool: Record<string, HTMLAudioElement> = {};

// ── Document-level audio unlock (Safari/iOS) ────────────────────────
// Fires on the FIRST user touch/click, in the native DOM event handler
// (before React's synthetic events). This ONLY unlocks audio APIs —
// it does NOT speak any text or play any content.
let unlockListenersAttached = false;

function attachAudioUnlockListeners(): void {
  if (unlockListenersAttached) return;
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  unlockListenersAttached = true;

  const unlock = () => {
    if (audioUnlocked) return;

    ttsLog('=== AUTO-UNLOCK: native DOM gesture detected ===');

    // 1. Play silent MP3 via HTMLAudioElement — unlocks HTMLAudioElement API
    try {
      const silentAudio = new (window as any).Audio(SILENT_MP3);
      silentAudio.volume = 0;
      const p = silentAudio.play();
      if (p) {
        p.then(() => {
          ttsLog('AUTO-UNLOCK: HTMLAudioElement UNLOCKED (silent MP3 played)');
          audioUnlocked = true;
        }).catch((e: any) => {
          ttsError('AUTO-UNLOCK: silent MP3 play failed:', e?.name, e?.message);
        });
      }
    } catch (e) {
      ttsError('AUTO-UNLOCK: silent MP3 error:', e);
    }

    // 2. Create + resume AudioContext — unlocks Web Audio API
    try {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const buf = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(0);
        ttsLog('AUTO-UNLOCK: Web Audio API buffer played');
      }
    } catch (e) {
      ttsError('AUTO-UNLOCK: Web Audio error:', e);
    }

    // 3. Resume the shared AudioContext from audioCues.ts
    try {
      unlockSharedAudioContext();
      ttsLog('AUTO-UNLOCK: shared AudioContext resumed');
    } catch (e) {
      ttsError('AUTO-UNLOCK: shared context error:', e);
    }
  };

  document.addEventListener('touchend', unlock, { passive: true });
  document.addEventListener('click', unlock, { passive: true });
  ttsLog('Audio unlock listeners attached to document (unlock only — no speech)');
}

// Attach immediately on module load (web only)
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  attachAudioUnlockListeners();
}

// ── Configure native audio on module load ───────────────────────────
if (Platform.OS !== 'web') {
  Audio.setAudioModeAsync({
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
  }).then(() => {
    nativeAudioModeReady = true;
    ttsLog('Native audio mode configured');
  }).catch((err) => {
    ttsError('Failed to set native audio mode:', err);
  });
}

// ── Cross-platform audio playback ───────────────────────────────────
function playAudioUrl(url: string, source: string, onDone?: () => void): boolean {
  if (!url) { ttsLog('playAudioUrl: no URL | source:', source); return false; }

  ttsLog(`PLAY | source: ${source} | url: ...${url.slice(-30)}`);

  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return false;
    try {
      if (currentWebAudio) {
        currentWebAudio.pause();
        currentWebAudio.currentTime = 0;
      }

      let audio = webPool[url];
      if (!audio) {
        audio = new (window as any).Audio(url);
        audio.preload = 'auto';
        webPool[url] = audio;
      } else {
        audio.currentTime = 0;
      }

      currentWebAudio = audio;
      if (onDone) audio.addEventListener('ended', onDone, { once: true });

      const p = audio.play();
      if (p) {
        p.then(() => {
          ttsLog(`PLAY OK | source: ${source} | url: ...${url.slice(-25)}`);
          audioUnlocked = true;
        }).catch((err: any) => {
          ttsError(`PLAY FAIL | source: ${source} | err: ${err?.name} ${err?.message}`);
          if (err?.name === 'NotAllowedError') {
            ttsError('AUTOPLAY BLOCKED — audioUnlocked:', audioUnlocked);
          }
        });
      }
      return true;
    } catch (err) {
      ttsError('playAudioUrl exception:', err);
      return false;
    }
  } else {
    // Native: expo-av
    (async () => {
      try {
        if (!nativeAudioModeReady) {
          await Audio.setAudioModeAsync({
            playsInSilentModeIOS: true,
            staysActiveInBackground: false,
            shouldDuckAndroid: true,
          });
          nativeAudioModeReady = true;
        }
        if (currentNativeSound) {
          try { await currentNativeSound.unloadAsync(); } catch {}
          currentNativeSound = null;
        }
        const { sound } = await Audio.Sound.createAsync(
          { uri: url },
          { shouldPlay: true, volume: 1.0 },
        );
        currentNativeSound = sound;
        ttsLog(`Native PLAY OK | source: ${source}`);
        if (onDone) {
          sound.setOnPlaybackStatusUpdate((status) => {
            if (status.isLoaded && status.didJustFinish) onDone();
          });
        }
      } catch (err) {
        ttsError('Native play error:', err);
      }
    })();
    return true;
  }
}

function preloadUrl(url: string): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  if (webPool[url]) return;
  try {
    const audio = new (window as any).Audio(url);
    audio.preload = 'auto';
    webPool[url] = audio;
  } catch {}
}

// ── Speech fallback (SCOPED — short cues only) ─────────────────────
function speakText(text: string, source: string): void {
  if (!text) return;

  // Guard: never speak long text — it's likely coach instructions, not a cue
  if (text.length > MAX_SPEECH_LENGTH) {
    ttsLog(`SPEECH BLOCKED (too long: ${text.length} chars) | source: ${source} | text: "${text.slice(0, 40)}..."`);
    return;
  }

  ttsLog(`SPEECH | source: ${source} | text: "${text}"`);

  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return;
    try {
      const synth = window.speechSynthesis;
      if (!synth) { ttsError('speechSynthesis unavailable'); return; }
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 0.95;
      synth.speak(u);
      ttsLog(`SPEECH FIRED | source: ${source} | text: "${text}"`);
    } catch (err) {
      ttsError('Web Speech error:', err);
    }
  } else {
    try {
      const Speech = require('expo-speech');
      Speech.stop();
      Speech.speak(text, { language: 'en-US', rate: 0.95 });
    } catch (err) {
      ttsError('expo-speech error:', err);
    }
  }
}

// ── Hook ─────────────────────────────────────────────────────────────
export function useWorkoutTTS({
  phase,
  current,
  next,
  isMuted,
  currentIndex,
  total,
  timeLeft,
  currentDuration,
  flatMovements,
}: UseWorkoutTTSOptions) {
  const clipUrlsRef = useRef<Record<string, string>>({});
  const [isPreloading, setIsPreloading] = useState(false);
  const [debugStatus, setDebugStatus] = useState('init');

  const lastPlayedRef = useRef('');
  const halfwayFiredRef = useRef(false);
  const countdownFiredRef = useRef(-1);

  // ── Scoping: all timers + active guard ────────────────────────────
  // activeRef is true while this hook instance is mounted. All speech
  // and audio playback checks this before firing.
  const activeRef = useRef(true);
  const pendingTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  /** Schedule a callback — tracked for cleanup on unmount */
  const scheduleTimer = useCallback((fn: () => void, ms: number): void => {
    const id = setTimeout(() => {
      pendingTimers.current.delete(id);
      if (!activeRef.current) {
        ttsLog('TIMER BLOCKED (unmounted) — skipping callback');
        return;
      }
      fn();
    }, ms);
    pendingTimers.current.add(id);
  }, []);

  // Ensure unlock listeners are attached (idempotent)
  useEffect(() => {
    attachAudioUnlockListeners();
  }, []);

  // Preload static cues
  useEffect(() => {
    Object.values(STATIC_CUES).forEach(preloadUrl);
    ttsLog('Static cues preloaded');
  }, []);

  // Batch-generate dynamic phrases
  const allPhrases = useMemo(() => {
    if (!flatMovements || flatMovements.length === 0) return [];
    return generateWorkoutPhrases(flatMovements);
  }, [flatMovements]);

  useEffect(() => {
    if (allPhrases.length === 0) return;
    if (phase === 'complete') return;
    if (Object.keys(clipUrlsRef.current).length > 0) return;

    let cancelled = false;
    setIsPreloading(true);
    setDebugStatus('generating...');

    (async () => {
      try {
        const functions = getFunctions(undefined, 'us-central1');
        const batchGenerate = httpsCallable<
          { phrases: { text: string; cacheKey: string }[] },
          { urls: Record<string, string>; generated: number; total: number }
        >(functions, 'batchGenerateVoice');

        const result = await batchGenerate({
          phrases: allPhrases.map(p => ({ text: p.text, cacheKey: p.cacheKey })),
        });

        if (!cancelled && activeRef.current) {
          clipUrlsRef.current = result.data.urls;
          const n = Object.keys(result.data.urls).length;
          ttsLog('Batch done:', n, 'clips');
          setDebugStatus(`${n} clips`);
          Object.values(result.data.urls).slice(0, 6).forEach(preloadUrl);
        }
      } catch (err) {
        ttsError('Batch failed:', err);
        if (!cancelled && activeRef.current) setDebugStatus('fallback (static cues)');
      } finally {
        if (!cancelled && activeRef.current) setIsPreloading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [allPhrases, phase]);

  // ── Playback functions ────────────────────────────────────────────
  const playStaticCue = useCallback((key: string, source: string): boolean => {
    if (isMuted || !activeRef.current) return false;
    const url = STATIC_CUES[key];
    if (!url) { ttsError('Unknown cue:', key); return false; }
    ttsLog(`CUE | key: ${key} | source: ${source}`);
    return playAudioUrl(url, `static:${key}:${source}`);
  }, [isMuted]);

  const playPhrase = useCallback((
    event: TTSEvent,
    source: string,
    movementName?: string,
    weight?: string | number,
    instructionText?: string,
  ) => {
    if (isMuted || !activeRef.current) return;

    const phrase = getPhraseForEvent(event, movementName, weight, instructionText);
    ttsLog(`PHRASE | event: ${event} | source: ${source} | text: "${phrase.text.slice(0, 50)}"`);

    // Layer 1: generated clip
    const gUrl = clipUrlsRef.current[phrase.cacheKey];
    if (gUrl) {
      playAudioUrl(gUrl, `clip:${event}:${source}`);
      return;
    }

    // Layer 2: static cue (preferred fallback — always sounds correct)
    const sk = EVENT_STATIC_MAP[event];
    if (sk && STATIC_CUES[sk]) {
      ttsLog(`STATIC FALLBACK | event: ${event} | cue: ${sk} | source: ${source}`);
      playAudioUrl(STATIC_CUES[sk], `static-fallback:${event}:${source}`);
      return;
    }

    // Layer 3: speech (SHORT cues only — guarded by MAX_SPEECH_LENGTH)
    if (phrase.text) {
      speakText(phrase.text, `speech-fallback:${event}:${source}`);
      return;
    }

    ttsError(`NO AUDIO PATH | event: ${event} | source: ${source}`);
  }, [isMuted]);

  const playPrepThenGo = useCallback((name: string, source: string, weight?: string | number) => {
    if (isMuted || !activeRef.current) return;

    const phrase = getPhraseForEvent('PREP_NEXT', name, weight);
    const gUrl = clipUrlsRef.current[phrase.cacheKey];

    if (gUrl) {
      playAudioUrl(gUrl, `clip:PREP_NEXT:${source}`, () => {
        scheduleTimer(() => playStaticCue('go', `${source}→go`), 400);
      });
    } else {
      // Fallback: static "next up" cue + speak movement name + static "go" cue
      playStaticCue('next_up', `${source}→next_up`);
      scheduleTimer(() => {
        if (!activeRef.current) return;
        speakText(buildMovementPhrase(name, weight), `speech:PREP_NEXT:${source}`);
        scheduleTimer(() => playStaticCue('go', `${source}→go`), 1800);
      }, 900);
    }
  }, [isMuted, playStaticCue, scheduleTimer]);

  // ── playStartCue: called from gesture handler as backup unlock ────
  const playStartCue = useCallback(() => {
    if (isMuted) return;
    ttsLog('playStartCue (gesture handler), unlocked:', audioUnlocked);

    const url = STATIC_CUES.lets_get_started;
    if (url) {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        try {
          const a = new (window as any).Audio(url);
          currentWebAudio = a;
          const p = a.play();
          if (p) {
            p.then(() => {
              ttsLog('playStartCue: PLAY SUCCEEDED');
              audioUnlocked = true;
            }).catch((e: any) => {
              ttsError('playStartCue: PLAY FAILED:', e?.name, e?.message);
            });
          }
        } catch (e) {
          ttsError('playStartCue error:', e);
        }
      } else {
        playAudioUrl(url, 'playStartCue:native');
      }
    }
  }, [isMuted]);

  // ── Phase-driven playback ─────────────────────────────────────────

  useEffect(() => {
    if (!current || current.stepType !== 'exercise') return;
    if (!activeRef.current) return;

    if (phase === 'work') {
      const key = `work_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        halfwayFiredRef.current = false;
        countdownFiredRef.current = -1;
        setDebugStatus(`work: ${current.name?.slice(0, 20)}`);

        if (current.name && current.name !== 'Get Ready') {
          if (currentIndex === 0) {
            scheduleTimer(() => playStaticCue('go', 'work:first→go'), 2000);
          } else {
            playPrepThenGo(current.name, `work:${currentIndex}`, current.weight);
          }
        }
      }
    } else if (phase === 'rest') {
      const key = `rest_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        countdownFiredRef.current = -1;
        setDebugStatus('rest');
        playStaticCue('nice_work_rest', `rest:${currentIndex}`);
        if (next?.stepType === 'exercise' && next.name && next.name !== 'Get Ready') {
          scheduleTimer(() => playPhrase('PREP_NEXT', `rest:${currentIndex}→prep`, next.name, next.weight), 1800);
        }
      }
    } else if (phase === 'swap') {
      const key = `swap_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        countdownFiredRef.current = -1;
        setDebugStatus('swap');
        playPhrase('SWAP_SIDES', `swap:${currentIndex}`);
      }
    } else if (phase === 'ready') {
      lastPlayedRef.current = '';
      halfwayFiredRef.current = false;
      countdownFiredRef.current = -1;
      setDebugStatus('ready');
    }
  }, [phase, currentIndex, current?.name, current?.stepType, next?.name, next?.stepType, playPhrase, playPrepThenGo, playStaticCue, scheduleTimer]);

  // Special blocks
  useEffect(() => {
    if (!current || !activeRef.current) return;
    if (phase === 'demo') {
      const key = `demo_${currentIndex}`;
      if (lastPlayedRef.current !== key) { lastPlayedRef.current = key; setDebugStatus('demo'); playPhrase('DEMO', `demo:${currentIndex}`); }
    } else if (phase === 'waterBreak') {
      const key = `water_${currentIndex}`;
      if (lastPlayedRef.current !== key) { lastPlayedRef.current = key; setDebugStatus('water'); playPhrase('WATER_BREAK', `water:${currentIndex}`); }
    } else if (phase === 'transition' || phase === 'grabEquipment') {
      const key = `trans_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        setDebugStatus('transition');
        // Use static "get ready" cue for transitions — do NOT speak raw instructionText
        // The instructionText is displayed on screen; speaking it would be jarring
        playPhrase('TRANSITION', `transition:${currentIndex}`);
      }
    } else if (phase === 'intro') {
      const key = `intro_${currentIndex}`;
      if (lastPlayedRef.current !== key) { lastPlayedRef.current = key; setDebugStatus('intro'); playStaticCue('lets_get_started', `intro:${currentIndex}`); }
    } else if (phase === 'complete') {
      const key = 'complete';
      if (lastPlayedRef.current !== key) { lastPlayedRef.current = key; setDebugStatus('done'); playPhrase('WORKOUT_COMPLETE', 'complete'); }
    }
  }, [phase, currentIndex, playPhrase, playStaticCue]);

  // Halfway
  useEffect(() => {
    if (phase !== 'work' || !current || current.stepType !== 'exercise') return;
    if (!activeRef.current) return;
    if (currentDuration <= 6) return;
    const hw = Math.floor(currentDuration / 2);
    if (timeLeft === hw && !halfwayFiredRef.current) {
      halfwayFiredRef.current = true;
      playPhrase('HALFWAY', `halfway:${currentIndex}`);
    }
  }, [phase, timeLeft, currentDuration, current, playPhrase, currentIndex]);

  // Countdown end of work
  useEffect(() => {
    if (phase !== 'work' || !current || current.stepType !== 'exercise') return;
    if (!activeRef.current) return;
    if (currentDuration <= 0) return;
    if (timeLeft === 3 && countdownFiredRef.current !== 3) {
      countdownFiredRef.current = 3;
      playStaticCue('countdown_3', `countdown:work:${currentIndex}`);
    }
  }, [phase, timeLeft, current, currentDuration, playStaticCue, currentIndex]);

  // Countdown end of rest/swap
  useEffect(() => {
    if (phase !== 'rest' && phase !== 'swap') return;
    if (!activeRef.current) return;
    if (timeLeft === 3 && countdownFiredRef.current !== 3) {
      countdownFiredRef.current = 3;
      playStaticCue('countdown_3_rest', `countdown:${phase}:${currentIndex}`);
    }
  }, [phase, timeLeft, playStaticCue, currentIndex]);

  // ── Cleanup: cancel ALL pending work on unmount ───────────────────
  useEffect(() => {
    activeRef.current = true;
    ttsLog('MOUNT — TTS hook active');

    return () => {
      ttsLog('UNMOUNT — TTS hook deactivating, cancelling all pending audio/speech');
      activeRef.current = false;

      // Cancel all tracked timers
      for (const id of pendingTimers.current) {
        clearTimeout(id);
      }
      pendingTimers.current.clear();

      // Stop all audio
      try {
        if (Platform.OS === 'web') {
          if (currentWebAudio) { currentWebAudio.pause(); currentWebAudio = null; }
          if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
        } else {
          if (currentNativeSound) { currentNativeSound.unloadAsync().catch(() => {}); currentNativeSound = null; }
          try { require('expo-speech').stop(); } catch {}
        }
      } catch {}
    };
  }, []);

  return { isPreloading, debugStatus, playStartCue };
}
