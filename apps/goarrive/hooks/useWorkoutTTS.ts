/**
 * useWorkoutTTS — Phrase-driven voice coaching for the Workout Player
 *
 * Architecture:
 *   1. On workout open: generate all unique phrases via batchGenerateVoice
 *   2. Cache URLs in a local map keyed by cacheKey
 *   3. Preload current + next 2 clips as Audio elements
 *   4. On phase/state change: look up the correct phrase, play its cached clip
 *
 * Phrase system (deterministic — no AI decides what to say):
 *   PREP_NEXT        → "Next up, {movement}."
 *   GO               → "Go."
 *   HALFWAY          → "That's halfway."
 *   SWAP_SIDES       → "Swap sides."
 *   DEMO             → "Here's what's coming up."
 *   WATER_BREAK      → "Rest. Grab some water."
 *   TRANSITION       → "{instructionText}" or "Get ready."
 *   WORKOUT_COMPLETE → "Your GoArrive workout is complete. Great job."
 *
 * Countdown "3, 2, 1" uses pre-generated static cues (unchanged).
 * All dynamic phrases use OpenAI TTS (voice: onyx) via batchGenerateVoice.
 */
import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { Platform } from 'react-native';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  generateWorkoutPhrases,
  getPhraseForEvent,
  type TTSEvent,
  type TTSPhrase,
  type FlatStep,
} from '../utils/ttsPhrase';

// ── Static countdown cues (pre-generated MP3s) ─────────────────────
const BASE_URL =
  'https://firebasestorage.googleapis.com/v0/b/goarrive.firebasestorage.app/o/voice_cache%2Fplatform%2F';
const CUE_URL = (name: string) => `${BASE_URL}${name}.mp3?alt=media`;

const COUNTDOWN_CUES = {
  countdown_3: CUE_URL('countdown_3'),
  countdown_3_rest: CUE_URL('countdown_3_rest'),
} as const;

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

// ── Audio element pool ──────────────────────────────────────────────
const audioPool: Record<string, HTMLAudioElement> = {};

