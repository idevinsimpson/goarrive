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
 *   3. Web Speech API / expo-speech fallback for movement names
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
// This is a valid silent MP3 frame. Playing it from a user gesture
// handler unlocks HTMLAudioElement for all subsequent programmatic plays.
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

// ── Module-level audio state ────────────────────────────────────────
let audioUnlocked = false;
let currentWebAudio: HTMLAudioElement | null = null;
let currentNativeSound: Audio.Sound | null = null;
let nativeAudioModeReady = false;
const webPool: Record<string, HTMLAudioElement> = {};

// ── Document-level audio unlock (Safari/iOS) ────────────────────────
// Fires on the FIRST user touch/click, in the native DOM event handler
// (before React's synthetic events). This is the only reliable way to
// unlock audio on Safari iOS.
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

    // Don't remove listeners yet — keep trying on subsequent touches
    // in case the first one was too early
  };

  // touchend and click are the events Safari recognizes as user gestures
  document.addEventListener('touchend', unlock, { passive: true });
  document.addEventListener('click', unlock, { passive: true });
  ttsLog('Audio unlock listeners attached to document');
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
function playAudioUrl(url: string, onDone?: () => void): boolean {
  if (!url) { ttsLog('playAudioUrl: no URL'); return false; }

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
          ttsLog('play() OK:', url.slice(-25));
          audioUnlocked = true;
        }).catch((err: any) => {
          ttsError('play() FAIL:', err?.name, err?.message, '| url:', url.slice(-25));
          if (err?.name === 'NotAllowedError') {
            ttsError('AUTOPLAY BLOCKED — user gesture required. audioUnlocked:', audioUnlocked);
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
        ttsLog('Native play OK:', url.slice(-25));
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

// ── Speech fallback ─────────────────────────────────────────────────
function speakText(text: string): void {
  ttsLog('speakText:', text);
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
  const goTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

        if (!cancelled) {
          clipUrlsRef.current = result.data.urls;
          const n = Object.keys(result.data.urls).length;
          ttsLog('Batch done:', n, 'clips');
          setDebugStatus(`${n} clips`);
          Object.values(result.data.urls).slice(0, 6).forEach(preloadUrl);
        }
      } catch (err) {
        ttsError('Batch failed:', err);
        if (!cancelled) setDebugStatus('fallback');
      } finally {
        if (!cancelled) setIsPreloading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [allPhrases, phase]);

  // ── Playback functions ────────────────────────────────────────────
  const playStaticCue = useCallback((key: string): boolean => {
    if (isMuted) return false;
    const url = STATIC_CUES[key];
    if (!url) { ttsError('Unknown cue:', key); return false; }
    ttsLog('cue:', key);
    return playAudioUrl(url);
  }, [isMuted]);

  const playPhrase = useCallback((
    event: TTSEvent,
    movementName?: string,
    weight?: string | number,
    instructionText?: string,
  ) => {
    if (isMuted) return;

    const phrase = getPhraseForEvent(event, movementName, weight, instructionText);
    ttsLog('phrase:', event, phrase.text.slice(0, 40));

    // Layer 1: generated clip
    const gUrl = clipUrlsRef.current[phrase.cacheKey];
    if (gUrl) { playAudioUrl(gUrl); return; }

    // Layer 2: static cue
    const sk = EVENT_STATIC_MAP[event];
    if (sk && STATIC_CUES[sk]) { ttsLog('static fallback:', sk); playAudioUrl(STATIC_CUES[sk]); return; }

    // Layer 3: speech
    if (phrase.text) { speakText(phrase.text); return; }

    ttsError('NO AUDIO PATH for', event);
  }, [isMuted]);

  const playPrepThenGo = useCallback((name: string, weight?: string | number) => {
    if (isMuted) return;
    if (goTimerRef.current) { clearTimeout(goTimerRef.current); goTimerRef.current = null; }

    const phrase = getPhraseForEvent('PREP_NEXT', name, weight);
    const gUrl = clipUrlsRef.current[phrase.cacheKey];

    if (gUrl) {
      playAudioUrl(gUrl, () => {
        goTimerRef.current = setTimeout(() => playStaticCue('go'), 400);
      });
    } else {
      playStaticCue('next_up');
      setTimeout(() => {
        speakText(buildMovementPhrase(name, weight));
        goTimerRef.current = setTimeout(() => playStaticCue('go'), 1800);
      }, 900);
    }
  }, [isMuted, playStaticCue]);

  // ── playStartCue: called from gesture handler as backup unlock ────
  const playStartCue = useCallback(() => {
    if (isMuted) return;
    ttsLog('playStartCue (gesture handler), unlocked:', audioUnlocked);

    // Play a real cue — this also serves as a gesture-context unlock
    // in case the document-level listener hasn't fired yet
    const url = STATIC_CUES.lets_get_started;
    if (url) {
      // Create a FRESH Audio element and play it directly
      // (don't reuse pool — Safari may need a fresh element in gesture)
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
        // Native
        playAudioUrl(url);
      }
    }
  }, [isMuted]);

  // ── Phase-driven playback ─────────────────────────────────────────

  useEffect(() => {
    if (!current || current.stepType !== 'exercise') return;

    if (phase === 'work') {
      const key = `work_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        halfwayFiredRef.current = false;
        countdownFiredRef.current = -1;
        setDebugStatus(`work: ${current.name?.slice(0, 20)}`);

        if (current.name && current.name !== 'Get Ready') {
          if (currentIndex === 0) {
            // First movement: playStartCue already played "let's get started"
            goTimerRef.current = setTimeout(() => playStaticCue('go'), 2000);
          } else {
            playPrepThenGo(current.name, current.weight);
          }
        }
      }
    } else if (phase === 'rest') {
      const key = `rest_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        countdownFiredRef.current = -1;
        setDebugStatus('rest');
        playStaticCue('nice_work_rest');
        if (next?.stepType === 'exercise' && next.name && next.name !== 'Get Ready') {
          setTimeout(() => playPhrase('PREP_NEXT', next.name, next.weight), 1800);
        }
      }
    } else if (phase === 'swap') {
      const key = `swap_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        countdownFiredRef.current = -1;
        setDebugStatus('swap');
        playPhrase('SWAP_SIDES');
      }
    } else if (phase === 'ready') {
      lastPlayedRef.current = '';
      halfwayFiredRef.current = false;
      countdownFiredRef.current = -1;
      setDebugStatus('ready');
    }
  }, [phase, currentIndex, current?.name, current?.stepType, next?.name, next?.stepType, playPhrase, playPrepThenGo, playStaticCue]);

  // Special blocks
  useEffect(() => {
    if (!current) return;
    if (phase === 'demo') {
      const key = `demo_${currentIndex}`;
      if (lastPlayedRef.current !== key) { lastPlayedRef.current = key; setDebugStatus('demo'); playPhrase('DEMO'); }
    } else if (phase === 'waterBreak') {
      const key = `water_${currentIndex}`;
      if (lastPlayedRef.current !== key) { lastPlayedRef.current = key; setDebugStatus('water'); playPhrase('WATER_BREAK'); }
    } else if (phase === 'transition' || phase === 'grabEquipment') {
      const key = `trans_${currentIndex}`;
      if (lastPlayedRef.current !== key) { lastPlayedRef.current = key; setDebugStatus('transition'); playPhrase('TRANSITION', undefined, undefined, current.instructionText); }
    } else if (phase === 'intro') {
      const key = `intro_${currentIndex}`;
      if (lastPlayedRef.current !== key) { lastPlayedRef.current = key; setDebugStatus('intro'); playStaticCue('lets_get_started'); }
    } else if (phase === 'complete') {
      const key = 'complete';
      if (lastPlayedRef.current !== key) { lastPlayedRef.current = key; setDebugStatus('done'); playPhrase('WORKOUT_COMPLETE'); }
    }
  }, [phase, currentIndex, current?.instructionText, playPhrase, playStaticCue]);

  // Halfway
  useEffect(() => {
    if (phase !== 'work' || !current || current.stepType !== 'exercise') return;
    if (currentDuration <= 6) return;
    const hw = Math.floor(currentDuration / 2);
    if (timeLeft === hw && !halfwayFiredRef.current) {
      halfwayFiredRef.current = true;
      playPhrase('HALFWAY');
    }
  }, [phase, timeLeft, currentDuration, current, playPhrase]);

  // Countdown end of work
  useEffect(() => {
    if (phase !== 'work' || !current || current.stepType !== 'exercise') return;
    if (currentDuration <= 0) return;
    if (timeLeft === 3 && countdownFiredRef.current !== 3) {
      countdownFiredRef.current = 3;
      playStaticCue('countdown_3');
    }
  }, [phase, timeLeft, current, currentDuration, playStaticCue]);

  // Countdown end of rest/swap
  useEffect(() => {
    if (phase !== 'rest' && phase !== 'swap') return;
    if (timeLeft === 3 && countdownFiredRef.current !== 3) {
      countdownFiredRef.current = 3;
      playStaticCue('countdown_3_rest');
    }
  }, [phase, timeLeft, playStaticCue]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (goTimerRef.current) clearTimeout(goTimerRef.current);
      try {
        if (Platform.OS === 'web') {
          if (currentWebAudio) currentWebAudio.pause();
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
