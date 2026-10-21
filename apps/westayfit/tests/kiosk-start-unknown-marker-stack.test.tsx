import { act, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BaseNavigationContainer,
  StackRouter,
  createNavigationContainerRef,
  createNavigatorFactory,
  useNavigationBuilder,
} from '@react-navigation/core';

/**
 * NATIVE-MEMBER-1 W16-23 (W14-N's composed check, RV17-641-N3). THE KIOSK
 * START SCREEN NEVER OFFERS TO KEEP A POSSIBLY-VISITOR SESSION WHEN THE
 * DEVICE'S KIOSK MARKER IS UNKNOWN.
 *
 * The device holds an open kiosk session ('goal-1' on disk) but the launch
 * read of the marker failed twice, so readKioskSession() answers null and
 * kioskSessionUnknown() is true (W14-N). Member's start screen decision
 * (MF-08, src/kioskSignOutGuard.ts decideKioskStart) took that null for "no
 * kiosk session" and ASKED, so "Stay signed in" could keep a visitor's
 * session on a shared device. An unknown marker is now kiosk evidence: the
 * screen signs whoever it finds out, without asking, as landAfterAuth and the
 * crash fallback fail closed since W14-N. Controls: nobody signed in (nothing
 * to do), and once the marker is known again with no session here, a member
 * opening the kiosk link on their own phone is asked, as MF-08 intends.
 *
 * The real @react-navigation/core container and StackRouter; the real kiosk
 * start screen and kiosk session over the NATIVE storage modules, with
 * AsyncStorage failing every read of the marker key (W14-N's harness,
 * tests/kiosk-marker-unknown-real-stack.test.tsx). Firebase is a fake. Each
 * case asserts the root stack, who is signed in and the marker, on iOS and
 * Android.
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
const fb = vi.hoisted(() => ({ signOutCalls: 0 }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: () => () => {},
  signOut: async () => {
    fb.signOutCalls += 1;
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

const { default: KioskGoal } = await import('../app/kiosk/[goalId]');
const session = await import('../src/kioskSession');
await session.kioskSessionReady();
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

function MemberHome() {
  const { user } = useWsfAuth();
  return <div data-testid="member-home">{user ? `member-home:${user.uid}` : 'signed-out-home'}</div>;
}
const VISITOR: User = { uid: 'visitor-1', email: 'visitor@example.com', emailVerified: true };
const OWNER: User = { uid: 'owner-1', email: 'owner@example.com', emailVerified: true };

let container: HTMLDivElement;
let root: Root;
let ref: ReturnType<typeof createNavigationContainerRef>;
beforeEach(() => {
  nav.log = [];
  fb.signOutCalls = 0;
  authStore.state = { ready: true, user: null };
  disk.map.set(MARKER_KEY, 'goal-1');
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
const signedIn = () => (authStore.state.user as { uid: string } | null)?.uid ?? null;
const asks = () => focusedEl().querySelector('[data-testid="wsf-kiosk-confirm-signout"]') !== null || (focusedEl().textContent ?? '').includes('Stay signed in');
function expectState(at: string, want: { stack: string[]; user: string | null; marker: string | null; unknown: boolean }): void {
  expect([at, 'stack', names()]).toEqual([at, 'stack', want.stack]);
  expect([at, 'signed in', signedIn()]).toEqual([at, 'signed in', want.user]);
  expect([at, 'marker', session.readKioskSession()]).toEqual([at, 'marker', want.marker]);
  expect([at, 'marker unknown', session.kioskSessionUnknown()]).toEqual([at, 'marker unknown', want.unknown]);
}

function App({ initial }: { initial: object[] }) {
  return (
    <BaseNavigationContainer ref={ref as never} initialState={{ index: initial.length - 1, routes: initial } as never}>
      <Stack.Navigator>
        <Stack.Screen name="(tabs)" component={MemberHome} />
        <Stack.Screen name="kiosk/[goalId]" component={KioskGoal as ComponentType} />
      </Stack.Navigator>
    </BaseNavigationContainer>
  );
}
const KIOSK = 'kiosk/[goalId]';
const KIOSK_G1 = { name: KIOSK, params: { goalId: 'goal-1' } };

describe.each(['ios', 'android'] as const)('W16-23 on %s: the kiosk start screen with the marker UNKNOWN', (os) => {
  beforeEach(() => {
    platform.OS = os;
  });

  it('the precondition: the disk holds an open kiosk session; the marker reads null and is unknown', () => {
    expect(disk.map.get(MARKER_KEY)).toBe('goal-1');
    expect(session.readKioskSession()).toBeNull();
    expect(session.kioskSessionUnknown()).toBe(true);
  });

  it('a visitor left signed in, the device at rest on the kiosk start screen: signed out without asking; never "Stay signed in"', async () => {
    setUser(VISITOR);
    act(() => root.render(<App initial={[KIOSK_G1]} />));
    await flush();
    expect(asks(), 'never offers to stay signed in').toBe(false);
    expect(fb.signOutCalls).toBe(1);
    expectState('at rest on the kiosk start', { stack: [KIOSK], user: null, marker: null, unknown: true });
    // Once nobody is signed in the kiosk session ends (app/kiosk/[goalId].tsx): its disk copy is removed.
    expect(disk.map.has(MARKER_KEY)).toBe(false);
    expect(nav.log).toEqual([]);
  });

  it('the start screen over member Home (a kiosk link on a phone): signed out without asking, the stack unchanged', async () => {
    setUser(OWNER);
    act(() => root.render(<App initial={[{ name: '(tabs)' }, KIOSK_G1]} />));
    await flush();
    expect(asks(), 'never offers to stay signed in').toBe(false);
    expect(fb.signOutCalls).toBe(1);
    expectState('over member Home', { stack: ['(tabs)', KIOSK], user: null, marker: null, unknown: true });
  });

  it('control: nobody signed in: nothing is asked and nothing is signed out', async () => {
    act(() => root.render(<App initial={[KIOSK_G1]} />));
    await flush();
    expect(asks()).toBe(false);
    expect(fb.signOutCalls).toBe(0);
    expectState('nobody signed in', { stack: [KIOSK], user: null, marker: null, unknown: true });
  });
});

// Last: these make the marker known again (an explicit write), for the rest of this file.
describe.each(['ios', 'android'] as const)('W16-23 on %s, control: once the marker is KNOWN again', (os) => {
  beforeEach(async () => {
    platform.OS = os;
    await act(async () => {
      await session.markKioskSession('goal-2');
      await session.clearKioskSession();
    });
  });

  it('with no kiosk session here, a member opening the kiosk link over Home is ASKED (MF-08), not signed out', async () => {
    expect(session.kioskSessionUnknown()).toBe(false);
    setUser(OWNER);
    act(() => root.render(<App initial={[{ name: '(tabs)' }, KIOSK_G1]} />));
    await flush();
    expect(asks(), 'asks first').toBe(true);
    expect(fb.signOutCalls).toBe(0);
    expectState('asked', { stack: ['(tabs)', KIOSK], user: OWNER.uid, marker: null, unknown: false });
  });
});
