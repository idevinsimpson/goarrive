/**
 * Per-goal repeat policy — wsfCreateGoal validation, wsfContribute
 * enforcement, wsfAdjustGoal change, and what the member-authorized read
 * publishes.
 *
 * What is pinned here:
 *   creation accepts 'once' and 'multiple' and refuses anything else
 *   the resolution table: absent/null -> 'multiple' (what this server has
 *       always done, so no live goal changes behaviour), 'once' -> 'once',
 *       'multiple' -> 'multiple', an unrecognised literal -> 'once' (stricter)
 *   a goal wsfCreateGoal writes is never absent: omitting the argument
 *       records an explicit 'once'
 *   'once': a SECOND attempt with a NEW attemptId is refused; the recorded
 *           one still replays its original receipt
 *   'multiple': further attempts land, each idempotent by its own attemptId,
 *           own credit and the shared total both accumulating
 *   concurrency: two different attemptIds sent in parallel — both land under
 *           'multiple', exactly one lands under 'once'
 *   wsfAdjustGoal changes the policy, Champion only, and a count correction
 *           does not disturb it
 *   wsfMyContribution publishes the policy to a member; wsfGoalPulse does not
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
import {
  wsfAdjustGoal,
  wsfContribute,
  wsfCreateGoal,
  wsfGoalPulse,
  wsfMyContribution,
} from '../../src/index';

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

async function tryRun(fn: { run: (r: any) => Promise<any> }, uid: string | null, data: Data) {
  try {
    return { ok: true as const, value: await fn.run(makeRequest(uid, data)) };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}

function uniq(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

/**
 * Seeds a goal directly. `repeatPolicy: undefined` writes NO field at all,
 * which is the shape every goal created before this change has.
 */
