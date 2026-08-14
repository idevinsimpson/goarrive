import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  resolveRenderedVideoForPlayback,
  type ResolvedRenderedVideoPlaybackMeta,
} from '../../utils/resolveRenderedVideoForPlayback';
import { useRenderedVideoPlayback } from '../useRenderedVideoPlayback';
import {
  useResolvedRenderedVideoPlayback,
  type UseResolvedRenderedVideoPlaybackParams,
} from '../useResolvedRenderedVideoPlayback';

jest.mock('../../utils/resolveRenderedVideoForPlayback', () => ({
  resolveRenderedVideoForPlayback: jest.fn(),
}));

jest.mock('../useRenderedVideoPlayback', () => ({
  useRenderedVideoPlayback: jest.fn(() => ({
    state: {
      currentBlockId: null,
      currentBlockIndex: -1,
      blockOffsetMs: 0,
      videoTimeMs: 0,
      isPlaying: false,
      mode: 'normal',
    },
    seekToBlock: jest.fn(),
    skipForward: jest.fn(),
    skipBackward: jest.fn(),
  })),
}));

const mockResolve = resolveRenderedVideoForPlayback as jest.MockedFunction<
  typeof resolveRenderedVideoForPlayback
>;
const mockPlayback = useRenderedVideoPlayback as jest.MockedFunction<
  typeof useRenderedVideoPlayback
>;

const resolvedMeta: ResolvedRenderedVideoPlaybackMeta = {
  status: 'ready',
  storagePath: 'gs://goarrive-staging/rendered-videos/workout-1/v2/source-hash.mp4',
  sourceHash: 'source-hash',
  version: 2,
  durationMs: 20_000,
  blocks: [
    { blockId: 'segment:one', startMs: 0, endMs: 10_000 },
    { blockId: 'segment:two', startMs: 10_000, endMs: 20_000 },
  ],
  url: 'https://storage.example.test/short-lived-workout.mp4',
  expiresAt: Date.now() + 15 * 60 * 1000,
};

function baseParams(
  overrides: Partial<UseResolvedRenderedVideoPlaybackParams> = {},
): UseResolvedRenderedVideoPlaybackParams {
  return {
    resolveInput: { workoutId: 'workout-1', assignmentId: 'assignment-1' },
    videoRef: { current: null },
    mode: 'normal',
    authoritativeBlockId: 'segment:one',
    authoritativeBlockOffsetMs: 0,
    authoritativeIsPlaying: false,
    ...overrides,
  };
}

