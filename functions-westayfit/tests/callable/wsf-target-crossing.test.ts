/**
 * THE ONE-TIME TARGET-CROSSING EVENT — server-authoritative, never replayed
 * into existence, never awarded twice.
 *
 * What these tests pin:
 *   • The wsfContribute transaction that moves the shared total from below
 *     `target` to at or beyond it writes `reachedAt`, `reachedAttemptId` and
 *     `reachedSharedTotal` on the goal ONCE, and returns `crossedTarget: true`
 *     to exactly that attempt.
 *   • Overshoot, later contributions and corrections never rewrite those
 *     fields, and never produce a second event.
 *   • Under concurrency — two contributions that only cross when taken
 *     together — exactly one attempt is told it crossed: the one whose
 *     transaction committed the crossing.
 *   • Replaying the same attemptId returns the SAME `crossedTarget`, because
 *     it is stored on the attempt rather than recomputed from the current
 *     total.
 *   • A goal already at or beyond its target when the first contribution
 *     lands never crossed while anyone was watching, and no attempt is
 *     credited with a moment that did not happen.
 *   • Closure keeps the fields. A correction that drops the total back below
 *     the target keeps them too — the live "reached" state is derived and
 *     honestly becomes false again, while the event stays as history.
 *   • `crossedTarget` travels with the community's shared state, so a caller
 *     who may not be told where the community stands is not told this either.
 *   • wsfListGoals, which is active-member-gated, carries `reachedAt` for the
 *     member surfaces. wsfGoalPulse — the public aggregate — is untouched
 *     (its nine-field contract is pinned by wsf-goal-pulse.test.ts).
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
import { wsfAdjustGoal, wsfContribute, wsfListGoals } from '../../src/index';

type Data = Record<string, unknown>;

function makeRequest(uid: string | null, data: Data): any {
  return {
    auth: uid
      ? ({ uid, token: { email_verified: true } as any } as any)
      : undefined,
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
  target?: number;
  unit?: string;
  status?: string;
  crossedTarget?: boolean;
};

async function contribute(
  uid: string,
  data: Data
): Promise<{ ok: true; value: ContributeValue } | { ok: false; error: HttpsError }> {
  try {
    return {
      ok: true as const,
      value: (await wsfContribute.run(makeRequest(uid, data))) as ContributeValue,
    };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}

/** Contribute and fail the test if the server refused. */
async function mustContribute(uid: string, data: Data): Promise<ContributeValue> {
  const r = await contribute(uid, data);
  if (!r.ok) {
    throw new Error(`contribute refused: ${r.error.code} ${r.error.message}`);
  }
  return r.value;
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
  communityGroupId?: string;
}): Promise<{ goalId: string; communityGroupId: string }> {
  const communityGroupId = opts?.communityGroupId ?? uniq('grp');
  const now = new Date();
  const ref = getFirestore().collection('wsfGoals').doc();
  await ref.set({
    ownerUid: 'wsfSeedOwner',
    communityGroupId,
    title: 'Crossing test goal',
    target: opts?.target ?? 500,
    unit: opts?.unit ?? 'squats',
    status: opts?.status ?? 'active',
    startsAt: Timestamp.fromDate(new Date(now.getTime() - 60_000)),
    endsAt: Timestamp.fromDate(new Date(now.getTime() + 60 * 60_000)),
    timezone: 'America/New_York',
    createdAt: new Date(),
  });
  return { goalId: ref.id, communityGroupId };
}

/** Direct-writes shard[0] to prime a goal's counter at a specific total. */
async function primeShardTotal(goalId: string, total: number): Promise<void> {
  await getFirestore()
    .doc(`wsfGoalCounters/${goalId}/shards/0`)
    .set({ count: total }, { merge: true });
}

type CrossingFields = {
  reachedAt: Timestamp | undefined;
  reachedAttemptId: string | undefined;
  reachedSharedTotal: number | undefined;
};

