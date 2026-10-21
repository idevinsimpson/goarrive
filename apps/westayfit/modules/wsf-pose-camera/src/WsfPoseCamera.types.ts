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
 * PRIVACY. This module's own code keeps frames in memory only: no file, no
 * photo or movie output, no network call, no audio. Only landmark numbers
 * cross into JavaScript.
 *
 * SDK USAGE TELEMETRY (disclosed; review of #638, finding 1 / F1 and the
 * delta review's Android completion). The MediaPipe Tasks native SDKs this
 * module links send Google usage telemetry whenever a pose landmarker is
 * created and while it runs. Per platform:
 *  - iOS: MediaPipeTasksCommon 0.10.35, through Clearcut
 *    (play.googleapis.com/log). What MediaPipe hands its logger (MPPTaskRunner,
 *    v0.10.35): task name, running mode, host system (iOS), iOS version,
 *    bundle id and app version; session start, clone and end; CPU/GPU input,
 *    finished and dropped frame counts; total and peak latency; elapsed time;
 *    init errors. What the Clearcut client adds to each request on iOS is NOT
 *    confirmed (no device, locale or carrier API reference was found in it,
 *    but no upload was decoded).
 *  - Android: tasks-core 0.10.29, through com.google.android.datatransport
 *    (CCT backend), which queues events on the device and uploads them later.
 *    MediaPipe's own fields: package name, versionCode and platform; task
 *    name, event name and running mode; session start, clone and end; frame
 *    counts, dropped count, elapsed time and latencies; error code.
 *    DataTransport's CCT backend adds to every event: device model and
 *    manufacturer, hardware, device and product names, build fingerprint, OS
 *    build id and SDK version, locale and country, SIM MCC/MNC, network type
 *    and subtype, timezone offset, app build number, and the event's
 *    wall-clock and uptime timestamps. (The OS version comes from CCT, not
 *    from MediaPipe.)
 *  - Both: each upload reaches Google from the device's IP address.
 * No camera frames, images or landmarks. The app therefore keeps the native
 * counter OFF (src/movement-camera/nativeCameraGate.ts
 * NATIVE_CAMERA_TELEMETRY_APPROVED = false) until the owner decides.
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
  /** Required: an event without it is dropped by the adapter, never guessed. */
  timestampUnit: TimestampUnit;
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
