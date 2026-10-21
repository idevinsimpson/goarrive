/**
 * wsf-pose-camera — local Expo module (autolinked from apps/westayfit/modules).
 *
 * JavaScript side of the native squat camera. Imported only by `.native.*`
 * app files, so the web bundle never contains it. A development build is
 * required: custom native code does not load in Expo Go, and there
 * `loadWsfPoseCameraModule()` returns null (the app fails closed to the
 * manual flow).
 */
import { requireOptionalNativeModule } from 'expo';

import { WSF_POSE_CAMERA_MODULE, type WsfPoseCameraNativeModule } from './src/WsfPoseCamera.types';

export * from './src/WsfPoseCamera.types';
export { getWsfPoseCameraView } from './src/WsfPoseCameraView';

/** The linked native module, or null when this binary does not contain it. Never throws. */
export function loadWsfPoseCameraModule(): WsfPoseCameraNativeModule | null {
  try {
    return requireOptionalNativeModule<WsfPoseCameraNativeModule>(WSF_POSE_CAMERA_MODULE);
  } catch {
    return null;
  }
}
