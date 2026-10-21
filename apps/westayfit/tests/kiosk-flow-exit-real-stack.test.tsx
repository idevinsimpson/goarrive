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
 * W14-O (owner decision, #365 6326225448; RV16-641-N3, RV17-641-N1,
 * RV17-C16-1) — LEAVING THE KIOSK FLOW SIGNED IN LEADS BACK TO THE KIOSK
 * START SCREEN, WHICH SIGNS THE VISITOR OUT. The OPEN-marker suite; the
 * unknown-marker variant is tests/kiosk-flow-exit-unknown-real-stack.
 *
 * Before: on a phone whose kiosk marker is open, a visitor who signed in at
 * the kiosk's Sign in with a join link, an event return or a /go marker
 * return pending landed on that member screen still signed in (no Finish,
 * no idle deadline), with "back to home" links that opened member Home over
 * the kiosk; so did a finished join. tests/kiosk-b1-real-stack pinned that
 * as "owner decision pending". Decided: while the marker is open (or cannot
 * be read) and a user is signed in and the focused root route is outside
 * the kiosk flow, the root stack is RESET to the kiosk start screen alone,
 * which signs the visitor out (src/kioskFlowExit.ts, mounted from
 * src/kioskLaunchGuard.ts `useKioskLaunchGuard`, the root layout's one
 * kiosk mount).
 *
 * THE OWNER'S ORDER: the ACTUAL mounted destination screens and navigation
 * stack. Every case asserts the root stack's route names through the real
 * @react-navigation/core container and StackRouter, nested as expo-router
 * nests them (an internal root navigator whose one `__root` screen holds
 * the app's Stack: expo-router/build/ExpoRoot.js, INTERNAL_SLOT_NAME), the
 * signed-in uid or null, the marker in memory (readKioskSession()) and on
 * disk (the AsyncStorage key), the kiosk return where it matters, the
 * screen in front (its test ids), and that the kiosk start screen a visitor
 * walked up to is the SAME mounted screen afterwards (its route key). On
 * iOS and Android. Real: the kiosk start screen, the join, event and /go
 * screens, the contribution screen, the kiosk session and destinations over
 * the NATIVE storage modules, landAfterAuth, and the guard itself, mounted
 * where the root layout mounts it (in the `__root` screen, outside the app's
 * Stack, reading the navigation object the root layout reads). Sign in is
 * member's terminal hop, modelled: landAfterAuth(routeAfterAuth('/'), deps),
 * with routes and dismissTo as W16-19's Sign in passes them, or without, as
 * before it. Firebase is a fake. Self-contained.
 *
 * FAIL-FIRST. The guard is imported conditionally: on a tree before the fix
 * nothing stands in for it, so the decided cases below fail on their stack
 * and auth assertions while the personal-mode controls pass unchanged; the
 * first case pins that the guard exists at all.
 *
 * WHAT IS AND IS NOT REACHABLE. With the guard in place a signed-in visitor
 * is never left in front of join, event, /go or member Home while the
 * marker is open: the landing itself is answered, so their "back to home"
 * links and the join's Finish are pre-empted (asserted: the screen in front
 * is the kiosk start, and those controls are not there). To exercise the
 * links themselves as the trigger, the link cases below open the marker
 * AFTER a personal-mode landing, with no navigation, auth or launch-read
 * event in between (in the product the marker is written only inside the
 * kiosk flow, and a late launch read or a relaunch is answered by the guard's
 * ready and auth triggers before any press): the press is then what the
 * guard answers, through the real screen's real link.
 */

const MARKER_KEY = 'wsf.kioskSessionGoalId';
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
vi.mock('../src/ui/useScreenTopInset', () => ({
  useScreenTopInset: () => 0,
  ScreenTopSpacer: () => null,
  ScreenStatusBar: () => null,
}));
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
/** What /go/oak-hall-01 resolves to: a signed-in visitor who is not a member, so the join step. */
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

