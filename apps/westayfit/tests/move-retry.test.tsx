import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-INTEGRATOR-1 (INT-04 case 4, MOVE half): the MOVE resolver's error
 * offers Try again, which reads again in place and fresh (INT-26: reuse 0,
 * never joining a read that may hang), and keeps Go Home as the way out. The
 * route rendered into jsdom with its reads mocked at the module boundary. No
 * device.
 */

const router = { replace: vi.fn(), back: vi.fn(), canGoBack: () => true, dismissTo: vi.fn(), push: vi.fn() };
const navigation = { dispatch: vi.fn(), isFocused: () => true, addListener: () => () => undefined };
vi.mock('expo-router', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  router,
  useRouter: () => router,
  useNavigation: () => navigation,
  useFocusEffect: () => undefined,
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
// Reduced motion: the sheet takes no animated path (jsdom has no AccessibilityInfo events).
vi.mock('../src/ui/useReducedMotion', () => ({ useReducedMotion: () => true }));
const USER = { uid: 'u1', email: 'member@example.com', displayName: 'Member' };
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: USER }) }));
// `currentCommunityReady` is the state lane's (wsf-native-state-3): resolved
// at once on web. Listed so this mock serves the merged tree as well as this one.
vi.mock('../src/currentCommunity', () => ({
  resolveCurrentCommunity: () => 'oak',
  currentCommunityReady: () => Promise.resolve(),
}));
const readMyCommunities = vi.fn();
const readGoals = vi.fn();
vi.mock('../src/memberReads', () => ({
  SAME_LOAD_MS: 10_000,
  peekMyCommunities: () => undefined,
  peekGoals: () => undefined,
  readMyCommunities: (...a: unknown[]) => readMyCommunities(...a),
  readGoals: (...a: unknown[]) => readGoals(...a),
}));

const { default: MoveResolver } = await import('../app/move/index');

const OFFLINE = Object.assign(new Error('internal'), { code: 'functions/unavailable' });
const MINE = { items: [{ groupId: 'oak', displayName: 'Oak Grove Together' }] };
const goal = (goalId: string, endsAt: string) => ({ goalId, title: goalId, target: 100, unit: 'squats', status: 'active', endsAt, sharedTotal: 10 });
const TWO_GOALS = { goals: [goal('g1', '2030-01-01'), goal('g2', '2030-02-01')] };

let container: HTMLDivElement;
let root: Root;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const settle = async () => {
  for (let i = 0; i < 6; i += 1) await act(async () => undefined);
};

beforeEach(() => {
  readMyCommunities.mockReset();
  readGoals.mockReset();
  Object.values(router).forEach((f) => typeof f === 'function' && 'mockReset' in f && (f as ReturnType<typeof vi.fn>).mockReset());
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('MOVE resolver error (INT-04 case 4)', () => {
  it('offers Try again and keeps Go Home', async () => {
    readMyCommunities.mockRejectedValue(OFFLINE);
    act(() => root.render(<MoveResolver />));
    await settle();
    expect(byId('wsf-move-error')).not.toBeNull();
    expect(byId('wsf-move-error-retry')!.textContent).toBe('Try again');
    expect(byId('wsf-move-error-home')).not.toBeNull();
  });

  it('Try again re-reads in place, fresh, and the member gets their goals; nothing navigates', async () => {
    readMyCommunities.mockRejectedValueOnce(OFFLINE).mockResolvedValue(MINE);
    readGoals.mockResolvedValue(TWO_GOALS);
    act(() => root.render(<MoveResolver />));
    await settle();
    expect(byId('wsf-move-error')).not.toBeNull();
    await act(async () => byId('wsf-move-error-retry')!.click());
    await settle();
    expect(byId('wsf-move-error')).toBeNull();
    expect(byId('wsf-move-choose')).not.toBeNull();
    // The first read may take this load's answer; the retry never does.
    expect(readMyCommunities.mock.calls.map((c) => c[1])).toEqual([10_000, 0]);
    expect(readGoals.mock.calls.map((c) => c[2])).toEqual([0]);
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.dismissTo).not.toHaveBeenCalled();
  });

  it('a goal-list failure is retried fresh too, and a still-failing read says so again', async () => {
    readMyCommunities.mockResolvedValue(MINE);
    readGoals.mockRejectedValue(OFFLINE);
    act(() => root.render(<MoveResolver />));
    await settle();
    expect(byId('wsf-move-error')).not.toBeNull();
    await act(async () => byId('wsf-move-error-retry')!.click());
    await settle();
    expect(byId('wsf-move-error')).not.toBeNull();
    expect(readGoals.mock.calls.map((c) => c[2])).toEqual([10_000, 0]);
  });
});
