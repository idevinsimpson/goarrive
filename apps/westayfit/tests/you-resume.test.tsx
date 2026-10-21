import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppState } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 W16-2 (INT-12) on You. The JS context survives hours in the
 * background and focus never fires on a return to the app, so You kept
 * offering "Start moving" for a goal that had ended while the app slept. A
 * return after at least 30 s away now reads fresh (reuse 0), as Progress does,
 * keeping what is on screen; a failed read keeps it, marked as last read.
 * The route is rendered whole (react-native-web, jsdom), AppState driven as
 * tests/resume-refresh.test.tsx does. No device.
 */

vi.mock('../src/ui/useReducedMotion', () => ({ useReducedMotion: () => true }));
const AUTH = { ready: true, user: { uid: 'u1', email: 'alex@example.com' } };
vi.mock('../src/auth', () => ({ useWsfAuth: () => AUTH }));
vi.mock('../src/firebase', () => ({ getFirebaseAuth: () => ({}) }));
vi.mock('firebase/auth', () => ({ signOut: () => Promise.resolve() }));
vi.mock('expo-router', () => ({
  router: { replace: vi.fn(), push: vi.fn() },
  useNavigation: () => ({ dispatch: vi.fn(), getParent: () => undefined }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(() => cb(), [cb]);
  },
}));

const COMMUNITY = { groupId: 'oak', displayName: 'Oak Grove', role: 'member', memberCount: 23 };
const FUTURE = '2099-01-01T00:00:00.000Z';
const goal = (status: string) => ({ goalId: 'g1', title: '500 squats', target: 500, unit: 'squats', status, sharedTotal: 241, endsAt: FUTURE, timezone: 'UTC' });
const readMemberProfile = vi.fn();
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
  readMemberProfile: (...a: unknown[]) => readMemberProfile(...a),
  readMyCommunities: (...a: unknown[]) => readMyCommunities(...a),
  readGoals: (...a: unknown[]) => readGoals(...a),
  readOwnCredit: (...a: unknown[]) => readOwnCredit(...a),
}));

const { default: You } = await import('../app/(tabs)/you');
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
  for (const f of [readMemberProfile, readMyCommunities, readGoals, readOwnCredit]) f.mockReset();
  readMemberProfile.mockResolvedValue({ displayName: 'Alex', createdAt: null });
  readMyCommunities.mockResolvedValue({ items: [COMMUNITY] });
  readGoals.mockResolvedValue({ goals: [goal('active')] });
  readOwnCredit.mockResolvedValue({ ownCredit: 0, unit: 'squats' });
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
    root.render(<You />);
  });
  await flush();
}
const emit = (s: string) => act(() => handlers.forEach((h) => h(s)));
async function returnAfter(ms: number): Promise<void> {
  emit('background');
  act(() => vi.advanceTimersByTime(ms));
  emit('active');
  act(() => vi.advanceTimersByTime(RESUME_SETTLE_MS));
}

describe('W16-2 / INT-12: You revalidates on a return to the app', () => {
  it('after 30 s away it reads fresh (reuse 0), keeps the page, and stops offering Start moving for an ended goal', async () => {
    await render();
    expect(byId('wsf-you-start-moving')).not.toBeNull();
    // The first load may reuse a just-read answer.
    expect(readMyCommunities.mock.calls[0]).toEqual(['u1', 10_000]);
    let answer!: (v: unknown) => void;
    readMyCommunities.mockImplementationOnce(() => new Promise((res) => (answer = res)));
    readGoals.mockResolvedValue({ goals: [goal('closed')] });
    await returnAfter(RESUME_MIN_AWAY_MS + 1_000);
    expect(readMyCommunities).toHaveBeenCalledTimes(2);
    expect(readMyCommunities.mock.calls[1]).toEqual(['u1', 0]);
    expect(readMemberProfile.mock.calls[1]).toEqual(['u1', 0]);
    // What is on screen stays while it reads.
    expect(byId('wsf-you-member')).not.toBeNull();
    expect(byId('wsf-you-loading')).toBeNull();
    await act(async () => answer({ items: [COMMUNITY] }));
    await flush();
    expect(readGoals.mock.calls[1]).toEqual(['u1', 'oak', 0]);
    expect(byId('wsf-you-start-moving')).toBeNull();
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

  it('a failed revalidation keeps the page, marked as last read', async () => {
    await render();
    readMyCommunities.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'functions/unavailable' }));
    await returnAfter(RESUME_MIN_AWAY_MS + 1_000);
    await flush();
    expect(byId('wsf-you-member')).not.toBeNull();
    expect(byId('wsf-you-stale')).not.toBeNull();
    expect(byId('wsf-you-start-moving')).not.toBeNull();
  });

  // INT-12 case 4 (review 1343247d-N3): the goal ended while the app slept and
  // the revalidation failed. The page is kept, but recomposed against now.
  it('a goal whose end passed during the suspend stops offering Start moving even when the read fails', async () => {
    const endsSoon = new Date(Date.now() + 30_000).toISOString();
    readGoals.mockResolvedValue({ goals: [{ ...goal('active'), endsAt: endsSoon }] });
    await render();
    expect(byId('wsf-you-start-moving')).not.toBeNull();
    readMyCommunities.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'functions/unavailable' }));
    await returnAfter(RESUME_MIN_AWAY_MS + 15_000);
    await flush();
    expect(byId('wsf-you-member')).not.toBeNull();
    expect(byId('wsf-you-stale')).not.toBeNull();
    expect(byId('wsf-you-start-moving')).toBeNull();
  });

  it('a failed page is retried on any return, however short', async () => {
    readMyCommunities.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'functions/unavailable' }));
    await render();
    expect(byId('wsf-you-failed')).not.toBeNull();
    await returnAfter(1_000);
    await flush();
    expect(readMyCommunities).toHaveBeenCalledTimes(2);
    expect(byId('wsf-you-member')).not.toBeNull();
  });
});
