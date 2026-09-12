/**
 * wsfAdjustGoal — authorized downward/upward correction to a goal's shared
 * total (and, optionally, a specific member's own credit).
 *
 * Pins the E4-A1-R1 correction-safety proofs:
 *
 *   • Caller must have an active foundingChampion membership in the goal's
 *     community. Non-members and rank-and-file members are refused with
 *     `permission-denied`.
 *   • Positive delta moves shared total up.
 *   • Negative delta with targetUid moves shared total AND the member's
 *     total down by the same amount.
 *   • Attempts that would drive shared or member totals below zero are
 *     rejected with `failed-precondition`. The audit doc is not written on
 *     rejection.
 *   • Every accepted adjustment writes a new immutable
 *     `wsfGoalAdjustments/{adjId}` doc — running the same call twice writes
 *     two rows, each with its own id.
 *
 * Runs against the local Firestore emulator via `func.run(request)`.
 */

process.env.METADATA_SERVER_DETECTION =
  process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'goarrive-test';
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { wsfAdjustGoal } from '../../src/index';

type Data = Record<string, unknown>;

function makeRequest(
  uid: string | null,
  data: Data
): Parameters<typeof wsfAdjustGoal.run>[0] {
  return {
    auth: uid
      ? ({ uid, token: { email_verified: true } as any } as any)
      : undefined,
    data: data as any,
    rawRequest: {} as any,
    acceptsStreaming: false,
  } as any;
}

