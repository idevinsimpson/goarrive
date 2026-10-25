/**
 * firestore.rules.test.ts
 *
 * Firestore Security Rules test suite for GoArrive.
 * Uses @firebase/rules-unit-testing v5 with the Firebase Emulator Suite.
 *
 * Run with:
 *   firebase emulators:exec --only firestore "npx jest firestore.rules.test.ts"
 *
 * Or start the emulator separately and run:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx jest firestore.rules.test.ts
 *
 * Prerequisites:
 *   npm install --save-dev @firebase/rules-unit-testing jest @types/jest ts-jest
 *   (already installed in /functions — run tests from that directory)
 *
 * Coverage:
 *   - member_plans: coach reads own plan, coach blocked from other coach's plan,
 *     member reads own plan, unauthenticated blocked, non-existent doc (coach only)
 *   - members: member reads own doc, coach reads own member, cross-coach blocked
 *   - notifications: member reads own, member blocked from others, coach creates
 *   - intakeSubmissions: coach reads own, cross-coach blocked
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
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

// ─── Constants ────────────────────────────────────────────────────────────────

const PROJECT_ID = 'goarrive-test';
const RULES_PATH = resolve(__dirname, 'firestore.rules');

const COACH_A_UID = 'coachA';
const COACH_B_UID = 'coachB';
const MEMBER_A_UID = 'memberA'; // belongs to Coach A
const MEMBER_B_UID = 'memberB'; // belongs to Coach B
const PLAN_A_ID = 'planA';      // owned by Coach A, for Member A
const PLAN_B_ID = 'planB';      // owned by Coach B, for Member B
const ADMIN_UID = 'platformAdmin1';
const LOG_PENDING_A_ID = 'logPendingA'; // pending workout log: Member A, Coach A

// ─── Test environment setup ───────────────────────────────────────────────────

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

  // Seed test data using the admin context (bypasses rules)
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    // Seed member_plans
    await setDoc(doc(db, 'member_plans', PLAN_A_ID), {
      coachId: COACH_A_UID,
      memberId: MEMBER_A_UID,
      goals: ['Fat loss'],
    });
    await setDoc(doc(db, 'member_plans', PLAN_B_ID), {
      coachId: COACH_B_UID,
      memberId: MEMBER_B_UID,
      goals: ['Muscle gain'],
    });

    // Seed members
    await setDoc(doc(db, 'members', MEMBER_A_UID), {
      uid: MEMBER_A_UID,
      coachId: COACH_A_UID,
      email: 'membera@test.com',
      role: 'member',
    });
    await setDoc(doc(db, 'members', MEMBER_B_UID), {
      uid: MEMBER_B_UID,
      coachId: COACH_B_UID,
      email: 'memberb@test.com',
      role: 'member',
    });

    // Seed notifications
    await setDoc(doc(db, 'notifications', 'notif1'), {
      recipientId: MEMBER_A_UID,
      coachId: COACH_A_UID,
      message: 'Your plan has been updated.',
      read: false,
    });

    // Seed intakeSubmissions
    await setDoc(doc(db, 'intakeSubmissions', MEMBER_A_UID), {
      uid: MEMBER_A_UID,
      coachId: COACH_A_UID,
      goals: ['Fat loss'],
    });
    await setDoc(doc(db, 'intakeSubmissions', 'leadNoCoach'), {
      uid: 'leadNoCoach',
      coachId: 'unassigned',
      goals: ['Muscle gain'],
    });

    // Seed pending workout_log (no review fields yet)
    await setDoc(doc(db, 'workout_logs', LOG_PENDING_A_ID), {
      memberId: MEMBER_A_UID,
      coachId: COACH_A_UID,
      assignmentId: 'asgA',
      completedAt: new Date('2026-04-30T12:00:00Z'),
      journal: '',
    });
  });
});

// ─── Helper: create authenticated Firestore context ───────────────────────────

function asCoachA() {
  // Bootstrap coach: UID matches coachId (no custom claims needed)
  return testEnv.authenticatedContext(COACH_A_UID).firestore();
}

function asCoachB() {
  return testEnv.authenticatedContext(COACH_B_UID).firestore();
}

function asMemberA() {
  return testEnv.authenticatedContext(MEMBER_A_UID).firestore();
}

function asMemberB() {
  return testEnv.authenticatedContext(MEMBER_B_UID).firestore();
}

function asUnauthenticated() {
  return testEnv.unauthenticatedContext().firestore();
}

function asPlatformAdmin() {
  // Custom-claim platformAdmin: token.admin == true triggers isPlatformAdmin()
  return testEnv.authenticatedContext(ADMIN_UID, { admin: true }).firestore();
}

// ─── member_plans ─────────────────────────────────────────────────────────────

describe('member_plans', () => {
  test('coach A can read their own member plan', async () => {
    await assertSucceeds(getDoc(doc(asCoachA(), 'member_plans', PLAN_A_ID)));
  });

  test('coach A is blocked from reading coach B member plan', async () => {
    await assertFails(getDoc(doc(asCoachA(), 'member_plans', PLAN_B_ID)));
  });

  test('member A can read their own plan', async () => {
    await assertSucceeds(getDoc(doc(asMemberA(), 'member_plans', PLAN_A_ID)));
  });

  test('member A is blocked from reading member B plan', async () => {
    await assertFails(getDoc(doc(asMemberA(), 'member_plans', PLAN_B_ID)));
  });

  test('unauthenticated user is blocked from reading any plan', async () => {
    await assertFails(getDoc(doc(asUnauthenticated(), 'member_plans', PLAN_A_ID)));
  });

  test('coach A can update their own member plan', async () => {
    await assertSucceeds(
      updateDoc(doc(asCoachA(), 'member_plans', PLAN_A_ID), { goals: ['Fat loss', 'Energy'] })
    );
  });

  test('coach A is blocked from updating coach B member plan', async () => {
    await assertFails(
      updateDoc(doc(asCoachA(), 'member_plans', PLAN_B_ID), { goals: ['Hacked'] })
    );
  });

  test('member A is blocked from updating their own plan (read-only)', async () => {
    await assertFails(
      updateDoc(doc(asMemberA(), 'member_plans', PLAN_A_ID), { goals: ['Changed'] })
    );
  });

  test('coach A can create a new plan for their member', async () => {
    await assertSucceeds(
      setDoc(doc(asCoachA(), 'member_plans', 'newPlan'), {
        coachId: COACH_A_UID,
        memberId: MEMBER_A_UID,
        goals: [],
      })
    );
  });

  test('coach A is blocked from creating a plan with coach B as owner', async () => {
    await assertFails(
      setDoc(doc(asCoachA(), 'member_plans', 'fakePlan'), {
        coachId: COACH_B_UID,
        memberId: MEMBER_A_UID,
        goals: [],
      })
    );
  });
});

// ─── members ──────────────────────────────────────────────────────────────────

describe('members', () => {
  test('member A can read their own member doc', async () => {
    await assertSucceeds(getDoc(doc(asMemberA(), 'members', MEMBER_A_UID)));
  });

  test('coach A can read their own member doc', async () => {
    await assertSucceeds(getDoc(doc(asCoachA(), 'members', MEMBER_A_UID)));
  });

  test('coach B is blocked from reading coach A member doc', async () => {
    await assertFails(getDoc(doc(asCoachB(), 'members', MEMBER_A_UID)));
  });

  test('member B is blocked from reading member A doc', async () => {
    await assertFails(getDoc(doc(asMemberB(), 'members', MEMBER_A_UID)));
  });

  test('unauthenticated user is blocked from reading any member doc', async () => {
    await assertFails(getDoc(doc(asUnauthenticated(), 'members', MEMBER_A_UID)));
  });
});

// ─── notifications ────────────────────────────────────────────────────────────

describe('notifications', () => {
  test('member A can read their own notification', async () => {
    await assertSucceeds(getDoc(doc(asMemberA(), 'notifications', 'notif1')));
  });

  test('member B is blocked from reading member A notification', async () => {
    await assertFails(getDoc(doc(asMemberB(), 'notifications', 'notif1')));
  });

  test('member A can mark their own notification as read', async () => {
    await assertSucceeds(
      updateDoc(doc(asMemberA(), 'notifications', 'notif1'), { read: true })
    );
  });

  test('member B is blocked from marking member A notification as read', async () => {
    await assertFails(
      updateDoc(doc(asMemberB(), 'notifications', 'notif1'), { read: true })
    );
  });

  test('coach A can create a notification for their member', async () => {
    await assertSucceeds(
      setDoc(doc(asCoachA(), 'notifications', 'notif2'), {
        recipientId: MEMBER_A_UID,
        coachId: COACH_A_UID,
        message: 'Plan updated.',
        read: false,
      })
    );
  });

  test('unauthenticated user is blocked from reading notifications', async () => {
    await assertFails(getDoc(doc(asUnauthenticated(), 'notifications', 'notif1')));
  });
});

// ─── intakeSubmissions ────────────────────────────────────────────────────────

describe('intakeSubmissions', () => {
  test('coach A can read their own member intake submission', async () => {
    await assertSucceeds(getDoc(doc(asCoachA(), 'intakeSubmissions', MEMBER_A_UID)));
  });

  test('coach B is blocked from reading coach A member intake submission', async () => {
    await assertFails(getDoc(doc(asCoachB(), 'intakeSubmissions', MEMBER_A_UID)));
  });

  test('unauthenticated user can create an intake submission', async () => {
    await assertSucceeds(
      setDoc(doc(asUnauthenticated(), 'intakeSubmissions', 'newSubmission'), {
        uid: null,
        coachId: COACH_A_UID,
        goals: ['Fat loss'],
      })
    );
  });

  test('platformAdmin can read a coach-assigned intake submission', async () => {
    await assertSucceeds(getDoc(doc(asPlatformAdmin(), 'intakeSubmissions', MEMBER_A_UID)));
  });

  test('platformAdmin can read an unassigned intake submission', async () => {
    await assertSucceeds(getDoc(doc(asPlatformAdmin(), 'intakeSubmissions', 'leadNoCoach')));
  });

  test('coach A is blocked from reading an unassigned intake submission', async () => {
    await assertFails(getDoc(doc(asCoachA(), 'intakeSubmissions', 'leadNoCoach')));
  });

  test('platformAdmin can list unassigned intake submissions', async () => {
    await assertSucceeds(
      getDocs(query(collection(asPlatformAdmin(), 'intakeSubmissions'), where('coachId', '==', 'unassigned')))
    );
  });
});

// ─── workout_logs (coach review field alignment) ──────────────────────────────

describe('workout_logs — coach review field alignment', () => {
  test('non-admin coach (bootstrap) can update pending log to reviewed using canonical fields', async () => {
    await assertSucceeds(
      updateDoc(doc(asCoachA(), 'workout_logs', LOG_PENDING_A_ID), {
        coachNote: 'Great form on the squats.',
        coachReaction: '💪',
        reviewedAt: new Date('2026-05-02T14:00:00Z'),
        reviewStatus: 'reviewed',
        updatedAt: new Date('2026-05-02T14:00:00Z'),
      })
    );
  });

  test('non-admin coach cannot write a stray field alongside canonical review fields', async () => {
    await assertFails(
      updateDoc(doc(asCoachA(), 'workout_logs', LOG_PENDING_A_ID), {
        coachNote: 'note',
        coachReaction: '🔥',
        reviewedAt: new Date('2026-05-02T14:00:00Z'),
        reviewStatus: 'reviewed',
        updatedAt: new Date('2026-05-02T14:00:00Z'),
        memberId: 'hacked', // stray / disallowed
      })
    );
  });

  test('member cannot write coach review fields on their own log', async () => {
    await assertFails(
      updateDoc(doc(asMemberA(), 'workout_logs', LOG_PENDING_A_ID), {
        coachNote: 'self-praise',
        reviewStatus: 'reviewed',
      })
    );
  });

  test('member journal update on own log still works', async () => {
    await assertSucceeds(
      updateDoc(doc(asMemberA(), 'workout_logs', LOG_PENDING_A_ID), {
        journal: 'Felt strong today.',
        glow: 'Hit a new PR',
        grow: 'Need more sleep',
        rating: 4,
        updatedAt: new Date('2026-05-02T14:00:00Z'),
      })
    );
  });

  test('platformAdmin bypass still works (can write canonical + stray together)', async () => {
    await assertSucceeds(
      updateDoc(doc(asPlatformAdmin(), 'workout_logs', LOG_PENDING_A_ID), {
        coachNote: 'admin override',
        coachReaction: '⭐',
        reviewedAt: new Date('2026-05-02T14:00:00Z'),
        reviewStatus: 'reviewed',
        updatedAt: new Date('2026-05-02T14:00:00Z'),
        adminAudit: { actor: ADMIN_UID }, // stray field allowed under admin bypass
      })
    );
  });

  test('legacy coachComment write by coach is rejected', async () => {
    await assertFails(
      updateDoc(doc(asCoachA(), 'workout_logs', LOG_PENDING_A_ID), {
        coachComment: 'legacy field name',
        coachReaction: '👏',
        reviewedAt: new Date('2026-05-02T14:00:00Z'),
        updatedAt: new Date('2026-05-02T14:00:00Z'),
      })
    );
  });

  test('legacy coachNotes (plural) write by coach is rejected', async () => {
    await assertFails(
      updateDoc(doc(asCoachA(), 'workout_logs', LOG_PENDING_A_ID), {
        coachNotes: 'legacy plural field',
        coachReaction: '❤️',
        reviewedAt: new Date('2026-05-02T14:00:00Z'),
        updatedAt: new Date('2026-05-02T14:00:00Z'),
      })
    );
  });
});

// ─── musicPrefs — per-user liked/disliked workout music tracks ────────────────

describe('musicPrefs', () => {
  test('member can write their own music prefs', async () => {
    await assertSucceeds(
      setDoc(
        doc(asMemberA(), 'musicPrefs', MEMBER_A_UID),
        { likedTracks: ['edm/3'], dislikedTracks: [] },
        { merge: true }
      )
    );
  });

  test('coach can read and write their own music prefs', async () => {
    await assertSucceeds(
      setDoc(
        doc(asCoachA(), 'musicPrefs', COACH_A_UID),
        { likedTracks: [], dislikedTracks: ['metal/7'] },
        { merge: true }
      )
    );
    await assertSucceeds(getDoc(doc(asCoachA(), 'musicPrefs', COACH_A_UID)));
  });

  test('member B cannot write member A music prefs', async () => {
    await assertFails(
      setDoc(doc(asMemberB(), 'musicPrefs', MEMBER_A_UID), { dislikedTracks: ['edm/1'] }, { merge: true })
    );
  });

  test('coach A cannot read member A music prefs', async () => {
    await assertFails(getDoc(doc(asCoachA(), 'musicPrefs', MEMBER_A_UID)));
  });

  test('unauthenticated cannot read or write music prefs', async () => {
    await assertFails(getDoc(doc(asUnauthenticated(), 'musicPrefs', MEMBER_A_UID)));
    await assertFails(
      setDoc(doc(asUnauthenticated(), 'musicPrefs', MEMBER_A_UID), { dislikedTracks: [] })
    );
  });

  test('platformAdmin can read and write any music prefs', async () => {
    await assertSucceeds(getDoc(doc(asPlatformAdmin(), 'musicPrefs', MEMBER_A_UID)));
    await assertSucceeds(
      setDoc(doc(asPlatformAdmin(), 'musicPrefs', MEMBER_A_UID), { likedTracks: ['pop/0'] }, { merge: true })
    );
  });
});

// ─── workoutMusicFeedback — shared per-workout track dislikes ─────────────────
// Member access requires member custom claims (role + coachId), unlike the
// bootstrap contexts above, because the rule uses isMemberOfCoach().

function asClaimedMemberA() {
  return testEnv
    .authenticatedContext(MEMBER_A_UID, { role: 'member', coachId: COACH_A_UID })
    .firestore();
}

function asClaimedMemberB() {
  return testEnv
    .authenticatedContext(MEMBER_B_UID, { role: 'member', coachId: COACH_B_UID })
    .firestore();
}

describe('workoutMusicFeedback', () => {
  const WORKOUT_A_ID = 'workoutA';

  test('coach (bootstrap) can write shared dislikes for their own workout', async () => {
    await assertSucceeds(
      setDoc(
        doc(asCoachA(), 'workoutMusicFeedback', COACH_A_UID, 'workouts', WORKOUT_A_ID),
        { dislikedTracks: ['house/2'] },
        { merge: true }
      )
    );
  });

  test('member of the coach can read and write shared dislikes', async () => {
    await assertSucceeds(
      setDoc(
        doc(asClaimedMemberA(), 'workoutMusicFeedback', COACH_A_UID, 'workouts', WORKOUT_A_ID),
        { dislikedTracks: ['edm/5'] },
        { merge: true }
      )
    );
    await assertSucceeds(
      getDoc(doc(asClaimedMemberA(), 'workoutMusicFeedback', COACH_A_UID, 'workouts', WORKOUT_A_ID))
    );
  });

  test('read of a not-yet-created feedback doc succeeds for tenant members', async () => {
    await assertSucceeds(
      getDoc(doc(asClaimedMemberA(), 'workoutMusicFeedback', COACH_A_UID, 'workouts', 'neverWritten'))
    );
  });

  test('member of another coach cannot read or write', async () => {
    await assertFails(
      getDoc(doc(asClaimedMemberB(), 'workoutMusicFeedback', COACH_A_UID, 'workouts', WORKOUT_A_ID))
    );
    await assertFails(
      setDoc(
        doc(asClaimedMemberB(), 'workoutMusicFeedback', COACH_A_UID, 'workouts', WORKOUT_A_ID),
        { dislikedTracks: ['edm/1'] },
        { merge: true }
      )
    );
  });

  test('unauthenticated cannot read', async () => {
    await assertFails(
      getDoc(doc(asUnauthenticated(), 'workoutMusicFeedback', COACH_A_UID, 'workouts', WORKOUT_A_ID))
    );
  });

  test('platformAdmin can read and write', async () => {
    await assertSucceeds(
      setDoc(
        doc(asPlatformAdmin(), 'workoutMusicFeedback', COACH_A_UID, 'workouts', WORKOUT_A_ID),
        { dislikedTracks: ['rock/9'] },
        { merge: true }
      )
    );
  });
});


describe('Playbook roster identity', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'session_instances', 'roster-session'), { memberId: 'roster-member', coachId: COACH_A_UID, status: 'scheduled' });
    });
  });
  test('linked member can query and stream own session and write live state', async () => {
    const db = testEnv.authenticatedContext('auth-member', { role: 'member', coachId: COACH_A_UID, memberId: 'roster-member' }).firestore();
    await assertSucceeds(getDocs(query(collection(db, 'session_instances'), where('memberId', '==', 'roster-member'), where('coachId', '==', COACH_A_UID))));
    await assertSucceeds(getDoc(doc(db, 'session_instances', 'roster-session')));
    await assertSucceeds(setDoc(doc(db, 'session_instances', 'roster-session', 'live', 'state'), { phase: 'work' }));
  });
  test('another member of the same coach cannot read or write the session', async () => {
    const db = testEnv.authenticatedContext('other-auth', { role: 'member', coachId: COACH_A_UID, memberId: 'other-roster' }).firestore();
    await assertFails(getDoc(doc(db, 'session_instances', 'roster-session')));
    await assertFails(setDoc(doc(db, 'session_instances', 'roster-session', 'live', 'state'), { phase: 'work' }));
  });
});

test('allocated session stays queryable by its member without a host capability; unrelated member remains denied', async () => {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const ref = doc(ctx.firestore(), 'session_instances', 'safe-allocation');
    await setDoc(ref, { coachId: COACH_A_UID, memberId: 'roster-member', status: 'scheduled', zoomStartUrl: 'synthetic-old-host-marker' });
    // Same deletion transform used by both allocator updates; no historical/live sweep.
    await updateDoc(ref, { status: 'allocated', zoomJoinUrl: 'https://example.invalid/participant', zoomStartUrl: deleteField() });
  });
  const memberDb = testEnv.authenticatedContext('auth-member', { role: 'member', coachId: COACH_A_UID, memberId: 'roster-member' }).firestore();
  const result = await assertSucceeds(getDocs(query(collection(memberDb, 'session_instances'), where('memberId', '==', 'roster-member'), where('coachId', '==', COACH_A_UID))));
  expect(result.size).toBe(1);
  expect(result.docs[0].data()).toMatchObject({ status: 'allocated', zoomJoinUrl: 'https://example.invalid/participant' });
  expect(result.docs[0].data()).not.toHaveProperty('zoomStartUrl');
  await assertFails(getDoc(doc(testEnv.authenticatedContext('other', { role: 'member', memberId: 'other', coachId: COACH_A_UID }).firestore(), 'session_instances', 'safe-allocation')));
});

test('legacy host field is not redacted by full-document rules: separate historical remediation is still needed', async () => {
  await testEnv.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'session_instances', 'legacy-host-field'), { coachId: COACH_A_UID, memberId: MEMBER_A_UID, zoomStartUrl: 'synthetic-legacy-marker' }));
  const snapshot = await assertSucceeds(getDoc(doc(testEnv.authenticatedContext(MEMBER_A_UID, { role: 'member', coachId: COACH_A_UID }).firestore(), 'session_instances', 'legacy-host-field')));
  expect(snapshot.data()?.zoomStartUrl).toBe('synthetic-legacy-marker');
});


test('linked member retains historical UID and current roster sessions without exposing others', async () => {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    for (const [id, memberId, coachId] of [['legacy', 'auth-member', COACH_A_UID], ['current', 'roster-member', COACH_A_UID], ['other-member', 'other', COACH_A_UID], ['other-coach', 'roster-member', COACH_B_UID]]) {
      await setDoc(doc(ctx.firestore(), 'session_instances', id), { memberId, coachId });
    }
  });
  const db = testEnv.authenticatedContext('auth-member', { role: 'member', coachId: COACH_A_UID, memberId: 'roster-member' }).firestore();
  const result = await assertSucceeds(getDocs(query(collection(db, 'session_instances'), where('memberId', 'in', ['auth-member', 'roster-member']), where('coachId', '==', COACH_A_UID))));
  expect(result.docs.map(d => d.id).sort()).toEqual(['current', 'legacy']);
});

// Deployed WSF access policy: users have no GoArrive custom role claims.
describe('shared WSF data access', () => {
  const profile = { displayName: 'Synthetic adult', adultConfirmation: true, acceptedTermsVersion: 'v1', acceptedPrivacyVersion: 'v1' };
  const wsf = (uid: string, verified = true) => testEnv.authenticatedContext(uid, { email_verified: verified }).firestore();
  const adminDb = () => testEnv.authenticatedContext('wsf-admin', { role: 'platformAdmin' }).firestore();
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'wsfMemberProfiles', 'owner'), profile);
      await setDoc(doc(db, 'wsfCommunityGroups', 'group'), { name: 'Synthetic group' });
      for (const [uid, status] of [['owner', 'active'], ['removed', 'removed'], ['pending', 'pending']]) {
        await setDoc(doc(db, 'wsfMemberships', 'group_' + uid), { userId: uid, communityGroupId: 'group', membershipStatus: status });
      }
    });
  });
  test('verified adult owner can create a profile without role claims', async () => {
    await assertSucceeds(setDoc(doc(wsf('new'), 'wsfMemberProfiles', 'new'), profile));
  });
  test('creation rejects unverified, non-adult, missing terms and another owner', async () => {
    await assertFails(setDoc(doc(wsf('new', false), 'wsfMemberProfiles', 'new'), profile));
    await assertFails(setDoc(doc(wsf('new'), 'wsfMemberProfiles', 'new'), { ...profile, adultConfirmation: false }));
    const { acceptedTermsVersion, ...missingTerms } = profile;
    await assertFails(setDoc(doc(wsf('new'), 'wsfMemberProfiles', 'new'), missingTerms));
    await assertFails(setDoc(doc(wsf('new'), 'wsfMemberProfiles', 'another'), profile));
  });
  test('profiles allow owner/admin reads and reject other/anonymous readers', async () => {
    for (const db of [wsf('owner'), adminDb()]) await assertSucceeds(getDoc(doc(db, 'wsfMemberProfiles', 'owner')));
    for (const db of [wsf('other'), testEnv.unauthenticatedContext().firestore()]) await assertFails(getDoc(doc(db, 'wsfMemberProfiles', 'owner')));
  });
  test('profile updates retain verification/adult invariants and reject admin writes/deletes', async () => {
    await assertSucceeds(updateDoc(doc(wsf('owner'), 'wsfMemberProfiles', 'owner'), { displayName: 'Updated' }));
    await assertFails(updateDoc(doc(wsf('owner', false), 'wsfMemberProfiles', 'owner'), { displayName: 'Unverified' }));
    await assertFails(updateDoc(doc(wsf('owner'), 'wsfMemberProfiles', 'owner'), { adultConfirmation: false }));
    await assertFails(updateDoc(doc(adminDb(), 'wsfMemberProfiles', 'owner'), { displayName: 'Admin update' }));
    await assertFails(deleteDoc(doc(wsf('owner'), 'wsfMemberProfiles', 'owner')));
  });
  test('groups allow active-member/admin reads, not removed/pending/other/anonymous', async () => {
    for (const db of [wsf('owner'), adminDb()]) await assertSucceeds(getDoc(doc(db, 'wsfCommunityGroups', 'group')));
    for (const db of [wsf('removed'), wsf('pending'), wsf('other'), testEnv.unauthenticatedContext().firestore()]) await assertFails(getDoc(doc(db, 'wsfCommunityGroups', 'group')));
  });
  test('membership ownership uses userId and allows retained removed rows', async () => {
    await assertSucceeds(getDoc(doc(wsf('owner'), 'wsfMemberships', 'group_owner')));
    await assertSucceeds(getDoc(doc(wsf('removed'), 'wsfMemberships', 'group_removed')));
    await assertSucceeds(getDoc(doc(adminDb(), 'wsfMemberships', 'group_owner')));
    await assertFails(getDoc(doc(wsf('other'), 'wsfMemberships', 'group_owner')));
  });
  test('group and membership writes remain server-only, even for owner/admin', async () => {
    for (const db of [wsf('owner'), adminDb()]) {
      for (const [collectionName, id, data] of [['wsfCommunityGroups', 'group', { name: 'Client' }], ['wsfMemberships', 'group_owner', { userId: 'owner', membershipStatus: 'active' }]] as const) {
        await assertFails(setDoc(doc(db, collectionName, 'new'), data));
        await assertFails(updateDoc(doc(db, collectionName, id), data));
        await assertFails(deleteDoc(doc(db, collectionName, id)));
      }
    }
  });
});