function getOrCreateAudio(key: string, url: string): HTMLAudioElement | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    if (audioPool[key]) {
      audioPool[key].currentTime = 0;
      return audioPool[key];
    }
    const audio = new (window as any).Audio(url);
    audio.preload = 'auto';
    audioPool[key] = audio;
    return audio;
  } catch {
    return null;
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
  // Map of cacheKey → download URL (populated by batch generation)
  const [clipUrls, setClipUrls] = useState<Record<string, string>>({});
  const [isPreloading, setIsPreloading] = useState(false);

  // Guards to prevent duplicate playback
  const lastPlayedRef = useRef<string>('');
  const halfwayPlayedRef = useRef<boolean>(false);
  const countdownPlayedRef = useRef<number>(-1);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  // ── Batch-generate all phrases on workout open ────────────────────
  const allPhrases = useMemo(() => {
    if (!flatMovements || flatMovements.length === 0) return [];
    return generateWorkoutPhrases(flatMovements);
  }, [flatMovements]);

  useEffect(() => {
    if (allPhrases.length === 0) return;
    if (phase === 'complete') return;
    // Don't re-generate if we already have URLs
    if (Object.keys(clipUrls).length > 0) return;

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
          setClipUrls(result.data.urls);
        }
      } catch (err) {
        console.warn('[useWorkoutTTS] Batch generation failed:', err);
      } finally {
        if (!cancelled) setIsPreloading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [allPhrases, phase]);

  // ── Preload upcoming clips ────────────────────────────────────────
  useEffect(() => {
    if (Object.keys(clipUrls).length === 0) return;
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    // Preload clips for current step, next step, and static phrases
    const toPreload: TTSPhrase[] = [];

    if (current?.stepType === 'exercise' && current.name !== 'Get Ready') {
      toPreload.push(getPhraseForEvent('PREP_NEXT', current.name, current.weight));
    }
    if (next?.stepType === 'exercise' && next.name !== 'Get Ready') {
      toPreload.push(getPhraseForEvent('PREP_NEXT', next.name, next.weight));
    }

    // Always preload static phrases
    for (const event of ['GO', 'HALFWAY', 'SWAP_SIDES', 'WORKOUT_COMPLETE'] as TTSEvent[]) {
      toPreload.push(getPhraseForEvent(event));
    }

    for (const phrase of toPreload) {
      const url = clipUrls[phrase.cacheKey];
      if (url) getOrCreateAudio(phrase.cacheKey, url);
    }
  }, [clipUrls, currentIndex, current?.name, next?.name]);

  // ── Play a phrase by event type ───────────────────────────────────
  const playPhrase = useCallback(
    (event: TTSEvent, movementName?: string, weight?: string | number, instructionText?: string) => {
      if (isMuted) return;
      if (Platform.OS !== 'web' || typeof window === 'undefined') return;

      const phrase = getPhraseForEvent(event, movementName, weight, instructionText);
      const url = clipUrls[phrase.cacheKey];
      if (!url) return;

      try {
        // Stop currently playing audio
        if (currentAudioRef.current) {
          currentAudioRef.current.pause();
          currentAudioRef.current.currentTime = 0;
        }

        const audio = getOrCreateAudio(phrase.cacheKey, url);
        if (audio) {
          currentAudioRef.current = audio;
          audio.play().catch(() => {});
        }
      } catch {}
    },
    [isMuted, clipUrls],
  );

  // ── Play a countdown cue ──────────────────────────────────────────
  const playCountdown = useCallback(
    (key: keyof typeof COUNTDOWN_CUES) => {
      if (isMuted) return;
      if (Platform.OS !== 'web' || typeof window === 'undefined') return;

      try {
        if (currentAudioRef.current) {
          currentAudioRef.current.pause();
          currentAudioRef.current.currentTime = 0;
        }
        const audio = getOrCreateAudio(key, COUNTDOWN_CUES[key]);
        if (audio) {
          currentAudioRef.current = audio;
          audio.play().catch(() => {});
        }
      } catch {}
    },
    [isMuted],
  );

  // ── Phase-driven playback ─────────────────────────────────────────

  // Exercise: announce movement on work phase entry
  useEffect(() => {
    if (!current || current.stepType !== 'exercise') return;

    if (phase === 'work') {
      const key = `work_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        halfwayPlayedRef.current = false;
        countdownPlayedRef.current = -1;

        if (current.name && current.name !== 'Get Ready') {
          // Play "Next up, {movement}" then after a beat, play "Go"
          playPhrase('PREP_NEXT', current.name, current.weight);
        }
      }
    } else if (phase === 'rest') {
      const key = `rest_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        // During rest, announce the next movement
        if (next?.stepType === 'exercise' && next.name && next.name !== 'Get Ready') {
          playPhrase('PREP_NEXT', next.name, next.weight);
        }
      }
    } else if (phase === 'swap') {
      const key = `swap_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        playPhrase('SWAP_SIDES');
      }
    } else if (phase === 'ready') {
      lastPlayedRef.current = '';
      halfwayPlayedRef.current = false;
      countdownPlayedRef.current = -1;
    }
  }, [phase, currentIndex, current?.name, current?.stepType, next?.name, next?.stepType, playPhrase]);

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
    } else if (phase === 'complete') {
      const key = 'complete';
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        playPhrase('WORKOUT_COMPLETE');
      }
    }
  }, [phase, currentIndex, current?.instructionText, playPhrase]);

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

  // Countdown (3, 2, 1) at end of work phase
  useEffect(() => {
    if (phase !== 'work' || !current || current.stepType !== 'exercise') return;
    if (currentDuration <= 0) return;

    if (timeLeft === 3 && countdownPlayedRef.current !== 3) {
      countdownPlayedRef.current = 3;
      playCountdown('countdown_3');
    }
  }, [phase, timeLeft, current, currentDuration, playCountdown]);

  // Countdown at end of rest phase (use rest-specific countdown)
  useEffect(() => {
    if (phase !== 'rest' && phase !== 'swap') return;
    if (timeLeft === 3 && countdownPlayedRef.current !== 3) {
      countdownPlayedRef.current = 3;
      playCountdown('countdown_3_rest');
    }
  }, [phase, timeLeft, playCountdown]);

  // ── Cleanup ────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      try {
        if (currentAudioRef.current) {
          currentAudioRef.current.pause();
          currentAudioRef.current = null;
        }
      } catch {}
    };
  }, []);

  return { isPreloading };
}
