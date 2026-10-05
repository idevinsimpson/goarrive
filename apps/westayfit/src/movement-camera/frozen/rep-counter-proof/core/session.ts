import { depthFromRatio, squatRatio } from './geometry';
import { SquatCounter, type SquatConfig, type SquatEvent, type SquatPhase } from './squatCounter';
import {
  SubjectLock,
  type LockReason,
  type LockState,
  type SubjectLockConfig,
} from './subjectLock';
import type { Box, Pose, PoseFrame } from './types';

/**
 * ONE SQUAT SESSION: lock + counter + the manual fallback, in one pure object.
 *
 * The session is the only thing a UI talks to. It takes engine-neutral pose
 * frames (or manual taps) and returns a snapshot. It has no I/O of any kind:
 * it does not persist, upload or write anywhere. The count lives in memory
 * and dies with the screen — by design, until the CV layer is trusted enough
 * to feed the real contribution path (not in this packet).
 *
 * MANUAL FALLBACK IS A MODE, NOT AN AFTERTHOUGHT. A member who refuses the
 * camera, or whose camera cannot see them, can still count by tapping. The
 * snapshot always says which way the count was produced (`mode`), so a later
 * integration can treat a camera count and a tapped count differently.
 */

export type CountMode = 'camera' | 'manual';

export interface SessionSnapshot {
  mode: CountMode;
  reps: number;
  partials: number;
  lockState: LockState;
  lockReason: LockReason | null;
  phase: SquatPhase;
  depth: number | null;
  event: SquatEvent;
  subject: Pose | null;
  subjectBox: Box | null;
  candidates: Box[];
  progress: number;
  /** True only on frames where a sample actually reached the counter. */
  counting: boolean;
  /**
   * Why this frame was not taken at face value: `outOfOrder` (timestamp not
   * after the previous one; the frame was rejected) or `gap` (longer than
   * `maxFrameGapMs` since the previous frame; tracking was suspended).
   */
  frameIssue: 'outOfOrder' | 'gap' | null;
}

export interface SessionConfig {
  lock?: Partial<SubjectLockConfig>;
  squat?: Partial<SquatConfig>;
  /**
   * The freshness bound. Two consecutive frames further apart than this mean
   * the stream was interrupted (a hidden tab, a stalled camera, a frozen
   * frame loop): nothing in between was observed, so the rep in progress is
   * void and the member must be re-acquired. Default 250 ms, which a frame
   * loop running at ≥ 5 fps never trips.
   */
  maxFrameGapMs?: number;
}

export const DEFAULT_MAX_FRAME_GAP_MS = 250;

export class MovementSession {
  private readonly lock: SubjectLock;
  private readonly counter: SquatCounter;
  private mode: CountMode = 'camera';
  private manualReps = 0;
  private last: SessionSnapshot;
  private readonly maxFrameGapMs: number;
  private lastT = -Infinity;

  constructor(config: SessionConfig = {}) {
    this.lock = new SubjectLock(config.lock);
    this.counter = new SquatCounter(config.squat);
    this.maxFrameGapMs = config.maxFrameGapMs ?? DEFAULT_MAX_FRAME_GAP_MS;
    this.last = this.blank();
  }

  get snapshot(): SessionSnapshot {
    return this.last;
  }

  update(frame: PoseFrame): SessionSnapshot {
    if (this.mode !== 'camera') return this.last;
    const t = frame.timestampMs;

    // FRESHNESS, 1: out of order. A frame not strictly after the previous one
    // is rejected outright, and whatever cycle was in progress is void.
    if (!Number.isFinite(t) || t <= this.lastT) {
      this.counter.interrupt();
      this.last = {
        ...this.last,
        phase: this.counter.currentPhase,
        depth: null,
        event: null,
        subject: null,
        counting: false,
        frameIssue: 'outOfOrder',
      };
      return this.last;
    }

    // FRESHNESS, 2: a gap. Nothing was observed in between, so no inference
    // spans it: the rep in progress is void and the lock must re-acquire.
    let frameIssue: SessionSnapshot['frameIssue'] = null;
    if (t - this.lastT > this.maxFrameGapMs && Number.isFinite(this.lastT)) {
      frameIssue = 'gap';
      this.lock.suspend();
      this.counter.interrupt();
    }
    this.lastT = t;

    const before = this.lock.currentState;
    const out = this.lock.update(frame);

    // Leaving `locked` for any reason voids the rep in progress.
    if (before === 'locked' && out.state !== 'locked') this.counter.interrupt();

    let depth: number | null = null;
    if (out.state === 'locked' && out.subject && out.standingRatio !== null) {
      const ratio = squatRatio(out.subject);
      if (ratio !== null) depth = depthFromRatio(ratio, out.standingRatio);
    }
    const counting = depth !== null;
    const c = this.counter.update({ timestampMs: frame.timestampMs, depth });

    this.last = {
      mode: 'camera',
      reps: c.reps,
      partials: c.partials,
      lockState: out.state,
      lockReason: out.reason,
      phase: c.phase,
      depth,
      event: c.event,
      subject: out.subject,
      subjectBox: out.subjectBox,
      candidates: out.candidates,
      progress: out.progress,
      counting,
      frameIssue,
    };
    return this.last;
  }

  /** Switch to tapping. The camera count so far carries over as the starting point. */
  useManual(): SessionSnapshot {
    if (this.mode === 'manual') return this.last;
    this.manualReps = this.counter.count;
    this.mode = 'manual';
    this.last = { ...this.blank(), mode: 'manual', reps: this.manualReps };
    return this.last;
  }

  tap(delta: 1 | -1): SessionSnapshot {
    if (this.mode !== 'manual') return this.last;
    this.manualReps = Math.max(0, this.manualReps + delta);
    this.last = { ...this.last, reps: this.manualReps };
    return this.last;
  }

  /** Back to camera counting from zero, looking for the member again. */
  reset(): SessionSnapshot {
    this.lock.reset();
    this.counter.reset();
    this.lastT = -Infinity;
    this.manualReps = 0;
    this.mode = 'camera';
    this.last = this.blank();
    return this.last;
  }

  private blank(): SessionSnapshot {
    return {
      mode: this.mode,
      reps: 0,
      partials: 0,
      lockState: 'searching',
      lockReason: 'noOne',
      phase: 'unknown',
      depth: null,
      event: null,
      subject: null,
      subjectBox: null,
      candidates: [],
      progress: 0,
      counting: false,
      frameIssue: null,
    };
  }
}

/** The words a tester sees for each tracking state. */
export function lockMessage(state: LockState, reason: LockReason | null): string {
  if (state === 'locked') return 'Tracking you';
  if (state === 'acquiring') return 'Hold still — locking on…';
  if (state === 'lost') {
    return reason === 'ambiguous'
      ? 'Someone else is too close — counting paused'
      : 'Lost you — step back into frame';
  }
  switch (reason) {
    case 'twoPeople':
      return 'More than one person in the zone — only the mover should stand in the middle';
    case 'notFullBody':
      return 'Step back — head to feet in frame';
    case 'tooSmall':
      return 'Step a little closer';
    case 'offCenter':
      return 'Move to the middle of the frame';
    case 'notStanding':
      return 'Stand tall to start';
    default:
      return 'Step into frame';
  }
}
