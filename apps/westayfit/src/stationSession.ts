/**
 * Station session — what a screen standing at an event is allowed to remember,
 * and what it is allowed to do with it, as plain functions.
 *
 * A STATION IS NOT AN ACCOUNT. app/kiosk/[goalId].tsx signs the device out
 * every time its start screen focuses, on purpose, so that no visitor inherits
 * the previous visitor's account. A screen at an event lives under that same
 * rule, so its identity cannot be a Firebase Auth user: it is a secret the
 * server minted, the Champion approved, this device holds, and the Champion
 * can revoke.
 *
 * WHY localStorage AND NOT sessionStorage. This is the one WSF surface where
 * the browser-storage lifetime goes the other way from src/kioskSession.ts. A
 * kiosk return goal must die with the tab because it belongs to one walk-up; a
 * station credential must survive a reload, a screen blanking and a browser
 * restart, because the thing it identifies is the SCREEN, not a person, and an
 * event is a long day. Nothing about any attendee is ever written here.
 *
 * WHAT IS NEVER IN STORAGE, IN A URL OR IN A QR: this file's rules are the
 * enforcement of the standing quality bar. The credential is presented in a
 * callable's request body and nowhere else. `stationRoute` and the two event
 * link builders in src/ui/eventLinks.ts produce addresses that carry a goal
 * id and, for the newcomer link, the community's existing invite code —
 * never a station secret, never a pairing id, never any administrative
 * authority.
 */

import { EVENT_ACTIVITY_PARAM, readActivityLabel } from './eventActivity';
import { PENDING_EVENT_ACTIVITY_KEY, PENDING_EVENT_KEY } from './joinEventHandoff';

/** The one browser-storage key the STATION owns. */
const STATION_CREDENTIAL_KEY = 'wsf.stationCredential';

/*
  THE EVENT A NEWCOMER ARRIVED FROM, AND ITS ACTIVITY — `wsf.pendingEventGoalId`
  and `wsf.pendingEventActivity` — are the member side of a join QR, not the
  station's. They now live in src/joinEventHandoff.ts (NATIVE-STATE-3), kept
  like the other post-auth destinations: the same sessionStorage keys on web,
  now holding JSON bound to the join code (and the activity to its goal); a
  bounded native store on a phone; owned by the account that stashed them.
  They never shared a key, a secret or a code path with the station's own
  session. The accessors are re-exported below, and their signatures now take
  the join code (and the activity's the goal id); the keys stay declared in
  the inventory.
*/
export {
  clearPendingEventActivity,
  clearPendingEventGoal,
  readPendingEventActivity,
  readPendingEventGoal,
  setPendingEventActivity,
  setPendingEventGoal,
} from './joinEventHandoff';

export const STATION_STORAGE_KEYS = [
  STATION_CREDENTIAL_KEY,
  PENDING_EVENT_KEY,
  PENDING_EVENT_ACTIVITY_KEY,
] as const;

/**
 * The pairing-code alphabet, 32 characters with I, O, 0 and 1 removed so a
 * code read off a screen across a hall cannot be mistyped into a DIFFERENT
 * valid code.
 *
 * A COPY of STATION_PAIRING_ALPHABET in functions-westayfit/src/index.ts,
 * deliberately — the client cannot import the server module, and the server is
 * the only place a code is minted or checked. tests/station-session.test.ts
 * pins this literal so the two cannot drift silently.
 */
export const STATION_PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const STATION_PAIRING_CODE_LENGTH = 6;

/** Station 1 or Station 2. There is no third slot. */
export const STATION_SLOTS = [1, 2] as const;
export type StationSlot = (typeof STATION_SLOTS)[number];

export function isStationSlot(value: unknown): value is StationSlot {
  return value === 1 || value === 2;
}

/**
 * What the Champion typed, turned into what the server will accept — or null.
 *
 * Spaces and dashes go (people type them), case is folded up, and anything
 * outside the alphabet makes the whole thing null rather than being silently
 * dropped: a character that was not in the code is evidence the code was
 * mistyped, and quietly deleting it would send a DIFFERENT six characters to
 * the server than the person believes they typed.
 */
export function normalizePairingCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[\s-]+/g, '').toUpperCase();
  if (cleaned.length !== STATION_PAIRING_CODE_LENGTH) return null;
  for (const ch of cleaned) {
    if (!STATION_PAIRING_ALPHABET.includes(ch)) return null;
  }
  return cleaned;
}

/** What a partially typed code looks like in the field: upper case, only
 * alphabet characters, never longer than a code. It is not a validation — it
 * is what the input is allowed to contain while it is being typed. */
