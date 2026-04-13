/**
 * useWorkoutTTS — Phrase-driven voice coaching for the Workout Player
 *
 * Audio pipeline (priority order):
 *   1. Pre-generated OpenAI TTS clips (cached in Firebase Storage)
 *   2. Pre-existing static platform cues (Firebase Storage MP3s)
 *   3. Web Speech API / expo-speech fallback for movement names
 *
 * CRITICAL: The first audio.play() MUST happen in a user gesture handler
 * (the Start Workout tap). The hook returns `playStartCue()` which the
 * player must call directly in the onPress handler — NOT in a useEffect.
 * This unlocks HTMLAudioElement on Safari/iOS.
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
  type TTSPhrase,
} from '../utils/ttsPhrase';
import { buildMovementPhrase } from '../utils/normalizeForSpeech';

// ── Logging helper (always visible, never swallowed) ────────────────
function ttsLog(msg: string, ...args: any[]): void {
  console.log(`[TTS] ${msg}`, ...args);
}
function ttsError(msg: string, ...args: any[]): void {
  console.error(`[TTS] ${msg}`, ...args);
}

// ── Pre-existing static platform cue URLs ───────────────────────────
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

// Map phrase events to static cue keys (fallback when generated clip not ready)
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

// ── Cross-platform audio playback ───────────────────────────────────

// Web: pool of Audio elements, keyed by URL
const webAudioPool: Record<string, HTMLAudioElement> = {};
let currentWebAudio: HTMLAudioElement | null = null;
let audioUnlocked = false;

// Native: current expo-av sound
let currentNativeSound: Audio.Sound | null = null;
let nativeAudioModeReady = false;

/**
 * Play an audio URL. Returns true if play was initiated.
 * On web: HTMLAudioElement. On native: expo-av Audio.Sound.
 */
function playAudioUrl(url: string, onDone?: () => void): boolean {
  if (!url) {
    ttsLog('playAudioUrl: no URL provided');
    return false;
  }

  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return false;
    try {
      // Stop current audio
      if (currentWebAudio) {
        currentWebAudio.pause();
        currentWebAudio.currentTime = 0;
      }

      // Reuse pooled audio or create new
      let audio = webAudioPool[url];
      if (!audio) {
        audio = new (window as any).Audio(url);
        audio.preload = 'auto';
        webAudioPool[url] = audio;
        ttsLog('playAudioUrl: created new Audio element for', url.slice(-30));
      } else {
        audio.currentTime = 0;
      }

      currentWebAudio = audio;
      if (onDone) {
        audio.addEventListener('ended', onDone, { once: true });
      }

      const playPromise = audio.play();
      if (playPromise) {
        playPromise
          .then(() => {
            ttsLog('playAudioUrl: play() SUCCEEDED for', url.slice(-30));
            audioUnlocked = true;
          })
          .catch((err: any) => {
            ttsError('playAudioUrl: play() REJECTED:', err?.name, err?.message);
            // If NotAllowedError, audio is not unlocked
            if (err?.name === 'NotAllowedError') {
              ttsError('playAudioUrl: AUTOPLAY BLOCKED — need user gesture');
              audioUnlocked = false;
            }
          });
      }
      return true;
    } catch (err) {
      ttsError('playAudioUrl: exception:', err);
      return false;
    }
  } else {
    // Native: expo-av
    (async () => {
      try {
        if (!nativeAudioModeReady) {
          ttsLog('playAudioUrl: setting native audio mode');
          await Audio.setAudioModeAsync({
            playsInSilentModeIOS: true,
            staysActiveInBackground: false,
            shouldDuckAndroid: true,
          });
          nativeAudioModeReady = true;
        }

        // Unload previous
        if (currentNativeSound) {
          try { await currentNativeSound.unloadAsync(); } catch {}
          currentNativeSound = null;
        }

        ttsLog('playAudioUrl: loading native sound from', url.slice(-30));
        const { sound } = await Audio.Sound.createAsync(
          { uri: url },
          { shouldPlay: true, volume: 1.0 },
        );
        currentNativeSound = sound;
        ttsLog('playAudioUrl: native sound playing');

        if (onDone) {
          sound.setOnPlaybackStatusUpdate((status) => {
            if (status.isLoaded && status.didJustFinish) {
              onDone();
            }
          });
        }
      } catch (err) {
        ttsError('playAudioUrl: native error:', err);
      }
    })();
    return true;
  }
}

/** Preload a URL into the web audio pool */
function preloadWebAudio(url: string): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  if (webAudioPool[url]) return;
  try {
    const audio = new (window as any).Audio(url);
    audio.preload = 'auto';
    webAudioPool[url] = audio;
  } catch {}
}

