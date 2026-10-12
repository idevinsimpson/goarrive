// REP-COUNTER-PROOF-1-r14 EXPERIMENTAL occlusion-aware transient subject continuity.
// Subclass of the r7 fast-start lock (itself on r5). Acquisition is inherited unchanged; only the
// lost/recover path differs, applying the r13 occlusion-continuity principle to the LIVE tracker:
//  - A short loss (<= maxOcclusionMs) keeps the track token and its standing calibration alive and
//    reacquires ONLY a single spatially/scale-consistent full-body candidate (prediction-gated,
//    confirmFrames consecutive). No new calibration, no identity switch.
//  - Two plausible candidates, or any crowding: fail closed (stay lost/ambiguous). Never switch.
//  - A candidate inconsistent in scale/position with the prediction is refused; if nothing valid
//    returns before maxOcclusionMs, the transient identity EXPIRES and the next acquisition is a
//    fresh start with fresh calibration.
//  - Partial occlusion (credible torso, legs gone) is inherited from r5: identity holds briefly
//    (held, no count sample); missing joints stay missing and are never synthesized.
// Continuity uses only short-lived spatial/motion cues (box center, predicted motion, scale,
// overlap, body completeness). No face, no appearance model, no embeddings, no persistence.
// Continuity decisions are exposed as numeric events for the local trace (drainEvents).
import type { Box } from '../core/types';
import type { Cand, StepResult } from '../r5/lockR5';
import { SubjectLockR7 } from '../r7/lockR7';

export const R14_REVISION = 'r14-occlusion-continuity-experimental';

export interface R14OccConfig {
  /** Transient identity/calibration window. Beyond it the track expires (fresh start). */
  maxOcclusionMs: number;
  /** Consecutive unique matching frames required to reacquire the SAME subject. */
  confirmFrames: number;
  /** Base reacquire gate as a fraction of track box height. */
  gateFrac: number;
  /** Gate growth per second of occlusion (people move while hidden). */
  gateGrowPerS: number;
  /** Hard cap on the reacquire gate (fraction of track height). */
  gateMax: number;
  /** Allowed |scale - 1| vs the tracked box. */
  scaleTol: number;
}
export const R14_OCC_CONFIG: R14OccConfig = {
  maxOcclusionMs: 3000,
  confirmFrames: 2,
  gateFrac: 0.6,
  gateGrowPerS: 0.6,
  gateMax: 1.6,
  scaleTol: 0.35,
};

export type R14ContinuityEvent =
  | 'occluded' // locked track lost with no ambiguity
  | 'ambiguous' // lost because a second person crowded the track
  | 'reacquire-candidate' // a unique consistent candidate is being confirmed
  | 'reacquired-same' // same subject reacquired inside the window, calibration preserved
  | 'refused-ambiguous' // reacquisition refused: more than one plausible person
  | 'refused-scale' // the only near candidate is inconsistent in scale (likely a different person)
  | 'expired'; // window elapsed: transient identity dropped, fresh calibration required

const MAX_VEL_PER_S = 1.5; // box heights per second; clamp for the motion prediction

export class SubjectLockR14 extends SubjectLockR7 {
  readonly occ: R14OccConfig;
  private vel = { vx: 0, vy: 0 };
  private lastBoxT: number | null = null;
  private confirm = 0;
  private evs: { t: number; ev: R14ContinuityEvent }[] = [];

  constructor(config: ConstructorParameters<typeof SubjectLockR7>[0] = {}, occ: Partial<R14OccConfig> = {}) {
    super(config);
    this.occ = { ...R14_OCC_CONFIG, ...occ };
  }

  /** Numeric continuity decisions since the last drain (local trace diagnostics only). */
  drainEvents(): { t: number; ev: R14ContinuityEvent }[] {
    const e = this.evs;
    this.evs = [];
    return e;
  }
  private ev(t: number, ev: R14ContinuityEvent) {
    if (this.evs.length < 2000) this.evs.push({ t, ev });
  }

  override reset(): void {
    super.reset();
    this.vel = { vx: 0, vy: 0 };
    this.lastBoxT = null;
    this.confirm = 0;
  }

  override suspend(): void {
    super.suspend();
    this.confirm = 0;
  }

  protected override follow(cands: Cand[], t: number, aspect: number): StepResult {
    const wasLocked = this.state === 'locked';
    const prevBox = this.track?.box ?? null;
    const prevT = this.lastBoxT;
    const r = super.follow(cands, t, aspect);
    if (wasLocked && this.state === 'lost') {
      this.confirm = 0;
      this.ev(t, this.reason === 'ambiguous' ? 'ambiguous' : 'occluded');
    }
    const tb = this.track?.box;
    if (this.state === 'locked' && r.subject && tb) {
      if (prevBox && prevT !== null && t > prevT) {
        const dt = (t - prevT) / 1000;
        const clamp = (v: number) => Math.max(-MAX_VEL_PER_S, Math.min(MAX_VEL_PER_S, v));
        this.vel = {
          vx: clamp(0.6 * this.vel.vx + (0.4 * (tb.cx - prevBox.cx)) / dt),
          vy: clamp(0.6 * this.vel.vy + (0.4 * (tb.cy - prevBox.cy)) / dt),
        };
      }
      this.lastBoxT = t;
    }
    return r;
  }

  protected override recover(cands: Cand[], t: number, aspect: number): StepResult {
    const track = this.track!;
    if (t - track.lastSeenMs > this.occ.maxOcclusionMs) {
      this.ev(t, 'expired');
      this.reset();
      return this.acquire(cands, t, aspect);
    }
    // Predict where the tracked person plausibly is; the gate grows with occlusion time.
    const dtS = Math.min(1, (t - track.lastSeenMs) / 1000);
    const pred: Box = { ...track.box, cx: track.box.cx + this.vel.vx * dtS, cy: track.box.cy + this.vel.vy * dtS };
    const gate = Math.min(this.occ.gateMax, this.occ.gateFrac + ((t - track.lastSeenMs) / 1000) * this.occ.gateGrowPerS) * track.box.h;
    let scaleRefused = false;
    const near = cands.filter((c) => {
      if (!c.fullBody) return false;
      if (this.dist(pred, c.box, aspect) > gate) return false;
      const s = c.box.h / track.box.h;
      if (Math.abs(s - 1) > this.occ.scaleTol) {
        scaleRefused = true;
        return false;
      }
      return true;
    });
    if (near.length !== 1) {
      this.confirm = 0;
      this.reason = near.length > 1 ? 'ambiguous' : 'missing';
      if (near.length > 1) this.ev(t, 'refused-ambiguous');
      else if (scaleRefused) this.ev(t, 'refused-scale');
      return this.none(near.length > 1 ? 'ambiguous' : cands.length === 0 ? 'noPose' : 'lowConfidence');
    }
    const m = near[0];
    if (cands.some((c) => c !== m && this.crowds(m.box, c, aspect))) {
      this.confirm = 0;
      this.reason = 'ambiguous';
      this.ev(t, 'refused-ambiguous');
      return this.none('ambiguous');
    }
    this.confirm += 1;
    if (this.confirm < this.occ.confirmFrames) {
      this.ev(t, 'reacquire-candidate');
      return this.none(null);
    }
    // Same subject inside the window: keep token AND standing calibration; no re-acquisition hold.
    track.box = m.box;
    track.lastSeenMs = t;
    track.lastFullMs = t;
    this.vel = { vx: 0, vy: 0 };
    this.confirm = 0;
    this.state = 'locked';
    this.reason = null;
    this.ev(t, 'reacquired-same');
    return { subject: m.pose, cause: null, missing: [], held: false };
  }
}
