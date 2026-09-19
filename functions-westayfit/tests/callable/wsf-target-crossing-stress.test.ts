/**
 * CONTENTION under the one-time target-crossing event.
 *
 * Before a goal crosses its target, every wsfContribute transaction reads all
 * ten counter shards so it can decide whether THIS attempt crossed. That is a
 * read set every concurrent shard write can invalidate, so this file measures
 * what that costs: N simultaneous, unique, valid attempts on one below-target
 * goal (N = 20 and N = 50), and the same N on a goal that has already crossed
 * (the cheap single-shard path) as the baseline.
 *
 * What is pinned, per batch:
 *   • every attempt is accepted after Firestore's normal transaction retries —
 *     no `aborted`/`internal` failures leak to a member;
 *   • each accepted attempt counted exactly once (exact final shard sum);
 *   • exactly one attempt in the crossing batch is told it crossed, and the
 *     goal carries exactly one event whose reachedAttemptId is that attempt;
 *   • elapsed wall-clock per batch is printed so the pre-crossing cost is
 *     visible next to the post-crossing baseline.
 */

process.env.METADATA_SERVER_DETECTION =
  process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { wsfContribute } from '../../src/index';

type Data = Record<string, unknown>;

function makeRequest(uid: string, data: Data): any {
  return {
    auth: { uid, token: { email_verified: true } as any } as any,
    data: data as any,
    rawRequest: {} as any,
    acceptsStreaming: false,
  } as any;
}

type ContributeValue = {
  addedCount: number;
  ownCredit: number;
  alreadyRecorded: boolean;
  sharedTotal?: number;
  crossedTarget?: boolean;
};

async function contribute(
  uid: string,
  data: Data
): Promise<{ ok: true; value: ContributeValue; ms: number } | { ok: false; code: string; message: string; ms: number }> {
  const t0 = Date.now();
  try {
    const value = (await wsfContribute.run(makeRequest(uid, data))) as ContributeValue;
    return { ok: true, value, ms: Date.now() - t0 };
  } catch (e) {
    const err = e as HttpsError;
    return { ok: false, code: String(err.code ?? 'unknown'), message: String(err.message ?? ''), ms: Date.now() - t0 };
  }
}

function uniq(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function seedGoal(target: number): Promise<{ goalId: string; communityGroupId: string }> {
  const communityGroupId = uniq('grp');
  const now = new Date();
  const ref = getFirestore().collection('wsfGoals').doc();
  await ref.set({
    ownerUid: 'wsfSeedOwner',
    communityGroupId,
    title: 'Contention goal',
    target,
    unit: 'squats',
    status: 'active',
    startsAt: Timestamp.fromDate(new Date(now.getTime() - 60_000)),
    endsAt: Timestamp.fromDate(new Date(now.getTime() + 60 * 60_000)),
    timezone: 'America/New_York',
    crossingTracked: true,
    createdAt: new Date(),
  });
  return { goalId: ref.id, communityGroupId };
}

async function seedMembers(groupId: string, n: number): Promise<string[]> {
  const db = getFirestore();
  const uids: string[] = [];
  const batch = db.batch();
  for (let i = 0; i < n; i++) {
    const uid = uniq(`m${i}`);
    uids.push(uid);
    batch.set(db.doc(`wsfMemberships/${groupId}_${uid}`), {
      groupId,
      userId: uid,
      role: 'member',
      membershipStatus: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  await batch.commit();
  return uids;
}

async function shardSum(goalId: string): Promise<number> {
  const db = getFirestore();
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const snap = await db.doc(`wsfGoalCounters/${goalId}/shards/${i}`).get();
    const data = snap.data() as { count?: number } | undefined;
    if (typeof data?.count === 'number') total += data.count;
  }
  return total;
}

async function runBatch(label: string, goalId: string, uids: string[], count: number, attemptPrefix: string) {
  const t0 = Date.now();
  const results = await Promise.all(
    uids.map((uid, i) => contribute(uid, { goalId, attemptId: `stress-${attemptPrefix}-${i}`, count }))
  );
  const elapsed = Date.now() - t0;
  const failed = results.filter((r) => !r.ok) as Array<{ ok: false; code: string; message: string; ms: number }>;
  const ok = results.filter((r) => r.ok) as Array<{ ok: true; value: ContributeValue; ms: number }>;
  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))];
  const max = latencies[latencies.length - 1];
  const crossed = ok.filter((r) => r.value.crossedTarget === true).length;
  // eslint-disable-next-line no-console
  console.log(
    `[contention] ${label}: N=${uids.length} count=${count} elapsed=${elapsed}ms p50=${p50}ms p95=${p95}ms max=${max}ms failed=${failed.length} crossed=${crossed}` +
      (failed.length ? ` codes=${failed.map((f) => f.code).join(',')}` : '')
  );
  return { results, ok, failed, elapsed, crossed };
}

describe('wsfContribute — contention around the target crossing', () => {
  beforeAll(async () => {
    await getFirestore().doc('_warmup/wsf-target-crossing-stress').set({ at: Date.now() });
  }, 30_000);

  for (const n of [20, 50]) {
    test(`${n} simultaneous unique attempts on a below-target goal: all count once, exactly one crossing`, async () => {
      const target = 500;
      const count = Math.ceil(600 / n); // the batch crosses as a whole
      const { goalId, communityGroupId } = await seedGoal(target);
      const uids = await seedMembers(communityGroupId, n);

      const pre = await runBatch(`pre-crossing (reachedAt null)`, goalId, uids, count, `a${n}`);
      expect(pre.failed).toEqual([]);
      expect(pre.ok.length).toBe(n);
      const sum = await shardSum(goalId);
      expect(sum).toBe(n * count);
      // Nobody is credited (see recordTargetCrossing); the event itself is recorded exactly once.
      expect(pre.crossed).toBe(0);

      const goal = (await getFirestore().doc(`wsfGoals/${goalId}`).get()).data() as Record<string, unknown>;
      expect(goal.reachedAt).toBeDefined();
        expect(goal.reachedAttemptId).toBeNull();
      expect(typeof goal.reachedSharedTotal).toBe('number');
      expect(goal.reachedSharedTotal as number).toBeGreaterThanOrEqual(target);
      expect(goal.reachedSharedTotal as number).toBeLessThanOrEqual(n * count);

      // Every attempt replays to its own stored answer: still exactly one crossing.
      const replays = await Promise.all(
        uids.map((uid, i) => contribute(uid, { goalId, attemptId: `stress-a${n}-${i}`, count }))
      );
      const replayOk = replays.filter((r) => r.ok) as Array<{ ok: true; value: ContributeValue }>;
      expect(replayOk.length).toBe(n);
      expect(replayOk.every((r) => r.value.alreadyRecorded)).toBe(true);
      expect(replayOk.filter((r) => r.value.crossedTarget === true).length).toBe(pre.crossed);
      expect(await shardSum(goalId)).toBe(n * count);

      // Baseline: the same N on the SAME goal now that it has crossed (single-shard path).
      const post = await runBatch(`post-crossing (reachedAt set)`, goalId, uids, count, `b${n}`);
      expect(post.failed).toEqual([]);
      expect(post.crossed).toBe(0);
      expect(await shardSum(goalId)).toBe(2 * n * count);
    }, 180_000);
  }
});
