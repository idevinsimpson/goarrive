import { act, useSyncExternalStore, type ComponentType, type ReactElement, type ReactNode } from 'react';
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
 * W14-O (owner decision, #365 6326225448), THE UNKNOWN-MARKER VARIANT of
 * tests/kiosk-flow-exit-real-stack (read that file's header first). The
 * device holds an open kiosk session ('goal-1' on disk), but the launch read
 * of the marker failed twice, so the storage layer marks it unreadable
 * (src/storage/mirror.ts): readKioskSession() answers null WITHOUT throwing
 * and kioskSessionUnknown() is true (RV17-641-N3). The guard fails closed:
 * an unknown marker counts as a possibly open session, and the nearest
 * kiosk start screen the stack shows is where a signed-in visitor on a
 * member screen is sent (there is no goal to name otherwise). The start
 * screen signs out on this lane (whoever it finds) and on member-1 since
 * W16-23 (an unknown marker is kiosk evidence there): asserted, never an
 * offer to stay signed in. The marker is asserted as the DISK KEY plus
 * kioskSessionUnknown(), never as readKioskSession() alone, which is null
 * by construction here (heads-16 K1).
 *
 * The one starting state this needs, a kiosk start screen beneath a Sign in
 * while the marker is unknown, cannot be reached in-process (the kiosk's
 * Contribute writes the marker, which makes it known: heads-16 K1), so the
 * stack is mounted as such; no case presses Contribute, so the marker stays
 * unknown for the whole file and no case depends on another's order.
 *
 * Same harness as the open-marker suite: the real container and StackRouter
 * nested as expo-router nests them, the real kiosk start, join, event and
 * /go screens, the native storage modules (AsyncStorage rejecting every read
 * of the marker key), landAfterAuth, and the guard imported conditionally
 * for the fail-first proof. iOS and Android.
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

type User = { uid: string; email: string; emailVerified: boolean; getIdToken: (force?: boolean) => Promise<string> };
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
  signInWithEmailAndPassword: () => Promise.reject(new Error('unused')),
  createUserWithEmailAndPassword: () => Promise.reject(new Error('unused')),
  updateProfile: () => Promise.resolve(),
  onAuthStateChanged: () => () => {},
  reload: async () => undefined,
  signOut: async () => {
    fb.signOutCalls += 1;
    setUser(null);
  },
}));
vi.mock('firebase/firestore', () => ({ doc: () => ({}), getDoc: async () => ({ exists: () => true, data: () => ({}) }) }));
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
const MARKER = {
  markerSlug: 'oak-hall-01',
  label: 'Oak Hall',
  communityName: 'Oak Grove',
  goalId: 'goal-1',
  goalTitle: '500 squats together',
  goalState: 'open',
  kioskMode: 'available',
  viewer: 'nonMember',
  communityGroupId: null,
};
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => async () => {
    switch (name) {
      case 'wsfGoalPulse':
        return { data: PULSE };
      case 'wsfMyContribution':
        return { data: { ownCredit: 0, unit: 'squats', repeatPolicy: 'multiple' } };
      case 'wsfJoinCommunity':
        return { data: { groupId: 'oak', alreadyMember: false } };
      case 'wsfPreviewCommunity':
        return { data: { displayName: 'Oak Grove Together', groupType: 'familyFriends', joinPolicy: 'code' } };
      case 'wsfListGoals':
        return { data: { goals: [] } };
      case 'wsfMyCommunities':
        return { data: { items: [] } };
      case 'wsfEventContext':
        return { data: { activities: [] } };
      case 'wsfResolveMarker':
        return { data: MARKER };
      default:
        return { data: {} };
    }
  },
}));
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
vi.mock('../src/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  wsfAuthEnabled: true,
}));

