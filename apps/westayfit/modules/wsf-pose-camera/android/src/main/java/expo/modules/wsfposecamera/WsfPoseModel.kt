// UNCOMPILED in sprint sandbox — first compile happens in an EAS development build
//
// The pose model and its settings — the web engine's, unchanged (src/movement-camera/engine.ts):
// pose_landmarker_lite float16 v1, VIDEO mode, numPoses 3, 0.5 / 0.5 / 0.5, no segmentation
// masks, GPU with CPU fallback. The model is bundled (an app asset, no download), read into
// memory, and its sha256 checked before use (WsfPoseContract.verifiedModelBuffer), so a different
// file can never run.
package expo.modules.wsfposecamera

import android.content.Context
import com.google.mediapipe.tasks.components.containers.NormalizedLandmark
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import java.nio.ByteBuffer

internal object WsfPoseModel {
  class Loaded(val landmarker: PoseLandmarker, val engine: String)

  /** The bundled model as a direct buffer, only if its bytes are exactly the pinned web model. */
  fun verifiedModel(context: Context): ByteBuffer =
    WsfPoseContract.verifiedModelBuffer(context.assets.open(WsfPoseContract.MODEL_FILE).use { it.readBytes() })

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
        .setNumPoses(WsfPoseContract.MAX_POSES)
        .setMinPoseDetectionConfidence(WsfPoseContract.MIN_CONFIDENCE)
        .setMinPosePresenceConfidence(WsfPoseContract.MIN_CONFIDENCE)
        .setMinTrackingConfidence(WsfPoseContract.MIN_CONFIDENCE)
        .setOutputSegmentationMasks(false)
        .build()
      return PoseLandmarker.createFromOptions(context, options)
    }
    return try {
      Loaded(make(Delegate.GPU), WsfPoseContract.engine("GPU"))
    } catch (gpuError: Exception) {
      Loaded(make(Delegate.CPU), WsfPoseContract.engine("CPU"))
    }
  }

  /** MediaPipe's landmarks for one person as plain numbers (visibility null when not reported). */
  fun landmarks(person: List<NormalizedLandmark>): List<WsfLandmark> =
    person.map { WsfLandmark(it.x(), it.y(), it.visibility().orElse(null)) }
}
