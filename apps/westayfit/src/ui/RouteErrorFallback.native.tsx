// The context @react-navigation/native re-exports (and expo-router's screens provide), from its own package.
import { NavigationContext } from '@react-navigation/core';
import { router } from 'expo-router';
import { useContext, useEffect, useState, type ComponentType } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context';

import { crashHarnessEnabled, disarmAllCrashSites } from '../crashHarness.native';
import { noteCaughtError } from '../crashRecords';
import { getFirebaseAuth } from '../firebase';
import { kioskSessionUnknown, kioskStartRoute, readKioskReturnGoal, readKioskSession } from '../kioskSession';
import { CREAM, kit } from './kit';
import type { BoundaryProps, FallbackVariant } from './routeErrorTypes';

/**
 * NATIVE-INTEGRATOR-1 (INT-01). WHAT A ROUTE SHOWS WHEN IT THROWS.
 *
 * expo-router wraps a route in its own error boundary when the route file
 * exports `ErrorBoundary` (node_modules/expo-router/build/useScreens.js,
 * `fromImport`), and renders that export with `{ error, retry }` in place of
 * the route. Without one, a render error on a phone is fatal and the process
 * dies; with one, only that route is replaced and everything around it keeps
 * working: a tab's fallback sits inside the tab, under the top bar and above
 * the tab bar, which still switch tabs.
 *
 * PLAIN REACT NATIVE, NO PROVIDERS. The root fallback renders in place of the
 * root layout, so the safe-area and auth providers are gone with it. This
 * component needs nothing from context: the top inset comes from
 * `initialWindowMetrics` (a constant, no provider), navigation from
 * expo-router's imperative `router`, styles from the kit. Where a context IS
 * there it is used, read without a hook that throws: the nearest safe-area
 * inset, and a screen's own navigator for Go to Home (RV16-641-N1).
 *
 * NATIVE ONLY. This file is the iOS and Android module; the web build gets
 * src/ui/RouteErrorFallback.tsx, whose `nativeErrorBoundary` returns undefined,
 * so expo-router adds no boundary there and a web crash behaves exactly as it
 * always has (INT-01: react-native-web unmounts to a blank page and a reload
 * recovers). None of this component ships in the web bundle.
 *
 * Each caught error is recorded, scrubbed, for Build details
 * (src/crashRecords.ts, shown by src/ui/CrashRecordsCard.native.tsx). The
 * screen itself shows only fixed copy, never the error's own text.
 *
 * ALWAYS A WAY OUT (#641 CS-4). Try again remounts what failed, and a route
 * that throws every time throws again. So every variant also offers Go to
 * Home. Where the fallback stands in for a navigator (root, shell, homeTab),
 * that navigator is unmounted and React Navigation has dropped its state; Go
 * to Home first asks for '/' (expo-router queues it for the navigator that is
 * still mounted, so the remounted one opens on Home rather than on whatever
 * stale screen its route still names), then remounts. At the root nothing is
 * left to navigate: the request is refused, and the remount alone starts the
 * stack fresh, on its first screen, which is Home ((tabs) → (home) → index).
 *
 * NEVER HOME WHILE A KIOSK SESSION IS OPEN (RV15-642-F1, PRIVACY). At a phone
 * kiosk the visitor is signed in on Sign in, Create account, verify-email or
 * the kiosk contribution, over the kiosk's start screen. Go to Home there
 * pushed member Home over the kiosk, signed in as the visitor on a shared
 * device. So while a kiosk session is open (the device's durable marker, or
 * the kiosk return armed for this account or for nobody in particular: the
 * same rule as the sign-in screens' way out, src/ui/authRedirect.ts on the
 * member lane) the way out is BACK TO THE KIOSK: router.dismissTo pops to the
 * kiosk's start screen (React Navigation's POP_TO; it replaces the current
 * route with it when it is not on the stack), and the start screen, focused
 * again, signs the visitor out. The body says so too. The account is read
 * from Firebase directly, inside a try (no provider is needed, and a failed
 * read counts as nobody). It is read again at the press and fails closed: a
 * button that said "Back to the kiosk" never goes Home. A navigator the
 * fallback stands in for is remounted as for Home, and the kiosk asked for
 * again once it has (at the root, the first request has no navigator to take
 * it).
 *
 * NO WAY HOME WHILE THE MARKER IS UNKNOWN (RV17-641-N3). When the device's
 * marker cannot be read (a read that throws, or the storage layer's unknown
 * state, `kioskSessionUnknown()`) and no kiosk return names a kiosk, this
 * device may be a kiosk with a visitor signed in, and there is no kiosk to go
 * back to. Of the two conservative answers (Try again only, or sign out and
 * then Home), this takes TRY AGAIN ONLY: it opens nothing and changes no
 * account, so a member whose storage merely failed is not signed out, and a
 * visitor is never shown member Home. Back, where the platform has one, still
 * leads down the stack, at a kiosk to its start screen, which signs out.
 */

