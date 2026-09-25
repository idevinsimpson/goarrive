import {
  DEFAULT_MIN_VISIBILITY,
  boxIoU,
  isFullBody,
  median,
  poseBox,
  squatRatio,
} from './geometry';
import type { Box, Pose, PoseFrame } from './types';

/**
 * THE ACTIVE-MOVER LOCK.
 *
 * The engine hands back an unordered list of people with no identity. This
 * module decides which one of them (if any) is "the member", and it is built
 * to refuse rather than guess:
 *
 *   searching  → nobody qualifies yet ("step into frame")
 *   acquiring  → exactly one person qualifies; hold for `acquireMs`
 *   locked     → counting is allowed, frame by frame, only for the matched person
 *   lost       → counting is paused ("lost you / step back into frame")
 *
 * STRATEGY: SPATIAL CONTINUITY, NOT IDENTITY. There is no face recognition and
 * no appearance model. The locked person is whoever continues the locked
 * track: centre within a gate scaled to their own body height, and body size
 * within a ratio of the last frame. A passerby elsewhere in frame never
 * matches the gate, so they are ignored. A person who comes CLOSE to the
 * track (overlapping box, or centre inside the wider ambiguity gate) makes the
 * frame ambiguous, and ambiguity drops to `lost` immediately — it does not
 * pick the likelier one.
 *
 * ACQUISITION IS DELIBERATELY STRICT: exactly one full-body person, big enough,
 * in the central zone, standing tall, steady for `acquireMs`. Two qualifying
 * people means no lock at all. Standing is required so the squat counter's
 * baseline (the member's own standing ratio) is measured on a standing body.
 *
 * WHAT IT CANNOT DO (see docs/westayfit/movement-vision/LIMITATIONS.md): if the
 * member leaves and a different person steps into the same spot, at the same
 * apparent size, inside `forgetAfterMs`, that person is re-acquired. Without
 * identity, "same place, same size" is the whole of the evidence.
 */

export type LockState = 'searching' | 'acquiring' | 'locked' | 'lost';

export type LockReason =
  | 'noOne'
  | 'notFullBody'
  | 'tooSmall'
  | 'offCenter'
  | 'notStanding'
  | 'twoPeople'
  | 'missing'
  | 'ambiguous';

export interface SubjectLockConfig {
  minVisibility: number;
  /** Body box height as a fraction of frame height, to acquire. */
  minBodyHeight: number;
  /** The movement zone: acquisition centre must be inside [zoneMinX, zoneMaxX]. */
  zoneMinX: number;
  zoneMaxX: number;
  /** The squat ratio (see geometry.squatRatio) that reads as "standing tall". */
  standingRatioMin: number;
  acquireMs: number;
  /** Frame-to-frame match: centre distance ≤ gate × tracked body height. */
  matchGate: number;
  /** Frame-to-frame match: new height / tracked height within [min, max]. */
  scaleMin: number;
  scaleMax: number;
  /** Anyone else whose centre is within this × body height, or whose box overlaps. */
  ambiguityGate: number;
  ambiguityIoU: number;
  /**
   * While acquiring or re-acquiring, the person must hold still: centre drift
   * from where the hold started ≤ this × body height. Someone walking through
   * the spot never holds still long enough to be taken for the member.
   */
  holdStillGate: number;
  /** Two detections overlapping this much are one person reported twice. */
  duplicateIoU: number;
  /** A locked subject missing this long is `lost`. Shorter gaps are dropouts. */
  lostAfterMs: number;
  /** From `lost`, the gate is wider (they may have shifted) … */
  reacquireGate: number;
  /**
   * … and the size window is wider, because the member may have been lost
   * at the bottom of a squat (a shorter box) and come back standing.
   */
  reacquireScaleMin: number;
  reacquireScaleMax: number;
  /** … and the single matching person must hold this long. */
  reacquireMs: number;
  /** Lost longer than this, the track is forgotten and acquisition starts over. */
  forgetAfterMs: number;
}

export const DEFAULT_LOCK_CONFIG: SubjectLockConfig = {
  minVisibility: DEFAULT_MIN_VISIBILITY,
  minBodyHeight: 0.3,
  zoneMinX: 0.2,
  zoneMaxX: 0.8,
  standingRatioMin: 1.6,
  acquireMs: 600,
  matchGate: 0.35,
  scaleMin: 0.7,
  scaleMax: 1.4,
  ambiguityGate: 0.35,
  ambiguityIoU: 0.1,
  holdStillGate: 0.15,
  duplicateIoU: 0.7,
  lostAfterMs: 300,
  reacquireGate: 0.6,
  reacquireScaleMin: 0.6,
  reacquireScaleMax: 1.6,
  reacquireMs: 400,
  forgetAfterMs: 4000,
};

