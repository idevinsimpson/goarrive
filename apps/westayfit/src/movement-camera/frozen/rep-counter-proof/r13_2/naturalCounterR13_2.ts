// R13.2 SIGNAL-RELIABILITY skeleton-phase counter — COMPARISON-ONLY (replay Compare column; never live).
//
// Successor to r13.1 (which stays byte-identical and is rejected on owner device replay). r13.1 still
// made DEPTH a hard bottom gate and trusted a 2D knee angle whenever the thigh looked long enough, so a
// front-facing squat (depth compressed by projection) could never reach the multi-signal vote, and a
// foreshortened front knee could trigger the hinge guard. r13.2:
//   - estimates a continuous VIEW cue from the selected skeleton only (shoulder/hip apparent width ÷
//     torso length → frontness 0..1; never identity) and gives every signal a RELIABILITY weight:
//       depth  0.6 + 0.4·side          (valid in both views, compressed when facing the camera)
//       pelvis 1 once a frozen upright body scale exists
//       knee   (0.45 + 0.55·side) × thigh-length credibility (front/foreshortened → never high authority)
//     weights are smoothed per sample so a view change cannot jump the composite;
//   - judges each signal's excursion in its OWN body-relative units against its own required range
//     (depth: the r13 lowered line; pelvis: torso lengths; knee: degrees), generic and conservative
//     before any count, then adapting slowly (bounded) to this track's counted cycles;
//   - a credible bottom: sustained depth with any corroboration (or depth alone when nothing else is
//     available), OR — depth NOT required — one signal reaching its own range corroborated by a signal
//     from an INDEPENDENT landmark group (hip-based depth/pelvis vs knee angle);
//   - a HIGH-authority signal that clearly did not move vetoes the bottom (contradiction, no count);
//   - hinge needs a high-authority knee that did not bend, OR torso lean gain + insufficient pelvis drop
//     + no clear knee bend. An unreliable knee can never trigger it.
// Pre-bottom wobbles stay inside one cycle, top needs reliable signals' recovery + plateau/new descent,
// occlusion keeps calibration and voids only the unfinished rep. Nothing hidden is inferred; never
// reads ownerReported/IDs.
import { R13_CONFIG } from '../r13/naturalCounterR13';
import type { NaturalOutput, Reject, Stage } from '../r6/naturalCounter';
import type { SkFeat } from '../r13_1/skeletonFeatures';

export type Sig = 'depth' | 'pelvis' | 'knee';
export const SIGS: readonly Sig[] = ['depth', 'pelvis', 'knee'];
export type R132Phase = 'uncalibrated' | 'top' | 'down' | 'up' | 'resync';

export interface R132Config {
  calibTop: number; confirmSamples: number; revEps: number; dirSamples: number;
  plateauSamples: number; plateauEps: number;
  minRange: number; lowFloor: number; downDepth: number; scaleFrac: number;
  recoverFrac: number; topFrac: number; topSlackMin: number;
  partialDepth: number; minPartialRise: number; minTorso: number; minRepMs: number; minCycleMs: number;
  maxOcclusionMs: number; maxGapMs: number;
  /** A pre-bottom cycle aborts only after recovering to cycleStart + abortFrac × observed range. */
  abortFrac: number;
  /** Signal agrees on a bottom when its own range ≥ agreeFrac × composite range and it is reversing. */
  agreeFrac: number; sigRevEps: number;
  /** Signal agrees on a top when it recovered ≥ sigRecoverFrac of its own cycle range. */
  sigRecoverFrac: number;
  /** A signal whose own cycle range is below this is "not informative" for the top vote. */
  minSigRange: number;
  /** Knee angle is credible only while 2D thigh length ≥ this × upright thigh length. */
  thighCredible: number;
  /** Credible knee at bottom with less flexion change than this (progress units) → hinge. */
  hingeKnee: number;
  /** Signal → progress scale (pelvis in torso lengths, knee in degrees). */
  pelvisScale: number; kneeScale: number;
  /** Slow adaptation of upright references while standing still. */
  refAlpha: number;
  /** Generic own-unit minimum excursions before any count: pelvis (torso lengths), knee (degrees). */
  pelvisMin: number; kneeMin: number;
  /** Vote eligibility and high-authority weight thresholds. */
  voteW: number; authW: number;
  /** A high-authority signal below this fraction of its required range vetoes the bottom. */
  vetoFrac: number;
  /** Hinge: high-authority knee below hingeKneeDeg, or lean gain ≥ hingeLean with pelvis < its range and knee < kneeMin. */
  hingeKneeDeg: number; hingeLean: number;
  /** Per-sample smoothing of reliability weights and view cue. */
  wAlpha: number;
}
export const R132_CONFIG: R132Config = {
  calibTop: R13_CONFIG.calibTop, confirmSamples: R13_CONFIG.confirmSamples, revEps: R13_CONFIG.revEps, dirSamples: R13_CONFIG.dirSamples,
  plateauSamples: R13_CONFIG.plateauSamples, plateauEps: R13_CONFIG.plateauEps,
  minRange: R13_CONFIG.minRange, lowFloor: R13_CONFIG.lowFloor, downDepth: R13_CONFIG.downDepth, scaleFrac: R13_CONFIG.scaleFrac,
  recoverFrac: R13_CONFIG.recoverFrac, topFrac: R13_CONFIG.topFrac, topSlackMin: R13_CONFIG.topSlackMin,
  partialDepth: R13_CONFIG.partialDepth, minPartialRise: R13_CONFIG.minPartialRise, minTorso: R13_CONFIG.minTorso,
  minRepMs: R13_CONFIG.minRepMs, minCycleMs: R13_CONFIG.minCycleMs, maxOcclusionMs: R13_CONFIG.maxOcclusionMs, maxGapMs: R13_CONFIG.maxGapMs,
  abortFrac: 0.3, agreeFrac: 0.35, sigRevEps: 0.02, sigRecoverFrac: 0.4, minSigRange: 0.08,
  thighCredible: 0.5, hingeKnee: 0.1, pelvisScale: 0.667, kneeScale: 150, refAlpha: 0.05,
  pelvisMin: 0.22, kneeMin: 30, voteW: 0.3, authW: 0.7, vetoFrac: 0.25, hingeKneeDeg: 15, hingeLean: 35, wAlpha: 0.15,
};
export const R132_REVISION = 'r13.2-signal-reliability-comparison-only';
export const R132_LABEL = 'Skeleton phase: r13.1 (comparison only)';

