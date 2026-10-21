import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, useEffect, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BackHandler, Dimensions, Platform, Text, View } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-INTEGRATOR-1 (I-7: INT-09, INT-10, INT-14). The top of the screen on
 * a notched phone: the shared top-inset helpers, the status-bar policy, the
 * build stamp that feeds Build details, and the member menu (W12-26: the
 * strip a test build used to draw is gone, by the owner's UI-copy order). The native
 * modules are rendered into jsdom with the safe-area, status-bar and router
 * modules mocked at their boundary; Platform.OS is set per case. No device:
 * where a pixel lands on an iPhone is Appendix C.
 */

const WINDOW = { insets: { top: 59, bottom: 34, left: 0, right: 0 }, frame: { x: 0, y: 0, width: 393, height: 852 } };
const state = {
  window: WINDOW as typeof WINDOW | null,
  top: 59,
  focused: true,
  builtAt: 'unknown',
  focusListeners: new Set<() => void>(),
};
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: state.top, bottom: 34, left: 0, right: 0 }),
  get initialWindowMetrics() {
    return state.window;
  },
  SafeAreaProvider: ({
    children,
    testID,
    initialMetrics,
  }: {
    children: ReactNode;
    testID?: string;
    initialMetrics?: { insets: { top: number; bottom: number } } | null;
  }) => (
    <div
      data-testid={testID ?? 'safe-area-provider'}
      data-provider="1"
      data-initial-top={initialMetrics ? String(initialMetrics.insets.top) : 'none'}
      data-initial-bottom={initialMetrics ? String(initialMetrics.insets.bottom) : 'none'}
    >
      {children}
    </div>
  ),
}));
vi.mock('expo-status-bar', () => ({
  StatusBar: ({ style }: { style: string }) => <span data-testid="status-bar" data-style={style} />,
}));
vi.mock('expo-router', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  // Focus as the navigator reports it, switchable from the test.
  useFocusEffect: (cb: () => void | (() => void)) => {
    const [focused, setFocused] = useState(state.focused);
    useEffect(() => {
      const l = () => setFocused(state.focused);
      state.focusListeners.add(l);
      return () => {
        state.focusListeners.delete(l);
      };
    }, []);
    useEffect(() => (focused ? cb() : undefined), [focused, cb]);
  },
}));
vi.mock('../src/firebase', () => ({ wsfIsStaging: true }));
vi.mock('../src/buildStamp', () => ({
  WSF_BUILD_STAMP: {
    commitSha: 'abc1234',
    get builtAt() {
      return state.builtAt;
    },
  },
}));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
// The banner and the shells use the native helpers here, not the web stubs vitest would resolve.
vi.mock('../src/ui/useScreenTopInset', async () => import('../src/ui/useScreenTopInset.native'));

const native = await import('../src/ui/useScreenTopInset.native');
// The real web module (this file mocks the import path to the native one, above).
const web = await vi.importActual<typeof import('../src/ui/useScreenTopInset')>('../src/ui/useScreenTopInset');
const { statusBarStyleFor } = await import('../src/ui/statusBarPolicy');
const { buildInfoFrom } = await import('../src/nativeBuildInfo.native');
const { nativeBuildInfo: webBuildInfo } = await import('../src/nativeBuildInfo');
const { MemberTopBar } = await import('../src/ui/MemberTopBar');
const { FormShell } = await import('../src/AuthFormPrimitives');

const APP_ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(APP_ROOT, p), 'utf8');

let container: HTMLDivElement;
let root: Root;
let os: string;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const setOs = (v: string) => ((Platform as { OS: string }).OS = v);
const setFocused = (v: boolean) => {
  state.focused = v;
  state.focusListeners.forEach((l) => l());
};

