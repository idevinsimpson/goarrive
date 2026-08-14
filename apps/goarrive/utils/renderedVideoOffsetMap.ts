/**
 * renderedVideoOffsetMap — bidirectional lookup between video timeline (ms)
 * and workout block position for continuous-video rendered workouts.
 *
 * Pure functions — no React, no hooks, no side effects. Designed for the
 * Phase 3 continuous-video pipeline. The Phase 4 player-integration worker
 * will wire these into the state machine and consume the PlayerCommand types.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RenderedVideoSegmentPhase =
  | 'intro'
  | 'outro'
  | 'follow-along'
  | 'special'
  | 'work'
  | 'movement-rest'
  | 'block-rest';

export interface RenderedVideoBlockOffset {
  /** Segment-unique renderer id. */
  blockId: string;
  /** Original workout block id retained for player/state-machine mapping. */
  parentBlockId?: string;
  blockIndex?: number;
  phase?: RenderedVideoSegmentPhase;
  /** Original global renderer position, including gaps for omitted segments. */
  segmentIndex?: number;
  movementId?: string;
  movementIndex?: number;
  startMs: number;
  endMs: number;
}

/** Timeline metadata consumed by the pure offset/seek utilities. */
export interface RenderedVideoTimelineMeta {
  durationMs: number;
  version: number;
  status: 'pending' | 'rendering' | 'ready' | 'failed';
  blocks: RenderedVideoBlockOffset[];
}

/** Existing #263 read-time player contract. */
export interface RenderedVideoMeta extends RenderedVideoTimelineMeta {
  url: string;
}

/** Durable Firestore representation. Signed URLs are never persisted here. */
export interface PersistedRenderedVideoMeta extends RenderedVideoTimelineMeta {
  storagePath: string;
  sourceHash: string;
}

/** Read-time representation returned after a trusted backend mints a URL. */
export interface ResolvedRenderedVideoMeta extends PersistedRenderedVideoMeta {
  url: string;
}

export interface OffsetLookupResult {
  blockId: string;
  blockIndex: number;
  blockOffsetMs: number; // how far into this block the video time is
  isBeforeFirstBlock: boolean;
  isAfterLastBlock: boolean;
}

export type PlayerCommand =
  | { type: 'seekToBlock'; blockId: string }
  | { type: 'skipForward'; deltaMs: number }  // default 15000
  | { type: 'skipBackward'; deltaMs: number } // default 15000
  | { type: 'pause' }
  | { type: 'play' };

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Given a video timestamp, find which block is playing.
 *
 * Boundary convention: a block owns [startMs, endMs). When videoTimeMs equals
 * a block's startMs it belongs to that block, not the previous one.
 *
 * Empty blocks: returns blockIndex -1, blockId '', both boundary flags true.
 */
export function lookupBlockAtVideoTime(
  meta: RenderedVideoTimelineMeta,
  videoTimeMs: number,
): OffsetLookupResult {
  const { blocks } = meta;

  if (blocks.length === 0) {
    return {
      blockId: '',
      blockIndex: -1,
      blockOffsetMs: 0,
      isBeforeFirstBlock: true,
      isAfterLastBlock: true,
    };
  }

  const first = blocks[0];
  const last = blocks[blocks.length - 1];

  if (videoTimeMs < first.startMs) {
    return {
      blockId: first.blockId,
      blockIndex: 0,
      blockOffsetMs: 0,
      isBeforeFirstBlock: true,
      isAfterLastBlock: false,
    };
  }

  if (videoTimeMs >= last.endMs) {
    const lastIndex = blocks.length - 1;
    return {
      blockId: last.blockId,
      blockIndex: lastIndex,
      blockOffsetMs: last.endMs - last.startMs,
      isBeforeFirstBlock: false,
      isAfterLastBlock: true,
    };
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (videoTimeMs >= block.startMs && videoTimeMs < block.endMs) {
      return {
        blockId: block.blockId,
        blockIndex: i,
        blockOffsetMs: videoTimeMs - block.startMs,
        isBeforeFirstBlock: false,
        isAfterLastBlock: false,
      };
    }
  }

  // Unreachable with well-formed meta, but satisfy the type-checker.
  return {
    blockId: last.blockId,
    blockIndex: blocks.length - 1,
    blockOffsetMs: last.endMs - last.startMs,
    isBeforeFirstBlock: false,
    isAfterLastBlock: true,
  };
}

/**
 * Reverse lookup: given a block ID and optional offset within that block,
 * return the absolute video time.
 *
 * blockOffsetMs is clamped to [0, block duration] before adding to startMs.
 * Returns null when blockId is not found in meta.blocks.
 */
