import { act, useSyncExternalStore, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BaseNavigationContainer,
  StackRouter,
  createNavigationContainerRef,
  createNavigatorFactory,
  getActionFromState,
  useNavigationBuilder,
  type NavigationState,
} from '@react-navigation/core';

/**
 * NATIVE-MEMBER-1 W16-19 (RV16-641-B1, owner order: kiosk escapes block
 * visitor and device use). MEMBER'S SIGN IN AND CREATE ACCOUNT NEVER LAND A
 * KIOSK VISITOR ON MEMBER HOME.
 *
 * They landed through landAfterAuth with only dispatch, push and replace, so
 * its kiosk-beneath guard (W14-K) could not see the stack: a join link opened
 * at the kiosk's Sign in, then Sign in, reset to [(tabs), join], the visitor
 * signed in on member Home with the kiosk gone. With the kiosk's marker alone,
 * Home replaced the kiosk's start screen over the one beneath: two start
 * screens. They now pass `routes` and `dismissTo` to landAfterAuth, as
 * verify-email does.
 *
 * OWNER-ORDER TEST STANDARD. Every case asserts the REAL root stack
 * (`names()`), the signed-in account (`signedInAs()`, the Firebase fake's
 * currentUser) and the kiosk records (`readKioskSession()`, and the kiosk
 * return where it matters) at each point: (1) the LANDING right after Sign in
 * or Create account, for a join link opened at the kiosk, an event return, a
 * /go marker return, the kiosk marker alone ('/', exactly ONE kiosk start
 * screen) and (W16-22, heads-15 RV17-642-N2) the plain kiosk RETURN, the
 * default after a kiosk Sign in (/contribute/<goal>?kiosk=1: dismissTo the
 * kiosk, then push the contribution, never signed out in between); (2) after
 * EACH Back until the kiosk start screen is focused; (3) FINISH on the kiosk
 * CONTRIBUTION flow, opened from the landing (it is the landing itself for
 * the return); (4) IDLE EXPIRY on that flow, past KIOSK_IDLE_MS; and (5) for
 * the join, after Join and then Back, Back. On iOS and Android. Finish and
 * idle exist only on the kiosk contribution flow: at a landed join, event or
 * /go screen there is neither (owner decision RV16-641-N3, pinned by W14).
 *
 * THE KIOSK START SCREEN'S DESIGN, asserted wherever it is reached:
 * app/kiosk/[goalId].tsx:118-137 (useFocusEffect): with the session's marker
 * naming this goal (decideKioskStart, :124) it signs the visitor out (:131),
 * and once nobody is signed in it clears the marker (:127, "the kiosk session
 * ends only once nobody is signed in", :109-113). Finish
 * (src/kioskSession.ts:470 runKioskFinish) clears the kiosk return and, once
 * the sign-out succeeded, the marker, then dismisses to the start screen
 * (app/contribute/[goalId].tsx:1669-1705). The idle countdown is
 * KIOSK_IDLE_MS (src/kioskSession.ts:38, 90 s), which performs the same
 * Finish (app/contribute/[goalId].tsx:1727-1733).
 *
 * Real: a @react-navigation/core container and a navigator on the real
 * StackRouter; the real kiosk start screen, kiosk contribution screen, Sign
 * in, Create account and join screens; the real kiosk session, hand-off
 * arming, pending join code, event and marker returns, routeAfterAuth,
 * landAfterAuth and runKioskFinish over the NATIVE storage modules and an
 * in-memory AsyncStorage, as on a phone. expo-router's hooks are forwarded to
 * the core hooks it wraps; router.push, replace, dismissTo and navigate
 * dispatch PUSH, REPLACE, POP_TO and NAVIGATE on the root stack, and its Link
 * (asChild) navigates on press, as expo-router does; an incoming link is the
 * real getActionFromState. Firebase is a fake. Adapted from the RV16
 * verifier's probe (RV16-641-B1) and member's auth-redirect-kiosk-stack test.
 * Self-contained, so it can run unchanged on a composed tree.
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
    initialWindowMetrics: null,
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
const fb = vi.hoisted(() => ({
  signIn: null as unknown as (...a: unknown[]) => unknown,
  getDoc: null as unknown as (...a: unknown[]) => unknown,
  signOutCalls: 0,
}));
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: (...a: unknown[]) => fb.signIn(...a),
  createUserWithEmailAndPassword: () => Promise.reject(new Error('unused')),
  updateProfile: () => Promise.resolve(),
  onAuthStateChanged: () => () => {},
  reload: async () => undefined,
  signOut: async () => {
    fb.signOutCalls += 1;
    setUser(null);
  },
}));
vi.mock('firebase/firestore', () => ({ doc: () => ({}), getDoc: (...a: unknown[]) => fb.getDoc(...a) }));
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
const MINE = { ownCredit: 0, unit: 'squats', repeatPolicy: 'multiple' };
const RECORDED = { addedCount: 5, ownCredit: 5, sharedTotal: 125, target: 500, unit: 'squats', status: 'active', alreadyRecorded: false };
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => () =>
    Promise.resolve({
      data:
        name === 'wsfJoinCommunity'
          ? { groupId: 'oak', alreadyMember: false }
          : name === 'wsfPreviewCommunity'
            ? { displayName: 'Oak Grove Together', groupType: 'familyFriends', joinPolicy: 'code' }
            : name === 'wsfMyContribution'
              ? MINE
              : name === 'wsfContribute'
                ? RECORDED
                : PULSE,
    }),
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
vi.mock('../src/verificationEmail', () => ({ requestVerificationEmail: () => Promise.resolve({ sent: true }) }));

// expo-router, forwarded to the real core hooks it wraps; the router acts on the real root stack.
const nav = vi.hoisted(() => ({ ref: null as unknown as { dispatch: (a: unknown) => void }, log: [] as string[] }));
vi.mock('expo-router', async () => {
  const core = await import('@react-navigation/core');
  const { Children, cloneElement, isValidElement } = await import('react');
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
  /** expo-router's Link asChild: the child's own onPress first, then the navigation (push, or replace). */
  function Link({ href, replace, children }: { href: string; replace?: boolean; asChild?: boolean; children: ReactNode }) {
    const child = Children.only(children);
    if (!isValidElement(child)) return child as never;
    const own = (child.props as { onPress?: (e: unknown) => void }).onPress;
    return cloneElement(child as never, {
      onPress: (e: unknown) => {
        own?.(e);
        if (replace) router.replace(href);
        else router.push(href);
      },
    });
  }
  return {
    router,
    useRouter: () => router,
    useNavigation: () => core.useNavigation(),
    useFocusEffect: core.useFocusEffect,
    useLocalSearchParams: () => core.useRoute().params ?? {},
    usePathname: () => '/',
    Link,
  };
});

