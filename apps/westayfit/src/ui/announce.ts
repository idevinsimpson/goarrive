/**
 * INT-18 (W12-7) — ONE WAY TO TELL A SCREEN READER THAT SOMETHING CHANGED.
 *
 * The web build's twin. Metro resolves `announce.native.ts` on iOS and
 * Android.
 *
 * On the web a polite live region already does this: the browser reads a
 * region marked `aria-live="polite"` when its text changes, and every site
 * that announces an outcome is such a region today. So here `liveRegion` is
 * exactly that attribute (spread it where the site had `aria-live="polite"`;
 * the DOM is unchanged) and `useAnnounce` does nothing, because the region
 * speaks.
 *
 * On a phone the live region is not enough (iOS ignores it, and Android's
 * would speak twice beside an explicit announcement), so the native twin
 * gives an empty `liveRegion` and speaks through `useAnnounce` instead.
 */

/** The props a live region spreads: `aria-live="polite"` on the web, nothing on native. */
export type LiveRegionProps = Readonly<{ 'aria-live'?: 'polite' }>;

/**
 * What identifies one announcement: the same key is spoken once, a new key is
 * spoken again; null or undefined means nothing is owed.
 */
export type AnnounceKey = string | number | null | undefined;

export const liveRegion: LiveRegionProps = Object.freeze({ 'aria-live': 'polite' as const });

/**
 * Speak `message` once per `key` (native only). On the web the live region
 * the site spreads speaks instead, so this does nothing and `onSpoken` is
 * never called.
 */
export function useAnnounce(_message: string | null | undefined, _key: AnnounceKey, _onSpoken?: () => void): void {}
