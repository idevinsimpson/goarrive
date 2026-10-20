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
 * LIFETIME, PER PLATFORM (src/storage/sessionKv.ts):
 *   - WEB: sessionStorage, exactly as before. It survives client-side
 *     navigation and a same-tab reload, and clears on tab close so a stale
 *     code cannot linger for the next visitor. Reads stay synchronous and go
 *     to storage every time (src/storage/syncRead.ts).
 *   - iOS / ANDROID: there is no tab session, and the round trip has to
 *     survive the OS killing the app while the member is in their mail app.
 *     So the code persists through AsyncStorage with a TWO-HOUR expiry
 *     (`NATIVE_SESSION_TTL_MS`, the bound already approved for the event
 *     return): long enough for a slow sign-up with a verification mail in the
 *     middle, short enough that it is still the same visit. It is read into
 *     memory at launch; the terminal hop waits for that read
 *     (`routeAfterAuth`), so a cold start can never route past a code that is
 *     still on its way out of storage.
 *
 * WHOSE CODE IT IS. A code is stored with the account that was signed in when
 * it was stashed, or with nobody:
 *   - stashed SIGNED OUT, it is the pre-auth handoff for whoever completes
 *     sign-in on this device next — that is the whole round trip, including
 *     "wrong account, sign out, sign in as the right one" at the identity
 *     gates. Its reach is bounded by the tab (web) or the expiry (native).
 *   - stashed while ACCOUNT A was signed in, it is A's. No other identity —
 *     not B, and not a signed-out visitor after A signs out — is routed by it
 *     or told it is waiting; the next terminal hop for anyone else drops it.
 *     That is what stops a durable phone store from handing one person's
 *     invitation to the next account on the device.
 *
 * FORMAT. An anonymous code is stored as the bare code string, as it always
 * was (the browser tests seed and read exactly that). An owned code is stored
 * as `{"code":…,"owner":…}`, which the old reader's shape check rejects, so
 * it can never be read as anonymous.
 */

import { useSyncExternalStore } from 'react';

import { eventRoute, readEventReturn } from './eventReturn';
import { kioskContributeRoute, readKioskReturnGoal } from './kioskSession';
import { markerRoute, readMarkerReturn } from './markerEntry';
import { createKeyMirror } from './storage/mirror';
import { sessionKv } from './storage/sessionKv';
import { HAS_SYNC_STORAGE, readSessionSync } from './storage/syncRead';

const KEY = 'wsf.pendingJoinCode';

/**
 * Whether a value looks like a plausible join code — matches the server's
 * normalizer so we do not stash garbage that the callables will reject.
 */
function isValidShape(code: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(code);
}

const store = createKeyMirror(sessionKv, readSessionSync);

let hydration: Promise<void> | null = null;
/** Resolves once the stored code (if any) has been read. Immediate on web. */
export function pendingJoinCodeReady(): Promise<void> {
  if (!hydration) hydration = store.load(KEY);
  return hydration;
}
// Native: start reading at launch, long before any screen can need it.
if (!HAS_SYNC_STORAGE) void pendingJoinCodeReady();

export function isPendingJoinCodeReady(): boolean {
  return store.loaded(KEY);
}

/**
 * Re-renders when the stored code has been read (native). Always true on web,
 * where the read is synchronous. A screen that SAYS a destination is waiting
 * reads it again when this flips; it does not otherwise react to changes,
 * exactly as before.
 */
export function usePendingJoinCodeReady(): boolean {
  return useSyncExternalStore(store.subscribe, isPendingJoinCodeReady, () => true);
}

type Stored = { code: string; owner: string | null };

function parse(raw: string | null): Stored | null {
  if (raw == null) return null;
  if (isValidShape(raw)) return { code: raw, owner: null };
  try {
    const v = JSON.parse(raw) as { code?: unknown; owner?: unknown } | null;
    if (v && typeof v.code === 'string' && isValidShape(v.code) && typeof v.owner === 'string' && v.owner) {
      return { code: v.code, owner: v.owner };
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Stash the code. `ownerUid` is the account signed in at this moment, or null
 * for a signed-out visitor. Resolves whether the device accepted it; losing
 * the handoff is annoying but not catastrophic — the /join route still works,
 * the member just has to re-scan.
 */
export function setPendingJoinCode(code: string, ownerUid: string | null = null): Promise<boolean> {
  if (!isValidShape(code)) return Promise.resolve(false);
  const value = ownerUid ? JSON.stringify({ code, owner: ownerUid }) : code;
  return store.write(KEY, value);
}

/**
 * The code waiting for `uid` (null: a signed-out reader), or null. A code
 * stashed under another account is never returned.
 */
export function readPendingJoinCode(uid: string | null = null): string | null {
  const stored = parse(store.read(KEY));
  if (!stored) return null;
  if (stored.owner !== null && stored.owner !== uid) return null;
  return stored.code;
}

export function clearPendingJoinCode(): Promise<boolean> {
  return store.remove(KEY);
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
 * on the last step. `uid` is the account completing the hop: a code stashed
 * under a different account does not claim it.
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
  const eventGoalId = readEventReturn();
  if (eventGoalId) return eventRoute(eventGoalId);
  const kioskGoalId = readKioskReturnGoal();
  if (kioskGoalId) return kioskContributeRoute(kioskGoalId);
  const markerSlug = readMarkerReturn();
  if (markerSlug) return markerRoute(markerSlug);
  return fallback;
}

/**
 * `nextRouteAfterAuth`, after the stored code has been read — the form every
 * terminal auth hop uses. Immediate on web. On a phone it waits for the
 * launch-time read, so a hop taken moments after a cold start cannot route
 * past a code that is still being loaded.
 *
 * A code that belongs to a DIFFERENT account is dropped here, at the first
 * terminal hop somebody else completes: it was never going to be theirs, and
 * it must not wait on the device for its owner's return either.
 */
export async function routeAfterAuth(fallback: string, uid: string | null): Promise<string> {
  await pendingJoinCodeReady();
  const stored = parse(store.read(KEY));
  if (stored && stored.owner !== null && stored.owner !== uid) await clearPendingJoinCode();
  return nextRouteAfterAuth(fallback, uid);
}
