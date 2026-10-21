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
 * W14-N (heads-15 review, kiosk hardening) — landAfterAuth with the kiosk
 * marker OPEN or UNREADABLE, on the REAL navigation stack.
 *
 * RV17-641-N2. The marker open and a stack that is READABLE but shows no kiosk
 * start screen ([(tabs), signin], an empty list, or a kiosk only inside a
 * child navigator) took the Home reset: the visitor signed in on member
 * routes, the marker open. Now the landing is that kiosk's start screen,
 * replacing the current route; focused, it signs the visitor out and clears
 * the marker (app/kiosk/[goalId].tsx:95-104).
 *
 * RV17-C16-3. The marker unreadable and Home: replace('/') put member Home
 * over the kiosk, the visitor signed in, even with the kiosk start in the
 * stack and dismissTo given. Now: dismissed to that kiosk (replaced with it
 * when the caller cannot dismiss).
 *
 * Every case asserts the root stack's route names (the real
 * @react-navigation/core container and StackRouter), the signed-in uid and the
 * marker (readKioskSession()), on iOS and Android. Real: the kiosk start
 * screen, hand-off arming, kiosk session and destinations over the NATIVE
 * storage modules and an in-memory AsyncStorage. Sign in is a stand-in that
 * signs the visitor in and lands through landAfterAuth with the deps a case
 * gives it (with routes and dismissTo, as the composed Sign in passes them
 * after W16-19). Firebase is a fake. Self-contained.
 */

