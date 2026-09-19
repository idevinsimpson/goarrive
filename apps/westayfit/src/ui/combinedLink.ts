/**
 * The address a combined movement goal's screen opens, built once so every
 * control agrees.
 *
 * The same reasoning as `joinLink.ts`, `kioskLink.ts` and `eventLinks.ts`: the
 * Champion copies a string, a button opens a string and a test asserts a
 * string, so all three come from ONE derivation rather than three that can
 * drift apart.
 *
 * `/combined/<setupId>` is a top-level route with its own Hosting rewrite, so
 * a copied link resolves on a cold load in a browser that has never seen the
 * app. It is deliberately NOT nested under `/kiosk/`: `/kiosk/**` already
 * rewrites to the single-goal kiosk page, so a nested route would need its own
 * rewrite ordered ahead of that one and would export an alias path the build
 * refuses.
 *
 * THE STANDING RULE: no secret, no token and no administrative authority ever
 * rides in a URL. `setupId` is a Firestore document name — it is not derived
 * from a uid, a membership, a join code or a session, and possession of it
 * changes nothing. Every read re-evaluates the server-side gate on its merits,
 * and an unauthorized caller gets the byte-identical answer an unknown id gets.
 */

import { currentOrigin } from './kioskLink';

// One definition of "the origin this build is actually served from", shared
// rather than copied, so a Champion's copied link can never be assembled from
// a second idea of where the app lives.
export { currentOrigin };

/** `/combined/<setupId>` — the public, read-only combined screen. */
export function combinedRoute(setupId: string): string {
  return `/combined/${encodeURIComponent(setupId)}`;
}

/**
 * The absolute address of the combined screen, or null when the origin or the
 * id is missing. Null is a real answer: the caller shows the control only when
 * there is an address for it to act on.
 */
export function buildCombinedUrl(opts: {
  origin: string | null | undefined;
  setupId: string | null | undefined;
}): string | null {
  const { origin } = opts;
  if (!origin) return null;
  const id = opts.setupId?.trim();
  if (!id) return null;
  return `${origin.replace(/\/+$/, '')}${combinedRoute(id)}`;
}
