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
// Every live focus effect (the route's own and useResumeRefresh's), so a test
// can return to the tab: refocus() runs each one's blur cleanup, then the
// callback again, as a real blur and focus do.
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

const COMMUNITY = { groupId: 'oak', displayName: 'Oak Grove', role: 'member', memberCount: 23 };
const FUTURE = '2099-01-01T00:00:00.000Z';
const goal = (status: string) => ({ goalId: 'g1', title: '500 squats', target: 500, unit: 'squats', status, sharedTotal: 241, endsAt: FUTURE, timezone: 'UTC' });
const readMemberProfile = vi.fn();
const readMyCommunities = vi.fn();
const readGoals = vi.fn();
const readOwnCredit = vi.fn();
// The account's record (src/memberReads.ts), empty unless a test fills it.
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
  readMyCommunities.mockResolvedValue({ items: [COMMUNITY] });
  readGoals.mockResolvedValue({ goals: [goal('active')] });
  readOwnCredit.mockResolvedValue({ ownCredit: 0, unit: 'squats' });
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
/** Back to the You tab: the focus path recomposes from the account's record. */
const refocus = () => act(() => focus.entries.forEach((e) => e.refire()));
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

/*
  heads-10 F-1. A failed resume read kept the page but recomposed it from the
  inputs of the last NETWORK compose, even when the page on screen had since
  been drawn from the account's record (the focus path, the recorded branch,
  the first frame), so older inputs could replace a newer page. The record
  is now preferred, the community on screen is never swapped, and (heads-11
  NB-3) the inputs kept are always those of the page on screen, a record
  draw included.
*/
describe('heads-10 F-1: a failed resume never draws older inputs over the page', () => {
  const OWN = (n: number) => ({ ownCredit: n, unit: 'squats' });
  const ELM = { groupId: 'elm', displayName: 'Elm Park', role: 'member', memberCount: 9 };
  const ELM_GOAL = { ...goal('active'), goalId: 'e1', title: '300 lunges', unit: 'lunges', target: 300 };
  const failResume = async () => {
    readMyCommunities.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'functions/unavailable' }));
    await returnAfter(RESUME_MIN_AWAY_MS + 1_000);
    await flush();
    expect(byId('wsf-you-stale')).not.toBeNull();
  };

  it('case 1: own part 10 from the network, then 25 from the record on focus; a failed resume keeps 25', async () => {
    readOwnCredit.mockResolvedValue(OWN(10));
    await render();
    expect(byId('wsf-you-lead-own')!.textContent).toBe('10 squats');
    // A confirmed receipt wrote the new own part into the record.
    record = { communities: { items: [COMMUNITY] }, profile: { displayName: 'Alex', createdAt: null }, goals: { oak: { goals: [goal('active')] } }, own: { g1: OWN(25) } };
    refocus();
    await flush();
    expect(byId('wsf-you-lead-own')!.textContent).toBe('25 squats');
    await failResume();
    expect(byId('wsf-you-lead-own')!.textContent).toBe('25 squats');
  });

  it('case 2: Oak Grove from the network, a switch to Elm Park drawn from the record; a failed resume keeps Elm Park', async () => {
    rememberCurrentCommunity('u1', 'oak');
    readMyCommunities.mockResolvedValue({ items: [COMMUNITY, ELM] });
    await render();
    expect(byId('wsf-you-community')!.textContent).toContain('Oak Grove');
    rememberCurrentCommunity('u1', 'elm');
    record = {
      communities: { items: [COMMUNITY, ELM] },
      profile: { displayName: 'Alex', createdAt: null },
      goals: { elm: { goals: [ELM_GOAL] } },
      own: { e1: OWN(12) },
    };
    refocus();
    await flush();
    expect(byId('wsf-you-community')!.textContent).toContain('Elm Park');
    await failResume();
    expect(byId('wsf-you-community')!.textContent).toContain('Elm Park');
    expect(byId('wsf-you-community')!.textContent).not.toContain('Oak Grove');
  });

  it('a failed resume never swaps the community on screen, even when the record now speaks for another', async () => {
    rememberCurrentCommunity('u1', 'oak');
    readMyCommunities.mockResolvedValue({ items: [COMMUNITY, ELM] });
    await render();
    // The member switched elsewhere; this tab has not been back to focus.
    rememberCurrentCommunity('u1', 'elm');
    record = {
      communities: { items: [COMMUNITY, ELM] },
      profile: { displayName: 'Alex', createdAt: null },
      goals: { elm: { goals: [ELM_GOAL] } },
      own: { e1: OWN(12) },
    };
    await failResume();
    expect(byId('wsf-you-community')!.textContent).toContain('Oak Grove');
  });

  it('the record, when whole, comes before the network inputs: 25 recorded while You stayed on screen; a failed resume draws 25', async () => {
    readOwnCredit.mockResolvedValue(OWN(10));
    await render();
    expect(byId('wsf-you-lead-own')!.textContent).toBe('10 squats');
    // Written to the record with no focus in between (another surface's receipt).
    record = { communities: { items: [COMMUNITY] }, profile: { displayName: 'Alex', createdAt: null }, goals: { oak: { goals: [goal('active')] } }, own: { g1: OWN(25) } };
    await failResume();
    expect(byId('wsf-you-lead-own')!.textContent).toBe('25 squats');
  });

  it('a page drawn from the record replaces the network inputs: once the record is incomplete, a failed resume keeps that page (25), never the older 10', async () => {
    readOwnCredit.mockResolvedValue(OWN(10));
    await render();
    record = { communities: { items: [COMMUNITY] }, profile: { displayName: 'Alex', createdAt: null }, goals: { oak: { goals: [goal('active')] } }, own: { g1: OWN(25) } };
    refocus();
    await flush();
    expect(byId('wsf-you-lead-own')!.textContent).toBe('25 squats');
    // The record no longer holds the own part (youFromRecord is null).
    record = { ...record, own: {} };
    await failResume();
    expect(byId('wsf-you-lead-own')!.textContent).toBe('25 squats');
  });
});

