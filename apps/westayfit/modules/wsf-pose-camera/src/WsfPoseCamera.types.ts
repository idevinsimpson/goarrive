/**
 * THE NATIVE POSE CAMERA CONTRACT — what the local Expo module
 * `modules/wsf-pose-camera` (Swift + Kotlin) sends to JavaScript.
 *
 * The native view owns the front camera and runs Google's MediaPipe Tasks
 * PoseLandmarker on each frame, in memory, with the same model and settings as
 * the web engine (engine.ts): the lite float16 v1 model, VIDEO mode, numPoses
 * 3, 0.5 confidences, no segmentation masks, GPU with CPU fallback. It sends
 * RAW landmarks; the app maps them with the existing `mapPerson`
 * (src/movement-camera/nativeEngine.ts) and feeds the orchestrator, exactly
 * as web does. Nothing here counts.
 *
 * PRIVACY. Frames never leave memory: no file, no photo or movie output, no
 * network, no audio. Only landmark numbers cross into JavaScript.
 */
import type { StyleProp, ViewStyle } from 'react-native';

/** The name both native sides register (Swift `Name(...)`, Kotlin `Name(...)`). */
export const WSF_POSE_CAMERA_MODULE = 'WsfPoseCamera';

/** The one bundled model: the SAME bytes as the web engine's MODEL_URL. */
export const MODEL_FILE = 'pose_landmarker_lite.task';
export const MODEL_SHA256 = '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a';

/** The camera clock unit of `timestamp`. iOS sends ms (CMTime PTS × 1000); Android sends ns (ImageInfo.timestamp). */
export type TimestampUnit = 'ms' | 'ns';

/**
 * One analysed camera frame. Sent for EVERY analysed frame, including frames
 * with nobody in them (`people: []`), so tracking loss reaches the counter as
 * "nobody here" rather than as a silent gap.
 */
export interface PoseEventPayload {
  /** The run this frame belongs to (the `runId` prop the camera was opened with). */
  runId: number;
  /** Camera clock of the frame, in `timestampUnit`. Strictly increasing within a run (native drops repeats before inference). */
  timestamp: number;
  timestampUnit?: TimestampUnit;
  /** UPRIGHT frame size in pixels (native rotates to upright before inference). */
  width: number;
  height: number;
  /** True only if the analysed pixels were mirrored. Both native sides analyse the unmirrored frame and send false. */
  mirrored?: boolean;
  /**
   * One flat array per detected person (at most numPoses = 3), BlazePose order:
   * [x0, y0, v0, x1, y1, v1, …] for the 33 landmarks. x, y are normalised to the
   * upright frame, unclamped. v is MediaPipe's visibility, or -1 when the
   * engine reported none (never invented).
   */
  people: number[][];
}

export interface CameraReadyPayload {
  runId: number;
  /** Engine id, e.g. `mediapipe-tasks-vision@0.10.35 pose_landmarker_lite (GPU, numPoses=3) ios`. */
  engine: string;
}

/** Same stage names as the web lifecycle's CameraFailureStage. */
export type NativeCameraErrorStage = 'permission' | 'playback' | 'model' | 'inference' | 'ended';

export interface CameraErrorPayload {
  runId: number;
  stage: NativeCameraErrorStage;
  message?: string;
}

/** The OS took the camera away (call, Siri, multitasking, the view left the window). The app shows "Camera paused". */
export interface CameraInterruptedPayload {
  runId: number;
  reason?: string;
}

export interface CameraPermissionResult {
  granted: boolean;
  status?: string;
  canAskAgain?: boolean;
}

/** The native module's functions (the view is separate, see WsfPoseCameraView.tsx). */
export interface WsfPoseCameraNativeModule {
  getCameraPermissionAsync(): Promise<CameraPermissionResult>;
  requestCameraPermissionAsync(): Promise<CameraPermissionResult>;
}

export interface WsfPoseCameraViewProps {
  /** Open the camera and model while true; release everything when false. */
  active: boolean;
  /** Stamped on every event of the run; a new value while active restarts the camera for a new run. */
  runId: number;
  style?: StyleProp<ViewStyle>;
  pointerEvents?: 'none' | 'auto' | 'box-none' | 'box-only';
  testID?: string;
  accessibilityElementsHidden?: boolean;
  importantForAccessibility?: 'auto' | 'yes' | 'no' | 'no-hide-descendants';
  onCameraReady?: (event: { nativeEvent: CameraReadyPayload }) => void;
  onPose?: (event: { nativeEvent: PoseEventPayload }) => void;
  onCameraError?: (event: { nativeEvent: CameraErrorPayload }) => void;
  onCameraInterrupted?: (event: { nativeEvent: CameraInterruptedPayload }) => void;
}
