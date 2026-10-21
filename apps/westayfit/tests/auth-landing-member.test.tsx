import { act, forwardRef, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 W16-7 (INT-20, INT-24): where a member lands, on a phone.
 *
 * INT-20. On a phone `router.replace` swaps only the top of the root stack,
 * so a sign-in screen's (tabs) and the one its hop opened piled up, and a
 * created community opened in a SECOND (tabs). Now:
 *   · Sign in's and Create account's terminal hop goes through the
 *     integrator's landAfterAuth (W12-12): RESET to Home only, then push the
 *     destination (nothing more for '/'). Sign in's submit and its redirect
 *     effect land ONCE between them.
 *   · the Community tab's Start a community pushes the form over the tabs;
 *   · start-community's confirmed create, and its "Open" on the created card,
 *     leave by router.dismissTo('/community/<id>'): this screen is popped and
 *     the community opens in the tabs already there, with no root replace.
 * The web keeps replace everywhere, exactly as before.
 *
 * INT-24. The sign-in and sign-up email fields say textContentType 'username'
 * on iOS (so the saved sign-in is offered); autoComplete stays 'email'.
 *
 * Rendered whole (react-native-web, jsdom) with Platform.OS set per case and
 * the router and the root stack's navigation mocked; TextInput is wrapped to
 * read the props a phone acts on. No device.
 */

const inputProps = new Map<string, Record<string, unknown>>();
vi.mock('react-native', async (importOriginal) => {
  const rn = await importOriginal<typeof import('react-native')>();
  const TextInput = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
    if (typeof props.testID === 'string') inputProps.set(props.testID, props);
    const Real = rn.TextInput as unknown as (p: Record<string, unknown>) => ReactNode;
    return <Real ref={ref} {...props} />;
  });
  return { ...rn, TextInput };
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

const router = { replace: vi.fn(), push: vi.fn(), dismissTo: vi.fn(), back: vi.fn(), canGoBack: () => true };
const navigation = { dispatch: vi.fn(), isFocused: () => true, getParent: () => undefined, addListener: () => () => {}, setParams: vi.fn() };
vi.mock('expo-router', () => ({
  router,
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  useLocalSearchParams: () => ({}),
  useNavigation: () => navigation,
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(() => cb(), [cb]);
  },
}));

type User = { uid: string; emailVerified: boolean; email?: string };
let auth: { ready: boolean; user: User | null } = { ready: true, user: null };
const authListeners = new Set<() => void>();
function setUser(user: User | null): void {
  auth = { ready: true, user };
  for (const l of authListeners) l();
}
vi.mock('../src/auth', () => ({
  useWsfAuth: () =>
    useSyncExternalStore(
      (l: () => void) => {
        authListeners.add(l);
        return () => authListeners.delete(l);
      },
      () => auth,
    ),
}));
const signIn = vi.fn();
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: (...a: unknown[]) => signIn(...a),
  createUserWithEmailAndPassword: () => Promise.reject(new Error('unused')),
  updateProfile: () => Promise.resolve(),
  onAuthStateChanged: (_a: unknown, listener: (u: { uid: string } | null) => void) => {
    listener(auth.user ? { uid: auth.user.uid } : null);
    return () => {};
  },
}));
const getDoc = vi.fn();
vi.mock('firebase/firestore', () => ({ doc: () => ({}), getDoc: (...a: unknown[]) => getDoc(...a) }));
const callable = vi.fn();
vi.mock('firebase/functions', () => ({ httpsCallable: () => callable }));
vi.mock('../src/firebase', () => ({
  getFirebaseAuth: () => ({ currentUser: auth.user ? { uid: auth.user.uid } : null }),
  getFirebaseFirestore: () => ({}),
  getFirebaseFunctions: () => ({}),
  wsfIsStaging: false,
}));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
vi.mock('../src/verificationEmail', () => ({ requestVerificationEmail: () => Promise.resolve({ sent: true }) }));
const next = { value: '/' };
vi.mock('../src/pendingJoinCode', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  routeAfterAuth: () => Promise.resolve(next.value),
}));
// The Community tab, in its no-memberships and failed states.
const memberships: { fail: boolean } = { fail: false };
vi.mock('../src/memberReads', () => ({
  SAME_LOAD_MS: 10_000,
  peekMyCommunities: () => undefined,
  peekGoals: () => undefined,
  wasRefused: () => false,
  readMyCommunities: () =>
    memberships.fail ? Promise.reject(Object.assign(new Error('x'), { code: 'functions/unavailable' })) : Promise.resolve({ items: [] }),
  readGoals: () => Promise.resolve({ goals: [] }),
}));
vi.mock('../src/ui/CommunityPrivacyControls', () => ({ onPrivacySettled: () => () => {} }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const { default: SignIn } = await import('../app/signin');
const { default: SignUp } = await import('../app/signup');
const { default: CommunityTab } = await import('../app/(tabs)/community/index');
const { default: StartCommunity } = await import('../app/start-community');
const { HOME_ONLY_RESET } = await import('../src/ui/authLanding');
const { forgetUnacknowledgedCreate } = await import('../src/startCommunityOutcome');

const OS = Platform.OS;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  for (const f of [router.replace, router.push, router.dismissTo, navigation.dispatch, signIn, getDoc, callable]) f.mockReset();
  getDoc.mockResolvedValue({ exists: () => true });
  next.value = '/';
  memberships.fail = false;
  auth = { ready: true, user: null };
  inputProps.clear();
  forgetUnacknowledgedCreate();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  (Platform as { OS: string }).OS = OS;
  vi.useRealTimers();
});

