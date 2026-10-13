/**
 * MOVEMENT-VISION-1 — THE ENGINE-NEUTRAL POSE VOCABULARY.
 *
 * Everything under src/movement/ except the files in `web/` is pure
 * TypeScript: no React, no DOM, no camera, no ML engine. An engine adapter
 * (MediaPipe on web today; a native frame-processor later) turns its own
 * output into these shapes, and the subject lock and squat counter only ever
 * see these shapes. That is what keeps the counting logic testable with
 * synthetic landmark sequences and portable to a native build.
 *
 * COORDINATES. Normalised image coordinates of the UNMIRRORED camera frame:
 * x in [0, 1] left→right, y in [0, 1] top→bottom. A self-view that is shown
 * mirrored mirrors the drawing, never the data.
 */

/** The only keypoints the squat POC needs. Engines with more map down to these. */
export const KEYPOINTS = [
  'nose',
  'leftShoulder',
  'rightShoulder',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
  'leftAnkle',
  'rightAnkle',
] as const;

export type Keypoint = (typeof KEYPOINTS)[number];

export interface Landmark {
  x: number;
  y: number;
  /** 0..1, the engine's own confidence that this point is visible in frame. */
  visibility: number;
}

/** One detected person in one frame. Missing keys mean "not reported". */
export type Pose = Partial<Record<Keypoint, Landmark>>;

/** Everything one camera frame produced. `poses` is unordered and carries no identity. */
export interface PoseFrame {
  timestampMs: number;
  poses: Pose[];
  /** Frame width / height, so distances in x and y are comparable. Defaults to 1. */
  aspect?: number;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
}
