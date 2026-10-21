import { useEffect, useLayoutEffect, useRef, type MutableRefObject, type ReactNode } from 'react';
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
 * A FADE NEVER OUTLIVES ITS TAB'S FOCUS. Every visited tab stays mounted
 * (`freezeOnBlur: false`), so a scene left mid-fade is stopped and set straight
 * to full opacity when it blurs, reduced motion turned on mid-fade ends it at
 * once, and unmounting stops it: a fast Home → Community → Progress leaves
 * every scene at full opacity.
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
  const running = useRef<Animated.CompositeAnimation | null>(null);

  const stop = () => {
    running.current?.stop();
    running.current = null;
  };

  // A layout effect, so the new tab's first painted frame is already faded.
  useLayoutEffect(() => {
    if (selectedKey !== routeKey) {
      // Blurred: never left part-faded.
      stop();
      opacity.setValue(1);
      return;
    }
    const previous = lastSelected.current;
    lastSelected.current = routeKey;
    if (!tabFadeOnSelect({ previous, routeKey, reducedMotion })) {
      // Reduced motion asked for while this scene is fading: end it at once.
      if (reducedMotion) {
        stop();
        opacity.setValue(1);
      }
      return;
    }
    // No running fade to stop here: a scene starts one only after it blurred
    // (which stopped any) or on its first selection (which does not fade).
    opacity.setValue(TAB_FADE_FROM);
    const fade = Animated.timing(opacity, {
      toValue: 1,
      duration: TAB_FADE_MS,
      easing: Easing.bezier(...TAB_FADE_EASING),
      useNativeDriver: true,
    });
    running.current = fade;
    fade.start(({ finished }) => {
      if (finished && running.current === fade) running.current = null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, routeKey, lastSelected, reducedMotion]);

  // No fade outlives the scene.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => stop(), []);

  return (
    <Animated.View style={{ flex: 1, opacity }} testID="wsf-tab-scene-native">
      {children}
    </Animated.View>
  );
}
