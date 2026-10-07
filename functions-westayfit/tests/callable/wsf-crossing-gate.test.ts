/**
 * THE CROSSING GATE (MEMBER-TRUTH-BACKEND-1) — the authoritative before and
 * after that decide the one fresh Together crossing.
 *
 * What this pins, beyond wsf-target-crossing.test.ts:
 *   • wsfCreateGoal opens every new goal's gate at an exact zero, so the
 *     retired `crossingTracked` contract is replaced by something true.
 *   • A goal without a gate builds it from the shards ONCE, inside the
 *     contribution transaction, and adds this contribution exactly once.
 *   • The gate and the shards never disagree: after contributions, a
 *     correction and replays, `gate.total` equals the shard sum.
 *   • A timed-out reply retried with the same attemptId, and a later
 *     reconcile, change nothing and never grant `crossedTarget`.
 *   • A correction moves an open gate to the authoritative projected total;
 *     one that takes the total past the target closes the gate with NO
 *     attempt, NO `reachedAt`, and no fresh crossing ever after.
 *   • A goal already reached before the gate existed (a legacy event) is
 *     never given a fresh crossing, and its gate is never read.
 *   • Refused contributions (closed, not started, ended, non-member, zero)
 *     move neither the gate nor the shards.
 *
 * All data is synthetic, emulator-only (demo-wsf-local).
 */

process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { wsfAdjustGoal, wsfContribute, wsfCreateGoal } from '../../src/index';

type Value = {
  addedCount: number;
  ownCredit: number;
  alreadyRecorded: boolean;
  sharedTotal?: number;
  crossedTarget?: boolean;
  crossingRecorded?: boolean;
};

const db = () => getFirestore();
const HOUR = 60 * 60 * 1000;

function req(uid: string, data: Record<string, unknown>): any {
  return { auth: { uid, token: { email_verified: true } }, data, rawRequest: {}, acceptsStreaming: false };
}

async function contribute(uid: string, goalId: string, attemptId: string, count: number): Promise<Value> {
  return (await wsfContribute.run(req(uid, { goalId, attemptId, count }))) as Value;
}

async function refusal(uid: string, goalId: string, attemptId: string, count: unknown): Promise<string> {
  try {
    await wsfContribute.run(req(uid, { goalId, attemptId, count }));
    return 'accepted';
  } catch (e) {
    return (e as HttpsError).code;
  }
}

function uniq(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function seedMember(groupId: string, uid: string, role = 'member') {
  await db().doc(`wsfMemberships/${groupId}_${uid}`).set({ groupId, userId: uid, role, membershipStatus: 'active' });
}

async function seedGoal(target: number, extra: Record<string, unknown> = {}) {
  const groupId = uniq('grp');
  const ref = db().collection('wsfGoals').doc();
  const now = Date.now();
  await ref.set({
    ownerUid: 'seed',
    communityGroupId: groupId,
    title: 'Synthetic gate goal',
    target,
    unit: 'squats',
    status: 'active',
    startsAt: Timestamp.fromMillis(now - HOUR),
    endsAt: Timestamp.fromMillis(now + HOUR),
    timezone: 'America/New_York',
    ...extra,
  });
  return { goalId: ref.id, groupId };
}

async function shardSum(goalId: string): Promise<number> {
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const d = (await db().doc(`wsfGoalCounters/${goalId}/shards/${i}`).get()).data() as { count?: number } | undefined;
    if (typeof d?.count === 'number') total += d.count;
  }
  return total;
}

async function gateOf(goalId: string) {
  return (await db().doc(`wsfGoalCrossingGates/${goalId}`).get()).data() as
    | { total: number; crossed: boolean; crossedAttemptId: string | null }
    | undefined;
}

async function goalOf(goalId: string) {
  return (await db().doc(`wsfGoals/${goalId}`).get()).data() as Record<string, unknown>;
}

beforeAll(async () => {
  await db().doc('_warmup/wsf-crossing-gate').set({ at: Date.now() });
}, 30_000);

