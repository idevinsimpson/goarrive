/**
 * THE FOLLOW-ALONG SESSION — the player's behaviour, with no screen attached.
 *
 * This is the movement player's brain, lifted out of `app/move/[goalId].tsx`
 * so that the SAME player can run in more than one place. The route still owns
 * its own chrome, its query string and its handoff; a station running somebody's
 * turn and a phone running its owner's turn own theirs. What all three share —
 * the round length, the clock, the phases, the figure, the interruption rule —
 * is here, once.
 *
 * WHY A HOOK AND NOT A COMPONENT. The hosts need the derived values as well as
 * the picture: a station's side panel shows the same status line the player's
 * card shows, and a turn host must know when a round has finished in order to
 * offer its own recording control. A component would have had to hand those
 * back out through callbacks that fire during render. A hook just returns them.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO — and it is the whole reason the wiring is
 * shaped this way. It does not count, it does not record, and it has no opinion
 * about what a finished round is worth. No credit comes from elapsed time, from
 * a completed round, or from the figure. The number that counts is the one a
 * person enters, on a control that belongs to the HOST and never to the player.
 * Mounting the player next to a station's record panel must not change that,
 * so the player has nothing to mount with.
 *
 * THE ROUND ID IS THE HOST'S. One round is one attempt, and who mints that
 * attempt differs: the `/move` route mints its own and carries it in the
 * handoff, while a turn already has a canonical attempt minted server-side by
 * `wsfStartTurn`. So this hook is TOLD the id and asks the host to produce one
 * when somebody presses Start.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import {
  buildFollowAlongPlan,
  clockElapsed,
  clockRunning,
  LENGTH_LABELS,
  mediaPresentation,
  pauseClock,
  pausesForInterruption,
  resetClock,
  secondsLeft,
  startClock,
  stepAt,
  type FollowAlongClock,
  type FollowAlongLength,
  type FollowAlongPlan,
  type FollowAlongReady,
  type FollowAlongStep,
  type MediaPresentation,
} from './followAlong';
import { figureKindFor, type MoveFigureKind, type MovePose } from './ui/moveFigure';

/** How often the screen re-reads the clock. Fine enough to look alive. */
export const TICK_MS = 250;
/** How fast the two poses alternate while the round is running. */
export const POSE_MS = 1_200;

export type FollowAlongPhase = 'ready' | 'countdown' | 'round' | 'finished';

export type FollowAlongSession = {
  plan: FollowAlongPlan;
  length: FollowAlongLength;
  /** Changing the length abandons the round in progress — see `chooseLength`. */
  chooseLength: (next: FollowAlongLength) => void;
  /** True when the round length is not this person's to choose. */
  lengthIsFixed: boolean;
  phase: FollowAlongPhase;
  running: boolean;
  started: boolean;
  finished: boolean;
  interrupted: boolean;
  reducedMotion: boolean;
  /** What the player's card says right now. */
  shown: FollowAlongStep | FollowAlongReady;
  /** Seconds remaining in whatever is currently counting. */
  remainingSeconds: number;
  statusLine: string;
  kind: MoveFigureKind;
  pose: MovePose;
  media: MediaPresentation;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onStartOver: () => void;
};

