/**
 * COMBINED MOVEMENT GOAL — CORRECTIONS LINKED TO THE CREDIT, AND THE BOUNDED
 * RECOVERY.
 *
 * THE GAP THIS FILE CLOSES, in the Director's words: "generic wsfAdjustGoal
 * decides parent correction from the current active claim/current clock. That
 * cannot distinguish a correction to pre-activation history from a correction
 * to a credited attempt, and it stops correcting the parent after the window
 * closes. […] the contract requires an actual bounded recovery path and proof,
 * not 'no repair callable.'"
 *
 * So two things are pinned here, and neither of them is a clock:
 *
 *   A. WHAT A CORRECTION IS ADDRESSED TO. A correction names the contribution
 *      it corrects (goalId, targetUid, attemptId) and carries its own
 *      idempotency key (correctionId). The server reads
 *      wsfCombinedCredits/{goalId}_{uid}_{attemptId} — the immutable row named
 *      after the contribution itself — and:
 *        • no row  → never credited (pre-activation, outside the frozen
 *                    window, or an unclaimed child): the child moves, the
 *                    parent NEVER does;
 *        • a row   → credited: both move, once each, EVEN AFTER the window has
 *                    closed and the claim has been released;
 *        • a repeat of the same correctionId applies nothing a second time.
 *      A correction that names NO contribution cannot be traced to a credit,
 *      so it never moves a parent at all.
 *
 *   B. THE RECOVERY. wsfRepairCombinedGoal recomputes a parent's counters from
 *      the credit rows alone, repairs what disagrees, hands back an audit
 *      receipt that reports even when it changes nothing, is safe to run
 *      twice, never writes a number no set of rows adds up to, and refuses to
 *      write at all when it could not read the whole ledger.
 *
 * Runs against the local Firestore emulator via `func.run(request)`. Admin SDK
 * writes only; no live project, no rules edit, no client SDK.
 */

process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  wsfAdjustGoal,
  wsfCloseCombinedGoal,
  wsfCombinedGoalPulse,
  wsfContribute,
  wsfCreateCombinedGoal,
  wsfGoalPulse,
  wsfRepairCombinedGoal,
} from '../../src/index';

type Data = Record<string, unknown>;

/** The 2 s combined-pulse TTL, plus margin for a slow emulator round trip. */
const CACHE_TTL_WAIT_MS = 2_300;
const afterCacheTtl = () => new Promise((r) => setTimeout(r, CACHE_TTL_WAIT_MS));

function request(uid: string | null, data: Data) {
  return {
    auth: uid ? ({ uid, token: { email_verified: true } as any } as any) : undefined,
    data: data as any,
    rawRequest: { ip: '127.0.0.1', headers: {} } as any,
    acceptsStreaming: false,
  } as any;
}

