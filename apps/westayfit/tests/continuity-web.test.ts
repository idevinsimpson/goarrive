import { beforeEach, describe, expect, it, vi } from 'vitest';

import { currentCommunityReady, isCurrentCommunityReady, resolveCurrentCommunity } from '../src/currentCommunity';
import { pendingKey, savePendingNew } from '../src/pendingContribution';
import { isPostAuthDestinationsReady } from '../src/postAuthDestination';
import {
  clearPendingJoinCode,
  nextRouteAfterAuth,
  readPendingJoinCode,
  routeAfterAuth,
  setPendingJoinCode,
} from '../src/pendingJoinCode';
import { readAuthDestinationKind } from '../src/authDestination';
import { createKeyMirror } from '../src/storage/mirror';
import { sessionKv } from '../src/storage/sessionKv';
import type { DeviceKv } from '../src/storage/kv';

// The post-auth destinations' session watch subscribes to Firebase Auth when
// an owned destination is written; here it is a captured listener.
const authListeners: Array<(user: { uid: string } | null) => void> = [];
vi.mock('../src/firebase', () => ({ getFirebaseAuth: () => ({}) }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_a: unknown, l: (user: { uid: string } | null) => void) => {
    authListeners.push(l);
    return () => undefined;
  },
}));

/**
 * NATIVE-STATE-1 — what the web build keeps, and the one rule it gains.
 *
 * The continuity records moved behind the device storage boundary. On web
 * that boundary is the same localStorage / sessionStorage, under the same keys
 * and in the same formats, read synchronously exactly as before. The one
 * deliberate change: a join code stashed while an account is signed in is that
 * account's alone (src/pendingJoinCode.ts).
 */

const CODE = 'WebJoinCode_0123456';
const A = 'uid-a';
const B = 'uid-b';

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('web: the same stores, keys, formats and synchronous reads', () => {
  it('a signed-out stash is the bare code in sessionStorage, readable on the very next line', () => {
    void setPendingJoinCode(CODE);
    expect(window.sessionStorage.getItem('wsf.pendingJoinCode')).toBe(CODE);
    expect(window.localStorage.getItem('wsf.pendingJoinCode')).toBeNull();
    expect(nextRouteAfterAuth('/')).toBe(`/join/${CODE}`);
    expect(isPostAuthDestinationsReady()).toBe(true);
  });

  it('a code seeded straight into sessionStorage (as the browser tests do) is honoured', async () => {
    window.sessionStorage.setItem('wsf.pendingJoinCode', CODE);
    expect(readPendingJoinCode(A)).toBe(CODE);
    expect(await routeAfterAuth('/', A)).toBe(`/join/${CODE}`);
  });

  it('clearing removes the session key', async () => {
    void setPendingJoinCode(CODE);
    expect(await clearPendingJoinCode()).toBe(true);
    expect(window.sessionStorage.getItem('wsf.pendingJoinCode')).toBeNull();
  });

  it('the session store is sessionStorage, not localStorage', async () => {
    expect(await sessionKv.setItem('wsf.t', '1')).toBe(true);
    expect(window.sessionStorage.getItem('wsf.t')).toBe('1');
    expect(window.localStorage.getItem('wsf.t')).toBeNull();
  });

  it('the remembered community is read from localStorage synchronously, with nothing to wait for', async () => {
    window.localStorage.setItem(`wsf.currentCommunity.${A}`, 'g2');
    expect(isCurrentCommunityReady()).toBe(true);
    expect(resolveCurrentCommunity(A, ['g1', 'g2'])).toBe('g2');
    await expect(currentCommunityReady()).resolves.toBeUndefined();
  });

  it('a pending record write the browser refuses resolves false — the screen is told it is not durable', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      expect(
        await savePendingNew({ goalId: 'g', attemptId: 'a1', count: 1, ts: 1, state: 'sending' }, A)
      ).toBe(false);
    } finally {
      spy.mockRestore();
    }
    expect(window.localStorage.getItem(pendingKey('g', A))).toBeNull();
  });
});

describe('web and native: a join code stashed under an account is that account’s alone', () => {
  it('is stored with its owner and never offered to another account or a signed-out reader', () => {
    void setPendingJoinCode(CODE, A);
    expect(JSON.parse(window.sessionStorage.getItem('wsf.pendingJoinCode') as string)).toEqual({ code: CODE, owner: A });
    expect(readPendingJoinCode(A)).toBe(CODE);
    expect(readPendingJoinCode(B)).toBeNull();
    expect(readPendingJoinCode(null)).toBeNull();
    expect(readAuthDestinationKind(null)).toBeNull();
    expect(readAuthDestinationKind(A)).toBe('join');
    expect(nextRouteAfterAuth('/', B)).toBe('/');
    expect(nextRouteAfterAuth('/', A)).toBe(`/join/${CODE}`);
  });

  it("is dropped at another account's terminal hop, so it does not wait for its owner either", async () => {
    void setPendingJoinCode(CODE, A);
    expect(await routeAfterAuth('/', B)).toBe('/');
    expect(window.sessionStorage.getItem('wsf.pendingJoinCode')).toBeNull();
    expect(await routeAfterAuth('/', A)).toBe('/');
  });

  it('a signed-out stash still serves the round trip, including a change of account at a gate', async () => {
    void setPendingJoinCode(CODE, null);
    // Signed up as the wrong account, signed out at verify, signed in as the right one.
    expect(readAuthDestinationKind(A)).toBe('join');
    expect(await routeAfterAuth('/', B)).toBe(`/join/${CODE}`);
  });

  it('refuses a malformed code, owned or not', async () => {
    expect(await setPendingJoinCode('short', A)).toBe(false);
    window.sessionStorage.setItem('wsf.pendingJoinCode', JSON.stringify({ code: '../evil', owner: A }));
    expect(readPendingJoinCode(A)).toBeNull();
  });
});

