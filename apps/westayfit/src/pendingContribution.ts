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
import { createKeyQueue } from './storage/keyQueue';
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

/**
 * The shapes goal ids take, and the same refusal as every other routed id in
 * this app (src/eventReturn.ts, src/kioskSession.ts). It matters MORE here:
 * the goal id comes from the route and is composed into storage keys, and a
 * dot in it would make one goal's legacy key another account's scoped key —
 * `legacyPendingKey('g.uid-a')` IS `pendingKey('g', 'uid-a')` — so retiring
 * "the legacy record" for a crafted goal id would move a member's own
 * unresolved attempt out of their reach. Nothing reads or moves a record for
 * a goal id outside this shape.
 */
export function isGoalIdShape(goalId: unknown): goalId is string {
  return typeof goalId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(goalId);
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
 * order it was called (src/storage/keyQueue.ts). Within this process a
 * conditional update or clear is therefore as atomic as it was when storage
 * was synchronous.
 *
 * Each queued operation is also TIME-BOUNDED: a storage call that never
 * settles releases the slot after `STORAGE_OP_TIMEOUT_MS` and its operation
 * answers "not done" — a write is not durable, a read is unreadable, a
 * conditional update or clear did nothing.
 *
 * AN UNREADABLE SLOT IS NOT AN EMPTY ONE. `deviceKv.readItem` tells the two
 * apart, and nothing here overwrites or clears a slot it could not read: a
 * record that is there but unreadable may be a member's only reminder of an
 * attempt whose outcome is unknown.
 */
const onSlot = createKeyQueue();

type SlotRead = { ok: true; value: PendingContribution | null } | { ok: false };

async function readSlotUnqueued(goalId: string, uid: string): Promise<SlotRead> {
  const read = await deviceKv.readItem(pendingKey(goalId, uid));
  if (!read.ok) return read;
  return { ok: true, value: parsePending(read.value, goalId) };
}

type NewWrite = { durable: boolean; conflict: PendingContribution | null };

/**
 * Write a NEW attempt's record — CREATE-ONLY. Run inside the slot's queue.
 *
 *   - unreadable slot: nothing written (a record we could not read may be an
 *     unresolved attempt); not durable.
 *   - readable slot holding a DIFFERENT attempt: nothing written; that
 *     attempt comes back as `conflict`, for the screen to show as the
 *     unresolved attempt it is. Overwriting it would lose the member's only
 *     reminder of effort whose outcome is unknown — which is what a restore
 *     that timed out, or failed and then recovered, used to allow.
 *   - empty slot, or the SAME attempt (a re-Record after it was not sent):
 *     written; durable if the device kept it.
 */
async function writeNewUnqueued(p: PendingContribution, uid: string): Promise<NewWrite> {
  const read = await readSlotUnqueued(p.goalId, uid);
  if (!read.ok) return { durable: false, conflict: null };
  if (read.value && read.value.attemptId !== p.attemptId) return { durable: false, conflict: read.value };
  return { durable: await deviceKv.setItem(pendingKey(p.goalId, uid), JSON.stringify(p)), conflict: null };
}

/** Clear the slot only if it is readable and does not hold a different attempt. Run inside the slot's queue. */
async function clearIfAttemptUnqueued(goalId: string, uid: string, attemptId: string): Promise<boolean> {
  const current = await readSlotUnqueued(goalId, uid);
  if (!current.ok) return false;
  if (current.value && current.value.attemptId !== attemptId) return false;
  return deviceKv.removeItem(pendingKey(goalId, uid));
}

/** This account's record for this goal; null when absent, malformed or unreadable. */
export async function loadPending(goalId: string, uid: string): Promise<PendingContribution | null> {
  if (!isGoalIdShape(goalId)) return null;
  const read = await onSlot(
    pendingKey(goalId, uid),
    () => readSlotUnqueued(goalId, uid),
    (): SlotRead => ({ ok: false })
  );
  return read.ok ? read.value : null;
}

/**
 * Retire a legacy unscoped record without transferring ownership.
 *
 * A record written before the key carried a uid belongs to an account we
 * cannot identify. It is NOT adopted by whoever signs in next and it is NOT
 * resubmitted — doing either would credit one person's effort to another.
 * It is moved to an orphan key so the original attempt identity survives for
 * reconciliation, and so it can never be picked up as a live pending attempt.
 *
 * A goal id outside the goal-id shape is refused before any key is composed
 * from it (see `isGoalIdShape`).
 */
export function retireLegacyPending(goalId: string): Promise<PendingContribution | null> {
  if (!isGoalIdShape(goalId)) return Promise.resolve(null);
  return onSlot(
    legacyPendingKey(goalId),
    async () => {
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
    },
    // Timed out: whatever the legacy key holds stays where it is, inert.
    () => null
  );
}

/**
 * Best-effort write of a record. Resolves whether the device accepted it.
 * (Quota exceeded / disabled / private mode resolve false; the retry path
 * still works within the session from the screen's own state.)
 */
export function savePending(p: PendingContribution, uid: string): Promise<boolean> {
  if (!isGoalIdShape(p.goalId)) return Promise.resolve(false);
  return onSlot(
    pendingKey(p.goalId, uid),
    () => deviceKv.setItem(pendingKey(p.goalId, uid), JSON.stringify(p)),
    () => false
  );
}

/**
 * Create the record for a genuinely NEW attempt — create-only: it never
 * replaces a different attempt's record, and never writes over a slot the
 * device could not read (see `writeNewUnqueued`). Everything asynchronous
 * uses `updatePendingIfAttempt` instead.
 *
 * Resolves TRUE ONLY WHEN THE DEVICE ACCEPTED THE WRITE. That answer is what
 * entitles the screen to say "the same attempt will be here when you come
 * back"; see `openAttempt`, which waits for it before the request fires.
 */
export function savePendingNew(p: PendingContribution, uid: string): Promise<boolean> {
  if (!isGoalIdShape(p.goalId)) return Promise.resolve(false);
  return onSlot(
    pendingKey(p.goalId, uid),
    async () => (await writeNewUnqueued(p, uid)).durable,
    () => false
  );
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
  if (!isGoalIdShape(p.goalId)) return Promise.resolve(false);
  return onSlot(
    pendingKey(p.goalId, uid),
    async () => {
      const current = await readSlotUnqueued(p.goalId, uid);
      // No readable record: the attempt this callback belongs to is finished,
      // was superseded, or cannot be seen. Nothing to update, nothing to
      // resurrect.
      if (!current.ok || !current.value) return false;
      if (current.value.attemptId !== attemptId) return false;
      if (p.attemptId !== attemptId) return false;
      return deviceKv.setItem(pendingKey(p.goalId, uid), JSON.stringify(p));
    },
    () => false
  );
}

/**
 * Clear ONLY if the stored record is still this attempt. An old success must
 * not clear a newer one, and a slot that could not be read is not cleared.
 */
export function clearPendingIfAttempt(goalId: string, uid: string, attemptId: string): Promise<boolean> {
  if (!isGoalIdShape(goalId)) return Promise.resolve(false);
  return onSlot(pendingKey(goalId, uid), () => clearIfAttemptUnqueued(goalId, uid, attemptId), () => false);
}

export function clearPending(goalId: string, uid: string): Promise<boolean> {
  if (!isGoalIdShape(goalId)) return Promise.resolve(false);
  return onSlot(pendingKey(goalId, uid), () => deviceKv.removeItem(pendingKey(goalId, uid)), () => false);
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
 * is persisted so a second reload shows the same screen.
 *
 * A legacy unscoped record is retired, never adopted (see
 * `retireLegacyPending`), and returned separately so the screen can hold its
 * camera and new-attempt entry closed. It is never copied into this
 * account's slot.
 *
 * `readFailed` — the slot could not be read (or the read did not answer in
 * time). The screen settles with nothing restored; a record it could not see
 * is protected by `savePendingNew`, which will not overwrite an unreadable
 * slot.
 *
 * NEVER REJECTS. The screen holds Record and the camera closed until this
 * answers, so a rejection would hold them closed for good.
 */
export type RestoredAttempt = {
  pending: PendingContribution | null;
  orphan: PendingContribution | null;
  readFailed?: boolean;
};

type RestoreRead = { ok: true; pending: PendingContribution | null } | { ok: false };

export async function restorePendingAttempt(goalId: string, uid: string | null): Promise<RestoredAttempt> {
  if (!isGoalIdShape(goalId)) return { pending: null, orphan: null };
  try {
    const orphan = await retireLegacyPending(goalId);
    if (!uid) return { pending: null, orphan };
    const key = pendingKey(goalId, uid);
    // ONE queued operation: the read, the escalation and the check of its
    // result. Nothing in this process can clear or replace the record between
    // them.
    const read = await onSlot(
      key,
      async (): Promise<RestoreRead> => {
        const slot = await readSlotUnqueued(goalId, uid);
        if (!slot.ok) return { ok: false };
        const existing = slot.value;
        if (!existing) return { ok: true, pending: null };
        const escalated: PendingContribution = { ...existing, state: 'unknown' };
        if (existing.state === 'unknown') return { ok: true, pending: escalated };
        if (await deviceKv.setItem(key, JSON.stringify(escalated))) return { ok: true, pending: escalated };
        // The escalation was refused. What is on the device now decides,
        // not what was read a moment ago: the same attempt still there (as
        // `sending`, which restores the same way next time) is this member's
        // reminder; an emptied slot restores nothing; a different attempt
        // restores as itself.
        const after = await readSlotUnqueued(goalId, uid);
        if (!after.ok) return { ok: true, pending: escalated };
        if (after.value?.attemptId === existing.attemptId) return { ok: true, pending: escalated };
        return { ok: true, pending: after.value ? { ...after.value, state: 'unknown' } : null };
      },
      (): RestoreRead => ({ ok: false })
    );
    if (!read.ok) return { pending: null, orphan, readFailed: true };
    return { pending: read.pending, orphan };
  } catch {
    return { pending: null, orphan: null, readFailed: true };
  }
}

/**
 * Whether the screen may begin a NEW attempt (Record, or the camera that
 * leads to one).
 *
 * Not until this account's stored attempt has been read: the store answers
 * asynchronously now, and a new attempt started before it answered would
 * overwrite a reminder the member has not reconciled — and could book the
 * same effort twice under two attempt ids. And never while an attempt is
 * pending, or a refusal or receipt is on screen, or while the restore could
 * not read the slot at all. (The camera additionally stays closed while a
 * legacy record is present; that rule is the screen's.)
 */
export function mayBeginNewAttempt(s: {
  restoreSettled: boolean;
  /**
   * The restore could not read this account's slot (an error, or no answer
   * within the storage bound). FAIL CLOSED: the slot may hold an unresolved
   * attempt nobody has seen, so nothing new begins until a retry reads it.
   */
  restoreFailed: boolean;
  pending: PendingContribution | null;
  settled: boolean;
}): boolean {
  return s.restoreSettled && !s.restoreFailed && !s.pending && !s.settled;
}

/**
 * Whether a request may go out NOW as `owner`.
 *
 * The callable authenticates as whoever is signed in WHEN IT IS CALLED, and
 * the server keys idempotency on that uid. The screen's own record of the
 * account follows auth a render later, so it is not enough: a request for
 * A's attempt sent while B is already the live auth user books a NEW
 * contribution credited to B. Three things must all hold:
 *   - the request's context (generation, account, goal) is still the
 *     screen's;
 *   - the live auth user is the owner;
 *   - the owner is the account the context was started for.
 */
export function mayFireAs(
  owner: string | null | undefined,
  started: RequestContext,
  current: RequestContext,
  liveUid: string | null | undefined
): boolean {
  // An owner is somebody: "nobody signed in, still nobody" is not a match.
  if (typeof owner !== 'string' || owner === '') return false;
  return isSameContext(started, current) && started.uid === owner && liveUid === owner;
}

/**
 * Step one of a NEW attempt: write its record, and wait for the device's
 * answer BEFORE the request is allowed to fire.
 *
 *   - `durable: true` — the record is on the device. If the process dies from
 *     here on, the next launch restores this attemptId as reconcilable.
 *   - `durable: false` — the device refused it (or could not be read, or did
 *     not answer in time). The request still fires (the member is never
 *     blocked from recording, which the web flow never did), but the screen
 *     must not claim the attempt will survive leaving it.
 *
 * `mayFire` is asked AFTER the write, because the write is asynchronous now:
 * if the account, goal or screen changed meanwhile, the request is not sent
 * at all and the record this call just wrote is retired — in the SAME queued
 * operation as the write, so a restore cannot read it in between and offer
 * an attempt that was never sent.
 *
 * CREATE-ONLY: a slot that already holds a different attempt is a
 * `conflict`, not a slot to overwrite (`writeNewUnqueued`).
 *
 * If the device does not answer within the storage bound, the request still
 * fires (not durable). Should the read then answer with a different attempt,
 * the late write is refused as a conflict, so that attempt is not replaced.
 */
export type OpenedAttempt = {
  fire: boolean;
  durable: boolean;
  /**
   * The slot already held a DIFFERENT attempt this screen had not shown (the
   * restore failed or timed out, another tab wrote it, ...). Nothing was
   * written and nothing may be sent: the screen shows this attempt as the
   * unresolved one instead.
   */
  conflict?: PendingContribution;
};

export function openAttempt(
  row: PendingContribution,
  uid: string,
  mayFire: () => boolean
): Promise<OpenedAttempt> {
  if (!isGoalIdShape(row.goalId)) return Promise.resolve({ fire: mayFire(), durable: false });
  // Set when the time bound answered for this call. A write that completes
  // after that must not then act on its own: the caller already has its
  // answer, and the request may already be out.
  let answeredLate = false;
  return onSlot(
    pendingKey(row.goalId, uid),
    async (): Promise<OpenedAttempt> => {
      const write = await writeNewUnqueued(row, uid);
      if (write.conflict) return { fire: false, durable: false, conflict: write.conflict };
      const durable = write.durable;
      if (answeredLate) return { fire: false, durable };
      if (mayFire()) return { fire: true, durable };
      if (durable) await clearIfAttemptUnqueued(row.goalId, uid, row.attemptId);
      return { fire: false, durable };
    },
    () => {
      // The device did not answer in time. Not durable, whatever happens to
      // the write later; and if the request may no longer go, retire the
      // record should the write land after all.
      answeredLate = true;
      const fire = mayFire();
      if (!fire) void clearPendingIfAttempt(row.goalId, uid, row.attemptId);
      return { fire, durable: false };
    }
  );
}

export type AttemptIo<T> = {
  /**
   * The request. Called at most once, with the attempt id and count of the
   * row being settled — the caller does not choose them, so a replay always
   * sends the restored attempt's own identity.
   */
  send: (attemptId: string, count: number) => Promise<T>;
  /** The server ran the request and refused it: nothing was or will be recorded. */
  isRefusal: (error: unknown) => boolean;
  /** Whether the request still belongs to what the screen is showing. */
  stillCurrent: () => boolean;
  /**
   * Whether the request may go out now as the row's owner (`mayFireAs`).
   * Asked synchronously IMMEDIATELY before `send`, with nothing awaited in
   * between.
   */
  mayFire: () => boolean;
};

export type AttemptSettlement<T> =
  | { kind: 'notSent' }
  | { kind: 'confirmed'; data: T; current: boolean }
  | { kind: 'refused'; error: unknown }
  | { kind: 'unknown'; error: unknown };

async function settle<T>(
  row: PendingContribution,
  uid: string,
  io: AttemptIo<T>,
  replay: boolean
): Promise<AttemptSettlement<T>> {
  // THE GATE IS ADJACENT TO THE SEND. Nothing is awaited between this check
  // and `io.send`, so the account the check saw is the account the request
  // goes out as (as far as this process can know).
  if (!io.mayFire()) {
    // A new attempt that never left: its record is retired (only if the slot
    // is still this attempt). A replay's record is the member's reminder of
    // an attempt that may have landed, and stays exactly as it is.
    if (!replay) await clearPendingIfAttempt(row.goalId, uid, row.attemptId);
    return { kind: 'notSent' };
  }
  // A replay's record flips to `sending` while it is in flight, queued on
  // the slot ahead of whatever the settlement writes, and conditional like
  // every other late write: it can neither recreate a cleared record nor
  // overwrite a newer attempt's.
  if (replay) void updatePendingIfAttempt({ ...row, state: 'sending' }, uid, row.attemptId);
  try {
    const data = await io.send(row.attemptId, row.count);
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
 * Step two: send once and settle the record by what came back.
 *
 *   - NOT SENT — `mayFire` said no at the moment of sending. Nothing left the
 *     device; the new attempt's record is retired.
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
export function settleAttempt<T>(
  row: PendingContribution,
  uid: string,
  io: AttemptIo<T>
): Promise<AttemptSettlement<T>> {
  return settle(row, uid, io, false);
}

/**
 * Replay the SAME attempt (a restored or unresolved one). The record already
 * exists, so nothing waits on storage before the request. Settles as
 * `settleAttempt` does, except that a replay that is not sent leaves its
 * record untouched. What counts as a refusal of a REPLAY is the caller's
 * `isRefusal` (src/contributionFlow.ts `isDefiniteRefusal`, 'replay').
 */
export function replayAttempt<T>(
  row: PendingContribution,
  uid: string,
  io: AttemptIo<T>
): Promise<AttemptSettlement<T>> {
  return settle(row, uid, io, true);
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
