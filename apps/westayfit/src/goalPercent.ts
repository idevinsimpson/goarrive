// Percentage math for the E4-A1 shared-goal surfaces. Extracted from
// contribute/[goalId].tsx + display/[goalId].tsx so the arithmetic can be
// exercised in a jsdom-free unit test with no expo-router/firebase imports.
//
// Two floors, one ceiling:
//   * barPercent — CLAMPED to [0, 100] because the progress bar cannot
//     visually exceed the track. Used for fill width only.
//   * integerPercent — floored at 0 but NOT ceilinged. Used for the visible
//     "N%" readout, so 4999/5000 renders 99 (never 100), and 5015/5000
//     renders 100 without lying that "goal reached" has happened before the
//     shard writes commit. E4-A1-R1 explicitly required that a display
//     showing "100%" must never be one below the goal.
//
// Both accept fractional inputs but return integers; both are pure.

export function barPercent(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((current * 100) / target)));
}

export function integerPercent(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.max(0, Math.floor((current * 100) / target));
}
