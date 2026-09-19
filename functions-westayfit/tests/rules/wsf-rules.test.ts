/**
 * wsf-rules.test.ts
 *
 * WSF Firestore Security Rules test suite.
 * Uses @firebase/rules-unit-testing v5 with the Firebase Emulator Suite.
 *
 * Run:
 *   cd functions-westayfit
 *   firebase emulators:exec --only firestore \
 *     --config ../firebase.json --project goarrive-test \
 *     "npm run test:rules"
 *
 * Or with a separately-running emulator:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run test:rules
 *
 * Scope: only wsf-prefixed collections. Does NOT touch GoArrive rules.
 */

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const PROJECT_ID = 'goarrive-test';
const RULES_PATH = resolve(__dirname, '../../../firestore.rules');

const ALICE_UID = 'wsfAlice';
const BOB_UID = 'wsfBob';
const ADMIN_UID = 'wsfPlatformAdmin';
const GROUP_ID = 'wsfGroup1';
const OTHER_GROUP_ID = 'wsfGroup2';

const verifiedEmail = { email_verified: true };
const unverifiedEmail = { email_verified: false };

const validProfile = {
  displayName: 'Alice',
  adultConfirmation: true,
  acceptedTermsVersion: 'pending-approval-2026-08-25',
  acceptedPrivacyVersion: 'pending-approval-2026-08-25',
};

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(RULES_PATH, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    // Seed an existing group + membership for Alice (used by read tests).
    await setDoc(doc(db, 'wsfCommunityGroups', GROUP_ID), {
      displayName: 'Alice Family',
      groupType: 'familyFriends',
      joinPolicy: 'private',
      createdByUserId: ALICE_UID,
      lifecycleStatus: 'active',
      isSample: false,
    });
    await setDoc(doc(db, 'wsfMemberships', `${GROUP_ID}_${ALICE_UID}`), {
      groupId: GROUP_ID,
      userId: ALICE_UID,
      role: 'foundingChampion',
      membershipStatus: 'active',
    });

    // Alice's completed profile.
    await setDoc(doc(db, 'wsfMemberProfiles', ALICE_UID), validProfile);

    // An orphan group (no members) used for negative read test.
    await setDoc(doc(db, 'wsfCommunityGroups', OTHER_GROUP_ID), {
      displayName: 'Bob Private',
      groupType: 'custom',
      joinPolicy: 'private',
      createdByUserId: BOB_UID,
      lifecycleStatus: 'active',
      isSample: false,
    });
  });
});

// ─── wsfMemberProfiles ────────────────────────────────────────────────────────

describe('wsfMemberProfiles', () => {
  test('owner (verified) can read own profile', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID, verifiedEmail).firestore();
    await assertSucceeds(getDoc(doc(alice, 'wsfMemberProfiles', ALICE_UID)));
  });

  test('other user cannot read profile', async () => {
    const bob = testEnv.authenticatedContext(BOB_UID, verifiedEmail).firestore();
    await assertFails(getDoc(doc(bob, 'wsfMemberProfiles', ALICE_UID)));
  });

  test('platform admin can read profile', async () => {
    const admin = testEnv
      .authenticatedContext(ADMIN_UID, { ...verifiedEmail, role: 'platformAdmin' })
      .firestore();
    await assertSucceeds(getDoc(doc(admin, 'wsfMemberProfiles', ALICE_UID)));
  });

  test('verified owner can create own profile with valid fields', async () => {
    const bob = testEnv.authenticatedContext(BOB_UID, verifiedEmail).firestore();
    await assertSucceeds(
      setDoc(doc(bob, 'wsfMemberProfiles', BOB_UID), {
        displayName: 'Bob',
        adultConfirmation: true,
        acceptedTermsVersion: 'pending-approval-2026-08-25',
        acceptedPrivacyVersion: 'pending-approval-2026-08-25',
      })
    );
  });

  test('unverified user cannot create own profile', async () => {
    const bob = testEnv.authenticatedContext(BOB_UID, unverifiedEmail).firestore();
    await assertFails(
      setDoc(doc(bob, 'wsfMemberProfiles', BOB_UID), {
        displayName: 'Bob',
        adultConfirmation: true,
        acceptedTermsVersion: 'pending-approval-2026-08-25',
        acceptedPrivacyVersion: 'pending-approval-2026-08-25',
      })
    );
  });

  test('user cannot create profile with adultConfirmation=false', async () => {
    const bob = testEnv.authenticatedContext(BOB_UID, verifiedEmail).firestore();
    await assertFails(
      setDoc(doc(bob, 'wsfMemberProfiles', BOB_UID), {
        displayName: 'Bob',
        adultConfirmation: false,
        acceptedTermsVersion: 'pending-approval-2026-08-25',
        acceptedPrivacyVersion: 'pending-approval-2026-08-25',
      })
    );
  });

  test('user cannot create another user profile', async () => {
    const bob = testEnv.authenticatedContext(BOB_UID, verifiedEmail).firestore();
    await assertFails(
      setDoc(doc(bob, 'wsfMemberProfiles', ALICE_UID), {
        displayName: 'Not Alice',
        adultConfirmation: true,
        acceptedTermsVersion: 'pending-approval-2026-08-25',
        acceptedPrivacyVersion: 'pending-approval-2026-08-25',
      })
    );
  });

  test('owner cannot flip adultConfirmation to false on update', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID, verifiedEmail).firestore();
    await assertFails(
      updateDoc(doc(alice, 'wsfMemberProfiles', ALICE_UID), {
        adultConfirmation: false,
      })
    );
  });

  test('owner cannot delete own profile', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID, verifiedEmail).firestore();
    await assertFails(deleteDoc(doc(alice, 'wsfMemberProfiles', ALICE_UID)));
  });
});

