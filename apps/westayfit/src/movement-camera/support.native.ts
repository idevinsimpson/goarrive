/**
 * Whether the squat camera can run here — NATIVE (iOS/Android). Metro picks
 * this file over support.ts on native; same exports.
 *
 * TRUE ONLY WHEN THE NATIVE MODULE IS LINKED: `requireOptionalNativeModule`
 * finds `WsfPoseCamera` with its permission function. Expo Go, a binary built
 * before the module existed, and any other runtime without it get false, and
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

/** Whether this runtime can run the counter at all. Native: only with the linked pose camera module. */
export function cameraCounterSupported(): boolean {
  return nativePoseCameraLinked();
}
