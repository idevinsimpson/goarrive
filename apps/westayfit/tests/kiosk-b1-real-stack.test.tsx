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
 * RV16-641-B1 (heads-14; owner order: kiosk escapes block visitor and device
 * use) — A MEMBER RETURN OPENED AT THE KIOSK'S SIGN IN NEVER RESETS THE KIOSK
 * AWAY. Self-contained: it runs on integrator-2 alone and copies unchanged onto
 * a composed candidate.
 *
 * The gap: landAfterAuth's kiosk-beneath guard needs the caller's `routes`, and
 * member's Sign in and Create account (app/signin.tsx, app/signup.tsx on the
 * member lane) pass only dispatch, push and replace. A pending join code, an
 * event return or a /go marker return outranks the kiosk return
 * (src/pendingJoinCode.ts nextRouteAfterAuth), so Sign in landed a member
 * destination by the Home reset: [(tabs), join] over a wiped kiosk, the visitor
 * signed in, the device's kiosk marker open, no Finish, no idle sign-out.
 *
 * Every case asserts the REAL navigation stack (the root stack's route names,
 * through the real @react-navigation/core container and StackRouter), the
 * signed-in state (the auth user's uid, or null) and the kiosk marker
 * (readKioskSession(), and the kiosk return where it matters), at each point:
 * the LANDING right after Sign in, EACH Back until the kiosk start screen is
 * focused, FINISH from the landed state, the IDLE deadline, and for a join link
 * after Join and Back, Back. On iOS and Android.
 *
 * What the kiosk design specifies, cited from source (integrator-2 at 41f8573f):
 *   · the kiosk start screen, focused, clears every hand-off AND the kiosk
 *     marker and signs whoever it finds out: app/kiosk/[goalId].tsx:95-104
 *     (useFocusEffect → resetSharedScreenHandoffs, src/handoffArming.ts:60-71,
 *     whose clearKioskSession() is :69; then signOut, :99);
 *   · Finish clears the kiosk return (src/kioskSession.ts:482), signs out
 *     (:488), clears the marker only once that sign-out succeeded (:495-497),
 *     and pops back to the start screen (app/contribute/[goalId].tsx:1632);
 *   · on a settled kiosk screen the deadline is KIOSK_IDLE_MS = 90_000
 *     (src/kioskSession.ts:38), ticked every KIOSK_TICK_MS (:41) by
 *     app/contribute/[goalId].tsx:1647, and performs Finish when it runs out
 *     (:1659).
 *
 * Sign in is MEMBER'S terminal hop, modelled: landAfterAuth(routeAfterAuth('/'),
 * { dispatch, push, replace, platform }), no routes and no dismissTo.
 * Everything else is real: the kiosk start screen, the hand-off arming, the
 * join screen, the contribution screen (once signed in), the kiosk session and
 * the destinations over the NATIVE storage modules and an in-memory
 * AsyncStorage, as on a phone. expo-router's hooks are forwarded to the core
 * hooks it wraps; router.push, replace, dismissTo and navigate dispatch PUSH,
 * REPLACE, POP_TO and NAVIGATE on the root stack. Firebase is a fake.
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
/** The callables, by name; a test may make one fail. */
const api = vi.hoisted(() => ({ failPulse: false }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => async () => {
    switch (name) {
      case 'wsfGoalPulse':
        if (api.failPulse) throw Object.assign(new Error('internal'), { code: 'functions/internal' });
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
    Link: ({ children }: { children: ReactNode }) => children,
  };
});

const { router, useNavigation } = await import('expo-router');
const { Platform } = await import('react-native');
const session = await import('../src/kioskSession');
await session.kioskSessionReady();
const { postAuthDestinationsReady } = await import('../src/postAuthDestination');
await postAuthDestinationsReady();
const { routeAfterAuth } = await import('../src/pendingJoinCode');
const { setEventReturn } = await import('../src/eventReturn');
const { setMarkerReturn } = await import('../src/markerEntry');
const { landAfterAuth } = await import('../src/ui/authLanding');
const { default: KioskGoal } = await import('../app/kiosk/[goalId]');
const { default: JoinPage } = await import('../app/join/[joinCode]');
const { default: ContributeToGoal } = await import('../app/contribute/[goalId]');
const { useWsfAuth } = await import('../src/auth');

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
const Stack = createNavigatorFactory(ProbeStack)();

let memberHomeRenders = 0;
function MemberHome() {
  const { user } = useWsfAuth();
  memberHomeRenders += 1;
  return <div data-testid="member-home">{user ? `member-home:${user.uid}` : 'signed-out-home'}</div>;
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
/** Member's Sign in terminal hop (app/signin.tsx on the member lane): landAfterAuth with NO routes and NO dismissTo. */
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
        });
      }}
    >
      Sign in
    </button>
  );
}
const EventScreen = () => <div data-testid="probe-event">event</div>;
const MarkerScreen = () => <div data-testid="probe-marker">marker</div>;

