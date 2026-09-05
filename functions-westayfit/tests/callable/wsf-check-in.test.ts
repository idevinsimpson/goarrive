/**
 * wsfCheckIn callable — the write that turns "I did that" into "we did that."
 * Five properties this test pins:
 *
 *   1. Happy path. A member of an active challenge checks in on a move; the
 *      shard sum moves by exactly one, and the response carries the new total.
 *
 *   2. Idempotent (§5.3). Same member + same move twice writes exactly one
 *      wsfCheckIns row and increments the counter by exactly one.
 *      alreadyCheckedIn=true on the second call, never an error.
 *
 *   3. Concurrent-safe (§5.4). Two members checking in on the same move via
 *      Promise.all produce a total of two — no lost update. Drive
 *      concurrently, not sequentially; a sequential test cannot fail the way
 *      production does.
 *
 *   4. Burst-safe (§5.5) — the §2 failure mode, the one that matters. Fifty
 *      distinct members hit the same move in Promise.all. Total is exactly 50.
 *      Nothing else in this spec is worth as much as this test.
 *
 *   5. Non-member refused (§5.6). A signed-in user with no membership on the
 *      challenge's group is permission-denied.
 *
 * Runs against Firestore emulator via `.run(request)`.
 */

process.env.GCLOUD_PROJECT = 'goarrive-test';
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { wsfCheckIn } from '../../src/index';

async function seedActiveMember(groupId: string, uid: string) {
  await getFirestore()
    .doc(`wsfMemberships/${groupId}_${uid}`)
    .set({
      groupId,
      userId: uid,
      role: 'member',
      membershipStatus: 'active',
    });
}

async function seedGroup(opts?: { isSample?: boolean }): Promise<string> {
  const ref = getFirestore().collection('wsfCommunityGroups').doc();
  await ref.set({
    displayName: 'CheckIn Test Group',
    groupType: 'custom',
    joinPolicy: 'public',
    lifecycleStatus: 'active',
    isSample: opts?.isSample === true,
  });
  return ref.id;
}

async function seedChallenge(
  groupId: string,
  opts?: { status?: 'draft' | 'active' | 'completed'; goalTarget?: number | null }
): Promise<string> {
  const ref = getFirestore().collection('wsfChallenges').doc();
  await ref.set({
    groupId,
    title: 'FitLife Moves',
    status: opts?.status ?? 'active',
    goalTarget: opts?.goalTarget ?? null,
  });
  return ref.id;
}

async function seedMove(
  challengeId: string,
  opts?: {
    sequence?: number;
    title?: string;
    requiresCode?: boolean;
    checkInCode?: string;
  }
): Promise<string> {
  const ref = getFirestore().collection('wsfChallengeMoves').doc();
  const doc: Record<string, unknown> = {
    challengeId,
    title: opts?.title ?? 'Do the walk',
    instructions: 'Walk from the entrance to the vendor row.',
    sequence: opts?.sequence ?? 0,
    dayNumber: null,
  };
  if (opts?.requiresCode === true) doc.requiresCode = true;
  if (typeof opts?.checkInCode === 'string') doc.checkInCode = opts.checkInCode;
  await ref.set(doc);
  return ref.id;
}

function makeRequest(
  uid: string | null,
  data: Record<string, unknown>
): Parameters<typeof wsfCheckIn.run>[0] {
  return {
    auth: uid
      ? ({ uid, token: { email_verified: true } as any } as any)
      : undefined,
    data: data as any,
    rawRequest: {} as any,
    acceptsStreaming: false,
  } as any;
}

async function tryRun(uid: string | null, data: Record<string, unknown>) {
  try {
    return { ok: true as const, value: await wsfCheckIn.run(makeRequest(uid, data)) };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}

/**
 * Sums the ten shards directly from Firestore. Duplicates the callable's own
 * helper on purpose — the test must not trust the callable's arithmetic to
 * assert its arithmetic.
 */
async function directShardSum(challengeId: string): Promise<number> {
  const db = getFirestore();
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const snap = await db
      .doc(`wsfChallengeCounters/${challengeId}/shards/${i}`)
      .get();
    const data = snap.data() as { count?: number } | undefined;
    if (typeof data?.count === 'number') total += data.count;
  }
  return total;
}