async function tryRun(uid: string | null, data: Data) {
  try {
    return {
      ok: true as const,
      value: await wsfAdjustGoal.run(makeRequest(uid, data)),
    };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}

async function seedMembership(
  groupId: string,
  uid: string,
  opts?: { role?: string; membershipStatus?: string }
): Promise<void> {
  await getFirestore().doc(`wsfMemberships/${groupId}_${uid}`).set(
    {
      groupId,
      userId: uid,
      role: opts?.role ?? 'foundingChampion',
      membershipStatus: opts?.membershipStatus ?? 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    { merge: true }
  );
}

async function seedGoal(opts?: {
  target?: number;
  unit?: string;
  status?: 'active' | 'closed';
  ownerUid?: string;
  communityGroupId?: string;
  timezone?: string;
}): Promise<{ goalId: string; communityGroupId: string }> {
  const communityGroupId = opts?.communityGroupId ?? uniq('grp');
  const now = new Date();
  const ref = getFirestore().collection('wsfGoals').doc();
  await ref.set({
    ownerUid: opts?.ownerUid ?? 'wsfSeedOwner',
    communityGroupId,
    title: 'Adjust-goal test',
    target: opts?.target ?? 5000,
    unit: opts?.unit ?? 'squats',
    status: opts?.status ?? 'active',
    startsAt: Timestamp.fromDate(new Date(now.getTime() - 60_000)),
    endsAt: Timestamp.fromDate(new Date(now.getTime() + 60 * 60_000)),
    timezone: opts?.timezone ?? 'America/New_York',
    createdAt: new Date(),
  });
  return { goalId: ref.id, communityGroupId };
}

async function primeShardTotal(goalId: string, total: number): Promise<void> {
  await getFirestore()
    .doc(`wsfGoalCounters/${goalId}/shards/0`)
    .set({ count: total }, { merge: true });
}

async function primeMemberTotal(
  goalId: string,
  uid: string,
  total: number
): Promise<void> {
  await getFirestore().doc(`wsfGoalMemberTotals/${goalId}_${uid}`).set(
    {
      goalId,
      userId: uid,
      total,
      updatedAt: new Date(),
    },
    { merge: true }
  );
}

async function directShardSum(goalId: string): Promise<number> {
  const db = getFirestore();
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const snap = await db.doc(`wsfGoalCounters/${goalId}/shards/${i}`).get();
    const data = snap.data() as { count?: number } | undefined;
    if (typeof data?.count === 'number') total += data.count;
  }
  return total;
}

async function directMemberTotal(
  goalId: string,
  uid: string
): Promise<number> {
  const snap = await getFirestore()
    .doc(`wsfGoalMemberTotals/${goalId}_${uid}`)
    .get();
  return (snap.data() as { total?: number } | undefined)?.total ?? 0;
}

async function directAdjustmentCount(goalId: string): Promise<number> {
  const snap = await getFirestore()
    .collection('wsfGoalAdjustments')
    .where('goalId', '==', goalId)
    .count()
    .get();
  return snap.data().count;
}

function uniq(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

describe('wsfAdjustGoal', () => {
  beforeAll(async () => {
    await getFirestore()
      .doc('_warmup/wsf-adjust-goal')
      .set({ at: Date.now() });
  }, 30_000);

  test('unauthenticated: unauthenticated code', async () => {
    const r = await tryRun(null, {
      goalId: 'anything',
      delta: -5,
      reason: 'test',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('unauthenticated');
  });

  test('invalid-argument: delta must be nonzero integer', async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const uid = uniq('champ');
    await seedMembership(communityGroupId, uid);

    const r0 = await tryRun(uid, { goalId, delta: 0, reason: 'nope' });
    expect(r0.ok).toBe(false);
    if (!r0.ok) expect(r0.error.code).toBe('invalid-argument');

    const rf = await tryRun(uid, { goalId, delta: 1.5, reason: 'nope' });
    expect(rf.ok).toBe(false);
    if (!rf.ok) expect(rf.error.code).toBe('invalid-argument');
  });

  test('invalid-argument: reason must be a non-empty string within 280 chars', async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const uid = uniq('champ');
    await seedMembership(communityGroupId, uid);

    const rEmpty = await tryRun(uid, { goalId, delta: -5, reason: '   ' });
    expect(rEmpty.ok).toBe(false);
    if (!rEmpty.ok) expect(rEmpty.error.code).toBe('invalid-argument');

    const rLong = await tryRun(uid, {
      goalId,
      delta: -5,
      reason: 'x'.repeat(281),
    });
    expect(rLong.ok).toBe(false);
    if (!rLong.ok) expect(rLong.error.code).toBe('invalid-argument');
  });

  test('not-found: unknown goalId', async () => {
    const uid = uniq('champ');
    // Even if the caller is a champion of *some* group, the callable resolves
    // group from the goal doc — unknown goal never reaches the auth check.
    await seedMembership(uniq('someGroup'), uid);
    const r = await tryRun(uid, {
      goalId: 'nonexistent',
      delta: -5,
      reason: 'unknown goal',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not-found');
  });

  test('permission-denied: caller has no membership in the goal community', async () => {
    const { goalId } = await seedGoal();
    const r = await tryRun(uniq('outsider'), {
      goalId,
      delta: -5,
      reason: 'unauthorized',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('permission-denied');
    expect(await directAdjustmentCount(goalId)).toBe(0);
  });

  test('permission-denied: regular member (non-foundingChampion) cannot adjust', async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const uid = uniq('rankAndFile');
    await seedMembership(communityGroupId, uid, {
      role: 'member',
    });
    const r = await tryRun(uid, {
      goalId,
      delta: -5,
      reason: 'trying to correct as a plain member',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('permission-denied');
    expect(await directAdjustmentCount(goalId)).toBe(0);
  });

  test('happy path: +25 with no targetUid moves shared total, writes one immutable adjustment', async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const champ = uniq('champUp');
    await seedMembership(communityGroupId, champ);
    await primeShardTotal(goalId, 100);

    const result = await wsfAdjustGoal.run(
      makeRequest(champ, {
        goalId,
        delta: 25,
        reason: 'Manual tally counter was jammed by 25.',
      })
    );

    expect(result.delta).toBe(25);
    expect(result.targetUid).toBeNull();
    expect(result.targetMemberTotal).toBeNull();
    expect(result.sharedTotal).toBe(125);
    expect(await directShardSum(goalId)).toBe(125);
    expect(await directAdjustmentCount(goalId)).toBe(1);

    const adjSnap = await getFirestore()
      .doc(`wsfGoalAdjustments/${result.adjustmentId}`)
      .get();
    const adj = adjSnap.data() as Record<string, unknown>;
    expect(adj.goalId).toBe(goalId);
    expect(adj.delta).toBe(25);
    expect(adj.targetUid).toBeNull();
    expect(adj.reason).toBe('Manual tally counter was jammed by 25.');
    expect(adj.byUid).toBe(champ);
    expect(adj.byRole).toBe('foundingChampion');
  });

  test('happy path: -30 with targetUid moves shared AND that member total down by 30', async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const champ = uniq('champDown');
    const target = uniq('mistake');
    await Promise.all([
      seedMembership(communityGroupId, champ),
      seedMembership(communityGroupId, target, { role: 'member' }),
    ]);
    await primeShardTotal(goalId, 200);
    await primeMemberTotal(goalId, target, 50);

    const result = await wsfAdjustGoal.run(
      makeRequest(champ, {
        goalId,
        delta: -30,
        targetUid: target,
        reason: 'Double-counted 30 squats.',
      })
    );

    expect(result.delta).toBe(-30);
    expect(result.targetUid).toBe(target);
    expect(result.sharedTotal).toBe(170);
    expect(result.targetMemberTotal).toBe(20);
    expect(await directShardSum(goalId)).toBe(170);
    expect(await directMemberTotal(goalId, target)).toBe(20);
  });

  test('failed-precondition: adjustment would drive shared total below zero', async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const champ = uniq('champUnder');
    await seedMembership(communityGroupId, champ);
    await primeShardTotal(goalId, 10);

    const r = await tryRun(champ, {
      goalId,
      delta: -25,
      reason: 'over-correction',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('failed-precondition');
    // No audit row written on rejection.
    expect(await directShardSum(goalId)).toBe(10);
    expect(await directAdjustmentCount(goalId)).toBe(0);
  });

  test("failed-precondition: adjustment would drive the target member's total below zero", async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const champ = uniq('champMinus');
    const target = uniq('lowBal');
    await Promise.all([
      seedMembership(communityGroupId, champ),
      seedMembership(communityGroupId, target, { role: 'member' }),
    ]);
    await primeShardTotal(goalId, 100);
    await primeMemberTotal(goalId, target, 5);

    const r = await tryRun(champ, {
      goalId,
      delta: -10,
      targetUid: target,
      reason: 'over-correct member',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('failed-precondition');
    expect(await directShardSum(goalId)).toBe(100); // unchanged
    expect(await directMemberTotal(goalId, target)).toBe(5); // unchanged
    expect(await directAdjustmentCount(goalId)).toBe(0);
  });

  test('sequential adjustments accumulate correctly and each writes its own audit row', async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const champ = uniq('champSeq');
    await seedMembership(communityGroupId, champ);
    await primeShardTotal(goalId, 0);

    const a = await wsfAdjustGoal.run(
      makeRequest(champ, { goalId, delta: 50, reason: 'add 50' })
    );
    const b = await wsfAdjustGoal.run(
      makeRequest(champ, { goalId, delta: -20, reason: 'undo 20' })
    );
    const c = await wsfAdjustGoal.run(
      makeRequest(champ, { goalId, delta: 5, reason: 'add 5' })
    );

    expect(a.sharedTotal).toBe(50);
    expect(b.sharedTotal).toBe(30);
    expect(c.sharedTotal).toBe(35);
    expect(await directShardSum(goalId)).toBe(35);
    expect(await directAdjustmentCount(goalId)).toBe(3);
    expect(new Set([a.adjustmentId, b.adjustmentId, c.adjustmentId]).size).toBe(
      3
    );
  });
});
