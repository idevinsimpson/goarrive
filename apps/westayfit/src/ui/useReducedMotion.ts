import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * The person's reduced-motion preference, and whether it has been read yet.
 *
 * Web reads the media query synchronously, so the preference is known on the
 * first render (react-native-web's AccessibilityInfo does the same, but
 * subscribing here keeps the value live).
 *
 * Native can only ask AccessibilityInfo, which answers asynchronously. Until
 * it answers, `known` is false, so a caller that must not move for a
 * reduced-motion user (NATIVE-MOTION-1, the Together receipt) can wait rather
 * than start on a guessed `false`. An answer that never comes, or a query that
 * fails, leaves `known` false: an unreadable preference is never treated as
 * permission to move.
 */
export type ReducedMotionPreference = { reduced: boolean; known: boolean };

const QUERY = '(prefers-reduced-motion: reduce)';

const hasMatchMedia = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/**
 * The last answer AccessibilityInfo gave on this runtime (native path only).
 * The root layout keeps a subscriber mounted for the app's lifetime, so a
 * screen mounted later starts from the known value instead of waiting for a
 * second round trip. Every mount still re-asks and keeps listening.
 */
let lastNativeAnswer: boolean | null = null;

function initialPreference(): ReducedMotionPreference {
  if (hasMatchMedia()) return { reduced: window.matchMedia(QUERY).matches, known: true };
  return lastNativeAnswer == null ? { reduced: false, known: false } : { reduced: lastNativeAnswer, known: true };
}

export function useReducedMotionPreference(): ReducedMotionPreference {
  const [pref, setPref] = useState<ReducedMotionPreference>(initialPreference);

  useEffect(() => {
    const apply = (reduced: boolean) =>
      setPref((prev) => (prev.known && prev.reduced === reduced ? prev : { reduced, known: true }));

    if (hasMatchMedia()) {
      const mq = window.matchMedia(QUERY);
      const onChange = () => apply(mq.matches);
      mq.addEventListener?.('change', onChange);
      return () => mq.removeEventListener?.('change', onChange);
    }
    let active = true;
    const answer = (v: boolean) => {
      lastNativeAnswer = v;
      if (active) apply(v);
    };
    AccessibilityInfo.isReduceMotionEnabled()
      .then(answer)
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', answer);
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
 * A caller that must not start motion before the answer uses
 * `useReducedMotionPreference` and waits for `known`.
 */
export function useReducedMotion(): boolean {
  return useReducedMotionPreference().reduced;
}
