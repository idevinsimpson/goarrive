/**
 * Identity helpers for the renderer's segment-level `blockId` contract.
 *
 * PR #262 currently writes `${parentBlockId}#${segmentIndex}` to rendered
 * metadata. That wire id is intentionally small, but it cannot by itself tell
 * the player whether a segment represents movement work, its following rest,
 * or a special phase. `RenderedVideoSegmentIdentity` retains that player
 * context while these helpers preserve compatibility with the current wire
 * format.
 */

export type RenderedVideoSegmentPhase = 'movement' | 'rest' | 'special';

export interface RenderedVideoSegmentIdentity {
  parentBlockId: string;
  segmentIndex: number;
  phase: RenderedVideoSegmentPhase;
  /** The player movement index associated with this segment, when applicable. */
  movementIndex: number | null;
}

export interface ParsedRendererSegmentId {
  parentBlockId: string;
  segmentIndex: number;
}

/** Encode the exact segment id currently emitted by PR #262. */
export function rendererSegmentId(
  identity: Pick<RenderedVideoSegmentIdentity, 'parentBlockId' | 'segmentIndex'>,
): string {
  return `${identity.parentBlockId}#${identity.segmentIndex}`;
}

/** Parse the current renderer wire id without losing `#` characters in the parent id. */
export function parseRendererSegmentId(blockId: string): ParsedRendererSegmentId | null {
  const hashIndex = blockId.lastIndexOf('#');
  if (hashIndex <= 0) return null;

  const parentBlockId = blockId.slice(0, hashIndex);
  const rawSegmentIndex = blockId.slice(hashIndex + 1);
  if (!/^\d+$/.test(rawSegmentIndex)) return null;

  const segmentIndex = Number(rawSegmentIndex);
  if (!Number.isSafeInteger(segmentIndex)) return null;

  return { parentBlockId, segmentIndex };
}

/**
 * Stable, reversible player-side key. Unlike the renderer wire id, this key
 * retains phase and movement context needed to relocate the flattened player.
 */
export function encodeRenderedVideoSegmentIdentity(
  identity: RenderedVideoSegmentIdentity,
): string {
  return JSON.stringify([
    identity.parentBlockId,
    identity.segmentIndex,
    identity.phase,
    identity.movementIndex,
  ]);
}

/** Decode a player-side identity key, rejecting malformed or unsupported data. */
export function decodeRenderedVideoSegmentIdentity(
  key: string,
): RenderedVideoSegmentIdentity | null {
  try {
    const value: unknown = JSON.parse(key);
    if (!Array.isArray(value) || value.length !== 4) return null;

    const [parentBlockId, segmentIndex, phase, movementIndex] = value;
    if (
      typeof parentBlockId !== 'string'
      || parentBlockId.length === 0
      || !Number.isSafeInteger(segmentIndex)
      || (phase !== 'movement' && phase !== 'rest' && phase !== 'special')
      || (movementIndex !== null && !Number.isSafeInteger(movementIndex))
    ) {
      return null;
    }

    return {
      parentBlockId,
      segmentIndex: segmentIndex as number,
      phase,
      movementIndex: movementIndex as number | null,
    };
  } catch {
    return null;
  }
}

/** Resolve a renderer wire id back to its full player identity using the render catalog. */
export function resolveRenderedVideoSegmentIdentity(
  blockId: string,
  catalog: readonly RenderedVideoSegmentIdentity[],
): RenderedVideoSegmentIdentity | null {
  const parsed = parseRendererSegmentId(blockId);
  if (!parsed) return null;

  return catalog.find(
    (identity) => identity.parentBlockId === parsed.parentBlockId
      && identity.segmentIndex === parsed.segmentIndex,
  ) ?? null;
}
