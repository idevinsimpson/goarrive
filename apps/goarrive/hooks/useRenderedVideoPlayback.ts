/// <reference lib="dom" />
import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  clampVideoTime,
  lookupBlockAtVideoTime,
  videoTimeForBlock,
} from '../utils/renderedVideoOffsetMap';
import type { RenderedVideoMeta } from '../utils/renderedVideoOffsetMap';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PlaybackMode = 'normal' | 'pip';

export interface RenderedVideoPlaybackState {
  currentBlockId: string | null;
  currentBlockIndex: number;
  blockOffsetMs: number;
  videoTimeMs: number;
  isPlaying: boolean;
  mode: PlaybackMode;
}

export interface UseRenderedVideoPlaybackParams {
  meta: RenderedVideoMeta | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  mode: PlaybackMode;
  /** State-machine truth for normal mode. Ignored in PiP mode (video is boss). */
  authoritativeBlockId: string | null;
  authoritativeBlockOffsetMs: number;
  authoritativeIsPlaying: boolean;
  /** Called from PiP mode when the <video> element diverges from state. */
  onVideoDrivenPositionChange?: (blockId: string, blockOffsetMs: number) => void;
  onVideoDrivenPlayStateChange?: (isPlaying: boolean) => void;
  /** Called once when mode transitions pip → normal. */
  onPipExitReconcile?: (blockId: string, blockOffsetMs: number) => void;
}

