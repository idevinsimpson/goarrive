/**
 * Where the join deep link comes from — one derivation, used by every control
 * that shows or encodes it.
 *
 * This was inline in `app/community/[groupId]/index.tsx`, producing the string
 * behind the Copy link control. The QR must encode THE SAME URL, so the rule
 * moved here rather than being written a second time: a QR that disagrees with
 * the link next to it is worse than no QR at all.
 *
 * The policy gate is the client half of the server's `LINK_JOINABLE` set in
 * `functions-westayfit/src/index.ts` — `public` and `inviteOnly` admit by code,
 * `private` does not. Private groups DO carry a joinCode (minted on create, so
 * the endpoints cannot be used as an existence oracle), which is exactly why
 * this must be checked before a URL is built from one: a private community
 * must not acquire a working invite link, let alone a printable one, because
 * the UI happened to have a code in hand.
 */

/** Join policies the server will actually admit someone through by code. */
export const LINK_JOINABLE_POLICIES: readonly string[] = ['public', 'inviteOnly'];

export function isLinkJoinable(joinPolicy: string | null | undefined): boolean {
  return typeof joinPolicy === 'string' && LINK_JOINABLE_POLICIES.includes(joinPolicy);
}

/**
 * The absolute join URL, or null when there is no link to show.
 *
 * Null — never a partial or placeholder URL — for every reason there might not
 * be one: no code yet, a policy that does not admit by code, or no origin
 * (server render / static export, where `window` does not exist).
 */
export function buildJoinUrl(opts: {
  origin: string | null | undefined;
  joinCode: string | null | undefined;
  joinPolicy: string | null | undefined;
}): string | null {
  const { origin, joinCode, joinPolicy } = opts;
  if (!origin) return null;
  if (!joinCode) return null;
  if (!isLinkJoinable(joinPolicy)) return null;
  return `${origin.replace(/\/+$/, '')}/join/${joinCode}`;
}
