import { createHash } from 'crypto';

export type RenderSegmentType = 'video' | 'image' | 'rest';

export type RenderSegmentPhase =
  | 'intro'
  | 'outro'
  | 'follow-along'
  | 'special'
  | 'work'
  | 'movement-rest'
  | 'block-rest';

export interface RenderRequestIdentity {
  version: number;
  sourceHash: string;
}

export interface SegmentIdentity {
  workoutId: string;
  parentBlockId: string;
  blockIndex: number;
  phase: RenderSegmentPhase;
  segmentIndex: number;
  movementId?: string;
  movementIndex?: number;
}

export interface Segment extends SegmentIdentity {
  type: RenderSegmentType;
  label: string;
  url?: string;
  durationSec: number;
  blockId: string;
  _localPath?: string;
  _isGif?: boolean;
}

/**
 * Structurally matches the merged #263 timeline contract while retaining the
 * source context needed to map a unique render segment back to its workout.
 */
export interface RenderedSegmentOffset {
  blockId: string;
  parentBlockId: string;
  blockIndex: number;
  phase: RenderSegmentPhase;
  movementId?: string;
  movementIndex?: number;
  startMs: number;
  endMs: number;
}

export interface PersistedRenderedVideoMeta {
  status: 'ready';
  storagePath: string;
  durationMs: number;
  version: number;
  sourceHash: string;
  blocks: RenderedSegmentOffset[];
}

export interface RenderStorageLocation {
  storageObject: string;
  storagePath: string;
}

const SPECIAL_BLOCK_TYPES = new Set([
  'Intro',
  'Outro',
  'Demo',
  'Transition',
  'Water Break',
  'Grab Equipment',
  'Follow-Along Video',
]);

const VIDEO_EXTENSIONS = /\.(mp4|mov|m4v|webm|avi|mkv)(\?.*)?$/i;
const SOURCE_HASH_RE = /^[a-f0-9]{64}$/;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        const item = record[key];
        if (item !== undefined) result[key] = canonicalize(item);
        return result;
      }, {});
  }
  return value;
}

/** Hash every workout field consumed by the render pipeline. */
export function hashRenderSource(workout: Record<string, unknown>): string {
  const source = canonicalize({
    blocks: workout.blocks || [],
    introVideoUrl: workout.introVideoUrl || null,
    outroVideoUrl: workout.outroVideoUrl || null,
    restDurationSeconds: workout.restDurationSeconds ?? null,
  });
  return createHash('sha256').update(JSON.stringify(source)).digest('hex');
}

export function isValidRenderRequestIdentity(
  identity: RenderRequestIdentity,
): boolean {
  return Number.isSafeInteger(identity.version) &&
    identity.version > 0 &&
    SOURCE_HASH_RE.test(identity.sourceHash);
}

export function isCurrentRenderRequest(
  workout: Record<string, unknown>,
  identity: RenderRequestIdentity,
): boolean {
  if (!isValidRenderRequestIdentity(identity)) return false;
  const renderedVideo = workout.renderedVideo as Record<string, unknown> | undefined;
  return renderedVideo?.version === identity.version &&
    renderedVideo?.sourceHash === identity.sourceHash &&
    hashRenderSource(workout) === identity.sourceHash;
}

function encodeIdentity(identity: SegmentIdentity): string {
  return `segment:${Buffer.from(JSON.stringify(identity), 'utf8').toString('base64url')}`;
}

