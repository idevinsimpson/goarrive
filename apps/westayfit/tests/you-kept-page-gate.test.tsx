import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppState } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 W16-17 (RV15-639-N2, RV16-C15-1, RV16-C15-2). WHEN A FAILED
 * YOU LOAD KEEPS WHAT IS ON SCREEN.
 *
 * One gate, on the page ON SCREEN (a focus may have redrawn it since the load
 * began): a member page is kept, marked stale, only while the load's fresh
 * read still shows it (`keptPageStillShown`, state-1 c2992bef's helper); a
 * member page the fresh read contradicts gives way to the failed page for the
 * community resolved, with Retry and no stale mark; a 'loading' page is never
 * kept (it gives way to the failed page with Retry); pick, none and failed
 * pages are kept as before when no fresh list was read, and (W16-22, heads-15
 * RV17-642-N1) give way to the failed page for the community a fresh list
 * resolved, whose goals then failed.
 *
 * Built on the RV16-C15 reviewer's probe (its harness is tests/you-resume's,
 * with one realism change: the membership read writes its answer into the
 * account's record, as src/memberReads.ts does), plus a refused-community
 * control. The route is rendered whole (react-native-web, jsdom). No device.
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
const OAK_GOAL = { goalId: 'g1', title: '500 squats', target: 500, unit: 'squats', status: 'active', sharedTotal: 241, endsAt: FUTURE, timezone: 'UTC' };
const ELM_GOAL = { ...OAK_GOAL, goalId: 'e1', title: '300 lunges', unit: 'lunges', target: 300 };
const OWN = (n: number, unit = 'lunges') => ({ ownCredit: n, unit });
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
/** Communities a fresh server answer refused (src/memberReads.ts `wasRefused`). */
const refused = new Set<string>();
vi.mock('../src/memberReads', () => ({
  SAME_LOAD_MS: 10_000,
  peekGoals: (_u: string, groupId: string) => record.goals[groupId],
  peekMemberProfile: () => record.profile,
  peekMyCommunities: () => record.communities,
  peekOwnCredit: (_u: string, goalId: string) => record.own[goalId],
  wasRefused: (_u: string, groupId: string) => refused.has(groupId),
  readMemberProfile: (...a: unknown[]) => readMemberProfile(...a),
  // The real layer records the answer: the record's list becomes the fresh one.
  readMyCommunities: async (...a: unknown[]) => {
    const answer = (await readMyCommunities(...a)) as { items: unknown[] };
    record = { ...record, communities: answer };
    return answer;
  },
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
  readOwnCredit.mockResolvedValue(OWN(12));
  readMyCommunities.mockResolvedValue({ items: [OAK, ELM] });
  window.localStorage.clear();
  record = { goals: {}, own: {} };
  refused.clear();
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
const refocus = () => act(() => focus.entries.forEach((e) => e.refire()));
async function returnAfter(ms: number): Promise<void> {
  emit('background');
  act(() => vi.advanceTimersByTime(ms));
  emit('active');
  act(() => vi.advanceTimersByTime(RESUME_SETTLE_MS));
}
/** A whole record on Elm Park (remembered), the account also in Oak Grove. */
function wholeRecordOnElm() {
  rememberCurrentCommunity('u1', 'elm');
  record = {
    communities: { items: [OAK, ELM] },
    profile: { displayName: 'Alex', createdAt: null },
    goals: { elm: { goals: [ELM_GOAL] } },
    own: { e1: OWN(12) },
  };
}
const oakGoalsFail = () =>
  readGoals.mockImplementation(async (_u: string, g: string) => {
    if (g === 'oak') throw OFFLINE();
    return { goals: [ELM_GOAL] };
  });
const text = () => container.textContent ?? '';
/** The failed page for Oak Grove: its band, Retry, no stale mark, nothing of Elm Park. */
function expectFailedForOak(): void {
  expect(byId('wsf-you-failed')).not.toBeNull();
  expect(byId('wsf-you-retry')).not.toBeNull();
  expect(byId('wsf-you-member')).toBeNull();
  expect(byId('wsf-you-stale')).toBeNull();
  expect(byId('wsf-you-community')!.textContent).toContain('Oak Grove');
  expect(text()).not.toContain('Elm Park');
}

describe('W16-17: a failed You load keeps the page on screen only while its fresh read still shows it', () => {
  it('(a) RV16-C15-1, the reviewer’s P3: Oak drawn from the record, its list read hangs, a focus draws Elm from the record; the list answers [Oak, Elm], Elm is resolved and its goals fail: Elm is kept, marked stale', async () => {
    rememberCurrentCommunity('u1', 'oak');
    record = {
      communities: { items: [OAK, ELM] },
      profile: { displayName: 'Alex', createdAt: null },
      goals: { oak: { goals: [OAK_GOAL] } },
      own: { g1: OWN(10, 'squats') },
    };
    let answer!: (v: unknown) => void;
    readMyCommunities.mockImplementationOnce(() => new Promise((res) => (answer = res)));
    readGoals.mockImplementation(async (_u: string, g: string) => {
      if (g === 'elm') throw OFFLINE();
      return { goals: [OAK_GOAL] };
    });
    await render();
    expect(byId('wsf-you-community')!.textContent).toContain('Oak Grove');
    rememberCurrentCommunity('u1', 'elm');
    record = { ...record, goals: { ...record.goals, elm: { goals: [ELM_GOAL] } }, own: { ...record.own, e1: OWN(12) } };
    refocus();
    await flush();
    await flush();
    expect(byId('wsf-you-community')!.textContent).toContain('Elm Park');
    await act(async () => answer({ items: [OAK, ELM] }));
    await flush();
    await flush();
    expect(readGoals.mock.calls.map((c) => c[1])).toEqual(['elm']);
    expect(byId('wsf-you-member')).not.toBeNull();
    expect(byId('wsf-you-community')!.textContent).toContain('Elm Park');
    expect(byId('wsf-you-stale')).not.toBeNull();
    expect(byId('wsf-you-failed')).toBeNull();
  });

  it('(b) the reviewer’s P1 (a load that drew the record): Elm from the record, the fresh list is [Oak] and Oak’s goals fail: the failed page for Oak', async () => {
    wholeRecordOnElm();
    let answer!: (v: unknown) => void;
    readMyCommunities.mockImplementationOnce(() => new Promise((res) => (answer = res)));
    oakGoalsFail();
    await render();
    expect(byId('wsf-you-community')!.textContent).toContain('Elm Park');
    await act(async () => answer({ items: [OAK] }));
    await flush();
    await flush();
    expect(readGoals.mock.calls.map((c) => c[1])).toEqual(['oak']);
    expectFailedForOak();
  });

  it('(b) the reviewer’s P2 (a resume, kept): Elm on screen; the fresh list is [Oak] and Oak’s goals fail: the failed page for Oak, not Elm marked stale', async () => {
    wholeRecordOnElm();
    readMyCommunities.mockResolvedValueOnce({ items: [OAK, ELM] });
    readGoals.mockResolvedValue({ goals: [ELM_GOAL] });
    await render();
    expect(byId('wsf-you-community')!.textContent).toContain('Elm Park');
    readMyCommunities.mockResolvedValueOnce({ items: [OAK] });
    oakGoalsFail();
    await returnAfter(RESUME_MIN_AWAY_MS + 1_000);
    await flush();
    await flush();
    expect(readMyCommunities.mock.calls.at(-1)).toEqual(['u1', 0]);
    expect(readGoals.mock.calls.at(-1)?.[1]).toBe('oak');
    expectFailedForOak();
  });

  it('(b) the reviewer’s P2b (a focus whose record is not whole, kept): the same, the failed page for Oak', async () => {
    wholeRecordOnElm();
    readMyCommunities.mockResolvedValueOnce({ items: [OAK, ELM] });
    readGoals.mockResolvedValue({ goals: [ELM_GOAL] });
    await render();
    expect(byId('wsf-you-community')!.textContent).toContain('Elm Park');
    record = { ...record, own: {} };
    readMyCommunities.mockResolvedValueOnce({ items: [OAK] });
    oakGoalsFail();
    refocus();
    await flush();
    await flush();
    expect(readGoals.mock.calls.at(-1)?.[1]).toBe('oak');
    expectFailedForOak();
  });

  it('(c) RV16-C15-2: a refused community’s page dropped to loading by the focus, then the membership read fails: the failed page with Retry, never a loading skeleton marked stale', async () => {
    rememberCurrentCommunity('u1', 'elm');
    readGoals.mockResolvedValue({ goals: [ELM_GOAL] });
    await render();
    expect(byId('wsf-you-community')!.textContent).toContain('Elm Park');
    // The record does not hold the goals, so the focus revalidates; Elm was refused by a fresh answer.
    refused.add('elm');
    readMyCommunities.mockRejectedValueOnce(OFFLINE());
    refocus();
    await flush();
    await flush();
    expect(byId('wsf-you-loading')).toBeNull();
    expect(byId('wsf-you-failed')).not.toBeNull();
    expect(byId('wsf-you-retry')).not.toBeNull();
    expect(text()).not.toContain('Elm Park');
  });

  it('(d) the membership read fails, so no list was read: the member page is kept, marked stale', async () => {
    wholeRecordOnElm();
    readMyCommunities.mockResolvedValueOnce({ items: [OAK, ELM] });
    readGoals.mockResolvedValue({ goals: [ELM_GOAL] });
    await render();
    readMyCommunities.mockRejectedValueOnce(OFFLINE());
    await returnAfter(RESUME_MIN_AWAY_MS + 1_000);
    await flush();
    await flush();
    expect(byId('wsf-you-member')).not.toBeNull();
    expect(byId('wsf-you-community')!.textContent).toContain('Elm Park');
    expect(byId('wsf-you-stale')).not.toBeNull();
    expect(byId('wsf-you-failed')).toBeNull();
  });

  it('(e) a page that is neither a member page nor loading (pick a community) is kept as today when a kept revalidation fails', async () => {
    // Two communities, none remembered: the page asks which one it speaks for.
    await render();
    expect(byId('wsf-you-pick-community')).not.toBeNull();
    // A return to the app reads fresh, keeping what is on screen; the membership read fails.
    readMyCommunities.mockRejectedValueOnce(OFFLINE());
    await returnAfter(RESUME_MIN_AWAY_MS + 1_000);
    await flush();
    await flush();
    expect(readMyCommunities.mock.calls.at(-1)).toEqual(['u1', 0]);
    expect(byId('wsf-you-pick-community')).not.toBeNull();
    expect(byId('wsf-you-failed')).toBeNull();
  });

  it('(e2) control: "no community" on screen, the membership read fails (no list read): kept as today', async () => {
    readMyCommunities.mockResolvedValueOnce({ items: [] });
    await render();
    expect(byId('wsf-you-no-community')).not.toBeNull();
    readMyCommunities.mockRejectedValueOnce(OFFLINE());
    await returnAfter(RESUME_MIN_AWAY_MS + 1_000);
    await flush();
    await flush();
    expect(byId('wsf-you-no-community')).not.toBeNull();
    expect(byId('wsf-you-failed')).toBeNull();
  });
});

/*
  W16-22 (heads-15 RV17-642-N1). The gate's non-member half kept a pick or
  "no community" page even when this load's FRESH list resolved a community
  whose goals then failed. The fresh read contradicts that page, and those
  pages draw no stale mark and no Retry (YouParityView draws both inside a
  member page only), so the contradicted card stood with nothing to say so.
  A non-member page is now kept only when no fresh list resolved a community
  (`community === undefined`: the membership read itself failed); otherwise
  the failed page for the community resolved, with Retry. The reviewer's P1
  and P2, which asserted the old behaviour, now assert this.
*/
describe('W16-22 / RV17-642-N1: a non-member page gives way when a fresh list resolved a community', () => {
  it('P1: "no community" on screen; a resume reads [Oak], Oak resolves and its goals fail: the failed page for Oak, with Retry', async () => {
    readMyCommunities.mockResolvedValueOnce({ items: [] });
    await render();
    expect(byId('wsf-you-no-community')).not.toBeNull();
    readMyCommunities.mockResolvedValueOnce({ items: [OAK] });
    oakGoalsFail();
    await returnAfter(RESUME_MIN_AWAY_MS + 1_000);
    await flush();
    await flush();
    expect(readGoals.mock.calls.at(-1)?.[1]).toBe('oak');
    expect(byId('wsf-you-no-community')).toBeNull();
    expectFailedForOak();
  });

  it('P2: pick on screen; Oak remembered meanwhile; a resume reads [Oak, Elm], Oak resolves and its goals fail: the failed page for Oak, with Retry', async () => {
    await render();
    expect(byId('wsf-you-pick-community')).not.toBeNull();
    rememberCurrentCommunity('u1', 'oak');
    readMyCommunities.mockResolvedValueOnce({ items: [OAK, ELM] });
    oakGoalsFail();
    await returnAfter(RESUME_MIN_AWAY_MS + 1_000);
    await flush();
    await flush();
    expect(readGoals.mock.calls.at(-1)?.[1]).toBe('oak');
    expect(byId('wsf-you-pick-community')).toBeNull();
    expectFailedForOak();
  });
});
