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
 */
import type { DeviceKv } from './kv';

export type KeyMirror = {
  /** Synchronous read. Web: storage truth. Native: hydrated or written value, else null. */
  read(key: string): string | null;
  /** Whether `read(key)` reflects the store yet. Always true on web. */
  loaded(key: string): boolean;
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
  readSync: (key: string) => string | null | undefined
): KeyMirror {
  const memory = new Map<string, string | null>();
  // Per-key count of writes made in this process. A hydration started before
  // a write must not land on top of it.
  const writes = new Map<string, number>();
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

  const load = async (key: string) => {
    if (loaded(key)) return;
    const before = writes.get(key) ?? 0;
    let value: string | null = null;
    try {
      value = await kv.getItem(key);
    } catch {
      value = null;
    }
    if ((writes.get(key) ?? 0) !== before || memory.has(key)) return;
    memory.set(key, value);
    notify();
  };

  return {
    read(key) {
      const sync = readSync(key);
      if (sync !== undefined) return sync;
      return memory.get(key) ?? null;
    },
    loaded,
    load,
    async loadPrefix(prefix) {
      let keys: string[] = [];
      try {
        keys = await kv.keysWithPrefix(prefix);
      } catch {
        keys = [];
      }
      await Promise.all(keys.map((k) => load(k)));
    },
    write(key, value) {
      bump(key);
      memory.set(key, value);
      notify();
      return kv.setItem(key, value).catch(() => false);
    },
    remove(key) {
      bump(key);
      memory.set(key, null);
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
