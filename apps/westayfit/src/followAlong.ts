/**
 * A follow-along plan: what a screen counts down, in order, for one activity.
 *
 * This is a WSF-owned, poster-first design. It is built entirely from the
 * activity guides this app already ships, so it works with NO video at all —
 * which is the situation today, because there is no movement video catalog in
 * this repository. The only follow-along video state that exists anywhere here
 * belongs to GoArrive and is gated behind GoArrive's own coach auth and
 * Firestore, which is exactly the dependency we were told not to import.
 *
 * So `media` is the seam. Today every plan carries `{ kind: 'none' }` and the
 * screen draws a figure instead — and SAYS SO, in the words below: it is an
 * illustrated fallback, not a video that failed to load and not a video at
 * all. When a poster or an authorized demonstration exists, a plan carries it
 * and nothing in this builder changes.
 *
 * THE SHAPE OF A SESSION (Director, 19 Sep):
 *
 *   Ready  →  3-second countdown  →  one 60-second round  →  done
 *
 * Ready is EXPLICIT and untimed: it waits for the person, it is not a step
 * that elapses. Only the countdown and the round are on the clock, which is
 * why they — and only they — are in `steps`.
 *
 * WHERE THIS AGREES WITH GOARRIVE'S PLAYER, AND WHERE IT DOES NOT.
 * `.claude/workout-player-spec.md` describes GoArrive's own data-driven
 * player. Its timer runs ready → countdown → work → rest → next and counts a
 * member in on 3, 2, 1, which is the same sequence and the same count the
 * Director asked for here, so this module follows it rather than inventing a
 * different shape. It parts company in four places, and the Director wins
 * each one:
 *   - no REST step and no multi-round circuit: the contract here is ONE
 *     60-second round, so there is nothing to rest between;
 *   - no "next up" reveal, no side-switch, no water break, no transition and
 *     no voice or haptic cues: every one of those needs an asset or a coach
 *     build, and neither exists in this repository;
 *   - its portrait-only rule is for a phone-held player; the station layout
 *     the Director asked for is landscape, with its panel clear of the player,
 *     and both are right for their own screen;
 *   - and, decisively, its player assumes a movement video always exists (its
 *     only fallback is a THUMBNAIL while one loads). There is no movement
 *     video, clip or animation asset anywhere in this repository. So the
 *     illustrated fallback below is not a port of anything: it is this app's
 *     honest answer to an asset gap that player never has to face.
 *
 * Two rules this module holds to, both inherited from `activityGuides.ts`:
 *  - Every string it can emit is subject to GUIDE_BANNED_WORDS. A follow-along
 *    is not a coach and makes no claim about anyone's body.
 *  - The member counts their own repetitions. Nothing here counts for them and
 *    nothing here records anything. No number this module produces is ever a
 *    contribution: elapsed time is not credit, and neither is a finished round.
 */

import { selectActivityGuide, SELF_COUNT_NOTE, type ActivityGuide } from './activityGuides';

/** Where the pictures for a step come from. */
export type FollowAlongMedia =
  /** No catalog: the screen draws the figure itself. This is today. */
  | { kind: 'none' }
  /**
   * A poster, and optionally a clip, supplied for this goal. A poster is shown
   * first and a clip may follow, so the screen is useful the instant it opens
   * rather than after a download.
   */
  | { kind: 'poster'; posterUri: string; clipUri?: string };

export type FollowAlongStep = {
  /** Stable id, so a screen can key a list and a test can name a step. */
  id: string;
  /** What this step is, in the goal's own words. */
  title: string;
  /** One short line: what to do. Never an instruction about the body. */
  detail: string;
  /** How long this step runs. */
  seconds: number;
  /** The countdown before the round, the round itself, or the resting end. */
  kind: 'countdown' | 'round' | 'done';
};

/** The explicit, untimed state a session opens in. It waits for a person. */
export type FollowAlongReady = { title: string; detail: string };

export type FollowAlongPlan = {
  /** The activity this plan follows. */
  unit: string;
  /** The guide the plan was built from, carried so a screen can show its rules. */
  guide: ActivityGuide;
  /** How many timed rounds this plan runs. One, today and by design. */
  rounds: number;
  /** The explicit Ready state, which is NOT on the clock. */
  ready: FollowAlongReady;
  /** The seconds counted down before the round starts. */
  countdownSeconds: number;
  /** The seconds the active round runs for. */
  roundSeconds: number;
  /** Every TIMED step, in order: countdown, round, done. */
  steps: readonly FollowAlongStep[];
  /** The timed length, so a screen can say it before starting. */
  totalSeconds: number;
  /** The one sentence about who is counting. Always present. */
  selfCountNote: string;
  media: FollowAlongMedia;
};

