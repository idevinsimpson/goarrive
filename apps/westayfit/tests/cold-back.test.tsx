import { act, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * INT-28 (W12-14) — Android Back from a lone cold-link route goes Home, and a
 * link to nothing gets this app's own screen. The pure decision
 * (src/ui/coldBack.ts), the root layout's listener (app/_layout.tsx) and
 * app/+not-found.tsx. BackHandler is a fake that calls the newest listener
 * first, as Android does.
 *
 * THE MOUNT ORDER IS expo-router 6's (RV13-641-F2). The navigation container
 * stand-in registers its Back listener in commit 1 and renders its children
 * only in a later commit (on Android the initial URL is a Promise, and the
 * safe-area provider renders nothing until the native insets arrive). The
 * route is a screen whose own Back handler registers through an expo-router-
 * like focus effect, deferred until its navigation object is set in a passive
 * effect, as expo-router's useFocusEffect is (INT-19 on the contribution
 * screen). So the real order Android calls them in is screen → cold-back →
 * container.
 */

const ctl = vi.hoisted(() => ({
  os: 'android' as 'ios' | 'android' | 'web',
  listeners: [] as Array<() => boolean>,
  rootState: null as unknown,
  calls: [] as string[],
  dispatched: [] as unknown[],
  /** Who was asked, in order, on the last Back. */
  asked: [] as string[],
  /** The route the root Stack renders (a stand-in screen), or none. */
  screen: null as null | ComponentType,
  /** Whether that screen's own Back handler consumes the press (INT-19). */
  screenConsumes: false,
}));

vi.mock('react-native', async () => {
  const actual = (await vi.importActual('react-native-web')) as Record<string, any>;
  return {
    ...actual,
    Platform: {
      ...actual.Platform,
      get OS() {
        return ctl.os;
      },
      select: (o: Record<string, unknown>) => (ctl.os in o ? o[ctl.os] : ctl.os !== 'web' && 'native' in o ? o.native : o.default),
    },
    BackHandler: {
      addEventListener: (_e: string, h: () => boolean) => {
        ctl.listeners.push(h);
        return { remove: () => (ctl.listeners = ctl.listeners.filter((x) => x !== h)) };
      },
    },
  };
});

vi.mock('expo-router', async () => {
  const React = await import('react');
  // The root layout's own navigation object: its screen in expo-router's
  // internal root navigator. Only the cold-back listener reads it on Back.
  const navigation = {
    getState: () => {
      ctl.asked.push('cold-back');
      return ctl.rootState;
    },
    dispatch: (a: unknown) => ctl.dispatched.push(a),
  };
  // The root Stack renders its focused route (the test's stand-in screen).
  const Stack = Object.assign(
    ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children, ctl.screen ? React.createElement(ctl.screen) : null),
    { Screen: () => null },
  );
  return {
    Stack,
    useNavigation: () => navigation,
    router: { replace: (h: string) => ctl.calls.push(`replace ${h}`) },
    Unmatched: () => React.createElement('div', { 'data-testid': 'expo-router-unmatched' }, 'Unmatched Route · Sitemap'),
  };
});
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('../src/crashContainment', () => ({}));
vi.mock('../src/auth', () => ({ WsfAuthProvider: ({ children }: { children?: ReactNode }) => <>{children}</> }));
vi.mock('../src/firebase', () => ({ getFirebaseApp: () => ({}), wsfIsStaging: false }));
vi.mock('../src/InAppBrowserBanner', () => ({ InAppBrowserBanner: () => null }));
vi.mock('../src/StagingBanner', () => ({ StagingBanner: () => null }));
vi.mock('../src/kioskLaunchGuard', () => ({ useKioskLaunchGuard: () => undefined }));
vi.mock('../src/stagingShell', () => ({
  StagingStackFrame: ({ children }: { children?: ReactNode }) => <>{children}</>,
  stagingScreenLayout: undefined,
}));
vi.mock('../src/crashHarness', () => ({ fireAsyncCrashFaults: () => undefined, injectedRenderFault: () => undefined }));
vi.mock('../src/ui/RouteErrorFallback', () => ({ nativeErrorBoundary: () => undefined }));
vi.mock('../src/ui/useReducedMotion', () => ({ useReducedMotion: () => false }));
vi.mock('../src/ui/useScreenTopInset', () => ({ useScreenTopInset: () => 0 }));

import { appRootState, COLD_BACK_ROUTES, coldBackHandler, coldBackReset } from '../src/ui/coldBack';
import { SIGNED_OUT_HOME_RESET } from '../src/ui/signOutReset';

const { default: RootLayout } = await import('../app/_layout');
const { default: NotFound } = await import('../app/+not-found');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  ctl.os = 'android';
  ctl.listeners = [];
  ctl.rootState = container_(lone('settings'));
  ctl.calls = [];
  ctl.dispatched = [];
  ctl.asked = [];
  ctl.screen = null;
  ctl.screenConsumes = false;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const lone = (name: string, params?: object) => ({ key: 'stack-root', index: 0, routes: [{ name, ...(params ? { params } : {}) }] });
