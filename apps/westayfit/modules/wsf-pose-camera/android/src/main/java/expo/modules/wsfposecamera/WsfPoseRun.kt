// UNCOMPILED in sprint sandbox — first compile happens in an EAS development build
//
// ONE CAMERA RUN: the front camera (CameraX Preview + ImageAnalysis, no audio, no capture or
// recording use case) and one PoseLandmarker, opened for one `runId` and released by stop().
// Frames are processed in memory on one analysis thread and dropped; this code writes, records
// and sends nothing. Only landmark numbers leave, as events stamped with this run's id.
// (MediaPipe's own SDK usage telemetry is disclosed in android/build.gradle.)
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
import androidx.camera.core.CameraState
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
import androidx.lifecycle.LiveData
import androidx.lifecycle.Observer
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
  private var cameraState: LiveData<CameraState>? = null
  private var cameraStateObserver: Observer<CameraState>? = null

  // Analysis thread only.
  private var landmarker: PoseLandmarker? = null
  private val clock = WsfFrameClock()

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
      } catch (error: Throwable) {
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
    cameraStateObserver?.let { observer -> cameraState?.removeObserver(observer) }
    cameraState = null
    cameraStateObserver = null
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
      val current = landmarker
      landmarker = null
      closeQuietly(current)
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
    val camera = cameraProvider.bindToLifecycle(owner, selector, preview, analysis)
    observeCameraState(camera.cameraInfo.cameraState)
    analysisExecutor.execute { loadModel() }
  }

  /**
   * CameraX reports a camera that cannot open or that stops (in use by another app, disabled by
   * policy, a fatal device or stream error) through its state, not by throwing. Without this the
   * view would show "live" over a black preview: in use -> interrupted (JS pauses); a critical
   * error -> failure (manual entry).
   */
  private fun observeCameraState(state: LiveData<CameraState>) {
    val observer = Observer<CameraState> { value ->
      val error = value.error ?: return@Observer
      if (error.code == CameraState.ERROR_CAMERA_IN_USE || error.code == CameraState.ERROR_MAX_CAMERAS_IN_USE) {
        send("onCameraInterrupted", mapOf("reason" to "camera-in-use"))
      } else if (error.type == CameraState.ErrorType.CRITICAL) {
        send("onCameraError", mapOf("stage" to "ended", "message" to "Camera error ${error.code}"))
      }
    }
    state.observe(owner, observer)
    cameraState = state
    cameraStateObserver = observer
  }

  // ── Analysis thread ────────────────────────────────────────────────────────

  private fun loadModel() {
    if (stopped) return
    val loaded = try {
      WsfPoseModel.create(context)
    } catch (error: Throwable) {
      // Throwable, not Exception: UnsatisfiedLinkError / NoClassDefFoundError from MediaPipe's JNI
      // library or OutOfMemoryError must fail the run (manual entry), never kill the app.
      // When the CPU retry failed too, the GPU error rides along (suppressed) for the diagnosis.
      val gpu = error.suppressed.firstOrNull()
      val message = (error.message ?: error.javaClass.simpleName) +
        (if (gpu != null) " (GPU: ${gpu.message ?: gpu.javaClass.simpleName})" else "")
      send("onCameraError", mapOf("stage" to "model", "message" to message))
      return
    }
    if (stopped) {
      closeQuietly(loaded.landmarker)
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
      // Drop, never fabricate: a repeated or older timestamp never reaches MediaPipe or the counter.
      val timestampMs = clock.accept(timestampNs) ?: return

      val upright = uprightBitmap(image)
      val width = upright.width
      val height = upright.height
      val mpImage = BitmapImageBuilder(upright).build()
      val result = try {
        current.detectForVideo(mpImage, timestampMs)
      } catch (error: Throwable) {
        // The graph is in error here, so close() may throw too: forget it first, close quietly,
        // and still report the failure.
        landmarker = null
        closeQuietly(current)
        send("onCameraError", mapOf("stage" to "inference", "message" to (error.message ?: "Pose inference failed.")))
        return
      } finally {
        // Free the frame now instead of waiting for GC: closing the MPImage recycles its bitmap.
        mpImage.close()
      }
      val people = WsfPoseContract.people(result.landmarks().map { WsfPoseModel.landmarks(it) })
      send("onPose", WsfPoseContract.posePayload(timestampNs, width, height, people))
    } catch (error: Throwable) {
      send("onCameraError", mapOf("stage" to "inference", "message" to (error.message ?: "Frame analysis failed.")))
    } finally {
      image.close()
    }
  }

  /**
   * PoseLandmarker.close() rethrows a graph error (TaskRunner.close -> reportError when no error
   * listener is set). A throw on a background thread would kill the process, so every close goes
   * through here: the run is already ending, there is nothing else to free.
   */
  private fun closeQuietly(landmarker: PoseLandmarker?) {
    if (landmarker == null) return
    try {
      landmarker.close()
    } catch (error: Throwable) {
      // Nothing to report: the run already failed or stopped.
    }
  }

  /** The frame turned upright (rotationDegrees), never mirrored. In memory only. */
  private fun uprightBitmap(image: ImageProxy): Bitmap {
    val bitmap = image.toBitmap()
    val rotation = WsfPoseContract.normalizedRotation(image.imageInfo.rotationDegrees)
    if (rotation == 0) return bitmap
    val matrix = Matrix().apply { postRotate(rotation.toFloat()) }
    val rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    if (rotated !== bitmap) bitmap.recycle()
    return rotated
  }

  /** Every event goes to the main thread, carries this run's id, and is dropped once the run is stopped. */
  private fun send(event: String, body: Map<String, Any>) {
    val payload = body + ("runId" to runId)
    main.post {
      if (!stopped) emit(this, event, payload)
    }
  }
}
