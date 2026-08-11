'use strict';

/**
 * seed-staging.js
 *
 * Idempotent staging seed: creates test coach + member auth users, member_plans
 * doc with contractEndAt, memberSubscriptions doc for pause/resume UI testing,
 * a music-enabled workout, and a Playbook Folder + template playbook.
 *
 * All doc IDs are suffixed -seed for easy identification and cleanup.
 *
 * Usage:
 *   node scripts/seed-staging.js
 *
 * Credentials: uses .secrets/firebase-service-account.json (same pattern as
 * other backfill scripts), or set GOOGLE_APPLICATION_CREDENTIALS env var.
 *
 * Limitations:
 *   - stripeSubscriptionId is a placeholder (sub_seed_001). The Firestore-side
 *     pause/resume flow is fully testable via the UI, but the Cloud Function
 *     will fail at the Stripe API call because no real test-mode sub exists.
 *     To test end-to-end Stripe pause/resume, replace sub_seed_001 with a real
 *     Stripe test-mode subscription ID and update the memberSubscriptions doc.
 */

const path = require('path');

let admin;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  admin = require('../functions/node_modules/firebase-admin');
  admin.initializeApp({ projectId: 'goarrive' });
} else {
  admin = require('../functions/node_modules/firebase-admin');
  const serviceAccount = require('../.secrets/firebase-service-account.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'goarrive',
  });
}

const db = admin.firestore();
const auth = admin.auth();
const { Timestamp, FieldValue } = admin.firestore;

const now = Timestamp.now();
const nowPlus90d = Timestamp.fromMillis(now.toMillis() + 90 * 24 * 60 * 60 * 1000);
const nowMinus7d = Timestamp.fromMillis(now.toMillis() - 7 * 24 * 60 * 60 * 1000);

// ─── Auth helpers ──────────────────────────────────────────────────────────────

async function upsertAuthUser({ uid, email, password, displayName, customClaims }) {
  try {
    await auth.getUser(uid);
    console.log(`  [skipped-exists] auth user ${uid} (${email})`);
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      await auth.createUser({ uid, email, password, displayName });
      console.log(`  [created] auth user ${uid} (${email})`);
    } else {
      throw err;
    }
  }
  await auth.setCustomUserClaims(uid, customClaims);
  console.log(`  [updated] custom claims for ${uid}:`, JSON.stringify(customClaims));
}

// ─── Firestore helper ──────────────────────────────────────────────────────────

