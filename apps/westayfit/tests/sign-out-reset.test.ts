// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { StackRouter, TabRouter } from '@react-navigation/routers';
import { describe, expect, it, vi } from 'vitest';

import { SIGNED_OUT_HOME_RESET, signOutToSignedOutHome } from '../src/ui/signOutReset';

/**
 * NATIVE-INTEGRATOR-1 (INT-05): menu Sign out on Progress or Community lands
 * on signed-out Home on a phone, with nothing behind it.
 *
 * Cases (section 4.1, INT-05): (a) Progress → menu Sign out → signed-out Home;
 * (b) the same from Community and You (the menu is the shell's, one handler);
 * (c) Android Back after it leaves the app (no tab history, no stack below);
 * (d) a failed sign-out moves nothing. No device here: the reset is proved
 * against React Navigation's own routers, the ones the navigators run.
 */

const ROOT_ROUTES = ['(tabs)', 'move/index', 'contribute/[goalId]', 'settings', 'health', 'signin'];
const TAB_ROUTES = ['(home)', 'community', 'activity', 'you'];
const HOME_ROUTES = ['index', 'community/[groupId]/index', 'community/[groupId]/challenge', 'community/[groupId]/members'];
const opts = (routeNames: string[]) => ({ routeNames, routeParamList: {}, routeGetIdList: {} });

describe('INT-05: sign out, then signed-out Home', () => {
  it('(a)(b) native: signs out first, then resets the root stack once', async () => {
    const order: string[] = [];
    const dispatch = vi.fn(() => order.push('reset'));
    const ok = await signOutToSignedOutHome({
      signOut: async () => {
        order.push('signOut');
      },
      dispatch,
      platform: 'ios',
    });
    expect(ok).toBe(true);
    expect(order).toEqual(['signOut', 'reset']);
    expect(dispatch).toHaveBeenCalledWith(SIGNED_OUT_HOME_RESET);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('web: signs out and moves nothing (the journeys expect the tab to stay)', async () => {
    const dispatch = vi.fn();
    expect(await signOutToSignedOutHome({ signOut: async () => undefined, dispatch, platform: 'web' })).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('(d) a failed sign-out keeps the member where they are and does not throw', async () => {
    const dispatch = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const ok = await signOutToSignedOutHome({
        signOut: () => Promise.reject(Object.assign(new Error('offline'), { code: 'auth/network-request-failed' })),
        dispatch,
        platform: 'android',
      });
      expect(ok).toBe(false);
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('(a)(c) the reset, run through the real routers, leaves exactly signed-out Home and nothing for Back', () => {
    const root = StackRouter({});
    const tabs = TabRouter({ backBehavior: 'history' });
    const home = StackRouter({});

    // Signed in on Progress, having visited Home's community and Community: a
    // tab history, and Settings once opened over the tabs.
    let rootState = root.getRehydratedState(
      { routes: [{ name: '(tabs)' }, { name: 'settings' }], index: 1 } as never,
      opts(ROOT_ROUTES),
    );
    rootState = root.getStateForAction(rootState, SIGNED_OUT_HOME_RESET as never, opts(ROOT_ROUTES)) as typeof rootState;
    expect(rootState).not.toBeNull();
    // RESET hands back a partial state; the stack rehydrates it, as useNavigationBuilder does.
    rootState = root.getRehydratedState(rootState as never, opts(ROOT_ROUTES));
    expect(rootState.routes.map((r) => r.name)).toEqual(['(tabs)']);
    expect(rootState.index).toBe(0);

    const tabsState = tabs.getRehydratedState(rootState.routes[0]!.state as never, opts(TAB_ROUTES));
    expect(tabsState.routes[tabsState.index]!.name).toBe('(home)');
    expect(tabsState.history).toEqual([{ type: 'route', key: tabsState.routes[tabsState.index]!.key }]);

    const homeState = home.getRehydratedState(tabsState.routes[tabsState.index]!.state as never, opts(HOME_ROUTES));
    expect(homeState.routes.map((r) => r.name)).toEqual(['index']);

    // Back has nowhere to go at any level, so Android leaves the app.
    const back = { type: 'GO_BACK' } as const;
    expect(home.getStateForAction(homeState, back as never, opts(HOME_ROUTES))).toBeNull();
    expect(tabs.getStateForAction(tabsState, back as never, opts(TAB_ROUTES))).toBeNull();
    expect(root.getStateForAction(rootState, back as never, opts(ROOT_ROUTES))).toBeNull();
  });

  it('the shell menu routes Sign out through it, with the platform', () => {
    const shell = readFileSync(join(__dirname, '..', 'app/(tabs)/_layout.tsx'), 'utf8');
    expect(shell).toMatch(/signOutToSignedOutHome\(\{\s*signOut: \(\) => signOut\(getFirebaseAuth\(\)\),\s*dispatch: \(action\) => rootNavigation\.dispatch\(action as never\),\s*platform: Platform\.OS,/);
    // The old fire-and-forget sign-out is gone.
    expect(shell).not.toMatch(/void signOut\(getFirebaseAuth\(\)\)\.finally/);
  });
});