const disk = vi.hoisted(() => {
  const map = new Map<string, string>();
  return {
    map,
    api: {
      async getItem(k: string) {
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

/** A marker read that throws, only while a landing runs (RV16-641-N2's case; readKioskSession never throws today). */
const fault = vi.hoisted(() => ({ markerThrows: false }));
vi.mock('../src/kioskSession', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/kioskSession')>();
  return {
    ...real,
    readKioskSession: () => {
      if (fault.markerThrows) throw new Error('marker unreadable');
      return real.readKioskSession();
    },
  };
});

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
    const [path, q] = href.split('?');
    const params = Object.fromEntries(new URLSearchParams(q ?? ''));
    if (path === '/') return ['(tabs)', undefined];
    let m = path!.match(/^\/(kiosk|contribute)\/([^/]+)$/);
    if (m) return [`${m[1]}/[goalId]`, { goalId: decodeURIComponent(m[2]!), ...params }];
    m = path!.match(/^\/join\/([^/]+)$/);
    if (m) return ['join/[joinCode]', { joinCode: decodeURIComponent(m[1]!) }];
    return [path!.slice(1), Object.keys(params).length ? params : undefined];
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
const Inner = createNavigatorFactory(ProbeStack)();

let memberHomeRenders = 0;
function MemberHome() {
  const { user } = useWsfAuth();
  if (user) memberHomeRenders += 1;
  return <div data-testid="member-home">{user ? `member-home:${user.uid}` : 'signed-out-home'}</div>;
}
/** (tabs) with a child stack that holds a kiosk start screen: a kiosk only inside a child navigator. */
function TabsWithNestedKiosk() {
  return (
    <Inner.Navigator>
      <Inner.Screen name="home" component={MemberHome} />
      <Inner.Screen name="kiosk/[goalId]" component={KioskGoal as ComponentType} />
    </Inner.Navigator>
  );
}
const VISITOR: User = { uid: 'visitor-1', email: 'visitor@example.com', emailVerified: true };

/** What the Sign in stand-in lands, and with which deps. */
const landing = vi.hoisted(() => ({
  target: '/join/OakGroveTogether01',
  routes: 'stack' as 'stack' | 'empty' | 'none',
  dismissTo: true,
  markerThrows: false,
}));
function SignInStandIn() {
  const navigation = useNavigation();
  return (
    <button
      data-testid="probe-signin-submit"
      onClick={() => {
        setUser(VISITOR);
        fault.markerThrows = landing.markerThrows;
        try {
          landAfterAuth(landing.target, {
            dispatch: (action) => navigation.dispatch(action as never),
            push: (href) => router.push(href as never),
            replace: (href) => router.replace(href as never),
            platform: Platform.OS,
            ...(landing.routes === 'stack'
              ? { routes: () => (navigation.getState() as NavigationState).routes }
              : landing.routes === 'empty'
                ? { routes: () => [] }
                : {}),
            ...(landing.dismissTo ? { dismissTo: (href: string) => router.dismissTo(href as never) } : {}),
          });
        } finally {
          fault.markerThrows = false;
        }
      }}
    >
      Sign in
    </button>
  );
}
function KioskContributionGate() {
  return (
    <button data-testid="probe-contribute-signin" onClick={() => router.replace('/signin' as never)}>
      Sign in
    </button>
  );
}
const JoinStandIn = () => <div data-testid="probe-join">join</div>;

let container: HTMLDivElement;
let root: Root;
let ref: ReturnType<typeof createNavigationContainerRef>;
let stacks: string[][] = [];
beforeEach(async () => {
  await act(async () => {
    await session.clearKioskSession();
    await session.clearKioskReturnGoal();
  });
  disk.map.clear();
  nav.log = [];
  stacks = [];
  memberHomeRenders = 0;
  authStore.state = { ready: true, user: null };
  Object.assign(landing, { target: '/join/OakGroveTogether01', routes: 'stack', dismissTo: true, markerThrows: false });
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
/** The ROOT stack's focused route (a child navigator's routes carry data-route too). */
const focusedEl = () =>
  Array.from(container.querySelectorAll('[data-route][data-focused="true"]')).find((el) => !el.parentElement?.closest('[data-route]')) as HTMLElement;
async function press(id: string): Promise<void> {
  const el = focusedEl().querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  expect(el, `${id} on the focused screen`).not.toBeNull();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}
const signedIn = () => (authStore.state.user as { uid: string } | null)?.uid ?? null;
function expectState(at: string, want: { stack: string[]; user: string | null; marker: string | null }): void {
  expect([at, 'stack', names()]).toEqual([at, 'stack', want.stack]);
  expect([at, 'signed in', signedIn()]).toEqual([at, 'signed in', want.user]);
  expect([at, 'marker', session.readKioskSession()]).toEqual([at, 'marker', want.marker]);
}

function App({ initial, tabs = MemberHome }: { initial: object[]; tabs?: ComponentType }) {
  return (
    <BaseNavigationContainer
      ref={ref as never}
      initialState={{ index: initial.length - 1, routes: initial } as never}
      onStateChange={(st) => stacks.push(((st as NavigationState | undefined)?.routes ?? []).map((r) => r.name))}
    >
      <Stack.Navigator>
        <Stack.Screen name="(tabs)" component={tabs} />
        <Stack.Screen name="kiosk/[goalId]" component={KioskGoal as ComponentType} />
        <Stack.Screen name="contribute/[goalId]" component={KioskContributionGate} />
        <Stack.Screen name="signin" component={SignInStandIn} />
        <Stack.Screen name="join/[joinCode]" component={JoinStandIn} />
      </Stack.Navigator>
    </BaseNavigationContainer>
  );
}

const KIOSK = 'kiosk/[goalId]';

/** A device whose kiosk marker is open (a kiosk session left open), and Sign in over member (tabs): no kiosk start beneath. */
async function signInWithMarkerOpen(tabs?: ComponentType, initialTabs: object = { name: '(tabs)' }): Promise<void> {
  await act(async () => {
    await session.markKioskSession('goal-1');
  });
  act(() => root.render(<App tabs={tabs} initial={[initialTabs, { name: 'signin' }]} />));
  await flush();
  expectState('before Sign in', { stack: ['(tabs)', 'signin'], user: null, marker: 'goal-1' });
  stacks = [];
  await press('probe-signin-submit');
  await flush();
}

/** The real kiosk flow up to its Sign in: [kiosk, signin], the marker and the kiosk return armed. */
async function atKioskSignIn(): Promise<void> {
  act(() => root.render(<App initial={[{ name: KIOSK, params: { goalId: 'goal-1' } }]} />));
  await flush();
  await press('wsf-kiosk-start');
  await press('probe-contribute-signin');
  expectState('at the kiosk Sign in', { stack: [KIOSK, 'signin'], user: null, marker: 'goal-1' });
  stacks = [];
  nav.log = [];
}

describe.each(['ios', 'android'] as const)('RV17-641-N2 on %s: the marker open, a readable stack with no kiosk start screen', (os) => {
  beforeEach(() => {
    platform.OS = os;
  });

  it('[(tabs), signin]: Sign in lands on that kiosk\'s start screen, which signs the visitor out; never member routes', async () => {
    await signInWithMarkerOpen();
    expectState('after Sign in', { stack: ['(tabs)', KIOSK], user: null, marker: null });
    expect(nav.log).toEqual(['replace /kiosk/goal-1']);
    expect(stacks.some((s) => s.includes('join/[joinCode]'))).toBe(false);
  });

  it('routes() answering []: the same', async () => {
    landing.routes = 'empty';
    await signInWithMarkerOpen();
    expectState('after Sign in', { stack: ['(tabs)', KIOSK], user: null, marker: null });
    expect(nav.log).toEqual(['replace /kiosk/goal-1']);
    expect(stacks.some((s) => s.includes('join/[joinCode]'))).toBe(false);
  });

  it('a kiosk start screen only inside a child navigator of (tabs): the same; the root stack gets its own kiosk start', async () => {
    await signInWithMarkerOpen(TabsWithNestedKiosk, {
      name: '(tabs)',
      state: { index: 1, routes: [{ name: 'home' }, { name: KIOSK, params: { goalId: 'goal-1' } }] },
    });
    expectState('after Sign in', { stack: ['(tabs)', KIOSK], user: null, marker: null });
    expect(nav.log).toEqual(['replace /kiosk/goal-1']);
    expect(stacks.some((s) => s.includes('join/[joinCode]'))).toBe(false);
  });

  it('control, no marker: the same Sign in takes the Home reset and the push, exactly as before', async () => {
    act(() => root.render(<App initial={[{ name: '(tabs)' }, { name: 'signin' }]} />));
    await flush();
    await press('probe-signin-submit');
    await flush();
    expectState('after Sign in', { stack: ['(tabs)', 'join/[joinCode]'], user: 'visitor-1', marker: null });
    expect(nav.log).toEqual(['push /join/OakGroveTogether01']);
  });
});

describe.each(['ios', 'android'] as const)('RV17-C16-3 on %s: the marker unreadable and Home, the kiosk start in the stack', (os) => {
  beforeEach(() => {
    platform.OS = os;
    landing.target = '/';
    landing.markerThrows = true;
  });

  it('with dismissTo: popped back to that kiosk, which signs the visitor out; never member Home over it', async () => {
    await atKioskSignIn();
    await press('probe-signin-submit');
    await flush();
    expectState('after Sign in', { stack: [KIOSK], user: null, marker: null });
    expect(nav.log).toEqual(['dismissTo /kiosk/goal-1']);
    expect(stacks.some((s) => s.includes('(tabs)'))).toBe(false);
    expect(memberHomeRenders).toBe(0);
  });

  it('without dismissTo: that kiosk\'s start screen replaces Sign in, and signs the visitor out', async () => {
    landing.dismissTo = false;
    await atKioskSignIn();
    await press('probe-signin-submit');
    await flush();
    expectState('after Sign in', { stack: [KIOSK, KIOSK], user: null, marker: null });
    expect(nav.log).toEqual(['replace /kiosk/goal-1']);
    expect(stacks.some((s) => s.includes('(tabs)'))).toBe(false);
  });
});