export function useFollowAlongSession(input: {
  /** The activity this goal counts. Decides the plan and the figure. */
  unit: string;
  /** The round's id, or null before one has begun. Owned by the host. */
  roundId: string | null;
  /** Pressed Start. The host mints or adopts an id for the round. */
  onRoundStart: () => void;
  /** Start over. The host drops the id, because that round is abandoned. */
  onRoundReset: () => void;
  /**
   * PIN THE ROUND LENGTH, and refuse to offer a choice at all.
   *
   * A QUEUED TURN IS ONE 60-SECOND ROUND. That is a throughput contract, not a
   * preference: a line of people moving through two stations cannot have each
   * turn silently double itself, and the person at the front of it is not the
   * one who should be deciding how long everybody else waits. So a turn host
   * pins it, and the chip that would offer two minutes is not rendered rather
   * than rendered-and-ignored.
   *
   * Left unset outside a queue — on `/move`, where somebody is following along
   * on their own time and the length is genuinely theirs.
   */
  fixedLength?: FollowAlongLength;
}): FollowAlongSession {
  const { unit, roundId, onRoundStart, onRoundReset, fixedLength } = input;

  const [chosenLength, setLength] = useState<FollowAlongLength>('short');
  const length = fixedLength ?? chosenLength;
  const [clock, setClock] = useState<FollowAlongClock>(resetClock);
  const [stopped, setStopped] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [reducedMotion, setReducedMotion] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((on) => {
        if (!cancelled) setReducedMotion(Boolean(on));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const running = clockRunning(clock);

  // One interval, only while something is running.
  useEffect(() => {
    if (!running) {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return undefined;
    }
    setNow(Date.now());
    tickRef.current = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [running]);

  const plan = useMemo(() => buildFollowAlongPlan({ unit, length }), [unit, length]);

  const elapsedMs = clockElapsed(clock, now);
  const at = stepAt(plan, elapsedMs);
  const started = roundId !== null && (running || clock.heldMs > 0 || stopped);
  const finished = started && (stopped || at.finished);
  const phase: FollowAlongPhase = !started
    ? 'ready'
    : finished
      ? 'finished'
      : at.step.kind === 'countdown'
        ? 'countdown'
        : 'round';

  // A round that ran to its end stops the clock rather than accruing forever.
  useEffect(() => {
    if (finished && clockRunning(clock)) setClock((c) => pauseClock(c, Date.now()));
  }, [finished, clock]);

  const onStart = useCallback(() => {
    // A NEW round is a new attempt. Starting again after a stop asks the host
    // for a fresh id rather than replaying the previous round's, because it is
    // a different round — and the person's entry for it is a different
    // contribution.
    onRoundStart();
    setStopped(false);
    setInterrupted(false);
    setNow(Date.now());
    setClock(startClock(resetClock(), Date.now()));
  }, [onRoundStart]);

  const onResume = useCallback(() => {
    setInterrupted(false);
    setNow(Date.now());
    setClock((c) => startClock(c, Date.now()));
  }, []);

  const onPause = useCallback(() => {
    setClock((c) => pauseClock(c, Date.now()));
  }, []);

  // STOP EARLY AND RUN TO THE END ARRIVE AT THE SAME PLACE. Stopping is not a
  // discard: what the person counted is theirs, and the next thing they see is
  // where to enter it.
  const onStop = useCallback(() => {
    setClock((c) => pauseClock(c, Date.now()));
    setStopped(true);
  }, []);

  // Back to the beginning. Nothing was recorded and nothing is kept.
  const onStartOver = useCallback(() => {
    onRoundReset();
    setStopped(false);
    setInterrupted(false);
    setClock(resetClock());
  }, [onRoundReset]);

  const chooseLength = useCallback(
    (next: FollowAlongLength) => {
      if (fixedLength) return;
      onStartOver();
      setLength(next);
    },
    [onStartOver, fixedLength]
  );

  // AN INTERRUPTION PAUSES THE ROUND. A tab the person left, a screen that
  // went away, media that stopped on its own: the round is not usable, so it
  // is not consumed. The clock banks what ran and waits.
  //
  // The listener is attached ONCE and reads the clock through a ref: a handler
  // re-bound on every tick would miss the event that arrives between renders,
  // and asking the ref lets the effect decide whether anything was running
  // without a state updater having to cause a second state change.
  const clockRef = useRef(clock);
  useEffect(() => {
    clockRef.current = clock;
  }, [clock]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const interrupt = (reason: string) => {
      if (!pausesForInterruption(reason)) return;
      if (!clockRunning(clockRef.current)) return;
      setInterrupted(true);
      setClock((c) => pauseClock(c, Date.now()));
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') interrupt('hidden');
    };
    const onHide = () => interrupt('pagehide');
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  const kind = figureKindFor(unit);
  const media = mediaPresentation(plan.media);
  const alternating = running && at.step.kind === 'round' && !reducedMotion;
  const pose: MovePose = alternating && Math.floor(elapsedMs / POSE_MS) % 2 === 1 ? 'end' : 'start';

  // What the player's card says right now: the Ready state before a round, the
  // closing step once one is over however it ended, and the live step between.
  const shown =
    phase === 'ready'
      ? plan.ready
      : phase === 'finished'
        ? plan.steps[plan.steps.length - 1]!
        : at.step;

  const statusLine = followAlongStatusLine({
    phase,
    length,
    running,
    remainingMs: at.remainingMs,
  });

  return {
    plan,
    length,
    chooseLength,
    lengthIsFixed: fixedLength !== undefined,
    phase,
    running,
    started,
    finished,
    interrupted,
    reducedMotion,
    shown,
    remainingSeconds: secondsLeft(at.remainingMs),
    statusLine,
    kind,
    pose,
    media,
    onStart,
    onPause,
    onResume,
    onStop,
    onStartOver,
  };
}

/**
 * The one sentence that says where this round is. Pure, so a test can pin every
 * phase without mounting a screen, and so the station's side panel and the
 * player's card cannot drift apart — they call this.
 */
export function followAlongStatusLine(input: {
  phase: FollowAlongPhase;
  length: FollowAlongLength;
  running: boolean;
  remainingMs: number;
}): string {
  const left = secondsLeft(input.remainingMs);
  switch (input.phase) {
    case 'ready':
      // Not "a 60 seconds round". The labels are nouns ("60 seconds",
      // "2 minutes") and reading one back inside an article produced a
      // sentence nobody would write, on the largest screen in the room.
      return `Not started · ${LENGTH_LABELS[input.length]}`;
    case 'countdown':
      return `Starting in ${left}`;
    case 'round':
      return input.running
        ? `${left} left in this round`
        : `Paused · ${left} left in this round`;
    default:
      return 'Round finished · enter your own count';
  }
}
