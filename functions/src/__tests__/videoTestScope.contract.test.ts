import { videoRolloutDecision, videoPolicyInScope, isRecordedTestRoute } from '../videoTestScope';
const now = 1000000, member = { uid: 'uid', token: { role: 'member' } }, coach = { uid: 'coach', token: { role: 'coach' } };
const scope = { sessionId: 'session', memberUid: 'uid', memberId: 'roster', coachId: 'coach', playbookId: 'plan', workoutId: 'workout', startsAt: now, expiresAt: now + 3600000 };
beforeEach(() => { delete process.env.WORKOUT_VIDEO_TEST_SCOPE; process.env.WORKOUT_VIDEO_ROLLOUT_ENABLED = 'false'; });
afterEach(() => { delete process.env.WORKOUT_VIDEO_TEST_SCOPE; delete process.env.WORKOUT_VIDEO_ROLLOUT_ENABLED; });
test('default off; absent test scope preserves explicitly enabled general rollout', () => {
  expect(videoRolloutDecision(member, now).enabled).toBe(false);
  process.env.WORKOUT_VIDEO_ROLLOUT_ENABLED = 'true'; expect(videoRolloutDecision(member, now)).toEqual({ enabled: true });
});
test('only configured actual member and coach identities are admitted, even with general flag true', () => {
  process.env.WORKOUT_VIDEO_TEST_SCOPE = JSON.stringify(scope); process.env.WORKOUT_VIDEO_ROLLOUT_ENABLED = 'true';
  expect(videoRolloutDecision(member, now).scope).toEqual(scope); expect(videoRolloutDecision(coach, now).enabled).toBe(true);
  for (const auth of [{ uid: 'other', token: { role: 'member', memberId: 'roster', coachId: 'coach' } }, { uid: 'admin', token: { role: 'platformAdmin', coachId: 'coach' } }, { uid: 'uid', token: { role: 'coach' } }]) expect(videoRolloutDecision(auth, now).enabled).toBe(false);
});
test.each(['', '{}', '[]', 'null', '{bad', JSON.stringify({ ...scope, expiresAt: now + 7200001 }), JSON.stringify({ ...scope, extra: true }), JSON.stringify({ ...scope, sessionId: '../session' }), JSON.stringify({ ...scope, startsAt: '1000000' })])('malformed test scope fails closed regardless of general flag: %s', raw => {
  process.env.WORKOUT_VIDEO_TEST_SCOPE = raw; process.env.WORKOUT_VIDEO_ROLLOUT_ENABLED = 'true'; expect(videoRolloutDecision(member, now).enabled).toBe(false);
});
test('inclusive start and exclusive expiry, without client-clock input', () => {
  process.env.WORKOUT_VIDEO_TEST_SCOPE = JSON.stringify(scope);
  expect(videoRolloutDecision(member, now - 1).enabled).toBe(false); expect(videoRolloutDecision(member, now).enabled).toBe(true);
  expect(videoRolloutDecision(member, scope.expiresAt - 1).enabled).toBe(true); expect(videoRolloutDecision(member, scope.expiresAt).enabled).toBe(false);
});
test('scope enables only the owning coach exact policy targets', () => {
  process.env.WORKOUT_VIDEO_TEST_SCOPE = JSON.stringify(scope); const decision = videoRolloutDecision(coach, now);
  expect(videoPolicyInScope(decision, coach, 'playbook', 'plan')).toBe(true); expect(videoPolicyInScope(decision, coach, 'workout', 'workout')).toBe(true);
  expect(videoPolicyInScope(decision, coach, 'playbook', 'other')).toBe(false); expect(videoPolicyInScope(decision, coach, undefined, undefined)).toBe(false);
  expect(videoPolicyInScope(decision, member, 'playbook', 'plan')).toBe(false);
});

test('owning platformAdmin supported without impersonated or cross-owner access', () => {
  process.env.WORKOUT_VIDEO_TEST_SCOPE = JSON.stringify(scope);
  const owner = { uid: 'coach', token: { role: 'platformAdmin', coachId: 'other' } };
  expect(videoPolicyInScope(videoRolloutDecision(owner, now), owner, 'playbook', 'plan')).toBe(true);
  const other = { uid: 'other', token: { role: 'platformAdmin', coachId: 'coach' } };
  expect(videoRolloutDecision(other, now).enabled).toBe(false);
});
test('recording is explicit, bounded, and never reverts expired tests to the legacy UI', () => {
  process.env.WORKOUT_VIDEO_TEST_SCOPE = JSON.stringify({ ...scope, recordingMode: 'cloud' });
  expect(videoRolloutDecision(member, now).scope?.recordingMode).toBe('cloud');
  expect(videoRolloutDecision(member, scope.expiresAt).enabled).toBe(false);
  expect(isRecordedTestRoute(member, 'session')).toBe(true);
  expect(isRecordedTestRoute(member, 'other')).toBe(false);
  process.env.WORKOUT_VIDEO_TEST_SCOPE = JSON.stringify({ ...scope, recordingMode: 'local' });
  expect(videoRolloutDecision(member, now).enabled).toBe(false);
  expect(isRecordedTestRoute(member, 'session')).toBe(false);
});
