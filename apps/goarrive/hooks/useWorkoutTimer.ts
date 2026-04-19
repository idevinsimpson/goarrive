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

// Lands inside REVEAL_LEAD_SECONDS (3.5 in WorkoutPlayer.tsx) so the next
// timeline item reveals immediately when Skip is pressed — important for the
// paused case, otherwise a paused user would be stuck on the current movement.
// The display side ceils timeLeft so the visible countdown is still 4,3,2,1.
const SKIP_PRE_ENTRY_SECONDS = 3.5;

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

  // Mirrored ref so cue gating inside useCallback bodies always sees the
  // latest pause state without rebuilding the callback on every toggle.
  const isPausedRef = useRef(isPaused);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);

  const total = flatMovements.length;
  const current = flatMovements[currentIndex] ?? null;
  const next = currentIndex + 1 < total ? flatMovements[currentIndex + 1] : null;

  const isRepBased = !!(current?.reps && (!current.duration || current.duration <= 0));
  const isSpecialPhase = phase === 'intro' || phase === 'outro' || phase === 'demo'
    || phase === 'transition' || phase === 'waterBreak' || phase === 'grabEquipment';

  const progressPct = total > 0 ? (currentIndex / total) * 100 : 0;

  // ── Advance to next step ────────────────────────────────────────────
  // Cues/haptics are silenced when paused (e.g. tap-through Skip while
  // paused) so audio only fires during active playback. `forceSilent` also
  // silences cues for rapid Skip scrubbing where the user is advancing
  // through phases faster than cues can play cleanly.
  const advanceToNext = useCallback((forceSilent = false) => {
    const silent = isPausedRef.current || forceSilent;
    const nextIdx = currentIndex + 1;
    if (nextIdx >= total) {
      setPhase('complete');
      // End-of-workout audio is owned by useWorkoutTTS — either the outro's
      // `workout_complete_long` MP3 (if the workout has an Outro block) or
      // the short `workout_complete` MP3 fired when the last exercise hits 0.
      // The arpeggio used to also fire here, which stacked on top. Keep the
      // success haptic so members still feel the finish.
      if (!silent) {
        hapticSuccess();
      }
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
        if (!silent) playCue('restStart');
      } else {
        // Exercise — go directly to work
        setPhase('work');
        setTimeLeft(nextStep.duration ?? 30);
        if (!silent) {
          playCue('workStart');
          hapticHeavy();
        }
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

        // Audio/haptic cues. Use Math.ceil so a fractional Skip pre-entry
        // (e.g. n=2.5 displayed as "3") still triggers the cue at the right
        // perceived second. n<=0 catches both natural 0 and Skip overshoot.
        const displayed = Math.max(0, Math.ceil(n));
        if (phase === 'rest') {
          // Audio for rest's last-3 countdown is owned by useWorkoutTTS
          // (spoken "3, 2, 1" + "Go" replacing the beeps). Only the haptic
          // pulse stays here so the wrist still confirms each tick.
          if (displayed <= 3 && displayed > 0 && n > 0) hapticLight();
          if (n <= 0) hapticMedium();
        } else if (phase === 'swap') {
          if (displayed <= 3 && displayed > 0 && n > 0) {
            playCue('countdownTick');
            hapticLight();
          }
          if (n <= 0) {
            playCue('countdownFinal');
            hapticMedium();
          }
        } else if (phase === 'work') {
          if (displayed <= 3 && displayed > 0 && n > 0) hapticLight();
          if (n <= 0) hapticMedium();
        } else if (isSpecialPhase) {
          if (displayed === 3) hapticLight();
          if (n <= 0) hapticMedium();
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

  // Skip is timeline-aware and stays responsive like a video scrubber. Two
  // regimes depending on where we are:
  //
  // 1. Outside the 3.5s lead-in: compress the current phase's remaining time
  //    to SKIP_PRE_ENTRY_SECONDS and let the existing tick + hit-zero logic
  //    run naturally. That means: work (restAfter>0) → rest, work (swapSides
  //    on L) → swap, work → next, rest → next, swap → work(R),
  //    intro/outro/demo/transition/waterBreak/grabEquipment → next. We land
  //    3.5s before the next real timeline item, so the reveal video swap and
  //    "3, 2, 1" cue stay in sync.
  //
  // 2. Already inside the 3.5s lead-in (or paused): advance the phase inline
  //    immediately — don't wait for the existing countdown to finish. This is
  //    what lets a user tap Skip repeatedly during the "3, 2, 1" to scrub
  //    through the workout. During active playback we land at another 3.5s
  //    lead-in so the next tap keeps scrubbing; when paused we land at the
  //    phase's natural duration so the user can step through one at a time.
  //
  // Active-play cues from advanceToNext are suppressed (forceSilent=true)
  // during rapid skip scrubbing — the tick's countdown cues in the new phase
  // fire naturally via the useWorkoutTTS `countdown_3` effect.
  const handleSkip = useCallback(() => {
    if (phase === 'ready' || phase === 'complete') return;

    // Regime 1: active-play outside the lead-in. Compress and let the natural
    // tick + hit-zero path handle the transition (with all its cues).
    if (!isPaused && timeLeft > SKIP_PRE_ENTRY_SECONDS) {
      // Rep-based work has no countdown running — start a 3.5s skip window
      // so the hit-zero handler picks the correct next state.
      if (phase === 'work' && isRepBased) {
        setIsSkippingRep(true);
      }
      setTimeLeft(SKIP_PRE_ENTRY_SECONDS);
      return;
    }

    // Regime 2: paused OR already inside the lead-in window. Advance phase
    // inline so rapid taps stay responsive. During active play, land at
    // another 3.5s lead-in; while paused, land at the phase's natural duration.
    setIsSkippingRep(false);
    const leadIn = SKIP_PRE_ENTRY_SECONDS;

    if (phase === 'intro' || phase === 'outro' || phase === 'demo'
        || phase === 'transition' || phase === 'waterBreak' || phase === 'grabEquipment') {
      advanceToNext(true);
      if (!isPaused) setTimeLeft(leadIn);
    } else if (phase === 'work') {
      if (current?.swapSides && swapSide === 'L') {
        setSwapSide('R');
        setPhase('swap');
        setTimeLeft(isPaused ? 5 : leadIn);
      } else if (current?.restAfter && current.restAfter > 0) {
        setPhase('rest');
        setTimeLeft(isPaused ? current.restAfter : leadIn);
      } else {
        advanceToNext(true);
        if (!isPaused) setTimeLeft(leadIn);
      }
    } else if (phase === 'swap') {
      setPhase('work');
      setTimeLeft(isPaused ? (current?.duration ?? 30) : leadIn);
    } else if (phase === 'rest') {
      advanceToNext(true);
      if (!isPaused) setTimeLeft(leadIn);
    }
  }, [phase, isPaused, isRepBased, current, swapSide, timeLeft, advanceToNext]);

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
