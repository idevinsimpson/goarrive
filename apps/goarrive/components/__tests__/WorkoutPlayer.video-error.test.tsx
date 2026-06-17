/**
 * Regression tests for WorkoutPlayer video-layer error handling.
 *
 * Guards against:
 *  - Unhandled exceptions when a video layer reports a decode/network error
 *  - Stall detection silently swallowing errors without a console.warn
 *  - The stall watchdog firing a false positive when position IS advancing
 */

import { handleVideoLayerPlaybackStatus } from '../WorkoutPlayer.helpers';

const LAYER_URL = 'https://storage.example.com/squat.mp4';

describe('handleVideoLayerPlaybackStatus — error path', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('fires console.warn on decode error without throwing', () => {
    const posMap = new Map<string, { pos: number; ts: number }>();
    expect(() =>
      handleVideoLayerPlaybackStatus(
        { isLoaded: true, error: 'mock decoding error' },
        LAYER_URL,
        posMap,
      ),
    ).not.toThrow();

    expect(warnSpy).toHaveBeenCalledWith(
      '[WorkoutPlayer] video error',
      expect.objectContaining({ url: LAYER_URL }),
    );
  });

  test('does not warn when status is not yet loaded', () => {
    const posMap = new Map<string, { pos: number; ts: number }>();
    handleVideoLayerPlaybackStatus({ isLoaded: false }, LAYER_URL, posMap);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('does not warn on null / undefined status', () => {
    const posMap = new Map<string, { pos: number; ts: number }>();
    handleVideoLayerPlaybackStatus(null, LAYER_URL, posMap);
    handleVideoLayerPlaybackStatus(undefined, LAYER_URL, posMap);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('handleVideoLayerPlaybackStatus — stall detection', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('warns on stall when position is frozen for >= 5 s and shouldPlay is true', () => {
    const posMap = new Map<string, { pos: number; ts: number }>();
    const t0 = 1000;

    // First call — record position at t0.
    handleVideoLayerPlaybackStatus(
      { isLoaded: true, positionMillis: 5000, shouldPlay: true },
      LAYER_URL,
      posMap,
      t0,
    );

    // Same position 5.1 s later — stall.
    handleVideoLayerPlaybackStatus(
      { isLoaded: true, positionMillis: 5000, shouldPlay: true },
      LAYER_URL,
      posMap,
      t0 + 5100,
    );

    expect(warnSpy).toHaveBeenCalledWith(
      '[WorkoutPlayer] video stall detected',
      expect.objectContaining({ url: LAYER_URL }),
    );
  });

  test('does NOT warn when position is advancing (no stall)', () => {
    const posMap = new Map<string, { pos: number; ts: number }>();
    const t0 = 1000;

    handleVideoLayerPlaybackStatus(
      { isLoaded: true, positionMillis: 5000, shouldPlay: true },
      LAYER_URL,
      posMap,
      t0,
    );
    handleVideoLayerPlaybackStatus(
      { isLoaded: true, positionMillis: 5500, shouldPlay: true },
      LAYER_URL,
      posMap,
      t0 + 5100,
    );

    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('does NOT warn on stall when shouldPlay is false (intentionally paused)', () => {
    const posMap = new Map<string, { pos: number; ts: number }>();
    const t0 = 1000;

    handleVideoLayerPlaybackStatus(
      { isLoaded: true, positionMillis: 5000, shouldPlay: false },
      LAYER_URL,
      posMap,
      t0,
    );
    handleVideoLayerPlaybackStatus(
      { isLoaded: true, positionMillis: 5000, shouldPlay: false },
      LAYER_URL,
      posMap,
      t0 + 5100,
    );

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
