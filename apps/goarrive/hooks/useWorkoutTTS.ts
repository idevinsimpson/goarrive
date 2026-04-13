/**
 * useWorkoutTTS — Phrase-driven voice coaching for the Workout Player
 *
 * Audio pipeline (priority order):
 *   1. Pre-generated OpenAI TTS clips (cached in Firebase Storage)
 *   2. Pre-existing static platform cues (Firebase Storage MP3s)
 *   3. Web Speech API fallback for movement names when clips aren't ready
 *
 * Cross-platform: uses HTMLAudioElement on web, expo-av Audio.Sound on native.
 *
 * Phrase system (deterministic — no AI decides what to say):
 *   PREP_NEXT        → "Next up, {movement}."  (then GO after delay)
 *   GO               → "Go."
 *   HALFWAY          → "That's halfway."
 *   SWAP_SIDES       → "Swap sides."
 *   DEMO             → "Here's what's coming up."
 *   WATER_BREAK      → "Rest. Grab some water."
 *   TRANSITION       → "{instructionText}" or "Get ready."
 *   WORKOUT_COMPLETE → "Your GoArrive workout is complete. Great job."
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
import { normalizeForSpeech, buildMovementPhrase } from '../utils/normalizeForSpeech';

// ── Pre-existing static platform cue URLs ───────────────────────────
// These are already in Firebase Storage — available immediately, no generation.
const BASE =
  'https://firebasestorage.googleapis.com/v0/b/goarrive.firebasestorage.app/o/voice_cache%2Fplatform%2F';
const CUE = (name: string) => `${BASE}${name}.mp3?alt=media`;

const STATIC_CUE_URLS: Record<string, string> = {
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

// Map event types to static cue keys (used as immediate fallback)
const EVENT_TO_STATIC: Partial<Record<TTSEvent, string>> = {
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

// ── Cross-platform audio player ─────────────────────────────────────

// Web: pool of HTMLAudioElement
const webPool: Record<string, HTMLAudioElement> = {};
// Native: track current sound for cleanup
let nativeSound: Audio.Sound | null = null;

/** Configure expo-av audio mode for native (allows background, mixes with others) */
let audioModeSet = false;
async function ensureAudioMode(): Promise<void> {
  if (audioModeSet || Platform.OS === 'web') return;
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });
    audioModeSet = true;
  } catch {}
}

/**
 * Play an audio URL. Cross-platform:
 * - Web: HTMLAudioElement with pool
 * - Native: expo-av Audio.Sound
 */
async function playUrl(url: string, onDone?: () => void): Promise<void> {
  if (!url) return;

  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return;
    try {
      // Stop current
      const prev = webPool.__current;
      if (prev) {
        prev.pause();
        prev.currentTime = 0;
      }

      let audio = webPool[url];
      if (!audio) {
        audio = new (window as any).Audio(url);
        audio.preload = 'auto';
        webPool[url] = audio;
      } else {
        audio.currentTime = 0;
      }

      webPool.__current = audio;
      if (onDone) audio.addEventListener('ended', onDone, { once: true });

      const playPromise = audio.play();
      if (playPromise && playPromise.catch) {
        playPromise.catch((err: any) => {
          console.warn('[TTS] Web audio play blocked:', err?.message);
        });
      }
    } catch (err) {
      console.warn('[TTS] Web audio error:', err);
    }
  } else {
    // Native via expo-av
    try {
      await ensureAudioMode();

      // Unload previous
      if (nativeSound) {
        try { await nativeSound.unloadAsync(); } catch {}
        nativeSound = null;
      }

      const { sound } = await Audio.Sound.createAsync(
        { uri: url },
        { shouldPlay: true, volume: 1.0 },
      );
      nativeSound = sound;

      if (onDone) {
        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish) {
            onDone();
          }
        });
      }
    } catch (err) {
      console.warn('[TTS] Native audio error:', err);
    }
  }
}

