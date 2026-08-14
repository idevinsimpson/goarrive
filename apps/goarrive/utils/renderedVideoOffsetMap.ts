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

export interface RenderedVideoBlockOffset {
  blockId: string;
  startMs: number;
  endMs: number;
}

export interface RenderedVideoMeta {
  url: string;
  durationMs: number;
  version: number;
  status: 'pending' | 'rendering' | 'ready' | 'failed';
  blocks: RenderedVideoBlockOffset[];
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
  meta: RenderedVideoMeta,
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
  meta: RenderedVideoMeta,
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
export function clampVideoTime(meta: RenderedVideoMeta, videoTimeMs: number): number {
  return Math.max(0, Math.min(videoTimeMs, meta.durationMs));
}

/** Return the block immediately after the named one, or null if it is last. */
export function nextBlockAfter(
  meta: RenderedVideoMeta,
  blockId: string,
): RenderedVideoBlockOffset | null {
  const index = meta.blocks.findIndex((b) => b.blockId === blockId);
  if (index === -1 || index === meta.blocks.length - 1) return null;
  return meta.blocks[index + 1];
}

/** Return the block immediately before the named one, or null if it is first. */
export function previousBlockBefore(
  meta: RenderedVideoMeta,
  blockId: string,
): RenderedVideoBlockOffset | null {
  const index = meta.blocks.findIndex((b) => b.blockId === blockId);
  if (index <= 0) return null;
  return meta.blocks[index - 1];
}
