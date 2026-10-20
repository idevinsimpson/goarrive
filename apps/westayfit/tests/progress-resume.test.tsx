import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppState } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-INTEGRATOR-1 (INT-12 cases 2, 4 and 6): Progress, sitting on screen,
 * makes a fresh network read when the member comes back to the app (a tab
 * return recomposes from the record; a return to the app asks the server),
 * keeps its rows while it does, and keeps them marked last-read if that read
 * fails. A goal that ended while the app slept stops offering Start moving.
 */

vi.mock('expo-router', () => ({
  router: { replace: vi.fn(), push: vi.fn() },
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(() => cb(), [cb]);
  },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const USER = { uid: 'u1' };
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: USER }) }));
const readMyCommunities = vi.fn();
const readGoals = vi.fn();
const readOwnCredit = vi.fn();
vi.mock('../src/memberReads', () => ({
  SAME_LOAD_MS: 10_000,
  peekGoals: () => undefined,
  peekMemberProfile: () => undefined,
  peekMyCommunities: () => undefined,
  peekOwnCredit: () => undefined,
  wasRefused: () => false,
  readMyCommunities: (...a: unknown[]) => readMyCommunities(...a),
  readGoals: (...a: unknown[]) => readGoals(...a),
  readOwnCredit: (...a: unknown[]) => readOwnCredit(...a),
}));

const { default: ActivityScreen } = await import('../app/(tabs)/activity');

let container: HTMLDivElement;
let root: Root;
let appStateHandlers: Array<(s: string) => void>;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await act(async () => undefined);
};

function goal(endsAt: number) {
  return { goalId: 'g-a', title: '500 squats together', target: 500, unit: 'squats', status: 'active', endsAt: new Date(endsAt).toISOString(), timezone: 'UTC', sharedTotal: 120 };
}

async function backAfter(ms: number) {
  act(() => appStateHandlers.forEach((h) => h('background')));
  act(() => vi.advanceTimersByTime(ms));
  act(() => appStateHandlers.forEach((h) => h('active')));
  await act(async () => vi.advanceTimersByTime(1_000));
}

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 20, 12), toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  readMyCommunities.mockReset().mockResolvedValue({ items: [{ groupId: 'oak', displayName: 'Oak Grove Together' }] });
  readGoals.mockReset().mockResolvedValue({ goals: [goal(Date.UTC(2026, 9, 20, 18))] });
  readOwnCredit.mockReset().mockResolvedValue({ ownCredit: 25, unit: 'squats' });
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

describe('Progress on a return to the app (INT-12)', () => {
  it('case 2: a return after a minute makes a fresh network read; the rows stay on screen while it runs', async () => {
    act(() => root.render(<ActivityScreen />));
    await settle();
    expect(byId('wsf-activity-goals')!.textContent).toContain('500 squats together');
    expect(readMyCommunities).toHaveBeenLastCalledWith('u1', 10_000);
    readMyCommunities.mockClear();
    readGoals.mockClear();
    await backAfter(60_000);
    expect(byId('wsf-activity-goals')).not.toBeNull();
    await settle();
    // Fresh (reuse 0) at every level, not an answer from this load.
    expect(readMyCommunities).toHaveBeenCalledWith('u1', 0);
    expect(readGoals).toHaveBeenCalledWith('u1', 'oak', 0);
    expect(byId('wsf-activity-goals')!.textContent).toContain('500 squats together');
  });

  it('case 4: across the goal\'s end while away, Start moving goes (no part recorded yet)', async () => {
    readOwnCredit.mockResolvedValue({ ownCredit: 0, unit: 'squats' });
    act(() => root.render(<ActivityScreen />));
    await settle();
    expect(byId('wsf-activity-start')).not.toBeNull();
    // Seven hours away: the goal ended at 18:00 while the app slept.
    await backAfter(7 * 60 * 60 * 1000);
    await settle();
    expect(byId('wsf-activity-start')).toBeNull();
    expect(byId('wsf-activity-empty')!.textContent).toContain('No goal is open for contributions');
  });

  it('case 4: across the goal\'s end while away, its line reads Ended (part recorded)', async () => {
    act(() => root.render(<ActivityScreen />));
    await settle();
    expect(byId('wsf-activity-goals')!.textContent).not.toMatch(/Ended/);
    await backAfter(7 * 60 * 60 * 1000);
    await settle();
    expect(byId('wsf-activity-goals')!.textContent).toMatch(/Ended/);
  });

  it('case 6: a failed resume read keeps the figures, marked as last read, with Retry', async () => {
    act(() => root.render(<ActivityScreen />));
    await settle();
    readMyCommunities.mockRejectedValue(Object.assign(new Error('internal'), { code: 'functions/internal' }));
    await backAfter(60_000);
    await settle();
    expect(byId('wsf-activity-goals')!.textContent).toContain('500 squats together');
    expect(container.textContent).toContain('This is what was last read.');
    expect(byId('wsf-activity-error')).toBeNull();
  });

  it('a flick away (under 30 s) reads nothing', async () => {
    act(() => root.render(<ActivityScreen />));
    await settle();
    readMyCommunities.mockClear();
    await backAfter(10_000);
    await settle();
    expect(readMyCommunities).not.toHaveBeenCalled();
  });
});