let container: HTMLDivElement;
let root: Root;
let ref: ReturnType<typeof createNavigationContainerRef>;
/** Every root stack the container settled on, as route names. */
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
  fb.signOutCalls = 0;
  api.failPulse = false;
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
const names = () => (ref.getRootState()?.routes ?? []).map((r) => r.name);
const focusedRoute = () => {
  const s = ref.getRootState();
  return s ? s.routes[s.index]!.name : null;
};
const focusedEl = () => container.querySelector('[data-focused="true"]') as HTMLElement;
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

/** Stack, signed-in state and kiosk records, all at once. */
function expectState(
  at: string,
  want: { stack: string[]; user: string | null; marker: string | null; kioskReturn?: string | null },
): void {
  expect([at, 'stack', names()]).toEqual([at, 'stack', want.stack]);
  expect([at, 'signed in', signedIn()]).toEqual([at, 'signed in', want.user]);
  expect([at, 'marker', session.readKioskSession()]).toEqual([at, 'marker', want.marker]);
  if (want.kioskReturn !== undefined) {
    expect([at, 'kiosk return', session.readKioskReturnGoal(null)]).toEqual([at, 'kiosk return', want.kioskReturn]);
  }
}

function App({ initial }: { initial: { name: string; params?: object }[] }) {
  return (
    <BaseNavigationContainer
      ref={ref as never}
      initialState={{ index: initial.length - 1, routes: initial } as never}
      onStateChange={(st) => stacks.push(((st as NavigationState | undefined)?.routes ?? []).map((r) => r.name))}
    >
      <Stack.Navigator>
        <Stack.Screen name="(tabs)" component={MemberHome} />
        <Stack.Screen name="kiosk/[goalId]" component={KioskGoal as ComponentType} />
        <Stack.Screen name="contribute/[goalId]" component={KioskContribution} />
        <Stack.Screen name="signin" component={MemberSignIn} />
        <Stack.Screen name="join/[joinCode]" component={JoinPage as ComponentType} />
        <Stack.Screen name="event/[goalId]" component={EventScreen} />
        <Stack.Screen name="go/[markerSlug]" component={MarkerScreen} />
      </Stack.Navigator>
    </BaseNavigationContainer>
  );
}

const KIOSK = 'kiosk/[goalId]';
const CODE = 'OakGroveTogether01';

/** A cold kiosk link: the start screen at rest, then Contribute (the real arming) and the kiosk's Sign in gate. */
async function atKioskSignIn(): Promise<void> {
  act(() => root.render(<App initial={[{ name: KIOSK, params: { goalId: 'goal-1' } }]} />));
  await flush();
  expect(focusedEl().querySelector('[data-testid="wsf-kiosk-start"]'), 'kiosk start screen at rest').not.toBeNull();
  await press('wsf-kiosk-start');
  await press('probe-contribute-signin');
  expectState('at the kiosk Sign in', { stack: [KIOSK, 'signin'], user: null, marker: 'goal-1', kioskReturn: 'goal-1' });
}