export function videoTimeForBlock(
  meta: RenderedVideoTimelineMeta,
  blockId: string,
  blockOffsetMs = 0,
): number | null {
  const block = meta.blocks.find((b) => b.blockId === blockId);
  if (!block) return null;
  const blockDuration = block.endMs - block.startMs;
  const clampedOffset = Math.max(0, Math.min(blockOffsetMs, blockDuration));
  return block.startMs + clampedOffset;
}

/** Clamp videoTimeMs to the valid range [0, durationMs]. */
export function clampVideoTime(meta: RenderedVideoTimelineMeta, videoTimeMs: number): number {
  return Math.max(0, Math.min(videoTimeMs, meta.durationMs));
}

/** Return the block immediately after the named one, or null if it is last. */
export function nextBlockAfter(
  meta: RenderedVideoTimelineMeta,
  blockId: string,
): RenderedVideoBlockOffset | null {
  const index = meta.blocks.findIndex((b) => b.blockId === blockId);
  if (index === -1 || index === meta.blocks.length - 1) return null;
  return meta.blocks[index + 1];
}

/** Return the block immediately before the named one, or null if it is first. */
export function previousBlockBefore(
  meta: RenderedVideoTimelineMeta,
  blockId: string,
): RenderedVideoBlockOffset | null {
  const index = meta.blocks.findIndex((b) => b.blockId === blockId);
  if (index <= 0) return null;
  return meta.blocks[index - 1];
}

export interface MetaValidationIssue {
  code:
    | 'block-startMs-negative'
    | 'block-endMs-not-after-start'
    | 'blocks-out-of-order'
    | 'blocks-overlap'
    | 'block-past-duration'
    | 'duplicate-blockId';
  message: string;
  blockIndex?: number;
  blockId?: string;
}

/**
 * Structural validation for RenderedVideoMeta. The render pipeline (Phase 2)
 * is trusted to produce sorted, non-overlapping blocks fitting inside the
 * video duration — but a corrupted Firestore doc, a partial write, or a bug
 * in a future writer would make every lookup here return silent wrong answers
 * (e.g. lookupBlockAtVideoTime picks the first matching block, so an overlap
 * would pin playback to the earlier one forever). Asserting the invariant
 * once at load time turns those silent failures into a visible error.
 *
 * Empty blocks arrays are valid (a workout that failed to render yet has
 * `status: 'pending'` and no blocks — that is a legitimate state, not
 * corruption).
 */
export function validateMeta(meta: RenderedVideoTimelineMeta): MetaValidationIssue[] {
  const issues: MetaValidationIssue[] = [];
  const seenIds = new Set<string>();
  let previousEnd = 0;

  meta.blocks.forEach((block, i) => {
    if (seenIds.has(block.blockId)) {
      issues.push({
        code: 'duplicate-blockId',
        message: `blocks[${i}].blockId "${block.blockId}" appears more than once`,
        blockIndex: i,
        blockId: block.blockId,
      });
    }
    seenIds.add(block.blockId);

    if (block.startMs < 0) {
      issues.push({
        code: 'block-startMs-negative',
        message: `blocks[${i}].startMs is ${block.startMs} (must be >= 0)`,
        blockIndex: i,
        blockId: block.blockId,
      });
    }

    if (block.endMs <= block.startMs) {
      issues.push({
        code: 'block-endMs-not-after-start',
        message: `blocks[${i}].endMs (${block.endMs}) must be greater than startMs (${block.startMs})`,
        blockIndex: i,
        blockId: block.blockId,
      });
    }

    if (i > 0 && block.startMs < previousEnd) {
      const overlap = previousEnd - block.startMs;
      const priorEndsAt = meta.blocks[i - 1].endMs;
      if (block.startMs < meta.blocks[i - 1].startMs) {
        issues.push({
          code: 'blocks-out-of-order',
          message: `blocks[${i}].startMs (${block.startMs}) is earlier than blocks[${i - 1}].startMs (${meta.blocks[i - 1].startMs})`,
          blockIndex: i,
          blockId: block.blockId,
        });
      } else {
        issues.push({
          code: 'blocks-overlap',
          message: `blocks[${i}].startMs (${block.startMs}) is inside blocks[${i - 1}] [${meta.blocks[i - 1].startMs}, ${priorEndsAt}) — overlap ${overlap}ms`,
          blockIndex: i,
          blockId: block.blockId,
        });
      }
    }

    if (block.endMs > meta.durationMs) {
      issues.push({
        code: 'block-past-duration',
        message: `blocks[${i}].endMs (${block.endMs}) exceeds meta.durationMs (${meta.durationMs})`,
        blockIndex: i,
        blockId: block.blockId,
      });
    }

    previousEnd = Math.max(previousEnd, block.endMs);
  });

  return issues;
}

