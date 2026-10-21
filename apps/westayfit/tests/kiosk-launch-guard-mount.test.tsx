import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * W12-1 (ST-05, integrator hunks). A phone acting as a kiosk that the OS kills
 * mid-session must relaunch to that kiosk's start screen, not to member Home
 * signed in as the visitor. The state lane's guard and marker
 * (src/kioskLaunchGuard.ts, src/kioskSession.ts) are mounted and written
 * here: the guard once in AppShell, the marker by contribute on a signed-in
 * kiosk session. The real root layout and the real contribute route render
 * into jsdom; the marker's storage and the router are mocked at their
 * boundary. No device.
 */
const state = {
  path: '/',
  marker: null as string | null,
  /** Use the real readKioskSession (null on web) instead of the stub marker. */
  realMarker: false,
  ready: true,
  /** false: a phone's device storage (the launch read is asynchronous, so the guard holds). */
  syncStorage: true,
  /** What the root Stack renders: nothing, or the member tabs layout (ESC-2 cases). */
  stackChild: null as ReactNode,
  /** Each time the member tabs rendered, how many replaces had been issued by then. */
  tabsRenders: [] as number[],
};
const params = { value: { goalId: 'g1' } as Record<string, string> };
const router = { replace: vi.fn(), push: vi.fn(), back: vi.fn(), canGoBack: () => true, dismissTo: vi.fn(), navigate: vi.fn() };
const navigation = {
  dispatch: vi.fn(),
  isFocused: () => true,
  addListener: () => () => undefined,
  setOptions: vi.fn(),
  getState: () => ({ index: 1, routes: [{ name: '(tabs)' }, { name: 'contribute/[goalId]' }] }),
};
vi.mock('expo-router', () => {
  const Stack = () => <div data-testid="root-stack">{state.stackChild}</div>;
  Stack.Screen = () => null;
  // The member tabs navigator: records when it renders, relative to the guard's replace.
  const Tabs = () => {
    state.tabsRenders.push(router.replace.mock.calls.length);
    return <div data-testid="member-tabs" />;
  };
  Tabs.Screen = () => null;
  return {
    Stack,
    Tabs,
    Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
    router,
    useRouter: () => router,
    useNavigation: () => navigation,
    usePathname: () => state.path,
    useLocalSearchParams: () => params.value,
    useFocusEffect: () => undefined,
  };
});
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  initialWindowMetrics: { insets: { top: 0, bottom: 0, left: 0, right: 0 }, frame: { x: 0, y: 0, width: 390, height: 844 } },
}));
vi.mock('../src/storage/syncRead', async () => {
  const actual = await vi.importActual<typeof import('../src/storage/syncRead')>('../src/storage/syncRead');
  return {
    ...actual,
    get HAS_SYNC_STORAGE() {
      return state.syncStorage;
    },
  };
});
vi.mock('../src/ui/MemberTabBar', async () => {
  const actual = await vi.importActual<typeof import('../src/ui/MemberTabBar')>('../src/ui/MemberTabBar');
  return { ...actual, MemberTabBar: () => null };
});
vi.mock('../src/ui/TabSceneFade', () => ({ TabSceneFade: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../src/ui/focusReturn', () => ({
  armTabsFocusReturn: () => undefined,
  armTabsFocusReturnTo: () => undefined,
  useTabsFocusReturn: () => undefined,
  useSheetFocusReturn: () => undefined,
}));
vi.mock('../src/crashContainment', () => ({}));
vi.mock('../src/crashHarness', () => ({ fireAsyncCrashFaults: () => undefined, injectedRenderFault: () => undefined }));
vi.mock('../src/StagingBanner', () => ({ StagingBanner: () => null }));
vi.mock('../src/InAppBrowserBanner', () => ({ InAppBrowserBanner: () => null }));
vi.mock('../src/ui/RouteErrorFallback', () => ({ nativeErrorBoundary: () => undefined }));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
vi.mock('../src/ui/useReducedMotion', () => ({
  useReducedMotion: () => true,
  useReducedMotionPreference: () => ({ known: true, reduced: true, failed: false }),
}));
vi.mock('../src/firebase', () => ({
  getFirebaseApp: () => ({}),
  getFirebaseAuth: () => ({}),
  getFirebaseFirestore: () => ({}),
  getFirebaseFunctions: () => ({}),
  wsfUsingEmulators: false,
  wsfIsStaging: false,
}));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(), onAuthStateChanged: () => () => undefined }));
const USER = { uid: 'u1', email: 'visitor@example.com', displayName: 'Visitor', emailVerified: true };
const auth = { user: USER as typeof USER | null };
vi.mock('../src/auth', () => ({
  WsfAuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useWsfAuth: () => ({ ready: state.ready, user: auth.user }),
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => async () => {
    if (name === 'wsfGoalPulse') return { data: { sharedTotal: 40, target: 100, unit: 'squats', status: 'active' } };
    if (name === 'wsfMyContribution') return { data: { ownCredit: 5, unit: 'squats', repeatPolicy: 'multiple' } };
    throw Object.assign(new Error('internal'), { code: 'functions/internal' });
  },
}));
const markKioskSession = vi.fn(async (_goalId: string) => true);
vi.mock('../src/kioskSession', async () => {
  const actual = await vi.importActual<typeof import('../src/kioskSession')>('../src/kioskSession');
  return {
    ...actual,
    kioskSessionReady: () => Promise.resolve(),
    readKioskSession: () => (state.realMarker ? actual.readKioskSession() : state.marker),
    markKioskSession: (goalId: string) => markKioskSession(goalId),
  };
});

