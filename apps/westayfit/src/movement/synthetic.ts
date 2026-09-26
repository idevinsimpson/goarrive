import type { Keypoint, Pose, PoseFrame } from './types';

/**
 * SYNTHETIC PEOPLE. Deterministic stick-figure landmarks for the unit tests
 * and for the lab's "synthetic scene" source (a no-camera way to watch the
 * lock and counter work in a browser).
 *
 * This is NOT evidence that the counter works on real bodies. It is evidence
 * that the logic does what it says on inputs whose truth is known exactly.
 * Real-camera evidence is gathered separately (docs/westayfit/movement-vision).
 */

export interface SyntheticPerson {
  /** Horizontal centre, 0..1. */
  cx: number;
  /** Ankle height, 0..1 (1 = bottom of frame). */
  footY: number;
  /** Standing nose-to-ankle height, as a fraction of frame height. */
  height: number;
  /** Squat depth: 0 standing, 1 hip at knee height. */
  depth: number;
  visibility?: number;
  /** Keypoints the engine "did not see" (occlusion, cropped legs). */
  hide?: Keypoint[];
}

export function syntheticPose(p: SyntheticPerson): Pose {
  const H = p.height;
  const v = p.visibility ?? 0.95;
  const shin = 0.26 * H;
  const ankleY = p.footY;
  const kneeY = ankleY - shin;
  const hipY = ankleY - (2 - p.depth) * shin; // ratio = 2 − depth, see geometry.squatRatio
  const lean = Math.min(1, p.depth) * 0.5; // torso tips forward as they sink
  const shoulderY = hipY - 0.36 * H * Math.cos(lean);
  const noseY = shoulderY - 0.12 * H;
  const kneeOut = 0.07 * H + p.depth * 0.03 * H;
  const pose: Pose = {
    nose: { x: p.cx, y: noseY, visibility: v },
    leftShoulder: { x: p.cx + 0.08 * H, y: shoulderY, visibility: v },
    rightShoulder: { x: p.cx - 0.08 * H, y: shoulderY, visibility: v },
    leftHip: { x: p.cx + 0.06 * H, y: hipY, visibility: v },
    rightHip: { x: p.cx - 0.06 * H, y: hipY, visibility: v },
    leftKnee: { x: p.cx + kneeOut, y: kneeY, visibility: v },
    rightKnee: { x: p.cx - kneeOut, y: kneeY, visibility: v },
    leftAnkle: { x: p.cx + 0.06 * H, y: ankleY, visibility: v },
    rightAnkle: { x: p.cx - 0.06 * H, y: ankleY, visibility: v },
  };
  for (const k of p.hide ?? []) delete pose[k];
  return pose;
}

/** Sample `scene` at `fps` over [fromMs, toMs). */
export function renderFrames(
  fromMs: number,
  toMs: number,
  scene: (tMs: number) => Pose[],
  fps = 30,
): PoseFrame[] {
  const out: PoseFrame[] = [];
  const step = 1000 / fps;
  for (let t = fromMs; t < toMs; t += step) {
    const ts = Math.round(t * 1000) / 1000;
    out.push({ timestampMs: ts, poses: scene(ts) });
  }
  return out;
}

/**
 * One smooth squat: 0 → maxDepth → 0 over `periodMs`, starting at `startMs`,
 * with an optional hold of `holdMs` at the bottom. 0 outside the rep.
 */
export function squatDepth(
  tMs: number,
  startMs: number,
  periodMs: number,
  maxDepth: number,
  holdMs = 0,
): number {
  const t = tMs - startMs;
  const half = periodMs / 2;
  if (t < 0 || t > periodMs + holdMs) return 0;
  if (t <= half) return maxDepth * Math.sin((t / half) * (Math.PI / 2));
  if (t <= half + holdMs) return maxDepth;
  const u = (t - half - holdMs) / half;
  return maxDepth * Math.cos(u * (Math.PI / 2));
}

/** A run of identical reps, one after another, each followed by `restMs` standing. */
export function repeatedSquats(
  tMs: number,
  startMs: number,
  reps: number,
  periodMs: number,
  maxDepth: number,
  restMs = 300,
): number {
  const slot = periodMs + restMs;
  const t = tMs - startMs;
  if (t < 0) return 0;
  const i = Math.floor(t / slot);
  if (i >= reps) return 0;
  return squatDepth(t - i * slot, 0, periodMs, maxDepth);
}

/**
 * THE LAB'S SCRIPTED SCENE (loops every 24 s). What a tester should see:
 *   0–2 s    the member steps in and stands → lock
 *   2–8 s    three full squats → 3
 *   8–10 s   a half squat → partial, no count
 *   10–13 s  a second person walks BEHIND the member → counting paused, 0 added
 *   13–15 s  the member is re-acquired
 *   15–19 s  a second person squats at the far edge of frame while the member
 *            does two squats → 2 more (5), the other person adds none
 *   19–24 s  the member walks out → lost
 */
export function labDemoScene(tMs: number): Pose[] {
  const t = tMs % 24000;
  const poses: Pose[] = [];
  const member: SyntheticPerson = { cx: 0.5, footY: 0.92, height: 0.7, depth: 0 };
  if (t < 19000) {
    if (t >= 2000 && t < 8000) member.depth = repeatedSquats(t, 2000, 3, 1600, 0.95, 400);
    if (t >= 8000 && t < 10000) member.depth = squatDepth(t, 8200, 1400, 0.4);
    if (t >= 15200 && t < 19000) member.depth = repeatedSquats(t, 15200, 2, 1500, 0.95, 300);
    poses.push(syntheticPose(member));
  } else if (t < 20500) {
    poses.push(syntheticPose({ ...member, cx: 0.5 + (t - 19000) / 1500 }));
  }
  if (t >= 10000 && t < 13000) {
    // Smaller (further away), walking left to right straight through the member.
    poses.push(syntheticPose({ cx: 0.1 + ((t - 10000) / 3000) * 0.8, footY: 0.8, height: 0.55, depth: 0 }));
  }
  if (t >= 15000 && t < 19000) {
    poses.push(
      syntheticPose({ cx: 0.1, footY: 0.9, height: 0.6, depth: repeatedSquats(t, 15000, 3, 1100, 1, 200) }),
    );
  }
  return poses;
}
