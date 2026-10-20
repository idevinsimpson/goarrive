import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { classifyContributeError } from '../src/contributionFlow';
import type { PendingContribution } from '../src/pendingContribution';
import { bootNative, createFakeAsyncStorage, flush, type FakeAsyncStorage } from './nativeStorageHarness';

/**
 * NATIVE-STATE-1 — the continuity records on a phone.
 *
 * Every test here runs the modules over their NATIVE storage implementations
 * (src/storage/kv.native.ts over a fake AsyncStorage, sessionKv.native.ts,
 * syncRead.native.ts) and simulates termination by booting fresh module state
 * over the same backing Map (tests/nativeStorageHarness.ts). The server is a
 * fake that keys idempotency exactly as wsfContribute does:
 * `${goalId}_${uid}_${attemptId}`.
 *
 * These prove the logic over the native implementations. They are NOT a
 * device run and establish nothing about AsyncStorage itself.
 */

const GOAL = 'goal-native-1';
const A = 'uid-a';
const B = 'uid-b';
const JOIN = 'J0inCodeForNative_01';
const pendingKeyOf = (goalId: string, uid: string) => `wsf.pendingContribution.${goalId}.${uid}`;

type Receipt = { alreadyRecorded: boolean; sharedTotal: number };

/** wsfContribute's idempotency, and nothing else. */
function fakeServer() {
  const recorded = new Map<string, number>();
  const calls: string[] = [];
  let sharedTotal = 0;
  return {
    calls,
    total: () => sharedTotal,
    contribute(goalId: string, uid: string, attemptId: string, count: number): Receipt {
      const key = `${goalId}_${uid}_${attemptId}`;
      calls.push(key);
      if (recorded.has(key)) return { alreadyRecorded: true, sharedTotal };
      recorded.set(key, count);
      sharedTotal += count;
      return { alreadyRecorded: false, sharedTotal };
    },
  };
}

const NETWORK_LOST = Object.assign(new Error('network'), { code: 'functions/unavailable' });
const REFUSED_CLOSED = Object.assign(new Error('This goal is closed.'), { code: 'functions/failed-precondition' });
const isRefusal = (e: unknown) => classifyContributeError(e).kind === 'refused';

const row = (attemptId: string, count: number, state: PendingContribution['state'] = 'sending'): PendingContribution => ({
  goalId: GOAL,
  attemptId,
  count,
  ts: 1,
  state,
});

let disk: FakeAsyncStorage;

async function launch() {
  bootNative(disk);
  return import('../src/pendingContribution');
}

beforeEach(() => {
  disk = createFakeAsyncStorage();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  // Proof that these ran over the native boundary: the browser stores were
  // never touched.
  expect(window.localStorage.length).toBe(0);
  expect(window.sessionStorage.length).toBe(0);
  vi.useRealTimers();
  vi.doUnmock('@react-native-async-storage/async-storage');
  vi.doUnmock('../src/storage/kv');
  vi.doUnmock('../src/storage/sessionKv');
  vi.doUnmock('../src/storage/syncRead');
  vi.doUnmock('../src/firebase');
  vi.doUnmock('firebase/auth');
  vi.resetModules();
});