// ─── wsfCommunityGroups ───────────────────────────────────────────────────────

describe('wsfCommunityGroups', () => {
  test('member can read own group', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID, verifiedEmail).firestore();
    await assertSucceeds(getDoc(doc(alice, 'wsfCommunityGroups', GROUP_ID)));
  });

  test('non-member cannot read group', async () => {
    const bob = testEnv.authenticatedContext(BOB_UID, verifiedEmail).firestore();
    await assertFails(getDoc(doc(bob, 'wsfCommunityGroups', GROUP_ID)));
  });

  test('platform admin can read any group', async () => {
    const admin = testEnv
      .authenticatedContext(ADMIN_UID, { ...verifiedEmail, role: 'platformAdmin' })
      .firestore();
    await assertSucceeds(getDoc(doc(admin, 'wsfCommunityGroups', GROUP_ID)));
    await assertSucceeds(getDoc(doc(admin, 'wsfCommunityGroups', OTHER_GROUP_ID)));
  });

  test('client cannot create a group directly', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID, verifiedEmail).firestore();
    await assertFails(
      setDoc(doc(alice, 'wsfCommunityGroups', 'wsfGroupNew'), {
        displayName: 'Client Written',
        groupType: 'familyFriends',
        joinPolicy: 'private',
        createdByUserId: ALICE_UID,
        lifecycleStatus: 'active',
        isSample: false,
      })
    );
  });

  test('client cannot update or delete a group', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID, verifiedEmail).firestore();
    await assertFails(
      updateDoc(doc(alice, 'wsfCommunityGroups', GROUP_ID), { displayName: 'Hacked' })
    );
    await assertFails(deleteDoc(doc(alice, 'wsfCommunityGroups', GROUP_ID)));
  });

  test('platform admin cannot write groups either (read-only ruling)', async () => {
    const admin = testEnv
      .authenticatedContext(ADMIN_UID, { ...verifiedEmail, role: 'platformAdmin' })
      .firestore();
    await assertFails(
      updateDoc(doc(admin, 'wsfCommunityGroups', GROUP_ID), { displayName: 'Admin edit' })
    );
    await assertFails(deleteDoc(doc(admin, 'wsfCommunityGroups', GROUP_ID)));
  });
});

// ─── wsfMemberships ───────────────────────────────────────────────────────────

describe('wsfMemberships', () => {
  test('owner can read own membership', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID, verifiedEmail).firestore();
    await assertSucceeds(getDoc(doc(alice, 'wsfMemberships', `${GROUP_ID}_${ALICE_UID}`)));
  });

  test('other user cannot read a membership they do not own', async () => {
    const bob = testEnv.authenticatedContext(BOB_UID, verifiedEmail).firestore();
    await assertFails(getDoc(doc(bob, 'wsfMemberships', `${GROUP_ID}_${ALICE_UID}`)));
  });

  test('platform admin can read any membership', async () => {
    const admin = testEnv
      .authenticatedContext(ADMIN_UID, { ...verifiedEmail, role: 'platformAdmin' })
      .firestore();
    await assertSucceeds(getDoc(doc(admin, 'wsfMemberships', `${GROUP_ID}_${ALICE_UID}`)));
  });

  test('client cannot create a membership directly', async () => {
    const bob = testEnv.authenticatedContext(BOB_UID, verifiedEmail).firestore();
    await assertFails(
      setDoc(doc(bob, 'wsfMemberships', `${GROUP_ID}_${BOB_UID}`), {
        groupId: GROUP_ID,
        userId: BOB_UID,
        role: 'foundingChampion',
        membershipStatus: 'active',
      })
    );
  });

  test('client cannot forge a membership for another user', async () => {
    const bob = testEnv.authenticatedContext(BOB_UID, verifiedEmail).firestore();
    await assertFails(
      setDoc(doc(bob, 'wsfMemberships', `${GROUP_ID}_forgedAlice`), {
        groupId: GROUP_ID,
        userId: ALICE_UID,
        role: 'foundingChampion',
        membershipStatus: 'active',
      })
    );
  });

  test('client cannot update or delete a membership', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID, verifiedEmail).firestore();
    await assertFails(
      updateDoc(doc(alice, 'wsfMemberships', `${GROUP_ID}_${ALICE_UID}`), {
        role: 'foundingChampion',
      })
    );
    await assertFails(deleteDoc(doc(alice, 'wsfMemberships', `${GROUP_ID}_${ALICE_UID}`)));
  });
});

// ─── Unauthenticated ──────────────────────────────────────────────────────────

describe('unauthenticated', () => {
  test('anonymous cannot read any wsf collection', async () => {
    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, 'wsfMemberProfiles', ALICE_UID)));
    await assertFails(getDoc(doc(anon, 'wsfCommunityGroups', GROUP_ID)));
    await assertFails(getDoc(doc(anon, 'wsfMemberships', `${GROUP_ID}_${ALICE_UID}`)));
  });
});
