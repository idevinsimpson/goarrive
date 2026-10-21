import { router } from 'expo-router';
import { useContext, useEffect, useState, type ComponentType } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context';

import { crashHarnessEnabled, disarmAllCrashSites } from '../crashHarness.native';
import { noteCaughtError } from '../crashRecords';
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
 * The others sit inside a live navigator, which simply moves to Home.
 */
const REMOUNTS_ON_HOME: Record<FallbackVariant, boolean> = {
  root: true,
  shell: true,
  homeTab: true,
  tab: false,
  screen: false,
  contribute: false,
};

/** Asks for Home; never throws (a throw in a press handler is fatal on a phone). */
function requestHome(): void {
  try {
    router.navigate('/');
  } catch {
    // The root fallback: no navigator is mounted to take it. The remount resets.
  }
}

export function RouteErrorFallback({ error, retry, variant }: Props) {
  const [retrying, setRetrying] = useState(false);
  const harness = crashHarnessEnabled();
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
          {COPY[variant]}
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
            requestHome();
            // After the queued navigation is dispatched (a discrete press
            // flushes its effects first), so the remount reads the new route.
            if (REMOUNTS_ON_HOME[variant]) {
              setTimeout(() => {
                void Promise.resolve()
                  .then(retry)
                  .catch(() => undefined);
              }, 0);
            }
          }}
          style={kit.secondaryButton}
          accessibilityRole="button"
          testID="wsf-route-error-home"
        >
          <Text style={kit.secondaryButtonText}>Go to Home</Text>
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
