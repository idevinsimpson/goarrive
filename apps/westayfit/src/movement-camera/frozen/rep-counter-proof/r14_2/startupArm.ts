// R14.2 STARTUP / REACQUISITION ARMING — ONE pure engine shared by the live session and the replay
// session-simulation, so both decide identically from the same op + selected-skeleton timeline.
//
// Composition (all frozen, reused by import): NaturalSquatCounterR13_3 + SkeletonFeatureAdapterR133
// + the r14.1 ≤120 ms gap grace (gapGraceOk / GraceLog). The ONLY new policy is an explicit ARM state
// in front of the counter:
//  - A fresh identity/run starts DISARMED. While disarmed the counter is NOT fed at all (no phase, no
//    calibration, nothing counted); only the feature adapter sees observed frames.
//  - Arming needs a short observed upright window of agreeing body-relative cues (standing-like depth,
//    extended knee when reliable, hip well above the ankles, flat depth + hip height, no abrupt body
//    scale change). Thresholds are generic, derived from synthetic fixtures — never from any packet.
//  - On arming a NEW r13.3 counter is created and fed exactly the observed upright window, so it
//    calibrates from that context. Nothing provisional is borrowed.
//  - Before the first rep of an armed identity, an interrupt or an ambiguity / refused-scale continuity
//    event discards the provisional counter and disarms (startup poisoning cannot survive).
//  - After at least one rep, interrupts keep the unchanged r14/r14.1 resync semantics (no re-arm).
//  - 'expired' (identity dropped → any later person is a fresh identity) always disarms; completed reps
//    are kept, calibration and partial are not.
// No inferred rep: a squat begun before arming is never counted; only cycles after the arm point are.
import type { FrameIn } from '../r13_1/skeletonFeatures';
import { viewCue } from '../r13_2/signalReliability';
import { NaturalSquatCounterR13_3, hipHeight, type R133Cycle, type SkFeat3 } from '../r13_3/naturalCounterR13_3';
import { SkeletonFeatureAdapterR133 } from '../r13_3/cameraTransform';
import type { NaturalOutput } from '../r6/naturalCounter';
import { GraceLog, freshGap, gapGraceOk, type GapState } from '../r14_1/gapGrace';

export const R142_REVISION = 'r14.2-startup-arm-comparison-sim';

export interface ArmConfig {
  /** Minimum observed span of the upright window (ms). */
  windowMs: number;
  /** Minimum observed samples in the window. */
  minSamples: number;
  /** Per-sample: standing-like depth ceiling. */
  maxDepth: number;
  /** Per-sample: knee flexion ceiling (degrees) when the knee is reliable (not foreshortened). */
  maxKneeFlex: number;
  /** Knee counted as reliable only when thigh/torso ≥ this (front-view foreshortening guard). */
  minThighNorm: number;
  /** Per-sample: hip height above ankles in torso lengths must be at least this (not crouched). */
  minHipHeight: number;
  /** Window plateau: depth range ceiling. */
  maxDepthRange: number;
  /** Window plateau: hip-height range ceiling (torso lengths). */
  maxHipRange: number;
  /** Window scale stability: max/min torso length ceiling. */
  maxScaleRatio: number;
}
export const ARM_CONFIG: ArmConfig = {
  windowMs: 400, minSamples: 8, maxDepth: 0.25, maxKneeFlex: 35, minThighNorm: 0.5,
  minHipHeight: 0.9, maxDepthRange: 0.08, maxHipRange: 0.15, maxScaleRatio: 1.1,
};
/** r14.2.1 comparison-only arm config: a high (chest) camera shows a natural standing knee at ~35–40°
 * and standing depth near 0.25–0.31, so the per-sample ceilings and plateau jitter allowances widen.
 * Body-relative hip height (≥0.9 torso above ankles) still guards against arming in a crouch.
 * r14.2's ARM_CONFIG is unchanged for A/B. */
