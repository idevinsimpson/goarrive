/**
 * wsfListGoals({ includeHistory: true }) — the community's durable record of
 * its own goals.
 *
 * The defect it closes: wsfListGoals returns active goals plus closed goals
 * that are STILL authorized for public display, and Community Home's history
 * was built on that. A goal that closed unauthorized, or whose authorization
 * was revoked, disappeared from the community's past — the record of work the
 * members did was governed by a publication decision that has nothing to do
 * with them.
 *
 * It is a FLAG on the existing callable rather than a new one, so no new Cloud
 * Run service is introduced. That makes the first pin below the most important
 * one: without the flag, nothing about this callable changed.
 *
 * These pins cover:
 *   1. Without the flag the response is unchanged — same keys, and a
 *      closed-unreached goal is still absent.
 *   2. With the flag the shape adds exactly sharedTotal, timezone and
 *      closedAt, and nothing else.
 *   3. An active member sees a closed-unreached goal that was never
 *      display-authorized.
 *   4. The history does not depend on display authorization in either
 *      direction — revoking it removes nothing.
 *   5. Anonymous, outsider and removed callers are refused exactly as before,
 *      and the flag does not open a route around the membership gate.
 *   6. No member data of any kind.
 *   7. The closed list is bounded to 50, most-recent-first by endsAt, and the
 *      bound only ever adds to what the unflagged call returns.
 *   8. Another community's history never appears.
 *
 * Runs against the Firestore emulator via `.run(request)`.
 */

process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { wsfListGoals } from '../../src/index';

type Listed = {
  goalId: string;
  title: string;
  target: number;
  unit: string;
  status: string;
  startsAt: string;
  endsAt: string;
  aggregateDisplayAuthorized: boolean;
  sharedTotal?: number;
  timezone?: string;
  closedAt?: string | null;
};

/** Today's response keys, which the unflagged call must keep exactly. */
const BASE_KEYS = [
  'aggregateDisplayAuthorized',
  // The one-time target-crossing event (W5) rides the member list too.
  'reachedAt',
  'endsAt',
  'goalId',
  'startsAt',
  'status',
  'target',
  'title',
  'unit',
].sort();

/** The only keys the flag may add. */
const HISTORY_ONLY_KEYS = ['closedAt', 'sharedTotal', 'timezone'].sort();

async function seedGroup(): Promise<string> {
  const ref = getFirestore().collection('wsfCommunityGroups').doc();
  await ref.set({
    displayName: 'History Group',
    groupType: 'custom',
    joinPolicy: 'public',
    lifecycleStatus: 'active',
    isSample: false,
  });
  return ref.id;
}

async function seedMember(
  groupId: string,
  uid: string,
  membershipStatus: 'active' | 'removed' = 'active'
) {
  await getFirestore().doc(`wsfMemberships/${groupId}_${uid}`).set({
    groupId,
    userId: uid,
    role: 'member',
    membershipStatus,
  });
}

async function seedGoal(
  groupId: string,
  opts: {
    title?: string;
    target?: number;
    unit?: string;
    status?: string;
    endsInMs?: number;
    displayAuthorized?: boolean;
    closedAtMs?: number;
    total?: number;
  } = {}
): Promise<string> {
  const now = Date.now();
  const db = getFirestore();
  const ref = db.collection('wsfGoals').doc();
  const doc: Record<string, unknown> = {
    ownerUid: 'champion-uid',
    communityGroupId: groupId,
    title: opts.title ?? 'Community squats',
    target: opts.target ?? 5000,
    unit: opts.unit ?? 'squats',
    status: opts.status ?? 'active',
    startsAt: Timestamp.fromMillis(now - 14 * 24 * 60 * 60_000),
    endsAt: Timestamp.fromMillis(now + (opts.endsInMs ?? 3_600_000)),
    timezone: 'America/New_York',
  };
  if (opts.displayAuthorized) doc.aggregateDisplayAuthorized = true;
  if (opts.closedAtMs) doc.closedAt = Timestamp.fromMillis(opts.closedAtMs);
  await ref.set(doc);
  // Shard counters, written where a real contribution writes them, so
  // sharedTotal comes from the same source the rest of the system reads.
  if (opts.total) {
    await db.doc(`wsfGoalCounters/${ref.id}/shards/0`).set({ count: opts.total });
  }
  return ref.id;
}

function call(uid: string | null, data: unknown) {
  const request = {
    data,
    auth: uid ? { uid, token: {} } : undefined,
    rawRequest: {},
  } as never;
  return (wsfListGoals as unknown as { run: (r: never) => Promise<{ goals: Listed[] }> }).run(
    request
  );
}

async function expectRefused(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(HttpsError);
  await promise.catch((e: HttpsError) => expect(e.code).toBe(code));
}

