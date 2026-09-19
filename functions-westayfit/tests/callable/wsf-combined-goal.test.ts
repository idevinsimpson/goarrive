/**
 * COMBINED MOVEMENT GOAL — the parent counts only what was earned for it.
 *
 * THIS FILE WAS REWRITTEN AFTER THE DIRECTOR REFUSED THE FIRST IMPLEMENTATION.
 * The old build derived the parent's total from the sum of its children's
 * LIFETIME shards. Two defects followed and both were real: activating a setup
 * over a child that already had repetitions showed those repetitions in the
 * combined total immediately (silent backfill), and one child could feed two
 * active parents at once.
 *
 * The assertions that encoded that behaviour are marked SUPERSEDED where they
 * changed, with what they used to say, so a reader can see what moved and why.
 *
 * What this file now pins:
 *   • activation is a BOUNDARY: a setup frozen over children with nonzero
 *     totals opens at exactly zero, and its counter documents do not yet exist
 *     (test 17);
 *   • one new attempt credits the child AND the parent, exactly once each,
 *     with one durable linkage row (test 18);
 *   • a retried attemptId credits neither a second time (test 19);
 *   • a correction moves both, once each, and the ledger says by how much
 *     (test 20);
 *   • an attempt outside the FROZEN window, and one on a released claim,
 *     credit the child and not the parent (tests 21 and 22);
 *   • a child cannot join a second ACTIVE parent, and closing the first gives
 *     it back — to a new parent that still opens at zero (test 23);
 *   • a full cycle writes exactly the rows it should and no others, and
 *     wsfGoalPulse still returns exactly its nine keys (test 24);
 *   • A GOAL IN NO COMBINED SETUP IS UNCHANGED, field for field, row for row,
 *     receipt for receipt (test 25). This is the one the change to
 *     wsfContribute has to earn.
 *
 * THE CACHE. wsfCombinedGoalPulse holds a 2 s per-instance entry per setupId,
 * consulted AFTER the access decision. Any test that changes a total and then
 * re-reads the SAME setup waits past that TTL first (`afterCacheTtl`), so what
 * it asserts is a fresh derivation and not a cached one. The authorization
 * tests deliberately do NOT wait: the point there is that a revocation takes
 * effect on the very next read, because the gate precedes the cache.
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
  wsfMyContribution,
  wsfSetGoalDisplayAuthorization,
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

/** An unverified account: authenticated, but not yet email-verified. */
function unverifiedRequest(uid: string, data: Data) {
  return {
    auth: { uid, token: { email_verified: false } as any } as any,
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
const myContribution = (uid: string | null, data: Data) =>
  attempt(() => wsfMyContribution.run(request(uid, data)));
const setDisplayAuth = (uid: string | null, data: Data) =>
  attempt(() => wsfSetGoalDisplayAuthorization.run(request(uid, data)));
const closeCombined = (uid: string | null, data: Data) =>
  attempt(() => wsfCloseCombinedGoal.run(request(uid, data)));

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

/** Every parent shard document this setup has, for counting rows. */
async function parentShardDocs(setupId: string) {
  return getFirestore().collection(`wsfCombinedCounters/${setupId}/shards`).get();
}

/** The durable linkage rows for one setup. A single-field equality. */
async function creditRows(setupId: string) {
  return getFirestore()
    .collection('wsfCombinedCredits')
    .where('setupId', '==', setupId)
    .get();
}

let seq = 0;
function uniq(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}_${Math.random().toString(36).slice(2, 7)}`;
}

/** A real community with real membership documents, so every lookup an
 * authorization decision makes actually finds something. */
async function seedCommunity(opts: {
  championUid: string;
  isSample?: boolean;
}): Promise<string> {
  const db = getFirestore();
  const groupId = uniq('combGroup');
  await db.doc(`wsfCommunityGroups/${groupId}`).set({
    displayName: 'Combined goal community',
    groupType: 'custom',
    joinPolicy: 'public',
    joinCode: uniq('code'),
    createdByUserId: opts.championUid,
    lifecycleStatus: 'active',
    isSample: opts.isSample === true,
  });
  await db.doc(`wsfMemberships/${groupId}_${opts.championUid}`).set({
    groupId,
    userId: opts.championUid,
    role: 'foundingChampion',
    membershipStatus: 'active',
  });
  return groupId;
}

async function seedMember(
  groupId: string,
  uid: string,
  opts?: { role?: string; membershipStatus?: string }
): Promise<void> {
  await getFirestore().doc(`wsfMemberships/${groupId}_${uid}`).set({
    groupId,
    userId: uid,
    role: opts?.role ?? 'member',
    membershipStatus: opts?.membershipStatus ?? 'active',
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
  status?: 'active' | 'closed';
}): Promise<string> {
  const ref = getFirestore().collection('wsfGoals').doc();
  await ref.set({
    ownerUid: opts.ownerUid,
    communityGroupId: opts.communityGroupId,
    title: opts.title,
    target: opts.target,
    unit: opts.unit,
    status: opts.status ?? 'active',
    startsAt: Timestamp.fromDate(opts.startsAt),
    endsAt: Timestamp.fromDate(opts.endsAt),
    timezone: 'America/New_York',
    // 'multiple' so one member may record several attempts on one activity;
    // the combined arithmetic is about totals, not about who recorded them.
    repeatPolicy: 'multiple',
    createdAt: new Date(),
  });
  return ref.id;
}

/**
 * THE FIXTURE, exactly as the design names it.
 *
 * Combined window [T, T+14d); child A "Squats" target 1000 unit "squats" and
 * child B "Push-ups" target 800 unit "push-ups", both with window
 * [T+1d, T+8d) — strictly inside the combined window — except that both are
 * open NOW so wsfContribute accepts contributions during the test. T is
 * therefore one day before now, which keeps the containment true and the
 * children live at the same time.
 */
async function seedFixture(opts?: { isSample?: boolean }) {
  const champ = uniq('champ');
  const groupId = await seedCommunity({ championUid: champ, isSample: opts?.isSample });
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
    combinedStart,
    combinedEnd,
    childStart,
    childEnd,
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

describe('wsfCreateCombinedGoal / wsfCombinedGoalPulse', () => {
  beforeAll(async () => {
    await getFirestore().doc('_warmup/wsf-combined-goal').set({ at: Date.now() });
  }, 30_000);

  // ── 1. create — happy path ──────────────────────────────────────────────
  test('the setup is persisted with its frozen rule, its children, and NO total', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);

    const snap = await getFirestore().doc(`wsfCombinedGoals/${setupId}`).get();
    expect(snap.exists).toBe(true);
    const doc = snap.data() as Record<string, unknown>;

    expect(doc.contributionRule).toBe('childWindowWithin');
    expect(doc.contributionRuleVersion).toBe(1);
    expect(doc.status).toBe('active');
    expect(doc.communityGroupId).toBe(fx.groupId);
    expect(doc.ownerUid).toBe(fx.champ);
    expect(doc.childGoalIds).toEqual([fx.goalA, fx.goalB]);

    const children = doc.children as Array<Record<string, unknown>>;
    expect(children).toHaveLength(2);
    for (const child of children) {
      // The whole conversion model of version 1, written out rather than
      // implied: one repetition of any eligible activity is one combined unit.
      expect(child.countsAs).toBe('repetition');
      // There is deliberately no factor field — an unapplied stored field is a
      // trap for the next reader.
      expect(Object.keys(child)).not.toContain('repetitionFactor');
    }
    expect(children[0]!.title).toBe('Squats');
    expect(children[0]!.unit).toBe('squats');
    expect(children[0]!.target).toBe(1000);
    expect(children[1]!.title).toBe('Push-ups');

    // THE FROZEN ACTIVATION, which is what the first implementation had no
    // concept of at all.
    expect(doc.version).toBe(1);
    expect((doc.activatedAt as Timestamp).toMillis()).toBeGreaterThan(0);
    expect((doc.activatedAt as Timestamp).toMillis()).toBeLessThanOrEqual(Date.now() + 1_000);

    // The setup document still stores no total of its own: the parent's number
    // lives in sharded counters written by the contribution transaction, not
    // in a field here that a job could forget to update.
    const keys = Object.keys(doc);
    expect(keys).not.toContain('combinedTotal');
    expect(keys).not.toContain('sharedTotal');
    expect(keys).not.toContain('total');
    expect(keys).not.toContain('reachedAt');

    // THE CLAIMS, written in the SAME transaction as the setup: one per child,
    // named by the child goal id, carrying the frozen boundary itself.
    for (const goalId of [fx.goalA, fx.goalB]) {
      const claimSnap = await getFirestore().doc(`wsfCombinedGoalClaims/${goalId}`).get();
      expect(claimSnap.exists).toBe(true);
      const claim = claimSnap.data() as Record<string, unknown>;
      expect(claim.setupId).toBe(setupId);
      expect(claim.setupVersion).toBe(1);
      expect(claim.status).toBe('active');
      expect(claim.goalId).toBe(goalId);
      expect(claim.communityGroupId).toBe(fx.groupId);
      expect(claim.contributionRuleVersion).toBe(1);
      expect((claim.activatedAt as Timestamp).toMillis()).toBe(
        (doc.activatedAt as Timestamp).toMillis()
      );
      expect((claim.windowStartsAt as Timestamp).toMillis()).toBe(
        (doc.startsAt as Timestamp).toMillis()
      );
      expect((claim.windowEndsAt as Timestamp).toMillis()).toBe(
        (doc.endsAt as Timestamp).toMillis()
      );
    }

    // AND NOTHING HAS BEEN CREDITED. Activation writes no counter and no
    // credit row: the parent opens empty because it is empty.
    expect((await parentShardDocs(setupId)).size).toBe(0);
    expect((await creditRows(setupId)).size).toBe(0);
  });

  // ── 2. create — authority ───────────────────────────────────────────────
  test('only a verified, active foundingChampion of the community may freeze a setup', async () => {
    const fx = await seedFixture();

    const anon = await createCombined(null, fx.createArgs);
    expect(anon.ok).toBe(false);
    if (!anon.ok) expect(anon.error.code).toBe('unauthenticated');

    const unverified = await attempt(() =>
      wsfCreateCombinedGoal.run(unverifiedRequest(fx.champ, fx.createArgs))
    );
    expect(unverified.ok).toBe(false);
    if (!unverified.ok) {
      expect(unverified.error.code).toBe('failed-precondition');
      expect(unverified.error.message).toBe('Verify your email before starting a goal.');
    }

    const member = await createCombined(fx.m1, fx.createArgs);
    expect(member.ok).toBe(false);
    if (!member.ok) expect(member.error.code).toBe('permission-denied');

    const stranger = await createCombined(uniq('outsider'), fx.createArgs);
    expect(stranger.ok).toBe(false);
    if (!stranger.ok) expect(stranger.error.code).toBe('permission-denied');
  });

  // ── 3. create — refusals ────────────────────────────────────────────────
  test('an unknown child and a child in another community are the SAME generic answer', async () => {
    const fx = await seedFixture();
    const other = await seedFixture();

    const unknown = await createCombined(fx.champ, {
      ...fx.createArgs,
      childGoalIds: [fx.goalA, uniq('nosuchgoal')],
    });
    const foreign = await createCombined(fx.champ, {
      ...fx.createArgs,
      childGoalIds: [fx.goalA, other.goalA],
    });

    expect(unknown.ok).toBe(false);
    expect(foreign.ok).toBe(false);
    if (unknown.ok || foreign.ok) return;
    expect(unknown.error.code).toBe('not-found');
    // Byte-identical, so this callable cannot become an oracle for which goal
    // ids exist in a community the caller is not a Champion of.
    expect(foreign.error.code).toBe(unknown.error.code);
    expect(foreign.error.message).toBe(unknown.error.message);
  });

  test('the child list is refused at 1, at 7, and on a duplicate', async () => {
    const fx = await seedFixture();

    const one = await createCombined(fx.champ, { ...fx.createArgs, childGoalIds: [fx.goalA] });
    expect(one.ok).toBe(false);
    if (!one.ok) expect(one.error.code).toBe('invalid-argument');

    const seven = await createCombined(fx.champ, {
      ...fx.createArgs,
      childGoalIds: [fx.goalA, fx.goalB, fx.goalA, fx.goalB, fx.goalA, fx.goalB, fx.goalA],
    });
    expect(seven.ok).toBe(false);
    if (!seven.ok) expect(seven.error.code).toBe('invalid-argument');

    // THE ONLY WAY THIS DESIGN COULD DOUBLE-COUNT, refused at the boundary.
    const dupe = await createCombined(fx.champ, {
      ...fx.createArgs,
      childGoalIds: [fx.goalA, fx.goalA],
    });
    expect(dupe.ok).toBe(false);
    if (!dupe.ok) {
      expect(dupe.error.code).toBe('invalid-argument');
      expect(dupe.error.message).toBe('Each activity may be listed once.');
    }
  });

  test('a child whose window escapes the combined window by one millisecond is refused', async () => {
    const fx = await seedFixture();
    const late = await seedGoal({
      communityGroupId: fx.groupId,
      ownerUid: fx.champ,
      title: 'Lunges',
      target: 500,
      unit: 'lunges',
      startsAt: fx.childStart,
      endsAt: new Date(fx.combinedEnd.getTime() + 1),
    });

    const r = await createCombined(fx.champ, {
      ...fx.createArgs,
      childGoalIds: [fx.goalA, late],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('failed-precondition');
      expect(r.error.message).toBe(
        "Every activity's own period must sit inside the combined period."
      );
    }
  });

  // ── 4. 20 then 15 giving 35 — the Director's case ───────────────────────
  test('20 on one activity and 15 on another is 35 combined, and each keeps its own goal', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);

    const a = await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'attempt-a1xx', count: 20 });
    expect(a.ok).toBe(true);
    const b = await contribute(fx.m1, { goalId: fx.goalB, attemptId: 'attempt-b1xx', count: 15 });
    expect(b.ok).toBe(true);

    const p = await combinedPulse(fx.m1, { setupId });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const pulse = p.value as any;
    expect(pulse.combinedTotal).toBe(35);

    const byId = new Map<string, any>(pulse.activities.map((x: any) => [x.goalId, x]));
    expect(byId.get(fx.goalA)!.total).toBe(20);
    expect(byId.get(fx.goalB)!.total).toBe(15);
    // Both activities started empty and were contributed to AFTER activation,
    // so here — and only here — the activity's own total and what it counted
    // toward the parent are the same number. Test 17 is the case where they
    // are not, and it is the case the first implementation got wrong.
    expect(byId.get(fx.goalA)!.combinedContribution).toBe(20);
    expect(byId.get(fx.goalB)!.combinedContribution).toBe(15);

    // EACH ACTIVITY KEEPS ITS OWN GOAL AND ITS OWN TOTAL. Enrolment wrote
    // nothing to either goal document.
    const pa = await goalPulse(fx.m1, { goalId: fx.goalA });
    const pb = await goalPulse(fx.m1, { goalId: fx.goalB });
    expect(pa.ok && (pa.value as any).sharedTotal).toBe(20);
    expect(pb.ok && (pb.value as any).sharedTotal).toBe(15);
    expect(pa.ok && (pa.value as any).target).toBe(1000);
    expect(pb.ok && (pb.value as any).target).toBe(800);
    expect(pa.ok && (pa.value as any).unit).toBe('squats');
    expect(pb.ok && (pb.value as any).unit).toBe('push-ups');
    // And the activity's own target is what the combined screen reports for
    // it — not a share of the combined target.
    expect(byId.get(fx.goalA)!.target).toBe(1000);
    expect(byId.get(fx.goalB)!.target).toBe(800);
  }, 30_000);

  // ── 5. retried attemptId ────────────────────────────────────────────────
  test('a retried attemptId counts once, and a replay with a different count still reports the original', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);

    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'attempt-a1xx', count: 20 });
    await contribute(fx.m1, { goalId: fx.goalB, attemptId: 'attempt-b1xx', count: 15 });

    const replay = await contribute(fx.m1, {
      goalId: fx.goalA,
      attemptId: 'attempt-a1xx',
      count: 20,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect((replay.value as any).alreadyRecorded).toBe(true);
    expect((replay.value as any).addedCount).toBe(20);

    // Exactly one stored contribution for that attempt, forever.
    const rows = await getFirestore()
      .collection('wsfContributions')
      .where('goalId', '==', fx.goalA)
      .get();
    expect(rows.size).toBe(1);

    // A replay that asks for a DIFFERENT count still reports the original,
    // and still moves nothing.
    const lying = await contribute(fx.m1, {
      goalId: fx.goalA,
      attemptId: 'attempt-a1xx',
      count: 99,
    });
    expect(lying.ok).toBe(true);
    if (lying.ok) expect((lying.value as any).addedCount).toBe(20);

    await afterCacheTtl();
    const p = await combinedPulse(fx.m1, { setupId });
    expect(p.ok && (p.value as any).combinedTotal).toBe(35);
    const pa = await goalPulse(fx.m1, { goalId: fx.goalA });
    expect(pa.ok && (pa.value as any).sharedTotal).toBe(20);
  }, 30_000);

  // ── 6. correction, both directions ──────────────────────────────────────
  test('a −5 correction takes the combined total to 30, and a +5 puts it back at 35', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);

    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'attempt-a1xx', count: 20 });
    await contribute(fx.m1, { goalId: fx.goalB, attemptId: 'attempt-b1xx', count: 15 });

    // SUPERSEDED ARGUMENTS, not a superseded number. A correction now says
    // WHICH contribution it corrects (attemptId) and carries its own
    // idempotency key (correctionId). Without them this is a tally correction
    // that names no credit, and a correction that names no credit never moves
    // a parent — see test 26.
    const down = await adjust(fx.champ, {
      goalId: fx.goalA,
      delta: -5,
      targetUid: fx.m1,
      attemptId: 'attempt-a1xx',
      correctionId: 'corr-a1-down',
      reason: 'Miscounted by five.',
    });
    expect(down.ok).toBe(true);

    await afterCacheTtl();
    const afterDown = await combinedPulse(fx.m1, { setupId });
    expect(afterDown.ok).toBe(true);
    if (!afterDown.ok) return;
    expect((afterDown.value as any).combinedTotal).toBe(30);
    const aDown = (afterDown.value as any).activities.find((x: any) => x.goalId === fx.goalA);
    expect(aDown.total).toBe(15);

    const pa = await goalPulse(fx.m1, { goalId: fx.goalA });
    expect(pa.ok && (pa.value as any).sharedTotal).toBe(15);
    const mine = await myContribution(fx.m1, { goalId: fx.goalA });
    expect(mine.ok && (mine.value as any).ownCredit).toBe(15);

    // The correction was recorded once and only once.
    const audits = await getFirestore()
      .collection('wsfGoalAdjustments')
      .where('goalId', '==', fx.goalA)
      .get();
    expect(audits.size).toBe(1);
    // SUPERSEDED REASONING, not a superseded number. The old build reached 30
    // with NO combined-goal code running at all, because the parent was a sum
    // of the children. The parent now has its own counter, so the correction
    // has to move it — and it does, by the same delta, once. Three credit rows
    // exist here: two contributions and one adjustment.
    expect(await parentCreditFor(setupId, fx.goalA)).toBe(15);
    expect((await creditRows(setupId)).size).toBe(3);

    const up = await adjust(fx.champ, {
      goalId: fx.goalA,
      delta: 5,
      targetUid: fx.m1,
      attemptId: 'attempt-a1xx',
      correctionId: 'corr-a1-backup',
      reason: 'Restoring the five.',
    });
    expect(up.ok).toBe(true);

    await afterCacheTtl();
    const afterUp = await combinedPulse(fx.m1, { setupId });
    expect(afterUp.ok && (afterUp.value as any).combinedTotal).toBe(35);
    const paUp = await goalPulse(fx.m1, { goalId: fx.goalA });
    expect(paUp.ok && (paUp.value as any).sharedTotal).toBe(20);
  }, 30_000);

  // ── 7. concurrency ──────────────────────────────────────────────────────
  test('ten parallel contributions across two activities derive exactly 100', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);

    await Promise.all([
      ...[0, 1, 2, 3, 4].map((i) =>
        contribute(fx.m1, { goalId: fx.goalA, attemptId: `par-a-00${i}`, count: 10 })
      ),
      ...[0, 1, 2, 3, 4].map((i) =>
        contribute(fx.m1, { goalId: fx.goalB, attemptId: `par-b-00${i}`, count: 10 })
      ),
    ]);

    const p = await combinedPulse(fx.m1, { setupId });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect((p.value as any).combinedTotal).toBe(100);
    const byId = new Map<string, any>((p.value as any).activities.map((x: any) => [x.goalId, x]));
    expect(byId.get(fx.goalA)!.total).toBe(50);
    expect(byId.get(fx.goalB)!.total).toBe(50);
  }, 30_000);

  // ── 8. the two response contracts ───────────────────────────────────────
  test('the nine-field goal pulse is still exactly nine fields, and the combined pulse is its own exact key set', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);
    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'attempt-a1xx', count: 20 });

    // A REGRESSION GUARD ON THIS WORK, pinned here so a future combined-goal
    // change trips it, in addition to wsf-goal-pulse.test.ts's own guard.
    for (const goalId of [fx.goalA, fx.goalB]) {
      const r = await goalPulse(fx.m1, { goalId });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(Object.keys(r.value as object).sort()).toEqual(
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
    }

    const p = await combinedPulse(fx.m1, { setupId });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    // SUPERSEDED: this list used to omit `activatedAt` and `version`. Both are
    // now published because a total with no stated boundary is exactly how the
    // first implementation came to show repetitions nobody performed for it,
    // and a credit must be attributable to the freeze that earned it.
    expect(Object.keys(p.value as object).sort()).toEqual(
      [
        'activatedAt',
        'activities',
        'combinedTotal',
        'communityDisplayName',
        'contributionRule',
        'contributionRuleVersion',
        'endsAt',
        'setupId',
        'startsAt',
        'status',
        'target',
        'timezone',
        'title',
        'unit',
        'version',
      ].sort()
    );
    // NOTHING ABOUT A PERSON is in the response, at either level.
    const json = JSON.stringify(p.value);
    expect(json).not.toContain(fx.m1);
    expect(json).not.toContain(fx.champ);
    expect(json).not.toContain('contributorCount');
    expect(json).not.toContain('ownerUid');
    expect(json).not.toContain('joinCode');

    // SUPERSEDED: this list used to omit `combinedContribution`. An activity
    // now reports TWO numbers — its own lifetime total, unchanged, and what it
    // has counted toward this combined goal — because those are different
    // facts and the old build published one of them as the other.
    for (const activity of (p.value as any).activities) {
      expect(Object.keys(activity).sort()).toEqual(
        [
          'combinedContribution',
          'countsAs',
          'goalId',
          'status',
          'target',
          'title',
          'total',
          'unit',
        ].sort()
      );
    }
  }, 30_000);

  // ── 9. gate — member route ──────────────────────────────────────────────
  test('an active member reads it with no child authorized; an outsider does not', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);

    const member = await combinedPulse(fx.m1, { setupId });
    expect(member.ok).toBe(true);

    const anon = await combinedPulse(null, { setupId });
    expect(anon.ok).toBe(false);
    if (!anon.ok) expect(anon.error.code).toBe('not-found');

    const removed = uniq('gone');
    await seedMember(fx.groupId, removed, { membershipStatus: 'removed' });
    const removedRead = await combinedPulse(removed, { setupId });
    expect(removedRead.ok).toBe(false);
    if (!removedRead.ok) expect(removedRead.error.code).toBe('not-found');

    // An unknown setup id and an unauthorized one are the same answer.
    const unknown = await combinedPulse(null, { setupId: uniq('nosuchsetup') });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok && !anon.ok) {
      expect(unknown.error.code).toBe(anon.error.code);
      expect(unknown.error.message).toBe(anon.error.message);
    }
  });

  // ── 10. gate — display route, and revocation on the VERY NEXT read ──────
  test('every child authorized opens the display route; revoking one closes it immediately', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);

    await setDisplayAuth(fx.champ, { goalId: fx.goalA, authorized: true });
    await setDisplayAuth(fx.champ, { goalId: fx.goalB, authorized: true });

    const open = await combinedPulse(null, { setupId });
    expect(open.ok).toBe(true);

    // NO WAIT. The gate is evaluated before the cache is consulted, so the
    // very next read after a revocation is refused rather than being served a
    // cached entry for up to two seconds.
    await setDisplayAuth(fx.champ, { goalId: fx.goalB, authorized: false });
    const closed = await combinedPulse(null, { setupId });
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.error.code).toBe('not-found');

    await setDisplayAuth(fx.champ, { goalId: fx.goalB, authorized: true });
    const reopened = await combinedPulse(null, { setupId });
    expect(reopened.ok).toBe(true);
  }, 30_000);

  // ── 11. gate — partial authorization ────────────────────────────────────
  test('one child authorized is not enough: it is every child, not any child', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);

    await setDisplayAuth(fx.champ, { goalId: fx.goalA, authorized: true });

    const anon = await combinedPulse(null, { setupId });
    expect(anon.ok).toBe(false);
    if (!anon.ok) expect(anon.error.code).toBe('not-found');

    // The member route is unaffected: members see their own community.
    const member = await combinedPulse(fx.m1, { setupId });
    expect(member.ok).toBe(true);
  });

  // ── 12. gate — sample suppression ───────────────────────────────────────
  test('a sample community never reaches the display route, and still reaches its own members', async () => {
    const fx = await seedFixture({ isSample: true });
    const setupId = await freeze(fx);

    await setDisplayAuth(fx.champ, { goalId: fx.goalA, authorized: true });
    await setDisplayAuth(fx.champ, { goalId: fx.goalB, authorized: true });

    const anon = await combinedPulse(null, { setupId });
    expect(anon.ok).toBe(false);
    if (!anon.ok) expect(anon.error.code).toBe('not-found');

    const member = await combinedPulse(fx.m1, { setupId });
    expect(member.ok).toBe(true);
  }, 30_000);

  // ── 13. a missing child ─────────────────────────────────────────────────
  test('a combined goal that cannot name all of its parts renders none of itself', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);
    await setDisplayAuth(fx.champ, { goalId: fx.goalA, authorized: true });
    await setDisplayAuth(fx.champ, { goalId: fx.goalB, authorized: true });

    await getFirestore().doc(`wsfGoals/${fx.goalA}`).delete();

    const member = await combinedPulse(fx.m1, { setupId });
    const anon = await combinedPulse(null, { setupId });
    expect(member.ok).toBe(false);
    expect(anon.ok).toBe(false);
    if (member.ok || anon.ok) return;
    expect(member.error.code).toBe('not-found');
    // The same message an unknown setupId gets.
    const unknown = await combinedPulse(null, { setupId: uniq('nosuchsetup') });
    if (!unknown.ok) expect(member.error.message).toBe(unknown.error.message);
  }, 30_000);

  // ── 14. a closed child ──────────────────────────────────────────────────
  test('closing an activity stops contributions and does NOT erase what it contributed', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);
    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'attempt-a1xx', count: 20 });
    await contribute(fx.m1, { goalId: fx.goalB, attemptId: 'attempt-b1xx', count: 15 });

    await getFirestore().doc(`wsfGoals/${fx.goalA}`).update({ status: 'closed' });

    const refused = await contribute(fx.m1, {
      goalId: fx.goalA,
      attemptId: 'attempt-a2xx',
      count: 5,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe('failed-precondition');

    await afterCacheTtl();
    const p = await combinedPulse(fx.m1, { setupId });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect((p.value as any).combinedTotal).toBe(35);
    const a = (p.value as any).activities.find((x: any) => x.goalId === fx.goalA);
    expect(a.total).toBe(20);
    expect(a.status).toBe('closed');
  }, 30_000);

  // ── 15. a hand-widened child window is not counted ──────────────────────
  test('the frozen rule is re-checked on every read, so a hand edit cannot widen what counts', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);
    const ok = await combinedPulse(fx.m1, { setupId });
    expect(ok.ok).toBe(true);

    // Push child A's end past the combined end, as only a hand edit could.
    await getFirestore()
      .doc(`wsfGoals/${fx.goalA}`)
      .update({ endsAt: Timestamp.fromDate(new Date(fx.combinedEnd.getTime() + 60_000)) });

    const after = await combinedPulse(fx.m1, { setupId });
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error.code).toBe('not-found');
  }, 30_000);

  // ── 16. the setupId is a name, not a capability ─────────────────────────
  test('an absent setupId is refused, and the read writes nothing', async () => {
    const missing = await combinedPulse(null, {});
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('invalid-argument');

    const fx = await seedFixture();
    const setupId = await freeze(fx);
    const before = await getFirestore().doc(`wsfCombinedGoals/${setupId}`).get();
    await combinedPulse(fx.m1, { setupId });
    const after = await getFirestore().doc(`wsfCombinedGoals/${setupId}`).get();
    expect(after.data()).toEqual(before.data());
  }, 30_000);

  // ══════════════════════════════════════════════════════════════════════════
  // THE DIRECTOR'S TWO DEFECTS, AND THE GUARANTEES THAT REPLACE THEM
  // ══════════════════════════════════════════════════════════════════════════

  // ── 17. NO SILENT BACKFILL ──────────────────────────────────────────────
  test('activating a combined goal over activities that already have totals opens it at ZERO', async () => {
    const fx = await seedFixture();

    // NONZERO BEFORE ACTIVATION. These repetitions are real, they belong to
    // the activities, and nobody performed them for a combined goal that did
    // not exist yet.
    const a = await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'pre-a-0001', count: 500 });
    const b = await contribute(fx.m1, { goalId: fx.goalB, attemptId: 'pre-b-0001', count: 300 });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);

    const setupId = await freeze(fx);

    const p = await combinedPulse(fx.m1, { setupId });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const pulse = p.value as any;

    // THE ASSERTION THE WHOLE CORRECTION EXISTS FOR. The old build reported
    // 800 here, on the spot, for work done before the Champion decided the
    // combined goal existed.
    expect(pulse.combinedTotal).toBe(0);

    const byId = new Map<string, any>(pulse.activities.map((x: any) => [x.goalId, x]));
    // Each activity KEEPS its own total. Nothing was taken away from it, and
    // nothing was moved.
    expect(byId.get(fx.goalA)!.total).toBe(500);
    expect(byId.get(fx.goalB)!.total).toBe(300);
    // And contributed nothing to the parent, because it contributed nothing
    // to the parent.
    expect(byId.get(fx.goalA)!.combinedContribution).toBe(0);
    expect(byId.get(fx.goalB)!.combinedContribution).toBe(0);

    // The activities' own pages are untouched.
    const pa = await goalPulse(fx.m1, { goalId: fx.goalA });
    expect(pa.ok && (pa.value as any).sharedTotal).toBe(500);

    // ZERO BY ABSENCE, NOT BY SUBTRACTION: the parent's counter documents do
    // not exist. There is nothing to have got the arithmetic wrong about.
    expect((await parentShardDocs(setupId)).size).toBe(0);
    expect((await creditRows(setupId)).size).toBe(0);

    // The boundary is published, so the screen can say what the total is SINCE.
    expect(typeof pulse.activatedAt).toBe('string');
    expect(Number.isNaN(Date.parse(pulse.activatedAt))).toBe(false);
  }, 30_000);

  test('a repetition recorded AFTER activation counts, and the ones before it still do not', async () => {
    const fx = await seedFixture();
    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'pre-a-0002', count: 500 });
    const setupId = await freeze(fx);
    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'post-a-0001', count: 7 });

    await afterCacheTtl();
    const p = await combinedPulse(fx.m1, { setupId });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    // 7, not 507. The line is the activation instant and it holds in both
    // directions at once.
    expect((p.value as any).combinedTotal).toBe(7);
    const a = (p.value as any).activities.find((x: any) => x.goalId === fx.goalA);
    expect(a.total).toBe(507);
    expect(a.combinedContribution).toBe(7);
  }, 30_000);

  // ── 18. ONE ATTEMPT, ONE CHILD CREDIT, ONE PARENT CREDIT ────────────────
  test('one new attempt credits the child and the parent exactly once each, with one linkage row', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);

    const r = await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'one-a-0001', count: 20 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.value as any).addedCount).toBe(20);
    expect((r.value as any).alreadyRecorded).toBe(false);

    // THE CHILD, once.
    const pa = await goalPulse(fx.m1, { goalId: fx.goalA });
    expect(pa.ok && (pa.value as any).sharedTotal).toBe(20);
    const contributions = await getFirestore()
      .collection('wsfContributions')
      .where('goalId', '==', fx.goalA)
      .get();
    expect(contributions.size).toBe(1);

    // THE PARENT, once, in the same transaction.
    expect(await parentCreditFor(setupId, fx.goalA)).toBe(20);
    const p = await combinedPulse(fx.m1, { setupId });
    expect(p.ok && (p.value as any).combinedTotal).toBe(20);

    // THE DURABLE LINKAGE: one row, naming the setup, its version, the child,
    // the member and the attempt. This is what a recovery rebuilds from.
    const credits = await creditRows(setupId);
    expect(credits.size).toBe(1);
    const credit = credits.docs[0]!.data() as Record<string, unknown>;
    expect(credit.setupId).toBe(setupId);
    expect(credit.setupVersion).toBe(1);
    expect(credit.contributionRuleVersion).toBe(1);
    expect(credit.goalId).toBe(fx.goalA);
    expect(credit.userId).toBe(fx.m1);
    expect(credit.attemptId).toBe('one-a-0001');
    expect(credit.source).toBe('contribution');
    expect(credit.amount).toBe(20);

    // ITS NAME IS THE CONTRIBUTION'S NAME.
    //
    // SUPERSEDED: this used to assert `${setupId}_${goalId}_${uid}_${attemptId}`.
    // The setup id has been dropped from the name, because a CORRECTION has to
    // find this row from the only three facts that name a contribution — the
    // goal, the member and the attempt — and a name carrying the setup id made
    // it findable only by someone who already knew the answer. Nothing is lost:
    // (goalId, uid, attemptId) is already unique, since wsfContribute refuses a
    // second contribution under the same triple, so no two setups can ever
    // credit the same attempt. The setup id is a FIELD on the row, asserted
    // above, which is where a fact a correction reads back belongs.
    expect(credits.docs[0]!.id).toBe(`${fx.goalA}_${fx.m1}_one-a-0001`);
    // IT STILL CARRIES THE UID. The hazard already in this code is
    // wsfGoals/{goalId}/recentAdditions/{attemptId}, keyed by an attempt id
    // with no uid in the path, which two members minting the same attemptId
    // collide on. This row does not repeat it.
    expect(credits.docs[0]!.id).toContain(fx.m1);
    // AND IT IS EXACTLY THE CONTRIBUTION ROW'S NAME, in its own collection.
    expect(credits.docs[0]!.id).toBe(
      (
        await getFirestore()
          .collection('wsfContributions')
          .where('goalId', '==', fx.goalA)
          .get()
      ).docs[0]!.id
    );

    // Two members, the SAME attemptId, two separate parent credits — which is
    // the collision the id shape exists to avoid.
    const m2 = uniq('m2');
    await seedMember(fx.groupId, m2);
    const second = await contribute(m2, { goalId: fx.goalA, attemptId: 'one-a-0001', count: 3 });
    expect(second.ok).toBe(true);
    if (second.ok) expect((second.value as any).alreadyRecorded).toBe(false);
    expect(await parentCreditFor(setupId, fx.goalA)).toBe(23);
    expect((await creditRows(setupId)).size).toBe(2);
  }, 30_000);

  // ── 19. RETRY ───────────────────────────────────────────────────────────
  test('a retried attemptId credits neither the child nor the parent a second time', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);

    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'retry-a-001', count: 20 });
    const replay = await contribute(fx.m1, {
      goalId: fx.goalA,
      attemptId: 'retry-a-001',
      count: 20,
    });
    // A replay asking for a DIFFERENT count still reports the original and
    // still moves nothing, on either side.
    const lying = await contribute(fx.m1, {
      goalId: fx.goalA,
      attemptId: 'retry-a-001',
      count: 99,
    });

    expect(replay.ok).toBe(true);
    expect(lying.ok).toBe(true);
    if (replay.ok) {
      expect((replay.value as any).alreadyRecorded).toBe(true);
      expect((replay.value as any).addedCount).toBe(20);
    }
    if (lying.ok) expect((lying.value as any).addedCount).toBe(20);

    const pa = await goalPulse(fx.m1, { goalId: fx.goalA });
    expect(pa.ok && (pa.value as any).sharedTotal).toBe(20);
    // THE PARENT DID NOT MOVE EITHER, and there is still exactly one linkage
    // row. The replay branch returns before the credit block is reached, so
    // the parent's idempotency is the child's idempotency and not a second
    // mechanism that could disagree with it.
    expect(await parentCreditFor(setupId, fx.goalA)).toBe(20);
    expect((await creditRows(setupId)).size).toBe(1);
    expect((await parentShardDocs(setupId)).size).toBe(1);

    await afterCacheTtl();
    const p = await combinedPulse(fx.m1, { setupId });
    expect(p.ok && (p.value as any).combinedTotal).toBe(20);
  }, 30_000);

  // ── 20. CORRECTION ──────────────────────────────────────────────────────
  test('a correction moves the child and the parent by the same delta, once each', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);
    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'corr-a-0001', count: 20 });

    // SUPERSEDED ARGUMENTS: the correction now NAMES the contribution it
    // corrects and carries its own idempotency key. That is what links the
    // parent's movement to the credit rather than to the claim and the clock.
    const down = await adjust(fx.champ, {
      goalId: fx.goalA,
      delta: -5,
      targetUid: fx.m1,
      attemptId: 'corr-a-0001',
      correctionId: 'corr-a-fix01',
      reason: 'Miscounted by five.',
    });
    expect(down.ok).toBe(true);

    const pa = await goalPulse(fx.m1, { goalId: fx.goalA });
    expect(pa.ok && (pa.value as any).sharedTotal).toBe(15);
    expect(await parentCreditFor(setupId, fx.goalA)).toBe(15);

    await afterCacheTtl();
    const p = await combinedPulse(fx.m1, { setupId });
    expect(p.ok && (p.value as any).combinedTotal).toBe(15);

    // ONCE. One audit row, and one adjustment linkage row beside the one
    // contribution linkage row — named by the adjustment id, which the server
    // mints once per call, so a transaction retry cannot double it.
    const audits = await getFirestore()
      .collection('wsfGoalAdjustments')
      .where('goalId', '==', fx.goalA)
      .get();
    expect(audits.size).toBe(1);
    const audit = audits.docs[0]!.data() as Record<string, unknown>;
    expect(audit.delta).toBe(-5);
    expect(audit.combinedSetupId).toBe(setupId);
    expect(audit.combinedDelta).toBe(-5);

    const credits = await creditRows(setupId);
    expect(credits.size).toBe(2);
    const adjustmentCredits = credits.docs.filter(
      (d) => (d.data() as { source?: string }).source === 'adjustment'
    );
    expect(adjustmentCredits).toHaveLength(1);
    const adjustmentCredit = adjustmentCredits[0]!.data() as Record<string, unknown>;
    expect(adjustmentCredit.amount).toBe(-5);
    expect(adjustmentCredit.adjustmentId).toBe(audits.docs[0]!.id);
    expect(adjustmentCredits[0]!.id).toBe(`${setupId}_adj_${audits.docs[0]!.id}`);
  }, 30_000);

  test('a correction can never take the parent below what that activity gave it', async () => {
    const fx = await seedFixture();
    // 500 BEFORE activation — the parent never counted them.
    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'clamp-pre-01', count: 500 });
    const setupId = await freeze(fx);
    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'clamp-post-1', count: 20 });

    // A correction big enough to wipe out the pre-activation history too,
    // addressed to the POST-activation attempt — the only one that ever gave
    // the parent anything.
    const down = await adjust(fx.champ, {
      goalId: fx.goalA,
      delta: -100,
      targetUid: fx.m1,
      attemptId: 'clamp-post-1',
      correctionId: 'clamp-fix-01',
      reason: 'Recount after the event.',
    });
    expect(down.ok).toBe(true);

    // The CHILD takes the whole −100: it really did have 520.
    const pa = await goalPulse(fx.m1, { goalId: fx.goalA });
    expect(pa.ok && (pa.value as any).sharedTotal).toBe(420);
    // The PARENT only ever had 20 from this activity, so it lands on 0 and not
    // on −80. The ledger records what actually moved, not what was asked for.
    expect(await parentCreditFor(setupId, fx.goalA)).toBe(0);
    const audits = await getFirestore()
      .collection('wsfGoalAdjustments')
      .where('goalId', '==', fx.goalA)
      .get();
    const audit = audits.docs[0]!.data() as Record<string, unknown>;
    expect(audit.delta).toBe(-100);
    expect(audit.combinedDelta).toBe(-20);

    await afterCacheTtl();
    const p = await combinedPulse(fx.m1, { setupId });
    expect(p.ok && (p.value as any).combinedTotal).toBe(0);
  }, 30_000);

  // ── 21. OUTSIDE THE FROZEN WINDOW ───────────────────────────────────────
  test('an attempt outside the FROZEN window credits the activity and not the parent', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);

    // The frozen window is on the CLAIM, which is server-only and reachable
    // here only through the Admin SDK. Narrowing it is how this test stands in
    // for the thing that really happens: a combined period that has ended
    // while an activity's own period is still open. (No callable moves a
    // window, so the alternative would be to wait out a real one.)
    await getFirestore()
      .doc(`wsfCombinedGoalClaims/${fx.goalA}`)
      .update({ windowEndsAt: Timestamp.fromDate(new Date(Date.now() - 60_000)) });

    const r = await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'late-a-0001', count: 9 });
    // THE ACTIVITY STILL TAKES IT. Its own window is open, its own gates are
    // unchanged, and its member gets the ordinary receipt.
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as any).addedCount).toBe(9);
    const pa = await goalPulse(fx.m1, { goalId: fx.goalA });
    expect(pa.ok && (pa.value as any).sharedTotal).toBe(9);

    // THE PARENT DOES NOT. Not a shard, not a linkage row.
    expect(await parentCreditFor(setupId, fx.goalA)).toBe(0);
    expect((await creditRows(setupId)).size).toBe(0);

    await afterCacheTtl();
    const p = await combinedPulse(fx.m1, { setupId });
    expect(p.ok && (p.value as any).combinedTotal).toBe(0);
  }, 30_000);

  // ── 22. A RELEASED CLAIM ────────────────────────────────────────────────
  test('closing a combined goal stops new credit, and does not erase what it already counted', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);
    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'close-a-0001', count: 20 });

    const closed = await closeCombined(fx.champ, { setupId });
    expect(closed.ok).toBe(true);

    // The claim is RELEASED, not deleted: the record of which setup held this
    // activity, and when, is still there to read.
    const claim = await getFirestore().doc(`wsfCombinedGoalClaims/${fx.goalA}`).get();
    expect(claim.exists).toBe(true);
    expect((claim.data() as { status?: string }).status).toBe('released');
    expect((claim.data() as { setupId?: string }).setupId).toBe(setupId);

    // The activity still takes contributions — closing a combined goal is not
    // closing an activity — and they no longer reach the parent.
    const after = await contribute(fx.m1, {
      goalId: fx.goalA,
      attemptId: 'close-a-0002',
      count: 11,
    });
    expect(after.ok).toBe(true);
    const pa = await goalPulse(fx.m1, { goalId: fx.goalA });
    expect(pa.ok && (pa.value as any).sharedTotal).toBe(31);
    expect(await parentCreditFor(setupId, fx.goalA)).toBe(20);
    expect((await creditRows(setupId)).size).toBe(1);

    await afterCacheTtl();
    const p = await combinedPulse(fx.m1, { setupId });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect((p.value as any).status).toBe('closed');
    expect((p.value as any).combinedTotal).toBe(20);
  }, 30_000);

  test('only a foundingChampion of the setup community may close it', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);

    const anon = await closeCombined(null, { setupId });
    expect(anon.ok).toBe(false);
    if (!anon.ok) expect(anon.error.code).toBe('unauthenticated');

    const member = await closeCombined(fx.m1, { setupId });
    expect(member.ok).toBe(false);
    if (!member.ok) expect(member.error.code).toBe('not-found');

    const stranger = await closeCombined(uniq('outsider'), { setupId });
    expect(stranger.ok).toBe(false);
    if (!stranger.ok) expect(stranger.error.code).toBe('not-found');

    // Still active, still claimed.
    const claim = await getFirestore().doc(`wsfCombinedGoalClaims/${fx.goalA}`).get();
    expect((claim.data() as { status?: string }).status).toBe('active');
  }, 30_000);

  // ── 23. ONE ACTIVE PARENT PER CHILD ─────────────────────────────────────
  test('a child cannot join a second active combined goal, and closing the first gives it back', async () => {
    const fx = await seedFixture();
    const firstSetupId = await freeze(fx);

    // A third activity in the same community and the same window, so the only
    // thing wrong with the second setup is that it wants goalA.
    const goalC = await seedGoal({
      communityGroupId: fx.groupId,
      ownerUid: fx.champ,
      title: 'Lunges',
      target: 400,
      unit: 'lunges',
      startsAt: fx.childStart,
      endsAt: fx.childEnd,
    });

    const second = await createCombined(fx.champ, {
      ...fx.createArgs,
      title: 'Move together again',
      childGoalIds: [fx.goalA, goalC],
    });
    // SUPERSEDED: the first implementation deliberately PERMITTED this, on the
    // reasoning that two parents each counting a shared child inflate nothing.
    // The guarantee actually required is one active parent per child for this
    // release, so it is refused.
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe('failed-precondition');
      expect(second.error.message).toBe(
        'One of these activities already feeds another combined goal. Close that one first.'
      );
    }

    // NOTHING PARTIAL SURVIVED the refusal: goalC was never claimed, and
    // goalA's claim still names the first setup. The claim and the setup are
    // written in one transaction, so a refused activation leaves no trace.
    expect((await getFirestore().doc(`wsfCombinedGoalClaims/${goalC}`).get()).exists).toBe(false);
    const claimA = await getFirestore().doc(`wsfCombinedGoalClaims/${fx.goalA}`).get();
    expect((claimA.data() as { setupId?: string }).setupId).toBe(firstSetupId);
    const setups = await getFirestore()
      .collection('wsfCombinedGoals')
      .where('communityGroupId', '==', fx.groupId)
      .get();
    expect(setups.size).toBe(1);

    // Give the activities back, and the second setup can have them.
    const closed = await closeCombined(fx.champ, { setupId: firstSetupId });
    expect(closed.ok).toBe(true);

    // Something happened on goalA while the first setup owned it, so the
    // re-claim is also a second proof that activation is a boundary.
    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'between-a-01', count: 60 });

    const retry = await createCombined(fx.champ, {
      ...fx.createArgs,
      title: 'Move together again',
      childGoalIds: [fx.goalA, goalC],
    });
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    const secondSetupId = (retry.value as { setupId: string }).setupId;
    expect(secondSetupId).not.toBe(firstSetupId);

    const reclaimed = await getFirestore().doc(`wsfCombinedGoalClaims/${fx.goalA}`).get();
    expect((reclaimed.data() as { setupId?: string }).setupId).toBe(secondSetupId);
    expect((reclaimed.data() as { status?: string }).status).toBe('active');
    // The released claim was overwritten, not merged: no field of the old
    // claim survives into the new one.
    expect((reclaimed.data() as { releasedAt?: unknown }).releasedAt).toBeNull();

    // THE NEW PARENT OPENS AT ZERO, although goalA now has 60 to its name.
    const p = await combinedPulse(fx.m1, { setupId: secondSetupId });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect((p.value as any).combinedTotal).toBe(0);
    const a = (p.value as any).activities.find((x: any) => x.goalId === fx.goalA);
    expect(a.total).toBe(60);
    expect(a.combinedContribution).toBe(0);

    // And the first setup keeps its own history: what it counted is still its.
    const firstStill = await combinedPulse(fx.m1, { setupId: firstSetupId });
    expect(firstStill.ok && (firstStill.value as any).combinedTotal).toBe(0);
  }, 45_000);

  // ── 24. THE FULL CYCLE, ROW BY ROW ──────────────────────────────────────
  test('a full cycle writes exactly the rows it should and no others, and wsfGoalPulse still returns its nine keys', async () => {
    const fx = await seedFixture();
    const setupId = await freeze(fx);
    const db = getFirestore();

    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'cycle-a-0001', count: 20 });
    await contribute(fx.m1, { goalId: fx.goalB, attemptId: 'cycle-b-0001', count: 15 });
    await contribute(fx.m1, { goalId: fx.goalA, attemptId: 'cycle-a-0001', count: 20 }); // replay
    await adjust(fx.champ, {
      goalId: fx.goalA,
      delta: -5,
      targetUid: fx.m1,
      attemptId: 'cycle-a-0001',
      correctionId: 'cycle-fix-01',
      reason: 'Miscounted by five.',
    });

    // ── the CHILD side, unchanged from what it always wrote ──
    for (const [goalId, attempts] of [
      [fx.goalA, 1],
      [fx.goalB, 1],
    ] as const) {
      const contributions = await db
        .collection('wsfContributions')
        .where('goalId', '==', goalId)
        .get();
      expect(contributions.size).toBe(attempts);
      const additions = await db.collection(`wsfGoals/${goalId}/recentAdditions`).get();
      expect(additions.size).toBe(attempts);
      const memberTotals = await db
        .collection('wsfGoalMemberTotals')
        .where('goalId', '==', goalId)
        .get();
      expect(memberTotals.size).toBe(1);
    }
    // One shard touched per contribution, plus shard 0 for the correction on A.
    expect((await db.collection(`wsfGoalCounters/${fx.goalA}/shards`).get()).size).toBeLessThanOrEqual(2);
    expect((await db.collection(`wsfGoalCounters/${fx.goalB}/shards`).get()).size).toBe(1);

    // ── the PARENT side ──
    // Two claims, one per child, and NOT ONE MORE.
    for (const goalId of [fx.goalA, fx.goalB]) {
      expect((await db.doc(`wsfCombinedGoalClaims/${goalId}`).get()).exists).toBe(true);
    }
    // Three credit rows: two contributions and one adjustment. The replay
    // wrote nothing.
    const credits = await creditRows(setupId);
    expect(credits.size).toBe(3);
    expect(
      credits.docs.filter((d) => (d.data() as { source?: string }).source === 'contribution')
    ).toHaveLength(2);
    expect(
      credits.docs.filter((d) => (d.data() as { source?: string }).source === 'adjustment')
    ).toHaveLength(1);
    // At most one shard per contribution plus shard 0 for the correction.
    const parentShards = await parentShardDocs(setupId);
    expect(parentShards.size).toBeLessThanOrEqual(3);
    expect(parentShards.size).toBeGreaterThanOrEqual(2);
    for (const doc of parentShards.docs) {
      // Every shard is named <goalId>_<0..9> and belongs to a child of this
      // setup. A shard named anything else would be a row nobody expects.
      expect(doc.id).toMatch(new RegExp(`^(${fx.goalA}|${fx.goalB})_[0-9]$`));
      expect(Object.keys(doc.data())).toEqual(['count']);
    }
    // The setup document itself was not rewritten by any of this.
    const setupDoc = await db.doc(`wsfCombinedGoals/${setupId}`).get();
    expect((setupDoc.data() as { status?: string }).status).toBe('active');

    // The arithmetic, end to end: 20 + 15 − 5.
    await afterCacheTtl();
    const p = await combinedPulse(fx.m1, { setupId });
    expect(p.ok && (p.value as any).combinedTotal).toBe(30);

    // AND THE NINE-FIELD CONTRACT IS STILL NINE FIELDS, after a cycle that
    // touched the contribution path, the correction path and both counters.
    for (const goalId of [fx.goalA, fx.goalB]) {
      const r = await goalPulse(fx.m1, { goalId });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(Object.keys(r.value as object).sort()).toEqual(
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
    }
  }, 45_000);

  // ── 25. THE UNCOMBINED PATH, PROVED RATHER THAN ASSERTED ────────────────
  //
  // wsfContribute was changed, which earlier briefs forbade. This is the test
  // that has to earn it: a goal in NO combined setup must behave exactly as it
  // did — the same writes, the same fields, the same receipt, the same
  // refusals — and the proof is field-for-field, not "it still worked".
  test('a goal in NO combined setup contributes exactly as it did before: same rows, same fields, same receipt', async () => {
    const fx = await seedFixture();
    const db = getFirestore();
    // DELIBERATELY NOT FROZEN into anything. No claim document exists for it.
    const goalId = fx.goalA;
    expect((await db.doc(`wsfCombinedGoalClaims/${goalId}`).get()).exists).toBe(false);

    const r = await contribute(fx.m1, { goalId, attemptId: 'plain-a-0001', count: 12 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // THE RECEIPT: exactly these eight keys, with exactly these values.
    expect(Object.keys(r.value as object).sort()).toEqual(
      [
        'addedCount',
        'alreadyRecorded',
        'crossedTarget',
        'ownCredit',
        'sharedTotal',
        'status',
        'target',
        'unit',
      ].sort()
    );
    expect(r.value as any).toEqual({
      addedCount: 12,
      ownCredit: 12,
      sharedTotal: 12,
      target: 1000,
      unit: 'squats',
      status: 'active',
      alreadyRecorded: false,
      crossedTarget: false,
    });

    // THE CONTRIBUTION ROW: exactly these nine fields.
    const contributions = await db
      .collection('wsfContributions')
      .where('goalId', '==', goalId)
      .get();
    expect(contributions.size).toBe(1);
    const contribution = contributions.docs[0]!;
    expect(contribution.id).toBe(`${goalId}_${fx.m1}_plain-a-0001`);
    expect(Object.keys(contribution.data()).sort()).toEqual(
      [
        'attemptId',
        'communityGroupId',
        'count',
        'createdAt',
        'crossedTarget',
        'goalId',
        'shardIndex',
        'unit',
        'userId',
      ].sort()
    );

    // THE MEMBER TOTAL: exactly these five.
    const memberTotal = await db.doc(`wsfGoalMemberTotals/${goalId}_${fx.m1}`).get();
    expect(Object.keys(memberTotal.data() as object).sort()).toEqual(
      ['contributionCount', 'goalId', 'total', 'updatedAt', 'userId'].sort()
    );
    expect((memberTotal.data() as { total?: number }).total).toBe(12);

    // THE RECENT-ADDITIONS TAIL: one document, named by the attempt id, with
    // exactly its two fields and nothing that identifies the contributor.
    const additions = await db.collection(`wsfGoals/${goalId}/recentAdditions`).get();
    expect(additions.size).toBe(1);
    expect(additions.docs[0]!.id).toBe('plain-a-0001');
    expect(Object.keys(additions.docs[0]!.data()).sort()).toEqual(['amount', 'at'].sort());

    // ONE SHARD, one field.
    const shards = await db.collection(`wsfGoalCounters/${goalId}/shards`).get();
    expect(shards.size).toBe(1);
    expect(Object.keys(shards.docs[0]!.data())).toEqual(['count']);
    expect((shards.docs[0]!.data() as { count?: number }).count).toBe(12);

    // AND NOTHING COMBINED WAS WRITTEN ANYWHERE. No claim, no counter, no
    // credit row. The credit block inside the transaction was reached with no
    // claim and wrote nothing.
    expect(
      (await db.collection('wsfCombinedCredits').where('goalId', '==', goalId).get()).size
    ).toBe(0);
    expect((await db.doc(`wsfCombinedGoalClaims/${goalId}`).get()).exists).toBe(false);

    // THE REPLAY: the original receipt, and still one of everything.
    const replay = await contribute(fx.m1, { goalId, attemptId: 'plain-a-0001', count: 99 });
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect((replay.value as any).addedCount).toBe(12);
      expect((replay.value as any).alreadyRecorded).toBe(true);
      expect((replay.value as any).sharedTotal).toBe(12);
    }
    expect((await db.collection(`wsfGoalCounters/${goalId}/shards`).get()).size).toBe(1);
    expect((await db.collection(`wsfGoals/${goalId}/recentAdditions`).get()).size).toBe(1);

    // THE REFUSALS, word for word.
    const nonMember = await contribute(uniq('outsider'), {
      goalId,
      attemptId: 'plain-a-0002',
      count: 1,
    });
    expect(nonMember.ok).toBe(false);
    if (!nonMember.ok) {
      expect(nonMember.error.code).toBe('permission-denied');
      expect(nonMember.error.message).toBe('Members only.');
    }

    const anon = await contribute(null, { goalId, attemptId: 'plain-a-0003', count: 1 });
    expect(anon.ok).toBe(false);
    if (!anon.ok) {
      expect(anon.error.code).toBe('unauthenticated');
      expect(anon.error.message).toBe('Sign in first.');
    }

    const badAttempt = await contribute(fx.m1, { goalId, attemptId: 'short', count: 1 });
    expect(badAttempt.ok).toBe(false);
    if (!badAttempt.ok) {
      expect(badAttempt.error.code).toBe('invalid-argument');
      expect(badAttempt.error.message).toBe(
        'attemptId must be 8..128 chars of A-Z, a-z, 0-9, _ or -.'
      );
    }

    await db.doc(`wsfGoals/${goalId}`).update({ status: 'closed' });
    const onClosed = await contribute(fx.m1, { goalId, attemptId: 'plain-a-0004', count: 1 });
    expect(onClosed.ok).toBe(false);
    if (!onClosed.ok) {
      expect(onClosed.error.code).toBe('failed-precondition');
      expect(onClosed.error.message).toBe('This goal is closed.');
    }

    const unknown = await contribute(fx.m1, {
      goalId: uniq('nosuchgoal'),
      attemptId: 'plain-a-0005',
      count: 1,
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.error.code).toBe('not-found');
      expect(unknown.error.message).toBe('Goal not found.');
    }
  }, 45_000);

  test('an uncombined goal still enforces its own window, with the same two sentences', async () => {
    const fx = await seedFixture();
    const now = Date.now();
    const notYet = await seedGoal({
      communityGroupId: fx.groupId,
      ownerUid: fx.champ,
      title: 'Later',
      target: 100,
      unit: 'reps',
      startsAt: new Date(now + 86_400_000),
      endsAt: new Date(now + 2 * 86_400_000),
    });
    const over = await seedGoal({
      communityGroupId: fx.groupId,
      ownerUid: fx.champ,
      title: 'Earlier',
      target: 100,
      unit: 'reps',
      startsAt: new Date(now - 2 * 86_400_000),
      endsAt: new Date(now - 86_400_000),
    });

    const early = await contribute(fx.m1, { goalId: notYet, attemptId: 'win-a-0001', count: 1 });
    expect(early.ok).toBe(false);
    if (!early.ok) {
      expect(early.error.code).toBe('failed-precondition');
      expect(early.error.message).toBe('Goal has not started yet.');
    }

    const late = await contribute(fx.m1, { goalId: over, attemptId: 'win-a-0002', count: 1 });
    expect(late.ok).toBe(false);
    if (!late.ok) {
      expect(late.error.code).toBe('failed-precondition');
      expect(late.error.message).toBe('Goal window has ended.');
    }
  }, 30_000);
});
