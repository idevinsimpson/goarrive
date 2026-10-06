// R13 MOTION-PHASE + OCCLUSION-RESYNC counter — COMPARISON-ONLY (never wired live).
//
// A squat is an OBSERVED temporal phase sequence of the tracked skeleton's depth signal, not a pass
// under one absolute "standing" number:
//
//   top ──(observed descent from an observed local minimum)──▶ down
//   down ──(credible bottom reversal: sustained fall back from the observed peak)──▶ up
//   up ──(this cycle's range recovered AND (new descent | plateau))──▶ +1 ──▶ down | top
//   up ──(re-lowered before recovery)──▶ down (rebottom, no count)
//
// Signals: 3-sample median of the observed depth (kills one-frame spikes) plus its direction, with
// hysteresis (revEps) confirmed over `dirSamples` consecutive samples. Anchors adapt per track:
// `upright` (recent observed tops) and `rangeScale` (median observed range of counted cycles).
//
// Three concepts are kept separate:
//   1. track continuity  — owned by the tracker (see r13/occlusionContinuity.ts); the counter only
//      receives interrupt() (short loss of the SAME track) vs resetCalibration()/reset() (new track/run).
//   2. calibration       — upright + rangeScale; SURVIVES a short interrupt (≤ maxOcclusionMs).
//   3. partial-rep state — ALWAYS voided by an interrupt / null sample / freshness gap.
// After an interrupt with preserved calibration the counter enters RESYNC: the first incomplete
// movement is discarded (a cycle may only start from a local minimum OBSERVED after reacquisition),
// then the next complete observed cycle counts normally — no absolute top re-establishment needed.
// Nothing hidden is ever inferred: a transition that happened while unobserved is never counted.
import { R12_CONFIG } from '../r12/naturalCounterR12';
import type { NaturalOutput, NaturalSample, Reject, Stage } from '../r6/naturalCounter';

export type R13Phase = 'uncalibrated' | 'top' | 'down' | 'up' | 'resync';
export interface R13Config {
  /** Absolute upright line, used ONLY to calibrate a fresh track at set start. */
  calibTop: number; confirmSamples: number;
  /** Hysteresis for every direction change (depth units) and its confirmation length. */
  revEps: number; dirSamples: number;
  /** Plateau = this many samples within plateauEps of the ascent's lowest point. */
  plateauSamples: number; plateauEps: number;
  /** Required observed range: peak ≥ max(lowFloor, cycleStart+minRange, min(downDepth, scaleFrac·rangeScale)). */
  minRange: number; lowFloor: number; downDepth: number; scaleFrac: number;
  /** Fraction of THIS cycle's observed range that must be recovered for a top. */
  recoverFrac: number;
  /** A cycle's top must lie in the upper part of the track's own range: ≤ upright + topFrac·rangeScale (min topSlackMin). */
  topFrac: number; topSlackMin: number;
  partialDepth: number; minPartialRise: number;
  minTorso: number; minRepMs: number; minCycleMs: number;
  /** Calibration survives an interrupt for at most this long; longer → recalibrate from scratch. */
  maxOcclusionMs: number;
  /** Two consecutive observed samples further apart than this void the partial (freshness). */
  maxGapMs: number;
}
export const R13_CONFIG: R13Config = {
  calibTop: R12_CONFIG.topDepth, confirmSamples: R12_CONFIG.confirmSamples,
  revEps: 0.06, dirSamples: 2, plateauSamples: 3, plateauEps: 0.03,
  minRange: R12_CONFIG.minDrop, lowFloor: R12_CONFIG.lowFloor, downDepth: R12_CONFIG.downDepth, scaleFrac: R12_CONFIG.scaleFrac,
  recoverFrac: 0.5, topFrac: 0.4, topSlackMin: 0.3,
  partialDepth: R12_CONFIG.partialDepth, minPartialRise: R12_CONFIG.minPartialRise,
  minTorso: R12_CONFIG.minTorso, minRepMs: R12_CONFIG.minRepMs, minCycleMs: R12_CONFIG.minCycleMs,
  maxOcclusionMs: 3000, maxGapMs: 500,
};
export const R13_REVISION = 'r13.0-comparison-only';
export const R13_LABEL = 'Motion-phase + occlusion resync: r13 (comparison only)';