export function pairingCodeInputValue(raw: string): string {
  let out = '';
  for (const ch of raw.toUpperCase()) {
    if (STATION_PAIRING_ALPHABET.includes(ch)) out += ch;
    if (out.length === STATION_PAIRING_CODE_LENGTH) break;
  }
  return out;
}

/** A code on a screen across a hall, in two groups of three. Display only —
 * the server is always sent the normalized six characters. */
export function formatPairingCode(code: string): string {
  const normalized = pairingCodeInputValue(code);
  if (normalized.length !== STATION_PAIRING_CODE_LENGTH) return normalized;
  return `${normalized.slice(0, 3)} ${normalized.slice(3)}`;
}

/** The shapes ids take here; refuses anything that could turn a stored value
 * into a path of its own. Same rule, and the same reason, as kioskSession. */
function isIdShape(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function isSecretShape(value: string): boolean {
  return /^[A-Za-z0-9_-]{32,128}$/.test(value);
}

export type StationCredential = {
  stationId: string;
  secret: string;
  /** The goal this screen was enrolled on. A credential is never presented on
   * another goal's screen — see `credentialForGoal`. */
  goalId: string;
  slot: StationSlot;
};

function readStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    // Private browsing, a locked-down UA, or storage disabled entirely. The
    // screen still works: it shows a pairing code, which is the honest state
    // for a device that cannot remember being enrolled.
    return null;
  }
}

export function readStationCredential(): StationCredential | null {
  try {
    const raw = readStorage()?.getItem(STATION_CREDENTIAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StationCredential> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    const { stationId, secret, goalId, slot } = parsed;
    if (typeof stationId !== 'string' || !isIdShape(stationId)) return null;
    if (typeof secret !== 'string' || !isSecretShape(secret)) return null;
    if (typeof goalId !== 'string' || !isIdShape(goalId)) return null;
    if (!isStationSlot(slot)) return null;
    return { stationId, secret, goalId, slot };
  } catch {
    return null;
  }
}

/**
 * The credential for THIS goal, or null.
 *
 * A screen opened on `/station/<other-goal>` must not present the credential
 * it holds for another goal: the server would refuse it anyway (the station
 * document carries its own goalId), but sending a secret to a screen it does
 * not belong to is the mistake, not the refusal.
 */
export function credentialForGoal(goalId: string | null | undefined): StationCredential | null {
  const held = readStationCredential();
  if (!held) return null;
  if (!goalId || held.goalId !== goalId) return null;
  return held;
}

export function saveStationCredential(credential: StationCredential): boolean {
  if (!isIdShape(credential.stationId)) return false;
  if (!isSecretShape(credential.secret)) return false;
  if (!isIdShape(credential.goalId)) return false;
  if (!isStationSlot(credential.slot)) return false;
  try {
    const storage = readStorage();
    if (!storage) return false;
    storage.setItem(STATION_CREDENTIAL_KEY, JSON.stringify(credential));
    return true;
  } catch {
    return false;
  }
}

/**
 * Forget this screen's enrolment. Called when the server refuses the
 * credential — revoked by the Champion, or no longer a station at all — so a
 * revocation the Champion performed from across the hall actually empties the
 * device rather than leaving a dead secret sitting in it.
 */
export function clearStationCredential(): void {
  try {
    readStorage()?.removeItem(STATION_CREDENTIAL_KEY);
  } catch {
    // ignore: nothing else reads this key.
  }
}

/**
 * Where a completed join goes: the event screen when the visitor came from an
 * event QR, and otherwise exactly where it went before — the community.
 *
 * A goal id that is not of a usable shape is ignored rather than routed to: an
 * unusable value must never build a path.
 *
 * THE ACTIVITY RIDES THE LAST HOP IN THE ADDRESS, not in storage. The session
 * entry is what carried it across signup, verification, the profile and the
 * join — four routes that each replace the page — and this is where that
 * carrying ENDS: the value is handed to the event's address, the session entry
 * is cleared by the caller in the same breath, and from that moment the only
 * copy left is the one in the address bar, which a reload keeps and a closed
 * tab takes with it. An activity is never routed to; it is only ever a query
 * value on a path built from the goal id, so it cannot steer where anyone
 * lands. It is dropped entirely when there is no event to attach it to.
 */
export function routeAfterJoin(
  groupId: string,
  eventGoalId: string | null,
  eventActivity?: string | null
): string {
  if (eventGoalId && isIdShape(eventGoalId)) {
    const base = `/event/${encodeURIComponent(eventGoalId)}`;
    const activity = readActivityLabel(eventActivity);
    if (!activity) return base;
    return `${base}?${EVENT_ACTIVITY_PARAM}=${encodeURIComponent(activity)}`;
  }
  return `/community/${encodeURIComponent(groupId)}`;
}
