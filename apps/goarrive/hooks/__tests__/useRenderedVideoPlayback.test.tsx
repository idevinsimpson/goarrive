/**
 * Tests for useRenderedVideoPlayback — dual-mode playback controller.
 *
 * Covers:
 *  - Cross-contract: multi-segment fixture + validateMeta + offset map + hook
 *  - Normal mode: drift threshold seek logic, block transition, play/pause sync
 *  - PiP mode: video-driven position callbacks, no currentTime writes
 *  - Mode transitions: pip→normal reconcile, normal→pip no-op
 *  - Imperative helpers: seekToBlock, skipForward, skipBackward
 *  - Edge cases: null meta, pending meta, null videoRef
 *  - Listener cleanup on unmount
 */

import { act, renderHook } from '@testing-library/react-native';
import {
  lookupBlockAtVideoTime,
  validateMeta,
  videoTimeForBlock,
} from '../../utils/renderedVideoOffsetMap';
import type { RenderedVideoMeta } from '../../utils/renderedVideoOffsetMap';
import {
  decodeRenderedVideoSegmentIdentity,
  encodeRenderedVideoSegmentIdentity,
  rendererSegmentId,
  resolveRenderedVideoSegmentIdentity,
} from '../../utils/renderedVideoSegmentIdentity';
import type { RenderedVideoSegmentIdentity } from '../../utils/renderedVideoSegmentIdentity';
import { useRenderedVideoPlayback } from '../useRenderedVideoPlayback';
import type { UseRenderedVideoPlaybackParams } from '../useRenderedVideoPlayback';

// ---------------------------------------------------------------------------
// Mock video element factory
// ---------------------------------------------------------------------------

type MockVideo = {
  currentTime: number;
  paused: boolean;
  play: jest.Mock;
  pause: jest.Mock;
  addEventListener: jest.Mock;
  removeEventListener: jest.Mock;
  /** Synchronously invoke all registered listeners for this event. */
  _fire: (event: string) => void;
  /** Spy on the currentTime setter. */
  _currentTimeSetter: jest.Mock;
};

function makeMockVideo(initialTimeMs = 0): MockVideo {
  let _currentTime = initialTimeMs / 1000;
  const currentTimeSetter = jest.fn((v: number) => {
    _currentTime = v;
  });
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  const video: Partial<MockVideo> = {
    paused: true,
    play: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn(),
    addEventListener: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    }),
    removeEventListener: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((h) => h !== handler);
      }
    }),
    _fire: (event: string) => {
      if (listeners[event]) [...listeners[event]].forEach((h) => h());
    },
    _currentTimeSetter: currentTimeSetter,
  };

  Object.defineProperty(video, 'currentTime', {
    get: () => _currentTime,
    set: (v: number) => currentTimeSetter(v),
    configurable: true,
  });

  return video as MockVideo;
}

