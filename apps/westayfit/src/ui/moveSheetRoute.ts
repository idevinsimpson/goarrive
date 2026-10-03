import { isKioskFlag } from '../kioskSession';

/**
 * APP-FEEL-PARITY-1. IS THIS CONTRIBUTION FLOW MOVE'S SHEET, OR A PAGE?
 *
 * One question, asked in two places that must agree: the root stack decides
 * the presentation (`app/_layout.tsx`: a transparent modal over the tab, or an
 * ordinary opaque page) and the flow decides what to draw (a sheet with a
 * scrim and a Close, or a page with its wordmark and Back). If they disagreed
 * the member would get a sheet on an opaque cream ground, or a page with the
 * tab showing through it.
 *
 * It is MOVE's sheet when all three hold:
 *   · move mode: MOVE's own flow, not "Already moved?", which opens as the
 *     page it was accepted as;
 *   · not a kiosk: a shared device never sees a member's tabs, sheet or not;
 *   · what is directly beneath it is the member's tabs or the MOVE sheet.
 *     Nothing beneath (a cold or deep link) or a different screen beneath (an
 *     event screen, Goal Setup's receipt) keeps the page and its own way out.
 *
 * Decided from the stack as it stands when the flow opens. Nothing beneath a
 * route is ever removed while it is open, so the answer does not change under
 * the member.
 */

type RouteLike = { key: string; params?: object | undefined };
type StateLike = { routes: ReadonlyArray<{ key: string; name: string }> } | undefined;

export const MOVE_SHEET_BENEATH = new Set(['(tabs)', 'move/index']);

export function isMoveSheetRoute(route: RouteLike, state: StateLike): boolean {
  const params = (route.params ?? {}) as { mode?: unknown; kiosk?: unknown };
  if (params.mode !== 'move' || isKioskFlag(params.kiosk)) return false;
  const routes = state?.routes ?? [];
  const i = routes.findIndex((r) => r.key === route.key);
  if (i <= 0) return false;
  return MOVE_SHEET_BENEATH.has(routes[i - 1]!.name);
}

/**
 * APP-FEEL-PARITY-1 CHECKPOINT 3. IS THIS ROUTE OPENED DIRECTLY OVER THE
 * MEMBER'S TABS? The root stack presents Settings as a side panel exactly
 * then (`app/_layout.tsx`), and Settings draws a panel to match; opened any
 * other way -- a cold or deep link, a reload -- it stays the page it was.
 */
export function isOverMemberTabs(route: RouteLike, state: StateLike): boolean {
  const routes = state?.routes ?? [];
  const i = routes.findIndex((r) => r.key === route.key);
  return i > 0 && routes[i - 1]!.name === '(tabs)';
}
