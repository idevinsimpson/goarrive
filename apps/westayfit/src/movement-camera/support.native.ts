/**
 * Whether the squat camera can run here — NATIVE (iOS/Android). Metro picks
 * this file over support.ts on native; same exports.
 *
 * FALSE UNTIL THE OWNER APPROVES THE SDK TELEMETRY (see
 * NATIVE_CAMERA_TELEMETRY_APPROVED below). After that, true only when the
 * native module is linked: `requireOptionalNativeModule` finds `WsfPoseCamera`
 * with its permission function. Expo Go, a binary built before the module
 * existed, and any other runtime without it get false. Whenever this is false
 * the member sees the existing manual squat flow (fail closed).
 *
 * The synthetic test source is a web emulator + loopback feature; it never
 * exists on native, so both hook functions return null here.
 *
 * Kept tiny: the contribute screen imports it statically. It reaches the
 * module's index (types and a lazy view getter) and nothing of the camera
 * screen, controller, frozen counter or engine.
 */
import { Platform } from 'react-native';

import { loadWsfPoseCameraModule, type WsfPoseCameraNativeModule } from '../../modules/wsf-pose-camera';
import type { TestPoseHook } from './support';

export type { TestPoseHook };

export function testPoseHook(_emulatorFlag: string | undefined, _win: unknown): TestPoseHook | null {
  return null;
}

export function pageTestPoseHook(): TestPoseHook | null {
  return null;
}

/** Seams for tests; production calls cameraCounterSupported() with none. */
export interface NativeSupportProbe {
  os?: string;
  load?: () => WsfPoseCameraNativeModule | null;
}

export function nativePoseCameraLinked(probe: NativeSupportProbe = {}): boolean {
  const os = probe.os ?? Platform.OS;
  if (os !== 'ios' && os !== 'android') return false;
  let mod: WsfPoseCameraNativeModule | null = null;
  try {
    mod = (probe.load ?? loadWsfPoseCameraModule)();
  } catch {
    return false;
  }
  return !!mod && typeof mod.requestCameraPermissionAsync === 'function';
}

/**
 * THE TELEMETRY GATE — reviewed approval required. Keep this `false`.
 *
 * Independent review of #638 (NATIVE-CAMERA-1 @ abe84f45, blocking finding 1 /
 * F1) found that the MediaPipe Tasks native SDKs the module links carry Google
 * usage telemetry:
 *  - iOS: MediaPipeTasksCommon 0.10.35 links ClearcutLoggingClient and posts
 *    to play.googleapis.com/log.
 *  - Android: tasks-core 0.10.29 (and 0.10.35) pulls
 *    com.google.android.datatransport and sends through RemoteLoggingClient.
 * Whenever a pose landmarker is created and while it runs, they send the task
 * name, running mode, app id, app version, OS version, frame counts and
 * latencies. No camera frames, images or landmarks. Turning the native camera
 * on would be expanded data collection, which this sprint does not authorize.
 * The decision (accept and disclose, or build telemetry-free binaries) is the
 * owner's; see docs/westayfit/qa/move-camera-native-adapter-1.md.
 *
 * Changing this to `true` is a privacy decision: it needs the owner's recorded
 * approval and a review, and must not be done to make a build "work".
 */
export const NATIVE_CAMERA_TELEMETRY_APPROVED: boolean = false;

/** Pure decision, so tests can cover both states of the gate. */
export function nativeCameraCounterAllowed(approved: boolean, probe: NativeSupportProbe = {}): boolean {
  return approved === true && nativePoseCameraLinked(probe);
}

/** Whether this runtime can run the counter at all. Native: false until the telemetry gate is approved; then only with the linked module. */
export function cameraCounterSupported(): boolean {
  return nativeCameraCounterAllowed(NATIVE_CAMERA_TELEMETRY_APPROVED);
}
