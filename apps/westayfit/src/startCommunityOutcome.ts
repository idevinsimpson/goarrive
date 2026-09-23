/**
 * WHAT HAPPENED WHEN A MEMBER PRESSED "CREATE COMMUNITY".
 *
 * Route-owned, and deliberately not merged into `src/callableErrors.ts`: that
 * module answers "what sentence does this error deserve", which is a different
 * question from "did the server answer at all". Only this route has to care
 * about the second one, because only this route performs an action that is
 * expensive to repeat.
 *
 * THE DISTINCTION THIS FILE EXISTS FOR. `wsfCreateCommunity` carries no
 * attempt key. A retry is a second community, not a second try at the first
 * one. So the client may only say "nothing was created" when the SERVER SAID
 * SO — and the only evidence of that is a callable code the server itself
 * named. Anything else, including the SDK's own transport failures, leaves the
 * outcome genuinely unknown, and the screen has to say so.
 *
 *   `db.runTransaction` does not settle this. It makes the write all-or-nothing
 *   ON THE SERVER; it says nothing about whether the server got that far, or
 *   whether the response survived the trip back.
 */

/** The stored values, unchanged. Re-exported here so the route has one import. */
export type GroupType = 'familyFriends' | 'custom';
export type JoinPolicy = 'public' | 'inviteOnly' | 'private';

export type CreateOutcome =
  | { kind: 'idle' }
  /** The server answered and declined. Nothing was created, and we may say so. */
  | { kind: 'refused'; message: string; recover: 'form' | 'profile' }
  /** No answer we can trust. The community may or may not exist. */
  | { kind: 'unconfirmed' }
  /**
   * The callable returned a usable id, and the member is looking at this card
   * rather than at the community. `via` says why, because the card must not
   * claim a failure that did not happen:
   * - `unopened`: they stayed, and getting them there failed;
   * - `left`: they left this page before the create landed, so nothing tried
   *   to open it (R1).
   */
  | { kind: 'created'; groupId: string; displayName: string; via: 'unopened' | 'left' };

/**
 * The code the server named, or null.
 *
 * MAPS THE CODE AND NEVER THE MESSAGE, the same rule `/join/[joinCode]` keeps:
 * a callable's text can be a member sentence or a developer note, and the
 * screen cannot tell which — a fixture answering `internal` with the words
 * "join failed" once rendered them verbatim. There is no path from a
 * callable's text to a rendered pixel on this route either.
 */
export function callableCode(e: unknown): string | null {
  if (!e || typeof e !== 'object' || !('code' in e)) return null;
  const raw = (e as { code?: unknown }).code;
  if (typeof raw !== 'string' || raw === '') return null;
  return raw.startsWith('functions/') ? raw.slice('functions/'.length) : raw;
}

/**
 * THE REFUSALS `wsfCreateCommunity` ACTUALLY NAMES, and nothing else.
 *
 * Reaching an entry here means a code came back AND it is one the callable
 * throws deliberately — so the call completed, the server declined it, and no
 * community exists. That is the only basis on which this screen is allowed to
 * make a claim about the server's state.
 *
 * `internal`, `unavailable`, `deadline-exceeded`, `unknown`, `cancelled`,
 * `aborted` and `data-loss` are ABSENT ON PURPOSE. The SDK raises them for
 * transport failures wearing a server-shaped code, and `deadline-exceeded` in
 * particular is exactly the case where the write landed and the answer did
 * not. Treating any of them as a refusal is the defect this route is fixing.
 */
const REFUSAL_COPY: Record<string, string> = {
  unauthenticated: 'Please sign in again, then try once more.',
  'failed-precondition': 'Complete your profile before creating a community.',
  'invalid-argument': 'Something about this didn’t look right. Check the details and try again.',
  'permission-denied': 'This account can’t start a community.',
  'resource-exhausted': 'Too many requests in a short time. Wait a moment and try again.',
};

/**
 * `failed-precondition` HAS TWO SERVER MEANINGS AND ONLY ONE IS REACHABLE HERE.
 *
 * The callable throws it for an unverified email and for a missing profile.
 * The route renders its own unverified gate instead of the form, and that gate
 * reads the same `email_verified` claim the callable reads, from the same ID
 * token — so a member who is looking at the form has already passed it, and
 * the profile case is the one that can arrive at a submit. Its recovery is the
 * existing profile route.
 *
 * It offers NO RETURN AND NO SAVED DRAFT, because neither exists:
 * `nextRouteAfterAuth` resolves a pending join code, an event return and a
 * kiosk return goal, and adding a fourth is new storage nobody has authorised.
 * Saying less than we can deliver is the point.
 */
