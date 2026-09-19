/**
 * What actually happened to this account's verification email.
 *
 * Why this exists: sign-up starts the send AFTER the auth effect has already
 * moved the new member to /verify-email, and it swallowed any failure into a
 * console warning. The verify screen then told every member "We sent a
 * verification link", including the members for whom nothing was sent and
 * nothing could be.
 *
 * Why it notifies rather than just storing: the send finishes while the verify
 * screen is already mounted. A plain module variable read during render would
 * be correct only by luck — the screen would keep showing "Sending" until some
 * unrelated render happened to pick the new value up. Subscribers are the
 * whole point, not a refinement.
 *
 * It is deliberately module state, not storage: the outcome describes one
 * attempt in one session and must never outlive a sign-out or be read back for
 * a different account.
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

type Entry = { uid: string; outcome: VerificationSendOutcome; attempt: number };

let entry: Entry | null = null;
let attemptCounter = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * Claim the right to report an outcome, and get back the attempt number that
 * proves it. A later attempt always wins: if a member taps Resend while the
 * sign-up send is still in the air, the sign-up's late answer must not
 * overwrite the newer one.
 */
export function beginVerificationSend(uid: string): number {
  attemptCounter += 1;
  const attempt = attemptCounter;
  if (uid) {
    entry = { uid, outcome: 'sending', attempt };
    emit();
  }
  return attempt;
}

/**
 * Record the outcome of a send attempt for exactly one account.
 *
 * Ignored when the attempt has been superseded, or when the account it belongs
 * to is no longer the one this record is about — which is what stops a send
 * that completes after sign-out from describing whoever signs in next.
 */
export function recordVerificationSend(
  uid: string,
  outcome: VerificationSendOutcome,
  attempt?: number
): void {
  if (!uid) return;
  if (attempt !== undefined) {
    if (!entry || entry.attempt > attempt || entry.uid !== uid) return;
    entry = { uid, outcome, attempt };
  } else {
    attemptCounter += 1;
    entry = { uid, outcome, attempt: attemptCounter };
  }
  emit();
}

/**
 * The outcome recorded for THIS account, or null when nothing is known about
 * it. The uid check is the point: a state recorded for one account must never
 * describe another, so a screen that cannot match the uid says nothing rather
 * than something plausible.
 */
export function readVerificationSend(
  uid: string | null | undefined
): VerificationSendOutcome | null {
  if (!uid || !entry || entry.uid !== uid) return null;
  return entry.outcome;
}

/** Drop the record. Called when the account changes or signs out. */
export function forgetVerificationSend(): void {
  const had = entry !== null;
  entry = null;
  // A later completion from the attempt that was in flight must not resurrect
  // it, so the counter moves on too.
  attemptCounter += 1;
  if (had) emit();
}

/** Subscribe to changes. Returns the unsubscribe function. */
export function subscribeVerificationSend(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * A stable snapshot for `useSyncExternalStore`. It must return the SAME value
 * when nothing has changed, so the entry object itself is the snapshot rather
 * than anything derived from it.
 */
export function verificationSendSnapshot(): Entry | null {
  return entry;
}
