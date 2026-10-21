import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppState } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 W16-2 (INT-12, HB-03) on the Community tab.
 *
 * INT-12: the tab stays mounted and focus never fires on a return to the app,
 * so it kept whatever it last read. A return after at least 30 s away now runs
 * the fresh reads QUIETLY: the rows stay (no skeleton), and a failed read keeps
 * them, marked as last read, with Retry. Nothing happens after 'inactive' alone
 * or a shorter trip.
 *
 * HB-03: a roster refused without the function's own sentence (the staging
 * hold in front of wsfCommunityMembers) says the member list is temporarily
 * unavailable -- the heading keeps the count and no names are drawn. A network
 * failure keeps "just now".
 *
 * The route is rendered whole (react-native-web, jsdom) with AppState driven
 * as tests/resume-refresh.test.tsx does. No device.
 */

vi.mock('../src/ui/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
// One stable object, as the real hook gives: a new user object each render would re-run every load.
const AUTH = { ready: true, user: { uid: 'u1' } };
vi.mock('../src/auth', () => ({ useWsfAuth: () => AUTH }));
vi.mock('../src/firebase', () => ({ getFirebaseFunctions: () => ({}) }));
vi.mock('../src/ui/CommunityPrivacyControls', () => ({ onPrivacySettled: () => () => {} }));
vi.mock('expo-router', () => ({
  router: { replace: vi.fn(), push: vi.fn() },
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(() => cb(), [cb]);
  },
}));

const OAK = { groupId: 'oak', displayName: 'Oak Grove', memberCount: 23, role: 'member' };
const goal = (sharedTotal: number) => ({ goalId: 'g1', title: '500 squats', target: 500, unit: 'squats', status: 'active', sharedTotal });
const readMyCommunities = vi.fn();
const readGoals = vi.fn();
vi.mock('../src/memberReads', () => ({
  peekMyCommunities: () => undefined,
  peekGoals: () => undefined,
  wasRefused: () => false,
  readMyCommunities: (...a: unknown[]) => readMyCommunities(...a),
  readGoals: (...a: unknown[]) => readGoals(...a),
}));
const fnError = (code: string, message: string) => Object.assign(new Error(message), { code: `functions/${code}` });
const members = vi.fn();
const recent = vi.fn();
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) =>
    name === 'wsfCommunityMembers' ? (...a: unknown[]) => members(...a) : (...a: unknown[]) => recent(...a),
}));

const { default: CommunityTab } = await import('../app/(tabs)/community/index');
const { RESUME_MIN_AWAY_MS, RESUME_SETTLE_MS } = await import('../src/useResumeRefresh');

let container: HTMLDivElement;
let root: Root;
let handlers: Array<(s: string) => void>;
beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
  handlers = [];
  vi.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, h: (s: string) => void) => {
    handlers.push(h);
    return { remove: () => (handlers = handlers.filter((x) => x !== h)) };
  }) as never);
  readMyCommunities.mockReset();
  readGoals.mockReset();
  members.mockReset();
  recent.mockReset();
  recent.mockResolvedValue({ data: { additions: [] } });
  readMyCommunities.mockResolvedValue({ items: [OAK] });
  readGoals.mockResolvedValue({ goals: [goal(241)] });
  members.mockResolvedValue({ data: { members: [{ displayName: 'Alex', role: 'member' }], nextCursor: null } });
  window.localStorage.clear();
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

const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
async function render(): Promise<void> {
  act(() => {
    root.render(<CommunityTab />);
  });
  await flush();
}
const emit = (s: string) => act(() => handlers.forEach((h) => h(s)));
/** Away for `ms`, then back, then the hook's settle delay. */
async function returnAfter(ms: number): Promise<void> {
  emit('background');
  act(() => vi.advanceTimersByTime(ms));
  emit('active');
  act(() => vi.advanceTimersByTime(RESUME_SETTLE_MS));
}

