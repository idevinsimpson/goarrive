/**
 * wsfListGoals callable — the seam this package exists to add.
 *
 * Every other wsfGoals access in index.ts is by explicit goalId, so a member
 * who did not create the goal had no way to learn its id. These pins cover the
 * authorization boundary and the shapes the community page depends on:
 *
 *   1. An active member sees this group's active goals, with the minimal
 *      permitted fields and nothing else.
 *   2. Unauthenticated, non-member, inactive-member and wrong-community
 *      callers are all refused — and a non-member gets the same not-found as
 *      a group that does not exist, so the response cannot probe which groups
 *      exist.
 *   3. Zero goals is an empty list, not an error.
 *   4. More than one active goal stays separate — nothing is collapsed.
 *   5. A goal that has reached or passed its target is still listed. Reaching
 *      the target must never make the goal disappear from under the people
 *      still contributing to it.
 *
 * Runs against the Firestore emulator via `.run(request)`.
 */

process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { wsfContribute, wsfListGoals } from '../../src/index';

type Listed = {
  goalId: string;
  title: string;
  target: number;
  unit: string;
  status: string;
  startsAt: string;
  endsAt: string;
};

async function seedGroup(): Promise<string> {
  const ref = getFirestore().collection('wsfCommunityGroups').doc();
  await ref.set({
    displayName: 'List Goals Group',
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
  opts: { title?: string; target?: number; unit?: string; status?: string; endsInMs?: number } = {}
): Promise<string> {
  const now = Date.now();
  const ref = getFirestore().collection('wsfGoals').doc();
  await ref.set({
    ownerUid: 'champion-uid',
    communityGroupId: groupId,
    title: opts.title ?? 'Community squats',
    target: opts.target ?? 5000,
    unit: opts.unit ?? 'squats',
    status: opts.status ?? 'active',
    startsAt: Timestamp.fromMillis(now - 60_000),
    endsAt: Timestamp.fromMillis(now + (opts.endsInMs ?? 3_600_000)),
    timezone: 'America/New_York',
  });
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

describe('wsfListGoals', () => {
  it('returns this group active goals to an active member, with minimal fields', async () => {
    const groupId = await seedGroup();
    await seedMember(groupId, 'member-1');
    const goalId = await seedGoal(groupId, { title: 'Squat-a-thon', target: 5000 });

    const result = await call('member-1', { groupId });
    expect(result.goals).toHaveLength(1);
    const goal = result.goals[0]!;
    expect(goal.goalId).toBe(goalId);
    expect(goal.title).toBe('Squat-a-thon');
    expect(goal.target).toBe(5000);
    expect(goal.unit).toBe('squats');
    expect(goal.status).toBe('active');
    // Minimal by design: no member identity, no credit, no shared total.
    expect(Object.keys(goal).sort()).toEqual(
      ['endsAt', 'goalId', 'startsAt', 'status', 'target', 'title', 'unit'].sort()
    );
  });

  it('refuses an unauthenticated caller', async () => {
    const groupId = await seedGroup();
    await seedGoal(groupId);
    await expectRefused(call(null, { groupId }), 'unauthenticated');
  });

  it('refuses a non-member with the same not-found as an unknown group', async () => {
    const groupId = await seedGroup();
    await seedGoal(groupId);
    await expectRefused(call('stranger', { groupId }), 'not-found');
    await expectRefused(call('stranger', { groupId: 'no-such-group' }), 'not-found');
  });

  it('refuses a member whose membership is not active', async () => {
    const groupId = await seedGroup();
    await seedMember(groupId, 'removed-1', 'removed');
    await seedGoal(groupId);
    await expectRefused(call('removed-1', { groupId }), 'not-found');
  });

  it('does not leak another community goals', async () => {
    const mine = await seedGroup();
    const theirs = await seedGroup();
    await seedMember(mine, 'member-2');
    const mineGoal = await seedGoal(mine, { title: 'Mine' });
    await seedGoal(theirs, { title: 'Theirs' });

    const result = await call('member-2', { groupId: mine });
    expect(result.goals.map((g) => g.goalId)).toEqual([mineGoal]);
  });

  it('rejects a missing groupId', async () => {
    await expectRefused(call('member-3', {}), 'invalid-argument');
  });

  it('returns an empty list when the community has no goal yet', async () => {
    const groupId = await seedGroup();
    await seedMember(groupId, 'member-4');
    const result = await call('member-4', { groupId });
    expect(result.goals).toEqual([]);
  });

  it('keeps several active goals separate rather than collapsing them', async () => {
    const groupId = await seedGroup();
    await seedMember(groupId, 'member-5');
    await seedGoal(groupId, { title: 'Squats', unit: 'squats', endsInMs: 3_600_000 });
    await seedGoal(groupId, { title: 'Steps', unit: 'steps', endsInMs: 7_200_000 });

    const result = await call('member-5', { groupId });
    expect(result.goals).toHaveLength(2);
    expect(result.goals.map((g) => g.unit).sort()).toEqual(['squats', 'steps']);
    // Deterministic order so the interface does not reshuffle between polls.
    expect(result.goals[0]!.endsAt < result.goals[1]!.endsAt).toBe(true);
  });

  it('omits a goal that is no longer active', async () => {
    const groupId = await seedGroup();
    await seedMember(groupId, 'member-6');
    await seedGoal(groupId, { status: 'closed' });
    const result = await call('member-6', { groupId });
    expect(result.goals).toEqual([]);
  });

  it('still lists a goal that has passed its target', async () => {
    const groupId = await seedGroup();
    await seedMember(groupId, 'member-7');
    const goalId = await seedGoal(groupId, { target: 10, unit: 'reps' });

    await (
      wsfContribute as unknown as { run: (r: never) => Promise<{ sharedTotal: number }> }
    ).run({
      data: { goalId, attemptId: 'overshoot-attempt-1', count: 25 },
      auth: { uid: 'member-7', token: {} },
      rawRequest: {},
    } as never);

    const result = await call('member-7', { groupId });
    expect(result.goals.map((g) => g.goalId)).toEqual([goalId]);
    expect(result.goals[0]!.status).toBe('active');
  });
});
