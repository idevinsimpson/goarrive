import { act, useSyncExternalStore, type ReactNode } from 'react';
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
 * RV14-642-F1 (heads-12, PRIVACY): THE REDIRECT-FAILED WAY OUT NEVER TAKES A
 * KIOSK TO MEMBER HOME, proven on a real navigation stack.
 *
 * A visitor at a phone kiosk presses Contribute (armKioskReturn: the kiosk
 * return and the durable marker), the kiosk's Sign in gate replaces, so the
 * stack is [kiosk/[goalId], signin]; sign-in succeeds, the profile read fails
 * offline, and MF-16's screen shows. Its way out was "Back to home", the RESET
 * to member Home: the kiosk was wiped and the visitor stayed signed in on a
 * shared device. Now, with a kiosk session open, it says "Back to the kiosk"
 * and pops back to the start screen, which signs the visitor out; with none,
 * it lands on Home exactly as before.
 *
 * Real: a @react-navigation/core container and a navigator built on the real
 * StackRouter (every screen keeps its place in the stack, as a native stack
 * does; focus is the library's own); the real kiosk start screen
 * (app/kiosk/[goalId].tsx), Sign in and Create account; the real kiosk
 * session, hand-off arming and routeAfterAuth over the NATIVE storage modules
 * and an in-memory AsyncStorage, as on a phone. expo-router's hooks are
 * forwarded to the core hooks it wraps; router.push, replace and dismissTo
 * dispatch PUSH, REPLACE and POP_TO on the root stack, as expo-router does.
 * Firebase is a fake. Adapted from the heads-12 verifier's probe.
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

type User = { uid: string; emailVerified: boolean };
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
vi.mock('firebase/functions', () => ({ httpsCallable: () => () => Promise.resolve({ data: PULSE }) }));
vi.mock('../src/firebase', () => ({
  getFirebaseAuth: () => ({}),
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
    let m = path.match(/^\/kiosk\/([^/]+)$/);
    if (m) return ['kiosk/[goalId]', { goalId: decodeURIComponent(m[1]), ...params }];
    m = path.match(/^\/contribute\/([^/]+)$/);
    if (m) return ['contribute/[goalId]', { goalId: decodeURIComponent(m[1]), ...params }];
    return [path.slice(1), Object.keys(params).length ? params : undefined];
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
const { default: SignIn } = await import('../app/signin');
const { default: SignUp } = await import('../app/signup');
const { useWsfAuth } = await import('../src/auth');

// ---- a real stack navigator (core's useNavigationBuilder + StackRouter) -----
function ProbeStack(props: { initialRouteName?: string; children: ReactNode }) {
  const { state, descriptors, NavigationContent } = useNavigationBuilder(StackRouter, props as never);
  return (
    <NavigationContent>
      {state.routes.map((r, i) => (
        <div key={r.key} data-route={r.name} data-focused={String(i === state.index)}>
          {descriptors[r.key].render()}
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
const VISITOR: User = { uid: 'visitor-1', emailVerified: true };
const KIOSK_START = { name: 'kiosk/[goalId]', params: { goalId: 'goal-1' } };

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
  fb.getDoc = () => Promise.reject(OFFLINE);
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
  return s ? s.routes[s.index].name : null;
};

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
        <Stack.Screen name="signin" component={SignIn as never} />
        <Stack.Screen name="signup" component={SignUp as never} />
      </Stack.Navigator>
    </BaseNavigationContainer>
  );
}

/** A cold kiosk link on a phone: the start screen (signed out), then Contribute and the kiosk's Sign in gate. */
async function kioskVisitorAtSignIn(): Promise<void> {
  act(() => root.render(<App initial={[KIOSK_START]} />));
  await flush();
  expect(byId('wsf-kiosk-start'), 'kiosk start screen at rest').not.toBeNull();
  await click('wsf-kiosk-start'); // the real onContribute: armKioskReturn + the hand-off note + push
  await click('probe-contribute-signin');
  expect(names()).toEqual(['kiosk/[goalId]', 'signin']);
}
async function signInOffline(): Promise<void> {
  type('wsf-signin-email', 'visitor@example.com');
  type('wsf-signin-password', 'correct horse');
  await click('wsf-signin-submit');
  await flush();
  expect(byId('wsf-signin-redirect-failed'), 'MF-16 screen shown').not.toBeNull();
}
/** Create account's redirect-failed screen on a kiosk: a signed-in, verified visitor sitting on /signup. */
async function signUpScreenOffline(): Promise<void> {
  act(() => router.push('/signup' as never));
  await flush();
  expect(names()).toEqual(['kiosk/[goalId]', 'signin', 'signup']);
  act(() => setUser(VISITOR));
  await flush();
  expect(byId('wsf-signup-redirect-failed'), 'MF-16 screen shown').not.toBeNull();
}

function expectBackAtTheKioskSignedOut(): void {
  expect(names()).toEqual(['kiosk/[goalId]']);
  expect(focusedRoute()).toBe('kiosk/[goalId]');
  expect(byId('wsf-kiosk-start'), 'the kiosk start screen, at rest').not.toBeNull();
  expect(fb.signOutCalls).toBe(1);
  expect(authStore.state.user).toBeNull();
  // Member Home was never on the stack, and never rendered.
  expect(stacks.some((s) => s.includes('(tabs)'))).toBe(false);
  expect(memberHomeRenders).toBe(0);
  expect(byId('member-home')).toBeNull();
  expect(nav.log).toContain('dismissTo /kiosk/goal-1');
  // The session ended the way it always does: once nobody is signed in.
  expect(session.readKioskSession()).toBeNull();
}

describe.each(['ios', 'android'] as const)('RV14-642-F1 on %s, a real stack: the way out under a kiosk session', (os) => {
  beforeEach(() => {
    platform.OS = os;
  });

  it('Sign in: "Back to the kiosk" pops to the kiosk start screen, which signs the visitor out; Home never on the stack', async () => {
    await kioskVisitorAtSignIn();
    expect(session.readKioskSession()).toBe('goal-1');
    await signInOffline();
    expect(byId('wsf-signin-redirect-home')).toBeNull();
    expect(byId('wsf-signin-redirect-kiosk')!.textContent).toContain('Back to the kiosk');
    await click('wsf-signin-redirect-kiosk');
    await flush();
    expectBackAtTheKioskSignedOut();
  });

  it('Create account: the same, from [kiosk, signin, signup]', async () => {
    await kioskVisitorAtSignIn();
    await signUpScreenOffline();
    expect(byId('wsf-signup-redirect-home')).toBeNull();
    expect(byId('wsf-signup-redirect-kiosk')!.textContent).toContain('Back to the kiosk');
    await click('wsf-signup-redirect-kiosk');
    await flush();
    expectBackAtTheKioskSignedOut();
  });

  it("Sign in, the device's marker alone (the two-hour return gone): back to the kiosk", async () => {
    await kioskVisitorAtSignIn();
    await act(async () => {
      await session.clearKioskReturnGoal();
    });
    expect(session.readKioskReturnGoal(null)).toBeNull();
    await signInOffline();
    await click('wsf-signin-redirect-kiosk');
    await flush();
    expectBackAtTheKioskSignedOut();
  });

  it('Sign in, the kiosk return alone (the marker not kept): back to the kiosk', async () => {
    await kioskVisitorAtSignIn();
    await act(async () => {
      await session.clearKioskSession();
    });
    expect(session.readKioskSession()).toBeNull();
    await signInOffline();
    await click('wsf-signin-redirect-kiosk');
    await flush();
    expectBackAtTheKioskSignedOut();
  });
});

describe.each(['ios', 'android'] as const)('RV14-642-F1 on %s, a real stack: no kiosk session, Home as before', (os) => {
  beforeEach(() => {
    platform.OS = os;
  });

  it('Sign in opened from Home: "Back to home" resets to member Home only', async () => {
    act(() => root.render(<App initial={[{ name: '(tabs)' }, { name: 'signin' }]} />));
    await flush();
    await signInOffline();
    expect(byId('wsf-signin-redirect-kiosk')).toBeNull();
    expect(byId('wsf-signin-redirect-home')!.textContent).toContain('Back to home');
    await click('wsf-signin-redirect-home');
    await flush();
    expect(names()).toEqual(['(tabs)']);
    expect(byId('member-home')!.textContent).toBe('member-home:visitor-1');
    expect(nav.log.some((l) => l.startsWith('dismissTo'))).toBe(false);
    expect(fb.signOutCalls).toBe(0);
  });

  it('Create account, signed in: "Back to home" resets to member Home only', async () => {
    act(() => root.render(<App initial={[{ name: '(tabs)' }, { name: 'signup' }]} />));
    await flush();
    act(() => setUser(VISITOR));
    await flush();
    expect(byId('wsf-signup-redirect-kiosk')).toBeNull();
    expect(byId('wsf-signup-redirect-home')!.textContent).toContain('Back to home');
    await click('wsf-signup-redirect-home');
    await flush();
    expect(names()).toEqual(['(tabs)']);
    expect(byId('member-home')!.textContent).toBe('member-home:visitor-1');
    expect(nav.log.some((l) => l.startsWith('dismissTo'))).toBe(false);
    expect(fb.signOutCalls).toBe(0);
  });
});
