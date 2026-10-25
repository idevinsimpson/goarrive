import type { firestore } from 'firebase-admin';
import { capabilityDigest, unavailable } from './guestWorkoutCapability';
import { FirestoreGuestCapabilityStore } from './guestCapabilityStore';
import { readGuestWorkoutContentSnapshot } from './guestWorkoutContent';

/** One serializable, read-only transaction binds grant + roster + assignment +
 * plan + session + workout + movements. No independently awaited content read
 * may follow this authorization decision. Not exported as a public endpoint. */
export async function readGuestAuthorizedSnapshot(db: firestore.Firestore, token: string, now: () => number = Date.now) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw unavailable();
  const digest = capabilityDigest(token), store = new FirestoreGuestCapabilityStore(db);
  return db.runTransaction(async tx => {
    const snapshot = await store.snapshot(tx, digest), { grant, assignment, plan, sessions } = snapshot;
    const at = now();
    if (!grant || grant.digest !== digest || grant.revoked || !grant.active || at >= grant.expiresAt || !assignment?.active ||
      grant.coachId !== assignment.coachId || grant.playbookId !== assignment.playbookId || grant.memberId !== assignment.memberId ||
      grant.generation !== assignment.generation || plan.coachId !== assignment.coachId) throw unavailable();
    const candidates = sessions.filter(s => s.coachId === assignment.coachId && s.playbookId === assignment.playbookId && s.memberId === assignment.memberId &&
      !s.completed && ['scheduled', 'allocated', 'in_progress', 'allocation_failed', 'completed'].includes(s.status) &&
      Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start && at >= s.start - 300000 && at < s.end);
    if (candidates.length !== 1) throw unavailable();
    const session = candidates[0], index = Number.isInteger(plan.nextWorkoutIndex) ? plan.nextWorkoutIndex : 0, ids = plan.workoutIds;
    const workoutId = session.pinnedWorkoutId || session.scheduledWorkoutId || (ids.length ? ids[((index % ids.length) + ids.length) % ids.length] : undefined);
    if (!workoutId) throw unavailable();
    const content = await readGuestWorkoutContentSnapshot(db, tx, workoutId);
    if (!content.workout || content.workout.coachId !== assignment.coachId || content.workout.isGlobal === true || content.workout.isArchived === true ||
      Object.values(content.movements).some(m => !m || m.coachId !== assignment.coachId || m.isGlobal === true || m.isArchived === true)) throw unavailable();
    const finished = now();
    if (finished >= grant.expiresAt || finished >= session.end) throw unavailable();
    return { admission: { sessionId: session.id, workoutId, coachId: assignment.coachId, digest,
      validUntil: Math.min(grant.expiresAt, session.end, finished + 25000) }, content };
  });
}