describe('1. accepted, response lost, app terminated and reopened', () => {
  it('restores the SAME attemptId as reconcilable after a relaunch', async () => {
    const server = fakeServer();
    let pc = await launch();

    const opened = await pc.openAttempt(row('att-1', 12), A, () => true);
    expect(opened).toEqual({ fire: true, durable: true });
    // The request reaches the server and is recorded…
    server.contribute(GOAL, A, 'att-1', 12);
    // …and the process dies before any response or catch block runs.

    pc = await launch();
    const restored = await pc.restorePendingAttempt(GOAL, A);
    expect(restored.pending).toEqual({ ...row('att-1', 12), state: 'unknown' });

    // The escalation is itself durable: a second relaunch shows the same.
    pc = await launch();
    expect(await pc.loadPending(GOAL, A)).toEqual({ ...row('att-1', 12), state: 'unknown' });
  });

  it('does not let the request fire until the record is confirmed on the device', async () => {
    const pc = await launch();
    const release = disk.hold();
    let answered: { fire: boolean; durable: boolean } | null = null;
    const opening = pc.openAttempt(row('att-1', 5), A, () => true).then((o) => (answered = o));

    await flush();
    // The write is still in flight: no answer, so the caller cannot send yet.
    expect(answered).toBeNull();
    expect(disk.map.has(pendingKeyOf(GOAL, A))).toBe(false);

    release();
    await opening;
    expect(answered).toEqual({ fire: true, durable: true });
    expect(JSON.parse(disk.map.get(pendingKeyOf(GOAL, A)) as string).attemptId).toBe('att-1');
  });

  it('reports a refused write as NOT durable, still lets the member record, and restores nothing it never kept', async () => {
    const server = fakeServer();
    let pc = await launch();
    disk.state.failWrites = true;

    const opened = await pc.openAttempt(row('att-1', 9), A, () => true);
    // Recording is not blocked on storage…
    expect(opened.fire).toBe(true);
    // …but the screen is told the truth, so it does not promise recovery.
    expect(opened.durable).toBe(false);

    const settled = await pc.settleAttempt(row('att-1', 9), A, {
      send: async () => {
        server.contribute(GOAL, A, 'att-1', 9);
        throw NETWORK_LOST;
      },
      isRefusal,
      stillCurrent: () => true,
    });
    expect(settled.kind).toBe('unknown');

    disk.state.failWrites = false;
    pc = await launch();
    expect((await pc.restorePendingAttempt(GOAL, A)).pending).toBeNull();
  });
});

describe('2. the same attempt retried reconciles once', () => {
  it('replays the restored attemptId under the same idempotency key and counts it once', async () => {
    const server = fakeServer();
    let pc = await launch();
    await pc.openAttempt(row('att-1', 12), A, () => true);
    server.contribute(GOAL, A, 'att-1', 12);

    pc = await launch();
    const { pending } = await pc.restorePendingAttempt(GOAL, A);
    expect(pending?.attemptId).toBe('att-1');

    const io = {
      send: async () => server.contribute(GOAL, A, pending!.attemptId, pending!.count),
      isRefusal,
      stillCurrent: () => true,
    };
    const first = await pc.replayAttempt(pending!, A, io);
    expect(first).toMatchObject({ kind: 'confirmed', current: true, data: { alreadyRecorded: true } });
    // A second replay (a double tap that got through, another relaunch) is
    // still the same attempt and still counted once.
    const second = await pc.replayAttempt(pending!, A, io);
    expect(second).toMatchObject({ kind: 'confirmed', data: { alreadyRecorded: true } });

    expect(server.total()).toBe(12);
    expect(new Set(server.calls)).toEqual(new Set([`${GOAL}_${A}_att-1`]));
    expect(server.calls).toHaveLength(3);

    // Server truth received: the reminder is gone, durably.
    pc = await launch();
    expect((await pc.restorePendingAttempt(GOAL, A)).pending).toBeNull();
  });

  it('a replay whose request never landed records it — once', async () => {
    const server = fakeServer();
    let pc = await launch();
    await pc.openAttempt(row('att-9', 4), A, () => true);
    // The process died before the request left the device.
    pc = await launch();
    const { pending } = await pc.restorePendingAttempt(GOAL, A);
    const settled = await pc.replayAttempt(pending!, A, {
      send: async () => server.contribute(GOAL, A, pending!.attemptId, pending!.count),
      isRefusal,
      stillCurrent: () => true,
    });
    expect(settled).toMatchObject({ kind: 'confirmed', data: { alreadyRecorded: false } });
    expect(server.total()).toBe(4);
  });
});