describe('the gate opens with the goal', () => {
  it('wsfCreateGoal writes an exact-zero open gate, and the first crossing on that goal is fresh', async () => {
    const groupId = uniq('grp');
    const champion = uniq('champ');
    await seedMember(groupId, champion, 'foundingChampion');
    const now = Date.now();
    const { goalId } = (await wsfCreateGoal.run(
      req(champion, {
        communityGroupId: groupId,
        title: 'Synthetic created goal',
        target: 10,
        unit: 'squats',
        startsAt: new Date(now - HOUR).toISOString(),
        endsAt: new Date(now + HOUR).toISOString(),
        timezone: 'America/New_York',
        repeatPolicy: 'multiple',
      })
    )) as { goalId: string };
    expect(await gateOf(goalId)).toMatchObject({ total: 0, crossed: false, crossedAttemptId: null });
    // The retired field is not written: nothing reads it any more.
    expect((await goalOf(goalId)).crossingTracked).toBeUndefined();

    const below = await contribute(champion, goalId, 'gate-created-below', 9);
    expect(below.crossedTarget).toBe(false);
    const cross = await contribute(champion, goalId, 'gate-created-cross', 1);
    expect(cross.crossedTarget).toBe(true);
    expect((await goalOf(goalId)).reachedAttemptId).toBe('gate-created-cross');
  });
});

describe('a goal without a gate builds it once from the shards', () => {
  it('starts from the authoritative shard total and adds this contribution exactly once', async () => {
    const { goalId, groupId } = await seedGoal(100);
    await db().doc(`wsfGoalCounters/${goalId}/shards/3`).set({ count: 40 });
    await db().doc(`wsfGoalCounters/${goalId}/shards/7`).set({ count: 35 });
    const uid = uniq('m');
    await seedMember(groupId, uid);
    expect(await gateOf(goalId)).toBeUndefined();

    const first = await contribute(uid, goalId, 'lazy-first-attempt', 5);
    expect(first.crossedTarget).toBe(false);
    expect(await gateOf(goalId)).toMatchObject({ total: 80, crossed: false });
    expect(await shardSum(goalId)).toBe(80);

    const cross = await contribute(uid, goalId, 'lazy-cross-attempt', 20);
    expect(cross.crossedTarget).toBe(true);
    expect(await gateOf(goalId)).toMatchObject({ total: 100, crossed: true, crossedAttemptId: 'lazy-cross-attempt' });
  });

  it('a goal already beyond its target when its gate is first built never celebrates and gets no dated event', async () => {
    const { goalId, groupId } = await seedGoal(100);
    await db().doc(`wsfGoalCounters/${goalId}/shards/0`).set({ count: 150 });
    const uid = uniq('m');
    await seedMember(groupId, uid);
    const v = await contribute(uid, goalId, 'legacy-beyond-attempt', 5);
    expect(v.crossedTarget).toBe(false);
    expect(await gateOf(goalId)).toMatchObject({ crossed: true, crossedAttemptId: null });
    expect((await goalOf(goalId)).reachedAt).toBeUndefined();
  });

  it('a legacy goal that already carries a reached event is never given a fresh crossing, and its gate is never built', async () => {
    const { goalId, groupId } = await seedGoal(100, {
      reachedAt: Timestamp.fromMillis(Date.now() - 24 * HOUR),
      reachedAttemptId: null,
      reachedSharedTotal: 100,
    });
    await db().doc(`wsfGoalCounters/${goalId}/shards/0`).set({ count: 90 });
    const uid = uniq('m');
    await seedMember(groupId, uid);
    const v = await contribute(uid, goalId, 'legacy-reached-attempt', 20);
    expect(v.crossedTarget).toBe(false);
    expect(await gateOf(goalId)).toBeUndefined();
    expect((await goalOf(goalId)).reachedAttemptId).toBeNull();
  });
});

