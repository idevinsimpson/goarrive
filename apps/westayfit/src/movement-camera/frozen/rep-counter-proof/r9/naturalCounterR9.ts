// R8-DEVICE-MISSES-1 → r9 EXPERIMENTAL movement-rule successor. Lives beside r6/naturalCounter.ts
// (unchanged and still selectable) and the frozen core (unchanged).
//
// Same signal, thresholds, confirmation and trajectory as r6 (topDepth 0.4, downDepth 0.55,
// minRise 0.35, confirmSamples 2, minRepMs 250, minCycleMs 150, minTorso 0.35). With the default
// band 0 it COUNTS IDENTICALLY to r6 (asserted on every corpus in wrapper-tests/r9.test.ts).
//
//  1. ATTEMPT-LEVEL LABELS (the r9 change). r6 labels a returned descent `notDeep` unless the bottom
//     zone was left on the very same frame (`brokeBottom` is frame-local), so a descent that DID touch
//     the bottom zone is reported as "never deep enough"; likewise a return to the bottom after the
//     top line was touched is labelled by frame-local state. r9 remembers, per excursion/ascent,
//     whether the zone was touched, labels the terminal outcome from that, and emits the warnings
//     (`downBrief`/`upBrief`) at most once per excursion/ascent instead of once per noisy crossing.
//  2. ZONE HYSTERESIS `band` — implemented but DEFAULT 0 (off). Tested at the owner's reported
//     ~51.5 samples/s with bounded noise up to ±0.07: r6's consecutive-sample confirmation already
//     confirmed every valid straddling dwell, while a 0.05 band added counts on a below-line
//     (true peak 0.52) negative. Rejected on that evidence; kept only so the A/B stays reproducible.
//
// Nothing is interpolated: a null sample mid-cycle still voids the cycle; no rep without an observed
// confirmed bottom AND an observed confirmed top with the minimum rise.
import { R6_CONFIG, type NaturalConfig, type NaturalOutput, type NaturalSample, type Reject, type Stage } from '../r6/naturalCounter';

export interface R9Config extends NaturalConfig {
  /** Hysteresis band: a zone visit stays open while depth is within `band` of the threshold. */
  band: number;
  /**
   * Bottom-zone evidence window (r9.1 corrective delta): a sample counts as "in the bottom zone" only
   * when the sample itself AND the MEAN of the last N consecutive OBSERVED depths reach downDepth. Any null/unusable sample
   * clears the window (nothing interpolated). 1 = raw per-sample test (r6/r9.0 behaviour).
   */
  bottomMean: number;
}
export const R9_CONFIG: R9Config = { ...R6_CONFIG, band: 0, bottomMean: 3 };
export const R9_REVISION = 'r9.1-experimental';

export class NaturalSquatCounterR9 {
  readonly cfg: R9Config;
  private reps = 0;
  private partials = 0;
  private stage: Stage = 'unknown';
  private topRun = 0;
  private bottomRun = 0;
  private inBottom = false;
  private inTop = false;
  private touchedBottom = false;
  private warnedDown = false;
  private warnedUp = false;
  private excursion = 0;
  private peak = 0;
  private ascMin = Infinity;
  private lastRepMs = -Infinity;
  private flaggedNoStanding = false;
  private flaggedGeometry = false;
  private folded = false;
  private cycleStart = -Infinity;
  private recent: number[] = [];

  constructor(cfg: Partial<R9Config> = {}) {
    this.cfg = { ...R9_CONFIG, ...cfg };
    if (!(this.cfg.downDepth > this.cfg.topDepth)) throw new Error('downDepth must exceed topDepth');
    if (this.cfg.confirmSamples < 1) throw new Error('confirmSamples must be ≥ 1');
    if (!(Number.isInteger(this.cfg.bottomMean) && this.cfg.bottomMean >= 1)) throw new Error('bottomMean must be an integer ≥ 1');
    if (!(this.cfg.band >= 0) || this.cfg.downDepth - this.cfg.band <= this.cfg.topDepth + this.cfg.band) throw new Error('band must keep the zones apart');
  }

  get count() { return this.reps; }
  get currentStage() { return this.stage; }
  get currentPhase(): NaturalOutput['phase'] { return phaseOf(this.stage); }

