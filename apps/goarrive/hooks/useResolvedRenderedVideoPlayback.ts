/// <reference lib="dom" />
import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  resolveRenderedVideoForPlayback,
  type ResolveRenderedVideoPlaybackInput,
  type ResolvedRenderedVideoPlaybackMeta,
} from '../utils/resolveRenderedVideoForPlayback';
import { validateMeta } from '../utils/renderedVideoOffsetMap';
import {
  useRenderedVideoPlayback,
  type UseRenderedVideoPlaybackApi,
  type UseRenderedVideoPlaybackParams,
} from './useRenderedVideoPlayback';

export type RenderedVideoResolutionStatus =
  | 'disabled'
  | 'resolving'
  | 'ready'
  | 'unavailable'
  | 'error';

export type RenderedVideoResolutionErrorCode =
  | 'unauthorized'
  | 'invalid-response'
  | 'resolver-error';

export interface UseResolvedRenderedVideoPlaybackParams
  extends Omit<UseRenderedVideoPlaybackParams, 'meta'> {
  /**
   * Set to null until the caller has a trusted workout/access-proof identity.
   * The segment player remains active while this hook is disabled or resolving.
   */
  resolveInput: ResolveRenderedVideoPlaybackInput | null;
  enabled?: boolean;
}

export interface UseResolvedRenderedVideoPlaybackApi
  extends UseRenderedVideoPlaybackApi {
  resolutionStatus: RenderedVideoResolutionStatus;
  resolutionErrorCode: RenderedVideoResolutionErrorCode | null;
  resolutionError: Error | null;
  resolvedMeta: ResolvedRenderedVideoPlaybackMeta | null;
  /** True only after a current, structurally valid HTTPS response is resolved. */
  isContinuousVideoActive: boolean;
  retryResolution: () => void;
}

interface ResolutionState {
  requestKey: string | null;
  status: RenderedVideoResolutionStatus;
  errorCode: RenderedVideoResolutionErrorCode | null;
  error: Error | null;
  meta: ResolvedRenderedVideoPlaybackMeta | null;
}

const DISABLED_STATE: ResolutionState = {
  requestKey: null,
  status: 'disabled',
  errorCode: null,
  error: null,
  meta: null,
};

const SIGNED_URL_REFRESH_SKEW_MS = 30_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

function resolutionRequestKey(input: ResolveRenderedVideoPlaybackInput): string {
  return JSON.stringify([
    input.workoutId,
    input.assignmentId ?? null,
    input.sessionInstanceId ?? null,
  ]);
}

