/**
 * THE ON-DEVICE POSE ENGINE (web): @mediapipe/tasks-vision PoseLandmarker.
 *
 * Settings are the frozen reference adapter's, unchanged (Lovable
 * e15b9fa0@1454357 mediapipeVite.ts / visualEstimator.ts): VIDEO mode, the
 * lite float16 v1 model, numPoses 3, 0.5 confidences, no segmentation masks,
 * GPU with CPU fallback. Each person goes through `mapPerson`, so the counter
 * receives exactly the frozen nine-point mapping and the visual-only points
 * ride beside it.
 *
 * VERSION PIN 0.10.35 (Director scope delta 5997885276). From 1.0.0 the
 * package carries a metrics logger that POSTs usage data to
 * odml.pa.googleapis.com; 0.10.35 has none, and a unit test checks the
 * installed bundle and package.json.
 *
 * ASSETS. Inference runs in this tab; the network is used only to fetch the
 * WASM runtime and the model, once, pinned to this exact version (the donor
 * #475 URLs). The reference served the same bytes same-origin; doing that here
 * needs the bytes in the hosted build, which is a separate, scoped change.
 * No frame, landmark or count is ever sent anywhere.
 *
 * LAZY. This module is reached only by `await import('./engine')` when the
 * squat camera opens, and it reaches the engine only by
 * `await import('./tasksVision')`, so neither is on any other page's path.
 */
import type { PoseEstimator, PoseFrame } from './frozen';
import { mapPerson } from './visual';

export const MEDIAPIPE_VERSION = '0.10.35';
export const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
export const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export async function createPoseEstimator(maxPoses = 3): Promise<PoseEstimator> {
  const { FilesetResolver, PoseLandmarker } = (await import('./tasksVision')).default;
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  const make = (delegate: 'GPU' | 'CPU') =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numPoses: maxPoses,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    });
  let delegate: 'GPU' | 'CPU' = 'GPU';
  let landmarker: Awaited<ReturnType<typeof make>>;
  try {
    landmarker = await make(delegate);
  } catch {
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
      const poses = (result.landmarks ?? []).map((raw) => mapPerson(raw));
      const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 1;
      return { timestampMs, poses, aspect };
    },
    close() {
      lm.close();
    },
  };
}
