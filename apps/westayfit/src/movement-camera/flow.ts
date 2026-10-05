/**
 * MOVE-CAMERA-NATIVE-PORT-1 — THE CAMERA SQUAT FLOW, AS PURE RULES.
 *
 * Everything the camera screen decides lives here, with no React, DOM, camera
 * or engine: who may enter it, when the member is ready, the automatic 3-2-1,
 * the GO baseline, pause banking, Finish and the adjust bounds. The screen
 * feeds frames and a clock and renders what this returns.
 *
 * THE COUNT STARTS AT GO. The session counts from the moment the member is
 * locked, but the set only counts what happens after GO: the session's reps at
 * GO are the baseline, and the set is `banked + max(0, reps − baseline)`.
 * Squatting before the countdown ends never reaches the member's number.
 *
 * VISUALS NEVER COUNT. Each incoming pose is copied down to KEYPOINTS before
 * the session sees it; the visual-only points (ears, elbows, wrists) are kept
 * in a side table keyed by that copy and are read back only to draw the body
 * guide for the locked subject.
 *
 * THE RESULT IS AN ESTIMATE. Finish returns `source: 'camera-estimate'`,
 * `verified: false`. It is a number the member reviews and may change; it is
 * never a contribution until the existing review is confirmed.
 */
import { isFullBody } from './geometry';
import { MovementSession, type SessionConfig, type SessionSnapshot } from './session';
import { KEYPOINTS, type CameraFrame, type Pose, type VisualPose } from './types';

// ── Settings ────────────────────────────────────────────────────────────────

export interface MoveCameraSettings {
  /** Automatically count squats with the camera. */
  cameraCounter: boolean;
  /** Show the body guide while counting. Subordinate: no effect when the counter is off. */
  stickFigure: boolean;
}

export const DEFAULT_MOVE_CAMERA_SETTINGS: MoveCameraSettings = Object.freeze({
  cameraCounter: true,
  stickFigure: true,
});

/** Anything missing or not a boolean reads as the default (ON). */
export function moveCameraSettingsOf(raw: unknown): MoveCameraSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    cameraCounter: typeof r.cameraCounter === 'boolean' ? r.cameraCounter : DEFAULT_MOVE_CAMERA_SETTINGS.cameraCounter,
    stickFigure: typeof r.stickFigure === 'boolean' ? r.stickFigure : DEFAULT_MOVE_CAMERA_SETTINGS.stickFigure,
  };
}

// ── Entry ───────────────────────────────────────────────────────────────────

/** Movements the camera counter is proven for. Exact unit match only. */
export const CAMERA_MOVEMENTS: readonly string[] = Object.freeze(['squats']);

export function isCameraMovement(unit: string | null | undefined): boolean {
  return CAMERA_MOVEMENTS.includes((unit ?? '').trim().toLowerCase().replace(/\s+/g, ' '));
}

export interface CameraEntryInput {
  settings: MoveCameraSettings;
  unit: string | null | undefined;
  /** "Start moving" (live) as opposed to logging something already done. */
  mode: 'start' | 'already';
  /** A resumed, pending, unknown or confirmed attempt keeps its existing recovery. */
  resumed: boolean;
  /** The runtime can actually run the counter (web with a camera). Native fails closed. */
  supported: boolean;
}

export function cameraEntryAllowed(i: CameraEntryInput): boolean {
  return i.supported && i.settings.cameraCounter && !i.resumed && i.mode === 'start' && isCameraMovement(i.unit);
}

// ── Adjust ──────────────────────────────────────────────────────────────────

export const ADJUST_MAX = 500;

export function clampReps(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(ADJUST_MAX, Math.round(n))) : 0;
}

// ── Countdown ───────────────────────────────────────────────────────────────

export const COUNTDOWN_MS = 3000;
export const FULL_BODY_STABLE_MS = 600;

export type CountdownState =
  | { phase: 'acquiring' }
  | { phase: 'countdown'; startedAt: number }
  | { phase: 'counting' };

export const ACQUIRING: CountdownState = Object.freeze({ phase: 'acquiring' });

export interface CountdownStep {
  state: CountdownState;
  /** 3, 2 or 1 while counting down; null otherwise. */
  display: number | null;
  /** True on the one step where the countdown completes. */
  go: boolean;
}

/** Losing readiness at any point before GO returns to acquisition. */
export function stepCountdown(state: CountdownState, ready: boolean, now: number): CountdownStep {
  if (state.phase === 'counting') return { state, display: null, go: false };
  if (!ready) return { state: ACQUIRING, display: null, go: false };
  if (state.phase === 'acquiring') {
    return { state: { phase: 'countdown', startedAt: now }, display: 3, go: false };
  }
  const elapsed = now - state.startedAt;
  if (elapsed >= COUNTDOWN_MS) return { state: { phase: 'counting' }, display: null, go: true };
  return { state, display: Math.max(1, 3 - Math.floor(elapsed / 1000)), go: false };
}

