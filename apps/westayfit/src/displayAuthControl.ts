/**
 * The value the display-permission control sends, and the words it shows.
 *
 * Extracted from the community screen because the important property here is
 * not observable from the screen. Whenever a retry is offered, the card
 * happens to be showing the negation of the value that was asked for, so
 * "send the intended value" and "send the inverse of what the card shows"
 * compute the same answer and a defect in that choice is invisible.
 *
 * That coincidence is a property of today's screen, not of the rule. The
 * moment the goal list can refresh on its own — a poll, a focus refresh,
 * another Champion's change arriving — the card can show the value that was
 * already saved, and inverting it silently undoes a request that succeeded.
 * The rule is pinned here so it is tested rather than true by luck.
 */

export type DisplayAuthOutcome =
  | { kind: 'idle' }
  | { kind: 'saving'; goalId: string; intended: boolean }
  | { kind: 'unconfirmed'; goalId: string; intended: boolean }
  | { kind: 'failed'; goalId: string; intended: boolean }
  | { kind: 'confirmed'; goalId: string; intended: boolean; title: string };

export type UnsettledDisplayAuth =
  | { kind: 'unconfirmed'; goalId: string; intended: boolean }
  | { kind: 'failed'; goalId: string; intended: boolean };

/** The unsettled outcome for THIS goal, or null. Scoped by goalId so a pending
 *  state never bleeds onto a different goal's card. */
export function unsettledFor(
  outcome: DisplayAuthOutcome,
  goalId: string
): UnsettledDisplayAuth | null {
  if (outcome.kind !== 'unconfirmed' && outcome.kind !== 'failed') return null;
  return outcome.goalId === goalId ? outcome : null;
}

/**
 * The explicit value the control sends.
 *
 * With nothing unsettled it is a toggle of the permission currently shown.
 * With something unsettled it is the value that was ASKED FOR, carried
 * through unchanged — never re-derived from the card, whose value may be
 * stale, already equal to the intended one, or both.
 */
export function displayAuthValueToSend(
  unsettled: UnsettledDisplayAuth | null,
  currentlyAuthorized: boolean
): boolean {
  if (unsettled) return unsettled.intended;
  return !currentlyAuthorized;
}
