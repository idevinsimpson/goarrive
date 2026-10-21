import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootNative, createFakeAsyncStorage, flush, type FakeAsyncStorage } from './nativeStorageHarness';

/**
 * W13-1 (ST-05): the durable kiosk-session marker and the launch guard.
 *
 * Native cases run over the NATIVE storage implementations and simulate a
 * relaunch by booting fresh modules over the same backing map
 * (tests/nativeStorageHarness.ts). Not a device run.
 */

const GOAL = 'goal-kiosk_1';
const MARKER = 'wsf.kioskSessionGoalId';
const B = 'uid-b';

let disk: FakeAsyncStorage;
const router = { replace: vi.fn() };
let pathname = '/';

async function launch() {
  bootNative(disk);
  vi.doMock('expo-router', () => ({ router, usePathname: () => pathname }));
  vi.doMock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: null }) }));
  const ks = await import('../src/kioskSession');
  const arm = await import('../src/handoffArming');
  const guard = await import('../src/kioskLaunchGuard');
  const pj = await import('../src/pendingJoinCode');
  return { ks, arm, guard, pj };
}

beforeEach(() => {
  disk = createFakeAsyncStorage();
  router.replace.mockReset();
  pathname = '/';
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  for (const m of [
    '@react-native-async-storage/async-storage',
    '../src/storage/kv',
    '../src/storage/sessionKv',
    '../src/storage/syncRead',
    '../src/firebase',
    'firebase/auth',
    'expo-router',
    '../src/auth',
  ]) {
    vi.doUnmock(m);
  }
  vi.resetModules();
});

describe('the marker (native)', () => {
  it('is written by the kiosk’s Contribute and survives a relaunch', async () => {
    let m = await launch();
    await m.arm.armKioskReturn(GOAL);
    expect(disk.map.has(MARKER)).toBe(true);
    m = await launch();
    await m.ks.kioskSessionReady();
    expect(m.ks.readKioskSession()).toBe(GOAL);
    expect(await m.guard.kioskLaunchRoute()).toBe(`/kiosk/${GOAL}`);
  });

  it('no marker: the launch goes nowhere special', async () => {
    const m = await launch();
    expect(await m.guard.kioskLaunchRoute()).toBeNull();
  });

  it('has no expiry: still there long after the two-hour handoffs have gone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-10-21T10:00:00Z').getTime();
    vi.setSystemTime(t0);
    let m = await launch();
    await m.arm.armKioskReturn(GOAL);
    vi.setSystemTime(t0 + 24 * 60 * 60 * 1000);
    m = await launch();
    expect(await m.guard.kioskLaunchRoute()).toBe(`/kiosk/${GOAL}`);
    // …while the kiosk RETURN (a two-hour handoff) has expired.
    expect(m.ks.readKioskReturnGoal(null)).toBeNull();
  });

  it('Finish: kept when the sign-out fails, cleared once it succeeds', async () => {
    let m = await launch();
    await m.ks.markKioskSession(GOAL);
    const failing = await m.ks.runKioskFinish(
      { goalId: GOAL, outcome: 'confirmed', uid: B, attemptId: null },
      {
        signOut: async () => {
          throw new Error('network');
        },
        clearPendingIfAttempt: () => false,
        clearKioskKeys: () => undefined,
      }
    );
    expect(failing.signedOut).toBe(false);
    m = await launch();
    expect(await m.guard.kioskLaunchRoute()).toBe(`/kiosk/${GOAL}`);

    const ok = await m.ks.runKioskFinish(
      { goalId: GOAL, outcome: 'confirmed', uid: B, attemptId: null },
      { signOut: async () => {}, clearPendingIfAttempt: () => false, clearKioskKeys: () => undefined }
    );
    expect(ok.signedOut).toBe(true);
    m = await launch();
    expect(await m.guard.kioskLaunchRoute()).toBeNull();
  });

  it('the marker is cleared only AFTER the sign-out has resolved', async () => {
    const m = await launch();
    await m.ks.markKioskSession(GOAL);
    let release!: () => void;
    const signingOut = new Promise<void>((r) => (release = r));
    const finishing = m.ks.runKioskFinish(
      { goalId: GOAL, outcome: 'none', uid: B, attemptId: null },
      { signOut: () => signingOut, clearPendingIfAttempt: () => false, clearKioskKeys: () => undefined }
    );
    await flush();
    expect(m.ks.readKioskSession()).toBe(GOAL);
    release();
    await finishing;
    expect(m.ks.readKioskSession()).toBeNull();
  });

  it('the kiosk start screen at rest clears it', async () => {
    let m = await launch();
    await m.arm.armKioskReturn(GOAL);
    m = await launch();
    await m.arm.resetSharedScreenHandoffs();
    m = await launch();
    expect(await m.guard.kioskLaunchRoute()).toBeNull();
  });

  it('a device that refuses the write, or the read, gives no route — and nothing throws', async () => {
    let m = await launch();
    disk.state.failWrites = true;
    expect(await m.ks.markKioskSession(GOAL)).toBe(false);
    disk.state.failWrites = false;
    m = await launch();
    await expect(m.guard.kioskLaunchRoute()).resolves.toBeNull();

    disk.map.set(MARKER, GOAL);
    disk.state.failReads = true;
    m = await launch();
    await expect(m.guard.kioskLaunchRoute()).resolves.toBeNull();
    disk.state.failReads = false;
  });

  it('a launch read that rejects gives no route and does not throw', async () => {
    bootNative(disk);
    vi.doMock('expo-router', () => ({ router, usePathname: () => pathname }));
    vi.doMock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: null }) }));
    vi.doMock('../src/kioskSession', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../src/kioskSession')>()),
      kioskSessionReady: () => Promise.reject(new Error('boom')),
    }));
    try {
      const guard = await import('../src/kioskLaunchGuard');
      await expect(guard.kioskLaunchRoute()).resolves.toBeNull();
    } finally {
      vi.doUnmock('../src/kioskSession');
    }
  });

  it('a stored value that is not a goal id routes nowhere', async () => {
    disk.map.set(MARKER, '../admin');
    const m = await launch();
    expect(await m.guard.kioskLaunchRoute()).toBeNull();
  });

  it('an ordinary sign-in after a finished kiosk session does not route to the kiosk', async () => {
    let m = await launch();
    await m.arm.armKioskReturn(GOAL);
    await m.ks.runKioskFinish(
      { goalId: GOAL, outcome: 'confirmed', uid: B, attemptId: null },
      { signOut: async () => {}, clearPendingIfAttempt: () => false, clearKioskKeys: m.ks.clearKioskReturnGoal }
    );
    m = await launch();
    expect(await m.guard.kioskLaunchRoute()).toBeNull();
    expect(await m.pj.routeAfterAuth('/', B)).toBe('/');
  });
});

