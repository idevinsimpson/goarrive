import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PERF-MOBILE-1 checkpoint 1: the one per-account read layer.
 * Every callable is counted at the network boundary (`httpsCallable`).
 */

const calls: Array<{ name: string; data: unknown }> = [];
const answers: Record<string, (data: unknown) => unknown | Promise<unknown>> = {};
let authListener: ((u: { uid: string } | null) => void) | null = null;

vi.mock('../src/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getFirebaseFirestore: () => ({}),
  getFirebaseFunctions: () => ({}),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => `${col}/${id}`,
  getDoc: async (path: string) => {
    calls.push({ name: 'getDoc', data: path });
    return { data: () => ({ displayName: 'Alex Rivera', createdAt: null }) };
  },
}));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_a: unknown, cb: (u: { uid: string } | null) => void) => {
    authListener = cb;
    return () => undefined;
  },
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => async (data: unknown) => {
    calls.push({ name, data });
    await Promise.resolve();
    return { data: await answers[name]!(data) };
  },
}));

import {
  JOIN_INFLIGHT_MS,
  SAME_LOAD_MS,
  clearMemberReads,
  forgetCommunity,
  noteConfirmedContribution,
  peekGoals,
  peekMyCommunities,
  peekMemberProfile,
  peekOwnCredit,
  readGoals,
  readMemberProfile,
  readMyCommunities,
  readOwnCredit,
  wasRefused,
} from '../src/memberReads';

/** An answer the test releases when it chooses (a held server response). */
function held<T>(value: T): { answer: () => Promise<T>; release: () => void } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  return { answer: () => gate.then(() => value), release: () => release() };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

type G = { goalId: string; status: string; sharedTotal?: number; target?: number };

beforeEach(() => {
  clearMemberReads();
  calls.length = 0;
  answers.wsfMyCommunities = () => ({ items: [{ groupId: 'g1', displayName: 'One', memberCount: 1 }] });
  answers.wsfListGoals = () => ({ goals: [{ goalId: 'a', status: 'active', sharedTotal: 10, target: 100 }] });
  answers.wsfMyContribution = () => ({ ownCredit: 5, unit: 'squats', repeatPolicy: 'multiple' });
  vi.useRealTimers();
});