function makeVideoRef(
  video: MockVideo | null,
): React.RefObject<HTMLVideoElement | null> {
  return { current: video as HTMLVideoElement | null };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type RendererFixtureMovement = {
  durationSec: number;
  restAfter: number;
};

type RendererFixtureBlock = {
  id: string;
  movements: RendererFixtureMovement[];
  restDurationSeconds: number;
};

type RendererFixtureSegment = {
  identity: RenderedVideoSegmentIdentity;
  durationMs: number;
};

/** Representative input consumed by PR #262's current flattenWorkout emitter. */
const rendererWorkoutFixture: { blocks: RendererFixtureBlock[] } = {
  blocks: [
    {
      id: 'block-a',
      movements: [
        { durationSec: 30, restAfter: 15 },
        { durationSec: 30, restAfter: 15 },
      ],
      restDurationSeconds: 0,
    },
    {
      id: 'block-b',
      movements: [
        { durationSec: 45, restAfter: 20 },
        { durationSec: 60, restAfter: 0 },
      ],
      restDurationSeconds: 30,
    },
  ],
};

/** Mirrors #262's movement → restAfter → block-rest segment order. */
function emitRendererFixtureSegments(
  workout: { blocks: RendererFixtureBlock[] },
): RendererFixtureSegment[] {
  const segments: RendererFixtureSegment[] = [];

  workout.blocks.forEach((block) => {
    let segmentIndex = 0;
    block.movements.forEach((movement, movementIndex) => {
      segments.push({
        identity: {
          parentBlockId: block.id,
          segmentIndex: segmentIndex++,
          phase: 'movement',
          movementIndex,
        },
        durationMs: movement.durationSec * 1000,
      });

      if (movement.restAfter > 0) {
        segments.push({
          identity: {
            parentBlockId: block.id,
            segmentIndex: segmentIndex++,
            phase: 'rest',
            movementIndex,
          },
          durationMs: movement.restAfter * 1000,
        });
      }
    });

    if (block.restDurationSeconds > 0) {
      segments.push({
        identity: {
          parentBlockId: block.id,
          segmentIndex: segmentIndex++,
          phase: 'rest',
          movementIndex: null,
        },
        durationMs: block.restDurationSeconds * 1000,
      });
    }
  });

  return segments;
}

function buildRendererFixtureMeta(segments: RendererFixtureSegment[]): RenderedVideoMeta {
  let startMs = 0;
  const blocks = segments.map(({ identity, durationMs }) => {
    const block = {
      blockId: rendererSegmentId(identity),
      startMs,
      endMs: startMs + durationMs,
    };
    startMs = block.endMs;
    return block;
  });

  return {
    url: 'https://example.com/workout.mp4',
    durationMs: startMs,
    version: 1,
    status: 'ready',
    blocks,
  };
}

const rendererSegments = emitRendererFixtureSegments(rendererWorkoutFixture);
const rendererSegmentCatalog = rendererSegments.map(({ identity }) => identity);
const rendererDerivedMeta = buildRendererFixtureMeta(rendererSegments);

/** Simple 3-block meta for most other tests. */
const simpleMeta: RenderedVideoMeta = {
  url: 'https://example.com/workout.mp4',
  durationMs: 60000,
  version: 1,
  status: 'ready',
  blocks: [
    { blockId: 'b1', startMs: 0,     endMs: 20000 },
    { blockId: 'b2', startMs: 20000, endMs: 40000 },
    { blockId: 'b3', startMs: 40000, endMs: 60000 },
  ],
};

function baseNormalParams(
  video: MockVideo,
  overrides: Partial<UseRenderedVideoPlaybackParams> = {},
): UseRenderedVideoPlaybackParams {
  return {
    meta: simpleMeta,
    videoRef: makeVideoRef(video),
    mode: 'normal',
    authoritativeBlockId: 'b1',
    authoritativeBlockOffsetMs: 0,
    authoritativeIsPlaying: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Cross-contract: multi-segment fixture
// ---------------------------------------------------------------------------

describe('cross-contract: renderer-derived segments (Phase 2 ↔ Phase 3 ↔ Phase 4)', () => {
  it('validateMeta accepts #262-derived offsets without duplicates or overlap', () => {
    const issues = validateMeta(rendererDerivedMeta);
    expect(issues).toHaveLength(0);
  });

  it('resolves movement and rest segments using #262 wire ids', () => {
    const movement = lookupBlockAtVideoTime(rendererDerivedMeta, 45000);
    expect(movement.blockId).toBe('block-a#2');
    expect(movement.blockOffsetMs).toBe(0);

    const rest = lookupBlockAtVideoTime(rendererDerivedMeta, 35000);
    expect(rest.blockId).toBe('block-a#1');
    expect(rest.blockOffsetMs).toBe(5000);
    expect(resolveRenderedVideoSegmentIdentity(rest.blockId, rendererSegmentCatalog)).toEqual({
      parentBlockId: 'block-a',
      segmentIndex: 1,
      phase: 'rest',
      movementIndex: 0,
    });
  });

  it('retains full player context through player → video → player round trips', () => {
    rendererSegmentCatalog.forEach((identity) => {
      const playerKey = encodeRenderedVideoSegmentIdentity(identity);
      const decodedPlayerIdentity = decodeRenderedVideoSegmentIdentity(playerKey);
      expect(decodedPlayerIdentity).toEqual(identity);

      const blockId = rendererSegmentId(decodedPlayerIdentity!);
      const videoTimeMs = videoTimeForBlock(rendererDerivedMeta, blockId, 0);
      expect(videoTimeMs).not.toBeNull();

      const lookup = lookupBlockAtVideoTime(rendererDerivedMeta, videoTimeMs!);
      const relocatedPlayerIdentity = resolveRenderedVideoSegmentIdentity(
        lookup.blockId,
        rendererSegmentCatalog,
      );
      expect(relocatedPlayerIdentity).toEqual(identity);
      expect(encodeRenderedVideoSegmentIdentity(relocatedPlayerIdentity!)).toBe(playerKey);
    });
  });

  it('videoTimeForBlock uses the renderer segment start plus local offset', () => {
    expect(videoTimeForBlock(rendererDerivedMeta, 'block-a#2', 500)).toBe(45500);
  });

  it('hook seeks across renderer movement/rest boundaries', () => {
    const video = makeMockVideo(29000);
    const videoRef = makeVideoRef(video);

    let params: UseRenderedVideoPlaybackParams = {
      meta: rendererDerivedMeta,
      videoRef,
      mode: 'normal',
      authoritativeBlockId: 'block-a#0',
      authoritativeBlockOffsetMs: 29000,
      authoritativeIsPlaying: false,
    };

    const { rerender } = renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      { initialProps: params },
    );

    video._currentTimeSetter.mockClear();
    params = {
      ...params,
      authoritativeBlockId: 'block-a#1',
      authoritativeBlockOffsetMs: 0,
    };
    rerender(params);

    expect(video._currentTimeSetter).toHaveBeenCalledWith(30);
  });
});

// ---------------------------------------------------------------------------
// Normal mode
// ---------------------------------------------------------------------------

describe('normal mode — drift threshold', () => {
  it('seeks when drift >= 250ms', () => {
    const video = makeMockVideo(0); // currentTime = 0ms
    // authoritativeBlockId = 'b1', offsetMs = 5000 → expectedMs = 5000ms
    // drift = |0 - 5000| = 5000 >= 250 → seek
    renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      {
        initialProps: baseNormalParams(video, {
          authoritativeBlockId: 'b1',
          authoritativeBlockOffsetMs: 5000,
        }),
      },
    );
    expect(video._currentTimeSetter).toHaveBeenCalledWith(5); // 5000ms / 1000
  });

  it('does NOT seek when drift < 250ms and block unchanged', () => {
    const video = makeMockVideo(5000); // currentTime = 5.0s = 5000ms
    let params = baseNormalParams(video, {
      authoritativeBlockId: 'b1',
      authoritativeBlockOffsetMs: 5000,
    });

    const { rerender } = renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      { initialProps: params },
    );

    // First render: blockId changed null→b1 → seeks to 5.0s. Clear mock.
    video._currentTimeSetter.mockClear();

    // Rerender: same blockId, offsetMs = 5100 → expectedMs = 5100ms
    // drift = |5000 - 5100| = 100 < 250 → no seek
    params = { ...params, authoritativeBlockOffsetMs: 5100 };
    rerender(params);

    expect(video._currentTimeSetter).not.toHaveBeenCalled();
  });

  it('always seeks on blockId change regardless of drift', () => {
    // Position video exactly at b2.startMs so drift from b2 offset=0 is 0ms.
    const video = makeMockVideo(20000); // currentTime = 20.0s = 20000ms
    let params = baseNormalParams(video, {
      authoritativeBlockId: 'b1',
      authoritativeBlockOffsetMs: 0,
    });

    const { rerender } = renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      { initialProps: params },
    );

    video._currentTimeSetter.mockClear();

    // Switch to b2 at offset 0 → expectedMs = 20000ms, drift = 0ms
    // But blockId changed b1→b2 → always seeks
    params = { ...params, authoritativeBlockId: 'b2', authoritativeBlockOffsetMs: 0 };
    rerender(params);

    expect(video._currentTimeSetter).toHaveBeenCalledWith(20); // 20000 / 1000
  });
});

