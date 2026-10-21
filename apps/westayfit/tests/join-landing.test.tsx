import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as nodePath from 'node:path';

import { StackRouter, TabRouter } from '@react-navigation/routers';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * W13-6a (INT-20) — a finished join lands without a second tab stack.
 *
 * app/join/[joinCode].tsx's terminal hop (onJoin) lands through landAfterAuth
 * (src/ui/authLanding.ts): on a phone the root stack is reset to Home only and
 * the destination pushed over it; a kiosk destination is replaced
 * (RV12-641-F1); the web replaces, exactly as before. The shared-screen hops to
 * the kiosk are gates and keep `replace`.
 *
 * Two halves. The screen is rendered with its backend stubbed and Platform.OS
 * switchable, recording what it asks the router for. Then the landing is run
 * through React Navigation's own routers, nested as the app nests them (root
 * Stack → (tabs) → (home) Stack), with each href turned into the action
 * expo-router 6 dispatches for it: its own findDivergentState and
 * getPayloadFromStateRoute (build/global-state/routing.js) pick the navigator
 * the action is addressed to, as its getNavigateAction does.
 */

const ctl = vi.hoisted(() => ({
  os: 'ios' as 'ios' | 'android' | 'web',
  calls: [] as Array<[string, unknown]>,
  context: { goalId: null as string | null, activity: null as string | null },
  routeOverride: null as string | null,
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
  };
});

vi.mock('expo-router', async () => {
  const React = await import('react');
  // The root stack as the join screen's navigation object reports it: Home's tabs, then the join.
  const navigation = {
    dispatch: (a: unknown) => ctl.calls.push(['dispatch', a]),
    getState: () => ({ routes: [{ name: '(tabs)' }, { name: 'join/[joinCode]' }] }),
  };
  return {
    router: {
      replace: (href: string) => ctl.calls.push(['replace', href]),
      push: (href: string) => ctl.calls.push(['push', href]),
    },
    useNavigation: () => navigation,
    useLocalSearchParams: () => ({ joinCode: 'OakGrove01' }),
    Link: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  };
});
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => async () =>
    name === 'wsfJoinCommunity'
      ? { data: { groupId: 'oak', alreadyMember: false } }
      : { data: { displayName: 'Oak Grove Together', groupType: 'familyFriends', joinPolicy: 'code' } },
}));
vi.mock('../src/firebase', () => ({ getFirebaseFunctions: () => ({}), wsfIsStaging: false, wsfUsingEmulators: false }));
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: { uid: 'u1' } }) }));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
vi.mock('../src/pendingJoinCode', () => ({ setPendingJoinCode: async () => true, clearPendingJoinCode: () => undefined }));
vi.mock('../src/joinEventHandoff', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  clearPendingEventActivity: async () => true,
  dropJoinJourney: async () => undefined,
  setPendingEventActivity: async () => true,
  setPendingEventGoal: async () => true,
  takeJoinEventContextWithin: async () => ctl.context,
}));
vi.mock('../src/deviceMode', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  useStoredDeviceMode: () => [null, () => undefined],
  saveDeviceMode: async () => true,
  clearDeviceMode: async () => true,
}));
vi.mock('../src/stationSession', async (importOriginal) => {
  const actual = (await importOriginal()) as { routeAfterJoin: (...a: unknown[]) => string };
  return {
    ...actual,
    routeAfterJoin: (...a: unknown[]) => ctl.routeOverride ?? actual.routeAfterJoin(...a),
  };
});

import { HOME_ONLY_RESET, landAfterAuth } from '../src/ui/authLanding';