export type R13EventKind = 'calibrated' | 'lost' | 'calibrationPreserved' | 'calibrationExpired' | 'resyncStart' | 'resyncCycle' | 'partialVoided' | 'rep' | 'reset' | 'gap' | 'outOfOrder';
export interface R13Event { t: number | null; kind: R13EventKind; detail?: string }

export class NaturalSquatCounterR13 {
  readonly cfg: R13Config;
  private reps = 0;
  private partials = 0;
  private phase: R13Phase = 'uncalibrated';
  // calibration (survives a short interrupt)
  private upright: number | null = null;
  private ranges: number[] = [];
  // signal
  private raw: number[] = [];
  private lastT: number | null = null;
  private lastObsT: number | null = null;
  private lostAt: number | null = null;
  private pendingLoss = false;
  // phase state (partial-rep evidence; voided on interrupt)
  private trough = Infinity;
  private troughIdx = -1;
  private sampleIdx = 0;
  private resyncFrom = -1;
  private cycleStart = 0;
  private cycleT = 0;
  private peak = 0;
  /** Deepest observed point of the whole cycle (peak is the current lobe's). */
  private cycleMax = 0;
  private stillRun = 0;
  private stillMax = 0;
  private bottomed = false;
  private uprightRun = 0;
  private peakRun = 0;
  private dirRun = 0;
  private plateauRun = 0;
  private calibRun = 0;
  private folded = false;
  private lastRepMs = -Infinity;
  private resyncCycle = false;
  /** Write-only analysis log (bounded); never read by the rules. */
  readonly events: R13Event[] = [];

  constructor(cfg: Partial<R13Config> = {}) { this.cfg = { ...R13_CONFIG, ...cfg }; }

  get count() { return this.reps; }
  get currentPhase(): R13Phase { return this.phase; }
  get currentStage(): Stage { return toStage(this.phase); }
  get calibration() { return { upright: this.upright, rangeScale: this.rangeScale() }; }

  private log(t: number | null, kind: R13EventKind, detail?: string) { if (this.events.length < 5000) this.events.push({ t, kind, detail }); }

  /** Short loss of the SAME track: void the partial, keep calibration, resync on return. */
  interrupt(): Reject | null {
    const mid = this.phase === 'down' || this.phase === 'up';
    this.voidPartial();
    if (this.upright !== null) { if (!this.pendingLoss) this.lostAt = this.lastObsT; this.phase = 'resync'; this.pendingLoss = true; }
    else this.phase = 'uncalibrated';
    if (mid) this.log(this.lastObsT, 'partialVoided');
    return mid ? 'interrupted' : null;
  }

  /** New track (replacement / expiry): nothing of the previous subject is inherited except the set total. */
  resetCalibration(): void {
    this.voidPartial();
    this.upright = null; this.ranges = []; this.phase = 'uncalibrated'; this.lostAt = null; this.pendingLoss = false;
  }

  /** New camera run. */
  reset(): void {
    this.resetCalibration();
    this.reps = this.partials = 0; this.lastRepMs = -Infinity;
    this.log(null, 'reset');
  }

  private voidPartial() {
    this.raw = []; this.trough = Infinity; this.troughIdx = -1; this.peak = 0; this.peakRun = 0;
    this.dirRun = 0; this.plateauRun = 0; this.calibRun = 0; this.folded = false; this.resyncCycle = false; this.cycleMax = 0; this.stillRun = 0; this.stillMax = 0; this.bottomed = false;
  }

  private rangeScale(): number {
    if (!this.ranges.length) return 0;
    const v = [...this.ranges].sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  }
  private lowLine(): number {
    const c = this.cfg;
    return Math.max(c.lowFloor, this.cycleStart + c.minRange, Math.min(c.downDepth, c.scaleFrac * this.rangeScale()));
  }
  /** Upper part of the track's own range: counted-cycle median, or this cycle's observed range before any count. */
  private topLimit(): number {
    const c = this.cfg;
    const scale = this.rangeScale() || Math.max(0, this.cycleMax - this.cycleStart);
    return (this.upright ?? c.calibTop) + Math.max(c.topSlackMin, c.topFrac * scale);
  }

