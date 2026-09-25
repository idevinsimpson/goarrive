import { onAuthStateChanged } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';

import { getFirebaseAuth, getFirebaseFunctions } from './firebase';

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
 * plus the last settled Community Home of a community (`recallCommunity`).
 *
 * Two things it does:
 *   · a read already in flight is SHARED, not repeated (the Home list and the
 *     community it redirects to ask at the same moment);
 *   · the last answer can be SHOWN at once while a fresh read runs, so a
 *     screen opens in its final composition with what is known, and replaces
 *     it quietly with what is true.
 *
 * WHAT IT NEVER DOES.
 *   · It never skips a read. Every screen still makes its own fresh,
 *     server-authorized read and replaces the remembered value with it; a
 *     refusal clears it. The warm value is a first frame, not an authority.
 *   · It never outlives the account. Everything is keyed to one uid and the
 *     whole record is dropped the moment a different uid -- or none -- asks
 *     (`scope`), and on sign-out (`clearMemberReads`). A second account on the
 *     same device never sees a byte of the first account's record.
 *   · It never reads ahead. Nothing here fetches a community the member has
 *     not opened or a screen they have not visited; it only keeps what a
 *     screen they did visit already read.
 *   · It never persists: no storage, no disk, gone on reload.
 */

type Entry = { value?: unknown; at?: number; inflight?: Promise<unknown> };

let owner: string | null = null;
const store = new Map<string, Entry>();

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
    store.clear();
    owner = uid;
  }
  return true;
}

/** Sign-out, and anything else that ends the account's session on this device. */
export function clearMemberReads(): void {
  store.clear();
  owner = null;
}

function peek<T>(uid: string | null, key: string): T | undefined {
  if (!scope(uid)) return undefined;
  return store.get(key)?.value as T | undefined;
}

function forget(uid: string | null, key: string): void {
  if (!scope(uid)) return;
  store.delete(key);
}

/**
 * The fresh read, shared with any identical read already in flight. The
 * answer is recorded only if the same account still owns the record when it
 * lands, so a slow answer for one account can never be kept for the next.
 */
function read<T>(uid: string, key: string, fetch: () => Promise<T>): Promise<T> {
  scope(uid);
  const entry = store.get(key) ?? {};
  if (entry.inflight) return entry.inflight as Promise<T>;
  const p = fetch()
    .then((value) => {
      if (owner === uid) store.set(key, { value, at: Date.now() });
      return value;
    })
    .catch((e: unknown) => {
      if (owner === uid) {
        const cur = store.get(key);
        if (cur) store.set(key, { value: cur.value, at: cur.at });
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

export function readMyCommunities(uid: string): Promise<MyCommunitiesAnswer> {
  return read(uid, MINE, async () => {
    const r = await httpsCallable<Record<string, never>, MyCommunitiesAnswer>(
      getFirebaseFunctions(),
      'wsfMyCommunities',
    )({});
    return { items: Array.isArray(r.data?.items) ? r.data.items : [] };
  });
}

// ---- wsfListGoals (with history) --------------------------------------------

export type ListedGoalsAnswer<G> = { goals: G[] };
const goalsKey = (groupId: string) => `wsfListGoals:${groupId}`;

export function peekGoals<G>(uid: string | null, groupId: string): ListedGoalsAnswer<G> | undefined {
  return peek<ListedGoalsAnswer<G>>(uid, goalsKey(groupId));
}

export function readGoals<G>(uid: string, groupId: string): Promise<ListedGoalsAnswer<G>> {
  return read(uid, goalsKey(groupId), async () => {
    const r = await httpsCallable<{ groupId: string; includeHistory: boolean }, ListedGoalsAnswer<G>>(
      getFirebaseFunctions(),
      'wsfListGoals',
    )({ groupId, includeHistory: true });
    return { goals: Array.isArray(r.data?.goals) ? r.data.goals : [] };
  });
}

// ---- the last settled Community Home ----------------------------------------

const homeKey = (groupId: string) => `communityHome:${groupId}`;

/** Kept when a Community Home settles as a member's ready screen. */
export function rememberCommunity<T>(uid: string | null, groupId: string, ready: T): void {
  if (!scope(uid)) return;
  store.set(homeKey(groupId), { value: ready, at: Date.now() });
}

export function recallCommunity<T>(uid: string | null, groupId: string): T | undefined {
  return peek<T>(uid, homeKey(groupId));
}

/**
 * The account is not (or no longer) a member here: nothing about this
 * community stays in the record, so re-entering it shows nothing it knew.
 */
export function forgetCommunity(uid: string | null, groupId: string): void {
  forget(uid, homeKey(groupId));
  forget(uid, goalsKey(groupId));
  // The membership list that still names it is stale too.
  forget(uid, MINE);
}
