// REP-COUNTER-PROOF-1-r5 EXPERIMENTAL successor session. Same contract as core/session.ts
// (MovementSession) and uses the FROZEN SquatCounter, geometry and thresholds unchanged.
// Difference G1: the frozen session feeds a null sample to the counter on every locked frame
// without a measurable subject, and a null mid-cycle voids the rep — one dropped/low-confidence
// frame loses the rep. r5 skips (does not feed) null samples while the lock is still `locked`
// for at most countGraceMs; nothing is synthesized: the counter only ever sees observed depths,
// and a phase change still requires observed samples in the target zone for dwellMs.
// After the grace (or on any lock loss / freshness gap) the counter is voided exactly as frozen.
import { depthFromRatio, median, squatRatio, visiblePoint } from '../core/geometry';
import { DEFAULT_MAX_FRAME_GAP_MS, type SessionSnapshot } from '../core/session';
import { SquatCounter, type SquatConfig } from '../core/squatCounter';
import type { PoseFrame } from '../core/types';
import { FrozenRejectObserver } from '../r6/frozenObserver';
import { torsoRatio } from '../r6/geometryR6';
import { NaturalSquatCounter, type NaturalConfig, type Reject, type Stage } from '../r6/naturalCounter';
import { NaturalSquatCounterR9, type R9Config } from '../r9/naturalCounterR9';
import { NaturalSquatCounterR10, type R10Config } from '../r10/naturalCounterR10';
import { NaturalSquatCounterR11, type R11Config } from '../r11/naturalCounterR11';
import { NaturalSquatCounterR12, type R12Config } from '../r12/naturalCounterR12';
import { NaturalSquatCounterR122, type R122Config } from '../r12_2/naturalCounterR12_2';
import type { RuleDecision } from '../replay/decision';
import { sideInfo, type SideInfo, type TraceOp } from '../replay/traceOps';
import { SubjectLockR5, type JointGroup, type LossCause, type R5LockConfig } from './lockR5';

export const R5_COUNT_GRACE_MS = 200;
export const R5_REVISION = 'r5-experimental';

export interface R5Snapshot extends SessionSnapshot {
  cause: LossCause | null;
  missing: JointGroup[];
  /** Identity held on torso-only evidence; this frame is NOT countable. */
  held: boolean;
  /** This frame's null sample was skipped within the count grace (not fed, not synthesized). */
  graceSkip: boolean;
  merged: number;
  /** r6: which movement rules produced this count. */
  rules: MovementRules;
  /** r6: the rule that rejected progress on this frame (transition-logged, not per frame). */
  reject: Reject | null;
  /** r6: natural-rule stage (null under frozen rules; frozen exposes only phase). */
  stage: Stage | null;
  rejects: RejectCounts;
  /** Standing ratio actually used for this frame's depth (lock baseline, or r9 refined), null if none. */
  standingRatio: number | null;
  /** Number of sides (0–2) with hip, knee and ankle usable on the tracked subject this frame. */
  legs: number;
  /** Why an unfinished cycle was voided on this frame (only set together with reject 'interrupted'). */
  interruptCause: InterruptCause | null;
  /** R10-REPLAY-1 (additive): last ACTUAL rule decision fed on this frame (r10/r11 only), else null. */
  decision?: RuleDecision | null;
  /** R10-REPLAY-1 (additive): per-side measurability/ratio of the MATCHED subject only. */
  sides?: SideInfo | null;
}

export type InterruptCause = 'outOfOrder' | 'gap' | 'lockLost' | 'ambiguous' | 'noSubject' | 'graceExpired';
export type MovementRules = 'frozen' | 'r6' | 'r9' | 'r10' | 'r11' | 'r12' | 'r122';
/** Standing-baseline policy: 'lock' (historical) or 'refine' (r9: raise toward observed upright ratios). */
export type BaselineMode = 'lock' | 'refine';
export const R9_REFINE_SAMPLES = 15;
export const R9_REFINE_MARGIN = 0.05;
export type RejectCounts = Record<Reject, number>;
export const emptyRejects = (): RejectCounts => ({ noStanding: 0, notDeep: 0, notTall: 0, downBrief: 0, upBrief: 0, minRep: 0, geometry: 0, interrupted: 0 });

