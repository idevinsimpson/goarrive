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
 *     account's session ends. An owned record is stored as JSON with its
 *     owner; a signed-out one is the bare value it always was.
 *
 * WHAT IS IN THEM. A goal id — the value that was already in the URL — and an
 * activity label, the event's own published word for what it counts. Nothing
 * about the person, no station secret, no pairing id, no authority.
 */
import { readActivityLabel } from './eventActivity';
import { definePostAuthDestination, postAuthDestinationsReady } from './postAuthDestination';

/** The event a scanned `/join/<code>?event=<goalId>` came from. */
export const PENDING_EVENT_KEY = 'wsf.pendingEventGoalId';
/** The activity that event was running, beside it, by the same mechanism. */
export const PENDING_EVENT_ACTIVITY_KEY = 'wsf.pendingEventActivity';

/** Goal ids as everywhere else here: nothing that could become a path of its own. */
function isIdShape(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function parseOwned(raw: string, field: 'goalId' | 'activity'): { value: string; owner: string } | null {
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const value = v[field];
    const owner = v.owner;
    if (typeof value !== 'string' || typeof owner !== 'string' || !owner) return null;
    return { value, owner };
  } catch {
    return null;
  }
}

const pendingEvent = definePostAuthDestination<string>({
  key: PENDING_EVENT_KEY,
  decode(raw) {
    if (isIdShape(raw)) return { value: raw, owner: null };
    const owned = parseOwned(raw, 'goalId');
    return owned && isIdShape(owned.value) ? owned : null;
  },
  encode(goalId, owner) {
    return owner ? JSON.stringify({ goalId, owner }) : goalId;
  },
});

const pendingActivity = definePostAuthDestination<string>({
  key: PENDING_EVENT_ACTIVITY_KEY,
  decode(raw) {
    // An owned record first: an activity label is free text, so a bare label
    // that happens to parse as {"activity","owner"} is read as owned — which
    // only ever hides it, never shows it to somebody else.
    const owned = parseOwned(raw, 'activity');
    if (owned) {
      const label = readActivityLabel(owned.value);
      return label ? { value: label, owner: owned.owner } : null;
    }
    // Re-checked on the way out as well as in: a hand-edited entry must not
    // become something this app will render or route with.
    const label = readActivityLabel(raw);
    return label ? { value: label, owner: null } : null;
  },
  encode(label, owner) {
    return owner ? JSON.stringify({ activity: label, owner }) : label;
  },
});

/**
 * Remember which event's QR a visitor followed, so the join can finish there.
 * `ownerUid` is the account signed in at this moment, or null. A value of the
 * wrong shape is not stored: the visitor then lands on their new community
 * instead of the event screen, which is a worse arrival, not a broken or
 * leaky one.
 */
export function setPendingEventGoal(goalId: string, ownerUid: string | null = null): Promise<boolean> {
  if (!isIdShape(goalId)) return Promise.resolve(false);
  return pendingEvent.write(goalId, ownerUid);
}

/** The event for `uid` (null: a signed-out reader), or null if it is somebody else's. */
export function readPendingEventGoal(uid: string | null = null): string | null {
  return pendingEvent.read(uid);
}

export function clearPendingEventGoal(): Promise<boolean> {
  return pendingEvent.clear();
}

/**
 * Remember which ACTIVITY that event was running. Shape-checked by
 * `readActivityLabel`, which refuses control characters and anything past the
 * cap outright; a value that does not survive that check is simply not stored
 * and the journey finishes without an activity — less context, never a
 * guessed one.
 */
export function setPendingEventActivity(activity: string, ownerUid: string | null = null): Promise<boolean> {
  const label = readActivityLabel(activity);
  if (!label) return Promise.resolve(false);
  return pendingActivity.write(label, ownerUid);
}

export function readPendingEventActivity(uid: string | null = null): string | null {
  return pendingActivity.read(uid);
}

export function clearPendingEventActivity(): Promise<boolean> {
  return pendingActivity.clear();
}

export type JoinEventContext = { goalId: string | null; activity: string | null };

/**
 * THE END OF THE CARRYING — called once, by the join route, after a join has
 * succeeded.
 *
 * Waits for the native launch read (immediate on web), reads the event and its
 * activity for the account that just joined, and clears BOTH in the same
 * breath whatever they held, so the context is consumed exactly once: a second
 * call, a later join or another account finds nothing. An activity without an
 * event names nothing and is dropped. A context that belongs to another
 * account is not applied, and is cleared with the rest.
 */
export async function takeJoinEventContext(uid: string | null): Promise<JoinEventContext> {
  await postAuthDestinationsReady();
  const goalId = readPendingEventGoal(uid);
  const activity = goalId ? readPendingEventActivity(uid) : null;
  await Promise.all([clearPendingEventGoal(), clearPendingEventActivity()]);
  return { goalId, activity };
}
