import { useEffect, useRef } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';

/**
 * INT-18 (W12-7) — ONE WAY TO TELL A SCREEN READER THAT SOMETHING CHANGED,
 * on iOS and Android.
 *
 * iOS VoiceOver ignores live regions, and an Android live region beside an
 * explicit announcement would speak twice; so on native `liveRegion` is empty
 * and the site speaks through `useAnnounce`. The web twin (`announce.ts`)
 * keeps `aria-live="polite"` and does nothing in `useAnnounce`.
 *
 * The rule is the one the Together receipt has kept since NATIVE-MOTION-1
 * (src/ui/TogetherCompletion.tsx, `speakAnnouncement` and its effect):
 *   · ONCE PER KEY. A key is spoken once for as long as it stays the key: a
 *     re-render, a new wording of the same message or React StrictMode's
 *     development re-run does not speak it again. A different key is a new
 *     announcement and is spoken (returning to an earlier key after another
 *     one counts as new). A null or undefined key, or an empty message, means
 *     nothing is owed yet; it is spoken when both are there.
 *   · ONLY IN THE FOREGROUND. A screen reader drops speech posted while the
 *     app is in the background or inactive, so then it waits and is spoken on
 *     the first `active`. Any other state (`active`, or `unknown` before iOS
 *     has reported one) speaks at once, so nothing waits for an `active` that
 *     has already happened.
 *   · QUEUED. `announceForAccessibilityWithOptions(message, { queue: true })`
 *     waits behind current speech on iOS; React Native routes Android to its
 *     plain announcement.
 *   · CANCELLED ON UNMOUNT. A screen that goes away before the app is active
 *     again says nothing.
 * The latest message for the key is the one spoken. `onSpoken` is called once,
 * when it has been posted.
 */

/** The props a live region spreads: `aria-live="polite"` on the web, nothing on native. */
export type LiveRegionProps = Readonly<{ 'aria-live'?: 'polite' }>;

/**
 * What identifies one announcement: the same key is spoken once, a new key is
 * spoken again; null or undefined means nothing is owed.
 */
export type AnnounceKey = string | number | null | undefined;

export const liveRegion: LiveRegionProps = Object.freeze({});

/** A screen reader drops speech posted in these states. */
const waitsForForeground = (state: string | null | undefined): boolean => state === 'background' || state === 'inactive';

function post(message: string): void {
  const withOptions = (AccessibilityInfo as { announceForAccessibilityWithOptions?: unknown })
    .announceForAccessibilityWithOptions;
  if (typeof withOptions === 'function') {
    AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
  } else {
    AccessibilityInfo.announceForAccessibility(message);
  }
}

export function useAnnounce(message: string | null | undefined, key: AnnounceKey, onSpoken?: () => void): void {
  // The key last spoken, boxed so that no key at all is distinguishable.
  const spoken = useRef<{ key: AnnounceKey } | null>(null);
  const spokenCallback = useRef(onSpoken);
  spokenCallback.current = onSpoken;

  // Re-run for a new key, and for a new message while one is still waiting
  // (so the latest is the one spoken); a key already spoken stops here.
  useEffect(() => {
    if (key === null || key === undefined || !message) return undefined;
    if (spoken.current?.key === key) return undefined;
    const say = () => {
      spoken.current = { key };
      try {
        post(message);
      } catch {
        // Announcing is a courtesy; what changed is on screen either way.
      }
      spokenCallback.current?.();
    };
    if (!waitsForForeground(AppState.currentState)) {
      say();
      return undefined;
    }
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      sub?.remove?.();
      say();
    });
    return () => sub?.remove?.();
  }, [key, message]);
}
