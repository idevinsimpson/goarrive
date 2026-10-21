import { router } from 'expo-router';
import { useContext, useEffect, useState, type ComponentType } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context';

import { crashHarnessEnabled, disarmAllCrashSites } from '../crashHarness.native';
import { noteCaughtError } from '../crashRecords';
import { getFirebaseAuth } from '../firebase';
import { kioskStartRoute, readKioskReturnGoal, readKioskSession } from '../kioskSession';
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
 * component reads nothing from context: the top inset comes from
 * `initialWindowMetrics` (a constant, no provider), navigation from
 * expo-router's imperative `router`, styles from the kit.
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

/**
 * The goal of the kiosk session open on this device, or null. Never throws: an
 * account that cannot be read counts as nobody in particular (the kiosk
 * return armed at a kiosk has no owner), and a record that cannot be read
 * counts as none.
 */
export function openKioskGoalForFallback(): string | null {
  let uid: string | null = null;
  try {
    uid = getFirebaseAuth().currentUser?.uid ?? null;
  } catch {
    uid = null;
  }
  try {
    return readKioskSession() ?? readKioskReturnGoal(uid);
  } catch {
    return null;
  }
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

/** Asks for Home; never throws (a throw in a press handler is fatal on a phone). */
function requestHome(variant: FallbackVariant): void {
  if (POPS_TO_HOME[variant]) {
    // POP_TO the tabs (they replace this route when nothing is beneath, as on
    // a cold link); navigate stays the fallback.
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
  const harness = crashHarnessEnabled();
  // Read on every render (two memory reads): the way out this screen shows.
  const shownKioskGoal = openKioskGoalForFallback();
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
          {shownKioskGoal && variant !== 'contribute' ? FALLBACK_KIOSK_COPY : COPY[variant]}
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
        <Pressable
          onPress={() => {
            // Read again at the press; fails closed to the kiosk this screen showed.
            const kioskGoal = openKioskGoalForFallback() ?? shownKioskGoal;
            if (kioskGoal) requestKiosk(kioskGoal);
            else requestHome(variant);
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
