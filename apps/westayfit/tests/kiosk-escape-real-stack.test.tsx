import { existsSync, readFileSync } from 'node:fs';
import * as nodePath from 'node:path';

import { Component, act, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
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
 * W14-K (heads-13, owner order: BLOCKERS for visitor and device use) — THE
 * THREE KIOSK ESCAPE PATHS, each proven closed on a REAL navigation stack, on
 * iOS and Android.
 *
 *   1. RV15-642-F1. The crash fallback's way out: a render throw on Sign in
 *      or Create account after a kiosk visitor has signed in. "Go to Home"
 *      pushed member Home over the kiosk, signed in as the visitor. Now, with
 *      a kiosk session open, it is "Back to the kiosk": the start screen,
 *      which signs the visitor out. With none, Go to Home as before.
 *   2. RV15-642-N1. The device's kiosk marker alone (the two-hour kiosk
 *      return gone): a post-auth hop's '/' reset the stack to member Home.
 *      Now it lands on that kiosk's start screen. verify-email and
 *      profile-setup here; Sign in's submit and its redirect-failed Try again
 *      wherever member's Sign in lands through landAfterAuth (the composed
 *      tree; the suite says so and is skipped where it does not).
 *   3. RV15-641-N1. A join finished over an open kiosk
 *      ([(tabs), kiosk/g1, contribute/g1?kiosk=1, join/<code>]) never wipes
 *      the kiosk: Back still reaches the start screen, which signs the
 *      visitor out.
 *
 * Real: a @react-navigation/core container and a navigator on the real
 * StackRouter (every screen keeps its place, as a native stack does; focus is
 * the library's own); the real kiosk start screen, Sign in, Create account,
 * verify-email, profile-setup and join; the real kiosk session, hand-off
 * arming, routeAfterAuth and landAfterAuth over the NATIVE storage modules and
 * an in-memory AsyncStorage, as on a phone; the real crash fallback
 * (RouteErrorFallback.native), wrapped round a route the way expo-router's
 * Try does for a route that exports ErrorBoundary. expo-router's hooks are
 * forwarded to the core hooks it wraps; router.push, replace, dismissTo and
 * navigate dispatch PUSH, REPLACE, POP_TO and NAVIGATE on the root stack, as
 * expo-router does. Firebase is a fake. The harness is adapted from member's
 * auth-redirect-kiosk-stack test (RV14-642-F1).
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
// The real module imports React Native internals jsdom cannot load.
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

// A signed-in render that throws (item 1): the screens' signed-in "Loading…" line.
const fault = vi.hoisted(() => ({ throwWhenSignedIn: false }));
vi.mock('../src/AuthFormPrimitives', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const Status = actual.StatusText as (p: { children: ReactNode; testID?: string }) => ReactNode;
  return {
    ...actual,
    StatusText: (p: { children: ReactNode; testID?: string }) => {
      if (fault.throwWhenSignedIn && authStore.state.user) throw new Error('signed-in render fault');
      return Status(p);
    },
  };
});