  update(sm: NaturalSample): NaturalOutput {
    const r = this.step(sm);
    return { reps: this.reps, partials: this.partials, phase: toStage(this.phase) === 'unknown' ? 'unknown' : this.phase === 'top' ? 'up' : this.phase === 'up' ? 'rising' : 'down', stage: toStage(this.phase), event: r.event, reject: r.reject } as NaturalOutput;
  }

  private step({ timestampMs: t, depth, torso }: NaturalSample): { event: 'rep' | 'partial' | null; reject: Reject | null } {
    const none = { event: null, reject: null } as const;
    const c = this.cfg;
    if (this.lastT !== null && !(t > this.lastT)) { this.log(t, 'outOfOrder'); return none; } // replayed/out-of-order timestamp: ignored
    if (depth === null || !Number.isFinite(depth)) {
      const rj = this.phase === 'resync' || this.phase === 'uncalibrated' ? null : this.interrupt();
      if (this.phase === 'uncalibrated') this.voidPartial();
      this.lastT = t;
      return { event: null, reject: rj };
    }
    // Freshness: a long gap between observed samples voids the partial (calibration kept if short).
    let rj: Reject | null = null;
    if (this.lastT !== null && t - this.lastT > c.maxGapMs && this.phase !== 'uncalibrated' && !this.pendingLoss) {
      this.log(t, 'gap', `${Math.round(t - this.lastT)}ms`);
      rj = this.interrupt();
    }
    if (this.pendingLoss || (this.phase === 'resync' && this.lostAt !== null)) {
      const gone = this.lostAt === null ? 0 : t - this.lostAt;
      this.log(this.lostAt, 'lost');
      if (gone > c.maxOcclusionMs) { this.log(t, 'calibrationExpired', `${Math.round(gone)}ms`); this.resetCalibration(); }
      else { this.log(t, 'calibrationPreserved', `${Math.round(gone)}ms`); this.log(t, 'resyncStart'); this.phase = 'resync'; this.resyncFrom = this.sampleIdx; this.stillMax = 0; this.stillRun = 0; }
      this.pendingLoss = false; this.lostAt = null;
    }
    this.lastT = t; this.lastObsT = t;
    this.sampleIdx += 1;
    this.raw.push(depth);
    if (this.raw.length > 3) this.raw.shift();
    const s = this.raw.length < 3 ? depth : median3(this.raw);
    const folded = torso !== undefined && (torso === null || !Number.isFinite(torso) || torso < c.minTorso);

    switch (this.phase) {
      case 'uncalibrated': {
        this.calibRun = s <= c.calibTop ? this.calibRun + 1 : 0;
        if (this.calibRun >= c.confirmSamples) {
          this.upright = s; this.phase = 'top'; this.trough = s; this.troughIdx = this.sampleIdx; this.dirRun = 0;
          this.log(t, 'calibrated', s.toFixed(3));
        }
        return { event: null, reject: rj };
      }
      case 'resync':
      case 'top': {
        if (s < this.trough) { this.trough = s; this.troughIdx = this.sampleIdx; this.dirRun = 0; this.stillRun = 0; return { event: null, reject: rj }; }
        this.stillRun = s <= this.trough + c.plateauEps ? this.stillRun + 1 : 0;
        if (this.stillRun > this.stillMax) this.stillMax = this.stillRun;
        this.dirRun = s >= this.trough + c.revEps ? this.dirRun + 1 : 0;
        if (this.dirRun >= c.dirSamples) {
          // Resync: the local minimum must have been OBSERVED after reacquisition (seen falling to it),
          // so a movement already under way at reacquisition is discarded, never completed.
          // (falling to it, or held still at it for plateauSamples).
          const observedMin = this.phase === 'top' || this.troughIdx > this.resyncFrom + 1 || this.stillMax >= c.plateauSamples;
          if (observedMin && this.trough <= this.topLimit()) {
            this.resyncCycle = this.phase === 'resync';
            if (this.resyncCycle) this.log(t, 'resyncCycle', `from ${this.trough.toFixed(3)}`);
            this.startDescent(t, s, folded);
          } else { this.trough = s; this.troughIdx = this.sampleIdx; }
          this.dirRun = 0;
        }
        return { event: null, reject: rj };
      }
      case 'down': {
        if (folded && s >= this.lowLine()) this.folded = true;
        if (s > this.peak) { this.peak = s; this.dirRun = 0; }
        if (s > this.cycleMax) this.cycleMax = s;
        this.peakRun = s >= this.lowLine() ? this.peakRun + 1 : this.peakRun;
        this.dirRun = s <= this.peak - c.revEps ? this.dirRun + 1 : 0;
        if (this.dirRun >= c.dirSamples) {
          this.dirRun = 0;
          if (this.peakRun >= c.confirmSamples || this.bottomed) { this.bottomed = true; this.uprightRun = 0; this.phase = 'up'; this.trough = s; this.troughIdx = this.sampleIdx; this.plateauRun = 0; return { event: null, reject: rj }; }
          // Reversed without a credible bottom: partial (never a rep).
          const ex = this.cycleMax, rose = ex - this.cycleStart >= c.minPartialRise;
          this.phase = 'top'; this.trough = s; this.troughIdx = this.sampleIdx; this.resyncCycle = false;
          if (ex >= c.partialDepth && rose) { this.partials += 1; return { event: 'partial', reject: 'notDeep' }; }
          return { event: null, reject: rj };
        }
        return { event: null, reject: rj };
      }
      case 'up': {
        if (s < this.trough) { this.trough = s; this.troughIdx = this.sampleIdx; this.plateauRun = 0; this.dirRun = 0; }
        else this.plateauRun = s <= this.trough + c.plateauEps ? this.plateauRun + 1 : 0;
        const recovered = this.peak - this.trough >= c.recoverFrac * (this.peak - this.cycleStart) && this.trough <= this.topLimit();
        this.dirRun = s >= this.trough + c.revEps ? this.dirRun + 1 : 0;
        const newDescent = this.dirRun >= c.dirSamples;
        // Observed back in the track's calibrated standing region (sufficient, never necessary).
        this.uprightRun = s <= Math.max(c.calibTop, (this.upright ?? 0) + c.plateauEps) ? this.uprightRun + 1 : 0;
        if (recovered && (newDescent || this.plateauRun >= c.plateauSamples || this.uprightRun >= c.confirmSamples)) {
          const out = this.complete(t);
          if (newDescent) this.startDescent(t, s, folded); else { this.phase = 'top'; this.dirRun = 0; }
          return out.event || out.reject ? out : { event: null, reject: rj };
        }
        if (newDescent) { // re-lowered before recovering this cycle's range: rebottom, no count
          const fell = this.peak - this.trough;
          this.phase = 'down'; this.dirRun = 0; this.peak = s; this.peakRun = 0; // new lobe within the same cycle
          return { event: null, reject: fell >= c.minPartialRise ? 'notTall' : rj };
        }
        return { event: null, reject: rj };
      }
    }
  }

