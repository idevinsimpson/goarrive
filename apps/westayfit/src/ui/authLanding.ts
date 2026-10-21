import { isKioskFlag, kioskStartRoute, readKioskSession } from '../kioskSession';
import { SIGNED_OUT_HOME_RESET } from './signOutReset';

/**
 * NATIVE-INTEGRATOR-1 (INT-20, W12-12) — WHERE A MEMBER LANDS WHEN SIGNING IN
 * IS DONE, ON A PHONE.
 *
 * The post-auth hops (verify-email clearing, profile-setup finishing) used
 * `router.replace(next)`. On the web that is right: the address bar shows the
 * landing and browser Back leaves the site. On a phone `replace` swaps only
 * the top of the root stack, so the sign-in screens' (tabs) and the new
 * (tabs) piled up, or the opener was lost, and Back led somewhere stale.
 *
 * So on iOS and Android the root stack is RESET to one (tabs) route whose only
 * history is Home's index (the same action as the signed-out reset,
 * src/ui/signOutReset.ts), and the destination, when it is not Home itself,
 * is PUSHED over it: Back from a join or a community lands on Home, never on
 * a sign-in screen. The web keeps `replace(next)` exactly as before.
 *
 * NEVER FOR A KIOSK (RV12-641-F1). A visitor signing in at a kiosk returns
 * to `/contribute/<goal>?kiosk=1`, over the kiosk's start screen. Resetting
 * the stack to Home there would wipe `/kiosk/<goal>` from beneath it, and
 * Back (or the iOS edge swipe) from the contribution would land on the
 * visitor's signed-in member Home on a shared device. So a kiosk destination
 * is never reset under, and never routed to member Home.
 *
 * BACK GOES STRAIGHT TO THE KIOSK (RV13-641-N2). After an account is created
 * at a kiosk, a stale sign-in screen sat between the kiosk and the
 * contribution: Back showed it, a 'Sign in · Loading…' shell, before the
 * kiosk. So on a phone, when the caller can see the root stack (`routes`) and
 * dismiss into it (`dismissTo`), and that kiosk's start screen is the nearest
 * kiosk in the stack, the sign-in screens are popped back to it
 * (`dismissTo('/kiosk/<goal>')`) and the contribution is pushed over it:
 * `[…, kiosk, contribute?kiosk=1]`, and one Back reaches the kiosk. Otherwise
 * (the kiosk not in the stack, another goal's kiosk nearer, a caller without
 * those two, or the web) the destination is REPLACED, as before: the last
 * sign-in screen's place is taken. The kiosk's start screen signs whoever it
 * finds out.
 *
 * HOME IS NOT A WAY OUT OF A KIOSK SESSION (RV15-642-N1). The post-auth hops
 * fall back to '/' when no destination is armed, and the kiosk return lives
 * two hours while the device's kiosk-session marker never expires. So on a
 * phone, when the destination is Home and the marker names a goal, the
 * landing goes to that kiosk's start screen instead (dismissed to when it is
 * beneath, replaced otherwise, as any kiosk destination), never the Home
 * reset. The start screen signs the visitor out.
 *
 * NOTHING RESETS A KIOSK AWAY (RV15-641-N1, RV16-641-B1). A member
 * destination reached while a kiosk start screen is somewhere in the stack (a
 * join link opened over a kiosk session) is REPLACED, the shape before
 * W13-6a, so Back still leads to the kiosk, which signs the visitor out; the
 * Home reset would wipe it. Callers that pass `routes` (join, verify-email,
 * profile-setup) are judged by the stack itself. A caller that passes NONE
 * (Sign in and Create account) cannot be checked, so while the device's kiosk
 * marker is open it is replaced too, never reset; and a marker that cannot
 * be read counts as open.
 *
 * Published for the member and state lanes' own post-auth hops.
 */

/** The root stack reset to Home only (React Navigation's RESET). */
export const HOME_ONLY_RESET = SIGNED_OUT_HOME_RESET;

export type AuthLandingDeps = {
  /** The root stack's dispatch (the navigation object of a root-stack screen). */
  dispatch: (action: typeof HOME_ONLY_RESET) => void;
  push: (href: string) => void;
  replace: (href: string) => void;
  platform: string;
  /**
   * The root stack's routes (that navigation object's getState().routes), to
   * find a kiosk's start screen beneath. Optional: without it (or without
   * `dismissTo`) a kiosk destination is replaced.
   */
  routes?: () => ReadonlyArray<{ name: string; params?: object }> | undefined;
  /** expo-router's router.dismissTo: pops back to a screen already in the stack. */
  dismissTo?: (href: string) => void;
};

/** The kiosk start screen's root route name (app/kiosk/[goalId].tsx). */
const KIOSK_ROUTE = 'kiosk/[goalId]';