/** The container's root state as expo-router has it: the app's Stack inside the internal `__root` slot. */
const container_ = (stack: object) => ({ key: 'internal', index: 0, routes: [{ name: '__root', state: stack }] });
const RESET_TO_STACK = { ...SIGNED_OUT_HOME_RESET, target: 'stack-root' };

describe('coldBackReset', () => {
  it('a lone member route (join, a marker, Settings, sign-in, the flows) resets to (tabs)/Home', () => {
    for (const name of COLD_BACK_ROUTES) {
      expect(coldBackReset(lone(name)), name).toBe(SIGNED_OUT_HOME_RESET);
      // As the container gives it: inside expo-router's internal root slot.
      expect(coldBackReset(container_(lone(name))), name).toBe(SIGNED_OUT_HOME_RESET);
    }
    expect([...COLD_BACK_ROUTES].sort()).toEqual(
      [
        'contribute/[goalId]',
        'go/[markerSlug]',
        'goals/new',
        'join/[joinCode]',
        'move/index',
        'reset-password',
        'settings',
        'settings/privacy',
        'signin',
        'signup',
        'start-community',
      ].sort(),
    );
  });

  it('the tabs, the venue and kiosk surfaces and the self-routing gates are left to Android', () => {
    for (const name of [
      '(tabs)',
      'kiosk/[goalId]',
      'station/[goalId]',
      'display/[goalId]',
      'queue/[goalId]',
      'event/[goalId]',
      'combined/[setupId]',
      'verify-email',
      'profile-setup',
      'move/[goalId]',
      'health',
    ]) {
      expect(coldBackReset(lone(name)), name).toBeNull();
    }
  });

  it('a kiosk’s contribution is the kiosk’s, not member Home’s', () => {
    expect(coldBackReset(lone('contribute/[goalId]', { goalId: 'g1', kiosk: '1' }))).toBeNull();
    expect(coldBackReset(lone('contribute/[goalId]', { goalId: 'g1', mode: 'move' }))).toBe(SIGNED_OUT_HOME_RESET);
  });

  it('a deeper stack, or no state at all, is left alone', () => {
    expect(coldBackReset({ index: 1, routes: [{ name: '(tabs)' }, { name: 'settings' }] })).toBeNull();
    expect(coldBackReset({ index: 1, routes: [{ name: 'signin' }, { name: 'signup' }] })).toBeNull();
    expect(coldBackReset(container_({ key: 's', index: 1, routes: [{ name: '(tabs)' }, { name: 'settings' }] }))).toBeNull();
    expect(coldBackReset(undefined)).toBeNull();
    expect(coldBackReset({ routes: [] })).toBeNull();
    expect(coldBackReset(container_({}))).toBeNull();
  });

  it('the handler consumes the press only when it resets, addressing the app’s root Stack by its key', () => {
    const dispatched: unknown[] = [];
    const nav = (state: object) => ({ getState: () => state, dispatch: (a: unknown) => dispatched.push(a) });
    expect(coldBackHandler(nav(container_(lone('join/[joinCode]'))))()).toBe(true);
    expect(dispatched).toEqual([RESET_TO_STACK]);
    expect(coldBackHandler(nav(container_(lone('kiosk/[goalId]'))))()).toBe(false);
    // A Stack state with no key yet: nothing to address, so nothing is sent.
    expect(coldBackHandler(nav(container_({ index: 0, routes: [{ name: 'settings' }] })))()).toBe(false);
    expect(dispatched).toHaveLength(1);
  });
});

/**
 * Stands in for expo-router 6's navigation container ABOVE the root layout. Its
 * Back listener (useBackButton, called before its early return) goes in in
 * commit 1, while it renders nothing; the children (the root layout and its
 * routes) render in a later commit.
 */
function NavigationContainerStandIn({ children }: { children?: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // React Navigation: go back if the app's Stack has anything under its top route.
    const h = () => {
      ctl.asked.push('container');
      if ((appRootState(ctl.rootState as never)?.routes?.length ?? 0) < 2) return false;
      ctl.calls.push('react-navigation goBack');
      return true;
    };
    ctl.listeners.push(h);
    const t = setTimeout(() => setReady(true), 0);
    return () => {
      clearTimeout(t);
      ctl.listeners = ctl.listeners.filter((x) => x !== h);
    };
  }, []);
  return ready ? <>{children}</> : null;
}

/**
 * A route with its own Back handler, registered as expo-router's useFocusEffect
 * does it (INT-19 on the contribution screen): only once the navigation object
 * has been set, in a passive effect, so a commit after the screen mounts.
 */
function ScreenWithBackHandler() {
  const [navigation, setNavigation] = useState<object | null>(null);
  useEffect(() => setNavigation({}), []);
  useEffect(() => {
    if (!navigation) return undefined;
    const h = () => {
      ctl.asked.push('screen');
      if (!ctl.screenConsumes) return false;
      ctl.calls.push('screen handles Back');
      return true;
    };
    ctl.listeners.push(h);
    return () => {
      ctl.listeners = ctl.listeners.filter((x) => x !== h);
    };
  }, [navigation]);
  return null;
}