export interface UseRenderedVideoPlaybackApi {
  state: RenderedVideoPlaybackState;
  seekToBlock: (blockId: string, blockOffsetMs?: number) => void;
  skipForward: (deltaMs?: number) => void;
  skipBackward: (deltaMs?: number) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEEK_DRIFT_THRESHOLD_MS = 250;

const NULL_STATE: RenderedVideoPlaybackState = {
  currentBlockId: null,
  currentBlockIndex: -1,
  blockOffsetMs: 0,
  videoTimeMs: 0,
  isPlaying: false,
  mode: 'normal',
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useRenderedVideoPlayback(
  params: UseRenderedVideoPlaybackParams,
): UseRenderedVideoPlaybackApi {
  const {
    meta,
    videoRef,
    mode,
    authoritativeBlockId,
    authoritativeBlockOffsetMs,
    authoritativeIsPlaying,
    onVideoDrivenPositionChange,
    onVideoDrivenPlayStateChange,
    onPipExitReconcile,
  } = params;

  // Increment this to force a re-render without useState.
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);

  // The externally visible state. Mutated imperatively; re-renders triggered by forceUpdate().
  const stateRef = useRef<RenderedVideoPlaybackState>({ ...NULL_STATE, mode });

  // Keep latest meta accessible inside event listener closures without re-attaching them.
  const metaRef = useRef<RenderedVideoMeta | null>(meta);
  useEffect(() => { metaRef.current = meta; });

  // Stable callback refs so PiP listeners never need re-attachment due to callback identity churn.
  const onPositionChangeRef = useRef(onVideoDrivenPositionChange);
  const onPlayStateChangeRef = useRef(onVideoDrivenPlayStateChange);
  const onPipExitRef = useRef(onPipExitReconcile);
  useEffect(() => { onPositionChangeRef.current = onVideoDrivenPositionChange; });
  useEffect(() => { onPlayStateChangeRef.current = onVideoDrivenPlayStateChange; });
  useEffect(() => { onPipExitRef.current = onPipExitReconcile; });

  // Track previous authoritative blockId for block-transition detection.
  const prevAuthBlockIdRef = useRef<string | null>(null);

  // Track previous mode to detect transitions.
  const prevModeRef = useRef<PlaybackMode>(mode);

  // Last position emitted by PiP listeners — dedup guard.
  const lastPipBlockIdRef = useRef<string | null>(null);
  const lastPipBlockOffsetMsRef = useRef<number>(0);

  const isMetaReady = meta !== null && meta.status === 'ready';

  // -------------------------------------------------------------------------
  // Mode transition: pip → normal
  // -------------------------------------------------------------------------
  // Runs before the normal-mode sync effect so onPipExitReconcile is dispatched
  // while the consumer can update its state machine before the next normal sync.
  useEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = mode;

    if (prev !== 'pip' || mode !== 'normal') return;

    const video = videoRef.current;
    const m = metaRef.current;
    if (!video || !m || m.status !== 'ready') return;

    const currentMs = video.currentTime * 1000;
    const lookup = lookupBlockAtVideoTime(m, currentMs);
    onPipExitRef.current?.(lookup.blockId, lookup.blockOffsetMs);
  }, [mode, videoRef]);

  // -------------------------------------------------------------------------
  // Normal mode: sync video element to the authoritative state machine
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (mode !== 'normal') return;

    if (!isMetaReady) {
      stateRef.current = { ...NULL_STATE, mode: 'normal' };
      forceUpdate();
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    const blockId = authoritativeBlockId;

    // Null blockId (pre/post-workout warmup, cooldown, or rep-based gap) → pause and hold.
    if (blockId === null) {
      video.pause();
      stateRef.current = { ...NULL_STATE, mode: 'normal' };
      prevAuthBlockIdRef.current = null;
      forceUpdate();
      return;
    }

    // Reverse-lookup: block id → absolute video time.
    const expectedMs = videoTimeForBlock(meta!, blockId, authoritativeBlockOffsetMs);
    if (expectedMs === null) {
      // Block not in the offset map (rep-based block or future gap) → pause and hold.
      video.pause();
      stateRef.current = { ...NULL_STATE, mode: 'normal' };
      prevAuthBlockIdRef.current = blockId;
      forceUpdate();
      return;
    }

    // Guard: outside rendered timeline → pause and hold.
    const lookup = lookupBlockAtVideoTime(meta!, expectedMs);
    if (lookup.isBeforeFirstBlock || lookup.isAfterLastBlock) {
      video.pause();
      stateRef.current = { ...NULL_STATE, mode: 'normal' };
      prevAuthBlockIdRef.current = blockId;
      forceUpdate();
      return;
    }

    const currentMs = video.currentTime * 1000;
    const drift = Math.abs(currentMs - expectedMs);
    const blockChanged = blockId !== prevAuthBlockIdRef.current;

    // Seek when: block transitioned OR drift exceeds threshold.
    // Do NOT seek sub-threshold drift — per-tick writes cause iOS Safari stutter.
    if (blockChanged || drift >= SEEK_DRIFT_THRESHOLD_MS) {
      video.currentTime = expectedMs / 1000;
    }

    // Mirror play/pause.
    if (authoritativeIsPlaying) {
      video.play();
    } else {
      video.pause();
    }

    stateRef.current = {
      currentBlockId: blockId,
      currentBlockIndex: lookup.blockIndex,
      blockOffsetMs: authoritativeBlockOffsetMs,
      videoTimeMs: expectedMs,
      isPlaying: authoritativeIsPlaying,
      mode: 'normal',
    };

    prevAuthBlockIdRef.current = blockId;
    forceUpdate();
  }, [
    mode,
    isMetaReady,
    meta,
    authoritativeBlockId,
    authoritativeBlockOffsetMs,
    authoritativeIsPlaying,
    videoRef,
  ]);

  // -------------------------------------------------------------------------
  // PiP mode: mirror video element → state, emit position callbacks
  // -------------------------------------------------------------------------
  // Listeners are attached once when entering PiP and removed on exit.
  // metaRef / callback refs are used inside handlers so they always read the
  // latest values without needing the listeners to be re-attached.
  useEffect(() => {
    if (mode !== 'pip') return;

    const video = videoRef.current;
    if (!video) return;

    function handlePositionEvent() {
      const v = videoRef.current;
      const m = metaRef.current;
      if (!v || !m || m.status !== 'ready') return;

      const currentMs = v.currentTime * 1000;
      const lookup = lookupBlockAtVideoTime(m, currentMs);
      const { blockId, blockOffsetMs } = lookup;

      // Capture previous values BEFORE any mutation for accurate comparison.
      const prevBlockId = lastPipBlockIdRef.current;
      const prevBlockOffsetMs = lastPipBlockOffsetMsRef.current;

      // Update the ref continuously so state.videoTimeMs is always fresh.
      stateRef.current = {
        ...stateRef.current,
        currentBlockId: blockId || null,
        currentBlockIndex: lookup.blockIndex,
        blockOffsetMs,
        videoTimeMs: currentMs,
        mode: 'pip',
      };

      // Emit callback and advance dedup tracking whenever position meaningfully changed.
      if (blockId !== prevBlockId || blockOffsetMs !== prevBlockOffsetMs) {
        lastPipBlockIdRef.current = blockId;
        lastPipBlockOffsetMsRef.current = blockOffsetMs;
        onPositionChangeRef.current?.(blockId, blockOffsetMs);
      }

      // Re-render only on block-boundary crossing to avoid per-ms re-render perf kills.
      if (blockId !== prevBlockId) {
        forceUpdate();
      }
    }

    function handlePlay() {
      onPlayStateChangeRef.current?.(true);
      stateRef.current = { ...stateRef.current, isPlaying: true, mode: 'pip' };
      forceUpdate();
    }

    function handlePause() {
      onPlayStateChangeRef.current?.(false);
      stateRef.current = { ...stateRef.current, isPlaying: false, mode: 'pip' };
      forceUpdate();
    }

    video.addEventListener('timeupdate', handlePositionEvent);
    video.addEventListener('seeked', handlePositionEvent);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    return () => {
      video.removeEventListener('timeupdate', handlePositionEvent);
      video.removeEventListener('seeked', handlePositionEvent);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, [mode, videoRef]);

  // -------------------------------------------------------------------------
  // Imperative helpers
  // -------------------------------------------------------------------------

  const seekToBlock = useCallback(
    (blockId: string, blockOffsetMs = 0) => {
      if (mode !== 'normal') return; // PiP: video is boss, consumer must not seek
      if (!isMetaReady || !meta) return;
      const video = videoRef.current;
      if (!video) return;
      const expectedMs = videoTimeForBlock(meta, blockId, blockOffsetMs);
      if (expectedMs === null) return;
      video.currentTime = expectedMs / 1000;
    },
    [mode, isMetaReady, meta, videoRef],
  );

  const skipForward = useCallback(
    (deltaMs = 15000) => {
      if (mode !== 'normal') return;
      if (!isMetaReady || !meta) return;
      const video = videoRef.current;
      if (!video) return;
      const currentMs = video.currentTime * 1000;
      video.currentTime = clampVideoTime(meta, currentMs + deltaMs) / 1000;
    },
    [mode, isMetaReady, meta, videoRef],
  );

  const skipBackward = useCallback(
    (deltaMs = 15000) => {
      if (mode !== 'normal') return;
      if (!isMetaReady || !meta) return;
      const video = videoRef.current;
      if (!video) return;
      const currentMs = video.currentTime * 1000;
      video.currentTime = clampVideoTime(meta, currentMs - deltaMs) / 1000;
    },
    [mode, isMetaReady, meta, videoRef],
  );

  return {
    state: stateRef.current,
    seekToBlock,
    skipForward,
    skipBackward,
  };
}
