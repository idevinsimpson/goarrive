// R13.1 replay-only skeleton feature adapter — COMPARISON-ONLY (never wired live).
//
// Turns ONE recorded trace frame of the SELECTED subject (9 keypoints [x, y, visibility], standing
// ratio, timestamps) into body-relative movement features. Pure, local-only; nothing is stored,
// uploaded or sent. Missing joints are NEVER synthesised: a feature whose joints are not visible is
// null for that frame. Left/right legs are kept in separate smoothed histories (SideStabilizer) and
// an offset is carried across a side switch, so a change from both legs to one leg cannot create a
// fake velocity or reversal.
//
// Limitation (declared): trace frames do not carry the camera aspect ratio, so 2D knee angles are
// measured in normalised image units. Only CHANGE relative to the track's own upright reference is
// used, never an absolute angle.
import { SideStabilizer } from '../r13/sideStabilizer';

export const MIN_VIS = 0.5;
/** Index of each keypoint in TraceFrame.joints (KEYPOINTS order × [x, y, visibility]). */
const K = { lSh: 1, rSh: 2, lHip: 3, rHip: 4, lKnee: 5, rKnee: 6, lAnk: 7, rAnk: 8 } as const;

export interface FrameIn {
  t: number;
  joints?: (number | null)[] | null;
  standingRatio?: number | null;
}

export interface SkFeat {
  /** Depth recomputed from the side-stabilised per-leg ratio and the recorded standing ratio. */
  sideDepth: number | null;
  /** Side-continuity correction to the RECORDED (both-leg-averaged) depth: (raw mean ratio − stabilised ratio)/(S − 1). */
  sideCorr: number;
  /** Side-stabilised hip-centre y (image units, larger = lower). */
  hipY: number | null;
  /** Instant shoulder-to-hip length (image units) — the counter keeps its own frozen reference. */
  torsoLen: number | null;
  /** Side-stabilised knee flexion in degrees (180 − hip-knee-ankle angle). */
  kneeFlex: number | null;
  /** Instant 2D thigh length; used by the counter to reject a foreshortened (front-view) knee angle. */
  thighLen: number | null;
  /** Torso lean from vertical (degrees) — plausibility/analysis only. */
  lean: number | null;
  /** Cumulative leg-side switches seen by the stabilisers. */
  switches: number;
  /** bit0 = left leg chain visible, bit1 = right. */
  mask: number;
}

type P = { x: number; y: number } | null;
function pt(j: (number | null)[], i: number): P {
  const x = j[i * 3], y = j[i * 3 + 1], v = j[i * 3 + 2];
  if (typeof x !== 'number' || typeof y !== 'number' || typeof v !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !(v >= MIN_VIS)) return null;
  return { x, y };
}
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
function flex(h: { x: number; y: number }, k: { x: number; y: number }, a: { x: number; y: number }): number | null {
  const ux = h.x - k.x, uy = h.y - k.y, vx = a.x - k.x, vy = a.y - k.y;
  const n = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (!(n > 1e-6)) return null;
  const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / n));
  return 180 - (Math.acos(cos) * 180) / Math.PI;
}

export class SkeletonFeatureAdapter {
  private ratio = new SideStabilizer({ alpha: 1 }); // separate L/R histories; smoothing is the counter's median3
  private hip = new SideStabilizer({ alpha: 0.8, compatTol: 0.03 });
  private knee = new SideStabilizer({ alpha: 0.8, compatTol: 12 });

  reset() { this.ratio.reset(); this.hip.reset(); this.knee.reset(); }
  get switches() { return this.ratio.switches + this.knee.switches; }

  /** Malformed or absent joints → null (the counter then falls back to the recorded depth alone). */
  feat(f: FrameIn | null): SkFeat | null {
    const j = f?.joints;
    if (!f || !Array.isArray(j) || j.length !== 27) { this.reset(); return null; }
    const side = (h: number, k: number, a: number) => {
      const H = pt(j, h), Kn = pt(j, k), A = pt(j, a);
      if (!H || !Kn || !A) return { ratio: null, flex: null, thigh: null, hipY: H ? H.y : null };
      const shin = A.y - Kn.y;
      return { ratio: shin > 0.01 ? (A.y - H.y) / shin : null, flex: flex(H, Kn, A), thigh: dist(H, Kn), hipY: H.y };
    };
    const L = side(K.lHip, K.lKnee, K.lAnk), R = side(K.rHip, K.rKnee, K.rAnk);
    const mask = (L.ratio !== null ? 1 : 0) | (R.ratio !== null ? 2 : 0);
    const r = this.ratio.update(L.ratio, R.ratio);
    const kf = this.knee.update(L.flex, R.flex);
    const lh = pt(j, K.lHip), rh = pt(j, K.rHip);
    const hy = this.hip.update(lh ? lh.y : null, rh ? rh.y : null);
    const thighs = [L.thigh, R.thigh].filter((v): v is number => v !== null);
    const ls = pt(j, K.lSh), rs = pt(j, K.rSh);
    const torsos: number[] = [];
    if (ls && lh) torsos.push(dist(ls, lh));
    if (rs && rh) torsos.push(dist(rs, rh));
    const shC = ls && rs ? { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 } : ls ?? rs;
    const hipC = lh && rh ? { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 } : lh ?? rh;
    const lean = shC && hipC && hipC.y - shC.y > 1e-4 ? (Math.atan2(Math.abs(shC.x - hipC.x), hipC.y - shC.y) * 180) / Math.PI : null;
    const S = f.standingRatio;
    const sideDepth = r !== null && typeof S === 'number' && S - 1 > 0.2 ? Math.max(0, Math.min(1.5, (S - r) / (S - 1))) : null;
    const rawR = [L.ratio, R.ratio].filter((v): v is number => v !== null);
    const sideCorr = r !== null && rawR.length && typeof S === 'number' && S - 1 > 0.2 ? (rawR.reduce((a, b) => a + b, 0) / rawR.length - r) / (S - 1) : 0;
    return {
      sideDepth, sideCorr, hipY: hy, torsoLen: torsos.length ? torsos.reduce((a, b) => a + b, 0) / torsos.length : null,
      kneeFlex: kf, thighLen: thighs.length ? thighs.reduce((a, b) => a + b, 0) / thighs.length : null,
      lean, switches: this.switches, mask,
    };
  }
}