const nav = vi.hoisted(() => ({ ref: null as unknown as { dispatch: (a: unknown) => void }, log: [] as string[] }));
vi.mock('expo-router', async () => {
  const core = await import('@react-navigation/core');
  const { cloneElement, isValidElement } = await import('react');
  function routeOf(href: string): [string, Record<string, string> | undefined] {
    const [path, q] = href.split('?');
    const params = Object.fromEntries(new URLSearchParams(q ?? ''));
    if (path === '/') return ['(tabs)', undefined];
    let m = path!.match(/^\/(kiosk|contribute|event)\/([^/]+)$/);
    if (m) return [`${m[1]}/[goalId]`, { goalId: decodeURIComponent(m[2]!), ...params }];
    m = path!.match(/^\/join\/([^/]+)$/);
    if (m) return ['join/[joinCode]', { joinCode: decodeURIComponent(m[1]!), ...params }];
    m = path!.match(/^\/go\/([^/]+)$/);
    if (m) return ['go/[markerSlug]', { markerSlug: decodeURIComponent(m[1]!), ...params }];
    m = path!.match(/^\/community\/([^/]+)$/);
    if (m) return ['(tabs)', { community: decodeURIComponent(m[1]!) }];
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
    dismissAll: () => {},
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
    Link: ({ href, replace, children }: { href: string; replace?: boolean; children: ReactNode }) =>
      isValidElement(children)
        ? cloneElement(children as ReactElement<{ onPress?: (e: unknown) => void }>, {
            onPress: (e: unknown) => {
              (children as ReactElement<{ onPress?: (e: unknown) => void }>).props.onPress?.(e);
              if (replace) router.replace(href);
              else router.navigate(href);
            },
          })
        : children,
  };
});

