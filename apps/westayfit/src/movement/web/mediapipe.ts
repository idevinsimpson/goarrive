import type { PoseEstimator } from '../adapter';
import type { Keypoint, Landmark, Pose, PoseFrame } from '../types';

/**
 * THE WEB ADAPTER: @mediapipe/tasks-vision PoseLandmarker.
 *
 * Inference runs in this browser tab (WASM, GPU delegate when available). The
 * network is used only to fetch two static assets, once: the WASM runtime
 * and the model file. No frame, landmark or count is ever sent anywhere.
 *
 * VERSION PIN, AND WHY IT IS 0.10.35 AND NOT 1.x. From 1.0.0 the package
 * carries a metrics logger that POSTs API usage and performance data to
 * odml.pa.googleapis.com/v1/log (see its README "Privacy Notice"). No images
 * are sent, but it is still data leaving the device, and the owner has made no
 * consent decision for it. 0.10.35 has no such logger, which
 * tests/movement-privacy.test.ts checks against the installed bundle. See
 * docs/westayfit/movement-vision/DECISION.md.
 */

export const MEDIAPIPE_VERSION = '0.10.35';

const DEFAULT_WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const DEFAULT_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

/** Where the two static assets come from. Both can be overridden per build. */
export function mediapipeAssetUrls(): { wasmBase: string; modelUrl: string } {
  return {
    wasmBase: process.env.EXPO_PUBLIC_WSF_MV_WASM_BASE || DEFAULT_WASM_BASE,
    modelUrl: process.env.EXPO_PUBLIC_WSF_MV_MODEL_URL || DEFAULT_MODEL_URL,
  };
}

/** BlazePose 33-landmark topology → the keypoints this POC uses. */
export const BLAZEPOSE_INDEX: Record<Keypoint, number> = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
};

interface RawLandmark {
  x: number;
  y: number;
  visibility?: number;
}

/** Slack outside [0,1] before a point counts as off-frame. */
const EDGE = 0.02;

/**
 * Map one person's BlazePose landmarks to a Pose. Pure; unit-tested.
 *
 * Points outside the frame get visibility 0: BlazePose extrapolates joints it
 * cannot see (feet below the frame edge, say), and an extrapolated ankle must
 * not count as a measured one.
 */
export function mapBlazePose(raw: RawLandmark[]): Pose {
  const pose: Pose = {};
  for (const key of Object.keys(BLAZEPOSE_INDEX) as Keypoint[]) {
    const p = raw[BLAZEPOSE_INDEX[key]];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const inFrame = p.x >= -EDGE && p.x <= 1 + EDGE && p.y >= -EDGE && p.y <= 1 + EDGE;
    const lm: Landmark = {
      x: p.x,
      y: p.y,
      visibility: inFrame && typeof p.visibility === 'number' ? p.visibility : 0,
    };
    pose[key] = lm;
  }
  return pose;
}

export interface MediaPipeOptions {
  /** People per frame. The lock needs at least 2 to see a second person at all. */
  maxPoses?: number;
  /**
   * 'GPU' (default) falls back to CPU if the GPU delegate cannot start. 'CPU'
   * forces the WASM/XNNPACK path — faster than a software-emulated GPU (a
   * headless browser, a VM), slower than a real one.
   */
  delegate?: 'GPU' | 'CPU';
}

/** Build the estimator. Loads the WASM and model; rejects if either fails. */
export async function createMediaPipeEstimator(
  options: MediaPipeOptions = {},
): Promise<PoseEstimator> {
  const maxPoses = options.maxPoses ?? 3;
  // Split into its own chunk; see tasksVision.ts.
  const { FilesetResolver, PoseLandmarker } = (await import('./tasksVision')).default;
  const { wasmBase, modelUrl } = mediapipeAssetUrls();
  const fileset = await FilesetResolver.forVisionTasks(wasmBase);

  const make = (delegate: 'GPU' | 'CPU') =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelUrl, delegate },
      runningMode: 'VIDEO',
      numPoses: maxPoses,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    });

  let delegate: 'GPU' | 'CPU' = options.delegate ?? 'GPU';
  let landmarker;
  try {
    landmarker = await make(delegate);
  } catch (e) {
    if (delegate === 'CPU') throw e;
    delegate = 'CPU';
    landmarker = await make('CPU');
  }
  const lm = landmarker;

  return {
    engine: `mediapipe-tasks-vision@${MEDIAPIPE_VERSION} pose_landmarker_lite (${delegate}, numPoses=${maxPoses})`,
    maxPoses,
    estimate(input: unknown, timestampMs: number): PoseFrame {
      const video = input as HTMLVideoElement;
      const result = lm.detectForVideo(video, timestampMs);
      const poses = (result.landmarks ?? []).map((raw) => mapBlazePose(raw));
      const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 1;
      return { timestampMs, poses, aspect };
    },
    close() {
      lm.close();
    },
  };
}
