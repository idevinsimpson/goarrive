import * as admin from 'firebase-admin';
import { setPlaybookWorkoutPolicy } from '../playbookWorkoutPolicy';
import { bookOccurrence, bookPlaybookSession, wallTimeToUtc } from '../playbookScheduling';
import { getSessionWorkout, completePlaybookSession } from '../playbookBooking';
import { getMemberPlaybookSessions } from '../memberPlaybookLink';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Local emulator required');
admin.initializeApp({ projectId: 'demo-workout-policy' });
const db = admin.firestore();
const member = { uid: 'uid', token: { role: 'member', memberId: 'roster', coachId: 'coach' } };
const coach = { uid: 'coach', token: { role: 'coach' } };
const invoke = (fn: any, data: any, auth: any = member) => fn.run({ auth, data });
const policy = (value: string, auth: any = coach) => invoke(setPlaybookWorkoutPolicy, { playbookId: 'plan', policy: value }, auth);
const read = async (path: string) => (await db.doc(path).get()).data()!;
const time = (s: string) => admin.firestore.Timestamp.fromDate(new Date(s));
const session = (start: string, extra = {}) => ({ coachId: 'coach', memberId: 'roster', playbookId: 'plan', status: 'scheduled', startUtc: time(start), endUtc: time(new Date(new Date(start).getTime() + 2700000).toISOString()), timezone: 'America/New_York', ...extra });
beforeEach(async () => {
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-25T12:00:00Z'));
  for (const collection of ['session_instances', 'playbooks', 'members', 'workouts', 'member_time_reservations', 'scheduling_audit_log', 'booking_requests']) {
    const docs = await db.collection(collection).get(); const batch = db.batch(); docs.docs.forEach(d => batch.delete(d.ref)); await batch.commit();
  }
  await db.doc('playbooks/plan').set({ coachId: 'coach', assignedMemberId: 'roster', memberIds: ['roster'], workoutIds: ['a', 'b', 'c'], nextWorkoutIndex: 0 });
  await db.doc('members/roster').set({ coachId: 'coach', uid: 'uid', name: 'Synthetic Member' });
  for (const id of ['a', 'b', 'c']) await db.doc('workouts/' + id).set({ coachId: 'coach', name: id });
  await db.doc('session_instances/monday').set(session('2026-11-02T14:00:00Z'));
  await db.doc('session_instances/wednesday').set(session('2026-11-04T14:00:00Z', { memberId: 'uid' }));
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => { await db.terminate(); await admin.app().delete(); });

test('absent setting carries unfinished Monday forward; scheduled mode gives Wednesday B without advancing or fabricating completion', async () => {
  expect((await invoke(getSessionWorkout, { sessionInstanceId: 'monday' })).workout.id).toBe('a');
  expect((await invoke(getSessionWorkout, { sessionInstanceId: 'wednesday' })).workout.id).toBe('a');
  // Fresh unopened synthetic occurrences represent choosing the policy before either session.
  for (const id of ['monday', 'wednesday']) await db.doc('session_instances/' + id).update({ pinnedWorkoutId: admin.firestore.FieldValue.delete(), pinnedWorkoutPolicy: admin.firestore.FieldValue.delete(), pinnedWorkoutIndex: admin.firestore.FieldValue.delete(), pinnedWorkoutSequence: admin.firestore.FieldValue.delete() });
  await policy('scheduled');
  await db.doc('session_instances/monday').update({ status: 'missed' });
  const before = await read('playbooks/plan');
  for (let i = 0; i < 3; i++) await invoke(getMemberPlaybookSessions, { playbookId: 'plan' });
  expect(await read('playbooks/plan')).toEqual(before);
  expect((await invoke(getSessionWorkout, { sessionInstanceId: 'wednesday' })).workout.id).toBe('b');
  expect((await read('session_instances/monday')).workoutCompletedAt).toBeUndefined();
  expect((await read('playbooks/plan')).nextWorkoutIndex).toBe(0);
});

test('coach ownership, invalid policy and foreign workout validation reject without writes', async () => {
  const before = await read('playbooks/plan');
  await expect(policy('scheduled', member)).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(policy('scheduled', { uid: 'stranger', token: { role: 'coach' } })).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(policy('other')).rejects.toMatchObject({ code: 'invalid-argument' });
  expect(await read('playbooks/plan')).toEqual(before);
  await db.doc('workouts/b').update({ coachId: 'other' });
  await expect(policy('scheduled')).rejects.toMatchObject({ code: 'failed-precondition' });
});

test('changing policy preserves pinned, in-progress and completed assignments; unopened sessions return to carry mode', async () => {
  await policy('scheduled');
  await invoke(getSessionWorkout, { sessionInstanceId: 'monday' });
  await db.doc('session_instances/started').set(session('2026-11-06T14:00:00Z', { status: 'in_progress', scheduledWorkoutId: 'c' }));
  await db.doc('session_instances/done').set(session('2026-11-08T14:00:00Z', { status: 'completed', workoutCompletedAt: time('2026-10-25T00:00:00Z'), pinnedWorkoutId: 'b' }));
  await policy('carry_forward');
  expect((await read('session_instances/monday')).pinnedWorkoutId).toBe('a');
  expect((await read('session_instances/started')).scheduledWorkoutId).toBe('c');
  expect((await read('session_instances/done')).pinnedWorkoutId).toBe('b');
  expect((await read('session_instances/wednesday')).scheduledWorkoutId).toBeUndefined();
  expect((await invoke(getSessionWorkout, { sessionInstanceId: 'wednesday' })).workout.id).toBe('a');
});

test('scheduled concurrent and repeated completion never advances carry pointer, including after policy switch', async () => {
  await policy('scheduled');
  for (const id of ['monday', 'wednesday']) await invoke(getSessionWorkout, { sessionInstanceId: id });
  await policy('carry_forward');
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-04T14:01:00Z'));
  await Promise.all(Array.from({ length: 4 }, () => Promise.all([
    invoke(completePlaybookSession, { sessionInstanceId: 'monday', workoutId: 'a' }),
    invoke(completePlaybookSession, { sessionInstanceId: 'wednesday', workoutId: 'b' }),
  ])));
  expect((await read('playbooks/plan')).nextWorkoutIndex).toBe(0);
  expect((await read('session_instances/wednesday')).workoutCompletedAt).toBeDefined();
});

test('cancelled occurrence retains its place and rescheduling preserves assigned workout', async () => {
  await policy('scheduled');
  const monday = await read('session_instances/monday');
  await db.doc('session_instances/monday').update({ status: 'cancelled' });
  // The actual reschedule action updates date/time fields, not workout assignment fields.
  await db.doc('session_instances/wednesday').update({ startUtc: time('2026-11-01T14:00:00Z'), scheduledDate: '2026-11-01', scheduledStartTime: '09:00' });
  expect((await invoke(getSessionWorkout, { sessionInstanceId: 'wednesday' })).workout.id).toBe('b');
  expect((await read('session_instances/monday')).scheduledWorkoutOrderUtc).toEqual(monday.scheduledWorkoutOrderUtc);
});

test('new earlier one-off slots reorder only unopened assignments in UTC order across DST; pinned slots stay stable', async () => {
  await policy('scheduled');
  const plan = await read('playbooks/plan');
  const booked = await bookOccurrence({ playbookId: 'plan', playbook: plan, coachId: 'coach', memberKey: 'roster', memberId: 'roster', guestEmail: null, memberName: 'Synthetic Member', dateStr: '2026-11-01', startTime: '01:30', timezone: 'America/New_York', durationMinutes: 45, sessionKind: 'coach_review', recordingEnabled: false, weeklySessionCap: null });
  const created = await read('session_instances/' + booked.instanceId);
  expect(created.scheduledWorkoutId).toBe('a');
  expect(created.startUtc.toMillis()).toBe(wallTimeToUtc('2026-11-01', '01:30', 'America/New_York').getTime());
  expect((await read('session_instances/monday')).scheduledWorkoutId).toBe('b');
  expect((await read('session_instances/wednesday')).scheduledWorkoutId).toBe('c');
  expect(created.workoutCompletedAt).toBeUndefined();
});

test('recurring and one-off coach scheduling both persist assignments; repeat call with same request is idempotent', async () => {
  await db.doc('session_instances/monday').delete(); await db.doc('session_instances/wednesday').delete();
  await policy('scheduled');
  const data = { playbookId: 'plan', memberId: 'roster', daysOfWeek: [1, 3], startTime: '09:00', timezone: 'America/New_York', startDate: '2026-11-02', repeatFrequency: 'weekly', repeatHorizonWeeks: 2, recordingEnabled: false, clientRequestId: 'policy-recurring-test' };
  const result = await invoke(bookPlaybookSession, data, coach);
  const again = await invoke(bookPlaybookSession, data, coach);
  expect(again).toEqual(result);
  expect(result.bookedCount).toBeGreaterThan(2);
  const rows = (await db.collection('session_instances').get()).docs.map(d => d.data()).sort((a, b) => a.startUtc.toMillis() - b.startUtc.toMillis());
  expect(rows.map(r => r.scheduledWorkoutId)).toEqual(rows.map((_, i) => ['a', 'b', 'c'][i % 3]));
  expect(rows.every(r => !r.workoutCompletedAt)).toBe(true);
});

test('spring DST and timezone day boundaries use absolute occurrence order, starting at current carry position', async () => {
  await db.doc('session_instances/monday').set(session('2027-03-14T07:30:00Z', { scheduledDate: '2027-03-14', scheduledStartTime: '03:30' }));
  await db.doc('session_instances/wednesday').set(session('2027-03-14T06:30:00Z', { memberId: 'uid', scheduledDate: '2027-03-13', scheduledStartTime: '22:30', timezone: 'America/Los_Angeles' }));
  await db.doc('playbooks/plan').update({ nextWorkoutIndex: 1 });
  await policy('scheduled');
  expect((await read('session_instances/wednesday')).scheduledWorkoutId).toBe('b');
  expect((await read('session_instances/monday')).scheduledWorkoutId).toBe('c');
  // Re-saving the same policy is idempotent, not a new assignment epoch.
  const before = await read('playbooks/plan'); await policy('scheduled'); expect(await read('playbooks/plan')).toEqual(before);
});

test('booking concurrently with carry completion never resets the completion pointer', async () => {
  await db.doc('session_instances/current').set(session('2026-10-25T11:59:00Z'));
  await invoke(getSessionWorkout, { sessionInstanceId: 'current' });
  const [booked] = await Promise.all([
    invoke(bookPlaybookSession, { playbookId: 'plan', daysOfWeek: [5], startTime: '09:00', timezone: 'America/New_York', startDate: '2026-11-02', repeatFrequency: 'none', recordingEnabled: false }, coach),
    invoke(completePlaybookSession, { sessionInstanceId: 'current', workoutId: 'a' }),
  ]);
  expect(booked.bookedCount).toBe(1);
  expect((await read('playbooks/plan')).nextWorkoutIndex).toBe(1);
  expect((await read('session_instances/' + booked.results[0].instanceId)).scheduledWorkoutId).toBeUndefined();
});
