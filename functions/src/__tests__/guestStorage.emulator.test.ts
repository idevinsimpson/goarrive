import { readGuestAuthorizedSnapshot } from '../guestAuthorizedSnapshot';
import * as admin from 'firebase-admin';
import { guestStorageReader } from '../guestStorageReader';
import { GuestWorkoutDelivery } from '../guestWorkoutDelivery';
import { GuestWorkoutCapabilities } from '../guestWorkoutCapability';
import { FirestoreGuestCapabilityStore } from '../guestCapabilityStore';
import { changeGuestAssignmentMembers, readGuestAssignment } from '../guestAssignmentLifecycle';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== '127.0.0.1:9199') throw new Error('Local emulators required');
const projectId = 'demo-guest-storage', bucketName = projectId + '.appspot.com';
const app = admin.initializeApp({ projectId, storageBucket: bucketName }, projectId), db = app.firestore(), bucket = app.storage().bucket();
const now = Date.parse('2026-11-01T06:15:00Z'), path = 'movements/coach/video/synthetic.mp4';
const payload = Buffer.from('synthetic bytes, not real media');
let token: string, service: GuestWorkoutCapabilities, delivery: GuestWorkoutDelivery;
beforeAll(async () => {
  process.env.GUEST_WORKOUT_ROLLOUT_ENABLED = 'true';
  await db.doc('members/member').set({ coachId: 'coach', uid: 'uid' });
  await db.doc('playbooks/plan').set({ coachId: 'coach', memberIds: ['member'], workoutIds: ['workout'], nextWorkoutIndex: 0 });
  await db.doc('session_instances/session').set({ coachId: 'coach', memberId: 'member', playbookId: 'plan', status: 'scheduled', startUtc: admin.firestore.Timestamp.fromMillis(now - 1000), endUtc: admin.firestore.Timestamp.fromMillis(now + 60000) });
  await db.doc('workouts/workout').set({ coachId: 'coach', blocks: [{ type: 'Strength', movements: [{ movementId: 'movement', reps: '10', restSec: 0 }] }] });
  await db.doc('movements/movement').set({ coachId: 'coach', name: 'Synthetic movement', videoUrl: `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=SYNTHETIC` });
  await bucket.file(path).save(payload, { resumable: false, metadata: { contentType: 'video/mp4' } });
  await changeGuestAssignmentMembers(db, 'coach', 'plan', ['member']);
  service = new GuestWorkoutCapabilities(new FirestoreGuestCapabilityStore(db), { enabled: true, mediaReady: true, assignmentGenerationReady: true }, () => now, () => Buffer.alloc(32, 42));
  token = (await service.issue({ uid: 'coach', role: 'coach' }, (await readGuestAssignment(db, 'plan', 'member'))!, true, now + 60000)).token;
  delivery = new GuestWorkoutDelivery({ enabled: true, bucket: bucketName, now: () => now, snapshot: value => readGuestAuthorizedSnapshot(db, value, () => now), ...guestStorageReader(bucket) });
});
afterAll(async () => { delete process.env.GUEST_WORKOUT_ROLLOUT_ENABLED; await bucket.file(path).delete({ ignoreNotFound: true }); await db.terminate(); await app.delete(); });

test('real Storage range delivery is opaque, bounded, and never writes session/progression', async () => {
  const before = (await db.doc('session_instances/session').get()).data(), manifest = await delivery.manifest(token);
  expect(JSON.stringify(manifest)).not.toMatch(/SYNTHETIC|firebasestorage|movements\/coach/);
  const first = await delivery.chunk(token, 'asset-0', manifest.revision, 'bytes=0-8');
  expect(first.bytes).toEqual(payload.subarray(0, 9)); expect(first.size).toBe(payload.length);
  expect(first.headers['Cache-Control']).toContain('no-store');
  const second = await delivery.chunk(token, 'asset-0', manifest.revision, `bytes=9-${payload.length - 1}`);
  expect(Buffer.concat([first.bytes, second.bytes])).toEqual(payload);
  expect((await db.doc('session_instances/session').get()).data()).toEqual(before);
  expect((await db.doc('playbooks/plan').get()).data()?.nextWorkoutIndex).toBe(0);
  // Same path, new Storage generation: old manifest must not mix the bytes.
  await bucket.file(path).save(Buffer.alloc(payload.length, 9), { resumable: false, metadata: { contentType: 'video/mp4' } });
  await expect(delivery.chunk(token, 'asset-0', manifest.revision, 'bytes=0-8')).rejects.toThrow('unavailable');
  const changed = await delivery.manifest(token); expect(changed.revision).not.toBe(manifest.revision);
  const reader = guestStorageReader(bucket);
  const racing = new GuestWorkoutDelivery({ enabled: true, bucket: bucketName, now: () => now, snapshot: value => readGuestAuthorizedSnapshot(db, value, () => now), ...reader, readRange: async (p, range, generation) => {
      const bytes = await reader.readRange(p, range, generation);
      await bucket.file(path).save(payload, { resumable: false, metadata: { contentType: 'video/mp4' } });
      return bytes;
    } });
  await expect(racing.chunk(token, 'asset-0', changed.revision, 'bytes=0-8')).rejects.toThrow('unavailable');
  for (const mutation of ['delete', 'archive', 'owner']) {
    const original = (await db.doc('movements/movement').get()).data()!;
    const contentRace = new GuestWorkoutDelivery({ enabled: true, bucket: bucketName, now: () => now, snapshot: value => readGuestAuthorizedSnapshot(db, value, () => now), ...reader, metadata: async p => {
        const meta = await reader.metadata(p);
        if (mutation === 'delete') await db.doc('movements/movement').delete();
        else await db.doc('movements/movement').update(mutation === 'archive' ? { isArchived: true } : { coachId: 'other' });
        return meta;
      } });
    await expect(contentRace.manifest(token)).rejects.toThrow('unavailable');
    await db.doc('movements/movement').set(original);
    const beforeRead = await delivery.manifest(token);
    const lateRead = new GuestWorkoutDelivery({ enabled: true, bucket: bucketName, now: () => now, snapshot: value => readGuestAuthorizedSnapshot(db, value, () => now), ...reader, readRange: async (p, range, generation) => {
        const bytes = await reader.readRange(p, range, generation);
        if (mutation === 'delete') await db.doc('movements/movement').delete();
        else await db.doc('movements/movement').update(mutation === 'archive' ? { isArchived: true } : { coachId: 'other' });
        return bytes;
      } });
    await expect(lateRead.chunk(token, 'asset-0', beforeRead.revision, 'bytes=0-8')).rejects.toThrow('unavailable');
    await db.doc('movements/movement').set(original);
  }
  const current = await delivery.manifest(token);
  await db.doc('session_instances/session').update({ status: 'cancelled' });
  await expect(delivery.chunk(token, 'asset-0', current.revision, 'bytes=0-8')).rejects.toThrow('unavailable');
  await db.doc('session_instances/session').update({ status: 'scheduled' });
  await service.revoke({ uid: 'coach', role: 'coach' }, (await readGuestAssignment(db, 'plan', 'member'))!);
  await expect(delivery.chunk(token, 'asset-0', current.revision, 'bytes=0-8')).rejects.toThrow('unavailable');
});
