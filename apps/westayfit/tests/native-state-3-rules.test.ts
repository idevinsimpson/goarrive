import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootNative, createFakeAsyncStorage, fakeAuth, type FakeAsyncStorage } from './nativeStorageHarness';

/**
 * NATIVE-STATE-3 review (#639): the join QR's event context, proved over the
 * NATIVE storage implementations (tests/nativeStorageHarness.ts), with the
 * route wiring pinned to app/join/[joinCode].tsx's own text where the route
 * cannot be imported. Not a device run.
 */

const A = 'uid-a';
const B = 'uid-b';
const CODE = 'JoinCodeFromTheHall_01';
const G1 = 'goal-one_1';
const G2 = 'goal-two_2';
const GROUP = 'group_1';
const EVENT_KEY = 'wsf.pendingEventGoalId';
const ACTIVITY_KEY = 'wsf.pendingEventActivity';
const JOIN_KEY = 'wsf.pendingJoinCode';
const ROUTE = readFileSync(path.resolve('app/join/[joinCode].tsx'), 'utf8');

let disk: FakeAsyncStorage;

async function launch() {
  bootNative(disk);
  const je = await import('../src/joinEventHandoff');
  const pj = await import('../src/pendingJoinCode');
  const st = await import('../src/stationSession');
  const dm = await import('../src/deviceMode');
  const pad = await import('../src/postAuthDestination');
  const arm = await import('../src/handoffArming');
  return { je, pj, st, dm, pad, arm };
}
type M = Awaited<ReturnType<typeof launch>>;

/** What the join page writes on `/join/<code>?event=<goal>[&activity=<label>]`, once auth has settled. */
async function scan(m: M, goalId: string, activity: string | null, owner: string | null = null, code = CODE) {
  await m.pj.setPendingJoinCode(code, owner);
  await m.je.setPendingEventGoal(goalId, code, owner);
  if (activity) await m.je.setPendingEventActivity(activity, goalId, code, owner);
  else await m.je.clearPendingEventActivity();
}

async function finishJoin(m: M, uid: string, code = CODE) {
  await m.pj.clearPendingJoinCode();
  const context = await m.je.takeJoinEventContext(uid, code);
  return m.st.routeAfterJoin(GROUP, context.goalId, context.activity);
}

beforeEach(() => {
  disk = createFakeAsyncStorage();
  fakeAuth.listeners = [];
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  expect(window.localStorage.length).toBe(0);
  expect(window.sessionStorage.length).toBe(0);
  vi.useRealTimers();
  for (const m of [
    '@react-native-async-storage/async-storage',
    '../src/storage/kv',
    '../src/storage/sessionKv',
    '../src/storage/syncRead',
    '../src/firebase',
    'firebase/auth',
  ]) {
    vi.doUnmock(m);
  }
  vi.resetModules();
});

describe('the activity belongs to its goal, not only to the join code', () => {
  it('same code: G1 with Squats, then a bare QR for G2, then the join — G2, and no activity (across a relaunch)', async () => {
    let m = await launch();
    await scan(m, G1, 'Squats');
    m = await launch();
    // The second scan, exactly as the route does it: no ?activity.
    await scan(m, G2, null);
    expect(await finishJoin(m, A)).toBe(`/event/${G2}`);
    expect(disk.map.has(ACTIVITY_KEY)).toBe(false);
  });

  it('holds even if the route’s clear of the older activity never landed', async () => {
    let m = await launch();
    await scan(m, G1, 'Squats');
    m = await launch();
    // Only the goal is rewritten; G1's activity is still on the device.
    await m.je.setPendingEventGoal(G2, CODE, null);
    expect(disk.map.has(ACTIVITY_KEY)).toBe(true);
    expect(await finishJoin(m, A)).toBe(`/event/${G2}`);
  });

  it('the activity still rides with its own goal', async () => {
    let m = await launch();
    await scan(m, G1, 'Squats');
    m = await launch();
    expect(await finishJoin(m, A)).toBe(`/event/${G1}?activity=Squats`);
  });

  it('the route clears an older activity when an event arrives without one', () => {
    const effect = ROUTE.slice(ROUTE.indexOf('// THE ACTIVITY RIDES WITH IT'), ROUTE.indexOf('// Dropped once the screen is known to be shared'));
    expect(effect).toContain('if (eventActivity) void setPendingEventActivity(eventActivity, eventGoalId, joinCode, stashUid.current);');
    expect(effect).toContain('else void clearPendingEventActivity();');
  });

  it('accepted limit, pinned: a plain invite for the SAME code still finds the context (a return trip looks the same)', async () => {
    let m = await launch();
    await scan(m, G1, 'Squats');
    m = await launch();
    await m.pj.setPendingJoinCode(CODE, null); // a plain /join/<CODE>, no ?event
    expect(await finishJoin(m, A)).toBe(`/event/${G1}?activity=Squats`);
  });
});

