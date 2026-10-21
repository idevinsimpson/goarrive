import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * INT-27 (W12-11) — a stalled first auth answer on a phone: after 4 s Home
 * says it is still connecting (still loading, never signed out because of
 * it), and the first answer, whenever it comes, decides as it always did.
 * The real WsfAuthProvider and the real Home; onAuthStateChanged is held
 * until the test answers; Platform.OS is switchable; timers are fake.
 */

const ctl = vi.hoisted(() => ({
  os: 'ios' as 'ios' | 'android' | 'web',
  answer: null as null | ((user: unknown) => void),
  subscribed: 0,
}));

vi.mock('react-native', async () => {
  const actual = (await vi.importActual('react-native-web')) as Record<string, any>;
  return {
    ...actual,
    Platform: {
      ...actual.Platform,
      get OS() {
        return ctl.os;
      },
      select: (o: Record<string, unknown>) => (ctl.os in o ? o[ctl.os] : ctl.os !== 'web' && 'native' in o ? o.native : o.default),
    },
  };
});
vi.mock('firebase/auth', () => ({
  signOut: vi.fn(),
  onAuthStateChanged: (_auth: unknown, cb: (user: unknown) => void) => {
    ctl.subscribed += 1;
    ctl.answer = cb;
    return () => {
      ctl.answer = null;
    };
  },
}));
vi.mock('../src/ui/useScreenTopInset', () => ({
  useScreenTopInset: () => 0,
  ScreenTopSpacer: () => null,
  ScreenStatusBar: () => null,
}));
vi.mock('expo-router', () => ({
  router: { replace: vi.fn(), push: vi.fn() },
  Link: ({ children }: { children: ReactNode }) => <>{children}</>,
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ setParams: vi.fn() }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(() => cb(), [cb]);
  },
}));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
vi.mock('../src/firebase', () => ({ getFirebaseAuth: () => ({}), wsfIsStaging: false }));
vi.mock('../src/currentCommunity', () => ({ resolveCurrentCommunity: () => null, useCurrentCommunityReady: () => true }));
vi.mock('../src/memberReads', () => ({
  SAME_LOAD_MS: 10_000,
  readMyCommunities: () => new Promise(() => undefined),
  readGoals: () => new Promise(() => undefined),
}));

import { AUTH_SLOW_MS, useWsfAuth, WsfAuthProvider } from '../src/auth';

const { default: Home } = await import('../app/(tabs)/(home)/index');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

beforeEach(() => {
  vi.useFakeTimers();
  ctl.os = 'ios';
  ctl.answer = null;
  ctl.subscribed = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const show = () =>
  act(() =>
    root.render(
      <WsfAuthProvider>
        <Home />
      </WsfAuthProvider>,
    ),
  );
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('INT-27: a stalled first auth answer', () => {
  for (const os of ['ios', 'android'] as const) {
    it(`${os}: at 4 s Home says it is still connecting, inside the loading state, and shows no signed-out hero`, () => {
      ctl.os = os;
      show();
      expect(AUTH_SLOW_MS).toBe(4_000);
      advance(AUTH_SLOW_MS - 1);
      expect(byId('wsf-home-connecting')).toBeNull();
      expect(byId('wsf-home-loading')!.textContent).toBe('Loading…');
      advance(1);
      const note = byId('wsf-home-connecting')!;
      expect(note.textContent).toBe('Connecting…We’re still reaching We Stay Fit. Check your connection.');
      // Inside the loading state (the wsf-home-loading View, data-state "loading").
      expect(byId('wsf-home-loading')!.contains(note)).toBe(true);
      expect(byId('wsf-home-signed-out')).toBeNull();
    });
  }

  it('it never signs anyone out: a late answer with a user renders the signed-in Home', () => {
    show();
    advance(30_000);
    expect(byId('wsf-home-connecting')).not.toBeNull();
    act(() => ctl.answer!({ uid: 'u1', email: 'member@example.com', displayName: 'Member', emailVerified: true }));
    expect(byId('wsf-home-connecting')).toBeNull();
    expect(byId('wsf-home-loading')).toBeNull();
    expect(byId('wsf-home-signed-in')).not.toBeNull();
  });

  it('a late answer with no user renders the signed-out Home', () => {
    show();
    advance(AUTH_SLOW_MS);
    act(() => ctl.answer!(null));
    expect(byId('wsf-home-connecting')).toBeNull();
    expect(byId('wsf-home-signed-out')).not.toBeNull();
  });

  it('an answer inside the 4 s: no note, and no timer left behind', () => {
    show();
    advance(1_000);
    act(() => ctl.answer!(null));
    expect(vi.getTimerCount()).toBe(0);
    advance(AUTH_SLOW_MS);
    expect(byId('wsf-home-connecting')).toBeNull();
  });

  it('web: no timer and no note, however long it waits', () => {
    ctl.os = 'web';
    show();
    expect(vi.getTimerCount()).toBe(0);
    advance(60_000);
    expect(byId('wsf-home-connecting')).toBeNull();
    expect(byId('wsf-home-loading')!.textContent).toBe('Loading…');
  });

  it('the state itself: slow while unanswered past 4 s, never ready because of it, and cleared by the answer', () => {
    function Probe() {
      const { ready, user, slow } = useWsfAuth();
      return <span data-testid="probe">{`${ready}/${user ? 'user' : 'none'}/${slow}`}</span>;
    }
    act(() =>
      root.render(
        <WsfAuthProvider>
          <Probe />
        </WsfAuthProvider>,
      ),
    );
    const probe = () => byId('probe')!.textContent;
    expect(probe()).toBe('false/none/false');
    advance(AUTH_SLOW_MS);
    expect(probe()).toBe('false/none/true');
    act(() => ctl.answer!({ uid: 'u1' }));
    expect(probe()).toBe('true/user/false');
  });

  it('unmounting before the answer clears the timer', () => {
    show();
    act(() => root.unmount());
    root = createRoot(container);
    expect(vi.getTimerCount()).toBe(0);
  });
});
