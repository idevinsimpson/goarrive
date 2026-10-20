import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootNative, createFakeAsyncStorage, fakeAuth, type FakeAsyncStorage } from './nativeStorageHarness';

/**
 * NATIVE-STATE-3 — a join QR's event + activity context, and the device-mode
 * answer, on a phone.
 *
 * The modules run over their NATIVE storage implementations, and termination
 * is simulated by booting fresh module state over the same backing Map
 * (tests/nativeStorageHarness.ts). Auth answers reach the real session watch
 * through a captured `onAuthStateChanged` listener. Not a device run.
 */

const A = 'uid-a';
const B = 'uid-b';
const CODE = 'JoinCodeFromTheHall_01';
const EVENT = 'goal-event_7';
const ACTIVITY = 'Squats';
const GROUP = 'group_1';
const EVENT_KEY = 'wsf.pendingEventGoalId';
const ACTIVITY_KEY = 'wsf.pendingEventActivity';

let disk: FakeAsyncStorage;

async function launch() {
  bootNative(disk);
  // One at a time: concurrent dynamic imports right after `vi.doMock` can
  // resolve before the mocks are registered, and then load the WEB stores.
  const je = await import('../src/joinEventHandoff');
  const pj = await import('../src/pendingJoinCode');
  const st = await import('../src/stationSession');
  const dm = await import('../src/deviceMode');
  return { je, pj, st, dm };
}

/** What the join page does when it mounts on `/join/<code>?event=…&activity=…`. */
async function scan(m: Awaited<ReturnType<typeof launch>>, owner: string | null, code: string = CODE) {
  await m.pj.setPendingJoinCode(code, owner);
  await m.je.setPendingEventGoal(EVENT, code, owner);
  await m.je.setPendingEventActivity(ACTIVITY, code, owner);
}

/** What the join page does after `wsfJoinCommunity` succeeded for `code`. */
async function finishJoin(
  m: Awaited<ReturnType<typeof launch>>,
  uid: string,
  code: string = CODE,
  group: string = GROUP
) {
  await m.pj.clearPendingJoinCode();
  const context = await m.je.takeJoinEventContext(uid, code);
  return m.st.routeAfterJoin(group, context.goalId, context.activity);
}