  private startDescent(t: number, s: number, folded: boolean) {
    this.phase = 'down'; this.cycleStart = this.trough; this.cycleT = t; this.peak = s; this.cycleMax = s; this.peakRun = 0; this.bottomed = false; this.folded = folded && s >= this.lowLine();
  }

  private complete(t: number): { event: 'rep' | null; reject: Reject | null } {
    const c = this.cfg;
    const range = this.cycleMax - this.cycleStart;
    const top = this.trough;
    if (this.folded) return { event: null, reject: 'geometry' };
    if (t - this.cycleT < c.minCycleMs || t - this.lastRepMs < c.minRepMs) return { event: null, reject: 'minRep' };
    this.reps += 1; this.lastRepMs = t;
    this.ranges.push(range); if (this.ranges.length > 5) this.ranges.shift();
    // Adaptive upright anchor: blend toward this cycle's observed top (bounded so it cannot drift deep).
    if (this.upright !== null) this.upright = Math.min(this.upright * 0.7 + top * 0.3, c.calibTop);
    this.log(t, 'rep', `${this.resyncCycle ? 'resync ' : ''}range ${range.toFixed(3)}`);
    this.resyncCycle = false;
    this.trough = top;
    return { event: 'rep', reject: null };
  }
}

const median3 = (v: number[]) => { const [a, b, c] = v; return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c)); };
export function toStage(p: R13Phase): Stage {
  return p === 'top' ? 'ready' : p === 'down' ? 'descending' : p === 'up' ? 'ascending' : 'unknown';
}
