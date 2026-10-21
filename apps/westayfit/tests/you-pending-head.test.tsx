import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppState } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 W16-25 (heads-16 RV18-642-M1, pre-existing). THE "YOU"
 * HEADER NEVER TURNS BACK INTO THE PENDING NAME BAR WHEN NO READ IS IN FLIGHT.
 *
 * A record with no profile composes a pending head (the name waits for the
 * profile read). Two paths drew it with no read behind it: (b) the FOCUS path
 * redraws a whole record and issues no read, so a tab return after a failed
 * profile read replaced the "You" header with the bar for good; (a) a KEPT
 * pick or "no community" page (a return's revalidation whose list and profile
 * reads both failed) was never recomposed, so the bar it showed while loading
 * stayed, with no stale mark and no Retry (those are drawn on member pages
 * only). Now the focus path keeps the head on screen, or revalidates as for
 * an incomplete record when there is none to keep; and fail()'s keep branch
 * replaces a pending head on non-member pages too (the account's recorded
 * profile, else this load's fallback).
 *
 * The harness is tests/you-resume's: the route rendered whole (react-native-web,
 * jsdom), the account's record mocked, AppState and focus driven. No device.
 */

vi.mock('../src/ui/useReducedMotion', () => ({ useReducedMotion: () => true }));
const AUTH = { ready: true, user: { uid: 'u1', email: 'alex@example.com' } };
vi.mock('../src/auth', () => ({ useWsfAuth: () => AUTH }));
vi.mock('../src/firebase', () => ({ getFirebaseAuth: () => ({}) }));
vi.mock('firebase/auth', () => ({ signOut: () => Promise.resolve() }));
type FocusEntry = { refire: () => void };
const focus = { entries: new Set<FocusEntry>() };
vi.mock('expo-router', () => ({
  router: { replace: vi.fn(), push: vi.fn() },
  useNavigation: () => ({ dispatch: vi.fn(), getParent: () => undefined }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(() => {
      let cleanup = cb();
      const entry: FocusEntry = {
        refire: () => {
          if (typeof cleanup === 'function') cleanup();
          cleanup = cb();
        },
      };
      focus.entries.add(entry);
      return () => {
        focus.entries.delete(entry);
        if (typeof cleanup === 'function') cleanup();
      };
    }, [cb]);
  },
}));

const OAK = { groupId: 'oak', displayName: 'Oak Grove', role: 'member', memberCount: 23 };
const ELM = { groupId: 'elm', displayName: 'Elm Park', role: 'member', memberCount: 9 };
const FUTURE = '2099-01-01T00:00:00.000Z';
const GOAL = { goalId: 'g1', title: '500 squats', target: 500, unit: 'squats', status: 'active', sharedTotal: 241, endsAt: FUTURE, timezone: 'UTC' };
const OWN = (n: number) => ({ ownCredit: n, unit: 'squats' });
const OFFLINE = () => Object.assign(new Error('x'), { code: 'functions/unavailable' });
const readMemberProfile = vi.fn();
const readMyCommunities = vi.fn();
const readGoals = vi.fn();
const readOwnCredit = vi.fn();
type Rec = {
  communities?: { items: unknown[] };
  profile?: unknown;
  goals: Record<string, { goals: unknown[] }>;
  own: Record<string, { ownCredit: number; unit: string }>;
};
let record: Rec = { goals: {}, own: {} };
vi.mock('../src/memberReads', () => ({
  SAME_LOAD_MS: 10_000,
  peekGoals: (_u: string, groupId: string) => record.goals[groupId],
  peekMemberProfile: () => record.profile,
  peekMyCommunities: () => record.communities,
  peekOwnCredit: (_u: string, goalId: string) => record.own[goalId],
  wasRefused: () => false,
  readMemberProfile: (...a: unknown[]) => readMemberProfile(...a),
  readMyCommunities: (...a: unknown[]) => readMyCommunities(...a),
  readGoals: (...a: unknown[]) => readGoals(...a),
  readOwnCredit: (...a: unknown[]) => readOwnCredit(...a),
}));

