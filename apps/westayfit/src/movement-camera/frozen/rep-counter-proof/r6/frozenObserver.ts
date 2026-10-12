// REP-COUNTER-PROOF-1-r6: wrapper-level observer that classifies WHY the FROZEN SquatCounter did not
// advance, from the depths it was fed and its public phase/event output. It never feeds or alters
// the counter. Thresholds mirror DEFAULT_SQUAT_CONFIG (read, not changed).
import { DEFAULT_SQUAT_CONFIG, type SquatConfig, type SquatOutput } from '../core/squatCounter';
import type { Reject } from './naturalCounter';

export class FrozenRejectObserver {
  private readonly c: SquatConfig;
  private prevPhase: SquatOutput['phase'] = 'unknown';
  private deepRun: number | null = null; // start ms of current ≥downDepth run while standing
  private upRun: number | null = null; // start ms of current ≤upDepth run while down
  private ascMin = Infinity;
  private flaggedNoStanding = false;
  private excursion = 0;

  constructor(cfg: SquatConfig = DEFAULT_SQUAT_CONFIG) { this.c = cfg; }

  reset() {
    this.prevPhase = 'unknown';
    this.deepRun = this.upRun = null;
    this.ascMin = Infinity;
    this.flaggedNoStanding = false;
    this.excursion = 0;
  }

  /** Call once per sample fed to the frozen counter, with the counter's output for that sample. */
  observe(t: number, depth: number | null, out: SquatOutput): Reject | null {
    const c = this.c;
    const prev = this.prevPhase;
    this.prevPhase = out.phase;
    if (out.event === 'partial') { this.deepRun = null; return 'notDeep'; }
    if (out.event === 'rep') { this.upRun = null; this.ascMin = Infinity; this.excursion = 0; return null; }
    if (prev !== 'unknown' && out.phase === 'unknown') {
      const mid = prev === 'down' || this.excursion > c.upDepth;
      this.deepRun = this.upRun = null; this.ascMin = Infinity; this.excursion = 0; this.flaggedNoStanding = false;
      return mid ? 'interrupted' : null;
    }
    if (depth === null) return null;
    if (out.phase === 'unknown') {
      if (depth >= c.downDepth && !this.flaggedNoStanding) { this.flaggedNoStanding = true; return 'noStanding'; }
      return null;
    }
    if (prev === 'down' && out.phase === 'standing') {
      // down→standing transition without a rep event: only the min-rep guard does that.
      this.upRun = null; this.ascMin = Infinity; this.excursion = 0;
      return 'minRep';
    }
    if (out.phase === 'standing') {
      this.flaggedNoStanding = false;
      if (depth > this.excursion) this.excursion = depth;
      if (depth <= c.upDepth) this.excursion = 0;
      if (depth >= c.downDepth) { this.deepRun ??= t; return null; }
      if (this.deepRun !== null) { this.deepRun = null; return 'downBrief'; }
      return null;
    }
    // phase down
    this.deepRun = null;
    if (depth <= c.upDepth) { this.upRun ??= t; return null; }
    const brokeUp = this.upRun !== null;
    this.upRun = null;
    if (brokeUp) return 'upBrief';
    if (depth >= c.downDepth) {
      const rose = this.ascMin <= c.downDepth - 0.15;
      this.ascMin = Infinity;
      return rose ? 'notTall' : null;
    }
    if (depth < this.ascMin) this.ascMin = depth;
    return null;
  }
}