export interface R5Config {
  lock?: Partial<R5LockConfig>;
  squat?: Partial<SquatConfig>;
  maxFrameGapMs?: number;
  countGraceMs?: number;
  /** Movement rules; default 'frozen' keeps r5 behaviour exactly. */
  rules?: MovementRules;
  natural?: Partial<NaturalConfig>;
  /** r9 rules only: hysteresis band etc. */
  r9?: Partial<R9Config>;
  /** r10 rules only (R10-INCLUSIVE-SQUAT-1). */
  r10?: Partial<R10Config>;
  /** r11 rules only (R10-REPLAY-1 rearm/pending-warning successor). */
  r11?: Partial<R11Config>;
  /** r12 rules only (camera-height successor). */
  r12?: Partial<R12Config>;
  /** r12.2 rules only (reversal successor; same class as the replay comparator). */
  r122?: Partial<R122Config>;
  /** Default 'lock' keeps historical behaviour exactly. */
  baseline?: BaselineMode;
  /** r7: alternative lock (default: SubjectLockR5, i.e. r5 behaviour exactly). */
  lockFactory?: (cfg?: Partial<R5LockConfig>) => SubjectLockR5;
  /**
   * r7.1 opt-in. 'r5' (default, historical r5/r6/r7 arms): every locked frame without depth gets the
   * count grace. 'strict': grace ONLY while the tracked body is still observed this frame (torso-only
   * identity hold, or matched full body whose leg ratio is unusable). No current credible subject
   * (no pose, association rejection, ambiguity) voids the unfinished cycle immediately. Also refuses
   * replay samples at or before the last fed timestamp.
   */
  continuity?: 'r5' | 'strict';
}

export class SessionR5 {
  private readonly lock: SubjectLockR5;
  private readonly counter: SquatCounter | NaturalSquatCounter | NaturalSquatCounterR9 | NaturalSquatCounterR10 | NaturalSquatCounterR11 | NaturalSquatCounterR12 | NaturalSquatCounterR122;
  /**
   * R10-REPLAY-1 observer seam: receives every counter operation in order (feed incl. fast-start replay
   * feeds and null feeds, grace skip, interrupt, reset). null = disabled (default). It is write-only:
   * the session never reads anything back from it, so it cannot affect decisions.
   */
  trace: ((op: TraceOp) => void) | null = null;
  private frameDec: RuleDecision | null = null;
  private readonly baseline: BaselineMode;
  private refine: number[] = [];
  private activeS: number | null = null;
  private readonly rules: MovementRules;
  private readonly observer = new FrozenRejectObserver();
  private rejects: RejectCounts = emptyRejects();
  private readonly maxFrameGapMs: number;
  private readonly graceMs: number;
  private mode: 'camera' | 'manual' = 'camera';
  private manualReps = 0;
  private lastT = -Infinity;
  private nullSince: number | null = null;
  private readonly continuity: 'r5' | 'strict';
  private lastFedT = -Infinity;
  private last: R5Snapshot;

  constructor(cfg: R5Config = {}) {
    this.lock = cfg.lockFactory ? cfg.lockFactory(cfg.lock) : new SubjectLockR5(cfg.lock);
    this.rules = cfg.rules ?? 'frozen';
    this.counter = this.rules === 'r6' ? new NaturalSquatCounter(cfg.natural) : this.rules === 'r9' ? new NaturalSquatCounterR9(cfg.r9) : this.rules === 'r10' ? new NaturalSquatCounterR10(cfg.r10) : this.rules === 'r11' ? new NaturalSquatCounterR11(cfg.r11) : this.rules === 'r12' ? new NaturalSquatCounterR12(cfg.r12) : this.rules === 'r122' ? new NaturalSquatCounterR122(cfg.r122) : new SquatCounter(cfg.squat);
    this.baseline = cfg.baseline ?? 'lock';
    this.maxFrameGapMs = cfg.maxFrameGapMs ?? DEFAULT_MAX_FRAME_GAP_MS;
    this.graceMs = Math.min(cfg.countGraceMs ?? R5_COUNT_GRACE_MS, this.maxFrameGapMs - 1);
    this.continuity = cfg.continuity ?? 'r5';
    this.last = this.blank();
  }

  get snapshot(): R5Snapshot {
    return this.last;
  }