export interface R132Sample { timestampMs: number; depth: number | null; torso?: number | null; sk?: SkFeat | null; /** View cue 0 (side) … 1 (front) from the selected skeleton; null = not measurable. */ front?: number | null }

export type CycleOutcome = 'counted' | 'partial' | 'aborted' | 'voided' | 'geometry' | 'minRep' | 'open';
export interface R132Cycle {
  tStart: number; tEnd: number | null; outcome: CycleOutcome; resync: boolean;
  signalsSeen: Sig[];
  depthRange: number; pelvisDropTorso: number | null; kneeFlexDeg: number | null; maxLean: number | null;
  hesitations: number; rebottoms: number; contradictions: number; sideSwitches: number;
  bottom: { t: number; votes: Sig[]; avail: Sig[]; fallback: boolean; reached: Sig[]; weights: Record<Sig, number> } | null;
  /** Mean view cue over the cycle (0 side … 1 front); null if never measurable. */
  front: number | null;
  /** Why the cycle did not count (plain words), or null. */
  reason: string | null;
  hingeEvidence: string | null;
  frontSum: number; frontN: number;
  top: { t: number; votes: Sig[]; avail: Sig[]; via: 'plateau' | 'newDescent' | 'upright' } | null;
}
export type R132EventKind = 'calibrated' | 'lost' | 'calibrationPreserved' | 'calibrationExpired' | 'resyncStart' | 'resyncCycle' | 'partialVoided' | 'rep' | 'reset' | 'gap' | 'outOfOrder';
export interface R132Event { t: number | null; kind: R132EventKind; detail?: string }

interface SigCycle { start: number | null; max: number; min: number; seen: boolean }

