// UNCOMPILED in sprint sandbox — first compile happens in an EAS development build
//
// The pose model and its settings — the web engine's, unchanged (src/movement-camera/engine.ts):
// pose_landmarker_lite float16 v1, VIDEO mode, numPoses 3, 0.5 / 0.5 / 0.5, no segmentation
// masks, GPU with CPU fallback. The model is bundled (an app asset, no download), read into
// memory, and its sha256 checked before use, so a different file can never run.
package expo.modules.wsfposecamera

import android.content.Context
import com.google.mediapipe.tasks.components.containers.NormalizedLandmark
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest

internal object WsfPoseModel {
  /** Keep in step with android/build.gradle `mediapipeTasksVisionVersion` (a unit test checks). */
  const val MEDIAPIPE_VERSION = "0.10.29"
  const val FILE = "pose_landmarker_lite.task"
  const val SHA256 = "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a"
  const val MAX_POSES = 3
  const val MIN_CONFIDENCE = 0.5f

  class Loaded(val landmarker: PoseLandmarker, val engine: String)

  /** The bundled model as a direct buffer, only if its bytes are exactly the pinned web model. */
  fun verifiedModel(context: Context): ByteBuffer {
    val bytes = context.assets.open(FILE).use { it.readBytes() }
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    check(digest == SHA256) { "The bundled pose model does not match the pinned sha256." }
    val buffer = ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder())
    buffer.put(bytes)
    buffer.rewind()
    return buffer
  }

  fun create(context: Context): Loaded {
    val model = verifiedModel(context)
    fun make(delegate: Delegate): PoseLandmarker {
      // MediaPipe copies the buffer from its position; start from 0 for each attempt.
      model.rewind()
      val base = BaseOptions.builder()
        .setModelAssetBuffer(model)
        .setDelegate(delegate)
        .build()
      val options = PoseLandmarker.PoseLandmarkerOptions.builder()
        .setBaseOptions(base)
        .setRunningMode(RunningMode.VIDEO)
        .setNumPoses(MAX_POSES)
        .setMinPoseDetectionConfidence(MIN_CONFIDENCE)
        .setMinPosePresenceConfidence(MIN_CONFIDENCE)
        .setMinTrackingConfidence(MIN_CONFIDENCE)
        .setOutputSegmentationMasks(false)
        .build()
      return PoseLandmarker.createFromOptions(context, options)
    }
    return try {
      Loaded(make(Delegate.GPU), engine("GPU"))
    } catch (gpuError: Exception) {
      Loaded(make(Delegate.CPU), engine("CPU"))
    }
  }

  private fun engine(delegate: String) =
    "mediapipe-tasks-vision@$MEDIAPIPE_VERSION pose_landmarker_lite ($delegate, numPoses=$MAX_POSES) android"

  /** One person → [x0, y0, v0, x1, y1, v1, …]; v = -1 when MediaPipe reported no visibility. */
  fun flatten(person: List<NormalizedLandmark>): List<Double> {
    val out = ArrayList<Double>(person.size * 3)
    for (landmark in person) {
      out.add(landmark.x().toDouble())
      out.add(landmark.y().toDouble())
      val visibility = landmark.visibility()
      out.add(if (visibility.isPresent) visibility.get().toDouble() else -1.0)
    }
    return out
  }
}