function errorCodeOf(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function isAuthorizationFailure(error: unknown): boolean {
  const code = errorCodeOf(error);
  return code === 'unauthenticated'
    || code === 'permission-denied'
    || code === 'functions/unauthenticated'
    || code === 'functions/permission-denied';
}

function errorFrom(error: unknown): Error {
  return error instanceof Error ? error : new Error('Rendered video resolution failed');
}

/**
 * Treat the callable response as untrusted at the app boundary. This keeps a
 * missing/expired URL or malformed offset map from activating the video hook.
 */
export function isUsableResolvedRenderedVideoMeta(
  value: unknown,
  now = Date.now(),
): value is ResolvedRenderedVideoPlaybackMeta {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const meta = value as Record<string, unknown>;
  if (
    meta.status !== 'ready'
    || typeof meta.url !== 'string'
    || !meta.url.startsWith('https://')
    || typeof meta.expiresAt !== 'number'
    || !Number.isFinite(meta.expiresAt)
    || meta.expiresAt <= now + SIGNED_URL_REFRESH_SKEW_MS
    || typeof meta.storagePath !== 'string'
    || meta.storagePath.length === 0
    || typeof meta.sourceHash !== 'string'
    || meta.sourceHash.length === 0
    || typeof meta.version !== 'number'
    || !Number.isInteger(meta.version)
    || typeof meta.durationMs !== 'number'
    || !Number.isFinite(meta.durationMs)
    || meta.durationMs < 0
    || !Array.isArray(meta.blocks)
  ) {
    return false;
  }

  const blocksAreStructurallySafe = meta.blocks.every((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const block = value as Record<string, unknown>;
    return typeof block.blockId === 'string'
      && block.blockId.length > 0
      && typeof block.startMs === 'number'
      && Number.isFinite(block.startMs)
      && typeof block.endMs === 'number'
      && Number.isFinite(block.endMs);
  });
  if (!blocksAreStructurallySafe) return false;

  return validateMeta(value as ResolvedRenderedVideoPlaybackMeta).length === 0;
}

/**
 * Resolve the authenticated, short-lived media URL before handing metadata to
 * the continuous-video controller. The wrapped hook is always called (React
 * hook ordering), but receives `meta: null` until resolution succeeds, so the
 * existing segment player remains the safe fallback on every failure path.
 */
export function useResolvedRenderedVideoPlayback(
  params: UseResolvedRenderedVideoPlaybackParams,
): UseResolvedRenderedVideoPlaybackApi {
  const {
    resolveInput,
    enabled = true,
    videoRef,
    mode,
    authoritativeBlockId,
    authoritativeBlockOffsetMs,
    authoritativeIsPlaying,
    onVideoDrivenPositionChange,
    onVideoDrivenPlayStateChange,
    onPipExitReconcile,
  } = params;

  const workoutId = enabled ? resolveInput?.workoutId ?? null : null;
  const assignmentId = enabled ? resolveInput?.assignmentId : undefined;
  const sessionInstanceId = enabled ? resolveInput?.sessionInstanceId : undefined;
  const requestKey = workoutId
    ? resolutionRequestKey({ workoutId, assignmentId, sessionInstanceId })
    : null;
  const [resolution, setResolution] = useReducer(
    (_current: ResolutionState, next: ResolutionState) => next,
    DISABLED_STATE,
  );
  const [retryVersion, retryResolution] = useReducer((value: number) => value + 1, 0);
  const requestSerialRef = useRef(0);

  useEffect(() => {
    const requestSerial = ++requestSerialRef.current;
    if (!requestKey || !workoutId) {
      setResolution(DISABLED_STATE);
      return;
    }

    const input: ResolveRenderedVideoPlaybackInput = {
      workoutId,
      ...(assignmentId === undefined ? {} : { assignmentId }),
      ...(sessionInstanceId === undefined ? {} : { sessionInstanceId }),
    };
    setResolution({
      requestKey,
      status: 'resolving',
      errorCode: null,
      error: null,
      meta: null,
    });

    resolveRenderedVideoForPlayback(input).then(
      (meta) => {
        if (requestSerialRef.current !== requestSerial) return;
        if (!isUsableResolvedRenderedVideoMeta(meta)) {
          setResolution({
            requestKey,
            status: 'error',
            errorCode: 'invalid-response',
            error: new Error('Rendered video resolver returned unusable metadata'),
            meta: null,
          });
          return;
        }
        setResolution({
          requestKey,
          status: 'ready',
          errorCode: null,
          error: null,
          meta,
        });
      },
      (error: unknown) => {
        if (requestSerialRef.current !== requestSerial) return;
        const unauthorized = isAuthorizationFailure(error);
        setResolution({
          requestKey,
          status: unauthorized ? 'unavailable' : 'error',
          errorCode: unauthorized ? 'unauthorized' : 'resolver-error',
          error: errorFrom(error),
          meta: null,
        });
      },
    );

    return () => {
      if (requestSerialRef.current === requestSerial) {
        requestSerialRef.current += 1;
      }
    };
  }, [assignmentId, requestKey, retryVersion, sessionInstanceId, workoutId]);

  // A signed URL must never remain active through its expiry boundary. Move
  // back to the segment-player fallback before expiry, then resolve a fresh
  // URL for the same trusted identity. Cleanup prevents an old timer from
  // refreshing after the workout/access proof changes.
  useEffect(() => {
    if (
      requestKey === null
      || resolution.requestKey !== requestKey
      || resolution.status !== 'ready'
      || resolution.meta === null
    ) {
      return;
    }

    const delayMs = Math.min(
      MAX_TIMEOUT_MS,
      Math.max(0, resolution.meta.expiresAt - Date.now() - SIGNED_URL_REFRESH_SKEW_MS),
    );
    const timer = setTimeout(() => {
      requestSerialRef.current += 1;
      setResolution({
        requestKey,
        status: 'resolving',
        errorCode: null,
        error: null,
        meta: null,
      });
      retryResolution();
    }, delayMs);

    return () => clearTimeout(timer);
  }, [requestKey, resolution]);

  // Never hand metadata from a previous workout/access proof to the player,
  // including the render before the effect above resets its state.
  const resolvedMeta = requestKey !== null
    && resolution.requestKey === requestKey
    && resolution.status === 'ready'
    ? resolution.meta
    : null;

  const playback = useRenderedVideoPlayback({
    meta: resolvedMeta,
    videoRef,
    mode,
    authoritativeBlockId,
    authoritativeBlockOffsetMs,
    authoritativeIsPlaying,
    onVideoDrivenPositionChange,
    onVideoDrivenPlayStateChange,
    onPipExitReconcile,
  });

  const effectiveStatus: RenderedVideoResolutionStatus = requestKey === null
    ? 'disabled'
    : resolution.requestKey === requestKey
      ? resolution.status
      : 'resolving';
  const retry = useCallback(() => retryResolution(), []);

  return {
    ...playback,
    resolutionStatus: effectiveStatus,
    resolutionErrorCode: resolution.requestKey === requestKey ? resolution.errorCode : null,
    resolutionError: resolution.requestKey === requestKey ? resolution.error : null,
    resolvedMeta,
    isContinuousVideoActive: resolvedMeta !== null,
    retryResolution: retry,
  };
}