const fb = vi.hoisted(() => ({
  signIn: null as unknown as (...a: unknown[]) => unknown,
  getDoc: null as unknown as (...a: unknown[]) => unknown,
  signOutCalls: 0,
  uidReadThrows: false,
}));
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: (...a: unknown[]) => fb.signIn(...a),
  createUserWithEmailAndPassword: () => Promise.reject(new Error('unused')),
  updateProfile: () => Promise.resolve(),
  onAuthStateChanged: () => () => {},
  reload: async (u: { emailVerified: boolean }) => {
    u.emailVerified = true;
  },
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
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => () =>
    Promise.resolve({
      data:
        name === 'wsfJoinCommunity'
          ? { groupId: 'oak', alreadyMember: false }
          : name === 'wsfPreviewCommunity'
            ? { displayName: 'Oak Grove Together', groupType: 'familyFriends', joinPolicy: 'code' }
            : PULSE,
    }),
}));
vi.mock('../src/firebase', () => ({
  getFirebaseAuth: () => ({
    get currentUser() {
      if (fb.uidReadThrows) throw new Error('auth state unreadable');
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
  function routeOf(href: string): [string, Record<string, string> | undefined] {
    const [path, q] = href.split('?');
    const params = Object.fromEntries(new URLSearchParams(q ?? ''));
    if (path === '/') return ['(tabs)', undefined];
    let m = path!.match(/^\/(kiosk|contribute)\/([^/]+)$/);
    if (m) return [`${m[1]}/[goalId]`, { goalId: decodeURIComponent(m[2]!), ...params }];
    m = path!.match(/^\/join\/([^/]+)$/);
    if (m) return ['join/[joinCode]', { joinCode: decodeURIComponent(m[1]!), ...params }];
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

const { router } = await import('expo-router');
const session = await import('../src/kioskSession');
await session.kioskSessionReady();
const { postAuthDestinationsReady } = await import('../src/postAuthDestination');
await postAuthDestinationsReady();
const { default: KioskGoal } = await import('../app/kiosk/[goalId]');
const signinModule = (await import('../app/signin')) as { default: ComponentType; ErrorBoundary?: ComponentType<BoundaryProps> };
const signupModule = (await import('../app/signup')) as { default: ComponentType; ErrorBoundary?: ComponentType<BoundaryProps> };
const { default: VerifyEmail } = await import('../app/verify-email');
const { default: ProfileSetup } = await import('../app/profile-setup');
const { default: JoinPage } = await import('../app/join/[joinCode]');
const { useWsfAuth } = await import('../src/auth');
const { nativeErrorBoundary, FALLBACK_WAY_OUT_KIOSK } = await import('../src/ui/RouteErrorFallback.native');
const { landAfterAuth } = await import('../src/ui/authLanding');
const webFallback = await import('../src/ui/RouteErrorFallback');

type BoundaryProps = { error: Error; retry: () => Promise<void> };

/** expo-router's Try (build/views/Try.js): a route that exports ErrorBoundary is rendered inside it. */
class Try extends Component<{ catch: ComponentType<BoundaryProps>; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  retry = () => new Promise<void>((resolve) => this.setState({ error: null }, () => resolve()));
  render() {
    const Fallback = this.props.catch;
    return this.state.error ? <Fallback error={this.state.error} retry={this.retry} /> : this.props.children;
  }
}
/** A route as expo-router mounts it: inside its own boundary (member exports nativeErrorBoundary('screen') on both). */
const withBoundary = (Screen: ComponentType, exported: ComponentType<BoundaryProps> | undefined) =>
  function Bounded() {
    return (
      <Try catch={exported ?? nativeErrorBoundary('screen')!}>
        <Screen />
      </Try>
    );
  };
const SignInRoute = withBoundary(signinModule.default, signinModule.ErrorBoundary);
const SignUpRoute = withBoundary(signupModule.default, signupModule.ErrorBoundary);

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
function ContributeKioskGate() {
  // app/contribute/[goalId].tsx signed out on a kiosk: SignInLink replace={kiosk} -> router.replace('/signin').
  return (
    <button data-testid="probe-contribute-signin" onClick={() => router.replace('/signin' as never)}>
      Sign in
    </button>
  );
}

const OFFLINE = Object.assign(new Error('Failed to get document because the client is offline.'), { code: 'unavailable' });
const makeUser = (emailVerified: boolean): User => ({
  uid: 'visitor-1',
  email: 'visitor@example.com',
  emailVerified,
  getIdToken: async () => 'token',
});
const KIOSK_START = { name: 'kiosk/[goalId]', params: { goalId: 'goal-1' } };
const PROFILE = { exists: () => true, data: () => ({ displayName: 'Visitor' }) };

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
  fault.throwWhenSignedIn = false;
  fb.signOutCalls = 0;
  fb.uidReadThrows = false;
  fb.getDoc = () => new Promise(() => undefined); // the profile read never answers unless a test says so
  fb.signIn = async () => {
    const u = makeUser(true);
    setUser(u);
    return { user: u };
  };
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
});
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () =>
  act(async () => {
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
  });
function type(id: string, value: string): void {
  const el = byId(id) as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(id: string): Promise<void> {
  const el = byId(id);
  expect(el, `${id} is on screen`).not.toBeNull();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}
const names = () => (ref.getRootState()?.routes ?? []).map((r) => r.name);
const focusedRoute = () => {
  const s = ref.getRootState();
  return s ? s.routes[s.index]!.name : null;
};
/** The visible fallback's way out (the focused route's). */
const focusedEl = () => container.querySelector('[data-focused="true"]') as HTMLElement;
async function pressFocusedWayOut(): Promise<string> {
  const el = focusedEl().querySelector('[data-testid="wsf-route-error-home"]') as HTMLElement | null;
  expect(el, 'the fallback’s way out is on the focused screen').not.toBeNull();
  const label = el!.textContent ?? '';
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
  return label;
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
        <Stack.Screen name="contribute/[goalId]" component={ContributeKioskGate} />
        <Stack.Screen name="signin" component={SignInRoute} />
        <Stack.Screen name="signup" component={SignUpRoute} />
        <Stack.Screen name="verify-email" component={VerifyEmail as never} />
        <Stack.Screen name="profile-setup" component={ProfileSetup as never} />
        <Stack.Screen name="join/[joinCode]" component={JoinPage as never} />
      </Stack.Navigator>
    </BaseNavigationContainer>
  );
}

/** A cold kiosk link on a phone: the start screen (signed out), then Contribute and the kiosk's Sign in gate. */
async function kioskVisitorAtSignIn(): Promise<void> {
  act(() => root.render(<App initial={[KIOSK_START]} />));
  await flush();
  expect(byId('wsf-kiosk-start'), 'kiosk start screen at rest').not.toBeNull();
  await click('wsf-kiosk-start'); // the real onContribute: armKioskReturn (the return and the marker) + push
  await click('probe-contribute-signin');
  expect(names()).toEqual(['kiosk/[goalId]', 'signin']);
  expect(session.readKioskSession()).toBe('goal-1');
}
async function submitSignIn(): Promise<void> {
  type('wsf-signin-email', 'visitor@example.com');
  type('wsf-signin-password', 'correct horse');
  await click('wsf-signin-submit');
  await flush();
}
/** The two-hour kiosk return gone; the device's marker alone stays open. */
async function markerOnly(): Promise<void> {
  await act(async () => {
    await session.clearKioskReturnGoal();
  });
  expect(session.readKioskReturnGoal(null)).toBeNull();
  expect(session.readKioskSession()).toBe('goal-1');
}

function expectBackAtTheKioskSignedOut(): void {
  expect(focusedRoute()).toBe('kiosk/[goalId]');
  expect(byId('wsf-kiosk-start'), 'the kiosk start screen, at rest').not.toBeNull();
  expect(fb.signOutCalls).toBeGreaterThanOrEqual(1);
  expect(authStore.state.user).toBeNull();
  // Member Home was never on the stack, and never rendered.
  expect(stacks.some((s) => s.includes('(tabs)'))).toBe(false);
  expect(names()).not.toContain('(tabs)');
  expect(memberHomeRenders).toBe(0);
  expect(byId('member-home')).toBeNull();
}

describe.each(['ios', 'android'] as const)('1. RV15-642-F1 on %s: a crash fallback under a kiosk session goes back to the kiosk', (os) => {
  beforeEach(() => {
    platform.OS = os;
  });

  it('Sign in: a render throw once the visitor is signed in → "Back to the kiosk" → the start screen, signed out; Home never on the stack', async () => {
    await kioskVisitorAtSignIn();
    fault.throwWhenSignedIn = true;
    await submitSignIn();
    expect(focusedEl().querySelector('[data-testid="wsf-route-error"]'), 'the screen fallback').not.toBeNull();
    expect(focusedEl().querySelector('[data-testid="wsf-route-error-body"]')!.textContent).toContain('go back to the kiosk');
    const label = await pressFocusedWayOut();
    expect(label).toBe(FALLBACK_WAY_OUT_KIOSK);
    expect(nav.log).toContain('dismissTo /kiosk/goal-1');
    expect(nav.log.some((l) => l.startsWith('navigate'))).toBe(false);
    expect(names()).toEqual(['kiosk/[goalId]']);
    expectBackAtTheKioskSignedOut();
  });

  it('Create account: a render throw once signed in, from [kiosk, signin, signup] → back to the kiosk, signed out', async () => {
    await kioskVisitorAtSignIn();
    act(() => router.push('/signup' as never));
    await flush();
    expect(names()).toEqual(['kiosk/[goalId]', 'signin', 'signup']);
    fault.throwWhenSignedIn = true;
    act(() => setUser(makeUser(true)));
    await flush();
    expect(focusedRoute()).toBe('signup');
    const label = await pressFocusedWayOut();
    expect(label).toBe(FALLBACK_WAY_OUT_KIOSK);
    expect(names()).toEqual(['kiosk/[goalId]']);
    expectBackAtTheKioskSignedOut();
  });

  it('fails closed: the records gone quiet after the fallback showed "Back to the kiosk", the press still goes to the kiosk', async () => {
    await kioskVisitorAtSignIn();
    fault.throwWhenSignedIn = true;
    await submitSignIn();
    expect(focusedEl().querySelector('[data-testid="wsf-route-error-home"]')!.textContent).toBe(FALLBACK_WAY_OUT_KIOSK);
    await act(async () => {
      await session.clearKioskSession();
      await session.clearKioskReturnGoal();
    });
    await pressFocusedWayOut();
    expect(nav.log).toContain('dismissTo /kiosk/goal-1');
    expect(names()).toEqual(['kiosk/[goalId]']);
    expect(memberHomeRenders).toBe(0);
  });

  it('an account that cannot be read counts as nobody: the marker still names the kiosk', async () => {
    await kioskVisitorAtSignIn();
    fault.throwWhenSignedIn = true;
    await submitSignIn();
    fb.uidReadThrows = true;
    const label = await pressFocusedWayOut();
    expect(label).toBe(FALLBACK_WAY_OUT_KIOSK);
    expect(names()).toEqual(['kiosk/[goalId]']);
    expectBackAtTheKioskSignedOut();
  });

  it('control, no kiosk session: Sign in opened from Home, the same throw → "Go to Home", as today', async () => {
    act(() => root.render(<App initial={[{ name: '(tabs)' }, { name: 'signin' }]} />));
    await flush();
    fault.throwWhenSignedIn = true;
    await submitSignIn();
    const label = await pressFocusedWayOut();
    expect(label).toBe('Go to Home');
    expect(nav.log).toContain('navigate /');
    expect(nav.log.some((l) => l.startsWith('dismissTo'))).toBe(false);
    expect(focusedRoute()).toBe('(tabs)');
    expect(byId('member-home')).not.toBeNull();
  });
});

describe.each(['ios', 'android'] as const)('2. RV15-642-N1 on %s: the kiosk marker alone, a post-auth hop to "/" lands on the kiosk', (os) => {
  beforeEach(() => {
    platform.OS = os;
  });

  it('verify-email: the visitor verifies, no destination armed → the kiosk start screen, signed out; never the Home reset', async () => {
    await kioskVisitorAtSignIn();
    await markerOnly();
    act(() => router.replace('/verify-email' as never)); // Sign in's own gate for an unverified account
    await flush();
    act(() => setUser(makeUser(false)));
    await flush();
    expect(names()).toEqual(['kiosk/[goalId]', 'verify-email']);
    fb.getDoc = async () => PROFILE;
    await click('wsf-verify-check');
    await flush();
    expect(nav.log).toContain('dismissTo /kiosk/goal-1');
    expect(names()).toEqual(['kiosk/[goalId]']);
    expectBackAtTheKioskSignedOut();
  });

  it('profile-setup: a returning visitor with a profile, no destination armed → the kiosk start screen, signed out', async () => {
    await kioskVisitorAtSignIn();
    await markerOnly();
    fb.getDoc = async () => PROFILE;
    act(() => setUser(makeUser(true)));
    act(() => router.replace('/profile-setup' as never));
    await flush();
    await flush();
    expect(names()).toEqual(['kiosk/[goalId]']);
    expectBackAtTheKioskSignedOut();
  });

  it('the kiosk not on the stack (a relaunch onto verify-email): replaced by the kiosk start screen, never Home', async () => {
    act(() => root.render(<App initial={[{ name: 'verify-email' }]} />));
    await flush();
    await act(async () => {
      await session.markKioskSession('goal-1');
    });
    act(() => setUser(makeUser(false)));
    await flush();
    fb.getDoc = async () => PROFILE;
    await click('wsf-verify-check');
    await flush();
    expect(nav.log).toContain('replace /kiosk/goal-1');
    expect(names()).toEqual(['kiosk/[goalId]']);
    expectBackAtTheKioskSignedOut();
  });
});

// Member's Sign in (W16-7, RV14-642-F1) lands through landAfterAuth and shows the
// redirect-failed screen. Where it does (the composed tree), its submit and its
// Try again are proven here too; on a branch without it, the suite is skipped.
const SIGNIN_SRC = readFileSync(nodePath.resolve(__dirname, '../app/signin.tsx'), 'utf8');
const MEMBER_SIGNIN = SIGNIN_SRC.includes('landAfterAuth(') && SIGNIN_SRC.includes('wsf-signin-redirect-retry');

describe.runIf(MEMBER_SIGNIN).each(['ios', 'android'] as const)('2. RV15-642-N1 on %s, member’s Sign in: the marker alone', (os) => {
  beforeEach(() => {
    platform.OS = os;
  });

  it('a successful sign-in submit lands on the kiosk, never member Home', async () => {
    await kioskVisitorAtSignIn();
    await markerOnly();
    fb.getDoc = async () => PROFILE;
    await submitSignIn();
    await flush();
    expect(focusedRoute()).toBe('kiosk/[goalId]');
    expectBackAtTheKioskSignedOut();
  });

  it('the redirect-failed screen’s Try again, once the connection is back, lands on the kiosk, never member Home', async () => {
    await kioskVisitorAtSignIn();
    await markerOnly();
    fb.getDoc = () => Promise.reject(OFFLINE);
    await submitSignIn();
    expect(byId('wsf-signin-redirect-failed'), 'MF-16 screen shown').not.toBeNull();
    fb.getDoc = async () => PROFILE;
    await click('wsf-signin-redirect-retry');
    await flush();
    expect(focusedRoute()).toBe('kiosk/[goalId]');
    expectBackAtTheKioskSignedOut();
  });
});

describe.each(['ios', 'android'] as const)('3. RV15-641-N1 on %s: a join finished over an open kiosk never wipes it', (os) => {
  beforeEach(() => {
    platform.OS = os;
  });

  it('[(tabs), kiosk/g1, contribute/g1?kiosk=1, join/<code>]: the kiosk stays beneath, and Back reaches it; it signs the visitor out', async () => {
    await act(async () => {
      await session.markKioskSession('goal-1');
    });
    act(() => setUser(makeUser(true)));
    act(() =>
      root.render(
        <App
          initial={[
            { name: '(tabs)' },
            KIOSK_START,
            { name: 'contribute/[goalId]', params: { goalId: 'goal-1', kiosk: '1' } },
            { name: 'join/[joinCode]', params: { joinCode: 'OakGrove01' } },
          ]}
        />,
      ),
    );
    await flush();
    await click('wsf-join-submit');
    await flush();
    // Replaced (the shape before W13-6a), never reset: the kiosk is still beneath.
    expect(nav.log).toContain('replace /community/oak');
    expect(names()).toEqual(['(tabs)', 'kiosk/[goalId]', 'contribute/[goalId]', '(tabs)']);
    expect(stacks.every((s) => s.includes('kiosk/[goalId]'))).toBe(true);
    expect(fb.signOutCalls).toBe(0);
    // Back, and Back: the kiosk's start screen, which signs the visitor out.
    act(() => (ref as unknown as { goBack: () => void }).goBack());
    await flush();
    expect(focusedRoute()).toBe('contribute/[goalId]');
    act(() => (ref as unknown as { goBack: () => void }).goBack());
    await flush();
    expect(focusedRoute()).toBe('kiosk/[goalId]');
    expect(fb.signOutCalls).toBe(1);
    expect(authStore.state.user).toBeNull();
  });

  it('control, no kiosk beneath: a join from Home still lands inside the one (tabs) by the Home reset', async () => {
    act(() => setUser(makeUser(true)));
    act(() => root.render(<App initial={[{ name: '(tabs)' }, { name: 'join/[joinCode]', params: { joinCode: 'OakGrove01' } }]} />));
    await flush();
    await click('wsf-join-submit');
    await flush();
    expect(nav.log).toContain('push /community/oak');
    expect(names()).toEqual(['(tabs)', '(tabs)']); // this flat probe stack has no nested (home): the push lands at its root
  });
});

describe('the web is unchanged', () => {
  it('no boundary on the web build; landAfterAuth on the web replaces "/" and member destinations, whatever the device records', async () => {
    platform.OS = 'web';
    expect(webFallback.nativeErrorBoundary('screen')).toBeUndefined();
    expect(nativeErrorBoundary('screen')).toBeUndefined();
    await act(async () => {
      await session.markKioskSession('goal-1');
    });
    const calls: string[] = [];
    const deps = {
      dispatch: () => calls.push('dispatch'),
      push: (h: string) => calls.push(`push ${h}`),
      replace: (h: string) => calls.push(`replace ${h}`),
      dismissTo: (h: string) => calls.push(`dismissTo ${h}`),
      routes: () => [{ name: '(tabs)' }, { name: 'kiosk/[goalId]', params: { goalId: 'goal-1' } }, { name: 'join/[joinCode]' }],
      platform: 'web',
    };
    landAfterAuth('/', deps);
    landAfterAuth('/community/oak', deps);
    expect(calls).toEqual(['replace /', 'replace /community/oak']);
  });
});

it('the copy is the pending sign-off copy, shared with member’s way out', () => {
  expect(FALLBACK_WAY_OUT_KIOSK).toBe('Back to the kiosk');
  const member = nodePath.resolve(__dirname, '../src/ui/authRedirect.ts');
  if (existsSync(member)) expect(readFileSync(member, 'utf8')).toContain(`'${FALLBACK_WAY_OUT_KIOSK}'`);
});
