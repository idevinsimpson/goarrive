/**
 * THE SQUAT STATE MACHINE.
 *
 * Input is one number per frame, `depth` (see geometry.depthFromRatio): 0 is
 * the member's own standing posture, 1 is hip at knee height. Or null, for a
 * frame with nothing trustworthy in it.
 *
 *            depth ≥ downDepth, held dwellMs
 *   standing ─────────────────────────────────▶ down
 *      ▲                                          │
 *      └──────────────────────────────────────────┘
 *            depth ≤ upDepth, held dwellMs   → +1 rep
 *
 * - HYSTERESIS: the down and up thresholds are far apart. Between them is a
 *   dead band that never changes the phase, so hovering near either threshold
 *   cannot flip it back and forth.
 * - DEBOUNCE: a phase changes only after its zone has held for `dwellMs` of
 *   consecutive samples. One noisy frame, or a bounce through the dead band,
 *   resets the wait.
 * - EXACTLY ONE INCREMENT: a rep is counted only on the down→standing edge,
 *   and that edge can happen once per down phase.
 * - HALF REPS DO NOT COUNT: a descent that never reaches `downDepth` never
 *   enters `down`, so returning to standing has nothing to count. It is
 *   reported as a `partial` event for feedback, and adds nothing.
 * - UNOBSERVED MEANS VOID: a null sample (no trusted pose this frame) during
 *   any partial cycle — down, or partway down — interrupts exactly as lost
 *   tracking does. Only a completion the counter actually watched can count.
 * - UNKNOWN IS A REAL PHASE: at start, after `interrupt()` (lost tracking, an
 *   unobserved frame mid-cycle) and after `reset()`, the machine must SEE the member standing before it can
 *   count again. A rep that was in progress when tracking was lost is
 *   discarded, never completed on the member's return.
 */

export type SquatPhase = 'unknown' | 'standing' | 'down';

export interface SquatConfig {
  downDepth: number;
  upDepth: number;
  dwellMs: number;
  /** Safety net: two counts closer together than this are one count. */
  minRepMs: number;
  /** An excursion from standing at least this deep that never reached `down` is a `partial`. */
  partialDepth: number;
}

export const DEFAULT_SQUAT_CONFIG: SquatConfig = {
  downDepth: 0.6,
  upDepth: 0.25,
  dwellMs: 100,
  minRepMs: 400,
  partialDepth: 0.3,
};

export interface SquatSample {
  timestampMs: number;
  depth: number | null;
}

export type SquatEvent = 'rep' | 'partial' | null;

export interface SquatOutput {
  reps: number;
  partials: number;
  phase: SquatPhase;
  event: SquatEvent;
}

type Zone = 'up' | 'mid' | 'down';

export class SquatCounter {
  private readonly cfg: SquatConfig;
  private reps = 0;
  private partials = 0;
  private phase: SquatPhase = 'unknown';
  private pending: { zone: Zone; sinceMs: number } | null = null;
  private lastRepMs = -Infinity;
  private excursion = 0;

  constructor(config: Partial<SquatConfig> = {}) {
    this.cfg = { ...DEFAULT_SQUAT_CONFIG, ...config };
    if (!(this.cfg.downDepth > this.cfg.upDepth)) {
      throw new Error('SquatCounter: downDepth must be greater than upDepth');
    }
  }

  get count(): number {
    return this.reps;
  }

  get currentPhase(): SquatPhase {
    return this.phase;
  }

  /** Tracking was lost: discard any rep in progress, require standing again. */
  interrupt(): void {
    this.phase = 'unknown';
    this.pending = null;
    this.excursion = 0;
  }

  reset(): void {
    this.interrupt();
    this.reps = 0;
    this.partials = 0;
    this.lastRepMs = -Infinity;
  }

  update(sample: SquatSample): SquatOutput {
    const event = this.step(sample);
    return { reps: this.reps, partials: this.partials, phase: this.phase, event };
  }

  private step({ timestampMs: t, depth }: SquatSample): SquatEvent {
    if (depth === null || !Number.isFinite(depth)) {
      // Nothing trustworthy this frame. A dwell cannot be confirmed across it,
      // and a cycle in progress was not fully observed, so it is void: the
      // same interrupt/re-arm rule as lost tracking. Only a member standing
      // at rest survives an unobserved frame.
      const atRest = this.phase === 'standing' && this.excursion <= this.cfg.upDepth;
      if (atRest) this.pending = null;
      else this.interrupt();
      return null;
    }
    const zone: Zone =
      depth >= this.cfg.downDepth ? 'down' : depth <= this.cfg.upDepth ? 'up' : 'mid';

    if (this.phase === 'standing' && depth > this.excursion) this.excursion = depth;

    if (zone === 'mid') {
      this.pending = null;
      return null;
    }

    const target: SquatPhase = zone === 'up' ? 'standing' : 'down';
    if (this.phase === target) {
      this.pending = null;
      if (zone === 'up' && this.excursion >= this.cfg.partialDepth) {
        this.excursion = 0;
        this.partials += 1;
        return 'partial';
      }
      if (zone === 'up') this.excursion = 0;
      return null;
    }
    // From `unknown`, only standing can be established.
    if (this.phase === 'unknown' && target === 'down') {
      this.pending = null;
      return null;
    }

    if (!this.pending || this.pending.zone !== zone) {
      this.pending = { zone, sinceMs: t };
      if (this.cfg.dwellMs > 0) return null;
    }
    if (t - this.pending.sinceMs < this.cfg.dwellMs) return null;

    const from = this.phase;
    this.phase = target;
    this.pending = null;
    this.excursion = 0;

    if (from === 'down' && target === 'standing') {
      if (t - this.lastRepMs < this.cfg.minRepMs) return null;
      this.lastRepMs = t;
      this.reps += 1;
      return 'rep';
    }
    return null;
  }
}
