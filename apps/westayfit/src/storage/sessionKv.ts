/**
 * Session-lifetime storage boundary (web implementation).
 *
 * Some continuity records are deliberately SHORT-LIVED: a post-auth
 * destination has to survive the sign-up round trip (signup -> verify email
 * -> profile setup) and a reload in the middle of it, and then die, so a
 * stale handoff cannot greet the next person who uses the device. On web that
 * lifetime is the tab: sessionStorage survives client navigation and a
 * same-tab reload and is gone when the tab closes. This is that store, behind
 * the same async `DeviceKv` contract as `deviceKv`.
 *
 * Native has no tab session. `sessionKv.native.ts` gives the same records a
 * bounded expiry instead.
 */
import type { DeviceKv } from './kv';

function webSession(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export const sessionKv: DeviceKv = {
  async getItem(key) {
    try {
      return webSession()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  async readItem(key) {
    const s = webSession();
    if (!s) return { ok: false };
    try {
      return { ok: true, value: s.getItem(key) };
    } catch {
      return { ok: false };
    }
  },
  async setItem(key, value) {
    const s = webSession();
    if (!s) return false;
    try {
      s.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  async removeItem(key) {
    const s = webSession();
    if (!s) return false;
    try {
      s.removeItem(key);
      return true;
    } catch {
      return false;
    }
  },
  async keysWithPrefix(prefix) {
    const s = webSession();
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