/*
  expo-router 6's own routing module (build/global-state/routing.js), for its
  two pure helpers, findDivergentState and getPayloadFromStateRoute: the
  installed file's own code, evaluated with what it imports for linking, the
  store and the DOM stubbed (those are not exercised; matchers is real).
  Vitest cannot mock a require inside an externalised package, and importing
  the module whole drags in expo/dom.
*/
const ROUTING = createRequire(import.meta.url).resolve('expo-router/build/global-state/routing.js');
const routing = (() => {
  const realRequire = createRequire(ROUTING);
  const stubs: Record<string, unknown> = {
    'expo/dom': {},
    'expo-linking': {},
    'react-native': {},
    './router-store': { store: {} },
    '../domComponents/emitDomEvent': {},
    '../getRoutesRedirects': {},
    '../link/href': {},
    '../navigationParams': {},
    '../utils/url': {},
  };
  const mod = { exports: {} as Record<string, unknown> };
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', '__filename', '__dirname', readFileSync(ROUTING, 'utf8'))(
    mod.exports,
    (id: string) => (id in stubs ? stubs[id] : realRequire(id)),
    mod,
    ROUTING,
    nodePath.dirname(ROUTING),
  );
  return mod.exports as {
    findDivergentState: (actionState: unknown, navigationState: unknown) => { actionStateRoute: object; navigationState: { key: string; type: string } };
    getPayloadFromStateRoute: (route: unknown) => { screen: string; params: object };
  };
})();
const { findDivergentState, getPayloadFromStateRoute } = routing;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  ctl.os = 'ios';
  ctl.calls = [];
  ctl.context = { goalId: null, activity: null };
  ctl.routeOverride = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await act(async () => undefined);
};

async function joinOnScreen() {
  const { default: JoinPage } = await import('../app/join/[joinCode]');
  act(() => root.render(<JoinPage />));
  await settle();
  act(() => (container.querySelector('[data-testid="wsf-join-submit"]') as HTMLElement).click());
  await settle();
}

describe('the join screen’s terminal hop', () => {
  for (const os of ['ios', 'android'] as const) {
    it(`${os}: the community → Home only, then the community pushed over it`, async () => {
      ctl.os = os;
      await joinOnScreen();
      expect(ctl.calls).toEqual([
        ['dispatch', HOME_ONLY_RESET],
        ['push', '/community/oak'],
      ]);
    });

    it(`${os}: a join from an event QR → Home only, then the event pushed`, async () => {
      ctl.os = os;
      ctl.context = { goalId: 'g1', activity: null };
      await joinOnScreen();
      expect(ctl.calls).toEqual([
        ['dispatch', HOME_ONLY_RESET],
        ['push', '/event/g1'],
      ]);
    });

    it(`${os}: a kiosk destination is replaced, never reset under (RV12-641-F1)`, async () => {
      ctl.os = os;
      ctl.routeOverride = '/contribute/g1?kiosk=1';
      await joinOnScreen();
      expect(ctl.calls).toEqual([['replace', '/contribute/g1?kiosk=1']]);
    });
  }

  it('web: replace(destination), exactly as before', async () => {
    ctl.os = 'web';
    await joinOnScreen();
    expect(ctl.calls).toEqual([['replace', '/community/oak']]);
  });

  it('the shared-screen hops to the kiosk are gates and keep replace; the terminal hop goes through landAfterAuth', () => {
    const src = readFileSync(nodePath.resolve(__dirname, '../app/join/[joinCode].tsx'), 'utf8');
    const shared = src.slice(src.indexOf('const onChooseShared = useCallback'), src.indexOf('const onUseOwnPhoneInstead'));
    expect(shared).toContain('router.replace(decided.route as never);');
    expect(src).toContain('onContinue={() => router.replace(deviceEntry.route as never)}');
    const onJoin = src.slice(src.indexOf('const onJoin = useCallback'), src.indexOf('}, [joinCode, navigation, user]);'));
    expect(onJoin.length).toBeGreaterThan(100);
    expect(onJoin).toMatch(/landAfterAuth\(destination, \{\s*dispatch: \(action\) => navigation\.dispatch\(action as never\),\s*push: \(href\) => router\.push\(href as never\),\s*replace: \(href\) => router\.replace\(href as never\),\s*platform: Platform\.OS,/);
    // RV15-641-N1: the root stack's routes, so a kiosk beneath is never reset away.
    expect(onJoin).toMatch(/routes: \(\) => \(navigation\.getState\(\) as [^)]*\)\?\.routes,\s*\}\);/);
    expect(onJoin).not.toMatch(/router\.replace\(destination/);
  });

  it('INT-01: the route exports the contained screen boundary', () => {
    const src = readFileSync(nodePath.resolve(__dirname, '../app/join/[joinCode].tsx'), 'utf8');
    expect(src).toContain("export const ErrorBoundary = nativeErrorBoundary('screen');");
  });
});