  update(frame: PoseFrame): R5Snapshot {
    if (this.mode !== 'camera') return this.last;
    const t = frame.timestampMs;
    this.frameDec = null;
    if (!Number.isFinite(t) || t <= this.lastT) {
      const rj = this.voidCycle();
      this.nullSince = null;
      this.last = { ...this.last, reject: rj, stage: this.stageNow(), phase: this.counter.currentPhase, depth: null, event: null, subject: null, counting: false, frameIssue: 'outOfOrder', cause: 'outOfOrder', held: false, graceSkip: false, legs: 0, interruptCause: rj ? 'outOfOrder' : null };
      return this.last;
    }
    let frameIssue: SessionSnapshot['frameIssue'] = null;
    let gapReject: Reject | null = null;
    if (t - this.lastT > this.maxFrameGapMs && Number.isFinite(this.lastT)) {
      frameIssue = 'gap';
      this.lock.suspend();
      gapReject = this.voidCycle();
      this.nullSince = null;
    }
    this.lastT = t;
    const before = this.lock.currentState;
    const out = this.lock.update(frame);
    let lockReject: Reject | null = null;
    if (before === 'locked' && out.state !== 'locked') {
      lockReject = this.voidCycle();
      this.nullSince = null;
    }
    // Baseline actually used for depth. 'lock' = the lock's calibration (historical, unchanged).
    if (out.state === 'locked' && before !== 'locked') { this.refine = []; this.activeS = out.standingRatio; }
    const S = out.standingRatio === null ? null : this.baseline === 'refine' ? Math.max(out.standingRatio, this.activeS ?? out.standingRatio) : out.standingRatio;
    // r7 only: feed earlier OBSERVED upright frames of the just-locked subject once, in order.
    if (out.state === 'locked' && out.replay && out.standingRatio !== null) {
      for (const r of out.replay) {
        const rr = squatRatio(r.subject);
        if (rr === null || !(r.timestampMs < t)) continue;
        if (this.continuity === 'strict' && !(r.timestampMs > this.lastFedT)) continue;
        this.feed(r.timestampMs, depthFromRatio(rr, S!), torsoRatio(r.subject), true);
      }
    }
    let depth: number | null = null;
    let torso: number | null = null;
    let ratio: number | null = null;
    if (out.state === 'locked' && out.subject && S !== null) {
      ratio = squatRatio(out.subject);
      if (ratio !== null) depth = depthFromRatio(ratio, S);
      torso = torsoRatio(out.subject);
    }
    let nullCause: InterruptCause | null = null;
    let graceSkip = false;
    let c: { reps: number; partials: number; phase: SessionSnapshot['phase']; event: SessionSnapshot['event']; reject?: Reject | null };
    const observedNow = out.held || out.subject !== null;
    if (depth === null && out.state === 'locked') {
      this.nullSince ??= t;
      if (t - this.nullSince <= this.graceMs && (this.continuity === 'r5' || observedNow)) {
        graceSkip = true;
        this.trace?.({ k: 'skip', t });
        c = { reps: this.counter.count, partials: this.last.partials, phase: this.counter.currentPhase, event: null };
      } else {
        nullCause = this.continuity === 'strict' && !observedNow ? 'noSubject' : 'graceExpired';
        c = this.feed(t, null, null);
      }
    } else {
      if (depth !== null) this.nullSince = null;
      c = this.feed(t, depth, torso);
    }
    const reject = c.reject ?? lockReject ?? gapReject ?? null;
    if (reject) this.rejects = { ...this.rejects, [reject]: this.rejects[reject] + 1 };
    const interruptCause: InterruptCause | null = reject !== 'interrupted' ? null
      : c.reject === 'interrupted' ? nullCause : lockReject ? (out.reason === 'ambiguous' ? 'ambiguous' : 'lockLost') : gapReject ? 'gap' : null;
    // r9 'refine': at a confirmed top (stage ready) collect observed upright ratios; once enough exist,
    // raise the baseline to their median when that exceeds the current baseline by more than the
    // margin (never lowers it below the lock's own calibration). Only applied
    // while at the top, so a cycle in progress is measured against one fixed baseline.
    if (this.baseline === 'refine' && out.state === 'locked' && ratio !== null && this.stageNow() === 'ready' && ratio >= this.lock.cfg.standingRatioMin) {
      this.refine.push(ratio);
      if (this.refine.length > R9_REFINE_SAMPLES) this.refine.shift();
      // Only a correction materially larger than sample noise (> R9_REFINE_MARGIN) replaces the baseline.
      if (this.refine.length >= R9_REFINE_SAMPLES) {
        const m = Math.min(2.6, median(this.refine));
        if (m > (this.activeS ?? 0) + R9_REFINE_MARGIN) this.activeS = m;
      }
    }
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
      counting: depth !== null,
      frameIssue,
      cause: depth !== null ? null : frameIssue === 'gap' ? 'stale' : out.cause,
      missing: out.missing,
      held: out.held,
      graceSkip,
      merged: out.merged,
      rules: this.rules,
      reject,
      stage: this.stageNow(),
      rejects: this.rejects,
      standingRatio: out.state === 'locked' ? S : null,
      legs: out.subject ? measurableSides(out.subject) : 0,
      interruptCause,
      decision: this.frameDec,
      sides: out.subject ? sideInfo(out.subject) : null,
    };
    return this.last;
  }

  useManual(): R5Snapshot {
    if (this.mode === 'manual') return this.last;
    this.manualReps = this.counter.count;
    this.mode = 'manual';
    this.last = { ...this.blank(), mode: 'manual', reps: this.manualReps };
    return this.last;
  }

  tap(delta: 1 | -1): R5Snapshot {
    if (this.mode !== 'manual') return this.last;
    this.manualReps = Math.max(0, this.manualReps + delta);
    this.last = { ...this.last, reps: this.manualReps };
    return this.last;
  }

  reset(): R5Snapshot {
    this.lock.reset();
    this.counter.reset();
    this.trace?.({ k: 'reset' });
    this.observer.reset();
    this.rejects = emptyRejects();
    this.lastT = -Infinity;
    this.nullSince = null;
    this.lastFedT = -Infinity;
    this.manualReps = 0;
    this.mode = 'camera';
    this.refine = [];
    this.activeS = null;
    this.last = this.blank();
    return this.last;
  }

  private stageNow(): Stage | null {
    return this.nat()?.currentStage ?? null;
  }

  /** Void any cycle in progress (lock loss / gap / out-of-order); returns 'interrupted' if one was. */
  private voidCycle(): Reject | null {
    this.trace?.({ k: 'interrupt' });
    const n = this.nat();
    if (n) return n.interrupt();
    const wasMid = this.counter.currentPhase === 'down';
    this.counter.interrupt();
    this.observer.reset();
    return wasMid ? 'interrupted' : null;
  }

  private nat(): NaturalSquatCounter | NaturalSquatCounterR9 | NaturalSquatCounterR10 | NaturalSquatCounterR11 | NaturalSquatCounterR12 | NaturalSquatCounterR122 | null {
    const c = this.counter;
    return c instanceof NaturalSquatCounter || c instanceof NaturalSquatCounterR9 || c instanceof NaturalSquatCounterR10 || c instanceof NaturalSquatCounterR11 || c instanceof NaturalSquatCounterR12 || c instanceof NaturalSquatCounterR122 ? c : null;
  }

  private feed(t: number, depth: number | null, torso: number | null, replay = false) {
    if (t > this.lastFedT) this.lastFedT = t;
    const n = this.nat();
    if (n) {
      const o = n.update({ timestampMs: t, depth, torso });
      const dec = n instanceof NaturalSquatCounterR10 || n instanceof NaturalSquatCounterR11 || n instanceof NaturalSquatCounterR12 || n instanceof NaturalSquatCounterR122 ? { ...n.lastDecision } : null;
      this.frameDec = dec;
      this.trace?.({ k: 'feed', t, depth, torso, replay, reps: o.reps, event: o.event, reject: o.reject, stage: o.stage, dec });
      return o;
    }
    this.trace?.({ k: 'feed', t, depth, torso, replay, reps: null, event: null, reject: null, stage: null, dec: null });
    const out = (this.counter as SquatCounter).update({ timestampMs: t, depth });
    return { ...out, reject: this.observer.observe(t, depth, out) };
  }

  private blank(): R5Snapshot {
    return {
      mode: 'camera', reps: 0, partials: 0, lockState: 'searching', lockReason: 'noOne', phase: 'unknown', depth: null,
      event: null, subject: null, subjectBox: null, candidates: [], progress: 0, counting: false, frameIssue: null,
      cause: null, missing: [], held: false, graceSkip: false, merged: 0,
      rules: this.rules, reject: null, stage: null, rejects: this.rejects, standingRatio: null, legs: 0, interruptCause: null, decision: null, sides: null,
    };
  }
}

