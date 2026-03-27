/**
 * useWorkoutTimer — Extracted timer logic for the Workout Player
 *
 * Manages countdown/work/rest/swap phase timing with audio cues and haptics.
 * Keeps WorkoutPlayer focused on rendering while this hook handles all timing state.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { playCue } from '../lib/audioCues';
import { hapticLight, hapticMedium, hapticHeavy, hapticSuccess } from '../lib/haptics';

export type Phase = 'ready' | 'countdown' | 'work' | 'rest' | 'swap' | 'complete';

const COUNTDOWN_SECONDS = 3;

interface FlatMovement {
  name: string;
  duration: number;
  restAfter: number;
  swapSides: boolean;
  reps?: string;
  [key: string]: any;
}

interface UseWorkoutTimerOptions {
  flatMovements: FlatMovement[];
  onComplete?: () => void;
}

export function useWorkoutTimer({ flatMovements, onComplete }: UseWorkoutTimerOptions) {
  const [phase, setPhase] = useState<Phase>('ready');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [swapSide, setSwapSide] = useState<'L' | 'R'>('L');
  const [isPaused, setIsPaused] = useState(false);

  const total = flatMovements.length;
  const current = flatMovements[currentIndex] ?? null;
  const next = currentIndex + 1 < total ? flatMovements[currentIndex + 1] : null;

  // Rep-based mode: movement has reps but no meaningful duration
  const isRepBased = !!(current?.reps && (!current.duration || current.duration <= 0));

  const progressPct = total > 0 ? (currentIndex / total) * 100 : 0;

  // ── Advance to next movement ─────────────────────────────────────────
  const advanceToNext = useCallback(() => {
    const nextIdx = currentIndex + 1;
    if (nextIdx >= total) {
      setPhase('complete');
      playCue('workoutComplete');
      hapticSuccess();
    } else {
      setCurrentIndex(nextIdx);
      setSwapSide('L');
      setPhase('countdown');
      setTimeLeft(COUNTDOWN_SECONDS);
    }
  }, [currentIndex, total]);

  // ── Timer tick ───────────────────────────────────────────────────────
  useEffect(() => {
    if (isPaused) return;
    if (phase !== 'countdown' && phase !== 'work' && phase !== 'rest' && phase !== 'swap')
      return;
    if (timeLeft <= 0) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        const n = prev - 1;
        // Only play beep tones during countdown/rest/swap phases.
        // During WORK phase, TTS handles "3... 2... 1... rest" voice.
        if (phase !== 'work') {
          if (n <= 3 && n > 0) {
            playCue('countdownTick');
            hapticLight();
          }
          if (n === 0) {
            playCue('countdownFinal');
            hapticMedium();
          }
        } else {
          // During WORK phase, still provide haptic feedback
          if (n <= 3 && n > 0) {
            hapticLight();
          }
          if (n === 0) {
            hapticMedium();
          }
        }
        return n;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [phase, timeLeft, isPaused]);

  // ── Timer hit zero → transition ──────────────────────────────────────
  useEffect(() => {
    if (isPaused || timeLeft > 0) return;

    if (phase === 'countdown') {
      setPhase('work');
      setTimeLeft(current?.duration ?? 30);
      playCue('workStart');
      hapticHeavy();
    } else if (phase === 'work') {
      if (isRepBased) return;
      if (current?.swapSides && swapSide === 'L') {
        setSwapSide('R');
        setPhase('swap');
        setTimeLeft(3);
      } else if (current?.restAfter > 0) {
        setPhase('rest');
        setTimeLeft(current.restAfter);
        playCue('restStart');
      } else {
        advanceToNext();
      }
    } else if (phase === 'swap') {
      setPhase('work');
      setTimeLeft(current?.duration ?? 30);
      playCue('workStart');
    } else if (phase === 'rest') {
      advanceToNext();
    }
  }, [timeLeft, phase, isPaused]);

  // ── Controls ─────────────────────────────────────────────────────────
  const handleStart = useCallback(() => {
    if (total === 0) return;
    setPhase('countdown');
    setTimeLeft(COUNTDOWN_SECONDS);
    hapticHeavy();
  }, [total]);

  const handlePauseResume = useCallback(() => {
    setIsPaused((p) => !p);
  }, []);

  const handleSkip = useCallback(() => {
    if (phase === 'rest' || phase === 'work' || phase === 'swap' || phase === 'countdown') {
      advanceToNext();
    }
  }, [phase, advanceToNext]);

  const handleRepDone = useCallback(() => {
    if (!current) return;
    playCue('repDone');
    hapticMedium();
    if (current.swapSides && swapSide === 'L') {
      setSwapSide('R');
      setPhase('swap');
      setTimeLeft(3);
    } else if (current.restAfter > 0) {
      setPhase('rest');
      setTimeLeft(current.restAfter);
    } else {
      advanceToNext();
    }
  }, [current, swapSide, advanceToNext]);

  // ── Reset on new workout ─────────────────────────────────────────────
  const reset = useCallback(() => {
    setCurrentIndex(0);
    setPhase('ready');
    setIsPaused(false);
    setSwapSide('L');
    setTimeLeft(0);
  }, []);

  return {
    phase,
    currentIndex,
    timeLeft,
    swapSide,
    isPaused,
    current,
    next,
    total,
    isRepBased,
    progressPct,
    handleStart,
    handlePauseResume,
    handleSkip,
    handleRepDone,
    advanceToNext,
    reset,
  };
}
