/**
 * wsfContribute — quantitative shared-total accumulation. Pins the E4-A1
 * acceptance proofs from Devin plus the E4-A1-R1 correction package:
 *
 *   3700 + 20 = 3720
 *   concurrent +30 / +20 -> shared 3750, own-credit 20 for the +20 caller
 *   double-submit (same attemptId) counts once
 *   4999 / 5000 stays 4999 (no phantom rounding to 100%)
 *   4980 + 35 = 5015 (overshoot preserved)
 *   closed goal rejects (failed-precondition)
 *   new-goal isolation (parallel goals do not bleed)
 *   unit isolation (goals with different units keep separate counters)
 *
 * R1 additions (2026-09-12):
 *   nonmember rejection (permission-denied, "Members only.")
 *   wrong-group isolation (caller in group X can't contribute to goal in Y)
 *   before-window rejection (failed-precondition)
 *   after-window rejection (failed-precondition)
 *   exact replay after the window closes (idempotent-first discipline)
 *
 * R4 additions (2026-09-12): attempt identity is goal + authenticated uid +
 * attemptId — same member + same attemptId counts once and replays the
 * original receipt; different members with the same attemptId each count
 * once; own credit is durable across closure and authorized correction.
 *
 * Runs against the local Firestore emulator via `func.run(request)`. No live
 * project, no rules edit, no client SDK — Admin SDK writes only.
 */

process.env.METADATA_SERVER_DETECTION =
  process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { wsfAdjustGoal, wsfContribute, wsfMyContribution } from '../../src/index';

type Data = Record<string, unknown>;

function makeRequest(
  uid: string | null,
  data: Data
): Parameters<typeof wsfContribute.run>[0] {
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
      value: await wsfContribute.run(makeRequest(uid, data)),
    };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}

/**
 * Seed a wsfMemberships doc keyed on `{groupId}_{uid}`. Defaults to an
 * `active` `foundingChampion` because most tests care about the "authorized
 * community member" path — non-default statuses/roles are opt-in.
 */
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

/**
 * Seed a wsfGoals doc with the full production shape (communityGroupId +
 * startsAt/endsAt/timezone). Returns both the goalId and the
 * communityGroupId so the caller can seed matching memberships.
 *
 * Default window is "open right now for the next hour." Individual tests
 * override startsAt/endsAt for before/after-window assertions.
 */
