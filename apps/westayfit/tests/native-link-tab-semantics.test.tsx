import { act, cloneElement, isValidElement, useEffect, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * W12-10 (INT-22, INT-32): native link and tab semantics.
 *
 *   · Home's community card: on a phone a Pressable link inside
 *     `<Link asChild>`, with one label (name, status, action); the web keeps
 *     today's anchor.
 *   · The tab bar: iOS 'tabbar' and Android 'tablist' on the container, 'tab'
 *     on each destination with its plain label (selected through
 *     accessibilityState); the web keeps its navigation landmark, link roles,
 *     ", current" and data-current.
 *
 * react-native's Platform is mocked so Platform.select follows the case's OS
 * (react-native-web's own always answers for the web). expo-router's Link is
 * mocked at its boundary: with asChild it hands its child an onPress that
 * pushes the href, as the real one does. No device.
 */
const fx = vi.hoisted(() => ({ os: 'web' as 'ios' | 'android' | 'web' }));
vi.mock('react-native', async () => {
  const actual = (await vi.importActual('react-native-web')) as Record<string, any>;
  return {
    ...actual,
    Platform: {
      ...actual.Platform,
      get OS() {
        return fx.os;
      },
      select: (o: Record<string, unknown>) =>
        fx.os in o ? o[fx.os] : fx.os !== 'web' && 'native' in o ? o.native : o.default,
    },
  };
});
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const links = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));
vi.mock('expo-router', () => ({
  router,
  Link: (props: { href: string; asChild?: boolean; children?: ReactNode } & Record<string, unknown>) => {
    links.props.push(props);
    const { href, asChild, children, style: _style, testID, ...rest } = props;
    if (asChild && isValidElement(children)) {
      return cloneElement(children as ReactElement<{ onPress?: () => void }>, { onPress: () => router.push(href) });
    }
    return (
      <a href={href} data-testid={testID as string} {...rest}>
        {children}
      </a>
    );
  },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ setParams: vi.fn() }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(() => cb(), [cb]);
  },
}));
vi.mock('firebase/auth', () => ({ signOut: vi.fn() }));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
vi.mock('../src/firebase', () => ({ wsfIsStaging: false, getFirebaseAuth: () => ({}) }));
const USER = { uid: 'u1', email: 'member@example.com', displayName: 'Member' };
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: USER, slow: false }), AuthConnectingNote: () => null }));
vi.mock('../src/currentCommunity', () => ({ resolveCurrentCommunity: () => null, useCurrentCommunityReady: () => true }));
vi.mock('../src/memberReads', () => ({
  SAME_LOAD_MS: 10_000,
  readMyCommunities: async () => ({
    items: [
      { groupId: 'oak', displayName: 'Oak Grove Together', groupType: 'custom', joinPolicy: 'private', role: 'member', memberCount: 3, isSample: false, activeChallenge: null },
      { groupId: 'harbor', displayName: 'Harbor Lunch Crew', groupType: 'custom', joinPolicy: 'private', role: 'member', memberCount: 5, isSample: true, activeChallenge: null },
    ],
  }),
  readGoals: async () => ({ goals: [] }),
}));

const { Dimensions, StyleSheet } = await import('react-native');
const { default: Home } = await import('../app/(tabs)/(home)/index');
const { MemberTabBar } = await import('../src/ui/MemberTabBar');

let container: HTMLDivElement;
let root: Root;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const settle = async () => {
  for (let i = 0; i < 6; i += 1) await act(async () => undefined);
};
type Fiber = { type: unknown; return: Fiber | null; alternate: Fiber | null; memoizedProps: Record<string, unknown> };
/** The props of the component that rendered `el` (react-native-web drops the phone's props from the DOM). */
function propsOf(el: Element): Record<string, unknown> {
  const own = el as unknown as Record<string, unknown>;
  const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))!;
  const propsKey = Object.keys(el).find((k) => k.startsWith('__reactProps$'))!;
  let fiber = own[fiberKey] as Fiber;
  if (fiber.memoizedProps !== own[propsKey] && fiber.alternate) fiber = fiber.alternate;
  while (fiber && typeof fiber.type === 'string') fiber = fiber.return as Fiber;
  return fiber.memoizedProps;
}