export const R1421_REVISION = 'r14.2.1-startup-arm-camera-height-comparison-sim';
export const ARM_CONFIG_R1421: ArmConfig = {
  windowMs: 400, minSamples: 8, maxDepth: 0.33, maxKneeFlex: 45, minThighNorm: 0.5,
  minHipHeight: 0.9, maxDepthRange: 0.1, maxHipRange: 0.18, maxScaleRatio: 1.15,
};

export interface ArmSample { t: number; depth: number; torso: number | null; sk: SkFeat3 | null; front: number | null }

export type ArmLogKind = 'cont' | 'windowStart' | 'windowBroken' | 'armed' | 'discarded' | 'disarmed';
export interface ArmLogEntry { t: number | null; kind: ArmLogKind; detail: string }

/** A null sample that was NOT bridged by the grace — classified for the chest follow-up diagnostics. */
export interface RefusedNull { t: number; gapMs: number | null; lock: string | null; reason: string | null; cause: 'over-grace safe-null' | 'lock unsafe' | 'after interrupt' | 'no observed sample' }

/** Per-sample check; returns a failure reason or null. */
export function armSampleFail(s: ArmSample, cfg: ArmConfig = ARM_CONFIG): string | null {
  if (s.depth > cfg.maxDepth) return `depth ${s.depth.toFixed(2)} > ${cfg.maxDepth}`;
  if (!s.sk) return 'no measurable skeleton';
  const hh = hipHeight(s.sk);
  if (hh === null) return 'hip/ankle not measurable';
  if (hh < cfg.minHipHeight) return `hip height ${hh.toFixed(2)} torso < ${cfg.minHipHeight}`;
  const tn = s.sk.thighLen !== null && s.sk.torsoLen !== null && s.sk.torsoLen > 0.02 ? s.sk.thighLen / s.sk.torsoLen : null;
  if (s.sk.kneeFlex !== null && tn !== null && tn >= cfg.minThighNorm && s.sk.kneeFlex > cfg.maxKneeFlex) return `knee flexed ${Math.round(s.sk.kneeFlex)}°`;
  return null;
}

/** Sliding observed-upright window. Pure. */
export class ArmGate {
  buf: ArmSample[] = [];
  constructor(readonly cfg: ArmConfig = ARM_CONFIG) {}
  clear() { this.buf = []; }
  /** Returns {ready} or {broke: reason, had: samples before break}. */
  push(s: ArmSample): { ready: boolean; broke: string | null; had: number } {
    const fail = armSampleFail(s, this.cfg);
    if (fail) { const had = this.buf.length; this.buf = []; return { ready: false, broke: fail, had }; }
    this.buf.push(s);
    // Trim from the front until the window is a plateau with a stable body scale.
    let trimmed: string | null = null;
    while (this.buf.length > 1) {
      const why = this.plateauFail();
      if (!why) break;
      trimmed = why;
      this.buf.shift();
    }
    const span = this.buf.length ? this.buf[this.buf.length - 1].t - this.buf[0].t : 0;
    return { ready: this.buf.length >= this.cfg.minSamples && span >= this.cfg.windowMs, broke: trimmed, had: 0 };
  }
  private plateauFail(): string | null {
    let dMin = Infinity, dMax = -Infinity, hMin = Infinity, hMax = -Infinity, sMin = Infinity, sMax = -Infinity;
    for (const s of this.buf) {
      dMin = Math.min(dMin, s.depth); dMax = Math.max(dMax, s.depth);
      const h = hipHeight(s.sk)!; hMin = Math.min(hMin, h); hMax = Math.max(hMax, h);
      const L = s.sk?.torsoLen ?? null; if (L !== null) { sMin = Math.min(sMin, L); sMax = Math.max(sMax, L); }
    }
    if (dMax - dMin > this.cfg.maxDepthRange) return 'depth still moving';
    if (hMax - hMin > this.cfg.maxHipRange) return 'hip height still moving';
    if (sMin < Infinity && sMax / sMin > this.cfg.maxScaleRatio) return 'body scale still settling';
    return null;
  }
}

