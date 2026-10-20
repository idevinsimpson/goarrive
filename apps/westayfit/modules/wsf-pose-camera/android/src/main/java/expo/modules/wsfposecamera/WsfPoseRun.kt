// UNCOMPILED in sprint sandbox — first compile happens in an EAS development build
//
// ONE CAMERA RUN: the front camera (CameraX Preview + ImageAnalysis, no audio, no capture or
// recording use case) and one PoseLandmarker, opened for one `runId` and released by stop().
// Frames are processed in memory on one analysis thread and dropped; nothing is written,
// recorded or sent. Only landmark numbers leave, as events stamped with this run's id.
//
// Data contract (see src/movement-camera/nativeEngine.ts):
//  - The analysis frame is the raw, UNMIRRORED sensor image; it is rotated upright by
//    rotationDegrees before inference, so landmarks are normalised to the upright,
//    unmirrored frame. (Google's sample also flips front-camera frames to match its mirrored
//    preview; we deliberately do not: mirroring is for display only.) PreviewView mirrors
//    the front camera for display.
//  - timestamp = ImageInfo.timestamp in NANOSECONDS (timestampUnit "ns"); JS converts to ms.
//    MediaPipe gets ns / 1e6 (ms). A frame whose ms is not after the last one is DROPPED
//    before inference; nothing is re-timed or invented.
//  - STRATEGY_KEEP_ONLY_LATEST + synchronous inference on one thread: a busy analyser drops
//    frames instead of queueing them.
//  - Preview and analysis both ask for 4:3, so the overlay's crop matches the preview's.
package expo.modules.wsfposecamera

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.Handler
import android.os.Looper
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.UseCase
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.lifecycle.LifecycleOwner
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import java.util.concurrent.Executor
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

internal class WsfPoseRun(
  val runId: Int,
  private val context: Context,
  private val owner: LifecycleOwner,
  private val previewView: PreviewView,
  private val emit: (source: WsfPoseRun, event: String, payload: Map<String, Any>) -> Unit
) {
  private val main = Handler(Looper.getMainLooper())
  private val mainExecutor = Executor { command -> main.post(command) }
  private val analysisExecutor: ExecutorService = Executors.newSingleThreadExecutor()

  @Volatile
  private var stopped = false

  // Main thread only.
  private var provider: ProcessCameraProvider? = null
  private var useCases: List<UseCase> = emptyList()

  // Analysis thread only.
  private var landmarker: PoseLandmarker? = null
  private var lastTimestampMs = Long.MIN_VALUE

  /** Main thread. */
  fun start() {
    if (context.checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      send("onCameraError", mapOf("stage" to "permission", "message" to "Camera permission is not granted."))
      return
    }
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      if (stopped) return@addListener
      try {
        bind(future.get())
      } catch (error: Exception) {
        send("onCameraError", mapOf("stage" to "playback", "message" to (error.message ?: "The camera did not start.")))
      }
    }, mainExecutor)
  }

  /** Main thread. */
  fun stop() {
    if (stopped) return
    stopped = true
    val cameraProvider = provider
    val bound = useCases
    provider = null
    useCases = emptyList()
    for (useCase in bound) {
      if (useCase is ImageAnalysis) useCase.clearAnalyzer()
    }
    if (cameraProvider != null && bound.isNotEmpty()) {
      try {
        cameraProvider.unbind(*bound.toTypedArray())
      } catch (error: Exception) {
        // Already released by the lifecycle; nothing else to free.
      }
    }
    // After any frame already being analysed, close the model; then end the thread.
    analysisExecutor.execute {
      landmarker?.close()
      landmarker = null
    }
    analysisExecutor.shutdown()
  }

  // ── Main thread ────────────────────────────────────────────────────────────

  private fun bind(cameraProvider: ProcessCameraProvider) {
    val selector = CameraSelector.DEFAULT_FRONT_CAMERA
    check(cameraProvider.hasCamera(selector)) { "This device has no front camera." }

    val previewResolution = ResolutionSelector.Builder()
      .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
      .build()
    val analysisResolution = ResolutionSelector.Builder()
      .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
      .setResolutionStrategy(
        ResolutionStrategy(Size(640, 480), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER)
      )
      .build()

    val preview = Preview.Builder().setResolutionSelector(previewResolution).build()
    preview.setSurfaceProvider(previewView.surfaceProvider)

    val analysis = ImageAnalysis.Builder()
      .setResolutionSelector(analysisResolution)
      .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
      .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
      .build()
    analysis.setAnalyzer(analysisExecutor) { image -> analyze(image) }

    provider = cameraProvider
    useCases = listOf(preview, analysis)
    cameraProvider.bindToLifecycle(owner, selector, preview, analysis)
    analysisExecutor.execute { loadModel() }
  }

  // ── Analysis thread ────────────────────────────────────────────────────────

  private fun loadModel() {
    if (stopped) return
    val loaded = try {
      WsfPoseModel.create(context)
    } catch (error: Exception) {
      send("onCameraError", mapOf("stage" to "model", "message" to (error.message ?: "The pose model did not load.")))
      return
    }
    if (stopped) {
      loaded.landmarker.close()
      return
    }
    landmarker = loaded.landmarker
    send("onCameraReady", mapOf("engine" to loaded.engine))
  }

  private fun analyze(image: ImageProxy) {
    try {
      val current = landmarker
      if (stopped || current == null) return
      val timestampNs = image.imageInfo.timestamp
      val timestampMs = timestampNs / 1_000_000L
      // Drop, never fabricate: a repeated or older timestamp never reaches MediaPipe or the counter.
      if (timestampMs <= lastTimestampMs) return
      lastTimestampMs = timestampMs

      val upright = uprightBitmap(image)
      val result = try {
        current.detectForVideo(BitmapImageBuilder(upright).build(), timestampMs)
      } catch (error: Exception) {
        current.close()
        landmarker = null
        send("onCameraError", mapOf("stage" to "inference", "message" to (error.message ?: "Pose inference failed.")))
        return
      }
      val people = result.landmarks().take(WsfPoseModel.MAX_POSES).map { WsfPoseModel.flatten(it) }
      send(
        "onPose",
        mapOf(
          "timestamp" to timestampNs.toDouble(),
          "timestampUnit" to "ns",
          "width" to upright.width,
          "height" to upright.height,
          "mirrored" to false,
          "people" to people
        )
      )
    } catch (error: Exception) {
      send("onCameraError", mapOf("stage" to "inference", "message" to (error.message ?: "Frame analysis failed.")))
    } finally {
      image.close()
    }
  }

  /** The frame turned upright (rotationDegrees), never mirrored. In memory only. */
  private fun uprightBitmap(image: ImageProxy): Bitmap {
    val bitmap = image.toBitmap()
    val rotation = image.imageInfo.rotationDegrees
    if (rotation == 0) return bitmap
    val matrix = Matrix().apply { postRotate(rotation.toFloat()) }
    return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
  }

  /** Every event goes to the main thread, carries this run's id, and is dropped once the run is stopped. */
  private fun send(event: String, body: Map<String, Any>) {
    val payload = body + ("runId" to runId)
    main.post {
      if (!stopped) emit(this, event, payload)
    }
  }
}
