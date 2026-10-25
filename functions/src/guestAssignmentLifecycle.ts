import * as admin from 'firebase-admin';
import { randomUUID } from 'crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { validGuestRoster } from './guestRosterLifecycle';

/** First activation is disabled unless explicitly configured; issuance remains unavailable. */
export const guestAssignmentGate = () => process.env.GUEST_WORKOUT_ROLLOUT_ENABLED === 'true';

export async function changeGuestAssignmentMembers(db: admin.firestore.Firestore, coachId: string, playbookId: string, memberIds: string[]) {
  if (typeof playbookId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(playbookId) || !Array.isArray(memberIds) || memberIds.length > 100 ||
    memberIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) || new Set(memberIds).size !== memberIds.length) {
    throw new HttpsError('invalid-argument', 'Invalid assignment.');
  }
  return writeAssignment(db, coachId, playbookId, memberIds);
}

/** First-time lock snapshots current membership inside the transaction; it
 * never overwrites membership from a stale browser read. */
export async function initializeGuestAssignment(db: admin.firestore.Firestore, coachId: string, playbookId: string) {
  return writeAssignment(db, coachId, playbookId);
}
async function writeAssignment(db: admin.firestore.Firestore, coachId: string, playbookId: string, requestedMembers?: string[]) {
  return db.runTransaction(async tx => {
    const ref = db.collection('playbooks').doc(playbookId), snap = await tx.get(ref), plan = snap.data();
    if (!plan || plan.coachId !== coachId) throw new HttpsError('permission-denied', 'Only the owning coach can change this assignment.');
    if (!requestedMembers && plan.guestAssignmentLocked === true) return { saved: true };
    const memberIds: string[] = requestedMembers || plan.memberIds;
    if (!Array.isArray(memberIds) || memberIds.length > 100 || memberIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) || new Set(memberIds).size !== memberIds.length) throw new HttpsError('invalid-argument', 'Invalid assignment.');
    // A shutdown must not strand existing protected plans. Only first-time
    // activation is gated; existing membership edits still invalidate grants.
    if (!guestAssignmentGate() && plan.guestAssignmentLocked !== true) throw new HttpsError('failed-precondition', 'Guest access is not available yet.');
    const members = await Promise.all(memberIds.map(id => tx.get(db.collection('members').doc(id))));
    if (members.some(m => !m.exists || m.data()?.coachId !== coachId || m.data()?.isArchived === true)) throw new HttpsError('permission-denied', 'Member is unavailable.');
    const version = db.collection('guest_assignment_versions').doc(playbookId);
    const rosterVersions = await Promise.all(memberIds.map(id => tx.get(db.doc('guest_roster_versions/' + id))));
    members.forEach((m, i) => {
      if (!validGuestRoster(m, rosterVersions[i])) {
        tx.set(db.doc('guest_roster_versions/' + m.id), { generation: randomUUID(), createdAt: m.createTime, coachId, uid: m.data()?.uid || null });
        tx.update(m.ref, { guestIdentityLocked: true });
      }
    });
    // One atomic write changes both membership and its private version. Any prior
    // grant remains invalid after remove/re-add, regardless of trigger latency.
    const generation = randomUUID(); // assignment version only, never a credential
    tx.set(version, { coachId, generation, playbookCreatedAt: snap.createTime, memberIds });
    tx.update(ref, requestedMembers ? { guestAssignmentLocked: true, memberIds, assignedMemberId: memberIds[0] || null,
      assignedMemberName: members[0]?.data()?.name || members[0]?.data()?.displayName || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp() } : { guestAssignmentLocked: true });
    return { saved: true };
  });
}

export const setGuestAssignmentMembers = onCall({ region: 'us-central1', invoker: 'public' }, async request => {
  if (!request.auth || request.auth.token.role !== 'coach') throw new HttpsError('permission-denied', 'Only the owning coach can change this assignment.');
  const coachId = request.auth.token.coachId || request.auth.uid;
  return changeGuestAssignmentMembers(admin.firestore(), String(coachId), request.data?.playbookId, request.data?.memberIds);
});

/** Read-only, no trigger-based invalidation. Must be called on each resolution.
 * A deletion/recreation is distinguished by the server creation timestamp. */
export async function readGuestAssignment(db: admin.firestore.Firestore, playbookId: string, memberId: string) {
  return db.runTransaction(async tx => {
    const [p, v] = await Promise.all([tx.get(db.collection('playbooks').doc(playbookId)), tx.get(db.collection('guest_assignment_versions').doc(playbookId))]);
    const plan = p.data(), version = v.data();
    if (!plan || !version || plan.guestAssignmentLocked !== true || version.coachId !== plan.coachId ||
      !p.createTime?.isEqual(version.playbookCreatedAt) || !Array.isArray(plan.memberIds) || !plan.memberIds.includes(memberId) ||
      !Array.isArray(version.memberIds) || JSON.stringify(plan.memberIds) !== JSON.stringify(version.memberIds)) return undefined;
    const [member, roster] = await Promise.all([tx.get(db.collection('members').doc(memberId)), tx.get(db.doc('guest_roster_versions/' + memberId))]);
    if (!validGuestRoster(member, roster) || member.data()?.coachId !== plan.coachId) return undefined;
    return { coachId: plan.coachId, playbookId, memberId, generation: version.generation + ':' + roster.data()!.generation, active: true };
  });
}
