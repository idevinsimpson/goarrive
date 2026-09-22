/**
 * wsf-rules.test.ts
 *
 * WSF Firestore Security Rules test suite.
 * Uses @firebase/rules-unit-testing v5 with the Firebase Emulator Suite.
 *
 * Run:
 *   cd functions-westayfit
 *   firebase emulators:exec --only firestore \
 *     --config ../firebase.json --project demo-wsf-local \
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
import {
  collection,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

const PROJECT_ID = 'demo-wsf-local';
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

    // Former members keep their rows with a non-active status (the server
    // never deletes a membership document); they must not read the group.
    await setDoc(doc(db, 'wsfMemberships', `${GROUP_ID}_removed-uid`), {
      groupId: GROUP_ID,
      userId: 'removed-uid',
      role: 'member',
      membershipStatus: 'removed',
    });
    await setDoc(doc(db, 'wsfMemberships', `${GROUP_ID}_departed-uid`), {
      groupId: GROUP_ID,
      userId: 'departed-uid',
      role: 'member',
      membershipStatus: 'departed',
    });
    // A row with no status at all is not membership either.
    await setDoc(doc(db, 'wsfMemberships', `${GROUP_ID}_nostatus-uid`), {
      groupId: GROUP_ID,
      userId: 'nostatus-uid',
      role: 'member',
    });

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

// ─── the member directory has exactly ONE door ───────────────────────────────

/**
 * `wsfCommunityMembers` returns names, and it decides who may see them. That
 * decision is worth nothing if a client can read the same rows directly.
 *
 * Nothing in the visibility work changed these rules — the diff on
 * firestore.rules is empty — and these tests exist so that stays true by
 * enforcement rather than by intention. Two properties carry the whole model:
 *
 *   · A CLIENT CANNOT QUERY `wsfMemberships` BY GROUP. Firestore evaluates
 *     `resource.data.userId == request.auth.uid` per document, and rejects a
 *     query it cannot prove satisfiable in advance. A `where('groupId', '==',
 *     X)` query is therefore refused ENTIRELY — not filtered down to the
 *     caller's own row, which is the intuition that gets this wrong.
 *
 *   · A CLIENT CANNOT READ ANOTHER MEMBER'S PROFILE. Even holding a uid, the
 *     name behind it is out of reach.
 *
 * Together: the only way to learn who is in a community is to ask the
 * callable, which asks whether that person chose to be named.
 */
