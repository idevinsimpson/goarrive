/**
 * wsfListChallenge callable — the members-only read behind the community
 * page's challenge panel. Pins:
 *
 *   1. §5.1 A joined member sees the active challenge and its moves,
 *      sorted by sequence, with a `checkedIn` flag per move reflecting
 *      that member's own history.
 *
 *   2. §5.6 non-member refused with permission-denied.
 *
 *   3. No active challenge in the group → challenge: null, moves: [],
 *      totals zeroed. This is the pre-event state and must not throw.
 *
 * Runs against Firestore emulator via `.run(request)`.
 */

process.env.GCLOUD_PROJECT = 'goarrive-test';
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { wsfCheckIn, wsfListChallenge } from '../../src/index';

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

async function seedGroup(): Promise<string> {
  const ref = getFirestore().collection('wsfCommunityGroups').doc();
  await ref.set({
    displayName: 'List Test Group',
    groupType: 'custom',
    joinPolicy: 'public',
    lifecycleStatus: 'active',
    isSample: false,
  });
  return ref.id;
}

async function seedChallenge(
  groupId: string,
  status: 'draft' | 'active' | 'completed' = 'active',
  goalTarget: number | null = null
): Promise<string> {
  const ref = getFirestore().collection('wsfChallenges').doc();
  await ref.set({ groupId, title: 'FitLife Moves', status, goalTarget });
  return ref.id;
}

async function seedMove(
  challengeId: string,
  sequence: number,
  title: string
): Promise<string> {
  const ref = getFirestore().collection('wsfChallengeMoves').doc();
  await ref.set({
    challengeId,
    title,
    instructions: '',
    sequence,
    dayNumber: null,
  });
  return ref.id;
}

function makeRequest(
  uid: string | null,
  data: Record<string, unknown>
): Parameters<typeof wsfListChallenge.run>[0] {
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
    return {
      ok: true as const,
      value: await wsfListChallenge.run(makeRequest(uid, data)),
    };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}

describe('wsfListChallenge', () => {
  test('unauthenticated caller: unauthenticated', async () => {
    const result = await tryRun(null, { groupId: 'anything' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unauthenticated');
  });

  test('non-member refused: permission-denied', async () => {
    const groupId = await seedGroup();
    await seedChallenge(groupId);
    const uid = `wsfList_nonmember_${Date.now()}`;
    // No membership.

    const result = await tryRun(uid, { groupId });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('permission-denied');
  });

  test('§5.1 member sees active challenge, moves ordered by sequence, and their own checkedIn flags', async () => {
    const groupId = await seedGroup();
    const challengeId = await seedChallenge(groupId, 'active', 1000);
    const moveB = await seedMove(challengeId, 2, 'B move');
    const moveA = await seedMove(challengeId, 1, 'A move');
    const moveC = await seedMove(challengeId, 3, 'C move');
    const uid = `wsfList_happy_${Date.now()}`;
    await seedActiveMember(groupId, uid);

    // Check in on A only.
    await wsfCheckIn.run({
      auth: { uid, token: { email_verified: true } as any } as any,
      data: { moveId: moveA } as any,
      rawRequest: {} as any,
      acceptsStreaming: false,
    } as any);

    const result = await wsfListChallenge.run(makeRequest(uid, { groupId }));

    expect(result.challenge?.id).toBe(challengeId);
    expect(result.challenge?.goalTarget).toBe(1000);
    expect(result.moves.map((m) => m.id)).toEqual([moveA, moveB, moveC]);
    expect(result.moves.map((m) => m.checkedIn)).toEqual([true, false, false]);
    expect(result.totals.completedCount).toBeGreaterThanOrEqual(1);
    expect(result.totals.goalTarget).toBe(1000);
  });

  test('no active challenge: challenge=null, moves=[], zeroed totals — no throw', async () => {
    const groupId = await seedGroup();
    // Only a draft challenge exists.
    await seedChallenge(groupId, 'draft');
    const uid = `wsfList_pre_event_${Date.now()}`;
    await seedActiveMember(groupId, uid);

    const result = await wsfListChallenge.run(makeRequest(uid, { groupId }));
    expect(result.challenge).toBeNull();
    expect(result.moves).toEqual([]);
    expect(result.totals).toEqual({
      participantCount: 0,
      completedCount: 0,
      goalTarget: null,
    });
  });

  test('missing groupId: invalid-argument', async () => {
    const uid = `wsfList_missing_${Date.now()}`;
    const result = await tryRun(uid, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid-argument');
  });
});
