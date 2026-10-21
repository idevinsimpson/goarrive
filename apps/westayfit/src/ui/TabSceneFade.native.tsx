import { useLayoutEffect, useRef, type MutableRefObject, type ReactNode } from 'react';
import { Animated, Easing } from 'react-native';

import { TAB_FADE_EASING, TAB_FADE_FROM, TAB_FADE_MS, tabFadeOnSelect } from './tabFade';

/**
 * MO-04 — A TAB CHANGE ON iOS AND ANDROID: THE NEW TAB'S CONTENT FADES IN.
 *
 * The native twin of TabSceneFade.tsx (which Metro keeps for the web, where
 * the fade is a CSS keyframe). Same decision, same numbers (src/ui/tabFade.ts):
 * the entering tab's content goes from 0.35 opacity to full over 140 ms,
 * ease-out, on the native driver; the navigator itself swaps tabs instantly
 * (`animation: 'none'`), so nothing of the leaving tab is ever seen through it.
 *
 * Only a change of tab fades — not the first tab, not a reselect, not a return
 * from MOVE or Settings (the selected tab did not change, so the effect does
 * not run). Reduced motion: no fade.
 *
 * A FADE NEVER OUTLIVES THE EFFECT THAT STARTED IT. Every visited tab stays
 * mounted (`freezeOnBlur: false`), so the fade is the effect's to clean up:
 * when the scene blurs, when reduced motion is turned on, when it unmounts --
 * and when React StrictMode re-runs the effect in development -- the fade is
 * stopped and the scene set straight to full opacity. A fast Home → Community
 * → Progress leaves every scene at full opacity, and no scene is ever left
 * part-faded.
 */
export function TabSceneFade({
  routeKey,
  selectedKey,
  lastSelected,
  reducedMotion,
  children,
}: {
  routeKey: string;
  selectedKey: string | undefined;
  lastSelected: MutableRefObject<string | null>;
  reducedMotion: boolean;
  children: ReactNode;
}) {
  const opacityRef = useRef<Animated.Value | null>(null);
  if (opacityRef.current === null) opacityRef.current = new Animated.Value(1);
  const opacity = opacityRef.current;

  // A layout effect, so the new tab's first painted frame is already faded.
  useLayoutEffect(() => {
    if (selectedKey !== routeKey) return undefined;
    const previous = lastSelected.current;
    lastSelected.current = routeKey;
    if (!tabFadeOnSelect({ previous, routeKey, reducedMotion })) return undefined;
    opacity.setValue(TAB_FADE_FROM);
    const fade = Animated.timing(opacity, {
      toValue: 1,
      duration: TAB_FADE_MS,
      easing: Easing.bezier(...TAB_FADE_EASING),
      useNativeDriver: true,
    });
    fade.start();
    // Blurred, reduced motion asked for, unmounted, or re-run by StrictMode:
    // stopped, and never left part-faded.
    return () => {
      fade.stop();
      opacity.setValue(1);
    };
  }, [selectedKey, routeKey, lastSelected, reducedMotion, opacity]);

  return (
    <Animated.View style={{ flex: 1, opacity }} testID="wsf-tab-scene-native">
      {children}
    </Animated.View>
  );
}
