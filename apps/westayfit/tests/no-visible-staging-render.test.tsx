import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Platform, Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * W12-26 (OWNER UI-COPY, 2026-10-21). WHAT A MEMBER SEES NEVER SAYS "STAGING".
 *
 * The root layout (app/_layout.tsx) is rendered into jsdom through
 * react-native-web with the Firebase module mocked as a staging build
 * (wsfIsStaging: true), around the real signed-out Sign in screen, the real
 * /health screen and the real signed-out Home, with Platform.OS set to ios,
 * android and web in turn. Nothing on the page may match /staging/i, while
 * the Health screen's Commit row (the QA build marker) is still there.
 * A control shows the harness can see the word when a screen prints it.
 *
 * jsdom is not a device: this proves the text the screens render, not where
 * it lands on a phone (the owner's device check stays).
 */
const state = vi.hoisted(() => ({ screen: null as ReactNode, path: '/' }));
const router = { replace: vi.fn(), push: vi.fn(), back: vi.fn(), canGoBack: () => false, dismissTo: vi.fn(), navigate: vi.fn() };
const navigation = {
  dispatch: vi.fn(),
  isFocused: () => true,
  addListener: () => () => undefined,
  setOptions: vi.fn(),
  getParent: () => undefined,
  getState: () => ({ index: 0, routes: [{ key: 'r', name: 'index' }] }),
};
vi.mock('expo-router', () => {
  const Stack = () => <>{state.screen}</>;
  Stack.Screen = () => null;
  return {
    Stack,
    Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
    router,
    useRouter: () => router,
    useNavigation: () => navigation,
    usePathname: () => state.path,
    useLocalSearchParams: () => ({}),
    useFocusEffect: () => undefined,
  };
});
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useSafeAreaInsets: () => ({ top: Platform.OS === 'web' ? 0 : 59, bottom: 34, left: 0, right: 0 }),
  initialWindowMetrics: { insets: { top: 59, bottom: 34, left: 0, right: 0 }, frame: { x: 0, y: 0, width: 393, height: 852 } },
}));
// The top-inset helpers as Metro resolves them for Platform.OS.
vi.mock('../src/ui/useScreenTopInset', async () => {
  const web = await vi.importActual<typeof import('../src/ui/useScreenTopInset')>('../src/ui/useScreenTopInset');
  const native = await import('../src/ui/useScreenTopInset.native');
  const pick = () => (Platform.OS === 'web' ? web : native);
  return {
    useScreenTopInset: () => pick().useScreenTopInset(),
    ScreenTopSpacer: (p: Record<string, unknown>) => createElement(pick().ScreenTopSpacer as never, p),
    ScreenStatusBar: (p: Record<string, unknown>) => createElement(pick().ScreenStatusBar as never, p),
    TopCleared: (p: Record<string, unknown>) => createElement(pick().TopCleared as never, p),
  };
});
vi.mock('../src/kioskLaunchGuard', () => ({ useKioskLaunchGuard: () => false }));
vi.mock('../src/crashContainment', () => ({}));
vi.mock('../src/crashHarness', () => ({ fireAsyncCrashFaults: () => undefined, injectedRenderFault: () => undefined }));
vi.mock('../src/InAppBrowserBanner', () => ({ InAppBrowserBanner: () => null }));
vi.mock('../src/ui/RouteErrorFallback', () => ({ nativeErrorBoundary: () => undefined }));
vi.mock('../src/ui/CrashRecordsCard', () => ({ CrashRecordsCard: () => null }));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
vi.mock('../src/ui/useReducedMotion', () => ({
  useReducedMotion: () => true,
  useReducedMotionPreference: () => ({ known: true, reduced: true, failed: false }),
}));
// A STAGING build: the strip and the Health card gate on this.
vi.mock('../src/firebase', () => ({
  getFirebaseApp: () => ({}),
  getFirebaseAuth: () => ({ currentUser: null }),
  getFirebaseFirestore: () => ({}),
  getFirebaseFunctions: () => ({}),
  wsfUsingEmulators: false,
  wsfIsStaging: true,
}));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(), onAuthStateChanged: () => () => undefined, signInWithEmailAndPassword: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), getDoc: vi.fn() }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => async () => {
    throw Object.assign(new Error('internal'), { code: 'functions/internal' });
  },
}));
// Signed out: no account.
vi.mock('../src/auth', async () => {
  const actual = await vi.importActual<typeof import('../src/auth')>('../src/auth');
  return {
    AuthConnectingNote: actual.AuthConnectingNote,
    WsfAuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    useWsfAuth: () => ({ ready: true, user: null, slow: false }),
  };
});
vi.mock('../src/postAuthDestination', async () => {
  const actual = await vi.importActual<typeof import('../src/postAuthDestination')>('../src/postAuthDestination');
  return { ...actual, isPostAuthDestinationsReady: () => true, usePostAuthDestinationsReady: () => true };
});

const { default: RootLayout } = await import('../app/_layout');
const { default: SignIn } = await import('../app/signin');
const { default: Health } = await import('../app/health');
const { default: Home } = await import('../app/(tabs)/(home)/index');
const { WSF_BUILD_STAMP } = await import('../src/buildStamp');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let os: string;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const settle = async () => {
  for (let i = 0; i < 6; i += 1) await act(async () => undefined);
};
const mount = async (screen: ReactNode, platform: string) => {
  (Platform as { OS: string }).OS = platform;
  state.screen = screen;
  act(() => root.render(<RootLayout />));
  await settle();
};

beforeEach(() => {
  os = Platform.OS;
  state.screen = null;
  state.path = '/';
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  (Platform as { OS: string }).OS = os;
  vi.restoreAllMocks();
});

const PLATFORMS = ['ios', 'android', 'web'] as const;

describe('W12-26: a staging build shows a member no "staging" copy', () => {
  it.each(PLATFORMS)('%s: the signed-out Sign in screen', async (platform) => {
    await mount(<SignIn />, platform);
    expect(byId('wsf-signin') ?? byId('wsf-signin-loading')).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/staging/i);
  });

  it.each(PLATFORMS)('%s: /health, with the Commit row (the QA build marker) still there', async (platform) => {
    await mount(<Health />, platform);
    expect(byId('wsf-health')).not.toBeNull();
    expect(byId('wsf-health-commit')!.textContent).toBe(WSF_BUILD_STAMP.commitSha);
    expect(byId('wsf-health-builtAt')).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/staging/i);
  });

  it.each(PLATFORMS)('%s: the signed-out Home', async (platform) => {
    await mount(<Home />, platform);
    expect(byId('wsf-home-signed-out')).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/staging/i);
  });

  it('control: the harness sees the word when a screen prints it', async () => {
    await mount(<Text testID="control">Staging control copy</Text>, 'ios');
    expect(byId('control')).not.toBeNull();
    expect(document.body.textContent).toMatch(/staging/i);
  });
});
