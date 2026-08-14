import {
  clampVideoTime,
  lookupBlockAtVideoTime,
  nextBlockAfter,
  previousBlockBefore,
  RenderedVideoMeta,
  videoTimeForBlock,
} from './renderedVideoOffsetMap';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const emptyMeta: RenderedVideoMeta = {
  url: 'https://example.com/workout.mp4',
  durationMs: 0,
  version: 1,
  status: 'ready',
  blocks: [],
};

const singleBlock: RenderedVideoMeta = {
  url: 'https://example.com/workout.mp4',
  durationMs: 30000,
  version: 1,
  status: 'ready',
  blocks: [{ blockId: 'b1', startMs: 0, endMs: 30000 }],
};

// Three adjacent blocks: b1 0-10s, b2 10-25s, b3 25-60s
const multiBlock: RenderedVideoMeta = {
  url: 'https://example.com/workout.mp4',
  durationMs: 60000,
  version: 1,
  status: 'ready',
  blocks: [
    { blockId: 'b1', startMs: 0,     endMs: 10000 },
    { blockId: 'b2', startMs: 10000, endMs: 25000 },
    { blockId: 'b3', startMs: 25000, endMs: 60000 },
  ],
};

// ---------------------------------------------------------------------------
// lookupBlockAtVideoTime — empty blocks
// ---------------------------------------------------------------------------

