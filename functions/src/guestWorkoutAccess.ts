import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { FirestoreGuestCapabilityStore } from './guestCapabilityStore';

function owner(auth: any): string {
  if (!auth || auth.token.role !== 'coach') throw new HttpsError('permission-denied', 'Only the owning coach can manage guest links.');
  return String(auth.token.coachId || auth.uid);
}
export const getGuestWorkoutAccess = onCall({ region: 'us-central1', invoker: 'public' }, async request => {
  owner(request.auth);
  // Deliberately cannot be enabled by setting an environment variable alone.
  // No media delivery adapter or guest response projection has been approved.
  return { canIssue: false, reason: 'Guest playback is not available yet.' };
});
export const revokeGuestWorkoutLink = onCall({ region: 'us-central1', invoker: 'public' }, async request => {
  const coachId = owner(request.auth), { playbookId, memberId } = request.data || {};
  if (![playbookId, memberId].every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id))) throw new HttpsError('invalid-argument', 'Invalid assignment.');
  // Caller-derived coach namespace; revocation remains possible after deletion,
  // removal, rollout shutdown or media failure. No token enters this request.
  await new FirestoreGuestCapabilityStore(admin.firestore()).revoke({ coachId, playbookId, memberId, generation: '', active: false });
  return { revoked: true };
});
