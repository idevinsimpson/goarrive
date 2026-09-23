import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * REDUCED MOTION, ASKED OF THE PLATFORM RATHER THAN ASSUMED.
 *
 * On the web `AccessibilityInfo.isReduceMotionEnabled` reads the
 * `prefers-reduced-motion` media query, and on iOS and Android it reads the
 * system setting, so one hook covers every surface this shell runs on.
 *
 * The shell uses it to turn the MOVE sheet's slide OFF rather than to pick a
 * gentler slide. A member who has asked for less motion has asked for
 * less motion; the sheet still opens, still covers the tab, and still closes
 * back onto it, and the only thing they lose is the travel.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) setReduced(Boolean(v));
      })
      // A platform that cannot answer is not a platform that wants motion
      // removed; the default stands.
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduced(Boolean(v)));
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return reduced;
}
