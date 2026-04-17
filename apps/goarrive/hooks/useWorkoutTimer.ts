/**
 * useWorkoutTimer — Timer state machine for the Workout Player
 *
 * Phase 3 upgrade: Handles special block types as distinct phases:
 *   - 'intro' / 'outro': full-screen cinematic countdown
 *   - 'demo': preview of upcoming movements with auto-advance
 *   - 'transition': instruction display with countdown
 *   - 'waterBreak': hydration pause with countdown
 *
 * Exercise phases: ready → work → rest/swap → next
 * Special block phases: ready → [special] → next
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { playCue } from '../lib/audioCues';
import { hapticLight, hapticMedium, hapticHeavy, hapticSuccess } from '../lib/haptics';
import type { StepType } from './useWorkoutFlatten';

export type Phase = 'ready' | 'work' | 'rest' | 'swap' | 'complete'
  | 'intro' | 'outro' | 'demo' | 'transition' | 'waterBreak' | 'grabEquipment';

// Integer seconds so the on-screen timer shows "4, 3, 2, 1" instead of a
// fractional half-second. Paired with REVEAL_LEAD_SECONDS = 3.5 in
// WorkoutPlayer.tsx: the reveal + "3, 2, 1" cue fire naturally once the
// countdown ticks past 3.5 (i.e., at 3).
const SKIP_PRE_ENTRY_SECONDS = 4;

interface FlatMovement {
  name: string;
  duration: number;
  restAfter: number;
  swapSides: boolean;
  reps?: string;
  stepType?: StepType;
  [key: string]: any;
}

interface UseWorkoutTimerOptions {
  flatMovements: FlatMovement[];
  onComplete?: () => void;
}

/** Map StepType to Phase */
export function stepTypeToPhase(stepType: StepType | undefined): Phase {
  switch (stepType) {
    case 'intro': return 'intro';
    case 'outro': return 'outro';
    case 'demo': return 'demo';
    case 'transition': return 'transition';
    case 'waterBreak': return 'waterBreak';
    case 'grabEquipment': return 'grabEquipment';
    default: return 'work';
  }
}

