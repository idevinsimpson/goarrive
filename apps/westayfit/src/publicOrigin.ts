import { isDevTunnelHost, isPublicHost } from './publicHost';

/**
 * W12-13 (INT-08 preparation, ST-01). THE ORIGIN A PHONE BUILD NAMES.
 *
 * On the web a QR code or a share link is built from the address the page is
 * served from (`window.location.origin`). A phone has no such address: a
 * release build has no `window.location` at all, and a development build's is
 * the Metro server on the developer's machine. So a phone build names its
 * public origin at build time, in `EXPO_PUBLIC_WSF_PUBLIC_ORIGIN`, and nothing
 * else is used. It stays unset until the owner names the host; until then a
 * phone builds no QR code or share link from an origin, as today.
 *
 * ONE NAME, TWO CONSUMERS (heads-14 RV16-641-3). The same variable already
 * sets the WEB build's share metadata (og:url, og:image, the canonical link):
 * scripts/westayfit/inject_meta.py reads it first when `npm run build:web`
 * runs. Its check there is looser (any dotted host name: an IP-shaped name or
 * a tunnel host passes), so one owner decision sets both, and a value refused
 * here can still reach the web's share cards. Name only the canonical public
 * origin (NATIVE-BUILD-READINESS.md, "Public origin").
 *
 * ACCEPTED: `https://<host>`, optionally with one trailing slash, where the
 * host is a public DNS name (`isPublicHost`) and not a development forwarder
 * (`isDevTunnelHost`). Refused (null): unset or blank, http, a port (`:8081`
 * included), a user, a path, a query or fragment, an IP address, a single
 * label, a local or LAN name, a tunnel.
 */
const HTTPS_ORIGIN = /^https:\/\/([^/?#@:\s]+)\/?$/i;

/** The canonical origin `value` names, lower-cased with no trailing slash, or null. */
export function publicOriginOf(value: string | undefined): string | null {
  const m = HTTPS_ORIGIN.exec((value ?? '').trim());
  if (!m) return null;
  const host = m[1]!.toLowerCase();
  if (!isPublicHost(host) || isDevTunnelHost(host)) return null;
  return `https://${host}`;
}

/**
 * This build's configured public origin, or null. Expo inlines
 * `process.env.EXPO_PUBLIC_*` at build time only when it is written out in
 * full, as here.
 */
export function configuredPublicOrigin(): string | null {
  return publicOriginOf(process.env.EXPO_PUBLIC_WSF_PUBLIC_ORIGIN);
}
