/**
 * WHICH COMMUNITY IS "HOME".
 *
 * Home is the community the member is in right now, not a directory of the
 * communities they belong to. That needs an answer to "which one", and the
 * answer has to survive a reload without inventing anything:
 *
 *   1. the one they last opened, if they are still in it;
 *   2. otherwise the only one they are in;
 *   3. otherwise nothing, and Home asks them to choose.
 *
 * Rule 1 is remembered per account, so one person's phone signed into two
 * accounts does not hand the second account the first one's community. The
 * store is best effort: a browser with storage blocked falls through to rule
 * 2, which is a worse guess and never a wrong claim.
 */
const KEY_PREFIX = 'wsf.currentCommunity.';

function store(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function rememberCurrentCommunity(uid: string | null | undefined, groupId: string): void {
  if (!uid || !groupId) return;
  try {
    store()?.setItem(`${KEY_PREFIX}${uid}`, groupId);
  } catch {
    // A member whose browser refuses storage still gets rule 2.
  }
}

export function forgetCurrentCommunity(uid: string | null | undefined): void {
  if (!uid) return;
  try {
    store()?.removeItem(`${KEY_PREFIX}${uid}`);
  } catch {
    // Nothing to do: the value is a convenience, never a source of truth.
  }
}

/**
 * The community Home should open, given what the member is actually in.
 * `memberOf` is the authority: a remembered id they have since left is
 * discarded rather than opened.
 */
export function resolveCurrentCommunity(
  uid: string | null | undefined,
  memberOf: readonly string[]
): string | null {
  if (memberOf.length === 0) return null;
  let remembered: string | null = null;
  try {
    remembered = uid ? store()?.getItem(`${KEY_PREFIX}${uid}`) ?? null : null;
  } catch {
    remembered = null;
  }
  if (remembered && memberOf.includes(remembered)) return remembered;
  if (memberOf.length === 1) return memberOf[0];
  return null;
}
