import { act, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BaseNavigationContainer,
  StackRouter,
  createNavigationContainerRef,
  createNavigatorFactory,
  useNavigationBuilder,
  type NavigationState,
} from '@react-navigation/core';

/**
 * W14-N, RV17-641-N3 — THE STORAGE LAYER'S UNKNOWN MARKER, ON THE REAL STACK.
 *
 * The device holds an open kiosk session ('goal-1' on disk), but the launch
 * read of the marker failed twice, so the mirror marks it unreadable
 * (src/storage/mirror.ts) and readKioskSession() answers null WITHOUT
 * throwing. Before, that null counted as "no kiosk session": a Sign in that
 * passes no routes took the Home reset, Home landed member (tabs) over the
 * kiosk, and the crash fallback offered Go to Home. Now kioskSessionUnknown()
 * says so, and landAfterAuth and the fallback treat the marker as unreadable.
 *
 * Every case asserts the root stack's route names (the real
 * @react-navigation/core container and StackRouter), the signed-in uid, and
 * the marker as it really is (heads-16 K1): the DISK key and the unknown
 * state, never readKioskSession() alone, which is null by construction. On
 * iOS and Android. Real: the kiosk start screen, the kiosk session over the
 * NATIVE storage modules (AsyncStorage failing every read of the marker
 * key), landAfterAuth, and the crash fallback (RouteErrorFallback.native) as
 * a route. Firebase is a fake. Self-contained, and no case depends on
 * another's order: each starts from the open session on disk and the marker
 * unknown, and the one case that writes the marker does so on a module
 * instance of its own.
 */

const MARKER_KEY = 'wsf.kioskSessionGoalId';
const disk = vi.hoisted(() => {
  const map = new Map<string, string>([['wsf.kioskSessionGoalId', 'goal-1']]);
  return {
    map,
    api: {
      async getItem(k: string) {
        if (k === 'wsf.kioskSessionGoalId') throw new Error('storage unavailable');
        return map.has(k) ? (map.get(k) as string) : null;
      },
      async setItem(k: string, v: string) {
        map.set(k, v);
      },
      async removeItem(k: string) {
        map.delete(k);
      },
      async getAllKeys() {
        return [...map.keys()];
      },
      async multiRemove(keys: string[]) {
        for (const k of keys) map.delete(k);
      },
    },
  };
});
vi.mock('@react-native-async-storage/async-storage', () => ({ default: disk.api }));
vi.mock('../src/storage/kv', async () => await import('../src/storage/kv.native'));
vi.mock('../src/storage/sessionKv', async () => await import('../src/storage/sessionKv.native'));
vi.mock('../src/storage/syncRead', async () => await import('../src/storage/syncRead.native'));

const platform = vi.hoisted(() => ({ OS: 'ios' as string }));
vi.mock('react-native', async (importOriginal) => {
  const rn = await importOriginal<typeof import('react-native')>();
  const P = new Proxy(rn.Platform as object, {
    get: (t, k) => (k === 'OS' ? platform.OS : (t as Record<string | symbol, unknown>)[k]),
  });
  return { ...rn, Platform: P };
});
vi.mock('react-native-safe-area-context', async () => {
  const { createContext, Fragment, createElement } = await import('react');
  return {
    SafeAreaInsetsContext: createContext(null),
    initialWindowMetrics: { insets: { top: 0, bottom: 0, left: 0, right: 0 }, frame: { x: 0, y: 0, width: 390, height: 844 } },
    SafeAreaProvider: ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
vi.mock('../src/ui/useScreenTopInset', () => ({ useScreenTopInset: () => 0, ScreenTopSpacer: () => null, ScreenStatusBar: () => null }));
vi.mock('../src/ui/useReducedMotion', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useReducedMotion: () => true,
  useReducedMotionPreference: () => ({ reduced: true, known: true, failed: false }),
}));
vi.mock('../src/ui/WsfWordmark', () => ({ WsfWordmark: () => null }));

type User = { uid: string; email: string; emailVerified: boolean };
const authStore = vi.hoisted(() => ({
  state: { ready: true, user: null as null | { uid: string; emailVerified: boolean } },
  listeners: new Set<() => void>(),
}));
function setUser(user: User | null): void {
  authStore.state = { ready: true, user };
  for (const l of [...authStore.listeners]) l();
}
vi.mock('../src/auth', () => ({
  useWsfAuth: () =>
    useSyncExternalStore(
      (l: () => void) => {
        authStore.listeners.add(l);
        return () => authStore.listeners.delete(l);
      },
      () => authStore.state,
    ),
}));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: () => () => {},
  signOut: async () => {
    setUser(null);
  },
}));
vi.mock('firebase/functions', () => ({ httpsCallable: () => async () => ({ data: {} }) }));
vi.mock('../src/firebase', () => ({
  getFirebaseAuth: () => ({
    get currentUser() {
      return authStore.state.user;
    },
  }),
  getFirebaseFirestore: () => ({}),
  getFirebaseFunctions: () => ({}),
  wsfUsingEmulators: false,
  wsfIsStaging: false,
}));
vi.mock('../src/featureFlags', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), wsfAuthEnabled: true }));

