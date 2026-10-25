import * as admin from 'firebase-admin';
import { randomUUID } from 'crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

export function validGuestRoster(member: admin.firestore.DocumentSnapshot, version: admin.firestore.DocumentSnapshot) {
  const m = member.data(), v = version.data();
  return !!m && !!v && m.guestIdentityLocked === true && !m.isArchived && member.createTime?.isEqual(v.createdAt) &&
    m.coachId === v.coachId && (m.uid || null) === v.uid;
}
export async function updateRosterIdentity(db: admin.firestore.Firestore, memberId: string, patch: Record<string, any>, expectedCoach?: string) {
  await db.runTransaction(async tx => {
    const ref = db.doc('members/' + memberId), snap = await tx.get(ref), member = snap.data();
    if (!member || (expectedCoach && member.coachId !== expectedCoach)) throw new HttpsError('permission-denied', 'Member is unavailable.');
    const next = { ...member, ...patch };
    if (member.guestIdentityLocked === true && ['uid', 'coachId', 'isArchived'].some(k => (member[k] ?? null) !== (next[k] ?? null))) {
      tx.set(db.doc('guest_roster_versions/' + memberId), { generation: randomUUID(), createdAt: snap.createTime,
        coachId: next.coachId, uid: next.uid || null });
    }
    tx.update(ref, patch);
  });
}
export const updateGuestRosterArchive = onCall({ region: 'us-central1', invoker: 'public' }, async request => {
  if (!request.auth || request.auth.token.role !== 'coach') throw new HttpsError('permission-denied', 'Only the owning coach can update this member.');
  const { memberId, isArchived } = request.data || {};
  if (typeof memberId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(memberId) || typeof isArchived !== 'boolean') throw new HttpsError('invalid-argument', 'Invalid member update.');
  await updateRosterIdentity(admin.firestore(), memberId, { isArchived, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, String(request.auth.token.coachId || request.auth.uid));
  return { saved: true };
});