describe('W16-2 / INT-12: the Community tab revalidates on a return to the app', () => {
  it('after 30 s away it reads memberships and goals fresh, and the rows stay on screen while it does', async () => {
    await render();
    expect(byId('wsf-community-index-rows')).not.toBeNull();
    expect(readMyCommunities).toHaveBeenCalledTimes(1);
    expect(readGoals).toHaveBeenCalledTimes(1);
    let answer!: (v: unknown) => void;
    readMyCommunities.mockImplementationOnce(() => new Promise((res) => (answer = res)));
    readGoals.mockResolvedValue({ goals: [goal(300)] });
    await returnAfter(RESUME_MIN_AWAY_MS + 1_000);
    expect(readMyCommunities).toHaveBeenCalledTimes(2);
    // Fresh: no reuse window is passed (memberReads' default is 0, a server read).
    expect(readMyCommunities.mock.calls[1]).toEqual(['u1']);
    // Kept on screen, no skeleton.
    expect(byId('wsf-community-index-rows')).not.toBeNull();
    expect(byId('wsf-community-index-loading')).toBeNull();
    await act(async () => answer({ items: [OAK] }));
    await flush();
    expect(readGoals).toHaveBeenCalledTimes(2);
    expect(readGoals.mock.calls[1]).toEqual(['u1', 'oak']);
    expect(container.textContent).toContain('300');
  });

  it("nothing is read after 'inactive' alone, or a trip shorter than 30 s", async () => {
    await render();
    emit('inactive');
    emit('active');
    act(() => vi.advanceTimersByTime(RESUME_SETTLE_MS));
    await returnAfter(10_000);
    await flush();
    expect(readMyCommunities).toHaveBeenCalledTimes(1);
  });

  it('a failed revalidation keeps the rows, marked as last read, with Retry', async () => {
    await render();
    readMyCommunities.mockRejectedValueOnce(fnError('unavailable', 'unavailable'));
    await returnAfter(RESUME_MIN_AWAY_MS + 1_000);
    await flush();
    expect(byId('wsf-community-index-rows')).not.toBeNull();
    expect(byId('wsf-community-index-stale')).not.toBeNull();
    expect(container.textContent).toContain('241');
    // Retry reads again, quietly; success clears the note.
    act(() => byId('wsf-community-index-stale-retry')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();
    expect(readMyCommunities).toHaveBeenCalledTimes(3);
    expect(byId('wsf-community-index-stale')).toBeNull();
    expect(byId('wsf-community-index-rows')).not.toBeNull();
  });

  it("a revalidation whose goal read fails keeps that row's goals, marked as last read", async () => {
    await render();
    readGoals.mockRejectedValueOnce(fnError('unavailable', 'unavailable'));
    await returnAfter(RESUME_MIN_AWAY_MS + 1_000);
    await flush();
    expect(byId('wsf-community-index-stale')).not.toBeNull();
    expect(container.textContent).toContain('241');
  });

  it('a revalidation whose roster read fails keeps the names it showed, marked as last read', async () => {
    await render();
    expect(byId('wsf-parity-member-0')).not.toBeNull();
    members.mockRejectedValueOnce(fnError('unavailable', 'unavailable'));
    await returnAfter(RESUME_MIN_AWAY_MS + 1_000);
    await flush();
    expect(byId('wsf-parity-member-0')).not.toBeNull();
    expect(byId('wsf-parity-roster-failed')).toBeNull();
    expect(byId('wsf-community-index-stale')).not.toBeNull();
  });

  // Review 1343247d-N1: the momentum rows are kept too, not emptied.
  it('a revalidation whose recent-movement read fails keeps the momentum rows, marked as last read', async () => {
    recent.mockResolvedValue({ data: { additions: [{ amount: 12, unit: 'squats', at: new Date(Date.now() - 60_000).toISOString() }] } });
    await render();
    expect(byId('wsf-community-index-momentum')).not.toBeNull();
    recent.mockRejectedValue(fnError('unavailable', 'unavailable'));
    await returnAfter(RESUME_MIN_AWAY_MS + 1_000);
    await flush();
    expect(byId('wsf-community-index-momentum')).not.toBeNull();
    expect(byId('wsf-community-index-stale')).not.toBeNull();
  });

  it('an error on screen is retried on any return, however short', async () => {
    readMyCommunities.mockRejectedValueOnce(fnError('unavailable', 'unavailable'));
    await render();
    expect(readMyCommunities).toHaveBeenCalledTimes(1);
    expect(byId('wsf-community-index-rows')).toBeNull();
    await returnAfter(1_000);
    await flush();
    expect(readMyCommunities).toHaveBeenCalledTimes(2);
    expect(byId('wsf-community-index-rows')).not.toBeNull();
  });
});

describe('W16-2 / HB-03: the roster under the staging hold', () => {
  it('a body-less refusal says the list is temporarily unavailable; the count stays and no names are drawn', async () => {
    members.mockRejectedValue(fnError('permission-denied', 'permission-denied'));
    await render();
    const unavailable = byId('wsf-parity-roster-unavailable');
    expect(unavailable).not.toBeNull();
    expect(unavailable!.textContent).toContain('The member list is temporarily unavailable. Try again later.');
    expect(byId('wsf-parity-roster-failed')).toBeNull();
    expect(byId('wsf-parity-roster-count')!.textContent).toMatch(/23/);
    expect(byId('wsf-parity-member-0')).toBeNull();
    expect(container.textContent).not.toMatch(/can.t do that|sign in again|no longer a member/i);
  });

  it('Try again re-reads the roster', async () => {
    members.mockRejectedValueOnce(fnError('unauthenticated', 'Unauthenticated'));
    await render();
    expect(byId('wsf-parity-roster-unavailable')).not.toBeNull();
    act(() => byId('wsf-parity-roster-unavailable-retry')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();
    expect(members).toHaveBeenCalledTimes(2);
    expect(byId('wsf-parity-member-0')).not.toBeNull();
  });

  it('a network failure keeps "just now"', async () => {
    members.mockRejectedValue(fnError('unavailable', 'unavailable'));
    await render();
    expect(byId('wsf-parity-roster-failed')!.textContent).toContain('Members couldn’t be loaded just now.');
    expect(byId('wsf-parity-roster-unavailable')).toBeNull();
  });

  it("the function's own refusal is not called unavailable either", async () => {
    members.mockRejectedValue(fnError('permission-denied', 'Members only.'));
    await render();
    expect(byId('wsf-parity-roster-unavailable')).toBeNull();
    expect(byId('wsf-parity-roster-failed')).not.toBeNull();
  });
});
