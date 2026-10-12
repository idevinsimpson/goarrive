import type { PoseFrame } from './types';

/**
 * THE PLATFORM SEAM.
 *
 * A pose engine is anything that can turn "the current camera frame" into a
 * PoseFrame of engine-neutral landmarks, synchronously, on the device. The
 * lock, counter and session never import an engine; the UI picks one and
 * feeds its frames to a MovementSession.
 *
 * Implemented today:
 *   - web/mediapipe.ts — @mediapipe/tasks-vision PoseLandmarker, browser only.
 *   - synthetic.ts     — scripted landmarks, no camera (tests and lab demo).
 *
 * The intended native path (NOT built, NOT proven): an Expo development
 * build with a camera frame processor running a pose model on-device (for
 * example react-native-vision-camera + a MediaPipe Tasks or TFLite pose
 * plugin), whose output is mapped to PoseFrame exactly as the web adapter
 * does. Nothing above this interface would change.
 */
export interface PoseEstimator {
  /** Human-readable engine id, shown in the lab and recorded in evidence. */
  readonly engine: string;
  /** Upper bound of people the engine reports per frame. The lock needs ≥ 2. */
  readonly maxPoses: number;
  /**
   * Run inference on one frame. `input` is platform-specific (a video element
   * on web). `timestampMs` must increase monotonically.
   */
  estimate(input: unknown, timestampMs: number): PoseFrame;
  close(): void;
}