describe('memberReads (PERF-MOBILE-1 cp1)', () => {
  it('one identical read in flight is shared', async () => {
    await Promise.all([readMyCommunities('u1'), readMyCommunities('u1')]);
    expect(calls.filter((c) => c.name === 'wsfMyCommunities')).toHaveLength(1);
  });

  it('a settled answer within SAME_LOAD_MS is the same read when asked for; otherwise it reads again', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    await readMyCommunities('u1');
    await readMyCommunities('u1', SAME_LOAD_MS);
    expect(calls).toHaveLength(1);
    // A read that does not ask for reuse (a return, a Retry) always asks the server.
    await readMyCommunities('u1');
    expect(calls).toHaveLength(2);
    vi.setSystemTime(1_000_000 + SAME_LOAD_MS + 1);
    await readMyCommunities('u1', SAME_LOAD_MS);
    expect(calls).toHaveLength(3);
  });

  it('goals and own credit are shared per community / per goal', async () => {
    await Promise.all([readGoals<G>('u1', 'g1'), readGoals<G>('u1', 'g1', SAME_LOAD_MS), readGoals<G>('u1', 'g2')]);
    expect(calls.filter((c) => c.name === 'wsfListGoals').map((c) => c.data)).toEqual([
      { groupId: 'g1', includeHistory: true },
      { groupId: 'g2', includeHistory: true },
    ]);
    await readOwnCredit('u1', 'a');
    await readOwnCredit('u1', 'a', SAME_LOAD_MS);
    expect(calls.filter((c) => c.name === 'wsfMyContribution')).toHaveLength(1);
    expect(peekOwnCredit('u1', 'a')).toMatchObject({ ownCredit: 5, repeatPolicy: 'multiple' });
  });

  it('the member profile is this account\'s own document, shared like the rest', async () => {
    await Promise.all([readMemberProfile('u1'), readMemberProfile('u1', SAME_LOAD_MS)]);
    expect(calls.filter((c) => c.name === 'getDoc').map((c) => c.data)).toEqual(['wsfMemberProfiles/u1']);
    expect(peekMemberProfile('u1')).toEqual({ displayName: 'Alex Rivera', createdAt: null });
    expect(peekMemberProfile('u2')).toBeUndefined();
  });

  it('nothing crosses accounts: another uid sees nothing and reads for itself', async () => {
    await readMyCommunities('u1');
    await readOwnCredit('u1', 'a');
    expect(peekMyCommunities('u2')).toBeUndefined();
    expect(peekOwnCredit('u2', 'a')).toBeUndefined();
    // u2 asked, so u1's record is gone too.
    expect(peekMyCommunities('u1')).toBeUndefined();
    await readMyCommunities('u2', SAME_LOAD_MS);
    expect(calls.filter((c) => c.name === 'wsfMyCommunities')).toHaveLength(2);
  });

  it('sign-out (auth owner change) clears the record', async () => {
    await readMyCommunities('u1');
    expect(authListener).not.toBeNull();
    authListener!(null);
    expect(peekMyCommunities('u1')).toBeUndefined();
  });

  it('a slow answer for one account is never kept for the next', async () => {
    let release: () => void = () => undefined;
    answers.wsfMyCommunities = () => ({ items: [{ groupId: 'late', displayName: 'Late', memberCount: 1 }] });
    const gate = new Promise<void>((r) => (release = r));
    const slow = readMyCommunities('u1');
    const pending = gate.then(() => slow);
    peekMyCommunities('u2'); // u2 takes the record over
    release();
    await pending;
    expect(peekMyCommunities('u2')).toBeUndefined();
    expect(peekMyCommunities('u1')).toBeUndefined();
  });

  it('losing a community forgets its goals, the own parts in them, and the membership list', async () => {
    await readMyCommunities('u1');
    await readGoals<G>('u1', 'g1');
    await readOwnCredit('u1', 'a');
    forgetCommunity('u1', 'g1');
    expect(peekGoals('u1', 'g1')).toBeUndefined();
    expect(peekOwnCredit('u1', 'a')).toBeUndefined();
    expect(peekMyCommunities('u1')).toBeUndefined();
  });

  it('a confirmed receipt updates only what it confirms', async () => {
    await readGoals<G>('u1', 'g1');
    await readOwnCredit('u1', 'a');
    noteConfirmedContribution('u1', {
      goalId: 'a',
      groupId: 'g1',
      ownCredit: 25,
      sharedTotal: 30,
      target: 100,
      unit: 'squats',
      status: 'active',
    });
    expect(peekOwnCredit('u1', 'a')).toMatchObject({ ownCredit: 25, unit: 'squats', repeatPolicy: 'multiple' });
    expect(peekGoals<G>('u1', 'g1')!.goals[0]).toMatchObject({ goalId: 'a', sharedTotal: 30, status: 'active' });
  });

  it('a receipt that closes the goal forgets that community\'s goals instead of guessing', async () => {
    await readGoals<G>('u1', 'g1');
    noteConfirmedContribution('u1', {
      goalId: 'a',
      groupId: 'g1',
      ownCredit: 25,
      sharedTotal: 100,
      target: 100,
      unit: 'squats',
      status: 'closed',
    });
    expect(peekGoals('u1', 'g1')).toBeUndefined();
  });

  it('a receipt with no signed-in account clears the record rather than writing to it', async () => {
    await readOwnCredit('u1', 'a');
    noteConfirmedContribution(null, {
      goalId: 'a',
      ownCredit: 99,
      sharedTotal: 99,
      target: 100,
      unit: 'squats',
      status: 'active',
    });
    expect(peekOwnCredit('u1', 'a')).toBeUndefined();
  });

  describe('generations: an answer issued before a change never lands after it (Director #494 5841250834, 5841341300)', () => {
    it('a stale own read after a receipt: the receipt wins in the record and in the answer', async () => {
      const old = held({ ownCredit: 35, unit: 'squats' });
      answers.wsfMyContribution = old.answer;
      const pending = readOwnCredit('u1', 'a');
      await flush();
      noteConfirmedContribution('u1', { goalId: 'a', groupId: 'g1', ownCredit: 55, sharedTotal: 235, target: 500, unit: 'squats', status: 'active' });
      old.release();
      expect(await pending).toMatchObject({ ownCredit: 55 });
      expect(peekOwnCredit('u1', 'a')).toMatchObject({ ownCredit: 55 });
    });

    it('a goals read in flight at the receipt cannot land its older total: the list is asked again', async () => {
      const old = held({ goals: [{ goalId: 'a', status: 'active', sharedTotal: 180, target: 500 }] });
      answers.wsfListGoals = old.answer;
      const pending = readGoals<G>('u1', 'g1');
      await flush();
      noteConfirmedContribution('u1', { goalId: 'a', groupId: 'g1', ownCredit: 55, sharedTotal: 200, target: 500, unit: 'squats', status: 'active' });
      answers.wsfListGoals = () => ({ goals: [{ goalId: 'a', status: 'active', sharedTotal: 200, target: 500 }] });
      old.release();
      expect((await pending).goals[0]).toMatchObject({ sharedTotal: 200 });
      expect(peekGoals<G>('u1', 'g1')!.goals[0]).toMatchObject({ sharedTotal: 200 });
      expect(calls.filter((c) => c.name === 'wsfListGoals')).toHaveLength(2);
    });

    it('a goals read in flight at a refusal cannot bring the community back', async () => {
      const old = held({ goals: [{ goalId: 'a', status: 'active', sharedTotal: 180, target: 500 }] });
      answers.wsfListGoals = old.answer;
      const pending = readGoals<G>('u1', 'g1');
      await flush();
      forgetCommunity('u1', 'g1');
      // The server now refuses this account for g1.
      answers.wsfListGoals = () => Promise.reject(Object.assign(new Error('Community not found.'), { code: 'functions/not-found' }));
      old.release();
      await expect(pending).rejects.toMatchObject({ code: 'functions/not-found' });
      expect(peekGoals('u1', 'g1')).toBeUndefined();
      expect(wasRefused('u1', 'g1')).toBe(true);
    });

    it('an own read in flight at a refusal cannot put the own part back', async () => {
      const old = held({ ownCredit: 9, unit: 'squats' });
      answers.wsfMyContribution = old.answer;
      await readGoals<G>('u1', 'g1');
      const pending = readOwnCredit('u1', 'a');
      await flush();
      forgetCommunity('u1', 'g1');
      answers.wsfMyContribution = () => ({ ownCredit: 9, unit: 'squats' });
      old.release();
      await pending;
      // The only value now recorded is from a request made after the refusal.
      expect(calls.filter((c) => c.name === 'wsfMyContribution')).toHaveLength(2);
    });

    it('forgetting a community reaches every own part recorded in it, even when its list is already gone', async () => {
      await readGoals<G>('u1', 'g1');
      await readOwnCredit('u1', 'a');
      // A receipt while a list read is in flight removes the list...
      answers.wsfListGoals = held({ goals: [] }).answer;
      void readGoals<G>('u1', 'g1').catch(() => undefined);
      await flush();
      noteConfirmedContribution('u1', { goalId: 'a', groupId: 'g1', ownCredit: 55, sharedTotal: 200, target: 500, unit: 'squats', status: 'active' });
      expect(peekGoals('u1', 'g1')).toBeUndefined();
      // ...and the refusal still finds the own part through the registry.
      forgetCommunity('u1', 'g1');
      expect(peekOwnCredit('u1', 'a')).toBeUndefined();
    });

    it('a new account clears generations, the registry and refusals with the record', async () => {
      await readGoals<G>('u1', 'g1');
      forgetCommunity('u1', 'g1');
      expect(wasRefused('u1', 'g1')).toBe(true);
      expect(wasRefused('u2', 'g1')).toBe(false);
    });

    it('an authorized goals answer lifts a refusal (membership again)', async () => {
      forgetCommunity('u1', 'g1');
      expect(wasRefused('u1', 'g1')).toBe(true);
      await readGoals<G>('u1', 'g1');
      expect(wasRefused('u1', 'g1')).toBe(false);
    });
  });
});

