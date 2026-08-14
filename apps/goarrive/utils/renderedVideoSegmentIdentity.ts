/**
 * Player identity helpers for renderer segment metadata.
 *
 * The renderer's `blockId` is an opaque wire value. Player context comes from
 * the persisted offset metadata; no delimiter or payload parsing is required.
 */

export type RenderedVideoSegmentPhase =
  | 'intro'
  | 'outro'
  | 'follow-along'
  | 'special'
  | 'work'
  | 'movement-rest'
  | 'block-rest';

/** Structural form accepted from the merged #263 offset map. */
export interface RenderedVideoSegmentMetadata {
  blockId: string;
  parentBlockId?: string;
  blockIndex?: number;
  phase?: RenderedVideoSegmentPhase;
  segmentIndex?: number;
  movementId?: string;
  movementIndex?: number;
}

export interface RenderedVideoSegmentIdentity {
  blockId: string;
  parentBlockId: string;
  blockIndex: number;
  phase: RenderedVideoSegmentPhase;
  /** Global renderer position; gaps are retained when a segment is omitted. */
  segmentIndex: number;
  movementId?: string;
  movementIndex?: number;
}

const SEGMENT_PHASES: ReadonlySet<string> = new Set<RenderedVideoSegmentPhase>([
  'intro',
  'outro',
  'follow-along',
  'special',
  'work',
  'movement-rest',
  'block-rest',
]);

function isSegmentPhase(value: unknown): value is RenderedVideoSegmentPhase {
  return typeof value === 'string' && SEGMENT_PHASES.has(value);
}

function isOptionalSafeInteger(value: unknown): value is number | undefined {
  return value === undefined || Number.isSafeInteger(value);
}

/** Return the renderer id unchanged. It is intentionally not reconstructed. */
export function rendererSegmentId(
  identity: Pick<RenderedVideoSegmentIdentity, 'blockId'>,
): string {
  return identity.blockId;
}

/** Build full player context from one persisted renderer offset. */
export function renderedVideoSegmentIdentityFromMetadata(
  metadata: RenderedVideoSegmentMetadata,
): RenderedVideoSegmentIdentity | null {
  if (
    typeof metadata.blockId !== 'string'
    || metadata.blockId.length === 0
    || typeof metadata.parentBlockId !== 'string'
    || metadata.parentBlockId.length === 0
    || !Number.isSafeInteger(metadata.blockIndex)
    || !Number.isSafeInteger(metadata.segmentIndex)
    || !isSegmentPhase(metadata.phase)
    || (metadata.movementId !== undefined && typeof metadata.movementId !== 'string')
    || !isOptionalSafeInteger(metadata.movementIndex)
  ) {
    return null;
  }

  return {
    blockId: metadata.blockId,
    parentBlockId: metadata.parentBlockId,
    blockIndex: metadata.blockIndex as number,
    phase: metadata.phase,
    segmentIndex: metadata.segmentIndex as number,
    ...(metadata.movementId === undefined ? {} : { movementId: metadata.movementId }),
    ...(metadata.movementIndex === undefined ? {} : { movementIndex: metadata.movementIndex }),
  };
}

/** Stable player-side key retaining both the opaque wire id and rich context. */
export function encodeRenderedVideoSegmentIdentity(
  identity: RenderedVideoSegmentIdentity,
): string {
  return JSON.stringify([
    identity.blockId,
    identity.parentBlockId,
    identity.blockIndex,
    identity.phase,
    identity.segmentIndex,
    identity.movementId ?? null,
    identity.movementIndex ?? null,
  ]);
}

/** Decode a player-side identity key, rejecting malformed or unsupported data. */
export function decodeRenderedVideoSegmentIdentity(
  key: string,
): RenderedVideoSegmentIdentity | null {
  try {
    const value: unknown = JSON.parse(key);
    if (!Array.isArray(value) || value.length !== 7) return null;

    const [
      blockId,
      parentBlockId,
      blockIndex,
      phase,
      segmentIndex,
      movementId,
      movementIndex,
    ] = value;
    if (
      typeof blockId !== 'string'
      || blockId.length === 0
      || typeof parentBlockId !== 'string'
      || parentBlockId.length === 0
      || !Number.isSafeInteger(blockIndex)
      || !isSegmentPhase(phase)
      || !Number.isSafeInteger(segmentIndex)
      || (movementId !== null && typeof movementId !== 'string')
      || (movementIndex !== null && !Number.isSafeInteger(movementIndex))
    ) {
      return null;
    }

    return {
      blockId,
      parentBlockId,
      blockIndex: blockIndex as number,
      phase,
      segmentIndex: segmentIndex as number,
      ...(movementId === null ? {} : { movementId }),
      ...(movementIndex === null ? {} : { movementIndex: movementIndex as number }),
    };
  } catch {
    return null;
  }
}

/** Resolve an opaque renderer id using the rich offset metadata catalog. */
export function resolveRenderedVideoSegmentIdentity(
  blockId: string,
  catalog: readonly RenderedVideoSegmentMetadata[],
): RenderedVideoSegmentIdentity | null {
  const metadata = catalog.find((candidate) => candidate.blockId === blockId);
  return metadata ? renderedVideoSegmentIdentityFromMetadata(metadata) : null;
}
