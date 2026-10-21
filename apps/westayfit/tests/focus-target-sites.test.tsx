import { act, useRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Dimensions } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * W12-9 part 2 (INT-17). The two integrator controls a flow returns focus to
 * on a phone: the tab bar's MOVE button (MOVE's opener) and the top bar's
 * menu button (Settings, opened from the menu). They register through
 * src/ui/focusTarget.ts, whose native twin is focusReturn.native's own
 * registry. Rendered here with the native twins (Metro's resolution), the
 * screen reader's focus recorded at react-native's boundary, the shell's
 * navigation events driven by hand. No device.
 */
const fx = vi.hoisted(() => ({ os: 'android' as 'android' | 'ios' | 'web', focused: [] as unknown[] }));
vi.mock('react-native', async () => {
  const actual = (await vi.importActual('react-native-web')) as Record<string, any>;
  return {
    ...actual,
    Platform: {
      ...actual.Platform,
      get OS() {
        return fx.os;
      },
      select: (o: Record<string, unknown>) => (fx.os in o ? o[fx.os] : o.default),
    },
    AccessibilityInfo: { ...actual.AccessibilityInfo, setAccessibilityFocus: (node: unknown) => fx.focused.push(node) },
    InteractionManager: { runAfterInteractions: (cb: () => void) => (cb(), { cancel: () => undefined }) },
    findNodeHandle: (x: unknown) => x,
  };
});
vi.mock('../src/ui/focusTarget', async () => import('../src/ui/focusTarget.native'));
type Route = { key: string; name: string };
const nav = { routes: [] as Route[], listeners: {} as Record<string, Array<() => void>> };
vi.mock('expo-router', () => ({
  useNavigation: () => ({
    getState: () => ({ index: nav.routes.length - 1, routes: nav.routes }),
    addListener: (event: string, cb: () => void) => {
      (nav.listeners[event] ??= []).push(cb);
      return () => {
        nav.listeners[event] = (nav.listeners[event] ?? []).filter((x) => x !== cb);
      };
    },
  }),
  Link: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('../src/firebase', () => ({
  wsfIsStaging: false,
  wsfUsingEmulators: false,
  getFirebaseAuth: () => ({}),
  getFirebaseFunctions: () => ({}),
  getFirebaseFirestore: () => ({}),
}));

const { MemberTabBar } = await import('../src/ui/MemberTabBar');
const { MemberTopBar } = await import('../src/ui/MemberTopBar');
const native = await import('../src/ui/focusReturn.native');

const TAB_STATE = {
  index: 0,
  routes: [
    { key: 'h', name: '(home)' },
    { key: 'c', name: 'community' },
    { key: 'a', name: 'activity' },
    { key: 'y', name: 'you' },
  ],
};

/** The shell: the native focus return over both bars, as app/(tabs)/_layout.tsx wires it. */
function Shell() {
  const ref = useRef(null);
  native.useTabsFocusReturn(ref);
  const [open, setOpen] = useState(false);
  return (
    <>
      <MemberTopBar onHome={() => undefined} menu={[]} menuOpen={open} onMenuToggle={setOpen} />
      <MemberTabBar
        state={TAB_STATE as never}
        navigation={{ emit: () => ({ defaultPrevented: false }), navigate: () => undefined } as never}
        descriptors={{} as never}
        insets={{ top: 0, bottom: 0, left: 0, right: 0 }}
        onMove={() => undefined}
      />
    </>
  );
}

let container: HTMLDivElement;
let root: Root;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const emit = (event: string) => act(() => (nav.listeners[event] ?? []).slice().forEach((cb) => cb()));
const cover = (name: string) => {
  nav.routes = [{ key: 't', name: '(tabs)' }, { key: 'f', name }];
  emit('blur');
};
const uncover = () => {
  nav.routes = [{ key: 't', name: '(tabs)' }];
  emit('focus');
};
const lastFocused = () => fx.focused[fx.focused.length - 1];

beforeEach(() => {
  fx.os = 'android';
  fx.focused.length = 0;
  nav.routes = [{ key: 't', name: '(tabs)' }];
  nav.listeners = {};
  // A phone's width: the MOVE button is drawn (below 260 px the bar wraps without it).
  vi.spyOn(Dimensions, 'get').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('W12-9 part 2: the MOVE and menu buttons take the screen reader\'s focus back', () => {
  it('MOVE closes → focus returns to the tab bar\'s MOVE button (its implied opener)', () => {
    act(() => root.render(<Shell />));
    cover('move/index');
    uncover();
    expect(lastFocused()).toBe(byId('wsf-member-tab-move'));
  });

  it('Settings opened from the menu closes → focus returns to the menu button, its own opener', () => {
    act(() => root.render(<Shell />));
    native.armTabsFocusReturnTo('wsf-member-topbar-menu-button');
    cover('settings');
    uncover();
    expect(lastFocused()).toBe(byId('wsf-member-topbar-menu-button'));
    // ... and the next MOVE still returns to MOVE, not to the last opener.
    cover('move/index');
    uncover();
    expect(lastFocused()).toBe(byId('wsf-member-tab-move'));
    expect(fx.focused).toHaveLength(2);
  });

  it('closing the menu moves the screen reader to the menu button on a phone', () => {
    act(() => root.render(<Shell />));
    act(() => byId('wsf-member-topbar-menu-button')!.click());
    expect(fx.focused).toHaveLength(0);
    act(() => byId('wsf-member-topbar-menu-button')!.click());
    expect(lastFocused()).toBe(byId('wsf-member-topbar-menu-button'));
  });

  it('web: closing the menu moves keyboard focus to the button, and nothing touches the screen reader', () => {
    fx.os = 'web';
    act(() => root.render(<Shell />));
    act(() => byId('wsf-member-topbar-menu-button')!.click());
    act(() => byId('wsf-member-topbar-menu-button')!.click());
    expect(document.activeElement).toBe(byId('wsf-member-topbar-menu-button'));
    expect(fx.focused).toHaveLength(0);
  });

  it('unmounted, the bars are no longer targets: a return finds nothing and does nothing', () => {
    act(() => root.render(<Shell />));
    act(() => root.render(<div />));
    native.returnFocusSoon(() => null, { node: null, testId: 'wsf-member-tab-move' }, []);
    native.returnFocusSoon(() => null, { node: null, testId: 'wsf-member-topbar-menu-button' }, []);
    expect(fx.focused).toHaveLength(0);
  });
});
