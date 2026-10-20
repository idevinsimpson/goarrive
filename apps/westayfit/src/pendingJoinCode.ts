/**
 * Pending join code — the post-auth handoff for the QR-scan flow.
 *
 * The moment that matters: a signed-out visitor scans a QR, lands on
 * /join/<code>, and taps "Sign up to join". The signup flow that follows
 * (signup -> verify email -> profile setup) navigates through four routes
 * before it can return to the join page. Passing the code through the URL on
 * every one of those hops is fragile and easy to drop; a page reload during
 * verify would lose it either way.
 *
 * LIFETIME AND OWNERSHIP are the family's (src/postAuthDestination.ts):
 * sessionStorage on web exactly as before; AsyncStorage with a two-hour
 * expiry on a phone, read at launch and waited for by the terminal hop; a code
 * stashed while an account is signed in is that account's alone and goes when
 * its session ends; a code stashed signed out is the handoff for whoever signs
 * in next.
 *
 * FORMAT. An anonymous code is stored as the bare code string, as it always
 * was (the browser tests seed and read exactly that). An owned code is stored
 * as `{"code":…,"owner":…}`, which the old reader's shape check rejects, so
 * it can never be read as anonymous.
 */

import { eventRoute, readEventReturn } from './eventReturn';
import { kioskContributeRoute, readKioskReturnGoal } from './kioskSession';
import { markerRoute, readMarkerReturn } from './markerEntry';
import {
  definePostAuthDestination,
  dropForeignDestinations,
  postAuthDestinationsReady,
} from './postAuthDestination';

/**
 * Whether a value looks like a plausible join code — matches the server's
 * normalizer so we do not stash garbage that the callables will reject.
 */
function isValidShape(code: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(code);
}

const joinCode = definePostAuthDestination<string>({
  key: 'wsf.pendingJoinCode',
  decode(raw) {
    if (isValidShape(raw)) return { value: raw, owner: null };
    try {
      const v = JSON.parse(raw) as { code?: unknown; owner?: unknown } | null;
      if (v && typeof v.code === 'string' && isValidShape(v.code) && typeof v.owner === 'string' && v.owner) {
        return { value: v.code, owner: v.owner };
      }
    } catch {
      // fall through
    }
    return null;
  },
  encode(code, owner) {
    return owner ? JSON.stringify({ code, owner }) : code;
  },
});

/**
 * Stash the code. `ownerUid` is the account signed in at this moment, or null
 * for a signed-out visitor. Resolves whether the device accepted it; losing
 * the handoff is annoying but not catastrophic — the /join route still works,
 * the member just has to re-scan.
 */
export function setPendingJoinCode(code: string, ownerUid: string | null = null): Promise<boolean> {
  if (!isValidShape(code)) return Promise.resolve(false);
  return joinCode.write(code, ownerUid);
}

/**
 * The code waiting for `uid` (null: a signed-out reader), or null. A code
 * stashed under another account is never returned.
 */
export function readPendingJoinCode(uid: string | null = null): string | null {
  return joinCode.read(uid);
}

export function clearPendingJoinCode(): Promise<boolean> {
  return joinCode.clear();
}

/**
 * Where a caller should route on the terminal auth hop. If a pending join code
 * is in play it wins — that is the whole point of the round-trip. Otherwise
 * falls back to the caller's default (which for every current caller is `/`).
 *
 * Only invoke on the terminal hop — after the member is verified AND has a
 * profile. Interim gates (verify-email, profile-setup) MUST route directly to
 * the next gate; otherwise `wsfJoinCommunity` fires before the profile exists
 * and the visitor dead-ends. The pending code survives the gate hops (session
 * storage on web, the bounded native store on a phone) and is consumed here
 * on the last step. `uid` is the account completing the hop: no destination
 * stashed under a different account claims it.
 *
 * Synchronous, for callers that already know the store has been read; the
 * terminal hops use `routeAfterAuth`, which waits for it.
 *
 * FOUR DESTINATIONS CAN CLAIM THIS HOP, in this order:
 *
 *   1. A PENDING JOIN CODE. A visitor mid-way through joining a community has
 *      to finish that before anything else.
 *   2. AN EVENT RETURN. Somebody scanned the QR at an event, was told they
 *      needed an account, and signed in. Before this existed they landed on
 *      home and the event they were standing in front of was simply gone —
 *      they had to find the QR and scan it again. The route is CONSTRUCTED
 *      from a validated goal id (src/eventReturn.ts); nothing stores a URL, so
 *      there is no return target for anything to tamper with.
 *   3. A KIOSK RETURN, which sends the visitor back to the contribution screen
 *      on the device they walked up to (src/kioskSession.ts).
 *   4. A MARKER RETURN (EVERGREEN-MARKER-ENTRY-1): somebody scanned a printed
 *      `/go/<slug>` code and went to sign in. The route is rebuilt from a
 *      validated slug (src/markerEntry.ts). It is last so it never changes
 *      where the three older destinations land; the marker screen clears the
 *      older returns when it arms its own, so in practice it stands alone.
 *
 * An event return and a kiosk return should not coexist: the event screen asks
 * whose screen this is FIRST, and a device that answers "shared" is handed to
 * the kiosk and never offered a personal sign-in. The order is written down
 * anyway, because "should not happen" is not a rule.
 */
export function nextRouteAfterAuth(fallback: string, uid: string | null = null): string {
  const pending = readPendingJoinCode(uid);
  if (pending) return `/join/${pending}`;
  const eventGoalId = readEventReturn(Date.now(), uid);
  if (eventGoalId) return eventRoute(eventGoalId);
  const kioskGoalId = readKioskReturnGoal(uid);
  if (kioskGoalId) return kioskContributeRoute(kioskGoalId);
  const markerSlug = readMarkerReturn(Date.now(), uid);
  if (markerSlug) return markerRoute(markerSlug);
  return fallback;
}

/**
 * `nextRouteAfterAuth`, after the stored destinations have been read — the
 * form every terminal auth hop uses. Immediate on web. On a phone it waits for
 * the launch-time read, so a hop taken moments after a cold start cannot route
 * past a destination that is still being loaded.
 *
 * Every destination that belongs to a DIFFERENT account is dropped here, at
 * the first terminal hop somebody else completes: it was never going to be
 * theirs, and it must not wait on the device for its owner's return either.
 */
export async function routeAfterAuth(fallback: string, uid: string | null): Promise<string> {
  await postAuthDestinationsReady();
  await dropForeignDestinations(uid);
  return nextRouteAfterAuth(fallback, uid);
}