export class NaturalSquatCounterR13_2 {
  readonly cfg: R132Config;
  private reps = 0; private partials = 0;
  private phase: R132Phase = 'uncalibrated';
  // calibration / envelope (survives a short interrupt)
  private upright: number | null = null;
  private ranges: number[] = [];
  private hipRef: number | null = null; private torsoRef: number | null = null;
  private kneeRef: number | null = null; private thighRef: number | null = null;
  // signal state (voided on interrupt)
  private buf: Record<Sig, number[]> = { depth: [], pelvis: [], knee: [] };
  private prevSet = ''; private prevRawC: number | null = null; private bias = 0;
  private cur: Partial<Record<Sig, number>> = {};
  private lastT: number | null = null; private lastObsT: number | null = null;
  private lostAt: number | null = null; private pendingLoss = false;
  private sampleIdx = 0; private resyncFrom = -1;
  // phase state
  private trough = Infinity; private troughIdx = -1;
  private cycleStart = 0; private cycleT = 0; private peak = 0; private cycleMax = 0;
  private stillRun = 0; private stillMax = 0; private bottomed = false;
  private uprightRun = 0; private peakRun = 0; private dirRun = 0; private abortRun = 0; private plateauRun = 0; private calibRun = 0;
  private folded = false; private hinge = false; private lastRepMs = -Infinity; private resyncCycle = false;
  private sc: Record<Sig, SigCycle> = blankSc();
  /** Signal values at the observed trough (a cycle's per-signal start = its observed minimum). */
  private troughSig: Partial<Record<Sig, number>> = {};
  private w: Record<Sig, number> = { depth: 1, pelvis: 1, knee: 1 };
  private front: number | null = null;
  private torsoBuf: number[] = [];
  private reachRun: Record<Sig, number> = { depth: 0, pelvis: 0, knee: 0 };
  private sigRanges: Record<'pelvis' | 'knee', number[]> = { pelvis: [], knee: [] };
  private leanStart: number | null = null;
  private member: Record<Sig, boolean> = { depth: true, pelvis: false, knee: false };
  private cyc: R132Cycle | null = null;
  private switchesAtStart = 0; private lastSwitches = 0; private lastLean: number | null = null;
  private rawKnee: number | null = null; private rawHip: number | null = null;
  /** Write-only analysis logs (bounded); never read by the rules. */
  readonly events: R132Event[] = [];
  readonly cycles: R132Cycle[] = [];

  constructor(cfg: Partial<R132Config> = {}) { this.cfg = { ...R132_CONFIG, ...cfg }; }
  get count() { return this.reps; }
  get currentPhase() { return this.phase; }
  get currentStage(): Stage { return toStage(this.phase); }

  private log(t: number | null, kind: R132EventKind, detail?: string) { if (this.events.length < 5000) this.events.push({ t, kind, detail }); }
  private close(outcome: CycleOutcome, t: number | null) {
    if (!this.cyc) return;
    const c = this.cyc; c.outcome = outcome; c.tEnd = t;
    c.depthRange = round3(Math.max(0, this.sc.depth.max - (this.sc.depth.start ?? this.sc.depth.max)));
    c.pelvisDropTorso = this.sc.pelvis.seen ? round3(Math.max(0, this.sc.pelvis.max - (this.sc.pelvis.start ?? this.sc.pelvis.max)) * this.cfg.pelvisScale) : null;
    c.kneeFlexDeg = this.sc.knee.seen ? Math.round(Math.max(0, this.sc.knee.max - (this.sc.knee.start ?? this.sc.knee.max)) * this.cfg.kneeScale) : null;
    c.signalsSeen = SIGS.filter((s) => this.sc[s].seen);
    c.sideSwitches = this.lastSwitches - this.switchesAtStart;
    c.front = c.frontN ? round3(c.frontSum / c.frontN) : null;
    if (!c.reason) c.reason = outcome === 'partial' ? 'reversed before any reliable bottom (not deep)' : outcome === 'aborted' ? 'small dip, returned to start' : outcome === 'voided' ? 'tracking lost mid-squat (unfinished squat dropped)' : outcome === 'minRep' ? 'too soon after previous' : outcome === 'geometry' ? (c.hingeEvidence ?? 'body folded') : null;
    if (this.cycles.length < 2000) this.cycles.push(c);
    this.cyc = null;
  }

  interrupt(): Reject | null {
    const mid = this.phase === 'down' || this.phase === 'up';
    if (mid) this.close('voided', this.lastObsT);
    this.voidPartial();
    if (this.upright !== null) { if (!this.pendingLoss) this.lostAt = this.lastObsT; this.phase = 'resync'; this.pendingLoss = true; }
    else this.phase = 'uncalibrated';
    if (mid) this.log(this.lastObsT, 'partialVoided');
    return mid ? 'interrupted' : null;
  }
  resetCalibration(): void {
    if (this.cyc) this.close('voided', this.lastObsT);
    this.voidPartial();
    this.upright = null; this.ranges = []; this.hipRef = this.torsoRef = this.kneeRef = this.thighRef = null; this.torsoBuf = []; this.sigRanges = { pelvis: [], knee: [] }; this.front = null;
    this.phase = 'uncalibrated'; this.lostAt = null; this.pendingLoss = false;
  }
  reset(): void {
    this.resetCalibration();
    this.reps = this.partials = 0; this.lastRepMs = -Infinity;
    this.log(null, 'reset');
  }
  private voidPartial() {
    this.buf = { depth: [], pelvis: [], knee: [] }; this.prevSet = ''; this.prevRawC = null; this.bias = 0;
    this.trough = Infinity; this.troughIdx = -1; this.peak = 0; this.peakRun = 0; this.dirRun = 0; this.abortRun = 0;
    this.plateauRun = 0; this.calibRun = 0; this.folded = false; this.hinge = false; this.resyncCycle = false;
    this.cycleMax = 0; this.stillRun = 0; this.stillMax = 0; this.bottomed = false; this.sc = blankSc();
  }
  private rangeScale(): number {
    if (!this.ranges.length) return 0;
    const v = [...this.ranges].sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  }
  /** Range requirement is judged on the DEPTH signal (the scale the r12/r13 lines were designed for);
   *  the fused composite drives phase direction, and the other signals must agree. */
  private lowLine(): number {
    const c = this.cfg;
    const start = this.sc.depth.start ?? this.cycleStart;
    return Math.max(c.lowFloor, start + c.minRange, Math.min(c.downDepth, c.scaleFrac * this.rangeScale()));
  }
  private topLimit(): number {
    const c = this.cfg;
    const scale = this.rangeScale() || Math.max(0, this.cycleMax - this.cycleStart);
    return (this.upright ?? c.calibTop) + Math.max(c.topSlackMin, c.topFrac * scale);
  }