const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
async function render(node: ReactNode, platform: 'ios' | 'android' | 'web'): Promise<void> {
  (Platform as { OS: string }).OS = platform;
  act(() => root.render(node));
  await flush();
}
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
const MEMBER: User = { uid: 'm1', emailVerified: true, email: 'm@example.com' };

describe('W16-7 / INT-20: the sign-in and sign-up terminal hops land on a phone', () => {
  it.each([
    ['Sign in', () => <SignIn />],
    ['Create account', () => <SignUp />],
  ])('%s, already signed in (iOS): RESET to Home only, then push the destination; no replace', async (_n, el) => {
    next.value = '/join/abc123';
    auth = { ready: true, user: MEMBER };
    await render(el(), 'ios');
    expect(navigation.dispatch).toHaveBeenCalledTimes(1);
    expect(navigation.dispatch).toHaveBeenCalledWith(HOME_ONLY_RESET);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/join/abc123');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it.each([
    ['Sign in', () => <SignIn />],
    ['Create account', () => <SignUp />],
  ])('%s, already signed in, landing on Home (Android): the RESET alone', async (_n, el) => {
    auth = { ready: true, user: MEMBER };
    await render(el(), 'android');
    expect(navigation.dispatch).toHaveBeenCalledWith(HOME_ONLY_RESET);
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it.each([
    ['Sign in', () => <SignIn />],
    ['Create account', () => <SignUp />],
  ])('%s on the web: replace(next), exactly as before', async (_n, el) => {
    next.value = '/join/abc123';
    auth = { ready: true, user: MEMBER };
    await render(el(), 'web');
    expect(router.replace).toHaveBeenCalledWith('/join/abc123');
    expect(navigation.dispatch).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('the gate hops keep replace on a phone: unverified to /verify-email, no profile to /profile-setup', async () => {
    auth = { ready: true, user: { ...MEMBER, emailVerified: false } };
    await render(<SignIn />, 'ios');
    expect(router.replace).toHaveBeenCalledWith('/verify-email');
    act(() => root.unmount());
    root = createRoot(container);
    router.replace.mockReset();
    getDoc.mockResolvedValue({ exists: () => false });
    auth = { ready: true, user: MEMBER };
    await render(<SignIn />, 'ios');
    expect(router.replace).toHaveBeenCalledWith('/profile-setup');
    expect(navigation.dispatch).not.toHaveBeenCalled();
  });

  it('Sign in submitted on a phone lands ONCE, though its redirect effect sees the same new account', async () => {
    next.value = '/join/abc123';
    signIn.mockImplementation(async () => {
      setUser(MEMBER);
      return { user: MEMBER };
    });
    await render(<SignIn />, 'ios');
    type('wsf-signin-email', 'm@example.com');
    type('wsf-signin-password', 'correct horse');
    await click('wsf-signin-submit');
    await flush();
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(navigation.dispatch).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/join/abc123');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('Sign in submitted on the web: one replace to the destination', async () => {
    next.value = '/join/abc123';
    signIn.mockImplementation(async () => {
      setUser(MEMBER);
      return { user: MEMBER };
    });
    await render(<SignIn />, 'web');
    type('wsf-signin-email', 'm@example.com');
    type('wsf-signin-password', 'correct horse');
    await click('wsf-signin-submit');
    await flush();
    expect(router.replace).toHaveBeenCalledWith('/join/abc123');
    expect(navigation.dispatch).not.toHaveBeenCalled();
  });
});

describe('W16-7 / INT-20: Start a community, on a phone, opens over the tabs', () => {
  it.each([
    ['no memberships', false],
    ['the failed list', true],
  ])('%s: native pushes /start-community; the web replaces', async (_n, fail) => {
    memberships.fail = fail;
    auth = { ready: true, user: MEMBER };
    await render(<CommunityTab />, 'ios');
    await click('wsf-community-index-start');
    expect(router.push).toHaveBeenCalledWith('/start-community');
    expect(router.replace).not.toHaveBeenCalledWith('/start-community');
    act(() => root.unmount());
    root = createRoot(container);
    router.push.mockReset();
    await render(<CommunityTab />, 'web');
    await click('wsf-community-index-start');
    expect(router.replace).toHaveBeenCalledWith('/start-community');
    expect(router.push).not.toHaveBeenCalledWith('/start-community');
  });
});

describe('W16-7 / INT-20: a created community opens in the tabs already there', () => {
  async function create(platform: 'ios' | 'web'): Promise<void> {
    auth = { ready: true, user: MEMBER };
    callable.mockResolvedValue({ data: { groupId: 'grp-1' } });
    await render(<StartCommunity />, platform);
    type('wsf-start-name', 'Harbor Walkers');
    await click('wsf-start-submit');
  }

  it('iOS: the confirmed create dismisses to /community/<id>: no root replace, no second (tabs)', async () => {
    await create('ios');
    expect(router.dismissTo).toHaveBeenCalledTimes(1);
    expect(router.dismissTo).toHaveBeenCalledWith('/community/grp-1');
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("iOS: the created card's Open dismisses too (the path after a navigation that did not happen)", async () => {
    router.dismissTo.mockImplementationOnce(() => {
      throw new Error('router is not mounted');
    });
    await create('ios');
    expect(byId('wsf-start-open')).not.toBeNull();
    router.dismissTo.mockReset();
    await click('wsf-start-open');
    expect(router.dismissTo).toHaveBeenCalledWith('/community/grp-1');
    expect(router.replace).not.toHaveBeenCalled();
    expect(callable).toHaveBeenCalledTimes(1);
  });

  it("the web keeps replace('/community/<id>') on both paths", async () => {
    router.replace.mockImplementationOnce(() => {
      throw new Error('router is not mounted');
    });
    await create('web');
    expect(router.replace).toHaveBeenCalledWith('/community/grp-1');
    router.replace.mockReset();
    await click('wsf-start-open');
    expect(router.replace).toHaveBeenCalledWith('/community/grp-1');
    expect(router.dismissTo).not.toHaveBeenCalled();
  });
});

describe('W16-7 / INT-24: the email field offers the saved sign-in on iOS', () => {
  it.each([
    ['Sign in', () => <SignIn />, 'wsf-signin-email'],
    ['Create account', () => <SignUp />, 'wsf-signup-email'],
  ])("%s: iOS says textContentType 'username', autoComplete stays 'email'", async (_n, el, id) => {
    await render(el(), 'ios');
    expect(inputProps.get(id)!.textContentType).toBe('username');
    expect(inputProps.get(id)!.autoComplete).toBe('email');
  });

  it.each([
    ['Sign in', () => <SignIn />, 'wsf-signin-email'],
    ['Create account', () => <SignUp />, 'wsf-signup-email'],
  ])("%s on the web: autocomplete='email' in the DOM, and the props as before", async (_n, el, id) => {
    await render(el(), 'web');
    expect(byId(id)!.getAttribute('autocomplete')).toBe('email');
    expect(inputProps.get(id)!.textContentType).toBe('emailAddress');
  });
});
