import { act, useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 W16-5 (INT-17). On a phone, Settings opened from You's own
 * Settings row now hands the screen reader's focus back to that row when it
 * closes, through kit-base's native registry (W12-9): YouHead registers the
 * row through src/ui/focusTarget, and the You route arms it on open. Without
 * it the only named opener was the top bar's menu button. The web is
 * untouched: no arm, and the native registry is never reached.
 *
 * The You route is rendered whole (react-native-web, jsdom) under a harness
 * that runs the tabs' half, useTabsFocusReturn, against a hand-driven
 * navigation (blur as Settings covers the tabs, focus as it closes).
 * "Native" swaps in focusTarget.native and focusReturn.native and sets
 * Platform.OS to ios; the focus move itself (accessibilityFocus) is a spy.
 * No device.
 */

const mode = { native: false };
const focusSoon = vi.fn((_ref: { current: unknown }) => () => {});
vi.mock('../src/ui/accessibilityFocus', () => ({
  IOS_FOCUS_DELAY_MS: 400,
  focusAccessibilitySoon: (ref: { current: unknown }) => focusSoon(ref),
}));
vi.mock('../src/ui/focusReturn.native', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/ui/focusReturn.native')>();
  return {
    ...real,
    registerFocusTarget: vi.fn(real.registerFocusTarget),
    armTabsFocusReturnTo: vi.fn(real.armTabsFocusReturnTo),
  };
});
vi.mock('../src/ui/focusReturn', async (importOriginal) => {
  const web = await importOriginal<typeof import('../src/ui/focusReturn')>();
  const native = await import('../src/ui/focusReturn.native');
  const webArm = vi.fn(web.armTabsFocusReturnTo);
  return {
    webArm,
    armTabsFocusReturnTo: (id: string) => (mode.native ? native.armTabsFocusReturnTo(id) : webArm(id)),
    useTabsFocusReturn: (c: { current: unknown }) => (mode.native ? native.useTabsFocusReturn(c) : web.useTabsFocusReturn(c)),
  };
});
vi.mock('../src/ui/focusTarget', async (importOriginal) => {
  const web = await importOriginal<typeof import('../src/ui/focusTarget')>();
  const native = await import('../src/ui/focusTarget.native');
  return {
    registerFocusTarget: (id: string, ref: { current: unknown }) =>
      mode.native ? native.registerFocusTarget(id, ref) : web.registerFocusTarget(id, ref),
    focusSoon: (ref: { current: unknown }) => (mode.native ? native.focusSoon(ref) : web.focusSoon(ref)),
  };
});

// The navigation the tabs' half listens to, driven by hand.
// (The web half also listens for 'state' and asks isFocused.)
let listeners: Record<string, Array<() => void>> = {};
const fire = (event: string) => act(() => (listeners[event] ?? []).forEach((cb) => cb()));
const nav = { top: '(tabs)' };
const NAVIGATION = {
  dispatch: vi.fn(),
  getParent: () => undefined,
  isFocused: () => nav.top === '(tabs)',
  addListener: (event: string, cb: () => void) => {
    (listeners[event] ??= []).push(cb);
    return () => {
      listeners[event] = (listeners[event] ?? []).filter((x) => x !== cb);
    };
  },
  getState: () => ({ index: 0, routes: [{ name: nav.top }] }),
};
const router = { replace: vi.fn(), push: vi.fn() };
vi.mock('expo-router', () => ({
  router,
  useNavigation: () => NAVIGATION,
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(() => cb(), [cb]);
  },
}));
vi.mock('../src/ui/useReducedMotion', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useReducedMotion: () => true,
  useReducedMotionPreference: () => ({ reduced: true, known: true, failed: false }),
}));
const AUTH = { ready: true, user: { uid: 'u1', email: 'alex@example.com' } };
vi.mock('../src/auth', () => ({ useWsfAuth: () => AUTH }));
vi.mock('../src/firebase', () => ({ getFirebaseAuth: () => ({}) }));
vi.mock('firebase/auth', () => ({ signOut: () => Promise.resolve() }));
const COMMUNITY = { groupId: 'oak', displayName: 'Oak Grove', role: 'member', memberCount: 23 };
vi.mock('../src/memberReads', () => ({
  SAME_LOAD_MS: 10_000,
  peekGoals: () => undefined,
  peekMemberProfile: () => undefined,
  peekMyCommunities: () => undefined,
  peekOwnCredit: () => undefined,
  wasRefused: () => false,
  readMemberProfile: () => Promise.resolve({ displayName: 'Alex', createdAt: null }),
  readMyCommunities: () => Promise.resolve({ items: [COMMUNITY] }),
  readGoals: () => Promise.resolve({ goals: [] }),
  readOwnCredit: () => Promise.resolve({ ownCredit: 0, unit: 'squats' }),
}));