  /** Per-signal progress (median3 each) + continuity-carrying composite. */
  private signals(depth: number, sk: SkFeat | null | undefined): number {
    const c = this.cfg;
    // Depth keeps the session's own calibration (recorded depth) plus only the side-switch continuity correction.
    const raw: Partial<Record<Sig, number>> = { depth: Math.max(0, depth + (sk?.sideCorr ?? 0)) };
    this.rawHip = sk?.hipY ?? null; this.rawKnee = sk?.kneeFlex ?? null;
    if (sk && sk.hipY !== null && this.hipRef !== null && this.torsoRef) raw.pelvis = (sk.hipY - this.hipRef) / this.torsoRef / c.pelvisScale;
    const kneeOk = !!sk && sk.kneeFlex !== null && sk.thighLen !== null && this.thighRef !== null && sk.thighLen >= c.thighCredible * this.thighRef;
    // Reliability weights (smoothed): continuity-safe, never a hard front/side switch.
    const side = 1 - (this.front ?? 0);
    const thighCred = kneeOk ? Math.max(0, Math.min(1, (sk!.thighLen! / this.thighRef! - c.thighCredible) / 0.3)) : 0;
    const target: Record<Sig, number> = { depth: 0.6 + 0.4 * side, pelvis: 1, knee: (0.45 + 0.55 * side) * thighCred }; // front: vote-eligible but never high-authority
    for (const g of SIGS) this.w[g] += c.wAlpha * (target[g] - this.w[g]);
    if (kneeOk && this.kneeRef !== null) raw.knee = (sk!.kneeFlex! - this.kneeRef) / c.kneeScale;
    if (sk) { this.lastSwitches = sk.switches; if (sk.lean !== null) this.lastLean = sk.lean; }
    const cur: Partial<Record<Sig, number>> = {};
    const inCycle = this.phase === 'down' || this.phase === 'up';
    for (const s of SIGS) {
      let v = raw[s];
      // Inside a cycle a signal only contributes if it was present at the cycle start and never
      // dropped out since (a foreshortened knee flickering back cannot drag the composite).
      if (inCycle && s !== 'depth') { if (!this.member[s] || v === undefined) { this.member[s] = false; v = undefined; } }
      if (v === undefined || !Number.isFinite(v)) { this.buf[s] = []; continue; }
      const b = this.buf[s]; b.push(v); if (b.length > 3) b.shift();
      cur[s] = b.length < 3 ? v : median3(b);
    }
    this.cur = cur;
    const keys = SIGS.filter((s) => cur[s] !== undefined);
    // Effective weight is continuous and exactly 0 below vote eligibility, so a low-reliability signal
    // appearing/disappearing cannot shift the composite (depth always keeps a positive weight).
    const ew = (g: Sig) => Math.max(0, this.w[g] - c.voteW) / (1 - c.voteW);
    const wsum = keys.reduce((a, s) => a + ew(s), 0) || 1;
    const rawC = keys.reduce((a, s) => a + ew(s) * cur[s]!, 0) / wsum;
    const set = keys.join(',');
    if (this.prevRawC !== null && set !== this.prevSet) this.bias = this.prevRawC + this.bias - rawC;
    else this.bias *= 0.85;
    if (Math.abs(this.bias) < 1e-4) this.bias = 0;
    this.prevSet = set; this.prevRawC = rawC;
    return rawC + this.bias;
  }

