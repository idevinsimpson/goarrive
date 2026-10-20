/**
 * Session-lifetime storage boundary (iOS and Android).
 *
 * WHY AN EXPIRY. On web a "session" record lives in sessionStorage and dies
 * when the tab closes. A phone app has no tab: AsyncStorage persists across
 * process termination, which is exactly what the sign-up round trip needs
 * (the OS may kill the app while the member is in their mail app verifying
 * their address) and exactly what a short-lived handoff must not do forever.
 * So every value written here carries an expiry and is refused, and removed,
 * once it has passed.
 *
 * WHY TWO HOURS. It is the bound this app already approved for the same shape
 * of record — the event return (`EVENT_RETURN_MAX_AGE_MS` in
 * src/eventReturn.ts): long enough for a slow sign-up with a verification mail
 * in the middle, short enough that it is still the same visit. A value stamped
 * with an expiry further out than that was written by a clock we cannot trust
 * and is refused the same way.
 *
 * Identity is NOT decided here. A record that must only be read back by one
 * account says so in its own value (src/pendingJoinCode.ts does).
 */
import { deviceKv, type DeviceKv } from './kv';

export const NATIVE_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

type Envelope = { v: string; exp: number };

function open(raw: string | null, now: number): string | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Envelope> | null;
    if (!parsed || typeof parsed.v !== 'string' || typeof parsed.exp !== 'number') return null;
    if (parsed.exp <= now) return null;
    if (parsed.exp > now + NATIVE_SESSION_TTL_MS) return null;
    return parsed.v;
  } catch {
    return null;
  }
}

export const sessionKv: DeviceKv = {
  async getItem(key) {
    const raw = await deviceKv.getItem(key);
    const value = open(raw, Date.now());
    // Expired, malformed or future-stamped: gone, not merely ignored, so it
    // cannot come back if the clock moves.
    if (raw != null && value == null) await deviceKv.removeItem(key);
    return value;
  },
  async setItem(key, value) {
    const envelope: Envelope = { v: value, exp: Date.now() + NATIVE_SESSION_TTL_MS };
    return deviceKv.setItem(key, JSON.stringify(envelope));
  },
  async removeItem(key) {
    return deviceKv.removeItem(key);
  },
  async keysWithPrefix(prefix) {
    return deviceKv.keysWithPrefix(prefix);
  },
};
