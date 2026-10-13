import type { Box, Keypoint, Landmark, Pose } from './types';

/**
 * PURE GEOMETRY OVER A POSE. No state, no thresholds that carry policy
 * (those live in subjectLock.ts and squatCounter.ts).
 */

export const DEFAULT_MIN_VISIBILITY = 0.5;

export function visiblePoint(
  pose: Pose,
  key: Keypoint,
  minVisibility = DEFAULT_MIN_VISIBILITY,
): Landmark | null {
  const p = pose[key];
  if (!p) return null;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  if (!(p.visibility >= minVisibility)) return null;
  return p;
}

/** Bounding box of the visible keypoints, or null when fewer than two are visible. */
export function poseBox(pose: Pose, minVisibility = DEFAULT_MIN_VISIBILITY): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let n = 0;
  for (const key of Object.keys(pose) as Keypoint[]) {
    const p = visiblePoint(pose, key, minVisibility);
    if (!p) continue;
    n += 1;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (n < 2) return null;
  return {
    minX,
    minY,
    maxX,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    w: maxX - minX,
    h: maxY - minY,
  };
}

/**
 * The sides (left/right) on which hip, knee and ankle are all visible. A squat
 * can only be measured on such a side.
 */
function measurableLegs(pose: Pose, minVisibility: number) {
  const legs: { hip: Landmark; knee: Landmark; ankle: Landmark }[] = [];
  for (const side of ['left', 'right'] as const) {
    const hip = visiblePoint(pose, `${side}Hip`, minVisibility);
    const knee = visiblePoint(pose, `${side}Knee`, minVisibility);
    const ankle = visiblePoint(pose, `${side}Ankle`, minVisibility);
    if (hip && knee && ankle) legs.push({ hip, knee, ankle });
  }
  return legs;
}

/**
 * "Whole body in frame" for this POC: a shoulder and at least one fully
 * visible leg (hip, knee, ankle). Without a leg there is nothing to count.
 */
export function isFullBody(pose: Pose, minVisibility = DEFAULT_MIN_VISIBILITY): boolean {
  const shoulder =
    visiblePoint(pose, 'leftShoulder', minVisibility) ||
    visiblePoint(pose, 'rightShoulder', minVisibility);
  return !!shoulder && measurableLegs(pose, minVisibility).length > 0;
}

/**
 * THE SQUAT SIGNAL, AS A SCALE-FREE RATIO.
 *
 *   ratio = (ankle.y − hip.y) / (ankle.y − knee.y)
 *
 * Standing, the hip sits about two shin-lengths above the ankle: ratio ≈ 2.
 * At a parallel squat the hip has dropped to knee height: ratio ≈ 1. Deeper
 * than parallel it falls below 1.
 *
 * Why this and not the 2-D knee angle: a phone propped in front of the member
 * sees the thigh pointing at the lens, and the projected knee angle barely
 * changes. Vertical hip travel measured in shin-lengths works from the front
 * and from the side, and needs no calibration for distance to the camera,
 * because both terms scale together when the member steps closer or the
 * phone is nudged.
 *
 * Averaged over the measurable legs. Null when no leg is measurable or the
 * shin is too short to divide by (a degenerate or collapsed detection).
 */
export function squatRatio(pose: Pose, minVisibility = DEFAULT_MIN_VISIBILITY): number | null {
  const legs = measurableLegs(pose, minVisibility);
  const ratios: number[] = [];
  for (const { hip, knee, ankle } of legs) {
    const shin = ankle.y - knee.y;
    if (!(shin > 0.01)) continue;
    ratios.push((ankle.y - hip.y) / shin);
  }
  if (ratios.length === 0) return null;
  return ratios.reduce((a, b) => a + b, 0) / ratios.length;
}

/**
 * Depth in [0, 1.5]: 0 at the member's own calibrated standing ratio, 1 at
 * hip-at-knee-height (ratio 1), above 1 below parallel.
 */
export function depthFromRatio(ratio: number, standingRatio: number): number {
  const span = standingRatio - 1;
  if (!(span > 0.2)) return 0;
  const d = (standingRatio - ratio) / span;
  if (d < 0) return 0;
  if (d > 1.5) return 1.5;
  return d;
}

export function boxIoU(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const iy = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
