/**
 * Synchronous reads (iOS and Android): there are none.
 *
 * AsyncStorage can only be read asynchronously, so every answer here is
 * `undefined` — "not knowable synchronously" — and the caller uses its
 * hydrated in-memory mirror instead (src/storage/mirror.ts). Same contract as
 * `syncRead.ts`.
 */

/** False: native storage is asynchronous only. */
export const HAS_SYNC_STORAGE = false;

export function readDeviceSync(_key: string): string | null | undefined {
  return undefined;
}

export function readSessionSync(_key: string): string | null | undefined {
  return undefined;
}