/*
  heads-11 NB-3 and NB-4, on the same keep path.
  NB-3: nulling the inputs on a record draw left INT-12 case 4 open. A page
  drawn from the record, then a record that lost a fact, a failed focus
  revalidation, and a failed resume past a goal's end still offered Start
  moving. The record's own inputs are now kept with the page.
  NB-4: the kept page's head ignored this load's profile read and could drop
  to the pending bar.
*/
describe('heads-11 NB-3, NB-4: the kept You page', () => {
  const OWN = (n: number) => ({ ownCredit: n, unit: 'squats' });
  const OFFLINE = () => Object.assign(new Error('x'), { code: 'functions/unavailable' });

  it('NB-3: drawn from the record, the record then loses a fact; a failed resume past the goal end still stops offering Start moving', async () => {
    // Start moving is offered before a first confirmed contribution (own part 0).
    const G = { ...goal('active'), endsAt: new Date(Date.now() + 60_000).toISOString() };
    readGoals.mockResolvedValue({ goals: [G] });
    await render();
    expect(byId('wsf-you-name')?.textContent).toBe('Alex');
    // Back to the tab with a whole record: the page is drawn from it (its name says so).
    record = { communities: { items: [COMMUNITY] }, profile: { displayName: 'Alex R.', createdAt: null }, goals: { oak: { goals: [G] } }, own: { g1: OWN(0) } };
    refocus();
    await flush();
    expect(byId('wsf-you-name')?.textContent).toBe('Alex R.');
    expect(byId('wsf-you-start-moving')).not.toBeNull();
    // The record loses the own part, and the focus revalidation fails.
    record = { ...record, own: {} };
    readMyCommunities.mockRejectedValueOnce(OFFLINE());
    refocus();
    await flush();
    expect(byId('wsf-you-stale')).not.toBeNull();
    expect(byId('wsf-you-start-moving')).not.toBeNull();
    // The phone sleeps past the goal's end; the resume read fails too.
    readMyCommunities.mockRejectedValueOnce(OFFLINE());
    await returnAfter(RESUME_MIN_AWAY_MS + 60_000);
    await flush();
    expect(byId('wsf-you-member')).not.toBeNull();
    expect(byId('wsf-you-start-moving')).toBeNull();
  });

  it('NB-4: with no profile ever read, a failed resume keeps the "You" header, never the pending bar', async () => {
    readMemberProfile.mockRejectedValue(OFFLINE());
    // The record holds everything but the profile.
    record = { communities: { items: [COMMUNITY] }, goals: { oak: { goals: [goal('active')] } }, own: { g1: OWN(25) } };
    await render();
    expect(byId('wsf-you-name')?.textContent).toBe('You');
    expect(byId('wsf-you-name-pending')).toBeNull();
    readMyCommunities.mockRejectedValueOnce(OFFLINE());
    await returnAfter(RESUME_MIN_AWAY_MS + 1_000);
    await flush();
    expect(byId('wsf-you-stale')).not.toBeNull();
    expect(byId('wsf-you-name-pending')).toBeNull();
    expect(byId('wsf-you-name')?.textContent).toBe('You');
  });

  it('NB-3: opened on the record with the first read failing, the record then loses a fact; a failed resume past the goal end still stops offering Start moving', async () => {
    const G = { ...goal('active'), endsAt: new Date(Date.now() + 60_000).toISOString() };
    record = { communities: { items: [COMMUNITY] }, profile: { displayName: 'Alex', createdAt: null }, goals: { oak: { goals: [G] } }, own: { g1: OWN(0) } };
    readMyCommunities.mockRejectedValueOnce(OFFLINE());
    await render();
    expect(byId('wsf-you-stale')).not.toBeNull();
    expect(byId('wsf-you-start-moving')).not.toBeNull();
    record = { ...record, own: {} };
    readMyCommunities.mockRejectedValueOnce(OFFLINE());
    await returnAfter(RESUME_MIN_AWAY_MS + 60_000);
    await flush();
    expect(byId('wsf-you-member')).not.toBeNull();
    expect(byId('wsf-you-start-moving')).toBeNull();
  });

  it('NB-3: a kept page recomposed from the record takes its inputs: once the record later loses a fact, the older network inputs (10) never come back', async () => {
    readOwnCredit.mockResolvedValue(OWN(10));
    await render();
    expect(byId('wsf-you-lead-own')!.textContent).toBe('10 squats');
    // A receipt recorded 25 while You stayed on screen; a failed resume draws it.
    record = { communities: { items: [COMMUNITY] }, profile: { displayName: 'Alex', createdAt: null }, goals: { oak: { goals: [goal('active')] } }, own: { g1: OWN(25) } };
    readMyCommunities.mockRejectedValueOnce(OFFLINE());
    await returnAfter(RESUME_MIN_AWAY_MS + 1_000);
    await flush();
    expect(byId('wsf-you-lead-own')!.textContent).toBe('25 squats');
    // The record then loses the own part; another failed resume keeps 25.
    record = { ...record, own: {} };
    readMyCommunities.mockRejectedValueOnce(OFFLINE());
    await returnAfter(RESUME_MIN_AWAY_MS + 1_000);
    await flush();
    expect(byId('wsf-you-lead-own')!.textContent).toBe('25 squats');
  });

  it("NB-4: when this load's profile read fails too, the recorded name stays (the read's fallback is not a profile)", async () => {
    record = { communities: { items: [COMMUNITY] }, profile: { displayName: 'Alex', createdAt: null }, goals: { oak: { goals: [goal('active')] } }, own: { g1: OWN(25) } };
    await render();
    expect(byId('wsf-you-name')?.textContent).toBe('Alex');
    readMemberProfile.mockRejectedValueOnce(OFFLINE());
    readMyCommunities.mockRejectedValueOnce(OFFLINE());
    await returnAfter(RESUME_MIN_AWAY_MS + 1_000);
    await flush();
    expect(byId('wsf-you-stale')).not.toBeNull();
    expect(byId('wsf-you-name')?.textContent).toBe('Alex');
  });

  it("NB-4: when this load's profile read answers and only the communities fail, the kept head shows the fresh name", async () => {
    record = { communities: { items: [COMMUNITY] }, profile: { displayName: 'Alex', createdAt: null }, goals: { oak: { goals: [goal('active')] } }, own: { g1: OWN(25) } };
    await render();
    expect(byId('wsf-you-name')?.textContent).toBe('Alex');
    readMemberProfile.mockResolvedValueOnce({ displayName: 'Alex B.', createdAt: null });
    readMyCommunities.mockRejectedValueOnce(OFFLINE());
    await returnAfter(RESUME_MIN_AWAY_MS + 1_000);
    await flush();
    expect(byId('wsf-you-stale')).not.toBeNull();
    expect(byId('wsf-you-name')?.textContent).toBe('Alex B.');
  });
});
