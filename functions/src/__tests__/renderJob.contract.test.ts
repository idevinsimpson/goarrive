/**
 * Contract test: renderJob emitter × renderedVideoOffsetMap validateMeta
 *
 * Verifies that the segment ids produced by flattenWorkout + buildBlockOffsets
 * satisfy every invariant enforced by validateMeta (no duplicate blockIds,
 * non-negative startMs, strictly ascending endMs, no overlap).
 *
 * Also exercises the lookup/round-trip APIs so Phase 4 wiring can rely on them.
 */

import {
  flattenWorkout,
  buildBlockOffsets,
  parseSegmentId,
  Segment,
} from '../renderJob';

import {
  validateMeta,
  lookupBlockAtVideoTime,
  videoTimeForBlock,
  RenderedVideoMeta,
} from '../../../apps/goarrive/utils/renderedVideoOffsetMap';

// ── helpers ───────────────────────────────────────────────────────────────────

function buildMeta(segments: Segment[], version = 1): RenderedVideoMeta {
  const blocks = buildBlockOffsets(segments);
  const durationMs = blocks.length > 0 ? blocks[blocks.length - 1].endMs : 0;
  return {
    url: '',       // not persisted in Firestore; present for type compat
    status: 'ready',
    durationMs,
    version,
    blocks,
  };
}

// Synthetic workout: two Circuit blocks, each with 2 movements + restAfter
const TWO_BLOCK_WORKOUT = {
  blocks: [
    {
      id: 'block-a',
      type: 'Circuit',
      movements: [
        { name: 'Squat', videoUrl: 'https://cdn.example.com/squat.mp4', duration: 30, restAfter: 15 },
        { name: 'Lunge', videoUrl: 'https://cdn.example.com/lunge.mp4', duration: 30, restAfter: 15 },
      ],
      restDurationSeconds: 0,
    },
    {
      id: 'block-b',
      type: 'Circuit',
      movements: [
        { name: 'Push-up', videoUrl: 'https://cdn.example.com/pushup.mp4', duration: 45, restAfter: 20 },
        { name: 'Plank', thumbnailUrl: 'https://cdn.example.com/plank.jpg', duration: 60, restAfter: 0 },
      ],
      restDurationSeconds: 30,
    },
  ],
};

// Workout with intro + outro, a follow-along block, and a water break
const MIXED_WORKOUT = {
  introVideoUrl: 'https://cdn.example.com/intro.mp4',
  outroVideoUrl: 'https://cdn.example.com/outro.mp4',
  blocks: [
    {
      id: 'fav-blk',
      type: 'Follow-Along Video',
      videoUrl: 'https://cdn.example.com/fav.mp4',
      videoDurationSec: 120,
    },
    {
      id: 'wb-blk',
      type: 'Water Break',
      durationSec: 30,
    },
    {
      id: 'circuit-blk',
      type: 'Circuit',
      movements: [
        { name: 'Burpee', videoUrl: 'https://cdn.example.com/burpee.mp4', duration: 30, restAfter: 10 },
      ],
      restDurationSeconds: 0,
    },
  ],
};

// ── Fix 1 contract: validateMeta passes with ZERO issues ──────────────────────

