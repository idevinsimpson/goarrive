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
/** What auth has answered, as `useWsfAuth` reports it. One object per answer. */
let auth: { ready: boolean; user: { uid: string } | null } = { ready: true, user: null };

async function launch() {
  bootNative(disk);
  vi.doMock('expo-router', () => ({ router, usePathname: () => pathname }));
  vi.doMock('../src/auth', () => ({ useWsfAuth: () => auth }));
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
  auth = { ready: true, user: null };
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
    'firebase/functions',
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

  it('resetting the shared screen’s handoffs leaves it: the visitor may still be signed in (ESC-1)', async () => {
    let m = await launch();
    await m.arm.armKioskReturn(GOAL);
    m = await launch();
    expect(await m.arm.resetSharedScreenHandoffs()).toBe(true);
    // The handoffs went…
    expect(m.ks.readKioskReturnGoal(null)).toBeNull();
    // …the kiosk session did not.
    m = await launch();
    expect(await m.guard.kioskLaunchRoute()).toBe(`/kiosk/${GOAL}`);
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

describe('the hook holds member screens until the launch is decided (ESC-2, native)', () => {
  /** Renders a probe that runs the guard, and another that only reads the hold; records every value. */
  async function mountProbes(m: Awaited<ReturnType<typeof launch>>) {
    const { createElement, act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const guarded: boolean[] = [];
    const read: boolean[] = [];
    function Guard() {
      guarded.push(m.guard.useKioskLaunchGuard());
      return null;
    }
    function Reader() {
      read.push(m.guard.useKioskLaunchHolding());
      return null;
    }
    const tree = () => createElement('div', null, createElement(Guard), createElement(Reader));
    await act(async () => {
      root.render(tree());
    });
    return {
      guarded,
      read,
      settle: () =>
        act(async () => {
          await flush();
        }),
      rerender: () =>
        act(async () => {
          root.render(tree());
          await flush();
        }),
      unmount: () => {
        act(() => root.unmount());
        container.remove();
      },
    };
  }

  it('holds on the first frame, and stops only after the replace has been issued', async () => {
    let m = await launch();
    await m.arm.armKioskReturn(GOAL);
    m = await launch();
    // Still holding at the moment the replace is issued.
    const atReplace: boolean[] = [];
    router.replace.mockImplementation(() => {
      atReplace.push(m.guard.isKioskLaunchHolding());
    });
    const probes = await mountProbes(m);
    expect(probes.guarded[0]).toBe(true);
    expect(probes.read[0]).toBe(true);
    await probes.settle();
    expect(router.replace).toHaveBeenCalledWith(`/kiosk/${GOAL}`);
    expect(atReplace).toEqual([true]);
    expect(probes.guarded.at(-1)).toBe(false);
    expect(probes.read.at(-1)).toBe(false);
    expect(m.guard.isKioskLaunchHolding()).toBe(false);
    probes.unmount();
  });

  it('no marker: holds until the read has answered, then lets go without a replace', async () => {
    const m = await launch();
    const probes = await mountProbes(m);
    expect(probes.guarded[0]).toBe(true);
    await probes.settle();
    expect(router.replace).not.toHaveBeenCalled();
    expect(probes.guarded.at(-1)).toBe(false);
    expect(probes.read.at(-1)).toBe(false);
    probes.unmount();
  });

  it('waits for auth to answer before deciding', async () => {
    const m = await launch();
    auth = { ready: false, user: null };
    const probes = await mountProbes(m);
    await probes.settle();
    expect(probes.guarded.at(-1)).toBe(true);
    auth = { ready: true, user: null };
    await probes.rerender();
    expect(probes.guarded.at(-1)).toBe(false);
    probes.unmount();
  });

  it('a later mount in the same process does not hold at all', async () => {
    const m = await launch();
    const first = await mountProbes(m);
    await first.settle();
    first.unmount();
    const again = await mountProbes(m);
    expect(again.guarded[0]).toBe(false);
    expect(again.read[0]).toBe(false);
    again.unmount();
  });

  it('a replace that throws neither escapes nor leaves the device holding', async () => {
    let m = await launch();
    await m.arm.armKioskReturn(GOAL);
    m = await launch();
    router.replace.mockImplementation(() => {
      throw new Error('Attempted to navigate before mounting the Root Layout component.');
    });
    const probes = await mountProbes(m);
    await probes.settle();
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(probes.guarded.at(-1)).toBe(false);
    probes.unmount();
  });
});

describe('the kiosk start screen ends the kiosk session only once nobody is signed in (ESC-1, native)', () => {
  /** What `signOut` does this time; `resolve` / `reject` settle the pending one. */
  let signOutCalls = 0;
  let signOutMode: 'reject' | 'pending' = 'reject';
  let settleSignOut: { resolve: () => void; reject: (e: Error) => void } | null = null;

  beforeEach(() => {
    signOutCalls = 0;
    signOutMode = 'reject';
    settleSignOut = null;
  });

  /** A fresh process with the kiosk start screen focused, as the launch guard would leave it. */
  async function openStartScreen() {
    await launch();
    vi.doMock('expo-router', async () => {
      const React = await import('react');
      return {
        router,
        usePathname: () => `/kiosk/${GOAL}`,
        useLocalSearchParams: () => ({ goalId: GOAL }),
        // Focused for as long as it is mounted, re-run when its callback changes.
        useFocusEffect: (effect: () => void | (() => void)) => React.useEffect(effect, [effect]),
      };
    });
    vi.doMock('../src/firebase', () => ({
      getFirebaseAuth: () => ({}),
      getFirebaseFunctions: () => ({}),
      wsfUsingEmulators: false,
    }));
    vi.doMock('firebase/auth', () => ({
      onAuthStateChanged: () => () => undefined,
      signOut: () => {
        signOutCalls += 1;
        if (signOutMode === 'reject') return Promise.reject(new Error('network'));
        return new Promise<void>((resolve, reject) => {
          settleSignOut = { resolve, reject };
        });
      },
    }));
    // The pulse never answers: the start screen stays on its loading frame.
    vi.doMock('firebase/functions', () => ({ httpsCallable: () => () => new Promise(() => undefined) }));
    const { createElement, act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const ks = await import('../src/kioskSession');
    const { default: KioskStart } = await import('../app/kiosk/[goalId]');
    await ks.kioskSessionReady();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const render = () =>
      act(async () => {
        root.render(createElement(KioskStart));
        await flush();
      });
    await render();
    return {
      ks,
      render,
      unmount: () => {
        act(() => root.unmount());
        container.remove();
      },
    };
  }

  async function withOpenSession(): Promise<void> {
    const m = await launch();
    await m.ks.markKioskSession(GOAL);
    expect(disk.map.get(MARKER)).toBe(GOAL);
  }

  it('a sign-out that fails keeps the marker, so the next launch still comes back here', async () => {
    await withOpenSession();
    auth = { ready: true, user: { uid: B } };
    signOutMode = 'reject';
    const screen = await openStartScreen();
    expect(signOutCalls).toBe(1);
    expect(screen.ks.readKioskSession()).toBe(GOAL);
    expect(disk.map.get(MARKER)).toBe(GOAL);
    screen.unmount();
    const m = await launch();
    expect(await m.guard.kioskLaunchRoute()).toBe(`/kiosk/${GOAL}`);
  });

  it('a sign-out still in flight keeps it; once auth answers with nobody, it goes', async () => {
    await withOpenSession();
    auth = { ready: true, user: { uid: B } };
    signOutMode = 'pending';
    const screen = await openStartScreen();
    expect(signOutCalls).toBe(1);
    expect(disk.map.get(MARKER)).toBe(GOAL);
    // The sign-out lands, and auth says so: the screen runs its effect again.
    settleSignOut!.resolve();
    auth = { ready: true, user: null };
    await screen.render();
    expect(screen.ks.readKioskSession()).toBeNull();
    expect(disk.map.has(MARKER)).toBe(false);
    screen.unmount();
    const m = await launch();
    expect(await m.guard.kioskLaunchRoute()).toBeNull();
  });

  it('nothing is cleared before auth has answered', async () => {
    await withOpenSession();
    auth = { ready: false, user: null };
    const screen = await openStartScreen();
    expect(signOutCalls).toBe(0);
    expect(disk.map.get(MARKER)).toBe(GOAL);
    // Auth answers with the visitor still signed in: sign-out, marker kept.
    auth = { ready: true, user: { uid: B } };
    signOutMode = 'reject';
    await screen.render();
    expect(signOutCalls).toBe(1);
    expect(disk.map.get(MARKER)).toBe(GOAL);
    screen.unmount();
  });

  it('nobody signed in at rest: the marker goes', async () => {
    await withOpenSession();
    auth = { ready: true, user: null };
    const screen = await openStartScreen();
    expect(signOutCalls).toBe(0);
    expect(disk.map.has(MARKER)).toBe(false);
    screen.unmount();
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

  it('never holds: the first frame is already free (ESC-2)', async () => {
    vi.resetModules();
    vi.doMock('expo-router', () => ({ router, usePathname: () => pathname }));
    vi.doMock('../src/auth', () => ({ useWsfAuth: () => auth }));
    auth = { ready: false, user: null };
    const guard = await import('../src/kioskLaunchGuard');
    const { createElement, act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const seen: boolean[] = [];
    function Probe() {
      seen.push(guard.useKioskLaunchGuard(), guard.useKioskLaunchHolding());
      return null;
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Probe));
    });
    expect(seen.slice(0, 2)).toEqual([false, false]);
    act(() => root.unmount());
    expect(router.replace).not.toHaveBeenCalled();
  });
});