// expo-router, forwarded to the real core hooks it wraps; the router acts on the real root stack.
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
    // A route inside the tabs: expo-router addresses it to the root stack as (tabs).
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
    // expo-router's Link (asChild): the child's onPress first, then the navigation (NAVIGATE; REPLACE with `replace`).
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
/**
 * The guard under test, imported conditionally for the fail-first proof: on a
 * tree before W14-O the module does not exist, nothing is mounted in its
 * place, and the decided cases fail on what they assert.
 */
const guardModule: { KioskFlowExitGuard: ComponentType } | null = await import('../src/kioskFlowExit').then(
  (m) => m,
  () => null,
);
const KioskFlowExitGuard: ComponentType = guardModule?.KioskFlowExitGuard ?? (() => null);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---- a real stack navigator (core's useNavigationBuilder + StackRouter) -----
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
/** expo-router's internal root navigator (one `__root` screen: the root layout) and the app's root Stack. */
const RootStack = createNavigatorFactory(ProbeStack)();
const AppStack = createNavigatorFactory(ProbeStack)();

let memberHomeRenders = 0;
function MemberHome() {
  const { user } = useWsfAuth();
  memberHomeRenders += 1;
  return <div data-testid="member-home">{user ? `member-home:${user.uid}` : 'signed-out-home'}</div>;
}
/** How often each REAL landed screen rendered: the witness that the landing mounted it before the guard answered. */
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
/**
 * The kiosk contribution: signed out, its Sign in gate (app/contribute/[goalId].tsx on a kiosk:
 * SignInLink replace={kiosk} → router.replace('/signin')); signed in, the REAL contribution screen.
 */
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
/** How Sign in lands: with the root stack and dismissTo (member's Sign in since W16-19), or without (before it). */
const signInDeps = { withRoutes: true };
/** Member's Sign in terminal hop (app/signin.tsx on the member lane): landAfterAuth(routeAfterAuth('/'), deps). */
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
/** Every app root stack the container settled on, as route names. */
let stacks: string[][] = [];
beforeEach(async () => {
  await act(async () => {
    await session.clearKioskSession();
    await session.clearKioskReturnGoal();
    // Nothing a previous case armed outranks this one's return (join code first, src/pendingJoinCode.ts).
    await clearPendingJoinCode();
    await clearEventReturn();
    await clearMarkerReturn();
    // A device that has not said whose it is (the event screen asks).
    await clearDeviceMode();
  });
  disk.map.clear();
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
/** The app's root Stack: the nested state of the `__root` screen. */
const appState = (): AnyState => (ref.getRootState() as AnyState)?.routes?.[0]?.state;
const appNames = (st: AnyState): string[] => (st?.routes?.[0]?.state?.routes ?? []).map((r) => r.name);
const names = () => (appState()?.routes ?? []).map((r) => r.name);
const focusedRoute = () => {
  const s = appState();
  return s?.routes ? s.routes[s.index ?? s.routes.length - 1]!.name : null;
};
/** The focused screen of the app's root Stack (never the `__root` slot itself). */
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
/** The route key of the kiosk start screen in the stack: the same key is the same mounted screen. */
const kioskKey = () => appState()?.routes?.find((r) => r.name === KIOSK)?.key ?? null;

/** Stack, signed-in state and kiosk records (in memory and on disk), all at once. */
function expectState(
  at: string,
  want: { stack: string[]; user: string | null; marker: string | null; kioskReturn?: string | null },
): void {
  expect([at, 'stack', names()]).toEqual([at, 'stack', want.stack]);
  expect([at, 'signed in', signedIn()]).toEqual([at, 'signed in', want.user]);
  expect([at, 'marker', session.readKioskSession()]).toEqual([at, 'marker', want.marker]);
  expect([at, 'marker on disk', disk.map.get(MARKER_KEY) ?? null]).toEqual([at, 'marker on disk', want.marker]);
  if (want.kioskReturn !== undefined) {
    expect([at, 'kiosk return', session.readKioskReturnGoal(null)]).toEqual([at, 'kiosk return', want.kioskReturn]);
  }
}

/** The `__root` screen: the root layout, where the launch guard (and with it this guard) mounts, over the app's Stack. */
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

/** A cold kiosk link: the start screen at rest, then Contribute (the real arming: the marker goes on disk) and the kiosk's Sign in gate. */
async function atKioskSignIn(): Promise<void> {
  act(() => root.render(<App initial={[KIOSK_G1]} />));
  await flush();
  expect(has('wsf-kiosk-start'), 'kiosk start screen at rest').toBe(true);
  await press('wsf-kiosk-start');
  await press('probe-contribute-signin');
  expectState('at the kiosk Sign in', { stack: [KIOSK, 'signin'], user: null, marker: 'goal-1', kioskReturn: 'goal-1' });
}

type Case = 'join' | 'event' | 'go';
/** Arms the case's member return at the kiosk Sign in (the join link arrives; an event or /go return is pending). */
async function armReturn(kind: Case): Promise<void> {
  if (kind === 'join') {
    // The join link arrives; signed out, the join screen stashes its code; its "Already have an account? Sign in" replaces it.
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
    // The /go marker screen clears the older returns, the kiosk return included, when it arms its own.
    await act(async () => {
      await session.clearKioskReturnGoal();
      await setMarkerReturn('oak-hall-01');
    });
  }
}
/** Each case up to the landing, right after Sign in completes, at the kiosk. */
async function landed(kind: Case): Promise<void> {
  await atKioskSignIn();
  await armReturn(kind);
  nav.log = [];
  await press('probe-member-signin-submit');
  await flush();
}
/** The landing's own action, before the guard answers it: the member screen replaced in over the kiosk (W14-M, W14-N). */
const LANDING_ACTION: Record<Case, string> = {
  join: `replace /join/${CODE}`,
  event: 'replace /event/goal-ev',
  go: 'replace /go/oak-hall-01',
};
/** The "back to home" link each landed screen offers, by its label. */
const HOME_LINK: Record<Case, string> = { join: 'Not now — back to home', event: 'Back to home', go: 'Not now — back to home' };
function homeLink(kind: Case): HTMLElement | undefined {
  return Array.from(focusedEl().querySelectorAll('[role="link"], a')).find((el) => el.textContent === HOME_LINK[kind]) as HTMLElement | undefined;
}
/** After the guard: the kiosk start screen alone, signed out, the session over, and the start screen in front. */
function expectAtKioskStart(at: string): void {
  expectState(at, { stack: [KIOSK], user: null, marker: null, kioskReturn: null });
  expect(focusedRoute()).toBe(KIOSK);
  expect(has('wsf-kiosk-start'), `${at}: the kiosk start screen (Contribute here) in front`).toBe(true);
  expect((focusedEl().textContent ?? '').includes('Stay signed in'), `${at}: never an offer to stay signed in`).toBe(false);
  expect(fb.signOutCalls, `${at}: signed out by the start screen`).toBeGreaterThanOrEqual(1);
}

describe('W14-O: the guard exists', () => {
  it('src/kioskFlowExit.ts exports KioskFlowExitGuard, mounted here as the root layout mounts it', () => {
    expect(guardModule, 'src/kioskFlowExit.ts').not.toBeNull();
    expect(typeof guardModule!.KioskFlowExitGuard).toBe('function');
  });
});

describe.each(['ios', 'android'] as const)('W14-O on %s: an open kiosk marker, a signed-in visitor, a screen outside the kiosk flow', (os) => {
  beforeEach(() => {
    platform.OS = os;
  });

  for (const kind of ['join', 'event', 'go'] as const) {
    it(`(a) ${kind}: the LANDING from the kiosk Sign in is answered: the stack is the kiosk start screen alone (the same mounted screen), signed out, the marker cleared by the start screen; the landed screen, its "back to home" link and any Finish are gone`, async () => {
      await atKioskSignIn();
      const key = kioskKey();
      expect(key).not.toBeNull();
      await armReturn(kind);
      nav.log = [];
      await press('probe-member-signin-submit');
      await flush();
      // The landing happened (the member screen replaced in over the kiosk and mounted), and was answered.
      // (The container's onStateChange cannot witness the step between: core's state ref is already past the
      // guard's RESET by the time it runs; the router log and the screen's own render do.)
      expect(nav.log, 'the landing action').toContain(LANDING_ACTION[kind]);
      expect(landedRenders[kind], `the real ${kind} screen mounted on the landing`).toBeGreaterThan(0);
      expect(stacks.every((st) => st.includes(KIOSK)), 'the kiosk on every recorded stack').toBe(true);
      expect(stacks.at(-1)).toEqual([KIOSK]);
      expectAtKioskStart(`${kind} after the landing`);
      expect(kioskKey(), 'the kiosk start screen the visitor walked up to, not a copy').toBe(key);
      // Nothing of the landed screen is in front: no "back to home" link, no join Finish, no kiosk Finish.
      expect(homeLink(kind)).toBeUndefined();
      expect(has('wsf-join-submit')).toBe(false);
      expect(has('wsf-kiosk-finish-chrome')).toBe(false);
      expect(memberHomeRenders).toBe(0);
    });

    it(`(d) ${kind}: Back after the redirect has nothing beneath to reach: the stack stays the kiosk start screen, signed out`, async () => {
      await landed(kind);
      expectAtKioskStart(`${kind} after the landing`);
      expect((ref as unknown as { canGoBack: () => boolean }).canGoBack()).toBe(false);
      await back();
      expectAtKioskStart(`${kind} after Back`);
    });

    it(`(e) ${kind}: Finish has nothing left to end; the next visitor's Contribute arms a new session over the same start screen, signed out at the gate`, async () => {
      await landed(kind);
      expectAtKioskStart(`${kind} after the landing`);
      const signOuts = fb.signOutCalls;
      await press('wsf-kiosk-start');
      expectState(`${kind}, the next Contribute`, { stack: [KIOSK, 'contribute/[goalId]'], user: null, marker: 'goal-1', kioskReturn: 'goal-1' });
      expect(has('probe-contribute-signin'), 'the kiosk Sign in gate').toBe(true);
      expect(fb.signOutCalls).toBe(signOuts);
    });

    it(`(f) ${kind}: IDLE after the redirect: the kiosk start screen's own rule applies (it is already signed out); past KIOSK_IDLE_MS nothing changes`, async () => {
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

    it(`(b) ${kind}: the "back to home" link, pressed over an open kiosk session (the marker opened after the landing): the press is answered with the kiosk start screen alone, signed out`, async () => {
      // A personal-mode landing: no marker, so Sign in lands the member screen over Home.
      act(() => root.render(<App initial={[{ name: '(tabs)' }]} />));
      await flush();
      if (kind === 'join') {
        act(() => router.push(`/join/${CODE}` as never));
        await flush();
      }
      await armReturn(kind);
      if (kind !== 'join') {
        act(() => router.push('/signin' as never));
        await flush();
      }
      await press('probe-member-signin-submit');
      await flush();
      const tabsStack = kind === 'join' ? ['(tabs)', 'join/[joinCode]'] : kind === 'event' ? ['(tabs)', 'event/[goalId]'] : ['(tabs)', 'go/[markerSlug]'];
      expectState(`${kind} landed in personal mode`, { stack: tabsStack, user: 'visitor-1', marker: null });
      if (kind === 'event') {
        // The event screen first asks whose screen this is (no device answer stored); "My own phone".
        await press('wsf-device-choice-personal');
        await flush();
      }
      // The device's record of an open kiosk session arrives now (a launch read landing late, or a relaunch whose launch replace was refused).
      await act(async () => {
        await session.markKioskSession('goal-1');
      });
      expectState(`${kind}, the marker opened`, { stack: tabsStack, user: 'visitor-1', marker: 'goal-1' });
      const link = homeLink(kind);
      expect(link, `${HOME_LINK[kind]} on the ${kind} screen`).toBeDefined();
      nav.log = [];
      await act(async () => {
        link!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await flush();
      // The link navigated to Home; the guard answered with the kiosk start screen alone (a fresh one: none was in the stack).
      expect(nav.log).toEqual(['navigate /']);
      expectAtKioskStart(`${kind} back to home`);
      expect(stacks.at(-1)).toEqual([KIOSK]);
      expect(focusedEl().querySelector('[data-testid="member-home"]')).toBeNull();
    });
  }

  it('(c) join FINISH over an open kiosk is pre-empted: by the time Finish could be pressed, the kiosk start screen is in front, signed out', async () => {
    await landed('join');
    expectAtKioskStart('join after the landing');
    expect(has('wsf-join-submit')).toBe(false);
  });

  it('(c) join Finish with the marker opened after a personal-mode landing: the landing goes to the kiosk start screen (RV17-641-N2), which signs out; no member screen is focused signed in', async () => {
    act(() => root.render(<App initial={[{ name: '(tabs)' }]} />));
    await flush();
    act(() => router.push(`/join/${CODE}` as never));
    await flush();
    await armReturn('join');
    await press('probe-member-signin-submit');
    await flush();
    expectState('join landed in personal mode', { stack: ['(tabs)', 'join/[joinCode]'], user: 'visitor-1', marker: null });
    await act(async () => {
      await session.markKioskSession('goal-1');
    });
    nav.log = [];
    await press('wsf-join-submit');
    await flush();
    expect(nav.log).toEqual(['replace /kiosk/goal-1']);
    // The N2 landing shape, unchanged by W14-O: the kiosk replaced in over Home, and the start screen ends the session.
    expectState('after Join', { stack: ['(tabs)', KIOSK], user: null, marker: null, kioskReturn: null });
    expect(focusedRoute()).toBe(KIOSK);
    expect(stacks.some((st) => st.at(-1) === '(tabs)' && st.length > 1)).toBe(false);
  });

  it('(g) the AUTH trigger: a visitor on a join link over the kiosk at rest, signed out, whose account arrives without any navigation: the kiosk start screen alone, signed out', async () => {
    await atKioskSignIn();
    const key = kioskKey();
    act(() => router.push(`/join/${CODE}` as never));
    await flush();
    expectState('the join link over the kiosk, signed out', { stack: [KIOSK, 'signin', 'join/[joinCode]'], user: null, marker: 'goal-1' });
    act(() => setUser(VISITOR));
    await flush();
    expectAtKioskStart('after auth answered');
    expect(kioskKey()).toBe(key);
  });

  it('(a) join, landed by a Sign in that passes no routes (member before W16-19): answered the same', async () => {
    signInDeps.withRoutes = false;
    await landed('join');
    expect(nav.log).toContain(LANDING_ACTION.join);
    expect(landedRenders.join).toBeGreaterThan(0);
    expectAtKioskStart('join (no routes) after the landing');
  });
});

describe.each(['ios', 'android'] as const)('W14-O on %s: PERSONAL MODE (no kiosk marker) is unchanged', (os) => {
  beforeEach(() => {
    platform.OS = os;
  });

  it('a join waiting, Sign in from Home: the Home reset and the push, exactly as before', async () => {
    act(() => root.render(<App initial={[{ name: '(tabs)' }, { name: 'join/[joinCode]', params: { joinCode: CODE } }]} />));
    await flush();
    act(() => router.replace('/signin' as never));
    await flush();
    nav.log = [];
    await press('probe-member-signin-submit');
    await flush();
    expect(nav.log).toEqual([`push /join/${CODE}`]);
    expectState('control landing', { stack: ['(tabs)', 'join/[joinCode]'], user: 'visitor-1', marker: null });
    expect(fb.signOutCalls).toBe(0);
  });

  for (const kind of ['join', 'event', 'go'] as const) {
    it(`${kind}: its "back to home" link opens member Home as before, signed in, nothing signs out`, async () => {
      act(() => root.render(<App initial={[{ name: '(tabs)' }]} />));
      await flush();
      if (kind === 'join') {
        act(() => router.push(`/join/${CODE}` as never));
        await flush();
      }
      await armReturn(kind);
      if (kind !== 'join') {
        act(() => router.push('/signin' as never));
        await flush();
      }
      await press('probe-member-signin-submit');
      await flush();
      const tabsStack = kind === 'join' ? ['(tabs)', 'join/[joinCode]'] : kind === 'event' ? ['(tabs)', 'event/[goalId]'] : ['(tabs)', 'go/[markerSlug]'];
      expectState(`${kind} landed`, { stack: tabsStack, user: 'visitor-1', marker: null });
      if (kind === 'event') {
        await press('wsf-device-choice-personal');
        await flush();
      }
      const link = homeLink(kind);
      expect(link, `${HOME_LINK[kind]} on the ${kind} screen`).toBeDefined();
      nav.log = [];
      await act(async () => {
        link!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await flush();
      expect(nav.log).toEqual(['navigate /']);
      expectState(`${kind} back to home`, { stack: [...tabsStack, '(tabs)'], user: 'visitor-1', marker: null });
      expect(focusedEl().querySelector('[data-testid="member-home"]')!.textContent).toBe('member-home:visitor-1');
      expect(fb.signOutCalls).toBe(0);
    });
  }

  it('join Finish: the Home reset and the push of the community (the flat harness pushes it as a second (tabs); join-landing has the nested shape), signed in', async () => {
    act(() => root.render(<App initial={[{ name: '(tabs)' }]} />));
    await flush();
    act(() => router.push(`/join/${CODE}` as never));
    await flush();
    await armReturn('join');
    await press('probe-member-signin-submit');
    await flush();
    expectState('join landed', { stack: ['(tabs)', 'join/[joinCode]'], user: 'visitor-1', marker: null });
    nav.log = [];
    await press('wsf-join-submit');
    await flush();
    expect(nav.log).toEqual(['push /community/oak']);
    expectState('after Join', { stack: ['(tabs)', '(tabs)'], user: 'visitor-1', marker: null });
    expect(fb.signOutCalls).toBe(0);
  });

  it('a kiosk start screen beneath is, on its own, no kiosk session: a join over a kiosk at rest (marker null) lands replaced and its "back to home" link opens member Home as before', async () => {
    act(() => root.render(<App initial={[KIOSK_G1, { name: 'join/[joinCode]', params: { joinCode: CODE } }]} />));
    await flush();
    expect(has('wsf-join-signed-out')).toBe(true);
    act(() => router.replace('/signin' as never));
    await flush();
    nav.log = [];
    await press('probe-member-signin-submit');
    await flush();
    // RV15-641-N1: replaced, never reset; and no session to send anyone back to.
    expect(nav.log).toEqual([`replace /join/${CODE}`]);
    expectState('join over the kiosk at rest', { stack: [KIOSK, 'join/[joinCode]'], user: 'visitor-1', marker: null });
    const link = homeLink('join');
    expect(link).toBeDefined();
    nav.log = [];
    await act(async () => {
      link!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(nav.log).toEqual(['navigate /']);
    expectState('back to home over the kiosk at rest', { stack: [KIOSK, 'join/[joinCode]', '(tabs)'], user: 'visitor-1', marker: null });
    expect(fb.signOutCalls).toBe(0);
  });
});
