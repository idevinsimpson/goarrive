// UNCOMPILED in sprint sandbox — first compile happens in an EAS development build
//
// Exception for THIS file: it is pure Kotlin (only java.* and kotlin.* imports; no Android,
// CameraX, MediaPipe or Expo), so the sprint sandbox DOES compile it with kotlinc 2.1.20 and run
// its JVM unit tests (android/src/test/.../WsfPoseContractTest.kt, reproduced by
// docs/westayfit/qa/camera-evidence/run-kotlin-jvm.sh). Its first ANDROID build is still the
// EAS development build.
//
// The Android side of the JS contract (src/WsfPoseCamera.types.ts, src/movement-camera/nativeEngine.ts):
// the per-run timestamp guard, landmark flattening, the onPose payload, the model check and the run
// decision. WsfPoseRun, WsfPoseModel and WsfPoseCameraView only adapt CameraX, MediaPipe and Expo
// types to these functions.
package expo.modules.wsfposecamera

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest

/** One MediaPipe landmark as plain numbers: normalised x, y and visibility (null = not reported). */
internal data class WsfLandmark(val x: Float, val y: Float, val visibility: Float?)

/** What applyProps does: stop the current run (if any) and/or start run `start` (0 = none). */
internal data class WsfRunChange(val stop: Boolean, val start: Int)

internal object WsfPoseContract {
  /** Keep in step with android/build.gradle `mediapipeTasksVisionVersion` (a unit test checks). */
  const val MEDIAPIPE_VERSION = "0.10.29"
  const val MODEL_FILE = "pose_landmarker_lite.task"
  const val MODEL_SHA256 = "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a"
  const val MAX_POSES = 3
  const val MIN_CONFIDENCE = 0.5f
  /** Android sends the camera clock in nanoseconds; JS divides by 1e6. */
  const val TIMESTAMP_UNIT = "ns"
  /** The analysed frame is the unmirrored sensor image turned upright; only the preview is a mirror. */
  const val MIRRORED = false
  /** Sent for a landmark whose visibility MediaPipe did not report; JS reads it as "not reported". */
  const val NO_VISIBILITY = -1.0

  /** MediaPipe's ms for a camera ns timestamp (truncating). */
  fun nsToMs(timestampNs: Long): Long = timestampNs / 1_000_000L

  /** CameraX rotationDegrees as one of 0, 90, 180, 270. */
  fun normalizedRotation(rotationDegrees: Int): Int = Math.floorMod(rotationDegrees, 360)

  /** One person → [x0, y0, v0, x1, y1, v1, …]; v = -1 when MediaPipe reported no visibility. */
  fun flatten(person: List<WsfLandmark>): List<Double> {
    val out = ArrayList<Double>(person.size * 3)
    for (landmark in person) {
      out.add(landmark.x.toDouble())
      out.add(landmark.y.toDouble())
      out.add(landmark.visibility?.toDouble() ?: NO_VISIBILITY)
    }
    return out
  }

  /** At most MAX_POSES people, in MediaPipe's order, flattened. */
  fun people(persons: List<List<WsfLandmark>>): List<List<Double>> = persons.take(MAX_POSES).map { flatten(it) }

  /** The onPose body for one analysed frame (the run adds its runId when it sends it). */
  fun posePayload(timestampNs: Long, width: Int, height: Int, people: List<List<Double>>): Map<String, Any> =
    mapOf(
      "timestamp" to timestampNs.toDouble(),
      "timestampUnit" to TIMESTAMP_UNIT,
      "width" to width,
      "height" to height,
      "mirrored" to MIRRORED,
      "people" to people
    )

  fun engine(delegate: String): String =
    "mediapipe-tasks-vision@$MEDIAPIPE_VERSION pose_landmarker_lite ($delegate, numPoses=$MAX_POSES) android"

  fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

  /** The model as a direct buffer at position 0, only if its bytes are exactly the pinned web model. */
  fun verifiedModelBuffer(bytes: ByteArray): ByteBuffer {
    check(sha256Hex(bytes) == MODEL_SHA256) { "The bundled pose model does not match the pinned sha256." }
    val buffer = ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder())
    buffer.put(bytes)
    buffer.rewind()
    return buffer
  }

  /** The run the view should have open for these props: `runId` while active and positive, else 0 (none). */
  fun targetRun(active: Boolean, runId: Int): Int = if (active && runId > 0) runId else 0

  /**
   * What applyProps does. `startedRunId` is the last run this view opened. That run may already
   * have stopped itself (an error or a detach) while the props still say active: a run id is never
   * opened twice, because JS has already failed or paused that run and ignores its events. JS
   * mints a new id for every start.
   */
  fun runChange(currentRunId: Int, startedRunId: Int, active: Boolean, runId: Int): WsfRunChange {
    val wanted = targetRun(active, runId)
    if (wanted == 0) return WsfRunChange(stop = currentRunId != 0, start = 0)
    if (wanted == startedRunId) return WsfRunChange(stop = false, start = 0)
    return WsfRunChange(stop = currentRunId != 0, start = wanted)
  }
}

/**
 * One run's camera clock. accept() returns the ms to give MediaPipe, or null to DROP a frame whose
 * ms is not after the last accepted one: a repeated or older timestamp never reaches MediaPipe or
 * the counter, and nothing is re-timed. Analysis thread only.
 */
internal class WsfFrameClock {
  private var lastMs = Long.MIN_VALUE

  fun accept(timestampNs: Long): Long? {
    val ms = WsfPoseContract.nsToMs(timestampNs)
    if (ms <= lastMs) return null
    lastMs = ms
    return ms
  }
}
