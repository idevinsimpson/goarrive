/**
 * NATIVE-MEMBER-1 F-2 (MF-02). WHAT A MEMBER MAY PASTE INTO "JOIN WITH A CODE".
 *
 * The code itself is never shown as text anywhere in the product: a Champion
 * hands out the invite LINK (`https://<host>/join/<code>`, or the QR that
 * encodes it). On the web the link opens the join preview by itself; in the
 * app it often cannot (INT-03), so the member pastes it into Home's field —
 * which used to accept only a bare code and called the link "not a valid
 * code". This reads either, and nothing else.
 *
 * ACCEPTED, after trimming surrounding whitespace:
 *   · a bare code: 16..128 of `[A-Za-z0-9_-]` (the server mints 22-character
 *     base64url codes; the same shape as `pendingJoinCode.ts` and
 *     `wsfPreviewCommunity`);
 *   · an `http:`, `https:` or `westayfit:` URL whose path is EXACTLY
 *     `/join/<code>`, optionally with one trailing slash. For the app scheme
 *     both `westayfit://join/<code>` and `westayfit:///join/<code>` are that
 *     path.
 *
 * FROM THE QUERY ONLY `event` AND `activity` ARE KEPT (the event QR's two
 * parameters), each decoded once and re-encoded with `encodeURIComponent`, so
 * nothing in a pasted link can add a parameter, a path segment or a fragment
 * to the in-app route. The join screen still screens both values itself
 * (`readEventParam`, `readActivityLabel`); this only carries them.
 *
 * WHY A HAND-WRITTEN GRAMMAR AND NOT `new URL()`. React Native's URL is
 * partial (several getters throw "not implemented") and differs from the
 * browser's, so the same input could parse differently on the two platforms.
 * This is pure string work: the same answer on web, iOS and Android, and the
 * one tested here. The host is never navigated to, only checked for shape —
 * the code is looked up by the app, not by the address it came in.
 */

/** The longest input worth reading; an invite link is far shorter. */
export const JOIN_INPUT_MAX = 2048;

const CODE = /^[A-Za-z0-9_-]{16,128}$/;
/** scheme://authority path ?query #fragment, with no whitespace anywhere. */
const URL_SHAPE = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#.*)?$/;
/** A DNS name or IPv4 literal, or a bracketed IPv6 literal, with an optional port. No userinfo. */
const HOST = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.?|\[[0-9A-Fa-f:.]{2,45}\])(?::\d{1,5})?$/;
const JOIN_PATH = /^\/join\/([A-Za-z0-9_-]{16,128})\/?$/;
const KEPT_PARAMS = ['event', 'activity'] as const;
type KeptParam = (typeof KEPT_PARAMS)[number];

export type JoinInput = {
  code: string;
  /** The in-app route to open: `/join/<code>`, plus the kept parameters. */
  href: string;
  event?: string;
  activity?: string;
};

/** One query value, decoded the way a browser reads a query (`+` is a space); null if malformed or empty. */
function decodeValue(raw: string): string | null {
  try {
    const value = decodeURIComponent(raw.replace(/\+/g, ' '));
    return value === '' ? null : value;
  } catch {
    return null;
  }
}

function keptParams(query: string | undefined): Partial<Record<KeptParam, string>> {
  const kept: Partial<Record<KeptParam, string>> = {};
  if (!query) return kept;
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const key = pair.slice(0, eq);
    const name = KEPT_PARAMS.find((k) => k === key);
    if (!name || kept[name] !== undefined) continue; // the first one wins
    const value = decodeValue(pair.slice(eq + 1));
    if (value !== null) kept[name] = value;
  }
  return kept;
}

function routeFor(code: string, kept: Partial<Record<KeptParam, string>>): JoinInput {
  const query: string[] = [];
  for (const name of KEPT_PARAMS) {
    const value = kept[name];
    if (value !== undefined) query.push(`${name}=${encodeURIComponent(value)}`);
  }
  return {
    code,
    href: `/join/${code}${query.length ? `?${query.join('&')}` : ''}`,
    ...kept,
  };
}

/**
 * The join route for what the member typed or pasted, or null when it is not
 * a code or an invite link. Never throws.
 */
export function parseJoinInput(raw: unknown): JoinInput | null {
  if (typeof raw !== 'string') return null;
  const input = raw.trim();
  if (input === '' || input.length > JOIN_INPUT_MAX) return null;
  if (CODE.test(input)) return routeFor(input, {});
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001F\u007F]/.test(input)) return null;

  const url = URL_SHAPE.exec(input);
  if (!url) return null;
  const scheme = url[1]!.toLowerCase();
  const authority = url[2]!;
  let path = url[3]!;
  if (scheme === 'http' || scheme === 'https') {
    if (!HOST.test(authority)) return null;
  } else if (scheme === 'westayfit') {
    // `westayfit://join/<code>`: the first segment arrives as the authority.
    if (authority !== '') path = `/${authority}${path}`;
  } else {
    return null;
  }
  const match = JOIN_PATH.exec(path);
  if (!match) return null;
  return routeFor(match[1]!, keptParams(url[4]));
}