describe('a shared screen takes no journey', () => {
  it('dropping the journey leaves nothing to route the next walk-up', async () => {
    let m = await launch();
    await scan(m, G1, 'Squats');
    m = await launch();
    expect(await m.je.dropJoinJourney()).toBe(true);
    for (const k of [JOIN_KEY, EVENT_KEY, ACTIVITY_KEY]) expect(disk.map.has(k), k).toBe(false);
    m = await launch();
    // The next visitor signs in on the kiosk: nothing sends them to /join or the event.
    expect(await m.pj.routeAfterAuth('/', B)).toBe('/');
    expect(await m.je.takeJoinEventContext(B, CODE)).toEqual({ goalId: null, activity: null });
  });

  it('the kiosk start screen at rest clears the join context too', async () => {
    let m = await launch();
    await scan(m, G1, 'Squats');
    m = await launch();
    await m.arm.resetSharedScreenHandoffs();
    for (const k of [JOIN_KEY, EVENT_KEY, ACTIVITY_KEY]) expect(disk.map.has(k), k).toBe(false);
  });

  it('the route stashes nothing while shared, drops what it stashed, and drops it on "shared" before handing off', () => {
    expect(ROUTE).toContain("const sharedScreen = !user && deviceEntry?.kind === 'shared';");
    expect(ROUTE).toContain('if (!joinCode || !ready || sharedScreen) return;\n    void setPendingJoinCode(joinCode, stashUid.current);');
    expect(ROUTE).toContain('if (!ready || !eventGoalId || !joinCode || sharedScreen) return;\n    void setPendingEventGoal(');
    expect(ROUTE).toContain('if (!ready || !eventGoalId || !joinCode || sharedScreen) return;\n    if (eventActivity)');
    expect(ROUTE).toContain('if (sharedScreen) void dropJoinJourney();');
    // The device mode is known before the stash effects are declared.
    expect(ROUTE.indexOf('const sharedScreen =')).toBeLessThan(ROUTE.indexOf('void setPendingJoinCode('));
    const shared = ROUTE.slice(ROUTE.indexOf('const onChooseShared = useCallback'), ROUTE.indexOf('const onUseOwnPhoneInstead'));
    expect(shared.indexOf('void dropJoinJourney();')).toBeGreaterThan(-1);
    expect(shared.indexOf('void dropJoinJourney();')).toBeLessThan(shared.indexOf('router.replace('));
  });
});