  /** Set/adapt upright references while standing; never during a cycle. */
  private adaptRefs(sk: SkFeat | null | undefined, initial: boolean) {
    if (!sk) return;
    const a = initial ? 1 : this.cfg.refAlpha;
    const ema = (p: number | null, v: number | null) => (v === null ? p : p === null ? v : p + a * (v - p));
    this.hipRef = ema(this.hipRef, sk.hipY);
    // Body scale: robust median of recent UPRIGHT torso lengths, frozen during a cycle (no in-rep jitter).
    if (sk.torsoLen !== null) { this.torsoBuf.push(sk.torsoLen); if (this.torsoBuf.length > 15) this.torsoBuf.shift(); const v = [...this.torsoBuf].sort((x, y) => x - y); this.torsoRef = v[Math.floor(v.length / 2)]; }
    this.thighRef = ema(this.thighRef, sk.thighLen); this.kneeRef = ema(this.kneeRef, sk.kneeFlex);
  }

  update(sm: R132Sample): NaturalOutput {
    const r = this.step(sm);
    return { reps: this.reps, partials: this.partials, phase: toStage(this.phase) === 'unknown' ? 'unknown' : this.phase === 'top' ? 'up' : this.phase === 'up' ? 'rising' : 'down', stage: toStage(this.phase), event: r.event, reject: r.reject } as NaturalOutput;
  }