beforeEach(() => {
  fx.os = 'web';
  links.props = [];
  router.push.mockClear();
  vi.spyOn(Dimensions, 'get').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  fx.os = 'web';
  vi.restoreAllMocks();
});

describe('W12-10 (INT-22): Home\'s community card', () => {
  it.each(['ios', 'android'] as const)('%s: a Pressable link in <Link asChild>, with one label; one press pushes once', async (os) => {
    fx.os = os;
    act(() => root.render(<Home />));
    await settle();
    const card = byId('wsf-home-community-oak')!;
    const props = propsOf(card);
    expect(props.accessibilityRole).toBe('link');
    expect(props.accessibilityLabel).toBe('Oak Grove Together, No goal running yet, Open');
    // A sample community says so in its label, as its title does.
    expect(propsOf(byId('wsf-home-community-harbor')!).accessibilityLabel).toBe('Harbor Lunch Crew, Sample, No goal running yet, Open');
    // The card is a view: no text styles on it.
    expect(StyleSheet.flatten(props.style as never)).not.toHaveProperty('textDecorationLine');
    const oakLink = links.props.find((p) => p.href === '/community/oak')!;
    expect(oakLink.asChild).toBe(true);
    expect(card.tagName).not.toBe('A');
    await act(async () => card.click());
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/community/oak');
  });

  it('web: today\'s anchor, with its href, testID and card style; no asChild', async () => {
    act(() => root.render(<Home />));
    await settle();
    const card = byId('wsf-home-community-oak')!;
    expect(card.tagName).toBe('A');
    expect(card.getAttribute('href')).toBe('/community/oak');
    const oakLink = links.props.find((p) => p.href === '/community/oak')!;
    expect(oakLink.asChild).toBeUndefined();
    expect(oakLink.testID).toBe('wsf-home-community-oak');
    expect(oakLink.style).toMatchObject({ flexDirection: 'column', textDecorationLine: 'none' });
  });
});

describe('W12-10 (INT-32): the tab bar\'s roles', () => {
  const STATE = {
    index: 0,
    routes: [
      { key: 'h', name: '(home)' },
      { key: 'c', name: 'community' },
      { key: 'a', name: 'activity' },
      { key: 'y', name: 'you' },
    ],
  };
  const renderBar = () =>
    act(() =>
      root.render(
        <MemberTabBar
          state={STATE as never}
          navigation={{ emit: () => ({ defaultPrevented: false }), navigate: () => undefined } as never}
          descriptors={{} as never}
          insets={{ top: 0, bottom: 0, left: 0, right: 0 }}
          onMove={() => undefined}
        />,
      ),
    );

  it.each([
    ['ios', 'tabbar'],
    ['android', 'tablist'],
  ] as const)('%s: the bar is a %s; each destination a tab named plainly, its selection in accessibilityState', (os, barRole) => {
    fx.os = os;
    renderBar();
    expect(propsOf(byId('wsf-member-tabs')!).accessibilityRole).toBe(barRole);
    const home = propsOf(byId('wsf-member-tab-home')!);
    expect(home.accessibilityRole).toBe('tab');
    expect(home.accessibilityLabel).toBe('Home');
    expect(home.accessibilityState).toEqual({ selected: true });
    const community = propsOf(byId('wsf-member-tab-community')!);
    expect(community.accessibilityRole).toBe('tab');
    expect(community.accessibilityLabel).toBe('Community');
    expect(community.accessibilityState).toEqual({ selected: false });
  });

  it('web: the navigation landmark, links, ", current" and data-current, as before', () => {
    renderBar();
    expect(byId('wsf-member-tabs')!.getAttribute('role')).toBe('navigation');
    const home = byId('wsf-member-tab-home')!;
    expect(home.getAttribute('role')).toBe('link');
    expect(home.getAttribute('aria-label')).toBe('Home, current');
    expect(home.dataset.current).toBe('true');
    expect(byId('wsf-member-tab-community')!.getAttribute('aria-label')).toBe('Community');
  });
});