describe('consumed once means consumed, even when the device refuses a removal', () => {
  function refuseRemovals(times: number) {
    const real = disk.api.removeItem;
    let left = times;
    disk.api.removeItem = async (key: string) => {
      if (left > 0) {
        left -= 1;
        throw new Error('storage refused the removal');
      }
      return real(key);
    };
    return () => {
      disk.api.removeItem = real;
    };
  }

  it('removals refused every time: the record is overwritten, and does not apply again after a relaunch', async () => {
    let m = await launch();
    await scan(m, G1, 'Squats');
    m = await launch();
    const restore = refuseRemovals(Infinity);
    try {
      expect(await finishJoin(m, A)).toBe(`/event/${G1}?activity=Squats`);
    } finally {
      restore();
    }
    m = await launch();
    expect(await m.je.takeJoinEventContext(A, CODE)).toEqual({ goalId: null, activity: null });
    m = await launch();
    expect(await m.je.takeJoinEventContext(B, CODE)).toEqual({ goalId: null, activity: null });
  });

  it('a removal refused once is retried, and the record is gone', async () => {
    let m = await launch();
    await scan(m, G1, 'Squats');
    m = await launch();
    const restore = refuseRemovals(2);
    try {
      await finishJoin(m, A);
    } finally {
      restore();
    }
    expect(disk.map.has(EVENT_KEY)).toBe(false);
    expect(disk.map.has(ACTIVITY_KEY)).toBe(false);
  });

  it('no destination decodes the overwrite as a value', async () => {
    const m = await launch();
    for (const key of [JOIN_KEY, EVENT_KEY, ACTIVITY_KEY, 'wsf.eventReturn', 'wsf.markerReturn', 'wsf.kioskReturnGoalId']) {
      disk.map.set(key, JSON.stringify({ v: m.pad.DISCARDED_RECORD, exp: Date.now() + 60_000 }));
    }
    const fresh = await launch();
    await fresh.pad.postAuthDestinationsReady();
    const now = Date.now();
    expect(fresh.pj.readPendingJoinCode(null)).toBeNull();
    expect(fresh.je.readPendingEventGoal(null, CODE)).toBeNull();
    expect(fresh.je.readPendingEventActivity(null, CODE, G1)).toBeNull();
    expect((await import('../src/eventReturn')).readEventReturn(now)).toBeNull();
    expect((await import('../src/markerEntry')).readMarkerReturn(now)).toBeNull();
    expect((await import('../src/kioskSession')).readKioskReturnGoal(null)).toBeNull();
    expect(await fresh.pj.routeAfterAuth('/', A)).toBe('/');
  });

  it('"this is my own phone" sticks across a restart even when the removal is refused', async () => {
    let m = await launch();
    await m.dm.saveDeviceMode('shared');
    m = await launch();
    await m.dm.deviceModeReady();
    expect(m.dm.readDeviceMode()).toBe('shared');
    const restore = refuseRemovals(Infinity);
    try {
      expect(await m.dm.clearDeviceMode()).toBe(true);
    } finally {
      restore();
    }
    m = await launch();
    await m.dm.deviceModeReady();
    expect(m.dm.readDeviceMode()).toBeNull();
  });
});

describe('a finished join does not wait on stalled storage', () => {
  it('past the wait, the member lands on the community (well inside the 5 s storage bound)', async () => {
    let m = await launch();
    await scan(m, G1, 'Squats');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    disk.holdReads(); // the relaunch's read of the context never answers
    m = await launch();
    let answer: unknown = 'waiting';
    void m.je.takeJoinEventContextWithin(A, CODE).then((c) => (answer = c));
    await vi.advanceTimersByTimeAsync(m.je.JOIN_CONTEXT_WAIT_MS - 10);
    expect(answer).toBe('waiting');
    await vi.advanceTimersByTimeAsync(20);
    expect(answer).toEqual({ goalId: null, activity: null });
  });

  it('a prompt take within the wait returns the context', async () => {
    let m = await launch();
    await scan(m, G1, 'Squats');
    m = await launch();
    expect(await m.je.takeJoinEventContextWithin(A, CODE)).toEqual({ goalId: G1, activity: 'Squats' });
  });

  it('the route uses the bounded take', () => {
    const onJoin = ROUTE.slice(ROUTE.indexOf('const onJoin = useCallback'));
    expect(onJoin).toContain('await takeJoinEventContextWithin(user.uid, joinCode)');
    expect(onJoin).not.toMatch(/await takeJoinEventContext\(/);
  });
});

describe('the two-hour expiry holds for the join context in a process that outlives it', () => {
  it('scanned, then the app stays in the background past two hours: the join lands on the community', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-10-20T10:00:00Z').getTime();
    vi.setSystemTime(t0);
    const m = await launch();
    await scan(m, G1, 'Squats');
    vi.setSystemTime(t0 + 2 * 60 * 60 * 1000 - 1000);
    expect(m.je.readPendingEventGoal(A, CODE)).toBe(G1);
    vi.setSystemTime(t0 + 2 * 60 * 60 * 1000 + 1000);
    expect(m.je.readPendingEventGoal(A, CODE)).toBeNull();
    expect(await finishJoin(m, A)).toBe(`/community/${GROUP}`);
  });
});