const { default: You } = await import('../app/(tabs)/you');
const { rememberCurrentCommunity } = await import('../src/currentCommunity');
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
  readMyCommunities.mockResolvedValue({ items: [OAK] });
  readGoals.mockResolvedValue({ goals: [GOAL] });
  readOwnCredit.mockResolvedValue(OWN(0));
  window.localStorage.clear();
  record = { goals: {}, own: {} };
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
/** Back to the You tab: the focus path. */
async function refocus(): Promise<void> {
  act(() => focus.entries.forEach((e) => e.refire()));
  await flush();
  await flush();
}
async function returnAfter(ms: number): Promise<void> {
  emit('background');
  act(() => vi.advanceTimersByTime(ms));
  emit('active');
  act(() => vi.advanceTimersByTime(RESUME_SETTLE_MS));
  await flush();
  await flush();
}
const hangs = () => new Promise<never>(() => {});
/** The "You" header, with the header role, and no pending bar anywhere. */
function expectYouHeader(): void {
  expect(byId('wsf-you-name-pending')).toBeNull();
  expect(byId('wsf-you-name')?.textContent).toBe('You');
  expect(byId('wsf-you-name')?.getAttribute('role')).toBe('heading');
}

describe('RV18-642-M1 (b): the focus path redraws a record that holds no profile', () => {
  it('member page: the profile read failed at mount ("You"); Home records the rest; a tab return keeps the "You" header, with no read', async () => {
    readMemberProfile.mockRejectedValueOnce(OFFLINE());
    await render();
    expect(byId('wsf-you-member')).not.toBeNull();
    expectYouHeader();
    record = { communities: { items: [OAK] }, goals: { oak: { goals: [GOAL] } }, own: { g1: OWN(0) } };
    const reads = readMyCommunities.mock.calls.length;
    await refocus();
    expect(byId('wsf-you-member')).not.toBeNull();
    expectYouHeader();
    expect(readMyCommunities.mock.calls.length, 'the whole record needs no read').toBe(reads);
  });

  it('"no community" page: the same', async () => {
    readMemberProfile.mockRejectedValueOnce(OFFLINE());
    readMyCommunities.mockResolvedValue({ items: [] });
    await render();
    expect(byId('wsf-you-no-community')).not.toBeNull();
    expectYouHeader();
    record = { communities: { items: [] }, goals: {}, own: {} };
    await refocus();
    expect(byId('wsf-you-no-community')).not.toBeNull();
    expectYouHeader();
  });

  it('a recorded name is never lost to the record: the head on screen stays through later returns too', async () => {
    await render();
    expect(byId('wsf-you-name')?.textContent).toBe('Alex');
    record = { communities: { items: [OAK] }, goals: { oak: { goals: [GOAL] } }, own: { g1: OWN(25) } };
    await refocus();
    expect(byId('wsf-you-name')?.textContent).toBe('Alex');
    expect(byId('wsf-you-lead-own')?.textContent).toBe('25 squats');
    await refocus();
    expect(byId('wsf-you-name')?.textContent).toBe('Alex');
    expect(byId('wsf-you-name-pending')).toBeNull();
  });

  it('with no head on screen to keep (the first load still in flight), a tab return revalidates instead: a read is behind the bar, and the name lands', async () => {
    readMyCommunities.mockImplementationOnce(hangs);
    readMemberProfile.mockImplementationOnce(hangs);
    await render();
    expect(byId('wsf-you-member')).toBeNull();
    record = { communities: { items: [OAK] }, goals: { oak: { goals: [GOAL] } }, own: { g1: OWN(0) } };
    const profileReads = readMemberProfile.mock.calls.length;
    await refocus();
    expect(readMemberProfile.mock.calls.length, 'the profile is read').toBe(profileReads + 1);
    expect(byId('wsf-you-member')).not.toBeNull();
    expect(byId('wsf-you-name')?.textContent).toBe('Alex');
    expect(byId('wsf-you-name-pending')).toBeNull();
  });
});

