# UNCOMPILED in sprint sandbox — first compile happens in an EAS development build
#
# The podspec lives at the module root (expo-module.config.json `apple.podspecPath`)
# so the bundled model in ../assets is inside the pod root: CocoaPods file patterns
# cannot climb out of it with "..". The one model file is shared with Android.
Pod::Spec.new do |s|
  s.name           = 'WsfPoseCamera'
  s.version        = '0.1.0'
  s.summary        = 'We Stay Fit squat camera: front camera and MediaPipe PoseLandmarker on device, landmarks only.'
  s.description    = 'Local Expo module for the We Stay Fit app. Opens the front camera with AVFoundation, runs MediaPipe Tasks PoseLandmarker on each frame in memory, and sends raw landmarks to JavaScript. The module itself records, stores and uploads nothing. Its MediaPipeTasksCommon dependency sends Google usage telemetry (Clearcut: task name, running mode, app id, app version, OS version, frame counts, latencies; no frames, images or landmarks).'
  s.author         = 'We Stay Fit'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }

  # MediaPipe ships static xcframeworks, so this pod is a static framework too.
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # Pinned to the web engine's exact version (engine.ts MEDIAPIPE_VERSION = '0.10.35').
  # 0.10.35 is on CocoaPods trunk (MediaPipeTasksVision 0.10.35, iOS >= 15.0).
  # PRIVACY: unlike the web package, this native SDK's MediaPipeTasksCommon 0.10.35 links
  # ClearcutLoggingClient and sends Google usage telemetry (task name, running mode, app id,
  # app version, OS version, frame counts, latencies; no frames, images or landmarks) to
  # play.googleapis.com/log. It also links MPPAudioRecord / AVAudioSession, which this module never
  # calls. The app keeps the native counter off until the owner decides
  # (src/movement-camera/support.native.ts NATIVE_CAMERA_TELEMETRY_APPROVED).
  s.dependency 'MediaPipeTasksVision', '0.10.35'

  s.frameworks = 'AVFoundation', 'CoreMedia', 'CoreVideo'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.source_files = 'ios/**/*.{h,m,mm,swift}'
  # The SAME model bytes as the web engine's MODEL_URL (sha256 pinned in
  # tests/move-camera-native-adapter.test.ts and re-checked at runtime).
  s.resource_bundles = {
    'WsfPoseCameraModel' => ['assets/pose_landmarker_lite.task']
  }
end