// ── Web Speech API / expo-speech fallback ───────────────────────────
function speakText(text: string): void {
  ttsLog('speakText: falling back to speech synthesis:', text);
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return;
    try {
      const synth = window.speechSynthesis;
      if (!synth) { ttsError('speakText: speechSynthesis not available'); return; }
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.95;
      utterance.pitch = 1.0;
      synth.speak(utterance);
      ttsLog('speakText: Web Speech initiated');
    } catch (err) {
      ttsError('speakText: Web Speech error:', err);
    }
  } else {
    try {
      const Speech = require('expo-speech');
      Speech.stop();
      Speech.speak(text, { language: 'en-US', rate: 0.95, pitch: 1.0 });
      ttsLog('speakText: expo-speech initiated');
    } catch (err) {
      ttsError('speakText: expo-speech error:', err);
    }
  }
}

// ── Configure native audio on import ────────────────────────────────
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
  // Generated TTS clip URLs (from batchGenerateVoice)
  const clipUrlsRef = useRef<Record<string, string>>({});
  const [isPreloading, setIsPreloading] = useState(false);
  const [debugStatus, setDebugStatus] = useState('init');

  // Playback guards
  const lastPlayedRef = useRef('');
  const halfwayFiredRef = useRef(false);
  const countdownFiredRef = useRef(-1);
  const goTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Preload all static cues on mount ──────────────────────────────
  useEffect(() => {
    ttsLog('Preloading static cues...');
    Object.entries(STATIC_CUES).forEach(([key, url]) => {
      preloadWebAudio(url);
    });
    ttsLog('Static cues preloaded:', Object.keys(STATIC_CUES).length);
  }, []);

  // ── Batch-generate dynamic TTS phrases ────────────────────────────
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
    setDebugStatus('generating clips...');
    ttsLog('Starting batch generation for', allPhrases.length, 'phrases');

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
          const count = Object.keys(result.data.urls).length;
          ttsLog('Batch generation complete:', count, 'clips cached');
          setDebugStatus(`${count} clips ready`);
          // Preload first few
          Object.values(result.data.urls).slice(0, 6).forEach(preloadWebAudio);
        }
      } catch (err) {
        ttsError('Batch generation failed:', err);
        if (!cancelled) setDebugStatus('clips failed - using fallback');
      } finally {
        if (!cancelled) setIsPreloading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [allPhrases, phase]);

  // ── Play a static cue by key ──────────────────────────────────────
  const playStaticCue = useCallback((key: string): boolean => {
    if (isMuted) { ttsLog('playStaticCue: MUTED, skipping', key); return false; }
    const url = STATIC_CUES[key];
    if (!url) { ttsError('playStaticCue: unknown key', key); return false; }
    ttsLog('playStaticCue:', key);
    return playAudioUrl(url);
  }, [isMuted]);

  // ── Play a phrase (generated clip → static fallback → speech) ─────
  const playPhrase = useCallback((
    event: TTSEvent,
    movementName?: string,
    weight?: string | number,
    instructionText?: string,
  ) => {
    if (isMuted) { ttsLog('playPhrase: MUTED, skipping', event); return; }

    const phrase = getPhraseForEvent(event, movementName, weight, instructionText);
    ttsLog('playPhrase:', event, '| text:', phrase.text, '| key:', phrase.cacheKey);

    // Layer 1: generated clip
    const generatedUrl = clipUrlsRef.current[phrase.cacheKey];
    if (generatedUrl) {
      ttsLog('playPhrase: using generated clip');
      playAudioUrl(generatedUrl);
      return;
    }

    // Layer 2: static platform cue
    const staticKey = EVENT_STATIC_MAP[event];
    if (staticKey && STATIC_CUES[staticKey]) {
      ttsLog('playPhrase: using static cue fallback:', staticKey);
      playAudioUrl(STATIC_CUES[staticKey]);
      return;
    }

    // Layer 3: speech synthesis
    if (phrase.text) {
      ttsLog('playPhrase: using speech synthesis fallback');
      speakText(phrase.text);
      return;
    }

    ttsError('playPhrase: NO AUDIO PATH for event', event);
  }, [isMuted]);

  // ── PREP_NEXT → GO chain ──────────────────────────────────────────
  const playPrepThenGo = useCallback((movementName: string, weight?: string | number) => {
    if (isMuted) return;

    if (goTimerRef.current) {
      clearTimeout(goTimerRef.current);
      goTimerRef.current = null;
    }

    const phrase = getPhraseForEvent('PREP_NEXT', movementName, weight);
    const generatedUrl = clipUrlsRef.current[phrase.cacheKey];

    if (generatedUrl) {
      ttsLog('playPrepThenGo: generated clip available');
      playAudioUrl(generatedUrl, () => {
        goTimerRef.current = setTimeout(() => {
          ttsLog('playPrepThenGo: chaining GO');
          playStaticCue('go');
        }, 400);
      });
    } else {
      ttsLog('playPrepThenGo: no clip, using static next_up + speech fallback');
      playStaticCue('next_up');
      setTimeout(() => {
        const spoken = buildMovementPhrase(movementName, weight);
        speakText(spoken);
        goTimerRef.current = setTimeout(() => {
          ttsLog('playPrepThenGo: chaining GO after speech');
          playStaticCue('go');
        }, 1800);
      }, 900);
    }
  }, [isMuted, playStaticCue]);

  // ── playStartCue: MUST be called directly in gesture handler ──────
  // This is what actually unlocks audio on Safari/iOS. The Start button
  // onPress must call this SYNCHRONOUSLY, not via useEffect.
  const playStartCue = useCallback(() => {
    if (isMuted) return;
    ttsLog('playStartCue: called from gesture handler (audio unlock)');
    ttsLog('playStartCue: audioUnlocked was:', audioUnlocked);

    // Play a real audio file directly in the gesture handler.
    // This is the canonical way to unlock HTMLAudioElement on Safari.
    const url = STATIC_CUES.lets_get_started;
    if (url) {
      playAudioUrl(url);
      ttsLog('playStartCue: play() called in gesture context');
    }
  }, [isMuted]);

  // ── Phase-driven playback ─────────────────────────────────────────

  // Exercise phases
  useEffect(() => {
    if (!current || current.stepType !== 'exercise') return;

    if (phase === 'work') {
      const key = `work_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        halfwayFiredRef.current = false;
        countdownFiredRef.current = -1;
        setDebugStatus(`work: ${current.name}`);

        if (current.name && current.name !== 'Get Ready') {
          // Don't play prep cue for the very first movement — playStartCue already played
          if (currentIndex === 0) {
            ttsLog('Skipping prep for first movement (playStartCue already fired)');
            // Just queue the GO cue after a moment
            goTimerRef.current = setTimeout(() => {
              playStaticCue('go');
            }, 2000);
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
          setTimeout(() => {
            playPhrase('PREP_NEXT', next.name, next.weight);
          }, 1800);
        }
      }
    } else if (phase === 'swap') {
      const key = `swap_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        countdownFiredRef.current = -1;
        setDebugStatus('swap sides');
        playPhrase('SWAP_SIDES');
      }
    } else if (phase === 'ready') {
      lastPlayedRef.current = '';
      halfwayFiredRef.current = false;
      countdownFiredRef.current = -1;
      setDebugStatus('ready');
    }
  }, [phase, currentIndex, current?.name, current?.stepType, next?.name, next?.stepType, playPhrase, playPrepThenGo, playStaticCue]);

  // Special block phases
  useEffect(() => {
    if (!current) return;

    if (phase === 'demo') {
      const key = `demo_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        setDebugStatus('demo');
        playPhrase('DEMO');
      }
    } else if (phase === 'waterBreak') {
      const key = `water_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        setDebugStatus('water break');
        playPhrase('WATER_BREAK');
      }
    } else if (phase === 'transition' || phase === 'grabEquipment') {
      const key = `trans_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        setDebugStatus('transition');
        playPhrase('TRANSITION', undefined, undefined, current.instructionText);
      }
    } else if (phase === 'intro') {
      const key = `intro_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        setDebugStatus('intro');
        playStaticCue('lets_get_started');
      }
    } else if (phase === 'complete') {
      const key = 'complete';
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        setDebugStatus('complete');
        playPhrase('WORKOUT_COMPLETE');
      }
    }
  }, [phase, currentIndex, current?.instructionText, playPhrase, playStaticCue]);

  // Halfway
  useEffect(() => {
    if (phase !== 'work' || !current || current.stepType !== 'exercise') return;
    if (currentDuration <= 6) return;
    const halfway = Math.floor(currentDuration / 2);
    if (timeLeft === halfway && !halfwayFiredRef.current) {
      halfwayFiredRef.current = true;
      ttsLog('Halfway cue at', timeLeft, 'seconds');
      playPhrase('HALFWAY');
    }
  }, [phase, timeLeft, currentDuration, current, playPhrase]);

  // Countdown at end of work
  useEffect(() => {
    if (phase !== 'work' || !current || current.stepType !== 'exercise') return;
    if (currentDuration <= 0) return;
    if (timeLeft === 3 && countdownFiredRef.current !== 3) {
      countdownFiredRef.current = 3;
      ttsLog('Countdown 3 (work)');
      playStaticCue('countdown_3');
    }
  }, [phase, timeLeft, current, currentDuration, playStaticCue]);

  // Countdown at end of rest/swap
  useEffect(() => {
    if (phase !== 'rest' && phase !== 'swap') return;
    if (timeLeft === 3 && countdownFiredRef.current !== 3) {
      countdownFiredRef.current = 3;
      ttsLog('Countdown 3 (rest/swap)');
      playStaticCue('countdown_3_rest');
    }
  }, [phase, timeLeft, playStaticCue]);

  // ── Cleanup ────────────────────────────────────────────────────────
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
