/**
 * useWorkoutTTS — Voice coaching hook for the Workout Player
 *
 * Audio pipeline:
 *   Web:    OpenAI TTS via generateVoice Cloud Function → cached blob URL → HTMLAudioElement
 *   Native: expo-speech (same normalized text, no network call needed)
 *
 * All cue text is deterministic — derived directly from player/build state.
 * OpenAI is used only for speech generation, never for deciding what to say.
 *
 * Caching: in-memory Map<normalizedText, blobUrl> — persists for the session.
 * Preloading: static cues are generated and cached when the workout starts.
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import { getFunctions, httpsCallable } from 'firebase/functions';
import type { StepType } from './useWorkoutFlatten';

// ── Text normalization ──────────────────────────────────────────────────────
function normalizeCueText(text: string): string {
  return text
    .replace(/\bT-spine\b/gi, 'T spine')
    .replace(/\bU-handle\b/gi, 'U handle')
    .replace(/\bsingle-arm\b/gi, 'single arm')
    .replace(/\bdouble-arm\b/gi, 'double arm')
    .replace(/\bDB\b/g, 'dumbbell')
    .replace(/\bDBs\b/g, 'dumbbells')
    .replace(/\bKB\b/g, 'kettlebell')
    .replace(/\bKBs\b/g, 'kettlebells')
    .replace(/\bBB\b/g, 'barbell')
    .replace(/(\d+)\s*lbs?\b/gi, '$1 pounds')
    .replace(/(\d+)\s*kg\b/gi, '$1 kilograms')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Static cue texts (deterministic, pre-generated on workout start) ────────
const STATIC_CUES = {
  countdown:        '3, 2, 1.',
  go:               '3, 2, 1. Go.',
  halfway:          "That's halfway.",
  swap_sides:       '3, 2, 1. Swap sides.',
  water_break:      '3, 2, 1. Grab some water.',
  demo:             "3, 2, 1. Here's what's coming up.",
  workout_complete: 'Your GoArrive workout is complete. Great job.',
  rest:             '3, 2, 1. Rest.',
  lets_go:          "Let's go.",
} as const;

type StaticCueKey = keyof typeof STATIC_CUES;

// ── In-memory audio cache: normalizedText → blob URL ────────────────────────
const audioCache = new Map<string, string>();
// Track in-flight requests to avoid duplicate Cloud Function calls
const pendingRequests = new Map<string, Promise<string | null>>();

// ── OpenAI TTS via Cloud Function ───────────────────────────────────────────
async function generateAndCacheAudio(text: string): Promise<string | null> {
  const normalized = normalizeCueText(text);
  if (audioCache.has(normalized)) return audioCache.get(normalized)!;
  if (pendingRequests.has(normalized)) return pendingRequests.get(normalized)!;

  const request = (async () => {
    try {
      const functions = getFunctions(undefined, 'us-central1');
      const generateVoice = httpsCallable<
        { text: string; voice: string },
        { url: string; path: string }
      >(functions, 'generateVoice');
      const result = await generateVoice({ text: normalized, voice: 'onyx' });
      const url = result.data.url;
      // Fetch and convert to blob URL so it plays offline after first load
      const resp = await fetch(url);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      audioCache.set(normalized, blobUrl);
      return blobUrl;
    } catch {
      return null;
    } finally {
      pendingRequests.delete(normalized);
    }
  })();

  pendingRequests.set(normalized, request);
  return request;
}

// ── HTMLAudioElement playback ────────────────────────────────────────────────
let currentAudio: HTMLAudioElement | null = null;

function playBlobUrl(blobUrl: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    }
    const audio = new (window as any).Audio(blobUrl);
    currentAudio = audio;
    audio.play().catch(() => {});
  } catch {
    // Audio API unavailable
  }
}

// ── Types ────────────────────────────────────────────────────────────────────
type Phase = 'ready' | 'work' | 'rest' | 'swap' | 'complete'
  | 'intro' | 'outro' | 'demo' | 'transition' | 'waterBreak' | 'grabEquipment';

interface UseWorkoutTTSOptions {
  phase: Phase;
  current: {
    name: string;
    stepType?: StepType;
    instructionText?: string;
    demoMovements?: { name: string }[];
    weight?: string | number;
    [key: string]: any;
  } | null;
  next: { name: string; weight?: string | number; [key: string]: any } | null;
  isMuted: boolean;
  ttsDisabled?: boolean;
  currentIndex: number;
  total: number;
  timeLeft: number;
  currentDuration: number;
}

// ── Build "Next up, {name}{, weight}" phrase ────────────────────────────────
function buildNextUpPhrase(name: string, weight?: string | number): string {
  const cleanName = normalizeCueText(name);
  if (weight) {
    const cleanWeight = normalizeCueText(String(weight));
    return `3, 2, 1. Next up, ${cleanName}, ${cleanWeight}.`;
  }
  return `3, 2, 1. Next up, ${cleanName}.`;
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useWorkoutTTS({
  phase,
  current,
  next,
  isMuted,
  ttsDisabled = false,
  currentIndex,
  total,
  timeLeft,
  currentDuration,
}: UseWorkoutTTSOptions) {
  const lastSpokenRef = useRef<string>('');
  const [isTTSAvailable, setIsTTSAvailable] = useState(true);
  const halfwaySpokenRef = useRef<boolean>(false);
  const countdownSpokenRef = useRef<number>(-1);
  const welcomeSpokenRef = useRef<boolean>(false);
  const preloadedRef = useRef<boolean>(false);

  // ── TTS availability check ──────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS === 'web') {
      setIsTTSAvailable(typeof window !== 'undefined');
    } else {
      Speech.getAvailableVoicesAsync()
        .then((voices) => setIsTTSAvailable(voices.length > 0))
        .catch(() => setIsTTSAvailable(false));
    }
  }, []);

  // ── Core speak function ─────────────────────────────────────────────
  // On web: generates via OpenAI TTS (cached), plays as blob URL.
  // On native: uses expo-speech with the same normalized text.
  const speakCue = useCallback(
    async (text: string) => {
      if (isMuted || ttsDisabled) return;
      const normalized = normalizeCueText(text);

      if (Platform.OS !== 'web') {
        // Native: expo-speech
        try {
          Speech.stop();
          Speech.speak(normalized, { language: 'en-US', rate: 0.95, pitch: 1.0 });
        } catch {}
        return;
      }

      // Web: OpenAI TTS
      if (typeof window === 'undefined') return;
      const blobUrl = await generateAndCacheAudio(normalized);
      if (blobUrl && !isMuted && !ttsDisabled) {
        playBlobUrl(blobUrl);
      }
    },
    [isMuted, ttsDisabled],
  );

  // Convenience: speak a static cue key
  const playCue = useCallback(
    (key: StaticCueKey) => speakCue(STATIC_CUES[key]),
    [speakCue],
  );

  // ── Preload static cues when workout starts ─────────────────────────
  // Only on web — native uses expo-speech which needs no preloading.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined') return;
    if (preloadedRef.current) return;
    if (phase === 'ready') return; // wait until workout actually starts
    preloadedRef.current = true;
    // Fire-and-forget: generate and cache all static cues
    Object.values(STATIC_CUES).forEach((text) => {
      generateAndCacheAudio(text).catch(() => {});
    });
  }, [phase]);

  // ── Special block announcements ─────────────────────────────────────
  useEffect(() => {
    if (!current) return;
    const stepType = current.stepType;

    // Intro block
    if (phase === 'intro' || (phase === 'work' && stepType === 'intro')) {
      const key = `intro_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        playCue('lets_go');
      }
      return;
    }

    // Outro block
    if (phase === 'outro' || (phase === 'work' && stepType === 'outro')) {
      const key = `outro_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        playCue('workout_complete');
      }
      return;
    }

    // Demo block — "3, 2, 1. Here's what's coming up."
    if (phase === 'demo' || (phase === 'work' && stepType === 'demo')) {
      const key = `demo_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        playCue('demo');
      }
      return;
    }

    // Transition / Grab Equipment — speak the coach-authored instruction text
    if (
      phase === 'transition' || (phase === 'work' && stepType === 'transition') ||
      phase === 'grabEquipment' || (phase === 'work' && stepType === 'grabEquipment')
    ) {
      const key = `transition_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        const instruction = current.instructionText || current.description || '';
        if (instruction) {
          speakCue(`3, 2, 1. ${normalizeCueText(instruction)}`);
        } else {
          playCue('lets_go');
        }
      }
      return;
    }

    // Water Break block
    if (phase === 'waterBreak' || (phase === 'work' && stepType === 'waterBreak')) {
      const key = `waterBreak_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        playCue('water_break');
      }
      return;
    }
  }, [phase, current?.stepType, currentIndex, speakCue, playCue]);

  // ── Welcome message on first work phase ────────────────────────────
  useEffect(() => {
    if (phase === 'work' && currentIndex === 0 && !welcomeSpokenRef.current) {
      if (current?.stepType === 'exercise') {
        welcomeSpokenRef.current = true;
        playCue('lets_go');
      }
    }
  }, [phase, currentIndex, current?.stepType, playCue]);

  // ── Exercise movement announcements ────────────────────────────────
  useEffect(() => {
    if (!current || current.stepType !== 'exercise') return;

    if (phase === 'work') {
      const key = `work_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        halfwaySpokenRef.current = false;
        countdownSpokenRef.current = -1;
        // "3, 2, 1. Next up, {movement name}{, weight}."
        const phrase = buildNextUpPhrase(current.name, current.weight);
        speakCue(phrase);
      }
    } else if (phase === 'rest') {
      const key = `rest_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        if (next && next.stepType === 'exercise') {
          // "3, 2, 1. Next up, {next movement name}{, weight}."
          const phrase = buildNextUpPhrase(next.name, next.weight);
          speakCue(phrase);
        } else {
          playCue('rest');
        }
      }
    } else if (phase === 'swap') {
      const key = `swap_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        playCue('swap_sides');
      }
    } else if (phase === 'ready') {
      lastSpokenRef.current = '';
      welcomeSpokenRef.current = false;
      halfwaySpokenRef.current = false;
      countdownSpokenRef.current = -1;
      preloadedRef.current = false;
    }
  }, [phase, current?.name, current?.stepType, current?.weight, currentIndex, next?.name, next?.stepType, next?.weight, speakCue, playCue]);

  // ── Halfway announcement (exercise only) ───────────────────────────
  useEffect(() => {
    if (phase !== 'work' || !current || current.stepType !== 'exercise') return;
    if (currentDuration <= 6) return;
    const halfway = Math.floor(currentDuration / 2);
    if (timeLeft === halfway && !halfwaySpokenRef.current) {
      halfwaySpokenRef.current = true;
      playCue('halfway');
    }
  }, [phase, timeLeft, currentDuration, current, playCue]);

  // ── Countdown (exercise only) ───────────────────────────────────────
  // At timeLeft === 3 → "3, 2, 1."
  // At timeLeft === 0 → "3, 2, 1. Rest." or "Your GoArrive workout is complete. Great job."
  useEffect(() => {
    if (phase !== 'work' || !current || current.stepType !== 'exercise') return;
    if (currentDuration <= 0) return;

    if (timeLeft === 3 && countdownSpokenRef.current !== 3) {
      countdownSpokenRef.current = 3;
      playCue('countdown');
    } else if (timeLeft === 0 && countdownSpokenRef.current !== 0) {
      countdownSpokenRef.current = 0;
      const isLastMovement = currentIndex >= total - 1;
      if (isLastMovement) {
        playCue('workout_complete');
      } else {
        playCue('rest');
      }
    }
  }, [phase, timeLeft, current, currentDuration, currentIndex, total, playCue]);

  // ── Cleanup ─────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      try {
        if (currentAudio) {
          currentAudio.pause();
          currentAudio = null;
        }
        if (Platform.OS !== 'web') {
          Speech.stop();
        }
      } catch {}
    };
  }, []);

  return { isTTSAvailable };
}
