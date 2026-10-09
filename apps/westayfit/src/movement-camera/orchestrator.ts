/**
 * Pure (no DOM) orchestration around the FROZEN live counter session.
 *
 * Ported from the owner-accepted reference (Lovable e15b9fa0@1454357,
 * src/integration/rep-counter/orchestrator.ts); only the imports and types are
 * adapted. It only READS the session snapshot; readiness gating and the set
 * baseline are app logic and never feed back into counting. The frozen session
 * is constructed exactly as the reference's live candidate does
 * (makeSessionR1421), so counting behaviour is identical.
 */
import { KEYPOINTS, makeSessionR1421, type FrozenSession, type FrozenSnapshot, type Pose, type PoseFrame } from './frozen';
import type { Landmark } from './types';

export type RepPhase = 'idle' | 'acquiring' | 'ready' | 'counting' | 'finished';
export type CameraStatus = 'off' | 'starting' | 'loadingModel' | 'live' | 'paused' | 'failed';
export type CameraFailure = 'permission' | 'unsupported' | 'playback' | 'model' | 'inference' | 'ended';
export type RepKeypoints = Pose;

export interface RepSetResult {
  estimatedReps: number;
  source: 'camera-estimate';
  verified: false;
}

export interface RepCounterSnapshot {
  phase: RepPhase;
  camera: CameraStatus;
  failure: CameraFailure | null;
  rawRunReps: number;
  setReps: number;
  keypoints: RepKeypoints | null;
  aspect: number;
  locked: boolean;
  armed: boolean;
  fresh: boolean;
  fullBodyVisible: boolean;
  fullBodyStable: boolean;
  readyForCountdown: boolean;
  guidance: string;
}

export interface OrchestratorOptions {
  /** Continuous full-body time required before readyForCountdown (ms). Default 600. */
  fullBodyStableMs?: number;
  /** Minimum keypoint visibility treated as "seen". Default 0.5. */
  minVisibility?: number;
  /** Injected for tests; defaults to the frozen live session. */
  makeSession?: () => FrozenSession;
}

export const DEFAULT_FULL_BODY_STABLE_MS = 600;
const EDGE = 0.02;
const SIDES = [
  ['leftShoulder', 'leftHip', 'leftKnee', 'leftAnkle'],
  ['rightShoulder', 'rightHip', 'rightKnee', 'rightAnkle'],
] as const;

/** Head plus one complete shoulder-hip-knee-ankle chain, all in frame and confidently seen. */
export function isFullBodyVisible(pose: Pose | null, minVis = 0.5): boolean {
  if (!pose) return false;
  const ok = (k: keyof Pose) => {
    const p = pose[k];
    return !!p && p.visibility >= minVis && p.x >= -EDGE && p.x <= 1 + EDGE && p.y >= -EDGE && p.y <= 1 + EDGE;
  };
  return ok('nose') && SIDES.some((chain) => chain.every((k) => ok(k)));
}

function toKeypoints(pose: Pose | null): RepKeypoints | null {
  if (!pose) return null;
  const out: RepKeypoints = {};
  for (const k of KEYPOINTS) { const p = pose[k] as Landmark | undefined; if (p) out[k] = { x: p.x, y: p.y, visibility: p.visibility }; }
  return out;
}

export class RepCounterOrchestrator {
  private session: FrozenSession;
  private readonly makeSession: () => FrozenSession;
  private readonly stableMs: number;
  private readonly minVis: number;
  private phase: RepPhase = 'idle';
  private camera: CameraStatus = 'off';
  private failure: CameraFailure | null = null;
  private baseline = 0;
  private banked = 0;
  private finalReps: number | null = null;
  private fullSince: number | null = null;
  private last: FrozenSnapshot;
  private lastT: number | null = null;
  private aspect = 1;
  private full = false;

  constructor(opts: OrchestratorOptions = {}) {
    this.makeSession = opts.makeSession ?? makeSessionR1421;
    this.stableMs = opts.fullBodyStableMs ?? DEFAULT_FULL_BODY_STABLE_MS;
    this.minVis = opts.minVisibility ?? 0.5;
    this.session = this.makeSession();
    this.last = this.session.snapshot;
  }

  /** Tracked subject pose object (same reference the frozen session selected), for visual-only lookups. */
  subjectPose(): Pose | null { return this.camera === 'live' ? this.last.subject : null; }