const { default: You } = await import('../app/(tabs)/you');
const focusReturn = (await import('../src/ui/focusReturn')) as unknown as {
  webArm: ReturnType<typeof vi.fn>;
  useTabsFocusReturn: (c: { current: unknown }) => void;
};
const native = await import('../src/ui/focusReturn.native');

/** The tab layout's part, around the You screen. */
function Shell() {
  const shell = useRef(null);
  focusReturn.useTabsFocusReturn(shell);
  return <You />;
}

const OS = Platform.OS;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  focusSoon.mockClear();
  router.push.mockClear();
  focusReturn.webArm.mockClear();
  (native.registerFocusTarget as unknown as ReturnType<typeof vi.fn>).mockClear();
  (native.armTabsFocusReturnTo as unknown as ReturnType<typeof vi.fn>).mockClear();
  listeners = {};
  nav.top = '(tabs)';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  (Platform as { OS: string }).OS = OS;
  mode.native = false;
});

const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
async function render(platform: 'ios' | 'web'): Promise<void> {
  mode.native = platform !== 'web';
  (Platform as { OS: string }).OS = platform;
  act(() => root.render(<Shell />));
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
  expect(byId('wsf-you-settings')).not.toBeNull();
}
/** Settings opens over the tabs, then closes. */
function openAndCloseSettings(): void {
  act(() => byId('wsf-you-settings')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(router.push).toHaveBeenCalledWith('/settings');
  nav.top = 'settings';
  fire('state');
  fire('blur');
  nav.top = '(tabs)';
  fire('state');
  fire('focus');
}

describe('W16-5 / INT-17: Settings from You returns focus to You’s Settings row', () => {
  it('natively, focus goes back to the row that opened Settings, not to the menu button', async () => {
    // The top bar's menu button is registered too, as the shell registers it.
    const menu = { current: document.createElement('button') };
    const offMenu = native.registerFocusTarget('wsf-member-topbar-menu-button', menu);
    try {
      await render('ios');
      expect(native.registerFocusTarget).toHaveBeenCalledWith('wsf-you-settings', expect.anything());
      openAndCloseSettings();
      expect(native.armTabsFocusReturnTo).toHaveBeenCalledWith('wsf-you-settings');
      expect(focusSoon).toHaveBeenCalledTimes(1);
      const ref = focusSoon.mock.calls[0]![0];
      expect(ref).not.toBe(menu);
      expect(ref.current).toBe(byId('wsf-you-settings'));
    } finally {
      offMenu();
    }
  });

  it('the row unregisters when You unmounts: a later return focuses nothing', async () => {
    await render('ios');
    act(() => root.unmount());
    root = createRoot(container);
    native.armTabsFocusReturnTo('wsf-you-settings');
    // A fresh tabs mount with no You screen: nothing is registered under the name.
    function Bare() {
      focusReturn.useTabsFocusReturn(useRef(null));
      return null;
    }
    act(() => root.render(<Bare />));
    nav.top = 'settings';
    fire('blur');
    nav.top = '(tabs)';
    fire('focus');
    expect(focusSoon).not.toHaveBeenCalled();
  });

  it('on the web nothing changes: no arm, and the native registry is never reached', async () => {
    await render('web');
    openAndCloseSettings();
    expect(focusReturn.webArm).not.toHaveBeenCalled();
    expect(native.armTabsFocusReturnTo).not.toHaveBeenCalled();
    expect(native.registerFocusTarget).not.toHaveBeenCalled();
    expect(focusSoon).not.toHaveBeenCalled();
  });
});