const { router } = await import('expo-router');
const session = await import('../src/kioskSession');
await session.kioskSessionReady();
const { postAuthDestinationsReady } = await import('../src/postAuthDestination');
await postAuthDestinationsReady();
const { readPendingJoinCode } = await import('../src/pendingJoinCode');
const { setEventReturn } = await import('../src/eventReturn');
const { armMarkerReturn } = await import('../src/handoffArming');
const { default: KioskGoal } = await import('../app/kiosk/[goalId]');
const { default: ContributeToGoal } = await import('../app/contribute/[goalId]');
const { default: SignIn } = await import('../app/signin');
const { default: SignUp } = await import('../app/signup');
const { default: JoinPage } = await import('../app/join/[joinCode]');
const { useWsfAuth } = await import('../src/auth');

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
/** The event and marker screens: only where the visitor lands matters here. */
const EventStub = () => <div data-testid="probe-event" />;
const MarkerStub = () => <div data-testid="probe-marker" />;

const CODE = 'OakGroveTogether01';
const GOAL = 'goal-1';
const KIOSK = 'kiosk/[goalId]';
const KIOSK_START = { name: KIOSK, params: { goalId: GOAL } };
const PROFILE = { exists: () => true, data: () => ({ displayName: 'Visitor' }) };
const VISITOR: User = { uid: 'visitor-1', email: 'visitor@example.com', emailVerified: true, getIdToken: async () => 'token' };

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
  fb.getDoc = async () => PROFILE;
  fb.signIn = async () => {
    setUser(VISITOR);
    return { user: VISITOR };
  };
  authStore.state = { ready: true, user: null };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  ref = createNavigationContainerRef();
  nav.ref = ref as never;
});
afterEach(() => {
  vi.useRealTimers();
  act(() => root.unmount());
  container.remove();
  platform.OS = 'ios';
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
/** The Firebase fake's currentUser: the account signed in on this device, or null. */
const signedInAs = () => authStore.state.user?.uid ?? null;
const focusedEl = () => container.querySelector('[data-focused="true"]') as HTMLElement;
const inFocused = (id: string) => focusedEl().querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
function typeFocused(id: string, value: string): void {
  const el = inFocused(id) as HTMLInputElement;
  expect(el, `${id} on the focused screen`).not.toBeNull();
  act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function clickFocused(id: string): Promise<void> {
  const el = inFocused(id);
  expect(el, `${id} on the focused screen`).not.toBeNull();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}

function App({ initial }: { initial: { name: string; params?: object }[] }) {
  return (
    <BaseNavigationContainer
      ref={ref as never}
      initialState={{ index: initial.length - 1, routes: initial } as never}
      onStateChange={(s) => stacks.push(((s as NavigationState | undefined)?.routes ?? []).map((r) => r.name))}
    >
      <Stack.Navigator>
        <Stack.Screen name="(tabs)" component={MemberHome} />
        <Stack.Screen name="kiosk/[goalId]" component={KioskGoal as never} />
        <Stack.Screen name="contribute/[goalId]" component={ContributeToGoal as never} />
        <Stack.Screen name="signin" component={SignIn as never} />
        <Stack.Screen name="signup" component={SignUp as never} />
        <Stack.Screen name="join/[joinCode]" component={JoinPage as never} />
        <Stack.Screen name="event/[goalId]" component={EventStub} />
        <Stack.Screen name="go/[markerSlug]" component={MarkerStub} />
      </Stack.Navigator>
    </BaseNavigationContainer>
  );
}

/** What the device holds at a checkpoint. */
type Checkpoint = { stack: string[]; user: string | null; marker: string | null; kioskReturn?: string | null };
function expectCheckpoint(label: string, want: Checkpoint): void {
  expect(names(), `${label}: the root stack`).toEqual(want.stack);
  expect(signedInAs(), `${label}: who is signed in`).toBe(want.user);
  expect(session.readKioskSession(), `${label}: the kiosk marker`).toBe(want.marker);
  if (want.kioskReturn !== undefined) expect(session.readKioskReturnGoal(null), `${label}: the kiosk return`).toBe(want.kioskReturn);
}
/** At rest on the kiosk start screen, as designed (app/kiosk/[goalId].tsx:118-137): the visitor signed out, the marker cleared. */
const AT_REST_ON_THE_KIOSK: Checkpoint = { stack: [KIOSK], user: null, marker: null };

/** A cold kiosk link on a phone: the start screen (signed out), Contribute (arms the return and the marker), then the kiosk contribution's Sign in. */
async function kioskVisitorAtSignIn(): Promise<void> {
  act(() => root.render(<App initial={[KIOSK_START]} />));
  await flush();
  expect(inFocused('wsf-kiosk-start'), 'kiosk start screen at rest').not.toBeNull();
  await clickFocused('wsf-kiosk-start');
  expect(names()).toEqual([KIOSK, 'contribute/[goalId]']);
  await clickFocused('wsf-contribute-signin-link');
  expectCheckpoint('at the kiosk Sign in', { stack: [KIOSK, 'signin'], user: null, marker: GOAL, kioskReturn: GOAL });
}
async function submitSignIn(): Promise<void> {
  typeFocused('wsf-signin-email', 'visitor@example.com');
  typeFocused('wsf-signin-password', 'correct horse');
  await clickFocused('wsf-signin-submit');
  await flush();
}

type Screen = 'signin' | 'signup';
type Destination = 'join' | 'event' | 'go' | 'marker' | 'return';

/**
 * From the kiosk start screen to the landing: the destination is armed at the
 * kiosk, then the visitor signs in on Sign in, or is signed in on Create
 * account (its own redirect lands them). Returns where it should have landed.
 */
async function landVia(screen: Screen, dest: Destination): Promise<Checkpoint> {
  await kioskVisitorAtSignIn();
  if (dest === 'join') {
    // The incoming link, as expo-router's linking hands it over: getActionFromState on the state for /join/<code>.
    const action = getActionFromState({ routes: [{ name: 'join/[joinCode]', params: { joinCode: CODE }, path: `/join/${CODE}` }] } as never, undefined);
    act(() => (ref as unknown as { dispatch: (a: unknown) => void }).dispatch(action));
    await flush();
    expect(names()).toEqual([KIOSK, 'signin', 'join/[joinCode]']);
    expect(inFocused('wsf-join-signed-out'), 'the signed-out join screen').not.toBeNull();
    expect(readPendingJoinCode(null)).toBe(CODE);
    // Its "Already have an account? Sign in" or "Sign up to join" (both replace).
    await clickFocused(screen === 'signin' ? 'wsf-join-signin' : 'wsf-join-signup');
    expect(names()).toEqual([KIOSK, 'signin', screen]);
  } else {
    if (screen === 'signup') {
      // Sign in's "New here? Create an account".
      await clickFocused('wsf-signin-create');
      expect(names()).toEqual([KIOSK, 'signin', 'signup']);
    }
    await act(async () => {
      if (dest === 'event') await setEventReturn('goal-2', Date.now(), null);
      if (dest === 'go') await armMarkerReturn('oak-bench-01', null); // a /go scan; it clears the kiosk return
      if (dest === 'marker') await session.clearKioskReturnGoal(); // the two-hour return gone, the marker alone
    });
  }
  nav.log = [];
  if (screen === 'signin') await submitSignIn();
  else {
    // Signed in meanwhile (contrived timing, as RV14-642-F1's Create account case): its redirect lands.
    act(() => setUser(VISITOR));
    await flush();
    await flush();
  }
  // Where it lands. Beneath the landing: the kiosk start screen, then (when the visitor went on from it) the first Sign in.
  const under = dest === 'join' || screen === 'signup' ? [KIOSK, 'signin'] : [KIOSK];
  switch (dest) {
    case 'join':
      return { stack: [...under, 'join/[joinCode]'], user: VISITOR.uid, marker: GOAL, kioskReturn: GOAL };
    case 'event':
      return { stack: [...under, 'event/[goalId]'], user: VISITOR.uid, marker: GOAL, kioskReturn: GOAL };
    case 'go':
      return { stack: [...under, 'go/[markerSlug]'], user: VISITOR.uid, marker: GOAL, kioskReturn: null };
    case 'marker':
      // '/' with the marker open: that kiosk's start screen, dismissed to (ONE kiosk), which signs the visitor out.
      return { ...AT_REST_ON_THE_KIOSK, kioskReturn: null };
    case 'return':
      // W16-22 (RV17-642-N2): the kiosk return Contribute armed, nothing else. dismissTo the kiosk start
      // screen (whatever lay above it goes), then push its contribution, signed in, the marker open.
      return { stack: [KIOSK, 'contribute/[goalId]'], user: VISITOR.uid, marker: GOAL, kioskReturn: GOAL };
  }
}

/** Back, one press at a time, until the kiosk start screen is focused: each step's stack, account and marker. */
async function backToTheKiosk(landed: Checkpoint, label: string): Promise<void> {
  const stack = [...landed.stack];
  while (focusedRoute() !== KIOSK) {
    expect(stack.length, `${label}: the kiosk is still beneath`).toBeGreaterThan(1);
    act(() => (ref as unknown as { goBack: () => void }).goBack());
    await flush();
    stack.pop();
    if (stack.length > 1) expectCheckpoint(`${label}: Back to ${stack.at(-1)}`, { stack, user: VISITOR.uid, marker: GOAL });
  }
  expectCheckpoint(`${label}: Back at the kiosk start`, AT_REST_ON_THE_KIOSK);
}

/** The kiosk flow from where the visitor is: the kiosk's own contribution screen (from the start screen, its Contribute). */
async function openTheKioskFlow(): Promise<void> {
  if (focusedRoute() === KIOSK) await clickFocused('wsf-kiosk-start');
  else if (focusedRoute() !== 'contribute/[goalId]') {
    act(() => router.push(`/contribute/${GOAL}?kiosk=1` as never));
    await flush();
  }
  expect(focusedRoute()).toBe('contribute/[goalId]');
  await flush();
}

describe.each(['ios', 'android'] as const)('W16-19 / RV16-641-B1 on %s: Sign in and Create account at a kiosk, on a real stack', (os) => {
  beforeEach(() => {
    platform.OS = os;
  });

  describe.each(['signin', 'signup'] as const)('%s', (screen) => {
    describe.each(['join', 'event', 'go', 'marker', 'return'] as const)('%s', (dest) => {
      /** Where Finish and idle run: the kiosk contribution flow (W14-N; no landed-state Finish or idle, RV16-641-N3). */
      const flow =
        dest === 'return' ? 'on the kiosk contribution flow (the landing itself)' : 'on the kiosk contribution flow, opened from the landing';
      it(`landing, then Back until the kiosk start screen`, async () => {
        const landed = await landVia(screen, dest);
        expectCheckpoint(`landed (${screen}, ${dest})`, landed);
        if (dest === 'marker') {
          // Exactly ONE kiosk start screen, reached by dismissTo; never a second one replaced over it.
          expect(names().filter((n) => n === KIOSK)).toHaveLength(1);
          expect(nav.log).toContain(`dismissTo /kiosk/${GOAL}`);
          expect(nav.log.some((l) => l.startsWith('replace /kiosk'))).toBe(false);
        } else if (dest === 'return') {
          // W16-22 (RV17-642-N2): dismissTo the ONE kiosk start screen, then push its contribution; the
          // dismiss in between never signs the visitor out, and the contribution is not the signed-out gate.
          const dismissed = nav.log.indexOf(`dismissTo /kiosk/${GOAL}`);
          expect(dismissed, nav.log.join(' | ')).toBeGreaterThanOrEqual(0);
          expect(nav.log.indexOf(`push /contribute/${GOAL}?kiosk=1`)).toBeGreaterThan(dismissed);
          expect(nav.log.some((l) => l.startsWith('replace'))).toBe(false);
          expect(fb.signOutCalls, 'no sign-out at the landing').toBe(0);
          expect(inFocused('wsf-contribute-signin-link'), 'the contribution is not the signed-out gate').toBeNull();
          expect(names().filter((n) => n === KIOSK)).toHaveLength(1);
        } else {
          expect(nav.log.some((l) => l.startsWith('push'))).toBe(false);
        }
        expect(memberHomeRenders, 'member Home never drawn').toBe(0);
        await backToTheKiosk(landed, `${screen}, ${dest}`);
        expect(fb.signOutCalls).toBeGreaterThanOrEqual(1);
      });

      it(`landing, then Finish ${flow}`, async () => {
        const landed = await landVia(screen, dest);
        expectCheckpoint(`landed (${screen}, ${dest})`, landed);
        await openTheKioskFlow();
        await clickFocused('wsf-kiosk-finish-chrome');
        await flush();
        // Finish (runKioskFinish): the kiosk return and the marker cleared, signed out, dismissed to the ONE start screen.
        expectCheckpoint(`after Finish (${screen}, ${dest})`, { ...AT_REST_ON_THE_KIOSK, kioskReturn: null });
        expect(memberHomeRenders).toBe(0);
      });

      it(dest === 'marker' ? 'landing at rest on the kiosk start screen, then past the idle timeout: unchanged' : `landing, then idle expiry ${flow}`, async () => {
        const landed = await landVia(screen, dest);
        expectCheckpoint(`landed (${screen}, ${dest})`, landed);
        if (dest === 'marker') {
          // At rest on the kiosk start screen nothing is left to expire: past KIOSK_IDLE_MS it is unchanged.
          vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
          act(() => vi.advanceTimersByTime(session.KIOSK_IDLE_MS + 5 * session.KIOSK_TICK_MS));
          await flush();
          expectCheckpoint('past the idle timeout, at rest', { ...AT_REST_ON_THE_KIOSK, kioskReturn: null });
          return;
        }
        await openTheKioskFlow();
        // The visitor records a contribution and walks away: the receipt starts the idle countdown.
        vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
        typeFocused('wsf-contribute-entry', '5');
        await clickFocused('wsf-contribute-review');
        await clickFocused('wsf-contribute-submit');
        await flush();
        expect(inFocused('wsf-contribute-receipt'), 'the receipt').not.toBeNull();
        expect(signedInAs()).toBe(VISITOR.uid);
        act(() => vi.advanceTimersByTime(session.KIOSK_IDLE_MS + 5 * session.KIOSK_TICK_MS));
        await flush();
        await flush();
        expectCheckpoint(`after the idle timeout (${screen}, ${dest})`, { ...AT_REST_ON_THE_KIOSK, kioskReturn: null });
        expect(memberHomeRenders).toBe(0);
      });
    });

    it('join: after Join, the community over the kiosk (signed in, marker open); then Back, Back to the kiosk start screen', async () => {
      const landed = await landVia(screen, 'join');
      expectCheckpoint(`landed (${screen}, join)`, landed);
      await clickFocused('wsf-join-submit');
      await flush();
      const joined: Checkpoint = { stack: [KIOSK, 'signin', '(tabs)'], user: VISITOR.uid, marker: GOAL };
      expectCheckpoint(`after Join (${screen})`, joined);
      expect(nav.log).toContain('replace /community/oak');
      await backToTheKiosk(joined, `${screen}, after Join`);
    });
  });

  it('control, no kiosk: Sign in opened from Home with a join armed lands by the Home reset and a push, as before', async () => {
    act(() => root.render(<App initial={[{ name: '(tabs)' }, { name: 'signin' }]} />));
    await flush();
    const { setPendingJoinCode } = await import('../src/pendingJoinCode');
    await act(async () => {
      await setPendingJoinCode(CODE, null);
    });
    nav.log = [];
    await submitSignIn();
    await flush();
    expect(nav.log).toContain(`push /join/${CODE}`);
    expectCheckpoint('landed from Home', { stack: ['(tabs)', 'join/[joinCode]'], user: VISITOR.uid, marker: null });
  });
});
