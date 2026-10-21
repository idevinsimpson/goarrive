import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as nodePath from 'node:path';

import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BaseNavigationContainer,
  StackRouter,
  TabRouter,
  createNavigationContainerRef,
  createNavigatorFactory,
  useNavigationBuilder,
} from '@react-navigation/core';

/**
 * RV16-641-N1 (heads-14) — GO TO HOME FROM A ROOT-STACK SCREEN'S FALLBACK
 * NEVER BUILDS A SECOND COMMUNITY.
 *
 * A member with a community opens Settings over the tabs; Home's index has
 * replaced itself with the community, as app/(tabs)/(home)/index.tsx does.
 * Settings throws, and its contained fallback's Go to Home used
 * router.dismissTo('/'): expo-router sends POP_TO (tabs) {screen:'(home)',
 * params:{screen:'index'}}, the Home stack pushed a second index, whose own
 * redirect built [community, community]. Now the fallback dispatches
 * contribute's "Back to Home" through its screen's navigator: POP_TO (tabs)
 * {screen:'(home)'}, which selects the Home tab as it stands.
 *
 * Real: @react-navigation/core navigators on its StackRouter and TabRouter,
 * nested as the app nests them (root Stack → (tabs) → (home) Stack), and the
 * real crash fallback (RouteErrorFallback.native) as the Settings route. The
 * expo-router router is modelled by expo-router 6's OWN getNavigateAction
 * (build/global-state/routing.js, evaluated with its linking, store and DOM
 * imports stubbed, as tests/join-landing.test.tsx does), computed against the
 * container's root state and dispatched on the container.
 */

const ctl = vi.hoisted(() => ({
  log: [] as string[],
  ref: null as unknown as { dispatch: (a: unknown) => void; getRootState: () => unknown },
}));
vi.mock('../src/kioskSession', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readKioskSession: () => null,
  readKioskReturnGoal: () => null,
}));
vi.mock('../src/firebase', () => ({ getFirebaseAuth: () => ({ currentUser: { uid: 'member-1' } }) }));
// The real module imports React Native internals jsdom cannot load.
vi.mock('react-native-safe-area-context', async () => {
  const { createContext } = await import('react');
  return { SafeAreaInsetsContext: createContext(null), initialWindowMetrics: null };
});

const ROUTING = createRequire(import.meta.url).resolve('expo-router/build/global-state/routing.js');
type Queued = { type: string; target?: string; payload?: { name?: string; params?: object } };
const getNavigateAction = (() => {
  const realRequire = createRequire(ROUTING);
  const stubs: Record<string, unknown> = {
    'expo/dom': {},
    'expo-linking': {},
    'react-native': {},
    './router-store': { store: {} },
    '../domComponents/emitDomEvent': {},
    '../getRoutesRedirects': {},
    '../link/href': {},
    '../utils/url': {},
  };
  const mod = { exports: {} as Record<string, unknown> };
  // getNavigateAction is module-private: exported here for the test.
  const source = `${readFileSync(ROUTING, 'utf8')}\nmodule.exports.__getNavigateAction = getNavigateAction;`;
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', '__filename', '__dirname', source)(
    mod.exports,
    (id: string) => (id in stubs ? stubs[id] : realRequire(id)),
    mod,
    ROUTING,
    nodePath.dirname(ROUTING),
  );
  return mod.exports.__getNavigateAction as (a: unknown, s: unknown, t: string) => Queued;
})();

/** What expo-router's getStateFromPath gives for the hrefs used here. */
function actionStateFor(href: string): object {
  if (href === '/') return { routes: [{ name: '(tabs)', state: { routes: [{ name: '(home)', state: { routes: [{ name: 'index' }] } }] } }] };
  const m = /^\/community\/([^/]+)$/.exec(href);
  if (m) {
    return {
      routes: [
        { name: '(tabs)', state: { routes: [{ name: '(home)', state: { routes: [{ name: 'community/[groupId]/index', params: { groupId: m[1] } }] } }] } },
      ],
    };
  }
  if (href === '/settings') return { routes: [{ name: 'settings' }] };
  throw new Error(`no route for ${href}`);
}

vi.mock('expo-router', () => {
  const go = (href: string, type: string) => {
    const action = getNavigateAction(actionStateFor(href), ctl.ref.getRootState(), type);
    ctl.log.push(`${type} ${href}`);
    ctl.ref.dispatch(action);
  };
  return {
    router: {
      navigate: (h: string) => go(h, 'NAVIGATE'),
      dismissTo: (h: string) => go(h, 'POP_TO'),
      replace: (h: string) => go(h, 'REPLACE'),
      push: (h: string) => go(h, 'PUSH'),
    },
  };
});

