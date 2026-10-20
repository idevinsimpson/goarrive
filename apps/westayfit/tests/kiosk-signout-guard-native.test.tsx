import { act, useEffect, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 F-4 (MF-08 interim), the kiosk start screen as the APP runs
 * it (`Platform.OS` is 'ios' here). MF-08 case 1: a phone's owner who lands on
 * the kiosk is still signed in afterwards, or first sees an explicit
 * confirmation that opening it here signs them out. A visitor who came
 * through this kiosk's own Contribute hand-off is still reset without asking,
 * as the shared device needs. The web twin is kiosk-signout-guard-web.test.tsx.
 */

vi.mock('react-native', async (importOriginal) => {
  const rn = await importOriginal<typeof import('react-native')>();
  return { ...rn, Platform: { ...rn.Platform, OS: 'ios' } };
});
vi.mock('../src/ui/useReducedMotion', () => ({ useReducedMotion: () => true }));
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
const push = vi.fn();
const replace = vi.fn();
const back = vi.fn();
let canGoBack = true;
let focused = true;
let focusEpoch = 0;
vi.mock('expo-router', () => ({
  router: {
    push: (...a: unknown[]) => push(...a),
    replace: (...a: unknown[]) => replace(...a),
    back: () => back(),
    canGoBack: () => canGoBack,
  },
  useLocalSearchParams: () => ({ goalId: 'goal-1' }),
  // A focused screen runs the callback on focus and whenever it changes.
  useFocusEffect: (cb: () => void | (() => void)) => {
    const epoch = focusEpoch;
    useEffect(() => (focused ? cb() : undefined), [cb, epoch]);
  },
}));

const { default: KioskGoal } = await import('../app/kiosk/[goalId]');
const { decideKioskStart } = await import('../src/kioskSignOutGuard');

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  signOut.mockClear();
  push.mockReset();
  replace.mockReset();
  back.mockReset();
  canGoBack = true;
  focused = true;
  auth = { ready: true, user: null };
  decideKioskStart('web', false); // spend any hand-off note a previous test left
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
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
async function render(): Promise<void> {
  act(() => {
    root.render(<KioskGoal />);
  });
  await flush();
}
async function press(id: string): Promise<void> {
  const el = byId(id);
  expect(el, `${id} is on screen`).not.toBeNull();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}
/** The device comes back to the start screen. */
async function refocus(): Promise<void> {
  focused = true;
  focusEpoch += 1;
  await render();
}

describe('the kiosk start screen in the app (MF-08 case 1)', () => {
  it("a phone's own signed-in account is asked first, and nothing is signed out", async () => {
    setUser({ uid: 'champion-1' });
    await render();
    expect(byId('wsf-kiosk-confirm-signout')).not.toBeNull();
    expect(container.textContent).toContain('Opening it on this phone signs you out');
    expect(container.textContent).not.toContain('champion-1');
    expect(signOut).not.toHaveBeenCalled();
    // The kiosk itself is not shown behind the question.
    expect(byId('wsf-kiosk-start')).toBeNull();
  });

  it('"Stay signed in" goes back and keeps the account', async () => {
    setUser({ uid: 'champion-1' });
    await render();
    await press('wsf-kiosk-confirm-signout-back');
    expect(back).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
  });

  it('"Stay signed in" with nothing to go back to goes Home', async () => {
    canGoBack = false;
    setUser({ uid: 'champion-1' });
    await render();
    await press('wsf-kiosk-confirm-signout-back');
    expect(replace).toHaveBeenCalledWith('/');
    expect(signOut).not.toHaveBeenCalled();
  });

  it('"Sign out and open the kiosk" signs out, then shows the kiosk', async () => {
    setUser({ uid: 'champion-1' });
    await render();
    await press('wsf-kiosk-confirm-signout-yes');
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(byId('wsf-kiosk-confirm-signout')).toBeNull();
    expect(byId('wsf-kiosk-start')).not.toBeNull();
  });

  it("a visitor who came through this kiosk's Contribute is reset without asking", async () => {
    await render();
    await press('wsf-kiosk-start');
    expect(push).toHaveBeenCalledTimes(1);
    // The visitor signs in on the screens pushed above the start screen.
    focused = false;
    act(() => setUser({ uid: 'visitor-1' }));
    await flush();
    expect(signOut).not.toHaveBeenCalled();
    // ...and the device comes back to rest on the start screen.
    await refocus();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(byId('wsf-kiosk-confirm-signout')).toBeNull();
    expect(byId('wsf-kiosk-start')).not.toBeNull();
  });

  it('the hand-off note is spent: the next account to arrive without Contribute is asked', async () => {
    await render();
    await press('wsf-kiosk-start');
    focused = false;
    act(() => setUser({ uid: 'visitor-1' }));
    await refocus();
    expect(signOut).toHaveBeenCalledTimes(1);
    focused = false;
    act(() => setUser({ uid: 'someone-else' }));
    await refocus();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(byId('wsf-kiosk-confirm-signout')).not.toBeNull();
  });

  it('signed out, the kiosk shows as before', async () => {
    await render();
    expect(byId('wsf-kiosk-confirm-signout')).toBeNull();
    expect(byId('wsf-kiosk-start')).not.toBeNull();
    expect(signOut).not.toHaveBeenCalled();
  });
});