async function attempt<T>(run: () => Promise<T>) {
  try {
    return { ok: true as const, value: await run() };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}

const createCombined = (uid: string | null, data: Data) =>
  attempt(() => wsfCreateCombinedGoal.run(request(uid, data)));
const combinedPulse = (uid: string | null, data: Data) =>
  attempt(() => wsfCombinedGoalPulse.run(request(uid, data)));
const goalPulse = (uid: string | null, data: Data) =>
  attempt(() => wsfGoalPulse.run(request(uid, data)));
const contribute = (uid: string | null, data: Data) =>
  attempt(() => wsfContribute.run(request(uid, data)));
const adjust = (uid: string | null, data: Data) =>
  attempt(() => wsfAdjustGoal.run(request(uid, data)));
const closeCombined = (uid: string | null, data: Data) =>
  attempt(() => wsfCloseCombinedGoal.run(request(uid, data)));
const repair = (uid: string | null, data: Data) =>
  attempt(() => wsfRepairCombinedGoal.run(request(uid, data)));

/** The parent's OWN credit for one child, read straight from its shards. */
async function parentCreditFor(setupId: string, goalId: string): Promise<number> {
  const snaps = await getFirestore()
    .collection(`wsfCombinedCounters/${setupId}/shards`)
    .get();
  let total = 0;
  for (const doc of snaps.docs) {
    if (!doc.id.startsWith(`${goalId}_`)) continue;
    const count = (doc.data() as { count?: number }).count;
    if (typeof count === 'number') total += count;
  }
  return total;
}

/** The durable linkage rows for one setup. A single-field equality. */
async function creditRows(setupId: string) {
  return getFirestore()
    .collection('wsfCombinedCredits')
    .where('setupId', '==', setupId)
    .get();
}

/**
 * Write `count` into a shard of `goalId` that nothing has used yet.
 *
 * A contribution picks one of the ten shards AT RANDOM, so writing a fixed
 * index would replace a real credit one time in ten and make these tests flaky
 * about the very arithmetic they are pinning. Corrupting an UNUSED shard adds
 * to the parent's counter deterministically, which is what a stray write or a
 * bad restore actually looks like.
 */
async function corruptUnusedShard(
  setupId: string,
  goalId: string,
  count: number
): Promise<void> {
  const db = getFirestore();
  const existing = new Set(
    (await db.collection(`wsfCombinedCounters/${setupId}/shards`).get()).docs.map((d) => d.id)
  );
  for (let i = 0; i < 10; i++) {
    const id = `${goalId}_${i}`;
    if (existing.has(id)) continue;
    await db.doc(`wsfCombinedCounters/${setupId}/shards/${id}`).set({ count });
    return;
  }
  throw new Error('every shard is already in use; nothing to corrupt');
}

async function auditRows(goalId: string) {
  return getFirestore()
    .collection('wsfGoalAdjustments')
    .where('goalId', '==', goalId)
    .get();
}

let seq = 0;
function uniq(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}_${Math.random().toString(36).slice(2, 7)}`;
}

async function seedCommunity(championUid: string): Promise<string> {
  const db = getFirestore();
  const groupId = uniq('repairGroup');
  await db.doc(`wsfCommunityGroups/${groupId}`).set({
    displayName: 'Combined goal community',
    groupType: 'custom',
    joinPolicy: 'public',
    joinCode: uniq('code'),
    createdByUserId: championUid,
    lifecycleStatus: 'active',
    isSample: false,
  });
  await db.doc(`wsfMemberships/${groupId}_${championUid}`).set({
    groupId,
    userId: championUid,
    role: 'foundingChampion',
    membershipStatus: 'active',
  });
  return groupId;
}

async function seedMember(groupId: string, uid: string, role = 'member'): Promise<void> {
  await getFirestore().doc(`wsfMemberships/${groupId}_${uid}`).set({
    groupId,
    userId: uid,
    role,
    membershipStatus: 'active',
  });
}

async function seedGoal(opts: {
  communityGroupId: string;
  ownerUid: string;
  title: string;
  target: number;
  unit: string;
  startsAt: Date;
  endsAt: Date;
}): Promise<string> {
  const ref = getFirestore().collection('wsfGoals').doc();
  await ref.set({
    ownerUid: opts.ownerUid,
    communityGroupId: opts.communityGroupId,
    title: opts.title,
    target: opts.target,
    unit: opts.unit,
    status: 'active',
    startsAt: Timestamp.fromDate(opts.startsAt),
    endsAt: Timestamp.fromDate(opts.endsAt),
    timezone: 'America/New_York',
    repeatPolicy: 'multiple',
    createdAt: new Date(),
  });
  return ref.id;
}

/** The same fixture shape the combined-goal suite uses: two eligible children
 * inside a wider combined window, both live now. */
async function seedFixture() {
  const champ = uniq('champ');
  const groupId = await seedCommunity(champ);
  const m1 = uniq('m1');
  await seedMember(groupId, m1);

  const now = Date.now();
  const combinedStart = new Date(now - 2 * 86_400_000);
  const combinedEnd = new Date(now + 12 * 86_400_000);
  const childStart = new Date(now - 86_400_000);
  const childEnd = new Date(now + 6 * 86_400_000);

  const goalA = await seedGoal({
    communityGroupId: groupId,
    ownerUid: champ,
    title: 'Squats',
    target: 1000,
    unit: 'squats',
    startsAt: childStart,
    endsAt: childEnd,
  });
  const goalB = await seedGoal({
    communityGroupId: groupId,
    ownerUid: champ,
    title: 'Push-ups',
    target: 800,
    unit: 'push-ups',
    startsAt: childStart,
    endsAt: childEnd,
  });

  return {
    champ,
    m1,
    groupId,
    goalA,
    goalB,
    createArgs: {
      communityGroupId: groupId,
      title: 'Move together',
      unit: 'movements',
      target: 2000,
      startsAt: combinedStart.toISOString(),
      endsAt: combinedEnd.toISOString(),
      childGoalIds: [goalA, goalB],
      timezone: 'America/New_York',
    },
  };
}

async function freeze(fx: Awaited<ReturnType<typeof seedFixture>>): Promise<string> {
  const r = await createCombined(fx.champ, fx.createArgs);
  expect(r.ok).toBe(true);
  if (!r.ok) throw r.error;
  return (r.value as { setupId: string }).setupId;
}

describe('wsfAdjustGoal — a correction is addressed to the credit, not to the clock', () => {
  beforeAll(async () => {
    await getFirestore().doc('_warmup/wsf-combined-correction').set({ at: Date.now() });
  }, 30_000);

  // ── 26. PRE-ACTIVATION HISTORY ──────────────────────────────────────────
  //
  // PROVES: a correction to a contribution the parent never counted moves the
  // child and never the parent — although the claim is active RIGHT NOW and
  // the clock is inside the frozen window, which is exactly the state the old
  // implementation would have read as "yes, move the parent".
  test('a correction to PRE-ACTIVATION history moves the activity and never the parent', async () => {
    const fx = await seedFixture();
    // 500 before anyone combined anything.
    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'pre-a-000001', count: 500 });
    const setupId = await freeze(fx);
    // 20 after, which the parent did count.
    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'post-a-00001', count: 20 });
    expect(await parentCreditFor(setupId, fx.goalA)).toBe(20);

    // The claim is active and the window is open — the conditions the old
    // build decided on — and they are not what decides this.
    const claim = await getFirestore().doc(`wsfCombinedGoalClaims/${fx.goalA}`).get();
    expect((claim.data() as { status?: string }).status).toBe('active');

    const r = await adjust(fx.champ, {
      goalId: fx.goalA,
      delta: -50,
      targetUid: fx.m1,
      attemptId: 'pre-a-000001',
      correctionId: 'pre-fix-0001',
      reason: 'Recount of the pre-event tally.',
    });
    expect(r.ok).toBe(true);

    // THE CHILD MOVED.
    const pa = await goalPulse(fx.m1, { goalId: fx.goalA });
    expect(pa.ok && (pa.value as any).sharedTotal).toBe(470);

    // THE PARENT DID NOT. Not a unit, not a shard write, not a linkage row.
    expect(await parentCreditFor(setupId, fx.goalA)).toBe(20);
    const credits = await creditRows(setupId);
    expect(credits.size).toBe(1);
    expect((credits.docs[0]!.data() as { source?: string }).source).toBe('contribution');

    // And the audit row SAYS the parent was untouched, by carrying none of the
    // combined fields at all.
    const audits = await auditRows(fx.goalA);
    expect(audits.size).toBe(1);
    const audit = audits.docs[0]!.data() as Record<string, unknown>;
    expect(audit.delta).toBe(-50);
    expect(audit.attemptId).toBe('pre-a-000001');
    expect(audit.combinedSetupId).toBeUndefined();
    expect(audit.combinedDelta).toBeUndefined();

    await afterCacheTtl();
    const p = await combinedPulse(fx.m1, { setupId });
    expect(p.ok && (p.value as any).combinedTotal).toBe(20);
  }, 45_000);

  // ── 27. A CREDITED ATTEMPT ──────────────────────────────────────────────
  //
  // PROVES: correcting a contribution that WAS credited moves both, once each.
  test('a correction to a CREDITED attempt moves the activity and the parent, once each', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);
    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'live-a-00001', count: 20 });

    const r = await adjust(fx.champ, {
      goalId: fx.goalA,
      delta: -5,
      targetUid: fx.m1,
      attemptId: 'live-a-00001',
      correctionId: 'live-fix-001',
      reason: 'Miscounted by five.',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as any).delta).toBe(-5);

    const pa = await goalPulse(fx.m1, { goalId: fx.goalA });
    expect(pa.ok && (pa.value as any).sharedTotal).toBe(15);
    expect(await parentCreditFor(setupId, fx.goalA)).toBe(15);

    // ONCE EACH: one audit row, one adjustment credit row beside the one
    // contribution credit row.
    expect((await auditRows(fx.goalA)).size).toBe(1);
    const credits = await creditRows(setupId);
    expect(credits.size).toBe(2);
    const adjustmentCredit = credits.docs.find(
      (d) => (d.data() as { source?: string }).source === 'adjustment'
    )!;
    const row = adjustmentCredit.data() as Record<string, unknown>;
    expect(row.amount).toBe(-5);
    expect(row.setupId).toBe(setupId);
    // The correction credit NAMES the attempt it unwinds, so the ledger can be
    // walked from either end.
    expect(row.correctsAttemptId).toBe('live-a-00001');
  }, 45_000);

  // ── 28. AFTER THE WINDOW CLOSED AND THE CLAIM WAS RELEASED ──────────────
  //
  // PROVES the half of the contract the old build could not keep at all: the
  // credit happened, so unwinding it is not a new credit, and nothing about
  // the passage of time changes that.
  test('correcting a credited attempt still moves the parent after the window closed and the claim was released', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);
    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'late-a-00001', count: 40 });
    expect(await parentCreditFor(setupId, fx.goalA)).toBe(40);

    // The setup is closed, which RELEASES the claim…
    expect((await closeCombined(fx.champ, { setupId })).ok).toBe(true);
    const claim = await getFirestore().doc(`wsfCombinedGoalClaims/${fx.goalA}`).get();
    expect((claim.data() as { status?: string }).status).toBe('released');
    // …and the frozen window is pushed into the past, as a real combined
    // period that has ended would be. Both of the old build's reasons to
    // refuse are now true at once.
    await getFirestore()
      .doc(`wsfCombinedGoalClaims/${fx.goalA}`)
      .update({ windowEndsAt: Timestamp.fromDate(new Date(Date.now() - 60_000)) });

    const r = await adjust(fx.champ, {
      goalId: fx.goalA,
      delta: -10,
      targetUid: fx.m1,
      attemptId: 'late-a-00001',
      correctionId: 'late-fix-001',
      reason: 'Post-event recount.',
    });
    expect(r.ok).toBe(true);

    const pa = await goalPulse(fx.m1, { goalId: fx.goalA });
    expect(pa.ok && (pa.value as any).sharedTotal).toBe(30);
    // THE PARENT MOVED. Once.
    expect(await parentCreditFor(setupId, fx.goalA)).toBe(30);
    const credits = await creditRows(setupId);
    expect(
      credits.docs.filter((d) => (d.data() as { source?: string }).source === 'adjustment')
    ).toHaveLength(1);

    await afterCacheTtl();
    const p = await combinedPulse(fx.m1, { setupId });
    expect(p.ok && (p.value as any).combinedTotal).toBe(30);
  }, 45_000);

  // ── 29. A REPEATED CORRECTION ───────────────────────────────────────────
  //
  // PROVES: a retried call with the same correctionId applies nothing a second
  // time, on either counter, and returns the first call's outcome.
  test('a repeated correction does not double-apply, on the activity or on the parent', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);
    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'idem-a-00001', count: 30 });

    const first = await adjust(fx.champ, {
      goalId: fx.goalA,
      delta: -7,
      targetUid: fx.m1,
      attemptId: 'idem-a-00001',
      correctionId: 'idem-fix-001',
      reason: 'Miscounted by seven.',
    });
    const replay = await adjust(fx.champ, {
      goalId: fx.goalA,
      delta: -7,
      targetUid: fx.m1,
      attemptId: 'idem-a-00001',
      correctionId: 'idem-fix-001',
      reason: 'Miscounted by seven.',
    });
    // A replay that asks for a DIFFERENT delta still reports the original and
    // still moves nothing — the key identifies the correction, not the body.
    const lying = await adjust(fx.champ, {
      goalId: fx.goalA,
      delta: -25,
      targetUid: fx.m1,
      attemptId: 'idem-a-00001',
      correctionId: 'idem-fix-001',
      reason: 'A retry that lost its nerve.',
    });

    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    expect(lying.ok).toBe(true);
    if (first.ok && replay.ok && lying.ok) {
      expect((first.value as any).adjustmentId).toBe((replay.value as any).adjustmentId);
      expect((replay.value as any).delta).toBe(-7);
      expect((lying.value as any).delta).toBe(-7);
      expect((replay.value as any).sharedTotal).toBe(23);
    }

    const pa = await goalPulse(fx.m1, { goalId: fx.goalA });
    expect(pa.ok && (pa.value as any).sharedTotal).toBe(23);
    expect(await parentCreditFor(setupId, fx.goalA)).toBe(23);

    // ONE audit row, ONE adjustment credit row, after three calls.
    expect((await auditRows(fx.goalA)).size).toBe(1);
    const credits = await creditRows(setupId);
    expect(
      credits.docs.filter((d) => (d.data() as { source?: string }).source === 'adjustment')
    ).toHaveLength(1);
  }, 45_000);

  // ── 30. A CORRECTION THAT NAMES NOTHING ─────────────────────────────────
  //
  // PROVES: an untraceable correction never moves a parent. This is the
  // behaviour the old build got wrong in the other direction — it moved the
  // parent for any correction at all, whatever it was correcting.
  test('a correction that names no contribution moves the activity and never the parent', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);
    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'tally-a-0001', count: 20 });

    // "One of the tally counters was jammed and the shared count is off by 40."
    const r = await adjust(fx.champ, {
      goalId: fx.goalA,
      delta: 40,
      reason: 'The tally counter was jammed by forty.',
    });
    expect(r.ok).toBe(true);

    const pa = await goalPulse(fx.m1, { goalId: fx.goalA });
    expect(pa.ok && (pa.value as any).sharedTotal).toBe(60);
    expect(await parentCreditFor(setupId, fx.goalA)).toBe(20);
    expect((await creditRows(setupId)).size).toBe(1);
  }, 45_000);

  // ── 31. THE ADDRESSING RULES THEMSELVES ─────────────────────────────────
  //
  // PROVES: the server never INFERS which contribution is meant. A correction
  // that names an attempt must name the member, must carry a key, and must
  // name a contribution that exists.
  test('an addressed correction is refused rather than guessed at', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);
    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'guess-a-0001', count: 20 });

    const noTarget = await adjust(fx.champ, {
      goalId: fx.goalA,
      delta: -1,
      attemptId: 'guess-a-0001',
      correctionId: 'guess-fix-01',
      reason: 'Who is this about?',
    });
    expect(noTarget.ok).toBe(false);
    if (!noTarget.ok) {
      expect(noTarget.error.code).toBe('invalid-argument');
      expect(noTarget.error.message).toBe(
        'targetUid is required when attemptId names the contribution to correct.'
      );
    }

    const noKey = await adjust(fx.champ, {
      goalId: fx.goalA,
      delta: -1,
      targetUid: fx.m1,
      attemptId: 'guess-a-0001',
      reason: 'No idempotency key.',
    });
    expect(noKey.ok).toBe(false);
    if (!noKey.ok) {
      expect(noKey.error.code).toBe('invalid-argument');
      expect(noKey.error.message).toBe(
        'correctionId is required when attemptId names the contribution to correct.'
      );
    }

    const unknownAttempt = await adjust(fx.champ, {
      goalId: fx.goalA,
      delta: -1,
      targetUid: fx.m1,
      attemptId: 'nosuchattempt',
      correctionId: 'guess-fix-02',
      reason: 'A typo in the attempt id.',
    });
    expect(unknownAttempt.ok).toBe(false);
    if (!unknownAttempt.ok) {
      expect(unknownAttempt.error.code).toBe('not-found');
      expect(unknownAttempt.error.message).toBe(
        'That contribution was not found on this goal.'
      );
    }

    // NOTHING MOVED on any of the three refusals.
    const pa = await goalPulse(fx.m1, { goalId: fx.goalA });
    expect(pa.ok && (pa.value as any).sharedTotal).toBe(20);
    expect(await parentCreditFor(setupId, fx.goalA)).toBe(20);
    expect((await auditRows(fx.goalA)).size).toBe(0);
  }, 45_000);
});

describe('wsfRepairCombinedGoal — the bounded recovery, and its receipt', () => {
  beforeAll(async () => {
    await getFirestore().doc('_warmup/wsf-combined-repair').set({ at: Date.now() });
  }, 30_000);

  // ── 32. A HEALTHY PARENT ────────────────────────────────────────────────
  //
  // PROVES: on a parent that agrees with its ledger the operation reports
  // "nothing to repair" AND STILL REPORTS — per child, ledger against counter,
  // difference zero — and writes nothing.
  test('a healthy parent reports nothing to repair, states the comparison anyway, and changes nothing', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);
    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'heal-a-00001', count: 20 });
    await contribute(fx.m1, { goalId: fx.goalB, attemptId: 'heal-b-00001', count: 15 });

    const before = await getFirestore()
      .collection(`wsfCombinedCounters/${setupId}/shards`)
      .get();
    const beforeByPath = new Map(before.docs.map((d) => [d.id, (d.data() as any).count]));

    const r = await repair(fx.champ, { setupId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const receipt = r.value as any;

    expect(receipt.status).toBe('healthy');
    expect(receipt.scanComplete).toBe(true);
    expect(receipt.childrenRepaired).toBe(0);
    expect(receipt.discrepancyTotal).toBe(0);
    expect(receipt.ledgerTotal).toBe(35);
    expect(receipt.counterTotalBefore).toBe(35);
    expect(receipt.counterTotalAfter).toBe(35);
    expect(receipt.creditRowsExamined).toBe(2);
    expect(receipt.unreadableCreditRows).toBe(0);
    expect(receipt.orphanCreditRows).toBe(0);
    expect(receipt.childrenExamined).toBe(2);

    // IT REPORTED EVEN THOUGH IT CHANGED NOTHING: both children are stated.
    const byId = new Map<string, any>(receipt.children.map((c: any) => [c.goalId, c]));
    expect(byId.get(fx.goalA)).toMatchObject({
      ledgerTotal: 20,
      counterTotalBefore: 20,
      counterTotalAfter: 20,
      discrepancy: 0,
      creditRows: 1,
      repaired: false,
    });
    expect(byId.get(fx.goalB)).toMatchObject({ ledgerTotal: 15, discrepancy: 0, repaired: false });

    // THE RECEIPT NAMES NO PERSON.
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain(fx.m1);
    expect(serialized).not.toContain(fx.champ);

    // AND IT WROTE NOTHING.
    const after = await getFirestore()
      .collection(`wsfCombinedCounters/${setupId}/shards`)
      .get();
    expect(after.size).toBe(before.size);
    for (const doc of after.docs) {
      expect((doc.data() as any).count).toBe(beforeByPath.get(doc.id));
    }
  }, 45_000);

  // ── 33. A CORRUPTED SHARD ───────────────────────────────────────────────
  //
  // PROVES: it restores the value from the rows and SAYS SO in the receipt.
  test('a parent whose shard was corrupted is restored from the credit rows, and the receipt says so', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);
    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'corr-a-00001', count: 20 });
    await contribute(fx.m1, { goalId: fx.goalB, attemptId: 'corr-b-00001', count: 15 });

    // Something outside the ordinary course of events: a shard that no row
    // accounts for. Only the Admin SDK can do this, which is the point.
    await corruptUnusedShard(setupId, fx.goalA, 999);
    expect(await parentCreditFor(setupId, fx.goalA)).toBe(1019);

    const r = await repair(fx.champ, { setupId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const receipt = r.value as any;

    expect(receipt.status).toBe('repaired');
    expect(receipt.childrenRepaired).toBe(1);
    expect(receipt.counterTotalBefore).toBe(1034);
    expect(receipt.ledgerTotal).toBe(35);
    expect(receipt.counterTotalAfter).toBe(35);
    expect(receipt.discrepancyTotal).toBe(-999);
    const byId = new Map<string, any>(receipt.children.map((c: any) => [c.goalId, c]));
    expect(byId.get(fx.goalA)).toMatchObject({
      ledgerTotal: 20,
      counterTotalBefore: 1019,
      counterTotalAfter: 20,
      discrepancy: -999,
      repaired: true,
    });
    // The untouched child is reported too, and reported as untouched.
    expect(byId.get(fx.goalB)).toMatchObject({ discrepancy: 0, repaired: false });

    // THE COUNTER REALLY MOVED.
    expect(await parentCreditFor(setupId, fx.goalA)).toBe(20);
    await afterCacheTtl();
    const p = await combinedPulse(fx.m1, { setupId });
    expect(p.ok && (p.value as any).combinedTotal).toBe(35);
  }, 45_000);

  // ── 34. RUN IT TWICE ────────────────────────────────────────────────────
  test('running the recovery twice is idempotent: the second pass repairs nothing', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);
    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'twice-a-0001', count: 20 });
    await corruptUnusedShard(setupId, fx.goalA, -5);

    const first = await repair(fx.champ, { setupId });
    const second = await repair(fx.champ, { setupId });
    const third = await repair(fx.champ, { setupId });
    expect(first.ok && (first.value as any).status).toBe('repaired');
    expect(second.ok && (second.value as any).status).toBe('healthy');
    expect(third.ok && (third.value as any).status).toBe('healthy');
    if (second.ok) {
      expect((second.value as any).childrenRepaired).toBe(0);
      expect((second.value as any).discrepancyTotal).toBe(0);
      expect((second.value as any).counterTotalAfter).toBe(20);
    }
    expect(await parentCreditFor(setupId, fx.goalA)).toBe(20);
  }, 45_000);

  // ── 35. IT NEVER INVENTS A CREDIT ───────────────────────────────────────
  //
  // PROVES: the ledger is the only authority. A counter with no rows behind it
  // goes to zero, and a row naming a goal this setup does not have is counted
  // and never applied.
  test('the recovery never invents a credit that has no row', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);
    const db = getFirestore();

    // A parent counter for a child that has NEVER been credited.
    await corruptUnusedShard(setupId, fx.goalB, 250);
    // And a credit row naming a goal that is not a child of this setup: it
    // must be reported and must NOT create a counter for that goal.
    const foreignGoalId = uniq('foreignGoal');
    await db.doc(`wsfCombinedCredits/${uniq('orphan')}`).set({
      setupId,
      setupVersion: 1,
      contributionRuleVersion: 1,
      goalId: foreignGoalId,
      userId: fx.m1,
      attemptId: 'orphan-00001',
      source: 'contribution',
      amount: 70,
      shardIndex: 0,
      communityGroupId: fx.groupId,
    });

    const r = await repair(fx.champ, { setupId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const receipt = r.value as any;

    expect(receipt.status).toBe('repaired');
    expect(receipt.orphanCreditRows).toBe(1);
    expect(receipt.ledgerTotal).toBe(0);
    expect(receipt.counterTotalAfter).toBe(0);
    const byId = new Map<string, any>(receipt.children.map((c: any) => [c.goalId, c]));
    expect(byId.get(fx.goalB)).toMatchObject({
      ledgerTotal: 0,
      counterTotalBefore: 250,
      counterTotalAfter: 0,
      creditRows: 0,
      repaired: true,
    });
    // The orphan's 70 reached nothing.
    expect(receipt.children.some((c: any) => c.goalId === foreignGoalId)).toBe(false);
    expect(await parentCreditFor(setupId, fx.goalB)).toBe(0);
    expect(
      (await db.collection(`wsfCombinedCounters/${setupId}/shards`).get()).docs.some((d) =>
        d.id.startsWith(`${foreignGoalId}_`)
      )
    ).toBe(false);
  }, 45_000);

  // ── 36. A LEDGER IT CANNOT READ ─────────────────────────────────────────
  //
  // PROVES the stated behaviour when the scan cannot be trusted: it writes
  // NOTHING and says so. This is the same refusal the row bound produces.
  test('a ledger it cannot fully read is reported and never repaired from', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);
    const db = getFirestore();
    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'unread-a-001', count: 20 });
    // A row this build cannot parse.
    await db.doc(`wsfCombinedCredits/${uniq('broken')}`).set({
      setupId,
      goalId: fx.goalA,
      source: 'contribution',
      amount: 'twenty',
    });
    await corruptUnusedShard(setupId, fx.goalA, 111);

    const r = await repair(fx.champ, { setupId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const receipt = r.value as any;

    expect(receipt.status).toBe('notVerified');
    expect(receipt.unreadableCreditRows).toBe(1);
    expect(receipt.childrenRepaired).toBe(0);
    // It still STATES the discrepancy it found.
    expect(receipt.counterTotalBefore).toBe(131);
    expect(receipt.discrepancyTotal).toBe(-111);
    expect(receipt.children.every((c: any) => c.repaired === false)).toBe(true);
    // And the counter is exactly as it was.
    expect(await parentCreditFor(setupId, fx.goalA)).toBe(131);
  }, 45_000);

  // ── 37. THE BOUND IS PUBLISHED ──────────────────────────────────────────
  test('the receipt states the bound it worked under', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);
    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'bound-a-0001', count: 1 });

    const r = await repair(fx.champ, { setupId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const receipt = r.value as any;
    expect(receipt.creditScanLimit).toBe(2000);
    expect(receipt.scanComplete).toBe(true);
    expect(receipt.creditRowsExamined).toBeLessThanOrEqual(receipt.creditScanLimit);
    expect(typeof receipt.checkedAt).toBe('string');
    expect(Number.isNaN(Date.parse(receipt.checkedAt))).toBe(false);
    expect(receipt.setupId).toBe(setupId);
    expect(receipt.setupVersion).toBe(1);
  }, 45_000);

  // ── 38. AUTHORIZATION ───────────────────────────────────────────────────
  //
  // PROVES: only a foundingChampion of THAT community may run it, and a
  // caller without the authority gets the same answer an unknown setup gets.
  test('the recovery is refused to anyone who is not a Champion of that community', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);
    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'authz-a-0001', count: 20 });
    // Something to repair, so a leak would be worth having.
    await corruptUnusedShard(setupId, fx.goalA, 500);

    const anon = await repair(null, { setupId });
    expect(anon.ok).toBe(false);
    if (!anon.ok) expect(anon.error.code).toBe('unauthenticated');

    const member = await repair(fx.m1, { setupId });
    expect(member.ok).toBe(false);
    if (!member.ok) {
      expect(member.error.code).toBe('not-found');
      expect(member.error.message).toBe('This link is not valid.');
    }

    const stranger = await repair(uniq('outsider'), { setupId });
    expect(stranger.ok).toBe(false);
    if (!stranger.ok) expect(stranger.error.code).toBe('not-found');

    // A Champion of a DIFFERENT community is a stranger here.
    const otherChamp = uniq('otherChamp');
    await seedCommunity(otherChamp);
    const foreign = await repair(otherChamp, { setupId });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.error.code).toBe('not-found');

    // An unknown setup is the SAME answer, so this is not an oracle.
    const unknown = await repair(fx.champ, { setupId: uniq('nosuchsetup') });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.error.code).toBe('not-found');
      expect(unknown.error.message).toBe('This link is not valid.');
    }

    const missing = await repair(fx.champ, {});
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('invalid-argument');

    // NOT ONE OF THOSE REFUSALS REPAIRED ANYTHING.
    expect(await parentCreditFor(setupId, fx.goalA)).toBe(520);
  }, 45_000);

  // ── 39. THE CORRECTION LEDGER IS PART OF THE REBUILD ────────────────────
  //
  // PROVES: a parent rebuilt from rows includes the corrections, so recovery
  // and correction agree rather than each having their own arithmetic.
  test('a parent is rebuilt from contribution AND correction rows together', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);
    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'mix-a-000001', count: 20 });
    await adjust(fx.champ, {
      goalId: fx.goalA,
      delta: -5,
      targetUid: fx.m1,
      attemptId: 'mix-a-000001',
      correctionId: 'mix-fix-0001',
      reason: 'Miscounted by five.',
    });
    expect(await parentCreditFor(setupId, fx.goalA)).toBe(15);

    // Wipe the counter entirely, as a bad restore would.
    const shards = await getFirestore()
      .collection(`wsfCombinedCounters/${setupId}/shards`)
      .get();
    await Promise.all(shards.docs.map((d) => d.ref.delete()));
    expect(await parentCreditFor(setupId, fx.goalA)).toBe(0);

    const r = await repair(fx.champ, { setupId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const receipt = r.value as any;
    // 20 − 5, from the two rows and from nothing else.
    expect(receipt.ledgerTotal).toBe(15);
    expect(receipt.counterTotalAfter).toBe(15);
    expect(receipt.status).toBe('repaired');
    const a = receipt.children.find((c: any) => c.goalId === fx.goalA);
    expect(a.creditRows).toBe(2);
    expect(await parentCreditFor(setupId, fx.goalA)).toBe(15);
  }, 45_000);
});
