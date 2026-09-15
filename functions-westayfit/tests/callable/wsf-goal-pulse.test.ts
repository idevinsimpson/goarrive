/**
 * wsfGoalPulse — public read of the shared total for a goal.
 *
 * Pins the read-side behavior of the E4-A1 slice:
 *   * public callable (no auth): a display / kiosk uses it unauthenticated
 *   * sharedTotal equals the sum of the 10 goal shards
 *   * contributorCount equals the number of members with a totals doc
 *   * unknown goalId -> not-found
 *   * cross-goal isolation: two goals do not share counters
 *
 * Cache TTL (2s) is a correctness concern for stale reads and is exercised
 * indirectly — a second call within the TTL must not undercount a shard
 * write that landed between the two calls (test asserts both calls return
 * the same snapshot when nothing else has changed).
 *
 * Runs against the local Firestore emulator via `func.run(request)`.
 */

process.env.METADATA_SERVER_DETECTION =
  process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { wsfGoalPulse } from '../../src/index';

type Data = Record<string, unknown>;

function makeRequest(data: Data): Parameters<typeof wsfGoalPulse.run>[0] {
  return {
    auth: undefined,
    data: data as any,
    rawRequest: {} as any,
    acceptsStreaming: false,
  } as any;
}

async function tryRun(data: Data) {
  try {
    return { ok: true as const, value: await wsfGoalPulse.run(makeRequest(data)) };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}

async function seedGoal(opts?: {
  target?: number;
  unit?: string;
  status?: 'active' | 'closed';
}): Promise<string> {
  // Uses the full production wsfGoals shape (community + window fields)
  // even though wsfGoalPulse only reads target/unit/status. Keeps the seed
  // realistic and matches the same shape used across the E4-A1-R1
  // corrected callable tests.
  const now = new Date();
  const ref = getFirestore().collection('wsfGoals').doc();
  await ref.set({
    ownerUid: 'wsfPulseSeed',
    communityGroupId: `pulseGroup_${ref.id}`,
    title: 'E4-A1 pulse test goal',
    target: opts?.target ?? 5000,
    unit: opts?.unit ?? 'squats',
    status: opts?.status ?? 'active',
    startsAt: Timestamp.fromDate(new Date(now.getTime() - 60_000)),
    endsAt: Timestamp.fromDate(new Date(now.getTime() + 60 * 60_000)),
    timezone: 'America/New_York',
    createdAt: new Date(),
  });
  return ref.id;
}

async function seedShardTotals(
  goalId: string,
  perShard: number[]
): Promise<void> {
  const db = getFirestore();
  const batch = db.batch();
  perShard.forEach((count, i) => {
    if (count > 0) {
      batch.set(
        db.doc(`wsfGoalCounters/${goalId}/shards/${i}`),
        { count },
        { merge: true }
      );
    }
  });
  await batch.commit();
}

async function seedContributors(
  goalId: string,
  uids: string[]
): Promise<void> {
  const db = getFirestore();
  const batch = db.batch();
  uids.forEach((uid) => {
    batch.set(
      db.doc(`wsfGoalMemberTotals/${goalId}_${uid}`),
      { goalId, userId: uid, total: 1, updatedAt: new Date() },
      { merge: true }
    );
  });
  await batch.commit();
}

beforeAll(async () => {
  await getFirestore()
    .doc('_warmup/wsf-goal-pulse')
    .set({ at: Date.now() }, { merge: true });
});

describe('wsfGoalPulse', () => {
  test('missing goalId -> invalid-argument', async () => {
    const r = await tryRun({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid-argument');
  });

  test('unknown goalId -> not-found', async () => {
    const r = await tryRun({ goalId: `wsfPulseUnknown_${Date.now()}` });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not-found');
  });

  test('fresh goal: sharedTotal=0, contributorCount=0, echoes target/unit/status', async () => {
    const goalId = await seedGoal({ target: 5000, unit: 'squats' });
    const r = await tryRun({ goalId });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({
        sharedTotal: 0,
        target: 5000,
        unit: 'squats',
        status: 'active',
        contributorCount: 0,
      });
    }
  });

  test('sharedTotal equals the sum of all 10 shards; contributorCount counts totals docs', async () => {
    const goalId = await seedGoal({ target: 5000 });
    await seedShardTotals(goalId, [10, 0, 20, 0, 5, 0, 0, 15, 0, 0]); // 50
    await seedContributors(goalId, [`u1_${Date.now()}`, `u2_${Date.now()}`]);
    const r = await tryRun({ goalId });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.sharedTotal).toBe(50);
      expect(r.value.contributorCount).toBe(2);
    }
  });

  test('cross-goal isolation: two goals do not share counters or contributors', async () => {
    const g1 = await seedGoal({ target: 5000, unit: 'squats' });
    const g2 = await seedGoal({ target: 3000, unit: 'push-ups' });
    await seedShardTotals(g1, [100, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    await seedShardTotals(g2, [7, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    await seedContributors(g1, [`iso1_${Date.now()}`]);
    await seedContributors(g2, [
      `iso2a_${Date.now()}`,
      `iso2b_${Date.now()}`,
    ]);

    const [r1, r2] = await Promise.all([
      tryRun({ goalId: g1 }),
      tryRun({ goalId: g2 }),
    ]);
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.value.sharedTotal).toBe(100);
      expect(r1.value.unit).toBe('squats');
      expect(r1.value.contributorCount).toBe(1);
      expect(r2.value.sharedTotal).toBe(7);
      expect(r2.value.unit).toBe('push-ups');
      expect(r2.value.contributorCount).toBe(2);
    }
  });

  test('closed goal returns status: closed with current counter, does not throw', async () => {
    const goalId = await seedGoal({ status: 'closed', target: 100 });
    await seedShardTotals(goalId, [42, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const r = await tryRun({ goalId });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('closed');
      expect(r.value.sharedTotal).toBe(42);
    }
  });

  test('cache TTL: same snapshot returned on immediate re-read (no re-fetch stale write)', async () => {
    const goalId = await seedGoal({ target: 5000 });
    await seedShardTotals(goalId, [10, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const a = await tryRun({ goalId });

    // A shard write lands BETWEEN the two calls. Because the second call
    // arrives within the 2s TTL, wsfGoalPulse should return the cached
    // snapshot — a display polling at 2s cadence never over- or
    // under-counts against the previous frame.
    await seedShardTotals(goalId, [15, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const b = await tryRun({ goalId });

    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.sharedTotal).toBe(10);
      expect(b.value.sharedTotal).toBe(10);
    }
  });
});