/**
 * The lengths on offer. `short` is the default the Director set: a three
 * second countdown and a sixty second round. `full` is the same session with
 * a longer round for someone who wants one.
 */
export type FollowAlongLength = 'short' | 'full';

/** The countdown, in seconds. Explicit, short, and the same for every length. */
export const COUNTDOWN_SECONDS = 3;
/** The default active round, in seconds. */
export const ROUND_SECONDS = 60;
/** The longer round, for the second choice. */
export const LONG_ROUND_SECONDS = 120;

/** What a screen calls each length, so the screen and a test read one literal. */
export const LENGTH_LABELS: Record<FollowAlongLength, string> = {
  short: '60 seconds',
  full: '2 minutes',
};

export function roundSecondsFor(length: FollowAlongLength | undefined): number {
  return length === 'full' ? LONG_ROUND_SECONDS : ROUND_SECONDS;
}

// ---- what the screen says about its pictures --------------------------------
//
// THE HONEST DEFAULT STATE. There is no movement video catalog in this
// repository. That is an asset gap, and these are the words that state it
// rather than paper over it. Nothing here may be phrased so that it implies a
// video was delivered, was loading, or failed.

export const ILLUSTRATED_FALLBACK_LABEL = 'Illustrated fallback';
export const ILLUSTRATED_FALLBACK_NOTE =
  'No movement video exists for this activity, so this app draws the two positions itself. It is a diagram, not a recording of a person.';

/** Shown when a poster or an authorized demonstration IS supplied for a goal. */
export const DEMO_MEDIA_LABEL = 'Demonstration';
export const DEMO_MEDIA_NOTE = 'Supplied with this goal and shown as it was given.';

export type MediaPresentation = {
  /** `fallback` — this app's own drawing. `supplied` — a poster or demo given for the goal. */
  kind: 'fallback' | 'supplied';
  label: string;
  note: string;
  /** The poster to show, when one exists. Null in the fallback case. */
  posterUri: string | null;
  /** The clip to offer, when one exists. Null otherwise — including today. */
  clipUri: string | null;
};

/**
 * What a screen should show for a plan's media, and what it should call it.
 *
 * One function so the screen, the label and a test cannot drift: if this says
 * `fallback`, the screen draws the figure and prints the fallback label, and
 * there is no wording anywhere on that path that names a video.
 */
export function mediaPresentation(media: FollowAlongMedia): MediaPresentation {
  if (media.kind === 'poster' && typeof media.posterUri === 'string' && media.posterUri.trim() !== '') {
    return {
      kind: 'supplied',
      label: DEMO_MEDIA_LABEL,
      note: DEMO_MEDIA_NOTE,
      posterUri: media.posterUri,
      clipUri: typeof media.clipUri === 'string' && media.clipUri.trim() !== '' ? media.clipUri : null,
    };
  }
  return {
    kind: 'fallback',
    label: ILLUSTRATED_FALLBACK_LABEL,
    note: ILLUSTRATED_FALLBACK_NOTE,
    posterUri: null,
    clipUri: null,
  };
}

/**
 * Build the plan for one activity.
 *
 * `length` picks the round length. The result is deterministic: the same
 * inputs always give the same steps, which is what lets a test assert the
 * whole plan rather than poke at it.
 */
export function buildFollowAlongPlan(input: {
  unit: string;
  activityGuideKey?: string | null;
  length?: FollowAlongLength;
  media?: FollowAlongMedia;
}): FollowAlongPlan {
  const unit = (input.unit ?? '').trim();
  const guide = selectActivityGuide({ unit, activityGuideKey: input.activityGuideKey });
  const roundSeconds = roundSecondsFor(input.length);
  const label = unit || 'your movement';

  const steps: FollowAlongStep[] = [
    {
      id: 'countdown',
      title: 'Starting',
      detail: `${label} begins when the count reaches zero.`,
      seconds: COUNTDOWN_SECONDS,
      kind: 'countdown',
    },
    {
      id: 'round-1',
      title: `Move: ${label}`,
      detail: guide.rules[0] ?? `Take your time with each one.`,
      seconds: roundSeconds,
      kind: 'round',
    },
    {
      id: 'done',
      title: 'Round finished',
      detail: `Enter the number you counted when you are ready.`,
      seconds: 0,
      kind: 'done',
    },
  ];

  return {
    unit: label,
    guide,
    rounds: 1,
    ready: {
      title: 'Ready when you are',
      detail: `Find your space. A count of ${COUNTDOWN_SECONDS} starts the round.`,
    },
    countdownSeconds: COUNTDOWN_SECONDS,
    roundSeconds,
    steps,
    totalSeconds: steps.reduce((sum, step) => sum + step.seconds, 0),
    selfCountNote: SELF_COUNT_NOTE,
    media: input.media ?? { kind: 'none' },
  };
}

