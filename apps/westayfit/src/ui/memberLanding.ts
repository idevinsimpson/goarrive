import { router } from 'expo-router';
import { Platform } from 'react-native';

import type { AuthLandingDeps } from './authLanding';

/**
 * NATIVE-MEMBER-1 W16-19 (RV16-641-B1, owner order: kiosk escapes block
 * visitor and device use). WHAT MEMBER'S SIGN IN AND CREATE ACCOUNT HAND
 * landAfterAuth, so it can see a kiosk beneath them.
 *
 * landAfterAuth keeps a kiosk on the stack only when its caller lets it read
 * the root stack (`routes`) and dismiss into it (`dismissTo`) (W14-K,
 * src/ui/authLanding.ts). Sign in and Create account passed neither, so a
 * join link opened at the kiosk's Sign in landed with the Home reset and a
 * push: [(tabs), join], the visitor signed in on member Home, the kiosk gone.
 * With the kiosk's marker alone, Home became a replace of the kiosk's start
 * screen over the one beneath: two start screens. These deps carry both, the
 * way verify-email's do, so the join is replaced over [kiosk, signin] and
 * Back reaches the kiosk (which signs the visitor out), and the marker's Home
 * dismisses back to the one kiosk.
 */

/** A root-stack screen's navigation object, as much of it as the landing reads. */
export type RootStackNavigation = {
  dispatch: (action: never) => void;
  getState: () => unknown;
};

/** The deps a member auth screen (a direct child of the root stack) lands with. Read per landing. */
export function memberLandingDeps(navigation: RootStackNavigation): AuthLandingDeps {
  return {
    dispatch: (action) => navigation.dispatch(action as never),
    push: (href) => router.push(href as never),
    replace: (href) => router.replace(href as never),
    platform: Platform.OS,
    routes: () => (navigation.getState() as { routes?: ReadonlyArray<{ name: string; params?: object }> } | undefined)?.routes,
    dismissTo: (href) => router.dismissTo(href as never),
  };
}