async function seedGoal(opts?: {
  target?: number;
  unit?: string;
  status?: 'active' | 'closed';
  ownerUid?: string;
  communityGroupId?: string;
  startsAt?: Date;
  endsAt?: Date;
  timezone?: string;
}): Promise<{ goalId: string; communityGroupId: string }> {
  const communityGroupId = opts?.communityGroupId ?? uniq('grp');
  const now = new Date();
  const startsAt = opts?.startsAt ?? new Date(now.getTime() - 60_000);
  const endsAt = opts?.endsAt ?? new Date(now.getTime() + 60 * 60_000);

  const ref = getFirestore().collection('wsfGoals').doc();
  await ref.set({
    ownerUid: opts?.ownerUid ?? 'wsfSeedOwner',
    communityGroupId,
    title: 'E4-A1 test goal',
    target: opts?.target ?? 5000,
    unit: opts?.unit ?? 'squats',
    status: opts?.status ?? 'active',
    startsAt: Timestamp.fromDate(startsAt),
    endsAt: Timestamp.fromDate(endsAt),
    timezone: opts?.timezone ?? 'America/New_York',
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

async function directContributionCount(goalId: string): Promise<number> {
  const snap = await getFirestore()
    .collection('wsfContributions')
    .where('goalId', '==', goalId)
    .count()
    .get();
  return snap.data().count;
}

function uniq(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

describe('wsfContribute', () => {
  beforeAll(async () => {
    await getFirestore()
      .doc('_warmup/wsf-contribute')
      .set({ at: Date.now() });
  }, 30_000);

  test('unauthenticated: unauthenticated code', async () => {
    const result = await tryRun(null, {
      goalId: 'anything',
      attemptId: 'attempt1234',
      count: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unauthenticated');
  });

  test('invalid-argument: missing count', async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const uid = uniq('user');
    await seedMembership(communityGroupId, uid);
    const result = await tryRun(uid, {
      goalId,
      attemptId: 'attempt1234',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid-argument');
  });

  test('invalid-argument: non-integer count', async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const uid = uniq('user');
    await seedMembership(communityGroupId, uid);
    const result = await tryRun(uid, {
      goalId,
      attemptId: 'attempt1234',
      count: 1.5,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid-argument');
  });

  test('not-found: unknown goalId', async () => {
    const result = await tryRun(uniq('user'), {
      goalId: 'nonexistent',
      attemptId: 'attempt1234',
      count: 10,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-found');
  });

  test('permission-denied: caller has no membership in the goal community', async () => {
    const { goalId } = await seedGoal();
    // No seedMembership — caller is authenticated but not a member.
    const result = await tryRun(uniq('outsider'), {
      goalId,
      attemptId: 'attempt-outsider',
      count: 5,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('permission-denied');
    expect(await directShardSum(goalId)).toBe(0);
    expect(await directContributionCount(goalId)).toBe(0);
  });

  test('permission-denied: wrong-group isolation (member of X can not contribute to a goal in Y)', async () => {
    const { goalId } = await seedGoal(); // creates its own communityGroupId Y
    const uid = uniq('wrongGroup');
    // Caller has an active membership — but in a DIFFERENT community.
    await seedMembership(uniq('otherGroup'), uid);
    const result = await tryRun(uid, {
      goalId,
      attemptId: 'attempt-wrong-group',
      count: 5,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('permission-denied');
    expect(await directShardSum(goalId)).toBe(0);
    expect(await directContributionCount(goalId)).toBe(0);
  });

  test('permission-denied: inactive membership rejected', async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const uid = uniq('inactive');
    await seedMembership(communityGroupId, uid, {
      membershipStatus: 'left',
    });
    const result = await tryRun(uid, {
      goalId,
      attemptId: 'attempt-inactive',
      count: 5,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('permission-denied');
  });

  test('failed-precondition: contribution before startsAt is rejected', async () => {
    const now = new Date();
    const { goalId, communityGroupId } = await seedGoal({
      startsAt: new Date(now.getTime() + 60 * 60_000), // 1h from now
      endsAt: new Date(now.getTime() + 2 * 60 * 60_000),
    });
    const uid = uniq('early');
    await seedMembership(communityGroupId, uid);
    const result = await tryRun(uid, {
      goalId,
      attemptId: 'attempt-early',
      count: 5,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('failed-precondition');
    expect(await directShardSum(goalId)).toBe(0);
  });

  test('failed-precondition: contribution after endsAt is rejected', async () => {
    const now = new Date();
    const { goalId, communityGroupId } = await seedGoal({
      startsAt: new Date(now.getTime() - 2 * 60 * 60_000),
      endsAt: new Date(now.getTime() - 60 * 60_000), // 1h ago
    });
    const uid = uniq('late');
    await seedMembership(communityGroupId, uid);
    const result = await tryRun(uid, {
      goalId,
      attemptId: 'attempt-late',
      count: 5,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('failed-precondition');
    expect(await directShardSum(goalId)).toBe(0);
  });

  test('idempotent replay AFTER endsAt: recorded attempt returns original body', async () => {
    // Contribute inside the window, then slide the window's end into the
    // past and replay the same attemptId. The replay must return the same
    // body (alreadyRecorded:true) — spec §5.3 "you did the reps."
    const { goalId, communityGroupId } = await seedGoal();
    const uid = uniq('replayPastWindow');
    await seedMembership(communityGroupId, uid);
    const attemptId = 'attempt-replay-past-window';

    const first = await wsfContribute.run(
      makeRequest(uid, { goalId, attemptId, count: 12 })
    );
    expect(first.alreadyRecorded).toBe(false);
    expect(first.addedCount).toBe(12);

    // Slide the endsAt into the past.
    await getFirestore()
      .doc(`wsfGoals/${goalId}`)
      .set(
        { endsAt: Timestamp.fromDate(new Date(Date.now() - 60_000)) },
        { merge: true }
      );

    const replay = await wsfContribute.run(
      makeRequest(uid, { goalId, attemptId, count: 12 })
    );
    expect(replay.alreadyRecorded).toBe(true);
    expect(replay.addedCount).toBe(12);
    expect(replay.sharedTotal).toBe(first.sharedTotal);
  });

  test('3700 + 20 = 3720 (single contribution, primed baseline)', async () => {
    const { goalId, communityGroupId } = await seedGoal({ target: 5000 });
    await primeShardTotal(goalId, 3700);
    expect(await directShardSum(goalId)).toBe(3700);

    const uid = uniq('happy');
    await seedMembership(communityGroupId, uid);
    const result = await wsfContribute.run(
      makeRequest(uid, {
        goalId,
        attemptId: 'attempt-3700-20',
        count: 20,
      })
    );

    expect(result.alreadyRecorded).toBe(false);
    expect(result.addedCount).toBe(20);
    expect(result.ownCredit).toBe(20);
    expect(result.sharedTotal).toBe(3720);
    expect(result.target).toBe(5000);
    expect(result.unit).toBe('squats');
    expect(result.status).toBe('active');
    expect(await directShardSum(goalId)).toBe(3720);
    expect(await directContributionCount(goalId)).toBe(1);
  });

  test('double-submit (same attemptId) counts once and returns the original body', async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const uid = uniq('idem');
    await seedMembership(communityGroupId, uid);
    const attemptId = 'attempt-idempotent-777';

    const first = await wsfContribute.run(
      makeRequest(uid, { goalId, attemptId, count: 25 })
    );
    const second = await wsfContribute.run(
      makeRequest(uid, { goalId, attemptId, count: 999 }) // count ignored on replay
    );

    expect(first.alreadyRecorded).toBe(false);
    expect(first.addedCount).toBe(25);
    expect(second.alreadyRecorded).toBe(true);
    expect(second.addedCount).toBe(25);
    expect(second.sharedTotal).toBe(first.sharedTotal);
    expect(second.ownCredit).toBe(25);
    expect(await directShardSum(goalId)).toBe(25);
    expect(await directContributionCount(goalId)).toBe(1);
  });

  test('concurrent +30 / +20 from two members: shared 50, own-credit isolated', async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const alice = uniq('alice');
    const bob = uniq('bob');
    await Promise.all([
      seedMembership(communityGroupId, alice),
      seedMembership(communityGroupId, bob),
    ]);

    const [aliceResult, bobResult] = await Promise.all([
      wsfContribute.run(
        makeRequest(alice, {
          goalId,
          attemptId: 'attempt-conc-alice',
          count: 30,
        })
      ),
      wsfContribute.run(
        makeRequest(bob, {
          goalId,
          attemptId: 'attempt-conc-bob',
          count: 20,
        })
      ),
    ]);

    expect(aliceResult.addedCount).toBe(30);
    expect(bobResult.addedCount).toBe(20);
    expect(aliceResult.ownCredit).toBe(30);
    expect(bobResult.ownCredit).toBe(20);
    expect(await directShardSum(goalId)).toBe(50);
    expect(await directContributionCount(goalId)).toBe(2);
  });

  test('concurrent +30 / +20 primed to 3700 -> 3750 shared, own credit 20 for +20 caller', async () => {
    const { goalId, communityGroupId } = await seedGoal();
    await primeShardTotal(goalId, 3700);
    const alice = uniq('alicePrime');
    const bob = uniq('bobPrime');
    await Promise.all([
      seedMembership(communityGroupId, alice),
      seedMembership(communityGroupId, bob),
    ]);

    const [, bobResult] = await Promise.all([
      wsfContribute.run(
        makeRequest(alice, {
          goalId,
          attemptId: 'attempt-primed-alice',
          count: 30,
        })
      ),
      wsfContribute.run(
        makeRequest(bob, {
          goalId,
          attemptId: 'attempt-primed-bob',
          count: 20,
        })
      ),
    ]);

    expect(bobResult.ownCredit).toBe(20);
    expect(await directShardSum(goalId)).toBe(3750);
  });

  test('4999 / 5000 sharedTotal stays 4999 (no phantom rounding to 100%)', async () => {
    const { goalId, communityGroupId } = await seedGoal({ target: 5000 });
    await primeShardTotal(goalId, 4998);
    const uid = uniq('near');
    await seedMembership(communityGroupId, uid);

    const result = await wsfContribute.run(
      makeRequest(uid, {
        goalId,
        attemptId: 'attempt-near-goal',
        count: 1,
      })
    );

    expect(result.sharedTotal).toBe(4999);
    expect(result.target).toBe(5000);
    // Integer division proof so downstream UI can't accidentally get 100.
    const percent = Math.floor((result.sharedTotal * 100) / result.target);
    expect(percent).toBe(99);
  });

  test('overshoot: 4980 + 35 = 5015 (aggregate unclamped)', async () => {
    const { goalId, communityGroupId } = await seedGoal({ target: 5000 });
    await primeShardTotal(goalId, 4980);
    const uid = uniq('over');
    await seedMembership(communityGroupId, uid);

    const result = await wsfContribute.run(
      makeRequest(uid, {
        goalId,
        attemptId: 'attempt-overshoot',
        count: 35,
      })
    );

    expect(result.sharedTotal).toBe(5015);
    expect(result.target).toBe(5000);
    expect(result.sharedTotal).toBeGreaterThan(result.target);
  });

  test('closed goal: failed-precondition', async () => {
    const { goalId, communityGroupId } = await seedGoal({ status: 'closed' });
    const uid = uniq('closed');
    await seedMembership(communityGroupId, uid);

    const result = await tryRun(uid, {
      goalId,
      attemptId: 'attempt-closed',
      count: 10,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('failed-precondition');
    expect(await directShardSum(goalId)).toBe(0);
    expect(await directContributionCount(goalId)).toBe(0);
  });

  test('idempotent replay against a goal that was closed after first tap: still returns the recorded body', async () => {
    const { goalId, communityGroupId } = await seedGoal({ status: 'active' });
    const uid = uniq('closeAfter');
    await seedMembership(communityGroupId, uid);
    const attemptId = 'attempt-close-after';

    const first = await wsfContribute.run(
      makeRequest(uid, { goalId, attemptId, count: 8 })
    );
    expect(first.alreadyRecorded).toBe(false);

    await getFirestore()
      .doc(`wsfGoals/${goalId}`)
      .set({ status: 'closed' }, { merge: true });

    const replay = await wsfContribute.run(
      makeRequest(uid, { goalId, attemptId, count: 8 })
    );
    expect(replay.alreadyRecorded).toBe(true);
    expect(replay.addedCount).toBe(8);
    expect(replay.status).toBe('closed');
  });

  test('new-goal isolation: contributing to A does not move B', async () => {
    const a = await seedGoal({ unit: 'squats' });
    const b = await seedGoal({ unit: 'squats' });
    const uid = uniq('isolate');
    await seedMembership(a.communityGroupId, uid);
    // NB: no membership in b — proves isolation on the "wrong-group" axis
    // as well as the "separate counters" axis.

    await wsfContribute.run(
      makeRequest(uid, {
        goalId: a.goalId,
        attemptId: 'attempt-isolate-A',
        count: 40,
      })
    );

    expect(await directShardSum(a.goalId)).toBe(40);
    expect(await directShardSum(b.goalId)).toBe(0);
  });

  test('unit isolation: two goals with different units keep separate counters and record the goal unit', async () => {
    const squats = await seedGoal({ unit: 'squats' });
    const minutes = await seedGoal({ unit: 'minutes' });
    const uid = uniq('units');
    await Promise.all([
      seedMembership(squats.communityGroupId, uid),
      seedMembership(minutes.communityGroupId, uid),
    ]);

    const sq = await wsfContribute.run(
      makeRequest(uid, {
        goalId: squats.goalId,
        attemptId: 'attempt-unit-squats',
        count: 12,
      })
    );
    const mi = await wsfContribute.run(
      makeRequest(uid, {
        goalId: minutes.goalId,
        attemptId: 'attempt-unit-minutes',
        count: 7,
      })
    );

    expect(sq.unit).toBe('squats');
    expect(mi.unit).toBe('minutes');
    expect(sq.sharedTotal).toBe(12);
    expect(mi.sharedTotal).toBe(7);

    const sqContribSnap = await getFirestore()
      .doc(`wsfContributions/${squats.goalId}_${uid}_attempt-unit-squats`)
      .get();
    expect(sqContribSnap.data()?.unit).toBe('squats');

    const miContribSnap = await getFirestore()
      .doc(`wsfContributions/${minutes.goalId}_${uid}_attempt-unit-minutes`)
      .get();
    expect(miContribSnap.data()?.unit).toBe('minutes');
  });

  test('same user, two distinct attemptIds: own-credit accumulates', async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const uid = uniq('accum');
    await seedMembership(communityGroupId, uid);

    const a = await wsfContribute.run(
      makeRequest(uid, { goalId, attemptId: 'attempt-accum-a', count: 10 })
    );
    const b = await wsfContribute.run(
      makeRequest(uid, { goalId, attemptId: 'attempt-accum-b', count: 15 })
    );

    expect(a.ownCredit).toBe(10);
    expect(b.ownCredit).toBe(25);
    expect(b.sharedTotal).toBe(25);
  });

  test('R4 exact-once scope: same member + same attemptId counts once; different members with the same attemptId each count once', async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const uidA = uniq('scopeA');
    const uidB = uniq('scopeB');
    await Promise.all([
      seedMembership(communityGroupId, uidA),
      seedMembership(communityGroupId, uidB),
    ]);

    const a1 = await wsfContribute.run(
      makeRequest(uidA, { goalId, attemptId: 'shared-attempt-x', count: 20 })
    );
    expect(a1.alreadyRecorded).toBe(false);
    expect(a1.ownCredit).toBe(20);

    // B independently supplies the very same attemptId: a distinct key, so
    // this is a valid NEW contribution, not a replay of A's.
    const b1 = await wsfContribute.run(
      makeRequest(uidB, { goalId, attemptId: 'shared-attempt-x', count: 99 })
    );
    expect(b1.alreadyRecorded).toBe(false);
    expect(b1.addedCount).toBe(99);
    expect(b1.ownCredit).toBe(99);
    expect(b1.sharedTotal).toBe(119);

    // A replays: original receipt, counted once, B's count never surfaces.
    const a2 = await wsfContribute.run(
      makeRequest(uidA, { goalId, attemptId: 'shared-attempt-x', count: 555 })
    );
    expect(a2.alreadyRecorded).toBe(true);
    expect(a2.addedCount).toBe(20);
    expect(a2.ownCredit).toBe(20);

    expect(await directShardSum(goalId)).toBe(119);
    expect(await directContributionCount(goalId)).toBe(2);
    const db = getFirestore();
    const [docA, docB] = await Promise.all([
      db.doc(`wsfContributions/${goalId}_${uidA}_shared-attempt-x`).get(),
      db.doc(`wsfContributions/${goalId}_${uidB}_shared-attempt-x`).get(),
    ]);
    expect(docA.exists && docA.data()?.userId).toBe(uidA);
    expect(docB.exists && docB.data()?.userId).toBe(uidB);
    const [totA, totB] = await Promise.all([
      db.doc(`wsfGoalMemberTotals/${goalId}_${uidA}`).get(),
      db.doc(`wsfGoalMemberTotals/${goalId}_${uidB}`).get(),
    ]);
    expect(totA.data()?.total).toBe(20);
    expect(totB.data()?.total).toBe(99);
  });

  test('R4 durability: own credit survives closure (wsfMyContribution reads the member total after status=closed)', async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const uid = uniq('durable');
    await seedMembership(communityGroupId, uid);
    await wsfContribute.run(
      makeRequest(uid, { goalId, attemptId: 'attempt-durable', count: 20 })
    );
    await getFirestore()
      .doc(`wsfGoals/${goalId}`)
      .set({ status: 'closed', closedAt: new Date() }, { merge: true });

    const mine = await wsfMyContribution.run(makeRequest(uid, { goalId }) as any);
    expect(mine).toEqual({ ownCredit: 20, unit: 'squats', repeatPolicy: 'multiple' });

    // New attempts are refused after closure; the recorded one replays.
    const late = await tryRun(uid, { goalId, attemptId: 'attempt-late', count: 1 });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error.code).toBe('failed-precondition');
    const replay = await wsfContribute.run(
      makeRequest(uid, { goalId, attemptId: 'attempt-durable', count: 20 })
    );
    expect(replay.alreadyRecorded).toBe(true);
  });

  test('R4 durability: own credit reflects an authorized downward correction', async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const uid = uniq('corrected');
    await seedMembership(communityGroupId, uid); // foundingChampion by default
    await wsfContribute.run(
      makeRequest(uid, { goalId, attemptId: 'attempt-corrected', count: 20 })
    );
    const adj = await wsfAdjustGoal.run(
      makeRequest(uid, {
        goalId,
        delta: -5,
        targetUid: uid,
        reason: 'E4-A1-R4 test: five counted twice',
      }) as any
    );
    expect(adj.sharedTotal).toBe(15);
    expect(adj.targetMemberTotal).toBe(15);
    const mine = await wsfMyContribution.run(makeRequest(uid, { goalId }) as any);
    expect(mine.ownCredit).toBe(15);
  });
});

/**
 * Overnight 2026-09-18, Task 3 (R2) — two calls with the SAME attemptId issued
 * CONCURRENTLY.
 *
 * The existing double-submit test runs them one after the other, so the
 * second read always sees a committed contribution. This is the harder shape
 * the client actually produces: a double tap, or a retry raced against the
 * original, where both transactions can read "no contribution yet" before
 * either commits. The contribution doc is keyed on goal + uid + attemptId, so
 * the two transactions contend on the same document and Firestore serializes
 * them — one records, the other replays. Neither caller may be told less than
 * the truth about their own effort.
 */
describe('wsfContribute — concurrent replay of one attempt', () => {
  test('two concurrent calls with the same attemptId count once and both report the caller’s own 25', async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const uid = uniq('r2ConcurrentSame');
    await seedMembership(communityGroupId, uid);
    const attemptId = 'attempt-r2-concurrent-same';

    const [first, second] = await Promise.all([
      wsfContribute.run(makeRequest(uid, { goalId, attemptId, count: 25 })),
      wsfContribute.run(makeRequest(uid, { goalId, attemptId, count: 25 })),
    ]);

    // One contribution, one increment — whichever of the two won the race.
    expect(await directShardSum(goalId)).toBe(25);
    expect(await directContributionCount(goalId)).toBe(1);

    // At most one of the two is a replay: the other is the call that recorded
    // it. Which one is not deterministic and is not asserted.
    const replays = [first.alreadyRecorded, second.alreadyRecorded].filter(Boolean).length;
    expect(replays).toBeLessThanOrEqual(1);

    // Both callers are the same member, and both are told the same truth
    // about their own effort: it was 25, and their credit on this goal is 25.
    expect(first.addedCount).toBe(25);
    expect(second.addedCount).toBe(25);
    expect(first.ownCredit).toBe(25);
    expect(second.ownCredit).toBe(25);

    // And the same shared state: the loser of the race writes nothing, so
    // neither response can carry a doubled total.
    expect(first.sharedTotal).toBe(25);
    expect(second.sharedTotal).toBe(25);
    expect(first.unit).toBe('squats');
    expect(second.status).toBe('active');
  }, 30_000);
});