beforeEach(() => {
  disk = createFakeAsyncStorage();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  // These ran over the native boundary: the browser stores were never touched.
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

describe('the join QR context survives sign-up and a relaunch, and lands in the community AND the event', () => {
  it('signed-out scan on a fresh install, app killed during verification, relaunched: same account lands at the event with its activity', async () => {
    let m = await launch();
    await scan(m, null);

    // Killed while the new member was in their mail app. Relaunched; the
    // profile gate's terminal hop routes back to the join page…
    m = await launch();
    expect(await m.pj.routeAfterAuth('/', A)).toBe(`/join/${CODE}`);
    // …which arrives WITHOUT the query string; the join succeeds.
    expect(await finishJoin(m, A)).toBe(`/event/${EVENT}?activity=${ACTIVITY}`);
  });

  it('a context stashed by a signed-in member survives a relaunch for that member', async () => {
    let m = await launch();
    await scan(m, A);
    m = await launch();
    expect(await finishJoin(m, A)).toBe(`/event/${EVENT}?activity=${ACTIVITY}`);
  });

  it('a signed-out scan is the handoff for whoever signs in next', async () => {
    let m = await launch();
    await scan(m, null);
    m = await launch();
    expect(await finishJoin(m, B)).toBe(`/event/${EVENT}?activity=${ACTIVITY}`);
  });
});

describe('the context never transfers to a different account', () => {
  it("A's context does not route B's join — B lands on the community, and A's context is gone", async () => {
    let m = await launch();
    await scan(m, A);
    m = await launch();
    await (await import('../src/postAuthDestination')).postAuthDestinationsReady();
    expect(m.je.readPendingEventGoal(B, CODE)).toBeNull();
    expect(m.je.readPendingEventGoal(null, CODE)).toBeNull();
    expect(m.je.readPendingEventActivity(B, CODE)).toBeNull();
    expect(await finishJoin(m, B)).toBe(`/community/${GROUP}`);
    expect(disk.map.has(EVENT_KEY)).toBe(false);
    expect(disk.map.has(ACTIVITY_KEY)).toBe(false);
  });

  it("B's terminal hop drops A's context before the join page ever reads it", async () => {
    let m = await launch();
    await scan(m, A);
    m = await launch();
    expect(await m.pj.routeAfterAuth('/', B)).toBe('/');
    expect(disk.map.has(EVENT_KEY)).toBe(false);
    expect(disk.map.has(ACTIVITY_KEY)).toBe(false);
  });

  it('sign-out clears an owned context through the session watch; a signed-out handoff stays', async () => {
    const m = await launch();
    await m.je.setPendingEventGoal(EVENT, CODE, A);
    await m.je.setPendingEventActivity(ACTIVITY, CODE, A);
    expect(fakeAuth.listeners).toHaveLength(1);
    await fakeAuth.fire(A);
    expect(disk.map.has(EVENT_KEY)).toBe(true);
    await fakeAuth.fire(null);
    expect(disk.map.has(EVENT_KEY)).toBe(false);
    expect(disk.map.has(ACTIVITY_KEY)).toBe(false);

    await m.je.setPendingEventGoal(EVENT, CODE, null);
    await fakeAuth.fire(B);
    expect(m.je.readPendingEventGoal(B, CODE)).toBe(EVENT);
  });
});

describe('consumed exactly once, and bounded', () => {
  it('the finished join consumes the context; a second take, or a later join, finds nothing', async () => {
    const m = await launch();
    await scan(m, null);
    expect(await m.je.takeJoinEventContext(A, CODE)).toEqual({ goalId: EVENT, activity: ACTIVITY });
    expect(await m.je.takeJoinEventContext(A, CODE)).toEqual({ goalId: null, activity: null });
    expect(m.st.routeAfterJoin('group_2', null, null)).toBe('/community/group_2');
    expect(disk.map.has(EVENT_KEY)).toBe(false);
    expect(disk.map.has(ACTIVITY_KEY)).toBe(false);
  });

  it('an activity with no event names nothing and is dropped with it', async () => {
    const m = await launch();
    await m.je.setPendingEventActivity(ACTIVITY, CODE, null);
    expect(await m.je.takeJoinEventContext(A, CODE)).toEqual({ goalId: null, activity: null });
    expect(disk.map.has(ACTIVITY_KEY)).toBe(false);
  });

  it('expires after two hours on a phone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-10-20T10:00:00Z').getTime();
    vi.setSystemTime(t0);
    let m = await launch();
    await scan(m, null);
    vi.setSystemTime(t0 + 2 * 60 * 60 * 1000 + 1000);
    m = await launch();
    expect(await finishJoin(m, A)).toBe(`/community/${GROUP}`);
  });

  it('refuses to carry anything that could become a path or be rendered', async () => {
    const m = await launch();
    expect(await m.je.setPendingEventGoal('../../admin', CODE, null)).toBe(false);
    expect(await m.je.setPendingEventActivity('x'.repeat(65), CODE, null)).toBe(false);
    expect(await m.je.setPendingEventGoal(EVENT, 'short', null)).toBe(false);
    expect(disk.map.size).toBe(0);
  });
});