export type { FallbackVariant };

type Props = {
  error: Error;
  retry: () => Promise<void> | void;
  variant: FallbackVariant;
};

const COPY: Record<FallbackVariant, string> = {
  root: 'The app hit a problem and stopped this screen. Try again, or go to Home.',
  shell: 'The app hit a problem and stopped this screen. Try again, or go to Home.',
  homeTab: 'This page hit a problem and stopped. Try again, go to Home, or pick another tab below.',
  tab: 'This page hit a problem and stopped. Try again, or go to Home.',
  screen: 'This screen hit a problem and stopped. Try again, or go to Home.',
  // Never "recorded": the attempt's outcome is unknown from here.
  contribute:
    'This screen hit a problem and stopped. Anything you were adding is not confirmed: check Progress before you add it again.',
};

/**
 * Variants that stand in for a whole navigator: Go to Home also remounts it.
 * The others sit inside a live navigator. A tab's fallback moves its tab to
 * Home. A screen's or the contribution's sits on the ROOT stack, often
 * presented as a modal over the tabs (Settings, MOVE, the contribution
 * sheet), where navigate('/') pushed a SECOND (tabs) above the fallback; so
 * those pop back to the tabs instead (RV15-634-N1).
 */
const REMOUNTS_ON_HOME: Record<FallbackVariant, boolean> = {
  root: true,
  shell: true,
  homeTab: true,
  tab: false,
  screen: false,
  contribute: false,
};

/** New copy (RV14-642-F1, the member lane's way out), pending owner wording sign-off. */
export const FALLBACK_WAY_OUT_KIOSK = 'Back to the kiosk';
/** New copy (RV15-642-F1): the body while a kiosk session is open, pending owner wording sign-off. */
export const FALLBACK_KIOSK_COPY = 'This screen hit a problem and stopped. Try again, or go back to the kiosk.';
/** New copy (RV17-641-N3): the body while the marker is unknown and no kiosk is named, pending owner wording sign-off. */
export const FALLBACK_UNKNOWN_COPY = 'This screen hit a problem and stopped. Try again.';

/**
 * What the fallback knows of a kiosk session on this device: the kiosk's goal
 * (`goalId`), and whether the marker is unknown. Never throws: an account that
 * cannot be read counts as nobody in particular (the kiosk return armed at a
 * kiosk has no owner), and each record is read on its own (RV16-641-N2): a
 * marker that cannot be read still lets the kiosk return name the kiosk. A
 * marker that cannot be read and no return to name a kiosk leaves
 * `markerUnknown` (RV17-641-N3), and then no way Home is offered.
 */
export function kioskStateForFallback(): { goalId: string | null; markerUnknown: boolean } {
  let uid: string | null = null;
  try {
    uid = getFirebaseAuth().currentUser?.uid ?? null;
  } catch {
    uid = null;
  }
  let marker: string | null = null;
  let markerUnknown = false;
  try {
    marker = readKioskSession();
    if (marker === null) markerUnknown = kioskSessionUnknown();
  } catch {
    marker = null;
    markerUnknown = true;
  }
  if (marker) return { goalId: marker, markerUnknown: false };
  let goalId: string | null = null;
  try {
    goalId = readKioskReturnGoal(uid);
  } catch {
    goalId = null;
  }
  return { goalId, markerUnknown: goalId === null && markerUnknown };
}

/** The goal of the kiosk session open on this device, or null (see kioskStateForFallback). */
export function openKioskGoalForFallback(): string | null {
  return kioskStateForFallback().goalId;
}