describe('the hook (native)', () => {
  async function mountGuard(m: Awaited<ReturnType<typeof launch>>) {
    const { createElement, act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    function Probe() {
      m.guard.useKioskLaunchGuard();
      return null;
    }
    await act(async () => {
      root.render(createElement(Probe));
      await flush();
    });
    return {
      rerender: async () =>
        act(async () => {
          root.render(createElement(Probe));
          await flush();
        }),
      unmount: () => {
        act(() => root.unmount());
        container.remove();
      },
    };
  }

  it('replaces to the kiosk start screen once per process', async () => {
    let m = await launch();
    await m.arm.armKioskReturn(GOAL);
    m = await launch();
    const view = await mountGuard(m);
    await view.rerender();
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith(`/kiosk/${GOAL}`);
    view.unmount();
    // A second mount in the same process does not ask again.
    const again = await mountGuard(m);
    expect(router.replace).toHaveBeenCalledTimes(1);
    again.unmount();
  });

  it('does not replace when already on that kiosk’s start screen, or with no marker', async () => {
    let m = await launch();
    await m.arm.armKioskReturn(GOAL);
    m = await launch();
    pathname = `/kiosk/${GOAL}`;
    const view = await mountGuard(m);
    expect(router.replace).not.toHaveBeenCalled();
    view.unmount();

    disk.map.delete(MARKER);
    pathname = '/';
    m = await launch();
    const none = await mountGuard(m);
    expect(router.replace).not.toHaveBeenCalled();
    none.unmount();
  });
});

describe('web: none of this', () => {
  it('writes nothing to browser storage and never routes', async () => {
    vi.resetModules();
    vi.doMock('expo-router', () => ({ router, usePathname: () => pathname }));
    vi.doMock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: null }) }));
    // A stale key in the browser (say, from another build) is never read.
    window.localStorage.setItem(MARKER, GOAL);
    const ks = await import('../src/kioskSession');
    const arm = await import('../src/handoffArming');
    const guard = await import('../src/kioskLaunchGuard');
    expect(ks.readKioskSession()).toBeNull();
    expect(await guard.kioskLaunchRoute()).toBeNull();
    window.localStorage.removeItem(MARKER);
    expect(await ks.markKioskSession(GOAL)).toBe(false);
    await arm.armKioskReturn(GOAL);
    expect(window.localStorage.getItem(MARKER)).toBeNull();
    expect(window.sessionStorage.getItem(MARKER)).toBeNull();
    expect(ks.readKioskSession()).toBeNull();
    expect(await guard.kioskLaunchRoute()).toBeNull();
    expect(await ks.clearKioskSession()).toBe(true);
    window.sessionStorage.clear();
  });
});
