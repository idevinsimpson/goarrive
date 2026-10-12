import { useEffect, useLayoutEffect, useState, type MutableRefObject, type ReactNode } from 'react';
import { View } from 'react-native';

import { ensureSheetMotionCss, TAB_FADE_MS } from './sheetMotion';

/**
 * APP-FEEL-PARITY-1 CHECKPOINT 3. A TAB CHANGE: THE OLD TAB IS GONE, THE NEW
 * ONE FADES IN OVER THE APP'S OWN GROUND.
 *
 * The reference (Lovable `e15b9fa0…` at frozen product `a15a610e`, styles.css
 * MOTION-FEEL-1) hides the leaving tab outright (`section[hidden]` is
 * `display: none`) and fades only the entering one, from 0.35 opacity to full
 * over 140 ms, ease-out: "a quiet fade only (no lift/bounce)".
 *
 * WHY NOT THE NAVIGATOR'S OWN `fade`. On the web every visited tab stays laid
 * out, and a tab is hidden by the focused tab's opaque ground lying over it.
 * The navigator's fade animates that ground, so for the length of the fade the
 * ground is translucent and the leaving tab shows through it: two screens of
 * text on top of each other (this checkpoint's first build, `a8d117da`). Here
 * the navigator swaps tabs instantly and only the CONTENT inside the entering
 * tab's opaque ground fades, so nothing of the leaving tab is ever seen.
 *
 * IT FADES ON A TAB CHANGE AND ON NOTHING ELSE. `lastSelected` is the shell's
 * record of which tab was last selected: the first tab of a session does not
 * fade, reselecting the current tab does not fade, and neither does coming
 * back to the tabs from a page, a sheet or the Settings panel, because the
 * selected tab did not change. The attribute is removed once the fade has
 * run, so nothing replays it later; the two names (`a`/`b`) restart it if the
 * member changes tab again mid-fade. Reduced motion: no fade.
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
  const [run, setRun] = useState(0);

  // A layout effect, so the new tab's first painted frame is already faded.
  useLayoutEffect(() => {
    if (selectedKey !== routeKey) return;
    const previous = lastSelected.current;
    lastSelected.current = routeKey;
    if (previous === null || previous === routeKey || reducedMotion) return;
    ensureSheetMotionCss();
    setRun((n) => n + 1);
  }, [selectedKey, routeKey, lastSelected, reducedMotion]);

  useEffect(() => {
    if (!run) return;
    const done = setTimeout(() => setRun(0), TAB_FADE_MS + 60);
    return () => clearTimeout(done);
  }, [run]);

  const phase = run === 0 ? 'rest' : run % 2 ? 'a' : 'b';
  return (
    <View style={{ flex: 1 }} {...({ dataSet: { wsfTabScene: phase } } as Record<string, unknown>)}>
      {children}
    </View>
  );
}
