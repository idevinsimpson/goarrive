import { router } from 'expo-router';
import { useEffect, useState, type ComponentType } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { initialWindowMetrics } from 'react-native-safe-area-context';

import { noteCaughtError } from '../crashContainment';
import { crashHarnessEnabled, disarmAllCrashSites } from '../crashHarness';
import { CREAM, kit } from './kit';

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
 * NATIVE ONLY. `nativeErrorBoundary` returns undefined on web, so expo-router
 * adds no boundary there and a web crash behaves exactly as it always has
 * (INT-01: react-native-web unmounts to a blank page and a reload recovers).
 *
 * Each caught error is recorded, scrubbed, for Build details
 * (src/crashContainment.ts).
 */

export type FallbackVariant = 'root' | 'shell' | 'homeTab' | 'tab' | 'screen' | 'contribute';

type Props = {
  error: Error;
  retry: () => Promise<void> | void;
  variant: FallbackVariant;
};

const COPY: Record<FallbackVariant, string> = {
  root: 'The app hit a problem and stopped this screen. Try again to reload it.',
  shell: 'The app hit a problem and stopped this screen. Try again to reload it.',
  homeTab: 'This page hit a problem and stopped. Try again, or pick another tab below.',
  tab: 'This page hit a problem and stopped. Try again, or go to Home.',
  screen: 'This screen hit a problem and stopped. Try again, or go to Home.',
  // Never "recorded": the attempt's outcome is unknown from here.
  contribute:
    'This screen hit a problem and stopped. Anything you were adding is not confirmed: check Progress before you add it again.',
};

/** Variants with a live navigator beneath them, where "Go to Home" can act. */
const HAS_HOME_LINK: Record<FallbackVariant, boolean> = {
  root: false,
  shell: false,
  homeTab: false,
  tab: true,
  screen: true,
  contribute: true,
};

export function RouteErrorFallback({ error, retry, variant }: Props) {
  const [retrying, setRetrying] = useState(false);
  const harness = crashHarnessEnabled();
  useEffect(() => {
    void noteCaughtError(error);
  }, [error]);
  // A tab's fallback sits below the shell's top bar, which already clears the
  // status bar; everything else is drawn from the top of the window.
  const topInset = variant === 'tab' || variant === 'homeTab' ? 0 : (initialWindowMetrics?.insets.top ?? 0);
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
        {HAS_HOME_LINK[variant] ? (
          <Pressable
            onPress={() => router.navigate('/')}
            style={kit.secondaryButton}
            accessibilityRole="button"
            testID="wsf-route-error-home"
          >
            <Text style={kit.secondaryButtonText}>Go to Home</Text>
          </Pressable>
        ) : null}
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

type BoundaryProps = { error: Error; retry: () => Promise<void> };

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
 * The value a route file exports as `ErrorBoundary`. Undefined on web, so
 * expo-router wraps nothing there.
 */
export function nativeErrorBoundary(variant: FallbackVariant): ComponentType<BoundaryProps> | undefined {
  return Platform.OS === 'web' ? undefined : boundaryFor(variant);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CREAM, paddingHorizontal: 20, paddingBottom: 24 },
  card: { gap: 14, maxWidth: 560, width: '100%', alignSelf: 'center' },
});
