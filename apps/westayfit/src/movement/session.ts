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
}

export interface SessionConfig {
  lock?: Partial<SubjectLockConfig>;
  squat?: Partial<SquatConfig>;
}

export class MovementSession {
  private readonly lock: SubjectLock;
  private readonly counter: SquatCounter;
  private mode: CountMode = 'camera';
  private manualReps = 0;
  private last: SessionSnapshot;

  constructor(config: SessionConfig = {}) {
    this.lock = new SubjectLock(config.lock);
    this.counter = new SquatCounter(config.squat);
    this.last = this.blank();
  }

  get snapshot(): SessionSnapshot {
    return this.last;
  }

  update(frame: PoseFrame): SessionSnapshot {
    if (this.mode !== 'camera') return this.last;
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
