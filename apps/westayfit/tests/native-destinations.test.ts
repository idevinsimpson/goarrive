import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootNative, createFakeAsyncStorage, fakeAuth, type FakeAsyncStorage } from './nativeStorageHarness';

/**
 * NATIVE-STATE-2 — the event return, the marker return and the kiosk return
 * goal on a phone, under the same identity rules as the pending join code.
 *
 * Every test runs the modules over their NATIVE storage implementations and
 * simulates termination by booting fresh module state over the same backing
 * Map (tests/nativeStorageHarness.ts). Auth answers are delivered through the
 * real session watch (src/postAuthDestination.ts) via a captured
 * `onAuthStateChanged` listener. Not a device run.
 */

const A = 'uid-a';
const B = 'uid-b';
const GOAL = 'goal-event_1';
const KIOSK_GOAL = 'goal-kiosk_1';
const SLUG = 'flag-07';
const JOIN = 'J0inCodeForNative_02';

let disk: FakeAsyncStorage;

async function launch() {
  bootNative(disk);
  const [pj, ev, mk, ks, pad, ad] = await Promise.all([
    import('../src/pendingJoinCode'),
    import('../src/eventReturn'),
    import('../src/markerEntry'),
    import('../src/kioskSession'),
    import('../src/postAuthDestination'),
    import('../src/authDestination'),
  ]);
  return { pj, ev, mk, ks, pad, ad };
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

describe('a marker or event entry survives a relaunch for the same account and never routes another', () => {
  it('a signed-out marker scan survives the app being killed and routes the account that signs in', async () => {
    let m = await launch();
    expect(await m.mk.setMarkerReturn(SLUG)).toBe(true);
    m = await launch();
    expect(await m.pj.routeAfterAuth('/', A)).toBe(`/go/${SLUG}`);
  });

  it("a marker return armed by A on the way to a gate routes A after a relaunch — and never B", async () => {
    let m = await launch();
    await m.mk.setMarkerReturn(SLUG, Date.now(), A);

    m = await launch();
    await m.pad.postAuthDestinationsReady();
    // Signed out now: not announced on the sign-in screen.
    expect(m.ad.readAuthDestinationKind(null)).toBeNull();
    expect(m.ad.readAuthDestinationKind(A)).toBe('marker');
    expect(await m.pj.routeAfterAuth('/', A)).toBe(`/go/${SLUG}`);

    // The same disk, relaunched, and B completes the hop instead.
    m = await launch();
    expect(await m.pj.routeAfterAuth('/', B)).toBe('/');
    // Dropped, not merely skipped: A does not find it waiting either.
    m = await launch();
    expect(await m.pj.routeAfterAuth('/', A)).toBe('/');
  });

  it('a signed-out event stash survives a relaunch and routes the next sign-in', async () => {
    let m = await launch();
    await m.ev.setEventReturn(GOAL);
    m = await launch();
    expect(await m.pj.routeAfterAuth('/', B)).toBe(`/event/${GOAL}`);
  });

  it("an event return stashed under A survives for A and never routes B", async () => {
    let m = await launch();
    await m.ev.setEventReturn(GOAL, Date.now(), A);
    m = await launch();
    await m.pad.postAuthDestinationsReady();
    expect(m.ev.readEventReturn(Date.now(), B)).toBeNull();
    expect(m.ev.readEventReturn(Date.now(), null)).toBeNull();
    expect(m.ev.readEventReturn(Date.now(), A)).toBe(GOAL);
    expect(await m.pj.routeAfterAuth('/', A)).toBe(`/event/${GOAL}`);
  });

  it('the kiosk return goal survives a relaunch for the visitor who signs in', async () => {
    let m = await launch();
    await m.ks.setKioskReturnGoal(KIOSK_GOAL, null);
    m = await launch();
    expect(await m.pj.routeAfterAuth('/', A)).toBe(`/contribute/${KIOSK_GOAL}?kiosk=1`);
  });

  it("a kiosk return stashed under A is not B's", async () => {
    let m = await launch();
    await m.ks.setKioskReturnGoal(KIOSK_GOAL, A);
    m = await launch();
    expect(await m.pj.routeAfterAuth('/', B)).toBe('/');
  });

  it('the terminal hop on a cold start waits for the launch read', async () => {
    let m = await launch();
    await m.mk.setMarkerReturn(SLUG);
    const release = disk.holdReads();
    m = await launch();
    // Not read yet: the synchronous router has nothing, the waiting one does.
    expect(m.pad.isPostAuthDestinationsReady()).toBe(false);
    expect(m.pj.nextRouteAfterAuth('/', A)).toBe('/');
    const routing = m.pj.routeAfterAuth('/', A);
    release();
    expect(await routing).toBe(`/go/${SLUG}`);
  });
});

describe('sign-out and account switch clear owned destinations — through the session watch', () => {
  it('sign-out clears what the account owned and keeps the signed-out handoff', async () => {
    const m = await launch();
    await m.pj.setPendingJoinCode(JOIN, A);
    await m.mk.setMarkerReturn(SLUG, Date.now(), A);
    await m.ks.setKioskReturnGoal(KIOSK_GOAL, A);
    // "Use a different account": deliberately nobody's.
    await m.ev.setEventReturn(GOAL, Date.now(), null);
    expect(fakeAuth.listeners).toHaveLength(1);

    await fakeAuth.fire(A); // A is who is signed in: nothing goes
    expect([...disk.map.keys()].sort()).toEqual(
      ['wsf.eventReturn', 'wsf.kioskReturnGoalId', 'wsf.markerReturn', 'wsf.pendingJoinCode'].sort()
    );

    await fakeAuth.fire(null); // A signs out
    expect([...disk.map.keys()]).toEqual(['wsf.eventReturn']);
    expect(await m.pj.routeAfterAuth('/', B)).toBe(`/event/${GOAL}`);
  });

  it('an account switch clears the previous account’s destinations', async () => {
    const m = await launch();
    await m.mk.setMarkerReturn(SLUG, Date.now(), A);
    await fakeAuth.fire(A);
    await fakeAuth.fire(B);
    expect(disk.map.has('wsf.markerReturn')).toBe(false);
  });

  it('a destination owned by A and found at launch starts the watch, and a launch as somebody else drops it', async () => {
    let m = await launch();
    await m.mk.setMarkerReturn(SLUG, Date.now(), A);

    m = await launch();
    await m.pad.postAuthDestinationsReady();
    await Promise.resolve();
    expect(fakeAuth.listeners).toHaveLength(1);
    // The app reopened signed out (A signed out before it was killed).
    await fakeAuth.fire(null);
    expect(disk.map.has('wsf.markerReturn')).toBe(false);
  });

  it('a device holding only signed-out handoffs starts no watch at all', async () => {
    let m = await launch();
    await m.mk.setMarkerReturn(SLUG);
    m = await launch();
    await m.pad.postAuthDestinationsReady();
    expect(fakeAuth.listeners).toHaveLength(0);
  });
});

describe('the two-hour bound on a phone', () => {
  it('the kiosk return goal (which carries no timestamp of its own) expires with the store', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-10-20T10:00:00Z').getTime();
    vi.setSystemTime(t0);
    let m = await launch();
    await m.ks.setKioskReturnGoal(KIOSK_GOAL, null);
    vi.setSystemTime(t0 + 2 * 60 * 60 * 1000 + 1000);
    m = await launch();
    expect(await m.pj.routeAfterAuth('/', A)).toBe('/');
    expect(disk.map.has('wsf.kioskReturnGoalId')).toBe(false);
  });

  it('the event and marker returns keep their own two-hour age check on top', async () => {
    const m = await launch();
    const now = Date.now();
    await m.ev.setEventReturn(GOAL, now - 2 * 60 * 60 * 1000 - 1000);
    await m.mk.setMarkerReturn(SLUG, now - 2 * 60 * 60 * 1000 - 1000);
    expect(m.ev.readEventReturn(now)).toBeNull();
    expect(m.mk.readMarkerReturn(now)).toBeNull();
  });
});

