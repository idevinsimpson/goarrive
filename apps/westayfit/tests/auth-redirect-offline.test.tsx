import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 W16-7 (MF-16). A signed-in member who opens Sign in or
 * Create account is redirected after one profile read. Offline, that read
 * rejected and the screen sat on "Loading…" with nothing to press. It is
 * caught now. On a phone the screen says "We couldn’t check your account.
 * Check your connection and try again.", with Try again (the same reads) and
 * Back to home. The web keeps its Loading branch: its DOM is unchanged, an
 * owner decision.
 *
 * RV14-642-F1 (heads-12, PRIVACY): while a kiosk session is open (the
 * device's marker, or the kiosk return armed for whoever signs in) the way
 * out is "Back to the kiosk", router.dismissTo(/kiosk/<goal>), and never the
 * RESET to member Home. The real-stack proof, on iOS and Android, is
 * tests/auth-redirect-kiosk-stack.test.tsx.
 *
 * Rendered whole (react-native-web, jsdom) with Platform.OS set per case;
 * getDoc and routeAfterAuth are mocked, and so are the router and the root
 * stack's navigation. No device.
 */

vi.mock('../src/ui/useScreenTopInset', () => ({
  useScreenTopInset: () => 0,
  ScreenTopSpacer: () => null,
  ScreenStatusBar: () => null,
}));
const router = { replace: vi.fn(), push: vi.fn(), dismissTo: vi.fn(), back: vi.fn(), canGoBack: () => true };
// The device's kiosk-session marker. jsdom has web storage, where the real
// readKioskSession() is always null; a phone's marker is stood in for here
// (the real native marker is driven in tests/auth-redirect-kiosk-stack.test.tsx).
const kioskMarker = vi.hoisted(() => ({ goal: null as string | null }));
vi.mock('../src/kioskSession', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readKioskSession: () => kioskMarker.goal,
}));
// W16-19: the screens read the root stack at the landing (landAfterAuth's
// kiosk-beneath guard). Here they were opened over Home, with no kiosk.
const ROOT_STACK = { index: 1, routes: [{ name: '(tabs)' }, { name: 'signin' }] };
const navigation = { dispatch: vi.fn(), isFocused: () => true, setParams: vi.fn(), getState: () => ROOT_STACK };
vi.mock('expo-router', () => ({
  router,
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  useLocalSearchParams: () => ({}),
  useNavigation: () => navigation,
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(() => cb(), [cb]);
  },
}));
type User = { uid: string; emailVerified: boolean };
let auth: { ready: boolean; user: User | null } = { ready: true, user: null };
vi.mock('../src/auth', () => ({ useWsfAuth: () => auth }));
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: () => Promise.reject(new Error('unused')),
  createUserWithEmailAndPassword: () => Promise.reject(new Error('unused')),
  updateProfile: () => Promise.resolve(),
}));
const getDoc = vi.fn();
vi.mock('firebase/firestore', () => ({ doc: () => ({}), getDoc: (...a: unknown[]) => getDoc(...a) }));
vi.mock('../src/firebase', () => ({ getFirebaseAuth: () => ({}), getFirebaseFirestore: () => ({}), wsfIsStaging: false }));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
vi.mock('../src/verificationEmail', () => ({ requestVerificationEmail: () => Promise.resolve({ sent: true }) }));
const routeAfterAuth = vi.fn();
vi.mock('../src/pendingJoinCode', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  routeAfterAuth: (...a: unknown[]) => routeAfterAuth(...a),
}));

const { default: SignIn } = await import('../app/signin');
const { default: SignUp } = await import('../app/signup');
const { HOME_ONLY_RESET } = await import('../src/ui/authLanding');
const { setKioskReturnGoal, clearKioskReturnGoal } = await import('../src/kioskSession');

const OFFLINE = Object.assign(new Error('Failed to get document because the client is offline.'), { code: 'unavailable' });
const SENTENCE = 'We couldn’t check your account. Check your connection and try again.';
const MEMBER: User = { uid: 'm1', emailVerified: true };

