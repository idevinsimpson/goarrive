// UNCOMPILED in sprint sandbox — first compile happens in an EAS development build
//
// THE POSE CAMERA VIEW. A full-bleed, mirrored self-view preview (AVCaptureVideoPreviewLayer,
// aspect-fill like web's object-fit: cover) plus, while `active`, one WsfPoseRun for `runId`.
//  - active true / new runId → stop any old run, open the camera and model for this run.
//  - active false, an error, or the view leaving its window → stop: camera off, model closed.
//  - A run id is never reopened: a run that stopped itself (error, detach) stays stopped even if
//    the props still say active; JS mints a new id for every start.
//  - The preview shows only while a run is open AND the app is active. It is hidden as soon as the
//    app resigns active, so the app-switcher snapshot never holds a live frame of the member
//    (natively, without waiting for JS to pause), and it is hidden whenever no run is open, so a
//    paused or failed camera never leaves a frozen frame on screen.
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
  // Read in deinit, which is nonisolated; every other access is on the main thread.
  #if compiler(>=5.10)
  nonisolated(unsafe) private var run: WsfPoseRun?
  #else
  private var run: WsfPoseRun?
  #endif
  private var startedRunId = 0
  /// Main thread. Read from UIApplication at init, then kept by the two notifications below.
  private var appActive = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black
    previewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(previewLayer)
    appActive = UIApplication.shared.applicationState == .active
    updatePreviewVisibility()
    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(appWillResignActive), name: UIApplication.willResignActiveNotification, object: nil)
    center.addObserver(self, selector: #selector(appDidBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
  }

  @objc private func appWillResignActive() {
    appActive = false
    updatePreviewVisibility()
  }

  @objc private func appDidBecomeActive() {
    appActive = true
    updatePreviewVisibility()
  }

  /// Visible only while a run is open and the app is active.
  private func updatePreviewVisibility() {
    setPreviewHidden(!(appActive && run != nil))
  }

  private func setPreviewHidden(_ hidden: Bool) {
    // No implicit fade: the snapshot must not catch a half-visible frame.
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    previewLayer.isHidden = hidden
    CATransaction.commit()
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
    guard wanted > 0 else {
      stopRun()
      return
    }
    // Never reopen a run id: the same id is either still running or already stopped itself.
    if wanted == startedRunId { return }
    stopRun()
    startedRunId = wanted
    let next = WsfPoseRun(runId: wanted) { [weak self] source, event, payload in
      guard let self = self, self.run === source else { return }
      self.forward(event, payload)
      if event == "onCameraError" {
        self.stopRun()
      }
    }
    run = next
    updatePreviewVisibility()
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
    updatePreviewVisibility()
  }
}