describe('retries, reconciles and refusals move nothing', () => {
  it('a timed-out reply retried, then reconciled later, never grants the fresh crossing and never double-counts', async () => {
    const { goalId, groupId } = await seedGoal(10);
    const uid = uniq('m');
    await seedMember(groupId, uid);
    await contribute(uid, goalId, 'retry-first-attempt', 4);
    // The crossing call commits; its reply is "lost". The client retries the
    // SAME attemptId, then reconciles it again after a reload.
    const original = await contribute(uid, goalId, 'retry-cross-attempt', 6);
    expect(original.crossedTarget).toBe(true);
    const retried = await contribute(uid, goalId, 'retry-cross-attempt', 6);
    const reconciled = await contribute(uid, goalId, 'retry-cross-attempt', 6);
    for (const r of [retried, reconciled]) {
      expect(r.alreadyRecorded).toBe(true);
      expect(r.crossedTarget).toBe(false);
      expect(r.crossingRecorded).toBe(true);
      expect(r.addedCount).toBe(6);
      expect(r.sharedTotal).toBe(10);
    }
    expect(await shardSum(goalId)).toBe(10);
    expect(await gateOf(goalId)).toMatchObject({ total: 10, crossed: true, crossedAttemptId: 'retry-cross-attempt' });
  });

  it('post-target contributions never touch the gate and are never fresh crossings', async () => {
    const { goalId, groupId } = await seedGoal(10);
    const uid = uniq('m');
    await seedMember(groupId, uid);
    await contribute(uid, goalId, 'post-cross-attempt', 12);
    const gateBefore = await gateOf(goalId);
    for (let i = 0; i < 3; i++) {
      const v = await contribute(uid, goalId, `post-after-attempt-${i}`, 5);
      expect(v.crossedTarget).toBe(false);
      expect(v.crossingRecorded).toBeUndefined();
    }
    expect(await gateOf(goalId)).toEqual(gateBefore);
    expect(await shardSum(goalId)).toBe(27);
  });

  it('closed, not-started, ended, non-member and zero contributions move neither the gate nor the shards', async () => {
    const now = Date.now();
    const cases: Array<[string, Record<string, unknown>]> = [
      ['closed', { status: 'closed' }],
      ['upcoming', { startsAt: Timestamp.fromMillis(now + HOUR), endsAt: Timestamp.fromMillis(now + 2 * HOUR) }],
      ['ended', { endsAt: Timestamp.fromMillis(now - 1000) }],
    ];
    for (const [name, extra] of cases) {
      const { goalId, groupId } = await seedGoal(10, extra);
      await db().doc(`wsfGoalCrossingGates/${goalId}`).set({ total: 9, crossed: false, crossedAttemptId: null });
      const uid = uniq('m');
      await seedMember(groupId, uid);
      expect(await refusal(uid, goalId, `refused-${name}-attempt`, 5)).toBe('failed-precondition');
      expect(await gateOf(goalId)).toMatchObject({ total: 9, crossed: false });
      expect(await shardSum(goalId)).toBe(0);
      expect((await goalOf(goalId)).reachedAt).toBeUndefined();
    }
    const { goalId, groupId } = await seedGoal(10);
    await db().doc(`wsfGoalCrossingGates/${goalId}`).set({ total: 9, crossed: false, crossedAttemptId: null });
    expect(await refusal(uniq('stranger'), goalId, 'refused-stranger-attempt', 5)).toBe('permission-denied');
    const uid = uniq('m');
    await seedMember(groupId, uid);
    expect(await refusal(uid, goalId, 'refused-zero-attempt', 0)).toBe('invalid-argument');
    expect(await gateOf(goalId)).toMatchObject({ total: 9, crossed: false });
  });
});

