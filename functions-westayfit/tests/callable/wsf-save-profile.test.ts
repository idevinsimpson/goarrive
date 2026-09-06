/**
 * wsfSaveProfile callable — create, update-preserves-createdAt, unverified,
 * bad-name. Invokes the v2 handler via `.run(request)` against a live
 * Firestore emulator.
 * Run:
 *   cd functions-westayfit
 *   firebase emulators:exec --only firestore --project goarrive-test \
 *     "npm run test:callable"
 */

process.env.GCLOUD_PROJECT = 'goarrive-test';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { wsfSaveProfile } from '../../src/index';

const ALICE_UID = 'wsfSaveProfileAlice';
const BOB_UID = 'wsfSaveProfileBob';
const CAROL_UID = 'wsfSaveProfileCarol';
const DAVE_UID = 'wsfSaveProfileDave';

async function clearProfile(uid: string) {
  await getFirestore().doc(`wsfMemberProfiles/${uid}`).delete().catch(() => undefined);
}

function makeRequest(
  uid: string,
  emailVerified: boolean,
  data: Record<string, unknown>
): Parameters<typeof wsfSaveProfile.run>[0] {
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

describe('wsfSaveProfile', () => {
  afterAll(async () => {
    await Promise.all([
      clearProfile(ALICE_UID),
      clearProfile(BOB_UID),
      clearProfile(CAROL_UID),
      clearProfile(DAVE_UID),
    ]);
  });

  test('create: verified caller with a fresh uid gets a new profile with server-stamped versions', async () => {
    await clearProfile(ALICE_UID);

    const result = await wsfSaveProfile.run(
      makeRequest(ALICE_UID, true, { displayName: '  Alice  ' })
    );

    expect(result).toEqual({ created: true });

    const snap = await getFirestore().doc(`wsfMemberProfiles/${ALICE_UID}`).get();
    expect(snap.exists).toBe(true);
    const data = snap.data() as {
      displayName: string;
      acceptedTermsVersion: string;
      acceptedPrivacyVersion: string;
      createdAt: Timestamp;
      updatedAt: Timestamp;
    };
    expect(data.displayName).toBe('Alice');
    expect(data.acceptedTermsVersion).toBe('pending-approval-2026-08-25');
    expect(data.acceptedPrivacyVersion).toBe('pending-approval-2026-08-25');
    expect(data.createdAt).toBeInstanceOf(Timestamp);
    expect(data.updatedAt).toBeInstanceOf(Timestamp);
  });

  test('update: re-save leaves createdAt untouched and only bumps updatedAt', async () => {
    await clearProfile(BOB_UID);
    // Seed with a hand-picked createdAt so the assertion is unambiguous.
    const seededCreatedAt = Timestamp.fromDate(new Date('2026-01-15T00:00:00Z'));
    await getFirestore().doc(`wsfMemberProfiles/${BOB_UID}`).set({
      displayName: 'Bob Old',
      acceptedTermsVersion: 'pending-approval-2026-08-25',
      acceptedPrivacyVersion: 'pending-approval-2026-08-25',
      createdAt: seededCreatedAt,
      updatedAt: seededCreatedAt,
    });

    const result = await wsfSaveProfile.run(
      makeRequest(BOB_UID, true, { displayName: 'Bob New' })
    );

    expect(result).toEqual({ created: false });

    const snap = await getFirestore().doc(`wsfMemberProfiles/${BOB_UID}`).get();
    const data = snap.data() as {
      displayName: string;
      createdAt: Timestamp;
      updatedAt: Timestamp;
    };
    expect(data.displayName).toBe('Bob New');
    expect(data.createdAt.toMillis()).toBe(seededCreatedAt.toMillis());
    expect(data.updatedAt.toMillis()).toBeGreaterThan(seededCreatedAt.toMillis());
  });

  test('unverified email is rejected with failed-precondition', async () => {
    await clearProfile(CAROL_UID);

    let caught: unknown;
    try {
      await wsfSaveProfile.run(
        makeRequest(CAROL_UID, false, { displayName: 'Carol' })
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(HttpsError);
    expect((caught as HttpsError).code).toBe('failed-precondition');
    expect((caught as HttpsError).message).toMatch(/Verify your email/);

    // Nothing written.
    const snap = await getFirestore().doc(`wsfMemberProfiles/${CAROL_UID}`).get();
    expect(snap.exists).toBe(false);
  });

  test('bad displayName (too short after trim) is rejected with invalid-argument', async () => {
    await clearProfile(DAVE_UID);

    let caught: unknown;
    try {
      await wsfSaveProfile.run(
        makeRequest(DAVE_UID, true, { displayName: ' a ' })
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(HttpsError);
    expect((caught as HttpsError).code).toBe('invalid-argument');
    expect((caught as HttpsError).message).toMatch(/2-80/);

    const snap = await getFirestore().doc(`wsfMemberProfiles/${DAVE_UID}`).get();
    expect(snap.exists).toBe(false);
  });
});
