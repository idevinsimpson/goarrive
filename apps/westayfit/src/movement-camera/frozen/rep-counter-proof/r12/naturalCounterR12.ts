// REP-COUNTER-PROOF-1 r12 — EXPERIMENTAL successor of r11 (opt-in ?tracker=r7.1&rules=r12). r11 is unchanged.
// Copied from r11/naturalCounterR11.ts; designed against the owner's chest-height device evidence
// (front-facing cycles peaking ~0.34-0.37 rejected as notDeep/downBrief; side-facing cycles peaking
// ~0.56-0.64 returning only to ~0.26-0.30 and merged as rebottom). Two hypotheses, both using only
// the run's own observed depth sequence (no learned model, no network, no owner counts):
//  H1 VIEW-SCALE LOWERED LINE: lowered = max(lowFloor, ref + minDrop, min(downDepth, scaleFrac x median
//     of this run's last counted peaks)). In a compressed view (small observed peaks) the line sits at
//     lowFloor; once the run shows large excursions (low phone) it returns to r11's downDepth. The
//     ref + minDrop movement requirement, mean window and confirmations are unchanged.
//  H2 RELATIVE RETURN: the return line is the r11 line OR, if higher, the point that recovers recoverFrac
//     of this cycle's own excursion (peak - cycle reference), never less than minRise below the peak.
//     After a count the next reference is min(return depth, run upright + uprightSlack), so a soft top
//     cannot inflate the next lowered line. Bounces that do not recover half the excursion still
//     cannot count; minRep/minCycle timing and null-voids are r11's.
import { blankDecision, type RuleDecision } from '../replay/decision';
import { R6_CONFIG, type NaturalConfig, type NaturalOutput, type NaturalSample, type Reject, type Stage } from '../r6/naturalCounter';

export interface R12Config extends NaturalConfig {
  /** r11: an excursion must rise at least this far above its reference to be recorded as a partial. */
  minPartialRise: number;
  /** r10: the return line is max(topDepth, returnFrac × observed peak) (and never above peak − minRise). */
  returnFrac: number;
  /** r10.1: 'lowered' also requires depth ≥ (lowest depth seen while ready) + minDrop, so a soft resting top is not itself 'lowered'. */
  minDrop: number;
  /** Hysteresis band: a zone visit stays open while depth is within `band` of the threshold. */
  band: number;
  /**
   * Bottom-zone evidence window (r9.1 corrective delta): a sample counts as "in the bottom zone" only
   * when the sample itself AND the MEAN of the last N consecutive OBSERVED depths reach downDepth. Any null/unusable sample
   * clears the window (nothing interpolated). 1 = raw per-sample test (r6/r9.0 behaviour).
   */
  bottomMean: number;
  /** r12 H1: lowest absolute lowered line (compressed views). */
  lowFloor: number;
  /** r12 H1: lowered line rises toward downDepth as scaleFrac x median of recent counted peaks. */
  scaleFrac: number;
  scaleN: number;
  /** r12 H2: fraction of this cycle's own excursion that must be recovered for a credible return. */
  recoverFrac: number;
  /** r12 H2: post-count reference is at most run upright + uprightSlack. */
  uprightSlack: number;
}
export const R12_CONFIG: R12Config = {
  ...R6_CONFIG,
  topDepth: 0.2, downDepth: 0.35, minRise: 0.2, partialDepth: 0.2, returnFrac: 0.45, minDrop: 0.25,
  band: 0, bottomMean: 3, minPartialRise: 0.1,
  lowFloor: 0.3, scaleFrac: 0.6, scaleN: 5, recoverFrac: 0.5, uprightSlack: 0.16,
};
export const R12_REVISION = 'r12.1-experimental';
export const R12_POLICY = 'inclusive-half-or-full';
export const R12_LABEL = 'Half and full squats — r12 camera-height (experimental)';

