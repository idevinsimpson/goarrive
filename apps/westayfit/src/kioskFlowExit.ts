/**
 * NATIVE-INTEGRATOR-2 W14-O (owner decision, #365 6326225448; RV16-641-N3,
 * RV17-641-N1, RV17-C16-1) — LEAVING THE KIOSK FLOW SIGNED IN LEADS BACK TO
 * THE KIOSK START SCREEN, WHICH SIGNS THE VISITOR OUT.
 *
 * THE GAP. On a phone whose kiosk-session marker is open (src/kioskSession.ts
 * `readKioskSession()`), a visitor who signs in at the kiosk's Sign in with a
 * join link, an event return or a /go marker return pending lands on that
 * member screen (app/join/[joinCode], app/event/[goalId], app/go/[markerSlug])
 * still signed in: no Finish, no idle deadline (KIOSK_IDLE_MS runs only on
 * the kiosk contribution), and "back to home" links that open member Home
 * over the kiosk. Whoever walks up next finds the previous visitor's account.
 * The landings themselves never reset the kiosk away any more (W14-K, W14-M,
 * W14-N), so Back always reaches the kiosk start screen; but nobody presses
 * Back for a visitor who walked away.
 *
 * THE RULE (the owner's decision). While a kiosk session is open on this
 * device, or MAY be (the marker cannot be read, `kioskSessionUnknown()`:
 * fail closed, as W14-N and member W16-23 do), and a user is signed in, and
 * the focused root route is OUTSIDE the kiosk flow, the root stack is RESET
 * to that kiosk's start screen alone: `[kiosk/[goalId]]`, no member screen
 * beneath or above. The start screen, focused, ends the session as it does
 * on every other arrival: it signs the visitor out and, once nobody is
 * signed in, clears the marker (app/kiosk/[goalId].tsx; member W16-23 signs
 * out without asking when the marker is open for this goal or unknown).
 *
 * THE KIOSK FLOW is the kiosk start screen; the kiosk's own sign-in and its
 * gates (signin, signup, verify-email, profile-setup, reset-password), where
 * a visitor is signed in for a moment before the landing moves on; and the
 * kiosk contribution for the marker's goal (`contribute/[goalId]` with the
 * kiosk flag, src/kioskSession.ts `isKioskFlag`, which also carries the
 * receipt). Everything else is outside it: `(tabs)` (member Home and the
 * tabs), join, event, /go, and any other member screen.
 *
 * WHICH KIOSK. The marker's goal. With the marker unknown there is no goal to
 * name, so the nearest kiosk start screen the stack shows is the target
 * (RV17-C16-3's rule); with none, nothing can be done here, and nothing is:
 * that state (a launch whose marker read failed, with no kiosk opened since)
 * is the launch guard's documented no-redirect (src/kioskLaunchGuard.ts).
 * When that kiosk's start screen is already in the stack it is kept, by its
 * key, so the screen a visitor walked up to stays mounted; otherwise a fresh
 * one is named.
 *
 * WHEN. On every change of the root navigation state (the landing right
 * after Sign in, a "back to home" link, a finished join), whenever the auth
 * state changes (an account restored after the screens are up), and once
 * the marker's launch read has landed. The marker itself is written only
 * inside the kiosk flow (the start screen's Contribute, the kiosk
 * contribution), so no other change can open a session under a member
 * screen.
 *
 * PERSONAL MODE IS UNCHANGED. With no marker on this device (every phone
 * that is not a kiosk, and the web, which keeps no marker), nothing here
 * ever fires: a kiosk start screen somewhere in the stack is, on its own, no
 * kiosk session (a member who opened a kiosk link on their own phone).
 *
 * WHERE. Mounted once, in the root layout (app/_layout.tsx), as the first
 * child of the auth provider and outside the root `<Stack>` (expo-router
 * renders only `Screen` children there and drops anything else). There the
 * navigation object is the root layout's own: its screen in expo-router's
 * internal root navigator, whose nested state is the app's root Stack
 * (src/ui/coldBack.ts `appRootState`); the RESET is addressed to that Stack
 * by its key, as the cold-back reset is.
 */
import { useNavigation } from 'expo-router';
import { useEffect } from 'react';

import { useWsfAuth } from './auth';
import { isKioskFlag, kioskSessionReady, kioskSessionUnknown, readKioskSession } from './kioskSession';
import { appRootState, type ColdBackRootState } from './ui/coldBack';

/** The kiosk start screen's root route name (app/kiosk/[goalId].tsx). */
export const KIOSK_START_ROUTE = 'kiosk/[goalId]';
/** The contribution screen's root route name (app/contribute/[goalId].tsx). */
const CONTRIBUTE_ROUTE = 'contribute/[goalId]';
/** The kiosk's own sign-in and its gates: a visitor is signed in here for a moment before the landing. */
export const KIOSK_FLOW_AUTH_ROUTES: ReadonlySet<string> = new Set(['signin', 'signup', 'verify-email', 'profile-setup', 'reset-password']);

/**
 * The device's marker cannot be read (RV16-641-N2, RV17-641-N3): a value of
 * its own, never a string, so no goal id can be mistaken for it.
 */
export const KIOSK_MARKER_UNKNOWN: unique symbol = Symbol('kiosk marker unknown');
export type KioskMarkerState = string | null | typeof KIOSK_MARKER_UNKNOWN;

