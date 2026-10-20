/**
 * Pending-contribution storage and request-context scoping.
 *
 * Extracted from the contribute route so these isolation rules can be tested
 * directly: a route module under a bracketed dynamic path cannot be imported
 * by the app's test harness.
 *
 * Storage goes through the device boundary (src/storage/kv.ts: localStorage
 * on web, AsyncStorage on iOS and Android), under the same keys and in the
 * same format as before, so a record written by the web app before this
 * change is read exactly as it was.
 */
import { deviceKv } from './storage/kv';

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

/**
 * WHY EVERY OPERATION BELOW IS ASYNCHRONOUS AND QUEUED PER KEY.
 *
 * These records used to live in window.localStorage, which is synchronous:
 * "read the slot, then write it" could not be interleaved with anything. They
 * now go through `deviceKv` (src/storage/kv.ts), which is AsyncStorage on a
 * phone, and an await between the read and the write is exactly where an old
 * attempt's late failure could land on top of a newer attempt's record — the
 * defect `updatePendingIfAttempt` exists to prevent. So every operation on a
 * slot runs strictly after the previous one on that slot has finished, in the
 * order it was called. Within this process a conditional update or clear is
 * therefore as atomic as it was when storage was synchronous.
 */
const queues = new Map<string, Promise<unknown>>();

function onSlot<T>(key: string, op: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.then(op, op);
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}

async function readSlot(goalId: string, uid: string): Promise<PendingContribution | null> {
  return parsePending(await deviceKv.getItem(pendingKey(goalId, uid)), goalId);
}

