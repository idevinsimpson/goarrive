import { ownsSessionMember } from '../sessionIdentity';
const records: Record<string, any> = {};
const ref = (path: string): any => ({ path, get: async () => snap(path) });
const snap = (path: string) => ({ exists: !!records[path], id: path.split('/').pop(), data: () => records[path] });
let queue = Promise.resolve();
const db = {
  collection: (name: string) => ({ doc: (id: string) => ref(name + '/' + id) }),
  runTransaction: (fn: any) => {
    const result = queue.then(() => fn({ get: async (r: any) => snap(r.path), update: (r: any, data: any) => { records[r.path] = { ...records[r.path], ...data }; } }));
    queue = result.catch(() => {});
    return result;
  },
};
jest.mock('firebase-admin', () => ({ firestore: () => db }));
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'timestamp' } }));
jest.mock('../playbookScheduling', () => ({}));
jest.mock('firebase-functions/v2/https', () => ({
  onCall: (_: any, fn: any) => fn, onRequest: (_: any, fn: any) => fn,
  HttpsError: class extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } },
}));
import { completePlaybookSession, getSessionWorkout, getSessionTime } from '../playbookBooking';
const auth = { uid: 'auth-member', token: { role: 'member', memberId: 'roster-member', coachId: 'coach' } };
const invoke = (fn: any, data: any, caller = auth) => fn({ auth: caller, data });
beforeEach(() => {
  for (const key of Object.keys(records)) delete records[key];
  records['session_instances/session'] = { memberId: 'roster-member', coachId: 'coach', playbookId: 'plan', status: 'scheduled', startUtc: { toMillis: () => 1 } };
  records['playbooks/plan'] = { coachId: 'coach', workoutIds: ['workout'], nextWorkoutIndex: 0 };
  records['workouts/workout'] = { coachId: 'coach', name: 'Synthetic workout' };
});
test('signed roster identity is coach scoped and rejects another roster member', () => {
  const session = records['session_instances/session'];
  expect(ownsSessionMember(auth.uid, auth.token, session)).toBe(true);
  expect(ownsSessionMember('other', { ...auth.token, memberId: 'other' }, session)).toBe(false);
  expect(ownsSessionMember(auth.uid, { ...auth.token, coachId: 'other' }, session)).toBe(false);
  expect(ownsSessionMember('legacy', {}, { memberId: 'legacy' })).toBe(true);
});
test('direct session time check is owned and read-only', async () => {
  const before = JSON.stringify(records);
  expect((await invoke(getSessionTime, { sessionInstanceId: 'session' })).serverNow).toEqual(expect.any(Number));
  expect(JSON.stringify(records)).toBe(before);
  await expect(invoke(getSessionTime, { sessionInstanceId: 'session' }, { uid: 'other', token: { ...auth.token, memberId: 'other' } })).rejects.toMatchObject({ code: 'permission-denied' });
});
test('assigned member resolves and pins the assigned workout', async () => {
  await expect(invoke(getSessionWorkout, { sessionInstanceId: 'session' })).resolves.toMatchObject({ workout: { id: 'workout' } });
  expect(records['session_instances/session'].pinnedWorkoutId).toBe('workout');
});
test('same-coach unrelated member cannot read workout or complete session', async () => {
  const other = { uid: 'other', token: { ...auth.token, memberId: 'other' } };
  for (const fn of [getSessionWorkout, completePlaybookSession]) {
    await expect(invoke(fn, { sessionInstanceId: 'session', workoutId: 'workout' }, other)).rejects.toMatchObject({ code: 'permission-denied' });
  }
});
test('completion survives retries and advances progression exactly once', async () => {
  await invoke(getSessionWorkout, { sessionInstanceId: 'session' });
  await Promise.all([1, 2, 3].map(() => invoke(completePlaybookSession, { sessionInstanceId: 'session', workoutId: 'workout' })));
  expect(records['session_instances/session']).toMatchObject({ status: 'completed', workoutCompletedAt: 'timestamp' });
  expect(records['playbooks/plan'].nextWorkoutIndex).toBe(1);
});
test('wrong workout and premature completion are rejected without progression', async () => {
  await invoke(getSessionWorkout, { sessionInstanceId: 'session' });
  await expect(invoke(completePlaybookSession, { sessionInstanceId: 'session', workoutId: 'other' })).rejects.toMatchObject({ code: 'failed-precondition' });
  records['session_instances/session'].startUtc = { toMillis: () => Date.now() + 3600000 };
  await expect(invoke(completePlaybookSession, { sessionInstanceId: 'session', workoutId: 'workout' })).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(records['playbooks/plan'].nextWorkoutIndex).toBe(0);
});
