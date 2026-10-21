import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
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
 * so a screen there clears the strip, not the status bar a second time.
 *
 * UNDER THE MEMBER TOP BAR THE TOP IS ALREADY CLEARED (#641 F1). The signed-in
 * shell (app/(tabs)/_layout.tsx) draws MemberTopBar, which pads the status bar
 * itself, and wraps its scenes in <TopCleared cleared>. Inside that, the inset
 * is 0 and no screen sets the status-bar icons: a FormShell rendered inside a
 * tab (a community's challenge page, its join gate) would otherwise add the
 * inset a second time below the bar and turn the icons white over the cream
 * bar. On web (src/ui/useScreenTopInset.ts) all of it is inert.
 */
export type { ScreenTone };

const TopClearedContext = createContext(false);

/** Scenes below a bar that already clears the status bar (the signed-in member shell). */
export function TopCleared({ cleared, children }: { cleared: boolean; children: ReactNode }) {
  return <TopClearedContext.Provider value={cleared}>{children}</TopClearedContext.Provider>;
}

export function useScreenTopInset(): number {
  const cleared = useContext(TopClearedContext);
  const top = useSafeAreaInsets().top;
  return cleared ? 0 : top;
}

export function ScreenTopSpacer() {
  const top = useScreenTopInset();
  return top > 0 ? <View pointerEvents="none" style={{ height: top }} testID="wsf-screen-top-spacer" /> : null;
}

export function ScreenStatusBar({ tone }: { tone: ScreenTone }) {
  const cleared = useContext(TopClearedContext);
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  // Under the member top bar the bar's own ground is behind the status bar: leave the icons to the shell.
  if (cleared) return null;
  return focused ? <StatusBar style={statusBarStyleFor(tone, STAGING_STRIP_UNDER_STATUS_BAR)} /> : null;
}
