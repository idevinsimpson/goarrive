import type { ReactElement, ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { wsfIsStaging } from './firebase';
import { StagingBanner } from './StagingBanner';

/**
 * NATIVE-INTEGRATOR-1 (INT-10). THE STAGING STRIP AND THE SCREENS BELOW IT.
 *
 * On a phone the strip (src/StagingBanner.tsx) paints behind the status bar
 * and ends below it. Two things follow, and only on a staging build:
 *
 *   1. THE STACK GETS ITS OWN SAFE-AREA PROVIDER. A provider reports the
 *      insets of its own frame, and this one starts below the strip, so the
 *      member top bar and every root-stack screen see a top inset of 0 and
 *      start directly under the strip. Before, each added the full inset again
 *      and a blank band of about 47-59 pt opened between strip and bar.
 *
 *   2. AN iOS MODAL REPEATS THE STRIP. iOS presents a `transparentModal`
 *      (MOVE, the contribution sheet, the Settings panel) over the full
 *      screen, covering the strip on exactly the screenshots it exists to
 *      mark. Inside such a screen the strip is drawn again at its top, in its
 *      own provider, and the screen's content sits in a provider below it, so
 *      it too starts under the strip. Android presents those screens inside
 *      the stack, below the strip, so it needs nothing.
 *
 * A production build has no strip, and both of these are the plain frame and
 * no layout, exactly as before. Web gets src/stagingShell.tsx.
 */

type ScreenLayout = (props: { options?: { presentation?: string }; children: ReactElement }) => ReactElement;

export function frameFor(staging: boolean) {
  return function StagingStackFrame({ children }: { children: ReactNode }) {
    if (!staging) return <View style={{ flex: 1 }}>{children}</View>;
    return (
      <SafeAreaProvider style={{ flex: 1 }} testID="wsf-staging-stack-frame">
        {children}
      </SafeAreaProvider>
    );
  };
}

export function screenLayoutFor(staging: boolean, platform: string): ScreenLayout | undefined {
  if (!staging || platform !== 'ios') return undefined;
  return function StagingModalLayout({ options, children }) {
    if (options?.presentation !== 'transparentModal') return children;
    return (
      <SafeAreaProvider testID="wsf-staging-modal-frame">
        <StagingBanner />
        <SafeAreaProvider style={{ flex: 1 }}>{children}</SafeAreaProvider>
      </SafeAreaProvider>
    );
  };
}

export const StagingStackFrame = frameFor(wsfIsStaging);

export const stagingScreenLayout: ScreenLayout | undefined = screenLayoutFor(wsfIsStaging, Platform.OS);