describe('NATIVE-INTEGRATOR-1 (INT-26): a Retry never joins a hung read', () => {
  const mine = () => calls.filter((c) => c.name === 'wsfMyCommunities');
  const lists = () => calls.filter((c) => c.name === 'wsfListGoals');
  const items = (id: string) => ({ items: [{ groupId: id, displayName: id, memberCount: 1 }] });

  it('case 1: with a read hung, Retry sends a new request at once, and its answer stands', async () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] });
    const hung = held(items('stale'));
    answers.wsfMyCommunities = hung.answer;
    const first = readMyCommunities('u1', SAME_LOAD_MS);
    await flush();
    // The network comes back a few seconds later; the member taps Retry.
    vi.setSystemTime(1_000_000 + 5_000);
    answers.wsfMyCommunities = () => items('fresh');
    const retry = await readMyCommunities('u1');
    expect(mine()).toHaveLength(2);
    expect(retry.items[0]!.groupId).toBe('fresh');
    expect(peekMyCommunities('u1')!.items[0]!.groupId).toBe('fresh');
    // Case 4: the hung read's late answer never overwrites the fresh one.
    hung.release();
    await first;
    expect(peekMyCommunities('u1')!.items[0]!.groupId).toBe('fresh');
  });

  it('case 3: a mount read (cold Home, then the community it opens) still shares a read in flight, however old', async () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] });
    const slow = held(items('g1'));
    answers.wsfMyCommunities = slow.answer;
    const a = readMyCommunities('u1', SAME_LOAD_MS);
    await flush();
    vi.setSystemTime(1_000_000 + 5_000);
    const b = readMyCommunities('u1', SAME_LOAD_MS);
    slow.release();
    await Promise.all([a, b]);
    expect(mine()).toHaveLength(1);
  });

  it('identical fresh reads issued together (within JOIN_INFLIGHT_MS) still share one request', async () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] });
    const slow = held({ goals: [] });
    answers.wsfListGoals = slow.answer;
    const a = readGoals<G>('u1', 'g1');
    vi.setSystemTime(1_000_000 + JOIN_INFLIGHT_MS);
    const b = readGoals<G>('u1', 'g1');
    slow.release();
    await Promise.all([a, b]);
    expect(lists()).toHaveLength(1);
  });

  it('a superseded read with nothing settled waits for the fresher read: no third request, one answer', async () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] });
    const one = held({ goals: [{ goalId: 'a', status: 'active', sharedTotal: 10, target: 100 }] });
    answers.wsfListGoals = one.answer;
    const first = readGoals<G>('u1', 'g1');
    await flush();
    vi.setSystemTime(1_000_000 + 5_000);
    const two = held({ goals: [{ goalId: 'a', status: 'active', sharedTotal: 30, target: 100 }] });
    answers.wsfListGoals = two.answer;
    const second = readGoals<G>('u1', 'g1');
    await flush();
    // Past the join window, so only the superseded read's own rule keeps it from asking again.
    vi.setSystemTime(1_000_000 + 5_000 + JOIN_INFLIGHT_MS + 1);
    one.release();
    await flush();
    await flush();
    expect(lists()).toHaveLength(2);
    two.release();
    expect((await first).goals[0]!.sharedTotal).toBe(30);
    expect((await second).goals[0]!.sharedTotal).toBe(30);
    expect(peekGoals<G>('u1', 'g1')!.goals[0]!.sharedTotal).toBe(30);
    expect(lists()).toHaveLength(2);
  });

  const total = (v: number) => ({ goals: [{ goalId: 'a', status: 'active', sharedTotal: v, target: 100 }] });
  /** Settles 10, then issues A (hung) and, past the join window, B superseding it. */
  async function supersede(aAnswer: () => Promise<unknown>, bAnswer: () => unknown) {
    vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] });
    answers.wsfListGoals = () => total(10);
    await readGoals<G>('u1', 'g1');
    vi.setSystemTime(1_000_000 + 60_000);
    answers.wsfListGoals = aAnswer;
    const first = readGoals<G>('u1', 'g1');
    await flush();
    vi.setSystemTime(1_000_000 + 65_000);
    answers.wsfListGoals = bAnswer;
    const second = readGoals<G>('u1', 'g1');
    // Observed now, asserted by the test: a rejection here is expected, not unhandled.
    second.catch(() => undefined);
    await flush();
    return { first, second };
  }

  it('SH-3a: a superseded read that lands first joins the fresher read; never the value settled before both', async () => {
    const a = held(total(20));
    const b = held(total(30));
    const { first, second } = await supersede(a.answer, b.answer);
    a.release();
    await flush();
    b.release();
    expect((await first).goals[0]!.sharedTotal).toBe(30);
    expect((await second).goals[0]!.sharedTotal).toBe(30);
    expect(peekGoals<G>('u1', 'g1')!.goals[0]!.sharedTotal).toBe(30);
    expect(lists()).toHaveLength(3);
  });

  it('SH-3b: when the fresher read failed, the superseded answer is kept: newer than what was settled, and no third request', async () => {
    const a = held(total(20));
    const { first, second } = await supersede(a.answer, () => Promise.reject(new Error('unavailable')));
    await expect(second).rejects.toThrow('unavailable');
    a.release();
    expect((await first).goals[0]!.sharedTotal).toBe(20);
    expect(peekGoals<G>('u1', 'g1')!.goals[0]!.sharedTotal).toBe(20);
    expect(lists()).toHaveLength(3);
  });

  it('SH-3b with nothing settled before: the superseded answer is kept, no third request', async () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] });
    const a = held(total(20));
    answers.wsfListGoals = a.answer;
    const first = readGoals<G>('u1', 'g1');
    await flush();
    vi.setSystemTime(1_000_000 + 5_000);
    answers.wsfListGoals = () => Promise.reject(new Error('unavailable'));
    await expect(readGoals<G>('u1', 'g1')).rejects.toThrow('unavailable');
    a.release();
    expect((await first).goals[0]!.sharedTotal).toBe(20);
    expect(peekGoals<G>('u1', 'g1')!.goals[0]!.sharedTotal).toBe(20);
    expect(lists()).toHaveLength(2);
  });

  it('SH-3b never outranks a receipt: a receipt after the superseded read was issued still wins', async () => {
    const a = held(total(20));
    const { first, second } = await supersede(a.answer, () => Promise.reject(new Error('unavailable')));
    await expect(second).rejects.toThrow('unavailable');
    // The settled 10 is patched by a receipt to 45 (it keeps its old time).
    noteConfirmedContribution('u1', { goalId: 'a', groupId: 'g1', ownCredit: 5, sharedTotal: 45, target: 100, unit: 'squats', status: 'active' });
    a.release();
    expect((await first).goals[0]!.sharedTotal).toBe(45);
    expect(peekGoals<G>('u1', 'g1')!.goals[0]!.sharedTotal).toBe(45);
  });

  it('SH-3b never brings back a forgotten community: a refusal after it was issued means ask again, fresh', async () => {
    const a = held(total(20));
    const { first, second } = await supersede(a.answer, () => Promise.reject(new Error('unavailable')));
    await expect(second).rejects.toThrow('unavailable');
    forgetCommunity('u1', 'g1');
    answers.wsfListGoals = () => total(50);
    a.release();
    expect((await first).goals[0]!.sharedTotal).toBe(50);
    expect(lists()).toHaveLength(4);
  });
});
