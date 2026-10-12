/**
 * The pose vocabulary the camera flow uses. Counting shapes come from the
 * frozen core (through the typed boundary); the visual-only points are app
 * code and never reach counting.
 */
import type { Keypoint, Landmark, Pose, PoseFrame } from './frozen';

export type { Keypoint, Landmark, Pose, PoseFrame };

/**
 * VISUAL-ONLY POINTS, for the body guide (head ring, elbows, wrists). They are
 * carried NEXT TO a counting pose, never inside it: the frozen session only
 * ever receives the nine counting keypoints.
 */
export const VISUAL_KEYPOINTS = [
  'leftEar',
  'rightEar',
  'leftElbow',
  'rightElbow',
  'leftWrist',
  'rightWrist',
] as const;

export type VisualKeypoint = (typeof VISUAL_KEYPOINTS)[number];

export type VisualPose = Partial<Record<VisualKeypoint, Landmark>>;
