import { act, useEffect, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 F-4 (MF-08 interim): ON THE WEB NOTHING CHANGES. The kiosk
 * start screen at an event signs out whatever account it comes to rest with,
 * without asking, exactly as before. The app's twin is
 * kiosk-signout-guard-native.test.tsx.
 */

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
vi.mock('firebase/functions', () => ({ httpsCallable: () => () => new Promise(() => {}) }));
vi.mock('expo-router', () => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({ goalId: 'goal-1' }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(() => cb(), [cb]);
  },
}));

const { default: KioskGoal } = await import('../app/kiosk/[goalId]');

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  signOut.mockClear();
  auth = { ready: true, user: null };
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

describe('the kiosk start screen on the web (unchanged)', () => {
  it('signs out an attached account without asking', async () => {
    setUser({ uid: 'left-without-finish' });
    act(() => {
      root.render(<KioskGoal />);
    });
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(byId('wsf-kiosk-confirm-signout')).toBeNull();
  });

  it('signed out, it does nothing but show the kiosk', async () => {
    act(() => {
      root.render(<KioskGoal />);
    });
    expect(signOut).not.toHaveBeenCalled();
    expect(byId('wsf-kiosk-confirm-signout')).toBeNull();
    expect(byId('wsf-kiosk-loading')).not.toBeNull();
  });
});