describe('3. a late response cannot recreate a cleared or newer attempt', () => {
  it('a late failure after the attempt was cleared leaves the slot empty, across a relaunch', async () => {
    let pc = await launch();
    await pc.openAttempt(row('att-1', 11), A, () => true);
    let fail!: (e: unknown) => void;
    const settling = pc.settleAttempt(row('att-1', 11), A, {
      send: () => new Promise((_, reject) => (fail = reject)),
      isRefusal,
      stillCurrent: () => false,
    });
    // The attempt is reconciled and cleared by another path meanwhile.
    expect(await pc.clearPendingIfAttempt(GOAL, A, 'att-1')).toBe(true);
    fail(NETWORK_LOST);
    expect((await settling).kind).toBe('unknown');

    expect(disk.map.has(pendingKeyOf(GOAL, A))).toBe(false);
    pc = await launch();
    expect((await pc.restorePendingAttempt(GOAL, A)).pending).toBeNull();
  });

  it('a late failure or late success for attempt 1 cannot touch attempt 2', async () => {
    let pc = await launch();
    await pc.openAttempt(row('att-1', 11), A, () => true);
    let fail!: (e: unknown) => void;
    let succeed!: (v: Receipt) => void;
    const lateFailure = pc.settleAttempt(row('att-1', 11), A, {
      send: () => new Promise((_, reject) => (fail = reject)),
      isRefusal,
      stillCurrent: () => true,
    });
    const lateSuccess = pc.settleAttempt(row('att-1', 11), A, {
      send: () => new Promise<Receipt>((resolve) => (succeed = resolve)),
      isRefusal,
      // Even a response that believes it is current cannot clear a newer slot.
      stillCurrent: () => true,
    });
    await pc.clearPendingIfAttempt(GOAL, A, 'att-1');
    await pc.openAttempt(row('att-2', 7), A, () => true);

    fail(NETWORK_LOST);
    succeed({ alreadyRecorded: false, sharedTotal: 11 });
    await Promise.all([lateFailure, lateSuccess]);

    pc = await launch();
    expect(await pc.loadPending(GOAL, A)).toEqual(row('att-2', 7));
  });

  it('holds when the late write and the new attempt interleave at the storage level', async () => {
    // Without per-record queuing, the old attempt's read could happen before
    // the new attempt's write lands and its write after — overwriting it.
    const pc = await launch();
    await pc.savePendingNew(row('att-1', 11), A);

    const release = disk.hold();
    const newer = pc.savePendingNew(row('att-2', 7), A);
    const late = pc.updatePendingIfAttempt(row('att-1', 11, 'unknown'), A, 'att-1');
    release();
    expect(await newer).toBe(true);
    expect(await late).toBe(false);
    expect(JSON.parse(disk.map.get(pendingKeyOf(GOAL, A)) as string)).toEqual(row('att-2', 7));
  });
});

