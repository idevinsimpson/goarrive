import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, useEffect, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BackHandler, Platform, Text, View } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-INTEGRATOR-1 (I-7: INT-09, INT-10, INT-14). The top of the screen on
 * a notched phone: the shared top-inset helpers, the status-bar policy, the
 * staging strip and the frame below it, and the member menu. The native
 * modules are rendered into jsdom with the safe-area, status-bar and router
 * modules mocked at their boundary; Platform.OS is set per case. No device:
 * where a pixel lands on an iPhone is Appendix C.
 */

const state = {
  top: 59,
  strip: false,
  focused: true,
  builtAt: 'unknown',
  focusListeners: new Set<() => void>(),
};
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: state.top, bottom: 34, left: 0, right: 0 }),
  SafeAreaProvider: ({ children, testID }: { children: ReactNode; testID?: string }) => (
    <div data-testid={testID ?? 'safe-area-provider'} data-provider="1">
      {children}
    </div>
  ),
}));
vi.mock('expo-status-bar', () => ({
  StatusBar: ({ style }: { style: string }) => <span data-testid="status-bar" data-style={style} />,
}));
vi.mock('expo-router', () => ({
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
vi.mock('../src/stagingStrip', () => ({
  get STAGING_STRIP_UNDER_STATUS_BAR() {
    return state.strip;
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
const webShell = await import('../src/stagingShell');
const { frameFor, screenLayoutFor } = await import('../src/stagingShell.native');
const { StagingBanner, builtAtLabel } = await import('../src/StagingBanner');
const { statusBarStyleFor } = await import('../src/ui/statusBarPolicy');
const { buildInfoFrom } = await import('../src/nativeBuildInfo.native');
const { nativeBuildInfo: webBuildInfo } = await import('../src/nativeBuildInfo');
const { MemberTopBar } = await import('../src/ui/MemberTopBar');

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
  state.top = 59;
  state.strip = false;
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
    // Below a staging strip (or on a phone without a notch) the inset is 0 and nothing is drawn.
    state.top = 0;
    act(() => root.render(<native.ScreenTopSpacer />));
    expect(byId('wsf-screen-top-spacer')).toBeNull();
  });

  it('the policy: light over navy, dark over cream, light everywhere over a native staging strip', () => {
    expect(statusBarStyleFor('navy', false)).toBe('light');
    expect(statusBarStyleFor('cream', false)).toBe('dark');
    expect(statusBarStyleFor('cream', true)).toBe('light');
    expect(statusBarStyleFor('navy', true)).toBe('light');
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
    state.strip = true;
    act(() => root.render(<native.ScreenStatusBar tone="navy" key="again" />));
    act(() => root.render(<native.ScreenStatusBar tone="cream" key="strip" />));
    expect(byId('status-bar')!.dataset.style).toBe('light');
  });

  it('the root StatusBar is the cream default (light over a native staging strip)', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toContain("<StatusBar style={statusBarStyleFor('cream', STAGING_STRIP_UNDER_STATUS_BAR)} />");
    expect(layout).not.toContain('<StatusBar style="dark" />');
  });
});

describe('INT-10: the staging strip', () => {
  it('native: paints behind the status bar and starts its text below it', () => {
    setOs('ios');
    act(() => root.render(<StagingBanner />));
    expect(byId('wsf-staging-banner')!.style.paddingTop).toBe('65px');
    expect(byId('wsf-staging-banner-text')!.textContent).toBe('STAGING · TEST DATA · not the live service');
  });

  it('web: exactly the row it was (no padding change, the same text)', () => {
    setOs('web');
    state.top = 0;
    state.builtAt = '2026-10-21T01:23:45Z';
    act(() => root.render(<StagingBanner />));
    expect(byId('wsf-staging-banner')!.style.paddingTop).toBe('');
    expect(byId('wsf-staging-banner-build')!.textContent).toBe('build abc1234');
  });

  it('native: names the binary\'s commit and build time; a build with no stamp says nothing more', () => {
    setOs('android');
    state.builtAt = '2026-10-21T01:23:45Z';
    act(() => root.render(<StagingBanner />));
    expect(byId('wsf-staging-banner-build')!.textContent).toBe('build abc1234 · 2026-10-21 01:23Z');
    state.builtAt = 'unknown';
    act(() => root.render(<StagingBanner key="unstamped" />));
    expect(byId('wsf-staging-banner-build')!.textContent).toBe('build abc1234');
    expect(builtAtLabel('2026-10-21T01:23:45Z')).toBe(' · 2026-10-21 01:23Z');
    expect(builtAtLabel('unknown')).toBe('');
  });

  it('the binary\'s stamp is read from its app config, keeping only well-formed values; web has none', () => {
    expect(buildInfoFrom({ wsfBuild: { commit: '9f3c2ab', builtAt: '2026-10-21T01:23:45Z' } })).toEqual({
      commit: '9f3c2ab',
      builtAt: '2026-10-21T01:23:45Z',
    });
    expect(buildInfoFrom({ wsfBuild: { commit: 'not a sha', builtAt: 'yesterday' } })).toEqual({ commit: undefined, builtAt: undefined });
    expect(buildInfoFrom(undefined)).toEqual({ commit: undefined, builtAt: undefined });
    expect(webBuildInfo).toEqual({});
  });

  it('a staging stack gets its own provider below the strip; production and web keep the plain frame', () => {
    const Staged = frameFor(true);
    act(() => root.render(<Staged><Text testID="child">x</Text></Staged>));
    expect(byId('wsf-staging-stack-frame')!.querySelector('[data-testid="child"]')).not.toBeNull();
    const Plain = frameFor(false);
    act(() => root.render(<Plain><Text testID="child">x</Text></Plain>));
    expect(byId('wsf-staging-stack-frame')).toBeNull();
    const plainHtml = container.innerHTML;
    act(() => root.render(<webShell.StagingStackFrame><Text testID="child">x</Text></webShell.StagingStackFrame>));
    expect(container.innerHTML).toBe(plainHtml);
    expect(webShell.stagingScreenLayout).toBeUndefined();
  });

  it('iOS staging: a transparent modal repeats the strip at its top, with its content in a provider below it', () => {
    setOs('ios');
    expect(screenLayoutFor(false, 'ios')).toBeUndefined();
    expect(screenLayoutFor(true, 'android')).toBeUndefined();
    const layout = screenLayoutFor(true, 'ios')!;
    const child = <Text testID="screen">screen</Text>;
    // A page is left exactly as it is.
    expect(layout({ options: {}, children: child })).toBe(child);
    expect(layout({ options: { presentation: 'card' }, children: child })).toBe(child);
    act(() => root.render(layout({ options: { presentation: 'transparentModal' }, children: child })));
    const frame = byId('wsf-staging-modal-frame')!;
    const [banner, below] = Array.from(frame.children) as HTMLElement[];
    expect(banner!.dataset.testid).toBe('wsf-staging-banner');
    expect(banner!.style.paddingTop).toBe('65px');
    expect(below!.dataset.provider).toBe('1');
    expect(below!.querySelector('[data-testid="screen"]')).not.toBeNull();
  });

  it('AppShell wires the frame and the layout around the stack', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toMatch(/<StagingStackFrame>\s*<Stack\s*screenLayout=\{stagingScreenLayout\}/);
    expect(layout).toContain('</Stack>\n      </StagingStackFrame>');
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
    expect(layer.style.height).not.toBe('');
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
