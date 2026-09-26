import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { getFirebaseAuth, getFirebaseFirestore, getFirebaseFunctions } from './firebase';

/**
 * APP-FEEL-PARITY-1 CHECKPOINT 2. THE MEMBER'S OWN READS, SHARED AND WARM.
 *
 * WHAT WAS MEASURED (development `91392f9d`, before this module): every member
 * surface read the same authorized facts for itself, from nothing, every
 * time it mounted. Home read `wsfMyCommunities`; the community it opened read
 * it again; the Community tab and Progress each read it again with every
 * community's `wsfListGoals`; and each of them showed a skeleton while it
 * did. A member moving between tabs watched the app re-learn things it had
 * just told them.
 *
 * WHAT THIS IS. An in-memory record, for the signed-in account only, of the
 * last authorized answer to the two reads every member surface starts from:
 *   · `wsfMyCommunities` -- which communities this account belongs to;
 *   · `wsfListGoals({ groupId, includeHistory: true })` -- one community's
 *     goals with their confirmed totals;
 *
 * Two things it does:
 *   · a read already in flight is SHARED, not repeated (the Home list and the
 *     community it redirects to ask at the same moment);
 *   · the last answer can be SHOWN at once while a fresh read runs, so a
 *     screen opens in its final composition with what is known, and replaces
 *     it quietly with what is true.
 *
 * WHAT IT NEVER DOES.
 *   · It never stands in for a read beyond one load. Every screen still gets
 *     a server-authorized answer -- its own, or one made for this account
 *     within `SAME_LOAD_MS` (below) -- and a refusal clears it. An older
 *     value is a first frame, not an authority.
 *   · It never outlives the account. Everything is keyed to one uid and the
 *     whole record is dropped the moment a different uid -- or none -- asks
 *     (`scope`), and on sign-out (`clearMemberReads`). A second account on the
 *     same device never sees a byte of the first account's record.
 *   · It never reads ahead. Nothing here fetches a community the member has
 *     not opened or a screen they have not visited; it only keeps what a
 *     screen they did visit already read.
 *   · It never persists: no storage, no disk, gone on reload.
 *
 * PERF-MOBILE-1 CHECKPOINT 1. ONE READ PER LOAD, AND THE MEMBER'S OWN PART.
 *
 * Measured on `0b460ce3` (W7 Check 41B): sharing only IN-FLIGHT reads did
 * not remove a single duplicate at the network boundary. Cold Home read
 * `wsfMyCommunities` twice -- the list's read had already SETTLED when the
 * community it redirects to asked -- and MOVE read one community's goals
 * twice. Progress and You re-read, serially and behind a skeleton, facts Home
 * had read a moment before.
 *
 *   · A read may now accept a SETTLED answer younger than `SAME_LOAD_MS`: it
 *     is the same read, made again within the same load, and it is served
 *     from the answer instead of the network. Only a mount-time read asks for
 *     this; a member's return, a Retry and a refresh still read fresh.
 *   · The member's own confirmed part (`wsfMyContribution`) is recorded the
 *     same way, so the surfaces that show it can open on what is known.
 *   · A confirmed contribution updates only what its receipt confirms
 *     (`noteConfirmedContribution`).
 *   · Losing a community forgets its goals AND the member's own parts in them.
 */

/**
 * How recent a settled answer must be to count as the same read. Short on
 * purpose: long enough to cover one screen opening another in the same load
 * (cold Home's list and the community it opens: ~100 ms apart; MOVE's
 * resolver and the flow it hands to), far too short to stand in for a
 * member's return to a screen.
 */
export const SAME_LOAD_MS = 10_000;

type Entry = { value?: unknown; at?: number; inflight?: Promise<unknown> };

let owner: string | null = null;
const store = new Map<string, Entry>();

