import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppState } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-INTEGRATOR-1 (INT-04, with INT-12): Home's communities error offers
 * Retry, Retry reads fresh in place, and a return to the app retries it with
 * no tap. The route rendered into jsdom (react-native-web) with its reads
 * mocked at the module boundary. No device.
 */

vi.mock('expo-router', () => ({
  router: { replace: vi.fn(), push: vi.fn() },
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ setParams: vi.fn() }),
  // Focused once, on mount, as the screen is when it opens.
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(() => cb(), [cb]);
  },
}));
vi.mock('firebase/auth', () => ({ signOut: vi.fn() }));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
vi.mock('../src/firebase', () => ({ getFirebaseAuth: () => ({}) }));
// One user object, as Firebase hands the same User to every render.
const USER = { uid: 'u1', email: 'member@example.com', displayName: 'Member' };
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: USER }) }));
// Two communities and nothing chosen: Home shows the list rather than opening one.
vi.mock('../src/currentCommunity', () => ({ resolveCurrentCommunity: () => null }));
const readMyCommunities = vi.fn();
const readGoals = vi.fn();
vi.mock('../src/memberReads', () => ({
  SAME_LOAD_MS: 10_000,
  readMyCommunities: (...a: unknown[]) => readMyCommunities(...a),
  readGoals: (...a: unknown[]) => readGoals(...a),
}));

const { default: Home } = await import('../app/(tabs)/(home)/index');

const OFFLINE = Object.assign(new Error('internal'), { code: 'functions/internal' });
const TWO = {
  items: [
    { groupId: 'oak', displayName: 'Oak Grove Together', groupType: 'custom', joinPolicy: 'private', role: 'member', memberCount: 3, isSample: false, activeChallenge: null },
    { groupId: 'harbor', displayName: 'Harbor Lunch Crew', groupType: 'custom', joinPolicy: 'private', role: 'member', memberCount: 5, isSample: false, activeChallenge: null },
  ],
};

let container: HTMLDivElement;
let root: Root;
let appStateHandlers: Array<(s: string) => void>;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await act(async () => undefined);
};

beforeEach(() => {
  readMyCommunities.mockReset();
  readGoals.mockReset();
  readGoals.mockResolvedValue({ goals: [] });
  appStateHandlers = [];
  vi.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, h: (s: string) => void) => {
    appStateHandlers.push(h);
    return { remove: () => (appStateHandlers = appStateHandlers.filter((x) => x !== h)) };
  }) as never);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Home (INT-04)', () => {
  it('case 1: a cold start offline names the connection and offers Retry; never blank, never "not in a community"', async () => {
    readMyCommunities.mockRejectedValue(OFFLINE);
    act(() => root.render(<Home />));
    await settle();
    expect(byId('wsf-home-my-error')!.textContent).toContain('We couldn’t reach the server. Check your connection');
    expect(byId('wsf-home-my-retry')!.textContent).toBe('Retry');
    expect(byId('wsf-home-my-empty')).toBeNull();
    expect(container.textContent).not.toContain('not in a community');
  });

  it('case 2: Retry reads again, fresh, in place, and the member arrives at their communities', async () => {
    readMyCommunities.mockRejectedValueOnce(OFFLINE).mockResolvedValueOnce(TWO);
    act(() => root.render(<Home />));
    await settle();
    await act(async () => byId('wsf-home-my-retry')!.click());
    await settle();
    expect(byId('wsf-home-my-error')).toBeNull();
    expect(byId('wsf-home-my-list')!.textContent).toContain('Oak Grove Together');
    // The mount read may take an answer from this load; the Retry never does.
    expect(readMyCommunities.mock.calls).toEqual([
      ['u1', 10_000],
      ['u1', 0],
    ]);
    // The cards of a list that came from a Retry read fresh too (#641 SH-5b).
    expect(readGoals.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ['oak', 0],
      ['harbor', 0],
    ]);
  });

  it('a cold start shares this load\'s answers: list and cards (no Retry, reuse SAME_LOAD_MS)', async () => {
    readMyCommunities.mockResolvedValue(TWO);
    act(() => root.render(<Home />));
    await settle();
    expect(readMyCommunities.mock.calls).toEqual([['u1', 10_000]]);
    expect(readGoals.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ['oak', 10_000],
      ['harbor', 10_000],
    ]);
  });

  it('a list stuck loading (a read hung under packet loss) is retried, fresh, on any return to the app (#641 SH-5c)', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    readMyCommunities.mockReturnValueOnce(new Promise(() => undefined)).mockResolvedValueOnce(TWO);
    act(() => root.render(<Home />));
    await settle();
    expect(byId('wsf-home-my-list')).toBeNull();
    act(() => appStateHandlers.forEach((h) => h('background')));
    act(() => vi.advanceTimersByTime(3_000));
    act(() => appStateHandlers.forEach((h) => h('active')));
    await act(async () => vi.advanceTimersByTime(1_000));
    vi.useRealTimers();
    await settle();
    expect(byId('wsf-home-my-list')!.textContent).toContain('Harbor Lunch Crew');
    expect(readMyCommunities.mock.calls).toEqual([
      ['u1', 10_000],
      ['u1', 0],
    ]);
  });

  it('case 2 (with INT-12): coming back to the app after reconnecting retries with no tap', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    readMyCommunities.mockRejectedValueOnce(OFFLINE).mockResolvedValueOnce(TWO);
    act(() => root.render(<Home />));
    await settle();
    expect(byId('wsf-home-my-error')).not.toBeNull();
    act(() => appStateHandlers.forEach((h) => h('background')));
    act(() => vi.advanceTimersByTime(3_000));
    act(() => appStateHandlers.forEach((h) => h('active')));
    await act(async () => vi.advanceTimersByTime(1_000));
    vi.useRealTimers();
    await settle();
    expect(byId('wsf-home-my-list')!.textContent).toContain('Harbor Lunch Crew');
    expect(readMyCommunities).toHaveBeenCalledTimes(2);
  });

  it('INT-12: a quick trip away from a healthy list reads nothing; a long one re-reads quietly', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    readMyCommunities.mockResolvedValue(TWO);
    act(() => root.render(<Home />));
    await settle();
    expect(readMyCommunities).toHaveBeenCalledTimes(1);
    act(() => appStateHandlers.forEach((h) => h('background')));
    act(() => vi.advanceTimersByTime(5_000));
    act(() => appStateHandlers.forEach((h) => h('active')));
    await act(async () => vi.advanceTimersByTime(1_000));
    await settle();
    expect(readMyCommunities).toHaveBeenCalledTimes(1);
    act(() => appStateHandlers.forEach((h) => h('background')));
    act(() => vi.advanceTimersByTime(60_000));
    act(() => appStateHandlers.forEach((h) => h('active')));
    await act(async () => vi.advanceTimersByTime(1_000));
    vi.useRealTimers();
    await settle();
    expect(readMyCommunities).toHaveBeenCalledTimes(2);
    // Quietly: the list stayed on screen; it never went back to loading.
    expect(byId('wsf-home-my-list')).not.toBeNull();
    expect(byId('wsf-home-my-loading')).toBeNull();
  });
});