/** The goal a kiosk destination belongs to: `/kiosk/<goal>` or `/contribute/<goal>?…kiosk…`; null for anything else. */
function kioskGoalOf(next: string): { goalId: string; isStart: boolean } | null {
  const m = /^\/(kiosk|contribute)\/([^/?#]+)(?:[?#]|$)/.exec(next);
  if (!m) return null;
  let goalId = m[2]!;
  try {
    goalId = decodeURIComponent(goalId);
  } catch {
    // Left as written: it then matches no route's goal, and the destination is replaced.
  }
  return { goalId, isStart: m[1] === 'kiosk' };
}

/** Whether the nearest kiosk start screen in the stack is this goal's. */
function kioskStartIsBeneath(goalId: string, routes: ReadonlyArray<{ name: string; params?: object }> | undefined): boolean {
  if (!routes) return false;
  for (let i = routes.length - 1; i >= 0; i -= 1) {
    const route = routes[i]!;
    if (route.name !== KIOSK_ROUTE) continue;
    return (route.params as { goalId?: unknown } | undefined)?.goalId === goalId;
  }
  return false;
}

/**
 * A kiosk's own destination: its start screen (`/kiosk/<goal>`), or a route
 * whose `kiosk` query parameter says kiosk by the ONE rule every reader uses
 * (`isKioskFlag`, src/kioskSession.ts: '1' or 'true', and a repeated parameter
 * counts if any copy says kiosk, so it fails closed). The rule is not copied
 * here; only the query is split.
 */
export function isKioskDestination(next: string): boolean {
  const hash = next.indexOf('#');
  const target = hash < 0 ? next : next.slice(0, hash);
  const query = target.indexOf('?');
  const path = query < 0 ? target : target.slice(0, query);
  if (/^\/kiosk(\/|$)/.test(path)) return true;
  if (query < 0) return false;
  const flags: string[] = [];
  for (const pair of target.slice(query + 1).split('&')) {
    const eq = pair.indexOf('=');
    if (decodeQueryPart(eq < 0 ? pair : pair.slice(0, eq)) !== 'kiosk') continue;
    flags.push(decodeQueryPart(eq < 0 ? '' : pair.slice(eq + 1)));
  }
  return isKioskFlag(flags);
}

function decodeQueryPart(part: string): string {
  try {
    return decodeURIComponent(part.replace(/\+/g, ' '));
  } catch {
    return part;
  }
}

type StackRoutes = ReadonlyArray<{ name: string; params?: object }>;

/** The caller's root-stack routes; 'unreadable' when reading them threw. */
function readRoutes(routes: (() => StackRoutes | undefined) | undefined): StackRoutes | undefined | 'unreadable' {
  if (!routes) return undefined;
  try {
    return routes();
  } catch {
    return 'unreadable';
  }
}

/**
 * The open kiosk session's goal (the device's marker; null on the web), or
 * 'unreadable' when reading it threw: never throwing, and an unreadable
 * marker counts as possibly open (RV16-641-N2).
 */
function openKioskMarker(): string | null | 'unreadable' {
  try {
    return readKioskSession();
  } catch {
    return 'unreadable';
  }
}

export function landAfterAuth(target: string, { dispatch, push, replace, platform, routes, dismissTo }: AuthLandingDeps): void {
  if (platform === 'web') {
    replace(target);
    return;
  }
  const marker = openKioskMarker();
  // Home while a kiosk session is open: that kiosk's start screen instead (RV15-642-N1).
  const next = target === '/' && marker !== null && marker !== 'unreadable' ? kioskStartRoute(marker) : target;
  if (isKioskDestination(next)) {
    // Never a reset under a kiosk destination. Back to the kiosk's own start
    // screen when it is the nearest kiosk beneath; otherwise replace.
    const kiosk = kioskGoalOf(next);
    const stack = readRoutes(routes);
    if (kiosk && dismissTo && stack !== 'unreadable' && kioskStartIsBeneath(kiosk.goalId, stack)) {
      dismissTo(kioskStartRoute(kiosk.goalId));
      if (!kiosk.isStart) push(next);
      return;
    }
    replace(next);
    return;
  }
  // A kiosk start screen anywhere beneath is never reset away (RV15-641-N1).
  // It fails closed the same way when the stack cannot be read, when the
  // caller gives no stack while a kiosk session is open (RV16-641-B1: Sign in
  // and Create account pass none, and a pending join, event or /go return
  // outranks the kiosk return, so '/join/<code>' arrives here over a kiosk),
  // and when the kiosk marker itself cannot be read (RV16-641-N2).
  const stack = readRoutes(routes);
  if (
    stack === 'unreadable' ||
    marker === 'unreadable' ||
    (stack === undefined && marker !== null) ||
    stack?.some((route) => route.name === KIOSK_ROUTE)
  ) {
    replace(next);
    return;
  }
  dispatch(HOME_ONLY_RESET);
  if (next !== '/') push(next);
}
