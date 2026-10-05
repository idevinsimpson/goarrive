/**
 * THE BODY GUIDE, AS GEOMETRY. One tracked person: a head ring (no head dot),
 * both shoulders and arms (shoulder → elbow → wrist), the torso sides and
 * hips, and both legs (hip → knee → ankle). No neck line. A joint the engine
 * did not see lifts the pen; a chain left with fewer than two points is not
 * drawn. Drawing only — nothing here is read by counting.
 *
 * Coordinates come in normalised and unmirrored; they go out in a viewBox
 * `W × 1000`, W = round(aspect × 1000). The mirror is applied to the drawing.
 */
import type { Landmark, Pose, VisualPose } from './types';

export const FIGURE_VIS = 0.5;
export const FIGURE_H = 1000;

type Any = Partial<Record<string, Landmark>>;

const CHAINS: string[][] = [
  ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow', 'rightWrist'],
  ['leftShoulder', 'leftHip'],
  ['rightShoulder', 'rightHip'],
  ['leftHip', 'rightHip'],
  ['leftHip', 'leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee', 'rightAnkle'],
];

export interface FigureGeometry {
  width: number;
  height: number;
  /** Polylines, each at least two points, in viewBox units. */
  lines: { x: number; y: number }[][];
  head: { cx: number; cy: number; r: number } | null;
}

export function figureGeometry(subject: Pose, visual: VisualPose | null, aspect: number): FigureGeometry {
  const W = Math.round((aspect > 0 ? aspect : 1) * FIGURE_H);
  const all: Any = { ...(visual ?? {}), ...subject };
  const pt = (k: string) => {
    const p = all[k];
    return p && p.visibility >= FIGURE_VIS ? { x: p.x * W, y: p.y * FIGURE_H } : null;
  };
  const lines: { x: number; y: number }[][] = [];
  for (const chain of CHAINS) {
    let run: { x: number; y: number }[] = [];
    for (const k of chain) {
      const p = pt(k);
      if (p) run.push(p);
      else {
        if (run.length >= 2) lines.push(run);
        run = [];
      }
    }
    if (run.length >= 2) lines.push(run);
  }
  const dist = (a: { x: number; y: number } | null, b: { x: number; y: number } | null) =>
    a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  const le = pt('leftEar');
  const re = pt('rightEar');
  const nose = pt('nose');
  const centre = le && re ? { x: (le.x + re.x) / 2, y: (le.y + re.y) / 2 } : nose;
  const head = centre
    ? {
        cx: centre.x,
        cy: centre.y,
        r: Math.min(150, Math.max(26, dist(le, re) * 0.75, dist(pt('leftShoulder'), pt('rightShoulder')) * 0.33)),
      }
    : null;
  return { width: W, height: FIGURE_H, lines, head };
}
