import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { classifyContributeError, isDefiniteRefusal } from '../src/contributionFlow';
import type { PendingContribution, RequestContext } from '../src/pendingContribution';
import { bootNative, createFakeAsyncStorage, flush, type FakeAsyncStorage } from './nativeStorageHarness';

/**
 * NATIVE-STATE-1 review (#635): the owner rules, proved where they are
 * decided — and, for the wiring that lives in the contribute route (which the
 * harness cannot import), pinned to the route's own text.
 *
 * Everything here runs over the NATIVE storage implementations
 * (tests/nativeStorageHarness.ts). The server is a fake that keys idempotency
 * exactly as wsfContribute does: `${goalId}_${uid}_${attemptId}`. Nothing here
 * is a device run.
 */

const GOAL = 'goal-native-1';
const A = 'uid-a';
const B = 'uid-b';
const pendingKeyOf = (goalId: string, uid: string) => `wsf.pendingContribution.${goalId}.${uid}`;
const ROUTE = readFileSync(path.resolve('app/contribute/[goalId].tsx'), 'utf8');

const NETWORK_LOST = Object.assign(new Error('network'), { code: 'functions/unavailable' });
const UNAUTHENTICATED = Object.assign(new Error('Sign in first.'), { code: 'functions/unauthenticated' });
const REFUSED_CLOSED = Object.assign(new Error('This goal is closed.'), { code: 'functions/failed-precondition' });

const row = (attemptId: string, count: number, state: PendingContribution['state'] = 'sending'): PendingContribution => ({
  goalId: GOAL,
  attemptId,
  count,
  ts: 1,
  state,
});
const stored = (uid = A) => {
  const raw = disk.map.get(pendingKeyOf(GOAL, uid));
  return raw ? (JSON.parse(raw) as PendingContribution) : null;
};

function fakeServer() {
  const recorded = new Map<string, number>();
  const calls: string[] = [];
  return {
    calls,
    contribute(goalId: string, uid: string, attemptId: string, count: number) {
      const key = `${goalId}_${uid}_${attemptId}`;
      calls.push(key);
      if (recorded.has(key)) return { alreadyRecorded: true };
      recorded.set(key, count);
      return { alreadyRecorded: false };
    },
  };
}

let disk: FakeAsyncStorage;

async function launch() {
  bootNative(disk);
  return import('../src/pendingContribution');
}

/** A route-shaped io: the gate is the live auth user, as the screen wires it. */
function io<T>(send: (attemptId: string, count: number) => Promise<T>, extra: Partial<{ live: () => string | null; current: () => boolean; replay: boolean }> = {}) {
  const live = extra.live ?? (() => A);
  const current = extra.current ?? (() => true);
  return {
    send: vi.fn(send),
    isRefusal: (e: unknown) => isDefiniteRefusal(e, extra.replay ? 'replay' : 'new'),
    stillCurrent: current,
    mayFire: vi.fn(() => current() && live() === A),
  };
}