describe('normal mode — play/pause sync', () => {
  it('calls play() when authoritativeIsPlaying becomes true', () => {
    const video = makeMockVideo(0);
    renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      {
        initialProps: baseNormalParams(video, { authoritativeIsPlaying: true }),
      },
    );
    expect(video.play).toHaveBeenCalled();
  });

  it('calls pause() when authoritativeIsPlaying is false', () => {
    const video = makeMockVideo(0);
    let params = baseNormalParams(video, { authoritativeIsPlaying: true });

    const { rerender } = renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      { initialProps: params },
    );

    params = { ...params, authoritativeIsPlaying: false };
    rerender(params);

    expect(video.pause).toHaveBeenCalled();
  });

  it('pauses and does NOT seek when authoritativeBlockId is null', () => {
    const video = makeMockVideo(5000);
    renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      {
        initialProps: baseNormalParams(video, {
          authoritativeBlockId: null,
          authoritativeIsPlaying: true,
        }),
      },
    );
    expect(video.pause).toHaveBeenCalled();
    expect(video._currentTimeSetter).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PiP mode
// ---------------------------------------------------------------------------

describe('pip mode — video-driven position callbacks', () => {
  it('timeupdate fires → onVideoDrivenPositionChange called with derived block/offset', () => {
    const video = makeMockVideo(5000); // 5000ms → b1, offset 5000
    const videoRef = makeVideoRef(video);
    const onPositionChange = jest.fn();

    renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      {
        initialProps: {
          meta: simpleMeta,
          videoRef,
          mode: 'pip' as const,
          authoritativeBlockId: null,
          authoritativeBlockOffsetMs: 0,
          authoritativeIsPlaying: false,
          onVideoDrivenPositionChange: onPositionChange,
        },
      },
    );

    act(() => {
      video._fire('timeupdate');
    });

    expect(onPositionChange).toHaveBeenCalledWith('b1', 5000);
  });

  it('seeked fires → onVideoDrivenPositionChange called', () => {
    const video = makeMockVideo(25000); // 25000ms → b2, offset 5000
    const videoRef = makeVideoRef(video);
    const onPositionChange = jest.fn();

    renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      {
        initialProps: {
          meta: simpleMeta,
          videoRef,
          mode: 'pip' as const,
          authoritativeBlockId: null,
          authoritativeBlockOffsetMs: 0,
          authoritativeIsPlaying: false,
          onVideoDrivenPositionChange: onPositionChange,
        },
      },
    );

    act(() => {
      video._fire('seeked');
    });

    expect(onPositionChange).toHaveBeenCalledWith('b2', 5000);
  });

  it('play event fires → onVideoDrivenPlayStateChange(true) called', () => {
    const video = makeMockVideo(0);
    const videoRef = makeVideoRef(video);
    const onPlayState = jest.fn();

    renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      {
        initialProps: {
          meta: simpleMeta,
          videoRef,
          mode: 'pip' as const,
          authoritativeBlockId: null,
          authoritativeBlockOffsetMs: 0,
          authoritativeIsPlaying: false,
          onVideoDrivenPlayStateChange: onPlayState,
        },
      },
    );

    act(() => {
      video._fire('play');
    });

    expect(onPlayState).toHaveBeenCalledWith(true);
  });

  it('pause event fires → onVideoDrivenPlayStateChange(false) called', () => {
    const video = makeMockVideo(0);
    const videoRef = makeVideoRef(video);
    const onPlayState = jest.fn();

    renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      {
        initialProps: {
          meta: simpleMeta,
          videoRef,
          mode: 'pip' as const,
          authoritativeBlockId: null,
          authoritativeBlockOffsetMs: 0,
          authoritativeIsPlaying: false,
          onVideoDrivenPlayStateChange: onPlayState,
        },
      },
    );

    act(() => {
      video._fire('pause');
    });

    expect(onPlayState).toHaveBeenCalledWith(false);
  });

  it('never writes currentTime even when authoritative props change repeatedly', () => {
    const video = makeMockVideo(0);
    const videoRef = makeVideoRef(video);

    let params: UseRenderedVideoPlaybackParams = {
      meta: simpleMeta,
      videoRef,
      mode: 'pip',
      authoritativeBlockId: 'b1',
      authoritativeBlockOffsetMs: 0,
      authoritativeIsPlaying: false,
    };

    const { rerender } = renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      { initialProps: params },
    );

    // Simulate the state machine advancing — hook must NOT propagate these to video in PiP mode.
    params = { ...params, authoritativeBlockId: 'b2', authoritativeBlockOffsetMs: 5000 };
    rerender(params);
    params = { ...params, authoritativeBlockId: 'b3', authoritativeBlockOffsetMs: 2000 };
    rerender(params);

    expect(video._currentTimeSetter).not.toHaveBeenCalled();
  });

  it('bounds ordinary timeupdate callbacks while seeked remains immediate', () => {
    const video = makeMockVideo(5000);
    const videoRef = makeVideoRef(video);
    const onPositionChange = jest.fn();

    renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      {
        initialProps: {
          meta: simpleMeta,
          videoRef,
          mode: 'pip' as const,
          authoritativeBlockId: null,
          authoritativeBlockOffsetMs: 0,
          authoritativeIsPlaying: false,
          onVideoDrivenPositionChange: onPositionChange,
        },
      },
    );

    act(() => {
      video._fire('timeupdate');
      video.currentTime = 5.1;
      video._fire('timeupdate');
      video.currentTime = 5.24;
      video._fire('timeupdate');
    });
    expect(onPositionChange).toHaveBeenCalledTimes(1);

    act(() => {
      video.currentTime = 5.25;
      video._fire('timeupdate');
    });
    expect(onPositionChange).toHaveBeenCalledTimes(2);
    expect(onPositionChange).toHaveBeenLastCalledWith('b1', 5250);

    act(() => {
      video.currentTime = 5.3;
      video._fire('seeked');
    });
    expect(onPositionChange).toHaveBeenCalledTimes(3);
    expect(onPositionChange).toHaveBeenLastCalledWith('b1', 5300);
  });

  it('reattaches listeners when videoRef.current changes under a stable ref', () => {
    const firstVideo = makeMockVideo(5000);
    const secondVideo = makeMockVideo(25000);
    const videoRef = makeVideoRef(firstVideo);
    const onPositionChange = jest.fn();
    const params: UseRenderedVideoPlaybackParams = {
      meta: simpleMeta,
      videoRef,
      mode: 'pip',
      authoritativeBlockId: null,
      authoritativeBlockOffsetMs: 0,
      authoritativeIsPlaying: false,
      onVideoDrivenPositionChange: onPositionChange,
    };

    const { rerender } = renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      { initialProps: params },
    );

    videoRef.current = secondVideo as unknown as HTMLVideoElement;
    rerender(params);

    const removedFromFirst: string[] = firstVideo.removeEventListener.mock.calls.map(
      (call: [string, ...unknown[]]) => call[0],
    );
    expect(removedFromFirst).toEqual(
      expect.arrayContaining(['timeupdate', 'seeked', 'play', 'pause']),
    );

    act(() => {
      firstVideo._fire('timeupdate');
    });
    expect(onPositionChange).not.toHaveBeenCalled();

    act(() => {
      secondVideo._fire('timeupdate');
    });
    expect(onPositionChange).toHaveBeenCalledTimes(1);
    expect(onPositionChange).toHaveBeenCalledWith('b2', 5000);
  });

  it('resets position dedup when re-entering PiP at the same position', () => {
    const video = makeMockVideo(5000);
    const videoRef = makeVideoRef(video);
    const onPositionChange = jest.fn();
    let params: UseRenderedVideoPlaybackParams = {
      meta: simpleMeta,
      videoRef,
      mode: 'pip',
      authoritativeBlockId: 'b1',
      authoritativeBlockOffsetMs: 5000,
      authoritativeIsPlaying: false,
      onVideoDrivenPositionChange: onPositionChange,
    };

    const { rerender } = renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      { initialProps: params },
    );

    act(() => {
      video._fire('timeupdate');
    });
    expect(onPositionChange).toHaveBeenCalledTimes(1);

    params = { ...params, mode: 'normal' };
    rerender(params);
    params = { ...params, mode: 'pip' };
    rerender(params);

    act(() => {
      video._fire('timeupdate');
    });
    expect(onPositionChange).toHaveBeenCalledTimes(2);
    expect(onPositionChange).toHaveBeenLastCalledWith('b1', 5000);
  });

  it('resets position dedup when rendered metadata changes', () => {
    const video = makeMockVideo(5000);
    const videoRef = makeVideoRef(video);
    const onPositionChange = jest.fn();
    let params: UseRenderedVideoPlaybackParams = {
      meta: simpleMeta,
      videoRef,
      mode: 'pip',
      authoritativeBlockId: null,
      authoritativeBlockOffsetMs: 0,
      authoritativeIsPlaying: false,
      onVideoDrivenPositionChange: onPositionChange,
    };

    const { rerender } = renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      { initialProps: params },
    );

    act(() => {
      video._fire('timeupdate');
    });
    expect(onPositionChange).toHaveBeenCalledTimes(1);

    params = { ...params, meta: { ...simpleMeta, version: 2 } };
    rerender(params);
    act(() => {
      video._fire('timeupdate');
    });

    expect(onPositionChange).toHaveBeenCalledTimes(2);
    expect(onPositionChange).toHaveBeenLastCalledWith('b1', 5000);
  });
});

