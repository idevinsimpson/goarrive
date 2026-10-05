// REP-COUNTER-PROOF-1-r14.2 session (NOT wired into the page yet — comparison/session-sim first).
// Unchanged SubjectLockR14 + R142Engine (startup arm in front of frozen r13.3 + frozen r14.1 grace).
// Same op-ordering as SessionR141: per-frame feed ops first, then the lock's continuity events, which
// is exactly the order recorded in a trace, so live and the replay sim decide identically.
import type { PoseFrame } from '../core/types';
import { KEYPOINTS } from '../core/types';
import { SessionR5, type MovementRules, type R5Snapshot } from '../r5/sessionR5';
import type { NaturalOutput, Reject } from '../r6/naturalCounter';
import type { TraceOp } from '../replay/traceOps';
import { SubjectLockR14 } from '../r14/lockR14';
import { R142Engine, R142_REVISION, R1421_REVISION, ARM_CONFIG, ARM_CONFIG_R1421, type ArmConfig } from './startupArm';

export { R142_REVISION, R1421_REVISION };
export const R1421_LABEL = 'r14.2.1 startup arm (camera-height calibration) + r14.1 gap grace + r13.3 skeleton phase (experimental live test)';
export const R142_LABEL = 'r14.2 startup arm + r14.1 gap grace + r13.3 skeleton phase (experimental, comparison first)';

export type R142Snapshot = Omit<R5Snapshot, 'rules'> & { rules: MovementRules | 'r133'; armed: boolean; armMessage: string };

export class SessionR142 extends SessionR5 {
  private readonly lock14: SubjectLockR14;
  readonly engine: R142Engine;
  private sink: ((op: TraceOp) => void) | null = null;
  private ops: TraceOp[] = [];
  private lastS: R142Snapshot;
  private phaseN: R5Snapshot['phase'] = 'unknown';

  constructor(cfg: ArmConfig = ARM_CONFIG) {
    const lock = new SubjectLockR14();
    super({ rules: 'r6', continuity: 'strict', lockFactory: () => lock });
    this.engine = new R142Engine(cfg);
    this.lock14 = lock;
    Object.defineProperty(this, 'trace', {
      get: () => this.dispatch,
      set: (fn: ((op: TraceOp) => void) | null) => { this.sink = fn; },
      configurable: true,
    });
    this.lastS = this.merge(super.snapshot, null, null);
  }

  private dispatch = (op: TraceOp) => { this.ops.push(op); };

  private merge(s: R5Snapshot, out: NaturalOutput | null, ir: Reject | null): R142Snapshot {
    const armed = this.engine.armed;
    return {
      ...s, reps: this.engine.runReps, partials: this.engine.c.cycles.filter((c) => c.outcome === 'partial').length,
      phase: armed ? (out ? (this.phaseN = out.phase) : this.phaseN) : (this.phaseN = 'unknown'),
      stage: armed ? this.engine.c.currentStage : 'unknown',
      event: out?.event ?? null, reject: out?.reject ?? ir, rules: 'r133', decision: null,
      armed, armMessage: armed ? 'Ready' : 'Getting ready — stand naturally',
    };
  }

  private pump(frame: PoseFrame | null, s: R5Snapshot) {
    let out: NaturalOutput | null = null, ir: Reject | null = null, graced = false;
    for (const op of this.ops) {
      if (op.k === 'feed') {
        const subj = frame && op.t === frame.timestampMs ? s.subject : null;
        const joints = subj ? KEYPOINTS.flatMap((k) => { const p = subj[k]; return p ? [p.x, p.y, p.visibility] : [null, null, null]; }) : null;
        const r = this.engine.feed(op.t, op.depth, op.torso, { frame: subj ? { t: op.t, joints, standingRatio: s.standingRatio } : null, lock: s.lockState, reason: s.lockReason });
        if (r.graced) { graced = true; this.sink?.({ k: 'skip', t: op.t }); continue; }
        if (r.out) out = r.out;
        this.sink?.({ ...op, reps: this.engine.runReps, event: r.out?.event ?? null, reject: r.out?.reject ?? null, stage: (r.out?.stage ?? 'unknown') as never, dec: null });
      } else if (op.k === 'interrupt') {
        if (this.engine.interrupt(null)) ir = 'interrupted';
        this.sink?.(op);
      } else if (op.k === 'reset') {
        this.engine.reset();
        this.sink?.(op);
      } else this.sink?.(op);
    }
    for (const e of this.lock14.drainEvents()) { this.engine.cont(e.t, e.ev); this.sink?.({ k: 'cont', t: e.t, ev: e.ev }); }
    this.ops = [];
    return { out, ir, graced };
  }

  override update(frame: PoseFrame): R142Snapshot {
    this.ops = [];
    const s = super.update(frame);
    const { out, ir, graced } = this.pump(frame, s);
    this.lastS = { ...this.merge(s, out, ir), graceSkip: s.graceSkip || graced, interruptCause: graced ? null : s.interruptCause };
    return this.lastS;
  }

  override reset(): R142Snapshot {
    this.ops = [];
    const s = super.reset();
    this.pump(null, s);
    this.engine.reset();
    this.lastS = this.merge(super.snapshot, null, null);
    return this.lastS;
  }

  override get snapshot(): R142Snapshot { return this.lastS; }
}

export function makeSessionR142(): SessionR142 { return new SessionR142(); }
/** Live opt-in mode ?tracker=r14.2&rules=r133 uses the replay-validated r14.2.1 arm config. */
export function makeSessionR1421(): SessionR142 { return new SessionR142(ARM_CONFIG_R1421); }