beforeEach(() => {
  disk = createFakeAsyncStorage();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  expect(window.localStorage.length).toBe(0);
  expect(window.sessionStorage.length).toBe(0);
  vi.useRealTimers();
  vi.doUnmock('@react-native-async-storage/async-storage');
  vi.doUnmock('../src/storage/kv');
  vi.doUnmock('../src/storage/sessionKv');
  vi.doUnmock('../src/storage/syncRead');
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// F1 (a): the request carries the row's own identity
// ---------------------------------------------------------------------------

describe('F1a: the attempt id that is sent is the row’s own, never the caller’s choice', () => {
  it('a replay sends the RESTORED attempt id and count, which the caller never supplied', async () => {
    const server = fakeServer();
    let pc = await launch();
    await pc.openAttempt(row('att-restored', 12), A, () => true);
    pc = await launch();
    const { pending } = await pc.restorePendingAttempt(GOAL, A);
    const handle = io(async (attemptId, count) => server.contribute(GOAL, A, attemptId, count), { replay: true });
    await pc.replayAttempt(pending!, A, handle);
    expect(handle.send).toHaveBeenCalledTimes(1);
    expect(handle.send).toHaveBeenCalledWith('att-restored', 12);
    expect(server.calls).toEqual([`${GOAL}_${A}_att-restored`]);
  });

  it('a new attempt sends the id and count of the record that was written', async () => {
    const pc = await launch();
    const handle = io(async () => ({ ok: true }));
    await pc.openAttempt(row('att-new', 7), A, () => true);
    await pc.settleAttempt(row('att-new', 7), A, handle);
    expect(handle.send).toHaveBeenCalledWith('att-new', 7);
  });
});

// ---------------------------------------------------------------------------
// F1 (b): the live-auth gate, tested, and adjacent to the send
// ---------------------------------------------------------------------------

describe('F1b: a request goes out only as its owner, checked at the moment of sending', () => {
  const ctx = (generation: number, uid: string | null, goalId: string | undefined): RequestContext => ({ generation, uid, goalId });

  it('mayFireAs: the live auth user must be the owner, even when the screen still shows the owner', async () => {
    const { mayFireAs } = await launch();
    const started = ctx(3, A, GOAL);
    // The screen (context) still says A; Firebase already says B.
    expect(mayFireAs(A, started, ctx(3, A, GOAL), B)).toBe(false);
    expect(mayFireAs(A, started, ctx(3, A, GOAL), null)).toBe(false);
    expect(mayFireAs(A, started, ctx(3, A, GOAL), undefined)).toBe(false);
    expect(mayFireAs(A, started, ctx(3, A, GOAL), A)).toBe(true);
    // A changed context fails even with the right live user.
    expect(mayFireAs(A, started, ctx(4, A, GOAL), A)).toBe(false);
    expect(mayFireAs(A, started, ctx(3, A, 'goal-other'), A)).toBe(false);
    // A context started for somebody else is not the owner's.
    expect(mayFireAs(A, ctx(3, B, GOAL), ctx(3, B, GOAL), A)).toBe(false);
  });

  it('auth flips to B after the record write and before the send: nothing is sent, no record is left', async () => {
    const server = fakeServer();
    const pc = await launch();
    let live: string | null = A;
    const handle = io(async (attemptId, count) => server.contribute(GOAL, live as string, attemptId, count), { live: () => live });
    const opened = await pc.openAttempt(row('att-a', 8), A, handle.mayFire);
    expect(opened.fire).toBe(true);
    live = B; // between the write's answer and the send
    const settled = await pc.settleAttempt(row('att-a', 8), A, handle);
    expect(settled.kind).toBe('notSent');
    expect(handle.send).not.toHaveBeenCalled();
    expect(server.calls).toEqual([]);
    expect(stored()).toBeNull();
  });

  it('the gate is asked synchronously right before the send, with nothing awaited between', async () => {
    const pc = await launch();
    const order: string[] = [];
    let flipAfterGate = false;
    await pc.savePendingNew(row('att-1', 3), A);
    const settled = pc.settleAttempt(row('att-1', 3), A, {
      send: async () => {
        order.push('send');
        return 'ok';
      },
      isRefusal: () => false,
      stillCurrent: () => true,
      mayFire: () => {
        order.push('gate');
        // Anything queued now (a microtask) would run before the send if
        // anything were awaited between the gate and the send.
        void Promise.resolve().then(() => {
          flipAfterGate = true;
          order.push('microtask');
        });
        return true;
      },
    });
    await settled;
    // Had anything been awaited between the gate and the send, the microtask
    // queued by the gate would have run first.
    expect(order).toEqual(['gate', 'send', 'microtask']);
    expect(flipAfterGate).toBe(true);
  });

  it('a replay while B is the live auth user is not sent, and A’s reminder is left exactly as it was', async () => {
    let pc = await launch();
    await pc.openAttempt(row('att-a', 20), A, () => true);
    pc = await launch();
    const { pending } = await pc.restorePendingAttempt(GOAL, A);
    const handle = io(async () => ({}), { live: () => B, replay: true });
    const settled = await pc.replayAttempt(pending!, A, handle);
    expect(settled.kind).toBe('notSent');
    expect(handle.send).not.toHaveBeenCalled();
    await flush();
    // Not cleared, not flipped to sending: still A's unknown reminder.
    expect(stored()).toEqual({ ...row('att-a', 20), state: 'unknown' });
  });
});

// ---------------------------------------------------------------------------
// F1 (c): a legacy record is never copied into the account's slot
// ---------------------------------------------------------------------------

describe('F1c: restoring with a legacy record present', () => {
  it('returns no pending attempt, returns the orphan, writes the orphan key, and leaves the account slot empty', async () => {
    const legacy = { goalId: GOAL, attemptId: 'legacy-1', count: 30, ts: 1, state: 'unknown' };
    disk.map.set(`wsf.pendingContribution.${GOAL}`, JSON.stringify(legacy));
    const pc = await launch();
    const restored = await pc.restorePendingAttempt(GOAL, A);
    expect(restored.pending).toBeNull();
    expect(restored.orphan).toEqual(legacy);
    expect(JSON.parse(disk.map.get(`wsf.pendingContribution.orphan.${GOAL}.legacy-1`) as string)).toMatchObject({
      attemptId: 'legacy-1',
      state: 'unknown',
    });
    expect(disk.map.has(`wsf.pendingContribution.${GOAL}`)).toBe(false);
    expect(disk.map.has(pendingKeyOf(GOAL, A))).toBe(false);
    expect([...disk.map.keys()].filter((k) => k.endsWith(`.${A}`))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F1 (d): the settlement rules the route relies on
// ---------------------------------------------------------------------------

describe('F1d: settlement rules', () => {
  it('a confirmed answer that arrives for a SUPERSEDED context leaves the record for its owner (M7)', async () => {
    let pc = await launch();
    await pc.openAttempt(row('att-1', 11), A, () => true);
    let current = true;
    const late = await pc.settleAttempt(row('att-1', 11), A, {
      send: async () => {
        current = false; // the account switched while the request was in flight
        return { alreadyRecorded: false };
      },
      isRefusal: () => false,
      stillCurrent: () => current,
      mayFire: () => current,
    });
    expect(late).toMatchObject({ kind: 'confirmed', current: false });
    // Not cleared: it is still the original account's to reconcile.
    expect(stored()).toEqual(row('att-1', 11));
    pc = await launch();
    expect((await pc.restorePendingAttempt(GOAL, A)).pending?.attemptId).toBe('att-1');
  });

  it('the same answer while still current clears it', async () => {
    const pc = await launch();
    await pc.openAttempt(row('att-1', 11), A, () => true);
    const settled = await pc.settleAttempt(row('att-1', 11), A, io(async () => ({ alreadyRecorded: false })));
    expect(settled).toMatchObject({ kind: 'confirmed', current: true });
    expect(stored()).toBeNull();
  });

  it('a replay’s flip to `sending` never recreates a cleared record or overwrites a newer one (M13)', async () => {
    const pc = await launch();
    // The slot holds a NEWER attempt; an old replay of att-1 runs and fails.
    await pc.savePendingNew(row('att-2', 7), A);
    const replayOld = await pc.replayAttempt(row('att-1', 11, 'unknown'), A, io(async () => {
      throw NETWORK_LOST;
    }, { replay: true }));
    expect(replayOld.kind).toBe('unknown');
    await flush();
    expect(stored()).toEqual(row('att-2', 7));

    // The slot is EMPTY (reconciled elsewhere); a replay of att-1 runs and fails.
    await pc.clearPending(GOAL, A);
    let fail!: (e: unknown) => void;
    const inFlight = pc.replayAttempt(row('att-1', 11, 'unknown'), A, io(() => new Promise((_, reject) => (fail = reject)), { replay: true }));
    await flush();
    expect(disk.map.has(pendingKeyOf(GOAL, A))).toBe(false);
    fail(NETWORK_LOST);
    await inFlight;
    await flush();
    expect(disk.map.has(pendingKeyOf(GOAL, A))).toBe(false);
  });

  it('a replay of the record that IS in the slot does flip it to sending while in flight', async () => {
    const pc = await launch();
    await pc.savePendingNew(row('att-1', 11, 'unknown'), A);
    let answer!: (v: unknown) => void;
    const inFlight = pc.replayAttempt(row('att-1', 11, 'unknown'), A, io(() => new Promise((r) => (answer = r)), { replay: true }));
    await flush();
    expect(stored()?.state).toBe('sending');
    answer({ alreadyRecorded: true });
    expect((await inFlight).kind).toBe('confirmed');
    expect(stored()).toBeNull();
  });
});

describe('F1d: the contribute route is wired to those rules', () => {
  const slice = (from: string, to: string) => {
    const start = ROUTE.indexOf(from);
    expect(start, from).toBeGreaterThan(-1);
    const end = ROUTE.indexOf(to, start + from.length);
    expect(end, to).toBeGreaterThan(start);
    return ROUTE.slice(start, end);
  };
  const GATE = 'mayFireAs(owner, started, currentContext(), getFirebaseAuth().currentUser?.uid ?? null)';

  it('Record: the live-auth gate, the row’s own id, and the durability answer (S1, S5)', () => {
    const record = slice('const onRecord = useCallback', 'const onReconcile = useCallback');
    expect(record).toContain(`const mayFire = () => ${GATE};`);
    expect(record).toContain('await openAttempt(pendingRow, owner, mayFire)');
    expect(record).toContain('send: (id, n) => sendContribute(id, n, true),');
    expect(record).toMatch(/await settleAttempt\(pendingRow, owner, \{[^}]*\bmayFire,\s*\}\)/);
    expect(record).toContain("isDefiniteRefusal(e, 'new')");
    const opened = record.indexOf('await openAttempt(');
    const durable = record.indexOf('setPendingDurable(opened.durable)');
    const sent = record.indexOf('await settleAttempt(');
    expect(durable).toBeGreaterThan(opened);
    expect(durable).toBeLessThan(sent);
  });

  it('Reconcile: the SAME attempt, the same gate, and a replay’s idea of a refusal (S2)', () => {
    const reconcile = slice('const onReconcile = useCallback', '}, [pending, submitting, goalId, uid, sendContribute');
    expect(reconcile).toContain(`const mayFire = () => ${GATE};`);
    expect(reconcile).toMatch(/await replayAttempt\(replay, owner, \{[^}]*\bmayFire,\s*\}\)/);
    expect(reconcile).toContain('send: (id, n) => sendContribute(id, n),');
    expect(reconcile).not.toContain('mintAttemptId');
    expect(reconcile).not.toContain('takeRoundAttemptId');
    expect(reconcile).not.toMatch(/sendContribute\((?!id, n\))/);
    expect(reconcile).toContain("isDefiniteRefusal(e, 'replay')");
  });

  it('sendContribute awaits nothing before the callable, so the gate stays adjacent to it', () => {
    const before = slice('const sendContribute = useCallback(', 'const result = await fn(');
    expect(before).not.toMatch(/\bawait\b/);
  });

  it('restore: settled only by the read’s answer (or for no goal), on every path (S7)', () => {
    const effect = slice('    generationRef.current += 1;\n    identityRef.current = uid;', '}, [goalId, uid]);');
    const settles = [...effect.matchAll(/setRestoreSettled\(true\)/g)].map((m) => m.index as number);
    expect(settles).toHaveLength(2);
    const noGoal = effect.indexOf('if (!goalId) {');
    const noGoalEnd = effect.indexOf('return;', noGoal);
    expect(settles[0]).toBeGreaterThan(noGoal);
    expect(settles[0]).toBeLessThan(noGoalEnd);
    const read = effect.indexOf('restorePendingAttempt(goalId, uid)');
    const caught = effect.indexOf('.catch(', read);
    const then = effect.indexOf('.then(', read);
    expect(read).toBeGreaterThan(noGoalEnd);
    expect(caught).toBeGreaterThan(read);
    expect(then).toBeGreaterThan(caught);
    expect(settles[1]).toBeGreaterThan(then);
    // The only settle before the read is the no-goal one.
    expect(effect.slice(0, read).match(/setRestoreSettled\(true\)/g)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Correctness items
// ---------------------------------------------------------------------------

describe('a restore that cannot answer still settles', () => {
  it('restorePendingAttempt never rejects, even when the storage boundary itself throws', async () => {
    bootNative(disk);
    vi.doMock('../src/storage/kv', () => ({
      deviceKv: {
        getItem: () => Promise.reject(new Error('boom')),
        readItem: () => Promise.reject(new Error('boom')),
        setItem: () => Promise.reject(new Error('boom')),
        removeItem: () => Promise.reject(new Error('boom')),
        keysWithPrefix: () => Promise.reject(new Error('boom')),
      },
    }));
    const pc = await import('../src/pendingContribution');
    await expect(pc.restorePendingAttempt(GOAL, A)).resolves.toEqual({ pending: null, orphan: null, readFailed: true });
  });

  it('a read that never answers releases the restore after the time bound', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pc = await launch();
    const { STORAGE_OP_TIMEOUT_MS } = await import('../src/storage/keyQueue');
    disk.holdReads(); // never released
    let answer: unknown = null;
    void pc.restorePendingAttempt(GOAL, A).then((r) => (answer = r));
    await vi.advanceTimersByTimeAsync(STORAGE_OP_TIMEOUT_MS * 2 + 10);
    expect(answer).toEqual({ pending: null, orphan: null, readFailed: true });
  });
});

describe('a storage call that never settles does not hold its slot forever', () => {
  it('the write answers not durable after the bound, and the next operation on the slot runs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pc = await launch();
    const { STORAGE_OP_TIMEOUT_MS } = await import('../src/storage/keyQueue');
    const releaseWrites = disk.hold();
    let opened: unknown = null;
    void pc.openAttempt(row('att-1', 5), A, () => true).then((o) => (opened = o));
    let loaded: unknown = 'waiting';
    void pc.loadPending(GOAL, A).then((p) => (loaded = p));
    await vi.advanceTimersByTimeAsync(STORAGE_OP_TIMEOUT_MS - 10);
    expect(opened).toBeNull();
    expect(loaded).toBe('waiting');
    await vi.advanceTimersByTimeAsync(20);
    // Fires (recording is never blocked on storage) but is honestly not durable.
    expect(opened).toEqual({ fire: true, durable: false });
    // The queue moved on: the next operation on the slot answered.
    expect(loaded).toBeNull();
    releaseWrites();
  });

  it('a write that lands after the bound answered does not then retire the record of a request that went out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pc = await launch();
    const { STORAGE_OP_TIMEOUT_MS } = await import('../src/storage/keyQueue');
    let live = A;
    const releaseWrites = disk.hold();
    let opened: { fire: boolean; durable: boolean } | null = null;
    void pc.openAttempt(row('att-1', 5), A, () => live === A).then((o) => (opened = o));
    await vi.advanceTimersByTimeAsync(STORAGE_OP_TIMEOUT_MS + 10);
    expect(opened).toEqual({ fire: true, durable: false }); // the request goes out now
    live = B; // later, the account changes…
    releaseWrites(); // …and only then does the device finish the write
    await vi.advanceTimersByTimeAsync(10);
    // The record of the request that went out is still there for A.
    expect(stored()?.attemptId).toBe('att-1');
  });
});

describe('an unreadable slot is not an empty one', () => {
  it('a new attempt does not overwrite a record it cannot read, and says it is not durable', async () => {
    const pc = await launch();
    disk.map.set(pendingKeyOf(GOAL, A), JSON.stringify(row('att-old', 9, 'unknown')));
    disk.state.failReads = true;
    expect(await pc.savePendingNew(row('att-new', 4), A)).toBe(false);
    const opened = await pc.openAttempt(row('att-new', 4), A, () => true);
    expect(opened).toEqual({ fire: true, durable: false });
    disk.state.failReads = false;
    expect(stored()).toEqual(row('att-old', 9, 'unknown'));
  });

  it('a conditional clear does not remove a record it cannot read', async () => {
    const pc = await launch();
    disk.map.set(pendingKeyOf(GOAL, A), JSON.stringify(row('att-old', 9, 'unknown')));
    disk.state.failReads = true;
    expect(await pc.clearPendingIfAttempt(GOAL, A, 'att-new')).toBe(false);
    expect(await pc.clearPendingIfAttempt(GOAL, A, 'att-old')).toBe(false);
    disk.state.failReads = false;
    expect(stored()?.attemptId).toBe('att-old');
  });

  it('restore reports the failed read instead of "nothing stored"', async () => {
    const pc = await launch();
    disk.map.set(pendingKeyOf(GOAL, A), JSON.stringify(row('att-old', 9, 'unknown')));
    disk.state.failReads = true;
    expect(await pc.restorePendingAttempt(GOAL, A)).toEqual({ pending: null, orphan: null, readFailed: true });
    disk.state.failReads = false;
    expect(stored()?.attemptId).toBe('att-old');
  });

  it('the mirror flags an unreadable key, and a toggle pressed meanwhile does not overwrite the stored choice', async () => {
    disk.map.set('wsf.moveCamera.v1', JSON.stringify({ cameraCounter: false, stickFigure: true }));
    disk.state.failReads = true;
    bootNative(disk);
    const st = await import('../src/movement-camera/settingsStore');
    st.writeMoveCameraSettings({ stickFigure: false });
    await st.moveCameraSettingsReady();
    // Answered (nothing waits forever), the toggle holds for the session…
    expect(st.moveCameraSettingsLoaded()).toBe(true);
    expect(st.readMoveCameraSettings().stickFigure).toBe(false);
    await flush();
    // …but defaults it never read were not written over the stored choice.
    expect(JSON.parse(disk.map.get('wsf.moveCamera.v1') as string)).toEqual({ cameraCounter: false, stickFigure: true });
  });

  it('the mirror itself: an unreadable key reads as nothing, says so, and an explicit write clears the flag', async () => {
    bootNative(disk);
    const { createKeyMirror } = await import('../src/storage/mirror');
    const { deviceKv } = await import('../src/storage/kv');
    disk.map.set('k', 'v');
    disk.state.failReads = true;
    const mirror = createKeyMirror(deviceKv, () => undefined);
    await mirror.load('k');
    expect(mirror.loaded('k')).toBe(true);
    expect(mirror.unreadable('k')).toBe(true);
    expect(mirror.read('k')).toBeNull();
    disk.state.failReads = false;
    await mirror.write('k', 'w');
    expect(mirror.unreadable('k')).toBe(false);
    expect(mirror.read('k')).toBe('w');
  });
});

describe('the restore escalation is one operation, and its result is honoured', () => {
  it('a refused escalation that left the record in place still restores it', async () => {
    const pc = await launch();
    disk.map.set(pendingKeyOf(GOAL, A), JSON.stringify(row('att-1', 6)));
    disk.state.failWrites = true;
    expect((await pc.restorePendingAttempt(GOAL, A)).pending).toEqual(row('att-1', 6, 'unknown'));
    disk.state.failWrites = false;
    expect(stored()).toEqual(row('att-1', 6));
  });

  it('a refused escalation that found the slot emptied restores nothing', async () => {
    const pc = await launch();
    disk.map.set(pendingKeyOf(GOAL, A), JSON.stringify(row('att-1', 6)));
    const realSet = disk.api.setItem;
    disk.api.setItem = async (key: string) => {
      // The device dropped the record and refused the write.
      disk.map.delete(key);
      throw new Error('storage refused');
    };
    try {
      expect((await pc.restorePendingAttempt(GOAL, A)).pending).toBeNull();
    } finally {
      disk.api.setItem = realSet;
    }
  });

  it('a clear issued during the restore lands after it, never between its read and its escalation', async () => {
    const pc = await launch();
    disk.map.set(pendingKeyOf(GOAL, A), JSON.stringify(row('att-1', 6)));
    const releaseWrites = disk.hold();
    const restoring = pc.restorePendingAttempt(GOAL, A);
    await flush();
    const clearing = pc.clearPendingIfAttempt(GOAL, A, 'att-1');
    releaseWrites();
    expect((await restoring).pending).toEqual(row('att-1', 6, 'unknown'));
    expect(await clearing).toBe(true);
    expect(stored()).toBeNull();
  });
});

describe('an attempt that may not fire is retired in the same operation that wrote it', () => {
  it('a restore issued while the write is in flight never sees an attempt that was not sent', async () => {
    const pc = await launch();
    let signedIn = A;
    const releaseWrites = disk.hold();
    const opening = pc.openAttempt(row('att-a', 8), A, () => signedIn === A);
    signedIn = B;
    const restoring = pc.restorePendingAttempt(GOAL, A);
    await flush(); // the restore is now queued behind the write
    releaseWrites();
    expect((await opening).fire).toBe(false);
    expect((await restoring).pending).toBeNull();
    expect(stored()).toBeNull();
  });
});

describe('the native session store', () => {
  it('an expired value cannot be removed on top of a write that lands after it was read', async () => {
    bootNative(disk);
    const { sessionKv } = await import('../src/storage/sessionKv');
    disk.map.set('wsf.k', JSON.stringify({ v: 'old', exp: Date.now() - 1000 }));
    // Every read sees the value as it was when it was ISSUED, and answers only
    // when released — one at a time.
    const realGet = disk.api.getItem;
    const waiting: Array<() => void> = [];
    disk.api.getItem = async (key: string) => {
      const seen = disk.map.get(key) ?? null;
      await new Promise<void>((r) => waiting.push(r));
      return seen;
    };
    try {
      const reading = sessionKv.getItem('wsf.k');
      await flush();
      waiting.shift()!(); // the read answers: expired
      await flush();
      // It re-reads before removing. A write issued now must not land between
      // that re-read and the remove.
      expect(waiting).toHaveLength(1);
      const writing = sessionKv.setItem('wsf.k', 'new');
      await flush();
      waiting.shift()!();
      expect(await reading).toBeNull();
      expect(await writing).toBe(true);
      expect(JSON.parse(disk.map.get('wsf.k') as string).v).toBe('new');
    } finally {
      disk.api.getItem = realGet;
    }
  });

  it('a value changed outside the queue between the read and the remove is not removed', async () => {
    bootNative(disk);
    const { sessionKv, NATIVE_SESSION_TTL_MS } = await import('../src/storage/sessionKv.native');
    disk.map.set('wsf.k', JSON.stringify({ v: 'old', exp: Date.now() - 1000 }));
    const releaseReads = disk.holdReads();
    const realGet = disk.api.getItem;
    let first = true;
    disk.api.getItem = async (key: string) => {
      if (!first) return realGet(key);
      first = false;
      const seen = disk.map.get(key) ?? null;
      await realGet(key);
      return seen;
    };
    try {
      const reading = sessionKv.getItem('wsf.k');
      await flush();
      // Another writer (not this queue) stores a fresh value meanwhile.
      const fresh = JSON.stringify({ v: 'fresh', exp: Date.now() + NATIVE_SESSION_TTL_MS });
      disk.map.set('wsf.k', fresh);
      releaseReads();
      expect(await reading).toBeNull();
      expect(disk.map.get('wsf.k')).toBe(fresh);
    } finally {
      disk.api.getItem = realGet;
    }
  });

  it('honours an expiry a few minutes past the bound (clock correction), and refuses one further out', async () => {
    bootNative(disk);
    const { sessionKv, NATIVE_SESSION_TTL_MS } = await import('../src/storage/sessionKv.native');
    disk.map.set('wsf.near', JSON.stringify({ v: 'near', exp: Date.now() + NATIVE_SESSION_TTL_MS + 4 * 60 * 1000 }));
    disk.map.set('wsf.far', JSON.stringify({ v: 'far', exp: Date.now() + NATIVE_SESSION_TTL_MS + 6 * 60 * 1000 }));
    expect(await sessionKv.getItem('wsf.near')).toBe('near');
    expect(await sessionKv.getItem('wsf.far')).toBeNull();
    expect(disk.map.has('wsf.far')).toBe(false);
  });

  it('the in-memory copy honours the two-hour expiry in a process that outlives it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-10-20T10:00:00Z').getTime();
    vi.setSystemTime(t0);
    bootNative(disk);
    const pj = await import('../src/pendingJoinCode');
    const code = 'J0inCodeForNative_01';
    await pj.setPendingJoinCode(code, null);
    vi.setSystemTime(t0 + 2 * 60 * 60 * 1000 - 1000);
    expect(pj.readPendingJoinCode(null)).toBe(code);
    vi.setSystemTime(t0 + 2 * 60 * 60 * 1000 + 1000);
    expect(pj.readPendingJoinCode(null)).toBeNull();
  });

  it('and a value hydrated at launch expires at its stored time, not two hours after the launch', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-10-20T10:00:00Z').getTime();
    vi.setSystemTime(t0);
    const code = 'J0inCodeForNative_01';
    disk.map.set('wsf.pendingJoinCode', JSON.stringify({ v: code, exp: t0 + 60 * 60 * 1000 }));
    bootNative(disk);
    const pj = await import('../src/pendingJoinCode');
    await pj.pendingJoinCodeReady();
    expect(pj.readPendingJoinCode(null)).toBe(code);
    vi.setSystemTime(t0 + 60 * 60 * 1000 + 1000);
    expect(pj.readPendingJoinCode(null)).toBeNull();
  });
});

describe('a goal id is validated before any key is composed from it', () => {
  it('a crafted goal id cannot retire another account’s scoped record as "legacy"', async () => {
    const pc = await launch();
    // legacyPendingKey('g.uid-a') is exactly pendingKey('g', 'uid-a').
    disk.map.set(pendingKeyOf('g', A), JSON.stringify({ goalId: 'g.uid-a', attemptId: 'att-a', count: 3, ts: 1, state: 'unknown' }));
    expect(pc.isGoalIdShape('g.uid-a')).toBe(false);
    expect(await pc.retireLegacyPending('g.uid-a')).toBeNull();
    expect(await pc.restorePendingAttempt('g.uid-a', B)).toEqual({ pending: null, orphan: null });
    expect(disk.map.has(pendingKeyOf('g', A))).toBe(true);
    expect([...disk.map.keys()].some((k) => k.includes('orphan'))).toBe(false);
  });

  it('accepts the shapes goal ids take', async () => {
    const pc = await launch();
    for (const id of ['goal-1', 'w9rpgoal-abc_123', 'AbC123xyz']) expect(pc.isGoalIdShape(id), id).toBe(true);
    for (const id of ['', 'a/b', '../x', 'a.b', 'a b', 'x'.repeat(129)]) expect(pc.isGoalIdShape(id), id).toBe(false);
  });
});

describe('a replay refused as unauthenticated keeps its reminder', () => {
  it('classification: unauthenticated is a refusal of a new attempt, not of a replay', () => {
    expect(classifyContributeError(UNAUTHENTICATED)).toEqual({ kind: 'refused', reason: 'signedOut' });
    expect(isDefiniteRefusal(UNAUTHENTICATED, 'new')).toBe(true);
    expect(isDefiniteRefusal(UNAUTHENTICATED, 'replay')).toBe(false);
    expect(isDefiniteRefusal(REFUSED_CLOSED, 'replay')).toBe(true);
    expect(isDefiniteRefusal(NETWORK_LOST, 'new')).toBe(false);
  });

  it('the owner’s reminder survives the unauthenticated replay and a relaunch, and replays once signed in', async () => {
    const server = fakeServer();
    let pc = await launch();
    await pc.openAttempt(row('att-1', 12), A, () => true);
    server.contribute(GOAL, A, 'att-1', 12); // landed; the reply was lost
    pc = await launch();
    const { pending } = await pc.restorePendingAttempt(GOAL, A);
    const refusedAsSignedOut = await pc.replayAttempt(pending!, A, io(async () => {
      throw UNAUTHENTICATED;
    }, { replay: true }));
    expect(refusedAsSignedOut.kind).toBe('unknown');
    expect(stored()).toEqual(row('att-1', 12, 'unknown'));

    pc = await launch();
    const again = await pc.restorePendingAttempt(GOAL, A);
    expect(again.pending?.attemptId).toBe('att-1');
    const settled = await pc.replayAttempt(again.pending!, A, io(async (id, n) => server.contribute(GOAL, A, id, n), { replay: true }));
    expect(settled).toMatchObject({ kind: 'confirmed', data: { alreadyRecorded: true } });
    expect(stored()).toBeNull();
  });
});
