/**
 * NATIVE-INTEGRATOR-1 (INT-05). SIGNING OUT FROM THE MENU LANDS ON SIGNED-OUT
 * HOME, NOT ON A TAB WITH NO WAY OUT.
 *
 * The shell draws its top bar and tab bar only for a signed-in member
 * (app/(tabs)/_layout.tsx), so after a menu Sign out on Progress or Community
 * the member was left on that tab's signed-out card with no control at all. On
 * iOS tabs have no back gesture, so the only way out was to force-quit; on
 * Android, Back led through the old tab history.
 *
 * After a SUCCESSFUL sign-out the root stack is reset to one `(tabs)` route
 * whose only tab history is Home's index: the signed-out Home with Sign in and
 * Create an account, and nothing behind it for Back to reach. A plain
 * `router.replace('/')` would keep the tab history. If the sign-out fails, the
 * member is still signed in and nothing moves.
 *
 * NATIVE ONLY. On web the address bar and browser Back already give a way out,
 * and the web journeys (sprint-w9-app-feel-parity-2.spec.ts) expect the tab
 * they signed out on to stay where it is; web keeps exactly that.
 */

/** React Navigation's RESET action (CommonActions.reset), as a plain object. */
export const SIGNED_OUT_HOME_RESET = {
  type: 'RESET',
  payload: {
    index: 0,
    routes: [
      {
        name: '(tabs)',
        state: {
          index: 0,
          routes: [{ name: '(home)', state: { index: 0, routes: [{ name: 'index' }] } }],
        },
      },
    ],
  },
} as const;

export type SignOutDeps = {
  signOut: () => Promise<void>;
  /** The root stack's dispatch (the `(tabs)` screen's navigation object). */
  dispatch: (action: typeof SIGNED_OUT_HOME_RESET) => void;
  platform: string;
};

/**
 * Signs out, then (native only) resets to signed-out Home. Resolves whether
 * the sign-out succeeded; never throws, so a failure leaves the member signed
 * in on the same tab with the top bar and tab bar intact.
 */
export async function signOutToSignedOutHome({ signOut, dispatch, platform }: SignOutDeps): Promise<boolean> {
  try {
    await signOut();
  } catch (e) {
    console.warn('[wsf] sign-out failed', e);
    return false;
  }
  if (platform !== 'web') dispatch(SIGNED_OUT_HOME_RESET);
  return true;
}
