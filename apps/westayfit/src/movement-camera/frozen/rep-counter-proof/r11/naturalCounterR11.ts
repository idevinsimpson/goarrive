// R10-REPLAY-1 — r11 EXPERIMENTAL successor of r10.3 (opt-in ?tracker=r7.1&rules=r11). r10 is unchanged.
// Copied from r10/naturalCounterR10.ts with exactly two mechanism corrections, both reproduced first
// in synthetic tests (wrapper-tests/replay.test.ts), NOT inferred from the owner's unrecorded set:
//  (1) REARM: after a count accepted at the relative return line R (> 0.20), the counter stays 'ready'
//      while depth ≤ R (readyLine) instead of the fixed 0.20; it falls back to 0.20 once a sample at or
//      below 0.20 is seen. A soft settle between 0.20 and R no longer opens a phantom descent. An
//      excursion that rises less than minPartialRise above its own reference returns to ready
//      silently (no partial, no warning) — it is not a lowering attempt.
//  (2) PENDING WARNING: 'downBrief' fires only after the raw depth has actually left the lowered zone
//      (the visit ended), never while the 3-observation mean window is still arriving.
// Everything else (lines, confirmations, timing, null-voids, no interpolation) is r10.3.
import { blankDecision, type RuleDecision } from '../replay/decision';
import { R6_CONFIG, type NaturalConfig, type NaturalOutput, type NaturalSample, type Reject, type Stage } from '../r6/naturalCounter';

export interface R11Config extends NaturalConfig {
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
}
export const R11_CONFIG: R11Config = {
  ...R6_CONFIG,
  topDepth: 0.2, downDepth: 0.35, minRise: 0.2, partialDepth: 0.2, returnFrac: 0.45, minDrop: 0.25,
  band: 0, bottomMean: 3, minPartialRise: 0.1,
};
export const R11_REVISION = 'r11.0-experimental';
export const R11_POLICY = 'inclusive-half-or-full';
export const R11_LABEL = 'Half and full squats — r11 rearm fix (experimental)';

export class NaturalSquatCounterR11 {
  readonly cfg: R11Config;
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
  // R10-REPLAY-1: read-only instrumentation of the ACTUAL decision (never read by the rules).
  private cycleId = 0;
  private dec: RuleDecision = blankDecision(0, 'unknown', 0, 0, 0);
  get lastDecision(): RuleDecision { return this.dec; }

  constructor(cfg: Partial<R11Config> = {}) {
    this.cfg = { ...R11_CONFIG, ...cfg };
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
    const low = Math.max(c.downDepth, this.base + c.minDrop);
    const deep = depth >= low;
    const torsoOk = torso === undefined ? true : torso !== null && Number.isFinite(torso) && torso >= c.minTorso;
    const bottomZone = deep && torsoOk && ev >= low; // raw sample AND window mean: tighter only
    const bottomBand = depth >= low - c.band && torsoOk;
    this.dec.raw = depth; this.dec.mean = Number.isFinite(ev) ? ev : null; this.dec.lowered = low; this.dec.base = this.base;

    switch (this.stage) {
      case 'unknown': {
        if (this.visit('top', top, topBand) !== 'out') {
          if (this.topRun >= c.confirmSamples) {
            this.stage = 'ready'; this.base = depth; this.clearRuns(); this.excursion = 0; this.flaggedNoStanding = false;
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
    return Math.min(Math.max(c.topDepth, c.returnFrac * this.peak), this.peak - c.minRise);
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
    this.base = depth;
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
    return { event: 'rep', reject: null };
  }
}

function phaseOf(s: Stage): NaturalOutput['phase'] {
  return s === 'unknown' ? 'unknown' : s === 'bottom' || s === 'ascending' ? 'down' : 'standing';
}