export function useWorkoutTimer({ flatMovements, onComplete }: UseWorkoutTimerOptions) {
  const [phase, setPhase] = useState<Phase>('ready');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [swapSide, setSwapSide] = useState<'L' | 'R'>('L');
  const [isPaused, setIsPaused] = useState(false);
  // Set when Skip is pressed during a rep-based work phase; bypasses the
  // rep-guard in the hit-zero handler so the 3.5s skip countdown can transition.
  const [isSkippingRep, setIsSkippingRep] = useState(false);

  const total = flatMovements.length;
  const current = flatMovements[currentIndex] ?? null;
  const next = currentIndex + 1 < total ? flatMovements[currentIndex + 1] : null;

  const isRepBased = !!(current?.reps && (!current.duration || current.duration <= 0));
  const isSpecialPhase = phase === 'intro' || phase === 'outro' || phase === 'demo'
    || phase === 'transition' || phase === 'waterBreak' || phase === 'grabEquipment';

  const progressPct = total > 0 ? (currentIndex / total) * 100 : 0;

  // ── Advance to next step ────────────────────────────────────────────
  const advanceToNext = useCallback(() => {
    const nextIdx = currentIndex + 1;
    if (nextIdx >= total) {
      setPhase('complete');
      playCue('workoutComplete');
      hapticSuccess();
    } else {
      setCurrentIndex(nextIdx);
      setSwapSide('L');

      const nextStep = flatMovements[nextIdx];
      const nextStepType = nextStep?.stepType;

      if (nextStepType && nextStepType !== 'exercise') {
        // Special block — go directly to its phase
        const specialPhase = stepTypeToPhase(nextStepType);
        setPhase(specialPhase);
        setTimeLeft(nextStep.duration ?? 10);
      } else if (nextStep.duration <= 0 && nextStep.restAfter > 0) {
        // Synthetic "Get Ready" step — skip work, go straight to rest/prep
        setPhase('rest');
        setTimeLeft(nextStep.restAfter);
        playCue('restStart');
      } else {
        // Exercise — go directly to work
        setPhase('work');
        setTimeLeft(nextStep.duration ?? 30);
        playCue('workStart');
        hapticHeavy();
      }
    }
  }, [currentIndex, total, flatMovements]);

  // ── Timer tick ──────────────────────────────────────────────────────
  useEffect(() => {
    if (isPaused) return;
    if (phase === 'ready' || phase === 'complete') return;
    if (timeLeft <= 0) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        const n = prev - 1;

        // Audio/haptic cues for rest countdown (3-2-1 heads-up)
        if (phase === 'rest' || phase === 'swap') {
          if (n <= 3 && n > 0) {
            playCue('countdownTick');
            hapticLight();
          }
          if (n === 0) {
            playCue('countdownFinal');
            hapticMedium();
          }
        } else if (phase === 'work') {
          if (n <= 3 && n > 0) hapticLight();
          if (n === 0) hapticMedium();
        } else if (isSpecialPhase) {
          // Gentle haptic at 3 seconds remaining for special blocks
          if (n === 3) hapticLight();
          if (n === 0) hapticMedium();
        }

        return n;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [phase, timeLeft, isPaused, isSpecialPhase]);

  // ── Timer hit zero → transition ─────────────────────────────────────
  useEffect(() => {
    if (isPaused || timeLeft > 0) return;

    // Special block phases: auto-advance when timer reaches 0
    if (phase === 'intro' || phase === 'outro' || phase === 'demo'
        || phase === 'transition' || phase === 'waterBreak' || phase === 'grabEquipment') {
      advanceToNext();
      return;
    }

    if (phase === 'work') {
      if (isRepBased && !isSkippingRep) return;
      if (isSkippingRep) setIsSkippingRep(false);
      if (current?.swapSides && swapSide === 'L') {
        setSwapSide('R');
        setPhase('swap');
        setTimeLeft(5);
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

  // ── Controls ────────────────────────────────────────────────────────
  const handleStart = useCallback(() => {
    if (total === 0) return;
    setIsSkippingRep(false);

    const firstStep = flatMovements[0];
    const firstStepType = firstStep?.stepType;

    if (firstStepType && firstStepType !== 'exercise') {
      // First step is a special block — go directly to its phase
      const specialPhase = stepTypeToPhase(firstStepType);
      setPhase(specialPhase);
      setTimeLeft(firstStep.duration ?? 10);
    } else if (firstStep.duration <= 0 && firstStep.restAfter > 0) {
      // Synthetic "Get Ready" step — skip work, go straight to rest/prep
      setPhase('rest');
      setTimeLeft(firstStep.restAfter);
      playCue('restStart');
    } else {
      setPhase('work');
      setTimeLeft(firstStep.duration ?? 30);
      playCue('workStart');
    }
    hapticHeavy();
  }, [total, flatMovements]);

  const handlePauseResume = useCallback(() => {
    setIsPaused((p) => !p);
  }, []);

  // Skip is timeline-aware: it never hard-cuts to the next index. Instead, it
  // compresses the current phase's remaining time to SKIP_PRE_ENTRY_SECONDS
  // so the existing phase-transition logic fires naturally. That means:
  //   work (restAfter>0) → rest, work (swapSides on L) → swap, work → next,
  //   rest → next, swap → work(R), intro/outro/demo/transition/waterBreak/
  //   grabEquipment → next. In every case we land 3.5s before the next real
  //   timeline item, so the reveal video swap and "3, 2, 1" cue stay in sync.
  const handleSkip = useCallback(() => {
    if (phase === 'ready' || phase === 'complete') return;

    // Rep-based work has no countdown running — start a 3.5s skip window and
    // let the hit-zero handler pick the correct next state (swap/rest/next).
    if (phase === 'work' && isRepBased) {
      setIsSkippingRep(true);
      setTimeLeft(SKIP_PRE_ENTRY_SECONDS);
      return;
    }

    setTimeLeft((prev) => (prev <= SKIP_PRE_ENTRY_SECONDS ? prev : SKIP_PRE_ENTRY_SECONDS));
  }, [phase, isRepBased]);

  const handleRepDone = useCallback(() => {
    if (!current) return;
    playCue('repDone');
    hapticMedium();
    if (current.swapSides && swapSide === 'L') {
      setSwapSide('R');
      setPhase('swap');
      setTimeLeft(5);
    } else if (current.restAfter > 0) {
      setPhase('rest');
      setTimeLeft(current.restAfter);
    } else {
      advanceToNext();
    }
  }, [current, swapSide, advanceToNext]);

  const reset = useCallback(() => {
    setCurrentIndex(0);
    setPhase('ready');
    setIsPaused(false);
    setSwapSide('L');
    setTimeLeft(0);
    setIsSkippingRep(false);
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
    isSpecialPhase,
    handleStart,
    handlePauseResume,
    handleSkip,
    handleRepDone,
    advanceToNext,
    reset,
  };
}
