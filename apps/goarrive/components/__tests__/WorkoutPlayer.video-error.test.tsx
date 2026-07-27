/**
 * Regression tests for WorkoutPlayer video-layer error handling.
 *
 * Guards against:
 *  - Unhandled exceptions when a video layer reports a decode/network error
 *  - Stall detection silently swallowing errors without a console.warn
 *  - The stall watchdog firing a false positive when position IS advancing
 */

import {
  handleVideoLayerPlaybackStatus,
  nextStallRecoveryAction,
  STALL_RECOVERY_THROTTLE_MS,
  type StallRecoveryState,
} from '../WorkoutPlayer.helpers';
import { vi } from 'vitest';

const LAYER_URL = 'https://storage.example.com/squat.mp4';

describe('handleVideoLayerPlaybackStatus — error path', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
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
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
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

describe('nextStallRecoveryAction — escalation ladder', () => {
  test('escalates nudge → remount → remount → fail across throttle windows', () => {
    let state: StallRecoveryState | undefined;
    let now = 10_000;
    const step = () => {
      const result = nextStallRecoveryAction(state, now);
      state = result.state;
      now += STALL_RECOVERY_THROTTLE_MS;
      return result.action;
    };

    expect(step()).toBe('nudge');
    expect(step()).toBe('remount');
    expect(step()).toBe('remount');
    expect(step()).toBe('fail');
  });

  test('first stall on a fresh URL acts immediately (no throttle)', () => {
    expect(nextStallRecoveryAction(undefined, 0).action).toBe('nudge');
  });

  test('waits (no escalation) inside the throttle window', () => {
    const first = nextStallRecoveryAction(undefined, 10_000);
    const tooSoon = nextStallRecoveryAction(first.state, 10_000 + STALL_RECOVERY_THROTTLE_MS - 1);
    expect(tooSoon.action).toBe('wait');
    expect(tooSoon.state.attempts).toBe(1);
  });

  test('recovery restarts from nudge after the caller resets state on progress', () => {
    let state: StallRecoveryState | undefined;
    let result = nextStallRecoveryAction(state, 10_000);
    result = nextStallRecoveryAction(result.state, 10_000 + STALL_RECOVERY_THROTTLE_MS);
    expect(result.action).toBe('remount');

    // Playback advanced → caller deletes the per-URL state. Next stall
    // starts the ladder over instead of escalating straight to fail.
    expect(nextStallRecoveryAction(undefined, 60_000).action).toBe('nudge');
  });
});
