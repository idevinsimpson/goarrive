/**
 * Pure helpers for useMediaPrefetch — kept free of react-native imports
 * so they can be unit-tested under vitest.
 */

/**
 * Returns the next `count` movements after `currentIndex`, clamped to the
 * list bounds and with sparse/undefined entries filtered out so callers
 * never dereference a hole near the end of the workout.
 */
export function getUpcomingMovements<T>(
  movements: T[],
  currentIndex: number,
  count = 3,
): T[] {
  if (!Array.isArray(movements) || movements.length === 0) return [];
  const start = currentIndex + 1;
  const end = Math.min(start + count, movements.length);
  if (start >= end) return [];
  return movements.slice(start, end).filter(Boolean);
}