async function upsertDoc(collectionPath, docId, data) {
  const ref = db.collection(collectionPath).doc(docId);
  const snap = await ref.get();
  await ref.set(data, { merge: true });
  console.log(`  [${snap.exists ? 'updated' : 'created'}] ${collectionPath}/${docId}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== GoArrive Staging Seed ===\n');

  // 1. Test Coach
  console.log('1. Test Coach auth + Firestore doc');
  await upsertAuthUser({
    uid: 'test-coach-seed-001',
    email: 'test-coach-seed@goa.staging',
    password: 'SeedTest#2026',
    displayName: 'Test Coach (Seed)',
    customClaims: { coachId: 'test-coach-seed-001', role: 'coach' },
  });
  await upsertDoc('coaches', 'test-coach-seed-001', {
    name: 'Test Coach (Seed)',
    email: 'test-coach-seed@goa.staging',
    role: 'coach',
    createdAt: now,
    updatedAt: now,
    funnelPhotoUrl: null,
  });

  // 2. Test Member
  console.log('\n2. Test Member auth + Firestore doc');
  await upsertAuthUser({
    uid: 'test-member-seed-001',
    email: 'test-member-seed@goa.staging',
    password: 'SeedTest#2026',
    displayName: 'Test Member (Seed)',
    customClaims: { role: 'member', coachId: 'test-coach-seed-001' },
  });
  await upsertDoc('members', 'test-member-seed-001', {
    name: 'Test Member (Seed)',
    email: 'test-member-seed@goa.staging',
    role: 'member',
    coachId: 'test-coach-seed-001',
    createdAt: now,
    updatedAt: now,
  });

  // 3. member_plans doc (doc ID = memberId per GoArrive convention)
  // contractEndAt is needed for pause/resume extension logic in resumeStripeSubscription.
  console.log('\n3. member_plans doc (for pause/resume contractEndAt test)');
  await upsertDoc('member_plans', 'test-member-seed-001', {
    memberId: 'test-member-seed-001',
    coachId: 'test-coach-seed-001',
    status: 'active',
    checkoutStatus: 'paid',
    contractMonths: 3,
    contractStartAt: nowMinus7d,
    contractEndAt: nowPlus90d,
    stripeCustomerId: 'cus_seed_001',
    pausedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  // 4. memberSubscriptions doc (doc ID = Stripe subscription ID)
  // This is what MemberDetail.tsx queries to show the pause/resume button.
  // Placeholder sub ID — Stripe API calls will fail, but the Firestore UI flow is testable.
  console.log('\n4. memberSubscriptions doc (for pause/resume UI)');
  await upsertDoc('memberSubscriptions', 'sub_seed_001', {
    subscriptionId: 'sub_seed_001',
    memberId: 'test-member-seed-001',
    coachId: 'test-coach-seed-001',
    planId: 'test-member-seed-001',
    snapshotId: 'snapshot-seed-001',
    stripeAccountId: 'acct_seed_001',
    stripeCustomerId: 'cus_seed_001',
    paymentOption: 'monthly',
    phase: 'contract',
    contractStartAt: nowMinus7d,
    contractEndAt: nowPlus90d,
    status: 'active',
    currentPeriodEnd: nowPlus90d,
    pausedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  // 5. Music-enabled workout (workoutMusicEnabled + volume for sweep Tests 3 & 4)
  console.log('\n5. Music-enabled workout');
  await upsertDoc('workouts', 'workout-seed-001', {
    coachId: 'test-coach-seed-001',
    name: 'Seed Workout (Music)',
    description: 'Seed workout for music-style validation',
    category: 'strength',
    difficulty: 'intermediate',
    tags: ['seed'],
    isTemplate: false,
    tenantId: 'test-coach-seed-001',
    isArchived: false,
    estimatedDurationMin: 30,
    coverThumbs: [],
    musicStyle: 'workout',
    workoutMusicEnabled: true,
    workoutMusicStyle: 'lofi',
    workoutMusicVolume: 0.5,
    blocks: [
      {
        type: 'movement',
        movementId: 'placeholder-movement-seed',
        reps: 10,
        sets: 3,
      },
    ],
    isPublished: true,
    createdAt: now,
    updatedAt: now,
  });

  // 6. Template playbook (assigned to test member to unblock player tests)
  console.log('\n6. Template playbook');
  await upsertDoc('playbooks', 'playbook-seed-001', {
    coachId: 'test-coach-seed-001',
    tenantId: 'test-coach-seed-001',
    name: 'Seed Template Playbook',
    description: 'Seed template playbook for Playbook Folder validation',
    workoutIds: ['workout-seed-001'],
    memberIds: ['test-member-seed-001'],
    assignedMemberId: 'test-member-seed-001',
    assignedMemberName: 'Test Member (Seed)',
    isArchived: false,
    recordingEnabled: false,
    schedulingEnabled: false,
    sessionKind: 'strength',
    repeatFrequency: 'weekly',
    repeatHorizonWeeks: 4,
    weeklySessionCap: 3,
    nextWorkoutIndex: 0,
    sessionDurationMinutes: 30,
    scheduleDaysOfWeek: [],
    scheduleDaySettings: {},
    scheduleStartTime: '09:00',
    timezone: 'America/New_York',
    parentId: null,
    createdAt: now,
    updatedAt: now,
  });

  // 7. Playbook Folder
  console.log('\n7. Playbook Folder');
  await upsertDoc('playbook_folders', 'folder-seed-001', {
    coachId: 'test-coach-seed-001',
    name: 'Seed Folder',
    type: 'playbook_folder',
    parentId: null,
    templatePlaybookIds: ['playbook-seed-001'],
    subscriptionPaths: [
      {
        id: 'path-1',
        label: 'Beginner',
        templatePlaybookId: 'playbook-seed-001',
        musicStyle: 'workout',
      },
    ],
    syncEnabled: true,
    emailTemplate: {
      subject: 'Welcome',
      body: 'Welcome to the program!',
    },
    linkedShareTokenIds: [],
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  });

  // 8. Staging platformAdmin account
  console.log('\n8. Staging platformAdmin auth user');
  await upsertAuthUser({
    uid: 'staging-admin-seed-001',
    email: 'staging-admin@goarrive.fit',
    password: 'StagingAdmin#2026',
    displayName: 'Staging Admin',
    customClaims: { role: 'platformAdmin', admin: true },
  });

  console.log('\n=== Seed complete ===');
  console.log('\nFixtures seeded:');
  console.log('  Coach:               test-coach-seed-001   /  test-coach-seed@goa.staging  / SeedTest#2026');
  console.log('  Member:              test-member-seed-001  /  test-member-seed@goa.staging / SeedTest#2026');
  console.log('  member_plans:        test-member-seed-001  (contractEndAt = now+90d)');
  console.log('  memberSubscriptions: sub_seed_001          (placeholder — Stripe API calls will fail)');
  console.log('  workout:             workout-seed-001      (musicStyle: workout, workoutMusicEnabled: true, workoutMusicVolume: 0.5)');
  console.log('  playbook:            playbook-seed-001     (assignedMemberId: test-member-seed-001)');
  console.log('  playbook_folder:     folder-seed-001');
  console.log('  staging admin:       staging-admin@goarrive.fit  (platformAdmin — see docs/staging-admin-account.md)');
  console.log('\nStaging URL: https://goarrive--staging-gurfzjak.web.app');
  console.log('\nNOTE: stripeSubscriptionId sub_seed_001 is a placeholder.');
  console.log('The pause/resume UI button will render, but the Cloud Function will fail');
  console.log('at the Stripe API step (no real test-mode sub). Firestore doc update');
  console.log('is still testable by inspecting Firestore directly after clicking Pause.');
}

main().then(() => process.exit(0)).catch(err => {
  console.error('\n[ERROR]', err);
  process.exit(1);
});