/** Preload a URL on web (noop on native — expo-av handles streaming) */
function preloadUrl(url: string): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  if (webPool[url]) return;
  try {
    const audio = new (window as any).Audio(url);
    audio.preload = 'auto';
    webPool[url] = audio;
  } catch {}
}

/** Unlock audio on user gesture (call on "Start Workout" tap) */
export function unlockAudio(): void {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      // Create and play a silent buffer to unlock AudioContext
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const buf = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(0);
      }
      // Also touch an Audio element to unlock HTMLAudioElement playback
      const silentAudio = new (window as any).Audio();
      silentAudio.play().catch(() => {});
    } catch {}
  }
}

// ── Web Speech API fallback ─────────────────────────────────────────
function speakFallback(text: string): void {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.95;
      utterance.pitch = 1.0;
      synth.speak(utterance);
    } catch {}
  } else {
    // Native fallback: use expo-speech
    try {
      const Speech = require('expo-speech');
      Speech.stop();
      Speech.speak(text, { language: 'en-US', rate: 0.95, pitch: 1.0 });
    } catch {}
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
  // Generated clip URLs (cacheKey → url). Stored in ref so playPhrase always sees latest.
  const clipUrlsRef = useRef<Record<string, string>>({});
  const [isPreloading, setIsPreloading] = useState(false);

  // Guards to prevent duplicate playback
  const lastPlayedRef = useRef<string>('');
  const halfwayPlayedRef = useRef<boolean>(false);
  const countdownPlayedRef = useRef<number>(-1);
  const goTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Batch-generate dynamic phrases (movement names) ───────────────
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
          // Preload the first few clips
          const urls = Object.values(result.data.urls);
          urls.slice(0, 6).forEach(preloadUrl);
        }
      } catch (err) {
        console.warn('[useWorkoutTTS] Batch generation failed:', err);
      } finally {
        if (!cancelled) setIsPreloading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [allPhrases, phase]);

  // ── Preload static cues on mount ──────────────────────────────────
  useEffect(() => {
    Object.values(STATIC_CUE_URLS).forEach(preloadUrl);
  }, []);

  // ── Play a phrase ─────────────────────────────────────────────────
  // Uses generated clip if available, falls back to static cue, then Web Speech.
  const playPhrase = useCallback(
    (event: TTSEvent, movementName?: string, weight?: string | number, instructionText?: string) => {
      if (isMuted) return;

      // 1. Try generated clip
      const phrase = getPhraseForEvent(event, movementName, weight, instructionText);
      const generatedUrl = clipUrlsRef.current[phrase.cacheKey];
      if (generatedUrl) {
        playUrl(generatedUrl);
        return;
      }

      // 2. Try static platform cue
      const staticKey = EVENT_TO_STATIC[event];
      if (staticKey && STATIC_CUE_URLS[staticKey]) {
        playUrl(STATIC_CUE_URLS[staticKey]);
        return;
      }

      // 3. Fallback to Web Speech (for movement names, transitions)
      if (phrase.text) {
        speakFallback(phrase.text);
      }
    },
    [isMuted],
  );

  // ── Play a static cue by key ──────────────────────────────────────
  const playCueByKey = useCallback(
    (key: string) => {
      if (isMuted) return;
      const url = STATIC_CUE_URLS[key];
      if (url) playUrl(url);
    },
    [isMuted],
  );

  // ── PREP_NEXT → GO chain ──────────────────────────────────────────
  const playPrepThenGo = useCallback(
    (movementName: string, weight?: string | number) => {
      if (isMuted) return;

      // Clear any pending GO timer
      if (goTimerRef.current) {
        clearTimeout(goTimerRef.current);
        goTimerRef.current = null;
      }

      // First: play "Next up, {movement}" (or static "next_up" + Web Speech fallback)
      const phrase = getPhraseForEvent('PREP_NEXT', movementName, weight);
      const generatedUrl = clipUrlsRef.current[phrase.cacheKey];

      if (generatedUrl) {
        // Generated clip available — play it, then play GO on end
        playUrl(generatedUrl, () => {
          goTimerRef.current = setTimeout(() => {
            playCueByKey('go');
          }, 400);
        });
      } else {
        // No generated clip — play static "next_up" cue, then speak name, then GO
        playCueByKey('next_up');
        setTimeout(() => {
          const spoken = buildMovementPhrase(movementName, weight);
          speakFallback(spoken);
          // GO after estimated speech duration (~1.5s)
          goTimerRef.current = setTimeout(() => {
            playCueByKey('go');
          }, 1800);
        }, 900);
      }
    },
    [isMuted, playCueByKey],
  );

  // ── Phase-driven playback ─────────────────────────────────────────

  // Exercise phases: work, rest, swap
  useEffect(() => {
    if (!current || current.stepType !== 'exercise') return;

    if (phase === 'work') {
      const key = `work_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        halfwayPlayedRef.current = false;
        countdownPlayedRef.current = -1;

        if (current.name && current.name !== 'Get Ready') {
          playPrepThenGo(current.name, current.weight);
        }
      }
    } else if (phase === 'rest') {
      const key = `rest_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        countdownPlayedRef.current = -1;

        // Play "nice work, rest" then announce next movement
        playCueByKey('nice_work_rest');
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
        countdownPlayedRef.current = -1;
        playPhrase('SWAP_SIDES');
      }
    } else if (phase === 'ready') {
      lastPlayedRef.current = '';
      halfwayPlayedRef.current = false;
      countdownPlayedRef.current = -1;
    }
  }, [phase, currentIndex, current?.name, current?.stepType, next?.name, next?.stepType, playPhrase, playPrepThenGo, playCueByKey]);

  // Special blocks
  useEffect(() => {
    if (!current) return;

    if (phase === 'demo') {
      const key = `demo_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        playPhrase('DEMO');
      }
    } else if (phase === 'waterBreak') {
      const key = `water_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        playPhrase('WATER_BREAK');
      }
    } else if (phase === 'transition' || phase === 'grabEquipment') {
      const key = `trans_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        playPhrase('TRANSITION', undefined, undefined, current.instructionText);
      }
    } else if (phase === 'intro') {
      const key = `intro_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        playCueByKey('lets_get_started');
      }
    } else if (phase === 'complete') {
      const key = 'complete';
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        playPhrase('WORKOUT_COMPLETE');
      }
    }
  }, [phase, currentIndex, current?.instructionText, playPhrase, playCueByKey]);

  // Halfway announcement
  useEffect(() => {
    if (phase !== 'work' || !current || current.stepType !== 'exercise') return;
    if (currentDuration <= 6) return;
    const halfway = Math.floor(currentDuration / 2);
    if (timeLeft === halfway && !halfwayPlayedRef.current) {
      halfwayPlayedRef.current = true;
      playPhrase('HALFWAY');
    }
  }, [phase, timeLeft, currentDuration, current, playPhrase]);

  // Countdown at end of work phase
  useEffect(() => {
    if (phase !== 'work' || !current || current.stepType !== 'exercise') return;
    if (currentDuration <= 0) return;

    if (timeLeft === 3 && countdownPlayedRef.current !== 3) {
      countdownPlayedRef.current = 3;
      playCueByKey('countdown_3');
    }
  }, [phase, timeLeft, current, currentDuration, playCueByKey]);

  // Countdown at end of rest/swap phase
  useEffect(() => {
    if (phase !== 'rest' && phase !== 'swap') return;
    if (timeLeft === 3 && countdownPlayedRef.current !== 3) {
      countdownPlayedRef.current = 3;
      playCueByKey('countdown_3_rest');
    }
  }, [phase, timeLeft, playCueByKey]);

  // ── Cleanup ────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (goTimerRef.current) clearTimeout(goTimerRef.current);
      try {
        if (Platform.OS === 'web') {
          const prev = webPool.__current;
          if (prev) { prev.pause(); }
          if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
        } else {
          if (nativeSound) { nativeSound.unloadAsync().catch(() => {}); nativeSound = null; }
          try { require('expo-speech').stop(); } catch {}
        }
      } catch {}
    };
  }, []);

  return { isPreloading, unlockAudio };
}