// ---- React Navigation's routers, nested as the app nests them ----

type Route = { key: string; name: string; params?: object; state?: NavState };
type NavState = { key: string; type: string; index: number; routes: Route[]; routeNames: string[]; stale: false };

const LEVELS: Record<string, { router: ReturnType<typeof StackRouter> | ReturnType<typeof TabRouter>; routeNames: string[] }> = {
  root: {
    router: StackRouter({}),
    routeNames: ['(tabs)', 'join/[joinCode]', 'event/[goalId]', 'kiosk/[goalId]', 'contribute/[goalId]', 'signin', 'verify-email'],
  },
  '(tabs)': { router: TabRouter({ backBehavior: 'history' }), routeNames: ['(home)', 'community', 'activity', 'you'] },
  '(home)': { router: StackRouter({}), routeNames: ['index', 'community/[groupId]/index'] },
};
const levelOf = (parentRouteName: string | null) => (parentRouteName === null ? LEVELS.root! : LEVELS[parentRouteName]!);
const opts = (routeNames: string[]) => ({ routeNames, routeParamList: {}, routeGetIdList: {} });

/** Every level rehydrated, as each navigator does when it renders. */
function hydrate(state: unknown, parentRouteName: string | null = null): NavState {
  const level = levelOf(parentRouteName);
  const s = level.router.getRehydratedState(state as never, opts(level.routeNames)) as unknown as NavState;
  return {
    ...s,
    routes: s.routes.map((r) => (r.state || LEVELS[r.name] ? { ...r, state: hydrate(r.state ?? { routes: [{ name: levelOf(r.name).routeNames[0] }] }, r.name) } : r)),
  };
}

/** Applies an action to the navigator it is addressed to (or the root), and rehydrates. */
function apply(state: NavState, action: { type: string; target?: string; payload?: object }, parentRouteName: string | null = null): NavState {
  const level = levelOf(parentRouteName);
  if (!action.target || action.target === state.key) {
    const next = level.router.getStateForAction(state as never, action as never, opts(level.routeNames) as never);
    expect(next).not.toBeNull();
    return hydrate(next, parentRouteName);
  }
  return {
    ...state,
    routes: state.routes.map((r) => (r.state ? { ...r, state: apply(r.state, action, r.name) } : r)),
  };
}

/** Back from the focused screen: the deepest navigator that can go back does. */
function goBack(state: NavState, parentRouteName: string | null = null): NavState | null {
  const focused = state.routes[state.index]!;
  if (focused.state) {
    const child = goBack(focused.state, focused.name);
    if (child) return { ...state, routes: state.routes.map((r, i) => (i === state.index ? { ...r, state: child } : r)) };
  }
  const level = levelOf(parentRouteName);
  const next = level.router.getStateForAction(state as never, { type: 'GO_BACK' } as never, opts(level.routeNames) as never);
  return next ? hydrate(next, parentRouteName) : null;
}

/** What expo-router's getStateFromPath gives for the hrefs used here. */
function actionStateFor(href: string): object {
  const [path, query = ''] = href.split('?');
  const search = Object.fromEntries(new URLSearchParams(query));
  let m = /^\/community\/([^/]+)$/.exec(path!);
  if (m) {
    return {
      routes: [
        {
          name: '(tabs)',
          state: { routes: [{ name: '(home)', state: { routes: [{ name: 'community/[groupId]/index', params: { groupId: m[1] } }] } }] },
        },
      ],
    };
  }
  m = /^\/(event|kiosk|contribute)\/([^/]+)$/.exec(path!);
  if (m) return { routes: [{ name: `${m[1]}/[goalId]`, params: { goalId: m[2], ...search } }] };
  throw new Error(`no route for ${href}`);
}

