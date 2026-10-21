import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootNative, createFakeAsyncStorage, fakeAuth, flush, type FakeAsyncStorage } from './nativeStorageHarness';

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
  // One at a time: concurrent dynamic imports right after `vi.doMock` can
  // resolve before the mocks are registered, and then load the WEB stores.
  const pj = await import('../src/pendingJoinCode');
  const ev = await import('../src/eventReturn');
  const mk = await import('../src/markerEntry');
  const ks = await import('../src/kioskSession');
  const pad = await import('../src/postAuthDestination');
  const ad = await import('../src/authDestination');
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

  it('the panel draws no rows until the order is known, then draws the remembered community first', async () => {
    bootNative(disk);
    let cc = await import('../src/currentCommunity');
    await cc.currentCommunityReady();
    await cc.rememberCurrentCommunity(A, 'g2');

    const release = disk.holdReads();
    bootNative(disk);
    const row = (groupId: string) => ({ groupId, displayName: groupId, role: 'member', nameVisibility: 'visible', activityVisibility: 'visible' });
    vi.doMock('../src/auth', () => ({ useWsfAuth: () => ({ user: { uid: A }, ready: true }) }));
    vi.doMock('../src/memberReads', () => ({
      readMyCommunities: async () => ({ items: [row('g1'), row('g2')] }),
      forgetCommunity: () => undefined,
      peekMemberProfile: () => null,
    }));
    vi.doMock('firebase/functions', () => ({ httpsCallable: () => async () => ({ data: {} }) }));
    cc = await import('../src/currentCommunity');
    const { CommunityPrivacyControls } = await import('../src/ui/CommunityPrivacyControls');
    const { createElement, act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const blocks = () =>
      Array.from(container.querySelectorAll('[data-testid^="wsf-privacy-panel-block-"]')).map((el) =>
        (el.getAttribute('data-testid') as string).replace('wsf-privacy-panel-block-', '')
      );
    try {
      await act(async () => {
        root.render(createElement(CommunityPrivacyControls));
        await flush();
      });
      // The communities have been read, but the remembered one has not: no
      // rows, and the panel says it is loading.
      expect(blocks()).toEqual([]);
      expect(container.querySelector('[data-testid="wsf-privacy-panel-loading"]')).not.toBeNull();
      await act(async () => {
        release();
        await cc.currentCommunityReady();
        await flush();
      });
      expect(blocks()).toEqual(['g2', 'g1']);
    } finally {
      act(() => root.unmount());
      container.remove();
      for (const m of ['../src/auth', '../src/memberReads', 'firebase/functions']) vi.doUnmock(m);
    }
  });
});

describe('the stash sites say whose destination it is', () => {
  const read = (rel: string) => readFileSync(path.resolve(rel), 'utf8');

  it('a marker armed by a signed-in member is that member\u2019s; armed signed out, it is the next sign-in\u2019s', async () => {
    const m = await launch();
    const arm = await import('../src/handoffArming');
    await arm.armMarkerReturn(SLUG, A);
    expect(m.mk.readMarkerReturn(Date.now(), A)).toBe(SLUG);
    expect(m.mk.readMarkerReturn(Date.now(), B)).toBeNull();
    expect(m.mk.readMarkerReturn(Date.now(), null)).toBeNull();
    await arm.armMarkerReturn(SLUG, null);
    expect(m.mk.readMarkerReturn(Date.now(), B)).toBe(SLUG);
    // The screen arms through that helper, for the account looking at it.
    const screen = read('src/ui/MarkerEntryScreen.tsx');
    expect(screen.slice(screen.indexOf('const armReturn'), screen.indexOf('const onJoin'))).toContain('armMarkerReturn(slug, uid)');
  });

  it('the kiosk\u2019s return is always the next sign-in\u2019s handoff', async () => {
    const m = await launch();
    const arm = await import('../src/handoffArming');
    expect(await arm.armKioskReturn(KIOSK_GOAL)).toBe(true);
    expect(m.ks.readKioskReturnGoal(null)).toBe(KIOSK_GOAL);
    expect(m.ks.readKioskReturnGoal(B)).toBe(KIOSK_GOAL);
    expect(read('app/kiosk/[goalId].tsx')).toContain('void armKioskReturn(goalId);');
  });

  it('"use a different account" hands off to the next sign-in on purpose', () => {
    const event = read('app/event/[goalId].tsx');
    const sw = event.slice(event.indexOf('const onUseDifferentAccount'), event.indexOf('router.replace(\'/signin\''));
    expect(sw).toContain('setEventReturn(goalId, Date.now(), null)');
    expect(sw.indexOf('setEventReturn')).toBeLessThan(sw.indexOf('signOut('));
  });
});