/*
  PERF-MOBILE-1 SUCCESSOR (Director #494 `5841250834`, `5841341300`).
  WHICH ANSWER IS THE NEWEST IS A GENERATION, NEVER A CLOCK.

  Every key carries a generation. Anything that replaces or removes a key
  from outside a read -- a confirmed receipt, a refusal, a forget -- advances
  it first. A read remembers the generation it was issued at (and the
  account epoch), and its answer is recorded ONLY if nothing has advanced
  since. So an own-part read issued before a receipt and answered after it
  can never put the older figure back, and a read issued before a refusal
  can never bring the lost community back.

  `groupGoals` remembers which goal ids each community's goal list named, so
  forgetting a community reaches every own part recorded in it even when the
  list itself is already gone. It is metadata only: no fetched value lives
  there. `refused` names the communities a fresh server answer refused this
  session, so a mounted screen can drop them at once.

  All of it belongs to one account and is cleared with it.
*/
let epoch = 0;
const versions = new Map<string, number>();
const groupGoals = new Map<string, Set<string>>();
const refused = new Set<string>();
const version = (key: string): number => versions.get(key) ?? 0;
const advance = (key: string): void => {
  versions.set(key, version(key) + 1);
};
function resetRecord(): void {
  store.clear();
  versions.clear();
  groupGoals.clear();
  refused.clear();
  epoch += 1;
}

/*
  THE RECORD ENDS WITH THE SESSION, whichever screen ended it. The member can
  sign out from the menu, from You, from Home's list, from a flow's gate; the
  record does not rely on each of them remembering to clear it. The first
  time it is used it watches the auth state itself, and drops everything the
  moment the signed-in uid is no longer the one it belongs to.
*/
let watching = false;
function watchAuth(): void {
  if (watching) return;
  watching = true;
  try {
    onAuthStateChanged(getFirebaseAuth(), (u) => {
      if (!u || u.uid !== owner) clearMemberReads();
    });
  } catch {
    watching = false;
  }
}

/** Drops everything unless this uid already owns the record. */
function scope(uid: string | null): boolean {
  watchAuth();
  if (!uid) {
    clearMemberReads();
    return false;
  }
  if (owner !== uid) {
    resetRecord();
    owner = uid;
  }
  return true;
}

/** Sign-out, and anything else that ends the account's session on this device. */
export function clearMemberReads(): void {
  resetRecord();
  owner = null;
}

function peek<T>(uid: string | null, key: string): T | undefined {
  if (!scope(uid)) return undefined;
  return store.get(key)?.value as T | undefined;
}

/** Removes a key; its generation advances first, so no older read can put it back. */
function forget(uid: string | null, key: string): void {
  if (!scope(uid)) return;
  advance(key);
  store.delete(key);
}

/**
 * The fresh read, shared with any identical read already in flight. The
 * answer is recorded only if the same account still owns the record when it
 * lands, so a slow answer for one account can never be kept for the next.
 *
 * `reuseMs`: a settled answer at most this old is the answer, and no request
 * is made. 0 (the default) always asks the server.
 */
function read<T>(
  uid: string,
  key: string,
  fetch: () => Promise<T>,
  reuseMs = 0,
  onRecorded?: (value: T) => void,
): Promise<T> {
  scope(uid);
  const entry = store.get(key) ?? {};
  if (entry.inflight) return entry.inflight as Promise<T>;
  if (reuseMs > 0 && entry.at !== undefined && Date.now() - entry.at <= reuseMs) {
    return Promise.resolve(entry.value as T);
  }
  const issuedEpoch = epoch;
  const issuedVersion = version(key);
  const sameAccount = () => owner === uid && epoch === issuedEpoch;
  const stillCurrent = () => sameAccount() && version(key) === issuedVersion;
  const p: Promise<T> = fetch()
    .then((value): T | Promise<T> => {
      if (stillCurrent()) {
        store.set(key, { value, at: Date.now() });
        onRecorded?.(value);
        return value;
      }
      if (sameAccount()) {
        // SUPERSEDED while in flight, for this same account. A receipt that
        // replaced the key is newer than this answer: that is the answer. A
        // key that was removed (a refusal, a receipt that could not patch a
        // list) is asked again, fresh, rather than answered from before.
        const now = store.get(key);
        if (now && now.at !== undefined) return now.value as T;
        return read(uid, key, fetch, 0, onRecorded);
      }
      // Another account owns the record now: nothing is recorded, and the
      // screen that asked drops the answer by its own account guard.
      return value;
    })
    .catch((e: unknown) => {
      if (stillCurrent()) {
        const cur = store.get(key);
        if (cur && cur.at !== undefined) store.set(key, { value: cur.value, at: cur.at });
        else store.delete(key);
      }
      throw e;
    });
  store.set(key, { ...entry, inflight: p });
  return p;
}

