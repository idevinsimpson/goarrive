import { attemptAtRiskOnLeave, type PendingContribution } from './pendingContribution';

/**
 * W12-3 (INT-19). WHAT ANDROID'S BACK DOES ON THE CONTRIBUTION FLOW.
 *
 * Back used to pop the whole sheet from any step, and a Back that acts like
 * Close on an attempt whose outcome is unknown and that the device did not
 * keep throws away the only copy and offers Record again: the ST-02
 * double-count path. So Back is decided here, in this order:
 *
 *   (a) a request in flight (`submitting`, or the attempt is `sending`):
 *       nothing happens;
 *   (b') leaving would put the attempt at risk (attemptAtRiskOnLeave: unknown
 *       and not kept, or the stored attempt could not be read): nothing
 *       happens. The not-saved notice stays on screen, and its own visible
 *       control stays the deliberate way out;
 *   (b) a settled screen (a receipt, a refusal, or an unknown attempt the
 *       device kept): the sheet closes like Close; a page goes back;
 *   (c) review: back to the entry, keeping the count;
 *   (d) adjust: nothing (unreachable on a phone while the camera gate is off);
 *   (e) entry opened from the movement step: back to it, with the timer still
 *       paused and the typed count kept; entry opened directly: as (b);
 *   (f) the movement step: as (b).
 *
 * Pure: the route registers the listener (Android, not a kiosk) and acts on
 * the answer.
 */
export type ContributeBackSnapshot = {
  submitting: boolean;
  pending: PendingContribution | null;
  pendingDurable: boolean;
  restoreFailed: boolean;
  /** A receipt is on screen. */
  hasResult: boolean;
  /** A definitive refusal is on screen. */
  hasRefusal: boolean;
  step: 'move' | 'enter' | 'adjust' | 'review';
  /** Where this flow started: the movement step, or the entry. */
  initialStep: 'move' | 'enter';
  /** Presented as the sheet over the member's tab (Close exits it), or a page. */
  asSheet: boolean;
};

/** consume: Back does nothing; close: the sheet's Close; edit: review to entry; toMove: entry to movement; pass: the navigator's own Back. */
export type ContributeBackAction = 'consume' | 'close' | 'edit' | 'toMove' | 'pass';

export function contributeBackAction(s: ContributeBackSnapshot): ContributeBackAction {
  const leave: ContributeBackAction = s.asSheet ? 'close' : 'pass';
  if (s.submitting || s.pending?.state === 'sending') return 'consume';
  if (
    attemptAtRiskOnLeave({
      pending: s.pending,
      pendingDurable: s.pendingDurable,
      submitting: s.submitting,
      restoreFailed: s.restoreFailed,
    })
  ) {
    return 'consume';
  }
  if (s.hasResult || s.hasRefusal || (s.pending?.state === 'unknown' && s.pendingDurable)) return leave;
  if (s.step === 'review') return 'edit';
  if (s.step === 'adjust') return 'consume';
  if (s.step === 'enter') return s.initialStep === 'move' ? 'toMove' : leave;
  return leave;
}