/** expo-router 6's getNavigateAction, from its own divergence and payload helpers. */
function expoRouterAction(href: string, state: NavState, type: 'PUSH' | 'REPLACE') {
  const { actionStateRoute, navigationState } = findDivergentState(actionStateFor(href), state);
  const payload = getPayloadFromStateRoute(actionStateRoute);
  const t = type === 'PUSH' && navigationState.type !== 'stack' ? 'NAVIGATE' : type;
  return { type: t, target: navigationState.key, payload: { name: payload.screen, params: payload.params } };
}

/** The tabs mounted (Home's index), with the join screen over them: where a join is finished. */
const AT_JOIN = () =>
  hydrate({
    index: 1,
    routes: [
      { name: '(tabs)', state: { index: 0, routes: [{ name: '(home)', state: { index: 0, routes: [{ name: 'index' }] } }] } },
      { name: 'join/[joinCode]', params: { joinCode: 'OakGrove01' } },
    ],
  });

function land(href: string, platform: string, viaReplaceOnly = false): NavState {
  let state = AT_JOIN();
  const deps = {
    dispatch: (a: unknown) => {
      state = apply(state, a as never);
    },
    push: (h: string) => {
      state = apply(state, expoRouterAction(h, state, 'PUSH'));
    },
    replace: (h: string) => {
      state = apply(state, expoRouterAction(h, state, 'REPLACE'));
    },
  };
  if (viaReplaceOnly) deps.replace(href);
  else landAfterAuth(href, { ...deps, platform });
  return state;
}

const names = (s: NavState) => s.routes.map((r) => r.name);
const homeStack = (s: NavState) => {
  const tabs = s.routes.find((r) => r.name === '(tabs)')!.state!;
  return tabs.routes.find((r) => r.name === '(home)')!.state!;
};

describe('the landing, through React Navigation’s routers and expo-router’s own action targeting', () => {
  it('the probe sees the bug it guards: a plain replace from the join screen to the community builds a SECOND (tabs)', () => {
    const state = land('/community/oak', 'ios', true);
    expect(names(state)).toEqual(['(tabs)', '(tabs)']);
  });

  for (const platform of ['ios', 'android']) {
    it(`${platform}: the community lands inside the one (tabs) (Home, then the community); Back goes to Home`, () => {
      const state = land('/community/oak', platform);
      expect(names(state)).toEqual(['(tabs)']);
      expect(homeStack(state).routes.map((r) => r.name)).toEqual(['index', 'community/[groupId]/index']);
      expect(homeStack(state).routes[1]!.params).toMatchObject({ groupId: 'oak' });
      const back = goBack(state)!;
      expect(names(back)).toEqual(['(tabs)']);
      expect(homeStack(back).routes.map((r) => r.name)).toEqual(['index']);
    });

    it(`${platform}: an event lands [(tabs), event], never two (tabs); Back goes to (tabs)`, () => {
      const state = land('/event/g1', platform);
      expect(names(state)).toEqual(['(tabs)', 'event/[goalId]']);
      const back = goBack(state)!;
      expect(names(back)).toEqual(['(tabs)']);
      expect(homeStack(back).routes.map((r) => r.name)).toEqual(['index']);
    });

    it(`${platform}: a kiosk destination is replaced (the join screen’s place), never reset under`, () => {
      const state = land('/contribute/g1?kiosk=1', platform);
      expect(names(state)).toEqual(['(tabs)', 'contribute/[goalId]']);
      expect(state.routes[1]!.params).toMatchObject({ goalId: 'g1', kiosk: '1' });
    });
  }
});