// ---------------------------------------------------------------------------
// Mode transitions
// ---------------------------------------------------------------------------

describe('mode transitions', () => {
  it('normal → pip: onPipExitReconcile is NOT called', () => {
    const video = makeMockVideo(5000);
    const videoRef = makeVideoRef(video);
    const onPipExit = jest.fn();

    let params: UseRenderedVideoPlaybackParams = {
      meta: simpleMeta,
      videoRef,
      mode: 'normal',
      authoritativeBlockId: 'b1',
      authoritativeBlockOffsetMs: 5000,
      authoritativeIsPlaying: false,
      onPipExitReconcile: onPipExit,
    };

    const { rerender } = renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      { initialProps: params },
    );

    params = { ...params, mode: 'pip' };
    rerender(params);

    expect(onPipExit).not.toHaveBeenCalled();
  });

  it('pip → normal: onPipExitReconcile fires once with current video position', () => {
    const video = makeMockVideo(25000); // 25000ms → b2, offset 5000
    const videoRef = makeVideoRef(video);
    const onPipExit = jest.fn();

    let params: UseRenderedVideoPlaybackParams = {
      meta: simpleMeta,
      videoRef,
      mode: 'pip',
      authoritativeBlockId: null,
      authoritativeBlockOffsetMs: 0,
      authoritativeIsPlaying: false,
      onPipExitReconcile: onPipExit,
    };

    const { rerender } = renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      { initialProps: params },
    );

    params = { ...params, mode: 'normal' };
    rerender(params);

    expect(onPipExit).toHaveBeenCalledTimes(1);
    expect(onPipExit).toHaveBeenCalledWith('b2', 5000);
  });

  it('pip → normal: holds video until reconciled authority is observed', () => {
    const video = makeMockVideo(25000);
    video.paused = false;
    const videoRef = makeVideoRef(video);
    const onPipExit = jest.fn();
    const onPlayState = jest.fn();
    let params: UseRenderedVideoPlaybackParams = {
      meta: simpleMeta,
      videoRef,
      mode: 'pip',
      authoritativeBlockId: 'b1',
      authoritativeBlockOffsetMs: 1000,
      authoritativeIsPlaying: false,
      onPipExitReconcile: onPipExit,
      onVideoDrivenPlayStateChange: onPlayState,
    };

    const { rerender } = renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      { initialProps: params },
    );

    params = { ...params, mode: 'normal' };
    rerender(params);

    expect(onPipExit).toHaveBeenCalledWith('b2', 5000);
    expect(onPlayState).toHaveBeenCalledWith(true);
    expect(video._currentTimeSetter).not.toHaveBeenCalled();
    expect(video.pause).not.toHaveBeenCalled();

    params = {
      ...params,
      authoritativeBlockId: 'b2',
      authoritativeBlockOffsetMs: 5000,
    };
    rerender(params);

    expect(video._currentTimeSetter).not.toHaveBeenCalled();
    expect(video.pause).not.toHaveBeenCalled();

    params = {
      ...params,
      authoritativeIsPlaying: true,
    };
    rerender(params);

    expect(video._currentTimeSetter).not.toHaveBeenCalled();
    expect(video.play).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Imperative helpers
// ---------------------------------------------------------------------------

describe('imperative helpers', () => {
  it('seekToBlock in normal mode → hard-seeks video', () => {
    const video = makeMockVideo(0);
    const videoRef = makeVideoRef(video);

    const { result } = renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      { initialProps: baseNormalParams(video) },
    );

    video._currentTimeSetter.mockClear();

    act(() => {
      result.current.seekToBlock('b2', 0);
    });

    // b2.startMs = 20000ms → 20.0s
    expect(video._currentTimeSetter).toHaveBeenCalledWith(20);
  });

  it('seekToBlock in pip mode → no-op (video is boss)', () => {
    const video = makeMockVideo(0);
    const videoRef = makeVideoRef(video);

    const { result } = renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      {
        initialProps: {
          meta: simpleMeta,
          videoRef,
          mode: 'pip' as const,
          authoritativeBlockId: null,
          authoritativeBlockOffsetMs: 0,
          authoritativeIsPlaying: false,
        },
      },
    );

    act(() => {
      result.current.seekToBlock('b1', 0);
    });

    expect(video._currentTimeSetter).not.toHaveBeenCalled();
  });

  it('skipForward(15000) clamps to meta.durationMs', () => {
    const video = makeMockVideo(55000); // 55.0s
    let params = baseNormalParams(video, {
      authoritativeBlockId: 'b3',
      authoritativeBlockOffsetMs: 15000,
    });

    const { result, rerender } = renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      { initialProps: params },
    );

    video._currentTimeSetter.mockClear();

    act(() => {
      result.current.skipForward(15000);
    });

    // 55000 + 15000 = 70000 → clamped to durationMs 60000 → 60.0s
    expect(video._currentTimeSetter).toHaveBeenCalledWith(60);
  });

  it('skipBackward(15000) clamps to 0', () => {
    const video = makeMockVideo(5000); // 5.0s
    let params = baseNormalParams(video, {
      authoritativeBlockId: 'b1',
      authoritativeBlockOffsetMs: 5000,
    });

    const { result, rerender } = renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      { initialProps: params },
    );

    video._currentTimeSetter.mockClear();

    act(() => {
      result.current.skipBackward(15000);
    });

    // 5000 - 15000 = -10000 → clamped to 0 → 0.0s
    expect(video._currentTimeSetter).toHaveBeenCalledWith(0);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases — null / pending meta', () => {
  it('meta === null → state defaults, no seek, no listeners attached', () => {
    const video = makeMockVideo(5000);
    const videoRef = makeVideoRef(video);

    const { result } = renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      {
        initialProps: {
          meta: null,
          videoRef,
          mode: 'normal' as const,
          authoritativeBlockId: 'b1',
          authoritativeBlockOffsetMs: 5000,
          authoritativeIsPlaying: true,
        },
      },
    );

    expect(result.current.state.currentBlockId).toBeNull();
    expect(result.current.state.currentBlockIndex).toBe(-1);
    expect(result.current.state.videoTimeMs).toBe(0);
    expect(video._currentTimeSetter).not.toHaveBeenCalled();
    expect(video.addEventListener).not.toHaveBeenCalled();
  });

  it('meta.status === "pending" → same behavior as null meta', () => {
    const pendingMeta: RenderedVideoMeta = { ...simpleMeta, status: 'pending', blocks: [] };
    const video = makeMockVideo(5000);
    const videoRef = makeVideoRef(video);

    const { result } = renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      {
        initialProps: {
          meta: pendingMeta,
          videoRef,
          mode: 'normal' as const,
          authoritativeBlockId: 'b1',
          authoritativeBlockOffsetMs: 5000,
          authoritativeIsPlaying: true,
        },
      },
    );

    expect(result.current.state.currentBlockId).toBeNull();
    expect(result.current.state.videoTimeMs).toBe(0);
    expect(video._currentTimeSetter).not.toHaveBeenCalled();
  });

  it('videoRef.current === null → no crash, no listeners attached', () => {
    const videoRef = makeVideoRef(null);

    expect(() => {
      renderHook(
        (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
        {
          initialProps: {
            meta: simpleMeta,
            videoRef,
            mode: 'normal' as const,
            authoritativeBlockId: 'b1',
            authoritativeBlockOffsetMs: 0,
            authoritativeIsPlaying: false,
          },
        },
      );
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Listener cleanup
// ---------------------------------------------------------------------------

describe('listener cleanup', () => {
  it('unmounting in pip mode removes timeupdate, seeked, play, and pause listeners', () => {
    const video = makeMockVideo(0);
    const videoRef = makeVideoRef(video);

    const { unmount } = renderHook(
      (p: UseRenderedVideoPlaybackParams) => useRenderedVideoPlayback(p),
      {
        initialProps: {
          meta: simpleMeta,
          videoRef,
          mode: 'pip' as const,
          authoritativeBlockId: null,
          authoritativeBlockOffsetMs: 0,
          authoritativeIsPlaying: false,
        },
      },
    );

    unmount();

    const removedEvents: string[] = video.removeEventListener.mock.calls.map(
      (c: [string, ...unknown[]]) => c[0],
    );
    expect(removedEvents).toContain('timeupdate');
    expect(removedEvents).toContain('seeked');
    expect(removedEvents).toContain('play');
    expect(removedEvents).toContain('pause');
  });
});