// ---- wsfMyCommunities --------------------------------------------------------

export type MyCommunitiesItem = {
  groupId: string;
  displayName: string;
  groupType?: string;
  role?: string;
  memberCount: number;
  isSample?: boolean;
  activeChallenge?: unknown;
  [k: string]: unknown;
};
export type MyCommunitiesAnswer = { items: MyCommunitiesItem[] };

const MINE = 'wsfMyCommunities';

export function peekMyCommunities(uid: string | null): MyCommunitiesAnswer | undefined {
  return peek<MyCommunitiesAnswer>(uid, MINE);
}

export function readMyCommunities(uid: string, reuseMs = 0): Promise<MyCommunitiesAnswer> {
  return read(
    uid,
    MINE,
    async () => {
      const r = await httpsCallable<Record<string, never>, MyCommunitiesAnswer>(
        getFirebaseFunctions(),
        'wsfMyCommunities',
      )({});
      return { items: Array.isArray(r.data?.items) ? r.data.items : [] };
    },
    reuseMs,
  );
}

// ---- wsfListGoals (with history) --------------------------------------------

export type ListedGoalsAnswer<G> = { goals: G[] };
const goalsKey = (groupId: string) => `wsfListGoals:${groupId}`;

export function peekGoals<G>(uid: string | null, groupId: string): ListedGoalsAnswer<G> | undefined {
  return peek<ListedGoalsAnswer<G>>(uid, goalsKey(groupId));
}

export function readGoals<G>(uid: string, groupId: string, reuseMs = 0): Promise<ListedGoalsAnswer<G>> {
  return read(
    uid,
    goalsKey(groupId),
    async () => {
      const r = await httpsCallable<{ groupId: string; includeHistory: boolean }, ListedGoalsAnswer<G>>(
        getFirebaseFunctions(),
        'wsfListGoals',
      )({ groupId, includeHistory: true });
      return { goals: Array.isArray(r.data?.goals) ? r.data.goals : [] };
    },
    reuseMs,
    (answer) => {
      // An authorized list for this community: it is a membership again, and
      // these are the goal ids its own parts may be recorded under.
      refused.delete(groupId);
      for (const g of answer.goals as Array<{ goalId?: unknown }>) {
        if (typeof g.goalId === 'string') registerGoal(groupId, g.goalId);
      }
    },
  );
}

function registerGoal(groupId: string, goalId: string): void {
  const ids = groupGoals.get(groupId) ?? new Set<string>();
  ids.add(goalId);
  groupGoals.set(groupId, ids);
}

/** True when a fresh server answer refused this community this session. */
export function wasRefused(uid: string | null, groupId: string): boolean {
  if (!scope(uid)) return false;
  return refused.has(groupId);
}

// ---- wsfMyContribution: the member's own confirmed part -----------------------

/**
 * The server's answer for the signed-in account's own part in one goal. The
 * callable keys it by `request.auth.uid`, so it can only ever be this
 * account's; it is recorded under this account's record like everything
 * else. `activityGuideKey` and `repeatPolicy` ride the same answer and are
 * kept with it, unread here.
 */
export type OwnCreditAnswer = {
  ownCredit: number;
  unit: string;
  activityGuideKey?: string;
  repeatPolicy?: unknown;
  [k: string]: unknown;
};
const ownKey = (goalId: string) => `wsfMyContribution:${goalId}`;

export function peekOwnCredit(uid: string | null, goalId: string): OwnCreditAnswer | undefined {
  return peek<OwnCreditAnswer>(uid, ownKey(goalId));
}

export function readOwnCredit(uid: string, goalId: string, reuseMs = 0): Promise<OwnCreditAnswer> {
  return read(
    uid,
    ownKey(goalId),
    async () => {
      const r = await httpsCallable<{ goalId: string }, OwnCreditAnswer>(
        getFirebaseFunctions(),
        'wsfMyContribution',
      )({ goalId });
      return r.data;
    },
    reuseMs,
  );
}

// ---- the member's own profile document ------------------------------------------

