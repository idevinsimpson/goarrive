/**
 * The app-only visual pose path (reference: src/integration/rep-counter/visualEstimator.ts).
 *
 * Every person is mapped with the frozen BlazePose mapping, so the counter
 * receives exactly the nine counting points. Ears, elbows and wrists are kept
 * BESIDE each mapped pose, in a WeakMap keyed by that pose object, for the
 * stick figure only — they never reach counting. The frozen session returns
 * the very pose object it selected, so `visualFor(subject)` finds its extras.
 */
import type { Keypoint, Landmark, Pose, VisualKeypoint, VisualPose } from './types';

export interface RawLandmark {
  x: number;
  y: number;
  visibility?: number;
}

const EDGE = 0.02;

/**
 * BlazePose 33-landmark topology → the nine counting keypoints. Identical to
 * the frozen reference's `BLAZEPOSE_INDEX` / `mapBlazePose`
 * (frozen/rep-counter-proof/mediapipeVite.ts.txt — a unit test holds the two
 * texts equal). That file cannot be bundled as-is (it imports the reference's
 * Vite asset manifests), so the mapping lives here.
 */
export const BLAZEPOSE_INDEX: Record<Keypoint, number> = {
  nose: 0, leftShoulder: 11, rightShoulder: 12, leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28,
};

export function mapBlazePose(raw: RawLandmark[]): Pose {
  const pose: Pose = {};
  for (const key of Object.keys(BLAZEPOSE_INDEX) as Keypoint[]) {
    const p = raw[BLAZEPOSE_INDEX[key]];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const inFrame = p.x >= -EDGE && p.x <= 1 + EDGE && p.y >= -EDGE && p.y <= 1 + EDGE;
    const lm: Landmark = { x: p.x, y: p.y, visibility: inFrame && typeof p.visibility === 'number' ? p.visibility : 0 };
    pose[key] = lm;
  }
  return pose;
}

export const VISUAL_INDEX: Record<VisualKeypoint, number> = {
  leftEar: 7, rightEar: 8, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16,
};

const visuals = new WeakMap<Pose, VisualPose>();

/** Visual-only landmarks for a pose object that came out of mapPerson (null otherwise). */
export function visualFor(pose: Pose | null): VisualPose | null {
  return pose ? visuals.get(pose) ?? null : null;
}

export function mapVisual(raw: RawLandmark[]): VisualPose {
  const out: VisualPose = {};
  for (const key of Object.keys(VISUAL_INDEX) as VisualKeypoint[]) {
    const p = raw[VISUAL_INDEX[key]];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const inFrame = p.x >= -EDGE && p.x <= 1 + EDGE && p.y >= -EDGE && p.y <= 1 + EDGE;
    out[key] = { x: p.x, y: p.y, visibility: inFrame && typeof p.visibility === 'number' ? p.visibility : 0 };
  }
  return out;
}

/** Maps one raw person exactly as the frozen adapter does, plus visual extras on the side. */
export function mapPerson(raw: RawLandmark[]): Pose {
  const pose = mapBlazePose(raw);
  visuals.set(pose, mapVisual(raw));
  return pose;
}