const DISARM_EVENTS = new Set(['ambiguous', 'refused-scale', 'refused-ambiguous']);

export interface FeedInfo { frame: FrameIn | null; lock: string | null | undefined; reason: string | null | undefined }
export interface FeedResult { out: NaturalOutput | null; graced: boolean; armed: boolean; armedNow: boolean }

export class R142Engine {
  c = new NaturalSquatCounterR13_3();
  readonly ad = new SkeletonFeatureAdapterR133();
  readonly gate: ArmGate;
  readonly graceLog = new GraceLog();
  gap: GapState = freshGap();
  armed = false;
  /** Reps of the current armed identity (decides whether interrupts may disarm). */
  repsSinceArm = 0;
  /** Reps in the current run (reset by reset()); cumulative across runs in totalReps. */
  runReps = 0; totalReps = 0;
  stage = 'unknown';
  armTimes: number[] = [];
  firstCountAfterArm: { armT: number; repT: number | null }[] = [];
  readonly log: ArmLogEntry[] = [];
  readonly refusedNulls: RefusedNull[] = [];
  /** Cycles from discarded/finished counter instances plus the current one. */
  private doneCycles: R133Cycle[] = [];
  private windowOpen = false;
  private prevNull = false;

  constructor(cfg: ArmConfig = ARM_CONFIG) { this.gate = new ArmGate(cfg); }

  private note(t: number | null, kind: ArmLogKind, detail: string) { if (this.log.length < 1000) this.log.push({ t, kind, detail }); }

  get cycles(): R133Cycle[] { return [...this.doneCycles, ...this.c.cycles]; }

  private disarm(t: number | null, why: string) {
    const hadState = this.armed && this.c.currentPhase !== 'uncalibrated';
    if (this.armed) { this.c.interrupt(); this.doneCycles.push(...this.c.cycles); this.c = new NaturalSquatCounterR13_3(); }
    if (this.armed) this.note(t, hadState ? 'discarded' : 'disarmed', `${why}${hadState ? ' — provisional counter state discarded' : ''}`);
    else if (this.gate.buf.length) this.note(t, 'windowBroken', `${why} (after ${this.gate.buf.length} upright samples)`);
    this.armed = false; this.repsSinceArm = 0; this.windowOpen = false;
    this.gate.clear(); this.ad.reset(); this.gap = freshGap(); this.stage = 'unknown';
  }

  private arm(t: number): NaturalOutput | null {
    this.doneCycles.push(...this.c.cycles);
    this.c = new NaturalSquatCounterR13_3();
    const w = this.gate.buf;
    this.note(t, 'armed', `stable upright ${w.length} samples over ${Math.round(w[w.length - 1].t - w[0].t)} ms (from ${w[0].t}); fresh r13.3 calibrated from this window`);
    let out: NaturalOutput | null = null;
    for (const s of w) {
      out = this.c.update({ timestampMs: s.t, depth: s.depth, torso: s.torso, sk: s.sk, front: s.front });
      if (out.event === 'rep') this.countRep(s.t);
    }
    this.gate.clear();
    this.armed = true; this.repsSinceArm = 0; this.windowOpen = false;
    this.armTimes.push(t); this.firstCountAfterArm.push({ armT: t, repT: null });
    this.gap = { lastObsT: t, unsafe: false };
    if (out) this.stage = out.stage;
    return out;
  }

  private countRep(t: number) {
    this.repsSinceArm += 1; this.runReps += 1; this.totalReps += 1;
    const f = this.firstCountAfterArm[this.firstCountAfterArm.length - 1];
    if (f && f.repT === null) f.repT = t;
  }

