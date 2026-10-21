// UNCOMPILED in sprint sandbox — first compile happens in an EAS development build
//
// ONE CAMERA RUN: the front camera (AVCaptureSession, video only) and one PoseLandmarker,
// opened for one `runId` and released by stop(). Frames are processed in memory on the video
// queue and dropped; this code writes, records and sends nothing. Only landmark numbers leave, as
// events stamped with this run's id. (MediaPipe's own SDK usage telemetry is disclosed in
// WsfPoseCamera.podspec.)
//
// Data contract (see src/movement-camera/nativeEngine.ts):
//  - Pixels are delivered UPRIGHT (connection rotated to portrait) and NOT mirrored, so the
//    landmarks are normalised to the unmirrored upright frame. The preview layer mirrors the
//    front camera for display only.
//  - timestamp = presentation time × 1000, in ms. A frame whose ms is not after the last one is
//    DROPPED before inference (MediaPipe VIDEO mode needs increasing timestamps); nothing is
//    re-timed or invented.
//  - Inference runs synchronously on the video queue; alwaysDiscardsLateVideoFrames drops
//    frames while it is busy (backpressure by dropping, never queueing).

import AVFoundation
import CoreMedia
import CoreVideo
import Foundation
import MediaPipeTasksVision
import UIKit

enum WsfPoseCameraFailure: Error {
  case noFrontCamera
  case cameraUnavailable
}