export class NaturalSquatCounterR12 {
  readonly cfg: R12Config;
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
  private base = 0;
  /** r11: top line in ready/descending; raised to the accepted return line after a count. */
  private readyTop = 0.2;
  /** r12 H1: peaks of this run's counted reps (observed only), newest last. */
  private peaks: number[] = [];
  /** r12 H2: lowest observed depth while ready in this run (upright reference). */
  private upright = Infinity;
  /** r12 H2: the reference this cycle descended from. */
  private cycleBase = 0;
  // R10-REPLAY-1: read-only instrumentation of the ACTUAL decision (never read by the rules).
  private cycleId = 0;
  private dec: RuleDecision = blankDecision(0, 'unknown', 0, 0, 0);
  get lastDecision(): RuleDecision { return this.dec; }

  constructor(cfg: Partial<R12Config> = {}) {
    this.cfg = { ...R12_CONFIG, ...cfg };
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
    this.readyTop = this.cfg.topDepth;
    this.peaks = []; this.upright = Infinity;
    return mid ? 'interrupted' : null;
  }

  reset(): void {
    this.interrupt();
    this.reps = this.partials = 0;
    this.lastRepMs = -Infinity;
  }

  update(s: NaturalSample): NaturalOutput {
    this.dec = blankDecision(s.timestampMs, this.stage, this.cycleId, this.stage === 'ready' || this.stage === 'descending' ? this.readyTop : this.cfg.topDepth, this.base);
    const r = this.step(s);
    const d = this.dec;
    d.stageAfter = this.stage; d.event = r.event; d.reject = r.reject;
    if (d.stageBefore === 'ready' && this.stage === 'descending') d.cycle = ++this.cycleId;
    if (this.stage === 'bottom' || this.stage === 'ascending') d.peak = Math.max(d.peak, this.peak);
    return { reps: this.reps, partials: this.partials, phase: phaseOf(this.stage), stage: this.stage, event: r.event, reject: r.reject };
  }

  private clearRuns() {
    this.topRun = this.bottomRun = 0;
    this.inTop = this.inBottom = false;
  }

