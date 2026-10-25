import * as admin from 'firebase-admin';
import { FieldValue, Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

export type WorkoutPolicy = 'carry_forward' | 'scheduled';
type Row = { id: string; data: Record<string, any> };
const MAX_SESSIONS = 400;
const futureUnopened = (s: Record<string, any>, now: number) =>
  !s.pinnedWorkoutId && !s.workoutCompletedAt &&
  ['scheduled', 'allocated', 'allocation_failed'].includes(s.status) &&
  s.startUtc?.toMillis?.() > now + 300000;

async function sessions(tx: Transaction, playbookId: string) {
  const snap = await tx.get(admin.firestore().collection('session_instances').where('playbookId', '==', playbookId).limit(MAX_SESSIONS + 1));
  if (snap.size > MAX_SESSIONS) throw new HttpsError('failed-precondition', 'This Playbook needs a larger schedule review before changing workout assignments.');
  return snap.docs.map(doc => ({ id: doc.id, data: doc.data() }));
}

async function memberAliases(tx: Transaction, plan: Record<string, any>, rows: Row[]) {
  const aliases = new Map<string, string>();
  const ids = new Set<string>([...(plan.memberIds || []), plan.assignedMemberId, ...rows.map(r => r.data.memberId)].filter(Boolean));
  for (const id of ids) {
    const member = (await tx.get(admin.firestore().collection('members').doc(id))).data();
    if (member && member.coachId === plan.coachId) {
      if (!aliases.has(id)) aliases.set(id, id);
      if (typeof member.uid === 'string' && !aliases.has(member.uid)) aliases.set(member.uid, id);
    }
  }
  return (s: Record<string, any>) => aliases.get(s.memberId) || s.memberKey || s.memberId;
}

/** Stable original occurrence order; rescheduling never changes its workout slot. */
export function orderedWorkoutAssignments(rows: Row[], sequence: string[], startIndex: number) {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = row.data.scheduledWorkoutMemberKey;
    if (!key) continue;
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  const result = new Map<string, string>();
  for (const group of groups.values()) {
    group.sort((a, b) => a.data.scheduledWorkoutOrderUtc.toMillis() - b.data.scheduledWorkoutOrderUtc.toMillis() || a.id.localeCompare(b.id));
    group.forEach((row, index) => result.set(row.id, sequence[((startIndex + index) % sequence.length + sequence.length) % sequence.length]));
  }
  return result;
}

/** All reads precede writes. Called inside the booking transaction. */
export async function prepareScheduledBooking(tx: Transaction, playbookId: string, candidate: Row) {
  const db = admin.firestore();
  const plan = (await tx.get(db.collection('playbooks').doc(playbookId))).data();
  if (!plan || plan.coachId !== candidate.data.coachId) throw new HttpsError('permission-denied', 'Playbook ownership changed');
  if (plan.workoutPolicy !== 'scheduled') return { candidateFields: {}, updates: [] as Array<{ id: string; fields: Record<string, any> }> };
  const config = plan.scheduledWorkoutPlan;
  if (!config?.version || !Array.isArray(config.workoutIds) || !config.workoutIds.length) throw new HttpsError('failed-precondition', 'Save the scheduled workout setting first');
  const all = await sessions(tx, playbookId);
  const memberKey = await memberAliases(tx, plan, [...all, candidate]);
  const candidateFields: Record<string, any> = {
    scheduledWorkoutVersion: config.version,
    scheduledWorkoutOrderUtc: candidate.data.startUtc,
    scheduledWorkoutMemberKey: memberKey(candidate.data),
  };
  const rows = all.filter(r => r.data.coachId === plan.coachId && r.data.scheduledWorkoutVersion === config.version);
  rows.push({ id: candidate.id, data: { ...candidate.data, ...candidateFields } });
  const assignments = orderedWorkoutAssignments(rows, config.workoutIds, config.startIndex);
  candidateFields.scheduledWorkoutId = assignments.get(candidate.id);
  const updates = rows.filter(r => r.id !== candidate.id && futureUnopened(r.data, Date.now()) && assignments.get(r.id) !== r.data.scheduledWorkoutId)
    .map(r => ({ id: r.id, fields: { scheduledWorkoutId: assignments.get(r.id) } }));
  return { candidateFields, updates };
}

/** Explicit coach mutation only; neither landing nor workout GET advances progression. */
export const setPlaybookWorkoutPolicy = onCall({ region: 'us-central1', invoker: 'public' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');
  const { playbookId, policy } = request.data || {};
  if (typeof playbookId !== 'string' || !playbookId || !['carry_forward', 'scheduled'].includes(policy)) throw new HttpsError('invalid-argument', 'Choose a workout policy');
  const db = admin.firestore(), ref = db.collection('playbooks').doc(playbookId);
  const version = db.collection('playbooks').doc().id; // non-secret assignment version, never an access credential
  return db.runTransaction(async tx => {
    const plan = (await tx.get(ref)).data();
    if (!plan) throw new HttpsError('not-found', 'Playbook not found');
    const claims = request.auth!.token;
    if (plan.coachId !== request.auth!.uid && claims.role !== 'platformAdmin' && claims.admin !== true) throw new HttpsError('permission-denied', 'This Playbook does not belong to you');
    if ((plan.workoutPolicy || 'carry_forward') === policy) return { policy };
    const all = (await sessions(tx, playbookId)).filter(r => r.data.coachId === plan.coachId);
    const editable = all.filter(r => futureUnopened(r.data, Date.now()));
    if (policy === 'scheduled') {
      const sequence = plan.workoutIds;
      if (!Array.isArray(sequence) || !sequence.length) throw new HttpsError('failed-precondition', 'Add workouts before following the schedule');
      for (const id of new Set<string>(sequence)) {
        const workout = (await tx.get(db.collection('workouts').doc(id))).data();
        if (!workout || workout.coachId !== plan.coachId) throw new HttpsError('failed-precondition', 'Every scheduled workout must belong to this coach');
      }
      const memberKey = await memberAliases(tx, plan, editable);
      const startIndex = Number.isInteger(plan.nextWorkoutIndex) ? plan.nextWorkoutIndex : 0;
      const rows = editable.map(r => ({ ...r, data: { ...r.data, scheduledWorkoutMemberKey: memberKey(r.data), scheduledWorkoutOrderUtc: r.data.startUtc } }));
      const assignments = orderedWorkoutAssignments(rows, sequence, startIndex);
      for (const row of rows) tx.update(db.collection('session_instances').doc(row.id), {
        scheduledWorkoutId: assignments.get(row.id), scheduledWorkoutVersion: version,
        scheduledWorkoutOrderUtc: row.data.scheduledWorkoutOrderUtc, scheduledWorkoutMemberKey: row.data.scheduledWorkoutMemberKey,
      });
      tx.update(ref, { workoutPolicy: policy, scheduledWorkoutPlan: { version, workoutIds: sequence, startIndex }, updatedAt: FieldValue.serverTimestamp() });
    } else {
      for (const row of editable) tx.update(db.collection('session_instances').doc(row.id), {
        scheduledWorkoutId: FieldValue.delete(), scheduledWorkoutVersion: FieldValue.delete(),
        scheduledWorkoutOrderUtc: FieldValue.delete(), scheduledWorkoutMemberKey: FieldValue.delete(),
      });
      tx.update(ref, { workoutPolicy: policy, scheduledWorkoutPlan: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    }
    return { policy };
  });
});