const OS = Platform.OS;
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  for (const f of [router.replace, router.push, router.dismissTo, navigation.dispatch, getDoc, routeAfterAuth]) f.mockReset();
  kioskMarker.goal = null;
  await clearKioskReturnGoal();
  routeAfterAuth.mockResolvedValue('/join/abc123');
  auth = { ready: true, user: MEMBER };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  (Platform as { OS: string }).OS = OS;
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
async function click(id: string): Promise<void> {
  const el = byId(id);
  expect(el, `${id} is on screen`).not.toBeNull();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}

describe.each([
  ['Sign in', () => <SignIn />, 'wsf-signin'],
  ['Create account', () => <SignUp />, 'wsf-signup'],
])('W16-7 / MF-16: %s, the redirect offline', (_name, screen, p) => {
  it('iOS: a rejected profile read says so, with Try again and Back to home, and moves nobody', async () => {
    getDoc.mockRejectedValueOnce(OFFLINE);
    await render(screen(), 'ios');
    expect(byId(`${p}-redirect-failed`)).not.toBeNull();
    expect(byId(`${p}-redirect-error`)!.textContent).toBe(SENTENCE);
    expect(byId(`${p}-redirect-retry`)!.textContent).toContain('Try again');
    expect(byId(`${p}-redirect-home`)!.textContent).toContain('Back to home');
    expect(byId(`${p}-loading`)).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
    expect(navigation.dispatch).not.toHaveBeenCalled();
  });

  it('Try again, no profile: replace(/profile-setup)', async () => {
    getDoc.mockRejectedValueOnce(OFFLINE);
    await render(screen(), 'ios');
    getDoc.mockResolvedValueOnce({ exists: () => false });
    await click(`${p}-redirect-retry`);
    expect(getDoc).toHaveBeenCalledTimes(2);
    expect(router.replace).toHaveBeenCalledWith('/profile-setup');
  });

  it('Try again, a profile: the routeAfterAuth result, landed (RESET to Home, then push)', async () => {
    getDoc.mockRejectedValueOnce(OFFLINE);
    await render(screen(), 'ios');
    getDoc.mockResolvedValueOnce({ exists: () => true });
    await click(`${p}-redirect-retry`);
    expect(routeAfterAuth).toHaveBeenCalledWith('/', 'm1');
    expect(navigation.dispatch).toHaveBeenCalledWith(HOME_ONLY_RESET);
    expect(router.push).toHaveBeenCalledWith('/join/abc123');
    expect(byId(`${p}-redirect-failed`)).toBeNull();
  });

  it('a routeAfterAuth that rejects is caught the same way', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => true });
    routeAfterAuth.mockRejectedValueOnce(OFFLINE);
    await render(screen(), 'ios');
    expect(byId(`${p}-redirect-failed`)).not.toBeNull();
    expect(navigation.dispatch).not.toHaveBeenCalled();
  });

  it('Back to home, no kiosk session: the RESET to Home only', async () => {
    getDoc.mockRejectedValueOnce(OFFLINE);
    await render(screen(), 'ios');
    expect(byId(`${p}-redirect-kiosk`)).toBeNull();
    await click(`${p}-redirect-home`);
    expect(navigation.dispatch).toHaveBeenCalledWith(HOME_ONLY_RESET);
    expect(router.push).not.toHaveBeenCalled();
    expect(router.dismissTo).not.toHaveBeenCalled();
  });

  describe.each(['ios', 'android'] as const)('RV14-642-F1, %s: a kiosk session open, the way out goes back to the kiosk', (os) => {
    it('the kiosk return armed (Contribute at the kiosk): "Back to the kiosk", dismissTo /kiosk/g1, no RESET to Home', async () => {
      await setKioskReturnGoal('g1', null);
      getDoc.mockRejectedValueOnce(OFFLINE);
      await render(screen(), os);
      expect(byId(`${p}-redirect-failed`)).not.toBeNull();
      expect(byId(`${p}-redirect-home`)).toBeNull();
      expect(byId(`${p}-redirect-kiosk`)!.textContent).toContain('Back to the kiosk');
      expect(container.textContent).not.toContain('Back to home');
      await click(`${p}-redirect-kiosk`);
      expect(router.dismissTo).toHaveBeenCalledTimes(1);
      expect(router.dismissTo).toHaveBeenCalledWith('/kiosk/g1');
      expect(navigation.dispatch).not.toHaveBeenCalled();
      expect(router.push).not.toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
    });

    it("the device's kiosk marker alone (the return gone): back to the marker's kiosk", async () => {
      kioskMarker.goal = 'g2';
      getDoc.mockRejectedValueOnce(OFFLINE);
      await render(screen(), os);
      expect(byId(`${p}-redirect-kiosk`)!.textContent).toContain('Back to the kiosk');
      await click(`${p}-redirect-kiosk`);
      expect(router.dismissTo).toHaveBeenCalledWith('/kiosk/g2');
      expect(navigation.dispatch).not.toHaveBeenCalled();
    });

    it('the marker wins over the return when both are open', async () => {
      kioskMarker.goal = 'g2';
      await setKioskReturnGoal('g1', null);
      getDoc.mockRejectedValueOnce(OFFLINE);
      await render(screen(), os);
      await click(`${p}-redirect-kiosk`);
      expect(router.dismissTo).toHaveBeenCalledWith('/kiosk/g2');
    });

    it('fails closed: a kiosk the screen showed still counts if the records went quiet before the press', async () => {
      await setKioskReturnGoal('g1', null);
      getDoc.mockRejectedValueOnce(OFFLINE);
      await render(screen(), os);
      expect(byId(`${p}-redirect-kiosk`)).not.toBeNull();
      await clearKioskReturnGoal();
      await click(`${p}-redirect-kiosk`);
      expect(router.dismissTo).toHaveBeenCalledWith('/kiosk/g1');
      expect(navigation.dispatch).not.toHaveBeenCalled();
    });

    it("another account's kiosk return is not this visitor's kiosk: Back to home, as before", async () => {
      await setKioskReturnGoal('g1', 'someone-else');
      getDoc.mockRejectedValueOnce(OFFLINE);
      await render(screen(), os);
      expect(byId(`${p}-redirect-kiosk`)).toBeNull();
      await click(`${p}-redirect-home`);
      expect(navigation.dispatch).toHaveBeenCalledWith(HOME_ONLY_RESET);
      expect(router.dismissTo).not.toHaveBeenCalled();
    });
  });

  it('unverified: /verify-email, with no read at all', async () => {
    auth = { ready: true, user: { ...MEMBER, emailVerified: false } };
    await render(screen(), 'ios');
    expect(router.replace).toHaveBeenCalledWith('/verify-email');
    expect(getDoc).not.toHaveBeenCalled();
  });

  it("the web keeps today's Loading branch: no error UI", async () => {
    getDoc.mockRejectedValueOnce(OFFLINE);
    await render(screen(), 'web');
    expect(byId(`${p}-loading`)).not.toBeNull();
    expect(byId(`${p}-redirect-failed`)).toBeNull();
    expect(container.textContent).not.toContain('couldn’t check your account');
  });

  it('RV14-642-F1: the web is unchanged with a kiosk return armed too (Loading, no way out, nothing moves)', async () => {
    await setKioskReturnGoal('g1', null);
    getDoc.mockRejectedValueOnce(OFFLINE);
    await render(screen(), 'web');
    expect(byId(`${p}-loading`)).not.toBeNull();
    expect(byId(`${p}-redirect-kiosk`)).toBeNull();
    expect(byId(`${p}-redirect-home`)).toBeNull();
    expect(router.dismissTo).not.toHaveBeenCalled();
    expect(navigation.dispatch).not.toHaveBeenCalled();
  });
});
