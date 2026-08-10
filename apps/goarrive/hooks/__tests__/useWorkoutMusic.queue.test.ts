/**
 * Tests for the useWorkoutMusic pure queue helpers.
 *
 * Guards against:
 *  - non-deterministic queue order (coach and member must hear the same
 *    songs in the same order on the same workout)
 *  - repeats inside a pool pass (the no-repeat guarantee)
 *  - disliked tracks leaking into the queue, or dislike-filtering reshuffling
 *    the order of the remaining tracks
 */

import {
  buildMusicQueue,
  hashSeed,
  indicesForStyle,
  mulberry32,
  parseTrackId,
  toTrackId,
} from '../useWorkoutMusic.helpers';

const POOL = 24;

describe('buildMusicQueue — deterministic no-repeat order', () => {
  test('same seed produces the identical order every time', () => {
    const a = buildMusicQueue({ poolSize: POOL, seed: 'workoutA:edm' });
    const b = buildMusicQueue({ poolSize: POOL, seed: 'workoutA:edm' });
    expect(a).toEqual(b);
  });

  test('covers every pool index exactly once', () => {
    const q = buildMusicQueue({ poolSize: POOL, seed: 'workoutA:edm' });
    expect(q).toHaveLength(POOL);
    expect(new Set(q).size).toBe(POOL);
    expect([...q].sort((x, y) => x - y)).toEqual(Array.from({ length: POOL }, (_, i) => i));
  });

  test('different workouts get different orders for the same style', () => {
    const a = buildMusicQueue({ poolSize: POOL, seed: 'workoutA:edm' });
    const b = buildMusicQueue({ poolSize: POOL, seed: 'workoutB:edm' });
    expect(a).not.toEqual(b);
  });

  test('different styles get different orders for the same workout', () => {
    const a = buildMusicQueue({ poolSize: POOL, seed: 'workoutA:edm' });
    const b = buildMusicQueue({ poolSize: POOL, seed: 'workoutA:house' });
    expect(a).not.toEqual(b);
  });

  test('excluded (disliked) indices never appear', () => {
    const excluded = [0, 5, 17];
    const q = buildMusicQueue({ poolSize: POOL, seed: 'workoutA:edm', excludedIndices: excluded });
    expect(q).toHaveLength(POOL - excluded.length);
    for (const i of excluded) expect(q).not.toContain(i);
  });

  test('exclusion filters the base order without reshuffling the rest', () => {
    // Critical for the "same music" guarantee: when one listener has an extra
    // personal dislike, everyone else's relative order must be unaffected.
    const base = buildMusicQueue({ poolSize: POOL, seed: 'workoutA:edm' });
    const excluded = [3, 9];
    const filtered = buildMusicQueue({ poolSize: POOL, seed: 'workoutA:edm', excludedIndices: excluded });
    expect(filtered).toEqual(base.filter((i) => !excluded.includes(i)));
  });

  test('everything excluded yields an empty queue', () => {
    const all = Array.from({ length: POOL }, (_, i) => i);
    expect(buildMusicQueue({ poolSize: POOL, seed: 'x', excludedIndices: all })).toEqual([]);
  });
});

describe('trackId helpers', () => {
  test('toTrackId/parseTrackId round-trip', () => {
    const id = toTrackId('edm', 3);
    expect(id).toBe('edm/3');
    expect(parseTrackId(id)).toEqual({ style: 'edm', index: 3 });
  });

  test('parseTrackId rejects garbage', () => {
    expect(parseTrackId('garbage')).toBeNull();
    expect(parseTrackId('edm/')).toBeNull();
    expect(parseTrackId('/3')).toBeNull();
    expect(parseTrackId('EDM/3')).toBeNull(); // style keys are lowercase
    expect(parseTrackId('edm/3/extra')).toBeNull();
  });

  test('indicesForStyle pulls only the matching style', () => {
    expect(indicesForStyle(['edm/3', 'house/0', 'edm/11', 'bogus'], 'edm')).toEqual([3, 11]);
    expect(indicesForStyle([], 'edm')).toEqual([]);
  });
});

describe('seed primitives', () => {
  test('hashSeed is stable and case-sensitive', () => {
    expect(hashSeed('workoutA:edm')).toBe(hashSeed('workoutA:edm'));
    expect(hashSeed('workoutA:edm')).not.toBe(hashSeed('workouta:edm'));
  });

  test('mulberry32 yields a deterministic sequence in [0, 1)', () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    for (let i = 0; i < 10; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
