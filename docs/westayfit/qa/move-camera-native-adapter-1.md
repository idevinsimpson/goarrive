# NATIVE-CAMERA-1 — native squat camera adapter (iOS/Android), QA record

Branch `claude/wsf-native-camera-1`, base `5a968141de60e6b355d2d1fa327ff2f6f6f14565` (NATIVE-BUILD-1: camera permission config, react-native-svg, generated native dirs ignored).
Design source: the camera-lane research report (local Expo module `modules/wsf-pose-camera`, MediaPipe Tasks PoseLandmarker in the web engine's mode and settings, raw landmarks into the existing `mapPerson` → `RepCounterOrchestrator`, frozen counter unchanged).

> **Status, plainly.** The JavaScript side is implemented and tested here. The Swift and Kotlin code is **UNCOMPILED**: this sandbox has no Xcode and no Android SDK (dl.google.com is blocked). Its first compile happens in an EAS development build. **Nothing here shows that the camera works, or counts accurately, on a real body or device.**

Paths below are relative to `apps/westayfit/`.

## What is implemented

| Layer | Where | What it does |
|---|---|---|
| Native module config | `modules/wsf-pose-camera/expo-module.config.json` | Autolinked local module. `apple.podspecPath` points to the root podspec (see "Deviations"). |
| JS contract | `modules/wsf-pose-camera/index.ts`, `src/WsfPoseCamera.types.ts`, `src/WsfPoseCameraView.tsx` | Event payload types (`onPose`, `onCameraReady`, `onCameraError`, `onCameraInterrupted`), `loadWsfPoseCameraModule()` (`requireOptionalNativeModule`, never throws), and a **lazy** `getWsfPoseCameraView()`. `requireNativeView` is never called at import time, so a binary without the module never registers a broken view. |
| iOS | `WsfPoseCamera.podspec`, `ios/WsfPoseCameraModule.swift`, `ios/WsfPoseCameraView.swift`, `ios/WsfPoseRun.swift`, `ios/WsfPoseModel.swift` | AVCaptureSession, front wide camera, `vga640x480`, 32BGRA data output with `alwaysDiscardsLateVideoFrames`. Connection rotated to portrait (`videoRotationAngle = 90` on iOS 17+, `.portrait` before). Data **not mirrored**. `AVCaptureVideoPreviewLayer` with `resizeAspectFill` (mirrored self-view). PoseLandmarker **VIDEO** mode, `detect(videoFrame:timestampInMilliseconds:)`, synchronous on the video queue. Session interruption → `onCameraInterrupted`; runtime error → `onCameraError('ended')`. Permission: video only. |
| Android | `android/build.gradle`, `android/proguard-rules.pro`, `android/src/main/java/expo/modules/wsfposecamera/{WsfPoseCameraModule,WsfPoseCameraView,WsfPoseRun,WsfPoseModel}.kt` | CameraX `Preview` in a `PreviewView` (`FILL_CENTER`, TextureView) plus `ImageAnalysis` (RGBA_8888, `STRATEGY_KEEP_ONLY_LATEST`, 640x480). Both use cases ask for 4:3, so the overlay crop matches the preview. Each frame is rotated upright by `rotationDegrees` (never flipped), then `detectForVideo(image, ms)` runs on one analysis thread. Permission: `CAMERA` only. |
| Model | `modules/wsf-pose-camera/assets/pose_landmarker_lite.task` | The **same bytes** as web's `MODEL_URL` (lite float16 v1). One copy, wired into the iOS resource bundle `WsfPoseCameraModel` and Android `assets.srcDirs`. Both sides **re-check the sha256 at runtime** before creating the landmarker, so a different file can never run. There is no runtime download. |
| Engine settings (both) | `WsfPoseModel.swift`, `WsfPoseModel.kt` | As `engine.ts`: VIDEO mode, `numPoses 3`, `0.5 / 0.5 / 0.5`, no segmentation masks, GPU then CPU fallback at creation. |
| Pure adapter | `src/movement-camera/nativeEngine.ts` | `toPoseFrame(event, lastMs)` and `NativeFrameGate`; details below. |
| Controller | `src/movement-camera/controller.native.ts` | Same public API as `controller.ts` (`snapshot`, `subscribe`, `startCamera`, `stopCamera`, `beginSet`, `finishSet`, `dispose`, `REQUESTED_CAMERA`). Run token per start. Permission is requested before the camera opens. The binding goes inactive on Stop, pause, failure and dispose. Pauses on `AppState` leaving `active` and on a native interruption, except while the OS permission prompt is up (the iOS alert makes the app `inactive`; the Android dialog pauses the activity). Read-only `frameStats` support a dev HUD. |
| Support probe | `src/movement-camera/support.native.ts` | `cameraCounterSupported()` is true **only** on iOS/Android when `requireOptionalNativeModule('WsfPoseCamera')` returns a module with `requestCameraPermissionAsync`. Expo Go, web and older binaries get false and stay on the manual flow (fail closed). Synthetic hooks return null on native. |
| Overlay | `src/ui/CameraSkeletonOverlay.native.tsx` | react-native-svg 15.12.1. Same `figureGeometry` as web (both arms, torso, legs, head **ring**). Same viewBox, `xMidYMid slice`. Mirrored with `scaleX(-1)` for display only. |
| Preview slot | `src/ui/NativeCameraPreview.native.tsx` (+ `NativeCameraPreview.tsx`, a web stub that renders null) and a 2-line edit in `src/ui/CameraRepCounter.tsx` | The native view, full-bleed, bound to the controller's `{active, runId}`. Every native event goes back to the controller. The web `<video>` branch is unchanged. |

**Not touched:** `frozen/**`, `frozen.js`, `frozen.d.ts`, `orchestrator.ts`, `flow.ts`, `visual.ts`, `figure.ts`, `engine.ts`, web `controller.ts` and `support.ts`. Nor were `package.json`, the lockfile, `app.json`, `eas.json`, `src/firebase.ts`, `src/stagingEnv.ts`, `src/storage/*` or `settingsStore.ts`. No thresholds or counting changed. Metro picks the `.native.*` files on iOS/Android; the web export contains none of the module code (checked: 0 bundle files mention `requestCameraPermissionAsync`).

### The event → PoseFrame contract (`nativeEngine.ts`)

- **Event:** `{runId, timestamp, timestampUnit, width, height, mirrored, people}`. `people` holds one flat `[x, y, v] × 33` array per person, BlazePose order. `v = -1` means MediaPipe reported no visibility.
- **Timestamps:**
  - iOS sends integer ms (presentation time × 1000, floored). Android sends ns (`ImageInfo.timestamp`), and JS divides by 1e6.
  - Unlabelled values above `1e12` are read as ns. A value **labelled** ms above `1e12` is dropped as a mislabelled clock.
  - Both native sides drop any frame whose ms is not after the last one, **before inference**. JS drops duplicates and out-of-order frames again. Frames are dropped, never re-timed, so the frozen session's `outOfOrder`/`gap` rules stay the only judge.
- **Coordinates:** normalised to the **upright, unmirrored** frame. An event that says `mirrored: true` is flipped back (x only). Both native sides send `false`.
- **Visibility:** a missing or negative value becomes "not reported". `mapBlazePose` turns that into `0`, so every landmark that reaches the counter has a numeric visibility, and an unknown point can never make the member look ready.
- **People:** at most `numPoses = 3`. Nobody in frame produces an **empty frame**, which is kept, so tracking loss is seen as loss and not as a gap. Malformed people are skipped.
- **Aspect:** `width / height` of the upright frame (portrait 480x640 gives 0.75), as web's `videoWidth / videoHeight`. A frame with no usable size is dropped, never given a guessed aspect, because the lock measures distances with it.

## What is tested here

Baseline before this change: **66 files, 1288 tests**. After: **67 files, 1339 tests**, all passing (`npx vitest run`). The +51 are in `tests/move-camera-native-adapter.test.ts`:

| Area | Tests |
|---|---|
| Pure adapter | Same `mapPerson` output as web. Aspect. ns→ms. The ns guard. Invalid events. Duplicate and out-of-order drop. Unmirroring. Visibility always present (missing → 0). Empty frames kept. Cap at 3. Malformed people skipped. Gate statistics. |
| Parity through the **real** frozen session (`makeSessionR1421`) | iOS-ms and Android-ns event streams give frame-for-frame identical orchestrator outcomes to the web path. The standard set gives raw 4 / set 3. Lab scene with a bystander behind and one squatting at the edge: native = web, and bystanders add nothing. Tracking loss: empty frames delivered, count held, "Step back into view.", counting resumes. 15 fps still counts every rep. A 400 ms hole mid-rep voids that rep. Injected duplicate and older frames never void a rep. Orientation: an upright stream becomes ready; a sideways (un-rotated) stream never becomes ready and counts 0. Mirroring: the member's right wrist is at smaller x. |
| `controller.native` | Public-API parity with `controller.ts`. Full flow: permission → bound for run 1 → ready → GO → 3 → Finish → released. Events of other runs ignored. A permission answer after Stop opens nothing. Denied, throwing or missing module → failure panel. Native error stages mapped. AppState `inactive`/`background` and native interruptions pause and keep banked reps. The OS permission prompt (iOS `inactive`, Android `background`) does not pause the run it is asking for. No start in the background. `frameStats`. |
| `support.native` | True only with the linked module, on iOS/Android. Expo Go, older binaries, web, and a throwing probe → false. Uses `requireOptionalNativeModule('WsfPoseCamera')`. Stays import-light. |
| Overlay / preview | react-native-svg rendering: 2 layers × 8 lines, head ring (`fill: none`, r 26–150), both arms drawn at the unmirrored data x, `scaleX(-1)` and `pointer-events: none` on the wrapper. The preview opens the native view only while the binding is active, for that run, and routes events. It renders nothing for a non-native controller. `CameraRepCounter` native slot. |
| Model | sha256 pinned. Size and GCS md5 match `MODEL_URL`'s object. Task bundle contents. One copy, wired into the podspec and gradle. Swift and Kotlin carry the same pin. |
| Native sources (static) | Every native file starts with the UNCOMPILED header. Config names the real classes. Module name, props, events and permission functions match on both sides. Engine settings. Camera contract (front, upright, unmirrored, drop-before-inference, ms/ns). Versions. Dependency allowlists. |
| Privacy (static) | Comment-stripped scan of every Swift/Kotlin/TS file in `modules/wsf-pose-camera/**`. It finds no photo, movie, audio, asset writer, recorder, network, socket, file write, image encoding, media store or preferences API. Exactly one camera input and one data output. Permission: video/CAMERA only. The model comes from the app's own assets. The new app files have no storage, network or Firestore. Only `.native` files import the module at runtime. |

Eleven hand mutants of the adapter, controller, support probe and overlay were run (no ns division, no duplicate drop, no out-of-order drop, no unmirroring, invented visibility, no people cap, no run-token check, no late-permission check, AppState pausing during the permission prompt, support always true, overlay not mirrored). **All eleven were caught** by this suite.

Also run here: `npx tsc --noEmit` is clean. `npx expo export --platform ios` and `--platform android` exit 0 with the module absent. The native bundles contain the native controller and preview and **none** of the web controller (`OverconstrainedError`), the synthetic hook (`__WSF_TEST_POSE__`) or the web engine (`FilesetResolver`, `vision_bundle`). `--platform web` exits 0.

### Checks of the native code that were possible without compiling it

- **Autolinking:** `npx expo-modules-autolinking resolve -p apple|android` finds `wsf-pose-camera`:
  - pod `WsfPoseCamera` at the module root, Swift module `WsfPoseCamera`, `WsfPoseCameraModule`;
  - Android project `android/`, module `expo.modules.wsfposecamera.WsfPoseCameraModule`.
- **Podspec:** loaded and linted with cocoapods-core 1.16.2 (`Pod::Specification::Linter`): **passes**. The one warning left is the expected "git source without a tag" of a local pod.
- **Kotlin:** all four files pass the Kotlin 2.1.20 compiler front end with **no syntax errors**. Every reported error is an unresolved Android, CameraX, MediaPipe or Expo symbol, because those jars were not on the classpath. **Semantic compile: UNVERIFIED.**
- **Swift:** all four files parse with **no syntax errors** under the tree-sitter-swift 0.7.1 grammar. The checker was confirmed to flag a deliberately broken file. **Type-check and compile: UNVERIFIED.**
- **MediaPipe API names** were read from source at tag `v0.10.35`:
  - iOS headers: `PoseLandmarkerOptions` (`numPoses`, `min*Confidence`, `shouldOutputSegmentationMasks`), `BaseOptions.delegate` (`Delegate.CPU/.GPU`), `RunningMode.video`, `MPImage(sampleBuffer:orientation:)`, `detect(videoFrame:timestampInMilliseconds:)`, `NormalizedLandmark.visibility: NSNumber?`.
  - Android Java: `PoseLandmarkerOptions.builder()…setOutputSegmentationMasks`, `BaseOptions.setModelAssetBuffer`/`setDelegate`, `detectForVideo(MPImage, long)`, `NormalizedLandmark.visibility(): Optional<Float>`. These are identical at `v0.10.26`.
  - Android `setModelAssetBuffer` is copied with `ByteString.copyFrom` from the buffer's position, so the code rewinds the buffer before each delegate attempt.

## MediaPipe versions chosen, with evidence

| Platform | Version | Evidence |
|---|---|---|
| Web (unchanged) | `@mediapipe/tasks-vision` 0.10.35 | `engine.ts`, the existing pin test. |
| iOS | `MediaPipeTasksVision` **0.10.35** (iOS ≥ 15.0, static xcframework, depends on `MediaPipeTasksCommon` 0.10.35) | The CocoaPods CDN index lists 0.10.35 for both pods. The trunk podspec (`CocoaPods/Specs` `Specs/9/9/0/MediaPipeTasksVision/0.10.35`) points to the `dl.google.com/cpdc/20260427-204221/MediaPipeTasksVision-0.10.35.tar.gz` release. The git tag `v0.10.35` exists (`f8ef212d`). |
| Android | `com.google.mediapipe:tasks-vision` **0.10.29** | **0.10.35 on Google Maven is UNVERIFIED**: dl.google.com is blocked here, and Maven Central does not host the group. Indirect signs that it exists: the same-release git tag and CocoaPods pods, and `react-native-pose-detection@0.2.2` (npm, 2026-09-28), which pins `tasks-vision:0.10.35`. Following the brief, the **nearest confirmed** version is used: **0.10.29**. Google's own `mediapipe-samples` pose_landmarker Android app built against it (commit `1daf138`, 2025-09-25 "Update all examples to 0.10.29", until `23a32e8` moved to 1.0.0 on 2026-08-04). Git tags 0.10.27–0.10.31 do not exist; the API used is identical at the neighbouring tags v0.10.26 and v0.10.35. Moving to 0.10.35 is one line in `android/build.gradle` plus `WsfPoseModel.MEDIAPIPE_VERSION`; a test keeps the two in step. Never 1.x without a privacy review. |
| CameraX (Android) | 1.4.2 (core, camera2, lifecycle, view) | The version Google's pose sample uses. Resolution from Google Maven is UNVERIFIED here for the same reason. |

**Consequence to know:** until Android moves to 0.10.35, Android runs a different MediaPipe release from web and iOS, with the same model file and settings. Proof plan item 9 (parity) must be read with that in mind.

## Model

- `pose_landmarker_lite.task`, 5,777,746 bytes.
- **sha256 `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`.**
- md5 `04a75ddf7c811ac7a1a4523266dd7d88`, which equals the GCS object metadata (ETag and `x-goog-hash`) of web's `MODEL_URL` when downloaded. It is a zip holding `pose_detector.tflite` and `pose_landmarks_detector.tflite`.

## UNCOMPILED / UNVERIFIED (nothing below has run)

- **UNCOMPILED:** every Swift and Kotlin file, the podspec and `build.gradle` in a real build.
- **UNVERIFIED, build:**
  - MediaPipe Android 0.10.35 availability (0.10.29 is pinned);
  - CameraX 1.4.2 resolution;
  - pod install and linking of MediaPipe's static xcframeworks under Expo SDK 54 (static libraries, new architecture);
  - resource-bundle placement.
- **UNVERIFIED, runtime:**
  - iOS GPU delegate behaviour;
  - whether `videoRotationAngle = 90` gives upright, unmirrored front-camera buffers on every iPhone;
  - whether Android analysis frames rotated by `rotationDegrees` are upright and unmirrored on every sensor mount;
  - preview/overlay alignment (iOS preview shows the 640x480 session, like web's 640x480 video);
  - frame rate and thermal behaviour;
  - `AppState` pause timing on calls, Siri and Control Center;
  - the camera indicator going off within 1 s;
  - visibility actually populated by native MediaPipe. If it is missing, readiness is never reached: the app fails closed, but the camera would be useless.
- **Not claimed:** camera accuracy, count accuracy, or any device behaviour.

## First-compile risks to check in the EAS development build

iOS (`eas build --profile development --platform ios`, then the pod install and Xcode logs):

1. `pod install` resolves `MediaPipeTasksVision 0.10.35` and `MediaPipeTasksCommon 0.10.35`, downloaded from dl.google.com. `WsfPoseCamera` is a `static_framework`; check for "transitive static library" errors.
2. Link: MediaPipe's graph registration needs its own `-force_load` flags, which its podspec supplies. If they are lost, the app builds but the landmarker fails at runtime with "No registered object with name: …PoseLandmarkerGraph". In the app that shows as the `model` failure panel.
3. Swift: `import MediaPipeTasksVision` from a Swift static pod. Check that `Delegate`, `BaseOptions.delegate`, `shouldOutputSegmentationMasks`, `MPImage(sampleBuffer:orientation:)` and `detect(videoFrame:timestampInMilliseconds:)` resolve (Swift names read from the 0.10.35 headers).
4. `ExpoView` (`ExpoFabricView` under the new architecture) subclass: `required init(appContext:)` only, and `EventDispatcher` properties named exactly as `Events(...)`.
5. `AVCaptureConnection.videoRotationAngle` / `isVideoRotationAngleSupported` need the iOS 17 SDK (Xcode 15+). The `videoOrientation` fallback gives deprecation warnings only.
6. The resource bundle `WsfPoseCameraModel.bundle` must be in the app bundle. Otherwise `WsfPoseModel.modelPath()` throws `modelMissing` (shown as the `model` failure). Xcode 14+ resource-bundle signing needs CocoaPods ≥ 1.12.
7. Swift language mode 5.9 under the Xcode 16 compiler: concurrency warnings are possible, not errors.

Android (`eas build --profile development --platform android`, Gradle log):

1. Google Maven resolves `com.google.mediapipe:tasks-vision:0.10.29` and `androidx.camera:*:1.4.2`. **Also try 0.10.35** and record whether it resolves.
2. The Expo SDK 54 toolchain (compileSdk, AGP, Kotlin 2.1.x) builds the module. MediaPipe needs minSdk 24, which matches the SDK 54 default.
3. Kotlin:
   - `Permissions.askForPermissionsWithPermissionsManager(appContext.permissions, promise, CAMERA)` picks the `expo.modules.kotlin.Promise` overload;
   - the `View(WsfPoseCameraView::class) { Prop / Events / OnViewDidUpdateProps / OnViewDestroys }` DSL compiles;
   - `ListenableFuture` (from `ProcessCameraProvider.getInstance`) is on the compile classpath. If it is not, add `com.google.guava:listenablefuture`; that is a dependency change, which needs the owner.
4. Packaging: watch for duplicate `.so` (for example `libc++_shared.so`) between React Native and MediaPipe, and APK size growth.
5. Runtime wiring:
   - `appContext.currentActivity as? LifecycleOwner` must be non-null, otherwise the `playback` failure shows;
   - `PreviewView` must lay out inside `ExpoView` (`shouldUseAndroidLayout` and `onLayout`). A black preview with landmarks still arriving means layout, not the camera.
6. A release (preview profile) build with minify on keeps MediaPipe classes through `consumerProguardFiles`.

JS (both): the bundle already exports with the module absent. On the dev build, check that `cameraCounterSupported()` becomes true **only** on the dev client. In Expo Go it must stay false.

## Device proof plan (dev build on a real iPhone and a mid-range Android; pass criteria are proposals for owner sign-off)

A dev-only HUD is **not built**. `RepCounterController.frameStats` (accepted, duplicate, outOfOrder, invalid) and the snapshot are what such a HUD would show.

1. **Orientation.**
   - Upright member: logged frames show `nose.y < shoulder.y < hip.y < knee.y < ankle.y`, and `aspect ≈ 0.75`.
   - Repeat after rotating the phone and returning.
   - Android: 2 devices with different sensor mounts.
2. **Mirroring.**
   - Member raises their RIGHT hand. Data: `rightWrist.x < leftWrist.x`.
   - Screen: the preview and the overlay arm move on the member's right side.
3. **Overlay alignment.**
   - Left edge, right edge, full crouch: joint offset ≤ 3% of screen width on 2 aspect ratios (19.5:9, 20:9).
   - Overlay OFF leaves counting identical.
4. **Monotonic timestamps.**
   - 0 `outOfOrder` reaching the session over 5 minutes. Median Δt ≈ 33 ms.
   - On Android, Δt must be in ms, not ~33,000,000.
5. **Dropped frames.**
   - Under load (Low Power Mode, 10 minutes): effective fps ≥ 15, and no `gap` in steady view.
   - A forced > 250 ms stall voids the rep in progress.
6. **Tracking loss.** Walk out mid-set: "Step back into view", count unchanged, the rep in progress is not counted, counting resumes on return.
7. **Multi-person** (live versions of `labDemoScene`):
   - a person walking behind adds 0;
   - a person squatting at the edge adds 0;
   - the member is re-acquired.
8. **Interruptions.**
   - Cases: home/background, lock, incoming call/Siri/Control Center, another app taking the camera, permission denied on first ask, permission revoked in Settings while backgrounded.
   - Expected: "Camera paused" with banked reps, or the failure panel with "Enter reps manually".
   - The camera indicator goes off within 1 s of Finish, Close or background.
9. **Count accuracy against a manual tally.**
   - 2 devices × ≥ 2 subjects × 3 sets of 10, plus 1 fast set and 1 set with 3 deliberate half-squats.
   - Proposed pass: |camera − manual| ≤ 1 per set; half-squats add 0.
   - **Parity**: mobile web on the same phone vs the native build. Note the Android MediaPipe version above.
10. **Privacy.**
    - A network inspector shows no requests while the camera runs.
    - The app container does not grow over a session.
    - The static scan here passes.

## Deviations from the research report, and why

- **Podspec at the module root**, not `ios/`. CocoaPods file patterns cannot climb out of the pod root with `..`, and the single shared model lives in `assets/`. `expo-module.config.json` `apple.podspecPath` points to it; autolinking resolves it (checked).
- **The preview slot is its own file pair** (`NativeCameraPreview.tsx` / `.native.tsx`). `CameraRepCounter.tsx` gets a 2-line edit (one import, one JSX expression) instead of native logic inline. The web `<video>` branch is byte-identical.
- **Two extra native files per platform** (`WsfPoseRun`, `WsfPoseModel`) keep the one-run camera lifecycle and the model/settings apart from the view glue.
- **The privacy list in `tests/move-camera-counter.test.ts` was not edited.** The new files are scanned by the new suite instead, so the existing suite stays as it was.

## Out of lane / owner actions

- Native settings persistence (`settingsStore.ts` is memory-only on native): a separate scoped change.
- Android MediaPipe 0.10.29 → 0.10.35 after the EAS log confirms resolution.
- `ListenableFuture` dependency, only if the Android compile asks for it (a dependency change).
- EAS project init, credentials and device registration (see the NATIVE-BUILD-1 readiness note).

## Reproduce

```sh
cd apps/westayfit
npx tsc --noEmit
npx vitest run tests/move-camera-native-adapter.test.ts     # 51 tests
npx vitest run                                              # 67 files, 1339 tests
npx expo export --platform ios --output-dir /tmp/exp-ios
npx expo export --platform android --output-dir /tmp/exp-android
npx expo-modules-autolinking resolve -p apple --json        # wsf-pose-camera → pod WsfPoseCamera
npx expo-modules-autolinking resolve -p android --json      # wsf-pose-camera → expo.modules.wsfposecamera.WsfPoseCameraModule
```