  private step({ timestampMs: t, depth, torso, sk, front }: R132Sample): { event: 'rep' | 'partial' | null; reject: Reject | null } {
    const none = { event: null, reject: null } as const;
    const c = this.cfg;
    if (this.lastT !== null && !(t > this.lastT)) { this.log(t, 'outOfOrder'); return none; }
    if (depth === null || !Number.isFinite(depth)) {
      const rj = this.phase === 'resync' || this.phase === 'uncalibrated' ? null : this.interrupt();
      if (this.phase === 'uncalibrated') this.voidPartial();
      this.lastT = t;
      return { event: null, reject: rj };
    }
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
    this.lastT = t; this.lastObsT = t; this.sampleIdx += 1;
    if (this.phase === 'uncalibrated' || this.phase === 'top' || this.phase === 'resync') {
      // Fill any reference still missing (e.g. a knee that only becomes credible later), standing phases only.
      if (sk && (this.hipRef === null || this.torsoRef === null || this.thighRef === null || this.kneeRef === null) && this.phase !== 'uncalibrated')
        this.adaptRefs({ ...sk, hipY: this.hipRef === null ? sk.hipY : null, torsoLen: this.torsoRef === null ? sk.torsoLen : null, thighLen: this.thighRef === null ? sk.thighLen : null, kneeFlex: this.kneeRef === null ? sk.kneeFlex : null }, true);
    }
    if (typeof front === 'number' && Number.isFinite(front)) this.front = this.front === null ? front : this.front + c.wAlpha * (front - this.front);
    if (this.cyc && this.front !== null) { this.cyc.frontSum += this.front; this.cyc.frontN += 1; }
    const s = this.signals(depth, sk);
    const folded = torso !== undefined && (torso === null || !Number.isFinite(torso) || torso < c.minTorso);
    if (this.phase === 'down' || this.phase === 'up') this.trackSigs();

    switch (this.phase) {
      case 'uncalibrated': {
        this.calibRun = s <= c.calibTop ? this.calibRun + 1 : 0;
        if (this.calibRun >= c.confirmSamples) {
          this.adaptRefs(sk, true);
          this.buf = { depth: [], pelvis: [], knee: [] }; this.prevRawC = null; this.prevSet = ''; this.bias = 0;
          this.upright = s; this.phase = 'top'; this.trough = s; this.troughIdx = this.sampleIdx; this.troughSig = { ...this.cur }; this.dirRun = 0;
          this.log(t, 'calibrated', s.toFixed(3));
        }
        return { event: null, reject: rj };
      }
      case 'resync':
      case 'top': {
        if (s < this.trough) { this.trough = s; this.troughIdx = this.sampleIdx; this.troughSig = { ...this.cur }; this.dirRun = 0; this.stillRun = 0; return { event: null, reject: rj }; }
        this.stillRun = s <= this.trough + c.plateauEps ? this.stillRun + 1 : 0;
        if (this.stillRun > this.stillMax) this.stillMax = this.stillRun;
        if (this.phase === 'top' && this.stillRun >= c.plateauSamples) this.adaptRefs(sk, false);
        this.dirRun = s >= this.trough + c.revEps ? this.dirRun + 1 : 0;
        if (this.dirRun >= c.dirSamples) {
          const observedMin = this.phase === 'top' || this.troughIdx > this.resyncFrom + 1 || this.stillMax >= c.plateauSamples;
          if (observedMin && this.trough <= this.topLimit()) {
            this.resyncCycle = this.phase === 'resync';
            if (this.resyncCycle) this.log(t, 'resyncCycle', `from ${this.trough.toFixed(3)}`);
            this.startDescent(t, s, folded);
          } else { this.trough = s; this.troughIdx = this.sampleIdx; this.troughSig = { ...this.cur }; }
          this.dirRun = 0;
        }
        return { event: null, reject: rj };
      }
      case 'down': {
        const dv = this.cur.depth ?? s;
        if (folded && dv >= this.lowLine()) this.folded = true;
        if (s > this.peak) { this.peak = s; this.dirRun = 0; }
        if (s > this.cycleMax) this.cycleMax = s;
        if (this.cyc && this.lastLean !== null) this.cyc.maxLean = Math.max(this.cyc.maxLean ?? 0, Math.round(this.lastLean));
        this.peakRun = dv >= this.lowLine() ? this.peakRun + 1 : this.peakRun;
        for (const g of ['pelvis', 'knee'] as const) this.reachRun[g] = this.cur[g] !== undefined && this.ownRange(g) >= this.reqOwn(g) ? this.reachRun[g] + 1 : this.reachRun[g];
        this.reachRun.depth = this.peakRun;
        const credible = this.bottomed || this.credibleBottom();
        if (!this.bottomed) {
          // Aborted partial only when the body actually recovers toward THIS cycle's start (also ends a
          // credible-but-vetoed cycle, keeping its contradiction reason).
          const abortLine = this.cycleStart + c.abortFrac * (this.cycleMax - this.cycleStart);
          this.abortRun = s <= abortLine ? this.abortRun + 1 : 0;
          if (this.abortRun >= c.dirSamples) {
            const ex = this.sc.depth.max, rose = ex - (this.sc.depth.start ?? ex) >= c.minPartialRise;
            this.phase = 'top'; this.trough = s; this.troughIdx = this.sampleIdx; this.troughSig = { ...this.cur }; this.resyncCycle = false; this.abortRun = 0; this.dirRun = 0;
            if (ex >= c.partialDepth && rose) { this.close('partial', t); this.partials += 1; return { event: 'partial', reject: 'notDeep' }; }
            this.close('aborted', t);
            return { event: null, reject: rj };
          }
        }
        this.dirRun = s <= this.peak - c.revEps ? this.dirRun + 1 : 0;
        const avail = this.availNow().filter((g) => this.w[g] >= c.voteW);
        const need = avail.length <= 1 ? c.dirSamples + 1 : c.dirSamples;
        if (this.dirRun >= need) {
          this.dirRun = 0;
          if (credible) {
            const votes = avail.filter((g) => this.agreesBottom(g));
            const veto = this.bottomed ? null : this.vetoSignal();
            if (!veto && votes.length >= Math.min(2, avail.length)) {
              if (!this.bottomed && this.cyc) this.cyc.bottom = { t, votes, avail, fallback: avail.length <= 1, reached: this.reachedSigs(), weights: { depth: round3(this.w.depth), pelvis: round3(this.w.pelvis), knee: round3(this.w.knee) } };
              if (!this.bottomed) this.checkHinge();
              this.bottomed = true; this.uprightRun = 0; this.phase = 'up'; this.trough = s; this.troughIdx = this.sampleIdx; this.troughSig = { ...this.cur }; this.plateauRun = 0;
              for (const g of SIGS) this.sc[g].min = this.cur[g] ?? Infinity;
              return { event: null, reject: rj };
            }
            if (this.cyc) { this.cyc.contradictions += 1; if (veto) this.cyc.reason = `${veto} is reliable but did not move (contradiction)`; }
          } else if (this.cyc) this.cyc.hesitations += 1;
          this.peak = s; // a new local lobe inside the SAME cycle (start and max range preserved)
        }
        return { event: null, reject: rj };
      }
      case 'up': {
        if (s < this.trough) { this.trough = s; this.troughIdx = this.sampleIdx; this.troughSig = { ...this.cur }; this.plateauRun = 0; this.dirRun = 0; }
        else this.plateauRun = s <= this.trough + c.plateauEps ? this.plateauRun + 1 : 0;
        const range = this.peak - this.cycleStart;
        const compRecovered = this.peak - this.trough >= c.recoverFrac * range && this.trough <= this.topLimit();
        const info = this.availNow().filter((g) => this.w[g] >= c.voteW && this.sigRange(g) >= c.minSigRange);
        const votes = info.filter((g) => this.recoveredSig(g));
        const recovered = compRecovered && votes.length >= Math.min(2, info.length);
        this.dirRun = s >= this.trough + c.revEps ? this.dirRun + 1 : 0;
        const newDescent = this.dirRun >= c.dirSamples;
        this.uprightRun = s <= Math.max(c.calibTop, (this.upright ?? 0) + c.plateauEps) ? this.uprightRun + 1 : 0;
        const via = newDescent ? 'newDescent' : this.plateauRun >= c.plateauSamples ? 'plateau' : this.uprightRun >= c.confirmSamples ? 'upright' : null;
        if (recovered && via) {
          if (this.cyc) this.cyc.top = { t, votes, avail: info, via };
          const out = this.complete(t);
          if (newDescent) this.startDescent(t, s, folded); else { this.phase = 'top'; this.dirRun = 0; }
          return out.event || out.reject ? out : { event: null, reject: rj };
        }
        if (newDescent) {
          const fell = this.peak - this.trough;
          if (this.cyc) this.cyc.rebottoms += 1;
          this.phase = 'down'; this.dirRun = 0; this.peak = s; this.peakRun = 0;
          return { event: null, reject: fell >= c.minPartialRise ? 'notTall' : rj };
        }
        return { event: null, reject: rj };
      }
    }
  }

