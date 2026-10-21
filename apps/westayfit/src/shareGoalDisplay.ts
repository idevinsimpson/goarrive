/**
 * W7 SOCIAL — sharing ONE thing: the public display link.
 *
 * The only artefact in this product that is safe to hand to someone outside the
 * community is the public display of a goal whose aggregate the Champion has
 * authorized. It carries the community name, the goal, its period and the
 * shared progress — and never an individual contribution or a member name.
 * Every other link (Community Home, a contribution screen, the join link) is
 * either member-gated or an admission credential, so none of them is offered
 * here.
 *
 * There is no friend graph, no recipient list and no invitation in any of this.
 * The control hands the URL to the operating system's share sheet, or to the
 * clipboard, and stops. Where the link goes afterwards is the member's business
 * and this application never learns it.
 *
 * Pure on purpose: every rule below is decided without a DOM, so the decision
 * that puts the control on screen is unit-tested directly rather than inferred
 * from a rendered page. (The one default below reads the current origin; every
 * rule takes it as an argument.)
 */
import { configuredInviteHosts } from './joinInput';
import { currentOrigin } from './ui/kioskLink';

/**
 * Which mechanism this platform can actually offer, in preference order.
 * `nativeShare` is the app's: the operating system's share sheet through React
 * Native's Share API (NATIVE-MEMBER-1 F-3, MF-01; src/ui/shareLink.native.ts).
 */
export type ShareRoute = 'nativeShare' | 'webShare' | 'clipboard' | 'unavailable';

/** The development forwarders' domains (src/joinInput.ts), re-exported for the share rule's readers. */
export { DEV_TUNNEL_DOMAINS } from './joinInput';

/**
 * NATIVE-MEMBER-1 F-3 (MF-01). The only kind of link the app hands to the
 * clipboard or a share sheet: absolute https, a host and no port, no
 * credentials, no whitespace. A development build's origin is the Metro
 * server (`http://<lan-ip>:8081`, or with `--tunnel`
 * `https://<id>-8081.exp.direct`), and a link built on it would point a
 * stranger at somebody's laptop; a release build without a configured public
 * origin has none at all (INT-08). These are refused, so the controls are not
 * offered rather than offered with a link that cannot work.
 *
 * HOST: FAIL CLOSED (reviews F3-N2, NB-1, NB-A, NB-B). The host must be one
 * of the canonical hosts configured in `EXPO_PUBLIC_WSF_INVITE_HOSTS`
 * (`configuredInviteHosts`, src/joinInput.ts), exactly -- and those are only
 * ever public host names that are not a local name or a development
 * forwarder. With nothing configured (today), or a value none of whose
 * entries is usable, NOTHING is shareable in the app. No list of tunnel,
 * loopback-in-DNS or LAN names can be complete (localtest.me, *.devtunnels.ms,
 * *.ts.net, a router's .lan ...), and a dev client loaded through any of them
 * has an https origin with no port; a release build has no origin at all
 * today, so failing closed costs nothing. Used only for the app: the web
 * helper (shareLink.ts) never asks.
 */
export function isShareableHttpsUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const shape = /^https:\/\/([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?:\/[^\s]*)?$/.exec(url);
  if (!shape) return false;
  const host = shape[1]!.toLowerCase();
  const canonical = configuredInviteHosts(process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS);
  return canonical !== null && canonical.includes(host);
}

/** The visible state of the fallback control, mirroring the invite control. */
export type ShareStatus = 'idle' | 'copied' | 'failed';

/**
 * Said before the link leaves, not after. It states both halves of the
 * privacy contract: what a stranger with this link CAN see, and what no one
 * with this link can see. It claims nothing about a screenshot someone has
 * already taken, which this application cannot reach.
 */
export const SHARE_DISCLOSURE =
  'Anyone with this link can see the shared progress — never who contributed.';

/**
 * The public display URL for a goal, derived from the origin the member is
 * already on. `/display/**` is a real route on this host (it is rewritten to
 * the exported display document by Hosting), so the link resolves for a
 * signed-out stranger exactly as a wall display does.
 *
 * Returns null rather than a guess when there is no usable origin (server
 * render, native) or no goal id: a half-built URL must never be shared.
 */
export function displayShareUrl(
  origin: string | null | undefined,
  goalId: string | null | undefined
): string | null {
  if (typeof origin !== 'string' || typeof goalId !== 'string') return null;
  const base = origin.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/i.test(base)) return null;
  const id = goalId.trim();
  if (!id) return null;
  return `${base}/display/${encodeURIComponent(id)}`;
}

/**
 * Whether this goal may be shared at all.
 *
 * TWO conditions, both required, both about the goal rather than the viewer:
 *
 *  1. The aggregate is authorized for public display. Without that the display
 *     route refuses the goal, so the link would be a dead end, and — more to
 *     the point — nothing has been published, so there is nothing to share.
 *  2. The community is not sample data. wsfGoalPulse refuses the display route
 *     for a sample group whatever the goal's permission says, so a shared
 *     sample link would show a stranger nothing at all. The same qualifier the
 *     Champion's permission card already states.
 */
export function canShareGoalDisplay(
  goal: { aggregateDisplayAuthorized?: boolean } | null | undefined,
  community: { isSample?: boolean } | null | undefined
): boolean {
  if (!goal || goal.aggregateDisplayAuthorized !== true) return false;
  return community?.isSample !== true;
}

/**
 * Which mechanism to use, decided from the navigator that is actually present.
 *
 * `navigator.share` first, because on a phone it opens the real share sheet the
 * member already knows. Where it does not exist — every desktop browser that
 * has not shipped it — this falls back to the clipboard path the invite
 * control already uses. Where neither exists there is no honest control to
 * draw, and the caller renders nothing rather than a button that cannot work.
 */
export function shareRoute(nav: unknown, origin: string | null = currentOrigin()): ShareRoute {
  if (!nav || typeof nav !== 'object') return 'unavailable';
  const candidate = nav as { product?: unknown; share?: unknown; clipboard?: { writeText?: unknown } | null };
  // React Native's navigator is `{ product: 'ReactNative' }`: no Web Share and
  // no clipboard. The app shares through the OS share sheet, and only when the
  // link it would share is absolute https -- so in a development build (Metro
  // origin) or a release build with no public origin, there is no control.
  if (candidate.product === 'ReactNative') {
    return isShareableHttpsUrl(origin) ? 'nativeShare' : 'unavailable';
  }
  if (typeof candidate.share === 'function') return 'webShare';
  const clipboard = candidate.clipboard;
  if (clipboard && typeof clipboard === 'object' && typeof clipboard.writeText === 'function') {
    return 'clipboard';
  }
  return 'unavailable';
}

/**
 * The label on the control. In the Web Share route the sheet itself explains
 * what is about to happen, so the label stays "Share". In the clipboard route
 * the control says what it actually does, and confirms with the same "Copied"
 * the invite control uses, so the two behave identically.
 */
export function shareControlLabel(route: ShareRoute, status: ShareStatus): string {
  if (route === 'webShare' || route === 'nativeShare') return 'Share';
  if (status === 'copied') return 'Copied';
  if (status === 'failed') return 'Copy failed — try again';
  return 'Copy display link';
}
