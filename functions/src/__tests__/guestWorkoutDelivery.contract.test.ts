import { GuestWorkoutDelivery, GuestDeliveryDependencies } from '../guestWorkoutDelivery';
const now = 100000, bucket = 'demo-guest.appspot.com';
const url = (path: string) => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=SYNTHETIC_NOT_A_CREDENTIAL`;
function fixture() {
  const workout: any = { coachId: 'coach', memberId: 'PRIVATE_MEMBER', notes: 'PRIVATE_NOTE', zoomJoinUrl: 'PRIVATE_ZOOM', blocks: [{ type: 'Strength', movements: [{ movementId: 'm', movementName: 'Squat', notes: 'PRIVATE_NOTE', sets: 3, reps: '10', restSec: 0 }] }] };
  const movement: any = { coachId: 'coach', name: 'Squat', videoUrl: url('movements/coach/videos/a.mp4'), notes: 'PRIVATE_NOTE' };
  const admission = { sessionId: 's', workoutId: 'w', coachId: 'coach', validUntil: now + 25000, digest: 'private-digest' };
  const d: GuestDeliveryDependencies = { enabled: true, bucket, now: () => now, snapshot: jest.fn(async () => ({ admission: { ...admission }, content: structuredClone({ workout, movements: { m: movement }, version: 'fixture' }) })),
    metadata: jest.fn(async () => ({ size: 10, contentType: 'video/mp4', generation: '1' })), readRange: jest.fn(async (_p, r) => Buffer.alloc(r.end - r.start + 1, 7)) };
  return { d, workout, movement, admission, service: new GuestWorkoutDelivery(d) };
}
test('defaults disabled before database or provider access', async () => {
  const f = fixture(); f.d.enabled = undefined; await expect(f.service.manifest('synthetic')).rejects.toThrow('unavailable'); expect(f.d.snapshot).not.toHaveBeenCalled();
});
test('manifest only exposes allowlisted prescription and opaque asset IDs', async () => {
  const f = fixture(), manifest = await f.service.manifest('synthetic'); const text = JSON.stringify(manifest);
  for (const secret of ['PRIVATE_', 'SYNTHETIC_NOT', 'firebasestorage', 'movements/coach', 'private-digest', 'sessionId', 'coachId']) expect(text).not.toContain(secret);
  expect(manifest.workout.blocks[0].movements[0]).toMatchObject({ name: 'Squat', sets: 3, reps: '10', restSec: 0, videoAsset: 'asset-0' });
  expect(f.d.metadata).toHaveBeenCalledWith('movements/coach/videos/a.mp4'); expect(f.d.readRange).not.toHaveBeenCalled();
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
  f.d.readRange = jest.fn(async () => { f.d.snapshot = async () => { throw new Error('This workout link is unavailable.'); }; return Buffer.alloc(10); });
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

test('same-path overwrite between chunks invalidates the original manifest', async () => {
  const f = fixture(), m = await f.service.manifest('synthetic');
  await f.service.chunk('synthetic', 'asset-0', m.revision, 'bytes=0-4');
  f.d.metadata = async () => ({ size: 10, contentType: 'video/mp4', generation: '2' });
  await expect(f.service.chunk('synthetic', 'asset-0', m.revision, 'bytes=5-9')).rejects.toThrow('unavailable');
  expect((await f.service.manifest('synthetic')).revision).not.toBe(m.revision);
});

test.each(['generation', 'size', 'contentType'])('same-path metadata changes during read discard buffered bytes: %s', async field => {
  const f = fixture(), m = await f.service.manifest('synthetic');
  f.d.readRange = jest.fn(async () => {
    f.d.metadata = async () => ({ size: field === 'size' ? 11 : 10, contentType: field === 'contentType' ? 'video/webm' : 'video/mp4', generation: field === 'generation' ? '2' : '1' });
    return Buffer.alloc(10);
  });
  await expect(f.service.chunk('synthetic', 'asset-0', m.revision, 'bytes=0-9')).rejects.toThrow('unavailable');
  expect(f.d.readRange).toHaveBeenCalledWith('movements/coach/videos/a.mp4', { start: 0, end: 9 }, '1');
});

test.each(['delete', 'archive', 'owner', 'workout-owner'])('late content change during metadata I/O rejects projection: %s', async change => {
  const f = fixture(), original = f.d.snapshot;
  f.d.metadata = async () => {
    if (change === 'delete') f.d.snapshot = async token => { const s = await original(token); return { ...s, content: { ...s.content, movements: {} } }; };
    if (change === 'archive') f.movement.isArchived = true;
    if (change === 'owner') f.movement.coachId = 'other';
    if (change === 'workout-owner') f.workout.coachId = 'other';
    return { size: 10, contentType: 'video/mp4', generation: '1' };
  };
  await expect(f.service.manifest('synthetic')).rejects.toThrow('unavailable');
});

test.each(['rounds', 'sets', 'between-round-rest', 'weight', 'sides', 'automatic-rest', 'intro', 'outro', 'follow-along', 'circuit', 'long-reps', 'invalid-reps', 'negative-reps'])('unsupported prescription is rejected instead of silently reduced: %s', async kind => {
  const f = fixture(), block = f.workout.blocks[0], m = block.movements[0];
  if (kind === 'rounds') block.rounds = 2;
  if (kind === 'sets') block.sets = 2;
  if (kind === 'between-round-rest') block.restBetweenRoundsSec = 30;
  if (kind === 'weight') m.weight = '20 kg';
  if (kind === 'sides') m.swapSides = true;
  if (kind === 'automatic-rest') delete m.restSec;
  if (kind === 'intro') f.workout.introVideoUrl = url('workouts/coach/intro.mp4');
  if (kind === 'outro') f.workout.outroVideoUrl = url('workouts/coach/outro.mp4');
  if (kind === 'follow-along') { block.type = 'Follow-Along Video'; block.videoDurationSec = 600; }
  if (kind === 'circuit') block.type = 'Circuit';
  if (kind === 'long-reps') m.reps = '1'.repeat(31);
  if (kind === 'invalid-reps') m.reps = NaN;
  if (kind === 'negative-reps') m.reps = -1;
  await expect(f.service.manifest('synthetic')).rejects.toThrow('unavailable');
});

test.each(['swapSides', 'swapMode', 'swapWindowSec'])('rejects unsupported canonical hydration fallthrough: %s', async field => {
  const f = fixture(); f.workout.blocks[0].movements[0].swapSides = false;
  f.movement[field] = field === 'swapSides' ? true : field === 'swapMode' ? 'split' : 5;
  await expect(f.service.manifest('synthetic')).rejects.toThrow('unavailable');
});

test('final unified snapshot denial cannot be superseded by a later content read', async () => {
  const f = fixture(), first = f.d.snapshot;
  let calls = 0;
  f.d.snapshot = async token => { if (++calls === 2) throw new Error('This workout link is unavailable.'); return first(token); };
  await expect(f.service.manifest('synthetic')).rejects.toThrow('unavailable');
  expect(calls).toBe(2); expect(f.d.readRange).not.toHaveBeenCalled();
});
