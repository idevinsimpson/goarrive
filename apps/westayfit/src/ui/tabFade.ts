/**
 * MO-04 — the tab fade's numbers and its one decision, for the NATIVE tab
 * scene (TabSceneFade.native.tsx). The web keeps its own copy inside
 * TabSceneFade.tsx (a CSS keyframe), byte-identical; these are the same values.
 *
 * The reference (Lovable `e15b9fa0…` at frozen product `a15a610e`, styles.css
 * MOTION-FEEL-1, --dur-tab): the entering tab fades from 0.35 opacity to full
 * over 140 ms, ease-out — "a quiet fade only (no lift/bounce)".
 */
import { TAB_FADE_MS } from './sheetMotion';

export { TAB_FADE_MS };
/** The entering tab's starting opacity. */
export const TAB_FADE_FROM = 0.35;
/** CSS `ease-out`, as numbers: cubic-bezier(0, 0, 0.58, 1). */
export const TAB_FADE_EASING = [0, 0, 0.58, 1] as const;

/**
 * Whether selecting `routeKey` fades its scene in. Only a CHANGE of tab fades:
 * not the first tab of a session (`previous` null), not a reselect of the same
 * tab, and not a return from a page, a sheet or Settings (the selected tab did
 * not change, so this is never asked). Reduced motion: never.
 */
export function tabFadeOnSelect(input: { previous: string | null; routeKey: string; reducedMotion: boolean }): boolean {
  return input.previous !== null && input.previous !== input.routeKey && !input.reducedMotion;
}
