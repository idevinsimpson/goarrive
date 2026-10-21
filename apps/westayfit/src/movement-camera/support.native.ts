/**
 * Whether the squat camera can run here — NATIVE (iOS/Android). Metro picks
 * this file over support.ts on native; same exports.
 *
 * FALSE UNTIL THE OWNER APPROVES THE SDK TELEMETRY (see
 * NATIVE_CAMERA_TELEMETRY_APPROVED in nativeCameraGate.ts). After that, true
 * only when the native module is linked: `requireOptionalNativeModule` finds `WsfPoseCamera`
 * with its permission function. Expo Go, a binary built before the module
 * existed, and any other runtime without it get false. Whenever this is false
 * the member sees the existing manual squat flow (fail closed).
 *
 * The synthetic test source is a web emulator + loopback feature; it never
 * exists on native, so both hook functions return null here.
 *
 * Kept tiny: the contribute screen imports it statically. It reaches the
 * module's index (types and a lazy view getter), the one-constant gate file,
 * the type-only testPoseHookType.ts, and nothing of the camera screen,
 * controller, frozen counter or engine.
 */
import { Platform } from 'react-native';

import { loadWsfPoseCameraModule, type WsfPoseCameraNativeModule } from '../../modules/wsf-pose-camera';
import { NATIVE_CAMERA_TELEMETRY_APPROVED } from './nativeCameraGate';
// From the suffix-free type file, never './support': on native that specifier is this file (TS2303).
import type { TestPoseHook } from './testPoseHookType';

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
 * THE TELEMETRY GATE lives in nativeCameraGate.ts, with the reason (#638: the
 * MediaPipe native SDKs send Google usage telemetry; per-platform list there)
 * and the owner's decision it waits for. Re-exported here so the support
 * probe's callers see it. `false` today: the camera entry is never offered on
 * native, and controller.native.ts refuses to ask for the camera as well.
 */
export { NATIVE_CAMERA_TELEMETRY_APPROVED };

/** Pure decision, so tests can cover both states of the gate. */
export function nativeCameraCounterAllowed(approved: boolean, probe: NativeSupportProbe = {}): boolean {
  return approved === true && nativePoseCameraLinked(probe);
}

/** Whether this runtime can run the counter at all. Native: false until the telemetry gate is approved; then only with the linked module. */
export function cameraCounterSupported(): boolean {
  return nativeCameraCounterAllowed(NATIVE_CAMERA_TELEMETRY_APPROVED);
}
