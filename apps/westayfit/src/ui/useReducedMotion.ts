import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * The person's reduced-motion preference, whether it has been read yet, and
 * whether reading it definitely failed.
 *
 * WEB reads the media query synchronously, so the preference is known on the
 * first render and stays live through the query's change event. Unchanged.
 *
 * NATIVE can only ask AccessibilityInfo, which answers asynchronously:
 *
 *  - `known` is false until THIS mount's own query answers, or a change event
 *    reaches this mount. A caller that must not move for a reduced-motion user
 *    (NATIVE-MOTION-1, the Together receipt) waits for it.
 *  - `failed` is true when the query rejected and nothing has answered since,
 *    so such a caller can settle at once instead of waiting out a deadline.
 *    An unreadable preference is never treated as permission to move.
 *  - ORDER WINS. Every change event bumps a runtime-wide epoch; a query's
 *    answer that arrives after a change event it did not see is stale and is
 *    dropped — from this mount's state and from the runtime cache — so a late
 *    `isReduceMotionEnabled()` can never overwrite a newer change.
 *  - THE CACHE SEEDS, IT DOES NOT CERTIFY (decision for NATIVE-MOTION-1
 *    review item 8c). The last answer this runtime received seeds `reduced`
 *    on a new mount, so a reduced-motion user reads `true` from the first
 *    render; but `known` still waits for this mount's own answer. A cached
 *    `true` can therefore only make a caller hold still sooner; a cached
 *    `false` never lets one start moving early. The Together receipt keeps
 *    its 500 ms start deadline as the bound on that wait.
 */
export type ReducedMotionPreference = { reduced: boolean; known: boolean; failed: boolean };

const QUERY = '(prefers-reduced-motion: reduce)';

const hasMatchMedia = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/** The last answer AccessibilityInfo gave on this runtime (native path only). */
let lastNativeAnswer: boolean | null = null;
/** Bumped by every reduce-motion change event seen on this runtime (native path only). */
let nativeEpoch = 0;

function initialPreference(): ReducedMotionPreference {
  if (hasMatchMedia()) return { reduced: window.matchMedia(QUERY).matches, known: true, failed: false };
  return { reduced: lastNativeAnswer ?? false, known: false, failed: false };
}

export function useReducedMotionPreference(): ReducedMotionPreference {
  const [pref, setPref] = useState<ReducedMotionPreference>(initialPreference);

  useEffect(() => {
    const apply = (reduced: boolean) =>
      setPref((prev) =>
        prev.known && !prev.failed && prev.reduced === reduced ? prev : { reduced, known: true, failed: false }
      );

    if (hasMatchMedia()) {
      const mq = window.matchMedia(QUERY);
      const onChange = () => apply(mq.matches);
      mq.addEventListener?.('change', onChange);
      return () => mq.removeEventListener?.('change', onChange);
    }

    let active = true;
    const onChange = (reduced: boolean) => {
      nativeEpoch += 1;
      lastNativeAnswer = reduced;
      if (active) apply(reduced);
    };
    // Subscribe first, so a change while the query is in flight is never missed.
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', onChange);
    const askedAt = nativeEpoch;
    AccessibilityInfo.isReduceMotionEnabled().then(
      (reduced) => {
        // A change event arrived after this query was asked: it is newer than this answer.
        if (nativeEpoch !== askedAt) return;
        lastNativeAnswer = reduced;
        if (active) apply(reduced);
      },
      () => {
        if (active) setPref((prev) => (prev.known || prev.failed ? prev : { ...prev, failed: true }));
      }
    );
    return () => {
      active = false;
      // react-native-web returns nothing here when it has no media query (jsdom).
      sub?.remove?.();
    };
  }, []);

  return pref;
}

/**
 * True when the person has asked for reduced motion. Unchanged on the web.
 * On native it reads the last answer this runtime received (or `false` before
 * any) until AccessibilityInfo answers this mount.
 */
export function useReducedMotion(): boolean {
  return useReducedMotionPreference().reduced;
}