const nav = vi.hoisted(() => ({ ref: null as unknown as { dispatch: (a: unknown) => void }, log: [] as string[] }));
vi.mock('expo-router', async () => {
  const core = await import('@react-navigation/core');
  function routeOf(href: string): [string, Record<string, string> | undefined] {
    const [path] = href.split('?');
    if (path === '/') return ['(tabs)', undefined];
    let m = path!.match(/^\/kiosk\/([^/]+)$/);
    if (m) return ['kiosk/[goalId]', { goalId: decodeURIComponent(m[1]!) }];
    m = path!.match(/^\/join\/([^/]+)$/);
    if (m) return ['join/[joinCode]', { joinCode: decodeURIComponent(m[1]!) }];
    return [path!.slice(1), undefined];
  }
  const router = {
    push: (href: string) => {
      nav.log.push(`push ${href}`);
      nav.ref.dispatch(core.StackActions.push(...routeOf(href)));
    },
    replace: (href: string) => {
      nav.log.push(`replace ${href}`);
      nav.ref.dispatch(core.StackActions.replace(...routeOf(href)));
    },
    dismissTo: (href: string) => {
      nav.log.push(`dismissTo ${href}`);
      nav.ref.dispatch(core.StackActions.popTo(...routeOf(href)));
    },
    navigate: (href: string) => {
      nav.log.push(`navigate ${href}`);
      nav.ref.dispatch(core.CommonActions.navigate(...routeOf(href)));
    },
    back: () => (nav.ref as unknown as { goBack: () => void }).goBack(),
    canGoBack: () => (nav.ref as unknown as { canGoBack: () => boolean }).canGoBack(),
  };
  return {
    router,
    useRouter: () => router,
    useNavigation: () => core.useNavigation(),
    useFocusEffect: core.useFocusEffect,
    useLocalSearchParams: () => core.useRoute().params ?? {},
    usePathname: () => '/',
    Link: ({ children }: { children: ReactNode }) => children,
  };
});

const { router, useNavigation } = await import('expo-router');
const { Platform } = await import('react-native');
const session = await import('../src/kioskSession');
await session.kioskSessionReady();
const { landAfterAuth } = await import('../src/ui/authLanding');
const { RouteErrorFallback } = await import('../src/ui/RouteErrorFallback.native');
const { default: KioskGoal } = await import('../app/kiosk/[goalId]');
const { useWsfAuth } = await import('../src/auth');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function ProbeStack(props: { children: ReactNode }) {
  const { state, descriptors, NavigationContent } = useNavigationBuilder(StackRouter, props as never);
  return (
    <NavigationContent>
      {state.routes.map((r, i) => (
        <div key={r.key} data-route={r.name} data-focused={String(i === state.index)}>
          {descriptors[r.key]!.render()}
        </div>
      ))}
    </NavigationContent>
  );
}
const Stack = createNavigatorFactory(ProbeStack)();

let memberHomeRenders = 0;
function MemberHome() {
  const { user } = useWsfAuth();
  if (user) memberHomeRenders += 1;
  return <div data-testid="member-home">{user ? `member-home:${user.uid}` : 'signed-out-home'}</div>;
}
const VISITOR: User = { uid: 'visitor-1', email: 'visitor@example.com', emailVerified: true };
const landing = vi.hoisted(() => ({ target: '/join/OakGroveTogether01', withRoutes: false }));
/** Sign in: signs the visitor in, then lands through landAfterAuth (with or without routes and dismissTo). */
function SignInStandIn() {
  const navigation = useNavigation();
  return (
    <button
      data-testid="probe-signin-submit"
      onClick={() => {
        setUser(VISITOR);
        landAfterAuth(landing.target, {
          dispatch: (action) => navigation.dispatch(action as never),
          push: (href) => router.push(href as never),
          replace: (href) => router.replace(href as never),
          platform: Platform.OS,
          ...(landing.withRoutes
            ? {
                routes: () => (navigation.getState() as NavigationState).routes,
                dismissTo: (href: string) => router.dismissTo(href as never),
              }
            : {}),
        });
      }}
    >
      Sign in
    </button>
  );
}
const JoinStandIn = () => <div data-testid="probe-join">join</div>;
/** A screen on the root stack that threw: its contained fallback, as expo-router renders it. */
let retries = 0;
const BrokenScreen = () => <RouteErrorFallback error={new Error('threw')} retry={() => void (retries += 1)} variant="screen" />;

