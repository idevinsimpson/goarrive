// UNCOMPILED in sprint sandbox — first compile happens in an EAS development build
//
// THE POSE CAMERA VIEW. A full-bleed, mirrored self-view preview (CameraX PreviewView,
// FILL_CENTER like web's object-fit: cover) plus, while `active`, one WsfPoseRun for `runId`.
//  - active true / new runId → stop any old run, open the camera and model for this run.
//  - active false, an error, the view being destroyed or leaving its window → stop: camera
//    unbound, model closed.
//  - App-switcher privacy: on API 33+ the Recents screenshot is disabled for as long as this view
//    is attached (paused or failed included), so no JS round trip can re-enable it before the
//    task snapshot. A black cover hides the preview whenever no run is open or the window lost
//    focus (any API level); the PreviewView itself stays VISIBLE, so its TextureView keeps
//    consuming frames while the notification shade is down.
// Events from a run that is no longer current are dropped here, and JS drops any event whose
// runId is not its current run.
package expo.modules.wsfposecamera

import android.content.Context
import android.graphics.Color
import android.os.Build
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
  /** Drawn over the preview: never a stale or backgrounded frame on screen or in a snapshot. */
  private val cover = View(context).apply { setBackgroundColor(Color.BLACK) }
  private var run: WsfPoseRun? = null
  private var startedRunId = 0

  init {
    setBackgroundColor(Color.BLACK)
    addView(previewView, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    addView(cover, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    val width = right - left
    val height = bottom - top
    previewView.measure(
      View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY)
    )
    previewView.layout(0, 0, width, height)
    cover.measure(
      View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY)
    )
    cover.layout(0, 0, width, height)
  }

  /** Called once all props of an update are set (OnViewDidUpdateProps). Main thread. */
  fun applyProps() {
    val change = WsfPoseContract.runChange(run?.runId ?: 0, startedRunId, active, runId)
    if (change.stop) stopRun()
    val wanted = change.start
    if (wanted == 0) return
    startedRunId = wanted
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
    updateCover()
    next.start()
  }

  /** OnViewDestroys. */
  fun release() {
    stopRun()
    setRecentsScreenshot(true)
  }

  /** The preview shows only while a run is open and the window has focus (it loses focus before the task snapshot). */
  private fun updateCover() {
    cover.visibility = if (run != null && hasWindowFocus()) View.INVISIBLE else View.VISIBLE
  }

  override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
    super.onWindowFocusChanged(hasWindowFocus)
    updateCover()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    setRecentsScreenshot(false)
  }

  private fun setRecentsScreenshot(enabled: Boolean) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    appContext.currentActivity?.setRecentsScreenshotEnabled(enabled)
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    setRecentsScreenshot(true)
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
    updateCover()
  }
}