export interface LockOutput {
  state: LockState;
  reason: LockReason | null;
  /** The locked person's pose THIS frame, or null (not locked, or a dropout frame). */
  subject: Pose | null;
  /** Last known box of the tracked person, for the overlay. */
  subjectBox: Box | null;
  /** The member's own standing ratio, measured during acquisition. */
  standingRatio: number | null;
  /** Every detected person this frame, for the debug overlay. */
  candidates: Box[];
  /** 0..1 while acquiring or re-acquiring. */
  progress: number;
}

interface Candidate {
  pose: Pose;
  box: Box;
  fullBody: boolean;
  ratio: number | null;
}

interface Track {
  box: Box;
  lastSeenMs: number;
  standingRatio: number;
}

interface Hold {
  startBox: Box;
  box: Box;
  sinceMs: number;
  ratios: number[];
}

export class SubjectLock {
  private readonly cfg: SubjectLockConfig;
  private state: LockState = 'searching';
  private reason: LockReason | null = 'noOne';
  private track: Track | null = null;
  private hold: Hold | null = null;

  constructor(config: Partial<SubjectLockConfig> = {}) {
    this.cfg = { ...DEFAULT_LOCK_CONFIG, ...config };
  }

  get currentState(): LockState {
    return this.state;
  }

  reset(): void {
    this.state = 'searching';
    this.reason = 'noOne';
    this.track = null;
    this.hold = null;
  }

  update(frame: PoseFrame): LockOutput {
    const t = frame.timestampMs;
    const aspect = frame.aspect && frame.aspect > 0 ? frame.aspect : 1;
    const cands = this.candidates(frame.poses);
    let subject: Pose | null = null;

    if (this.state === 'searching' || this.state === 'acquiring') {
      subject = this.acquire(cands, t, aspect);
    } else if (this.state === 'locked') {
      subject = this.follow(cands, t, aspect);
    } else {
      subject = this.recover(cands, t, aspect);
    }

    return {
      state: this.state,
      reason: this.reason,
      subject,
      subjectBox: this.track?.box ?? this.hold?.box ?? null,
      standingRatio: this.track?.standingRatio ?? null,
      candidates: cands.map((c) => c.box),
      progress: this.progress(t),
    };
  }

  private candidates(poses: Pose[]): Candidate[] {
    const all: Candidate[] = [];
    for (const pose of poses) {
      const box = poseBox(pose, this.cfg.minVisibility);
      if (!box) continue;
      all.push({
        pose,
        box,
        fullBody: isFullBody(pose, this.cfg.minVisibility),
        ratio: squatRatio(pose, this.cfg.minVisibility),
      });
    }
    // One person reported twice: keep the more complete detection.
    all.sort((a, b) => Number(b.fullBody) - Number(a.fullBody) || b.box.h - a.box.h);
    const kept: Candidate[] = [];
    for (const c of all) {
      if (kept.some((k) => boxIoU(k.box, c.box) >= this.cfg.duplicateIoU)) continue;
      kept.push(c);
    }
    return kept;
  }

