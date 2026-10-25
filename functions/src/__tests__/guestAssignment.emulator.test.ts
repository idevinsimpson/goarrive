import * as admin from 'firebase-admin';
import { initializeTestEnvironment, assertFails, assertSucceeds, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { changeGuestAssignmentMembers, readGuestAssignment } from '../guestAssignmentLifecycle';
import { FirestoreGuestCapabilityStore } from '../guestCapabilityStore';
import { GuestWorkoutCapabilities } from '../guestWorkoutCapability';
import { getGuestWorkoutAccess, revokeGuestWorkoutLink } from '../guestWorkoutAccess';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Local emulator required');
const projectId = 'demo-guest-capability', app = admin.initializeApp({ projectId }), db = app.firestore();
let env: RulesTestEnvironment;
const now = Date.parse('2026-11-01T06:15:00Z');
const owner = { uid: 'coach', role: 'coach' };
beforeAll(async () => { env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8') } }); });
beforeEach(async () => {
  await env.clearFirestore(); process.env.GUEST_WORKOUT_ROLLOUT_ENABLED = 'true';
  await db.doc('playbooks/plan').set({ coachId: 'coach', memberIds: ['member'], assignedMemberId: 'member', workoutIds: ['A', 'B'], nextWorkoutIndex: 0 });
  await db.doc('members/member').set({ coachId: 'coach', uid: 'uid' });
  await db.doc('members/foreign').set({ coachId: 'foreign' });
  await db.doc('session_instances/session').set({ coachId: 'coach', memberId: 'uid', playbookId: 'plan', status: 'scheduled', startUtc: admin.firestore.Timestamp.fromMillis(now - 60000), endUtc: admin.firestore.Timestamp.fromMillis(now + 60000) });
});
afterAll(async () => { delete process.env.GUEST_WORKOUT_ROLLOUT_ENABLED; await env.cleanup(); await db.terminate(); await app.delete(); });
async function fixture() {
  await changeGuestAssignmentMembers(db, 'coach', 'plan', ['member']);
  const assignment = (await readGuestAssignment(db, 'plan', 'member'))!;
  let sequence = 0;
  const store = new FirestoreGuestCapabilityStore(db);
  const service = new GuestWorkoutCapabilities(store, { enabled: true, mediaReady: true, assignmentGenerationReady: true }, () => now, () => Buffer.alloc(32, ++sequence));
  const token = (await service.issue(owner, assignment, true, now + 60000)).token;
  return { assignment, service, token, store };
}
test('server gate defaults closed before mutation', async () => {
  delete process.env.GUEST_WORKOUT_ROLLOUT_ENABLED;
  await expect(changeGuestAssignmentMembers(db, 'coach', 'plan', [])).rejects.toMatchObject({ code: 'failed-precondition' });
  expect((await db.doc('playbooks/plan').get()).data()?.memberIds).toEqual(['member']);
});
test('owner and cross-tenant member checks reject before mutation', async () => {
  await expect(changeGuestAssignmentMembers(db, 'other', 'plan', [])).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(changeGuestAssignmentMembers(db, 'coach', 'plan', ['foreign'])).rejects.toMatchObject({ code: 'permission-denied' });
});
test('real store resolves historical UID alias without progression/session writes', async () => {
  const f = await fixture(), before = (await db.doc('session_instances/session').get()).data();
  expect((await f.service.resolve(f.token)).workoutId).toBe('A');
  await f.service.resolve(f.token);
  expect((await db.doc('session_instances/session').get()).data()).toEqual(before);
  expect((await db.doc('playbooks/plan').get()).data()?.nextWorkoutIndex).toBe(0);
});
test('atomic remove/re-add changes private generation and cannot revive old token', async () => {
  const f = await fixture();
  await changeGuestAssignmentMembers(db, 'coach', 'plan', []);
  await expect(f.service.resolve(f.token)).rejects.toThrow('unavailable');
  await changeGuestAssignmentMembers(db, 'coach', 'plan', ['member']);
  expect((await readGuestAssignment(db, 'plan', 'member'))?.generation).not.toBe(f.assignment.generation);
  await expect(f.service.resolve(f.token)).rejects.toThrow('unavailable');
  await expect(f.service.issue(owner, f.assignment, true, now + 60000)).rejects.toThrow('unavailable');
});
test('rollout shutdown still permits removal and invalidates existing grants', async () => {
  const f = await fixture(); delete process.env.GUEST_WORKOUT_ROLLOUT_ENABLED;
  await changeGuestAssignmentMembers(db, 'coach', 'plan', []);
  await expect(f.service.resolve(f.token)).rejects.toThrow('unavailable');
});
test('public management contracts never enable issuance; revocation ignores rollout but keeps coach namespace', async () => {
  const f = await fixture(); delete process.env.GUEST_WORKOUT_ROLLOUT_ENABLED;
  expect(await (getGuestWorkoutAccess as any).run({ auth: { uid: 'coach', token: { role: 'coach' } } })).toMatchObject({ canIssue: false });
  await expect((getGuestWorkoutAccess as any).run({ auth: null })).rejects.toMatchObject({ code: 'permission-denied' });
  await (revokeGuestWorkoutLink as any).run({ auth: { uid: 'other', token: { role: 'coach' } }, data: { playbookId: 'plan', memberId: 'member' } });
  expect((await f.service.resolve(f.token)).workoutId).toBe('A');
  await (revokeGuestWorkoutLink as any).run({ auth: { uid: 'coach', token: { role: 'coach' } }, data: { playbookId: 'plan', memberId: 'member' } });
  await expect(f.service.resolve(f.token)).rejects.toThrow('unavailable');
});
test('client cannot lock, unlock, alter protected membership or forge private version/grant', async () => {
  const client = env.authenticatedContext('coach', { role: 'coach', coachId: 'coach' }).firestore();
  await assertFails(updateDoc(doc(client, 'playbooks/plan'), { guestAssignmentLocked: true }));
  await fixture();
  for (const patch of [{ memberIds: [] }, { assignedMemberId: 'other' }, { coachId: 'other' }, { guestAssignmentLocked: false }]) await assertFails(updateDoc(doc(client, 'playbooks/plan'), patch));
  await assertSucceeds(updateDoc(doc(client, 'playbooks/plan'), { name: 'Allowed edit' }));
  for (const path of ['guest_assignment_versions/plan', 'guest_workout_grants/fake', 'guest_assignment_grants/fake']) {
    await assertFails(getDoc(doc(client, path))); await assertFails(setDoc(doc(client, path), { generation: 'forged' }));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), path)));
  }
});
test('legacy unlocked assignment updates still pass existing rules', async () => {
  const client = env.authenticatedContext('coach', { role: 'coach', coachId: 'coach' }).firestore();
  await assertSucceeds(updateDoc(doc(client, 'playbooks/plan'), { memberIds: [], assignedMemberId: null }));
});
test('deletion/recreation cannot revive a grant even when server lock fields are copied', async () => {
  const f = await fixture(), plan = (await db.doc('playbooks/plan').get()).data()!;
  await db.doc('playbooks/plan').delete(); await db.doc('playbooks/plan').set(plan);
  await expect(f.service.resolve(f.token)).rejects.toThrow('unavailable');
});
test('rotation and revocation persist, cancelled/foreign sessions fail closed', async () => {
  const f = await fixture(), next = await f.service.issue(owner, f.assignment, true, now + 60000);
  await expect(f.service.resolve(f.token)).rejects.toThrow('unavailable');
  await db.doc('session_instances/session').update({ status: 'cancelled' });
  await expect(f.service.resolve(next.token)).rejects.toThrow('unavailable');
  await db.doc('session_instances/session').update({ status: 'scheduled', coachId: 'foreign' });
  await expect(f.service.resolve(next.token)).rejects.toThrow('unavailable');
  await f.service.revoke(owner, f.assignment); await expect(f.service.resolve(next.token)).rejects.toThrow('unavailable');
});
test.each(['cancel', 'complete', 'reschedule', 'workout'])('final transaction rejects actual Firestore mutation after selection: %s', async change => {
  const f = await fixture(), original = f.store.schedule.bind(f.store);
  jest.spyOn(f.store, 'schedule').mockImplementationOnce(async a => {
    const snapshot = await original(a);
    await db.doc('session_instances/session').update(change === 'cancel' ? { status: 'cancelled' } : change === 'complete' ?
      { workoutCompletedAt: admin.firestore.Timestamp.fromMillis(now) } : change === 'reschedule' ?
        { startUtc: admin.firestore.Timestamp.fromMillis(now + 86400000) } : { scheduledWorkoutId: 'B' });
    return snapshot;
  });
  await expect(f.service.resolve(f.token)).rejects.toThrow('unavailable');
});