describe('the context is bound to the join code it arrived with', () => {
  const OTHER_CODE = 'OtherCommunityCode_02';

  it('abandon event-QR join A, then complete join B (after a relaunch): lands on B\u2019s community, no event', async () => {
    let m = await launch();
    await scan(m, null); // the event QR for community A, then walked away
    m = await launch();
    // Later, a plain invite to a different community, joined by the same person.
    await m.pj.setPendingJoinCode(OTHER_CODE, A);
    expect(await finishJoin(m, A, OTHER_CODE, 'group_b')).toBe('/community/group_b');
    // The stale context is gone, not waiting for some later join.
    expect(disk.map.has(EVENT_KEY)).toBe(false);
    expect(disk.map.has(ACTIVITY_KEY)).toBe(false);
  });

  it('completing the same code still lands at the event with its activity', async () => {
    let m = await launch();
    await scan(m, null, OTHER_CODE);
    m = await launch();
    expect(await finishJoin(m, B, OTHER_CODE, 'group_b')).toBe(`/event/${EVENT}?activity=${ACTIVITY}`);
  });

  it('a newer scan replaces the event, and a stale activity from the older code is not attached to it', async () => {
    const m = await launch();
    await scan(m, null); // event + activity for CODE
    await m.je.setPendingEventGoal('goal-other_9', OTHER_CODE, null); // a second QR, no activity
    expect(await finishJoin(m, A, OTHER_CODE, 'group_b')).toBe('/event/goal-other_9');
  });

  it('a record from before the code was kept is discarded safely and never routes', async () => {
    // A bare goal id and label, and an owned record without a code — the
    // shapes written before this rule.
    disk.map.set(EVENT_KEY, JSON.stringify({ v: EVENT, exp: Date.now() + 60_000 }));
    disk.map.set(ACTIVITY_KEY, JSON.stringify({ v: JSON.stringify({ activity: ACTIVITY, owner: A }), exp: Date.now() + 60_000 }));
    const m = await launch();
    expect(await finishJoin(m, A)).toBe(`/community/${GROUP}`);
    expect(disk.map.has(EVENT_KEY)).toBe(false);
    expect(disk.map.has(ACTIVITY_KEY)).toBe(false);
  });
});

describe('the device-mode answer is a device preference on a phone', () => {
  it('survives a relaunch, is not read as "personal" before the launch read lands, and survives every sign-out', async () => {
    let m = await launch();
    expect(await m.dm.saveDeviceMode('shared')).toBe(true);

    const release = disk.holdReads();
    m = await launch();
    // Not read yet: no answer, and the screens hold their loading state.
    expect(m.dm.isDeviceModeReady()).toBe(false);
    expect(m.dm.readDeviceMode()).toBeNull();
    release();
    await m.dm.deviceModeReady();
    expect(m.dm.readDeviceMode()).toBe('shared');

    // A shared screen signs out every visitor; its answer must outlive them.
    await m.je.setPendingEventGoal(EVENT, CODE, A); // starts the session watch
    await fakeAuth.fire(A);
    await fakeAuth.fire(null);
    expect(disk.map.get('wsf.deviceMode')).toBe('shared');
    m = await launch();
    await m.dm.deviceModeReady();
    expect(m.dm.readDeviceMode()).toBe('shared');
  });

  it('forgetting it is durable too, and a refused write is reported', async () => {
    let m = await launch();
    await m.dm.saveDeviceMode('personal');
    expect(await m.dm.clearDeviceMode()).toBe(true);
    m = await launch();
    await m.dm.deviceModeReady();
    expect(m.dm.readDeviceMode()).toBeNull();
    disk.state.failWrites = true;
    expect(await m.dm.saveDeviceMode('shared')).toBe(false);
  });
});

describe('the station path is untouched, and the join route consumes once', () => {
  const read = (rel: string) => readFileSync(path.resolve(rel), 'utf8');

  it('the station screen never touches the member handoff, and the credential stays in localStorage', () => {
    const station = read('app/station/[goalId].tsx');
    expect(station).not.toMatch(/PendingEvent|joinEventHandoff/);
    const session = read('src/stationSession.ts');
    expect(session).toContain('window.localStorage');
    expect(session).not.toContain('sessionStorage?.');
    expect(session).toMatch(/export \{[\s\S]*setPendingEventGoal[\s\S]*\} from '\.\/joinEventHandoff'/);
  });

  it('the join route stashes owned context once auth has settled, and takes it exactly once after a join', () => {
    const join = read('app/join/[joinCode].tsx');
    expect(join).toContain('void setPendingEventGoal(eventGoalId, joinCode, stashUid.current)');
    expect(join).toContain('void setPendingEventActivity(eventActivity, joinCode, stashUid.current)');
    expect(join.match(/takeJoinEventContext\(/g)).toHaveLength(1);
    expect(join).toContain('takeJoinEventContext(user.uid, joinCode)');
    expect(join).not.toMatch(/readPendingEvent(Goal|Activity)\(|clearPendingEvent(Goal|Activity)\(/);
    const onJoin = join.slice(join.indexOf('const onJoin = useCallback'));
    expect(onJoin.indexOf("'wsfJoinCommunity'")).toBeLessThan(onJoin.indexOf('takeJoinEventContext('));
  });
});
