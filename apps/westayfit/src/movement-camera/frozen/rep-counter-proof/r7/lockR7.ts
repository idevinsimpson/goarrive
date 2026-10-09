// REP-COUNTER-PROOF-1-r7 EXPERIMENTAL acquisition successor to r5/lockR5.ts (itself a successor of
// the frozen core/subjectLock.ts, which is untouched). Only ACQUISITION changes; following, ambiguity,
// torso-only identity grace, lost/recover (400 ms hold-still), forget (4 s) are inherited from r5.
//
// Gate found in r5/frozen acquisition (identical in both): the lock needs ONE continuous hold of
// acquireMs = 600 ms in which the person is full-body, centred, upright (ratio ≥ 1.6) AND within
// holdStillGate (0.15 × body height) of where the hold started; any non-upright frame resets the hold.
// A person who starts descending < 600 ms after appearing is therefore never locked for that rep.
//
// r7 separates two things that the 600 ms hold fused:
//  1. PROVISIONAL IDENTITY — exactly one full-body, centred, large-enough person, nobody crowding,
//     tracked with the r5 squat-aware continuity gate. Any second qualifying/crowding body or any
//     continuity break discards the provisional subject (nothing has been counted from it).
//  2. STANDING BASELINE — calibrated only from CONSECUTIVE OBSERVED upright frames (ratio ≥ 1.6) of
//     that provisional subject, with a consistency check (spread ≤ calibMaxSpread) and settled
//     horizontal position. A crouched frame never contributes and clears the upright run.
// The lock (and therefore counting) begins only when identity has ≥ identityFrames frames AND the
// baseline has ≥ calibSamples consecutive upright samples. The earlier upright frames of that run are
// returned once as `replay` so the counter sees those REAL observations (nothing synthesized, no
// interpolation, never non-upright frames). Minimum evidence was chosen from the startup sweep
// (wrapper-tests/r7Fixtures.ts) before any real-video run.
import { median } from '../core/geometry';
import type { Box, Pose } from '../core/types';
import { SubjectLockR5, type Cand, type JointGroup, type LossCause, type R5LockConfig, type StepResult, clippedGroups, missingGroups } from '../r5/lockR5';

export interface R7AcqConfig {
  /** Frames of continuous single-person identity required before lock. */
  identityFrames: number;
  /** Consecutive observed upright frames required for the standing baseline. */
  calibSamples: number;
  /** Max spread (max − min) of the upright ratios used for the baseline. */
  calibMaxSpread: number;
}

export const R7_ACQ_CONFIG: R7AcqConfig = { identityFrames: 2, calibSamples: 2, calibMaxSpread: 0.2 };
export const R7_REVISION = 'r7-experimental';

interface Prov {
  box: Box;
  frames: number;
  sinceMs: number;
  upright: { timestampMs: number; ratio: number; pose: Pose; box: Box }[];
}

export class SubjectLockR7 extends SubjectLockR5 {
  readonly acq: R7AcqConfig;
  private prov: Prov | null = null;

  constructor(config: Partial<R5LockConfig> = {}, acq: Partial<R7AcqConfig> = {}) {
    super(config);
    this.acq = { ...R7_ACQ_CONFIG, ...acq };
    if (this.acq.identityFrames < 1 || this.acq.calibSamples < 1) throw new Error('r7 evidence minimums must be ≥ 1');
  }

  override reset(): void {
    super.reset();
    this.prov = null;
  }

  override suspend(): void {
    super.suspend();
    this.prov = null;
  }

  protected override acquire(cands: Cand[], t: number, aspect: number): StepResult {
    const cfg = this.cfg;
    const q1 = cands.filter((c) => c.fullBody && c.box.h >= cfg.minBodyHeight && c.box.cx >= cfg.zoneMinX && c.box.cx <= cfg.zoneMaxX);
    const fail = (reason: 'twoPeople' | 'noOne' | 'notFullBody' | 'tooSmall' | 'offCenter', cause: LossCause | null = null, missing: JointGroup[] = []) => {
      this.state = 'searching';
      this.reason = reason;
      this.hold = null;
      this.prov = null;
      return this.none(cause, missing);
    };
    if (q1.length > 1) return fail('twoPeople', 'ambiguous');
    if (q1.length === 0) {
      if (cands.length === 0) return fail('noOne', 'noPose');
      const big = cands.reduce((a, b) => (b.box.h > a.box.h ? b : a));
      if (!big.fullBody) return fail('notFullBody', clippedGroups(big.pose).length ? 'clipped' : 'lowConfidence', missingGroups(big.pose, cfg.minVisibility));
      if (big.box.h < cfg.minBodyHeight) return fail('tooSmall');
      return fail('offCenter');
    }
    const q = q1[0];
    if (cands.some((c) => c !== q && this.crowds(q.box, c, aspect))) return fail('twoPeople', 'ambiguous');
    // Continuity of the provisional subject (squat-aware r5 gate). A break restarts from scratch.
    if (this.prov && this.gate(this.prov.box, q, aspect) !== null) this.prov = null;
    const prov: Prov = this.prov ?? { box: q.box, frames: 0, sinceMs: t, upright: [] };
    this.prov = prov;
    prov.frames += 1;
    prov.box = q.box;
    const upright = q.ratio !== null && q.ratio >= cfg.standingRatioMin;
    if (upright) {
      // Settled: an upright run whose start drifted horizontally more than holdStillGate restarts.
      const first = prov.upright[0];
      if (first && Math.abs(q.box.cx - first.box.cx) * aspect > cfg.holdStillGate * first.box.h) prov.upright = [];
      prov.upright.push({ timestampMs: t, ratio: q.ratio!, pose: q.pose, box: q.box });
      if (prov.upright.length > this.acq.calibSamples) prov.upright.shift();
    } else prov.upright = []; // crouched/unknown: never part of a baseline; consecutive run broken
    const ratios = prov.upright.map((u) => u.ratio);
    const spreadOk = ratios.length > 0 && Math.max(...ratios) - Math.min(...ratios) <= this.acq.calibMaxSpread;
    if (prov.frames >= this.acq.identityFrames && prov.upright.length >= this.acq.calibSamples && spreadOk) {
      const standingRatio = Math.min(2.6, Math.max(cfg.standingRatioMin, median(ratios)));
      this.track = { box: q.box, lastSeenMs: t, lastFullMs: t, standingRatio };
      const replay = prov.upright.slice(0, -1).map((u) => ({ timestampMs: u.timestampMs, subject: u.pose }));
      this.prov = null;
      this.hold = null;
      this.state = 'locked';
      this.reason = null;
      return { subject: q.pose, cause: null, missing: [] as JointGroup[], held: false, replay };
    }
    this.state = 'acquiring';
    this.reason = upright ? null : 'notStanding';
    return this.none(null);
  }

  protected override progress(t: number): number {
    if (this.state === 'acquiring' && this.prov) return Math.min(1, this.prov.upright.length / this.acq.calibSamples) * 0.99;
    return super.progress(t);
  }
}
