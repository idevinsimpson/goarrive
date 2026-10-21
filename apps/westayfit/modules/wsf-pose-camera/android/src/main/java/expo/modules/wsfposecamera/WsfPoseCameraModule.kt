// UNCOMPILED in sprint sandbox — first compile happens in an EAS development build
//
// The Expo module: camera permission (CAMERA only, never audio) and the pose camera view.
// JS contract: modules/wsf-pose-camera/src/WsfPoseCamera.types.ts.
package expo.modules.wsfposecamera

import android.Manifest
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class WsfPoseCameraModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WsfPoseCamera")

    AsyncFunction("getCameraPermissionAsync") { promise: Promise ->
      Permissions.getPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.CAMERA)
    }

    AsyncFunction("requestCameraPermissionAsync") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.CAMERA)
    }

    View(WsfPoseCameraView::class) {
      Events("onCameraReady", "onPose", "onCameraError", "onCameraInterrupted")

      Prop("active") { view: WsfPoseCameraView, active: Boolean ->
        view.active = active
      }

      Prop("runId") { view: WsfPoseCameraView, runId: Int ->
        view.runId = runId
      }

      OnViewDidUpdateProps { view: WsfPoseCameraView ->
        view.applyProps()
      }

      OnViewDestroys { view: WsfPoseCameraView ->
        view.release()
      }
    }
  }
}