  /** Own body-relative excursion: depth units, pelvis torso lengths, knee degrees. */
  private ownRange(g: Sig): number { const r = Math.max(0, this.sigRange(g)); return g === 'pelvis' ? r * this.cfg.pelvisScale : g === 'knee' ? r * this.cfg.kneeScale : r; }
  /** Required own-unit excursion: generic minimum, then bounded slow adaptation to counted cycles. */
  private reqOwn(g: 'pelvis' | 'knee'): number {
    const base = g === 'pelvis' ? this.cfg.pelvisMin : this.cfg.kneeMin;
    const h = this.sigRanges[g];
    if (h.length < 2) return base;
    const v = [...h].sort((a, b) => a - b), med = v[Math.floor(v.length / 2)];
    return Math.max(0.7 * base, Math.min(1.3 * base, 0.5 * med));
  }
  private reqFor(g: Sig): number { return g === 'depth' ? Math.max(1e-6, this.lowLine() - (this.sc.depth.start ?? 0)) : this.reqOwn(g); }
  private reachedSigs(): Sig[] { return SIGS.filter((g) => this.reachRun[g] >= this.cfg.confirmSamples && this.member[g] !== false && this.cur[g] !== undefined && this.w[g] >= this.cfg.voteW); }
  private credibleBottom(): boolean {
    const c = this.cfg;
    const reached = this.reachedSigs();
    if (!reached.length) return false;
    const elig = this.availNow().filter((g) => this.w[g] >= c.voteW);
    const half = (g: Sig) => this.ownRange(g) >= 0.5 * this.reqFor(g);
    if (reached.includes('depth')) {
      // Legacy r13.1 path: sustained depth + any corroboration, or depth alone when nothing else exists.
      const others = elig.filter((g) => g !== 'depth');
      return !others.length || others.some(half);
    }
    // Depth compressed (e.g. facing the camera): the evidence must span two INDEPENDENT landmark groups —
    // depth and pelvis both come from the hip, the knee angle does not.
    const grp = (g: Sig) => (g === 'knee' ? 'knee' : 'hip');
    return reached.some((r) => elig.some((g) => grp(g) !== grp(r) && (reached.includes(g) || half(g))));
  }
  /** A HIGH-authority signal that clearly did not move vetoes the bottom (never majority-voted away). */
  private vetoSignal(): Sig | null {
    const c = this.cfg;
    for (const g of this.availNow()) {
      if (this.w[g] < c.authW) continue;
      const req = this.reqFor(g);
      if (this.ownRange(g) < c.vetoFrac * req) return g;
    }
    return null;
  }
  private checkHinge() {
    const c = this.cfg;
    const kneeDeg = this.ownRange('knee'), kneeAuth = this.cur.knee !== undefined && this.w.knee >= c.authW;
    const leanGain = this.lastLean !== null && this.leanStart !== null ? this.lastLean - this.leanStart : null;
    if (kneeAuth && kneeDeg < c.hingeKneeDeg) { this.hinge = true; if (this.cyc) this.cyc.hingeEvidence = `hinge: reliable knee bent only ${Math.round(kneeDeg)}°`; return; }
    if (leanGain !== null && leanGain >= c.hingeLean && this.ownRange('pelvis') < this.reqOwn('pelvis') && kneeDeg < c.kneeMin) {
      this.hinge = true; if (this.cyc) this.cyc.hingeEvidence = `hinge: torso lean +${Math.round(leanGain)}° with pelvis drop ${this.ownRange('pelvis').toFixed(2)} torso and knee ${Math.round(kneeDeg)}°`;
    }
  }
  private availNow(): Sig[] { return SIGS.filter((g) => this.cur[g] !== undefined && this.sc[g].start !== null); }
  private sigRange(g: Sig) { const x = this.sc[g]; return x.start === null ? 0 : x.max - x.start; }
  private agreesBottom(g: Sig): boolean {
    const comp = Math.max(1e-6, this.cycleMax - this.cycleStart);
    return this.sigRange(g) >= this.cfg.agreeFrac * comp && this.sc[g].max - (this.cur[g] as number) >= this.cfg.sigRevEps;
  }
  private recoveredSig(g: Sig): boolean {
    const x = this.sc[g], v = this.cur[g] as number;
    return x.start !== null && x.max - v >= this.cfg.sigRecoverFrac * (x.max - x.start);
  }
  private trackSigs() {
    for (const g of SIGS) {
      const v = this.cur[g]; if (v === undefined) continue;
      const x = this.sc[g]; x.seen = true;
      if (x.start === null) { x.start = v; x.max = v; x.min = v; }
      if (v > x.max) x.max = v;
      if (v < x.min) x.min = v;
    }
  }

