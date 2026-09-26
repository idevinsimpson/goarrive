/**
 * PROGRESS-PARITY-1 — the facts the Progress screen shows, and the pure rules
 * that turn them into what the accepted reference (Lovable `09b8a73c`,
 * `src/demo/screens/progress.tsx`) draws.
 *
 * Nothing here reads Firebase, routes, or stores anything. The route resolves
 * canonical facts (wsfMyCommunities → wsfListGoals → wsfMyContribution, as
 * `app/(tabs)/activity.tsx` already does); these functions only decide how to
 * present them, so they are tested directly (tests/progress-parity.test.ts).
 *
 * WHAT CANONICAL CANNOT READ. Dated, per-contribution receipts. No callable
 * returns a member's own `wsfContributions` rows and the collection is
 * client-denied (see the header of activity.tsx and
 * docs/design-target/review/page-04-progress/PRIVATE-HISTORY-CONTRACT.md).
 * So `receipts` is `null` — unavailable — and never an invented list.
 *
 * The shared-position and lifecycle rules are src/goalTruth.ts, shared with
 * YouParityView: an unknown shared total is never 0 and never decides reached
 * or unfinished, and no date is interpreted here.
 */

import {
  isReachedNow,
  sharedCell,
  statusOf,
  type LifecycleStatus,
  type LifecycleTone,
  type SharedPosition,
} from './goalTruth';

export { isReachedNow, sharedCell, statusOf };

/** A goal this member has a RECORDED part in, with both figures kept apart. */
export type ProgressGoal = {
  goalId: string;
  title: string;
  communityId: string;
  /** The community's display name. */
  community: string;
  unit: string;
  /** Exactly what this member recorded. Never summed with another unit. */
  yourPart: number;
  target: number;
  /** Where the community stands: a different number, or not known at all. */
  shared: SharedPosition;
  /** status === 'active' on the goal. */
  open: boolean;
  /**
   * The goal's window as the route formats it in the goal's own timezone
   * ("Ended Aug 31", "This week"), shown verbatim; null when there is none.
   */
  periodLabel: string | null;
};

/**
 * One recorded contribution, as a future authorized source would supply it.
 * NO CANONICAL SOURCE EXISTS TODAY; the slot and its shape are the contract.
 */
export type ProgressReceipt = {
  id: string;
  amount: number;
  unit: string;
  goalTitle: string;
  community: string;
  /** Already formatted by the caller, e.g. with `relTime`. */
  whenLabel: string;
};

export type ProgressState =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'failed'; memberName: string | null }
  | {
      kind: 'ready';
      memberName: string | null;
      /** Open goals with own credit. */
      open: ProgressGoal[];
      /** Finished goals with own credit, most recently ended first. */
      finished: ProgressGoal[];
      /** A read failed and these lists may be short. */
      partial: boolean;
      /** A live open goal with a usable target exists: Start moving is truthful. */
      canStart: boolean;
      /** `null` = no source can supply dated receipts (today, always). */
      receipts: ProgressReceipt[] | null;
    };

export type ProgressTone = LifecycleTone;
export type ProgressStatus = LifecycleStatus;

const n = (v: number) => v.toLocaleString('en-US');

/**
 * Private totals, ONE PER UNIT, in the order the units first appear. The key is
 * the exact unit text, so "squats" and "step-ups" never add up to anything and
 * two spellings never merge.
 */
export function unitTotals(goals: readonly ProgressGoal[]): Array<{ unit: string; total: number }> {
  const totals = new Map<string, number>();
  for (const g of goals) totals.set(g.unit, (totals.get(g.unit) ?? 0) + g.yourPart);
  return [...totals.entries()].map(([unit, total]) => ({ unit, total }));
}

const plural = (count: number, one: string, many = `${one}s`) => `${n(count)} ${count === 1 ? one : many}`;

/** "Across 4 goals in 2 communities. Each unit stays separate." */
export function summaryLine(goals: readonly ProgressGoal[]): string {
  const communities = new Set(goals.map((g) => g.communityId)).size;
  return `Across ${plural(goals.length, 'goal')} in ${plural(communities, 'community', 'communities')}. Each unit stays separate.`;
}

/** Open goals first, then finished — the reference's `memberGoalRows` order. */
export function orderedGoals(open: readonly ProgressGoal[], finished: readonly ProgressGoal[]): ProgressGoal[] {
  return [...open, ...finished];
}

/** Which body the ready state shows. */
export type ProgressBody = 'goals' | 'firstEligible' | 'noOpenGoal';

export function bodyOf(state: Extract<ProgressState, { kind: 'ready' }>): ProgressBody {
  if (state.open.length + state.finished.length > 0) return 'goals';
  return state.canStart ? 'firstEligible' : 'noOpenGoal';
}

/** The hero eyebrow: private, and whose. */
export function heroEyebrow(memberName: string | null): string {
  const name = memberName?.trim();
  return name ? `PRIVATE TO YOU · ${name.toUpperCase()}` : 'PRIVATE TO YOU';
}

/**
 * The reference's relative time, for the receipt source that does not exist
 * yet. Deterministic: the caller passes `now`.
 */
export function relTime(at: number, now: number): string {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