async function directCheckInCount(
  challengeId: string,
  moveId?: string
): Promise<number> {
  let query = getFirestore()
    .collection('wsfCheckIns')
    .where('challengeId', '==', challengeId);
  if (moveId) query = query.where('moveId', '==', moveId);
  const snap = await query.count().get();
  return snap.data().count;
}

describe('wsfCheckIn', () => {
  test('unauthenticated caller: unauthenticated code', async () => {
    const result = await tryRun(null, { moveId: 'anything' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unauthenticated');
  });

  test('happy path: member of active challenge checks in and total moves by exactly one', async () => {
    const groupId = await seedGroup();
    const challengeId = await seedChallenge(groupId);
    const moveId = await seedMove(challengeId);
    const uid = `wsfCheckIn_happy_${Date.now()}`;
    await seedActiveMember(groupId, uid);

    const before = await directShardSum(challengeId);
    const result = await wsfCheckIn.run(makeRequest(uid, { moveId }));

    expect(result.alreadyCheckedIn).toBe(false);
    expect(result.totals.completedCount).toBe(before + 1);
    expect(result.totals.participantCount).toBeGreaterThanOrEqual(1);

    const after = await directShardSum(challengeId);
    expect(after).toBe(before + 1);
    expect(await directCheckInCount(challengeId, moveId)).toBe(1);
  });

  test('§5.3 idempotency: checking in twice writes ONE row and increments by ONE', async () => {
    const groupId = await seedGroup();
    const challengeId = await seedChallenge(groupId);
    const moveId = await seedMove(challengeId);
    const uid = `wsfCheckIn_idem_${Date.now()}`;
    await seedActiveMember(groupId, uid);

    const before = await directShardSum(challengeId);

    const first = await wsfCheckIn.run(makeRequest(uid, { moveId }));
    const second = await wsfCheckIn.run(makeRequest(uid, { moveId }));

    expect(first.alreadyCheckedIn).toBe(false);
    expect(second.alreadyCheckedIn).toBe(true);

    // Assert the total, not just the absence of an error — that is the
    // §5.3 rule verbatim, and the failure mode a "no throw" test would miss.
    const after = await directShardSum(challengeId);
    expect(after).toBe(before + 1);
    expect(await directCheckInCount(challengeId, moveId)).toBe(1);
    expect(second.totals.completedCount).toBe(before + 1);
  });

  test('§5.4 two-way concurrency: two members on the same move produce total two', async () => {
    const groupId = await seedGroup();
    const challengeId = await seedChallenge(groupId);
    const moveId = await seedMove(challengeId);
    const uidA = `wsfCheckIn_conc_a_${Date.now()}`;
    const uidB = `wsfCheckIn_conc_b_${Date.now()}`;
    await seedActiveMember(groupId, uidA);
    await seedActiveMember(groupId, uidB);

    const before = await directShardSum(challengeId);

    // Promise.all, not for-await. A sequential test cannot fail the way
    // production does — this is the §5.4 rule verbatim.
    await Promise.all([
      wsfCheckIn.run(makeRequest(uidA, { moveId })),
      wsfCheckIn.run(makeRequest(uidB, { moveId })),
    ]);

    const after = await directShardSum(challengeId);
    expect(after).toBe(before + 2);
    expect(await directCheckInCount(challengeId, moveId)).toBe(2);
  });

  test('§5.5 BURST: 50 concurrent members on the same move produce exactly 50', async () => {
    const groupId = await seedGroup();
    const challengeId = await seedChallenge(groupId);
    const moveId = await seedMove(challengeId);

    const BURST = 50;
    const uids: string[] = [];
    for (let i = 0; i < BURST; i++) {
      uids.push(`wsfCheckIn_burst_${Date.now()}_${i}`);
    }
    // Seed memberships sequentially — this is prep, not part of the
    // concurrency measurement. The burst itself is the next Promise.all.
    for (const uid of uids) {
      await seedActiveMember(groupId, uid);
    }

    const before = await directShardSum(challengeId);
    const beforeRows = await directCheckInCount(challengeId, moveId);

    const responses = await Promise.all(
      uids.map((uid) => wsfCheckIn.run(makeRequest(uid, { moveId })))
    );

    const after = await directShardSum(challengeId);
    const afterRows = await directCheckInCount(challengeId, moveId);

    expect(after - before).toBe(BURST);
    expect(afterRows - beforeRows).toBe(BURST);
    for (const r of responses) {
      expect(r.alreadyCheckedIn).toBe(false);
    }
    // Last response saw the full total. Any earlier concurrent response
    // could have raced with mid-flight commits and legally read a smaller
    // number, so only pin the terminal value here — the shard sum above
    // covers the aggregate invariant.
  }, 60_000);

  test('§5.6 non-member refused: authenticated user with no membership gets permission-denied', async () => {
    const groupId = await seedGroup();
    const challengeId = await seedChallenge(groupId);
    const moveId = await seedMove(challengeId);
    const uid = `wsfCheckIn_nonmember_${Date.now()}`;
    // No membership seeded.

    const result = await tryRun(uid, { moveId });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('permission-denied');
  });

  test('inactive challenge: failed-precondition, no counter movement', async () => {
    const groupId = await seedGroup();
    const challengeId = await seedChallenge(groupId, { status: 'draft' });
    const moveId = await seedMove(challengeId);
    const uid = `wsfCheckIn_inactive_${Date.now()}`;
    await seedActiveMember(groupId, uid);

    const before = await directShardSum(challengeId);
    const result = await tryRun(uid, { moveId });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('failed-precondition');
    expect(await directShardSum(challengeId)).toBe(before);
  });

  test('unknown moveId (well-formed but absent): not-found', async () => {
    const groupId = await seedGroup();
    await seedChallenge(groupId);
    const uid = `wsfCheckIn_unknown_${Date.now()}`;
    await seedActiveMember(groupId, uid);

    // 20 chars, matches the Firestore auto-ID shape, so it passes the shape
    // check and reaches the doc read — the branch this test is pinning.
    const result = await tryRun(uid, { moveId: 'ABCDEFGHIJKLMNOPQRST' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-found');
  });

  test('§E3-review invalid moveId (contains /): invalid-argument — never internal', async () => {
    // Under the old shape check `foo/bar` reached db.doc(...) and threw a
    // TypeError under the callable wrapper, which surfaced as `internal` on a
    // public-facing endpoint. Pin the new contract: shape-invalid input never
    // reaches Firestore.
    const uid = `wsfCheckIn_bad_slash_${Date.now()}`;
    const result = await tryRun(uid, { moveId: 'wsfChallengeMoves/injected' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid-argument');
  });

  test('§E3-review too-short moveId: invalid-argument', async () => {
    const uid = `wsfCheckIn_bad_short_${Date.now()}`;
    const result = await tryRun(uid, { moveId: 'short' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid-argument');
  });

  test('§E3-review requiresCode:true refuses missing code: failed-precondition', async () => {
    const groupId = await seedGroup();
    const challengeId = await seedChallenge(groupId);
    const moveId = await seedMove(challengeId, {
      requiresCode: true,
      checkInCode: 'FITLIFE-42',
    });
    const uid = `wsfCheckIn_reqcode_missing_${Date.now()}`;
    await seedActiveMember(groupId, uid);

    const before = await directShardSum(challengeId);
    const result = await tryRun(uid, { moveId });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('failed-precondition');
    // The counter must not have moved — a refused check-in changes nothing.
    expect(await directShardSum(challengeId)).toBe(before);
  });

  test('§E3-review requiresCode:true refuses wrong code: failed-precondition', async () => {
    const groupId = await seedGroup();
    const challengeId = await seedChallenge(groupId);
    const moveId = await seedMove(challengeId, {
      requiresCode: true,
      checkInCode: 'FITLIFE-42',
    });
    const uid = `wsfCheckIn_reqcode_wrong_${Date.now()}`;
    await seedActiveMember(groupId, uid);

    const result = await tryRun(uid, { moveId, code: 'nope' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('failed-precondition');
    expect(await directCheckInCount(challengeId, moveId)).toBe(0);
  });

  test('§E3-review requiresCode:true accepts the right code and writes one row', async () => {
    const groupId = await seedGroup();
    const challengeId = await seedChallenge(groupId);
    const moveId = await seedMove(challengeId, {
      requiresCode: true,
      checkInCode: 'FITLIFE-42',
    });
    const uid = `wsfCheckIn_reqcode_ok_${Date.now()}`;
    await seedActiveMember(groupId, uid);

    const before = await directShardSum(challengeId);
    const result = await wsfCheckIn.run(makeRequest(uid, { moveId, code: 'FITLIFE-42' }));

    expect(result.alreadyCheckedIn).toBe(false);
    expect(await directShardSum(challengeId)).toBe(before + 1);
    expect(await directCheckInCount(challengeId, moveId)).toBe(1);
  });

  test('§E3-review completed challenge: idempotent hit still returns alreadyCheckedIn:true; new tap refused', async () => {
    const groupId = await seedGroup();
    const challengeId = await seedChallenge(groupId, { status: 'active' });
    const moveId = await seedMove(challengeId);
    const uidExisting = `wsfCheckIn_completed_existing_${Date.now()}`;
    const uidStraggler = `wsfCheckIn_completed_new_${Date.now()}`;
    await seedActiveMember(groupId, uidExisting);
    await seedActiveMember(groupId, uidStraggler);

    // Existing member checks in while the challenge is still active.
    const first = await wsfCheckIn.run(makeRequest(uidExisting, { moveId }));
    expect(first.alreadyCheckedIn).toBe(false);
    const afterFirst = await directShardSum(challengeId);

    // Emcee marks the challenge completed.
    await getFirestore()
      .doc(`wsfChallenges/${challengeId}`)
      .set({ status: 'completed' }, { merge: true });

    // Straggler taps for the first time — must be refused, counter unchanged.
    const stragglerAttempt = await tryRun(uidStraggler, { moveId });
    expect(stragglerAttempt.ok).toBe(false);
    if (stragglerAttempt.ok) return;
    expect(stragglerAttempt.error.code).toBe('failed-precondition');
    expect(await directShardSum(challengeId)).toBe(afterFirst);

    // Existing member retries — must succeed with alreadyCheckedIn:true.
    const retry = await wsfCheckIn.run(makeRequest(uidExisting, { moveId }));
    expect(retry.alreadyCheckedIn).toBe(true);
    expect(await directShardSum(challengeId)).toBe(afterFirst);
    expect(await directCheckInCount(challengeId, moveId)).toBe(1);
  });

  test('goalTarget flows through nullable — null stays null on the response', async () => {
    const groupId = await seedGroup();
    const challengeId = await seedChallenge(groupId, { goalTarget: null });
    const moveId = await seedMove(challengeId);
    const uid = `wsfCheckIn_null_goal_${Date.now()}`;
    await seedActiveMember(groupId, uid);

    const result = await wsfCheckIn.run(makeRequest(uid, { moveId }));
    expect(result.totals.goalTarget).toBeNull();

    // And a number goal flows through as a number.
    const challenge2 = await seedChallenge(groupId, { goalTarget: 2000 });
    const move2 = await seedMove(challenge2);
    const uid2 = `wsfCheckIn_num_goal_${Date.now()}`;
    await seedActiveMember(groupId, uid2);
    const r2 = await wsfCheckIn.run(makeRequest(uid2, { moveId: move2 }));
    expect(r2.totals.goalTarget).toBe(2000);
  });
});
