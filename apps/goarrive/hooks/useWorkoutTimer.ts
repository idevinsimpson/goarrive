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
  | 'intro' | 'outro' | 'demo' | 'transition' | 'waterBreak' | 'grabEquipment'
  | 'followAlongVideo';

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
  swapMode?: 'split' | 'duplicate';
  swapWindowSec?: number;
  reps?: string;
  stepType?: StepType;
  [key: string]: any;
}

const DEFAULT_SWAP_WINDOW_SEC = 5;

// Per-side work duration. `split` mode halves the configured duration so L + R
// together equal the coach's intended work time. `duplicate` (default for any
// legacy block without a mode) plays the full duration on each side.
function sideDuration(mov: FlatMovement | null): number {
  const base = mov?.duration ?? 30;
  if (!mov?.swapSides) return base;
  if (mov.swapMode === 'split') return Math.max(1, Math.round(base / 2));
  return base;
}

// 0 is a meaningful value (skip the swap visual phase entirely — sides flip
// instantly when work-L hits zero). 1–15 are the configurable window lengths.
// Anything outside the valid range falls back to the 5s default.
function swapWindowOf(mov: FlatMovement | null): number {
  const raw = mov?.swapWindowSec;
  if (typeof raw === 'number' && raw >= 0 && raw <= 15) return raw;
  return DEFAULT_SWAP_WINDOW_SEC;
}

// ── seekRelative helpers (pure, module-level) ────────────────────────────────
// These reconstruct the phase sequence from flatMovements without any history
// tracking, enabling boundary-crossing forward/backward seeks.

interface PhaseSlot {
  phase: Phase;
  idx: number;
  side: 'L' | 'R';
  dur: number;
}

function phaseDuration(ph: Phase, idx: number, side: 'L' | 'R', moves: FlatMovement[]): number {
  const mov = moves[idx] ?? null;
  if (!mov) return 0;
  switch (ph) {
    case 'work': return Math.max(0, sideDuration(mov));
    case 'swap': return swapWindowOf(mov);
    case 'rest': return mov.restAfter ?? 0;
    default: return mov.duration ?? 10; // special phases
  }
}

function firstPhaseOf(idx: number, moves: FlatMovement[]): PhaseSlot | null {
  const mov = moves[idx];
  if (!mov) return null;
  const st = mov.stepType;
  if (st && st !== 'exercise') {
    return { phase: stepTypeToPhase(st), idx, side: 'L', dur: mov.duration ?? 10 };
  }
  if (mov.duration <= 0 && mov.restAfter > 0) {
    return { phase: 'rest', idx, side: 'L', dur: mov.restAfter };
  }
  return { phase: 'work', idx, side: 'L', dur: sideDuration(mov) };
}

function lastPhaseOf(idx: number, moves: FlatMovement[]): PhaseSlot | null {
  const mov = moves[idx];
  if (!mov) return null;
  const st = mov.stepType;
  if (st && st !== 'exercise') {
    return { phase: stepTypeToPhase(st), idx, side: 'L', dur: mov.duration ?? 10 };
  }
  if (mov.duration <= 0 && mov.restAfter > 0) {
    return { phase: 'rest', idx, side: 'L', dur: mov.restAfter };
  }
  if (mov.restAfter > 0) {
    return { phase: 'rest', idx, side: mov.swapSides ? 'R' : 'L', dur: mov.restAfter };
  }
  if (mov.swapSides) {
    return { phase: 'work', idx, side: 'R', dur: sideDuration(mov) };
  }
  return { phase: 'work', idx, side: 'L', dur: sideDuration(mov) };
}

function nextPhaseSlot(ph: Phase, idx: number, side: 'L' | 'R', moves: FlatMovement[]): PhaseSlot | null {
  const mov = moves[idx] ?? null;
  switch (ph) {
    case 'work':
      if (mov?.swapSides && side === 'L') {
        const w = swapWindowOf(mov);
        return w <= 0
          ? { phase: 'work', idx, side: 'R', dur: sideDuration(mov) }
          : { phase: 'swap', idx, side: 'R', dur: w };
      }
      if ((mov?.restAfter ?? 0) > 0) {
        return { phase: 'rest', idx, side, dur: mov!.restAfter };
      }
      return firstPhaseOf(idx + 1, moves);
    case 'swap':
      return { phase: 'work', idx, side: 'R', dur: sideDuration(mov) };
    default: // rest and all special phases
      return firstPhaseOf(idx + 1, moves);
  }
}

