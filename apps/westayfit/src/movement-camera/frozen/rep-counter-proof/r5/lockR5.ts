// REP-COUNTER-PROOF-1-r5 EXPERIMENTAL successor to core/subjectLock.ts (PR574 c4c241b).
// The frozen file is untouched; this sibling is A/B-tested against it (wrapper-tests/r5.test.ts).
// Differences vs frozen, each tied to a gate identified in the frozen code:
//  G2  follow() required a FULL body (shoulder + hip/knee/ankle ≥ 0.5) to continue the track.
//      r5: a credible torso (shoulder + hip visible) at the right place continues the IDENTITY,
//      but yields no subject, so no count sample (counting still needs a measurable leg).
//      Torso-only identity is capped at identityGraceMs, then the lock is lost as before.
//  G3  continuity gate was isotropic 0.35×h and scale 0.7–1.4 vs the previous frame.
//      r5: horizontal 0.35×h, vertical 0.6×h (a squat translates the box vertically), scale 0.55–1.6.
//  G4  overlapping detections were always a crowd. r5 merges two detections ONLY when they are the
//      same body: ≥ 6 shared visible keypoints with mean distance < 0.04×h and IoU > 0.8. Any other
//      overlap (e.g. a person behind) is still ambiguity → lost, exactly as frozen.
//  Acquisition, ambiguity, hold-still re-acquisition (400 ms), forget (4 s) and standing baseline
//  are copied unchanged. No identity, no appearance model, no landmark synthesis.
import { DEFAULT_MIN_VISIBILITY, boxIoU, isFullBody, median, poseBox, squatRatio, visiblePoint } from '../core/geometry';
import type { LockReason, LockState } from '../core/subjectLock';
import type { Box, Keypoint, Pose, PoseFrame } from '../core/types';

export type LossCause =
  | 'noPose'
  | 'lowConfidence'
  | 'clipped'
  | 'associationScale'
  | 'associationPosition'
  | 'ambiguous'
  | 'stale'
  | 'outOfOrder';

export type JointGroup = 'shoulders' | 'hips' | 'knees' | 'ankles';

export interface R5LockConfig {
  minVisibility: number;
  minBodyHeight: number;
  zoneMinX: number;
  zoneMaxX: number;
  standingRatioMin: number;
  acquireMs: number;
  matchGateX: number;
  matchGateY: number;
  scaleMin: number;
  scaleMax: number;
  ambiguityGate: number;
  ambiguityIoU: number;
  holdStillGate: number;
  lostAfterMs: number;
  identityGraceMs: number;
  reacquireGate: number;
  reacquireScaleMin: number;
  reacquireScaleMax: number;
  reacquireMs: number;
  forgetAfterMs: number;
  dupMinShared: number;
  dupMaxMeanDist: number;
  dupMinIoU: number;
}

export const R5_LOCK_CONFIG: R5LockConfig = {
  minVisibility: DEFAULT_MIN_VISIBILITY,
  minBodyHeight: 0.3,
  zoneMinX: 0.2,
  zoneMaxX: 0.8,
  standingRatioMin: 1.6,
  acquireMs: 600,
  matchGateX: 0.35,
  matchGateY: 0.6,
  scaleMin: 0.55,
  scaleMax: 1.6,
  ambiguityGate: 0.35,
  ambiguityIoU: 0.1,
  holdStillGate: 0.15,
  lostAfterMs: 300,
  identityGraceMs: 600,
  reacquireGate: 0.6,
  reacquireScaleMin: 0.6,
  reacquireScaleMax: 1.6,
  reacquireMs: 400,
  forgetAfterMs: 4000,
  dupMinShared: 6,
  dupMaxMeanDist: 0.04,
  dupMinIoU: 0.8,
};

export interface R5LockOutput {
  state: LockState;
  reason: LockReason | null;
  subject: Pose | null;
  subjectBox: Box | null;
  standingRatio: number | null;
  candidates: Box[];
  progress: number;
  /** Observed reason the current frame yielded no countable subject, or null. */
  cause: LossCause | null;
  /** Required joint groups not usable on the tracked/nearest body this frame. */
  missing: JointGroup[];
  /** True when identity continues on a torso-only observation (not countable). */
  held: boolean;
  /** Detections merged as the same body this frame. */
  merged: number;
  /** r7 only: earlier OBSERVED upright frames of the same provisional subject, in order, to feed once on lock. */
  replay?: { timestampMs: number; subject: Pose }[];
}

/** Per-frame acquisition/follow result (type only). */
export interface StepResult { subject: Pose | null; cause: LossCause | null; missing: JointGroup[]; held: boolean; replay?: { timestampMs: number; subject: Pose }[] }

