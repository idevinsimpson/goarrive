// UNCOMPILED in sprint sandbox — first compile happens in an EAS development build
//
// THE POSE CAMERA VIEW. A full-bleed, mirrored self-view preview (AVCaptureVideoPreviewLayer,
// aspect-fill like web's object-fit: cover) plus, while `active`, one WsfPoseRun for `runId`.
//  - active true / new runId → stop any old run, open the camera and model for this run.
//  - active false, an error, or the view leaving its window → stop: camera off, model closed.
// Events from a run that is no longer current are dropped here, and JS drops any event whose
// runId is not its current run.

import AVFoundation
import ExpoModulesCore
import UIKit

final class WsfPoseCameraView: ExpoView {
  let onCameraReady = EventDispatcher()
  let onPose = EventDispatcher()
  let onCameraError = EventDispatcher()
  let onCameraInterrupted = EventDispatcher()

  var active = false
  var runId = 0

  private let previewLayer = AVCaptureVideoPreviewLayer()
  private var run: WsfPoseRun?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black
    previewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(previewLayer)
  }

  deinit {
    run?.stop()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window == nil, let current = run else { return }
    // Off screen (unmounted or hidden by a parent): release the camera now and let JS pause.
    stopRun()
    onCameraInterrupted(["runId": current.runId, "reason": "detached"])
  }

  /// Called once all props of an update are set (OnViewDidUpdateProps).
  func applyProps() {
    let wanted = active && runId > 0 ? runId : 0
    if wanted == (run?.runId ?? 0) { return }
    stopRun()
    guard wanted > 0 else { return }
    let next = WsfPoseRun(runId: wanted) { [weak self] source, event, payload in
      guard let self = self, self.run === source else { return }
      self.forward(event, payload)
      if event == "onCameraError" {
        self.stopRun()
      }
    }
    run = next
    next.start(previewLayer: previewLayer)
  }

  private func forward(_ event: String, _ payload: [String: Any]) {
    switch event {
    case "onCameraReady":
      onCameraReady(payload)
    case "onPose":
      onPose(payload)
    case "onCameraError":
      onCameraError(payload)
    case "onCameraInterrupted":
      onCameraInterrupted(payload)
    default:
      break
    }
  }

  private func stopRun() {
    guard let current = run else { return }
    run = nil
    current.stop()
    previewLayer.session = nil
  }
}