function everyPlaybackCallHasNullMeta(): boolean {
  return mockPlayback.mock.calls.every(([params]) => params.meta === null);
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useResolvedRenderedVideoPlayback', () => {
  it('keeps playback inactive until the resolver returns valid metadata', async () => {
    let resolveRequest: ((meta: ResolvedRenderedVideoPlaybackMeta) => void) | null = null;
    mockResolve.mockImplementation(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));

    const { result } = renderHook(() => useResolvedRenderedVideoPlayback(baseParams()));

    expect(result.current.resolutionStatus).toBe('resolving');
    expect(result.current.isContinuousVideoActive).toBe(false);
    expect(mockPlayback).toHaveBeenLastCalledWith(expect.objectContaining({ meta: null }));

    await act(async () => {
      resolveRequest!(resolvedMeta);
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.resolutionStatus).toBe('ready'));
    expect(result.current.isContinuousVideoActive).toBe(true);
    expect(result.current.resolvedMeta).toBe(resolvedMeta);
    expect(mockPlayback).toHaveBeenLastCalledWith(expect.objectContaining({ meta: resolvedMeta }));
  });

  it('treats an authorization rejection as unavailable and never activates playback', async () => {
    const denied = Object.assign(new Error('permission denied'), {
      code: 'functions/permission-denied',
    });
    mockResolve.mockRejectedValue(denied);

    const { result } = renderHook(() => useResolvedRenderedVideoPlayback(baseParams()));

    await waitFor(() => expect(result.current.resolutionStatus).toBe('unavailable'));
    expect(result.current.resolutionErrorCode).toBe('unauthorized');
    expect(result.current.resolutionError).toBe(denied);
    expect(result.current.isContinuousVideoActive).toBe(false);
    expect(everyPlaybackCallHasNullMeta()).toBe(true);
  });

  it('rejects a response with no HTTPS URL and keeps the segment-player fallback', async () => {
    mockResolve.mockResolvedValue({ ...resolvedMeta, url: '' });

    const { result } = renderHook(() => useResolvedRenderedVideoPlayback(baseParams()));

    await waitFor(() => expect(result.current.resolutionStatus).toBe('error'));
    expect(result.current.resolutionErrorCode).toBe('invalid-response');
    expect(result.current.resolvedMeta).toBeNull();
    expect(result.current.isContinuousVideoActive).toBe(false);
    expect(everyPlaybackCallHasNullMeta()).toBe(true);
  });

  it('surfaces an operational resolver failure without activating playback', async () => {
    const failure = new Error('callable unavailable');
    mockResolve.mockRejectedValue(failure);

    const { result } = renderHook(() => useResolvedRenderedVideoPlayback(baseParams()));

    await waitFor(() => expect(result.current.resolutionStatus).toBe('error'));
    expect(result.current.resolutionErrorCode).toBe('resolver-error');
    expect(result.current.resolutionError).toBe(failure);
    expect(everyPlaybackCallHasNullMeta()).toBe(true);
  });

  it('drops old-workout metadata if an earlier request resolves late', async () => {
    const pending = new Map<string, (meta: ResolvedRenderedVideoPlaybackMeta) => void>();
    mockResolve.mockImplementation(({ workoutId }) => new Promise((resolve) => {
      pending.set(workoutId, resolve);
    }));

    const { result, rerender } = renderHook(
      (params: UseResolvedRenderedVideoPlaybackParams) =>
        useResolvedRenderedVideoPlayback(params),
      { initialProps: baseParams() },
    );

    rerender(baseParams({
      resolveInput: { workoutId: 'workout-2', assignmentId: 'assignment-2' },
    }));

    await act(async () => {
      pending.get('workout-1')!({ ...resolvedMeta, url: 'https://example.test/old.mp4' });
      await Promise.resolve();
    });

    expect(result.current.resolutionStatus).toBe('resolving');
    expect(result.current.resolvedMeta).toBeNull();
    expect(everyPlaybackCallHasNullMeta()).toBe(true);

    const currentMeta = {
      ...resolvedMeta,
      url: 'https://example.test/current.mp4',
    };
    await act(async () => {
      pending.get('workout-2')!(currentMeta);
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.resolutionStatus).toBe('ready'));
    expect(result.current.resolvedMeta).toEqual(currentMeta);
    expect(mockPlayback).toHaveBeenLastCalledWith(expect.objectContaining({ meta: currentMeta }));
  });

  it('deactivates before expiry, refreshes, and ignores a stale refresh response', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-14T10:00:00.000Z'));

    let resolveRefresh: ((meta: ResolvedRenderedVideoPlaybackMeta) => void) | null = null;
    const firstMeta = {
      ...resolvedMeta,
      url: 'https://example.test/first.mp4',
      expiresAt: Date.now() + 60_000,
    };
    const currentMeta = {
      ...resolvedMeta,
      url: 'https://example.test/current.mp4',
      expiresAt: Date.now() + 15 * 60 * 1000,
    };
    mockResolve
      .mockResolvedValueOnce(firstMeta)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveRefresh = resolve;
      }))
      .mockResolvedValueOnce(currentMeta);

    const { result, rerender, unmount } = renderHook(
      (params: UseResolvedRenderedVideoPlaybackParams) =>
        useResolvedRenderedVideoPlayback(params),
      { initialProps: baseParams() },
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.resolutionStatus).toBe('ready');
    expect(result.current.resolvedMeta).toBe(firstMeta);

    await act(async () => {
      jest.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    expect(mockResolve).toHaveBeenCalledTimes(2);
    expect(result.current.resolutionStatus).toBe('resolving');
    expect(result.current.resolvedMeta).toBeNull();
    expect(result.current.isContinuousVideoActive).toBe(false);

    rerender(baseParams({
      resolveInput: { workoutId: 'workout-2', assignmentId: 'assignment-2' },
    }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockResolve).toHaveBeenCalledTimes(3);
    expect(result.current.resolutionStatus).toBe('ready');
    expect(result.current.resolvedMeta).toBe(currentMeta);

    await act(async () => {
      resolveRefresh!({
        ...firstMeta,
        url: 'https://example.test/stale-refresh.mp4',
        expiresAt: Date.now() + 15 * 60 * 1000,
      });
      await Promise.resolve();
    });
    expect(result.current.resolvedMeta).toBe(currentMeta);
    expect(mockPlayback).toHaveBeenLastCalledWith(expect.objectContaining({ meta: currentMeta }));
    unmount();
  });

  it('does not resolve or activate when explicitly disabled', () => {
    const { result } = renderHook(() => useResolvedRenderedVideoPlayback(
      baseParams({ enabled: false }),
    ));

    expect(mockResolve).not.toHaveBeenCalled();
    expect(result.current.resolutionStatus).toBe('disabled');
    expect(result.current.isContinuousVideoActive).toBe(false);
    expect(everyPlaybackCallHasNullMeta()).toBe(true);
  });
});