export interface Cand {
  pose: Pose;
  box: Box;
  fullBody: boolean;
  torso: boolean;
  ratio: number | null;
}

const GROUPS: Record<JointGroup, Keypoint[]> = {
  shoulders: ['leftShoulder', 'rightShoulder'],
  hips: ['leftHip', 'rightHip'],
  knees: ['leftKnee', 'rightKnee'],
  ankles: ['leftAnkle', 'rightAnkle'],
};
const EDGE = 0.02;

export function missingGroups(pose: Pose, minVis = DEFAULT_MIN_VISIBILITY): JointGroup[] {
  return (Object.keys(GROUPS) as JointGroup[]).filter((g) => GROUPS[g].every((k) => !visiblePoint(pose, k, minVis)));
}

/** Clipped = a missing required joint whose reported position lies outside the frame. */
export function clippedGroups(pose: Pose): JointGroup[] {
  return (Object.keys(GROUPS) as JointGroup[]).filter((g) =>
    GROUPS[g].some((k) => {
      const p = pose[k];
      return !!p && (p.x < -EDGE || p.x > 1 + EDGE || p.y < -EDGE || p.y > 1 + EDGE);
    }),
  );
}

export function sameBody(a: Cand, b: Cand, cfg: R5LockConfig): boolean {
  if (boxIoU(a.box, b.box) <= cfg.dupMinIoU) return false;
  let n = 0;
  let sum = 0;
  for (const k of Object.keys(a.pose) as Keypoint[]) {
    const p = visiblePoint(a.pose, k, cfg.minVisibility);
    const q = visiblePoint(b.pose, k, cfg.minVisibility);
    if (!p || !q) continue;
    n += 1;
    sum += Math.hypot(p.x - q.x, p.y - q.y);
  }
  const h = Math.max(a.box.h, b.box.h);
  return n >= cfg.dupMinShared && h > 0 && sum / n < cfg.dupMaxMeanDist * h;
}

const meanVis = (p: Pose) => {
  const v = Object.values(p).map((l) => l?.visibility ?? 0);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
};

export class SubjectLockR5 {
  readonly cfg: R5LockConfig;
  protected state: LockState = 'searching';
  protected reason: LockReason | null = 'noOne';
  protected track: { box: Box; lastSeenMs: number; lastFullMs: number; standingRatio: number } | null = null;
  protected hold: { startBox: Box; box: Box; sinceMs: number; ratios: number[] } | null = null;
  protected lastT = -Infinity;

  constructor(config: Partial<R5LockConfig> = {}) {
    this.cfg = { ...R5_LOCK_CONFIG, ...config };
  }

  get currentState(): LockState {
    return this.state;
  }

  reset(): void {
    this.state = 'searching';
    this.reason = 'noOne';
    this.track = null;
    this.hold = null;
    this.lastT = -Infinity;
  }

  suspend(): void {
    this.hold = null;
    if (this.state === 'locked' || this.state === 'lost') {
      this.state = 'lost';
      this.reason = 'missing';
    } else {
      this.state = 'searching';
      this.reason = 'noOne';
    }
  }

  update(frame: PoseFrame): R5LockOutput {
    const t = frame.timestampMs;
    const base = {
      subjectBox: this.track?.box ?? this.hold?.box ?? null,
      standingRatio: this.track?.standingRatio ?? null,
    };
    if (!Number.isFinite(t) || t <= this.lastT) {
      return { state: this.state, reason: this.reason, subject: null, ...base, candidates: [], progress: 0, cause: 'outOfOrder', missing: [], held: false, merged: 0 };
    }
    this.lastT = t;
    const aspect = frame.aspect && frame.aspect > 0 ? frame.aspect : 1;
    const { cands, merged } = this.candidates(frame.poses);
    let r: { subject: Pose | null; cause: LossCause | null; missing: JointGroup[]; held: boolean; replay?: { timestampMs: number; subject: Pose }[] };
    if (this.state === 'searching' || this.state === 'acquiring') r = this.acquire(cands, t, aspect);
    else if (this.state === 'locked') r = this.follow(cands, t, aspect);
    else r = this.recover(cands, t, aspect);
    return {
      state: this.state,
      reason: this.reason,
      subject: r.subject,
      subjectBox: this.track?.box ?? this.hold?.box ?? null,
      standingRatio: this.track?.standingRatio ?? null,
      candidates: cands.map((c) => c.box),
      progress: this.progress(t),
      cause: r.subject ? null : r.cause,
      missing: r.missing,
      held: r.held,
      merged,
      ...(r.replay?.length ? { replay: r.replay } : {}),
    };
  }

