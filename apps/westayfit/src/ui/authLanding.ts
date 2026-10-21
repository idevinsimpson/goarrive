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

export function landAfterAuth(next: string, { dispatch, push, replace, platform }: AuthLandingDeps): void {
  if (platform === 'web') {
    replace(next);
    return;
  }
  dispatch(HOME_ONLY_RESET);
  if (next !== '/') push(next);
}
