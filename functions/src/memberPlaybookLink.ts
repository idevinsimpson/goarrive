import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { ownsSessionMember } from './sessionIdentity';

/** Read-only projection. A Playbook ID identifies a resource, never grants access. */
export const getMemberPlaybookSessions = onCall({ region: 'us-central1', invoker: 'public' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in');
  const id = request.data?.playbookId;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new HttpsError('invalid-argument', 'Invalid Playbook link');
  }
  const db = admin.firestore();
  const playbook = (await db.collection('playbooks').doc(id).get()).data();
  const caller = request.auth;
  const members: string[] = Array.isArray(playbook?.memberIds) && playbook!.memberIds.length
    ? playbook!.memberIds : playbook?.assignedMemberId ? [playbook.assignedMemberId] : [];
  if (!playbook || !members.some(memberId => ownsSessionMember(caller.uid, caller.token, { memberId, coachId: playbook.coachId }))) {
    throw new HttpsError('permission-denied', 'This Playbook is not assigned to your account.');
  }
  const snapshot = await db.collection('session_instances').where('playbookId', '==', id).get();
  const sessions = snapshot.docs.filter(doc => {
    const s = doc.data();
    return s.coachId === playbook.coachId && ownsSessionMember(caller.uid, caller.token, s);
  }).map(doc => {
    const s = doc.data();
    return { id: doc.id, status: s.status, scheduledDate: s.scheduledDate || '',
      scheduledStartTime: s.scheduledStartTime || '', scheduledEndTime: s.scheduledEndTime || '',
      timezone: s.timezone || playbook.timezone || 'America/New_York', durationMinutes: s.durationMinutes || 45,
      startUtc: s.startUtc ? { seconds: s.startUtc.seconds, nanoseconds: s.startUtc.nanoseconds || 0 } : null,
      endUtc: s.endUtc ? { seconds: s.endUtc.seconds, nanoseconds: s.endUtc.nanoseconds || 0 } : null,
      workoutCompletedAt: !!s.workoutCompletedAt };
  });
  return { title: playbook.title || playbook.name || 'Your Playbook', sessions, serverNow: Date.now() };
});
