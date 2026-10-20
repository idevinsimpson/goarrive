/**
 * Device key-value storage boundary (web implementation).
 *
 * The app's continuity records (pending attempts, post-auth destinations,
 * selected community, device preferences) used to call window.localStorage
 * directly, which does not exist on native. This module is the one boundary
 * they go through instead. Metro picks `kv.native.ts` on iOS and Android.
 *
 * The API is asynchronous on every platform so callers are written once for
 * the slower case. Writes report whether they were durably accepted: a caller
 * that needs the record to exist before acting (a pending attempt before its
 * request) must check the result rather than assume it.
 */
export type DeviceKv = {
  /** The value, or null when absent OR UNREADABLE. Use `readItem` when the difference matters. */
  getItem(key: string): Promise<string | null>;
  /**
   * The value, telling "nothing stored" (`{ ok: true, value: null }`) apart
   * from "the device could not be read" (`{ ok: false }`). A caller that
   * would overwrite or clear a record on "nothing stored" must use this: an
   * unreadable record is not an absent one.
   *
   * `expiresAt` is set by a store whose values expire (the native session
   * store), so an in-memory copy can honour the same expiry after it is read.
   */
  readItem(key: string): Promise<KvRead>;
  setItem(key: string, value: string): Promise<boolean>;
  removeItem(key: string): Promise<boolean>;
  /** Keys starting with the prefix. Used to clear account-scoped records. */
  keysWithPrefix(prefix: string): Promise<string[]>;
  /** Set by a store whose writes expire after this long (the native session store). */
  readonly ttlMs?: number;
};

export type KvRead = { ok: true; value: string | null; expiresAt?: number } | { ok: false };

function webStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export const deviceKv: DeviceKv = {
  async getItem(key) {
    try {
      return webStorage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  async readItem(key) {
    const s = webStorage();
    if (!s) return { ok: false };
    try {
      return { ok: true, value: s.getItem(key) };
    } catch {
      return { ok: false };
    }
  },
  async setItem(key, value) {
    const s = webStorage();
    if (!s) return false;
    try {
      s.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  async removeItem(key) {
    const s = webStorage();
    if (!s) return false;
    try {
      s.removeItem(key);
      return true;
    } catch {
      return false;
    }
  },
  async keysWithPrefix(prefix) {
    const s = webStorage();
    if (!s) return [];
    try {
      const out: string[] = [];
      for (let i = 0; i < s.length; i += 1) {
        const k = s.key(i);
        if (k !== null && k.startsWith(prefix)) out.push(k);
      }
      return out;
    } catch {
      return [];
    }
  },
};