/** Root-stack variants: Home is the tabs beneath, popped back to. */
const POPS_TO_HOME: Record<FallbackVariant, boolean> = {
  root: false,
  shell: false,
  homeTab: false,
  tab: false,
  screen: true,
  contribute: true,
};

/** The tabs as they stand, Home selected: contribute's own "Back to Home" (leaveFor). */
const POP_TO_HOME_TAB = { type: 'POP_TO', payload: { name: '(tabs)', params: { screen: '(home)' } } } as const;

type Navigation = {
  dispatch: (action: never) => void;
  getState?: () => unknown;
  getParent?: () => Navigation;
};
type Dispatches = Navigation | undefined;

/** The ROOT navigator's state, reached through the screen's navigation object; undefined when it cannot be read. */
function rootStateOf(navigation: Navigation): unknown {
  try {
    let top = navigation;
    for (let parent = top.getParent?.(); parent; parent = parent.getParent?.()) top = parent;
    return top.getState?.();
  } catch {
    return undefined;
  }
}

/**
 * Dispatches on the screen's navigator; true when some navigator took it.
 * React Navigation drops an action that no navigator handles without a word
 * (core 7.21.13 useOnAction: onUnhandledAction only logs, in development), so
 * a dispatch that did not throw proves nothing (RV17-641-N4): the root state
 * must have changed. A state that cannot be read is taken at its word.
 */
function dispatchHandled(navigation: Navigation, action: object): boolean {
  const before = rootStateOf(navigation);
  navigation.dispatch(action as never);
  if (before === undefined) return true;
  return rootStateOf(navigation) !== before;
}

/** Asks for Home; never throws (a throw in a press handler is fatal on a phone). */
function requestHome(variant: FallbackVariant, navigation: Dispatches): void {
  if (POPS_TO_HOME[variant]) {
    // POP_TO the tabs and select the Home tab as it stands (RV16-641-N1), as
    // contribute's "Back to Home" does: dismissTo('/') named Home's index,
    // which the Home stack pushed over a mounted community, whose own redirect
    // then built a second copy of it. With nothing beneath (a cold link) the
    // tabs replace this route. dismissTo('/'), and navigate('/') should that
    // throw, stay the fallbacks: for a screen with no navigator to dispatch
    // to, and for a dispatch that no navigator took (RV17-641-N4). expo-router
    // 6 queues its own actions for the container to run (routing.js
    // routingQueue), so whether dismissTo was taken cannot be read here.
    try {
      if (navigation && dispatchHandled(navigation, POP_TO_HOME_TAB)) return;
    } catch {
      // fall through to dismissTo
    }
    try {
      router.dismissTo('/' as never);
      return;
    } catch {
      // fall through to navigate
    }
  }
  try {
    router.navigate('/');
  } catch {
    // The root fallback: no navigator is mounted to take it. The remount resets.
  }
}

/** Asks for the kiosk's start screen; never throws. */
function requestKiosk(goalId: string): void {
  try {
    router.dismissTo(kioskStartRoute(goalId) as never);
  } catch {
    // The root fallback: no navigator is mounted yet; asked again after the remount.
  }
}

