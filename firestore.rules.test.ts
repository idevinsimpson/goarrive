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
    const db = modularDb(ctx.firestore());

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

// ─── Helper: unwrap RUT's compat Firestore for the modular API ────────────────

// @firebase/rules-unit-testing v5 returns a COMPAT Firestore -- its public types
// declare `firestore(): firebase.firestore.Firestore`. Every call below uses the
// MODULAR API (collection/doc/setDoc/...), which accepts a compat instance only
// by unwrapping `._delegate` internally. Whether that unwrap yields the same
// Firestore class the modular API expects depends on how the `firebase/compat/*`
// and `firebase/firestore` entry points resolve in a given process -- so the
// suite passes in one environment and fails in another with:
//   "Expected first argument to collection() to be a CollectionReference,
//    a DocumentReference or FirebaseFirestore"
// Unwrapping explicitly removes the accident.
function modularDb(compat: unknown): any {
  return (compat as any)?._delegate ?? compat;
}

// ─── Helper: create authenticated Firestore context ───────────────────────────

function asCoachA() {
  // Bootstrap coach: UID matches coachId (no custom claims needed)
  return modularDb(testEnv.authenticatedContext(COACH_A_UID).firestore());
}

function asCoachB() {
  return modularDb(testEnv.authenticatedContext(COACH_B_UID).firestore());
}

function asMemberA() {
  return modularDb(testEnv.authenticatedContext(MEMBER_A_UID).firestore());
}

function asMemberB() {
  return modularDb(testEnv.authenticatedContext(MEMBER_B_UID).firestore());
}

function asUnauthenticated() {
  return modularDb(testEnv.unauthenticatedContext().firestore());
}

function asPlatformAdmin() {
  // Custom-claim platformAdmin: token.admin == true triggers isPlatformAdmin()
  return modularDb(
    testEnv.authenticatedContext(ADMIN_UID, { admin: true }).firestore()
  );
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
  return modularDb(
    testEnv
      .authenticatedContext(MEMBER_A_UID, { role: 'member', coachId: COACH_A_UID })
      .firestore()
  );
}

function asClaimedMemberB() {
  return modularDb(
    testEnv
      .authenticatedContext(MEMBER_B_UID, { role: 'member', coachId: COACH_B_UID })
      .firestore()
  );
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