async function seedGoal(opts?: {
  /** Any raw value, so a goal carrying an unrecognised literal can be seeded. */
  repeatPolicy?: unknown;
  status?: 'active' | 'closed';
  target?: number;
}): Promise<{ goalId: string; communityGroupId: string }> {
  const communityGroupId = uniq('grp');
  const now = new Date();
  const ref = getFirestore().collection('wsfGoals').doc();
  await ref.set({
    ownerUid: 'wsfSeedOwner',
    communityGroupId,
    title: 'repeat policy test goal',
    target: opts?.target ?? 5000,
    unit: 'squats',
    status: opts?.status ?? 'active',
    startsAt: Timestamp.fromDate(new Date(now.getTime() - 60_000)),
    endsAt: Timestamp.fromDate(new Date(now.getTime() + 60 * 60_000)),
    timezone: 'America/New_York',
    ...(opts?.repeatPolicy !== undefined ? { repeatPolicy: opts.repeatPolicy } : {}),
    createdAt: new Date(),
  });
  return { goalId: ref.id, communityGroupId };
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

function createGoalData(groupId: string, repeatPolicy?: unknown): Data {
  const now = Date.now();
  const data: Data = {
    communityGroupId: groupId,
    title: 'A goal with a policy',
    target: 5000,
    unit: 'squats',
    startsAt: new Date(now - 60_000).toISOString(),
    endsAt: new Date(now + 60 * 60_000).toISOString(),
    timezone: 'America/New_York',
  };
  if (repeatPolicy !== undefined) data.repeatPolicy = repeatPolicy;
  return data;
}

describe('wsfCreateGoal — repeatPolicy validation', () => {
  beforeAll(async () => {
    await getFirestore().doc('_warmup/wsf-goal-repeat-policy').set({ at: Date.now() });
  }, 30_000);

  test.each([['once'], ['multiple']])(
    "accepts %s and stores it verbatim",
    async (policy) => {
      const groupId = uniq('grp');
      const uid = uniq('champ');
      await seedMembership(groupId, uid);
      const created = await wsfCreateGoal.run(
        makeRequest(uid, createGoalData(groupId, policy))
      );
      const snap = await getFirestore().doc(`wsfGoals/${created.goalId}`).get();
      expect(snap.data()?.repeatPolicy).toBe(policy);
    }
  );

  test('omitting it records an EXPLICIT once, never an absent field', async () => {
    // A new goal states its policy. The absent-field row of the resolution
    // table ('multiple') therefore only ever applies to goals written before
    // the field existed — a new goal can never drift into it.
    const groupId = uniq('grp');
    const uid = uniq('champ');
    await seedMembership(groupId, uid);
    const created = await wsfCreateGoal.run(makeRequest(uid, createGoalData(groupId)));
    const snap = await getFirestore().doc(`wsfGoals/${created.goalId}`).get();
    expect(snap.data()?.repeatPolicy).toBe('once');
    expect(Object.keys(snap.data() ?? {})).toContain('repeatPolicy');
  });

  test('a goal created with no argument enforces once end to end', async () => {
    const groupId = uniq('grp');
    const uid = uniq('champ');
    await seedMembership(groupId, uid);
    const created = await wsfCreateGoal.run(makeRequest(uid, createGoalData(groupId)));
    await wsfContribute.run(
      makeRequest(uid, { goalId: created.goalId, attemptId: 'created-attempt-a', count: 10 })
    );
    const second = await tryRun(wsfContribute, uid, {
      goalId: created.goalId,
      attemptId: 'created-attempt-b',
      count: 10,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('failed-precondition');
  });

  test.each([
    ['MULTIPLE'],
    ['many'],
    [''],
    [2],
    [true],
    [{ policy: 'multiple' }],
    [['multiple']],
  ])('refuses %j with invalid-argument', async (bad) => {
    const groupId = uniq('grp');
    const uid = uniq('champ');
    await seedMembership(groupId, uid);
    const r = await tryRun(wsfCreateGoal, uid, createGoalData(groupId, bad));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('invalid-argument');
    expect(r.error.message).toBe("repeatPolicy must be 'once' or 'multiple'.");
  });

  test('a null repeatPolicy is treated as omitted, not as an error', async () => {
    const groupId = uniq('grp');
    const uid = uniq('champ');
    await seedMembership(groupId, uid);
    const created = await wsfCreateGoal.run(
      makeRequest(uid, createGoalData(groupId, null))
    );
    const snap = await getFirestore().doc(`wsfGoals/${created.goalId}`).get();
    expect(snap.data()?.repeatPolicy).toBe('once');
  });
});

describe('wsfContribute — once', () => {
  test('a second attempt with a NEW attemptId is refused', async () => {
    const { goalId, communityGroupId } = await seedGoal({ repeatPolicy: 'once' });
    const uid = uniq('once');
    await seedMembership(communityGroupId, uid);

    const first = await wsfContribute.run(
      makeRequest(uid, { goalId, attemptId: 'once-attempt-a', count: 20 })
    );
    expect(first.alreadyRecorded).toBe(false);
    expect(first.ownCredit).toBe(20);

    const second = await tryRun(wsfContribute, uid, {
      goalId,
      attemptId: 'once-attempt-b',
      count: 15,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe('failed-precondition');
    expect(second.error.message).toBe(
      'This goal takes one contribution from each member, and yours is already recorded.'
    );

    // Nothing of the refused attempt survives anywhere.
    expect(await directShardSum(goalId)).toBe(20);
    expect(await directContributionCount(goalId)).toBe(1);
    const refused = await getFirestore()
      .doc(`wsfContributions/${goalId}_${uid}_once-attempt-b`)
      .get();
    expect(refused.exists).toBe(false);
  });

  test.each([['weekly'], ['ONCE'], [''], [3], [true]])(
    'a goal carrying the unrecognised value %j resolves to the stricter once',
    async (bad) => {
      // Not the absent-field row: the field IS there and this build does not
      // understand it, which must never widen what a member may do.
      const { goalId, communityGroupId } = await seedGoal({ repeatPolicy: bad });
      const uid = uniq('unknownlit');
      await seedMembership(communityGroupId, uid);
      await wsfContribute.run(
        makeRequest(uid, { goalId, attemptId: 'unknown-attempt-a', count: 10 })
      );
      const second = await tryRun(wsfContribute, uid, {
        goalId,
        attemptId: 'unknown-attempt-b',
        count: 10,
      });
      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.error.code).toBe('failed-precondition');
    }
  );

  test('a legacy member-total row with no contributionCount blocks under an EXPLICIT once', async () => {
    // A row written before contributionCount existed: total only. The policy
    // gate falls back to the contribution ledger rather than trusting the
    // total, so an honest earlier contribution is still recognised.
    const { goalId, communityGroupId } = await seedGoal({ repeatPolicy: 'once' });
    const uid = uniq('legacyrow');
    await seedMembership(communityGroupId, uid);
    const db = getFirestore();
    await db.doc(`wsfContributions/${goalId}_${uid}_pre-existing`).set({
      goalId,
      attemptId: 'pre-existing',
      userId: uid,
      count: 12,
      shardIndex: 0,
      unit: 'squats',
      communityGroupId,
      createdAt: new Date(),
    });
    await db.doc(`wsfGoalMemberTotals/${goalId}_${uid}`).set({
      goalId,
      userId: uid,
      total: 12,
      updatedAt: new Date(),
    });
    await db.doc(`wsfGoalCounters/${goalId}/shards/0`).set({ count: 12 }, { merge: true });

    const second = await tryRun(wsfContribute, uid, {
      goalId,
      attemptId: 'legacyrow-attempt-b',
      count: 5,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('failed-precondition');
    expect(await directShardSum(goalId)).toBe(12);
  });

  test('replaying the RECORDED attemptId still returns its original outcome', async () => {
    const { goalId, communityGroupId } = await seedGoal({ repeatPolicy: 'once' });
    const uid = uniq('oncereplay');
    await seedMembership(communityGroupId, uid);

    await wsfContribute.run(
      makeRequest(uid, { goalId, attemptId: 'once-replay-a', count: 20 })
    );
    // A different count on the same attemptId does not change the receipt.
    const replay = await wsfContribute.run(
      makeRequest(uid, { goalId, attemptId: 'once-replay-a', count: 999 })
    );
    expect(replay.alreadyRecorded).toBe(true);
    expect(replay.addedCount).toBe(20);
    expect(replay.ownCredit).toBe(20);
    expect(replay.sharedTotal).toBe(20);
    expect(await directContributionCount(goalId)).toBe(1);
  });

  test('once is per member, not per goal: another member still contributes', async () => {
    const { goalId, communityGroupId } = await seedGoal({ repeatPolicy: 'once' });
    const a = uniq('onceA');
    const b = uniq('onceB');
    await Promise.all([seedMembership(communityGroupId, a), seedMembership(communityGroupId, b)]);

    await wsfContribute.run(makeRequest(a, { goalId, attemptId: 'once-two-a', count: 20 }));
    const second = await wsfContribute.run(
      makeRequest(b, { goalId, attemptId: 'once-two-b', count: 30 })
    );
    expect(second.alreadyRecorded).toBe(false);
    expect(second.ownCredit).toBe(30);
    expect(second.sharedTotal).toBe(50);
  });
});

describe('wsfContribute — multiple', () => {
  test('further attempts land, each with its own credit and an accumulating shared total', async () => {
    const { goalId, communityGroupId } = await seedGoal({ repeatPolicy: 'multiple' });
    const uid = uniq('multi');
    await seedMembership(communityGroupId, uid);

    const a = await wsfContribute.run(
      makeRequest(uid, { goalId, attemptId: 'multi-attempt-a', count: 20 })
    );
    const b = await wsfContribute.run(
      makeRequest(uid, { goalId, attemptId: 'multi-attempt-b', count: 15 })
    );
    const c = await wsfContribute.run(
      makeRequest(uid, { goalId, attemptId: 'multi-attempt-c', count: 5 })
    );

    expect([a.ownCredit, b.ownCredit, c.ownCredit]).toEqual([20, 35, 40]);
    expect([a.addedCount, b.addedCount, c.addedCount]).toEqual([20, 15, 5]);
    expect(c.sharedTotal).toBe(40);
    expect(await directShardSum(goalId)).toBe(40);
    expect(await directContributionCount(goalId)).toBe(3);
    const totals = await getFirestore().doc(`wsfGoalMemberTotals/${goalId}_${uid}`).get();
    expect(totals.data()?.contributionCount).toBe(3);
  });

  test('each further attempt is still idempotent by its own attemptId', async () => {
    const { goalId, communityGroupId } = await seedGoal({ repeatPolicy: 'multiple' });
    const uid = uniq('multireplay');
    await seedMembership(communityGroupId, uid);

    await wsfContribute.run(makeRequest(uid, { goalId, attemptId: 'mrep-attempt-a', count: 20 }));
    await wsfContribute.run(makeRequest(uid, { goalId, attemptId: 'mrep-attempt-b', count: 15 }));

    // Replaying the FIRST attempt returns the first receipt, not the latest
    // one, and adds nothing.
    const replayA = await wsfContribute.run(
      makeRequest(uid, { goalId, attemptId: 'mrep-attempt-a', count: 20 })
    );
    expect(replayA.alreadyRecorded).toBe(true);
    expect(replayA.addedCount).toBe(20);
    expect(replayA.ownCredit).toBe(35);
    expect(replayA.sharedTotal).toBe(35);
    expect(await directContributionCount(goalId)).toBe(2);
  });

  test('multiple does not open a closed goal or a finished window', async () => {
    const { goalId, communityGroupId } = await seedGoal({
      repeatPolicy: 'multiple',
      status: 'closed',
    });
    const uid = uniq('multiclosed');
    await seedMembership(communityGroupId, uid);
    const r = await tryRun(wsfContribute, uid, {
      goalId,
      attemptId: 'multi-closed-a',
      count: 20,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('failed-precondition');
  });

  test('a goal with NO repeatPolicy field behaves as multiple — live goals are unchanged', async () => {
    // The whole reason absence resolves to 'multiple': this is exactly what
    // this server did before the field existed, and it still does.
    const { goalId, communityGroupId } = await seedGoal();
    const uid = uniq('absent');
    await seedMembership(communityGroupId, uid);

    const a = await wsfContribute.run(
      makeRequest(uid, { goalId, attemptId: 'absent-attempt-a', count: 10 })
    );
    const b = await wsfContribute.run(
      makeRequest(uid, { goalId, attemptId: 'absent-attempt-b', count: 15 })
    );
    expect(a.ownCredit).toBe(10);
    expect(b.ownCredit).toBe(25);
    expect(b.sharedTotal).toBe(25);
    expect(await directContributionCount(goalId)).toBe(2);
  });

  test('a legacy member-total row with no contributionCount does NOT block when the field is absent', async () => {
    // The fallback ledger lookup exists to make an EXPLICIT 'once' honest on
    // old rows. With no policy on the goal there is nothing to enforce, and an
    // old row must not become a restriction nobody asked for.
    const { goalId, communityGroupId } = await seedGoal();
    const uid = uniq('absentlegacy');
    await seedMembership(communityGroupId, uid);
    const db = getFirestore();
    await db.doc(`wsfContributions/${goalId}_${uid}_pre-existing`).set({
      goalId,
      attemptId: 'pre-existing',
      userId: uid,
      count: 12,
      shardIndex: 0,
      unit: 'squats',
      communityGroupId,
      createdAt: new Date(),
    });
    await db.doc(`wsfGoalMemberTotals/${goalId}_${uid}`).set({
      goalId,
      userId: uid,
      total: 12,
      updatedAt: new Date(),
    });
    await db.doc(`wsfGoalCounters/${goalId}/shards/0`).set({ count: 12 }, { merge: true });

    const next = await wsfContribute.run(
      makeRequest(uid, { goalId, attemptId: 'absentlegacy-attempt-b', count: 5 })
    );
    expect(next.alreadyRecorded).toBe(false);
    expect(next.ownCredit).toBe(17);
    expect(await directShardSum(goalId)).toBe(17);
  });

  test('under multiple, two different attemptIds in parallel BOTH land (see also the concurrency block)', async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const uid = uniq('absentpar');
    await seedMembership(communityGroupId, uid);
    await Promise.all([
      wsfContribute.run(makeRequest(uid, { goalId, attemptId: 'absentpar-attempt-a', count: 10 })),
      wsfContribute.run(makeRequest(uid, { goalId, attemptId: 'absentpar-attempt-b', count: 10 })),
    ]);
    expect(await directShardSum(goalId)).toBe(20);
  });

  test('multiple does not admit a non-member', async () => {
    const { goalId } = await seedGoal({ repeatPolicy: 'multiple' });
    const r = await tryRun(wsfContribute, uniq('stranger'), {
      goalId,
      attemptId: 'multi-stranger-a',
      count: 20,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('permission-denied');
  });
});

describe('wsfContribute — two different attemptIds in parallel', () => {
  test('under multiple, both land', async () => {
    const { goalId, communityGroupId } = await seedGoal({ repeatPolicy: 'multiple' });
    const uid = uniq('parmulti');
    await seedMembership(communityGroupId, uid);

    const [a, b] = await Promise.all([
      wsfContribute.run(makeRequest(uid, { goalId, attemptId: 'par-multi-a', count: 20 })),
      wsfContribute.run(makeRequest(uid, { goalId, attemptId: 'par-multi-b', count: 30 })),
    ]);

    expect(a.alreadyRecorded).toBe(false);
    expect(b.alreadyRecorded).toBe(false);
    expect(await directShardSum(goalId)).toBe(50);
    expect(await directContributionCount(goalId)).toBe(2);
    const totals = await getFirestore().doc(`wsfGoalMemberTotals/${goalId}_${uid}`).get();
    expect(totals.data()?.total).toBe(50);
    expect(totals.data()?.contributionCount).toBe(2);
  });

  test('under once, exactly one lands and the other is refused', async () => {
    const { goalId, communityGroupId } = await seedGoal({ repeatPolicy: 'once' });
    const uid = uniq('paronce');
    await seedMembership(communityGroupId, uid);

    const [a, b] = await Promise.all([
      tryRun(wsfContribute, uid, { goalId, attemptId: 'par-once-a', count: 20 }),
      tryRun(wsfContribute, uid, { goalId, attemptId: 'par-once-b', count: 30 }),
    ]);

    const landed = [a, b].filter((r) => r.ok);
    const refused = [a, b].filter((r) => !r.ok);
    expect(landed).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0] as { error: HttpsError }).error.code).toBe('failed-precondition');

    const winner = (landed[0] as { value: { addedCount: number } }).value;
    expect(await directShardSum(goalId)).toBe(winner.addedCount);
    expect(await directContributionCount(goalId)).toBe(1);
    const totals = await getFirestore().doc(`wsfGoalMemberTotals/${goalId}_${uid}`).get();
    expect(totals.data()?.total).toBe(winner.addedCount);
    expect(totals.data()?.contributionCount).toBe(1);
  });
});

describe('wsfAdjustGoal — changing the policy', () => {
  test('a Champion switches once to multiple and the next attempt lands', async () => {
    const { goalId, communityGroupId } = await seedGoal({ repeatPolicy: 'once' });
    const champ = uniq('champ');
    await seedMembership(communityGroupId, champ);

    await wsfContribute.run(
      makeRequest(champ, { goalId, attemptId: 'switch-attempt-a', count: 20 })
    );
    const blocked = await tryRun(wsfContribute, champ, {
      goalId,
      attemptId: 'switch-attempt-b',
      count: 10,
    });
    expect(blocked.ok).toBe(false);

    const adjusted = await wsfAdjustGoal.run(
      makeRequest(champ, {
        goalId,
        repeatPolicy: 'multiple',
        reason: 'The community asked to log more than one session.',
      })
    );
    expect(adjusted.repeatPolicy).toBe('multiple');
    expect(adjusted.delta).toBe(0);
    expect(adjusted.sharedTotal).toBe(20);

    const after = await wsfContribute.run(
      makeRequest(champ, { goalId, attemptId: 'switch-attempt-c', count: 10 })
    );
    expect(after.alreadyRecorded).toBe(false);
    expect(after.ownCredit).toBe(30);
    expect(after.sharedTotal).toBe(30);
  });

  test('switching multiple back to once refuses the next NEW attempt', async () => {
    const { goalId, communityGroupId } = await seedGoal({ repeatPolicy: 'multiple' });
    const champ = uniq('champ');
    await seedMembership(communityGroupId, champ);

    await wsfContribute.run(makeRequest(champ, { goalId, attemptId: 'back-attempt-a', count: 20 }));
    await wsfContribute.run(makeRequest(champ, { goalId, attemptId: 'back-attempt-b', count: 20 }));

    const adjusted = await wsfAdjustGoal.run(
      makeRequest(champ, { goalId, repeatPolicy: 'once', reason: 'One per member from here.' })
    );
    expect(adjusted.repeatPolicy).toBe('once');

    const blocked = await tryRun(wsfContribute, champ, {
      goalId,
      attemptId: 'back-attempt-c',
      count: 20,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe('failed-precondition');

    // What was already recorded stays recorded and still replays.
    const replay = await wsfContribute.run(
      makeRequest(champ, { goalId, attemptId: 'back-attempt-b', count: 20 })
    );
    expect(replay.alreadyRecorded).toBe(true);
    expect(replay.ownCredit).toBe(40);
  });

  test('a policy change writes an attributed, immutable audit row', async () => {
    const { goalId, communityGroupId } = await seedGoal({ repeatPolicy: 'once' });
    const champ = uniq('champ');
    await seedMembership(communityGroupId, champ);
    const adjusted = await wsfAdjustGoal.run(
      makeRequest(champ, { goalId, repeatPolicy: 'multiple', reason: 'Policy correction.' })
    );
    const row = await getFirestore().doc(`wsfGoalAdjustments/${adjusted.adjustmentId}`).get();
    expect(row.data()).toMatchObject({
      goalId,
      delta: 0,
      repeatPolicy: 'multiple',
      reason: 'Policy correction.',
      byUid: champ,
      byRole: 'foundingChampion',
    });
    const goal = await getFirestore().doc(`wsfGoals/${goalId}`).get();
    expect(goal.data()?.repeatPolicy).toBe('multiple');
    expect(goal.data()?.repeatPolicyUpdatedBy).toBe(champ);
  });

  test('a non-champion member cannot change it', async () => {
    const { goalId, communityGroupId } = await seedGoal({ repeatPolicy: 'once' });
    const member = uniq('member');
    await seedMembership(communityGroupId, member, { role: 'member' });
    const r = await tryRun(wsfAdjustGoal, member, {
      goalId,
      repeatPolicy: 'multiple',
      reason: 'I would like to log more.',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('permission-denied');
    const goal = await getFirestore().doc(`wsfGoals/${goalId}`).get();
    expect(goal.data()?.repeatPolicy).toBe('once');
  });

  test('a non-member cannot change it', async () => {
    const { goalId } = await seedGoal({ repeatPolicy: 'once' });
    const r = await tryRun(wsfAdjustGoal, uniq('stranger'), {
      goalId,
      repeatPolicy: 'multiple',
      reason: 'Trying.',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('permission-denied');
  });

  test('an unauthenticated caller cannot change it', async () => {
    const { goalId } = await seedGoal({ repeatPolicy: 'once' });
    const r = await tryRun(wsfAdjustGoal, null, {
      goalId,
      repeatPolicy: 'multiple',
      reason: 'Trying.',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('unauthenticated');
  });

  test.each([['MULTIPLE'], ['sometimes'], [3], [false]])(
    'refuses %j with invalid-argument and changes nothing',
    async (bad) => {
      const { goalId, communityGroupId } = await seedGoal({ repeatPolicy: 'once' });
      const champ = uniq('champ');
      await seedMembership(communityGroupId, champ);
      const r = await tryRun(wsfAdjustGoal, champ, {
        goalId,
        repeatPolicy: bad,
        reason: 'Trying.',
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.code).toBe('invalid-argument');
      const goal = await getFirestore().doc(`wsfGoals/${goalId}`).get();
      expect(goal.data()?.repeatPolicy).toBe('once');
    }
  );

  test('delta is still required when no repeatPolicy is supplied', async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const champ = uniq('champ');
    await seedMembership(communityGroupId, champ);
    const r = await tryRun(wsfAdjustGoal, champ, { goalId, reason: 'Nothing to do.' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid-argument');
  });

  test('a reason is still required for a policy change', async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const champ = uniq('champ');
    await seedMembership(communityGroupId, champ);
    const r = await tryRun(wsfAdjustGoal, champ, { goalId, repeatPolicy: 'multiple' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid-argument');
  });

  test('an ordinary count correction leaves the policy alone', async () => {
    const { goalId, communityGroupId } = await seedGoal({ repeatPolicy: 'multiple' });
    const champ = uniq('champ');
    await seedMembership(communityGroupId, champ);
    await wsfContribute.run(makeRequest(champ, { goalId, attemptId: 'corr-attempt-a', count: 40 }));

    const adjusted = await wsfAdjustGoal.run(
      makeRequest(champ, { goalId, delta: -10, reason: 'Counter was jammed.' })
    );
    expect(adjusted.repeatPolicy).toBe('multiple');
    expect(adjusted.sharedTotal).toBe(30);
    const goal = await getFirestore().doc(`wsfGoals/${goalId}`).get();
    expect(goal.data()?.repeatPolicy).toBe('multiple');
  });

  test('a correction against a member total does not consume their one contribution', async () => {
    // contributionCount counts contributions, not units, so zeroing a member's
    // credit does not silently hand them a second attempt under 'once'.
    const { goalId, communityGroupId } = await seedGoal({ repeatPolicy: 'once' });
    const champ = uniq('champ');
    await seedMembership(communityGroupId, champ);
    await wsfContribute.run(makeRequest(champ, { goalId, attemptId: 'zero-attempt-a', count: 20 }));
    await wsfAdjustGoal.run(
      makeRequest(champ, {
        goalId,
        delta: -20,
        targetUid: champ,
        reason: 'Recorded in error.',
      })
    );
    const totals = await getFirestore().doc(`wsfGoalMemberTotals/${goalId}_${champ}`).get();
    expect(totals.data()?.total).toBe(0);
    expect(totals.data()?.contributionCount).toBe(1);

    const again = await tryRun(wsfContribute, champ, {
      goalId,
      attemptId: 'zero-attempt-b',
      count: 20,
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('failed-precondition');
  });
});

describe('who learns the policy', () => {
  test('wsfMyContribution reports multiple for a goal with no field at all', async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const uid = uniq('absentreader');
    await seedMembership(communityGroupId, uid);
    const mine = await wsfMyContribution.run(makeRequest(uid, { goalId }));
    expect(mine).toEqual({ ownCredit: 0, unit: 'squats', repeatPolicy: 'multiple' });
  });

  test('wsfMyContribution reports once for an unrecognised literal', async () => {
    const { goalId, communityGroupId } = await seedGoal({ repeatPolicy: 'weekly' });
    const uid = uniq('unknownreader');
    await seedMembership(communityGroupId, uid);
    const mine = await wsfMyContribution.run(makeRequest(uid, { goalId }));
    expect(mine).toEqual({ ownCredit: 0, unit: 'squats', repeatPolicy: 'once' });
  });

  test('wsfMyContribution tells a member, before they have contributed anything', async () => {
    const { goalId, communityGroupId } = await seedGoal({ repeatPolicy: 'multiple' });
    const uid = uniq('reader');
    await seedMembership(communityGroupId, uid);
    const mine = await wsfMyContribution.run(makeRequest(uid, { goalId }));
    expect(mine).toEqual({ ownCredit: 0, unit: 'squats', repeatPolicy: 'multiple' });
  });

  test('wsfGoalPulse is unchanged — nine fields, and repeatPolicy is not one of them', async () => {
    const { goalId, communityGroupId } = await seedGoal({ repeatPolicy: 'multiple' });
    const uid = uniq('pulse');
    await seedMembership(communityGroupId, uid);
    await getFirestore()
      .doc(`wsfCommunityGroups/${communityGroupId}`)
      .set({ displayName: 'Repeat Policy Community', createdAt: new Date() }, { merge: true });

    const pulse = await wsfGoalPulse.run(makeRequest(uid, { goalId }));
    expect(Object.keys(pulse).sort()).toEqual(
      [
        'communityDisplayName',
        'endsAt',
        'goalTitle',
        'sharedTotal',
        'startsAt',
        'status',
        'target',
        'timezone',
        'unit',
      ].sort()
    );
    expect(pulse).not.toHaveProperty('repeatPolicy');
  });
});
