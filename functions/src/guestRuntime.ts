import * as admin from 'firebase-admin';
import { randomBytes } from 'crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { GuestWorkoutCapabilities } from './guestWorkoutCapability';
import { FirestoreGuestCapabilityStore } from './guestCapabilityStore';
import { initializeGuestAssignment, readGuestAssignment } from './guestAssignmentLifecycle';
import { GuestWorkoutDelivery } from './guestWorkoutDelivery';
import { readGuestAuthorizedSnapshot } from './guestAuthorizedSnapshot';
import { guestStorageReader } from './guestStorageReader';
import { GuestRequestBudget } from './guestDeliveryHttp';

// Independent release approval gate. Environment changes alone cannot activate
// live issuance/media. Only emulator fixtures may opt in before release review.
const guestReleaseApproved: boolean = false;
const issueBudget = new GuestRequestBudget(Date.now, { concurrent: 2, total: 20, perKey: 6 });
export function guestRuntimeEnabled(projectId: string, syntheticFixture = false) {
  if (syntheticFixture) return /^demo-[a-z0-9-]+$/.test(projectId) && process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080' &&
    process.env.FIREBASE_STORAGE_EMULATOR_HOST === '127.0.0.1:9199';
  return guestReleaseApproved && process.env.GUEST_WORKOUT_ROLLOUT_ENABLED === 'true';
}
export function owningGuestCoach(auth: any) {
  if (!auth || auth.token?.role !== 'coach') throw new HttpsError('permission-denied', 'Only the owning coach can manage guest links.');
  return String(auth.token.coachId || auth.uid);
}
export function createGuestRuntime(app: admin.app.App, options: { syntheticFixture?: boolean; entropy?: () => Buffer; now?: () => number } = {}) {
  const projectId = String(app.options.projectId || ''), enabled = guestRuntimeEnabled(projectId, options.syntheticFixture), db = app.firestore();
  const store = new FirestoreGuestCapabilityStore(db), clock = options.now || Date.now;
  const capabilities = new GuestWorkoutCapabilities(store, { enabled, mediaReady: enabled, assignmentGenerationReady: enabled }, clock,
    options.syntheticFixture && enabled ? options.entropy : () => randomBytes(32));
  const delivery = new GuestWorkoutDelivery({ enabled, bucket: String(app.options.storageBucket || ''), now: clock,
    snapshot: token => readGuestAuthorizedSnapshot(db, token, clock),
    // Bucket construction is lazy: a disabled endpoint needs no Storage setup.
    metadata: path => guestStorageReader(app.storage().bucket()).metadata(path),
    readRange: (path, range, generation) => guestStorageReader(app.storage().bucket()).readRange(path, range, generation) });
  const ids = (data: any) => {
    if (!data || ![data.playbookId, data.memberId].every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id))) throw new HttpsError('invalid-argument', 'Invalid assignment.');
    return { playbookId: data.playbookId as string, memberId: data.memberId as string };
  };
  return { enabled, delivery,
    status(auth: any) { owningGuestCoach(auth); return { canIssue: enabled, reason: enabled ? '' : 'Guest playback is not available yet.' }; },
    async issue(auth: any, data: any) {
      const coachId = owningGuestCoach(auth);
      if (!enabled) throw new HttpsError('failed-precondition', 'Guest playback is not available yet.');
      const { playbookId, memberId } = ids(data);
      if (data.confirmed !== true || !Number.isFinite(data.expiresAt) || data.expiresAt <= clock() || data.expiresAt > clock() + 7 * 86400000) throw new HttpsError('invalid-argument', 'Confirm an expiry within seven days.');
      const release = issueBudget.enter(coachId);
      if (!release) throw new HttpsError('resource-exhausted', 'Please wait before creating another link.');
      try {
        // Check membership before adding locks; every later step rechecks it.
        const plan = (await db.doc('playbooks/' + playbookId).get()).data();
        if (plan?.coachId !== coachId || !plan.memberIds?.includes(memberId)) throw new HttpsError('permission-denied', 'Assignment unavailable.');
        await initializeGuestAssignment(db, coachId, playbookId);
        const assignment = await readGuestAssignment(db, playbookId, memberId);
        if (!assignment || assignment.coachId !== coachId) throw new HttpsError('permission-denied', 'Assignment unavailable.');
        return await capabilities.issue({ uid: auth.uid, role: 'coach', coachId }, assignment, true, data.expiresAt);
      } finally { release(); }
    },
    async revoke(auth: any, data: any) {
      const coachId = owningGuestCoach(auth), { playbookId, memberId } = ids(data);
      await store.revoke({ coachId, playbookId, memberId, generation: '', active: false });
      return { revoked: true };
    },
  };
}