const PROFILE_REFUSAL = 'failed-precondition';

export function classifyCreateFailure(e: unknown): CreateOutcome {
  const code = callableCode(e);
  const message = code ? REFUSAL_COPY[code] : undefined;
  if (!message) return { kind: 'unconfirmed' };
  return {
    kind: 'refused',
    message,
    recover: code === PROFILE_REFUSAL ? 'profile' : 'form',
  };
}

/**
 * A `groupId` this screen is willing to navigate to.
 *
 * The Open action re-navigates and never re-creates, so the id it holds is the
 * only thing standing between a member and a dead route. An unusable one is
 * treated as an unconfirmed outcome rather than a broken button: the community
 * probably does exist, and "check your communities" is the honest next step
 * when we cannot point at it ourselves.
 */
export function usableGroupId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  if (id === '' || id.includes('/') || id.includes('?') || id.includes('#')) return null;
  return id;
}

/* ── the name, matched to what the server enforces ───────────────────────── */

/** `functions-westayfit/src/index.ts`: 2–80 characters after trimming. */
export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 80;

export const NAME_SHORT_MESSAGE = 'Give your community a name.';

export function nameLongMessage(length: number): string {
  return `Use ${NAME_MAX_LENGTH} characters or fewer. This name is ${length}.`;
}

/**
 * The field's complaint, or null. Checked against the TRIMMED value because
 * that is what the callable receives, so the client and the server can never
 * disagree about whether a name is acceptable.
 */
export function nameProblem(raw: string): 'short' | 'long' | null {
  const length = raw.trim().length;
  if (length < NAME_MIN_LENGTH) return 'short';
  if (length > NAME_MAX_LENGTH) return 'long';
  return null;
}

/**
 * R1 — A CONFIRMED COMMUNITY THE MEMBER HAS NOT SEEN YET.
 *
 * A member who leaves mid-create stays where they went (M5), so the create can
 * land with nobody looking. Home read its list before the commit and still
 * offers "Start a community", and without this the form it opens is blank: a
 * silent second community. So a confirmed create that landed while its form
 * was not the screen in front of the member is remembered here, and a
 * /start-community for the SAME account shows that community by name before
 * it offers a blank form.
 *
 * - Confirmed only. An unconfirmed or refused attempt never lands here; the
 *   uncertainty and no-auto-retry behaviour is unchanged.
 * - One account, one sign-in. It is remembered only if the account that asked
 *   is still the one signed in when the confirmation arrives, it is read only
 *   for that uid, and it is dropped on any sign-out or account change, so it
 *   can never be shown across accounts or resurface later as if current.
 * - Memory only. Module state, never persisted. A reload clears it, and a
 *   reload is also what makes Home read its list again.
 * - Cleared by the member: opening the community, or deliberately starting
 *   another one.
 */
type UnacknowledgedCreate = { uid: string; groupId: string; displayName: string };

let unacknowledged: UnacknowledgedCreate | null = null;
const listeners = new Set<() => void>();

export function rememberUnacknowledgedCreate(entry: UnacknowledgedCreate): void {
  unacknowledged = { ...entry };
  for (const listener of Array.from(listeners)) listener();
}

/** The confirmed community `uid` has not acknowledged yet, or null. */
export function unacknowledgedCreateFor(
  uid: string | null,
): { groupId: string; displayName: string } | null {
  if (!unacknowledged || uid === null) return null;
  if (unacknowledged.uid !== uid) {
    // Another account is here. Its creator's result is dropped, not kept for
    // later, so it cannot be shown to anyone else.
    unacknowledged = null;
    return null;
  }
  return { groupId: unacknowledged.groupId, displayName: unacknowledged.displayName };
}

/**
 * Drops the note unless it belongs to `uid`, the account signed in now (null
 * when signed out). Called on every sign-in change, so a note lives only while
 * the account that made it stays signed in.
 */
export function dropUnacknowledgedCreateUnlessFor(uid: string | null): void {
  if (unacknowledged && unacknowledged.uid !== uid) unacknowledged = null;
}

/** Clears the note — only if it is `groupId`'s, when one is given. */
export function forgetUnacknowledgedCreate(groupId?: string): void {
  if (!unacknowledged) return;
  if (groupId !== undefined && unacknowledged.groupId !== groupId) return;
  unacknowledged = null;
}

/** Called whenever a new note is remembered. Returns the unsubscribe. */
export function subscribeUnacknowledgedCreate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