describe('lookupBlockAtVideoTime — empty blocks', () => {
  it('returns sentinel values when blocks array is empty', () => {
    const result = lookupBlockAtVideoTime(emptyMeta, 5000);
    expect(result.blockId).toBe('');
    expect(result.blockIndex).toBe(-1);
    expect(result.blockOffsetMs).toBe(0);
    expect(result.isBeforeFirstBlock).toBe(true);
    expect(result.isAfterLastBlock).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// lookupBlockAtVideoTime — single block
// ---------------------------------------------------------------------------

describe('lookupBlockAtVideoTime — single block', () => {
  it('returns the block at the start', () => {
    const r = lookupBlockAtVideoTime(singleBlock, 0);
    expect(r.blockId).toBe('b1');
    expect(r.blockIndex).toBe(0);
    expect(r.blockOffsetMs).toBe(0);
    expect(r.isBeforeFirstBlock).toBe(false);
    expect(r.isAfterLastBlock).toBe(false);
  });

  it('returns the block mid-block', () => {
    const r = lookupBlockAtVideoTime(singleBlock, 15000);
    expect(r.blockId).toBe('b1');
    expect(r.blockOffsetMs).toBe(15000);
    expect(r.isBeforeFirstBlock).toBe(false);
    expect(r.isAfterLastBlock).toBe(false);
  });

  it('flags isAfterLastBlock at exact endMs', () => {
    const r = lookupBlockAtVideoTime(singleBlock, 30000);
    expect(r.blockId).toBe('b1');
    expect(r.isAfterLastBlock).toBe(true);
    expect(r.blockOffsetMs).toBe(30000); // full block duration
  });

  it('flags isBeforeFirstBlock for negative time', () => {
    const r = lookupBlockAtVideoTime(singleBlock, -1);
    expect(r.blockId).toBe('b1');
    expect(r.isBeforeFirstBlock).toBe(true);
    expect(r.blockOffsetMs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// lookupBlockAtVideoTime — multi-block
// ---------------------------------------------------------------------------

describe('lookupBlockAtVideoTime — multi-block', () => {
  it('resolves exact startMs of b1', () => {
    const r = lookupBlockAtVideoTime(multiBlock, 0);
    expect(r.blockId).toBe('b1');
    expect(r.blockIndex).toBe(0);
    expect(r.blockOffsetMs).toBe(0);
  });

  it('resolves mid-block time inside b1', () => {
    const r = lookupBlockAtVideoTime(multiBlock, 5000);
    expect(r.blockId).toBe('b1');
    expect(r.blockOffsetMs).toBe(5000);
    expect(r.isBeforeFirstBlock).toBe(false);
    expect(r.isAfterLastBlock).toBe(false);
  });

  it('resolves exact startMs of b2 (boundary: belongs to b2, not b1)', () => {
    const r = lookupBlockAtVideoTime(multiBlock, 10000);
    expect(r.blockId).toBe('b2');
    expect(r.blockIndex).toBe(1);
    expect(r.blockOffsetMs).toBe(0);
  });

  it('resolves mid-block time inside b2', () => {
    const r = lookupBlockAtVideoTime(multiBlock, 17500);
    expect(r.blockId).toBe('b2');
    expect(r.blockOffsetMs).toBe(7500);
  });

  it('resolves exact startMs of b3 (boundary: belongs to b3, not b2)', () => {
    const r = lookupBlockAtVideoTime(multiBlock, 25000);
    expect(r.blockId).toBe('b3');
    expect(r.blockIndex).toBe(2);
    expect(r.blockOffsetMs).toBe(0);
  });

  it('resolves mid-block time inside b3', () => {
    const r = lookupBlockAtVideoTime(multiBlock, 40000);
    expect(r.blockId).toBe('b3');
    expect(r.blockOffsetMs).toBe(15000);
  });

  it('flags isBeforeFirstBlock for time before first block start', () => {
    const r = lookupBlockAtVideoTime(multiBlock, -500);
    expect(r.blockId).toBe('b1');
    expect(r.isBeforeFirstBlock).toBe(true);
    expect(r.blockOffsetMs).toBe(0);
  });

  it('flags isAfterLastBlock for time at last block endMs', () => {
    const r = lookupBlockAtVideoTime(multiBlock, 60000);
    expect(r.blockId).toBe('b3');
    expect(r.isAfterLastBlock).toBe(true);
    expect(r.blockOffsetMs).toBe(35000); // b3 duration
  });

  it('flags isAfterLastBlock for time beyond durationMs', () => {
    const r = lookupBlockAtVideoTime(multiBlock, 999999);
    expect(r.isAfterLastBlock).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// videoTimeForBlock
// ---------------------------------------------------------------------------

describe('videoTimeForBlock', () => {
  it('returns startMs for a valid blockId with no offset', () => {
    expect(videoTimeForBlock(multiBlock, 'b2')).toBe(10000);
  });

  it('returns startMs + offset for a valid blockId with offset', () => {
    expect(videoTimeForBlock(multiBlock, 'b2', 5000)).toBe(15000);
  });

  it('returns null for an unknown blockId', () => {
    expect(videoTimeForBlock(multiBlock, 'does-not-exist')).toBeNull();
  });

  it('clamps blockOffsetMs exceeding block duration to block end', () => {
    // b1 duration = 10000ms; passing 99999 should clamp to endMs
    expect(videoTimeForBlock(multiBlock, 'b1', 99999)).toBe(10000);
  });

  it('clamps negative blockOffsetMs to startMs', () => {
    expect(videoTimeForBlock(multiBlock, 'b1', -5000)).toBe(0);
  });

  it('defaults blockOffsetMs to 0 when omitted', () => {
    expect(videoTimeForBlock(singleBlock, 'b1')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// clampVideoTime
// ---------------------------------------------------------------------------

describe('clampVideoTime', () => {
  it('returns the value when inside range', () => {
    expect(clampVideoTime(multiBlock, 30000)).toBe(30000);
  });

  it('clamps negative values to 0', () => {
    expect(clampVideoTime(multiBlock, -1000)).toBe(0);
  });

  it('clamps values greater than durationMs to durationMs', () => {
    expect(clampVideoTime(multiBlock, 100000)).toBe(60000);
  });

  it('returns 0 for 0 when durationMs is 0', () => {
    expect(clampVideoTime(emptyMeta, 0)).toBe(0);
  });

  it('returns durationMs exactly at boundary', () => {
    expect(clampVideoTime(multiBlock, 60000)).toBe(60000);
  });
});

// ---------------------------------------------------------------------------
// nextBlockAfter
// ---------------------------------------------------------------------------

describe('nextBlockAfter', () => {
  it('returns second block when given first', () => {
    const next = nextBlockAfter(multiBlock, 'b1');
    expect(next?.blockId).toBe('b2');
  });

  it('returns third block when given second', () => {
    const next = nextBlockAfter(multiBlock, 'b2');
    expect(next?.blockId).toBe('b3');
  });

  it('returns null for the last block', () => {
    expect(nextBlockAfter(multiBlock, 'b3')).toBeNull();
  });

  it('returns null for an unknown blockId', () => {
    expect(nextBlockAfter(multiBlock, 'unknown')).toBeNull();
  });

  it('returns null when blocks array is empty', () => {
    expect(nextBlockAfter(emptyMeta, 'b1')).toBeNull();
  });

  it('returns null for the only block in a single-block workout', () => {
    expect(nextBlockAfter(singleBlock, 'b1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// previousBlockBefore
// ---------------------------------------------------------------------------

describe('previousBlockBefore', () => {
  it('returns second block when given third', () => {
    const prev = previousBlockBefore(multiBlock, 'b3');
    expect(prev?.blockId).toBe('b2');
  });

  it('returns first block when given second', () => {
    const prev = previousBlockBefore(multiBlock, 'b2');
    expect(prev?.blockId).toBe('b1');
  });

  it('returns null for the first block', () => {
    expect(previousBlockBefore(multiBlock, 'b1')).toBeNull();
  });

  it('returns null for an unknown blockId', () => {
    expect(previousBlockBefore(multiBlock, 'unknown')).toBeNull();
  });

  it('returns null when blocks array is empty', () => {
    expect(previousBlockBefore(emptyMeta, 'b1')).toBeNull();
  });

  it('returns null for the only block in a single-block workout', () => {
    expect(previousBlockBefore(singleBlock, 'b1')).toBeNull();
  });
});
