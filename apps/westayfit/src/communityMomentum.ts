/**
 * W7 SOCIAL — community momentum, from data already on the screen.
 *
 * WHAT THIS IS NOT. There is no "members active this week" here, and there
 * cannot be: `wsfGoalPulse` returns the four aggregate fields plus the goal's
 * window, and `contributorCount` was deliberately removed from it (DECISIONS.md
 * §"contributorCount is excluded" — "a substitute metric would be the same
 * unapproved disclosure under another name"). No server surface in this
 * application counts people, so nothing here counts people. Not a rounded
 * count, not a band, not a phrase that implies one.
 *
 * WHAT IT IS. One roll-up across the community's OPEN goals: how many of them
 * have reached their target. Every fact in it is already confirmed and already
 * rendered per goal; the line only says the thing no single goal card can —
 * where the community stands across all of them at once.
 *
 * THREE RULES, each of which suppresses the line rather than softening it:
 *
 *  1. Fewer than two open goals and there is no roll-up to do — the hero
 *     already states that goal's own progress, and repeating it as an
 *     "aggregate" would dress one number up as a second one.
 *  2. Every open goal must have a CONFIRMED pulse. A count taken over the
 *     subset that happened to answer reads as a count over all of them, which
 *     would be false. A failed read is not zero progress.
 *  3. Closed goals are excluded. `wsfListGoals` returns a closed goal only
 *     while it is still display-authorized, so the closed set on hand is the
 *     available subset of history, not all of it. Counting it would make a
 *     claim about the community's past that this data cannot support. Open
 *     goals have no such filter: every active goal is returned.
 */

/** One open goal, as the screen knows it after a progress read. */
export type OpenGoalMomentum = {
  /** False while the pulse is loading, and after a pulse that failed. */
  confirmed: boolean;
  /** From the confirmed pulse only; meaningless when `confirmed` is false. */
  reached: boolean;
};

/**
 * The single line, or null when there is nothing honest to say. Never "0 of 0",
 * never a partial count, never a count of people.
 */
export function communityMomentumLine(openGoals: readonly OpenGoalMomentum[]): string | null {
  if (openGoals.length < 2) return null;
  if (!openGoals.every((g) => g.confirmed)) return null;
  const reached = openGoals.filter((g) => g.reached).length;
  return `${reached} of ${openGoals.length} open goals reached together.`;
}
