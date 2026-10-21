/**
 * The native camera preview view, resolved LAZILY.
 *
 * `requireNativeView` on a binary without this module (Expo Go, an older
 * build) registers a component with no view config, which would fail when
 * rendered. So nothing calls it at import time: the camera screen calls
 * `getWsfPoseCameraView()` only after `cameraCounterSupported()` (support.native.ts)
 * has confirmed the module is linked.
 */
import { requireNativeView } from 'expo';
import type { ComponentType } from 'react';

import { WSF_POSE_CAMERA_MODULE, type WsfPoseCameraViewProps } from './WsfPoseCamera.types';

let cached: ComponentType<WsfPoseCameraViewProps> | null = null;

export function getWsfPoseCameraView(): ComponentType<WsfPoseCameraViewProps> {
  if (!cached) cached = requireNativeView<WsfPoseCameraViewProps>(WSF_POSE_CAMERA_MODULE);
  return cached;
}
