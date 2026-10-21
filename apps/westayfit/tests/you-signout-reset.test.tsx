import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { StackRouter, TabRouter } from '@react-navigation/routers';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SIGNED_OUT_HOME_RESET } from '../src/ui/signOutReset';

/**
 * NATIVE-MEMBER-1 SH-7: You's OWN Sign out (not the shell menu's) goes
 * through the same INT-05 reset as the menu. The INT-05 cases, for the You
 * path (the menu's are tests/sign-out-reset.test.ts):
 *   (a)(b) on a phone, a successful sign-out, then ONE reset of the root
 *          stack to signed-out Home -- dispatched on this tab's parent, the
 *          same navigation object the menu uses;
 *   (c)    nothing behind it for Back: the reset is the menu's own action,
 *          proved against the real routers there; here, that it reaches the
 *          root stack even from the tab level;
 *   (d)    a failed sign-out moves nothing and throws nothing.
 * The web is unchanged: You goes to Home after a successful sign-out.
 * The route is rendered whole (react-native-web in jsdom); no device.
 */

let os = 'ios';
vi.mock('react-native', async (importOriginal) => {
  const rn = await importOriginal<typeof import('react-native')>();
  return {
    ...rn,
    Platform: Object.defineProperty({ ...rn.Platform }, 'OS', { get: () => os, enumerable: true }),
  };
});
vi.mock('../src/ui/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../src/auth', () => ({
  useWsfAuth: () => AUTH,
}));
const AUTH = { ready: true, user: { uid: 'uid-a', email: 'a@example.com' } };
vi.mock('../src/firebase', () => ({ getFirebaseAuth: () => ({}) }));
const order: string[] = [];
const signOut = vi.fn<() => Promise<void>>();
vi.mock('firebase/auth', () => ({
  signOut: () => {
    order.push('signOut');
    return signOut();
  },
}));
// A signed-in member with no community yet: You settles on a state that
// shows the account row and its Sign out.
vi.mock('../src/memberReads', () => ({
  SAME_LOAD_MS: 10_000,
  peekGoals: () => undefined,
  peekMemberProfile: () => undefined,
  peekMyCommunities: () => undefined,
  peekOwnCredit: () => undefined,
  wasRefused: () => false,
  readMemberProfile: () => Promise.resolve({ displayName: 'Alex', createdAt: null }),
  readMyCommunities: () => Promise.resolve({ items: [] }),
  readGoals: () => Promise.resolve({ goals: [] }),
  readOwnCredit: () => Promise.resolve({ ownCredit: 0, unit: 'reps' }),
}));

const replace = vi.fn();
const push = vi.fn();
/** The root stack's navigation: the `(tabs)` route's, which the shell menu dispatches on. */
const rootDispatch = vi.fn((_a: unknown) => {
  order.push('reset');
});
/** The You tab's own navigation, inside the tab navigator. */
const tabDispatch = vi.fn((_a: unknown) => {
  order.push('tab-dispatch');
});
let parent: { dispatch: typeof rootDispatch } | undefined;
vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return {
    router: { replace: (...a: unknown[]) => replace(...a), push: (...a: unknown[]) => push(...a) },
    useNavigation: () => ({ dispatch: tabDispatch, getParent: () => parent }),
    useFocusEffect: (cb: () => void | (() => void)) => {
      useEffect(() => cb(), [cb]);
    },
  };
});

const { default: You } = await import('../app/(tabs)/you');

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  os = 'ios';
  order.length = 0;
  signOut.mockReset();
  signOut.mockResolvedValue(undefined);
  replace.mockReset();
  push.mockReset();
  rootDispatch.mockClear();
  tabDispatch.mockClear();
  parent = { dispatch: rootDispatch };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