describe('RV18-642-M1 (a): a kept non-member page whose head was pending', () => {
  /** A load that draws the record's page while its reads hang: the bar shows with a read behind it. */
  async function pendingWhileLoading(): Promise<void> {
    readMyCommunities.mockImplementationOnce(hangs);
    readMemberProfile.mockImplementationOnce(hangs);
    await render();
    expect(byId('wsf-you-name-pending')).not.toBeNull();
  }

  it('"no community": the return\'s list and profile reads both fail: the page is kept with the "You" header, never the bar', async () => {
    record = { communities: { items: [] }, goals: {}, own: {} };
    await pendingWhileLoading();
    expect(byId('wsf-you-no-community')).not.toBeNull();
    readMyCommunities.mockRejectedValueOnce(OFFLINE());
    readMemberProfile.mockRejectedValueOnce(OFFLINE());
    await returnAfter(RESUME_MIN_AWAY_MS + 1_000);
    expect(byId('wsf-you-no-community')).not.toBeNull();
    expect(byId('wsf-you-failed')).toBeNull();
    expectYouHeader();
  });

  it('pick a community: the same', async () => {
    record = { communities: { items: [OAK, ELM] }, goals: {}, own: {} };
    await pendingWhileLoading();
    expect(byId('wsf-you-pick-community')).not.toBeNull();
    readMyCommunities.mockRejectedValueOnce(OFFLINE());
    readMemberProfile.mockRejectedValueOnce(OFFLINE());
    await returnAfter(RESUME_MIN_AWAY_MS + 1_000);
    expect(byId('wsf-you-pick-community')).not.toBeNull();
    expect(byId('wsf-you-failed')).toBeNull();
    expectYouHeader();
  });

  it('the account\'s recorded profile comes first: recorded as "Alexandra" meanwhile, the kept page shows it', async () => {
    record = { communities: { items: [] }, goals: {}, own: {} };
    await pendingWhileLoading();
    record = { ...record, profile: { displayName: 'Alexandra', createdAt: null } };
    readMyCommunities.mockRejectedValueOnce(OFFLINE());
    readMemberProfile.mockRejectedValueOnce(OFFLINE());
    await returnAfter(RESUME_MIN_AWAY_MS + 1_000);
    expect(byId('wsf-you-no-community')).not.toBeNull();
    expect(byId('wsf-you-name-pending')).toBeNull();
    expect(byId('wsf-you-name')?.textContent).toBe('Alexandra');
  });

  it('control: a kept non-member page with a name keeps it when this load\'s profile read fails', async () => {
    readMyCommunities.mockResolvedValue({ items: [] });
    await render();
    expect(byId('wsf-you-name')?.textContent).toBe('Alex');
    readMyCommunities.mockRejectedValueOnce(OFFLINE());
    readMemberProfile.mockRejectedValueOnce(OFFLINE());
    await returnAfter(RESUME_MIN_AWAY_MS + 1_000);
    expect(byId('wsf-you-no-community')).not.toBeNull();
    expect(byId('wsf-you-name')?.textContent).toBe('Alex');
  });

  it('control: a fresh answer wins: this load\'s profile read answers a new name while the list fails', async () => {
    readMyCommunities.mockResolvedValue({ items: [] });
    await render();
    readMyCommunities.mockRejectedValueOnce(OFFLINE());
    readMemberProfile.mockResolvedValueOnce({ displayName: 'Alex B.', createdAt: null });
    await returnAfter(RESUME_MIN_AWAY_MS + 1_000);
    expect(byId('wsf-you-no-community')).not.toBeNull();
    expect(byId('wsf-you-name')?.textContent).toBe('Alex B.');
  });
});