/** Android's hardware Back: the newest listener first, until one returns true. */
function pressBack(): boolean {
  ctl.asked = [];
  for (const h of [...ctl.listeners].reverse()) if (h()) return true;
  return false;
}

/** Mounts the tree in expo-router's order: the container's commit 1, then everything deferred. */
function showLayout() {
  vi.useFakeTimers();
  try {
    act(() =>
      root.render(
        <NavigationContainerStandIn>
          <RootLayout />
        </NavigationContainerStandIn>,
      ),
    );
    // Commit 1: the container's listener, and nothing rendered under it yet.
    expect(ctl.listeners).toHaveLength(1);
    act(() => vi.runAllTimers());
  } finally {
    vi.useRealTimers();
  }
}

describe('the root layout’s Back listener (Android only), in expo-router’s real mount order', () => {
  it('Android: registered once, after the container’s and before the screen’s, so it is asked second: screen → cold-back → container', () => {
    ctl.screen = ScreenWithBackHandler;
    ctl.rootState = container_(lone('kiosk/[goalId]')); // nobody consumes: everyone is asked
    showLayout();
    expect(ctl.listeners).toHaveLength(3);
    expect(pressBack()).toBe(false);
    expect(ctl.asked).toEqual(['screen', 'cold-back', 'container']);
    expect(ctl.dispatched).toEqual([]);
  });

  it('Android: a screen’s own handler (INT-19 on a cold, lone contribution) decides first; cold-back is never asked', () => {
    ctl.screen = ScreenWithBackHandler;
    ctl.screenConsumes = true;
    ctl.rootState = container_(lone('contribute/[goalId]', { goalId: 'g1' }));
    showLayout();
    expect(pressBack()).toBe(true);
    expect(ctl.asked).toEqual(['screen']);
    expect(ctl.calls).toEqual(['screen handles Back']);
    expect(ctl.dispatched).toEqual([]);
  });

  it('Android: the screen passes on a lone cold Settings → cold-back resets to Home and consumes the press; React Navigation is not reached', () => {
    ctl.screen = ScreenWithBackHandler;
    showLayout();
    expect(pressBack()).toBe(true);
    expect(ctl.asked).toEqual(['screen', 'cold-back']);
    expect(ctl.dispatched).toEqual([RESET_TO_STACK]);
    expect(ctl.calls).toEqual([]);
  });

  it('Android: anything under the top route (depth > 1, even over an allowlisted route) → cold-back passes and React Navigation goes back', () => {
    ctl.screen = ScreenWithBackHandler;
    for (const stack of [
      { key: 'stack-root', index: 1, routes: [{ name: 'join/[joinCode]' }, { name: 'signin' }] },
      { key: 'stack-root', index: 1, routes: [{ name: '(tabs)' }, { name: 'settings' }] },
    ]) {
      ctl.rootState = container_(stack);
      ctl.calls = [];
      showLayout();
      expect(pressBack()).toBe(true);
      expect(ctl.asked).toEqual(['screen', 'cold-back', 'container']);
      expect(ctl.calls).toEqual(['react-navigation goBack']);
      expect(ctl.dispatched).toEqual([]);
      act(() => root.unmount());
      root = createRoot(container);
    }
  });

  it('Android: a lone kiosk, with nothing under it → nobody consumes, and Back leaves as Android expects', () => {
    ctl.rootState = container_(lone('kiosk/[goalId]'));
    showLayout();
    expect(pressBack()).toBe(false);
    expect(ctl.asked).toEqual(['cold-back', 'container']);
    expect(ctl.dispatched).toEqual([]);
  });

  it('iOS and the web register nothing', () => {
    for (const os of ['ios', 'web'] as const) {
      ctl.os = os;
      ctl.listeners = [];
      showLayout();
      expect(ctl.listeners).toHaveLength(1); // the container's own only
      act(() => root.unmount());
      root = createRoot(container);
    }
  });

  it('unmounting removes it', () => {
    showLayout();
    expect(ctl.listeners).toHaveLength(2);
    act(() => root.unmount());
    root = createRoot(container);
    expect(ctl.listeners).toHaveLength(0);
  });
});

describe('app/+not-found.tsx', () => {
  for (const os of ['ios', 'android'] as const) {
    it(`${os}: this app’s screen — a sentence and Go Home, never the Sitemap`, () => {
      ctl.os = os;
      act(() => root.render(<NotFound />));
      expect(container.querySelector('[data-testid="wsf-not-found"]')).not.toBeNull();
      expect(container.textContent).not.toMatch(/Sitemap/);
      expect(container.querySelector('[data-testid="expo-router-unmatched"]')).toBeNull();
      act(() => (container.querySelector('[data-testid="wsf-not-found-home"]') as HTMLElement).click());
      expect(container.querySelector('[data-testid="wsf-not-found-home"]')!.textContent).toBe('Go Home');
      expect(ctl.calls).toEqual(['replace /']);
    });
  }

  it('web: expo-router’s Unmatched, as before', () => {
    ctl.os = 'web';
    act(() => root.render(<NotFound />));
    expect(container.querySelector('[data-testid="expo-router-unmatched"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="wsf-not-found"]')).toBeNull();
  });
});
