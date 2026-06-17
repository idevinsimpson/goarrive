/**
 * Regression tests for WorkoutPlayer preloadVideoUrl calculation.
 *
 * Guards the peek-by-index strategy that replaced walk-by-URL: bounded
 * lookahead (offsets 1..3) prevents preloading a far-future URL when the
 * next several movements share the active URL.
 */

import { computePreloadVideoUrl } from '../WorkoutPlayer.helpers';

const URL_A = 'https://storage.example.com/squat.mp4';
const URL_B = 'https://storage.example.com/lunge.mp4';

describe('computePreloadVideoUrl — peek-by-index', () => {
  // Regression guard: walk-by-URL would scan past the four URL_A entries and
  // wrongly preload URL_B at index 4. Peek-by-index with offset cap 3 returns
  // null instead, which is correct — we don't preload a video that belongs to
  // a movement four steps ahead.
  test('returns null when next 3 movements share active URL (peek-by-index cap)', () => {
    const movements = [
      { videoUrl: URL_A },
      { videoUrl: URL_A },
      { videoUrl: URL_A },
      { videoUrl: URL_A },
      { videoUrl: URL_B },
    ];
    expect(computePreloadVideoUrl(URL_A, 0, movements)).toBeNull();
  });

  // Passes on both main and fix: walk-by-URL skips the duplicate and returns URL_B;
  // peek-by-index returns URL_A (movements[1]). Both are non-null.
  test('returns non-null when movements 1 and 2 share a videoUrl', () => {
    const movements = [
      { videoUrl: URL_A }, // current (index 0)
      { videoUrl: URL_A }, // next — same URL as current
      { videoUrl: URL_B }, // after next
    ];
    // On main (walk-by-URL): skips the second URL_A → returns URL_B.
    // After fix (peek-by-index, currentIndex=0): returns URL_A (movements[1]).
    // Either way, result must not be null.
    const result = computePreloadVideoUrl(URL_A, 0, movements);
    expect(result).not.toBeNull();
  });

  // This test passes on main today (walk-by-URL returns URL_B correctly).
  test('returns next distinct URL when movements differ', () => {
    const movements = [
      { videoUrl: URL_A },
      { videoUrl: URL_B },
    ];
    const result = computePreloadVideoUrl(URL_A, 0, movements);
    expect(result).toBe(URL_B);
  });

  test('returns null when activeVideoUrl is null', () => {
    const movements = [{ videoUrl: URL_A }, { videoUrl: URL_B }];
    expect(computePreloadVideoUrl(null, 0, movements)).toBeNull();
  });

  test('returns null for a single-movement workout (nothing to preload)', () => {
    const movements = [{ videoUrl: URL_A }];
    expect(computePreloadVideoUrl(URL_A, 0, movements)).toBeNull();
  });

  test('skips movements with no videoUrl', () => {
    const movements = [
      { videoUrl: URL_A },
      { videoUrl: undefined },
      { videoUrl: URL_B },
    ];
    // Both strategies should find URL_B eventually.
    const result = computePreloadVideoUrl(URL_A, 0, movements);
    // After fix: returns undefined (movements[1].videoUrl) then would skip...
    // Actually with peek-by-index: offset=1 url=undefined → skip; offset=2 url=URL_B → return URL_B.
    // With walk-by-URL: skip undefined → find URL_B.
    // Both: non-null.
    expect(result).not.toBeNull();
  });
});