beforeEach(() => {
  os = Platform.OS;
  state.window = WINDOW;
  state.top = 59;
  state.focused = true;
  state.builtAt = 'unknown';
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

describe('INT-09: the top inset and the status bar', () => {
  it('web: no inset, no spacer, no status bar (the browser owns the status area)', () => {
    expect(web.useScreenTopInset()).toBe(0);
    expect(web.ScreenTopSpacer()).toBeNull();
    expect(web.ScreenStatusBar({ tone: 'navy' })).toBeNull();
  });

  it('native: the inset is the nearest provider\'s top, and the spacer is that tall', () => {
    function Probe() {
      return <Text testID="inset">{String(native.useScreenTopInset())}</Text>;
    }
    act(() =>
      root.render(
        <View>
          <Probe />
          <native.ScreenTopSpacer />
        </View>,
      ),
    );
    expect(byId('inset')!.textContent).toBe('59');
    expect(byId('wsf-screen-top-spacer')!.style.height).toBe('59px');
    // On a phone without a notch the inset is 0 and nothing is drawn.
    state.top = 0;
    act(() => root.render(<native.ScreenTopSpacer />));
    expect(byId('wsf-screen-top-spacer')).toBeNull();
  });

  it('the policy: light over navy, dark over cream (W12-26: no strip, so the tone alone decides)', () => {
    expect(statusBarStyleFor('navy')).toBe('light');
    expect(statusBarStyleFor('cream')).toBe('dark');
  });

  it('a navy screen sets light icons only while focused; leaving it hands the status bar back', () => {
    act(() => root.render(<native.ScreenStatusBar tone="navy" />));
    expect(byId('status-bar')!.dataset.style).toBe('light');
    act(() => setFocused(false));
    expect(byId('status-bar')).toBeNull();
    act(() => setFocused(true));
    expect(byId('status-bar')!.dataset.style).toBe('light');
    act(() => root.render(<native.ScreenStatusBar tone="cream" />));
    expect(byId('status-bar')!.dataset.style).toBe('dark');
  });

  it('the root StatusBar is the cream default, by the policy alone (W12-26)', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toContain("<StatusBar style={statusBarStyleFor('cream')} />");
    expect(layout).not.toContain('<StatusBar style="dark" />');
    expect(layout).not.toContain('STAGING_STRIP_UNDER_STATUS_BAR');
  });
});

describe('#641 F1: under the signed-in member shell the top is already cleared', () => {
  function Probe() {
    return <Text testID="inset">{String(native.useScreenTopInset())}</Text>;
  }

  it('inside TopCleared the inset is 0 and no screen sets the status bar; outside it nothing changes', () => {
    act(() =>
      root.render(
        <native.TopCleared cleared>
          <Probe />
          <native.ScreenTopSpacer />
          <native.ScreenStatusBar tone="navy" />
        </native.TopCleared>,
      ),
    );
    expect(byId('inset')!.textContent).toBe('0');
    expect(byId('wsf-screen-top-spacer')).toBeNull();
    expect(byId('status-bar')).toBeNull();
    // Signed out the shell clears nothing (no top bar): the screen clears it itself.
    act(() =>
      root.render(
        <native.TopCleared cleared={false}>
          <Probe />
          <native.ScreenStatusBar tone="navy" />
        </native.TopCleared>,
      ),
    );
    expect(byId('inset')!.textContent).toBe('59');
    expect(byId('status-bar')!.dataset.style).toBe('light');
  });

  it('iOS, 59 pt inset: a FormShell inside a tab (a challenge page, a join gate) adds no second gap and no white icons', () => {
    setOs('ios');
    const field = () => byId('wsf-form-wordmark')!.parentElement!.parentElement!;
    act(() =>
      root.render(
        <native.TopCleared cleared>
          <FormShell heading="Challenge" step="Members only" testID="wsf-challenge-not-member">
            <Text>body</Text>
          </FormShell>
        </native.TopCleared>,
      ),
    );
    expect(field().style.paddingTop).toBe('');
    expect(byId('status-bar')).toBeNull();
    // The same FormShell as a root-stack screen (sign in) still clears the status bar, under light icons.
    act(() =>
      root.render(
        <FormShell heading="Sign in" step="Step 1 of 2" testID="wsf-signin">
          <Text>body</Text>
        </FormShell>,
      ),
    );
    expect(field().style.paddingTop).toBe(`${28 + 59}px`);
    expect(byId('status-bar')!.dataset.style).toBe('light');
  });

  it('the shell wraps its scenes, and only them, in TopCleared while signed in', () => {
    const layout = read('app/(tabs)/_layout.tsx');
    expect(layout).toContain('<TopCleared cleared={signedIn}>');
    // The bar itself stays outside: it is what clears the status bar.
    expect(layout.indexOf('<MemberTopBar')).toBeLessThan(layout.indexOf('<TopCleared cleared={signedIn}>'));
    expect(layout.indexOf('<TopCleared cleared={signedIn}>')).toBeLessThan(layout.indexOf('<Tabs\n          backBehavior'));
    expect(layout.indexOf('</Tabs>')).toBeLessThan(layout.indexOf('</TopCleared>'));
  });

  it('web: TopCleared is just its children (no element)', async () => {
    const webModule = await vi.importActual<typeof import('../src/ui/useScreenTopInset')>('../src/ui/useScreenTopInset');
    act(() => root.render(<View testID="x"><Text>a</Text></View>));
    const plain = container.innerHTML;
    act(() =>
      root.render(
        <webModule.TopCleared cleared>
          <View testID="x"><Text>a</Text></View>
        </webModule.TopCleared>,
      ),
    );
    expect(container.innerHTML).toBe(plain);
  });
});

describe('INT-10: the build stamp (Build details)', () => {
  it('the binary\'s stamp is read from its app config, keeping only well-formed values; web has none', () => {
    expect(buildInfoFrom({ wsfBuild: { commit: '9f3c2ab', builtAt: '2026-10-21T01:23:45Z' } })).toEqual({
      commit: '9f3c2ab',
      builtAt: '2026-10-21T01:23:45Z',
    });
    expect(buildInfoFrom({ wsfBuild: { commit: 'not a sha', builtAt: 'yesterday' } })).toEqual({ commit: undefined, builtAt: undefined });
    expect(buildInfoFrom(undefined)).toEqual({ commit: undefined, builtAt: undefined });
    expect(webBuildInfo).toEqual({});
  });
});

describe('INT-14: the member menu on a notched phone', () => {
  const onNavigate = vi.fn();
  const onSignOut = vi.fn();
  const MENU = [
    { kind: 'link' as const, key: 'settings', label: 'Settings', href: '/settings', onNavigate },
    { kind: 'action' as const, key: 'signout', label: 'Sign out', onPress: onSignOut },
  ];
  function Harness({ onToggle }: { onToggle?: (next: boolean) => void }) {
    const [open, setOpen] = useState(false);
    return (
      <MemberTopBar
        onHome={vi.fn()}
        menu={MENU}
        menuOpen={open}
        onMenuToggle={(next) => {
          onToggle?.(next);
          setOpen(next);
        }}
      />
    );
  }

  it('iOS: the open sheet hangs from the hairline at insets.top + 62, not over the button', () => {
    setOs('ios');
    act(() => root.render(<Harness />));
    act(() => byId('wsf-member-topbar-menu-button')!.click());
    expect(byId('wsf-member-topbar-menu')!.style.top).toBe('121px');
  });

  it('native: a tap outside closes the menu and activates nothing beneath it', () => {
    setOs('android');
    // An edge-to-edge Android phone whose window is shorter than its screen.
    vi.spyOn(Dimensions, 'get').mockImplementation(((dim: string) =>
      dim === 'screen' ? { width: 412, height: 900, scale: 2.6, fontScale: 1 } : { width: 412, height: 820, scale: 2.6, fontScale: 1 }) as never);
    onNavigate.mockClear();
    onSignOut.mockClear();
    const onHome = vi.fn();
    const toggles: boolean[] = [];
    function Open() {
      const [open, setOpen] = useState(true);
      return (
        <MemberTopBar
          onHome={onHome}
          menu={MENU}
          menuOpen={open}
          onMenuToggle={(n) => {
            toggles.push(n);
            setOpen(n);
          }}
        />
      );
    }
    act(() => root.render(<Open />));
    const layer = byId('wsf-member-topbar-menu-dismiss')!;
    // Over the bar (drawn after it) and under the sheet (drawn before it).
    const order = Array.from(byId('wsf-member-topbar')!.children).map((e) => (e as HTMLElement).dataset.testid ?? 'bar');
    expect(order).toEqual(['bar', 'wsf-member-topbar-menu-dismiss', 'wsf-member-topbar-menu']);
    // NB-6: the screen's height (here taller than the window) plus both insets, so the Android tab bar cannot take the tap.
    expect(layer.style.height).toBe(`${900 + 59 + 34}px`);
    act(() => layer.click());
    expect(toggles).toEqual([false]);
    expect(byId('wsf-member-topbar-menu')).toBeNull();
    expect(onHome).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('Android: Back closes the open menu before any navigation, and lets go once it is closed', () => {
    setOs('android');
    const handlers: Array<() => boolean> = [];
    const removed: number[] = [];
    vi.spyOn(BackHandler, 'addEventListener').mockImplementation(((_e: string, h: () => boolean) => {
      handlers.push(h);
      const i = handlers.length - 1;
      return { remove: () => removed.push(i) };
    }) as never);
    act(() => root.render(<Harness />));
    expect(handlers).toHaveLength(0);
    act(() => byId('wsf-member-topbar-menu-button')!.click());
    expect(handlers).toHaveLength(1);
    let consumed = false;
    act(() => {
      consumed = handlers[0]!();
    });
    expect(consumed).toBe(true);
    expect(byId('wsf-member-topbar-menu')).toBeNull();
    expect(removed).toEqual([0]);
  });

  it('web: nothing changes (the sheet on the hairline, no layer, no Back)', () => {
    setOs('web');
    const add = vi.spyOn(BackHandler, 'addEventListener');
    act(() => root.render(<Harness />));
    act(() => byId('wsf-member-topbar-menu-button')!.click());
    expect(byId('wsf-member-topbar-menu')!.style.top).toBe('');
    expect(byId('wsf-member-topbar-menu-dismiss')).toBeNull();
    expect(add).not.toHaveBeenCalled();
  });

  it('a tab change on a phone finds the menu closed', () => {
    expect(read('app/(tabs)/_layout.tsx')).toContain(
      "screenListeners={Platform.OS === 'web' ? undefined : { focus: () => setMenuOpen(false) }}",
    );
  });
});
