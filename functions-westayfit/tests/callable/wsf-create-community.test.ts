/**
 * wsfCreateCommunity callable — happy path + unverified-email rejection.
 * Invokes the v2 handler via `.run(request)` against a live Firestore emulator.
 * Run:
 *   cd functions-westayfit
 *   firebase emulators:exec --only firestore --project goarrive-test \
 *     "npm run test:callable"
 */

process.env.GCLOUD_PROJECT = 'goarrive-test';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { wsfCreateCommunity } from '../../src/index';

const ALICE_UID = 'wsfCreateCommunityAlice';
const BOB_UID = 'wsfCreateCommunityBob';

async function seedAdultProfile(uid: string) {
  await getFirestore()
    .doc(`wsfMemberProfiles/${uid}`)
    .set({
      displayName: 'Test User',
      adultConfirmation: true,
      acceptedTermsVersion: 'pending-approval-2026-08-25',
      acceptedPrivacyVersion: 'pending-approval-2026-08-25',
    });
}

async function clearMemberProfile(uid: string) {
  await getFirestore().doc(`wsfMemberProfiles/${uid}`).delete().catch(() => undefined);
}

function makeRequest(
  uid: string,
  emailVerified: boolean,
  data: Record<string, unknown>
): Parameters<typeof wsfCreateCommunity.run>[0] {
  return {
    auth: {
      uid,
      token: { email_verified: emailVerified } as any,
    } as any,
    data: data as any,
    rawRequest: {} as any,
    acceptsStreaming: false,
  } as any;
}

describe('wsfCreateCommunity', () => {
  afterAll(async () => {
    await Promise.all([clearMemberProfile(ALICE_UID), clearMemberProfile(BOB_UID)]);
  });

  test('happy path: verified adult creates community + membership', async () => {
    await seedAdultProfile(ALICE_UID);

    const result = await wsfCreateCommunity.run(
      makeRequest(ALICE_UID, true, {
        displayName: 'Alice Family Group',
        groupType: 'familyFriends',
        joinPolicy: 'private',
      })
    );

    expect(result).toEqual({ groupId: expect.any(String) });
    const { groupId } = result as { groupId: string };

    const db = getFirestore();
    const groupSnap = await db.doc(`wsfCommunityGroups/${groupId}`).get();
    expect(groupSnap.exists).toBe(true);
    expect(groupSnap.data()).toMatchObject({
      displayName: 'Alice Family Group',
      groupType: 'familyFriends',
      joinPolicy: 'private',
      createdByUserId: ALICE_UID,
      lifecycleStatus: 'active',
      isSample: false,
    });
    // E2: every new group ships with a mint-fresh joinCode from day one so the
    // backfill only has to catch legacy rows.
    const groupData = groupSnap.data() as { joinCode?: unknown };
    expect(typeof groupData.joinCode).toBe('string');
    expect((groupData.joinCode as string).length).toBeGreaterThanOrEqual(16);
    expect(groupData.joinCode).toMatch(/^[A-Za-z0-9_-]+$/);

    const membershipSnap = await db.doc(`wsfMemberships/${groupId}_${ALICE_UID}`).get();
    expect(membershipSnap.exists).toBe(true);
    expect(membershipSnap.data()).toMatchObject({
      groupId,
      userId: ALICE_UID,
      role: 'foundingChampion',
      membershipStatus: 'active',
    });
  });

  test('unverified email is rejected with failed-precondition', async () => {
    await seedAdultProfile(BOB_UID);

    let caught: unknown;
    try {
      await wsfCreateCommunity.run(
        makeRequest(BOB_UID, false, {
          displayName: 'Bob Group',
          groupType: 'familyFriends',
        })
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(HttpsError);
    expect((caught as HttpsError).code).toBe('failed-precondition');
    expect((caught as HttpsError).message).toMatch(/Verify your email/);
  });
});
