/**
 * THE DEVICE STORAGE CONTRACT, in a module with no platform sibling.
 *
 * `kv.ts` (web) and `kv.native.ts` (iOS and Android) both implement it. It
 * used to be declared in `kv.ts` and imported by `kv.native.ts` from './kv'
 * — which, under Metro's native resolution (module suffixes `.ios`/`.android`,
 * `.native`, ``), resolves to `kv.native.ts` itself: a circular type alias, so
 * the native storage boundary was not type-checked against this contract at
 * all (runtime was unaffected; the imports are type-only). A file with no
 * `.native` sibling resolves the same way on every platform. Both `kv`
 * modules re-export these types, so importers of './kv' are unchanged.
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
