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
import { useSyncExternalStore } from 'react';

import { deviceKv } from './storage/kv';
import { createKeyMirror } from './storage/mirror';
import { HAS_SYNC_STORAGE, readDeviceSync } from './storage/syncRead';

const KEY_PREFIX = 'wsf.currentCommunity.';

/*
  WHERE IT IS KEPT. The device store (src/storage/kv.ts): localStorage on web,
  read synchronously and directly every time exactly as before; AsyncStorage
  on a phone, read into memory at launch. Until that read has answered, rule 1
  is simply unavailable and the resolver gives rule 2 or 3 — the same worse
  guess a browser with storage blocked gets, and never a wrong claim. A screen
  that decides ONCE (Home's redirect) waits for `useCurrentCommunityReady`; an
  async load awaits `currentCommunityReady()` before it resolves.

  Per account, always: the key carries the uid, so a sign-out or an account
  switch never hands the next account the previous one's community.
*/
const store = createKeyMirror(deviceKv, readDeviceSync);
let ready = HAS_SYNC_STORAGE;
const readyListeners = new Set<() => void>();
const hydrated: Promise<void> = HAS_SYNC_STORAGE
  ? Promise.resolve()
  : store
      .loadPrefix(KEY_PREFIX)
      .catch(() => undefined)
      .then(() => {
        ready = true;
        for (const l of [...readyListeners]) l();
      });

/** Resolves once this device's remembered communities have been read. Immediate on web. */
export function currentCommunityReady(): Promise<void> {
  return hydrated;
}

export function isCurrentCommunityReady(): boolean {
  return ready;
}

function subscribeReady(l: () => void): () => void {
  readyListeners.add(l);
  return () => {
    readyListeners.delete(l);
  };
}

/** True once the remembered communities are readable (always, on web). */
export function useCurrentCommunityReady(): boolean {
  return useSyncExternalStore(subscribeReady, isCurrentCommunityReady, () => true);
}

/** Remember the community this account is in now. Resolves whether the device kept it. */
export function rememberCurrentCommunity(uid: string | null | undefined, groupId: string): Promise<boolean> {
  if (!uid || !groupId) return Promise.resolve(false);
  // A member whose device refuses storage still gets rule 2.
  return store.write(`${KEY_PREFIX}${uid}`, groupId);
}

export function forgetCurrentCommunity(uid: string | null | undefined): Promise<boolean> {
  if (!uid) return Promise.resolve(false);
  // The value is a convenience, never a source of truth.
  return store.remove(`${KEY_PREFIX}${uid}`);
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
  const remembered = uid ? store.read(`${KEY_PREFIX}${uid}`) : null;
  if (remembered && memberOf.includes(remembered)) return remembered;
  if (memberOf.length === 1) return memberOf[0];
  return null;
}

/**
 * The member's communities as they are PRESENTED: the current one first, then
 * the rest in the order they came (the server's), so the member's context is
 * the first thing each list says (Director #506 `5845751705`). Presentation
 * only: nothing is re-sorted at the source, and an unknown or missing current
 * id leaves the order exactly as it was.
 */
export function currentFirst<T extends { groupId: string }>(items: readonly T[], currentId: string | null | undefined): T[] {
  const i = currentId ? items.findIndex((c) => c.groupId === currentId) : -1;
  if (i <= 0) return [...items];
  return [items[i]!, ...items.slice(0, i), ...items.slice(i + 1)];
}
