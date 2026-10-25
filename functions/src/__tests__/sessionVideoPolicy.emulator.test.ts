import * as admin from 'firebase-admin';
import { sessionVideoAvailability, setWorkoutVideoPolicy, getWorkoutVideoRollout, videoEnabled } from '../sessionVideoPolicy';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Local emulator required');
admin.initializeApp({ projectId: 'demo-session-video-policy' });
const db = admin.firestore();
const now = Date.parse('2026-10-25T12:00:00Z');
const member = { uid: 'uid', token: { role: 'member', memberId: 'roster', coachId: 'coach' } };
const coach = { uid: 'coach', token: { role: 'coach' } };
const read = (auth = member, at = now) => sessionVideoAvailability('session', auth, at);
beforeEach(async () => {
  delete process.env.WORKOUT_VIDEO_TEST_SCOPE;
  process.env.WORKOUT_VIDEO_ROLLOUT_ENABLED = 'true';
  await db.doc('session_video_receipts/session').set({ coachId: 'coach', roomId: 'room', meetingId: 'synthetic', recordingMode: 'none', memberId: 'roster', playbookId: 'plan', providerMode: 'live', participantVideoOff: true, startMs: now, endMs: now + 2700000 });
  await db.doc('playbooks/plan').set({ coachId: 'coach', memberIds: ['roster'], videoEnabled: true });
  await db.doc('workouts/workout').set({ coachId: 'coach', videoPolicy: 'inherit' });
  await db.doc('zoom_rooms/room').set({ coachId: 'coach', status: 'active' });
  await db.doc('session_instances/session').set({ coachId: 'coach', memberId: 'roster', playbookId: 'plan', pinnedWorkoutId: 'workout', status: 'allocated', startUtc: admin.firestore.Timestamp.fromMillis(now), endUtc: admin.firestore.Timestamp.fromMillis(now + 2700000), recordingEnabled: false, zoomRecordingMode: 'none', zoomRoomId: 'room', zoomMeetingId: 'synthetic', zoomJoinUrl: 'https://example.invalid/synthetic' });
});
afterAll(() => admin.app().delete());
test.each([undefined, false, true])('truth table for Playbook default %s', video => {
  expect(videoEnabled({ videoEnabled: video }, {})).toBe(video === true);
  expect(videoEnabled({ videoEnabled: video }, { videoPolicy: 'inherit' })).toBe(video === true);
  expect(videoEnabled({ videoEnabled: video }, { videoPolicy: 'off' })).toBe(false);
  expect(videoEnabled({ videoEnabled: video }, { videoPolicy: 'on' })).toBe(true);
});
test('read is side-effect free and current canonical member and coach are permitted', async () => {
  const before = (await db.doc('session_instances/session').get()).data();
  expect(await read()).toMatchObject({ enabled: true, serverNow: now });
  expect(await sessionVideoAvailability('session', coach, now)).toMatchObject({ enabled: true });
  expect((await db.doc('session_instances/session').get()).data()).toEqual(before);
  await expect(read({ uid: 'other', token: { role: 'member', memberId: 'other', coachId: 'coach' } })).rejects.toMatchObject({ code: 'permission-denied' });
});
test('server window accepts boundaries and rejects early/ended independent of client clock', async () => {
  expect((await read(member, now - 300000)).enabled).toBe(true);
  expect((await read(member, now - 300001)).enabled).toBe(false);
  expect((await read(member, now + 2700000)).enabled).toBe(true);
  expect((await read(member, now + 2700001)).enabled).toBe(false);
});
test.each([
  ['playbooks/plan', { memberIds: ['other'] }], ['playbooks/plan', { coachId: 'other' }],
  ['workouts/workout', { coachId: 'other' }], ['workouts/workout', { videoPolicy: 'off' }],
  ['session_instances/session', { status: 'cancelled' }], ['session_instances/session', { recordingEnabled: true }],
  ['session_video_receipts/session', { recordingMode: 'cloud' }], ['session_instances/session', { workoutCompletedAt: true }], ['session_instances/session', { zoomRoomId: 'missing' }],
  ['session_video_receipts/session', { providerMode: 'mock' }], ['session_video_receipts/session', { participantVideoOff: false }], ['session_video_receipts/session', { memberId: 'other' }], ['zoom_rooms/room', { coachId: 'other' }], ['zoom_rooms/room', { status: 'disabled' }],
])('denies changed assignment/state %s %j', async (path, update) => {
  await db.doc(path as string).update(update as any); expect((await read()).enabled).toBe(false);
});
test('only explicit shared-pool allocation may use active HMTI room, never grants host privileges', async () => {
  await db.doc('zoom_rooms/room').set({ poolId: 'hmti', status: 'active' });
  expect((await read()).enabled).toBe(false);
  await db.doc('session_instances/session').update({ roomSource: 'shared_pool' });
  expect(await read()).toMatchObject({ enabled: true, reason: '', serverNow: now });
});
test('only owning coach changes policy, preserving recording and progression', async () => {
  const invoke = (auth: any, policy: string) => (setWorkoutVideoPolicy as any).run({ auth, data: { kind: 'playbook', id: 'plan', policy } });
  await expect(invoke(member, 'off')).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(invoke({ uid: 'other', token: { role: 'coach' } }, 'off')).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(invoke(coach, 'invalid')).rejects.toMatchObject({ code: 'invalid-argument' });
  const before = (await db.doc('session_instances/session').get()).data();
  await invoke(coach, 'off'); expect((await read()).enabled).toBe(false);
  expect((await db.doc('session_instances/session').get()).data()).toEqual(before);
});