describe('#639 N1/N2 (delta review)', () => {
  it('N1: a prompt read with a 2 s removal still routes to the event; the discards finish afterwards', async () => {
    let m = await launch();
    await scan(m, G1, 'Squats');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    m = await launch();
    await m.pad.postAuthDestinationsReady();
    const realRemove = disk.api.removeItem;
    disk.api.removeItem = async (key: string) => {
      await new Promise((r) => setTimeout(r, 2_000));
      return realRemove(key);
    };
    try {
      let answer: unknown = 'waiting';
      void m.je.takeJoinEventContextWithin(A, CODE).then((c) => (answer = c));
      await vi.advanceTimersByTimeAsync(10);
      expect(answer).toEqual({ goalId: G1, activity: 'Squats' });
      await vi.advanceTimersByTimeAsync(2_100);
      expect(disk.map.has(EVENT_KEY)).toBe(false);
      expect(disk.map.has(ACTIVITY_KEY)).toBe(false);
    } finally {
      disk.api.removeItem = realRemove;
    }
  });

  function refuseRemovalsWhile(during: () => void) {
    const real = disk.api.removeItem;
    let first = true;
    disk.api.removeItem = async () => {
      if (first) {
        first = false;
        during(); // a newer write lands while the removal is outstanding
      }
      throw new Error('storage refused the removal');
    };
    return () => {
      disk.api.removeItem = real;
    };
  }

  it('N2: a newer scan that lands during a refused removal is not retried away or overwritten', async () => {
    let m = await launch();
    await scan(m, G1, 'Squats');
    m = await launch();
    await m.pad.postAuthDestinationsReady();
    const mm = m;
    const restore = refuseRemovalsWhile(() => {
      void mm.je.setPendingEventGoal(G2, CODE, null);
    });
    try {
      await m.je.dropJoinJourney();
    } finally {
      restore();
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(m.je.readPendingEventGoal(null, CODE)).toBe(G2);
    m = await launch();
    expect(await m.je.takeJoinEventContext(A, CODE)).toMatchObject({ goalId: G2 });
  });

  it('N2: a device answer given during a refused removal is not overwritten with "forgotten"', async () => {
    let m = await launch();
    await m.dm.saveDeviceMode('shared');
    m = await launch();
    await m.dm.deviceModeReady();
    const mm = m;
    const restore = refuseRemovalsWhile(() => {
      void mm.dm.saveDeviceMode('personal');
    });
    try {
      await m.dm.clearDeviceMode();
    } finally {
      restore();
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(m.dm.readDeviceMode()).toBe('personal');
    m = await launch();
    await m.dm.deviceModeReady();
    expect(m.dm.readDeviceMode()).toBe('personal');
  });
});

describe('#639 follow-up: newer writes are decided by write generation, not value', () => {
  function refuseRemovalsWhile(during: () => void) {
    const real = disk.api.removeItem;
    let first = true;
    disk.api.removeItem = async () => {
      if (first) {
        first = false;
        during();
      }
      throw new Error('storage refused the removal');
    };
    return () => {
      disk.api.removeItem = real;
    };
  }

  it('an IDENTICAL re-stash that lands during a refused removal survives (own-phone after a shared drop)', async () => {
    let m = await launch();
    await scan(m, G1, 'Squats');
    m = await launch();
    await m.pad.postAuthDestinationsReady();
    const mm = m;
    const restore = refuseRemovalsWhile(() => {
      // The very same record, stashed again.
      void mm.je.setPendingEventGoal(G1, CODE, null);
    });
    try {
      await m.je.dropJoinJourney();
    } finally {
      restore();
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(m.je.readPendingEventGoal(null, CODE)).toBe(G1);
    m = await launch();
    expect((await m.je.takeJoinEventContext(A, CODE)).goalId).toBe(G1);
  });

  it('the SAME device answer given again during a refused removal is not overwritten with "forgotten"', async () => {
    let m = await launch();
    await m.dm.saveDeviceMode('shared');
    m = await launch();
    await m.dm.deviceModeReady();
    const mm = m;
    const restore = refuseRemovalsWhile(() => {
      void mm.dm.saveDeviceMode('shared');
    });
    try {
      await m.dm.clearDeviceMode();
    } finally {
      restore();
    }
    await new Promise((r) => setTimeout(r, 0));
    m = await launch();
    await m.dm.deviceModeReady();
    expect(m.dm.readDeviceMode()).toBe('shared');
  });

  it('the TIMEOUT path still discards: a read that answers after the wait is consumed, not left for a later join', async () => {
    let m = await launch();
    await scan(m, G1, 'Squats');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const realGet = disk.api.getItem;
    disk.api.getItem = async (key: string) => {
      await new Promise((r) => setTimeout(r, 3_000));
      return realGet(key);
    };
    try {
      m = await launch();
      let answer: unknown = 'waiting';
      void m.je.takeJoinEventContextWithin(A, CODE).then((c) => (answer = c));
      await vi.advanceTimersByTimeAsync(m.je.JOIN_CONTEXT_WAIT_MS + 10);
      expect(answer).toEqual({ goalId: null, activity: null });
      await vi.advanceTimersByTimeAsync(12_000);
      expect(disk.map.has(EVENT_KEY)).toBe(false);
      expect(disk.map.has(ACTIVITY_KEY)).toBe(false);
    } finally {
      disk.api.getItem = realGet;
    }
    vi.useRealTimers();
    m = await launch();
    expect(await m.je.takeJoinEventContext(A, CODE)).toEqual({ goalId: null, activity: null });
  });
});

describe('#639 delta-3 N1: the discard ends the take that started it, not a later stash', () => {
  it('a scan that lands while a bounded take is still reading survives the take’s discard', async () => {
    let m = await launch();
    await scan(m, G1, 'Squats');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const realGet = disk.api.getItem;
    disk.api.getItem = async (key: string) => {
      await new Promise((r) => setTimeout(r, 3_000));
      return realGet(key);
    };
    try {
      m = await launch();
      let answer: unknown = 'waiting';
      void m.je.takeJoinEventContextWithin(A, CODE).then((c) => (answer = c));
      await vi.advanceTimersByTimeAsync(m.je.JOIN_CONTEXT_WAIT_MS + 10);
      expect(answer).toEqual({ goalId: null, activity: null });
      // A fresh scan of a second event (no activity) arrives before the slow read answers.
      await vi.advanceTimersByTimeAsync(500);
      void m.je.setPendingEventGoal(G2, CODE, null);
      await vi.advanceTimersByTimeAsync(12_000);
    } finally {
      disk.api.getItem = realGet;
    }
    vi.useRealTimers();
    // The take discarded what it read (G1's activity), not the newer scan.
    expect(disk.map.has(ACTIVITY_KEY)).toBe(false);
    m = await launch();
    expect(await m.je.takeJoinEventContext(A, CODE)).toEqual({ goalId: G2, activity: null });
  });

  it('with no write in between, the take still consumes what it read', async () => {
    let m = await launch();
    await scan(m, G1, 'Squats');
    m = await launch();
    expect(await m.je.takeJoinEventContext(A, CODE)).toEqual({ goalId: G1, activity: 'Squats' });
    m = await launch();
    expect(await m.je.takeJoinEventContext(A, CODE)).toEqual({ goalId: null, activity: null });
  });
});

describe('#639 delta-3 N1: a context that is USED is consumed, even one written while it was being read', () => {
  async function slowReads(ms: number) {
    const realGet = disk.api.getItem;
    disk.api.getItem = async (key: string) => {
      await new Promise((r) => setTimeout(r, ms));
      return realGet(key);
    };
    return () => {
      disk.api.getItem = realGet;
    };
  }

  it('unbounded take: a scan landing during the read is what it returns, and it is consumed', async () => {
    let m = await launch();
    await scan(m, G1, 'Squats');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const restore = await slowReads(3_000);
    let answer: unknown = 'waiting';
    try {
      m = await launch();
      void m.je.takeJoinEventContext(A, CODE).then((c) => (answer = c));
      await vi.advanceTimersByTimeAsync(1_000);
      void m.je.setPendingEventGoal(G2, CODE, null);
      await vi.advanceTimersByTimeAsync(12_000);
    } finally {
      restore();
    }
    vi.useRealTimers();
    expect(answer).toEqual({ goalId: G2, activity: null });
    m = await launch();
    expect(await m.je.takeJoinEventContext(A, CODE)).toEqual({ goalId: null, activity: null });
  });

  it('bounded take answering in time: what it returns is consumed, including a scan that landed mid-read', async () => {
    let m = await launch();
    await scan(m, G1, 'Squats');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const restore = await slowReads(1_000);
    let answer: unknown = 'waiting';
    try {
      m = await launch();
      void m.je.takeJoinEventContextWithin(A, CODE).then((c) => (answer = c));
      await vi.advanceTimersByTimeAsync(400);
      void m.je.setPendingEventGoal(G2, CODE, null);
      await vi.advanceTimersByTimeAsync(12_000);
    } finally {
      restore();
    }
    vi.useRealTimers();
    expect(answer).toEqual({ goalId: G2, activity: null });
    m = await launch();
    expect(await m.je.takeJoinEventContext(A, CODE)).toEqual({ goalId: null, activity: null });
  });
});