/**
 * Which step a plan is on after `elapsedMs`, and how long is left in it.
 *
 * Derived from elapsed wall-clock time rather than counted down, so a screen
 * that a browser throttled in a background tab catches up instead of drifting
 * — the same reasoning the kiosk's own timer uses. `index` is clamped, so an
 * elapsed time past the end reports the final step rather than running off it.
 */
export function stepAt(
  plan: FollowAlongPlan,
  elapsedMs: number
): { index: number; step: FollowAlongStep; remainingMs: number; finished: boolean } {
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  let cursor = 0;
  for (let i = 0; i < plan.steps.length; i += 1) {
    const step = plan.steps[i];
    const end = cursor + step.seconds * 1000;
    // The final, zero-length step is the resting place, not a step to pass.
    if (step.seconds > 0 && elapsed < end) {
      return { index: i, step, remainingMs: end - elapsed, finished: false };
    }
    cursor = end;
  }
  const last = plan.steps.length - 1;
  return { index: last, step: plan.steps[last], remainingMs: 0, finished: true };
}

/** A whole number of seconds, for a screen that shows one big number. */
export function secondsLeft(remainingMs: number): number {
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

// ---- the clock --------------------------------------------------------------
//
// ELAPSED TIMESTAMPS, NOT A DECREMENTED COUNTER. A pause records how much has
// already elapsed and forgets the running start; a resume takes a NEW start.
// Nothing accrues while paused, and a tab that was throttled or asleep lands
// where the wall clock says it should rather than where a missed interval
// would have left it.

export type FollowAlongClock = {
  /** When the current run began, or null while paused or idle. */
  startedAt: number | null;
  /** Elapsed milliseconds banked by previous runs. */
  heldMs: number;
};

export const IDLE_CLOCK: FollowAlongClock = { startedAt: null, heldMs: 0 };

export function clockRunning(clock: FollowAlongClock): boolean {
  return clock.startedAt !== null;
}

/** How much of the plan has elapsed at `now`. Never negative, never drifting. */
export function clockElapsed(clock: FollowAlongClock, now: number): number {
  const held = Number.isFinite(clock.heldMs) && clock.heldMs > 0 ? clock.heldMs : 0;
  if (clock.startedAt === null) return held;
  const run = now - clock.startedAt;
  return held + (Number.isFinite(run) && run > 0 ? run : 0);
}

/** Start, or resume from exactly where a pause left off. Starting twice is a no-op. */
export function startClock(clock: FollowAlongClock, now: number): FollowAlongClock {
  if (clock.startedAt !== null) return clock;
  return { startedAt: now, heldMs: clock.heldMs };
}

/** Pause: bank what has run so far and stop accruing. Pausing twice is a no-op. */
export function pauseClock(clock: FollowAlongClock, now: number): FollowAlongClock {
  if (clock.startedAt === null) return clock;
  return { startedAt: null, heldMs: clockElapsed(clock, now) };
}

/** Back to the beginning. Nothing kept, and nothing was ever recorded. */
export function resetClock(): FollowAlongClock {
  return { startedAt: null, heldMs: 0 };
}

// ---- interruptions ----------------------------------------------------------

/**
 * Things that happen TO a running round rather than because someone asked.
 *
 * A round nobody can see is not a round: the person is in another tab, or the
 * screen went away, or the media stopped on its own. Letting the clock run
 * through that would silently consume a round the person could not use, and
 * the only number that exists afterwards is the one they type — so a round
 * they could not follow is a round they will under-count.
 *
 * `blur` is deliberately NOT one of these. A station screen loses focus for
 * reasons that have nothing to do with whether anyone is moving in front of
 * it, and pausing a public round on focus would be its own defect.
 */
export type Interruption = 'hidden' | 'pagehide' | 'mediaPause' | 'mediaStalled' | 'blur';

export function pausesForInterruption(reason: unknown): boolean {
  return (
    reason === 'hidden' ||
    reason === 'pagehide' ||
    reason === 'mediaPause' ||
    reason === 'mediaStalled'
  );
}

/** What the screen says once an interruption has paused a round. */
export const INTERRUPTED_NOTICE =
  'Paused when this screen went away. Nothing was counted while it was paused — pick up where you left off.';