/** Reverse a renderer-emitted segment id without relying on delimiters in IDs. */
export function decodeSegmentId(blockId: string): SegmentIdentity | null {
  if (!blockId.startsWith('segment:')) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(blockId.slice('segment:'.length), 'base64url').toString('utf8'),
    ) as SegmentIdentity;
    if (!parsed.workoutId || !parsed.parentBlockId || !parsed.phase) return null;
    if (!Number.isInteger(parsed.blockIndex) || !Number.isInteger(parsed.segmentIndex)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Flatten a workout into deterministic, globally unique render segments. */
export function flattenWorkout(
  workout: Record<string, unknown>,
  workoutId: string,
): Segment[] {
  if (!workoutId) throw new Error('workoutId is required for segment identity');

  const blocks = (workout.blocks as Record<string, unknown>[]) || [];
  const segments: Segment[] = [];
  const workoutRestDur = (workout.restDurationSeconds as number) || 30;

  const append = (
    segment: Omit<Segment, keyof SegmentIdentity | 'blockId'>,
    context: Omit<SegmentIdentity, 'workoutId' | 'segmentIndex'>,
  ): void => {
    const identity: SegmentIdentity = {
      workoutId,
      ...context,
      segmentIndex: segments.length,
    };
    segments.push({ ...segment, ...identity, blockId: encodeIdentity(identity) });
  };

  if (workout.introVideoUrl) {
    append(
      {
        type: 'video',
        label: 'Intro',
        url: workout.introVideoUrl as string,
        durationSec: 10,
      },
      { parentBlockId: '$intro', blockIndex: -1, phase: 'intro' },
    );
  }

  blocks.forEach((block, blockIndex) => {
    const blockType = (block.type as string) || 'Circuit';
    const parentBlockId = (block.id as string) || `block-${blockIndex}`;
    const movements = (block.movements as Record<string, unknown>[]) || [];

    if (blockType === 'Follow-Along Video') {
      append(
        {
          type: 'video',
          label: (block.label || block.name || 'Follow-Along') as string,
          url: (block.videoUrl as string) || '',
          durationSec: (block.videoDurationSec || block.durationSec || 60) as number,
        },
        { parentBlockId, blockIndex, phase: 'follow-along' },
      );
      return;
    }

    if (blockType === 'Water Break' || blockType === 'Rest') {
      append(
        {
          type: 'rest',
          label: (block.label || block.name || 'Rest') as string,
          durationSec: (block.durationSec || workoutRestDur) as number,
        },
        { parentBlockId, blockIndex, phase: 'block-rest' },
      );
      return;
    }

    if (SPECIAL_BLOCK_TYPES.has(blockType)) {
      append(
        block.videoUrl
          ? {
              type: 'video',
              label: blockType,
              url: block.videoUrl as string,
              durationSec: (block.durationSec || 10) as number,
            }
          : {
              type: 'rest',
              label: blockType,
              durationSec: (block.durationSec || 15) as number,
            },
        { parentBlockId, blockIndex, phase: 'special' },
      );
      return;
    }

    movements.forEach((movement, movementIndex) => {
      const movementId = (movement.id as string) || `movement-${movementIndex}`;
      const videoUrl = (movement.videoUrl || movement.mediaUrl || '') as string;
      const workDuration = (
        movement.duration || movement.durationSec || movement.workSec || 30
      ) as number;
      const restAfter = (movement.restAfter || movement.restSec || 0) as number;
      const label = (movement.name || 'Movement') as string;
      const context = {
        parentBlockId,
        blockIndex,
        movementId,
        movementIndex,
        phase: 'work' as const,
      };

      if (videoUrl && VIDEO_EXTENSIONS.test(videoUrl)) {
        append({ type: 'video', label, url: videoUrl, durationSec: workDuration }, context);
      } else if (movement.thumbnailUrl || movement.posterUrl) {
        append(
          {
            type: 'image',
            label,
            url: (movement.thumbnailUrl || movement.posterUrl) as string,
            durationSec: workDuration,
          },
          context,
        );
      } else {
        append({ type: 'rest', label, durationSec: workDuration }, context);
      }

      if (restAfter > 0) {
        append(
          { type: 'rest', label: 'Rest', durationSec: restAfter },
          {
            parentBlockId,
            blockIndex,
            movementId,
            movementIndex,
            phase: 'movement-rest',
          },
        );
      }
    });

    if ((block.restDurationSeconds as number) > 0) {
      append(
        {
          type: 'rest',
          label: 'Rest',
          durationSec: block.restDurationSeconds as number,
        },
        { parentBlockId, blockIndex, phase: 'block-rest' },
      );
    }
  });

  if (workout.outroVideoUrl) {
    append(
      {
        type: 'video',
        label: 'Outro',
        url: workout.outroVideoUrl as string,
        durationSec: 10,
      },
      { parentBlockId: '$outro', blockIndex: blocks.length, phase: 'outro' },
    );
  }

  return segments;
}

export function buildBlockOffsets(segments: Segment[]): RenderedSegmentOffset[] {
  const offsets: RenderedSegmentOffset[] = [];
  let offsetMs = 0;

  for (const segment of segments) {
    const durationMs = Math.round(segment.durationSec * 1000);
    if (durationMs <= 0) continue;
    offsets.push({
      blockId: segment.blockId,
      parentBlockId: segment.parentBlockId,
      blockIndex: segment.blockIndex,
      phase: segment.phase,
      movementId: segment.movementId,
      movementIndex: segment.movementIndex,
      startMs: offsetMs,
      endMs: offsetMs + durationMs,
    });
    offsetMs += durationMs;
  }

  return offsets;
}

export function buildRenderStorageLocation(
  bucketName: string,
  workoutId: string,
  identity: RenderRequestIdentity,
): RenderStorageLocation {
  if (!bucketName) throw new Error('bucketName is required');
  if (!workoutId) throw new Error('workoutId is required');
  if (!isValidRenderRequestIdentity(identity)) throw new Error('invalid render request identity');

  const workoutKey = encodeURIComponent(workoutId);
  const storageObject =
    `rendered-videos/${workoutKey}/v${identity.version}/${identity.sourceHash}.mp4`;
  return { storageObject, storagePath: `gs://${bucketName}/${storageObject}` };
}

export function buildReadyRenderedVideoMeta(
  bucketName: string,
  workoutId: string,
  identity: RenderRequestIdentity,
  emittedSegments: Segment[],
): PersistedRenderedVideoMeta {
  const location = buildRenderStorageLocation(bucketName, workoutId, identity);
  const blocks = buildBlockOffsets(emittedSegments);
  const durationMs = blocks.length > 0 ? blocks[blocks.length - 1].endMs : 0;
  return {
    status: 'ready',
    storagePath: location.storagePath,
    durationMs,
    version: identity.version,
    sourceHash: identity.sourceHash,
    blocks,
  };
}
