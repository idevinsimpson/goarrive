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
 * LIFETIME. sessionStorage, like its two siblings: it survives the auth hops
 * and a same-tab reload, and dies with the tab so a stale event cannot greet
 * the next visitor on a shared phone. On top of that the record carries the
 * time it was written and is refused once it is older than MAX_AGE_MS — a
 * phone left in a pocket between two events must not send its owner back to
 * the morning's one.
 */

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

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage ?? null;
  } catch {
    // Private browsing, a locked-down UA, or storage disabled. Losing the
    // return is a worse walk-back, not a broken or leaky one: the visitor
    // lands on home exactly as they did before this existed.
    return null;
  }
}

/** `/event/<goalId>` — the scanned address, rebuilt rather than remembered. */
export function eventRoute(goalId: string): string {
  return `/event/${encodeURIComponent(goalId)}`;
}

type StoredReturn = { goalId: string; at: number };

export function setEventReturn(goalId: string, now: number = Date.now()): void {
  try {
    const store = storage();
    if (!store) return;
    if (!isGoalIdShape(goalId)) return;
    if (!Number.isFinite(now)) return;
    const record: StoredReturn = { goalId, at: now };
    store.setItem(EVENT_RETURN_KEY, JSON.stringify(record));
  } catch {
    // ignore — see storage()
  }
}

/**
 * The goal to return to, or null. Anything malformed, from another origin's
 * leftovers, or older than MAX_AGE_MS reads as null: a return this function
 * cannot vouch for is not a return.
 */
export function readEventReturn(now: number = Date.now()): string | null {
  try {
    const store = storage();
    if (!store) return null;
    const raw = store.getItem(EVENT_RETURN_KEY);
    if (raw == null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Partial<StoredReturn>;
    if (!isGoalIdShape(record.goalId)) return null;
    if (typeof record.at !== 'number' || !Number.isFinite(record.at)) return null;
    // A record stamped in the future is as untrustworthy as an expired one.
    if (record.at > now) return null;
    if (now - record.at > EVENT_RETURN_MAX_AGE_MS) return null;
    return record.goalId;
  } catch {
    return null;
  }
}

/**
 * Forget the handoff.
 *
 * Called when the visitor is standing on the event again as a member — the
 * return has done its job and must not fire a second time on some later,
 * unrelated sign-in — and at the cancel boundary, so somebody who said "not
 * now" is not carried back to an event they walked away from.
 */
export function clearEventReturn(): void {
  try {
    storage()?.removeItem(EVENT_RETURN_KEY);
  } catch {
    // ignore
  }
}