  /** Camera run starts: fresh frozen session (startup arm again); banked set reps are kept. */
  beginRun(): void {
    if (this.phase === 'counting') this.banked = this.setRepsNow();
    this.session.reset();
    this.last = this.session.snapshot;
    this.baseline = 0;
    this.fullSince = null; this.full = false; this.lastT = null;
    this.failure = null;
    // Resuming a paused set requires readiness again; the host calls beginSet() to resume (banked kept).
    if (this.phase !== 'finished') this.phase = 'acquiring';
  }

  setCamera(status: CameraStatus, failure: CameraFailure | null = null): void {
    if ((status === 'paused' || status === 'failed' || status === 'off') && this.phase === 'counting') {
      this.banked = this.setRepsNow();
      this.phase = 'acquiring';
    }
    this.camera = status;
    this.failure = failure;
    if (status !== 'live') { this.fullSince = null; this.full = false; }
  }

  /** Feed one pose frame (all detected people; the frozen lock picks the subject). */
  onFrame(frame: PoseFrame): RepCounterSnapshot {
    this.last = this.session.update(frame);
    this.lastT = frame.timestampMs;
    if (frame.aspect) this.aspect = frame.aspect;
    const locked = this.last.lockState === 'locked';
    this.full = locked && isFullBodyVisible(this.last.subject, this.minVis);
    if (this.full) { if (this.fullSince === null) this.fullSince = frame.timestampMs; }
    else this.fullSince = null;
    if (this.phase === 'acquiring' || this.phase === 'ready') this.phase = this.isReady() ? 'ready' : 'acquiring';
    return this.snapshot();
  }

  private isReady(): boolean {
    return this.camera === 'live' && this.last.lockState === 'locked' && this.last.armed
      && this.fullSince !== null && this.lastT !== null && this.lastT - this.fullSince >= this.stableMs;
  }

  private setRepsNow(): number {
    if (this.finalReps !== null) return this.finalReps;
    if (this.phase !== 'counting') return this.banked;
    return this.banked + Math.max(0, this.last.reps - this.baseline);
  }

  /** Call at GO. Returns false (no-op) unless readyForCountdown is still true. */
  beginSet(opts: { requireReady?: boolean } = {}): boolean {
    if (this.phase === 'finished' || this.phase === 'counting') return false;
    if ((opts.requireReady ?? true) && !this.isReady()) return false;
    this.baseline = this.last.reps;
    this.phase = 'counting';
    return true;
  }

  finishSet(): RepSetResult {
    const n = this.setRepsNow();
    this.finalReps = n;
    this.phase = 'finished';
    return { estimatedReps: n, source: 'camera-estimate', verified: false };
  }

  /** Clear the set (keeps camera state); next set starts from acquiring/arming again. */
  reset(): void {
    this.session.reset();
    this.last = this.session.snapshot;
    this.baseline = 0; this.banked = 0; this.finalReps = null;
    this.fullSince = null; this.full = false; this.lastT = null;
    this.phase = this.camera === 'live' ? 'acquiring' : 'idle';
  }

  snapshot(): RepCounterSnapshot {
    const s = this.last;
    const live = this.camera === 'live';
    const locked = live && s.lockState === 'locked';
    const fullBodyStable = live && this.fullSince !== null && this.lastT !== null && this.lastT - this.fullSince >= this.stableMs;
    const ready = this.isReady() && this.phase !== 'counting' && this.phase !== 'finished';
    return {
      phase: this.phase,
      camera: this.camera,
      failure: this.failure,
      rawRunReps: s.reps,
      setReps: this.setRepsNow(),
      keypoints: live ? toKeypoints(s.subject) : null,
      aspect: this.aspect,
      locked,
      armed: live && s.armed,
      fresh: live && s.frameIssue === null && s.counting,
      fullBodyVisible: live && this.full,
      fullBodyStable,
      readyForCountdown: ready,
      guidance: this.guidance(locked, s.armed, fullBodyStable),
    };
  }

  private guidance(locked: boolean, armed: boolean, stable: boolean): string {
    if (this.camera === 'failed') return 'Camera unavailable — you can enter your reps manually.';
    if (this.camera === 'paused') return 'Camera paused.';
    if (this.camera !== 'live') return this.camera === 'off' ? '' : 'Starting camera…';
    if (this.phase === 'finished') return 'Set finished.';
    if (this.phase === 'counting') return locked ? 'Squat when ready.' : 'Step back into view.';
    if (!locked || !this.full) return 'Step back so your whole body is in view.';
    if (!armed || !stable) return 'Getting ready — stand naturally.';
    return 'Ready.';
  }
}