describe('wsfListGoals includeHistory', () => {
  it('leaves the response unchanged without the flag, closed-unreached goals still absent', async () => {
    const groupId = await seedGroup();
    await seedMember(groupId, 'hist-member-1');
    const open = await seedGoal(groupId, { title: 'Open', total: 10 });
    await seedGoal(groupId, {
      title: 'Missed',
      target: 500,
      total: 312,
      status: 'closed',
      endsInMs: -20 * 24 * 60 * 60_000,
    });

    // Absent, false, and a non-boolean value all mean today's behaviour.
    for (const data of [
      { groupId },
      { groupId, includeHistory: false },
      { groupId, includeHistory: 'yes' },
      { groupId, includeHistory: 1 },
      { groupId, includeHistory: null },
    ]) {
      const result = await call('hist-member-1', data);
      expect(result.goals.map((g) => g.goalId)).toEqual([open]);
      expect(Object.keys(result.goals[0]!).sort()).toEqual(BASE_KEYS);
    }
  });

  it('adds exactly sharedTotal, timezone and closedAt with the flag', async () => {
    const groupId = await seedGroup();
    await seedMember(groupId, 'hist-member-2');
    const closedAtMs = Date.now() - 20 * 24 * 60 * 60_000;
    await seedGoal(groupId, {
      title: 'August push-ups',
      target: 500,
      unit: 'push-ups',
      total: 312,
      status: 'closed',
      endsInMs: -20 * 24 * 60 * 60_000,
      closedAtMs,
    });

    const result = await call('hist-member-2', { groupId, includeHistory: true });
    expect(result.goals).toHaveLength(1);
    const goal = result.goals[0]!;
    expect(Object.keys(goal).sort()).toEqual([...BASE_KEYS, ...HISTORY_ONLY_KEYS].sort());
    expect(goal.sharedTotal).toBe(312);
    expect(goal.timezone).toBe('America/New_York');
    expect(goal.closedAt).toBe(new Date(closedAtMs).toISOString());
  });

  it('returns a closed-unreached goal that was never display-authorized', async () => {
    const groupId = await seedGroup();
    await seedMember(groupId, 'hist-member-3');
    const goalId = await seedGoal(groupId, {
      title: 'August push-ups',
      target: 500,
      unit: 'push-ups',
      total: 312,
      status: 'closed',
      endsInMs: -20 * 24 * 60 * 60_000,
    });

    // Absent from the unflagged call, present with the flag. That difference
    // IS the defect this packet closes.
    expect((await call('hist-member-3', { groupId })).goals).toEqual([]);
    const result = await call('hist-member-3', { groupId, includeHistory: true });
    expect(result.goals.map((g) => g.goalId)).toEqual([goalId]);
    const goal = result.goals[0]!;
    expect(goal.status).toBe('closed');
    expect(goal.aggregateDisplayAuthorized).toBe(false);
    // The closed-unreached fact the screen labels "Closed at 62.4%": the
    // server states the totals, not the verdict.
    expect(goal.sharedTotal).toBe(312);
    expect(goal.target).toBe(500);
    expect(goal.closedAt).toBeNull();
  });

  it('returns active, closed-reached and closed-unreached goals together', async () => {
    const groupId = await seedGroup();
    await seedMember(groupId, 'hist-member-4');
    const open = await seedGoal(groupId, { title: 'Open', total: 10, endsInMs: 3_600_000 });
    const reached = await seedGoal(groupId, {
      title: 'Reached',
      target: 100,
      total: 140,
      status: 'closed',
      endsInMs: -1 * 24 * 60 * 60_000,
    });
    const missed = await seedGoal(groupId, {
      title: 'Missed',
      target: 100,
      total: 40,
      status: 'closed',
      endsInMs: -2 * 24 * 60 * 60_000,
    });

    const result = await call('hist-member-4', { groupId, includeHistory: true });
    expect(result.goals.map((g) => g.goalId).sort()).toEqual([open, reached, missed].sort());
    const byId = new Map(result.goals.map((g) => [g.goalId, g]));
    expect(byId.get(reached)!.sharedTotal).toBe(140);
    expect(byId.get(missed)!.sharedTotal).toBe(40);
    expect(byId.get(open)!.status).toBe('active');
  });

  it('does not depend on display authorization in either direction', async () => {
    const groupId = await seedGroup();
    await seedMember(groupId, 'hist-member-5');
    const authorized = await seedGoal(groupId, {
      title: 'Authorized',
      status: 'closed',
      endsInMs: -1 * 24 * 60 * 60_000,
      displayAuthorized: true,
    });
    const unauthorized = await seedGoal(groupId, {
      title: 'Unauthorized',
      status: 'closed',
      endsInMs: -2 * 24 * 60 * 60_000,
    });

    const before = await call('hist-member-5', { groupId, includeHistory: true });
    expect(before.goals.map((g) => g.goalId).sort()).toEqual([authorized, unauthorized].sort());
    expect(before.goals.find((g) => g.goalId === authorized)!.aggregateDisplayAuthorized).toBe(true);

    // Revoking publication must take nothing out of the community's own record.
    await getFirestore().doc(`wsfGoals/${authorized}`).update({ aggregateDisplayAuthorized: false });
    const after = await call('hist-member-5', { groupId, includeHistory: true });
    expect(after.goals.map((g) => g.goalId).sort()).toEqual([authorized, unauthorized].sort());
    expect(after.goals.find((g) => g.goalId === authorized)!.aggregateDisplayAuthorized).toBe(false);
  });

  it('carries no member data', async () => {
    const groupId = await seedGroup();
    await seedMember(groupId, 'hist-member-6');
    await seedGoal(groupId, { status: 'closed', endsInMs: -1_000, total: 7 });

    const result = await call('hist-member-6', { groupId, includeHistory: true });
    const goal = result.goals[0]!;
    expect(Object.keys(goal).sort()).toEqual([...BASE_KEYS, ...HISTORY_ONLY_KEYS].sort());
    // Named absences, so a later widening has to delete a line here.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('ownerUid');
    expect(serialized).not.toContain('champion-uid');
    expect(serialized).not.toContain('hist-member-6');
    for (const forbidden of [
      'memberCount',
      'contributorCount',
      'members',
      'displayName',
      'ownCredit',
      'contributions',
    ]) {
      expect(Object.keys(goal)).not.toContain(forbidden);
    }
  });

  it('refuses an anonymous caller asking for history', async () => {
    const groupId = await seedGroup();
    await seedGoal(groupId, { status: 'closed', endsInMs: -1_000 });
    await expectRefused(call(null, { groupId, includeHistory: true }), 'unauthenticated');
  });

  it('refuses an outsider asking for history, with the same not-found as an unknown group', async () => {
    const groupId = await seedGroup();
    await seedGoal(groupId, { status: 'closed', endsInMs: -1_000 });
    await expectRefused(call('hist-outsider', { groupId, includeHistory: true }), 'not-found');
    await expectRefused(
      call('hist-outsider', { groupId: 'no-such-group', includeHistory: true }),
      'not-found'
    );
  });

  it('refuses a removed member asking for history', async () => {
    const groupId = await seedGroup();
    await seedMember(groupId, 'hist-removed', 'removed');
    await seedGoal(groupId, { status: 'closed', endsInMs: -1_000 });
    await expectRefused(call('hist-removed', { groupId, includeHistory: true }), 'not-found');
  });

  it('rejects a missing groupId even with the flag', async () => {
    await expectRefused(call('hist-member-7', { includeHistory: true }), 'invalid-argument');
  });

  it('returns an empty list for a community with no goals', async () => {
    const groupId = await seedGroup();
    await seedMember(groupId, 'hist-member-8');
    expect((await call('hist-member-8', { groupId, includeHistory: true })).goals).toEqual([]);
  });

  it('does not leak another community history', async () => {
    const mine = await seedGroup();
    const theirs = await seedGroup();
    await seedMember(mine, 'hist-member-9');
    const mineGoal = await seedGoal(mine, { title: 'Mine', status: 'closed', endsInMs: -1_000 });
    await seedGoal(theirs, { title: 'Theirs', status: 'closed', endsInMs: -1_000 });

    const result = await call('hist-member-9', { groupId: mine, includeHistory: true });
    expect(result.goals.map((g) => g.goalId)).toEqual([mineGoal]);
  });

  it('bounds the closed goals to the most recent 50 by endsAt, and only ever adds', async () => {
    const groupId = await seedGroup();
    await seedMember(groupId, 'hist-member-10');
    const day = 24 * 60 * 60_000;
    // 52 closed goals, one day further back each, plus an open goal that the
    // bound must never displace.
    const closedIds: string[] = [];
    for (let i = 1; i <= 52; i += 1) {
      closedIds.push(
        await seedGoal(groupId, { title: `Goal ${i}`, status: 'closed', endsInMs: -i * day })
      );
    }
    const open = await seedGoal(groupId, { title: 'Open', endsInMs: 3_600_000 });

    const result = await call('hist-member-10', { groupId, includeHistory: true });
    const closedReturned = result.goals.filter((g) => g.status === 'closed');
    expect(closedReturned).toHaveLength(50);
    // The bound keeps the most recent, so the two OLDEST are the ones dropped.
    const returnedIds = new Set(closedReturned.map((g) => g.goalId));
    expect(returnedIds.has(closedIds[0]!)).toBe(true);
    expect(returnedIds.has(closedIds[49]!)).toBe(true);
    expect(returnedIds.has(closedIds[50]!)).toBe(false);
    expect(returnedIds.has(closedIds[51]!)).toBe(false);
    // The active goal is not bounded away, and the flagged call is a strict
    // superset of the unflagged one.
    expect(result.goals.map((g) => g.goalId)).toContain(open);
    const plain = await call('hist-member-10', { groupId });
    for (const g of plain.goals) {
      expect(result.goals.map((x) => x.goalId)).toContain(g.goalId);
    }
    // Deterministic order, unchanged: ascending by endsAt, as the unflagged
    // call has always returned. The screen sorts its own history.
    for (let i = 1; i < result.goals.length; i += 1) {
      expect(result.goals[i - 1]!.endsAt <= result.goals[i]!.endsAt).toBe(true);
    }
  });
});
