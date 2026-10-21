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
 * with an expiry further out than that (beyond a few minutes' clock
 * correction) was written by a clock we cannot trust and is refused the same
 * way.
 *
 * Identity is NOT decided here. A record that must only be read back by one
 * account says so in its own value (src/pendingJoinCode.ts does).
 */
import { deviceKv, type DeviceKv, type KvRead } from './kv';
import { createKeyQueue } from './keyQueue';

export const NATIVE_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * How far past the two-hour bound an expiry may sit and still be honoured: a
 * device clock corrected by a few minutes between the write and the read is
 * not a clock this module should distrust. Anything further out is refused.
 */
export const NATIVE_SESSION_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

type Envelope = { v: string; exp: number };

function open(raw: string, now: number): Envelope | null {
  try {
    const parsed = JSON.parse(raw) as Partial<Envelope> | null;
    if (!parsed || typeof parsed.v !== 'string' || typeof parsed.exp !== 'number') return null;
    if (parsed.exp <= now) return null;
    if (parsed.exp > now + NATIVE_SESSION_TTL_MS + NATIVE_SESSION_FUTURE_TOLERANCE_MS) return null;
    return { v: parsed.v, exp: parsed.exp };
  } catch {
    return null;
  }
}

/*
  Every operation on a key is queued (src/storage/keyQueue.ts). A read that
  finds an expired value removes it, and that read-then-remove is one queued
  operation: a write queued after the read cannot land between them and then
  be deleted as if it were the expired value. The remove is also conditional
  on the stored value still being exactly what was read.
*/
const onKey = createKeyQueue();

async function readUnqueued(key: string): Promise<KvRead> {
  const raw = await deviceKv.readItem(key);
  if (!raw.ok) return raw;
  if (raw.value == null) return { ok: true, value: null };
  const opened = open(raw.value, Date.now());
  if (opened) return { ok: true, value: opened.v, expiresAt: opened.exp };
  // Expired, malformed or future-stamped: gone, not merely ignored, so it
  // cannot come back if the clock moves — but only if it is still the value
  // that was read.
  const again = await deviceKv.readItem(key);
  if (again.ok && again.value === raw.value) await deviceKv.removeItem(key);
  return { ok: true, value: null };
}

function readItem(key: string): Promise<KvRead> {
  return onKey(key, () => readUnqueued(key), () => ({ ok: false }));
}

export const sessionKv: DeviceKv = {
  ttlMs: NATIVE_SESSION_TTL_MS,
  readItem,
  async getItem(key) {
    const read = await readItem(key);
    return read.ok ? read.value : null;
  },
  setItem(key, value) {
    return onKey(
      key,
      () => {
        const envelope: Envelope = { v: value, exp: Date.now() + NATIVE_SESSION_TTL_MS };
        return deviceKv.setItem(key, JSON.stringify(envelope));
      },
      () => false
    );
  },
  removeItem(key) {
    return onKey(key, () => deviceKv.removeItem(key), () => false);
  },
  keysWithPrefix(prefix) {
    return deviceKv.keysWithPrefix(prefix);
  },
};