  feed(t: number, depth: number | null, torso: number | null, info: FeedInfo): FeedResult {
    const fr = info.frame && info.frame.t === t ? info.frame : null;
    if (!this.armed) {
      if (depth === null) {
        if (this.gate.buf.length) this.note(t, 'windowBroken', `empty sample (after ${this.gate.buf.length} upright samples)`);
        this.gate.clear(); this.ad.reset(); this.windowOpen = false;
        return { out: null, graced: false, armed: false, armedNow: false };
      }
      const sk = this.ad.feat(fr);
      const front = sk ? viewCue(fr?.joints) : null;
      const r = this.gate.push({ t, depth, torso, sk, front });
      if (r.broke && r.had >= 3) this.note(t, 'windowBroken', `${r.broke} (after ${r.had} upright samples)`);
      if (this.gate.buf.length === 1 && !this.windowOpen) { this.windowOpen = true; this.note(t, 'windowStart', 'upright window started'); }
      if (!this.gate.buf.length) this.windowOpen = false;
      if (r.ready) return { out: this.arm(t), graced: false, armed: true, armedNow: true };
      return { out: null, graced: false, armed: false, armedNow: false };
    }
    // ARMED: the unchanged r14.1 path.
    if (depth === null) {
      if (gapGraceOk(this.gap, t, info.lock, info.reason)) {
        this.graceLog.skip(this.gap.lastObsT!, t, this.stage);
        return { out: null, graced: true, armed: true, armedNow: false };
      }
      const lockOk = info.lock === 'locked' && (info.reason === null || info.reason === undefined);
      this.graceLog.refused(lockOk);
      if (!this.prevNull) {
        const gapMs = this.gap.lastObsT !== null ? Math.round(t - this.gap.lastObsT) : null;
        const cause: RefusedNull['cause'] = this.gap.lastObsT === null ? 'no observed sample' : this.gap.unsafe ? 'after interrupt' : !lockOk ? 'lock unsafe' : 'over-grace safe-null';
        if (this.refusedNulls.length < 500) this.refusedNulls.push({ t, gapMs, lock: info.lock ?? null, reason: info.reason ?? null, cause });
      }
      this.gap.unsafe = true;
    }
    this.prevNull = depth === null;
    const sk = depth === null ? (this.ad.reset(), null) : this.ad.feat(fr);
    const out = this.c.update({ timestampMs: t, depth, torso, sk, front: sk ? viewCue(fr?.joints) : null });
    if (out.event === 'rep') this.countRep(t);
    this.stage = out.stage;
    if (depth !== null) { this.gap = { lastObsT: t, unsafe: false }; this.graceLog.observed(t, out.event, out.reject, out.stage); }
    return { out, graced: false, armed: true, armedNow: false };
  }

  /** Returns true when an unfinished armed cycle was voided. */
  interrupt(t: number | null = null): boolean {
    if (!this.armed) { this.disarm(t, 'interrupt before arming'); this.graceLog.interrupt(); return false; }
    if (this.repsSinceArm === 0) { const mid = this.c.currentStage === 'descending' || this.c.currentStage === 'ascending'; this.disarm(t, 'interrupt before first rep'); this.graceLog.interrupt(); return mid; }
    const v = this.c.interrupt() === 'interrupted';
    this.ad.reset(); this.gap.unsafe = true; this.graceLog.interrupt(); this.stage = this.c.currentStage;
    return v;
  }

  cont(t: number, ev: string) {
    if (ev.startsWith('gap-grace')) return;
    this.note(t, 'cont', ev);
    if (ev === 'expired') { if (this.armed || this.gate.buf.length) this.disarm(t, 'identity expired — fresh identity must arm again'); return; }
    if (DISARM_EVENTS.has(ev) && (!this.armed || this.repsSinceArm === 0)) this.disarm(t, `${ev} before first rep`);
  }

  reset() {
    if (this.armed) { this.c.interrupt(); }
    this.doneCycles.push(...this.c.cycles);
    this.c = new NaturalSquatCounterR13_3();
    this.armed = false; this.repsSinceArm = 0; this.runReps = 0; this.windowOpen = false;
    this.gate.clear(); this.ad.reset(); this.gap = freshGap(); this.stage = 'unknown';
    this.graceLog.interrupt();
  }
}