/** A root-stack route as the guard reads it. */
export type KioskFlowRoute = { key?: string; name: string; params?: object };

/** React Navigation's RESET to the kiosk start screen alone, addressed to the app's root Stack. */
export type KioskFlowExitAction = {
  type: 'RESET';
  payload: { index: 0; routes: [KioskFlowRoute] };
  target: string;
};

/**
 * The open kiosk session's goal; null when none (always on the web); or
 * KIOSK_MARKER_UNKNOWN when the marker cannot be read (a read that throws,
 * or the storage layer's own unknown state). Never throws.
 */
export function readKioskMarkerState(): KioskMarkerState {
  try {
    const goalId = readKioskSession();
    if (goalId !== null) return goalId;
    return kioskSessionUnknown() ? KIOSK_MARKER_UNKNOWN : null;
  } catch {
    return KIOSK_MARKER_UNKNOWN;
  }
}

/**
 * Whether `route`, focused, is inside the kiosk flow of the open session
 * (`marker`: its goal, or unknown). Pure.
 */
export function inKioskFlow(route: KioskFlowRoute, marker: string | typeof KIOSK_MARKER_UNKNOWN): boolean {
  if (route.name === KIOSK_START_ROUTE) return true;
  if (KIOSK_FLOW_AUTH_ROUTES.has(route.name)) return true;
  if (route.name === CONTRIBUTE_ROUTE) {
    const params = (route.params ?? {}) as { goalId?: unknown; kiosk?: unknown };
    if (!isKioskFlag(params.kiosk)) return false;
    return marker === KIOSK_MARKER_UNKNOWN || params.goalId === marker;
  }
  return false;
}

/** The nearest kiosk start screen in the stack, from the top; for `goalId` when given. */
function nearestKioskStart(routes: ReadonlyArray<KioskFlowRoute>, goalId?: string): KioskFlowRoute | null {
  for (let i = routes.length - 1; i >= 0; i -= 1) {
    const route = routes[i]!;
    if (route.name !== KIOSK_START_ROUTE) continue;
    const g = (route.params as { goalId?: unknown } | undefined)?.goalId;
    if (typeof g !== 'string' || g === '') continue;
    if (goalId === undefined || g === goalId) return route;
  }
  return null;
}

/**
 * The RESET that sends a signed-in visitor on a member screen back to the
 * kiosk start screen, or null: nobody signed in; no kiosk session on this
 * device; the focused route inside the kiosk flow; no kiosk to name; or a
 * root Stack whose state cannot be addressed yet (no key). Pure.
 *
 * `rootState` is what the root layout's navigation object reports: the
 * internal root navigator's state (its one `__root` route holding the app's
 * Stack), or that Stack's state itself.
 */
export function kioskFlowExitReset(rootState: ColdBackRootState, signedIn: boolean, marker: KioskMarkerState): KioskFlowExitAction | null {
  if (!signedIn || marker === null) return null;
  const app = appRootState(rootState);
  const routes = (app?.routes ?? []) as ReadonlyArray<KioskFlowRoute>;
  if (!app?.key || routes.length === 0) return null;
  const focused = routes[app.index ?? routes.length - 1] ?? routes[routes.length - 1]!;
  if (inKioskFlow(focused, marker)) return null;
  const existing = typeof marker === 'string' ? nearestKioskStart(routes, marker) : nearestKioskStart(routes);
  let base: KioskFlowRoute;
  if (existing) {
    base = existing.key ? { key: existing.key, name: existing.name, params: existing.params } : { name: existing.name, params: existing.params };
  } else if (typeof marker === 'string') {
    base = { name: KIOSK_START_ROUTE, params: { goalId: marker } };
  } else {
    return null;
  }
  return { type: 'RESET', payload: { index: 0, routes: [base] }, target: app.key };
}

/** What the guard needs of the root layout's navigation object. */
export type KioskFlowExitNavigation = {
  getState: () => ColdBackRootState;
  dispatch: (action: KioskFlowExitAction) => void;
  addListener: (type: 'state', listener: () => void) => () => void;
};

/**
 * The guard, for the root layout: checks on mount, on every root
 * navigation-state change, on every auth change and once the marker's launch
 * read has landed, and dispatches the RESET when one is due. Never throws
 * (an unreadable stack, or a dispatch the navigation refuses, is left
 * alone: there is nothing to address).
 */
export function useKioskFlowExitGuard(): void {
  const navigation = useNavigation() as unknown as KioskFlowExitNavigation;
  const { user } = useWsfAuth();
  const signedIn = !!user;
  useEffect(() => {
    let active = true;
    const check = () => {
      if (!active) return;
      let action: KioskFlowExitAction | null;
      try {
        action = kioskFlowExitReset(navigation.getState(), signedIn, readKioskMarkerState());
      } catch {
        return;
      }
      if (!action) return;
      try {
        navigation.dispatch(action);
      } catch {
        // The navigation refused (not mounted yet, say): the next state change asks again.
      }
    };
    check();
    const unsubscribe = navigation.addListener('state', check);
    void kioskSessionReady().then(check, () => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [navigation, signedIn]);
}

/** The guard as a component that draws nothing, for the root layout. */
export function KioskFlowExitGuard(): null {
  useKioskFlowExitGuard();
  return null;
}