const { default: RootLayout } = await import('../app/_layout');
const { resetKioskLaunchGuardForTests } = await import('../src/kioskLaunchGuard');
const { default: MemberTabsLayout } = await import('../app/(tabs)/_layout');
const { KIOSK_SESSION_MARKER_KEY } = await import('../src/kioskSession');
const { clearMemberReads } = await import('../src/memberReads');
const { default: ContributeToGoal } = await import('../app/contribute/[goalId]');

const APP_ROOT = join(__dirname, '..');
let container: HTMLDivElement;
let root: Root;
let os: string;
const setOs = (v: string) => ((Platform as { OS: string }).OS = v);
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await act(async () => undefined);
};

beforeEach(() => {
  os = Platform.OS;
  state.path = '/';
  state.marker = null;
  state.realMarker = false;
  state.ready = true;
  state.syncStorage = true;
  state.stackChild = null;
  state.tabsRenders = [];
  auth.user = USER;
  params.value = { goalId: 'g1' };
  router.replace.mockClear();
  markKioskSession.mockClear();
  resetKioskLaunchGuardForTests();
  clearMemberReads();
  localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setOs(os);
  vi.restoreAllMocks();
});

describe('W12-1: AppShell mounts the kiosk launch guard', () => {
  it('(a) exactly once, in a component of its own that draws nothing, under WsfAuthProvider; not in AppShell (RV10-641-1)', () => {
    const layout = readFileSync(join(APP_ROOT, 'app/_layout.tsx'), 'utf8');
    expect(layout.match(/useKioskLaunchGuard\(\)/g)).toHaveLength(1);
    expect(layout).toMatch(/function KioskLaunchGuard\(\) \{\s*useKioskLaunchGuard\(\);\s*return null;\s*\}/);
    const shell = layout.slice(layout.indexOf('function AppShell()'));
    expect(shell).not.toContain('useKioskLaunchGuard');
    expect(shell).not.toContain('KioskLaunchHolding');
    const rootLayout = layout.slice(layout.indexOf('export default function RootLayout()'), layout.indexOf('function KioskLaunchGuard()'));
    expect(rootLayout.indexOf('<WsfAuthProvider>')).toBeLessThan(rootLayout.indexOf('<KioskLaunchGuard />'));
    expect(rootLayout.indexOf('<KioskLaunchGuard />')).toBeLessThan(rootLayout.indexOf('</WsfAuthProvider>'));
  });

  it('(b) native, a marker for g1: the launch replaces to /kiosk/g1 exactly once', async () => {
    setOs('ios');
    state.marker = 'g1';
    act(() => root.render(<RootLayout />));
    await settle();
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/kiosk/g1');
    // Re-rendering the shell does not ask again: a launch is a process start.
    act(() => root.render(<RootLayout />));
    await settle();
    expect(router.replace).toHaveBeenCalledTimes(1);
  });

  it('(b) already on /kiosk/g1: no replace', async () => {
    setOs('android');
    state.marker = 'g1';
    state.path = '/kiosk/g1';
    act(() => root.render(<RootLayout />));
    await settle();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('(b) no marker: no replace; and nothing before auth has answered', async () => {
    setOs('ios');
    act(() => root.render(<RootLayout />));
    await settle();
    expect(router.replace).not.toHaveBeenCalled();
    resetKioskLaunchGuardForTests();
    state.marker = 'g1';
    state.ready = false;
    act(() => root.render(<RootLayout key="cold" />));
    await settle();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('(c) web: no replace, even with the marker key in browser storage', async () => {
    setOs('web');
    state.realMarker = true;
    localStorage.setItem(KIOSK_SESSION_MARKER_KEY, 'g1');
    sessionStorage.setItem(KIOSK_SESSION_MARKER_KEY, 'g1');
    act(() => root.render(<RootLayout />));
    await settle();
    expect(router.replace).not.toHaveBeenCalled();
    sessionStorage.clear();
  });
});

describe('ESC-2: the member tabs hold back until the launch decision; the Stack stays mounted', () => {
  const tabs = () => container.querySelector('[data-testid="member-tabs"]');
  const holdingGround = () => container.querySelector('[data-testid="wsf-member-tabs-holding"]');
  const stack = () => container.querySelector('[data-testid="root-stack"]');
  /** A phone: device storage, so the launch read is asynchronous and the guard holds. */
  const phone = (os: 'ios' | 'android') => {
    setOs(os);
    state.syncStorage = false;
    resetKioskLaunchGuardForTests();
  };

  it('kiosk relaunch (marker g1): no member content while holding, the Stack mounted; the replace comes before any tab', async () => {
    phone('ios');
    state.marker = 'g1';
    state.stackChild = <MemberTabsLayout />;
    act(() => root.render(<RootLayout />));
    // The first frame: the ground only, inside a mounted root Stack.
    expect(stack()).not.toBeNull();
    expect(holdingGround()).not.toBeNull();
    expect(tabs()).toBeNull();
    expect(container.querySelector('[data-testid="wsf-member-topbar"]')).toBeNull();
    await settle();
    expect(router.replace).toHaveBeenCalledWith('/kiosk/g1');
    // Every render of the member tabs came after the replace was issued.
    expect(state.tabsRenders.every((replaces) => replaces >= 1)).toBe(true);
  });

  it('no marker: the member tabs render once the read has found nothing', async () => {
    phone('android');
    state.stackChild = <MemberTabsLayout />;
    act(() => root.render(<RootLayout />));
    expect(holdingGround()).not.toBeNull();
    expect(tabs()).toBeNull();
    await settle();
    expect(router.replace).not.toHaveBeenCalled();
    expect(holdingGround()).toBeNull();
    expect(tabs()).not.toBeNull();
  });

  it('before auth has answered, still holding (nothing decided yet)', async () => {
    phone('ios');
    state.ready = false;
    state.stackChild = <MemberTabsLayout />;
    act(() => root.render(<RootLayout />));
    await settle();
    expect(holdingGround()).not.toBeNull();
    expect(tabs()).toBeNull();
  });

  it('web: never holds; the member tabs are there from the first render, and nothing is replaced', async () => {
    setOs('web');
    state.syncStorage = true;
    resetKioskLaunchGuardForTests();
    state.stackChild = <MemberTabsLayout />;
    act(() => root.render(<RootLayout />));
    expect(holdingGround()).toBeNull();
    expect(tabs()).not.toBeNull();
    const first = container.innerHTML;
    await settle();
    expect(router.replace).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe(first);
    expect(state.tabsRenders[0]).toBe(0);
  });
});

describe('W12-1: contribute writes the kiosk marker on a phone', () => {
  it('(d) native, kiosk=1, signed in: markKioskSession(g1) once, and not again on re-render', async () => {
    setOs('ios');
    params.value = { goalId: 'g1', kiosk: '1' };
    act(() => root.render(<ContributeToGoal />));
    await settle();
    expect(markKioskSession).toHaveBeenCalledTimes(1);
    expect(markKioskSession).toHaveBeenCalledWith('g1');
    act(() => root.render(<ContributeToGoal />));
    await settle();
    expect(markKioskSession).toHaveBeenCalledTimes(1);
  });

  it('(d) without kiosk, or signed out: never', async () => {
    setOs('android');
    act(() => root.render(<ContributeToGoal />));
    await settle();
    expect(markKioskSession).not.toHaveBeenCalled();
    act(() => root.unmount());
    root = createRoot(container);
    params.value = { goalId: 'g1', kiosk: '1' };
    auth.user = null;
    act(() => root.render(<ContributeToGoal />));
    await settle();
    expect(markKioskSession).not.toHaveBeenCalled();
  });

  it('(d) web, kiosk=1: never (a closed tab ends its session)', async () => {
    setOs('web');
    params.value = { goalId: 'g1', kiosk: '1' };
    act(() => root.render(<ContributeToGoal />));
    await settle();
    expect(markKioskSession).not.toHaveBeenCalled();
  });

  it('kiosk Finish is untouched: the marker is cleared only by runKioskFinish after sign-out', () => {
    const contribute = readFileSync(join(APP_ROOT, 'app/contribute/[goalId].tsx'), 'utf8');
    expect(contribute).not.toContain('clearKioskSession');
    expect(contribute.match(/markKioskSession\(/g)).toHaveLength(1);
  });
});
