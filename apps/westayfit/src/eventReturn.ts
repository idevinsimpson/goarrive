/**
 * Event return — bringing a scanned event back after the auth round trip.
 *
 * THE DEFECT THIS EXISTS FOR. A visitor scans the QR at an event, lands on
 * `/event/<goalId>`, is told they need an account, and signs in. Sign-in ends
 * with `router.replace(nextRouteAfterAuth('/'))`, and until now that carried a
 * pending join code or a kiosk return goal and nothing else — so the phone
 * landed on the app's home and the event they were standing in front of was
 * simply gone. They had to find the QR and scan it again.
 *
 * `pendingJoinCode` already solves exactly this shape for `/join/<code>`, and
 * `kioskSession` for the walk-up contribution screen. This is the third
 * member of that family and is deliberately built the same way rather than
 * inventing a new mechanism.
 *
 * WHAT IS STORED, AND WHAT IS NOT.
 *   - A GOAL ID, never a route. The destination is CONSTRUCTED here from a
 *     validated id, so a tampered value cannot become an open redirect, a path
 *     traversal or a query of its own. There is no "return to this URL"
 *     parameter anywhere in this flow, by design.
 *   - No token, no station id, no pairing code, no membership claim. Nothing
 *     stored here grants anything: it names where the visitor was, and the
 *     server decides everything else when they get back.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: carry a chosen ACTIVITY.
 * An earlier version of this module did, and it was wrong twice over. A
 * signed-out visitor cannot choose an activity — the control exists only
 * after auth — so the value was written on an ordinary member tap and had
 * nothing to do with an auth handoff; and the scanned journey that really
 * does carry both halves already exists, through
 * `/join/<code>?event=…&activity=…`, `src/stationSession.ts` and its browser
 * proof `tests-e2e/ui-event-activity-choice.spec.ts`. Selecting the activity
 * stays an explicit decision, made once the visitor is back on the event.
 *
 * LIFETIME. sessionStorage on web, like its siblings: it survives the auth
 * hops and a same-tab reload, and dies with the tab so a stale event cannot
 * greet the next visitor on a shared phone. On top of that the record carries
 * the time it was written and is refused once it is older than MAX_AGE_MS — a
 * phone left in a pocket between two events must not send its owner back to
 * the morning's one. On iOS and Android, where there is no tab, it persists
 * through AsyncStorage under the same two-hour bound, so it survives the app
 * being killed mid-sign-up (src/postAuthDestination.ts).
 *
 * WHOSE IT IS (src/postAuthDestination.ts). Stashed signed out — which is how
 * the event screen stashes it, on the way into sign-in or sign-up — it is the
 * handoff for whoever signs in next. Stashed while an account is signed in, it
 * is that account's alone: never routed to or announced to anybody else, and
 * gone when that account's session ends on the device. The record gains an
 * `owner` field only in that case; a signed-out record is byte-for-byte what
 * it always was.
 */

import { definePostAuthDestination } from './postAuthDestination';

/** The goal whose event screen sent the visitor into the auth flow. */
const EVENT_RETURN_KEY = 'wsf.eventReturn';

/**
 * Two hours. Long enough for a slow signup with a verification mail in the
 * middle, short enough that it is still the same visit to the same event.
 */
export const EVENT_RETURN_MAX_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * The same shape `kioskSession` accepts, and for the same reason: refuse
 * anything that could turn a stored value into a path traversal or a query.
 * Deliberately a copy rather than a shared import — the kiosk module's copy is
 * approved as it stands, and tests/event-return.test.ts pins this one.
 */
function isGoalIdShape(goalId: unknown): goalId is string {
  return typeof goalId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(goalId);
}


/** `/event/<goalId>` — the scanned address, rebuilt rather than remembered. */
export function eventRoute(goalId: string): string {
  return `/event/${encodeURIComponent(goalId)}`;
}

type StoredReturn = { goalId: string; at: number };

/*
  Private browsing, a locked-down UA, or storage disabled: losing the return
  is a worse walk-back, not a broken or leaky one — the visitor lands on home
  exactly as they did before this existed. The store reports such a write as
  not kept, and a read as nothing.
*/
const eventReturn = definePostAuthDestination<StoredReturn>({
  key: EVENT_RETURN_KEY,
  decode(raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const record = parsed as Partial<StoredReturn> & { owner?: unknown };
      if (!isGoalIdShape(record.goalId)) return null;
      if (typeof record.at !== 'number' || !Number.isFinite(record.at)) return null;
      if (record.owner !== undefined && (typeof record.owner !== 'string' || !record.owner)) return null;
      return { value: { goalId: record.goalId, at: record.at }, owner: record.owner ?? null };
    } catch {
      return null;
    }
  },
  encode(value, owner) {
    return JSON.stringify(owner ? { ...value, owner } : value);
  },
});

/**
 * Remember the event. `ownerUid` is the account signed in at this moment, or
 * null for a signed-out visitor (and for "use a different account", which
 * hands the event to whoever signs in next ON PURPOSE).
 */
export function setEventReturn(
  goalId: string,
  now: number = Date.now(),
  ownerUid: string | null = null
): Promise<boolean> {
  if (!isGoalIdShape(goalId)) return Promise.resolve(false);
  if (!Number.isFinite(now)) return Promise.resolve(false);
  return eventReturn.write({ goalId, at: now }, ownerUid);
}

/**
 * The goal to return to, or null. Anything malformed, from another origin's
 * leftovers, older than MAX_AGE_MS, or stashed under an account other than
 * `uid` (null: a signed-out reader) reads as null: a return this function
 * cannot vouch for is not a return.
 */
export function readEventReturn(now: number = Date.now(), uid: string | null = null): string | null {
  const record = eventReturn.read(uid);
  if (!record) return null;
  // A record stamped in the future is as untrustworthy as an expired one.
  if (record.at > now) return null;
  if (now - record.at > EVENT_RETURN_MAX_AGE_MS) return null;
  return record.goalId;
}

/**
 * Forget the handoff.
 *
 * Called when the visitor is standing on the event again as a member — the
 * return has done its job and must not fire a second time on some later,
 * unrelated sign-in — and at the cancel boundary, so somebody who said "not
 * now" is not carried back to an event they walked away from.
 */
export function clearEventReturn(): Promise<boolean> {
  return eventReturn.clear();
}
