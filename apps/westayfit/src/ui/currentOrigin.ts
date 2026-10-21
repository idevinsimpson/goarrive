/**
 * The origin this build is actually being served from, or null without one
 * (server rendering has no location). The web's twin: what the page's
 * address bar says. On iOS and Android Metro picks `currentOrigin.native.ts`,
 * which never reads `window.location` (W12-13, INT-08).
 */
export function currentOrigin(): string | null {
  if (typeof window === 'undefined') return null;
  return window.location?.origin ?? null;
}
