/**
 * THE EVENT A NEWCOMER ARRIVED FROM — the member side of a join QR.
 *
 * A screen at an event shows `/join/<code>?event=<goalId>&activity=<label>`.
 * Somebody who scans it signed out goes through sign-up, verification and
 * profile setup — routes that each replace the page and drop the query string
 * — before the join happens. These two records carry the event and the
 * activity across that round trip so the finished join lands at the event the
 * person walked up to, with what the room was doing, rather than at a page
 * that has forgotten both.
 *
 * SPLIT OUT OF src/stationSession.ts (NATIVE-STATE-3). They lived beside the
 * station credential, but they are not the station's: they belong to a member
 * journey, are written and read only by the join route, and never shared a key
 * with the station device's own session, secret or pairing. Moving them here
 * changed nothing about the station path; stationSession.ts re-exports these
 * accessors so its existing callers are untouched.
 *
 * KEPT LIKE EVERY OTHER POST-AUTH DESTINATION (src/postAuthDestination.ts):
 *   - WEB: sessionStorage under the same two keys, read synchronously, the
 *     bare value exactly as before. A closed tab must not carry an event into
 *     the next thing this browser does.
 *   - iOS / ANDROID: AsyncStorage with a two-hour expiry, read at launch, so a
 *     scan survives the app being killed mid-sign-up (the member is in their
 *     mail app verifying their address) and still ends at the event.
 *   - WHOSE: stashed signed out, the context is the handoff for whoever signs
 *     in next; stashed while an account is signed in, it is that account's
 *     alone, never applied to another account's join, and cleared when that
 *     account's session ends.
 *
 * BOUND TO THE JOIN CODE IT ARRIVED WITH. Each record stores the code of the
 * join link it came on, and the finished join applies the context ONLY when
 * the join it completed was for that same code. Without this, somebody who
 * scanned an event's join QR, walked away, and later joined a different
 * community (in the same tab, or within the two hours on a phone) landed on
 * the abandoned event instead of their new community. A record that names a
 * different code — or none, as every record written before this rule did —
 * is discarded at the join and never routes anywhere.
 *
 * FORMAT: `{"goalId":…,"joinCode":…}` and `{"activity":…,"joinCode":…}`,
 * plus `"owner":…` when an account stashed it. (These were the bare goal id
 * and the bare label before; a bare value left over from then reads as
 * code-less, and is discarded.)
 *
 * WHAT IS IN THEM. A goal id — the value that was already in the URL — and an
 * activity label, the event's own published word for what it counts. Nothing
 * about the person, no station secret, no pairing id, no authority.
 */
import { readActivityLabel } from './eventActivity';
import { isJoinCodeShape } from './pendingJoinCode';
import { definePostAuthDestination, postAuthDestinationsReady } from './postAuthDestination';

/** The event a scanned `/join/<code>?event=<goalId>` came from. */
export const PENDING_EVENT_KEY = 'wsf.pendingEventGoalId';
/** The activity that event was running, beside it, by the same mechanism. */
export const PENDING_EVENT_ACTIVITY_KEY = 'wsf.pendingEventActivity';

/** Goal ids as everywhere else here: nothing that could become a path of its own. */
function isIdShape(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

/** A stored value and the join code it arrived with (null: a record from before codes were kept). */
type Bound = { value: string; joinCode: string | null };

/**
 * Decode `{"<field>":…,"joinCode":…[,"owner":…]}`. Anything else — including
 * a bare value from before the code was kept — decodes as code-less, so it is
 * still found (and cleared) but never applied.
 */
function decodeBound(
  raw: string,
  field: 'goalId' | 'activity',
  bare: (raw: string) => string | null,
  valid: (value: string) => string | null
) {
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v[field] === 'string') {
      const value = valid(v[field] as string);
      if (!value) return null;
      const joinCode = typeof v.joinCode === 'string' && isJoinCodeShape(v.joinCode) ? v.joinCode : null;
      const owner = v.owner === undefined ? null : typeof v.owner === 'string' && v.owner ? v.owner : undefined;
      if (owner === undefined) return null;
      return { value: { value, joinCode } as Bound, owner };
    }
  } catch {
    // not JSON: a bare value from before, below
  }
  const value = bare(raw);
  return value ? { value: { value, joinCode: null } as Bound, owner: null } : null;
}