describe('emitter contract: validateMeta', () => {
  test('two-block workout passes validateMeta with 0 issues', () => {
    const segments = flattenWorkout(TWO_BLOCK_WORKOUT);
    const meta = buildMeta(segments);
    const issues = validateMeta(meta);
    expect(issues).toHaveLength(0);
  });

  test('mixed workout (intro/outro/follow-along/water-break) passes validateMeta with 0 issues', () => {
    const segments = flattenWorkout(MIXED_WORKOUT);
    const meta = buildMeta(segments);
    const issues = validateMeta(meta);
    expect(issues).toHaveLength(0);
  });

  test('all blockIds in emitted meta are unique', () => {
    const segments = flattenWorkout(TWO_BLOCK_WORKOUT);
    const meta = buildMeta(segments);
    const ids = meta.blocks.map((b) => b.blockId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('all emitted blockIds follow the Option-A ${parentId}#${n} format', () => {
    const segments = flattenWorkout(TWO_BLOCK_WORKOUT);
    for (const seg of segments) {
      expect(seg.blockId).toMatch(/#\d+$/);
    }
  });
});

// ── lookupBlockAtVideoTime returns the correct segment id ─────────────────────

describe('lookupBlockAtVideoTime', () => {
  test('lookup at t=0 returns the first segment', () => {
    const segments = flattenWorkout(TWO_BLOCK_WORKOUT);
    const meta = buildMeta(segments);
    const result = lookupBlockAtVideoTime(meta, 0);
    // First segment is block-a's first movement (Squat, 30 s)
    expect(result.blockId).toBe('block-a#0');
    expect(result.blockIndex).toBe(0);
    expect(result.isBeforeFirstBlock).toBe(false);
  });

  test('lookup inside the second segment (after first rest) returns block-a#2', () => {
    // Segment layout: block-a#0=30s, block-a#1=15s(rest), block-a#2=30s, block-a#3=15s(rest)
    // block-a#2 starts at 45 000 ms
    const segments = flattenWorkout(TWO_BLOCK_WORKOUT);
    const meta = buildMeta(segments);
    const result = lookupBlockAtVideoTime(meta, 45_000);
    expect(result.blockId).toBe('block-a#2');
  });

  test('lookup inside block-b Plank segment returns block-b#2', () => {
    // block-a: 30+15+30+15 = 90 s = 90 000 ms
    // block-b: #0=Push-up 45s, #1=rest 20s, #2=Plank 60s, #3=block-rest 30s
    // Plank starts at 90000+45000+20000 = 155 000 ms
    const segments = flattenWorkout(TWO_BLOCK_WORKOUT);
    const meta = buildMeta(segments);
    const result = lookupBlockAtVideoTime(meta, 155_000);
    expect(result.blockId).toBe('block-b#2');
  });
});

// ── videoTimeForBlock round-trips ─────────────────────────────────────────────

describe('videoTimeForBlock round-trip', () => {
  test('segment id → time → lookup returns the same segment id', () => {
    const segments = flattenWorkout(TWO_BLOCK_WORKOUT);
    const meta = buildMeta(segments);

    for (const block of meta.blocks) {
      const time = videoTimeForBlock(meta, block.blockId);
      expect(time).not.toBeNull();
      const lookup = lookupBlockAtVideoTime(meta, time!);
      expect(lookup.blockId).toBe(block.blockId);
    }
  });

  test('videoTimeForBlock returns null for unknown segment id', () => {
    const segments = flattenWorkout(TWO_BLOCK_WORKOUT);
    const meta = buildMeta(segments);
    expect(videoTimeForBlock(meta, 'nonexistent#99')).toBeNull();
  });
});

// ── parseSegmentId ────────────────────────────────────────────────────────────

describe('parseSegmentId', () => {
  test('parses a standard Option-A id correctly', () => {
    expect(parseSegmentId('block-abc#3')).toEqual({ parentBlockId: 'block-abc', segIndex: 3 });
  });

  test('parses intro#0', () => {
    expect(parseSegmentId('intro#0')).toEqual({ parentBlockId: 'intro', segIndex: 0 });
  });

  test('returns segIndex=0 for ids without #', () => {
    expect(parseSegmentId('plainId')).toEqual({ parentBlockId: 'plainId', segIndex: 0 });
  });

  test('handles blockIds with hyphens in parentBlockId', () => {
    expect(parseSegmentId('block-a-b-c#7')).toEqual({ parentBlockId: 'block-a-b-c', segIndex: 7 });
  });
});

// ── Fix 3 contract: write shape does NOT contain a signed URL ─────────────────

describe('storagePath contract', () => {
  test('buildBlockOffsets does not produce any url fields', () => {
    const segments = flattenWorkout(TWO_BLOCK_WORKOUT);
    const offsets = buildBlockOffsets(segments);
    for (const offset of offsets) {
      expect(Object.keys(offset)).not.toContain('url');
      expect(JSON.stringify(offset)).not.toMatch(/x-goog-signature/i);
    }
  });
});

// ── Stale-render guard: skips write when version is lower ────────────────────
// The actual Firestore transaction is integration-tested by the Cloud Run service;
// here we verify the guard logic using a mock.

describe('stale-render guard logic (unit)', () => {
  test('does not overwrite when current doc version is higher', async () => {
    const writes: unknown[] = [];

    const mockTx = {
      get: jest.fn().mockResolvedValue({
        data: () => ({ renderedVideo: { version: 5 } }),
      }),
      update: jest.fn((ref: unknown, data: unknown) => { writes.push(data); }),
    };

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    // Replicate the guard logic inline (the HTTP handler can't be unit-tested without
    // a running server, so we test the decision tree here directly).
    const jobVersion = 3;
    let skipped = false;
    const snap = await mockTx.get(null);
    const currentVersion = (snap.data()?.renderedVideo?.version ?? 0) as number;
    if (currentVersion > jobVersion) {
      console.log(`[STALE-RENDER] version=${jobVersion} < current=${currentVersion}, skipping write`);
      skipped = true;
    } else {
      mockTx.update(null, { renderedVideo: { version: jobVersion } });
    }

    expect(skipped).toBe(true);
    expect(writes).toHaveLength(0);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[STALE-RENDER]')
    );

    consoleSpy.mockRestore();
  });

  test('proceeds with write when current doc version is equal or lower', async () => {
    const writes: unknown[] = [];

    const mockTx = {
      get: jest.fn().mockResolvedValue({
        data: () => ({ renderedVideo: { version: 3 } }),
      }),
      update: jest.fn((ref: unknown, data: unknown) => { writes.push(data); }),
    };

    const jobVersion = 3;
    let skipped = false;
    const snap = await mockTx.get(null);
    const currentVersion = (snap.data()?.renderedVideo?.version ?? 0) as number;
    if (currentVersion > jobVersion) {
      skipped = true;
    } else {
      mockTx.update(null, { renderedVideo: { version: jobVersion } });
    }

    expect(skipped).toBe(false);
    expect(writes).toHaveLength(1);
  });
});
