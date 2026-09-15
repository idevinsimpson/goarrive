/**
 * Pending-contribution storage and request-context scoping.
 *
 * Extracted from the contribute route so these isolation rules can be tested
 * directly: a route module under a bracketed dynamic path cannot be imported
 * by the app's test harness.
 */

export type PendingContribution = {
  goalId: string;
  attemptId: string;
  count: number;
  ts: number;
  // 'sending' — request is in flight; 'unknown' — the network dropped or an
  // error prevented us from learning the outcome. Both surface as
  // reconcilable in the UI. A confirmed contribution clears the key.
  state: 'sending' | 'unknown';
};

const PENDING_KEY_PREFIX = 'wsf.pendingContribution.';


// The key is scoped to the GOAL AND THE SIGNED-IN ACCOUNT.
//
// It used to be `wsf.pendingContribution.{goalId}` alone. On a shared laptop
// that made an unsent attempt inherited by whoever signed in next — and
// because the server's idempotency key is `{goalId}_{uid}_{attemptId}`,
// replaying it under a different uid does not deduplicate. It books a NEW
// contribution credited to the wrong member. Scoping the key is necessary;
// the guards below are the rest of what makes the account switch safe.
export function pendingKey(goalId: string, uid: string): string {
  return `${PENDING_KEY_PREFIX}${goalId}.${uid}`;
}

/** The pre-fix key shape. Read only to retire it — never to restore from. */
export function legacyPendingKey(goalId: string): string {
  return `${PENDING_KEY_PREFIX}${goalId}`;
}

function parsePending(raw: string | null, goalId: string): PendingContribution | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      parsed.goalId === goalId &&
      typeof parsed.attemptId === 'string' &&
      typeof parsed.count === 'number' &&
      typeof parsed.ts === 'number' &&
      (parsed.state === 'sending' || parsed.state === 'unknown')
    ) {
      return parsed as PendingContribution;
    }
  } catch {
    // fall through
  }
  return null;
}

export function loadPending(goalId: string, uid: string): PendingContribution | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    return parsePending(window.localStorage.getItem(pendingKey(goalId, uid)), goalId);
  } catch {
    return null;
  }
}

/**
 * Retire a legacy unscoped record without transferring ownership.
 *
 * A record written before the key carried a uid belongs to an account we
 * cannot identify. It is NOT adopted by whoever signs in next and it is NOT
 * resubmitted — doing either would credit one person's effort to another.
 * It is moved to an orphan key so the original attempt identity survives for
 * reconciliation, and so it can never be picked up as a live pending attempt.
 */
export function retireLegacyPending(goalId: string): PendingContribution | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(legacyPendingKey(goalId));
    if (!raw) return null;
    const parsed = parsePending(raw, goalId);

    // Preserve FIRST, remove second. Removing the original before the
    // quarantine copy is written means a storage failure loses the only
    // record of the attempt identity — which is the one thing that lets the
    // original account reconcile it safely.
    if (parsed) {
      try {
        window.localStorage.setItem(
          `${PENDING_KEY_PREFIX}orphan.${goalId}.${parsed.attemptId}`,
          JSON.stringify({ ...parsed, state: 'unknown', orphanedAt: Date.now() })
        );
      } catch {
        // Could not preserve it. Leave the original in place rather than
        // destroy it — it is inert either way, because loadPending only ever
        // reads account-scoped keys and never this one.
        return parsed;
      }
    }
    window.localStorage.removeItem(legacyPendingKey(goalId));
    return parsed;
  } catch {
    return null;
  }
}

export function savePending(p: PendingContribution, uid: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(pendingKey(p.goalId, uid), JSON.stringify(p));
  } catch {
    // Quota exceeded / disabled / private mode — best-effort. The retry
    // path still works within-session via attemptRef.
  }
}

/**
 * Write a pending record ONLY if the stored record is still the same attempt.
 *
 * Guarding the visible state is not enough. An old request's `catch` used to
 * persist unconditionally, so a failure belonging to attempt 1 could overwrite
 * attempt 2's record for the same account and goal — resurrecting work the
 * member had already reconciled, underneath work they were still doing. The
 * error was invisible; the damage was not.
 *
 * Returns whether it wrote, so callers can tell "superseded" from "saved".
 */
export function savePendingIfAttempt(
  p: PendingContribution,
  uid: string,
  attemptId: string
): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    const current = loadPending(p.goalId, uid);
    // Nothing stored: only the attempt that owns this slot may create it.
    if (current && current.attemptId !== attemptId) return false;
    if (!current && p.attemptId !== attemptId) return false;
    window.localStorage.setItem(pendingKey(p.goalId, uid), JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

/** Clear ONLY if the stored record is still this attempt. An old success must not clear a newer one. */
export function clearPendingIfAttempt(goalId: string, uid: string, attemptId: string): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    const current = loadPending(goalId, uid);
    if (current && current.attemptId !== attemptId) return false;
    window.localStorage.removeItem(pendingKey(goalId, uid));
    return true;
  } catch {
    return false;
  }
}

export function clearPending(goalId: string, uid: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(pendingKey(goalId, uid));
  } catch {
    // best-effort
  }
}

/**
 * The context an async request belongs to.
 *
 * Comparing the uid alone is not enough. The same account switching goals
 * passes a uid check; so does A -> B -> A while an old request is still in
 * flight. The generation counter closes both: it increments on every account
 * or goal change, so a superseded request can never match the current one even
 * if the account and goal happen to be identical again.
 */
export type RequestContext = {
  generation: number;
  uid: string | null;
  goalId: string | undefined;
};

export function isSameContext(started: RequestContext, current: RequestContext): boolean {
  return (
    started.generation === current.generation &&
    started.uid === current.uid &&
    started.goalId === current.goalId
  );
}