final class WsfPoseRun: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  typealias Emit = (_ run: WsfPoseRun, _ event: String, _ payload: [String: Any]) -> Void

  let runId: Int
  private let emit: Emit
  private let session = AVCaptureSession()
  private let output = AVCaptureVideoDataOutput()
  /// ONE queue for every run's session work, so a stopping run's teardown always finishes before
  /// the next run configures and starts (two sessions never compete for the front camera).
  private static let sessionQueue = DispatchQueue(label: "fit.westayfit.posecamera.session")
  private let videoQueue = DispatchQueue(label: "fit.westayfit.posecamera.video")

  // Video queue only.
  private var landmarker: PoseLandmarker?
  private var lastTimestampMs = Int.min

  // Main thread only.
  private var observers: [NSObjectProtocol] = []

  private let lock = NSLock()
  private var stoppedFlag = false
  private var stopped: Bool {
    lock.lock()
    defer { lock.unlock() }
    return stoppedFlag
  }

  init(runId: Int, emit: @escaping Emit) {
    self.runId = runId
    self.emit = emit
    super.init()
  }

  // MARK: - Start / stop (main thread)

  func start(previewLayer: AVCaptureVideoPreviewLayer) {
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
      send("onCameraError", ["stage": "permission", "message": "Camera permission is not granted."])
      return
    }
    previewLayer.session = session
    observeSession()
    WsfPoseRun.sessionQueue.async { [weak self, weak previewLayer] in
      self?.openCamera(previewLayer: previewLayer)
    }
  }

  func stop() {
    lock.lock()
    let already = stoppedFlag
    stoppedFlag = true
    lock.unlock()
    if already { return }

    for observer in observers {
      NotificationCenter.default.removeObserver(observer)
    }
    observers.removeAll()

    let session = self.session
    let output = self.output
    WsfPoseRun.sessionQueue.async {
      output.setSampleBufferDelegate(nil, queue: nil)
      if session.isRunning {
        session.stopRunning()
      }
      session.beginConfiguration()
      for input in session.inputs {
        session.removeInput(input)
      }
      for sessionOutput in session.outputs {
        session.removeOutput(sessionOutput)
      }
      session.commitConfiguration()
    }
    // After any frame already being analysed, close the model.
    videoQueue.async { [self] in
      landmarker = nil
    }
  }

  // MARK: - Session queue

  private func openCamera(previewLayer: AVCaptureVideoPreviewLayer?) {
    if stopped { return }
    do {
      try configureSession()
    } catch {
      send("onCameraError", ["stage": "playback", "message": "\(error)"])
      return
    }
    session.startRunning()
    if stopped { return }
    guard session.isRunning else {
      send("onCameraError", ["stage": "playback", "message": "The camera did not start."])
      return
    }
    DispatchQueue.main.async { [weak previewLayer] in
      if let connection = previewLayer?.connection {
        WsfPoseRun.makePortrait(connection)
      }
    }
    videoQueue.async { [weak self] in
      self?.loadModel()
    }
  }

  private func configureSession() throws {
    session.beginConfiguration()
    defer { session.commitConfiguration() }

    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) else {
      throw WsfPoseCameraFailure.noFrontCamera
    }
    let input = try AVCaptureDeviceInput(device: device)
    guard session.canAddInput(input) else { throw WsfPoseCameraFailure.cameraUnavailable }
    session.addInput(input)
    // The preset is set once the input is in, so canSetSessionPreset answers for this camera.
    if session.canSetSessionPreset(.vga640x480) {
      session.sessionPreset = .vga640x480
    }

    // MediaPipe needs 32BGRA sample buffers.
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    output.alwaysDiscardsLateVideoFrames = true
    output.setSampleBufferDelegate(self, queue: videoQueue)
    guard session.canAddOutput(output) else { throw WsfPoseCameraFailure.cameraUnavailable }
    session.addOutput(output)

    if let connection = output.connection(with: .video) {
      WsfPoseRun.makePortrait(connection)
      if connection.isVideoMirroringSupported {
        // The data is the UNMIRRORED frame; only the preview is a mirror.
        connection.automaticallyAdjustsVideoMirroring = false
        connection.isVideoMirrored = false
      }
    }
  }

  static func makePortrait(_ connection: AVCaptureConnection) {
    if #available(iOS 17.0, *) {
      if connection.isVideoRotationAngleSupported(90) {
        connection.videoRotationAngle = 90
      }
    } else if connection.isVideoOrientationSupported {
      connection.videoOrientation = .portrait
    }
  }

  // MARK: - Video queue

  private func loadModel() {
    if stopped { return }
    do {
      let made = try WsfPoseModel.makeLandmarker()
      if stopped { return }
      landmarker = made.landmarker
      send("onCameraReady", ["engine": made.engine])
    } catch {
      send("onCameraError", ["stage": "model", "message": "\(error)"])
    }
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard !stopped, let landmarker = landmarker else { return }

    let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    guard pts.isValid, pts.isNumeric else { return }
    let seconds = CMTimeGetSeconds(pts)
    guard seconds.isFinite else { return }
    let timestampMs = Int((seconds * 1000).rounded(.down))
    // Drop, never fabricate: a repeated or older timestamp never reaches MediaPipe or the counter.
    guard timestampMs > lastTimestampMs else { return }
    lastTimestampMs = timestampMs

    guard let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    let width = CVPixelBufferGetWidth(pixels)
    let height = CVPixelBufferGetHeight(pixels)

    let result: PoseLandmarkerResult
    do {
      let image = try MPImage(sampleBuffer: sampleBuffer, orientation: .up)
      result = try landmarker.detect(videoFrame: image, timestampInMilliseconds: timestampMs)
    } catch {
      send("onCameraError", ["stage": "inference", "message": "\(error)"])
      return
    }

    let people: [[Double]] = result.landmarks.prefix(WsfPoseModel.maxPoses).map { WsfPoseModel.flatten($0) }
    send("onPose", [
      "timestamp": Double(timestampMs),
      "timestampUnit": "ms",
      "width": width,
      "height": height,
      "mirrored": false,
      "people": people,
    ])
  }

  // MARK: - Events

  // The SDK constants. The iOS 18 SDK (Xcode 16, Swift 6 compiler) names the notifications
  // AVCaptureSession.wasInterruptedNotification / .runtimeErrorNotification (NS_SWIFT_NAME in
  // AVCaptureSession.h); the iOS 17 SDK and earlier exposed them as NSNotification.Name members.
  #if compiler(>=6.0)
  private static let wasInterrupted = AVCaptureSession.wasInterruptedNotification
  private static let runtimeError = AVCaptureSession.runtimeErrorNotification
  #else
  private static let wasInterrupted = NSNotification.Name.AVCaptureSessionWasInterrupted
  private static let runtimeError = NSNotification.Name.AVCaptureSessionRuntimeError
  #endif
  private static let interruptionReasonKey = AVCaptureSessionInterruptionReasonKey
  private static let errorKey = AVCaptureSessionErrorKey

  private func observeSession() {
    let center = NotificationCenter.default
    observers.append(center.addObserver(forName: WsfPoseRun.wasInterrupted, object: session, queue: .main) { [weak self] note in
      let reason = (note.userInfo?[WsfPoseRun.interruptionReasonKey] as? NSNumber).map { "\($0.intValue)" } ?? "unknown"
      self?.send("onCameraInterrupted", ["reason": reason])
    })
    observers.append(center.addObserver(forName: WsfPoseRun.runtimeError, object: session, queue: .main) { [weak self] note in
      let message = (note.userInfo?[WsfPoseRun.errorKey] as? NSError)?.localizedDescription ?? "The camera stopped."
      self?.send("onCameraError", ["stage": "ended", "message": message])
    })
  }

  /// Every event goes to the main thread, carries this run's id, and is dropped once the run is stopped.
  private func send(_ event: String, _ body: [String: Any]) {
    var payload = body
    payload["runId"] = runId
    DispatchQueue.main.async { [weak self] in
      guard let self = self, !self.stopped else { return }
      self.emit(self, event, payload)
    }
  }
}
