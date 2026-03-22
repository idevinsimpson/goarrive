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
  doc,
  getDoc,
  setDoc,
  updateDoc,
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
});
