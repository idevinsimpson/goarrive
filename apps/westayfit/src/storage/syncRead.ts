/**
 * Synchronous reads of the same stores the async boundaries write to (web).
 *
 * Web storage is synchronous, and several continuity records are read during
 * render (which community Home opens, which destination a sign-in screen is
 * carrying, the camera preferences). On web those reads keep going straight
 * to storage, exactly as they did before the async boundary existed, so a
 * reload, a second tab or a test that clears storage sees what it always saw.
 *
 * Native has no synchronous storage: `syncRead.native.ts` answers `undefined`
 * ("not knowable synchronously"), and the stores fall back to an in-memory
 * mirror hydrated from `deviceKv` / `sessionKv` (src/storage/mirror.ts).
 *
 * `null` means "known: nothing stored" (including SSR and a browser that
 * refuses storage, which is how those cases have always read).
 */

/** True where storage can be read synchronously (web). */
export const HAS_SYNC_STORAGE = true;

function read(which: 'localStorage' | 'sessionStorage', key: string): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const s = window[which];
    if (!s) return null;
    return s.getItem(key);
  } catch {
    return null;
  }
}

/** The value `deviceKv` holds for `key` (web: localStorage). */
export function readDeviceSync(key: string): string | null | undefined {
  return read('localStorage', key);
}

/** The value `sessionKv` holds for `key` (web: sessionStorage). */
export function readSessionSync(key: string): string | null | undefined {
  return read('sessionStorage', key);
}
