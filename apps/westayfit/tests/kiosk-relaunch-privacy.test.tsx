import { act, useEffect, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 heads-10 C7-1 (state ESC-1 plus member F-4). A phone acting
 * as a kiosk is killed mid-session with the visitor still signed in. On
 * relaunch, state's launch guard brings it back to the kiosk start screen (the
 * durable kiosk-session marker). F-4's hand-off note lived in memory only and
 * died with the process, so the screen ASKED. "Stay signed in" then left the
 * previous visitor on member Home, which breaks ST-05 case 5. An open
 * kiosk-session marker for this goal now counts as kiosk evidence: the
 * visitor is signed out once, with no prompt.
 *
 * On a phone: Platform.OS 'ios', device storage asynchronous (HAS_SYNC_STORAGE
 * false; the marker's store is jsdom's, so it survives the "kill"). A fresh
 * process is vi.resetModules() and a fresh import: no hand-off note, the
 * marker re-read from the device. No device.
 */

vi.mock('react-native', async (importOriginal) => {
  const rn = await importOriginal<typeof import('react-native')>();
  return { ...rn, Platform: { ...rn.Platform, OS: 'ios' } };
});
vi.mock('../src/storage/syncRead', async () => {
  const actual = await vi.importActual<typeof import('../src/storage/syncRead')>('../src/storage/syncRead');
  // A phone's device storage: read asynchronously, hydrated at launch.
  return { ...actual, HAS_SYNC_STORAGE: false, readDeviceSync: () => undefined };
});
vi.mock('../src/ui/useReducedMotion', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useReducedMotion: () => true,
  useReducedMotionPreference: () => ({ reduced: true, known: true, failed: false }),
}));
vi.mock('../src/ui/WsfWordmark', () => ({ WsfWordmark: () => null }));

type User = { uid: string };
let auth: { ready: boolean; user: User | null } = { ready: true, user: null };
const listeners = new Set<() => void>();
function setUser(user: User | null): void {
  auth = { ready: true, user };
  for (const l of listeners) l();
}
vi.mock('../src/auth', () => ({
  useWsfAuth: () =>
    useSyncExternalStore(
      (l: () => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      () => auth,
    ),
}));
const signOut = vi.fn(async () => setUser(null));
vi.mock('firebase/auth', () => ({ signOut: () => signOut() }));
vi.mock('../src/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getFirebaseFunctions: () => ({}),
  wsfUsingEmulators: false,
}));
const PULSE = {
  sharedTotal: 120,
  target: 500,
  unit: 'squats',
  status: 'active',
  communityDisplayName: 'Oak Grove',
  goalTitle: '500 squats together',
  startsAt: '2026-10-01T00:00:00Z',
  endsAt: '2026-12-01T00:00:00Z',
  timezone: 'UTC',
};
vi.mock('firebase/functions', () => ({ httpsCallable: () => () => Promise.resolve({ data: PULSE }) }));
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), canGoBack: () => true };
let routeGoalId = 'goal-1';
vi.mock('expo-router', () => ({
  router,
  useLocalSearchParams: () => ({ goalId: routeGoalId }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(() => cb(), [cb]);
  },
}));

/** A new process: every module afresh, the marker re-read from the device. */
async function freshProcess() {
  vi.resetModules();
  const session = await import('../src/kioskSession');
  await session.kioskSessionReady();
  const { default: KioskGoal } = await import('../app/kiosk/[goalId]');
  return { KioskGoal, session };
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  signOut.mockClear();
  router.replace.mockReset();
  routeGoalId = 'goal-1';
  auth = { ready: true, user: null };
  window.localStorage.clear();
  window.sessionStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });

describe('heads-10 C7-1: a phone relaunched mid-kiosk-session signs its visitor out', () => {
  it('marker written, process killed, relaunched with the visitor signed in: signOut once, no prompt, and the marker closes after', async () => {
    // The previous process: the kiosk's Contribute armed a session for goal-1.
    const before = await freshProcess();
    expect(await before.session.markKioskSession('goal-1')).toBe(true);

    // The OS kills the app. On relaunch the visitor is still signed in.
    const { KioskGoal, session } = await freshProcess();
    expect(session.readKioskSession()).toBe('goal-1');
    setUser({ uid: 'visitor-1' });
    act(() => root.render(<KioskGoal />));
    await flush();

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(byId('wsf-kiosk-confirm-signout')).toBeNull();
    // Signed out, the start screen at rest closes the session.
    expect(auth.user).toBeNull();
    await flush();
    expect(session.readKioskSession()).toBeNull();
    expect(router.replace).not.toHaveBeenCalledWith('/');
  });

  it('a marker for ANOTHER goal is no evidence: an account opening this kiosk is still asked, nothing signed out', async () => {
    const before = await freshProcess();
    expect(await before.session.markKioskSession('goal-2')).toBe(true);
    const { KioskGoal } = await freshProcess();
    setUser({ uid: 'champion-1' });
    act(() => root.render(<KioskGoal />));
    await flush();
    expect(signOut).not.toHaveBeenCalled();
    expect(byId('wsf-kiosk-confirm-signout')).not.toBeNull();
  });

  it('no marker at all: still asked (F-4, unchanged)', async () => {
    const { KioskGoal, session } = await freshProcess();
    expect(session.readKioskSession()).toBeNull();
    setUser({ uid: 'champion-1' });
    act(() => root.render(<KioskGoal />));
    await flush();
    expect(signOut).not.toHaveBeenCalled();
    expect(byId('wsf-kiosk-confirm-signout')).not.toBeNull();
  });
});