// ── The set ─────────────────────────────────────────────────────────────────

export type CameraSetPhase = 'acquiring' | 'counting' | 'finished';

export interface CameraEstimate {
  estimatedReps: number;
  source: 'camera-estimate';
  verified: false;
}

export interface CameraView {
  phase: CameraSetPhase;
  /** The member's number for this set: zero until GO, then reps after GO plus anything banked. */
  setReps: number;
  locked: boolean;
  fullBody: boolean;
  ready: boolean;
  /** The locked subject's counting pose, for the body guide. Null unless locked. */
  subject: Pose | null;
  /** The locked subject's visual-only points, for the body guide. Never counted. */
  subjectVisual: VisualPose | null;
}

/** Copy a pose down to the counting keypoints. Nothing else survives. */
export function countingPose(pose: Pose): Pose {
  const out: Pose = {};
  const src = pose as Record<string, unknown>;
  for (const k of KEYPOINTS) {
    const p = src[k] as Pose[typeof k];
    if (p) out[k] = { x: p.x, y: p.y, visibility: p.visibility };
  }
  return out;
}

export class CameraSquatSet {
  private readonly session: MovementSession;
  private phase: CameraSetPhase = 'acquiring';
  private baseline = 0;
  private banked = 0;
  private fullSince: number | null = null;
  private lastT = -Infinity;
  private snap: SessionSnapshot;
  private visualOf = new WeakMap<Pose, VisualPose>();

  constructor(config: SessionConfig = {}) {
    this.session = new MovementSession(config);
    this.snap = this.session.snapshot;
  }

  update(frame: CameraFrame): CameraView {
    if (this.phase === 'finished') return this.view();
    const visualOf = new WeakMap<Pose, VisualPose>();
    const poses = frame.poses.map((p, i) => {
      const c = countingPose(p);
      const v = frame.visuals?.[i];
      if (v) visualOf.set(c, v);
      return c;
    });
    this.visualOf = visualOf;
    this.snap = this.session.update({ timestampMs: frame.timestampMs, poses, aspect: frame.aspect });
    if (Number.isFinite(frame.timestampMs) && frame.timestampMs > this.lastT) this.lastT = frame.timestampMs;
    const full = this.snap.lockState === 'locked' && !!this.snap.subject && isFullBody(this.snap.subject);
    if (!full) this.fullSince = null;
    else if (this.fullSince === null) this.fullSince = this.lastT;
    return this.view();
  }

  /** Locked, the whole body in view, and held for FULL_BODY_STABLE_MS. */
  isReady(): boolean {
    return (
      this.phase === 'acquiring' &&
      this.snap.lockState === 'locked' &&
      this.fullSince !== null &&
      this.lastT - this.fullSince >= FULL_BODY_STABLE_MS
    );
  }

  /** GO. Refused unless ready; the session's reps right now become the baseline. */
  beginSet(): boolean {
    if (!this.isReady()) return false;
    this.baseline = this.snap.reps;
    this.phase = 'counting';
    return true;
  }

  get setReps(): number {
    return this.phase === 'counting' ? this.banked + Math.max(0, this.snap.reps - this.baseline) : this.banked;
  }

  /**
   * The camera stopped mid-set (background, failure). What was counted is
   * kept; the member must be acquired again and counted down again.
   */
  pause(): void {
    if (this.phase === 'finished') return;
    this.banked = this.setReps;
    this.phase = 'acquiring';
    this.baseline = 0;
    this.fullSince = null;
    this.lastT = -Infinity;
    this.session.reset();
    this.snap = this.session.snapshot;
  }

  /** Freeze the number. Further frames change nothing. */
  finish(): CameraEstimate {
    const estimatedReps = clampReps(this.setReps);
    this.banked = estimatedReps;
    this.phase = 'finished';
    return { estimatedReps, source: 'camera-estimate', verified: false };
  }

  view(): CameraView {
    const locked = this.snap.lockState === 'locked';
    const subject = locked ? this.snap.subject : null;
    return {
      phase: this.phase,
      setReps: this.setReps,
      locked,
      fullBody: !!subject && isFullBody(subject),
      ready: this.isReady(),
      subject,
      subjectVisual: subject ? this.visualOf.get(subject) ?? null : null,
    };
  }
}

// ── Copy ────────────────────────────────────────────────────────────────────

export type CameraStatus = 'starting' | 'live' | 'paused' | 'failed';

/** The one plain line under the count. Null when nothing needs saying. */
export function cameraCue(i: {
  status: CameraStatus;
  countingNow: boolean;
  countdown: number | null;
  locked: boolean;
  fullBody: boolean;
}): string | null {
  if (i.status !== 'live') return i.status === 'starting' ? 'Starting camera…' : null;
  if (i.countingNow) return i.locked ? null : 'Step back into view';
  if (i.countdown !== null) return 'Get ready';
  if (!i.locked || !i.fullBody) return 'Step back so I can see you';
  return 'Stand tall — getting ready';
}