  protected candidates(poses: Pose[]): { cands: Cand[]; merged: number } {
    const all: Cand[] = [];
    for (const pose of poses) {
      const box = poseBox(pose, this.cfg.minVisibility);
      if (!box) continue;
      const mv = this.cfg.minVisibility;
      const torso =
        !!(visiblePoint(pose, 'leftShoulder', mv) || visiblePoint(pose, 'rightShoulder', mv)) &&
        !!(visiblePoint(pose, 'leftHip', mv) || visiblePoint(pose, 'rightHip', mv));
      all.push({ pose, box, fullBody: isFullBody(pose, mv), torso, ratio: squatRatio(pose, mv) });
    }
    const out: Cand[] = [];
    let merged = 0;
    for (const c of all) {
      const i = out.findIndex((o) => sameBody(o, c, this.cfg));
      if (i < 0) out.push(c);
      else {
        merged += 1;
        if (meanVis(c.pose) > meanVis(out[i].pose)) out[i] = c;
      }
    }
    return { cands: out, merged };
  }

  protected dist(a: Box, b: Box, aspect: number): number {
    return Math.hypot((a.cx - b.cx) * aspect, a.cy - b.cy);
  }

  protected crowds(ref: Box, c: Cand, aspect: number): boolean {
    return boxIoU(ref, c.box) > this.cfg.ambiguityIoU || this.dist(ref, c.box, aspect) <= this.cfg.ambiguityGate * ref.h;
  }

  /** Squat-aware continuity test; returns null when it passes, else which gate rejected. */
  protected gate(ref: Box, c: Cand, aspect: number): 'associationScale' | 'associationPosition' | null {
    if (Math.abs(c.box.cx - ref.cx) * aspect > this.cfg.matchGateX * ref.h) return 'associationPosition';
    if (!c.fullBody) {
      // Torso-only: legs are missing, so its box height says nothing about scale; compare the top edge.
      if (Math.abs(c.box.minY - ref.minY) > this.cfg.matchGateY * ref.h) return 'associationPosition';
      return null;
    }
    const s = c.box.h / ref.h;
    if (s < this.cfg.scaleMin || s > this.cfg.scaleMax) return 'associationScale';
    if (Math.abs(c.box.cy - ref.cy) > this.cfg.matchGateY * ref.h) return 'associationPosition';
    return null;
  }

  protected matchesFrozenStyle(ref: Box, c: Cand, gate: number, aspect: number, smin: number, smax: number): boolean {
    if (!c.fullBody) return false;
    const s = c.box.h / ref.h;
    if (s < smin || s > smax) return false;
    return this.dist(ref, c.box, aspect) <= gate * ref.h;
  }

  protected none(cause: LossCause | null, missing: JointGroup[] = []) {
    return { subject: null, cause, missing, held: false };
  }

  protected acquire(cands: Cand[], t: number, aspect: number): StepResult {
    const q1 = cands.filter((c) => c.fullBody && c.box.h >= this.cfg.minBodyHeight && c.box.cx >= this.cfg.zoneMinX && c.box.cx <= this.cfg.zoneMaxX);
    const fail = (reason: LockReason, cause: LossCause | null = null, missing: JointGroup[] = []) => {
      this.state = 'searching';
      this.reason = reason;
      this.hold = null;
      return this.none(cause, missing);
    };
    if (q1.length > 1) return fail('twoPeople', 'ambiguous');
    if (q1.length === 0) {
      if (cands.length === 0) return fail('noOne', 'noPose');
      const big = cands.reduce((a, b) => (b.box.h > a.box.h ? b : a));
      if (!big.fullBody) {
        const clipped = clippedGroups(big.pose);
        return fail('notFullBody', clipped.length ? 'clipped' : 'lowConfidence', missingGroups(big.pose, this.cfg.minVisibility));
      }
      if (big.box.h < this.cfg.minBodyHeight) return fail('tooSmall');
      return fail('offCenter');
    }
    const q = q1[0];
    if (cands.some((c) => c !== q && this.crowds(q.box, c, aspect))) return fail('twoPeople', 'ambiguous');
    if (q.ratio === null || q.ratio < this.cfg.standingRatioMin) return fail('notStanding');
    if (this.holding(q, aspect)) {
      this.hold!.box = q.box;
      this.hold!.ratios.push(q.ratio);
    } else this.hold = { startBox: q.box, box: q.box, sinceMs: t, ratios: [q.ratio] };
    const hold = this.hold!;
    if (t - hold.sinceMs >= this.cfg.acquireMs) {
      const standingRatio = Math.min(2.6, Math.max(this.cfg.standingRatioMin, median(hold.ratios)));
      this.track = { box: q.box, lastSeenMs: t, lastFullMs: t, standingRatio };
      this.hold = null;
      this.state = 'locked';
      this.reason = null;
      return { subject: q.pose, cause: null, missing: [], held: false };
    }
    this.state = 'acquiring';
    this.reason = null;
    return this.none(null);
  }