let container: HTMLDivElement;
let root: Root;
let ref: ReturnType<typeof createNavigationContainerRef>;
let stacks: string[][] = [];
beforeEach(() => {
  // Each case starts from the same device: the open session on disk, the marker unknown, nothing read.
  disk.map.set(MARKER_KEY, 'goal-1');
  expect(session.kioskSessionUnknown()).toBe(true);
  expect(() => session.readKioskSession()).not.toThrow();
  expect(session.readKioskSession()).toBeNull();
  nav.log = [];
  stacks = [];
  memberHomeRenders = 0;
  retries = 0;
  authStore.state = { ready: true, user: null };
  Object.assign(landing, { target: '/join/OakGroveTogether01', withRoutes: false });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  ref = createNavigationContainerRef();
  nav.ref = ref as never;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  platform.OS = 'ios';
});
const flush = () =>
  act(async () => {
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
  });
const names = () => (ref.getRootState()?.routes ?? []).map((r) => r.name);
const focusedEl = () => container.querySelector('[data-route][data-focused="true"]') as HTMLElement;
async function press(id: string): Promise<void> {
  const el = focusedEl().querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  expect(el, `${id} on the focused screen`).not.toBeNull();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}
const signedIn = () => (authStore.state.user as { uid: string } | null)?.uid ?? null;
/**
 * Stack, signed-in state, and the marker as it really is (K1): its DISK key
 * ('goal-1' while the session is open on the device; null once the kiosk
 * start screen at rest has cleared it) and the unknown state, which stays
 * true for the process (K2: a removal does not clear it; only a write
 * does). readKioskSession() is null throughout, by construction.
 */
function expectState(at: string, want: { stack: string[]; user: string | null; disk: string | null }): void {
  expect([at, 'stack', names()]).toEqual([at, 'stack', want.stack]);
  expect([at, 'signed in', signedIn()]).toEqual([at, 'signed in', want.user]);
  expect([at, 'marker on disk', disk.map.get(MARKER_KEY) ?? null]).toEqual([at, 'marker on disk', want.disk]);
  expect([at, 'marker unknown', session.kioskSessionUnknown()]).toEqual([at, 'marker unknown', true]);
  expect([at, 'marker read', session.readKioskSession()]).toEqual([at, 'marker read', null]);
}

function App({ initial }: { initial: object[] }) {
  return (
    <BaseNavigationContainer
      ref={ref as never}
      initialState={{ index: initial.length - 1, routes: initial } as never}
      onStateChange={(st) => stacks.push(((st as NavigationState | undefined)?.routes ?? []).map((r) => r.name))}
    >
      <Stack.Navigator>
        <Stack.Screen name="(tabs)" component={MemberHome} />
        <Stack.Screen name="kiosk/[goalId]" component={KioskGoal as ComponentType} />
        <Stack.Screen name="signin" component={SignInStandIn} />
        <Stack.Screen name="join/[joinCode]" component={JoinStandIn} />
        <Stack.Screen name="broken" component={BrokenScreen} />
      </Stack.Navigator>
    </BaseNavigationContainer>
  );
}
const KIOSK = 'kiosk/[goalId]';
const KIOSK_G1 = { name: KIOSK, params: { goalId: 'goal-1' } };

/**
 * The kiosk start screen, focused, at rest: THAT SCREEN'S OWN DECISION. On
 * integrator-2 it signs whoever it finds out (app/kiosk/[goalId].tsx). On
 * member-1 (MF-08) it signs out on kiosk evidence and otherwise asks
 * (src/kioskSignOutGuard.ts decideKioskStart); since member W16-23 an
 * UNKNOWN marker is kiosk evidence there, so it signs out too. On both
 * lanes, then: signed out, never "Stay signed in", at the kiosk start
 * screen, never on member Home; and the disk record of the session cleared
 * by the start screen once nobody is signed in.
 */
function expectAtKioskStart(at: string, stack: string[] = [KIOSK]): void {
  expect(focusedEl().getAttribute('data-route')).toBe(KIOSK);
  expect(focusedEl().textContent ?? '', 'never offers to stay signed in').not.toContain('Stay signed in');
  expectState(at, { stack, user: null, disk: null });
  expect(memberHomeRenders).toBe(0);
}