describe('the synchronous mirror (native path)', () => {
  function memoryKv(map: Map<string, string>, gate: () => Promise<void>): DeviceKv {
    return {
      async getItem(k) {
        await gate();
        return map.get(k) ?? null;
      },
      async readItem(k) {
        await gate();
        return { ok: true, value: map.get(k) ?? null };
      },
      async setItem(k, v) {
        map.set(k, v);
        return true;
      },
      async removeItem(k) {
        map.delete(k);
        return true;
      },
      async keysWithPrefix(p) {
        return [...map.keys()].filter((k) => k.startsWith(p));
      },
    };
  }

  it('a hydration that answers after a write never overwrites the newer write', async () => {
    const map = new Map([['k', 'old']]);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const mirror = createKeyMirror(memoryKv(map, () => held), () => undefined);
    expect(mirror.loaded('k')).toBe(false);
    expect(mirror.read('k')).toBeNull();
    const loading = mirror.load('k');
    await mirror.write('k', 'new');
    release();
    await loading;
    expect(mirror.read('k')).toBe('new');
    expect(map.get('k')).toBe('new');
  });

  it('reads the stored value once hydrated, and notifies', async () => {
    const map = new Map([['k', 'stored']]);
    const mirror = createKeyMirror(memoryKv(map, async () => {}), () => undefined);
    const seen = vi.fn();
    mirror.subscribe(seen);
    await mirror.load('k');
    expect(mirror.read('k')).toBe('stored');
    expect(seen).toHaveBeenCalled();
  });
});

describe('web (NATIVE-STATE-2): event, marker and kiosk returns under the same ownership rule', () => {
  it('a signed-out stash is stored exactly as before', async () => {
    const { setEventReturn } = await import('../src/eventReturn');
    const { setMarkerReturn } = await import('../src/markerEntry');
    const { setKioskReturnGoal } = await import('../src/kioskSession');
    void setEventReturn('goal-1', 1000);
    void setMarkerReturn('flag-01', 2000);
    void setKioskReturnGoal('goal-k');
    expect(window.sessionStorage.getItem('wsf.eventReturn')).toBe('{"goalId":"goal-1","at":1000}');
    expect(window.sessionStorage.getItem('wsf.markerReturn')).toBe('{"slug":"flag-01","at":2000}');
    expect(window.sessionStorage.getItem('wsf.kioskReturnGoalId')).toBe('goal-k');
    expect(window.localStorage.length).toBe(0);
  });

  it('a stash by a signed-in account carries its owner and is not offered to anybody else', async () => {
    const { readEventReturn, setEventReturn } = await import('../src/eventReturn');
    const { readMarkerReturn, setMarkerReturn } = await import('../src/markerEntry');
    const { readKioskReturnGoal, setKioskReturnGoal } = await import('../src/kioskSession');
    const now = Date.now();
    void setEventReturn('goal-1', now, A);
    void setMarkerReturn('flag-01', now, A);
    void setKioskReturnGoal('goal-k', A);
    expect(JSON.parse(window.sessionStorage.getItem('wsf.eventReturn') as string)).toEqual({ goalId: 'goal-1', at: now, owner: A });
    expect(readEventReturn(now, A)).toBe('goal-1');
    expect(readEventReturn(now, B)).toBeNull();
    expect(readEventReturn(now)).toBeNull();
    expect(readMarkerReturn(now, A)).toBe('flag-01');
    expect(readMarkerReturn(now, B)).toBeNull();
    expect(readKioskReturnGoal(A)).toBe('goal-k');
    expect(readKioskReturnGoal(null)).toBeNull();
    expect(readAuthDestinationKind(B)).toBeNull();
  });

  it("signing out clears the account's own destinations and leaves the signed-out handoff", async () => {
    const { setMarkerReturn } = await import('../src/markerEntry');
    const { setEventReturn } = await import('../src/eventReturn');
    void setPendingJoinCode(CODE, A);
    void setMarkerReturn('flag-01', Date.now(), A);
    void setEventReturn('goal-1', Date.now(), null);
    expect(authListeners.length).toBeGreaterThan(0);
    for (const l of authListeners) l(null);
    await new Promise((r) => setTimeout(r, 0));
    expect(window.sessionStorage.getItem('wsf.pendingJoinCode')).toBeNull();
    expect(window.sessionStorage.getItem('wsf.markerReturn')).toBeNull();
    expect(window.sessionStorage.getItem('wsf.eventReturn')).not.toBeNull();
  });
});
