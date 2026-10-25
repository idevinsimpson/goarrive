import { GuestWorkoutDelivery, GuestDeliveryDependencies } from '../guestWorkoutDelivery';
const now = 100000, bucket = 'demo-guest.appspot.com';
const url = (path: string) => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=SYNTHETIC_NOT_A_CREDENTIAL`;
function fixture() {
  const workout: any = { coachId: 'coach', memberId: 'PRIVATE_MEMBER', notes: 'PRIVATE_NOTE', zoomJoinUrl: 'PRIVATE_ZOOM', blocks: [{ type: 'Strength', movements: [{ movementId: 'm', notes: 'PRIVATE_NOTE', sets: 3, reps: '10' }] }] };
  const movement: any = { coachId: 'coach', name: 'Squat', videoUrl: url('movements/coach/videos/a.mp4'), notes: 'PRIVATE_NOTE' };
  const admission = { sessionId: 's', workoutId: 'w', coachId: 'coach', validUntil: now + 25000, digest: 'private-digest' };
  const d: GuestDeliveryDependencies = { enabled: true, bucket, now: () => now, admit: jest.fn(async () => admission), workout: jest.fn(async () => workout), movement: jest.fn(async () => movement),
    metadata: jest.fn(async () => ({ size: 10, contentType: 'video/mp4', generation: '1' })), readRange: jest.fn(async (_p, r) => Buffer.alloc(r.end - r.start + 1, 7)) };
  return { d, workout, movement, admission, service: new GuestWorkoutDelivery(d) };
}
test('defaults disabled before database or provider access', async () => {
  const f = fixture(); f.d.enabled = undefined; await expect(f.service.manifest('synthetic')).rejects.toThrow('unavailable'); expect(f.d.admit).not.toHaveBeenCalled();
});
test('manifest only exposes allowlisted prescription and opaque asset IDs', async () => {
  const f = fixture(), manifest = await f.service.manifest('synthetic'); const text = JSON.stringify(manifest);
  for (const secret of ['PRIVATE_', 'SYNTHETIC_NOT', 'firebasestorage', 'movements/coach', 'private-digest', 'sessionId', 'coachId']) expect(text).not.toContain(secret);
  expect(manifest.workout.blocks[0].movements[0]).toMatchObject({ name: 'Squat', sets: 3, reps: '10', videoAsset: 'asset-0' });
  expect(f.d.metadata).not.toHaveBeenCalled(); expect(f.d.readRange).not.toHaveBeenCalled();
});
test.each(['foreign', 'global', 'external', 'wrong-bucket', 'traversal'])('fails closed for unsupported ownership/source: %s', async mode => {
  const f = fixture();
  if (mode === 'foreign') f.movement.coachId = 'other';
  if (mode === 'global') f.movement.isGlobal = true;
  if (mode === 'external') f.movement.videoUrl = 'http://169.254.169.254/computeMetadata/v1/';
  if (mode === 'wrong-bucket') f.movement.videoUrl = f.movement.videoUrl.replace(bucket, 'other.appspot.com');
  if (mode === 'traversal') f.movement.videoUrl = url('movements/coach/../other/a.mp4');
  await expect(f.service.manifest('synthetic')).rejects.toThrow('unavailable'); expect(f.d.readRange).not.toHaveBeenCalled();
});
test('range reads are generation-pinned, bounded and private', async () => {
  const f = fixture(), m = await f.service.manifest('synthetic');
  const chunk = await f.service.chunk('synthetic', 'asset-0', m.revision, 'bytes=0-9');
  expect(f.d.readRange).toHaveBeenCalledWith('movements/coach/videos/a.mp4', { start: 0, end: 9 }, '1');
  expect(chunk.bytes).toEqual(Buffer.alloc(10, 7)); expect(chunk.headers['Cache-Control']).toContain('no-store');
  await expect(f.service.chunk('synthetic', 'asset-0', m.revision, 'bytes=0-')).rejects.toThrow('unavailable');
  await expect(f.service.chunk('synthetic', 'forged', m.revision, 'bytes=0-1')).rejects.toThrow('unavailable');
});
test('revocation during provider read discards bytes', async () => {
  const f = fixture(), m = await f.service.manifest('synthetic');
  f.d.readRange = jest.fn(async () => { f.d.admit = async () => { throw new Error('This workout link is unavailable.'); }; return Buffer.alloc(10); });
  await expect(f.service.chunk('synthetic', 'asset-0', m.revision, 'bytes=0-9')).rejects.toThrow('unavailable');
});
test('asset removed or replaced during provider read cannot return stale bytes', async () => {
  const f = fixture(), m = await f.service.manifest('synthetic');
  f.d.readRange = jest.fn(async () => { f.movement.videoUrl = url('movements/coach/videos/new.mp4'); return Buffer.alloc(10); });
  await expect(f.service.chunk('synthetic', 'asset-0', m.revision, 'bytes=0-9')).rejects.toThrow('unavailable');
});
test('rejects unsafe content type and truncated/oversized byte responses', async () => {
  const f = fixture(), m = await f.service.manifest('synthetic');
  f.d.metadata = async () => ({ size: 10, contentType: 'text/html', generation: '1' });
  await expect(f.service.chunk('synthetic', 'asset-0', m.revision, 'bytes=0-9')).rejects.toThrow('unavailable');
  f.d.metadata = async () => ({ size: 10, contentType: 'video/mp4', generation: '1' }); f.d.readRange = async () => Buffer.alloc(11);
  await expect(f.service.chunk('synthetic', 'asset-0', m.revision, 'bytes=0-9')).rejects.toThrow('unavailable');
});

test.each(['global', 'archived', 'unsupported-follow-along'])('workout availability fails closed: %s', async kind => {
  const f = fixture();
  if (kind === 'global') f.workout.isGlobal = true;
  if (kind === 'archived') f.workout.isArchived = true;
  if (kind === 'unsupported-follow-along') f.workout.blocks = [{ type: 'Follow-Along Video', externalUrl: 'https://example.invalid' }];
  await expect(f.service.manifest('synthetic')).rejects.toThrow('unavailable');
});