describe('4. one account never inherits or submits another account’s state', () => {
  it("B neither restores nor clears A's unresolved attempt; A gets it back", async () => {
    const server = fakeServer();
    let pc = await launch();
    await pc.openAttempt(row('att-a', 20), A, () => true);
    server.contribute(GOAL, A, 'att-a', 20);

    // Relaunched, and B is the account signed in now.
    pc = await launch();
    expect((await pc.restorePendingAttempt(GOAL, B)).pending).toBeNull();
    // B's own attempt lives in B's slot and leaves A's alone.
    await pc.openAttempt(row('att-b', 3), B, () => true);
    expect(await pc.clearPendingIfAttempt(GOAL, B, 'att-a')).toBe(false);
    expect(disk.map.has(pendingKeyOf(GOAL, A))).toBe(true);

    pc = await launch();
    expect((await pc.restorePendingAttempt(GOAL, A)).pending?.attemptId).toBe('att-a');
    // Nothing was ever sent as B for A's attempt.
    expect(server.calls.filter((k) => k.includes(B))).toEqual([]);
  });

  it('an account switch during the record write sends nothing and leaves no record behind', async () => {
    const pc = await launch();
    let signedIn = A;
    const send = vi.fn();
    const release = disk.hold();
    const opening = pc.openAttempt(row('att-a', 8), A, () => signedIn === A);
    signedIn = B; // A signed out, B signed in, before the device answered
    release();
    const opened = await opening;
    if (opened.fire) send();
    expect(opened.fire).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(disk.map.has(pendingKeyOf(GOAL, A))).toBe(false);
  });

  it("a join code stashed under A does not route B, or a signed-out visitor, after a relaunch", async () => {
    bootNative(disk);
    let pj = await import('../src/pendingJoinCode');
    expect(await pj.setPendingJoinCode(JOIN, A)).toBe(true);

    bootNative(disk);
    pj = await import('../src/pendingJoinCode');
    const { readAuthDestinationKind } = await import('../src/authDestination');
    await (await import('../src/postAuthDestination')).postAuthDestinationsReady();
    // A signed out: the sign-in screen does not announce A's invitation…
    expect(readAuthDestinationKind(null)).toBeNull();
    // …and B's terminal hop is not routed by it, and drops it.
    expect(await pj.routeAfterAuth('/', B)).toBe('/');
    bootNative(disk);
    pj = await import('../src/pendingJoinCode');
    expect(await pj.routeAfterAuth('/', A)).toBe('/');
  });

  it("A's code still routes A across a relaunch", async () => {
    bootNative(disk);
    let pj = await import('../src/pendingJoinCode');
    await pj.setPendingJoinCode(JOIN, A);
    bootNative(disk);
    pj = await import('../src/pendingJoinCode');
    expect(await pj.routeAfterAuth('/', A)).toBe(`/join/${JOIN}`);
  });

  it("A's remembered community is never B's, and survives a relaunch for A", async () => {
    bootNative(disk);
    let cc = await import('../src/currentCommunity');
    await cc.currentCommunityReady();
    expect(await cc.rememberCurrentCommunity(A, 'g2')).toBe(true);

    const releaseReads = disk.holdReads();
    bootNative(disk);
    cc = await import('../src/currentCommunity');
    // Before the launch read answers: rule 2/3, never A's choice.
    expect(cc.isCurrentCommunityReady()).toBe(false);
    expect(cc.resolveCurrentCommunity(A, ['g1', 'g2'])).toBeNull();
    expect(cc.resolveCurrentCommunity(A, ['g2'])).toBe('g2');
    releaseReads();
    await cc.currentCommunityReady();
    expect(cc.resolveCurrentCommunity(A, ['g1', 'g2'])).toBe('g2');
    expect(cc.resolveCurrentCommunity(B, ['g1', 'g2'])).toBeNull();

    // Forgetting it on sign-out is durable too.
    await cc.forgetCurrentCommunity(A);
    bootNative(disk);
    cc = await import('../src/currentCommunity');
    await cc.currentCommunityReady();
    expect(cc.resolveCurrentCommunity(A, ['g1', 'g2'])).toBeNull();
  });
});

describe('5. refusal stays distinct from unknown', () => {
  it('a refusal retires the reminder; an unknown outcome keeps it reconcilable', async () => {
    let pc = await launch();
    await pc.openAttempt(row('att-r', 6), A, () => true);
    const refused = await pc.settleAttempt(row('att-r', 6), A, {
      send: async () => {
        throw REFUSED_CLOSED;
      },
      isRefusal,
      stillCurrent: () => true,
    });
    expect(refused.kind).toBe('refused');
    pc = await launch();
    expect((await pc.restorePendingAttempt(GOAL, A)).pending).toBeNull();

    await pc.openAttempt(row('att-u', 6), A, () => true);
    const unknown = await pc.settleAttempt(row('att-u', 6), A, {
      send: async () => {
        throw NETWORK_LOST;
      },
      isRefusal,
      stillCurrent: () => true,
    });
    expect(unknown.kind).toBe('unknown');
    pc = await launch();
    expect((await pc.restorePendingAttempt(GOAL, A)).pending).toMatchObject({ attemptId: 'att-u', state: 'unknown' });
  });

  it('a refusal on a replay is a refusal, not a reason to keep asking', async () => {
    let pc = await launch();
    await pc.openAttempt(row('att-r', 6), A, () => true);
    pc = await launch();
    const { pending } = await pc.restorePendingAttempt(GOAL, A);
    const settled = await pc.replayAttempt(pending!, A, {
      send: async () => {
        throw REFUSED_CLOSED;
      },
      isRefusal,
      stillCurrent: () => true,
    });
    expect(settled.kind).toBe('refused');
    expect(disk.map.has(pendingKeyOf(GOAL, A))).toBe(false);
  });
});

