/**
 * COMBINED MOVEMENT GOAL — the parent has no counter.
 *
 * Everything in this file exists to pin one property: a combined goal's total
 * is a PURE FUNCTION of its children's existing sharded counters, derived at
 * read time and never stored. That is what makes the Director's acceptance
 * cases true without a single line being added to the contribution path:
 *
 *   • 20 on one activity and 15 on another is 35 combined, while each
 *     activity still reports its own 20 and its own 15 and keeps its own
 *     target (test 4);
 *   • a retried attemptId counts once, because the existing (goal, uid,
 *     attemptId) idempotency is untouched and no combined-goal code runs on
 *     that path (test 5);
 *   • a −5 correction and then a +5 correction land back on exactly the same
 *     total, applied once each, with no combined-goal code running at all
 *     (test 6);
 *   • the nine-field wsfGoalPulse contract is still exactly nine fields, and
 *     the combined response is pinned to its own exact key set (test 8).
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

    // THE POINT OF THE WHOLE DESIGN: the parent stores no number, so there is
    // nothing that can drift from the children.
    const keys = Object.keys(doc);
    expect(keys).not.toContain('combinedTotal');
    expect(keys).not.toContain('sharedTotal');
    expect(keys).not.toContain('total');
    expect(keys).not.toContain('reachedAt');
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

    const down = await adjust(fx.champ, {
      goalId: fx.goalA,
      delta: -5,
      targetUid: fx.m1,
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

    const up = await adjust(fx.champ, {
      goalId: fx.goalA,
      delta: 5,
      targetUid: fx.m1,
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
    expect(Object.keys(p.value as object).sort()).toEqual(
      [
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
      ].sort()
    );
    // NOTHING ABOUT A PERSON is in the response, at either level.
    const json = JSON.stringify(p.value);
    expect(json).not.toContain(fx.m1);
    expect(json).not.toContain(fx.champ);
    expect(json).not.toContain('contributorCount');
    expect(json).not.toContain('ownerUid');
    expect(json).not.toContain('joinCode');

    for (const activity of (p.value as any).activities) {
      expect(Object.keys(activity).sort()).toEqual(
        ['countsAs', 'goalId', 'status', 'target', 'title', 'total', 'unit'].sort()
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
});
