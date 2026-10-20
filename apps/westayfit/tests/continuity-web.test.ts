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

describe('web (NATIVE-STATE-3): the join QR event context and the device-mode answer', () => {
  const JOIN_A = 'JoinCodeForGroupA_01';
  const JOIN_B = 'JoinCodeForGroupB_02';

  it('a signed-out stash is stored with the join code it arrived on', async () => {
    const { setPendingEventActivity, setPendingEventGoal } = await import('../src/stationSession');
    void setPendingEventGoal('goal_1', JOIN_A);
    void setPendingEventActivity('squats', 'goal_1', JOIN_A);
    expect(window.sessionStorage.getItem('wsf.pendingEventGoalId')).toBe(
      JSON.stringify({ goalId: 'goal_1', joinCode: JOIN_A })
    );
    expect(window.sessionStorage.getItem('wsf.pendingEventActivity')).toBe(
      JSON.stringify({ activity: 'squats', goalId: 'goal_1', joinCode: JOIN_A })
    );
    expect(window.localStorage.length).toBe(0);
  });

  it("a member's stash carries its owner and is not applied to another account's join", async () => {
    const je = await import('../src/joinEventHandoff');
    void je.setPendingEventGoal('goal_1', JOIN_A, A);
    void je.setPendingEventActivity('squats', 'goal_1', JOIN_A, A);
    expect(JSON.parse(window.sessionStorage.getItem('wsf.pendingEventGoalId') as string)).toEqual({
      goalId: 'goal_1',
      joinCode: JOIN_A,
      owner: A,
    });
    expect(await je.takeJoinEventContext(B, JOIN_A)).toEqual({ goalId: null, activity: null });
    expect(window.sessionStorage.getItem('wsf.pendingEventGoalId')).toBeNull();
  });

  it('the same account takes its own context for the same code, once', async () => {
    const je = await import('../src/joinEventHandoff');
    void je.setPendingEventGoal('goal_1', JOIN_A, A);
    void je.setPendingEventActivity('squats', 'goal_1', JOIN_A, A);
    expect(await je.takeJoinEventContext(A, JOIN_A)).toEqual({ goalId: 'goal_1', activity: 'squats' });
    expect(await je.takeJoinEventContext(A, JOIN_A)).toEqual({ goalId: null, activity: null });
  });

  it('an abandoned event scan for join A does not redirect a later join B in the same tab', async () => {
    const je = await import('../src/joinEventHandoff');
    const { routeAfterJoin } = await import('../src/stationSession');
    void je.setPendingEventGoal('goal_1', JOIN_A);
    void je.setPendingEventActivity('squats', 'goal_1', JOIN_A);
    const context = await je.takeJoinEventContext(A, JOIN_B);
    expect(context).toEqual({ goalId: null, activity: null });
    expect(routeAfterJoin('group_b', context.goalId, context.activity)).toBe('/community/group_b');
    expect(window.sessionStorage.getItem('wsf.pendingEventGoalId')).toBeNull();
    expect(window.sessionStorage.getItem('wsf.pendingEventActivity')).toBeNull();
  });

  it('a bare event or activity left in the tab from before the code was kept is discarded, never routed', async () => {
    const je = await import('../src/joinEventHandoff');
    window.sessionStorage.setItem('wsf.pendingEventGoalId', 'goal_1');
    window.sessionStorage.setItem('wsf.pendingEventActivity', 'squats');
    expect(await je.takeJoinEventContext(A, JOIN_A)).toEqual({ goalId: null, activity: null });
    expect(window.sessionStorage.length).toBe(0);
  });

  it('the device-mode answer stays the bare word in localStorage, readable at once', async () => {
    const dm = await import('../src/deviceMode');
    expect(dm.isDeviceModeReady()).toBe(true);
    expect(await dm.saveDeviceMode('shared')).toBe(true);
    expect(window.localStorage.getItem('wsf.deviceMode')).toBe('shared');
    expect(dm.readDeviceMode()).toBe('shared');
    // Not an account's: an auth change leaves it alone.
    for (const l of authListeners) l(null);
    await new Promise((r) => setTimeout(r, 0));
    expect(dm.readDeviceMode()).toBe('shared');
  });
});

describe('web (NATIVE-STATE-2 review): an owned record found after a same-tab reload is still cleared at sign-out', () => {
  it('the session watch starts when the module loads over an owned record, and sign-out clears it', async () => {
    window.sessionStorage.setItem(
      'wsf.markerReturn',
      JSON.stringify({ slug: 'flag-01', at: Date.now(), owner: A })
    );
    // The "reload": fresh module instances over the same sessionStorage.
    vi.resetModules();
    const before = authListeners.length;
    const { readMarkerReturn } = await import('../src/markerEntry');
    await import('../src/pendingJoinCode');
    await new Promise((r) => setTimeout(r, 0));
    expect(authListeners.length).toBe(before + 1);
    expect(readMarkerReturn(Date.now(), A)).toBe('flag-01');
    authListeners[authListeners.length - 1]!(null);
    await new Promise((r) => setTimeout(r, 0));
    expect(window.sessionStorage.getItem('wsf.markerReturn')).toBeNull();
  });

  it('nothing owned in the tab: no watch is started by loading the module', async () => {
    window.sessionStorage.setItem('wsf.markerReturn', JSON.stringify({ slug: 'flag-01', at: Date.now() }));
    vi.resetModules();
    const before = authListeners.length;
    await import('../src/markerEntry');
    await import('../src/pendingJoinCode');
    await new Promise((r) => setTimeout(r, 0));
    expect(authListeners.length).toBe(before);
    window.sessionStorage.clear();
  });
});