function encodeBound(field: 'goalId' | 'activity', bound: Bound, owner: string | null): string {
  return JSON.stringify({ [field]: bound.value, joinCode: bound.joinCode, ...(owner ? { owner } : {}) });
}

const idOrNull = (v: string) => (isIdShape(v) ? v : null);

const pendingEvent = definePostAuthDestination<Bound>({
  key: PENDING_EVENT_KEY,
  decode: (raw) => decodeBound(raw, 'goalId', idOrNull, idOrNull),
  encode: (bound, owner) => encodeBound('goalId', bound, owner),
});

const pendingActivity = definePostAuthDestination<Bound>({
  key: PENDING_EVENT_ACTIVITY_KEY,
  // Re-checked on the way out as well as in: a hand-edited entry must not
  // become something this app will render or route with.
  decode: (raw) => decodeBound(raw, 'activity', readActivityLabel, readActivityLabel),
  encode: (bound, owner) => encodeBound('activity', bound, owner),
});

/**
 * Remember which event's QR a visitor followed, and the join code it came
 * with, so the join of THAT code can finish there. `ownerUid` is the account
 * signed in at this moment, or null. A value of the wrong shape is not
 * stored: the visitor then lands on their new community instead of the event
 * screen, which is a worse arrival, not a broken or leaky one.
 */
export function setPendingEventGoal(
  goalId: string,
  joinCode: string,
  ownerUid: string | null = null
): Promise<boolean> {
  if (!isIdShape(goalId) || !isJoinCodeShape(joinCode)) return Promise.resolve(false);
  return pendingEvent.write({ value: goalId, joinCode }, ownerUid);
}

/**
 * The event for `uid` (null: a signed-out reader) that arrived with
 * `joinCode`, or null — somebody else's, another code's, or a code-less
 * leftover.
 */
export function readPendingEventGoal(uid: string | null, joinCode: string): string | null {
  const bound = pendingEvent.read(uid);
  return bound && bound.joinCode !== null && bound.joinCode === joinCode ? bound.value : null;
}

export function clearPendingEventGoal(): Promise<boolean> {
  return pendingEvent.clear();
}

/**
 * Remember which ACTIVITY that event was running, bound to the same join
 * code. Shape-checked by `readActivityLabel`, which refuses control
 * characters and anything past the cap outright; a value that does not
 * survive that check is simply not stored and the journey finishes without an
 * activity — less context, never a guessed one.
 */
export function setPendingEventActivity(
  activity: string,
  joinCode: string,
  ownerUid: string | null = null
): Promise<boolean> {
  const label = readActivityLabel(activity);
  if (!label || !isJoinCodeShape(joinCode)) return Promise.resolve(false);
  return pendingActivity.write({ value: label, joinCode }, ownerUid);
}

export function readPendingEventActivity(uid: string | null, joinCode: string): string | null {
  const bound = pendingActivity.read(uid);
  return bound && bound.joinCode !== null && bound.joinCode === joinCode ? bound.value : null;
}

export function clearPendingEventActivity(): Promise<boolean> {
  return pendingActivity.clear();
}

export type JoinEventContext = { goalId: string | null; activity: string | null };

/**
 * THE END OF THE CARRYING — called once, by the join route, after the join of
 * `joinCode` has succeeded.
 *
 * Waits for the native launch read (immediate on web), reads the event and its
 * activity for the account that just joined AND for the code it just joined
 * with, and clears BOTH in the same breath whatever they held, so the context
 * is consumed exactly once: a second call, a later join or another account
 * finds nothing. A context from another join code, a code-less leftover, one
 * that belongs to another account, or an activity without an event, is not
 * applied — it is discarded with the rest and never routes.
 */
export async function takeJoinEventContext(uid: string | null, joinCode: string): Promise<JoinEventContext> {
  await postAuthDestinationsReady();
  const goalId = readPendingEventGoal(uid, joinCode);
  const activity = goalId ? readPendingEventActivity(uid, joinCode) : null;
  await Promise.all([clearPendingEventGoal(), clearPendingEventActivity()]);
  return { goalId, activity };
}
