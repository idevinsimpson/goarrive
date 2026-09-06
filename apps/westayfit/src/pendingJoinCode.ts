/**
 * Pending join code — sessionStorage-backed handoff for the QR-scan flow.
 *
 * The moment that matters: a signed-out visitor scans a QR, lands on
 * /join/<code>, and taps "Sign up to join". The signup flow that follows
 * (signup -> verify email -> profile setup) navigates through four routes
 * before it can return to the join page. Passing the code through the URL on
 * every one of those hops is fragile and easy to drop; a page reload during
 * verify would lose it either way.
 *
 * sessionStorage is exactly the right lifetime: survives client-side navigation
 * and a same-tab reload, clears on tab close so a stale code cannot linger for
 * the next visitor. Web-only: WSF ships web-only for now, and the write is
 * guarded against SSR / RN with a `typeof window` check that also masks a
 * private-browsing quota reject.
 */

const KEY = 'wsf.pendingJoinCode';

/**
 * Whether a value looks like a plausible join code — matches the server's
 * normalizer so we do not stash garbage that the callables will reject.
 */
function isValidShape(code: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(code);
}

export function setPendingJoinCode(code: string): void {
  try {
    if (typeof window === 'undefined') return;
    const storage = window.sessionStorage;
    if (!storage) return;
    if (!isValidShape(code)) return;
    storage.setItem(KEY, code);
  } catch {
    // Private-browsing quota reject or a locked-down UA. Losing the handoff
    // is annoying but not catastrophic — the /join route still works; the
    // member just has to re-scan.
  }
}

export function readPendingJoinCode(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const storage = window.sessionStorage;
    if (!storage) return null;
    const raw = storage.getItem(KEY);
    if (raw == null) return null;
    return isValidShape(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function clearPendingJoinCode(): void {
  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage?.removeItem(KEY);
  } catch {
    // ignore
  }
}

/**
 * Where a caller should route on the terminal auth hop. If a pending join code
 * is in play it wins — that is the whole point of the round-trip. Otherwise
 * falls back to the caller's default (which for every current caller is `/`).
 *
 * Only invoke on the terminal hop — after the member is verified AND has a
 * profile. Interim gates (verify-email, profile-setup) MUST route directly to
 * the next gate; otherwise `wsfJoinCommunity` fires before the profile exists
 * and the visitor dead-ends. The pending code survives sessionStorage across
 * the gate hops and is consumed here on the last step.
 */
export function nextRouteAfterAuth(fallback: string): string {
  const pending = readPendingJoinCode();
  if (pending) return `/join/${pending}`;
  return fallback;
}