  /** Advance a zone visit. Returns 'in' (in-zone sample counted), 'band' (visit held open) or 'out'. */
  private visit(which: 'top' | 'bottom', inZone: boolean, inBand: boolean): 'in' | 'band' | 'out' {
    if (which === 'bottom') {
      if (inZone) { this.inBottom = true; this.bottomRun += 1; this.dec.bottomRun = this.bottomRun; return 'in'; }
      if (this.inBottom && inBand) return 'band';
      this.inBottom = false; this.bottomRun = 0; this.dec.bottomRun = 0; return 'out';
    }
    if (inZone) { this.inTop = true; this.topRun += 1; this.dec.topRun = this.topRun; return 'in'; }
    if (this.inTop && inBand) return 'band';
    this.inTop = false; this.topRun = 0; this.dec.topRun = 0; return 'out';
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
    // r11 rearm: in ready/descending the top line is readyTop (≥ topDepth); elsewhere topDepth.
    const atTopLine = this.stage === 'ready' || this.stage === 'descending' ? this.readyTop : c.topDepth;
    if (this.stage === 'ready' && depth <= c.topDepth) this.readyTop = c.topDepth;
    const top = depth <= atTopLine;
    const topBand = depth <= atTopLine + c.band;
    this.recent.push(depth);
    if (this.recent.length > c.bottomMean) this.recent.shift();
    const ev = this.recent.length < c.bottomMean ? -Infinity : this.recent.reduce((a, b) => a + b, 0) / this.recent.length;
    // r10.3: the reference is the lowest depth seen at the top AND during the descent's start (a partial
    // return does not reset it), so noisy top chatter cannot raise the 'lowered' line.
    if ((this.stage === 'ready' || this.stage === 'descending') && depth < this.base) this.base = depth;
    if (this.stage === 'ready' && depth < this.upright) this.upright = depth;
    const low = Math.max(c.lowFloor, this.base + c.minDrop, Math.min(c.downDepth, c.scaleFrac * this.scale()));
    const deep = depth >= low;
    const torsoOk = torso === undefined ? true : torso !== null && Number.isFinite(torso) && torso >= c.minTorso;
    const bottomZone = deep && torsoOk && ev >= low; // raw sample AND window mean: tighter only
    const bottomBand = depth >= low - c.band && torsoOk;
    this.dec.raw = depth; this.dec.mean = Number.isFinite(ev) ? ev : null; this.dec.lowered = low; this.dec.base = this.base;

    switch (this.stage) {
      case 'unknown': {
        if (this.visit('top', top, topBand) !== 'out') {
          if (this.topRun >= c.confirmSamples) {
            this.stage = 'ready'; this.base = depth; this.upright = depth; this.clearRuns(); this.excursion = 0; this.flaggedNoStanding = false;
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
            this.cycleBase = this.base;
            // Keep a fold already observed earlier in THIS descent (the bottom window can confirm later).
            this.peak = depth;
            this.clearRuns();
            this.warnedUp = false;
          } else this.stage = 'descending';
          return none;
        }
        // Bottom visit (if any) ended without confirmation: warn once per excursion.
        // r11: only once the raw depth has actually LEFT the lowered zone (not while the mean window fills).
        const brokeBottom = this.touchedBottom && !this.warnedDown && !deep ? this.warnDown() : null;
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
            const rose = ex - this.base >= c.minPartialRise;
            if (ex >= c.partialDepth && rose) { this.partials += 1; return { event: 'partial', reject: touched ? 'downBrief' : 'notDeep' }; }
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
        if (depth < Math.max(low, this.peak - c.minRise)) { this.stage = 'ascending'; this.ascMin = depth; return this.ascend(t, depth); }
        return none;
      }
      case 'ascending': {
        if (deep && torso !== undefined && torso !== null && torso < c.minTorso) this.folded = true;
        if (bottomZone && depth >= this.ascMin + c.minDrop) { // r10.2: re-lowered by minDrop from the ascent's lowest point
          const rose = this.ascMin <= c.downDepth - 0.1;
          // Top line reached at some point in this ascent but never confirmed (attempt-level, not frame-local).
          const brokeTop = this.ascMin <= this.returnLine();
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

  /** r10 return line: back to ≤ max(topDepth, returnFrac·peak), and at least minRise below the peak. */
  private returnLine(): number {
    const c = this.cfg;
    const r11 = Math.min(Math.max(c.topDepth, c.returnFrac * this.peak), this.peak - c.minRise);
    const rel = Math.min(this.peak - c.minRise, this.cycleBase + (1 - c.recoverFrac) * (this.peak - this.cycleBase));
    return Math.max(r11, rel);
  }

  /** r12 H1: median of recent counted peaks (0 when none yet in this run). */
  private scale(): number {
    if (!this.peaks.length) return 0;
    const v = [...this.peaks].sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  }

  private ascend(t: number, depth: number): { event: NaturalOutput['event']; reject: Reject | null } {
    const c = this.cfg;
    const line = this.returnLine();
    this.dec.returnLine = line; this.dec.peak = this.peak;
    const v = this.visit('top', depth <= line, depth <= line + c.band);
    if (v === 'out') {
      // A top visit that ended unconfirmed: warn once per ascent.
      if (this.warnedUp || this.ascMin > line) return { event: null, reject: null };
      this.warnedUp = true;
      return { event: null, reject: 'upBrief' };
    }
    if (this.topRun < c.confirmSamples) return { event: null, reject: null };
    this.stage = 'ready';
    const peak = this.peak;
    this.base = Math.min(depth, (Number.isFinite(this.upright) ? this.upright : depth) + c.uprightSlack);
    this.readyTop = Math.max(c.topDepth, line);
    this.clearRuns();
    this.excursion = depth;
    this.peak = 0;
    this.ascMin = Infinity;
    this.touchedBottom = this.warnedDown = this.warnedUp = false;
    if (this.folded) { this.folded = false; return { event: null, reject: 'geometry' }; }
    if (t - this.lastRepMs < c.minRepMs || t - this.cycleStart < c.minCycleMs) return { event: null, reject: 'minRep' };
    this.lastRepMs = t;
    this.reps += 1;
    this.peaks.push(peak); if (this.peaks.length > c.scaleN) this.peaks.shift();
    return { event: 'rep', reject: null };
  }
}

function phaseOf(s: Stage): NaturalOutput['phase'] {
  return s === 'unknown' ? 'unknown' : s === 'bottom' || s === 'ascending' ? 'down' : 'standing';
}
