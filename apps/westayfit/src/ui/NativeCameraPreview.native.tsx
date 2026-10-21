/**
 * The camera screen's NATIVE preview slot (iOS/Android): the wsf-pose-camera
 * view, full-bleed behind the overlay and controls.
 *
 * It is bound to the controller (controller.native.ts): it opens the camera
 * only while the controller's binding is active, for that binding's run, and
 * hands every native event back to the controller, which ignores events from
 * any other run. When the binding goes inactive (Finish, Close, pause,
 * dispose) or this view unmounts, the native side releases the camera and the
 * model.
 *
 * The native preview shows the front camera MIRRORED (a self-view); the
 * landmark data it sends is not.
 */
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { getWsfPoseCameraView } from '../../modules/wsf-pose-camera';
import { isNativeCameraHost, type NativeCameraBinding } from '../movement-camera/nativeEngine';

export function NativeCameraPreview({ controller }: { controller: unknown }) {
  const host = isNativeCameraHost(controller) ? controller : null;
  const [binding, setBinding] = useState<NativeCameraBinding>({ active: false, runId: 0 });
  useEffect(() => (host ? host.subscribeBinding(setBinding) : undefined), [host]);
  if (!host) return null;
  const PoseCameraView = getWsfPoseCameraView();
  return (
    <PoseCameraView
      style={StyleSheet.absoluteFill}
      active={binding.active}
      runId={binding.runId}
      pointerEvents="none"
      testID="wsf-camera-native-preview"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onCameraReady={(e) => host.handleReady(e.nativeEvent)}
      onPose={(e) => host.handlePose(e.nativeEvent)}
      onCameraError={(e) => host.handleError(e.nativeEvent)}
      onCameraInterrupted={(e) => host.handleInterrupted(e.nativeEvent)}
    />
  );
}
