// UNCOMPILED in sprint sandbox — first compile happens in an EAS development build
//
// THE POSE CAMERA VIEW. A full-bleed, mirrored self-view preview (CameraX PreviewView,
// FILL_CENTER like web's object-fit: cover) plus, while `active`, one WsfPoseRun for `runId`.
//  - active true / new runId → stop any old run, open the camera and model for this run.
//  - active false, an error, the view being destroyed or leaving its window → stop: camera
//    unbound, model closed.
// Events from a run that is no longer current are dropped here, and JS drops any event whose
// runId is not its current run.
package expo.modules.wsfposecamera

import android.content.Context
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import androidx.camera.view.PreviewView
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

class WsfPoseCameraView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onCameraReady by EventDispatcher()
  private val onPose by EventDispatcher()
  private val onCameraError by EventDispatcher()
  private val onCameraInterrupted by EventDispatcher()

  var active: Boolean = false
  var runId: Int = 0

  // PreviewView adds its own surface view after layout; let Android lay it out.
  override val shouldUseAndroidLayout: Boolean = true

  private val previewView = PreviewView(context).apply {
    scaleType = PreviewView.ScaleType.FILL_CENTER
    // TextureView: composes with React Native's view hierarchy and overlays.
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
  }
  private var run: WsfPoseRun? = null

  init {
    setBackgroundColor(Color.BLACK)
    addView(previewView, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    val width = right - left
    val height = bottom - top
    previewView.measure(
      View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY)
    )
    previewView.layout(0, 0, width, height)
  }

  /** Called once all props of an update are set (OnViewDidUpdateProps). Main thread. */
  fun applyProps() {
    val change = WsfPoseContract.runChange(run?.runId ?: 0, active, runId)
    if (change.stop) stopRun()
    val wanted = change.start
    if (wanted == 0) return
    val owner = appContext.currentActivity as? LifecycleOwner
    if (owner == null) {
      onCameraError(mapOf("runId" to wanted, "stage" to "playback", "message" to "No activity to attach the camera to."))
      return
    }
    val next = WsfPoseRun(wanted, context, owner, previewView) { source, event, payload ->
      if (run === source) {
        forward(event, payload)
        if (event == "onCameraError") stopRun()
      }
    }
    run = next
    next.start()
  }

  /** OnViewDestroys. */
  fun release() {
    stopRun()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    val current = run ?: return
    // Off screen: release the camera now and let JS pause.
    stopRun()
    onCameraInterrupted(mapOf("runId" to current.runId, "reason" to "detached"))
  }

  private fun forward(event: String, payload: Map<String, Any>) {
    when (event) {
      "onCameraReady" -> onCameraReady(payload)
      "onPose" -> onPose(payload)
      "onCameraError" -> onCameraError(payload)
      "onCameraInterrupted" -> onCameraInterrupted(payload)
    }
  }

  private fun stopRun() {
    val current = run ?: return
    run = null
    current.stop()
  }
}
