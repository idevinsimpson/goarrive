/**
 * Presentation rules for one goal's confirmed progress. Pure, so every rule is
 * unit-tested directly.
 *
 * Source: Strategic Master v3 §05 "Calculation and display", confirmed by
 * Devin on 2026-09-17.
 *   - actual progress is T / G; the FILL uses the true ratio, clamped to [0, 1]
 *   - below the target the percentage TEXT shows at most one decimal, rounded
 *     DOWN: floor(1000 × T / G) / 10 — 4,999 of 5,000 is 99.9%, never 100%;
 *     a whole number prints without a trailing ".0" (450 of 500 is 90%)
 *   - positive progress below 0.1% reads "less than 0.1%"; zero reads "0%"
 *   - at or beyond the target the mark reads 100% and stops at full; the
 *     stored total is never capped, so the exact total and the amount beyond
 *     the goal stay visible where relevant
 *   - state transitions use confirmed values, not rounded text
 *   - reached and closed are separate facts
 *
 * This replaces the integer-floor rule in src/goalPercent.ts for the member
 * and display surfaces. The integer helpers remain for the existing shared
 * bar until every caller has moved.
 */

export type GoalStatus = 'active' | 'closed';

/** T / G clamped to [0, 1]. Non-positive targets and negative totals are 0. */
export function fillRatio(completed: number, target: number): number {
  if (!Number.isFinite(completed) || !Number.isFinite(target) || target <= 0) return 0;
  if (completed <= 0) return 0;
  return Math.min(1, completed / target);
}

/**
 * The fill ratio as a four-decimal string for the DOM, ROUNDED DOWN, so it can
 * only read "1.0000" at or beyond the target. (`toFixed` rounds to nearest,
 * which would print a literal full ratio for 29,999 of 30,000.)
 */
export function fillRatioAttribute(completed: number, target: number): string {
  const ratio = fillRatio(completed, target);
  if (ratio >= 1) return '1.0000';
  const tenThousandths =
    Number.isInteger(completed) && Number.isInteger(target)
      ? Math.floor((completed * 10000) / target)
      : Math.floor(ratio * 10000);
  return (tenThousandths / 10000).toFixed(4);
}

/**
 * One-decimal percentage, rounded down, capped at 100 at or beyond the target.
 * Integer inputs are computed with integer arithmetic so 261 of 500 is exactly
 * 52.2 and never 52.199999.
 */
export function decimalPercent(completed: number, target: number): number {
  if (!Number.isFinite(completed) || !Number.isFinite(target) || target <= 0) return 0;
  if (completed <= 0) return 0;
  if (completed >= target) return 100;
  const tenths =
    Number.isInteger(completed) && Number.isInteger(target)
      ? Math.floor((completed * 1000) / target)
      : Math.floor(1000 * (completed / target));
  return tenths / 10;
}

/**
 * The text a person reads: "0%", "less than 0.1%", "48.2%", "90%", "100%".
 * At most one decimal below completion, and no trailing ".0": 450 of 500 is
 * "90%", not "90.0%".
 */
export function percentLabel(completed: number, target: number): string {
  if (!Number.isFinite(target) || target <= 0) return '0%';
  if (completed <= 0) return '0%';
  if (completed >= target) return '100%';
  const pct = decimalPercent(completed, target);
  if (pct < 0.1) return 'less than 0.1%';
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}

export function remaining(completed: number, target: number): number {
  if (!Number.isFinite(target) || target <= 0) return 0;
  return Math.max(0, target - Math.max(0, completed));
}

export function beyondTarget(completed: number, target: number): number {
  if (!Number.isFinite(target) || target <= 0) return 0;
  return Math.max(0, completed - target);
}

export function isReached(completed: number, target: number): boolean {
  return Number.isFinite(target) && target > 0 && completed >= target;
}

/** The near-goal state begins at 90% of the true confirmed target. */
export function isNearGoal(completed: number, target: number): boolean {
  if (isReached(completed, target)) return false;
  return fillRatio(completed, target) >= 0.9;
}

export type ProgressPhase =
  | 'openAtZero'
  | 'building'
  | 'nearGoal'
  | 'reachedOpen'
  | 'closedReached'
  | 'closedUnreached';

/** Reached and closed are independent facts; this names their combination. */
export function progressPhase(
  completed: number,
  target: number,
  status: GoalStatus | string
): ProgressPhase {
  const reached = isReached(completed, target);
  if (status === 'closed') return reached ? 'closedReached' : 'closedUnreached';
  if (reached) return 'reachedOpen';
  if (completed <= 0) return 'openAtZero';
  if (isNearGoal(completed, target)) return 'nearGoal';
  return 'building';
}

/** Thousands-grouped count for human reading; the value itself is untouched. */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.trunc(n));
}

/** "241 of 500 squats" */
export function totalOfTargetLabel(completed: number, target: number, unit: string): string {
  const { count, rest } = totalOfTargetParts(completed, target, unit);
  return `${count} ${rest}`;
}

/**
 * The same line, split where a hero wants to break it: the confirmed total
 * alone, then what it is out of. `totalOfTargetLabel` is composed from these,
 * so the one-line and two-line renderings can never drift apart, and a surface
 * that joins them back with a space gets the label byte for byte.
 */
export function totalOfTargetParts(
  completed: number,
  target: number,
  unit: string,
): { count: string; rest: string } {
  return { count: formatCount(completed), rest: `of ${formatCount(target)} ${unit}` };
}

/**
 * The one line under the numbers. Says what remains, or that the goal is
 * reached, without ever saying "closer" once the target is met.
 */
export function statusLine(completed: number, target: number, status: GoalStatus | string): string {
  const phase = progressPhase(completed, target, status);
  const left = remaining(completed, target);
  const over = beyondTarget(completed, target);
  switch (phase) {
    case 'openAtZero':
      return `${formatCount(target)} to go`;
    case 'building':
      return `${formatCount(left)} to go`;
    case 'nearGoal':
      return `Only ${formatCount(left)} to go`;
    case 'reachedOpen':
      return over > 0
        ? `${formatCount(over)} beyond our goal · still open`
        : 'Goal reached · still open';
    case 'closedReached':
      return over > 0 ? `${formatCount(over)} beyond our goal` : 'Goal reached';
    case 'closedUnreached':
      return `Closed at ${percentLabel(completed, target)}`;
  }
}
