/**
 * useWorkoutTTS — Voice coaching hook for the Workout Player
 *
 * Audio pipeline:
 *   Web:    OpenAI TTS via generateVoice Cloud Function → AudioContext decode → play
 *           AudioContext is unlocked on the user's first tap (workout start button).
 *           This bypasses the browser autoplay policy that blocks audio triggered
 *           by timers rather than direct user gestures.
 *   Native: expo-speech (same normalized text, no network call needed)
 *
 * Caching:
 *   - audioCache: normalizedText → ArrayBuffer (persists for the session)
 *   - Storage path is deterministic (hash of text) so the same phrase always
 *     maps to the same file — enabling cross-session caching in Firebase Storage.
 *
 * Preloading:
 *   - Static cues are fetched and cached as ArrayBuffers when the workout starts.
 *   - This ensures zero latency on the first countdown/next-up cue.
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

// ── AudioContext — one shared context, unlocked on first user gesture ────────
// Must be module-level so it persists across re-renders.
let sharedAudioContext: AudioContext | null = null;
let audioContextUnlocked = false;

/**
 * Call this from a user gesture handler (e.g., the workout start button tap).
 * Creates and resumes the AudioContext so subsequent timer-triggered audio plays.
 */
export function unlockAudioContext(): void {
  if (typeof window === 'undefined') return;
  try {
    if (!sharedAudioContext) {
      sharedAudioContext = new (
        (window as any).AudioContext || (window as any).webkitAudioContext
      )();
    }
    const ctx = sharedAudioContext!;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    audioContextUnlocked = true;
  } catch {
    // AudioContext unavailable (e.g., SSR)
  }
}

// ── In-memory audio cache: normalizedText → ArrayBuffer ─────────────────────
// ArrayBuffer is reusable — decode a new AudioBuffer from it each play.
const audioCache = new Map<string, ArrayBuffer>();
// Track in-flight requests to avoid duplicate Cloud Function calls
const pendingRequests = new Map<string, Promise<ArrayBuffer | null>>();

// ── OpenAI TTS via Cloud Function ───────────────────────────────────────────
async function generateAndCacheAudio(text: string): Promise<ArrayBuffer | null> {
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

      // Fetch the MP3 as an ArrayBuffer for AudioContext decoding.
      // The CF calls file.makePublic() so this URL is publicly accessible.
      const resp = await fetch(url);
      if (!resp.ok) {
        console.warn('[useWorkoutTTS] fetch failed for:', url, resp.status);
        return null;
      }
      const buffer = await resp.arrayBuffer();
      audioCache.set(normalized, buffer);
      return buffer;
    } catch (err) {
      console.warn('[useWorkoutTTS] generateAndCacheAudio failed for:', normalized, err);
      return null;
    } finally {
      pendingRequests.delete(normalized);
    }
  })();

  pendingRequests.set(normalized, request);
  return request;
}

// ── AudioContext playback ────────────────────────────────────────────────────
// Uses AudioContext.decodeAudioData + AudioBufferSourceNode.
// This respects the unlocked AudioContext and is not subject to autoplay policy.
let currentSource: AudioBufferSourceNode | null = null;

async function playWithAudioContext(buffer: ArrayBuffer): Promise<void> {
  if (!sharedAudioContext || !audioContextUnlocked) {
    console.warn('[useWorkoutTTS] AudioContext not unlocked — skipping playback');
    return;
  }
  try {
    // Stop any currently playing audio
    if (currentSource) {
      try { currentSource.stop(); } catch {}
      currentSource = null;
    }
    // Clone the buffer — decodeAudioData detaches it in some browsers
    const bufferCopy = buffer.slice(0);
    const audioBuffer = await sharedAudioContext.decodeAudioData(bufferCopy);
    const source = sharedAudioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(sharedAudioContext.destination);
    source.start(0);
    currentSource = source;
    source.onended = () => {
      if (currentSource === source) currentSource = null;
    };
  } catch (err) {
    console.warn('[useWorkoutTTS] AudioContext playback error:', err);
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
  // On web: generates via OpenAI TTS (cached), plays via AudioContext.
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

      // Web: OpenAI TTS via AudioContext
      if (typeof window === 'undefined') return;
      const buffer = await generateAndCacheAudio(normalized);
      if (buffer && !isMuted && !ttsDisabled) {
        await playWithAudioContext(buffer);
      }
    },
    [isMuted, ttsDisabled],
  );

  // Convenience: speak a static cue key
  const playCue = useCallback(
    (key: StaticCueKey) => speakCue(STATIC_CUES[key]),
    [speakCue],
  );

  // ── Preload static cues on workout start ────────────────────────────
  // Fire-and-forget: fetch all 9 static cue MP3s into audioCache so the
  // first countdown fires instantly with no Cloud Function latency.
  useEffect(() => {
    if (phase === 'ready' || preloadedRef.current) return;
    if (Platform.OS !== 'web') return;
    preloadedRef.current = true;
    Object.values(STATIC_CUES).forEach((text) => {
      generateAndCacheAudio(text).catch(() => {});
    });
  }, [phase]);

  // ── Special block announcements ─────────────────────────────────────
  useEffect(() => {
    if (!current) return;
    const stepType = current.stepType;

    // Intro / Outro — no voice cue (full-screen video experience)
    if (phase === 'intro' || phase === 'outro') return;

    // Complete
    if (phase === 'complete') {
      const key = `complete_${currentIndex}`;
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
        if (currentSource) {
          try { currentSource.stop(); } catch {}
          currentSource = null;
        }
        if (Platform.OS !== 'web') {
          Speech.stop();
        }
      } catch {}
    };
  }, []);

  return { isTTSAvailable };
}