type Case = 'join' | 'event' | 'go' | 'marker-alone';
/** Each case up to the landing, right after Sign in completes. */
async function landed(kind: Case): Promise<void> {
  await atKioskSignIn();
  if (kind === 'join') {
    // The join link arrives; signed out, the join screen stashes its code; its "Already have an account? Sign in" replaces it.
    act(() => router.push(`/join/${CODE}` as never));
    await flush();
    expect(focusedEl().querySelector('[data-testid="wsf-join-signed-out"]')).not.toBeNull();
    act(() => router.replace('/signin' as never));
    await flush();
  } else if (kind === 'event') {
    await act(async () => {
      await setEventReturn('goal-ev');
    });
  } else if (kind === 'go') {
    // The /go marker screen clears the older returns, the kiosk return included, when it arms its own.
    await act(async () => {
      await session.clearKioskReturnGoal();
      await setMarkerReturn('oak-hall-01');
    });
  } else {
    // The kiosk return gone (it lives two hours); the device's marker alone stays open.
    await act(async () => {
      await session.clearKioskReturnGoal();
    });
  }
  nav.log = [];
  await press('probe-member-signin-submit');
  await flush();
}

const LANDED: Record<Case, { stack: string[]; user: string | null; marker: string | null; kioskReturn: string | null }> = {
  // Replaced: the second Sign in (the join screen's) became the join screen; the kiosk is beneath.
  join: { stack: [KIOSK, 'signin', 'join/[joinCode]'], user: 'visitor-1', marker: 'goal-1', kioskReturn: 'goal-1' },
  event: { stack: [KIOSK, 'event/[goalId]'], user: 'visitor-1', marker: 'goal-1', kioskReturn: 'goal-1' },
  go: { stack: [KIOSK, 'go/[markerSlug]'], user: 'visitor-1', marker: 'goal-1', kioskReturn: null },
  // '/' with the marker: that kiosk's start screen replaces Sign in; focused, it ends the session there
  // (app/kiosk/[goalId].tsx:95-104).
  'marker-alone': { stack: [KIOSK, KIOSK], user: null, marker: null, kioskReturn: null },
};

