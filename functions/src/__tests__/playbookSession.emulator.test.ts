import * as admin from 'firebase-admin';
import { getSessionWorkout, completePlaybookSession } from '../playbookBooking';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Local Firestore emulator required');
admin.initializeApp({ projectId: 'demo-playbook-transactions' });
const db = admin.firestore();
const auth: any = { uid: 'auth-member', token: { role: 'member', memberId: 'roster-member', coachId: 'coach' } };
const call = (fn: any, sessionInstanceId: string, workoutId?: string) => fn.run({ auth, data: { sessionInstanceId, workoutId } });
beforeEach(async () => {
  const batch = db.batch();
  for (const id of ['one', 'two']) batch.set(db.doc('session_instances/' + id), { memberId: 'roster-member', coachId: 'coach', playbookId: 'plan', status: 'scheduled', startUtc: admin.firestore.Timestamp.fromMillis(Date.now() - 60000) });
  batch.set(db.doc('playbooks/plan'), { coachId: 'coach', workoutIds: ['a', 'b', 'c'], nextWorkoutIndex: 0 });
  for (const id of ['a', 'b', 'c']) batch.set(db.doc('workouts/' + id), { coachId: 'coach', name: id });
  await batch.commit();
});
afterAll(async () => { await db.terminate(); await admin.app().delete(); });
test('concurrent duplicate completions advance exactly once in Firestore', async () => {
  await call(getSessionWorkout, 'one');
  await Promise.all(Array.from({ length: 8 }, () => call(completePlaybookSession, 'one', 'a')));
  expect((await db.doc('playbooks/plan').get()).data()?.nextWorkoutIndex).toBe(1);
  expect((await db.doc('session_instances/one').get()).data()?.workoutCompletedAt).toBeDefined();
});
test('two sessions opened before completion do not skip an unplayed workout', async () => {
  const opened = await Promise.all(['one', 'two'].map(id => call(getSessionWorkout, id)));
  expect(opened.map((x: any) => x.workout.id)).toEqual(['a', 'a']);
  await Promise.all(['one', 'two'].map(id => call(completePlaybookSession, id, 'a')));
  expect((await db.doc('playbooks/plan').get()).data()?.nextWorkoutIndex).toBe(1);
});
test('sequential sessions advance to the next assigned workout', async () => {
  await call(getSessionWorkout, 'one');
  await call(completePlaybookSession, 'one', 'a');
  expect((await call(getSessionWorkout, 'two')).workout.id).toBe('b');
  await call(completePlaybookSession, 'two', 'b');
  expect((await db.doc('playbooks/plan').get()).data()?.nextWorkoutIndex).toBe(2);
});

test('Zoom-ended meeting still accepts one idempotent workout completion', async () => {
  await call(getSessionWorkout, 'one');
  await db.doc('session_instances/one').update({ status: 'completed' });
  await call(completePlaybookSession, 'one', 'a');
  await call(completePlaybookSession, 'one', 'a');
  expect((await db.doc('playbooks/plan').get()).data()?.nextWorkoutIndex).toBe(1);
  expect((await db.doc('session_instances/one').get()).data()?.workoutCompletedAt).toBeDefined();
});
test('sequence edit while a player is open cannot advance the edited sequence', async () => {
  await call(getSessionWorkout, 'one');
  await db.doc('playbooks/plan').update({ workoutIds: ['c', 'b', 'a'] });
  await call(completePlaybookSession, 'one', 'a');
  expect((await db.doc('playbooks/plan').get()).data()?.nextWorkoutIndex).toBe(0);
});