function prevPhaseSlot(ph: Phase, idx: number, side: 'L' | 'R', moves: FlatMovement[]): PhaseSlot | null {
  const mov = moves[idx] ?? null;
  switch (ph) {
    case 'swap':
      return { phase: 'work', idx, side: 'L', dur: sideDuration(mov) };
    case 'work':
      if (side === 'R') {
        const w = swapWindowOf(mov);
        return w <= 0
          ? { phase: 'work', idx, side: 'L', dur: sideDuration(mov) }
          : { phase: 'swap', idx, side: 'R', dur: w };
      }
      // work-L: go to last phase of previous movement
      return idx > 0 ? lastPhaseOf(idx - 1, moves) : null;
    case 'rest':
      // If this is a synthetic rest-only step (no work phase): go to prev movement
      if (!mov || mov.duration <= 0) {
        return idx > 0 ? lastPhaseOf(idx - 1, moves) : null;
      }
      if (mov.swapSides) {
        const w = swapWindowOf(mov);
        return w <= 0
          ? { phase: 'work', idx, side: 'R', dur: sideDuration(mov) }
          : { phase: 'swap', idx, side: 'R', dur: w };
      }
      return { phase: 'work', idx, side: 'L', dur: sideDuration(mov) };
    default: // special phases: go to last phase of previous movement
      return idx > 0 ? lastPhaseOf(idx - 1, moves) : null;
  }
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
    case 'followAlongVideo': return 'followAlongVideo';
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
    || phase === 'transition' || phase === 'waterBreak' || phase === 'grabEquipment'
    || phase === 'followAlongVideo';

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
        // Synthetic "Get Ready" step — skip work, go straight to rest/prep.
        // Phase-transition chimes are intentionally gone: all audible cues
        // belong to the OpenAI/MP3 pipeline in useWorkoutTTS so a tone never
        // overlaps the spoken "3, 2, 1. Rest." / "Go." countdown pair.
        setPhase('rest');
        setTimeLeft(nextStep.restAfter);
      } else {
        // Exercise — go directly to work. No workStart tone chime: it
        // previously fired concurrently with the spoken "Go" MP3 and was
        // heard as a beep BETWEEN "3, 2, 1" and "Go".
        setPhase('work');
        setTimeLeft(sideDuration(nextStep));
        if (!silent) hapticHeavy();
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
          // Audio for swap's last-3 countdown + "Go" is owned by useWorkoutTTS
          // (spoken `countdown_3` + `go`). The synth beeps used to fire here
          // were a 880Hz square wave that masked the spoken cue (member heard
          // "peeps" instead of "3, 2, 1, Go") and on iOS competed for the
          // audio context with the TTS queue, dropping later movement-name
          // announcements. Keep only haptics so the wrist still confirms each
          // tick. Mirrors how `rest` already works.
          if (displayed <= 3 && displayed > 0 && n > 0) hapticLight();
          if (n <= 0) hapticMedium();
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
        || phase === 'transition' || phase === 'waterBreak' || phase === 'grabEquipment'
        || phase === 'followAlongVideo') {
      advanceToNext();
      return;
    }

    if (phase === 'work') {
      if (isRepBased && !isSkippingRep) return;
      if (isSkippingRep) setIsSkippingRep(false);
      if (current?.swapSides && swapSide === 'L') {
        const window = swapWindowOf(current);
        if (window <= 0) {
          // Zero-window swap: skip the visual swap phase entirely. The TTS
          // layer already played "3, 2, 1, go on the other side" during
          // work-L's last 4s, so sides flip instantly into work-R.
          setSwapSide('R');
          setPhase('work');
          setTimeLeft(sideDuration(current));
        } else {
          setSwapSide('R');
          setPhase('swap');
          setTimeLeft(window);
        }
      } else if (current?.restAfter > 0) {
        setPhase('rest');
        setTimeLeft(current.restAfter);
      } else {
        advanceToNext();
      }
    } else if (phase === 'swap') {
      setPhase('work');
      setTimeLeft(sideDuration(current));
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
    } else {
      setPhase('work');
      setTimeLeft(sideDuration(firstStep));
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
        || phase === 'transition' || phase === 'waterBreak' || phase === 'grabEquipment'
        || phase === 'followAlongVideo') {
      advanceToNext(true);
      if (!isPaused) setTimeLeft(leadIn);
    } else if (phase === 'work') {
      if (current?.swapSides && swapSide === 'L') {
        const window = swapWindowOf(current);
        if (window <= 0) {
          // Zero-window swap: skip directly to work-R, mirroring the natural
          // hit-zero path. No swap phase to scrub into.
          setSwapSide('R');
          setPhase('work');
          setTimeLeft(isPaused ? sideDuration(current) : leadIn);
        } else {
          setSwapSide('R');
          setPhase('swap');
          setTimeLeft(isPaused ? window : leadIn);
        }
      } else if (current?.restAfter && current.restAfter > 0) {
        setPhase('rest');
        setTimeLeft(isPaused ? current.restAfter : leadIn);
      } else {
        advanceToNext(true);
        if (!isPaused) setTimeLeft(leadIn);
      }
    } else if (phase === 'swap') {
      setPhase('work');
      setTimeLeft(isPaused ? sideDuration(current) : leadIn);
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
      const window = swapWindowOf(current);
      if (window <= 0) {
        setSwapSide('R');
        setPhase('work');
        setTimeLeft(sideDuration(current));
      } else {
        setSwapSide('R');
        setPhase('swap');
        setTimeLeft(window);
      }
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

  // Advance or rewind the workout's phase timeline by deltaSec real seconds,
  // crossing block/movement boundaries as needed. All audio suppressed during
  // the seek (forceSilent equivalent). Clamps at workout start and 'complete'.
  const seekRelative = useCallback((deltaSec: number) => {
    if (phase === 'ready' || phase === 'complete') return;
    if (deltaSec === 0) return;

    const MAX_ITER = 200;

    if (deltaSec > 0) {
      let left = deltaSec;
      let tl = timeLeft;
      let ph: Phase = phase;
      let idx = currentIndex;
      let side: 'L' | 'R' = swapSide;

      for (let i = 0; i < MAX_ITER; i++) {
        // Skip zero-duration phases (rep-based work has duration 0)
        if (tl <= 0) {
          const n = nextPhaseSlot(ph, idx, side, flatMovements);
          if (!n) { setPhase('complete'); return; }
          ph = n.phase; idx = n.idx; side = n.side; tl = n.dur;
          continue;
        }
        if (tl > left) {
          setPhase(ph);
          setCurrentIndex(idx);
          setSwapSide(side);
          setTimeLeft(tl - left);
          return;
        }
        left -= tl;
        const n = nextPhaseSlot(ph, idx, side, flatMovements);
        if (!n) { setPhase('complete'); return; }
        ph = n.phase; idx = n.idx; side = n.side; tl = n.dur;
      }
      setPhase('complete');

    } else {
      const left0 = Math.abs(deltaSec);
      const curDur = phaseDuration(phase, currentIndex, swapSide, flatMovements);
      const elapsed = Math.max(0, curDur - timeLeft);

      if (left0 <= elapsed) {
        // Stays in current phase
        setTimeLeft(Math.min(curDur, timeLeft + left0));
        return;
      }

      let left = left0 - elapsed;
      let ph: Phase = phase;
      let idx = currentIndex;
      let side: 'L' | 'R' = swapSide;

      for (let i = 0; i < MAX_ITER; i++) {
        const p = prevPhaseSlot(ph, idx, side, flatMovements);
        if (!p) {
          // Clamp to start of workout
          const fp = firstPhaseOf(0, flatMovements);
          if (!fp) return;
          setPhase(fp.phase);
          setCurrentIndex(0);
          setSwapSide(fp.side);
          setTimeLeft(fp.dur);
          return;
        }
        if (left < p.dur) {
          setPhase(p.phase);
          setCurrentIndex(p.idx);
          setSwapSide(p.side);
          setTimeLeft(left);
          return;
        }
        left -= p.dur;
        ph = p.phase; idx = p.idx; side = p.side;
      }

      // Guard: clamp to start
      const fp = firstPhaseOf(0, flatMovements);
      if (!fp) return;
      setPhase(fp.phase);
      setCurrentIndex(0);
      setSwapSide(fp.side);
      setTimeLeft(fp.dur);
    }
  }, [phase, currentIndex, timeLeft, swapSide, flatMovements]);

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
    seekRelative,
    advanceToNext,
    reset,
  };
}
