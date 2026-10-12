// REP-COUNTER-PROOF-1-r6 EXPERIMENTAL natural-squat counter. Lives beside the frozen
// core/squatCounter.ts (unchanged) and is A/B-selectable in the lab.
//
// Same input signal as the frozen counter (depth: 0 = own calibrated standing, 1 = hip at knee
// height, from core/geometry) plus an optional body-relative torso value (hip-to-shoulder height
// in shin lengths) used ONLY to refuse a bend-over at the bottom.
//
// Trajectory, not dwell:
//   unknown ──(confirm top)──▶ ready ─▶ descending ──(confirm bottom)──▶ bottom ─▶ ascending
//      ▲                                                                              │
//      └──── ready ◀──(confirm top AND rose ≥ minRise from the deepest observed point) ┘ +1
// "Confirm" = `confirmSamples` consecutive OBSERVED samples in the zone (no time dwell). One noisy
// frame never confirms a zone. Nothing is interpolated: a null sample mid-cycle voids the cycle,
// exactly like the frozen counter. minRepMs is only a duplicate-count guard; a full traversal is
// already required, so it does not limit any human pace up to ~240/min.
export type Stage = 'unknown' | 'ready' | 'descending' | 'bottom' | 'ascending';
export type Reject =
  | 'noStanding' // movement seen before a standing/ready posture was established
  | 'notDeep' // went down and came back up without reaching the bottom zone
  | 'notTall' // came up from the bottom, stopped short of the top zone, went back down
  | 'downBrief' // bottom zone touched in fewer samples than needed (frozen: dwell not met)
  | 'upBrief' // top zone touched in fewer samples than needed (frozen: dwell not met)
  | 'minRep' // otherwise valid completion blocked by the minimum rep interval
  | 'geometry' // deep enough but torso folded (bend-over) or torso landmarks unusable
  | 'interrupted'; // unobserved frame / freshness gap / lock loss voided a cycle in progress

export interface NaturalConfig {
  topDepth: number;
  downDepth: number;
  minRise: number;
  partialDepth: number;
  confirmSamples: number;
  minRepMs: number;
  minTorso: number;
  /** Physical-plausibility floor for one whole cycle (leave top → confirm top). Record pace is ~577 ms. */
  minCycleMs: number;
}

export const R6_CONFIG: NaturalConfig = {
  topDepth: 0.4,
  downDepth: 0.55,
  minRise: 0.35,
  partialDepth: 0.3,
  confirmSamples: 2,
  minRepMs: 250,
  minTorso: 0.35,
  minCycleMs: 150,
};

export interface NaturalSample { timestampMs: number; depth: number | null; torso?: number | null }
export interface NaturalOutput {
  reps: number;
  partials: number;
  phase: 'unknown' | 'standing' | 'down';
  event: 'rep' | 'partial' | null;
  stage: Stage;
  reject: Reject | null;
}

export class NaturalSquatCounter {
  readonly cfg: NaturalConfig;
  private reps = 0;
  private partials = 0;
  private stage: Stage = 'unknown';
  private topRun = 0;
  private bottomRun = 0;
  private excursion = 0;
  private peak = 0;
  private ascMin = Infinity;
  private lastRepMs = -Infinity;
  private flaggedNoStanding = false;
  private flaggedGeometry = false;
  private folded = false;
  private cycleStart = -Infinity;

  constructor(cfg: Partial<NaturalConfig> = {}) {
    this.cfg = { ...R6_CONFIG, ...cfg };
    if (!(this.cfg.downDepth > this.cfg.topDepth)) throw new Error('downDepth must exceed topDepth');
    if (this.cfg.confirmSamples < 1) throw new Error('confirmSamples must be ≥ 1');
  }

  get count() { return this.reps; }
  get currentStage() { return this.stage; }
  get currentPhase(): NaturalOutput['phase'] { return phaseOf(this.stage); }

  interrupt(): Reject | null {
    const mid = this.stage === 'descending' || this.stage === 'bottom' || this.stage === 'ascending';
    this.stage = 'unknown';
    this.topRun = this.bottomRun = 0;
    this.excursion = this.peak = 0;
    this.ascMin = Infinity;
    this.flaggedNoStanding = false;
    this.flaggedGeometry = false;
    this.folded = false;
    return mid ? 'interrupted' : null;
  }

  reset(): void {
    this.interrupt();
    this.reps = this.partials = 0;
    this.lastRepMs = -Infinity;
  }

  update(s: NaturalSample): NaturalOutput {
    const r = this.step(s);
    return { reps: this.reps, partials: this.partials, phase: phaseOf(this.stage), stage: this.stage, event: r.event, reject: r.reject };
  }

