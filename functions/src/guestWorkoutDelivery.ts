import { createHash } from 'crypto';
import { boundedGuestMediaRange, storedGuestMediaPath } from './guestMediaBoundary';
import { unavailable } from './guestWorkoutCapability';

export type GuestAdmission = { sessionId: string; workoutId: string; coachId: string; validUntil: number; digest: string };
export interface GuestDeliveryDependencies {
  enabled?: boolean;
  bucket: string;
  now(): number;
  admit(token: string): Promise<GuestAdmission>;
  workout(id: string): Promise<Record<string, any> | undefined>;
  movement(id: string): Promise<Record<string, any> | undefined>;
  metadata(path: string): Promise<{ size: number; contentType: string; generation: string }>;
  readRange(path: string, range: { start: number; end: number }, generation: string): Promise<Buffer>;
}
type Asset = { id: string; path: string; kind: 'video' | 'image' };
const TYPES = new Set(['Intro', 'Outro', 'Demo', 'Transition', 'Water Break', 'Grab Equipment', 'Follow-Along Video', 'Warm-Up', 'Circuit', 'Superset', 'Interval', 'Strength', 'Timed', 'AMRAP', 'EMOM', 'Cool-Down', 'Rest']);
const num = (value: unknown, fallback = 0, max = 3600) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : fallback;
const text = (value: unknown, max = 120) => typeof value === 'string' ? value.slice(0, max) : '';
const same = (a: GuestAdmission, b: GuestAdmission) => a.digest === b.digest && a.sessionId === b.sessionId && a.workoutId === b.workoutId && a.coachId === b.coachId;

export class GuestWorkoutDelivery {
  constructor(private d: GuestDeliveryDependencies) {}
  private async selection(token: string) {
    if (this.d.enabled !== true) throw unavailable();
    const admission = await this.d.admit(token);
    if (this.d.now() >= admission.validUntil) throw unavailable();
    const workout = await this.d.workout(admission.workoutId);
    if (!workout || workout.coachId !== admission.coachId || workout.isGlobal === true || workout.isArchived === true || !Array.isArray(workout.blocks) || workout.blocks.length > 60) throw unavailable();
    const assets: Asset[] = [], canonical = new Map<string, Record<string, any>>();
    const asset = (value: unknown, kind: Asset['kind']) => {
      if (!value) return null;
      const path = storedGuestMediaPath(value, this.d.bucket, admission.coachId);
      if (!path) throw unavailable();
      const id = 'asset-' + assets.length; assets.push({ id, path, kind }); return id;
    };
    let count = 0;
    const blocks: Record<string, any>[] = [];
    for (const block of workout.blocks) {
      if (!block || !TYPES.has(block.type) || (block.movements && !Array.isArray(block.movements))) throw unavailable();
      if (block.type === 'Follow-Along Video' && !block.videoUrl) throw unavailable();
      const movements: Record<string, any>[] = [];
      for (const m of block.movements || []) {
        if (!m || ++count > 300) throw unavailable();
        let library: Record<string, any> = {};
        if (m.movementId) {
          if (typeof m.movementId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(m.movementId)) throw unavailable();
          if (!canonical.has(m.movementId)) {
            const loaded = await this.d.movement(m.movementId);
            if (!loaded || loaded.coachId !== admission.coachId || loaded.isGlobal === true || loaded.isArchived === true) throw unavailable();
            canonical.set(m.movementId, loaded);
          }
          library = canonical.get(m.movementId)!;
        }
        movements.push({ name: text(library.name || m.movementName || m.name), sets: num(m.sets, 1, 100), reps: text(m.reps, 30),
          workSec: num(m.workSec ?? m.durationSec ?? m.duration, 30), restSec: num(m.restSec ?? m.restSeconds),
          videoAsset: asset(m.videoUrl || m.mediaUrl || library.videoUrl || library.mediaUrl, 'video'),
          thumbnailAsset: asset(m.thumbnailUrl || library.thumbnailUrl, 'image') });
      }
      blocks.push({ type: block.type, rounds: num(block.rounds, 1, 100), durationSec: num(block.durationSec, 10),
        restBetweenMovementsSec: num(block.restBetweenMovementsSec), movements,
        videoAsset: asset(block.videoUrl, 'video') });
    }
    // Explicitly omit all identity, notes, URLs, voice/music, Zoom and write state.
    const view = { title: 'Your workout', blocks, unsupportedFeatures: ['generated voice', 'background music', 'coach notes', 'video calls'] };
    const revision = createHash('sha256').update(JSON.stringify({ view, assets })).digest('hex');
    const finalAdmission = await this.d.admit(token);
    if (!same(admission, finalAdmission) || this.d.now() >= finalAdmission.validUntil) throw unavailable();
    return { admission: finalAdmission, view, assets, revision };
  }
  async manifest(token: string) {
    const selected = await this.selection(token), fresh = await this.d.admit(token);
    if (!same(selected.admission, fresh) || this.d.now() >= fresh.validUntil) throw unavailable();
    return { workout: selected.view, revision: selected.revision, serverNow: this.d.now(), validUntil: fresh.validUntil,
      assets: selected.assets.map(({ id, kind }) => ({ id, kind })) };
  }
  async chunk(token: string, assetId: string, revision: string, rangeHeader: unknown) {
    const selected = await this.selection(token);
    if (selected.revision !== revision) throw unavailable();
    const asset = selected.assets.find(a => a.id === assetId);
    if (!asset) throw unavailable();
    const metadata = await this.d.metadata(asset.path);
    const allowed = asset.kind === 'video' ? ['video/mp4', 'video/webm'] : ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!allowed.includes(metadata.contentType) || !/^\d+$/.test(metadata.generation)) throw unavailable();
    const range = boundedGuestMediaRange(rangeHeader, metadata.size);
    if (!range) throw unavailable();
    const bytes = await this.d.readRange(asset.path, range, metadata.generation);
    if (bytes.length !== range.end - range.start + 1) throw unavailable();
    // Revocation/assignment/cancellation and removal of this specific asset are
    // checked again after provider I/O. Never send bytes before this revalidation.
    const latest = await this.selection(token);
    if (!same(selected.admission, latest.admission) || latest.revision !== revision ||
      latest.assets.find(a => a.id === assetId)?.path !== asset.path || this.d.now() >= latest.admission.validUntil) throw unavailable();
    return { bytes, size: metadata.size, start: range.start, end: range.end, contentType: metadata.contentType,
      serverNow: this.d.now(), validUntil: latest.admission.validUntil, headers: { 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' } };
  }
}
