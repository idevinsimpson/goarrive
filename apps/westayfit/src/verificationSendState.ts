/**
 * What actually happened to this account's verification email.
 *
 * Why this exists: sign-up starts the send AFTER the auth effect has already
 * moved the new member to /verify-email, and it swallowed any failure into a
 * console warning. The verify screen then told every member "We sent a
 * verification link", including the members for whom nothing was sent and
 * nothing could be. Someone who tapped Resend saw both that claim and "no
 * message was sent" on the same screen. This module carries the real outcome
 * from whoever attempted the send to whoever has to describe it.
 *
 * It is deliberately module state, not storage: the outcome describes one
 * attempt in one session and must never outlive a sign-out or be read back for
 * a different account. `forgetVerificationSend()` is called on sign-out.
 */

export type VerificationSendOutcome =
  /** A send is in flight; nothing can be claimed yet. */
  | 'sending'
  /** The server confirmed it sent a message. */
  | 'sent'
  /** The server declined because the address is already verified. */
  | 'already-verified'
  /** This build has no mail configured, so no message can be sent at all. */
  | 'unconfigured'
  /** The send was attempted and failed for some other reason. */
  | 'failed';

type Entry = { uid: string; outcome: VerificationSendOutcome };

let entry: Entry | null = null;

/** Record the outcome of a send attempt for exactly one account. */
export function recordVerificationSend(uid: string, outcome: VerificationSendOutcome): void {
  if (!uid) return;
  entry = { uid, outcome };
}

/**
 * The outcome recorded for THIS account, or null when nothing is known about
 * it. The uid check is the point: a state recorded for one account must never
 * describe another, so a screen that cannot match the uid says nothing rather
 * than something plausible.
 */
export function readVerificationSend(uid: string | null | undefined): VerificationSendOutcome | null {
  if (!uid || !entry || entry.uid !== uid) return null;
  return entry.outcome;
}

/** Drop the record. Called when the account changes or signs out. */
export function forgetVerificationSend(): void {
  entry = null;
}