  private distance(a: Box, b: Box, aspect: number): number {
    const dx = (a.cx - b.cx) * aspect;
    const dy = a.cy - b.cy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private matches(
    ref: Box,
    c: Candidate,
    gate: number,
    aspect: number,
    scaleMin = this.cfg.scaleMin,
    scaleMax = this.cfg.scaleMax,
  ): boolean {
    if (!c.fullBody) return false;
    const scale = c.box.h / ref.h;
    if (scale < scaleMin || scale > scaleMax) return false;
    return this.distance(ref, c.box, aspect) <= gate * ref.h;
  }

  private crowds(ref: Box, c: Candidate, aspect: number): boolean {
    return (
      boxIoU(ref, c.box) > this.cfg.ambiguityIoU ||
      this.distance(ref, c.box, aspect) <= this.cfg.ambiguityGate * ref.h
    );
  }

  /** searching / acquiring */
  private acquire(cands: Candidate[], t: number, aspect: number): Pose | null {
    const qualifying = cands.filter(
      (c) =>
        c.fullBody &&
        c.box.h >= this.cfg.minBodyHeight &&
        c.box.cx >= this.cfg.zoneMinX &&
        c.box.cx <= this.cfg.zoneMaxX,
    );

    const fail = (reason: LockReason): null => {
      this.state = 'searching';
      this.reason = reason;
      this.hold = null;
      return null;
    };

    if (qualifying.length > 1) return fail('twoPeople');
    if (qualifying.length === 0) {
      if (cands.length === 0) return fail('noOne');
      const biggest = cands.reduce((a, b) => (b.box.h > a.box.h ? b : a));
      if (!biggest.fullBody) return fail('notFullBody');
      if (biggest.box.h < this.cfg.minBodyHeight) return fail('tooSmall');
      return fail('offCenter');
    }

    const q = qualifying[0];
    if (cands.some((c) => c !== q && this.crowds(q.box, c, aspect))) return fail('twoPeople');
    if (q.ratio === null || q.ratio < this.cfg.standingRatioMin) return fail('notStanding');

    if (this.holding(q, aspect)) {
      this.hold!.box = q.box;
      this.hold!.ratios.push(q.ratio);
    } else {
      this.hold = { startBox: q.box, box: q.box, sinceMs: t, ratios: [q.ratio] };
    }
    const hold = this.hold!;

    if (t - hold.sinceMs >= this.cfg.acquireMs) {
      const standingRatio = Math.min(2.6, Math.max(this.cfg.standingRatioMin, median(hold.ratios)));
      this.track = { box: q.box, lastSeenMs: t, standingRatio };
      this.hold = null;
      this.state = 'locked';
      this.reason = null;
      return q.pose;
    }
    this.state = 'acquiring';
    this.reason = null;
    return null;
  }

  /** locked */
  private follow(cands: Candidate[], t: number, aspect: number): Pose | null {
    const track = this.track!;
    const match = this.best(track.box, cands, this.cfg.matchGate, aspect);
    const crowding = cands.filter((c) => c !== match && this.crowds(track.box, c, aspect));
    // With a match, anyone else close is an intruder. Without one, a single
    // close detection is most likely the member seen badly (legs cut off,
    // turned away): a dropout, not a crowd. Two or more is a crowd either way.
    const intruder = match ? crowding.length > 0 : crowding.length > 1;

    if (intruder) {
      this.state = 'lost';
      this.reason = 'ambiguous';
      return null;
    }
    if (match) {
      track.box = match.box;
      track.lastSeenMs = t;
      return match.pose;
    }
    if (t - track.lastSeenMs > this.cfg.lostAfterMs) {
      this.state = 'lost';
      this.reason = 'missing';
    }
    return null;
  }

  /** lost */
  private recover(cands: Candidate[], t: number, aspect: number): Pose | null {
    const track = this.track!;
    if (t - track.lastSeenMs > this.cfg.forgetAfterMs) {
      this.reset();
      return this.acquire(cands, t, aspect);
    }
    const near = cands.filter((c) =>
      this.matches(
        track.box,
        c,
        this.cfg.reacquireGate,
        aspect,
        this.cfg.reacquireScaleMin,
        this.cfg.reacquireScaleMax,
      ),
    );
    if (near.length !== 1) {
      this.reason = near.length > 1 ? 'ambiguous' : 'missing';
      this.hold = null;
      return null;
    }
    const m = near[0];
    if (cands.some((c) => c !== m && this.crowds(m.box, c, aspect))) {
      this.reason = 'ambiguous';
      this.hold = null;
      return null;
    }
    if (this.holding(m, aspect)) {
      this.hold!.box = m.box;
    } else {
      this.hold = { startBox: m.box, box: m.box, sinceMs: t, ratios: [] };
    }
    if (t - this.hold!.sinceMs >= this.cfg.reacquireMs) {
      track.box = m.box;
      track.lastSeenMs = t;
      this.hold = null;
      this.state = 'locked';
      this.reason = null;
      return m.pose;
    }
    return null;
  }

  /** Is `c` continuing the current hold, and still where the hold began? */
  private holding(c: Candidate, aspect: number): boolean {
    const hold = this.hold;
    if (!hold) return false;
    if (!this.matches(hold.box, c, this.cfg.matchGate, aspect)) return false;
    return this.distance(hold.startBox, c.box, aspect) <= this.cfg.holdStillGate * hold.startBox.h;
  }

  private best(ref: Box, cands: Candidate[], gate: number, aspect: number): Candidate | null {
    let best: Candidate | null = null;
    let bestD = Infinity;
    for (const c of cands) {
      if (!this.matches(ref, c, gate, aspect)) continue;
      const d = this.distance(ref, c.box, aspect);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  private progress(t: number): number {
    if (!this.hold) return this.state === 'locked' ? 1 : 0;
    const need = this.state === 'lost' ? this.cfg.reacquireMs : this.cfg.acquireMs;
    return Math.max(0, Math.min(1, (t - this.hold.sinceMs) / need));
  }
}