  private step({ timestampMs: t, depth, torso }: NaturalSample): { event: NaturalOutput['event']; reject: Reject | null } {
    const none = { event: null, reject: null } as const;
    const c = this.cfg;
    if (depth === null || !Number.isFinite(depth)) {
      if (this.stage === 'ready') { this.topRun = this.bottomRun = 0; return none; }
      return { event: null, reject: this.interrupt() };
    }
    const top = depth <= c.topDepth;
    const deep = depth >= c.downDepth;
    const torsoOk = torso === undefined ? true : torso !== null && Number.isFinite(torso) && torso >= c.minTorso;
    const bottomZone = deep && torsoOk;

    switch (this.stage) {
      case 'unknown': {
        if (top) {
          this.topRun += 1;
          if (this.topRun >= c.confirmSamples) { this.stage = 'ready'; this.topRun = 0; this.excursion = 0; this.flaggedNoStanding = false; }
          return none;
        }
        this.topRun = 0;
        if (deep && !this.flaggedNoStanding) { this.flaggedNoStanding = true; return { event: null, reject: 'noStanding' }; }
        return none;
      }
      case 'ready':
      case 'descending': {
        if (this.stage === 'ready' && !top) this.cycleStart = t;
        if (depth > this.excursion) this.excursion = depth;
        if (bottomZone) {
          this.bottomRun += 1;
          this.topRun = 0;
          if (this.bottomRun >= c.confirmSamples) {
            this.stage = 'bottom';
            this.folded = false;
            this.peak = depth;
            this.bottomRun = 0;
          } else this.stage = 'descending';
          return none;
        }
        const brokeBottom = this.bottomRun > 0;
        this.bottomRun = 0;
        if (deep && !torsoOk) {
          this.stage = 'descending';
          if (this.flaggedGeometry) return none;
          this.flaggedGeometry = true;
          return { event: null, reject: 'geometry' };
        }
        if (top) {
          if (this.stage === 'descending') {
            this.topRun += 1;
            if (this.topRun >= c.confirmSamples) {
              this.stage = 'ready';
              this.topRun = 0;
              this.flaggedGeometry = false;
              const ex = this.excursion;
              this.excursion = depth;
              if (ex >= c.partialDepth) { this.partials += 1; return { event: 'partial', reject: brokeBottom ? 'downBrief' : 'notDeep' }; }
            }
          }
          return brokeBottom ? { event: null, reject: 'downBrief' } : none;
        }
        this.topRun = 0;
        this.stage = 'descending';
        return brokeBottom ? { event: null, reject: 'downBrief' } : none;
      }
      case 'bottom': {
        if (depth > this.peak) this.peak = depth;
        if (torso !== undefined && torso !== null && torso < c.minTorso) this.folded = true;
        if (depth < c.downDepth) { this.stage = 'ascending'; this.ascMin = depth; return this.ascend(t, depth); }
        return none;
      }
      case 'ascending': {
        if (deep && torso !== undefined && torso !== null && torso < c.minTorso) this.folded = true;
        if (bottomZone) {
          const rose = this.ascMin <= c.downDepth - 0.1;
          const brokeTop = this.topRun > 0;
          this.stage = 'bottom';
          this.topRun = 0;
          if (depth > this.peak) this.peak = depth;
          this.ascMin = Infinity;
          return { event: null, reject: brokeTop ? 'upBrief' : rose ? 'notTall' : null };
        }
        if (depth < this.ascMin) this.ascMin = depth;
        return this.ascend(t, depth);
      }
    }
  }

  private ascend(t: number, depth: number): { event: NaturalOutput['event']; reject: Reject | null } {
    const c = this.cfg;
    const complete = depth <= c.topDepth && depth <= this.peak - c.minRise;
    if (!complete) {
      const broke = this.topRun > 0;
      this.topRun = 0;
      return { event: null, reject: broke ? 'upBrief' : null };
    }
    this.topRun += 1;
    if (this.topRun < c.confirmSamples) return { event: null, reject: null };
    this.stage = 'ready';
    this.topRun = 0;
    this.excursion = depth;
    this.peak = 0;
    this.ascMin = Infinity;
    if (this.folded) { this.folded = false; return { event: null, reject: 'geometry' }; }
    if (t - this.lastRepMs < c.minRepMs || t - this.cycleStart < c.minCycleMs) return { event: null, reject: 'minRep' };
    this.lastRepMs = t;
    this.reps += 1;
    return { event: 'rep', reject: null };
  }
}

function phaseOf(s: Stage): NaturalOutput['phase'] {
  return s === 'unknown' ? 'unknown' : s === 'bottom' || s === 'ascending' ? 'down' : 'standing';
}