describe.each(['ios', 'android'] as const)('RV16-641-B1 on %s: a return opened at the kiosk Sign in, landed by a Sign in that passes no routes', (os) => {
  beforeEach(() => {
    platform.OS = os;
  });

  for (const kind of ['join', 'event', 'go', 'marker-alone'] as const) {
    it(`${kind}: LANDING never resets the kiosk away; then each Back until the kiosk start screen, which ends the session`, async () => {
      await landed(kind);
      expectState(`${kind} landing`, LANDED[kind]);
      expect(stacks.every((st) => st.includes(KIOSK)), 'the kiosk on every recorded stack').toBe(true);
      expect(memberHomeRenders).toBe(0);
      // Each Back, until the kiosk start screen is focused.
      let presses = 0;
      while (focusedRoute() !== KIOSK || names().length > 1) {
        if (focusedRoute() === KIOSK) break;
        await back();
        presses += 1;
        expect(names(), `after Back ${presses}`).toContain(KIOSK);
        if (focusedRoute() !== KIOSK) {
          // Still on the member's side of the kiosk: still signed in, the session still open.
          expectState(`${kind} after Back ${presses}`, { stack: LANDED[kind].stack.slice(0, -presses), user: 'visitor-1', marker: 'goal-1' });
        }
        expect(presses).toBeLessThan(5);
      }
      // At the kiosk start (app/kiosk/[goalId].tsx:95-104): signed out, the marker and every hand-off cleared.
      expect(focusedRoute()).toBe(KIOSK);
      expectState(`${kind} at the kiosk start`, {
        stack: kind === 'marker-alone' ? [KIOSK, KIOSK] : [KIOSK],
        user: null,
        marker: null,
        kioskReturn: null,
      });
      expect(memberHomeRenders).toBe(0);
    });
  }

  for (const kind of ['join', 'event', 'go'] as const) {
    it(`${kind}: FINISH from the landed state (the kiosk contribution's Finish) → the kiosk start screen, signed out, the marker cleared`, async () => {
      await landed(kind);
      expectState(`${kind} landing`, LANDED[kind]);
      // Back to the kiosk flow: the kiosk contribution, the visitor still signed in.
      act(() => router.push('/contribute/goal-1?kiosk=1' as never));
      await flush();
      expect(focusedRoute()).toBe('contribute/[goalId]');
      expectState(`${kind} on the kiosk contribution`, { stack: [...LANDED[kind].stack, 'contribute/[goalId]'], user: 'visitor-1', marker: 'goal-1' });
      await press('wsf-kiosk-finish-chrome');
      await flush();
      // Finish: the kiosk return cleared (src/kioskSession.ts:482), signed out (:488), the marker cleared once
      // that succeeded (:495-497), and popped back to the start screen (app/contribute/[goalId].tsx:1632).
      expect(nav.log).toContain('dismissTo /kiosk/goal-1');
      expect(focusedRoute()).toBe(KIOSK);
      expectState(`${kind} after Finish`, { stack: [KIOSK], user: null, marker: null, kioskReturn: null });
    });

    it(`${kind}: IDLE — on a settled kiosk screen nobody touches, the ${90}-second deadline finishes the session`, async () => {
      await landed(kind);
      expectState(`${kind} landing`, LANDED[kind]);
      // The kiosk contribution that cannot load is a settled screen (src/kioskSession.ts kioskScreenSettled):
      // it shows Finish and runs the deadline (app/contribute/[goalId].tsx:1574-1659).
      api.failPulse = true;
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
      act(() => router.push('/contribute/goal-1?kiosk=1' as never));
      await flush();
      expect(focusedRoute()).toBe('contribute/[goalId]');
      expect(focusedEl().querySelector('[data-testid="wsf-kiosk-finish-bar"]'), 'the settled kiosk screen with Finish').not.toBeNull();
      expectState(`${kind} on the settled kiosk screen`, { stack: [...LANDED[kind].stack, 'contribute/[goalId]'], user: 'visitor-1', marker: 'goal-1' });
      // Just short of KIOSK_IDLE_MS (src/kioskSession.ts:38): nothing yet.
      await act(async () => vi.advanceTimersByTime(session.KIOSK_IDLE_MS - 2 * session.KIOSK_TICK_MS));
      await flush();
      expectState(`${kind} before the deadline`, { stack: [...LANDED[kind].stack, 'contribute/[goalId]'], user: 'visitor-1', marker: 'goal-1' });
      // Past it: Finish, unattended.
      await act(async () => vi.advanceTimersByTime(3 * session.KIOSK_TICK_MS));
      await flush();
      await flush();
      expect(focusedRoute()).toBe(KIOSK);
      expectState(`${kind} after the deadline`, { stack: [KIOSK], user: null, marker: null, kioskReturn: null });
    });
  }

  it('marker-alone: the landing IS the kiosk start screen, so the session is already over there: Finish and the deadline have nothing left to end', async () => {
    await landed('marker-alone');
    expectState('marker-alone landing', LANDED['marker-alone']);
    expect(focusedRoute()).toBe(KIOSK);
    expect(fb.signOutCalls).toBeGreaterThanOrEqual(1);
  });

  it('join: after JOIN completes the kiosk stays beneath, signed in; then Back, Back reaches the kiosk start screen, which ends the session', async () => {
    await landed('join');
    expectState('join landing', LANDED.join);
    await press('wsf-join-submit');
    await flush();
    // Join passes its routes: a kiosk beneath means replace, never the Home reset.
    expectState('after Join', { stack: [KIOSK, 'signin', '(tabs)'], user: 'visitor-1', marker: 'goal-1' });
    await back();
    expectState('after Join, Back 1', { stack: [KIOSK, 'signin'], user: 'visitor-1', marker: 'goal-1' });
    await back();
    expect(focusedRoute()).toBe(KIOSK);
    expectState('after Join, Back 2 (the kiosk start)', { stack: [KIOSK], user: null, marker: null, kioskReturn: null });
  });
});

describe('control: no kiosk session', () => {
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
  });
});