describe('6. a restored attempt opens no camera and manufactures no success', () => {
  it('restoring sends nothing, confirms nothing, and closes new-attempt entry', async () => {
    const server = fakeServer();
    let pc = await launch();
    await pc.openAttempt(row('att-1', 12), A, () => true);

    pc = await launch();
    // Before the stored attempt has been read back, nothing new may begin.
    expect(pc.mayBeginNewAttempt({ restoreSettled: false, pending: null, settled: false })).toBe(false);
    const restored = await pc.restorePendingAttempt(GOAL, A);
    // A reminder, never a receipt: no server call, no confirmed state.
    expect(server.calls).toEqual([]);
    expect(restored.pending?.state).toBe('unknown');
    expect(Object.keys(restored.pending as object).sort()).toEqual(['attemptId', 'count', 'goalId', 'state', 'ts']);
    // With it on screen, neither Record nor the camera may begin.
    expect(pc.mayBeginNewAttempt({ restoreSettled: true, pending: restored.pending, settled: false })).toBe(false);
    // Only a settled restore with nothing pending opens new-attempt entry.
    expect(pc.mayBeginNewAttempt({ restoreSettled: true, pending: null, settled: false })).toBe(true);
  });

  it('the contribute screen gates the camera and Record on it, and restores without a receipt', () => {
    const code = readFileSync(path.resolve('app/contribute/[goalId].tsx'), 'utf8');
    const camera = code.slice(code.indexOf('const cameraOpen ='), code.indexOf('if (cameraOpen) {'));
    expect(camera).toContain('mayBeginNewAttempt({ restoreSettled');
    expect(camera).toContain('moveCameraLoaded');

    const restore = code.slice(code.indexOf('const restoringFor'), code.indexOf('return () => {', code.indexOf('const restoringFor')));
    expect(restore).toContain('restorePendingAttempt(goalId, uid)');
    expect(restore).toContain('generationRef.current !== restoringFor');
    for (const forbidden of ['setLastResult', 'setFreshAttempt', 'sendContribute', 'setStep']) {
      expect(restore, forbidden).not.toContain(forbidden);
    }

    const record = code.slice(code.indexOf('const onRecord = useCallback'), code.indexOf('const onReconcile = useCallback'));
    expect(record).toContain('mayBeginNewAttempt(');
    // The record is confirmed (or honestly not) BEFORE the request is sent.
    expect(record.indexOf('await openAttempt(')).toBeGreaterThan(-1);
    expect(record.indexOf('await openAttempt(')).toBeLessThan(record.indexOf('await settleAttempt('));
    expect(record).not.toMatch(/savePendingNew\(/);
    // "Will be here when you come back" only when the device kept it.
    expect(code).toMatch(/pendingDurable \? \(\s*<Text style=\{styles\.stepBody\}>\s*You can leave this page\. The same attempt will be here when you come back\./);
  });

  it('camera preferences are a persisted device preference, read at launch, and never acted on before', async () => {
    bootNative(disk);
    let st = await import('../src/movement-camera/settingsStore');
    await st.moveCameraSettingsReady();
    st.writeMoveCameraSettings({ cameraCounter: false });
    await flush();

    const releaseReads = disk.holdReads();
    bootNative(disk);
    st = await import('../src/movement-camera/settingsStore');
    // Before the read: defaults on screen, but NOT loaded, so nothing acts.
    expect(st.moveCameraSettingsLoaded()).toBe(false);
    expect(st.readMoveCameraSettings()).toEqual({ cameraCounter: true, stickFigure: true });
    releaseReads();
    await st.moveCameraSettingsReady();
    expect(st.moveCameraSettingsLoaded()).toBe(true);
    expect(st.readMoveCameraSettings()).toEqual({ cameraCounter: false, stickFigure: true });
  });

  it('a toggle pressed before the launch read lands on top of the stored choice', async () => {
    disk.map.set('wsf.moveCamera.v1', JSON.stringify({ cameraCounter: false, stickFigure: true }));
    const releaseReads = disk.holdReads();
    bootNative(disk);
    let st = await import('../src/movement-camera/settingsStore');
    expect(st.moveCameraSettingsLoaded()).toBe(false);
    st.writeMoveCameraSettings({ stickFigure: false });
    releaseReads();
    await st.moveCameraSettingsReady();
    // cameraCounter is the stored OFF, not the default ON.
    expect(st.readMoveCameraSettings()).toEqual({ cameraCounter: false, stickFigure: false });
    await flush();
    bootNative(disk);
    st = await import('../src/movement-camera/settingsStore');
    await st.moveCameraSettingsReady();
    expect(st.readMoveCameraSettings()).toEqual({ cameraCounter: false, stickFigure: false });
  });

  it('malformed or missing stored settings read as the defaults', async () => {
    disk.map.set('wsf.moveCamera.v1', '{not json');
    bootNative(disk);
    const st = await import('../src/movement-camera/settingsStore');
    await st.moveCameraSettingsReady();
    expect(st.readMoveCameraSettings()).toEqual({ cameraCounter: true, stickFigure: true });
  });
});

describe('the pending join code on a phone: bounded, and it survives termination', () => {
  it('a signed-out scan survives the app being killed mid-sign-up and routes the account that signs in', async () => {
    bootNative(disk);
    let pj = await import('../src/pendingJoinCode');
    await pj.setPendingJoinCode(JOIN, null);

    bootNative(disk);
    pj = await import('../src/pendingJoinCode');
    // A terminal hop moments after a cold start waits for the read.
    expect(await pj.routeAfterAuth('/', A)).toBe(`/join/${JOIN}`);
  });

  it('expires after two hours, and a far-future stamp is refused too', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-10-20T10:00:00Z').getTime();
    vi.setSystemTime(t0);
    bootNative(disk);
    let pj = await import('../src/pendingJoinCode');
    const { NATIVE_SESSION_TTL_MS } = await import('../src/storage/sessionKv.native');
    expect(NATIVE_SESSION_TTL_MS).toBe(2 * 60 * 60 * 1000);
    await pj.setPendingJoinCode(JOIN, null);

    vi.setSystemTime(t0 + NATIVE_SESSION_TTL_MS - 1000);
    bootNative(disk);
    pj = await import('../src/pendingJoinCode');
    expect(await pj.routeAfterAuth('/', A)).toBe(`/join/${JOIN}`);

    vi.setSystemTime(t0 + NATIVE_SESSION_TTL_MS + 1000);
    bootNative(disk);
    pj = await import('../src/pendingJoinCode');
    expect(await pj.routeAfterAuth('/', A)).toBe('/');
    // Gone from the device, not merely ignored.
    expect(disk.map.has('wsf.pendingJoinCode')).toBe(false);

    disk.map.set('wsf.pendingJoinCode', JSON.stringify({ v: JOIN, exp: Date.now() + 10 * NATIVE_SESSION_TTL_MS }));
    bootNative(disk);
    pj = await import('../src/pendingJoinCode');
    expect(await pj.routeAfterAuth('/', A)).toBe('/');
  });

  it('the identity screens say a destination is waiting only once the read has answered', async () => {
    bootNative(disk);
    let pj = await import('../src/pendingJoinCode');
    await pj.setPendingJoinCode(JOIN, null);
    const releaseReads = disk.holdReads();
    bootNative(disk);
    pj = await import('../src/pendingJoinCode');
    const { readAuthDestinationKind } = await import('../src/authDestination');
    expect((await import('../src/postAuthDestination')).isPostAuthDestinationsReady()).toBe(false);
    expect(readAuthDestinationKind(null)).toBeNull();
    releaseReads();
    await (await import('../src/postAuthDestination')).postAuthDestinationsReady();
    expect((await import('../src/postAuthDestination')).isPostAuthDestinationsReady()).toBe(true);
    expect(readAuthDestinationKind(null)).toBe('join');
  });
});
