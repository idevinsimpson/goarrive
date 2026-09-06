/**
 * wsfMyCommunities callable — the read behind the signed-in home. Pins:
 *
 *   1. §3 A1 — a member sees exactly their own active memberships, each item
 *      carrying the group's displayName / groupType / joinPolicy / role /
 *      memberCount / isSample / activeChallenge summary.
 *
 *   2. Aggregate totals only — no other member's identity ever appears in the
 *      response (asserted via a top-level whitelist of item keys).
 *
 *   3. isSample is BADGED, never counted or filtered — a member of a sample
 *      group still sees it in their list, and the field is passed through so
 *      the UI can render a "Sample" pill.
 *
 *   4. A non-member sees zero items.
 *
 * Runs against Firestore emulator via `.run(request)`.
 */

process.env.GCLOUD_PROJECT = 'goarrive-test';
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { wsfCheckIn, wsfMyCommunities } from '../../src/index';

async function seedActiveMember(
  groupId: string,
  uid: string,
  role: string = 'member'
): Promise<void> {
  await getFirestore()
    .doc(`wsfMemberships/${groupId}_${uid}`)
    .set({
      groupId,
      userId: uid,
      role,
      membershipStatus: 'active',
    });
}

async function seedGroup(opts: {
  displayName?: string;
  joinPolicy?: 'private' | 'inviteOnly' | 'public';
  groupType?: 'familyFriends' | 'custom';
  isSample?: boolean;
  lifecycleStatus?: string;
} = {}): Promise<string> {
  const ref = getFirestore().collection('wsfCommunityGroups').doc();
  await ref.set({
    displayName: opts.displayName ?? 'My Community',
    groupType: opts.groupType ?? 'custom',
    joinPolicy: opts.joinPolicy ?? 'private',
    lifecycleStatus: opts.lifecycleStatus ?? 'active',
    isSample: opts.isSample ?? false,
  });
  return ref.id;
}

async function seedChallenge(
  groupId: string,
  status: 'draft' | 'active' | 'completed' = 'active',
  goalTarget: number | null = null
): Promise<string> {
  const ref = getFirestore().collection('wsfChallenges').doc();
  await ref.set({ groupId, title: 'MyC Test Challenge', status, goalTarget });
  return ref.id;
}

async function seedMove(challengeId: string, sequence: number): Promise<string> {
  const ref = getFirestore().collection('wsfChallengeMoves').doc();
  await ref.set({
    challengeId,
    title: `Move ${sequence}`,
    instructions: '',
    sequence,
    dayNumber: null,
  });
  return ref.id;
}

function makeRequest(
  uid: string | null,
  data: Record<string, unknown> = {}
): Parameters<typeof wsfMyCommunities.run>[0] {
  return {
    auth: uid
      ? ({ uid, token: { email_verified: true } as any } as any)
      : undefined,
    data: data as any,
    rawRequest: {} as any,
    acceptsStreaming: false,
  } as any;
}

async function tryRun(uid: string | null, data: Record<string, unknown> = {}) {
  try {
    return {
      ok: true as const,
      value: await wsfMyCommunities.run(makeRequest(uid, data)),
    };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}

describe('wsfMyCommunities', () => {
  test('unauthenticated caller: unauthenticated code', async () => {
    const result = await tryRun(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unauthenticated');
  });

  test('member with no groups: empty items', async () => {
    const uid = `wsfMy_solo_${Date.now()}`;
    const result = await wsfMyCommunities.run(makeRequest(uid));
    expect(result).toEqual({ items: [] });
  });

  test('§3 A1 member sees only their own groups, with aggregate totals and no member identity', async () => {
    const caller = `wsfMy_caller_${Date.now()}`;
    const stranger = `wsfMy_stranger_${Date.now()}`;

    // Group A: caller is foundingChampion, one other member joined, active
    // challenge with one caller check-in.
    const groupAId = await seedGroup({
      displayName: 'Alpha Community',
      joinPolicy: 'public',
      groupType: 'custom',
    });
    await seedActiveMember(groupAId, caller, 'foundingChampion');
    await seedActiveMember(groupAId, stranger, 'member');
    const challengeAId = await seedChallenge(groupAId, 'active', 100);
    const moveAId = await seedMove(challengeAId, 1);
    await wsfCheckIn.run({
      auth: { uid: caller, token: { email_verified: true } as any } as any,
      data: { moveId: moveAId } as any,
      rawRequest: {} as any,
      acceptsStreaming: false,
    } as any);

    // Group B: caller is a member, no active challenge (draft only).
    const groupBId = await seedGroup({
      displayName: 'Bravo Community',
      joinPolicy: 'private',
      groupType: 'familyFriends',
    });
    await seedActiveMember(groupBId, caller, 'member');
    await seedChallenge(groupBId, 'draft');

    // Group C: caller is NOT a member — must not appear.
    const groupCId = await seedGroup({ displayName: 'Charlie Community' });
    await seedActiveMember(groupCId, stranger);

    const result = await wsfMyCommunities.run(makeRequest(caller));
    expect(result.items.map((i) => i.groupId).sort()).toEqual(
      [groupAId, groupBId].sort()
    );

    const groupA = result.items.find((i) => i.groupId === groupAId)!;
    expect(groupA).toMatchObject({
      displayName: 'Alpha Community',
      groupType: 'custom',
      joinPolicy: 'public',
      role: 'foundingChampion',
      memberCount: 2,
      isSample: false,
    });
    expect(groupA.activeChallenge).toMatchObject({
      id: challengeAId,
      title: 'MyC Test Challenge',
      goalTarget: 100,
    });
    expect(groupA.activeChallenge!.completedCount).toBeGreaterThanOrEqual(1);
    expect(groupA.activeChallenge!.participantCount).toBeGreaterThanOrEqual(1);

    const groupB = result.items.find((i) => i.groupId === groupBId)!;
    expect(groupB).toMatchObject({
      displayName: 'Bravo Community',
      groupType: 'familyFriends',
      joinPolicy: 'private',
      role: 'member',
      memberCount: 1,
      activeChallenge: null,
      isSample: false,
    });

    // Whitelist the item shape — a future field that leaked another member's
    // uid or displayName would fail this check even if it slipped past a
    // targeted assertion.
    for (const item of result.items) {
      expect(Object.keys(item).sort()).toEqual([
        'activeChallenge',
        'displayName',
        'groupId',
        'groupType',
        'isSample',
        'joinPolicy',
        'memberCount',
        'role',
      ]);
      if (item.activeChallenge) {
        expect(Object.keys(item.activeChallenge).sort()).toEqual([
          'completedCount',
          'goalTarget',
          'id',
          'participantCount',
          'title',
        ]);
      }
    }
  });

  test('§3 A1 sample groups appear with isSample:true (badged, never filtered)', async () => {
    const uid = `wsfMy_sample_${Date.now()}`;
    const groupId = await seedGroup({
      displayName: 'Sample Group',
      isSample: true,
    });
    await seedActiveMember(groupId, uid);

    const result = await wsfMyCommunities.run(makeRequest(uid));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      groupId,
      displayName: 'Sample Group',
      isSample: true,
    });
  });

  test('inactive membership does not appear', async () => {
    const uid = `wsfMy_inactive_${Date.now()}`;
    const groupId = await seedGroup();
    await getFirestore()
      .doc(`wsfMemberships/${groupId}_${uid}`)
      .set({
        groupId,
        userId: uid,
        role: 'member',
        membershipStatus: 'pending',
      });

    const result = await wsfMyCommunities.run(makeRequest(uid));
    expect(result.items).toEqual([]);
  });
});