const { RouteErrorFallback } = await import('../src/ui/RouteErrorFallback.native');
const { router } = await import('expo-router');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function ProbeStack(props: { children: ReactNode }) {
  const { state, descriptors, NavigationContent } = useNavigationBuilder(StackRouter, props as never);
  return (
    <NavigationContent>
      {state.routes.map((r, i) => (
        <div key={r.key} data-route={r.name} data-focused={String(i === state.index)}>
          {descriptors[r.key]!.render()}
        </div>
      ))}
    </NavigationContent>
  );
}
function ProbeTabs(props: { children: ReactNode }) {
  const { state, descriptors, NavigationContent } = useNavigationBuilder(TabRouter, props as never);
  const focused = state.routes[state.index]!;
  return <NavigationContent>{descriptors[focused.key]!.render()}</NavigationContent>;
}
const RootStack = createNavigatorFactory(ProbeStack)();
const Tabs = createNavigatorFactory(ProbeTabs)();
const HomeStack = createNavigatorFactory(ProbeStack)();

let indexMounts = 0;
function HomeIndex() {
  // app/(tabs)/(home)/index.tsx: a member with a community is sent to it by router.replace('/community/<id>').
  useEffect(() => {
    indexMounts += 1;
    const t = setTimeout(() => router.replace('/community/oak' as never), 0);
    return () => clearTimeout(t);
  }, []);
  return <div data-testid="home-index">index</div>;
}
const Community = () => <div data-testid="community">community</div>;
const Progress = () => <div data-testid="progress">progress</div>;
function HomeTab() {
  return (
    <HomeStack.Navigator>
      <HomeStack.Screen name="index" component={HomeIndex} />
      <HomeStack.Screen name="community/[groupId]/index" component={Community} />
    </HomeStack.Navigator>
  );
}
function TabsShell() {
  return (
    <Tabs.Navigator>
      <Tabs.Screen name="(home)" component={HomeTab} />
      <Tabs.Screen name="activity" component={Progress} />
    </Tabs.Navigator>
  );
}
const SettingsFallback = () => <RouteErrorFallback error={new Error('settings threw')} retry={() => undefined} variant="screen" />;

let container: HTMLDivElement;
let root: Root;
let ref: ReturnType<typeof createNavigationContainerRef>;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  ref = createNavigationContainerRef();
  ctl.ref = ref as never;
  ctl.log = [];
  indexMounts = 0;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const flush = () =>
  act(async () => {
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
  });
type N = { index: number; routes: Array<{ name: string; state?: N }> };
const rootNames = () => (ref.getRootState() as unknown as N).routes.map((r) => r.name);
const homeStackNames = () => {
  const s = ref.getRootState() as unknown as N;
  const tabs = s.routes.find((r) => r.name === '(tabs)')!.state!;
  return tabs.routes.find((r) => r.name === '(home)')!.state!.routes.map((r) => r.name);
};

async function settingsOverCommunity(): Promise<void> {
  act(() =>
    root.render(
      <BaseNavigationContainer ref={ref as never}>
        <RootStack.Navigator>
          <RootStack.Screen name="(tabs)" component={TabsShell} />
          <RootStack.Screen name="settings" component={SettingsFallback} />
        </RootStack.Navigator>
      </BaseNavigationContainer>,
    ),
  );
  await flush();
  expect(homeStackNames()).toEqual(['community/[groupId]/index']);
  act(() => router.push('/settings' as never));
  await flush();
  expect(rootNames()).toEqual(['(tabs)', 'settings']);
  ctl.log = [];
}

describe('RV16-641-N1: Go to Home from a root-stack screen fallback over a mounted community', () => {
  it('pops back to the tabs with the Home tab as it stands: one community, never a second', async () => {
    await settingsOverCommunity();
    const home = container.querySelector('[data-focused="true"] [data-testid="wsf-route-error-home"]') as HTMLElement;
    expect(home.textContent).toBe('Go to Home');
    await act(async () => home.click());
    await flush();
    expect(rootNames()).toEqual(['(tabs)']);
    expect(homeStackNames()).toEqual(['community/[groupId]/index']);
    expect(indexMounts).toBe(1);
    // Through the screen's navigator: expo-router's router was not asked.
    expect(ctl.log).toEqual([]);
  });

  it('control, what dismissTo("/") does there: the Home stack builds a second community', async () => {
    await settingsOverCommunity();
    act(() => router.dismissTo('/' as never));
    await flush();
    expect(rootNames()).toEqual(['(tabs)']);
    expect(homeStackNames()).toEqual(['community/[groupId]/index', 'community/[groupId]/index']);
  });
});