test('a room changed between initial lookup and admission cannot sign the stale meeting', async () => {
  const original = (await db.doc('session_instances/session').get()).data()!;
  await db.doc('session_instances/session').update({ zoomMeetingId: 'replacement' });
  expect(await sessionVideoAvailability('session', member, now, original)).toMatchObject({ enabled: false, reason: 'The session changed. Please retry video.' });
});

test('rescheduling or reallocating changes the non-secret client binding', async () => {
  const first = await read();
  await db.doc('session_instances/session').update({ zoomMeetingId: 'new-room-meeting' });
  await db.doc('session_video_receipts/session').update({ meetingId: 'new-room-meeting' });
  const second = await read();
  expect(second.enabled).toBe(true); expect(second.binding).not.toBe(first.binding);
  expect(second.binding).toMatch(/^[a-f0-9]{64}$/);
});

test('rollout absent/false blocks admission and policy writes even with workout override', async () => {
  await db.doc('workouts/workout').update({ videoPolicy: 'on' });
  for (const value of [undefined, 'false', 'TRUE']) {
    if (value === undefined) delete process.env.WORKOUT_VIDEO_ROLLOUT_ENABLED; else process.env.WORKOUT_VIDEO_ROLLOUT_ENABLED = value;
    expect((await read()).enabled).toBe(false);
    await expect((setWorkoutVideoPolicy as any).run({ auth: coach, data: { kind: 'playbook', id: 'plan', policy: 'on' } })).rejects.toMatchObject({ code: 'failed-precondition' });
  }
});
test('coach-writable recording fields cannot forge server recording observation', async () => {
  await db.doc('session_video_receipts/session').delete();
  await db.doc('session_instances/session').update({ zoomRecordingMode: 'none', recordingEnabled: false });
  expect((await read()).enabled).toBe(false);
});


const testScope = () => {
  process.env.WORKOUT_VIDEO_ROLLOUT_ENABLED = 'false';
  process.env.WORKOUT_VIDEO_TEST_SCOPE = JSON.stringify({ sessionId: 'session', memberUid: 'uid', memberId: 'roster', coachId: 'coach', playbookId: 'plan', workoutId: 'workout', startsAt: now, expiresAt: now + 600000 });
};
test('single-session scope keeps others off and bounds admission to test expiry without writes', async () => {
  testScope(); const before = (await db.doc('session_instances/session').get()).data();
  expect((await read()).enabled).toBe(true);
  const nearEnd = await read(member, now + 595000); expect(nearEnd.enabled).toBe(true); expect((nearEnd as any).validForMs).toBeGreaterThan(0); expect((nearEnd as any).validForMs).toBeLessThanOrEqual(5000);
  expect((await read(member, now + 600000)).enabled).toBe(false);
  expect((await sessionVideoAvailability('other-session', member, now)).enabled).toBe(false);
  expect((await read({ uid: 'other', token: { role: 'member', memberId: 'roster', coachId: 'coach' } })).enabled).toBe(false);
  expect((await db.doc('session_instances/session').get()).data()).toEqual(before);
});
test.each([{ pinnedWorkoutId: 'other' }, { playbookId: 'other' }, { memberId: 'other' }, { recordingEnabled: true }, { status: 'cancelled' }])('test scope never overrides assignment/recording/lifecycle: %j', async patch => {
  testScope(); await db.doc('session_instances/session').update(patch);
  const outcome = await read().catch(() => ({ enabled: false })); expect(outcome.enabled).toBe(false);
});
test('scoped test still requires server receipt and explicit workout policy', async () => {
  testScope(); await db.doc('workouts/workout').update({ videoPolicy: 'off' }); expect((await read()).enabled).toBe(false);
  await db.doc('workouts/workout').update({ videoPolicy: 'on' }); await db.doc('session_video_receipts/session').delete(); expect((await read()).enabled).toBe(false);
});
test('scope exposes and updates only exact coach policy target while global rollout stays off', async () => {
  testScope(); const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  try {
    const status = (auth: any, kind: string, id: string) => (getWorkoutVideoRollout as any).run({ auth, data: { kind, id } });
    expect(await status(coach, 'playbook', 'plan')).toEqual({ enabled: true }); expect(await status(coach, 'playbook', 'other')).toEqual({ enabled: false });
    expect(await status(member, 'workout', 'workout')).toEqual({ enabled: false });
    await expect((setWorkoutVideoPolicy as any).run({ auth: coach, data: { kind: 'workout', id: 'other', policy: 'on' } })).rejects.toMatchObject({ code: 'permission-denied' });
    await (setWorkoutVideoPolicy as any).run({ auth: coach, data: { kind: 'workout', id: 'workout', policy: 'off' } });
    expect((await db.doc('workouts/workout').get()).data()?.videoPolicy).toBe('off'); expect(process.env.WORKOUT_VIDEO_ROLLOUT_ENABLED).toBe('false');
  } finally { clock.mockRestore(); delete process.env.WORKOUT_VIDEO_TEST_SCOPE; }
});

test('test scope expiring during admission I/O is rejected before returning a lease', async () => {
  testScope(); const clock = jest.spyOn(Date, 'now').mockReturnValueOnce(now).mockReturnValue(now + 700000);
  try { expect((await read()).enabled).toBe(false); } finally { clock.mockRestore(); }
});
