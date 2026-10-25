import { createHash } from 'crypto';
import { boundedGuestMediaRange, storedGuestMediaPath } from './guestMediaBoundary';
import { unavailable } from './guestWorkoutCapability';

export type GuestAdmission = { sessionId: string; workoutId: string; coachId: string; validUntil: number; digest: string };
export type GuestContentSnapshot = { workout?: Record<string, any>; movements: Record<string, Record<string, any> | undefined>; version: string };
export interface GuestDeliveryDependencies {
  enabled?: boolean;
  bucket: string;
  now(): number;
  /** One authoritative transaction over authorization AND referenced content. */
  snapshot(token: string): Promise<{ admission: GuestAdmission; content: GuestContentSnapshot }>;
  metadata(path: string): Promise<{ size: number; contentType: string; generation: string }>;
  readRange(path: string, range: { start: number; end: number }, generation: string): Promise<Buffer>;
}
type Asset = { id: string; path: string; kind: 'video' | 'image'; metadata?: { size: number; contentType: string; generation: string } };
const num = (value: unknown, fallback = 0, max = 3600) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : fallback;
const text = (value: unknown, max = 120) => typeof value === 'string' ? value.slice(0, max) : '';
const same = (a: GuestAdmission, b: GuestAdmission) => a.digest === b.digest && a.sessionId === b.sessionId && a.workoutId === b.workoutId && a.coachId === b.coachId;

export class GuestWorkoutDelivery {
  constructor(private d: GuestDeliveryDependencies) {}
  private async selection(token: string) {
    if (this.d.enabled !== true) throw unavailable();
    const initial = await this.d.snapshot(token), admission = initial.admission;
    if (this.d.now() >= admission.validUntil) throw unavailable();
    const snapshot = initial.content, workout = snapshot.workout;
    if (!workout || workout.coachId !== admission.coachId || workout.isGlobal === true || workout.isArchived === true || !Array.isArray(workout.blocks) || workout.blocks.length > 60) throw unavailable();
    // Deliberately limited until full authenticated timeline parity is shared.
    // Never flatten rounds, rests, side switches or special phases away.
    if (workout.introVideoUrl || workout.outroVideoUrl) throw unavailable();
    const assets: Asset[] = [], canonical = new Map<string, Record<string, any>>();
    const asset = (value: unknown, kind: Asset['kind']) => {
      if (!value) return null;
      const path = storedGuestMediaPath(value, this.d.bucket, admission.coachId);
      if (!path) throw unavailable();
      const existing = assets.find(a => a.path === path && a.kind === kind);
      if (existing) return existing.id;
      if (assets.length >= 32) throw unavailable();
      const id = 'asset-' + assets.length; assets.push({ id, path, kind }); return id;
    };
    let count = 0;
    const blocks: Record<string, any>[] = [];
    for (const block of workout.blocks) {
      if (!block || block.type !== 'Strength' || !Array.isArray(block.movements) || !block.movements.length ||
        (block.rounds ?? block.sets ?? 1) !== 1 || block.videoUrl || block.showDemo || block.showGrabEquipment ||
        block.headerOrder?.length || block.restBetweenSec || block.restBetweenRoundsSec || block.rest || block.restBetweenMovementsSec) throw unavailable();
      const movements: Record<string, any>[] = [];
      for (const m of block.movements || []) {
        if (!m || ++count > 300) throw unavailable();
        const duration = m.duration || m.durationSec || m.workSec || 30;
        if (m.restSec !== 0 || m.swapSides || m.swapMode || m.swapWindowSec || (m.weight != null && m.weight !== '') ||
          (m.cropScale != null && m.cropScale !== 1) || m.cropTranslateX || m.cropTranslateY ||
          typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || duration > 3600 ||
          (m.sets != null && (!Number.isInteger(m.sets) || m.sets < 1 || m.sets > 100)) ||
          (m.reps != null && !['string', 'number'].includes(typeof m.reps)) ||
          (typeof m.reps === 'string' && m.reps.length > 30) ||
          (typeof m.reps === 'number' && (!Number.isFinite(m.reps) || m.reps < 0 || m.reps > 10000))) throw unavailable();
        let library: Record<string, any> = {};
        if (m.movementId) {
          if (typeof m.movementId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(m.movementId)) throw unavailable();
          if (!canonical.has(m.movementId)) {
            const loaded = snapshot.movements[m.movementId];
            if (!loaded || loaded.coachId !== admission.coachId || loaded.isGlobal === true || loaded.isArchived === true) throw unavailable();
            canonical.set(m.movementId, loaded);
          }
          library = canonical.get(m.movementId)!;
        }
        // useMovementHydrate applies canonical side-switch fallthrough even when
        // the block's swapSides is false. Reject unsupported effective fields.
        if (library.swapSides === true || ['split', 'duplicate'].includes(library.swapMode) || typeof library.swapWindowSec === 'number') throw unavailable();
        const canonicalName = typeof library.name === 'string' && library.name.trim() ? library.name : undefined;
        movements.push({ name: text(canonicalName || m.movementName || m.name || 'Movement'), sets: m.sets ?? null, reps: text(m.reps == null ? '' : String(m.reps), 30),
          workSec: duration, restSec: 0,
          videoAsset: asset(m.videoUrl || m.mediaUrl || library.videoUrl || library.mediaUrl, 'video'),
          thumbnailAsset: asset(m.thumbnailUrl || library.thumbnailUrl, 'image') });
      }
      blocks.push({ type: block.type, rounds: num(block.rounds, 1, 100), durationSec: num(block.durationSec, 10),
        restBetweenMovementsSec: num(block.restBetweenMovementsSec), movements,
        videoAsset: asset(block.videoUrl, 'video') });
    }
    // The revision binds immutable object generations, not just reusable paths.
    // Every request rechecks current metadata; an overwrite invalidates old views.
    for (const a of assets) {
      const metadata = await this.d.metadata(a.path);
      const allowed = a.kind === 'video' ? ['video/mp4', 'video/webm'] : ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
      if (!allowed.includes(metadata.contentType) || !/^\d+$/.test(metadata.generation) || !boundedGuestMediaRange('bytes=0-0', metadata.size)) throw unavailable();
      a.metadata = { size: metadata.size, contentType: metadata.contentType, generation: metadata.generation };
    }
    // Explicitly omit all identity, notes, URLs, voice/music, Zoom and write state.
    const view = { title: 'Your workout', blocks, unsupportedFeatures: ['generated voice', 'background music', 'coach notes', 'video calls'] };
    const revision = createHash('sha256').update(JSON.stringify({ view, assets, contentVersion: snapshot.version })).digest('hex');
    const final = await this.d.snapshot(token), finalAdmission = final.admission;
    if (!same(admission, finalAdmission) || this.d.now() >= finalAdmission.validUntil) throw unavailable();
    if (JSON.stringify(final.content) !== JSON.stringify(snapshot) || this.d.now() >= finalAdmission.validUntil) throw unavailable();
    return { admission: finalAdmission, view, assets, revision };
  }
  async manifest(token: string) {
    const selected = await this.selection(token);
    return { workout: selected.view, revision: selected.revision, serverNow: this.d.now(), validUntil: selected.admission.validUntil,
      assets: selected.assets.map(({ id, kind }) => ({ id, kind })) };
  }
  async chunk(token: string, assetId: string, revision: string, rangeHeader: unknown) {
    const selected = await this.selection(token);
    if (selected.revision !== revision) throw unavailable();
    const asset = selected.assets.find(a => a.id === assetId);
    if (!asset) throw unavailable();
    const metadata = asset.metadata!;
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