export function loadPending(goalId: string, uid: string): Promise<PendingContribution | null> {
  return onSlot(pendingKey(goalId, uid), () => readSlot(goalId, uid));
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
export function retireLegacyPending(goalId: string): Promise<PendingContribution | null> {
  return onSlot(legacyPendingKey(goalId), async () => {
    const raw = await deviceKv.getItem(legacyPendingKey(goalId));
    if (!raw) return null;
    const parsed = parsePending(raw, goalId);

    // Preserve FIRST, remove second. Removing the original before the
    // quarantine copy is written means a storage failure loses the only
    // record of the attempt identity — which is the one thing that lets the
    // original account reconcile it safely.
    if (parsed) {
      const preserved = await deviceKv.setItem(
        `${PENDING_KEY_PREFIX}orphan.${goalId}.${parsed.attemptId}`,
        JSON.stringify({ ...parsed, state: 'unknown', orphanedAt: Date.now() })
      );
      if (!preserved) {
        // Could not preserve it. Leave the original in place rather than
        // destroy it — it is inert either way, because loadPending only ever
        // reads account-scoped keys and never this one.
        return parsed;
      }
    }
    await deviceKv.removeItem(legacyPendingKey(goalId));
    return parsed;
  });
}

/**
 * Best-effort write of a record. Resolves whether the device accepted it.
 * (Quota exceeded / disabled / private mode resolve false; the retry path
 * still works within the session from the screen's own state.)
 */
export function savePending(p: PendingContribution, uid: string): Promise<boolean> {
  return onSlot(pendingKey(p.goalId, uid), () => deviceKv.setItem(pendingKey(p.goalId, uid), JSON.stringify(p)));
}

/**
 * Create the record for a genuinely NEW attempt.
 *
 * Unconditional by design: starting an attempt is the one moment a record is
 * supposed to come into existence. Everything asynchronous uses
 * `updatePendingIfAttempt` instead.
 *
 * Resolves TRUE ONLY WHEN THE DEVICE ACCEPTED THE WRITE. That answer is what
 * entitles the screen to say "the same attempt will be here when you come
 * back"; see `openAttempt`, which waits for it before the request fires.
 */
export function savePendingNew(p: PendingContribution, uid: string): Promise<boolean> {
  return onSlot(pendingKey(p.goalId, uid), () => deviceKv.setItem(pendingKey(p.goalId, uid), JSON.stringify(p)));
}

/**
 * Update an EXISTING record, and only if it is still the expected attempt.
 *
 * This is what every late callback must use. Two conditions, both required:
 * a readable record is present AND it is this attempt, and the incoming row
 * is this attempt too.
 *
 * An absent, cleared or unreadable slot is NOT permission to write. The
 * earlier version treated an empty slot as writable whenever the incoming row
 * matched the attempt it was told about — which is always true in the catch
 * blocks — so after attempt 1 was reconciled and cleared, its late failure
 * recreated it as `unknown`. The member saw a reminder to reconcile work they
 * had already completed.
 *
 * This is a LOCAL REMINDER record only. Recreating it never double-counted
 * anything: the server keys idempotency on goalId, uid and attemptId, and
 * replaying a recorded attempt returns the original receipt.
 */
export function updatePendingIfAttempt(
  p: PendingContribution,
  uid: string,
  attemptId: string
): Promise<boolean> {
  return onSlot(pendingKey(p.goalId, uid), async () => {
    const current = await readSlot(p.goalId, uid);
    // No readable record: the attempt this callback belongs to is finished or
    // was superseded. Nothing to update, and nothing to resurrect.
    if (!current) return false;
    if (current.attemptId !== attemptId) return false;
    if (p.attemptId !== attemptId) return false;
    return deviceKv.setItem(pendingKey(p.goalId, uid), JSON.stringify(p));
  });
}

/** Clear ONLY if the stored record is still this attempt. An old success must not clear a newer one. */
export function clearPendingIfAttempt(goalId: string, uid: string, attemptId: string): Promise<boolean> {
  return onSlot(pendingKey(goalId, uid), async () => {
    const current = await readSlot(goalId, uid);
    if (current && current.attemptId !== attemptId) return false;
    return deviceKv.removeItem(pendingKey(goalId, uid));
  });
}

export function clearPending(goalId: string, uid: string): Promise<boolean> {
  return onSlot(pendingKey(goalId, uid), () => deviceKv.removeItem(pendingKey(goalId, uid)));
}

// ---------------------------------------------------------------------------
// The attempt lifecycle, as the contribute screen drives it.
//
// Kept here, not in the route, so the ordering rules can be tested directly
// (a route under a bracketed path cannot be imported by the test harness).
// None of these touch screen state: each returns what happened and the screen
// decides what to show, after its own context check.
// ---------------------------------------------------------------------------

/**
 * What a screen restores on arrival for this account and goal.
 *
 * A stored attempt — whether it was left `sending` (the process died with
 * the request in flight) or `unknown` — comes back as `unknown`: a reminder
 * to replay the SAME attempt. Restoring NEVER makes anything confirmed and
 * never produces a receipt; only a server response does that. The escalation
 * is persisted (conditionally) so a second reload shows the same screen.
 *
 * A legacy unscoped record is retired, never adopted (see
 * `retireLegacyPending`), and returned separately so the screen can hold its
 * camera and new-attempt entry closed.
 */
export type RestoredAttempt = {
  pending: PendingContribution | null;
  orphan: PendingContribution | null;
};

export async function restorePendingAttempt(goalId: string, uid: string | null): Promise<RestoredAttempt> {
  const orphan = await retireLegacyPending(goalId);
  if (!uid) return { pending: null, orphan };
  const existing = await loadPending(goalId, uid);
  if (!existing) return { pending: null, orphan };
  const escalated: PendingContribution = { ...existing, state: 'unknown' };
  await updatePendingIfAttempt(escalated, uid, existing.attemptId);
  return { pending: escalated, orphan };
}

/**
 * Whether the screen may begin a NEW attempt (Record, or the camera that
 * leads to one).
 *
 * Not until this account's stored attempt has been read: the store answers
 * asynchronously now, and a new attempt started before it answered would
 * overwrite a reminder the member has not reconciled — and could book the
 * same effort twice under two attempt ids. And never while an attempt is
 * pending, or a refusal or receipt is on screen. (The camera additionally
 * stays closed while a legacy record is present; that rule is the screen's.)
 */
export function mayBeginNewAttempt(s: {
  restoreSettled: boolean;
  pending: PendingContribution | null;
  settled: boolean;
}): boolean {
  return s.restoreSettled && !s.pending && !s.settled;
}

/**
 * Step one of a NEW attempt: write its record, and wait for the device's
 * answer BEFORE the request is allowed to fire.
 *
 *   - `durable: true` — the record is on the device. If the process dies from
 *     here on, the next launch restores this attemptId as reconcilable.
 *   - `durable: false` — the device refused it. The request still fires (the
 *     member is never blocked from recording, which the web flow never did),
 *     but the screen must not claim the attempt will survive leaving it.
 *
 * `mayFire` is asked AFTER the write, because the write is asynchronous now:
 * if the account, goal or screen changed meanwhile, the request is not sent
 * at all — it would otherwise go out under whichever account is signed in
 * NOW, and the server keys idempotency on that uid — and the record this
 * call just wrote is retired (only if the slot is still this attempt).
 */
export async function openAttempt(
  row: PendingContribution,
  uid: string,
  mayFire: () => boolean
): Promise<{ fire: boolean; durable: boolean }> {
  const durable = await savePendingNew(row, uid);
  if (!mayFire()) {
    await clearPendingIfAttempt(row.goalId, uid, row.attemptId);
    return { fire: false, durable };
  }
  return { fire: true, durable };
}

export type AttemptIo<T> = {
  /** The request. Called exactly once. */
  send: () => Promise<T>;
  /** The server ran the request and refused it: nothing was or will be recorded. */
  isRefusal: (error: unknown) => boolean;
  /** Whether the request still belongs to what the screen is showing. */
  stillCurrent: () => boolean;
};

export type AttemptSettlement<T> =
  | { kind: 'confirmed'; data: T; current: boolean }
  | { kind: 'refused'; error: unknown }
  | { kind: 'unknown'; error: unknown };

/**
 * Step two: send once and settle the record by what came back.
 *
 *   - CONFIRMED — server truth. The record is cleared, but only while the
 *     request is still current; a late success for a superseded context leaves
 *     it under the ORIGINAL account so that person can still reconcile it (the
 *     replay returns the original receipt).
 *   - REFUSED — kept distinct from unknown. Nothing was recorded and nothing
 *     will be, so the reminder is retired (only if it is still this attempt):
 *     it would only invite a replay that will be refused again.
 *   - UNKNOWN — the outcome was not learned. The record is escalated to
 *     `unknown` under the original account, and only if the slot is still this
 *     attempt, so a late failure can neither recreate a cleared record nor
 *     overwrite a newer one.
 */
export async function settleAttempt<T>(
  row: PendingContribution,
  uid: string,
  io: AttemptIo<T>
): Promise<AttemptSettlement<T>> {
  try {
    const data = await io.send();
    const current = io.stillCurrent();
    if (current) await clearPendingIfAttempt(row.goalId, uid, row.attemptId);
    return { kind: 'confirmed', data, current };
  } catch (error) {
    if (io.isRefusal(error)) {
      await clearPendingIfAttempt(row.goalId, uid, row.attemptId);
      return { kind: 'refused', error };
    }
    await updatePendingIfAttempt({ ...row, state: 'unknown' }, uid, row.attemptId);
    return { kind: 'unknown', error };
  }
}

/**
 * Replay the SAME attempt (a restored or unresolved one). The record already
 * exists, so nothing waits on storage before the request: the flip to
 * `sending` is queued on the slot ahead of whatever the settlement writes,
 * and is conditional, like every other late write.
 */
export function replayAttempt<T>(
  row: PendingContribution,
  uid: string,
  io: AttemptIo<T>
): Promise<AttemptSettlement<T>> {
  void updatePendingIfAttempt({ ...row, state: 'sending' }, uid, row.attemptId);
  return settleAttempt(row, uid, io);
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
