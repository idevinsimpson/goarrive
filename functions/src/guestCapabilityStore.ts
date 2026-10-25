import * as admin from 'firebase-admin';
import { Assignment, CapabilityStore, Grant, Session, unavailable } from './guestWorkoutCapability';
import { readGuestAssignment } from './guestAssignmentLifecycle';
import { createHash } from 'crypto';
import { validGuestRoster } from './guestRosterLifecycle';

const key = (a: Assignment) => createHash('sha256').update(JSON.stringify([a.coachId, a.playbookId, a.memberId])).digest('hex');
/** Server-only adapter; no endpoint exports this store or its internal admissions. */
export class FirestoreGuestCapabilityStore implements CapabilityStore {
  constructor(private db: admin.firestore.Firestore) {}
  async rotate(a: Assignment, grant: Grant) {
    await this.db.runTransaction(async tx => {
      const [p, v, previous, member, roster] = await Promise.all([
        tx.get(this.db.doc('playbooks/' + a.playbookId)), tx.get(this.db.doc('guest_assignment_versions/' + a.playbookId)),
        tx.get(this.db.doc('guest_assignment_grants/' + key(a))),
        tx.get(this.db.doc('members/' + a.memberId)), tx.get(this.db.doc('guest_roster_versions/' + a.memberId)),
      ]);
      const plan = p.data(), version = v.data();
      if (!plan || plan.guestAssignmentLocked !== true || plan.coachId !== a.coachId || !version ||
        !validGuestRoster(member, roster) || member.data()?.coachId !== a.coachId || version.generation + ':' + roster.data()!.generation !== a.generation ||
        !p.createTime?.isEqual(version.playbookCreatedAt) || !plan.memberIds?.includes(a.memberId) ||
        JSON.stringify(plan.memberIds) !== JSON.stringify(version.memberIds)) throw unavailable();
      if (previous.data()?.digest) tx.update(this.db.doc('guest_workout_grants/' + previous.data()!.digest), { revoked: true });
      tx.set(this.db.doc('guest_workout_grants/' + grant.digest), grant);
      tx.set(this.db.doc('guest_assignment_grants/' + key(a)), { digest: grant.digest });
    });
  }
  async revoke(a: Assignment) {
    await this.db.runTransaction(async tx => {
      const ref = this.db.doc('guest_assignment_grants/' + key(a)), previous = await tx.get(ref);
      if (previous.data()?.digest) tx.update(this.db.doc('guest_workout_grants/' + previous.data()!.digest), { revoked: true });
      tx.delete(ref);
    });
  }
  async read(digest: string) { return (await this.db.doc('guest_workout_grants/' + digest).get()).data() as Grant | undefined; }
  async assignment(g: Grant) { return readGuestAssignment(this.db, g.playbookId, g.memberId); }
  async refresh(digest: string) {
    return this.db.runTransaction(async tx => {
      const g = (await tx.get(this.db.doc('guest_workout_grants/' + digest))).data() as Grant | undefined;
      const denied = { grant: g, assignment: undefined, plan: { coachId: '', workoutIds: [] as string[], nextWorkoutIndex: 0 }, sessions: [] as Session[] };
      if (!g) return denied;
      const [p, v, m, rows, roster] = await Promise.all([
        tx.get(this.db.doc('playbooks/' + g.playbookId)), tx.get(this.db.doc('guest_assignment_versions/' + g.playbookId)),
        tx.get(this.db.doc('members/' + g.memberId)), tx.get(this.db.collection('session_instances').where('playbookId', '==', g.playbookId).limit(401)),
        tx.get(this.db.doc('guest_roster_versions/' + g.memberId)),
      ]);
      const plan = p.data(), version = v.data(), member = m.data();
      if (!plan || !version || plan.guestAssignmentLocked !== true || plan.coachId !== g.coachId || version.coachId !== g.coachId ||
        !p.createTime?.isEqual(version.playbookCreatedAt) || !plan.memberIds?.includes(g.memberId) || member?.coachId !== g.coachId || !validGuestRoster(m, roster) ||
        JSON.stringify(plan.memberIds) !== JSON.stringify(version.memberIds) || rows.size > 400) return denied;
      const sessions = rows.docs.filter(d => d.data().coachId === g.coachId && [g.memberId, member.uid].filter(Boolean).includes(d.data().memberId)).map(d => {
        const s = d.data(); return { id: d.id, coachId: s.coachId, memberId: g.memberId, playbookId: s.playbookId,
          start: s.startUtc?.toMillis?.(), end: s.endUtc?.toMillis?.(), status: s.status, completed: !!s.workoutCompletedAt,
          pinnedWorkoutId: s.pinnedWorkoutId, scheduledWorkoutId: s.scheduledWorkoutId };
      });
      return { grant: g, assignment: { coachId: g.coachId, playbookId: g.playbookId, memberId: g.memberId, generation: version.generation + ':' + roster.data()!.generation, active: true },
        plan: { coachId: plan.coachId, workoutIds: Array.isArray(plan.workoutIds) ? plan.workoutIds : [], nextWorkoutIndex: plan.nextWorkoutIndex }, sessions };
    });
  }
  async schedule(a: Assignment) {
    const [planSnap, memberSnap, rows] = await Promise.all([
      this.db.doc('playbooks/' + a.playbookId).get(), this.db.doc('members/' + a.memberId).get(),
      this.db.collection('session_instances').where('playbookId', '==', a.playbookId).limit(401).get(),
    ]);
    const p = planSnap.data(), m = memberSnap.data();
    if (!p || p.coachId !== a.coachId || m?.coachId !== a.coachId || rows.size > 400) throw unavailable();
    const sessions: Session[] = rows.docs.filter(d => d.data().coachId === a.coachId &&
      [a.memberId, m.uid].filter(Boolean).includes(d.data().memberId)).map(d => {
      const s = d.data();
      return { id: d.id, coachId: s.coachId, memberId: a.memberId, playbookId: s.playbookId,
        start: s.startUtc?.toMillis?.(), end: s.endUtc?.toMillis?.(), status: s.status, completed: !!s.workoutCompletedAt,
        pinnedWorkoutId: s.pinnedWorkoutId, scheduledWorkoutId: s.scheduledWorkoutId };
    });
    return { plan: { coachId: p.coachId, workoutIds: Array.isArray(p.workoutIds) ? p.workoutIds : [], nextWorkoutIndex: p.nextWorkoutIndex }, sessions };
  }
}