const { router, useNavigation } = await import('expo-router');
const { Platform } = await import('react-native');
const session = await import('../src/kioskSession');
await session.kioskSessionReady();
const { postAuthDestinationsReady } = await import('../src/postAuthDestination');
await postAuthDestinationsReady();
const { routeAfterAuth, clearPendingJoinCode } = await import('../src/pendingJoinCode');
const { setEventReturn, clearEventReturn } = await import('../src/eventReturn');
const { setMarkerReturn, clearMarkerReturn } = await import('../src/markerEntry');
const { landAfterAuth } = await import('../src/ui/authLanding');
const { default: KioskGoal } = await import('../app/kiosk/[goalId]');
const { default: JoinPage } = await import('../app/join/[joinCode]');
const { default: ContributeToGoal } = await import('../app/contribute/[goalId]');
const { default: EventPage } = await import('../app/event/[goalId]');
const { default: MarkerEntryRoute } = await import('../app/go/[markerSlug]');
const { clearDeviceMode } = await import('../src/deviceMode');
const { useWsfAuth } = await import('../src/auth');
/** The guard under test, imported conditionally for the fail-first proof (see the open-marker suite). */
const guardModule: { KioskFlowExitGuard: ComponentType } | null = await import('../src/kioskFlowExit').then(
  (m) => m,
  () => null,
);
const KioskFlowExitGuard: ComponentType = guardModule?.KioskFlowExitGuard ?? (() => null);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function ProbeStack(props: { initialRouteName?: string; children: ReactNode }) {
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
const RootStack = createNavigatorFactory(ProbeStack)();
const AppStack = createNavigatorFactory(ProbeStack)();

let memberHomeRenders = 0;
function MemberHome() {
  const { user } = useWsfAuth();
  if (user) memberHomeRenders += 1;
  return <div data-testid="member-home">{user ? `member-home:${user.uid}` : 'signed-out-home'}</div>;
}
const landedRenders = { join: 0, event: 0, go: 0 };
function JoinRoute() {
  landedRenders.join += 1;
  return <JoinPage />;
}
function EventRoute() {
  landedRenders.event += 1;
  return <EventPage />;
}
function GoRoute() {
  landedRenders.go += 1;
  return <MarkerEntryRoute />;
}
function KioskContribution() {
  const { user } = useWsfAuth();
  if (user) return <ContributeToGoal />;
  return (
    <button data-testid="probe-contribute-signin" onClick={() => router.replace('/signin' as never)}>
      Sign in
    </button>
  );
}
const VISITOR: User = { uid: 'visitor-1', email: 'visitor@example.com', emailVerified: true, getIdToken: async () => 'token' };
const signInDeps = { withRoutes: true };
function MemberSignIn() {
  const navigation = useNavigation();
  return (
    <button
      data-testid="probe-member-signin-submit"
      onClick={async () => {
        setUser(VISITOR);
        const next = await routeAfterAuth('/', VISITOR.uid);
        landAfterAuth(next, {
          dispatch: (action) => navigation.dispatch(action as never),
          push: (href) => router.push(href as never),
          replace: (href) => router.replace(href as never),
          platform: Platform.OS,
          ...(signInDeps.withRoutes
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

let container: HTMLDivElement;
let root: Root;
let ref: ReturnType<typeof createNavigationContainerRef>;
let stacks: string[][] = [];
beforeEach(async () => {
  await act(async () => {
    await session.clearKioskReturnGoal();
    await clearPendingJoinCode();
    await clearEventReturn();
    await clearMarkerReturn();
    await clearDeviceMode();
  });
  // Order independence: the disk holds the open session again, and the marker is still unknown.
  disk.map.set(MARKER_KEY, 'goal-1');
  expect(session.kioskSessionUnknown()).toBe(true);
  expect(session.readKioskSession()).toBeNull();
  nav.log = [];
  stacks = [];
  memberHomeRenders = 0;
  landedRenders.join = landedRenders.event = landedRenders.go = 0;
  fb.signOutCalls = 0;
  signInDeps.withRoutes = true;
  authStore.state = { ready: true, user: null };
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
  vi.useRealTimers();
});
const flush = () =>
  act(async () => {
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
  });
type AnyState = { index?: number; routes?: ReadonlyArray<{ key?: string; name: string; params?: object; state?: AnyState }> } | undefined;
const appState = (): AnyState => (ref.getRootState() as AnyState)?.routes?.[0]?.state;
const appNames = (st: AnyState): string[] => (st?.routes?.[0]?.state?.routes ?? []).map((r) => r.name);
const names = () => (appState()?.routes ?? []).map((r) => r.name);
const focusedRoute = () => {
  const s = appState();
  return s?.routes ? s.routes[s.index ?? s.routes.length - 1]!.name : null;
};
const focusedEl = () => container.querySelector('[data-route]:not([data-route="__root"])[data-focused="true"]') as HTMLElement;
const has = (id: string) => focusedEl().querySelector(`[data-testid="${id}"]`) !== null;
async function press(id: string): Promise<void> {
  const el = focusedEl().querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  expect(el, `${id} on the focused screen`).not.toBeNull();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}
async function back(): Promise<void> {
  act(() => (ref as unknown as { goBack: () => void }).goBack());
  await flush();
}
const signedIn = () => (authStore.state.user as { uid: string } | null)?.uid ?? null;
const KIOSK = 'kiosk/[goalId]';
const kioskKey = () => appState()?.routes?.find((r) => r.name === KIOSK)?.key ?? null;

/**
 * Stack, signed-in state, and the marker as it really is: the DISK key (the
 * session on the device) and the unknown state (K2: never cleared by a
 * removal, only by a write); readKioskSession() is null throughout, by
 * construction, and asserted as such.
 */
function expectState(at: string, want: { stack: string[]; user: string | null; disk: string | null }): void {
  expect([at, 'stack', names()]).toEqual([at, 'stack', want.stack]);
  expect([at, 'signed in', signedIn()]).toEqual([at, 'signed in', want.user]);
  expect([at, 'marker on disk', disk.map.get(MARKER_KEY) ?? null]).toEqual([at, 'marker on disk', want.disk]);
  expect([at, 'marker unknown', session.kioskSessionUnknown()]).toEqual([at, 'marker unknown', true]);
  expect([at, 'marker read', session.readKioskSession()]).toEqual([at, 'marker read', null]);
}
/** After the guard: the kiosk start screen alone, signed out, the disk record cleared by the start screen at rest, never an offer to stay signed in. */
function expectAtKioskStart(at: string): void {
  expectState(at, { stack: [KIOSK], user: null, disk: null });
  expect(focusedRoute()).toBe(KIOSK);
  expect(has('wsf-kiosk-start'), `${at}: the kiosk start screen (Contribute here) in front`).toBe(true);
  expect((focusedEl().textContent ?? '').includes('Stay signed in'), `${at}: never an offer to stay signed in`).toBe(false);
  expect(fb.signOutCalls, `${at}: signed out by the start screen`).toBeGreaterThanOrEqual(1);
}

function RootSlot() {
  return (
    <>
      <KioskFlowExitGuard />
      <AppStack.Navigator>
        <AppStack.Screen name="(tabs)" component={MemberHome} />
        <AppStack.Screen name="kiosk/[goalId]" component={KioskGoal as ComponentType} />
        <AppStack.Screen name="contribute/[goalId]" component={KioskContribution} />
        <AppStack.Screen name="signin" component={MemberSignIn} />
        <AppStack.Screen name="join/[joinCode]" component={JoinRoute} />
        <AppStack.Screen name="event/[goalId]" component={EventRoute} />
        <AppStack.Screen name="go/[markerSlug]" component={GoRoute} />
      </AppStack.Navigator>
    </>
  );
}
function App({ initial }: { initial: { name: string; params?: object }[] }) {
  return (
    <BaseNavigationContainer
      ref={ref as never}
      initialState={{ index: 0, routes: [{ name: '__root', state: { index: initial.length - 1, routes: initial } }] } as never}
      onStateChange={(st) => stacks.push(appNames(st as AnyState))}
    >
      <RootStack.Navigator>
        <RootStack.Screen name="__root" component={RootSlot} />
      </RootStack.Navigator>
    </BaseNavigationContainer>
  );
}

const CODE = 'OakGroveTogether01';
const KIOSK_G1 = { name: KIOSK, params: { goalId: 'goal-1' } };
type Case = 'join' | 'event' | 'go';
const LANDING_ACTION: Record<Case, string> = {
  join: `replace /join/${CODE}`,
  event: 'replace /event/goal-ev',
  go: 'replace /go/oak-hall-01',
};
const HOME_LINK: Record<Case, string> = { join: 'Not now — back to home', event: 'Back to home', go: 'Not now — back to home' };
function homeLink(kind: Case): HTMLElement | undefined {
  return Array.from(focusedEl().querySelectorAll('[role="link"], a')).find((el) => el.textContent === HOME_LINK[kind]) as HTMLElement | undefined;
}

/** The kiosk start screen beneath the kiosk's Sign in, the marker unknown: mounted as such (see the header). */
async function atKioskSignIn(): Promise<void> {
  act(() => root.render(<App initial={[KIOSK_G1, { name: 'signin' }]} />));
  await flush();
  expectState('at the kiosk Sign in', { stack: [KIOSK, 'signin'], user: null, disk: 'goal-1' });
}
async function armReturn(kind: Case): Promise<void> {
  if (kind === 'join') {
    act(() => router.push(`/join/${CODE}` as never));
    await flush();
    expect(has('wsf-join-signed-out')).toBe(true);
    act(() => router.replace('/signin' as never));
    await flush();
  } else if (kind === 'event') {
    await act(async () => {
      await setEventReturn('goal-ev');
    });
  } else {
    await act(async () => {
      await setMarkerReturn('oak-hall-01');
    });
  }
}
async function landed(kind: Case): Promise<void> {
  await atKioskSignIn();
  await armReturn(kind);
  nav.log = [];
  await press('probe-member-signin-submit');
  await flush();
}

describe('W14-O (unknown marker): the guard exists', () => {
  it('src/kioskFlowExit.ts exports KioskFlowExitGuard', () => {
    expect(guardModule, 'src/kioskFlowExit.ts').not.toBeNull();
    expect(typeof guardModule!.KioskFlowExitGuard).toBe('function');
  });
});

describe.each(['ios', 'android'] as const)('W14-O on %s: the marker UNKNOWN, a signed-in visitor, a screen outside the kiosk flow', (os) => {
  beforeEach(() => {
    platform.OS = os;
  });

  for (const kind of ['join', 'event', 'go'] as const) {
    it(`(h-a) ${kind}: the LANDING from the kiosk Sign in is answered with the nearest kiosk start screen (the same mounted screen), signed out, no offer to stay signed in; the landed screen and its "back to home" link are gone`, async () => {
      await atKioskSignIn();
      const key = kioskKey();
      await armReturn(kind);
      nav.log = [];
      await press('probe-member-signin-submit');
      await flush();
      expect(nav.log, 'the landing action').toContain(LANDING_ACTION[kind]);
      expect(landedRenders[kind], `the real ${kind} screen mounted on the landing`).toBeGreaterThan(0);
      expect(stacks.every((st) => st.includes(KIOSK)), 'the kiosk on every recorded stack').toBe(true);
      expect(stacks.at(-1)).toEqual([KIOSK]);
      expectAtKioskStart(`${kind} after the landing`);
      expect(kioskKey()).toBe(key);
      expect(homeLink(kind)).toBeUndefined();
      expect(has('wsf-join-submit')).toBe(false);
      expect(memberHomeRenders, 'member Home never rendered signed in').toBe(0);
    });

    it(`(h-d) ${kind}: Back after the redirect has nothing beneath to reach`, async () => {
      await landed(kind);
      expectAtKioskStart(`${kind} after the landing`);
      expect((ref as unknown as { canGoBack: () => boolean }).canGoBack()).toBe(false);
      await back();
      expectAtKioskStart(`${kind} after Back`);
    });

    it(`(h-f) ${kind}: IDLE after the redirect: already signed out; past KIOSK_IDLE_MS nothing changes`, async () => {
      await landed(kind);
      expectAtKioskStart(`${kind} after the landing`);
      const signOuts = fb.signOutCalls;
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(session.KIOSK_IDLE_MS + 10 * session.KIOSK_TICK_MS);
      });
      vi.useRealTimers();
      await flush();
      expectAtKioskStart(`${kind} past the deadline`);
      expect(fb.signOutCalls).toBe(signOuts);
    });
  }

  it('(h-a) join, landed by a Sign in that passes no routes: answered the same', async () => {
    signInDeps.withRoutes = false;
    await landed('join');
    expect(nav.log).toContain(LANDING_ACTION.join);
    expectAtKioskStart('join (no routes) after the landing');
  });

  it('(h-b) the "back to home" link of a join over the kiosk, pressed signed out, opens Home; the moment an account arrives there (auth), the kiosk start screen alone, signed out', async () => {
    await atKioskSignIn();
    const key = kioskKey();
    act(() => router.push(`/join/${CODE}` as never));
    await flush();
    expectState('the join link over the kiosk, signed out', { stack: [KIOSK, 'signin', 'join/[joinCode]'], user: null, disk: 'goal-1' });
    const link = homeLink('join');
    expect(link).toBeDefined();
    nav.log = [];
    await act(async () => {
      link!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    // Nobody signed in: the guard has nothing to protect, and member Home shows signed out over the kiosk, as before.
    expect(nav.log).toEqual(['navigate /']);
    expectState('back to home, signed out', { stack: [KIOSK, 'signin', 'join/[joinCode]', '(tabs)'], user: null, disk: 'goal-1' });
    expect(focusedEl().querySelector('[data-testid="member-home"]')!.textContent).toBe('signed-out-home');
    act(() => setUser(VISITOR));
    await flush();
    expectAtKioskStart('after auth answered on member Home');
    expect(kioskKey()).toBe(key);
    // Member Home was in front when the account arrived, so it re-rendered signed in for ONE commit before the
    // guard's effect answered (whether that frame is ever painted is a device check); then it was reset away.
    expect(memberHomeRenders).toBe(1);
    expect(container.querySelector('[data-testid="member-home"]')).toBeNull();
  });

  it('(h-g) the AUTH trigger: a join link over the kiosk, signed out, whose account arrives without any navigation', async () => {
    await atKioskSignIn();
    act(() => router.push(`/join/${CODE}` as never));
    await flush();
    act(() => setUser(VISITOR));
    await flush();
    expectAtKioskStart('after auth answered');
    expect(memberHomeRenders).toBe(0);
  });

  it('residual, pinned (not closed here): with NO kiosk start screen in the stack there is no kiosk to name, so a signed-in member on a member screen is left alone (the launch guard\'s documented no-redirect on an unreadable marker)', async () => {
    setUser(VISITOR);
    act(() => root.render(<App initial={[{ name: '(tabs)' }, { name: 'join/[joinCode]', params: { joinCode: CODE } }]} />));
    await flush();
    expectState('a member on a join link', { stack: ['(tabs)', 'join/[joinCode]'], user: 'visitor-1', disk: 'goal-1' });
    const link = homeLink('join');
    expect(link).toBeDefined();
    nav.log = [];
    await act(async () => {
      link!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(nav.log).toEqual(['navigate /']);
    expectState('back to home, no kiosk to name', { stack: ['(tabs)', 'join/[joinCode]', '(tabs)'], user: 'visitor-1', disk: 'goal-1' });
    expect(fb.signOutCalls).toBe(0);
  });
});
