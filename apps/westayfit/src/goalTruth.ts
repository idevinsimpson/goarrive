/**
 * GOAL TRUTH — what a member-facing parity view may say about a goal's shared
 * position and lifecycle, and nothing more. Shared by YouParityView and
 * ProgressParityView (Director #492 `5841012915`, #365 `5841122582`).
 *
 * A SHARED POSITION IS KNOWN OR IT IS NOT. When the aggregate read did not
 * answer, the position is `unknown`: it never renders as 0, never feeds a
 * Living WE, and never decides reached or unfinished. An open goal can still
 * truthfully say OPEN; a closed one says CLOSED · RESULT UNAVAILABLE.
 *
 * NO DATES ARE INTERPRETED HERE. A goal's window is shown as the
 * `periodLabel` the route adapter formats with the goal's own timezone; the
 * views display it verbatim and never read the device's zone.
 */

export type SharedPosition = { kind: 'known'; total: number } | { kind: 'unknown' };

export const UNKNOWN_SHARED: SharedPosition = { kind: 'unknown' };

/**
 * A confirmed total is a finite, non-negative count. Anything else (NaN,
 * ±Infinity, a negative) fails closed to unknown, so it can never draw as
 * progress (Director #492 `5841926397`, W5 Y-F1).
 */
export const knownShared = (total: number): SharedPosition =>
  Number.isFinite(total) && total >= 0 ? { kind: 'known', total } : UNKNOWN_SHARED;

export type GoalTruth = {
  /** status === 'active' on the goal. */
  open: boolean;
  target: number;
  shared: SharedPosition;
};

export type LifecycleTone = 'open' | 'closedReached' | 'muted';
export type LifecycleStatus = { label: string; tone: LifecycleTone };

/** The confirmed total, or null when it is not known. */
export function sharedTotalOf(goal: Pick<GoalTruth, 'shared'>): number | null {
  return goal.shared.kind === 'known' ? goal.shared.total : null;
}

/** A progress instrument needs a confirmed total and a positive target. */
export function hasInstrument(goal: Pick<GoalTruth, 'shared' | 'target'>): boolean {
  return goal.shared.kind === 'known' && goal.target > 0;
}

/** Whether a numerical Living WE may be drawn: the same rule, by its purpose. */
export const canRenderLivingWe = hasInstrument;

/** Reached only on a confirmed total against a usable target. */
export function isReachedNow(goal: Pick<GoalTruth, 'shared' | 'target'>): boolean {
  return goal.shared.kind === 'known' && goal.target > 0 && goal.shared.total >= goal.target;
}

/**
 * The reference's lifecycle pill (Lovable `baseView` → `statusLabel`, upper-cased
 * by its CSS). A closed goal whose total is unknown says CLOSED · RESULT
 * UNAVAILABLE: whether it was reached is not known, so it is claimed neither
 * way.
 */
export function statusOf(goal: GoalTruth): LifecycleStatus {
  const reached = isReachedNow(goal);
  if (goal.open) return { label: reached ? 'REACHED · STILL OPEN' : 'OPEN', tone: 'open' };
  if (goal.shared.kind === 'unknown') return { label: 'CLOSED · RESULT UNAVAILABLE', tone: 'muted' };
  return reached
    ? { label: 'CLOSED · REACHED', tone: 'closedReached' }
    : { label: 'CLOSED · UNFINISHED', tone: 'muted' };
}

const n = (v: number) => v.toLocaleString('en-US');

/** A "Shared" cell: Unknown, a bare total with no usable target, or total / target unit. */
export function sharedCell(goal: GoalTruth & { unit: string }): string {
  if (goal.shared.kind === 'unknown') return 'Unknown';
  return goal.target > 0
    ? `${n(goal.shared.total)} / ${n(goal.target)} ${goal.unit}`
    : `${n(goal.shared.total)} ${goal.unit}`;
}
