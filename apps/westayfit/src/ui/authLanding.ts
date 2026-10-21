import { isKioskFlag } from '../kioskSession';
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
 * is REPLACED, as before this change on every platform: the last sign-in
 * screen's place is taken and the kiosk stays beneath. Back walks toward the
 * kiosk (through the sign-in screen only when the visitor went on to create
 * an account), never to member Home before it; and the kiosk's start screen
 * signs whoever it finds out.
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
};

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

export function landAfterAuth(next: string, { dispatch, push, replace, platform }: AuthLandingDeps): void {
  if (platform === 'web' || isKioskDestination(next)) {
    replace(next);
    return;
  }
  dispatch(HOME_ONLY_RESET);
  if (next !== '/') push(next);
}
