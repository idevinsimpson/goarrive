import * as admin from 'firebase-admin';
import { getMemberPlaybookSessions } from '../memberPlaybookLink';
import { getSessionWorkout } from '../playbookBooking';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Local Firestore emulator required');
admin.initializeApp({ projectId: 'demo-member-playbook-link' });
const db = admin.firestore();
const auth: any = { uid: 'uid', token: { role: 'member', memberId: 'roster', coachId: 'coach' } };
const call = (caller: any = auth, playbookId = 'plan') => (getMemberPlaybookSessions as any).run({ auth: caller, data: { playbookId } });
beforeEach(async () => {
  const batch = db.batch();
  batch.set(db.doc('playbooks/plan'), { coachId: 'coach', assignedMemberId: 'roster', title: 'Synthetic plan', nextWorkoutIndex: 0 });
  for (const [id, memberId, coachId] of [['current', 'roster', 'coach'], ['legacy', 'uid', 'coach'], ['other', 'stranger', 'coach'], ['cross', 'roster', 'other-coach']]) {
    batch.set(db.doc('session_instances/' + id), { playbookId: 'plan', memberId, coachId, status: 'scheduled', startUtc: admin.firestore.Timestamp.now(), zoomJoinUrl: 'must-not-leak' });
  }
  await batch.commit();
});
afterAll(async () => { await db.terminate(); await admin.app().delete(); });
test('returns only owned mixed-identity sessions and never pins/advances on repeated opens', async () => {
  for (let i = 0; i < 3; i++) {
    const result = await call();
    expect(result.sessions.map((s: any) => s.id).sort()).toEqual(['current', 'legacy']);
    expect(result.sessions.every((s: any) => !('zoomJoinUrl' in s) && !('memberId' in s))).toBe(true);
  }
  expect((await db.doc('session_instances/current').get()).data()?.pinnedWorkoutId).toBeUndefined();
  expect((await db.doc('playbooks/plan').get()).data()?.nextWorkoutIndex).toBe(0);
});
test('rejects unauthenticated, wrong member, cross-coach claims, missing and unassigned plans', async () => {
  await expect(call(null)).rejects.toMatchObject({ code: 'unauthenticated' });
  for (const caller of [{ uid: 'stranger', token: { ...auth.token, memberId: 'stranger' } }, { uid: 'stranger', token: { ...auth.token, coachId: 'other' } }]) await expect(call(caller)).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(call(auth, 'missing')).rejects.toMatchObject({ code: 'permission-denied' });
  await db.doc('playbooks/plan').update({ assignedMemberId: null });
  await expect(call()).rejects.toMatchObject({ code: 'permission-denied' });
});
test('reflects cancellation and reassignment without changing the link', async () => {
  await db.doc('session_instances/current').update({ status: 'cancelled' });
  expect((await call()).sessions.find((s: any) => s.id === 'current').status).toBe('cancelled');
  await db.doc('playbooks/plan').update({ memberIds: ['stranger'] });
  await expect(call()).rejects.toMatchObject({ code: 'permission-denied' });
});

test.each(['missed', 'scheduled'])('characterizes the next session after an uncompleted past %s session: workout A repeats', async status => {
  const now = Date.now();
  await db.doc('playbooks/plan').update({ workoutIds: ['a', 'b'], nextWorkoutIndex: 0 });
  for (const id of ['a', 'b']) await db.doc('workouts/' + id).set({ coachId: 'coach', name: id });
  await db.doc('session_instances/legacy').update({ status,
    scheduledDate: new Date(now - 86400000).toISOString().slice(0, 10),
    startUtc: admin.firestore.Timestamp.fromMillis(now - 86400000),
    endUtc: admin.firestore.Timestamp.fromMillis(now - 83700000) });
  await db.doc('session_instances/current').update({
    scheduledDate: new Date(now).toISOString().slice(0, 10),
    startUtc: admin.firestore.Timestamp.fromMillis(now - 60000),
    endUtc: admin.firestore.Timestamp.fromMillis(now + 2640000) });
  const result = await call();
  expect(result.sessions.find((s: any) => s.id === 'current').status).toBe('scheduled');
  expect((await db.doc('session_instances/current').get()).data()?.pinnedWorkoutId).toBeUndefined();
  const opened = await (getSessionWorkout as any).run({ auth, data: { sessionInstanceId: 'current' } });
  expect(opened.workout.id).toBe('a');
  expect((await db.doc('playbooks/plan').get()).data()?.nextWorkoutIndex).toBe(0);
  expect((await db.doc('session_instances/legacy').get()).data()?.workoutCompletedAt).toBeUndefined();
});
