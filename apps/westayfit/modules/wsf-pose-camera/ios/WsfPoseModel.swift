// UNCOMPILED in sprint sandbox — first compile happens in an EAS development build
//
// The pose model and its settings — the web engine's, unchanged (src/movement-camera/engine.ts):
// pose_landmarker_lite float16 v1, VIDEO mode, numPoses 3, 0.5 / 0.5 / 0.5, no segmentation
// masks, GPU with CPU fallback. The model is bundled (no download) and its sha256 is checked
// before use, so a different file can never run.

import CryptoKit
import Foundation
import MediaPipeTasksVision

enum WsfPoseError: Error {
  case modelMissing
  case modelMismatch
}

enum WsfPoseModel {
  static let mediapipeVersion = "0.10.35"
  static let resourceBundle = "WsfPoseCameraModel"
  static let fileName = "pose_landmarker_lite"
  static let fileExtension = "task"
  static let sha256 = "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a"
  static let maxPoses = 3
  static let minConfidence: Float = 0.5

  /// The bundled model file (resource bundle first; static and dynamic linking both covered).
  static func modelPath() throws -> String {
    for bundle in [Bundle(for: WsfPoseCameraView.self), Bundle.main] {
      if let url = bundle.url(forResource: resourceBundle, withExtension: "bundle"),
         let resources = Bundle(url: url),
         let path = resources.path(forResource: fileName, ofType: fileExtension) {
        return path
      }
      if let path = bundle.path(forResource: fileName, ofType: fileExtension) {
        return path
      }
    }
    throw WsfPoseError.modelMissing
  }

  /// The model path, only if its bytes are exactly the pinned web model.
  static func verifiedModelPath() throws -> String {
    let path = try modelPath()
    let data = try Data(contentsOf: URL(fileURLWithPath: path), options: .mappedIfSafe)
    let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    guard digest == sha256 else { throw WsfPoseError.modelMismatch }
    return path
  }

  static func makeLandmarker() throws -> (landmarker: PoseLandmarker, engine: String) {
    let path = try verifiedModelPath()
    func make(_ delegate: Delegate) throws -> PoseLandmarker {
      let options = PoseLandmarkerOptions()
      options.baseOptions.modelAssetPath = path
      options.baseOptions.delegate = delegate
      options.runningMode = .video
      options.numPoses = maxPoses
      options.minPoseDetectionConfidence = minConfidence
      options.minPosePresenceConfidence = minConfidence
      options.minTrackingConfidence = minConfidence
      options.shouldOutputSegmentationMasks = false
      return try PoseLandmarker(options: options)
    }
    do {
      return (try make(.GPU), engine("GPU"))
    } catch {
      return (try make(.CPU), engine("CPU"))
    }
  }

  static func engine(_ delegate: String) -> String {
    return "mediapipe-tasks-vision@\(mediapipeVersion) pose_landmarker_lite (\(delegate), numPoses=\(maxPoses)) ios"
  }

  /// One person → [x0, y0, v0, x1, y1, v1, …]; v = -1 when MediaPipe reported no visibility.
  static func flatten(_ person: [NormalizedLandmark]) -> [Double] {
    var out: [Double] = []
    out.reserveCapacity(person.count * 3)
    for landmark in person {
      out.append(Double(landmark.x))
      out.append(Double(landmark.y))
      out.append(landmark.visibility.map { $0.doubleValue } ?? -1)
    }
    return out
  }
}