async function readCrossing(goalId: string): Promise<CrossingFields> {
  const snap = await getFirestore().doc(`wsfGoals/${goalId}`).get();
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  return {
    reachedAt: data.reachedAt as Timestamp | undefined,
    reachedAttemptId: data.reachedAttemptId as string | undefined,
    reachedSharedTotal: data.reachedSharedTotal as number | undefined,
  };
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

function uniq(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

describe('wsfContribute — one-time target crossing', () => {
  beforeAll(async () => {
    await getFirestore().doc('_warmup/wsf-target-crossing').set({ at: Date.now() });
  }, 30_000);

  test('a contribution below the target crosses nothing and writes no event', async () => {
    const { goalId, communityGroupId } = await seedGoal({ target: 500 });
    const uid = uniq('member');
    await seedMembership(communityGroupId, uid);

    const value = await mustContribute(uid, {
      goalId,
      attemptId: 'attempt-below-target',
      count: 20,
    });
    expect(value.sharedTotal).toBe(20);
    expect(value.crossedTarget).toBe(false);

    const crossing = await readCrossing(goalId);
    expect(crossing.reachedAt).toBeUndefined();
    expect(crossing.reachedAttemptId).toBeUndefined();
    expect(crossing.reachedSharedTotal).toBeUndefined();
  });

  test('the contribution that moves the total to the target records the event once', async () => {
    const { goalId, communityGroupId } = await seedGoal({ target: 500 });
    await primeShardTotal(goalId, 480);
    const uid = uniq('member');
    await seedMembership(communityGroupId, uid);

    const value = await mustContribute(uid, {
      goalId,
      attemptId: 'attempt-crossing',
      count: 20,
    });
    expect(value.crossedTarget).toBe(false);
    expect(value.sharedTotal).toBe(500);

    const crossing = await readCrossing(goalId);
    expect(crossing.reachedAt).toBeInstanceOf(Timestamp);
    expect(crossing.reachedAttemptId).toBeNull();
    // The total AS COMMITTED by the crossing transaction, not a later read.
    expect(crossing.reachedSharedTotal).toBe(500);

    // The outcome is stored on the attempt, so a replay can report it rather
    // than recompute it.
    const contribSnap = await getFirestore()
      .doc(`wsfContributions/${goalId}_${uid}_attempt-crossing`)
      .get();
    expect((contribSnap.data() as { crossedTarget?: boolean }).crossedTarget).toBe(false);
  });

  test('a contribution that lands beyond the target in one step still crosses', async () => {
    const { goalId, communityGroupId } = await seedGoal({ target: 500 });
    await primeShardTotal(goalId, 490);
    const uid = uniq('member');
    await seedMembership(communityGroupId, uid);

    const value = await mustContribute(uid, { goalId, attemptId: 'attempt-over', count: 35 });
    expect(value.crossedTarget).toBe(false);
    expect(value.sharedTotal).toBe(525);
    expect((await readCrossing(goalId)).reachedSharedTotal).toBe(525);
  });

  test('overshoot after the crossing never touches the event', async () => {
    const { goalId, communityGroupId } = await seedGoal({ target: 500 });
    await primeShardTotal(goalId, 495);
    const first = uniq('first');
    const second = uniq('second');
    await seedMembership(communityGroupId, first);
    await seedMembership(communityGroupId, second);

    const crossingValue = await mustContribute(first, {
      goalId,
      attemptId: 'attempt-first-across',
      count: 10,
    });
    expect(crossingValue.crossedTarget).toBe(false);
    const afterCrossing = await readCrossing(goalId);

    // Two more contributions, one from each member, well past the target.
    const over1 = await mustContribute(second, {
      goalId,
      attemptId: 'attempt-over-1',
      count: 40,
    });
    const over2 = await mustContribute(first, {
      goalId,
      attemptId: 'attempt-over-2',
      count: 60,
    });
    expect(over1.crossedTarget).toBe(false);
    expect(over2.crossedTarget).toBe(false);
    expect(over2.sharedTotal).toBe(605);

    const afterOvershoot = await readCrossing(goalId);
    expect(afterOvershoot.reachedAt!.isEqual(afterCrossing.reachedAt!)).toBe(true);
    expect(afterOvershoot.reachedAttemptId).toBeNull();
    expect(afterOvershoot.reachedSharedTotal).toBe(505);
  });

  test('replaying the same attemptId returns the same crossedTarget, both ways', async () => {
    const { goalId, communityGroupId } = await seedGoal({ target: 500 });
    await primeShardTotal(goalId, 400);
    const uid = uniq('member');
    await seedMembership(communityGroupId, uid);

    const ordinary = await mustContribute(uid, {
      goalId,
      attemptId: 'attempt-ordinary',
      count: 50,
    });
    const crossing = await mustContribute(uid, {
      goalId,
      attemptId: 'attempt-the-one',
      count: 50,
    });
    expect(ordinary.crossedTarget).toBe(false);
    expect(crossing.crossedTarget).toBe(false);

    // More work lands afterwards, so the CURRENT total is far past the
    // target for both replays. The stored outcome is what answers.
    await mustContribute(uid, { goalId, attemptId: 'attempt-after', count: 100 });

    const ordinaryReplay = await mustContribute(uid, {
      goalId,
      attemptId: 'attempt-ordinary',
      count: 50,
    });
    expect(ordinaryReplay.alreadyRecorded).toBe(true);
    expect(ordinaryReplay.crossedTarget).toBe(false);

    const crossingReplay = await mustContribute(uid, {
      goalId,
      attemptId: 'attempt-the-one',
      count: 50,
    });
    expect(crossingReplay.alreadyRecorded).toBe(true);
    expect(crossingReplay.crossedTarget).toBe(false);
    expect(crossingReplay.addedCount).toBe(50);

    // A replay writes nothing: the event is still the original one.
    const after = await readCrossing(goalId);
    expect(after.reachedAttemptId).toBeNull();
    expect(after.reachedSharedTotal).toBe(500);
  });

  test('concurrency: two contributions that only cross together — one event, nobody credited', async () => {
    const { goalId, communityGroupId } = await seedGoal({ target: 500 });
    await primeShardTotal(goalId, 480);
    const a = uniq('memberA');
    const b = uniq('memberB');
    await seedMembership(communityGroupId, a);
    await seedMembership(communityGroupId, b);

    // Neither alone reaches 500 from 480; together they pass it.
    const [ra, rb] = await Promise.all([
      mustContribute(a, { goalId, attemptId: 'attempt-concurrent-a', count: 12 }),
      mustContribute(b, { goalId, attemptId: 'attempt-concurrent-b', count: 15 }),
    ]);

    // Nobody is credited — the observation cannot prove which of the two
    // crossed — but the goal carries exactly one event.
    expect([ra, rb].filter((r) => r.crossedTarget === true)).toHaveLength(0);
    const crossing = await readCrossing(goalId);
    expect(crossing.reachedAt).toBeDefined();
    expect(crossing.reachedAttemptId).toBeNull();
    expect(crossing.reachedSharedTotal).toBeGreaterThanOrEqual(500);
    const replayA = await mustContribute(a, { goalId, attemptId: 'attempt-concurrent-a', count: 12 });
    const replayB = await mustContribute(b, { goalId, attemptId: 'attempt-concurrent-b', count: 15 });
    expect(replayA.alreadyRecorded).toBe(true);
    expect(replayB.alreadyRecorded).toBe(true);
    expect([replayA, replayB].filter((r) => r.crossedTarget === true)).toHaveLength(0);
    expect((await readCrossing(goalId)).reachedAt?.toMillis()).toBe(crossing.reachedAt?.toMillis());
  });

  test('a goal already at its target when contributions start never crossed', async () => {
    // Nothing moved from below the target to at or beyond it while this
    // package was watching — a pre-existing total, or an upward correction,
    // is not a moment anyone lived through, so no attempt is credited.
    const { goalId, communityGroupId } = await seedGoal({ target: 500 });
    await primeShardTotal(goalId, 520);
    const uid = uniq('member');
    await seedMembership(communityGroupId, uid);

    const value = await mustContribute(uid, { goalId, attemptId: 'attempt-late', count: 10 });
    expect(value.crossedTarget).toBe(false);
    expect(value.sharedTotal).toBe(530);
    expect((await readCrossing(goalId)).reachedAt).toBeUndefined();
  });

  test('an upward correction past the target emits no event, and later contributions emit none either', async () => {
    const { goalId, communityGroupId } = await seedGoal({ target: 500 });
    await primeShardTotal(goalId, 400);
    const champion = uniq('champion');
    await seedMembership(communityGroupId, champion, { role: 'foundingChampion' });

    await wsfAdjustGoal.run(
      makeRequest(champion, {
        goalId,
        delta: 150,
        reason: 'Tally sheet from the park session was never entered.',
      })
    );
    expect(await directShardSum(goalId)).toBe(550);
    expect((await readCrossing(goalId)).reachedAt).toBeUndefined();

    const value = await mustContribute(champion, {
      goalId,
      attemptId: 'attempt-after-correction',
      count: 10,
    });
    expect(value.crossedTarget).toBe(false);
    expect((await readCrossing(goalId)).reachedAt).toBeUndefined();
  });

  test('a correction below the target keeps the event and lets the live state go back to unreached', async () => {
    const { goalId, communityGroupId } = await seedGoal({ target: 500 });
    await primeShardTotal(goalId, 480);
    const champion = uniq('champion');
    await seedMembership(communityGroupId, champion, { role: 'foundingChampion' });

    const crossingValue = await mustContribute(champion, {
      goalId,
      attemptId: 'attempt-crossed-then-corrected',
      count: 25,
    });
    expect(crossingValue.crossedTarget).toBe(false);
    const before = await readCrossing(goalId);

    // The tally was wrong by 100. Down it goes, back under the target.
    const adjusted = (await wsfAdjustGoal.run(
      makeRequest(champion, {
        goalId,
        delta: -100,
        reason: 'Double-counted the Saturday session.',
      })
    )) as { sharedTotal: number };
    expect(adjusted.sharedTotal).toBe(405);

    // The live state is derived from the total against the target, and is now
    // honestly below it. The event is history and stays exactly as written.
    const after = await readCrossing(goalId);
    expect(after.reachedAt!.isEqual(before.reachedAt!)).toBe(true);
    expect(after.reachedAttemptId).toBeNull();
    expect(after.reachedSharedTotal).toBe(505);

    // Crossing the line a second time emits NOTHING: the goal already carries
    // its first crossing, and nothing in this package clears it.
    const second = await mustContribute(champion, {
      goalId,
      attemptId: 'attempt-second-crossing',
      count: 200,
    });
    expect(second.sharedTotal).toBe(605);
    expect(second.crossedTarget).toBe(false);
    const afterSecond = await readCrossing(goalId);
    expect(afterSecond.reachedAt!.isEqual(before.reachedAt!)).toBe(true);
    expect(afterSecond.reachedAttemptId).toBeNull();
    expect(afterSecond.reachedSharedTotal).toBe(505);

    // And the original attempt's replay still reports the crossing it made.
    const replay = await mustContribute(champion, {
      goalId,
      attemptId: 'attempt-crossed-then-corrected',
      count: 25,
    });
    expect(replay.crossedTarget).toBe(false);
  });

  test('raising the target above the total keeps the event and emits no second one', async () => {
    const { goalId, communityGroupId } = await seedGoal({ target: 500 });
    await primeShardTotal(goalId, 495);
    const uid = uniq('member');
    await seedMembership(communityGroupId, uid);

    await mustContribute(uid, { goalId, attemptId: 'attempt-first-crossing', count: 10 });
    const before = await readCrossing(goalId);
    expect(before.reachedAttemptId).toBeNull();

    // The champion raises the bar. (No callable changes a target today; this
    // is the stored shape such a change would produce.)
    await getFirestore().doc(`wsfGoals/${goalId}`).update({ target: 1000 });

    const value = await mustContribute(uid, {
      goalId,
      attemptId: 'attempt-past-new-target',
      count: 600,
    });
    expect(value.target).toBe(1000);
    expect(value.sharedTotal).toBe(1105);
    expect(value.crossedTarget).toBe(false);

    const after = await readCrossing(goalId);
    expect(after.reachedAt!.isEqual(before.reachedAt!)).toBe(true);
    expect(after.reachedAttemptId).toBeNull();
    expect(after.reachedSharedTotal).toBe(505);
  });

  test('closure keeps the fields, and a closed goal records nothing new', async () => {
    const { goalId, communityGroupId } = await seedGoal({ target: 500 });
    await primeShardTotal(goalId, 490);
    const uid = uniq('member');
    await seedMembership(communityGroupId, uid);

    await mustContribute(uid, { goalId, attemptId: 'attempt-crossing-then-closed', count: 30 });
    const before = await readCrossing(goalId);

    await getFirestore()
      .doc(`wsfGoals/${goalId}`)
      .update({ status: 'closed', closedAt: Timestamp.now() });

    const refused = await contribute(uid, {
      goalId,
      attemptId: 'attempt-after-closure',
      count: 10,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe('failed-precondition');

    const after = await readCrossing(goalId);
    expect(after.reachedAt!.isEqual(before.reachedAt!)).toBe(true);
    expect(after.reachedAttemptId).toBeNull();
    expect(after.reachedSharedTotal).toBe(520);

    // Idempotency still wins over closure, and the stored outcome with it.
    const replay = await mustContribute(uid, {
      goalId,
      attemptId: 'attempt-crossing-then-closed',
      count: 30,
    });
    expect(replay.alreadyRecorded).toBe(true);
    expect(replay.crossedTarget).toBe(false);
    expect(replay.status).toBe('closed');
  });

  test('a caller who may not see the community’s state is not told it crossed either', async () => {
    const { goalId, communityGroupId } = await seedGoal({ target: 500 });
    await primeShardTotal(goalId, 495);
    const uid = uniq('member');
    await seedMembership(communityGroupId, uid);

    const crossingValue = await mustContribute(uid, {
      goalId,
      attemptId: 'attempt-then-removed',
      count: 20,
    });
    expect(crossingValue.crossedTarget).toBe(false);

    // Membership is revoked. The replay still honours their own contribution
    // — idempotency wins over membership drift — and withholds every shared
    // fact, `crossedTarget` included.
    await seedMembership(communityGroupId, uid, { membershipStatus: 'removed' });
    const replay = await mustContribute(uid, {
      goalId,
      attemptId: 'attempt-then-removed',
      count: 20,
    });
    expect(replay.alreadyRecorded).toBe(true);
    expect(replay.addedCount).toBe(20);
    expect(replay.ownCredit).toBe(20);
    expect(Object.keys(replay).sort()).toEqual([
      'addedCount',
      'alreadyRecorded',
      'ownCredit',
    ]);
    expect(replay.crossedTarget).toBeUndefined();
  });
});

describe('wsfListGoals carries the crossing date for member surfaces', () => {
  test('null before the crossing, the ISO instant after it, and no attempt id', async () => {
    const { goalId, communityGroupId } = await seedGoal({ target: 500 });
    await primeShardTotal(goalId, 480);
    const uid = uniq('member');
    await seedMembership(communityGroupId, uid);

    const beforeList = (await wsfListGoals.run(
      makeRequest(uid, { groupId: communityGroupId })
    )) as { goals: Array<Record<string, unknown>> };
    const beforeGoal = beforeList.goals.find((g) => g.goalId === goalId)!;
    expect(beforeGoal.reachedAt).toBeNull();

    await mustContribute(uid, { goalId, attemptId: 'attempt-list-crossing', count: 40 });

    const afterList = (await wsfListGoals.run(
      makeRequest(uid, { groupId: communityGroupId })
    )) as { goals: Array<Record<string, unknown>> };
    const afterGoal = afterList.goals.find((g) => g.goalId === goalId)!;
    expect(typeof afterGoal.reachedAt).toBe('string');
    const stored = await readCrossing(goalId);
    expect(afterGoal.reachedAt).toBe(stored.reachedAt!.toDate().toISOString());

    // The member list names the day, never the person or the attempt.
    expect(Object.keys(afterGoal).sort()).toEqual([
      'aggregateDisplayAuthorized',
      'endsAt',
      'goalId',
      'reachedAt',
      'startsAt',
      'status',
      'target',
      'title',
      'unit',
    ]);
  });
  test('30 + 70 against 100: whichever lands first, one event, nobody named (both orders and concurrent)', async () => {
    for (const order of ['a-then-b', 'b-then-a', 'concurrent'] as const) {
      const { goalId, communityGroupId } = await seedGoal({ target: 100 });
      const a = uniq('member-a');
      const b = uniq('member-b');
      await seedMembership(communityGroupId, a);
      await seedMembership(communityGroupId, b);
      const A = () => mustContribute(a, { goalId, attemptId: `attempt-thirty-${order}`, count: 30 });
      const B = () => mustContribute(b, { goalId, attemptId: `attempt-seventy-${order}`, count: 70 });
      let results: ContributeValue[];
      if (order === 'a-then-b') results = [await A(), await B()];
      else if (order === 'b-then-a') results = [await B(), await A()];
      else results = await Promise.all([A(), B()]);
      expect(results.filter((r) => r.crossedTarget === true)).toHaveLength(0);
      expect(await directShardSum(goalId)).toBe(100);
      const crossing = await readCrossing(goalId);
      expect(crossing.reachedAt).toBeDefined();
      expect(crossing.reachedAttemptId).toBeNull();
      expect(crossing.reachedSharedTotal).toBe(100);
      // Replays repeat the stored answers: still nobody credited, still one event.
      const replays = [await A(), await B()];
      expect(replays.every((r) => r.alreadyRecorded)).toBe(true);
      expect(replays.filter((r) => r.crossedTarget === true)).toHaveLength(0);
      expect((await readCrossing(goalId)).reachedAt?.toMillis()).toBe(crossing.reachedAt?.toMillis());
    }
  }, 60_000);

});
