/**
 * THE POST-AUTH DESTINATIONS, AS ONE FAMILY (NATIVE-STATE-1 / -2).
 *
 * Four records carry somebody back to where they were across the sign-in
 * round trip: a pending join code (src/pendingJoinCode.ts), an event return
 * (src/eventReturn.ts), a kiosk return goal (src/kioskSession.ts) and a marker
 * return (src/markerEntry.ts). Each stores an id or slug, never a URL, and each
 * keeps its own format and validation. What they share lives here, once:
 *
 * WHERE THEY ARE KEPT (src/storage/sessionKv.ts).
 *   - WEB: sessionStorage, read synchronously and directly every time, exactly
 *     as before: it survives the auth hops and a same-tab reload and dies with
 *     the tab.
 *   - iOS / ANDROID: there is no tab. AsyncStorage, so the round trip survives
 *     the OS killing the app mid-sign-up, with a TWO-HOUR expiry on every value
 *     (`NATIVE_SESSION_TTL_MS`, the bound already approved for the event
 *     return). Read into memory at launch; the terminal hop waits for that read
 *     (`postAuthDestinationsReady`), and the identity screens re-render when it
 *     lands (`usePostAuthDestinationsReady`).
 *
 * WHOSE THEY ARE. Every destination is stored with the account that was signed
 * in when it was stashed, or with nobody:
 *   - stashed SIGNED OUT, it is the pre-auth handoff for whoever completes
 *     sign-in on this device next — the whole point of the round trip,
 *     including "wrong account, sign out, sign in as the right one" at the
 *     identity gates. Its reach is the tab (web) or the expiry (native), and
 *     the destination screen consumes it when the visitor arrives.
 *   - stashed while ACCOUNT A was signed in, it is A's alone: never routed to,
 *     or announced to, another account or a signed-out reader; dropped at the
 *     first terminal hop anybody else completes; and dropped the moment A's
 *     session ends on this device (sign-out or account switch, below).
 *
 * THE SESSION WATCH. The moment an owned destination exists in this process —
 * written, found in the tab when this module loads (web: sessionStorage
 * survives a same-tab reload), or found at the native launch read — this
 * module watches the auth state itself (the same pattern as src/memberReads.ts: it does not rely on
 * every sign-out control remembering to clear it). On every auth answer, any
 * destination owned by an account other than the one signed in now is
 * removed. Signed-out handoffs are never touched by it.
 */
import { onAuthStateChanged } from 'firebase/auth';
import { useSyncExternalStore } from 'react';

import { getFirebaseAuth } from './firebase';
import { createKeyMirror } from './storage/mirror';
import { sessionKv } from './storage/sessionKv';
import { HAS_SYNC_STORAGE, readSessionSync } from './storage/syncRead';

export type Owned<V> = { value: V; owner: string | null };

export type DestinationCodec<V> = {
  key: string;
  /** The stored string, or null for anything this record cannot vouch for. */
  decode(raw: string): Owned<V> | null;
  encode(value: V, owner: string | null): string;
};

export type PostAuthDestination<V> = {
  key: string;
  /** The stored record with its owner, unfiltered. */
  peek(): Owned<V> | null;
  /** The value for `uid` (null: a signed-out reader), or null if it is somebody else's. */
  read(uid: string | null): V | null;
  /** Stash it. `owner` is the account signed in now, or null. Resolves whether the device kept it. */
  write(value: V, owner: string | null): Promise<boolean>;
  clear(): Promise<boolean>;
  /**
   * Clear it FOR GOOD: a removal the device refuses is retried once, and if
   * it still refuses, the record is overwritten with `DISCARDED_RECORD`,
   * which no destination decodes — so a record that must be consumed once
   * cannot apply again after a relaunch. Resolves whether any of the three
   * steps was kept.
   */
  discard(): Promise<boolean>;
};

/** What a record that could not be removed is overwritten with. Every codec decodes it as nothing. */
export const DISCARDED_RECORD = '{"discarded":true}';

const store = createKeyMirror(sessionKv, readSessionSync);
const registry: PostAuthDestination<unknown>[] = [];
const loads = new Map<string, Promise<void>>();

function loadKey(key: string): Promise<void> {
  let p = loads.get(key);
  if (!p) {
    p = store.load(key);
    loads.set(key, p);
  }
  return p;
}

export function definePostAuthDestination<V>(codec: DestinationCodec<V>): PostAuthDestination<V> {
  const peek = (): Owned<V> | null => {
    const raw = store.read(codec.key);
    return raw == null ? null : codec.decode(raw);
  };
  const destination: PostAuthDestination<V> = {
    key: codec.key,
    peek,
    read(uid) {
      const owned = peek();
      if (!owned) return null;
      if (owned.owner !== null && owned.owner !== uid) return null;
      return owned.value;
    },
    write(value, owner) {
      if (owner) watchAccountSession();
      return store.write(codec.key, codec.encode(value, owner));
    },
    clear() {
      return store.remove(codec.key);
    },
    async discard() {
      if (await store.remove(codec.key)) return true;
      if (await store.remove(codec.key)) return true;
      return store.write(codec.key, DISCARDED_RECORD);
    },
  };
  registry.push(destination as PostAuthDestination<unknown>);
  if (HAS_SYNC_STORAGE) {
    // Web: a same-tab reload keeps sessionStorage, so an account's record can
    // already be here when this module loads — and its sign-out must still
    // clear it. Deferred, so loading this module never initialises Firebase
    // by itself. (During a server render there is no window: nothing is
    // found and nothing starts.)
    if (peek()?.owner) queueMicrotask(watchAccountSession);
  } else {
    // Native: read it at launch, and start the session watch if what was
    // left on the device belongs to an account.
    void loadKey(codec.key).then(() => {
      if (peek()?.owner) watchAccountSession();
    });
  }
  return destination;
}

/** Resolves once every destination has been read from the device. Immediate on web. */
export function postAuthDestinationsReady(): Promise<void> {
  return Promise.all(registry.map((d) => loadKey(d.key))).then(() => undefined);
}

export function isPostAuthDestinationsReady(): boolean {
  return registry.every((d) => store.loaded(d.key));
}

/**
 * Re-renders once the destinations have been read (native). Always true on
 * web. A screen that SAYS a destination is waiting reads it again when this
 * flips; it does not otherwise react to changes, exactly as before.
 */
export function usePostAuthDestinationsReady(): boolean {
  return useSyncExternalStore(store.subscribe, isPostAuthDestinationsReady, () => true);
}

/**
 * Remove every destination owned by an account other than `uid` (null: nobody
 * is signed in). Signed-out handoffs stay. Called by the session watch on every
 * auth answer, and by the terminal hop for the account completing it.
 */
export async function dropForeignDestinations(uid: string | null): Promise<void> {
  await postAuthDestinationsReady();
  await Promise.all(
    registry.map(async (d) => {
      const owned = d.peek();
      if (owned && owned.owner !== null && owned.owner !== uid) await d.clear();
    })
  );
}

let watching = false;
function watchAccountSession(): void {
  if (watching) return;
  watching = true;
  try {
    onAuthStateChanged(getFirebaseAuth(), (user) => {
      void dropForeignDestinations(user?.uid ?? null);
    });
  } catch {
    // No auth on this build (flag off) means no account can own anything;
    // the read rule still keeps any owned record from anybody else.
    watching = false;
  }
}
