/**
 * ONE FOLLOW-ALONG ROUND, ONE IDENTITY — carried from the screen someone moved
 * in front of to the screen they type their number into.
 *
 * WHAT PROBLEM THIS SOLVES. A person can follow a round on a station screen in
 * a hall and then enter their number on their own phone (they scan the panel's
 * QR), or follow it on their phone and enter it there. Either way it is ONE
 * round and it must become at most ONE contribution — including when they do
 * both, or reload, or come back to the same link later. `wsfContribute` is
 * already idempotent on (goalId, uid, attemptId); all this module does is make
 * sure both devices arrive at the SAME attemptId for the same person, without
 * changing one line of the server's rules.
 *
 * WHAT IS IN THE URL, AND WHAT IS NOT. The URL carries a ROUND id: a random,
 * meaningless string minted on the device when a round starts. It is not a
 * token, it grants nothing, it identifies nobody, and pasting it into a
 * browser opens the ordinary contribute page which still asks whoever is
 * holding it to sign in as themselves. No count, no elapsed time and no credit
 * ever travels with it — the only number that counts is the one the person
 * types, and this module cannot produce a number at all.
 *
 * WHY THE SERVER ATTEMPT ID IS `<round>_<uid>` AND NOT JUST `<round>`.
 * `wsfContribute` keys idempotency on (goal, uid, attemptId), so appending the
 * uid changes nothing about whether one person's two devices replay one
 * attempt: same person, same uid, same key, counted once. What it does change
 * is what happens when TWO people use the same round id — which is exactly
 * what a QR on a shared screen invites. The server writes its recent-additions
 * tail to `wsfGoals/<goalId>/recentAdditions/<attemptId>`, a document named by
 * the attempt id ALONE with no uid in the path, so two members sharing a round
 * id would write the same document and one of the two entries would be lost
 * from that tail. Deriving per account makes that impossible by construction,
 * and costs nothing: the round is still one canonical id, and one person still
 * has exactly one attempt for it.
 */

/**
 * The query parameter the round id travels in, on the follow-along screen and
 * on the contribute screen it hands off to.
 */
export const MOVE_ATTEMPT_PARAM = 'attempt';

/** The shape a round id takes. Nothing that could become a path of its own. */
const ROUND_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

/** The shape the server accepts for an attemptId, mirrored exactly. */
const SERVER_ATTEMPT_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * A fresh round id. Minted once, when a round begins, and reused for that
 * round no matter which screen finishes it.
 *
 * `crypto.randomUUID` where it exists, and a time-plus-random string where it
 * does not — the same two-branch approach the contribute screen already uses
 * for its own attempt ids, so the two cannot drift in what they can produce.
 */
export function mintMoveRoundId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  const uuid = g.crypto?.randomUUID?.();
  if (typeof uuid === 'string' && uuid.length >= 32) {
    return `mv${uuid.replace(/-/g, '').slice(0, 24)}`;
  }
  return `mv${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** A round id from a route parameter, or null if it is not one. */
export function readMoveRoundId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return ROUND_ID_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * The attemptId this account should send for this round, or null when either
 * half is missing or malformed — in which case the caller mints its own
 * ordinary attempt id and behaves exactly as it always has.
 */
export function moveAttemptIdFor(
  roundId: string | null | undefined,
  uid: string | null | undefined
): string | null {
  const round = readMoveRoundId(roundId);
  if (!round) return null;
  if (typeof uid !== 'string') return null;
  const owner = uid.trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(owner)) return null;
  const attemptId = `${round}_${owner}`;
  return SERVER_ATTEMPT_PATTERN.test(attemptId) ? attemptId : null;
}

// ---- the routes the follow-along screen uses --------------------------------

function query(parts: Array<[string, string | null | undefined]>): string {
  const pairs = parts
    .filter((p): p is [string, string] => typeof p[1] === 'string' && p[1] !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  return pairs.length ? `?${pairs.join('&')}` : '';
}

/**
 * Where "Enter my reps" goes: the EXISTING contribute screen, at its ordinary
 * entry step, carrying this round's id and the community hint it was given.
 *
 * It deliberately does NOT pass `mode=move` (that is contribute's own movement
 * step, and this round has already happened) and it deliberately does not pass
 * `kiosk` (a shared-device session is the kiosk's to start, not this screen's).
 */
export function moveHandoffHref(opts: {
  goalId: string;
  roundId?: string | null;
  groupId?: string | null;
}): string {
  const goalId = encodeURIComponent(opts.goalId);
  return `/contribute/${goalId}${query([
    [MOVE_ATTEMPT_PARAM, readMoveRoundId(opts.roundId)],
    ['groupId', opts.groupId ?? null],
  ])}`;
}

/**
 * The same address, absolute, for the QR on a station panel: the person's own
 * phone opens THIS round's entry page and their entry replays this round's
 * attempt rather than opening a second one.
 */
export function moveHandoffUrl(opts: {
  origin: string | null | undefined;
  goalId: string | null | undefined;
  roundId?: string | null;
  groupId?: string | null;
}): string | null {
  const goalId = opts.goalId?.trim();
  if (!opts.origin) return null;
  if (!goalId) return null;
  return `${opts.origin.replace(/\/+$/, '')}${moveHandoffHref({
    goalId,
    roundId: opts.roundId,
    groupId: opts.groupId,
  })}`;
}

/**
 * A return path from a route parameter: an address INSIDE this app and nothing
 * else. A scheme, a protocol-relative `//host`, a backslash or anything that
 * is not a plain path is refused outright rather than sanitised, so no link on
 * this screen can be aimed somewhere else by editing its URL.
 */
export function readReturnPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 512) return null;
  if (!trimmed.startsWith('/')) return null;
  if (trimmed.startsWith('//')) return null;
  if (trimmed.includes('\\')) return null;
  return /^\/[A-Za-z0-9\-._~/?&=%+:@]*$/.test(trimmed) ? trimmed : null;
}

/**
 * Where "Back" goes, in order of what is actually known: the return path the
 * caller preserved, then the event this round belongs to, then the community,
 * then home. Never a dead end and never a guess about a route that may not
 * exist for this person.
 */
export function moveBackHref(opts: {
  from?: unknown;
  eventGoalId?: string | null;
  groupId?: string | null;
}): string {
  const from = readReturnPath(opts.from);
  if (from) return from;
  const event = opts.eventGoalId?.trim();
  if (event) return `/event/${encodeURIComponent(event)}`;
  const groupId = opts.groupId?.trim();
  if (groupId) return `/community/${encodeURIComponent(groupId)}`;
  return '/';
}

/**
 * The activity a caller selected, as a label to show — the goal's own word for
 * what is being counted, when the screen was opened with one. Length-capped
 * and stripped of control characters; it is displayed, never stored and never
 * sent anywhere.
 */
export function readActivityLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (cleaned === '' || cleaned.length > 64) return null;
  return cleaned;
}
