import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { ownsSessionMember } from './sessionIdentity';
import { createHash } from 'crypto';

export function videoEnabled(playbook: Record<string, any>, workout: Record<string, any>): boolean {
  if (workout.videoPolicy === 'off') return false;
  if (workout.videoPolicy === 'on') return true;
  return playbook.videoEnabled === true;
}

/** No allocation, provider call, signing, recording or progression side effects. */
export async function sessionVideoAvailability(id: unknown, auth: { uid: string; token: Record<string, any> }, now = Date.now(), expected?: Record<string, any>) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new HttpsError('invalid-argument', 'Invalid session');
  const db = admin.firestore();
  const session = (await db.collection('session_instances').doc(id).get()).data();
  if (!session || (!ownsSessionMember(auth.uid, auth.token, session) && auth.uid !== session.coachId)) {
    throw new HttpsError('permission-denied', 'This session is not assigned to your account.');
  }
  const unavailable = (reason: string) => ({ enabled: false, reason, serverNow: now });
  // Signing must use the very same assignment/room that this fresh admission checked.
  if (expected && ['coachId', 'memberId', 'playbookId', 'pinnedWorkoutId', 'zoomRoomId', 'zoomMeetingId', 'zoomMeetingPassword'].some(key => session[key] !== expected[key])) return unavailable('The session changed. Please retry video.');
  if (!session.playbookId || !session.pinnedWorkoutId) return unavailable('Open the assigned workout first.');
  const [pbDoc, workoutDoc] = await Promise.all([
    db.collection('playbooks').doc(session.playbookId).get(),
    db.collection('workouts').doc(session.pinnedWorkoutId).get(),
  ]);
  const pb = pbDoc.data(); const workout = workoutDoc.data();
  if (!pb || !workout || pb.coachId !== session.coachId || workout.coachId !== session.coachId) return unavailable('Video is unavailable for this assignment.');
  const members = Array.isArray(pb.memberIds) && pb.memberIds.length ? pb.memberIds : pb.assignedMemberId ? [pb.assignedMemberId] : [];
  const assigned = members.includes(session.memberId) || (ownsSessionMember(auth.uid, auth.token, session) && members.some((memberId: string) => ownsSessionMember(auth.uid, auth.token, { memberId, coachId: session.coachId })));
  if (!assigned) return unavailable('This member is no longer assigned to the Playbook.');
  if (!videoEnabled(pb, workout)) return unavailable('Video is off for this workout.');
  if (!['allocated', 'in_progress'].includes(session.status) || session.workoutCompletedAt) return unavailable('This session is not live.');
  const start = session.startUtc?.toMillis?.(); const end = session.endUtc?.toMillis?.();
  if (!Number.isFinite(start) || !Number.isFinite(end) || now < start - 300000 || now > end) return unavailable('Video is available only during this session.');
  // Joining an auto-recorded room can start recording; do not treat camera consent as recording consent.
  if (session.recordingEnabled !== false || session.zoomRecordingMode !== 'none') return unavailable('In-workout video requires a session with recording turned off.');
  if (!session.zoomRoomId || !session.zoomMeetingId || !session.zoomJoinUrl) return unavailable('No video room has been allocated.');
  const room = (await db.collection('zoom_rooms').doc(session.zoomRoomId).get()).data();
  if (!room || room.status !== 'active' || !(room.coachId === session.coachId || (session.roomSource === 'shared_pool' && room.poolId === 'hmti'))) return unavailable('The assigned video room is unavailable.');
  const binding = createHash('sha256').update(JSON.stringify([session.coachId, session.memberId, session.playbookId, session.pinnedWorkoutId, session.zoomRoomId, session.zoomMeetingId, start, end])).digest('hex');
  return { enabled: true, reason: '', serverNow: now, binding };
}

export const getSessionVideoAvailability = onCall({ region: 'us-central1', invoker: 'public' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in.');
  return sessionVideoAvailability(request.data?.sessionInstanceId, request.auth);
});

export const setWorkoutVideoPolicy = onCall({ region: 'us-central1', invoker: 'public' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in.');
  const { kind, id, policy } = request.data || {};
  if (!['playbook', 'workout'].includes(kind) || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || !(kind === 'playbook' ? ['on', 'off'] : ['inherit', 'on', 'off']).includes(policy)) throw new HttpsError('invalid-argument', 'Invalid video setting.');
  const ref = admin.firestore().collection(kind === 'playbook' ? 'playbooks' : 'workouts').doc(id);
  await admin.firestore().runTransaction(async tx => {
    const data = (await tx.get(ref)).data();
    const claims = request.auth!.token;
    const coachId = claims.role === 'coach' ? claims.coachId || request.auth!.uid : request.auth!.uid;
    if (!data || data.coachId !== coachId || !['coach', 'platformAdmin'].includes(String(claims.role))) throw new HttpsError('permission-denied', 'Only the owning coach can change video settings.');
    tx.update(ref, { ...(kind === 'playbook' ? { videoEnabled: policy === 'on' } : { videoPolicy: policy }), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  });
  return { saved: true };
});