export function RouteErrorFallback({ error, retry, variant }: Props) {
  const [retrying, setRetrying] = useState(false);
  const [, redraw] = useState(0);
  const harness = crashHarnessEnabled();
  // Read on every render (memory reads only): the way out this screen shows.
  const shown = kioskStateForFallback();
  const shownKioskGoal = shown.goalId;
  // RV17-641-N3: the marker unknown and no kiosk named: Try again only.
  const noWayOut = shownKioskGoal === null && shown.markerUnknown;
  // The navigator this fallback's route sits in (none at the root, or in a test without one).
  const navigation = useContext(NavigationContext) as Dispatches;
  useEffect(() => {
    void noteCaughtError(error);
  }, [error]);
  /*
    THE TOP INSET, PER VARIANT (#641 NB-4).
    - tab, homeTab: below the shell's top bar, which already clears the status bar.
    - root: the providers are gone with the layout it replaces, so the
      window's own first metrics (a constant, no provider).
    - shell, screen, contribute: the nearest safe-area provider is still
      mounted above them, so its inset, which is 0 below a staging strip and
      right inside an iOS modal. Read without a hook that throws, so a missing
      provider falls back to the window's metrics.
  */
  const providedInsets = useContext(SafeAreaInsetsContext);
  const windowTop = initialWindowMetrics?.insets.top ?? 0;
  const topInset =
    variant === 'tab' || variant === 'homeTab' ? 0 : variant === 'root' ? windowTop : (providedInsets?.top ?? windowTop);
  return (
    <View
      style={[styles.screen, { paddingTop: 24 + topInset }]}
      testID="wsf-route-error"
      {...({ dataSet: { variant } } as Record<string, unknown>)}
    >
      <View style={styles.card}>
        <Text style={kit.cardTitle} accessibilityRole="header">
          Something went wrong
        </Text>
        <Text style={kit.body} testID="wsf-route-error-body">
          {variant === 'contribute'
            ? COPY[variant]
            : shownKioskGoal
              ? FALLBACK_KIOSK_COPY
              : noWayOut
                ? FALLBACK_UNKNOWN_COPY
                : COPY[variant]}
        </Text>
        <Pressable
          onPress={() => {
            if (retrying) return;
            setRetrying(true);
            void Promise.resolve(retry()).finally(() => setRetrying(false));
          }}
          style={[kit.primaryButton, retrying ? kit.primaryButtonDisabled : null]}
          accessibilityRole="button"
          testID="wsf-route-error-retry"
        >
          <Text style={kit.primaryButtonText}>{retrying ? 'Trying again…' : 'Try again'}</Text>
        </Pressable>
        {noWayOut ? null : (
          <Pressable
            onPress={() => {
              // Read again at the press; fails closed to the kiosk this screen showed.
              const now = kioskStateForFallback();
              const kioskGoal = now.goalId ?? shownKioskGoal;
              if (!kioskGoal && now.markerUnknown) {
                // The marker became unknown since this rendered: never Home.
                // Drawn again, now without a way out (RV17-641-N3).
                redraw((n) => n + 1);
                return;
              }
              if (kioskGoal) requestKiosk(kioskGoal);
              else requestHome(variant, navigation);
              // After the queued navigation is dispatched (a discrete press
              // flushes its effects first), so the remount reads the new route.
              if (REMOUNTS_ON_HOME[variant]) {
                setTimeout(() => {
                  void Promise.resolve()
                    .then(retry)
                    // At the root the first request had no navigator: ask again.
                    .then(() => (kioskGoal ? setTimeout(() => requestKiosk(kioskGoal), 0) : undefined))
                    .catch(() => undefined);
                }, 0);
              }
            }}
            style={kit.secondaryButton}
            accessibilityRole="button"
            testID="wsf-route-error-home"
          >
            <Text style={kit.secondaryButtonText}>{shownKioskGoal ? FALLBACK_WAY_OUT_KIOSK : 'Go to Home'}</Text>
          </Pressable>
        )}
        {harness ? (
          <Pressable
            onPress={disarmAllCrashSites}
            style={kit.tertiaryButton}
            accessibilityRole="button"
            testID="wsf-route-error-disarm"
          >
            <Text style={kit.tertiaryButtonText}>Remove injected fault (test build)</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const boundaries = new Map<FallbackVariant, ComponentType<BoundaryProps>>();

function boundaryFor(variant: FallbackVariant): ComponentType<BoundaryProps> {
  let b = boundaries.get(variant);
  if (!b) {
    const Boundary = ({ error, retry }: BoundaryProps) => (
      <RouteErrorFallback error={error} retry={retry} variant={variant} />
    );
    Boundary.displayName = `RouteErrorBoundary(${variant})`;
    b = Boundary;
    boundaries.set(variant, b);
  }
  return b;
}

/**
 * The value a route file exports as `ErrorBoundary` (this module is native
 * only; the web module returns undefined). The Platform check is a second
 * guard should this file ever be bundled for web.
 */
export function nativeErrorBoundary(variant: FallbackVariant): ComponentType<BoundaryProps> | undefined {
  return Platform.OS === 'web' ? undefined : boundaryFor(variant);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CREAM, paddingHorizontal: 20, paddingBottom: 24 },
  card: { gap: 14, maxWidth: 560, width: '100%', alignSelf: 'center' },
});
