/**
 * The camera screen's NATIVE preview slot. On web the camera is the <video>
 * element in CameraRepCounter.tsx, so this renders nothing; Metro picks
 * NativeCameraPreview.native.tsx on iOS/Android.
 */
export function NativeCameraPreview(_props: { controller: unknown }): null {
  return null;
}
