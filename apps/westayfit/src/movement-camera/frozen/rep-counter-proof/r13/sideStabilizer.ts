// R13 leg-side stabiliser — experimental, test-only (not wired live; replay ops already carry the
// averaged depth). Keeps left/right squat ratios separately smoothed and prefers continuity of the
// side already in use, so a change in WHICH leg is measurable cannot create an artificial jump or
// reversal. Both sides are averaged only when compatible. Missing joints are never synthesised: with
// no measurable side the output is null.
export interface SideStabConfig { alpha: number; compatTol: number; biasDecay: number }
export const SIDE_STAB_CONFIG: SideStabConfig = { alpha: 0.5, compatTol: 0.08, biasDecay: 0.9 };

export class SideStabilizer {
  readonly cfg: SideStabConfig;
  private l: number | null = null;
  private r: number | null = null;
  private side: 'L' | 'R' | 'B' | null = null;
  private bias = 0;
  private last: number | null = null;
  switches = 0;
  constructor(cfg: Partial<SideStabConfig> = {}) { this.cfg = { ...SIDE_STAB_CONFIG, ...cfg }; }

  reset() { this.l = this.r = this.last = null; this.side = null; this.bias = 0; }

  /** ratio per side (null = not measurable this frame). Returns the stabilised ratio or null. */
  update(left: number | null, right: number | null): number | null {
    const a = this.cfg.alpha, sm = (p: number | null, v: number | null) => (v === null ? null : p === null ? v : p + a * (v - p));
    this.l = sm(this.l, left); this.r = sm(this.r, right);
    if (left === null) this.l = null;
    if (right === null) this.r = null;
    let side: 'L' | 'R' | 'B' | null; let v: number | null;
    if (this.l !== null && this.r !== null) {
      if (Math.abs(this.l - this.r) <= this.cfg.compatTol) { side = 'B'; v = (this.l + this.r) / 2; }
      else { side = this.side === 'R' ? 'R' : this.side === 'L' ? 'L' : this.l >= this.r ? 'L' : 'R'; v = side === 'L' ? this.l : this.r; }
    } else if (this.l !== null) { side = 'L'; v = this.l; }
    else if (this.r !== null) { side = 'R'; v = this.r; }
    else { this.side = null; this.bias = 0; this.last = null; return null; }
    // Side change: carry the offset so the measured signal is continuous, then let the offset decay.
    if (this.side !== null && side !== this.side && this.last !== null) { this.bias = this.last - v; this.switches += 1; }
    else this.bias *= this.cfg.biasDecay;
    this.side = side;
    this.last = v + this.bias;
    return this.last;
  }
}
