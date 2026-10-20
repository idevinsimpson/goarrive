// UNCOMPILED in sprint sandbox — first compile happens in an EAS development build
//
// The Expo module: camera permission (video only, never audio) and the pose camera view.
// JS contract: modules/wsf-pose-camera/src/WsfPoseCamera.types.ts.

import AVFoundation
import ExpoModulesCore

public class WsfPoseCameraModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WsfPoseCamera")

    AsyncFunction("getCameraPermissionAsync") { () -> [String: Any] in
      return WsfPoseCameraModule.permissionResponse(AVCaptureDevice.authorizationStatus(for: .video))
    }

    AsyncFunction("requestCameraPermissionAsync") { (promise: Promise) in
      let status = AVCaptureDevice.authorizationStatus(for: .video)
      guard status == .notDetermined else {
        promise.resolve(WsfPoseCameraModule.permissionResponse(status))
        return
      }
      AVCaptureDevice.requestAccess(for: .video) { granted in
        promise.resolve(WsfPoseCameraModule.permissionResponse(granted ? .authorized : .denied))
      }
    }

    View(WsfPoseCameraView.self) {
      Events("onCameraReady", "onPose", "onCameraError", "onCameraInterrupted")

      Prop("active") { (view: WsfPoseCameraView, active: Bool) in
        view.active = active
      }

      Prop("runId") { (view: WsfPoseCameraView, runId: Int) in
        view.runId = runId
      }

      OnViewDidUpdateProps { (view: WsfPoseCameraView) in
        view.applyProps()
      }
    }
  }

  static func permissionResponse(_ status: AVAuthorizationStatus) -> [String: Any] {
    switch status {
    case .authorized:
      return ["status": "granted", "granted": true, "canAskAgain": true, "expires": "never"]
    case .notDetermined:
      return ["status": "undetermined", "granted": false, "canAskAgain": true, "expires": "never"]
    default:
      // .denied, .restricted: only the Settings app can change it now.
      return ["status": "denied", "granted": false, "canAskAgain": false, "expires": "never"]
    }
  }
}
