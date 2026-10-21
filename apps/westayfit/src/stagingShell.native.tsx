import type { ReactElement, ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics, type Metrics } from 'react-native-safe-area-context';

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

/*
  FIRST-FRAME METRICS (#641 NB-5). A nested provider with no initialMetrics
  starts from its parent's insets and corrects itself after one native
  measurement, so the first frame below the strip would pad the full status
  bar and then jump. Each provider here starts from what it will measure:
  below the strip, the window's metrics with a top of 0; the modal's own
  frame (which starts at the top of the window), the window's metrics.
*/
const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
export function belowTheStrip(window: Metrics | null = initialWindowMetrics): Metrics {
  return {
    frame: window?.frame ?? { x: 0, y: 0, width: 0, height: 0 },
    insets: { ...(window?.insets ?? NO_INSETS), top: 0 },
  };
}

export function frameFor(staging: boolean) {
  return function StagingStackFrame({ children }: { children: ReactNode }) {
    if (!staging) return <View style={{ flex: 1 }}>{children}</View>;
    return (
      <SafeAreaProvider style={{ flex: 1 }} initialMetrics={belowTheStrip()} testID="wsf-staging-stack-frame">
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
      <SafeAreaProvider initialMetrics={initialWindowMetrics} testID="wsf-staging-modal-frame">
        <StagingBanner />
        <SafeAreaProvider style={{ flex: 1 }} initialMetrics={belowTheStrip()}>
          {children}
        </SafeAreaProvider>
      </SafeAreaProvider>
    );
  };
}

export const StagingStackFrame = frameFor(wsfIsStaging);

export const stagingScreenLayout: ScreenLayout | undefined = screenLayoutFor(wsfIsStaging, Platform.OS);