  protected follow(cands: Cand[], t: number, aspect: number) {
    const track = this.track!;
    const credible = cands.filter((c) => c.torso || c.fullBody);
    let match: Cand | null = null;
    let bestD = Infinity;
    let rejected: 'associationScale' | 'associationPosition' | null = null;
    for (const c of credible) {
      const g = this.gate(track.box, c, aspect);
      if (g) {
        rejected = rejected ?? g;
        continue;
      }
      const d = this.dist(track.box, c.box, aspect);
      if (d < bestD) {
        bestD = d;
        match = c;
      }
    }
    const crowding = cands.filter((c) => c !== match && this.crowds(track.box, c, aspect));
    const intruder = match ? crowding.length > 0 : crowding.length > 1;
    if (intruder) {
      this.state = 'lost';
      this.reason = 'ambiguous';
      return this.none('ambiguous');
    }
    if (match && match.fullBody) {
      track.box = match.box;
      track.lastSeenMs = t;
      track.lastFullMs = t;
      return { subject: match.pose, cause: null, missing: [], held: false };
    }
    if (match) {
      // Identity continues on a torso-only observation: no subject, so no count sample.
      const missing = missingGroups(match.pose, this.cfg.minVisibility);
      const cause: LossCause = clippedGroups(match.pose).length ? 'clipped' : 'lowConfidence';
      if (t - track.lastFullMs > this.cfg.identityGraceMs) {
        this.state = 'lost';
        this.reason = 'missing';
        return this.none(cause, missing);
      }
      track.lastSeenMs = t; // box kept from the last full-body observation
      return { subject: null, cause, missing, held: true };
    }
    let cause: LossCause = 'noPose';
    let missing: JointGroup[] = [];
    if (rejected) cause = rejected;
    else if (cands.length > 0) {
      const near = cands.reduce((a, b) => (this.dist(track.box, b.box, aspect) < this.dist(track.box, a.box, aspect) ? b : a));
      missing = missingGroups(near.pose, this.cfg.minVisibility);
      cause = clippedGroups(near.pose).length ? 'clipped' : 'lowConfidence';
    }
    if (t - track.lastSeenMs > this.cfg.lostAfterMs) {
      this.state = 'lost';
      this.reason = 'missing';
    }
    return this.none(cause, missing);
  }

  protected recover(cands: Cand[], t: number, aspect: number) {
    const track = this.track!;
    if (t - track.lastSeenMs > this.cfg.forgetAfterMs) {
      this.reset();
      return this.acquire(cands, t, aspect);
    }
    const near = cands.filter((c) =>
      this.matchesFrozenStyle(track.box, c, this.cfg.reacquireGate, aspect, this.cfg.reacquireScaleMin, this.cfg.reacquireScaleMax),
    );
    if (near.length !== 1) {
      this.reason = near.length > 1 ? 'ambiguous' : 'missing';
      this.hold = null;
      if (near.length > 1) return this.none('ambiguous');
      if (cands.length === 0) return this.none('noPose');
      const n = cands[0];
      return this.none(n.fullBody ? 'associationPosition' : clippedGroups(n.pose).length ? 'clipped' : 'lowConfidence', missingGroups(n.pose, this.cfg.minVisibility));
    }
    const m = near[0];
    if (cands.some((c) => c !== m && this.crowds(m.box, c, aspect))) {
      this.reason = 'ambiguous';
      this.hold = null;
      return this.none('ambiguous');
    }
    if (this.holding(m, aspect)) this.hold!.box = m.box;
    else this.hold = { startBox: m.box, box: m.box, sinceMs: t, ratios: [] };
    if (t - this.hold!.sinceMs >= this.cfg.reacquireMs) {
      track.box = m.box;
      track.lastSeenMs = t;
      track.lastFullMs = t;
      this.hold = null;
      this.state = 'locked';
      this.reason = null;
      return { subject: m.pose, cause: null, missing: [], held: false };
    }
    return this.none(null);
  }

  protected holding(c: Cand, aspect: number): boolean {
    const hold = this.hold;
    if (!hold) return false;
    if (!this.matchesFrozenStyle(hold.box, c, 0.35, aspect, 0.7, 1.4)) return false;
    return this.dist(hold.startBox, c.box, aspect) <= this.cfg.holdStillGate * hold.startBox.h;
  }

  protected progress(t: number): number {
    if (!this.hold) return this.state === 'locked' ? 1 : 0;
    const need = this.state === 'lost' ? this.cfg.reacquireMs : this.cfg.acquireMs;
    return Math.max(0, Math.min(1, (t - this.hold.sinceMs) / need));
  }
}
