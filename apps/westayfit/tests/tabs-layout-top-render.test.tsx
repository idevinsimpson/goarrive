import { act, useEffect, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Platform, Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #641 RV8-641-I10-2 (F1, rendered). The real `app/(tabs)/_layout.tsx` with
 * a FormShell as its scene (a community's challenge page or join gate), on
 * iOS at a 59 pt inset. expo-router's Tabs is mocked to render that scene and
 * the tab bar; auth, the tab bar, reduced motion, the tab fade and the
 * boundary are mocked at their boundary. Everything between the shell and
 * the FormShell field is the real code. No device: Appendix C.
 */
const state = { user: null as null | { uid: string }, focused: true, scene: null as ReactNode };
// The root stack as the (tabs) screen sees it: its state, and its blur and focus events.
type Route = { key: string; name: string; params?: object };
const rootNav = {
  routes: [{ key: 't', name: '(tabs)' }] as Route[],
  listeners: {} as Record<string, Array<() => void>>,
};
const navigationObject = {
  dispatch: vi.fn(),
  getState: () => ({ index: rootNav.routes.length - 1, routes: rootNav.routes }),
  addListener: (event: string, cb: () => void) => {
    (rootNav.listeners[event] ??= []).push(cb);
    return () => {
      rootNav.listeners[event] = (rootNav.listeners[event] ?? []).filter((x) => x !== cb);
    };
  },
};

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
  initialWindowMetrics: { insets: { top: 59, bottom: 34, left: 0, right: 0 }, frame: { x: 0, y: 0, width: 393, height: 852 } },
  SafeAreaProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('expo-status-bar', () => ({
  StatusBar: ({ style }: { style: string }) => <span data-testid="status-bar" data-style={style} />,
}));
vi.mock('expo-router', () => {
  // The scene is set by the test (FormShell imports expo-router itself, so it cannot be imported here).
  const Tabs = ({ tabBar }: { tabBar?: (props: object) => ReactNode }) => (
    <>
      {state.scene}
      {tabBar ? tabBar({}) : null}
    </>
  );
  Tabs.Screen = () => null;
  return {
    Tabs,
    Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
    useRouter: () => ({ push: vi.fn() }),
    useNavigation: () => navigationObject,
    useFocusEffect: (cb: () => void | (() => void)) => {
      const [focused] = useState(state.focused);
      useEffect(() => (focused ? cb() : undefined), [focused, cb]);
    },
  };
});
vi.mock('firebase/auth', () => ({ signOut: vi.fn() }));
vi.mock('../src/firebase', () => ({ wsfIsStaging: false, getFirebaseAuth: () => ({}) }));
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ user: state.user }) }));
vi.mock('../src/ui/MemberTabBar', () => ({ MemberTabBar: () => <div data-testid="tab-bar" /> }));
vi.mock('../src/ui/useReducedMotion', () => ({
  useReducedMotion: () => false,
  useReducedMotionPreference: () => ({ known: true, reduced: false, failed: false }),
}));
vi.mock('../src/ui/TabSceneFade', () => ({ TabSceneFade: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../src/ui/RouteErrorFallback', () => ({ nativeErrorBoundary: () => undefined }));
vi.mock('../src/ui/focusReturn', () => ({ armTabsFocusReturnTo: vi.fn(), useTabsFocusReturn: vi.fn() }));
// The phone's helpers, not the web stubs vitest would otherwise resolve.
vi.mock('../src/ui/useScreenTopInset', async () => import('../src/ui/useScreenTopInset.native'));

const { default: MemberTabsLayout } = await import('../app/(tabs)/_layout');
const { FormShell } = await import('../src/AuthFormPrimitives');

let container: HTMLDivElement;
let root: Root;
let os: string;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
// The FormShell field: the block that holds the wordmark and the step chip.
const field = () => byId('wsf-form-wordmark')!.parentElement!.parentElement!;

beforeEach(() => {
  os = Platform.OS;
  (Platform as { OS: string }).OS = 'ios';
  state.user = null;
  rootNav.routes = [{ key: 't', name: '(tabs)' }];
  rootNav.listeners = {};
  state.scene = (
    <FormShell heading="Challenge" step="Members only" testID="wsf-challenge-not-member">
      <Text>body</Text>
    </FormShell>
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  (Platform as { OS: string }).OS = os;
});

describe('#641 F1, rendered: the real member shell over a FormShell scene (iOS, 59 pt)', () => {
  it('signed in: the bar pads 59, the field adds no top padding, and the scene sets no status bar', () => {
    state.user = { uid: 'u1' };
    act(() => root.render(<MemberTabsLayout />));
    expect(byId('wsf-member-topbar')!.style.paddingTop).toBe('59px');
    expect(byId('wsf-challenge-not-member')).not.toBeNull();
    expect(field().style.paddingTop).toBe('');
    expect(byId('status-bar')).toBeNull();
    expect(byId('tab-bar')).not.toBeNull();
  });

  it('signed out: no bar, so the field clears the status bar itself (28 + 59) under light icons', () => {
    act(() => root.render(<MemberTabsLayout />));
    expect(byId('wsf-member-topbar')).toBeNull();
    expect(field().style.paddingTop).toBe(`${28 + 59}px`);
    expect(byId('status-bar')!.dataset.style).toBe('light');
    expect(byId('tab-bar')).toBeNull();
  });
});

describe('W12-9 (INT-17): while a sheet or panel covers the tabs, the screen reader cannot reach them', () => {
  const shell = () => container.firstElementChild as HTMLElement;
  const emit = (event: string) => act(() => (rootNav.listeners[event] ?? []).slice().forEach((cb) => cb()));
  const cover = (route: Route) => {
    rootNav.routes = [{ key: 't', name: '(tabs)' }, route];
    emit('blur');
  };
  const uncover = () => {
    rootNav.routes = [{ key: 't', name: '(tabs)' }];
    emit('focus');
  };
  /*
    The View's own props: react-native-web renders neither prop to the DOM (they
    are the phone's), so they are read from the View that rendered the shell's
    element, the first component above it in React's tree.
  */
  type Fiber = { type: unknown; return: Fiber | null; alternate: Fiber | null; memoizedProps: Record<string, unknown> };
  const viewProps = (el: HTMLElement) => {
    const own = el as unknown as Record<string, unknown>;
    const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))!;
    const propsKey = Object.keys(el).find((k) => k.startsWith('__reactProps$'))!;
    // The node keeps the fiber it was created with; the committed one is whichever carries its latest props.
    let fiber = own[fiberKey] as Fiber;
    if (fiber.memoizedProps !== own[propsKey] && fiber.alternate) fiber = fiber.alternate;
    while (fiber && typeof fiber.type === 'string') fiber = fiber.return as Fiber;
    return fiber.memoizedProps;
  };
  const hidden = () => {
    const p = viewProps(shell());
    const on = p.accessibilityElementsHidden === true;
    expect(p.importantForAccessibility === 'no-hide-descendants').toBe(on);
    return on;
  };

  it.each(['ios', 'android'] as const)('%s: hidden under MOVE, the contribution sheet and Settings; shown again in front', (os) => {
    (Platform as { OS: string }).OS = os;
    state.user = { uid: 'u1' };
    act(() => root.render(<MemberTabsLayout />));
    expect(hidden()).toBe(false);
    cover({ key: 'm', name: 'move/index' });
    expect(hidden()).toBe(true);
    uncover();
    expect(hidden()).toBe(false);
    cover({ key: 'c', name: 'contribute/[goalId]', params: { goalId: 'g1', mode: 'move' } });
    expect(hidden()).toBe(true);
    uncover();
    cover({ key: 's', name: 'settings' });
    expect(hidden()).toBe(true);
    uncover();
    expect(hidden()).toBe(false);
  });

  it('a sheet over MOVE (the hand-off) keeps the tabs hidden; a route not over the tabs does not hide them', () => {
    (Platform as { OS: string }).OS = 'ios';
    act(() => root.render(<MemberTabsLayout />));
    rootNav.routes = [
      { key: 't', name: '(tabs)' },
      { key: 'm', name: 'move/index' },
      { key: 'c', name: 'contribute/[goalId]', params: { goalId: 'g1', mode: 'move' } },
    ];
    emit('blur');
    expect(hidden()).toBe(true);
    uncover();
    rootNav.routes = [{ key: 'x', name: 'kiosk/[goalId]' }, { key: 't', name: '(tabs)' }];
    emit('blur');
    expect(hidden()).toBe(false);
  });

  it('web: never hidden this way (the web makes the shell inert itself)', () => {
    (Platform as { OS: string }).OS = 'web';
    act(() => root.render(<MemberTabsLayout />));
    cover({ key: 'm', name: 'move/index' });
    expect(hidden()).toBe(false);
    expect(rootNav.listeners.blur ?? []).toHaveLength(0);
  });
});