describe('the privacy panel never puts a guess first on a phone', () => {
  it('orders nothing until the remembered community has been read, then puts it first', async () => {
    bootNative(disk);
    let cc = await import('../src/currentCommunity');
    await cc.currentCommunityReady();
    await cc.rememberCurrentCommunity(A, 'g2');

    const release = disk.holdReads();
    bootNative(disk);
    cc = await import('../src/currentCommunity');
    const rows = [{ groupId: 'g1' }, { groupId: 'g2' }];
    expect(cc.currentFirstWhenReady(A, rows)).toBeNull();
    release();
    await cc.currentCommunityReady();
    expect(cc.currentFirstWhenReady(A, rows)?.map((r) => r.groupId)).toEqual(['g2', 'g1']);
    expect(cc.currentFirstWhenReady(B, rows)?.map((r) => r.groupId)).toEqual(['g1', 'g2']);
  });

  it('the panel holds its loading state while the order is not known', () => {
    const code = readFileSync(path.resolve('src/ui/CommunityPrivacyControls.tsx'), 'utf8');
    expect(code).toContain('useCurrentCommunityReady();');
    expect(code).toContain('const ordered = currentFirstWhenReady(uid, rows);');
    expect(code).toContain("load={phase === 'ready' && ordered === null ? 'loading' : phase}");
    expect(code).not.toMatch(/resolveCurrentCommunity\(/);
  });
});

describe('the stash sites say whose destination it is', () => {
  const read = (rel: string) => readFileSync(path.resolve(rel), 'utf8');

  it('the marker screen arms the return for the account looking at it', () => {
    const screen = read('src/ui/MarkerEntryScreen.tsx');
    const arm = screen.slice(screen.indexOf('const armReturn'), screen.indexOf('const onJoin'));
    expect(arm).toContain('setMarkerReturn(slug, Date.now(), uid)');
  });

  it('"use a different account" and the kiosk start screen hand off to the next sign-in on purpose', () => {
    const event = read('app/event/[goalId].tsx');
    const sw = event.slice(event.indexOf('const onUseDifferentAccount'), event.indexOf('router.replace(\'/signin\''));
    expect(sw).toContain('setEventReturn(goalId, Date.now(), null)');
    expect(sw.indexOf('setEventReturn')).toBeLessThan(sw.indexOf('signOut('));
    expect(read('app/kiosk/[goalId].tsx')).toContain('setKioskReturnGoal(goalId, null)');
  });
});
