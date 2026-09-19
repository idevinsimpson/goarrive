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
 * screen draws a figure instead. When a catalog exists, a plan can carry a
 * poster and a clip and nothing in this builder changes.
 *
 * Two rules this module holds to, both inherited from `activityGuides.ts`:
 *  - Every string it can emit is subject to GUIDE_BANNED_WORDS. A follow-along
 *    is not a coach and makes no claim about anyone's body.
 *  - The member counts their own repetitions. Nothing here counts for them and
 *    nothing here records anything.
 */

import { selectActivityGuide, SELF_COUNT_NOTE, type ActivityGuide } from './activityGuides';

/** Where the pictures for a step come from. */
export type FollowAlongMedia =
  /** No catalog: the screen draws the figure itself. This is today. */
  | { kind: 'none' }
  /**
   * A future catalog. A poster is shown first and a clip may follow, so the
   * screen is useful the instant it opens rather than after a download.
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
  /** A step the member moves through, or a step they rest through. */
  kind: 'ready' | 'move' | 'rest' | 'done';
};

export type FollowAlongPlan = {
  /** The activity this plan follows. */
  unit: string;
  /** The guide the plan was built from, carried so a screen can show its rules. */
  guide: ActivityGuide;
  /** How many times the move-and-rest pair repeats. */
  rounds: number;
  /** Every step, in order, including the ready and done bookends. */
  steps: readonly FollowAlongStep[];
  /** The whole plan's length, so a screen can say it before starting. */
  totalSeconds: number;
  /** The one sentence about who is counting. Always present. */
  selfCountNote: string;
  media: FollowAlongMedia;
};

/**
 * The two lengths the owner asked for: a short taster and a full round. Both
 * are built from the same shape, so a screen only has to know which one it is
 * showing.
 */
export type FollowAlongLength = 'short' | 'full';

const READY_SECONDS = 5;
const SHORT = { moveSeconds: 20, restSeconds: 10, rounds: 1 } as const;
const FULL = { moveSeconds: 40, restSeconds: 20, rounds: 1 } as const;

/**
 * Build the plan for one activity.
 *
 * `length` picks the taster or the full round. The result is deterministic:
 * the same inputs always give the same steps, which is what lets a test assert
 * the whole plan rather than poke at it.
 */
export function buildFollowAlongPlan(input: {
  unit: string;
  activityGuideKey?: string | null;
  length?: FollowAlongLength;
  media?: FollowAlongMedia;
}): FollowAlongPlan {
  const unit = (input.unit ?? '').trim();
  const guide = selectActivityGuide({ unit, activityGuideKey: input.activityGuideKey });
  const shape = input.length === 'full' ? FULL : SHORT;
  const label = unit || 'your movement';

  const steps: FollowAlongStep[] = [
    {
      id: 'ready',
      title: 'Get ready',
      detail: `Find your space. ${label} starts in a moment.`,
      seconds: READY_SECONDS,
      kind: 'ready',
    },
  ];

  for (let round = 1; round <= shape.rounds; round += 1) {
    steps.push({
      id: `move-${round}`,
      title: `Move: ${label}`,
      detail: guide.rules[0] ?? `Take your time with each one.`,
      seconds: shape.moveSeconds,
      kind: 'move',
    });
    steps.push({
      id: `rest-${round}`,
      title: 'Rest',
      detail: 'Stand easy. Keep your own count in mind.',
      seconds: shape.restSeconds,
      kind: 'rest',
    });
  }

  steps.push({
    id: 'done',
    title: 'Done',
    detail: `Add what you counted to the goal when you are ready.`,
    seconds: 0,
    kind: 'done',
  });

  return {
    unit: label,
    guide,
    rounds: shape.rounds,
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
