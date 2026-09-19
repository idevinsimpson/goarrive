/**
 * The address a kiosk screen opens, built once so every control agrees.
 *
 * The same reasoning as `joinLink.ts`: the Champion copies a string, a QR
 * encodes a string, and a test asserts a string, so all three must come from
 * one place rather than three derivations that can drift apart.
 *
 * `/kiosk/<goalId>` already exists as a route and already has its Hosting
 * rewrite, so a copied link resolves on a cold load in a browser that has
 * never seen the app.
 */

export function buildKioskUrl(opts: {
  origin: string | null | undefined;
  goalId: string | null | undefined;
}): string | null {
  const { origin, goalId } = opts;
  if (!origin) return null;
  const id = goalId?.trim();
  if (!id) return null;
  return `${origin.replace(/\/+$/, '')}/kiosk/${encodeURIComponent(id)}`;
}

/**
 * The origin this build is actually being served from, or null off-web.
 * Kept here so a caller never reaches for `window` directly and never has to
 * remember that server rendering has no location.
 */
export function currentOrigin(): string | null {
  if (typeof window === 'undefined') return null;
  return window.location?.origin ?? null;
}
