/**
 * W12-13 (INT-08 preparation). THE PUBLIC-HOST RULES, IN ONE PLACE.
 *
 * Copied verbatim from the member lane's src/joinInput.ts
 * (origin/claude/wsf-native-member-1 at 695ed63f, lines 69-118 and 150-158:
 * PUBLIC_HOST, NON_PUBLIC_SUFFIXES, DEV_TUNNEL_DOMAINS, isDevTunnelHost and
 * isPublicHost), not ported with the rest of that module: joinInput.ts imports
 * currentOrigin from src/ui/kioskLink, and currentOrigin now needs these rules,
 * which would be an import cycle. The member lane switches joinInput.ts to
 * import them from here, so the rules have one source. Change them here.
 *
 * This module imports nothing: app.config.js compiles it in memory at build
 * time (src/publicOrigin.ts, the INT-08 build checks).
 */

/**
 * A plain public DNS name: at least two labels, the last starting with a
 * letter. No port, IP literal, wildcard, single label or trailing dot.
 */
const PUBLIC_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/**
 * Names that never resolve on the public internet: the special-use names
 * (RFC 6761: .localhost, .test, .invalid, .example; RFC 6762: .local; RFC
 * 7686: .onion; RFC 8375: home.arpa; RFC 9476: .alt; ICANN's .internal) and
 * the undelegated names home and office routers hand out (.localdomain, .lan,
 * .home, fritz.box). Whole labels: `wsf.example.com` is not under `example`.
 * RV16-641-2 (heads-14) added test, invalid, example, onion and alt.
 */
const NON_PUBLIC_SUFFIXES = [
  'localhost',
  'local',
  'internal',
  'home.arpa',
  'localdomain',
  'lan',
  'home',
  'fritz.box',
  'test',
  'invalid',
  'example',
  'onion',
  'alt',
] as const;

/**
 * Domains that put a development machine on a public-looking https name:
 * the ones `expo start --tunnel` uses (Expo's tunnel host and the ngrok
 * domains it has used), other tunnel and port-forwarding services
 * (Cloudflare quick tunnels, localtunnel, localhost.run, serveo, Microsoft
 * dev tunnels, GitHub Codespaces, Tailscale, Pinggy) and the DNS names that
 * point back at the caller or name an IP address (localtest.me, lvh.me,
 * nip.io, sslip.io). Never a canonical We Stay Fit host.
 */
export const DEV_TUNNEL_DOMAINS = [
  'exp.direct',
  'exp.host',
  'ngrok.io',
  'ngrok.app',
  'ngrok-free.app',
  'ngrok.dev',
  'ngrok-free.dev',
  'trycloudflare.com',
  'loca.lt',
  'localtunnel.me',
  'lhr.life',
  'localhost.run',
  'serveo.net',
  'devtunnels.ms',
  'app.github.dev',
  'ts.net',
  'pinggy.link',
  'localtest.me',
  'lvh.me',
  'nip.io',
  'sslip.io',
] as const;

/** Whether `host` is under a development forwarder's domain (whole labels). */
export function isDevTunnelHost(host: string): boolean {
  const h = host.toLowerCase();
  return DEV_TUNNEL_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`));
}

/**
 * Whether `host` (no scheme or port) is a public DNS name: PUBLIC_HOST's
 * shape, and not under a special-use local name. `localhost`, `10.0.2.2`, a
 * LAN address or `laptop.local` are not.
 */
export function isPublicHost(host: string): boolean {
  const h = host.toLowerCase();
  return PUBLIC_HOST.test(h) && !NON_PUBLIC_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
}
