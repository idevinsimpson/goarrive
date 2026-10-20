/**
 * THE NATIVE ENGINE ADAPTER (pure: no React, no native module, no clock).
 *
 * The native camera (modules/wsf-pose-camera) sends one `onPose` event per
 * analysed frame with RAW MediaPipe landmarks. This file turns that event into
 * the frozen counter's `PoseFrame`, through the SAME `mapPerson` the web
 * engine uses (engine.ts), so the frozen session receives exactly the nine
 * counting keypoints and the visual-only points ride beside them.
 *
 * WHAT IT GUARANTEES
 *  - Timestamps in ms. Android's camera clock is ns (ImageInfo.timestamp); it
 *    is divided by 1e6 here. The unit is REQUIRED (both native sides send it);
 *    an event without one is dropped, never guessed. A value LABELLED ms above
 *    NS_GUARD is a mislabelled ns clock and is dropped too.
 *  - Strictly increasing timestamps. A repeated or older frame is DROPPED,
 *    never re-timed: a duplicate must never reach the session (it would be an
 *    `outOfOrder` interruption there), and nothing is fabricated.
 *  - Unmirrored 0..1 coordinates. Both native sides analyse the unmirrored
 *    frame; if an event ever says `mirrored: true`, x is flipped back here.
 *    Mirroring is for display only (the preview and the overlay).
 *  - Visibility always present on what reaches the counter. A missing or
 *    negative native visibility becomes "not reported", which `mapBlazePose`
 *    turns into 0: such a point can never make the member look ready.
 *  - At most NATIVE_MAX_POSES people, as engine.ts asks of MediaPipe
 *    (numPoses 3; the lock needs ≥ 2 to see bystanders). A frame with nobody
 *    in it is kept, as an empty frame, so tracking loss is seen as loss.
 *  - `aspect` = upright width / height, as web's videoWidth / videoHeight.
 *    The lock measures distances with it, so a frame without a usable size is
 *    dropped rather than given a guessed aspect.
 */
import type {
  CameraErrorPayload,
  CameraInterruptedPayload,
  CameraReadyPayload,
  PoseEventPayload,
} from '../../modules/wsf-pose-camera/src/WsfPoseCamera.types';
import type { PoseFrame } from './types';
import { mapPerson, type RawLandmark } from './visual';

/** engine.ts creates the web estimator with numPoses 3; the native sides use the same. */
export const NATIVE_MAX_POSES = 3;
/** BlazePose topology: 33 landmarks of [x, y, visibility]. */
export const BLAZEPOSE_LANDMARKS = 33;
export const VALUES_PER_LANDMARK = 3;
/** ≈ 31.7 years in ms. No camera clock in ms gets here, so an 'ms' value above it is a mislabelled clock. */
export const NS_GUARD = 1e12;

export type FrameDrop = 'invalid' | 'duplicate' | 'outOfOrder';
export type FrameResult = { ok: true; frame: PoseFrame } | { ok: false; drop: FrameDrop };

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** The event's camera time in ms, or null when it cannot be trusted. */
export function timestampMsOf(event: unknown): number | null {
  if (!isObject(event)) return null;
  const t = event.timestamp;
  if (!finite(t) || t < 0) return null;
  const unit = event.timestampUnit;
  if (unit === 'ns') return t / 1e6;
  if (unit === 'ms') return t > NS_GUARD ? null : t;
  return null;
}

/** Raw people (BlazePose lists) from the flat native arrays, unmirrored, capped at NATIVE_MAX_POSES. */
export function rawPeople(event: unknown): RawLandmark[][] {
  if (!isObject(event) || !Array.isArray(event.people)) return [];
  const mirrored = event.mirrored === true;
  const out: RawLandmark[][] = [];
  for (const person of event.people) {
    if (out.length >= NATIVE_MAX_POSES) break;
    if (!Array.isArray(person)) continue;
    const raw: RawLandmark[] = [];
    const n = Math.min(BLAZEPOSE_LANDMARKS, Math.floor(person.length / VALUES_PER_LANDMARK));
    for (let i = 0; i < n; i += 1) {
      const x = person[i * VALUES_PER_LANDMARK];
      const y = person[i * VALUES_PER_LANDMARK + 1];
      const v = person[i * VALUES_PER_LANDMARK + 2];
      const lm: RawLandmark = { x: finite(x) ? (mirrored ? 1 - x : x) : Number.NaN, y: finite(y) ? y : Number.NaN };
      if (finite(v) && v >= 0) lm.visibility = v;
      raw.push(lm);
    }
    out.push(raw);
  }
  return out;
}

/**
 * One native event → one PoseFrame, given the last timestamp (ms) that was
 * accepted in this run (null at the start of a run). Pure.
 */
export function toPoseFrame(event: unknown, lastTimestampMs: number | null): FrameResult {
  const ms = timestampMsOf(event);
  if (ms === null || !isObject(event)) return { ok: false, drop: 'invalid' };
  const { width, height } = event;
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return { ok: false, drop: 'invalid' };
  if (!Array.isArray(event.people)) return { ok: false, drop: 'invalid' };
  if (lastTimestampMs !== null) {
    if (ms === lastTimestampMs) return { ok: false, drop: 'duplicate' };
    if (ms < lastTimestampMs) return { ok: false, drop: 'outOfOrder' };
  }
  const poses = rawPeople(event).map((raw) => mapPerson(raw));
  return { ok: true, frame: { timestampMs: ms, poses, aspect: width / height } };
}

/** Per-run gate: remembers the last accepted timestamp and counts what it dropped (for the dev HUD). */
export class NativeFrameGate {
  private last: number | null = null;
  readonly stats = { accepted: 0, invalid: 0, duplicate: 0, outOfOrder: 0 };

  get lastTimestampMs(): number | null {
    return this.last;
  }

  accept(event: unknown): FrameResult {
    const r = toPoseFrame(event, this.last);
    if (r.ok) {
      this.last = r.frame.timestampMs;
      this.stats.accepted += 1;
    } else {
      this.stats[r.drop] += 1;
    }
    return r;
  }
}

// ── The seam between the native controller and the native preview view ──────

/** What the preview view should do now: open the camera for `runId`, or release it. */
export interface NativeCameraBinding {
  active: boolean;
  runId: number;
}

/** Implemented by controller.native.ts; the preview (NativeCameraPreview.native.tsx) talks to it. */
export interface NativeCameraHost {
  subscribeBinding(fn: (binding: NativeCameraBinding) => void): () => void;
  handleReady(payload: CameraReadyPayload): void;
  handlePose(payload: PoseEventPayload): void;
  handleError(payload: CameraErrorPayload): void;
  handleInterrupted(payload: CameraInterruptedPayload): void;
}

export function isNativeCameraHost(x: unknown): x is NativeCameraHost {
  if (!isObject(x)) return false;
  return ['subscribeBinding', 'handleReady', 'handlePose', 'handleError', 'handleInterrupted'].every(
    (k) => typeof (x as Record<string, unknown>)[k] === 'function',
  );
}