/**
 * `wsfMemberProfiles/<uid>`: the account's own document, which only that
 * account can read (firestore.rules). Its name and join date are what You
 * opens on. An unreadable document is `null` fields, as You has always
 * treated it.
 */
export type MemberProfileAnswer = { displayName: string | null; createdAt: unknown };
const PROFILE = 'wsfMemberProfiles:self';

export function peekMemberProfile(uid: string | null): MemberProfileAnswer | undefined {
  return peek<MemberProfileAnswer>(uid, PROFILE);
}

export function readMemberProfile(uid: string, reuseMs = 0): Promise<MemberProfileAnswer> {
  return read(
    uid,
    PROFILE,
    async () => {
      const snap = await getDoc(doc(getFirebaseFirestore(), 'wsfMemberProfiles', uid));
      const data = snap.data() as { displayName?: unknown; createdAt?: unknown } | undefined;
      return {
        displayName: typeof data?.displayName === 'string' ? data.displayName : null,
        createdAt: data?.createdAt ?? null,
      };
    },
    reuseMs,
  );
}

// ---- a confirmed contribution -------------------------------------------------

/**
 * WHAT A CONFIRMED RECEIPT MAY CHANGE HERE, AND NOTHING ELSE.
 *
 * `wsfContribute` answers a confirmed write with the member's own credit and
 * the goal's shared total, target, unit and status as the server committed
 * them. Those fields -- and only those -- replace what is recorded:
 *   · the member's own part in that goal (its guide key and repeat policy are
 *     not in the receipt and are kept as they were read);
 *   · that goal's shared total in its community's list, while both the list
 *     and the receipt say the goal is open.
 * A receipt that says the goal is now closed does not guess what the list
 * would call it: that community's goals are forgotten and read fresh next
 * time. Nothing is predicted -- no one else's concurrent movement, no total
 * the receipt did not state.
 */
export type ConfirmedReceipt = {
  goalId: string;
  groupId?: string | null;
  ownCredit: number;
  sharedTotal: number;
  target: number;
  unit: string;
  status: 'active' | 'closed';
};

export function noteConfirmedContribution(uid: string | null, receipt: ConfirmedReceipt): void {
  if (!scope(uid)) return;
  const now = Date.now();
  const ownKeyOf = ownKey(receipt.goalId);
  const previous = (store.get(ownKeyOf)?.value ?? {}) as OwnCreditAnswer;
  advance(ownKeyOf);
  store.set(ownKeyOf, { value: { ...previous, ownCredit: receipt.ownCredit, unit: receipt.unit }, at: now });
  if (!receipt.groupId) return;
  registerGoal(receipt.groupId, receipt.goalId);
  // The community's goal list always moves on: patched when a settled list
  // can take the receipt's exact total, otherwise removed so that no list
  // read before the receipt can land its older total (asked again, fresh).
  const key = goalsKey(receipt.groupId);
  const listed = store.get(key);
  const goals = (listed?.value as ListedGoalsAnswer<Record<string, unknown>> | undefined)?.goals;
  advance(key);
  if (listed && !listed.inflight && listed.at !== undefined && Array.isArray(goals)) {
    const index = goals.findIndex((g) => g.goalId === receipt.goalId);
    if (index >= 0 && receipt.status === 'active' && goals[index]!.status === 'active') {
      const next = goals.slice();
      next[index] = { ...goals[index]!, sharedTotal: receipt.sharedTotal };
      store.set(key, { value: { goals: next }, at: listed.at });
      return;
    }
  }
  store.delete(key);
}

// ---- lost membership -------------------------------------------------------

/**
 * The account is not (or no longer) a member here: the goals it read for
 * this community, its own part in each of them, and the membership list that
 * still names it are dropped, so no surface can open on them again.
 */
export function forgetCommunity(uid: string | null, groupId: string): void {
  if (!scope(uid)) return;
  const ids = new Set(groupGoals.get(groupId) ?? []);
  for (const g of peekGoals<{ goalId?: unknown }>(uid, groupId)?.goals ?? []) {
    if (typeof g.goalId === 'string') ids.add(g.goalId);
  }
  for (const goalId of ids) forget(uid, ownKey(goalId));
  forget(uid, goalsKey(groupId));
  groupGoals.delete(groupId);
  forget(uid, MINE);
  refused.add(groupId);
}