  interrupt(): Reject | null {
    const mid = this.stage === 'descending' || this.stage === 'bottom' || this.stage === 'ascending';
    this.stage = 'unknown';
    this.clearRuns();
    this.excursion = this.peak = 0;
    this.ascMin = Infinity;
    this.flaggedNoStanding = false;
    this.flaggedGeometry = false;
    this.folded = false;
    this.touchedBottom = this.warnedDown = this.warnedUp = false;
    this.recent = [];
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

  private clearRuns() {
    this.topRun = this.bottomRun = 0;
    this.inTop = this.inBottom = false;
  }

  /** Advance a zone visit. Returns 'in' (in-zone sample counted), 'band' (visit held open) or 'out'. */
  private visit(which: 'top' | 'bottom', inZone: boolean, inBand: boolean): 'in' | 'band' | 'out' {
    if (which === 'bottom') {
      if (inZone) { this.inBottom = true; this.bottomRun += 1; return 'in'; }
      if (this.inBottom && inBand) return 'band';
      this.inBottom = false; this.bottomRun = 0; return 'out';
    }
    if (inZone) { this.inTop = true; this.topRun += 1; return 'in'; }
    if (this.inTop && inBand) return 'band';
    this.inTop = false; this.topRun = 0; return 'out';
  }

  private warnDown(): Reject | null {
    if (this.warnedDown) return null;
    this.warnedDown = true;
    return 'downBrief';
  }

  private step({ timestampMs: t, depth, torso }: NaturalSample): { event: NaturalOutput['event']; reject: Reject | null } {
    const none = { event: null, reject: null } as const;
    const c = this.cfg;
    if (depth === null || !Number.isFinite(depth)) {
      this.recent = [];
      if (this.stage === 'ready') { this.clearRuns(); return none; }
      return { event: null, reject: this.interrupt() };
    }
    const top = depth <= c.topDepth;
    const topBand = depth <= c.topDepth + c.band;
    this.recent.push(depth);
    if (this.recent.length > c.bottomMean) this.recent.shift();
    const ev = this.recent.length < c.bottomMean ? -Infinity : this.recent.reduce((a, b) => a + b, 0) / this.recent.length;
    const deep = depth >= c.downDepth;
    const torsoOk = torso === undefined ? true : torso !== null && Number.isFinite(torso) && torso >= c.minTorso;
    const bottomZone = deep && torsoOk && ev >= c.downDepth; // raw sample AND window mean: tighter only
    const bottomBand = depth >= c.downDepth - c.band && torsoOk;

    switch (this.stage) {
      case 'unknown': {
        if (this.visit('top', top, topBand) !== 'out') {
          if (this.topRun >= c.confirmSamples) {
            this.stage = 'ready'; this.clearRuns(); this.excursion = 0; this.flaggedNoStanding = false;
            this.touchedBottom = this.warnedDown = this.warnedUp = false;
          }
          return none;
        }
        if (deep && !this.flaggedNoStanding) { this.flaggedNoStanding = true; return { event: null, reject: 'noStanding' }; }
        return none;
      }
      case 'ready':
      case 'descending': {
        if (this.stage === 'ready' && !top) { this.cycleStart = t; this.touchedBottom = this.warnedDown = false; this.folded = false; }
        if (depth > this.excursion) this.excursion = depth;
        const b = this.visit('bottom', bottomZone, bottomBand);
        if (deep && torsoOk) this.touchedBottom = true; // raw line touch (label only; confirmation uses the window)
        if (b !== 'out') {
          this.inTop = false; this.topRun = 0;
          if (this.bottomRun >= c.confirmSamples) {
            this.stage = 'bottom';
            // Keep a fold already observed earlier in THIS descent (the bottom window can confirm later).
            this.peak = depth;
            this.clearRuns();
            this.warnedUp = false;
          } else this.stage = 'descending';
          return none;
        }
        // Bottom visit (if any) ended without confirmation: warn once per excursion.
        const brokeBottom = this.touchedBottom && !this.warnedDown ? this.warnDown() : null;
        if (deep && !torsoOk) {
          this.folded = true; // observed fold during this excursion → its completion is a geometry reject
          this.stage = 'descending';
          if (this.flaggedGeometry) return { event: null, reject: brokeBottom };
          this.flaggedGeometry = true;
          return { event: null, reject: 'geometry' };
        }
        if (this.stage === 'descending' && this.visit('top', top, topBand) !== 'out') {
          if (this.topRun >= c.confirmSamples) {
            this.stage = 'ready';
            this.clearRuns();
            this.flaggedGeometry = false;
            const ex = this.excursion, touched = this.touchedBottom;
            this.excursion = depth;
            this.touchedBottom = this.warnedDown = false;
            if (ex >= c.partialDepth) { this.partials += 1; return { event: 'partial', reject: touched ? 'downBrief' : 'notDeep' }; }
          }
          return { event: null, reject: brokeBottom };
        }
        if (this.stage === 'ready' && top) return { event: null, reject: brokeBottom }; // still at the top
        this.stage = 'descending';
        return { event: null, reject: brokeBottom };
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
          // Top line reached at some point in this ascent but never confirmed (attempt-level, not frame-local).
          const brokeTop = this.ascMin <= Math.min(c.topDepth, this.peak - c.minRise);
          this.stage = 'bottom';
          this.clearRuns();
          this.warnedUp = false;
          if (depth > this.peak) this.peak = depth;
          this.ascMin = Infinity;
          // Terminal for this ascent: back to the bottom without a confirmed top.
          return { event: null, reject: brokeTop ? 'upBrief' : rose ? 'notTall' : null };
        }
        if (depth < this.ascMin) this.ascMin = depth;
        return this.ascend(t, depth);
      }
    }
  }

  private ascend(t: number, depth: number): { event: NaturalOutput['event']; reject: Reject | null } {
    const c = this.cfg;
    const line = Math.min(c.topDepth, this.peak - c.minRise);
    const v = this.visit('top', depth <= line, depth <= line + c.band);
    if (v === 'out') {
      // A top visit that ended unconfirmed: warn once per ascent.
      if (this.warnedUp || this.ascMin > line) return { event: null, reject: null };
      this.warnedUp = true;
      return { event: null, reject: 'upBrief' };
    }
    if (this.topRun < c.confirmSamples) return { event: null, reject: null };
    this.stage = 'ready';
    this.clearRuns();
    this.excursion = depth;
    this.peak = 0;
    this.ascMin = Infinity;
    this.touchedBottom = this.warnedDown = this.warnedUp = false;
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
