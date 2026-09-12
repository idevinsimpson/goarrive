/**
 * wsfMyContribution — authenticated own-credit read for a goal (E4-A1-R4).
 *
 * Pins:
 *   * the auth boundary is the explicit request.auth check -> unauthenticated
 *   * unknown goalId -> not-found
 *   * a member who never contributed reads 0
 *   * a member who contributed 20 reads 20
 *   * a member reads only their own row: another member's 20 is not visible
 *   * closure does not clear own credit
 *   * an authorized downward correction is reflected (via wsfAdjustGoal)
 *
 * Runs against the local Firestore emulator via `func.run(request)`.
 */

process.env.METADATA_SERVER_DETECTION =
  process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'goarrive-test';
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { wsfAdjustGoal, wsfContribute, wsfMyContribution } from '../../src/index';

type Data = Record<string, unknown>;

function makeRequest(uid: string | null, data: Data): any {
  return {
    auth: uid
      ? ({ uid, token: { email_verified: true } as any } as any)
      : undefined,
    data: data as any,
    rawRequest: {} as any,
    acceptsStreaming: false,
  };
}

async function tryMine(uid: string | null, data: Data) {
  try {
    return {
      ok: true as const,
      value: await wsfMyContribution.run(makeRequest(uid, data)),
    };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}

function uniq(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function seedMembership(groupId: string, uid: string): Promise<void> {
  await getFirestore().doc(`wsfMemberships/${groupId}_${uid}`).set(
    {
      groupId,
      userId: uid,
      role: 'foundingChampion',
      membershipStatus: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    { merge: true }
  );
}

async function seedGoal(): Promise<{ goalId: string; communityGroupId: string }> {
  const communityGroupId = uniq('mineGrp');
  const now = new Date();
  const ref = getFirestore().collection('wsfGoals').doc();
  await ref.set({
    ownerUid: 'wsfSeedOwner',
    communityGroupId,
    title: 'E4-A1 own-credit test goal',
    target: 5000,
    unit: 'squats',
    status: 'active',
    startsAt: Timestamp.fromDate(new Date(now.getTime() - 60_000)),
    endsAt: Timestamp.fromDate(new Date(now.getTime() + 60 * 60_000)),
    timezone: 'America/New_York',
    createdAt: new Date(),
  });
  return { goalId: ref.id, communityGroupId };
}

async function contribute(uid: string, goalId: string, attemptId: string, count: number) {
  return wsfContribute.run(makeRequest(uid, { goalId, attemptId, count }));
}

describe('wsfMyContribution', () => {
  beforeAll(async () => {
    await getFirestore()
      .doc('_warmup/wsf-my-contribution')
      .set({ at: Date.now() });
  }, 30_000);

  test('(a) unauthenticated -> unauthenticated (explicit request.auth check)', async () => {
    const { goalId } = await seedGoal();
    const r = await tryMine(null, { goalId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('unauthenticated');
  });

  test('(b) unknown goalId -> not-found', async () => {
    const r = await tryMine(uniq('u'), { goalId: uniq('missing-goal') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not-found');
  });

  test('(c) member who never contributed reads 0 with the goal unit', async () => {
    const { goalId } = await seedGoal();
    const r = await tryMine(uniq('fresh'), { goalId });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ ownCredit: 0, unit: 'squats' });
  });

  test('(d) member who contributed 20 reads 20', async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const uid = uniq('twenty');
    await seedMembership(communityGroupId, uid);
    await contribute(uid, goalId, 'attempt-mine-20', 20);
    const r = await tryMine(uid, { goalId });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ ownCredit: 20, unit: 'squats' });
  });

  test("(e) another member's 20 is not visible: the reader sees only their own row", async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const contributor = uniq('contrib');
    const reader = uniq('reader');
    await seedMembership(communityGroupId, contributor);
    await contribute(contributor, goalId, 'attempt-other-20', 20);
    const r = await tryMine(reader, { goalId });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.ownCredit).toBe(0);
  });

  test('(f) closure does not clear own credit', async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const uid = uniq('closed');
    await seedMembership(communityGroupId, uid);
    await contribute(uid, goalId, 'attempt-before-close', 20);
    await getFirestore().doc(`wsfGoals/${goalId}`).set(
      { status: 'closed', closedAt: new Date() },
      { merge: true }
    );
    const r = await tryMine(uid, { goalId });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.ownCredit).toBe(20);
  });

  test('(g) an authorized downward correction is reflected', async () => {
    const { goalId, communityGroupId } = await seedGoal();
    const uid = uniq('corrected');
    await seedMembership(communityGroupId, uid); // foundingChampion by default
    await contribute(uid, goalId, 'attempt-then-corrected', 20);
    const adj = await wsfAdjustGoal.run(
      makeRequest(uid, {
        goalId,
        delta: -5,
        targetUid: uid,
        reason: 'E4-A1-R4 test: counted five too many',
      })
    );
    expect(adj.targetMemberTotal).toBe(15);
    const r = await tryMine(uid, { goalId });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.ownCredit).toBe(15);
  });
});