  private startDescent(t: number, s: number, folded: boolean) {
    if (this.cyc) this.close('open', t);
    this.phase = 'down'; this.cycleStart = this.trough; this.cycleT = t; this.peak = s; this.cycleMax = s; this.peakRun = 0; this.abortRun = 0;
    this.bottomed = false; this.hinge = false;
    this.sc = blankSc();
    for (const g of SIGS) { const v = this.cur[g]; this.member[g] = v !== undefined; if (v !== undefined) { const st = Math.min(v, this.troughSig[g] ?? v); this.sc[g] = { start: st, max: v, min: st, seen: true }; } }
    this.switchesAtStart = this.lastSwitches;
    this.reachRun = { depth: 0, pelvis: 0, knee: 0 }; this.leanStart = this.lastLean;
    this.folded = folded && (this.cur.depth ?? s) >= this.lowLine();
    this.cyc = { tStart: t, tEnd: null, outcome: 'open', resync: this.resyncCycle, signalsSeen: [], depthRange: 0, pelvisDropTorso: null, kneeFlexDeg: null, maxLean: null, hesitations: 0, rebottoms: 0, contradictions: 0, sideSwitches: 0, bottom: null, top: null, front: null, reason: null, hingeEvidence: null, frontSum: 0, frontN: 0 };
  }

  private complete(t: number): { event: 'rep' | null; reject: Reject | null } {
    const c = this.cfg;
    const range = Math.max(0, this.sc.depth.max - (this.sc.depth.start ?? this.sc.depth.max));
    const top = this.cur.depth ?? this.trough;
    if (this.folded || this.hinge) { this.close('geometry', t); return { event: null, reject: 'geometry' }; }
    if (t - this.cycleT < c.minCycleMs || t - this.lastRepMs < c.minRepMs) { this.close('minRep', t); return { event: null, reject: 'minRep' }; }
    this.reps += 1; this.lastRepMs = t;
    this.ranges.push(range); if (this.ranges.length > 5) this.ranges.shift();
    for (const g of ['pelvis', 'knee'] as const) if (this.sc[g].seen && this.w[g] >= c.voteW) { this.sigRanges[g].push(this.ownRange(g)); if (this.sigRanges[g].length > 5) this.sigRanges[g].shift(); }
    if (this.upright !== null) this.upright = Math.min(this.upright * 0.7 + top * 0.3, c.calibTop);
    this.log(t, 'rep', `${this.resyncCycle ? 'resync ' : ''}range ${range.toFixed(3)}`);
    this.close('counted', t);
    this.resyncCycle = false;
    this.trough = top;
    void this.rawHip; void this.rawKnee;
    return { event: 'rep', reject: null };
  }
}

const blankSc = (): Record<Sig, SigCycle> => ({ depth: { start: null, max: -Infinity, min: Infinity, seen: false }, pelvis: { start: null, max: -Infinity, min: Infinity, seen: false }, knee: { start: null, max: -Infinity, min: Infinity, seen: false } });
const median3 = (v: number[]) => { const [a, b, c] = v; return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c)); };
const round3 = (n: number) => Math.round(n * 1000) / 1000;
export function toStage(p: R132Phase): Stage {
  return p === 'top' ? 'ready' : p === 'down' ? 'descending' : p === 'up' ? 'ascending' : 'unknown';
}
