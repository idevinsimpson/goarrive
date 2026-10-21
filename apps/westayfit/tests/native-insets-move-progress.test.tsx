import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Platform, StyleSheet } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * W12-16 (INT-09, INT-30).
 *   · /move/<goalId> starts below the status bar on a phone: each Page
 *     variant (loading, unavailable, ready) has the top spacer as its first
 *     child; the web has none.
 *   · tabContentBottomReserve: the web's value is today's (bar body + MOVE
 *     overhang + safe area); a phone reserves MOVE's overhang only, because
 *     the tab navigator lays the bar out below the scene. Progress pads by it.
 * The inset helper's twin follows the case (the phone's reads the nearest
 * provider's top inset, 59 here). No device.
 */
const fx = vi.hoisted(() => ({ native: false }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
  initialWindowMetrics: { insets: { top: 59, bottom: 34, left: 0, right: 0 }, frame: { x: 0, y: 0, width: 390, height: 844 } },
}));
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('../src/ui/useScreenTopInset', async () => {
  const web = await vi.importActual<typeof import('../src/ui/useScreenTopInset')>('../src/ui/useScreenTopInset');
  const native = await import('../src/ui/useScreenTopInset.native');
  const twin = () => (fx.native ? native : web) as typeof web;
  return {
    TopCleared: (props: Parameters<typeof web.TopCleared>[0]) => twin().TopCleared(props),
    useScreenTopInset: () => twin().useScreenTopInset(),
    ScreenTopSpacer: () => twin().ScreenTopSpacer(),
    ScreenStatusBar: (props: Parameters<typeof web.ScreenStatusBar>[0]) => twin().ScreenStatusBar(props),
  };
});
const params = vi.hoisted(() => ({ value: { goalId: 'g1' } as Record<string, string> }));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => params.value,
  useFocusEffect: () => undefined,
  router: { push: vi.fn(), replace: vi.fn() },
  Link: ({ children }: { children?: unknown }) => children,
}));
vi.mock('../src/firebase', () => ({ getFirebaseFunctions: () => ({}), getFirebaseAuth: () => ({}), wsfIsStaging: false }));
const pulse = vi.hoisted(() => ({ answer: (): Promise<unknown> => new Promise(() => undefined) }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => async () => ({ data: await pulse.answer() }),
}));

const { default: MoveGoal } = await import('../app/move/[goalId]');
const { MEMBER_TAB_BAR_BODY, MEMBER_TAB_MOVE_OVERHANG, tabContentBottomReserve } = await import('../src/ui/MemberTabBar');
const { ProgressParityView } = await import('../src/ui/ProgressParityView');

let container: HTMLDivElement;
let root: Root;
let os: string;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const settle = async () => {
  for (let i = 0; i < 6; i += 1) await act(async () => undefined);
};
const phone = () => {
  fx.native = true;
  (Platform as { OS: string }).OS = 'ios';
};

beforeEach(() => {
  os = Platform.OS;
  fx.native = false;
  params.value = { goalId: 'g1' };
  pulse.answer = () => new Promise(() => undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  (Platform as { OS: string }).OS = os;
  vi.restoreAllMocks();
});

describe('W12-16 (INT-09): /move/<goalId> starts below the status bar on a phone', () => {
  /** The first thing in the page's scroll content, before the column. */
  const firstChild = () => byId('wsf-move-screen')!.parentElement!.firstElementChild as HTMLElement;

  const VARIANTS: Array<[string, () => void, string]> = [
    ['loading', () => undefined, 'wsf-move-loading'],
    ['unavailable', () => (pulse.answer = () => Promise.reject(new Error('not found'))), 'wsf-move-not-available'],
    ['ready', () => (pulse.answer = async () => ({ unit: 'squats', goalTitle: '500 squats together', communityDisplayName: 'Oak Grove' })), 'wsf-move-heading'],
  ];

  it.each(VARIANTS)('%s: the top spacer (59) comes first, then the page', async (_name, arrange, marker) => {
    phone();
    arrange();
    act(() => root.render(<MoveGoal />));
    await settle();
    expect(byId(marker)).not.toBeNull();
    expect(firstChild().dataset.testid).toBe('wsf-screen-top-spacer');
    expect(firstChild().style.height).toBe('59px');
    expect(firstChild().nextElementSibling).toBe(byId('wsf-move-screen'));
  });

  it.each(VARIANTS)('web, %s: no spacer; the page is the first child, as before', async (_name, arrange, marker) => {
    arrange();
    act(() => root.render(<MoveGoal />));
    await settle();
    expect(byId(marker)).not.toBeNull();
    expect(byId('wsf-screen-top-spacer')).toBeNull();
    expect(firstChild()).toBe(byId('wsf-move-screen'));
  });
});

describe('W12-16 (INT-30): what a tab screen leaves free at its end', () => {
  it('web: today\'s value, the bar body, the overhang and the safe area', () => {
    expect(tabContentBottomReserve(0, 'web')).toBe(MEMBER_TAB_BAR_BODY + MEMBER_TAB_MOVE_OVERHANG);
    expect(tabContentBottomReserve(34, 'web')).toBe(64 + 24 + 34);
  });

  it('a phone: MOVE\'s overhang only (the bar is laid out below the scene and pads its own inset)', () => {
    for (const platform of ['ios', 'android']) {
      expect(tabContentBottomReserve(0, platform)).toBe(24);
      expect(tabContentBottomReserve(34, platform)).toBe(24);
    }
  });

  const state = { kind: 'ready' as const, memberName: 'Alex M.', open: [], finished: [], partial: false, canStart: true, receipts: null };
  const actions = { onRetry: vi.fn(), onStartMoving: vi.fn(), onOpenCommunity: vi.fn(), onOpenReceipt: vi.fn() };
  type Fiber = { type: unknown; return: Fiber | null; alternate: Fiber | null; memoizedProps: Record<string, unknown> };
  /** The ScrollView's content style, read from the component that rendered the content element. */
  const contentPadding = (): unknown => {
    const hero = byId('wsf-activity-hero')!;
    const content = hero.parentElement!;
    const own = content as unknown as Record<string, unknown>;
    const fiberKey = Object.keys(content).find((k) => k.startsWith('__reactFiber$'))!;
    let fiber = own[fiberKey] as Fiber;
    while (fiber && typeof fiber.type === 'string') fiber = fiber.return as Fiber;
    return (StyleSheet.flatten(fiber.memoizedProps.style as never) as Record<string, unknown>).paddingBottom;
  };

  it('Progress, web: the same bottom padding as before (bar body + overhang + inset)', () => {
    act(() => root.render(<ProgressParityView state={state} actions={actions} bottomInset={34} />));
    expect(contentPadding()).toBe(64 + 24 + 34);
  });

  it('Progress, a phone: the overhang only, whatever the inset', () => {
    (Platform as { OS: string }).OS = 'android';
    act(() => root.render(<ProgressParityView state={state} actions={actions} bottomInset={34} />));
    expect(contentPadding()).toBe(24);
  });
});