async function render(): Promise<void> {
  act(() => {
    root.render(<You />);
  });
  await flush();
}
async function pressSignOut(): Promise<void> {
  const button = byId('wsf-you-signout');
  expect(button, 'You shows its Sign out').not.toBeNull();
  await act(async () => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}

describe("SH-7 / INT-05: You's own Sign out", () => {
  it.each(['ios', 'android'])('(a)(b) %s: signs out first, then resets the root stack to signed-out Home once', async (platform) => {
    os = platform;
    await render();
    await pressSignOut();
    expect(order).toEqual(['signOut', 'reset']);
    expect(rootDispatch).toHaveBeenCalledTimes(1);
    expect(rootDispatch).toHaveBeenCalledWith(SIGNED_OUT_HOME_RESET);
    // One route, not a replace on top of the old tab history.
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(tabDispatch).not.toHaveBeenCalled();
  });

  it('native: nothing moves while the sign-out is still in flight', async () => {
    let finish!: () => void;
    signOut.mockReturnValue(new Promise<void>((res) => (finish = res)));
    await render();
    await pressSignOut();
    expect(byId('wsf-you-signout')!.textContent).toContain('Signing out…');
    expect(rootDispatch).not.toHaveBeenCalled();
    await act(async () => finish());
    await flush();
    expect(rootDispatch).toHaveBeenCalledTimes(1);
  });

  it('(c) with no parent to hand it to, the reset goes on the tab navigation and bubbles to the root stack', async () => {
    parent = undefined;
    await render();
    await pressSignOut();
    expect(tabDispatch).toHaveBeenCalledWith(SIGNED_OUT_HOME_RESET);
    // The tab navigator cannot take a reset naming the root's `(tabs)` route,
    // so React Navigation passes it up, to the root stack that can.
    const tabs = TabRouter({ backBehavior: 'history' });
    const opts = (routeNames: string[]) => ({ routeNames, routeParamList: {}, routeGetIdList: {} });
    const TAB_ROUTES = ['(home)', 'community', 'activity', 'you'];
    const tabState = tabs.getInitialState(opts(TAB_ROUTES));
    expect(tabs.getStateForAction(tabState, SIGNED_OUT_HOME_RESET as never, opts(TAB_ROUTES))).toBeNull();
    const ROOT_ROUTES = ['(tabs)', 'move/index', 'settings', 'signin'];
    const rootRouter = StackRouter({});
    const rootState = rootRouter.getInitialState(opts(ROOT_ROUTES));
    expect(rootRouter.getStateForAction(rootState, SIGNED_OUT_HOME_RESET as never, opts(ROOT_ROUTES))).not.toBeNull();
  });

  it.each(['ios', 'android', 'web'])('(d) %s: a failed sign-out moves nothing, throws nothing, and gives the button back', async (platform) => {
    os = platform;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    signOut.mockRejectedValue(Object.assign(new Error('offline'), { code: 'auth/network-request-failed' }));
    await render();
    await pressSignOut();
    expect(rootDispatch).not.toHaveBeenCalled();
    expect(tabDispatch).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    // The failure was caught by the reset helper, not left unhandled.
    expect(warn).toHaveBeenCalledWith('[wsf] sign-out failed', expect.anything());
    expect(byId('wsf-you-signout')!.textContent).toContain('Sign out');
    expect(byId('wsf-you-signout')!.textContent).not.toContain('Signing out…');
  });

  it('web (unchanged): signs out, then goes Home with router.replace, and resets nothing', async () => {
    os = 'web';
    await render();
    await pressSignOut();
    expect(order).toEqual(['signOut']);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/');
    expect(rootDispatch).not.toHaveBeenCalled();
    expect(tabDispatch).not.toHaveBeenCalled();
  });

  it("You's handler goes through the same helper as the menu, with the platform", () => {
    const you = readFileSync(join(__dirname, '..', 'app/(tabs)/you.tsx'), 'utf8');
    expect(you).toMatch(
      /signOutToSignedOutHome\(\{\s*signOut: \(\) => signOut\(getFirebaseAuth\(\)\),\s*dispatch: \(action\) => \(navigation\.getParent\(\) \?\? navigation\)\.dispatch\(action as never\),\s*platform: Platform\.OS,/,
    );
    // The old fire-and-forget sign-out and its unconditional replace are gone.
    expect(you).not.toMatch(/void signOut\(getFirebaseAuth\(\)\)/);
    expect(you).not.toMatch(/\.then\(\(\) => router\.replace\('\/'\)\)/);
  });
});
