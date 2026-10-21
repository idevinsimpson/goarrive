/**
 * A synchronous view of an asynchronous store, for records read during render.
 *
 * Which community Home opens, which destination a sign-in screen is carrying
 * and the camera preferences are all read while a screen renders, and render
 * cannot await. So each of those stores reads through one of these:
 *
 *   - WEB: `readSync` answers from storage itself, every time. Nothing is
 *     cached, so behaviour is exactly what direct localStorage /
 *     sessionStorage reads gave (a reload, another tab, a test that clears
 *     storage all see the truth).
 *   - NATIVE: `readSync` answers `undefined`, and reads come from an in-memory
 *     copy. A key is "loaded" once it has been hydrated from the async store
 *     or written in this process. Before that it reads as nothing — callers
 *     that must not act on "nothing yet" check `loaded()` or await `load()`.
 *
 * Writes go to memory immediately (so this process reads its own writes on
 * the next line) and to the store asynchronously; the returned promise says
 * whether the store accepted it. A hydration that resolves after a write in
 * this process never overwrites that newer write.
 *
 * AN UNREADABLE KEY IS NOT AN EMPTY ONE. If the store cannot be read (the
 * read is tried twice, each try bounded), the key is answered as nothing —
 * so no screen waits on it forever — but `unreadable(key)` says so, and a
 * caller that would write a value DERIVED from "nothing stored" checks it
 * first rather than overwrite a record it could not see. An explicit write
 * clears the flag. (Only the camera settings derive a write today, and they
 * check it. A member's own explicit change made AFTER an unreadable launch
 * read — a settings toggle, a chosen community — is written as asked, and
 * replaces the stored value it could not see; that is their choice now.) A
 * prefix listing that fails or does not answer reads as no keys.
 *
 * EXPIRY. A store whose values expire (the native session store, two hours)
 * reports each value's expiry when it is read and its lifetime when written.
 * The in-memory copy honours it: an expired value reads as nothing, however
 * long this process has been running.
 */
import { bounded, STORAGE_OP_TIMEOUT_MS } from './keyQueue';
import type { DeviceKv } from './kv';

export type KeyMirror = {
  /** Synchronous read. Web: storage truth. Native: hydrated or written value, else null. */
  read(key: string): string | null;
  /** Whether `read(key)` reflects the store yet. Always true on web. */
  loaded(key: string): boolean;
  /** Native: the store could not be read for this key, so `read` answering null proves nothing. */
  unreadable(key: string): boolean;
  /**
   * How many writes (not removals) this process has made to `key` through
   * this mirror. A caller that removes a record and must not then destroy a
   * NEWER write — even one with the same value — compares it before and
   * after. Works on web too, where `read` is the browser store itself.
   */
  writeCount(key: string): number;
  /** Hydrate one key from the store (no-op once loaded). */
  load(key: string): Promise<void>;
  /** Hydrate every stored key with this prefix. */
  loadPrefix(prefix: string): Promise<void>;
  /** Write through. Resolves true only if the store accepted it. */
  write(key: string, value: string): Promise<boolean>;
  /** Remove through. Resolves true only if the store accepted it. */
  remove(key: string): Promise<boolean>;
  /** Called after any hydration or write changes what `read` returns. */
  subscribe(listener: () => void): () => void;
};

export function createKeyMirror(
  kv: DeviceKv,
  readSync: (key: string) => string | null | undefined,
  now: () => number = Date.now
): KeyMirror {
  // value + the time it stops being true (undefined: it does not expire).
  const memory = new Map<string, { value: string | null; expiresAt?: number }>();
  const failed = new Set<string>();
  // Per-key count of writes made in this process. A hydration started before
  // a write must not land on top of it.
  const writes = new Map<string, number>();
  // Writes only (removals excluded), for `writeCount`.
  const written = new Map<string, number>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const l of [...listeners]) {
      try {
        l();
      } catch {
        // A listener's failure is its own; the store has already changed.
      }
    }
  };
  const bump = (key: string) => writes.set(key, (writes.get(key) ?? 0) + 1);

  const loaded = (key: string) => readSync(key) !== undefined || memory.has(key);

  // Every read is BOUNDED (src/storage/keyQueue.ts): a device call that never
  // answers counts as unreadable after the bound, so a screen waiting on
  // `load` is never held for good. (The session store bounds its own calls
  // too; the device store does not, so this is where its reads are bounded.)
  const readOnce = async (key: string) => {
    try {
      return await bounded(() => kv.readItem(key), STORAGE_OP_TIMEOUT_MS, () => ({ ok: false }) as const);
    } catch {
      return { ok: false } as const;
    }
  };

  const load = async (key: string) => {
    if (loaded(key)) return;
    const before = writes.get(key) ?? 0;
    let read = await readOnce(key);
    if (!read.ok) read = await readOnce(key);
    if ((writes.get(key) ?? 0) !== before || memory.has(key)) return;
    if (read.ok) {
      memory.set(key, { value: read.value, expiresAt: read.expiresAt });
    } else {
      failed.add(key);
      memory.set(key, { value: null });
    }
    notify();
  };

  const stamp = () => (kv.ttlMs != null ? now() + kv.ttlMs : undefined);

  return {
    read(key) {
      const sync = readSync(key);
      if (sync !== undefined) return sync;
      const held = memory.get(key);
      if (!held) return null;
      if (held.expiresAt != null && held.expiresAt <= now()) return null;
      return held.value;
    },
    loaded,
    unreadable(key) {
      return failed.has(key);
    },
    writeCount(key) {
      return written.get(key) ?? 0;
    },
    load,
    async loadPrefix(prefix) {
      let keys: string[] = [];
      try {
        keys = await bounded(() => kv.keysWithPrefix(prefix), STORAGE_OP_TIMEOUT_MS, () => []);
      } catch {
        keys = [];
      }
      await Promise.all(keys.map((k) => load(k)));
    },
    write(key, value) {
      bump(key);
      written.set(key, (written.get(key) ?? 0) + 1);
      failed.delete(key);
      memory.set(key, { value, expiresAt: stamp() });
      notify();
      return kv.setItem(key, value).catch(() => false);
    },
    remove(key) {
      bump(key);
      memory.set(key, { value: null });
      notify();
      return kv.removeItem(key).catch(() => false);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
