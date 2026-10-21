import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * W14-O (owner decision, #365 6326225448): THE ROOT LAYOUT MOUNTS THE
 * KIOSK-FLOW EXIT GUARD, AND THE GUARD'S DECISION, UNIT BY UNIT.
 *
 * The real root layout (app/_layout.tsx) renders into jsdom over a mocked
 * expo-router whose navigation object is what the root layout's own is on a
 * phone: its screen in expo-router's internal root navigator, whose state
 * holds the app's root Stack as the nested state of its one `__root` route
 * (expo-router/build/ExpoRoot.js). The guard's RESET must be addressed to
 * that Stack by its key and name the kiosk start screen alone; it must fire
 * on mount, on a state change, on an auth change and once the marker's
 * launch read lands; and it must never fire in personal mode. The stack
 * shapes the RESET produces on the real StackRouter are the real-stack
 * suites' business (tests/kiosk-flow-exit-real-stack and its unknown-marker
 * twin); this file pins the wiring and the pure decision.
 */
const state = {
  path: '/',
  marker: null as string | null,
  unknown: false,
  /** The marker's launch read: resolved, or held until a case resolves it. */
  ready: Promise.resolve(),
  rootState: null as unknown,
  authReady: true,
};
const APP_STACK_KEY = 'stack-app-1';
/** The root layout's navigation state: the internal root navigator holding the app's Stack. */
function rootStateWith(routes: { key?: string; name: string; params?: object }[], index = routes.length - 1): unknown {
  return { key: 'stack-root', index: 0, routes: [{ key: '__root-1', name: '__root', state: { key: APP_STACK_KEY, index, routes } }] };
}
const listeners = new Set<() => void>();
const router = { replace: vi.fn(), push: vi.fn(), back: vi.fn(), canGoBack: () => true, dismissTo: vi.fn(), navigate: vi.fn() };
type Reset = { type: string; target?: string; payload: { index: number; routes: { key?: string; name: string; params?: object }[] } };
const navigation = {
  // Applies a RESET addressed to the app Stack to the state the guard reads next, as React Navigation would; so a
  // second trigger after an answered one sees the kiosk focused and does nothing (the guard is idempotent).
  dispatch: vi.fn((action: Reset) => {
    if (action.type === 'RESET' && action.target === APP_STACK_KEY) state.rootState = rootStateWith(action.payload.routes, action.payload.index);
  }),
  isFocused: () => true,
  addListener: (_type: string, cb: () => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  setOptions: vi.fn(),
  getState: () => state.rootState,
};
vi.mock('expo-router', () => {
  const Stack = () => <div data-testid="root-stack" />;
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
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  initialWindowMetrics: { insets: { top: 0, bottom: 0, left: 0, right: 0 }, frame: { x: 0, y: 0, width: 390, height: 844 } },
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
const USER = { uid: 'visitor-1', email: 'visitor@example.com', displayName: 'Visitor', emailVerified: true };
const auth = { user: USER as typeof USER | null };
vi.mock('../src/auth', () => ({
  WsfAuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useWsfAuth: () => ({ ready: state.authReady, user: auth.user }),
}));
vi.mock('firebase/functions', () => ({ httpsCallable: () => async () => ({ data: {} }) }));
vi.mock('../src/kioskSession', async () => {
  const actual = await vi.importActual<typeof import('../src/kioskSession')>('../src/kioskSession');
  return {
    ...actual,
    kioskSessionReady: () => state.ready,
    readKioskSession: () => state.marker,
    kioskSessionUnknown: () => state.unknown,
    markKioskSession: async () => true,
  };
});
// The launch guard's own replace is not under test here; it is kept real so the two guards' co-existence is seen.

const { default: RootLayout } = await import('../app/_layout');
const { resetKioskLaunchGuardForTests } = await import('../src/kioskLaunchGuard');
const guard = await import('../src/kioskFlowExit');
const { inKioskFlow, kioskFlowExitReset, useKioskFlowExitGuard } = guard;
// Bound by its declared type: destructuring would widen the unique symbol to `symbol`.
const KIOSK_MARKER_UNKNOWN: typeof guard.KIOSK_MARKER_UNKNOWN = guard.KIOSK_MARKER_UNKNOWN;

const APP_ROOT = join(__dirname, '..');
let container: HTMLDivElement;
let root: Root;
let os: string;
const setOs = (v: string) => ((Platform as { OS: string }).OS = v);
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await act(async () => undefined);
};
const KIOSK = 'kiosk/[goalId]';
const TABS = { key: 'tabs-1', name: '(tabs)' };
const KIOSK_G1 = { key: 'kiosk-1', name: KIOSK, params: { goalId: 'g1' } };
const resetTo = (route: object) => ({ type: 'RESET', payload: { index: 0, routes: [route] }, target: APP_STACK_KEY });

beforeEach(() => {
  os = Platform.OS;
  setOs('ios');
  state.path = '/';
  state.marker = null;
  state.unknown = false;
  state.ready = Promise.resolve();
  state.rootState = rootStateWith([TABS]);
  state.authReady = true;
  auth.user = USER;
  listeners.clear();
  router.replace.mockClear();
  navigation.dispatch.mockClear();
  resetKioskLaunchGuardForTests();
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
const emitState = async () => {
  await act(async () => {
    for (const l of [...listeners]) l();
  });
  await settle();
};

describe('W14-O: the root layout mounts the guard', () => {
  it('app/_layout.tsx renders <KioskFlowExitGuard /> once, as the first child of WsfAuthProvider, outside the root Stack', () => {
    const layout = readFileSync(join(APP_ROOT, 'app/_layout.tsx'), 'utf8');
    expect(layout).toContain("import { KioskFlowExitGuard } from '../src/kioskFlowExit';");
    expect(layout.match(/<KioskFlowExitGuard \/>/g)).toHaveLength(1);
    expect(layout).toMatch(/<WsfAuthProvider>\s*<KioskFlowExitGuard \/>/);
    expect(layout.indexOf('<KioskFlowExitGuard />')).toBeLessThan(layout.indexOf('<AppShell />'));
    expect(layout.indexOf('<KioskFlowExitGuard />')).toBeLessThan(layout.indexOf('<Stack'));
  });

  it('(mount) a phone, the marker g1, a visitor signed in, member tabs focused: the RESET to [kiosk g1] is addressed to the app Stack; the launch guard still replaces once', async () => {
    state.marker = 'g1';
    act(() => root.render(<RootLayout />));
    await settle();
    expect(navigation.dispatch).toHaveBeenCalledTimes(1);
    expect(navigation.dispatch).toHaveBeenCalledWith(resetTo({ name: KIOSK, params: { goalId: 'g1' } }));
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/kiosk/g1');
  });

  it('(mount) the kiosk start screen for g1 already in the stack is kept by its key, beneath nothing', async () => {
    state.marker = 'g1';
    state.rootState = rootStateWith([TABS, KIOSK_G1, { key: 'join-1', name: 'join/[joinCode]', params: { joinCode: 'X' } }]);
    act(() => root.render(<RootLayout />));
    await settle();
    expect(navigation.dispatch).toHaveBeenCalledWith(resetTo(KIOSK_G1));
  });

  it('(state) nothing on mount while the kiosk is focused; a change that focuses member Home is answered', async () => {
    state.marker = 'g1';
    state.rootState = rootStateWith([KIOSK_G1]);
    act(() => root.render(<RootLayout />));
    await settle();
    expect(navigation.dispatch).not.toHaveBeenCalled();
    state.rootState = rootStateWith([KIOSK_G1, TABS]);
    await emitState();
    expect(navigation.dispatch).toHaveBeenCalledTimes(1);
    expect(navigation.dispatch).toHaveBeenCalledWith(resetTo(KIOSK_G1));
  });

  it('(auth) nothing while nobody is signed in; the account arriving is answered', async () => {
    state.marker = 'g1';
    auth.user = null;
    act(() => root.render(<RootLayout />));
    await settle();
    expect(navigation.dispatch).not.toHaveBeenCalled();
    auth.user = USER;
    act(() => root.render(<RootLayout />));
    await settle();
    expect(navigation.dispatch).toHaveBeenCalledTimes(1);
  });

  it('(ready) nothing until the marker\'s launch read lands; then answered', async () => {
    let land!: () => void;
    state.ready = new Promise<void>((resolve) => (land = resolve));
    state.unknown = true; // not loaded yet, and no kiosk in the stack: nothing to name
    act(() => root.render(<RootLayout />));
    await settle();
    expect(navigation.dispatch).not.toHaveBeenCalled();
    state.unknown = false;
    state.marker = 'g1';
    await act(async () => {
      land();
      await state.ready;
    });
    await settle();
    expect(navigation.dispatch).toHaveBeenCalledTimes(1);
    expect(navigation.dispatch).toHaveBeenCalledWith(resetTo({ name: KIOSK, params: { goalId: 'g1' } }));
  });

  it('(personal mode) no marker: never, whatever is focused, even with a kiosk start screen beneath', async () => {
    state.rootState = rootStateWith([KIOSK_G1, { key: 'join-1', name: 'join/[joinCode]' }]);
    act(() => root.render(<RootLayout />));
    await settle();
    state.rootState = rootStateWith([KIOSK_G1, { key: 'join-1', name: 'join/[joinCode]' }, TABS]);
    await emitState();
    expect(navigation.dispatch).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('(unmount) the state subscription is released', async () => {
    act(() => root.render(<RootLayout />));
    await settle();
    expect(listeners.size).toBe(1);
    act(() => root.unmount());
    expect(listeners.size).toBe(0);
    root = createRoot(container);
  });

  it('(hook) a navigation whose state cannot be read, or that refuses the dispatch, never throws', async () => {
    state.marker = 'g1';
    const broken = {
      getState: () => {
        throw new Error('no state');
      },
      dispatch: () => {
        throw new Error('refused');
      },
      addListener: () => () => undefined,
    };
    const nav = navigation as unknown as Record<string, unknown>;
    const saved = { getState: nav.getState, dispatch: nav.dispatch };
    Object.assign(nav, { getState: broken.getState, dispatch: broken.dispatch });
    function Probe() {
      useKioskFlowExitGuard();
      return <div data-testid="probe" />;
    }
    try {
      act(() => root.render(<Probe />));
      await settle();
      expect(container.querySelector('[data-testid="probe"]')).not.toBeNull();
      Object.assign(nav, { getState: () => state.rootState, dispatch: broken.dispatch });
      await emitState();
      expect(container.querySelector('[data-testid="probe"]')).not.toBeNull();
    } finally {
      Object.assign(nav, saved);
    }
  });
});

describe('W14-O: the decision (pure)', () => {
  const app = (routes: { key?: string; name: string; params?: object }[], index?: number) => rootStateWith(routes, index) as never;

  it.each([
    ['the kiosk start screen', { name: KIOSK, params: { goalId: 'g1' } }, 'g1', true],
    ['another goal\'s kiosk start screen', { name: KIOSK, params: { goalId: 'g2' } }, 'g1', true],
    ['the kiosk contribution for the marker\'s goal', { name: 'contribute/[goalId]', params: { goalId: 'g1', kiosk: '1' } }, 'g1', true],
    ['the kiosk contribution, flag "true"', { name: 'contribute/[goalId]', params: { goalId: 'g1', kiosk: 'true' } }, 'g1', true],
    ['the kiosk contribution, a repeated flag with one copy set', { name: 'contribute/[goalId]', params: { goalId: 'g1', kiosk: ['0', '1'] } }, 'g1', true],
    ['the kiosk contribution for ANOTHER goal', { name: 'contribute/[goalId]', params: { goalId: 'g2', kiosk: '1' } }, 'g1', false],
    ['a member contribution (no flag)', { name: 'contribute/[goalId]', params: { goalId: 'g1' } }, 'g1', false],
    ['a contribution with the flag off', { name: 'contribute/[goalId]', params: { goalId: 'g1', kiosk: '0' } }, 'g1', false],
    ['the kiosk contribution while the marker is unknown', { name: 'contribute/[goalId]', params: { goalId: 'g9', kiosk: '1' } }, KIOSK_MARKER_UNKNOWN, true],
    ['Sign in', { name: 'signin' }, 'g1', true],
    ['Create account', { name: 'signup' }, 'g1', true],
    ['verify-email', { name: 'verify-email' }, 'g1', true],
    ['profile-setup', { name: 'profile-setup' }, 'g1', true],
    ['reset-password', { name: 'reset-password' }, 'g1', true],
    ['member tabs', { name: '(tabs)' }, 'g1', false],
    ['a join link', { name: 'join/[joinCode]', params: { joinCode: 'X' } }, 'g1', false],
    ['an event screen', { name: 'event/[goalId]', params: { goalId: 'g1' } }, 'g1', false],
    ['a /go marker screen', { name: 'go/[markerSlug]', params: { markerSlug: 'oak' } }, 'g1', false],
    ['Settings', { name: 'settings' }, 'g1', false],
    ['MOVE', { name: 'move/index' }, 'g1', false],
    ['not found', { name: '+not-found' }, 'g1', false],
  ] as const)('inKioskFlow: %s', (_label, route, marker, want) => {
    expect(inKioskFlow(route as never, marker as never)).toBe(want);
  });

  it('nobody signed in: null', () => {
    expect(kioskFlowExitReset(app([TABS]), false, 'g1')).toBeNull();
  });
  it('no marker (personal mode): null, with or without a kiosk beneath', () => {
    expect(kioskFlowExitReset(app([TABS]), true, null)).toBeNull();
    expect(kioskFlowExitReset(app([KIOSK_G1, TABS]), true, null)).toBeNull();
  });
  it('the focused route inside the kiosk flow: null', () => {
    expect(kioskFlowExitReset(app([TABS, KIOSK_G1]), true, 'g1')).toBeNull();
    expect(kioskFlowExitReset(app([KIOSK_G1, { name: 'signin' }]), true, 'g1')).toBeNull();
    expect(kioskFlowExitReset(app([KIOSK_G1, { name: 'contribute/[goalId]', params: { goalId: 'g1', kiosk: '1' } }]), true, 'g1')).toBeNull();
  });
  it('the marker open, member Home focused, no kiosk in the stack: a fresh kiosk start screen for the marker\'s goal, alone', () => {
    expect(kioskFlowExitReset(app([TABS]), true, 'g1')).toEqual(resetTo({ name: KIOSK, params: { goalId: 'g1' } }));
  });
  it('the marker open, a join focused over the kiosk start screen for that goal: that screen kept by its key, alone', () => {
    expect(kioskFlowExitReset(app([TABS, KIOSK_G1, { key: 'join-1', name: 'join/[joinCode]' }]), true, 'g1')).toEqual(resetTo(KIOSK_G1));
  });
  it('the marker open for g1 over another goal\'s kiosk start screen: a fresh g1 start screen, not g2\'s', () => {
    const g2 = { key: 'kiosk-2', name: KIOSK, params: { goalId: 'g2' } };
    expect(kioskFlowExitReset(app([g2, TABS]), true, 'g1')).toEqual(resetTo({ name: KIOSK, params: { goalId: 'g1' } }));
  });
  it('the focused route is the one at the state\'s index, not the last', () => {
    expect(kioskFlowExitReset(app([KIOSK_G1, TABS], 0), true, 'g1')).toBeNull();
    expect(kioskFlowExitReset(app([TABS, KIOSK_G1], 0), true, 'g1')).toEqual(resetTo(KIOSK_G1));
  });
  it('the marker unknown: the nearest kiosk start screen the stack shows, kept by its key; none to name, null', () => {
    const g2 = { key: 'kiosk-2', name: KIOSK, params: { goalId: 'g2' } };
    expect(kioskFlowExitReset(app([KIOSK_G1, g2, TABS]), true, KIOSK_MARKER_UNKNOWN)).toEqual(resetTo(g2));
    expect(kioskFlowExitReset(app([TABS, { name: 'join/[joinCode]' }]), true, KIOSK_MARKER_UNKNOWN)).toBeNull();
  });
  it('a Stack whose state has no key yet, an empty stack, or no state: null', () => {
    expect(kioskFlowExitReset({ routes: [{ name: '__root', state: { index: 0, routes: [TABS] } }] } as never, true, 'g1')).toBeNull();
    expect(kioskFlowExitReset({ routes: [{ name: '__root', state: { key: 'k', index: 0, routes: [] } }] } as never, true, 'g1')).toBeNull();
    expect(kioskFlowExitReset(undefined, true, 'g1')).toBeNull();
    expect(kioskFlowExitReset(null, true, 'g1')).toBeNull();
  });
  it('the app Stack\'s state given directly (no root slot): read as that Stack', () => {
    expect(kioskFlowExitReset({ key: APP_STACK_KEY, index: 0, routes: [TABS] } as never, true, 'g1')).toEqual(resetTo({ name: KIOSK, params: { goalId: 'g1' } }));
  });
});