describe('a shared screen\u2019s fresh destination is not outranked by a stale one', () => {
  const read = (rel: string) => readFileSync(path.resolve(rel), 'utf8');
  it('an event handoff left by an abandoned sign-in, a relaunch, then kiosk Contribute: routes to the kiosk', async () => {
    let m = await launch();
    await m.ev.setEventReturn(GOAL, Date.now(), null);
    m = await launch();
    const arm = await import('../src/handoffArming');
    await arm.armKioskReturn(KIOSK_GOAL);
    expect(await m.pj.routeAfterAuth('/', B)).toBe(`/contribute/${KIOSK_GOAL}?kiosk=1`);
    expect(disk.map.has('wsf.eventReturn')).toBe(false);
  });

  it('a stale join code or marker does not outrank or outlive the kiosk\u2019s return either', async () => {
    let m = await launch();
    await m.pj.setPendingJoinCode(JOIN, null);
    await m.mk.setMarkerReturn(SLUG, Date.now(), null);
    m = await launch();
    const arm = await import('../src/handoffArming');
    await arm.armKioskReturn(KIOSK_GOAL);
    expect(await m.pj.routeAfterAuth('/', B)).toBe(`/contribute/${KIOSK_GOAL}?kiosk=1`);
    expect(disk.map.has('wsf.pendingJoinCode')).toBe(false);
    expect(disk.map.has('wsf.markerReturn')).toBe(false);
  });

  it('a stale kiosk return does not outrank a marker scanned afterwards', async () => {
    let m = await launch();
    await m.ks.setKioskReturnGoal(KIOSK_GOAL, null);
    m = await launch();
    const arm = await import('../src/handoffArming');
    await arm.armMarkerReturn(SLUG, null);
    expect(await m.pj.routeAfterAuth('/', B)).toBe(`/go/${SLUG}`);
  });

  it('a kiosk start screen at rest clears every destination an earlier visitor armed', async () => {
    let m = await launch();
    await m.pj.setPendingJoinCode(JOIN, null);
    await m.ev.setEventReturn(GOAL, Date.now(), null);
    await m.mk.setMarkerReturn(SLUG, Date.now(), null);
    await m.ks.setKioskReturnGoal(KIOSK_GOAL, null);
    m = await launch();
    const arm = await import('../src/handoffArming');
    expect(await arm.resetSharedScreenHandoffs()).toBe(true);
    expect(await m.pj.routeAfterAuth('/', B)).toBe('/');
    for (const k of ['wsf.pendingJoinCode', 'wsf.eventReturn', 'wsf.markerReturn', 'wsf.kioskReturnGoalId']) {
      expect(disk.map.has(k), k).toBe(false);
    }
    expect(read('app/kiosk/[goalId].tsx')).toContain('void resetSharedScreenHandoffs();');
  });
});

describe('the kiosk return expires in a process that outlives it (the #635 mirror expiry)', () => {
  it('two hours after it was armed it no longer routes, without a relaunch', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-10-20T10:00:00Z').getTime();
    vi.setSystemTime(t0);
    const m = await launch();
    await m.ks.setKioskReturnGoal(KIOSK_GOAL, null);
    vi.setSystemTime(t0 + 2 * 60 * 60 * 1000 - 1000);
    expect(await m.pj.routeAfterAuth('/', B)).toBe(`/contribute/${KIOSK_GOAL}?kiosk=1`);
    vi.setSystemTime(t0 + 2 * 60 * 60 * 1000 + 1000);
    expect(m.ks.readKioskReturnGoal(B)).toBeNull();
    expect(await m.pj.routeAfterAuth('/', B)).toBe('/');
  });
});