describe('the precondition, on every case', () => {
  it('the disk holds an open kiosk session, the marker is unknown, and readKioskSession() answers null without throwing', () => {
    expect(disk.map.get(MARKER_KEY)).toBe('goal-1');
    expect(session.kioskSessionUnknown()).toBe(true);
    expect(() => session.readKioskSession()).not.toThrow();
    expect(session.readKioskSession()).toBeNull();
  });
});

describe.each(['ios', 'android'] as const)('RV17-641-N3 on %s: the marker unknown', (os) => {
  beforeEach(() => {
    platform.OS = os;
  });

  it('a Sign in that passes no routes, with the kiosk beneath: the join is replaced, never the Home reset, the visitor signed in with the session still on disk; Back reaches the kiosk start screen, which signs out and clears the disk record', async () => {
    act(() => root.render(<App initial={[KIOSK_G1, { name: 'signin' }]} />));
    await flush();
    await press('probe-signin-submit');
    await flush();
    expectState('after Sign in', { stack: [KIOSK, 'join/[joinCode]'], user: 'visitor-1', disk: 'goal-1' });
    expect(nav.log).toEqual(['replace /join/OakGroveTogether01']);
    expect(stacks.every((s) => s.includes(KIOSK))).toBe(true);
    act(() => (ref as unknown as { goBack: () => void }).goBack());
    await flush();
    expectAtKioskStart('after Back');
  });

  it('Home, with routes and dismissTo and the kiosk in the stack (RV17-C16-3): popped back to that kiosk start screen, signed out, the disk record cleared', async () => {
    landing.target = '/';
    landing.withRoutes = true;
    act(() => root.render(<App initial={[KIOSK_G1, { name: 'signin' }]} />));
    await flush();
    await press('probe-signin-submit');
    await flush();
    expect(nav.log).toEqual(['dismissTo /kiosk/goal-1']);
    expect(stacks.some((s) => s.includes('(tabs)'))).toBe(false);
    expectAtKioskStart('after Sign in');
  });

  it('a screen that throws, with no kiosk return: no way Home is offered (Try again only); the visitor stays where they are, signed in, never on member Home; Back, Back reaches the kiosk start screen, which signs out', async () => {
    setUser(VISITOR);
    act(() => root.render(<App initial={[KIOSK_G1, { name: 'signin' }, { name: 'broken' }]} />));
    await flush();
    expect(session.readKioskReturnGoal(null)).toBeNull();
    // The visitor reaches for a way out: whatever the fallback offers besides Try again.
    const wayOut = focusedEl().querySelector('[data-testid="wsf-route-error-home"]') as HTMLElement | null;
    if (wayOut) {
      await act(async () => {
        wayOut.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await flush();
    }
    expectState('after reaching for a way out', { stack: [KIOSK, 'signin', 'broken'], user: 'visitor-1', disk: 'goal-1' });
    expect(memberHomeRenders).toBe(0);
    // Try again is still there, and retries.
    await press('wsf-route-error-retry');
    expect(retries).toBe(1);
    expectState('after Try again', { stack: [KIOSK, 'signin', 'broken'], user: 'visitor-1', disk: 'goal-1' });
    // Back, the platform's own way down the stack, still reaches the kiosk, which signs out.
    act(() => (ref as unknown as { goBack: () => void }).goBack());
    await flush();
    act(() => (ref as unknown as { goBack: () => void }).goBack());
    await flush();
    expectAtKioskStart('after Back, Back');
  });
});

describe('kioskSessionUnknown() (RV17-641-N3)', () => {
  it('is true while the launch read of the marker has failed', () => {
    expect(session.kioskSessionUnknown()).toBe(true);
    expect(session.readKioskSession()).toBeNull();
  });

  it('an explicit write (a new kiosk session) makes the marker known again: on a module instance of its own, so the shared one stays unknown for the other cases', async () => {
    vi.resetModules();
    const fresh = await import('../src/kioskSession');
    await fresh.kioskSessionReady();
    expect(fresh.kioskSessionUnknown()).toBe(true);
    expect(fresh.readKioskSession()).toBeNull();
    await act(async () => {
      await fresh.markKioskSession('goal-2');
    });
    expect(fresh.kioskSessionUnknown()).toBe(false);
    expect(fresh.readKioskSession()).toBe('goal-2');
    expect(disk.map.get(MARKER_KEY)).toBe('goal-2');
    // The shared instance never saw a write: still unknown.
    expect(session.kioskSessionUnknown()).toBe(true);
    expect(session.readKioskSession()).toBeNull();
  });
});