describe('a client cannot assemble the member directory for itself', () => {
  test('a member cannot QUERY memberships by group — the query is refused whole', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID, verifiedEmail).firestore();
    await assertFails(
      getDocs(query(collection(alice, 'wsfMemberships'), where('groupId', '==', GROUP_ID)))
    );
  });

  test('adding the visibility filter does not make it allowed', async () => {
    /*
      The shape a client would reach for after reading the callable's source.
      It is still refused, because no combination of filters proves every
      matched document belongs to the caller.
    */
    const alice = testEnv.authenticatedContext(ALICE_UID, verifiedEmail).firestore();
    await assertFails(
      getDocs(
        query(
          collection(alice, 'wsfMemberships'),
          where('groupId', '==', GROUP_ID),
          where('membershipStatus', '==', 'active'),
          where('visibility', '==', 'visible')
        )
      )
    );
  });

  test('an unfiltered collection read is refused', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID, verifiedEmail).firestore();
    await assertFails(getDocs(collection(alice, 'wsfMemberships')));
  });

  test("a member CAN query their OWN memberships — the rule is ownership, not silence", async () => {
    // The positive control. Without it, the three denials above would also
    // pass against a rule that simply refused every query on the collection,
    // and a later widening could not be told apart from this state.
    const alice = testEnv.authenticatedContext(ALICE_UID, verifiedEmail).firestore();
    await assertSucceeds(
      getDocs(query(collection(alice, 'wsfMemberships'), where('userId', '==', ALICE_UID)))
    );
  });

  test('a member cannot query memberships under ANOTHER uid', async () => {
    const bob = testEnv.authenticatedContext(BOB_UID, verifiedEmail).firestore();
    await assertFails(
      getDocs(query(collection(bob, 'wsfMemberships'), where('userId', '==', ALICE_UID)))
    );
  });

  test('a client cannot write its own visibility directly — the callable is the only writer', async () => {
    /*
      `allow create, update, delete: if false` on wsfMemberships. A client that
      could write this field could publish itself while skipping every check in
      wsfSetCommunityVisibility — and, since the doc id is not the authority,
      could write a row for somebody else.
    */
    const alice = testEnv.authenticatedContext(ALICE_UID, verifiedEmail).firestore();
    await assertFails(
      updateDoc(doc(alice, 'wsfMemberships', `${GROUP_ID}_${ALICE_UID}`), {
        visibility: 'visible',
      })
    );
    await assertFails(
      setDoc(doc(alice, 'wsfMemberships', `${GROUP_ID}_${BOB_UID}`), {
        groupId: GROUP_ID,
        userId: BOB_UID,
        role: 'member',
        membershipStatus: 'active',
        visibility: 'visible',
      })
    );
  });

  test('holding a uid is not holding a name — another profile stays unreadable', async () => {
    const bob = testEnv.authenticatedContext(BOB_UID, verifiedEmail).firestore();
    await assertFails(getDoc(doc(bob, 'wsfMemberProfiles', ALICE_UID)));
    await assertFails(
      getDocs(query(collection(bob, 'wsfMemberProfiles'), where('displayName', '==', 'Alice')))
    );
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

  test('a REMOVED member cannot read the group (row kept, status changed)', async () => {
    const removed = testEnv.authenticatedContext('removed-uid', verifiedEmail).firestore();
    // Positive control: the seeded membership row exists and belongs to this
    // uid (readable under the unchanged wsfMemberships owner rule), so the
    // denial below is about membershipStatus, not about a missing row.
    await assertSucceeds(getDoc(doc(removed, 'wsfMemberships', `${GROUP_ID}_removed-uid`)));
    await assertFails(getDoc(doc(removed, 'wsfCommunityGroups', GROUP_ID)));
  });

  test('a DEPARTED member cannot read the group', async () => {
    const departed = testEnv.authenticatedContext('departed-uid', verifiedEmail).firestore();
    await assertSucceeds(getDoc(doc(departed, 'wsfMemberships', `${GROUP_ID}_departed-uid`)));
    await assertFails(getDoc(doc(departed, 'wsfCommunityGroups', GROUP_ID)));
  });

  test('a membership row with no membershipStatus does not grant the group read', async () => {
    const nostatus = testEnv.authenticatedContext('nostatus-uid', verifiedEmail).firestore();
    await assertSucceeds(getDoc(doc(nostatus, 'wsfMemberships', `${GROUP_ID}_nostatus-uid`)));
    await assertFails(getDoc(doc(nostatus, 'wsfCommunityGroups', GROUP_ID)));
  });

  test('membership is scoped to its own group: an active member of one group cannot read another', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID, verifiedEmail).firestore();
    await assertSucceeds(getDoc(doc(alice, 'wsfCommunityGroups', GROUP_ID)));
    await assertFails(getDoc(doc(alice, 'wsfCommunityGroups', OTHER_GROUP_ID)));
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

// ─── wsfGoals and its subcollections ─────────────────────────────────────────

describe('wsfGoals', () => {
  /**
   * wsfGoals has no `match` block of its own, so it falls to the closing
   * `match /{document=**} { allow read, write: if false; }`. That recursive
   * wildcard covers SUBCOLLECTIONS as well as documents, which is what makes
   * the recent-additions tail safe to store at
   * `wsfGoals/{goalId}/recentAdditions/{attemptId}` with no rules change: it
   * is reachable only through the gated callable, never by a client.
   *
   * Asserted rather than assumed, because the whole privacy argument for that
   * tail rests on it. A future `match /wsfGoals/{goalId}` block that opened
   * reads would silently open the tail too unless it stopped at the document —
   * and this test would fail.
   */
  test('no client can read a goal, or its recentAdditions tail', async () => {
    const goalId = 'wsfGoal1';
    const attemptId = 'wsfAttempt00000001';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'wsfGoals', goalId), {
        communityGroupId: GROUP_ID,
        title: 'Rules fixture goal',
        aggregateDisplayAuthorized: true,
      });
      await setDoc(doc(db, 'wsfGoals', goalId, 'recentAdditions', attemptId), {
        amount: 20,
        at: '2026-09-18T13:04:00.000Z',
      });
    });

    // An ACTIVE MEMBER of the goal's community — the most-entitled client
    // there is — still cannot read either one directly.
    const alice = testEnv.authenticatedContext(ALICE_UID, verifiedEmail).firestore();
    await assertFails(getDoc(doc(alice, 'wsfGoals', goalId)));
    await assertFails(getDoc(doc(alice, 'wsfGoals', goalId, 'recentAdditions', attemptId)));

    // And an anonymous caller — the public display's own identity — cannot
    // either. Its access comes from the callable, never from Firestore.
    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, 'wsfGoals', goalId)));
    await assertFails(getDoc(doc(anon, 'wsfGoals', goalId, 'recentAdditions', attemptId)));
  });

  test('no client can write the recentAdditions tail', async () => {
    const alice = testEnv.authenticatedContext(ALICE_UID, verifiedEmail).firestore();
    await assertFails(
      setDoc(doc(alice, 'wsfGoals', 'wsfGoal1', 'recentAdditions', 'wsfAttempt00000002'), {
        amount: 999,
        at: '2026-09-18T13:04:00.000Z',
      })
    );
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