describe('the crossing is a transition, not a level', () => {
  it('a target lowered beneath an open gate’s total never yields a fresh crossing', async () => {
    const { goalId, groupId } = await seedGoal(100);
    const uid = uniq('m');
    await seedMember(groupId, uid);
    await contribute(uid, goalId, 'lowered-first-attempt', 60);
    // No callable lowers a target today; this is the stored shape such a
    // change would produce. Nothing crossed from below to at-or-beyond.
    await db().doc(`wsfGoals/${goalId}`).update({ target: 50 });
    const v = await contribute(uid, goalId, 'lowered-next-attempt', 5);
    expect(v.crossedTarget).toBe(false);
    expect((await goalOf(goalId)).reachedAt).toBeUndefined();
  });
});

describe('corrections follow the shards and never celebrate', () => {
  async function adjust(uid: string, goalId: string, delta: number) {
    return (await wsfAdjustGoal.run(req(uid, { goalId, delta, reason: 'Synthetic correction.' }))) as { sharedTotal: number };
  }

  it('a correction moves an open gate to the exact projected total', async () => {
    const { goalId, groupId } = await seedGoal(100);
    const champ = uniq('champ');
    await seedMember(groupId, champ, 'foundingChampion');
    await contribute(champ, goalId, 'corr-open-attempt', 30);
    await adjust(champ, goalId, -10);
    expect(await gateOf(goalId)).toMatchObject({ total: 20, crossed: false });
    expect(await shardSum(goalId)).toBe(20);
    await adjust(champ, goalId, 15);
    expect(await gateOf(goalId)).toMatchObject({ total: 35, crossed: false });
    // And the next crossing is still decided exactly.
    const v = await contribute(champ, goalId, 'corr-open-cross', 65);
    expect(v.crossedTarget).toBe(true);
    expect(await gateOf(goalId)).toMatchObject({ total: 100, crossed: true, crossedAttemptId: 'corr-open-cross' });
  });

  it('a correction that crosses the target closes the gate: no attempt, no reachedAt, no later fresh crossing', async () => {
    const { goalId, groupId } = await seedGoal(100);
    const champ = uniq('champ');
    await seedMember(groupId, champ, 'foundingChampion');
    await contribute(champ, goalId, 'corr-cross-first', 60);
    await adjust(champ, goalId, 50);
    expect(await gateOf(goalId)).toMatchObject({ total: 110, crossed: true, crossedAttemptId: null });
    expect((await goalOf(goalId)).reachedAt).toBeUndefined();
    // Down below the line and back over it: still never a fresh crossing.
    await adjust(champ, goalId, -40);
    const v = await contribute(champ, goalId, 'corr-cross-recross', 50);
    expect(v.crossedTarget).toBe(false);
    expect((await goalOf(goalId)).reachedAt).toBeUndefined();
    expect(await shardSum(goalId)).toBe(120);
  });

  it('a correction on a goal with no gate yet creates none; the first contribution builds it from the corrected shards', async () => {
    const { goalId, groupId } = await seedGoal(100);
    const champ = uniq('champ');
    await seedMember(groupId, champ, 'foundingChampion');
    await adjust(champ, goalId, 40);
    expect(await gateOf(goalId)).toBeUndefined();
    await contribute(champ, goalId, 'corr-nogate-first', 10);
    expect(await gateOf(goalId)).toMatchObject({ total: 50, crossed: false });
  });

  it('gate and shards agree after a mixed sequence of contributions, corrections and replays', async () => {
    const { goalId, groupId } = await seedGoal(1000);
    const champ = uniq('champ');
    await seedMember(groupId, champ, 'foundingChampion');
    await contribute(champ, goalId, 'mix-attempt-1', 100);
    await contribute(champ, goalId, 'mix-attempt-2', 50);
    await contribute(champ, goalId, 'mix-attempt-1', 100);
    await adjust(champ, goalId, -25);
    await contribute(champ, goalId, 'mix-attempt-3', 75);
    await adjust(champ, goalId, 10);
    expect((await gateOf(goalId))!.total).toBe(await shardSum(goalId));
    expect(await shardSum(goalId)).toBe(210);
  });
});