/** Sides (0–2) whose hip, knee and ankle are all usable (same rule as core geometry's measurable legs). */
export function measurableSides(pose: PoseFrame['poses'][number]): number {
  let n = 0;
  for (const side of ['left', 'right'] as const) {
    if (visiblePoint(pose, `${side}Hip`) && visiblePoint(pose, `${side}Knee`) && visiblePoint(pose, `${side}Ankle`)) n += 1;
  }
  return n;
}

const JOINT_TEXT: Record<JointGroup, string> = { shoulders: 'shoulders', hips: 'hips', knees: 'knees', ankles: 'ankles' };

/** Short observed reason for the reacquiring/paused label; null when nothing observed supports one. */
export function causeText(s: Pick<R5Snapshot, 'cause' | 'missing'>): string | null {
  const joints = s.missing.filter((g) => g !== 'shoulders' && g !== 'hips').map((g) => JOINT_TEXT[g]);
  const list = (s.missing.length ? (joints.length ? joints : s.missing.map((g) => JOINT_TEXT[g])) : []).join(' and ');
  switch (s.cause) {
    case 'noPose': return 'pose temporarily lost';
    case 'lowConfidence': return list ? `${list} not visible` : 'key joints not usable';
    case 'clipped': return list ? `${list} outside the frame` : 'body outside the frame';
    case 'associationScale': return 'pose size jumped, not matched to you';
    case 'associationPosition': return 'pose moved too far, not matched to you';
    case 'ambiguous': return 'more than one person close by';
    case 'stale': return 'frames arrived too slowly';
    case 'outOfOrder': return 'frame out of order';
    default: return null;
  }
}
