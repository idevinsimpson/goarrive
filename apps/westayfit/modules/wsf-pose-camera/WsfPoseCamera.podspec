# UNCOMPILED in sprint sandbox — first compile happens in an EAS development build
#
# The podspec lives at the module root (expo-module.config.json `apple.podspecPath`)
# so the bundled model in ../assets is inside the pod root: CocoaPods file patterns
# cannot climb out of it with "..". The one model file is shared with Android.
Pod::Spec.new do |s|
  s.name           = 'WsfPoseCamera'
  s.version        = '0.1.0'
  s.summary        = 'We Stay Fit squat camera: front camera and MediaPipe PoseLandmarker on device, landmarks only.'
  s.description    = 'Local Expo module for the We Stay Fit app. Opens the front camera with AVFoundation, runs MediaPipe Tasks PoseLandmarker on each frame in memory, and sends raw landmarks to JavaScript. The module itself records, stores and uploads nothing. Its MediaPipeTasksCommon dependency sends Google usage telemetry through Clearcut: what MediaPipe hands its logger is the task name, running mode, iOS version, bundle id, app version, session events, frame counts and latencies; no frames, images or landmarks. What the Clearcut client adds to each request is not confirmed.'
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
  # ClearcutLoggingClient and sends Google usage telemetry to play.googleapis.com/log whenever a
  # landmarker is created and while it runs. What MediaPipe hands its logger (MPPTaskRunner.mm,
  # task_runner.cc, tasks_logger.h at v0.10.35): task name, running mode, host system (iOS), iOS
  # version, bundle id and app version; session start/clone/end; CPU/GPU input, finished and dropped
  # frame counts; total and peak latency; elapsed time; init errors. No frames, images or landmarks.
  # What the Clearcut client itself adds to each request on iOS is NOT confirmed (the review found
  # no UIDevice, sysctl, NSLocale or CoreTelephony reference in its objects, but no upload was
  # decoded); each upload reaches Google from the device's IP address. It also links MPPAudioRecord /
  # AVAudioSession, which this module never calls. The app keeps the native counter off until the
  # owner decides (src/movement-camera/nativeCameraGate.ts NATIVE_CAMERA_TELEMETRY_APPROVED).
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
