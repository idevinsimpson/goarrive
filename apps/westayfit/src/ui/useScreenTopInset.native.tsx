import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { STAGING_STRIP_UNDER_STATUS_BAR } from '../stagingStrip';
import { statusBarStyleFor, type ScreenTone } from './statusBarPolicy';

/**
 * NATIVE-INTEGRATOR-1 (INT-09). THE TOP OF A ROOT-STACK SCREEN, ON A PHONE.
 *
 * The root stack has no header (`headerShown: false`), native-stack uses the
 * insets only for a header's height, and Android draws edge to edge, so a
 * screen outside the member tabs starts under the clock and the Dynamic
 * Island unless it clears the top inset itself. These are the ways it does:
 *
 *   useScreenTopInset()  the inset, for a container's own padding (a navy
 *                        field keeps bleeding behind the status bar and
 *                        moves only its content down).
 *   <ScreenTopSpacer />  the same height as a first child, for a screen
 *                        whose container is someone else's to restyle.
 *   <ScreenStatusBar />  light icons over navy, dark over cream, while this
 *                        screen is the focused one; leaving it hands the
 *                        status bar back to the screen beneath.
 *
 * The inset is the nearest SafeAreaProvider's. On a staging build the stack
 * sits in its own provider below the red strip (src/stagingShell.native.tsx),
 * so a screen there clears the strip, not the status bar a second time. On
 * web (src/ui/useScreenTopInset.ts) all of it is inert.
 */
export type { ScreenTone };

export function useScreenTopInset(): number {
  return useSafeAreaInsets().top;
}

export function ScreenTopSpacer() {
  const top = useScreenTopInset();
  return top > 0 ? <View pointerEvents="none" style={{ height: top }} testID="wsf-screen-top-spacer" /> : null;
}

export function ScreenStatusBar({ tone }: { tone: ScreenTone }) {
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return focused ? <StatusBar style={statusBarStyleFor(tone, STAGING_STRIP_UNDER_STATUS_BAR)} /> : null;
}
