# NATIVE-CAMERA-1 — native squat camera adapter (iOS/Android), QA record

Branch `claude/wsf-native-camera-1`, base `5a968141de60e6b355d2d1fa327ff2f6f6f14565` (NATIVE-BUILD-1: camera permission config, react-native-svg, generated native dirs ignored).
Design source: the camera-lane research report (local Expo module `modules/wsf-pose-camera`, MediaPipe Tasks PoseLandmarker in the web engine's mode and settings, raw landmarks into the existing `mapPerson` → `RepCounterOrchestrator`, frozen counter unchanged).

> **BLOCKING, owner decision required: the native MediaPipe SDKs carry Google usage telemetry.** Independent review of #638 (finding 1 / F1) found it. Until the owner decides, the native counter is **OFF**: `support.native.ts` has `NATIVE_CAMERA_TELEMETRY_APPROVED = false`, so `cameraCounterSupported()` is false on every native build and members see only the manual flow. See "MediaPipe SDK usage telemetry" below.
>
> **Status, plainly.** The JavaScript side is implemented and tested here. The native code has **not been built for a phone**: this sandbox has no Xcode and no Android SDK (dl.google.com is blocked), so the first real build is an EAS development build.
>
> **The evidence pass narrowed this** (see "Compile and contract evidence" below):
> - The Android pure contract (`WsfPoseContract.kt`) is compiled and **run** on the JVM with kotlinc 2.1.20.
> - `WsfPoseCameraModule.kt` type-checks with **zero errors** against the real Android framework and the real expo-modules-core sources.
> - The Kotlin emitter and the JS adapter are **proven to agree** on one recorded-format stream.
> - Every Swift API call is cross-checked line by line against MediaPipe v0.10.35, expo-modules-core 3.0.30 and iOS 18.0 SDK headers.
>
> **Nothing here shows that the camera works, or counts accurately, on a real body or device.**

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
| Support probe | `src/movement-camera/support.native.ts` | **Telemetry gate first:** `cameraCounterSupported()` is false while `NATIVE_CAMERA_TELEMETRY_APPROVED` is `false`, which it is. Flipping it is a reviewed privacy decision. After approval it is true **only** on iOS/Android when `requireOptionalNativeModule('WsfPoseCamera')` returns a module with `requestCameraPermissionAsync`. Expo Go, web and older binaries get false. Whenever it is false the member stays on the manual flow (fail closed). Synthetic hooks return null on native. |
| Overlay | `src/ui/CameraSkeletonOverlay.native.tsx` | react-native-svg 15.12.1. Same `figureGeometry` as web (both arms, torso, legs, head **ring**). Same viewBox, `xMidYMid slice`. Mirrored with `scaleX(-1)` for display only. |
| Preview slot | `src/ui/NativeCameraPreview.native.tsx` (+ `NativeCameraPreview.tsx`, a web stub that renders null) and a 2-line edit in `src/ui/CameraRepCounter.tsx` | The native view, full-bleed, bound to the controller's `{active, runId}`. Every native event goes back to the controller. The web `<video>` branch is unchanged. |

**Not touched:** `frozen/**`, `frozen.js`, `frozen.d.ts`, `orchestrator.ts`, `flow.ts`, `visual.ts`, `figure.ts` and `engine.ts`. The web `controller.ts` and `support.ts` got **comment-only** edits (review web-2: their "native: unsupported" comments were stale); comments are stripped from the bundle. Nor were `package.json`, the lockfile, `app.json`, `eas.json`, `src/firebase.ts`, `src/stagingEnv.ts`, `src/storage/*` or `settingsStore.ts`. No thresholds or counting changed. Metro picks the `.native.*` files on iOS/Android; the web export contains none of the module code (checked: 0 bundle files mention `requestCameraPermissionAsync`).

### The event → PoseFrame contract (`nativeEngine.ts`)

- **Event:** `{runId, timestamp, timestampUnit, width, height, mirrored, people}`. `people` holds one flat `[x, y, v] × 33` array per person, BlazePose order. `v = -1` means MediaPipe reported no visibility.
- **Timestamps:**
  - iOS sends integer ms (presentation time × 1000, floored). Android sends ns (`ImageInfo.timestamp`), and JS divides by 1e6.
  - The unit is **required**: an event without `timestampUnit` is dropped, never guessed (review finding 6). A value **labelled** ms above `1e12` is dropped as a mislabelled ns clock.
  - Both native sides drop any frame whose ms is not after the last one, **before inference**. JS drops duplicates and out-of-order frames again. Frames are dropped, never re-timed, so the frozen session's `outOfOrder`/`gap` rules stay the only judge.
- **Coordinates:** normalised to the **upright, unmirrored** frame. An event that says `mirrored: true` is flipped back (x only). Both native sides send `false`.
- **Visibility:** a missing or negative value becomes "not reported". `mapBlazePose` turns that into `0`, so every landmark that reaches the counter has a numeric visibility, and an unknown point can never make the member look ready.
- **People:** at most `numPoses = 3`. Nobody in frame produces an **empty frame**, which is kept, so tracking loss is seen as loss and not as a gap. Malformed people are skipped.
- **Aspect:** `width / height` of the upright frame (portrait 480x640 gives 0.75), as web's `videoWidth / videoHeight`. A frame with no usable size is dropped, never given a guessed aspect, because the lock measures distances with it.

## What is tested here

Baseline before this change: **66 files, 1288 tests**. At `abe84f45`: **67 files, 1339 tests**. After the evidence pass and the NATIVE-BUILD-1 merge: **68 files, 1351 tests**. After the #638 review fixes: **68 files, 1361 tests**, all passing (`npx vitest run --testTimeout=30000`). This lane's suites:
- `tests/move-camera-native-adapter.test.ts`: 61 tests (51 before the #638 review fixes);
- `tests/move-camera-native-contract.test.ts`: 6 tests.

The merged NATIVE-BUILD-1 commits brought the rest. The adapter suite covers:

| Area | Tests |
|---|---|
| Pure adapter | Same `mapPerson` output as web. Aspect. ns→ms. The ns guard. Invalid events. Duplicate and out-of-order drop. Unmirroring. Visibility always present (missing → 0). Empty frames kept. Cap at 3. Malformed people skipped. Gate statistics. |
| Parity through the **real** frozen session (`makeSessionR1421`) | iOS-ms and Android-ns event streams give frame-for-frame identical orchestrator outcomes to the web path. The outcomes compared include keypoint coordinates, aspect and guidance, not just counts (review finding 4). The standard set gives raw 4 / set 3. Lab scene with a bystander behind and one squatting at the edge: native = web, and bystanders add nothing. Tracking loss: empty frames delivered, count held, "Step back into view.", counting resumes. 15 fps still counts every rep. A 400 ms hole mid-rep voids that rep. Injected duplicate and older frames never void a rep. Orientation: an upright stream becomes ready; a sideways (un-rotated) stream never becomes ready and counts 0. Mirroring: the member's right wrist is at smaller x. |
| `controller.native` | Public-API parity with `controller.ts`. Full flow: permission → bound for run 1 → ready → GO → 3 → Finish → released. Events of other runs ignored. A permission answer after Stop opens nothing. Denied, throwing or missing module → failure panel. Native error stages mapped. AppState `inactive`/`background` and native interruptions pause and keep banked reps. The OS permission prompt (iOS `inactive`, Android `background`) does not pause the run it is asking for. A grant that lands while the app is away opens the camera only on the next `active`. A throw while counting or rendering fails the run closed (released, manual entry). Native `playback` maps to the generic "Camera isn't available" panel. No start in the background. `frameStats`. tsc holds the native controller and preview to the web surface the camera screen uses. |
| `support.native` | **The telemetry gate:** the constant is `false`, so support is false even with the module linked, and the camera entry stays on the manual flow. Both gate states are covered (approved + linked → true; approved + not linked, or on web → false). The constant states its reason. With the gate open, true only with the linked module on iOS/Android; Expo Go, older binaries, web and a throwing probe → false. Uses `requireOptionalNativeModule('WsfPoseCamera')`. Stays import-light. |
| Overlay / preview | react-native-svg rendering: 2 layers × 8 lines, head ring (`fill: none`, r 26–150), both arms drawn at the unmirrored data x, `scaleX(-1)` and `pointer-events: none` on the wrapper. The preview opens the native view only while the binding is active, for that run, and routes events. It renders nothing for a non-native controller. `CameraRepCounter` native slot. |
| Model | sha256 pinned. Size and GCS md5 match `MODEL_URL`'s object. Task bundle contents. One copy, wired into the podspec and gradle. Swift and Kotlin carry the same pin. |
| Native sources (static) | Every native file starts with the UNCOMPILED header. Config names the real classes. Module name, props, events and permission functions match on both sides. Engine settings. Camera contract (front, upright, unmirrored, drop-before-inference, ms/ns). Versions. Dependency allowlists. |
| Privacy (static) | The module's file list is pinned exactly, so a new `.m`/`.mm`/`.h`/`.java` file or an `AndroidManifest.xml` fails the suite. Every compiled source kind is scanned (Swift, Kotlin, Java, ObjC, TS), with block comments and comment-only lines removed and strings kept: a `//` inside a string no longer hides code. The scan finds no photo, movie, audio, asset writer, recorder, encoder or muxer API; no photo library, file write, storage or preferences API; no network, socket or `URL(string:)`; no location, and no fully-qualified `java.io`/`java.net`/`android.location`/`android.media`/`okhttp3` use. Swift imports are limited to the eight reviewed frameworks and Kotlin imports are pinned exactly. The SDK telemetry is disclosed in the types, the podspec and `build.gradle`, and datatransport is **not** excluded. Exactly one camera input and one data output. Permission: video/CAMERA only. The model comes from the app's own assets. The new app files have no storage, network or Firestore. Only `.native` files import the module at runtime. |

Eleven hand mutants of the adapter, controller, support probe and overlay were run (no ns division, no duplicate drop, no out-of-order drop, no unmirroring, invented visibility, no people cap, no run-token check, no late-permission check, AppState pausing during the permission prompt, support always true, overlay not mirrored). **All eleven were caught** by this suite. Eight more for the #638 review fixes were all caught: gate approved, gate ignored, handlePose without catch, no AppState re-check on grant, native `playback` passed through, unit guessed, the old comment `strip()`, an extra `.m` file in the module.

Also run here: `npx tsc --noEmit` is clean. `npx expo export --platform ios` and `--platform android` exit 0 with the module absent. The native bundles contain the native controller and preview and **none** of the web controller (`OverconstrainedError`), the synthetic hook (`__WSF_TEST_POSE__`) or the web engine (`FilesetResolver`, `vision_bundle`). `--platform web` exits 0. Re-run after the #638 review fixes: all three exports exit 0; the iOS and Android bundles contain `WsfPoseCamera`, `requestCameraPermissionAsync` and `NATIVE_CAMERA_TELEMETRY_APPROVED`; the web bundle contains none of them (0 matches each) and still contains the web engine.

### Checks of the native code that were possible without compiling it

- **Autolinking:** `npx expo-modules-autolinking resolve -p apple|android` finds `wsf-pose-camera`:
  - pod `WsfPoseCamera` at the module root, Swift module `WsfPoseCamera`, `WsfPoseCameraModule`;
  - Android project `android/`, module `expo.modules.wsfposecamera.WsfPoseCameraModule`.
- **Podspec:** loaded and linted with cocoapods-core 1.16.2 (`Pod::Specification::Linter`): **passes**. The one warning left is the expected "git source without a tag" of a local pod.
- **Kotlin:** superseded by the real compile in "Compile and contract evidence" below.
- **Swift:** all four files parse with **no syntax errors** under the tree-sitter-swift 0.7.1 grammar. The checker was confirmed to flag a deliberately broken file.
  - That grammar cannot parse member-level `#if` blocks or `nonisolated(unsafe)`: it also rejects expo-modules-core's own `AppContext.swift`.
  - So since the review fixes, each file is parsed after keeping only the branch a Swift 6 (Xcode 16) compiler takes.
  - **Type-check and compile: UNVERIFIED.**
- **MediaPipe API names** were read from source at tag `v0.10.35`:
  - iOS headers: `PoseLandmarkerOptions` (`numPoses`, `min*Confidence`, `shouldOutputSegmentationMasks`), `BaseOptions.delegate` (`Delegate.CPU/.GPU`), `RunningMode.video`, `MPImage(sampleBuffer:orientation:)`, `detect(videoFrame:timestampInMilliseconds:)`, `NormalizedLandmark.visibility: NSNumber?`.
  - Android Java: `PoseLandmarkerOptions.builder()…setOutputSegmentationMasks`, `BaseOptions.setModelAssetBuffer`/`setDelegate`, `detectForVideo(MPImage, long)`, `NormalizedLandmark.visibility(): Optional<Float>`. These are identical at `v0.10.26`.
  - Android `setModelAssetBuffer` is copied with `ByteString.copyFrom`. MediaPipe 0.10.35 `TaskOptions` rewinds the buffer itself before copying, so the code's own rewind before each delegate attempt is redundant but harmless (correction from review F8).

## Compile and contract evidence (evidence pass, on top of `abe84f45`)

Everything below is reproducible with `docs/westayfit/qa/camera-evidence/run-kotlin-jvm.sh`. It uses only Maven Central jars (kotlin-compiler 2.1.20, Robolectric `android-all` 14-robolectric-10818077, kotlin-reflect, kotlinx-coroutines, fbjni). Each jar is sha256-pinned in the script, and its sha1 was cross-checked against Maven Central's own `.sha1`.

**1. The Android pure contract is compiled and RUN on the JVM.**
- Every Android computation that needs no CameraX, MediaPipe or Expo type now lives in `android/src/main/java/expo/modules/wsfposecamera/WsfPoseContract.kt` (`java.*`/`kotlin.*` imports only). Behaviour is unchanged. It holds:
  - the ns→ms `WsfFrameClock`, which drops a frame whose ms is not after the last one, before inference;
  - landmark flattening (missing visibility → -1);
  - the 3-person cap;
  - the `onPose` payload and the mirrored flag;
  - the engine id;
  - the model sha256 check and the direct `ByteBuffer`;
  - the `applyProps` run decision.
- `WsfPoseRun`, `WsfPoseModel` and `WsfPoseCameraView` now only adapt CameraX, MediaPipe and Expo types to it.
- `android/src/test/.../WsfPoseContractTest.kt` is a framework-free JVM runner. Log excerpt:

```
info: kotlinc-jvm 2.1.20 (JRE 21.0.12.1+1-1-24.04.4-Ubuntu)
PASS nsToMs truncates nanoseconds to whole milliseconds
PASS frame clock: the first frame is taken; repeated, same-ms and older frames are dropped, never re-timed
PASS flatten: x, y are MediaPipe's Floats widened to Double; a missing visibility is -1
PASS people: at most MAX_POSES (3) in MediaPipe's order; nobody gives an empty list
PASS posePayload: exactly the keys and types the JS contract reads
PASS sha256: the FIPS 180-2 'abc' vector, and the bundled model is the pinned web model
PASS verifiedModelBuffer: a direct buffer at position 0 with the whole model; any other bytes are refused
PASS run decision: open only while active with a positive runId; a new runId restarts; inactive stops
PASS run decision: a run that stopped itself (error, detach) is never reopened under the same id
PASS MEDIAPIPE_VERSION equals build.gradle mediapipeTasksVisionVersion
PASS contract fixture: the recorded stream -> the onPose events Android would send
kotlin-jvm: 13 passed, 0 failed
  android-emitted.json reproduced byte for byte (fa6f1aba1b16be99...)
```

**2. Every module file compiled against the real Android framework and the real expo-modules-core sources (no stubs).**
- Inputs: `android-all` API 34 plus `node_modules/expo-modules-core/android/src/{main/java,withoutCompose}` as source roots.
- `WsfPoseCameraModule.kt` (the Expo DSL: `Module`, `View`, `Prop`, `Events`, `OnViewDidUpdateProps`, `OnViewDestroys`, `AsyncFunction` with `Promise`, `Permissions` overloads) and `WsfPoseContract.kt` have **0 errors**.
- The other three files have 115 errors after the review fixes (92 before). **Every one** is either:
  - an unresolved reference into `androidx.camera.*` (now including `CameraState`), `androidx.lifecycle.*` (`LifecycleOwner`, `LiveData`, `Observer`) or `com.google.mediapipe.*` (Google Maven, unreachable here); or
  - a cascade on a value of such a type (`cannot infer type`, or a member of `PreviewView`, `ImageProxy`, `ProcessCameraProvider`, `UseCase`, `LiveData`, `CameraState`, `PoseLandmarker` or `NormalizedLandmark`).
- The new framework calls resolve against android-all API 34 with no error: `Activity.setRecentsScreenshotEnabled`, `Build.VERSION_CODES.TIRAMISU` and `View.onWindowFocusChanged`.
- No React Native, Expo or Android-framework symbol is unresolved in module files.
- The script fails if the Module or Contract file gains an error, or if any other import goes unresolved.
- The 1144 errors inside expo-modules-core itself come from React Native and AndroidX jars being absent. They are not ours.

```
  errors in module files: 115
    WsfPoseCameraModule.kt       0
    WsfPoseCameraView.kt         13
    WsfPoseContract.kt           0
    WsfPoseModel.kt              21
    WsfPoseRun.kt                81
  OK: WsfPoseCameraModule.kt and WsfPoseContract.kt compile clean; unresolved imports are only androidx.camera / androidx.lifecycle / com.google.mediapipe
```

**3. The Kotlin emitter and the JS adapter agree** (`tests/move-camera-native-contract.test.ts`).
- One deterministic, recorded-format stream: `tests/fixtures/native-camera/landmark-stream.json`. It is synthetic float32 data, **not a camera recording**, with:
  - 334 frames, including 19 injected repeated, same-ms or older frames;
  - missing visibility;
  - nobody in frame;
  - four people.
- The JVM run of the real `WsfFrameClock` + `WsfPoseContract` writes `android-emitted.json` (315 events, hash-linked to the input).
- The test asserts:
  - the Kotlin events equal the contract's events exactly;
  - the Kotlin events, through `nativeEngine.ts`, give PoseFrames **identical** to the web `mapPerson` normalisation of the same stream;
  - both drive the real frozen session to identical snapshots (GO at 1.5 s, then set 3).

**4. iOS:** no Swift compiler is reachable. `docs/westayfit/qa/camera-evidence/ios-api-crosscheck.md` cites, for every MediaPipe, Expo, AVFoundation, CoreMedia, CoreVideo, Foundation and CryptoKit call, the exact declaration line and the rule that gives its Swift spelling.
- Sources: MediaPipe v0.10.35 headers and BUILD, expo-modules-core 3.0.30, and iOS 18.0 SDK headers from the third-party `xybp888/iOS-SDKs` mirror.
- It confirms `import MediaPipeTasksVision` exposes every header used.
- The AVCaptureSession notification constants are spelled differently by SDK generation:
  - iOS 18 SDK: `AVCaptureSession.wasInterruptedNotification` / `.runtimeErrorNotification` (NS_SWIFT_NAME).
  - Older: `NSNotification.Name.AVCaptureSessionWasInterrupted` / `.AVCaptureSessionRuntimeError`. The iOS 18 AVFoundation overlay still declares these as deprecated aliases `introduced: 4.0`, which corrects the earlier "no alias" note.
- Since review IOS-3 the code uses the SDK constants: the new names under `#if compiler(>=6.0)` and the old names otherwise, plus the `AVCaptureSessionInterruptionReasonKey` / `AVCaptureSessionErrorKey` globals. No hand-typed strings remain.
- Still UNVERIFIED: the swift-foundation `Data(contentsOf:options:)`.

**5. Merge and config assertion.**
- `origin/claude/wsf-native-build-1` was merged at `9e9dc2ca` (one commit past `426ab227`). It brought a reworded `NSCameraUsageDescription`, more `blockedPermissions` and `app.config.js`.
- The privacy test now checks the **meaning**:
  - CAMERA is requested, RECORD_AUDIO is blocked, and no audio permission is requested;
  - there is no `NSMicrophoneUsageDescription`;
  - the camera string says it counts on this device, and its "recorded" sentence is a negation that covers upload.

## MediaPipe SDK usage telemetry — BLOCKING, owner decision required

**What the review found** (#638 finding 1 / F1, confirmed twice by adversarial verification). The binaries were inspected through their NuGet repackages, because dl.google.com is blocked:
- **iOS:** `MediaPipeTasksCommon` 0.10.35 links `ClearcutLoggingClient` and POSTs to `play.googleapis.com/log`.
- **Android:**
  - `tasks-vision` 0.10.29 (and 0.10.35) depends on `tasks-core`, which pulls `com.google.android.datatransport` (`transport-api`, `transport-backend-cct`, `transport-runtime`).
  - The merged manifest gains `ACCESS_NETWORK_STATE`, a `JobInfoSchedulerService` JobService, an `AlarmManagerSchedulerBroadcastReceiver` and `TransportBackendDiscovery`.
  - `TaskRunner` builds a stats logger whose `RemoteLoggingClient` sends through DataTransport. It queues locally and uploads later.
- **What is sent** whenever a pose landmarker is created and while it runs: task name, running mode, app id (bundle id / package name), app version, OS version, frame counts and latencies.
- **What is not sent:** camera frames, images or landmarks. No footage leaves the device.
- The **web** package 0.10.35 has no logger. That is why the Director pinned web to 0.10.35 (`engine.ts`). That reasoning does **not** carry over to the native SDKs.

**What this branch does until the owner decides.**
- **Fail closed.** `support.native.ts` has `export const NATIVE_CAMERA_TELEMETRY_APPROVED: boolean = false`, commented with the reason and this review. `cameraCounterSupported()` returns `nativeCameraCounterAllowed(NATIVE_CAMERA_TELEMETRY_APPROVED)`, so it is false on every native build and members see only the manual squat flow. Tests cover both states of the gate.
- The module code, the parity tests and the contract evidence all stay. A device test needs a reviewed dev-only change that sets the constant to `true`.
- **Disclosure.** The privacy claims in `src/WsfPoseCamera.types.ts`, `WsfPoseCamera.podspec`, `android/build.gradle`, the Swift/Kotlin run headers and `controller.native.ts` now say what is true:
  - the module's own code records, stores and sends nothing;
  - the MediaPipe SDK sends the usage telemetry above.
  - The PR body needs the same correction (wording in the reply to the integrator; GitHub is not edited from here).
- **Not done, on purpose:** `exclude group: 'com.google.android.datatransport'`. `RemoteLoggingClient` would then throw `NoClassDefFoundError` at landmarker creation. A test forbids the exclude.
- **No user-facing copy was written.** The `NSCameraUsageDescription` in `app.json` belongs to NATIVE-BUILD-1 and is unchanged. It reads "No video or photos are recorded, saved or uploaded": true for media, silent on the SDK's usage telemetry. **Flagged** for the owner and BUILD-1. If option A is chosen, it and any member copy ("nothing is recorded") need an owner-approved review.

**Options for the owner.**
- **A. Accept and disclose.**
  - Keep the SDKs and set the gate to `true` in a reviewed change.
  - Disclose in the App Store privacy label (usage / diagnostics data linked to the app id) and the Play data-safety form (app interactions / diagnostics; collected; not shared).
  - Review the camera purpose string and member copy.
  - Change proof step 10 to: "only MediaPipe's Clearcut / DataTransport calls appear, with no image or landmark payloads".
- **B. Reject.**
  - Keep the gate `false` until telemetry-free binaries exist: MediaPipe Tasks built from source, where `CreateTasksLogger` / `TasksStatsLoggerFactory` return the dummy logger by default.
  - Vendor them with pinned hashes, and re-review.
  - Alternatives the review lists, each a larger change: strip the datatransport components from the merged manifest plus a 24 h device capture; or run the `.tflite` models directly on LiteRT.

**First EAS build checks (record the output in this file).**
- Android: `./gradlew :app:dependencies --configuration releaseRuntimeClasspath | grep datatransport` (expect `transport-api` / `transport-backend-cct` / `transport-runtime` under `tasks-core`).
- Android: inspect the merged manifest (`app/build/intermediates/merged_manifests/*/AndroidManifest.xml`) for `ACCESS_NETWORK_STATE`, `JobInfoSchedulerService`, `AlarmManagerSchedulerBroadcastReceiver` and `TransportBackendDiscovery`.
- Android: `javap -c` on `TasksStatsLoggerFactory` inside `tasks-core-0.10.29.aar`. If it returns `TasksStatsDummyLogger`, this finding drops to a wording fix.
- iOS: `nm -m` on `Pods/MediaPipeTasksCommon/frameworks/MediaPipeTasksCommon.xcframework/ios-arm64/…` and on the graph library; look for `ClearcutLoggingClient`.
- **Informational (privacy-8):** the iOS `MediaPipeTasksCommon` binary also links `MPPAudioRecord` / `AVAudioSession` (`AVAudioSessionCategoryPlayAndRecord`). This module never calls it.
  - There is no `NSMicrophoneUsageDescription`, so any microphone access would crash rather than record; Android `RECORD_AUDIO` stays blocked.
  - At the first TestFlight upload, record any ITMS-90683 "missing purpose string" warning. Do **not** add a microphone string to silence it without owner review.

## MediaPipe versions chosen, with evidence

| Platform | Version | Evidence |
|---|---|---|
| Web (unchanged) | `@mediapipe/tasks-vision` 0.10.35 | `engine.ts`, the existing pin test. |
| iOS | `MediaPipeTasksVision` **0.10.35** (iOS ≥ 15.0, static xcframework, depends on `MediaPipeTasksCommon` 0.10.35) | The CocoaPods CDN index lists 0.10.35 for both pods. The trunk podspec (`CocoaPods/Specs` `Specs/9/9/0/MediaPipeTasksVision/0.10.35`) points to the `dl.google.com/cpdc/20260427-204221/MediaPipeTasksVision-0.10.35.tar.gz` release. The git tag `v0.10.35` exists (`f8ef212d`). |
| Android | `com.google.mediapipe:tasks-vision` **0.10.29** | **0.10.35 on Google Maven is UNVERIFIED**: dl.google.com is blocked here, and Maven Central does not host the group. Indirect signs that it exists: the same-release git tag and CocoaPods pods, and `react-native-pose-detection@0.2.2` (npm, 2026-09-28), which pins `tasks-vision:0.10.35`. Following the brief, the **nearest confirmed** version is used: **0.10.29**. Google's own `mediapipe-samples` pose_landmarker Android app built against it (commit `1daf138`, 2025-09-25 "Update all examples to 0.10.29", until `23a32e8` moved to 1.0.0 on 2026-08-04). Git tags 0.10.27–0.10.31 do not exist; the API used is identical at the neighbouring tags v0.10.26 and v0.10.35. Moving to 0.10.35 is one line in `android/build.gradle` plus `WsfPoseContract.MEDIAPIPE_VERSION`; a test keeps the two in step.
- Review F8 found stronger indirect evidence: a Gradle-generated dependency tree in `stripe/stripe-android` resolves `tasks-vision:0.10.35` and `tasks-core:0.10.35`, and about 74 public build files pin it. Direct presence is still unverifiable here.
- Moving to 0.10.35 does **not** remove the telemetry: its core carries the same datatransport dependencies. |
| CameraX (Android) | 1.4.2 (core, camera2, lifecycle, view) | The version Google's pose sample uses. Resolution from Google Maven is UNVERIFIED here for the same reason. |

**Consequence to know:** until Android moves to 0.10.35, Android runs a different MediaPipe release from web and iOS, with the same model file and settings. Proof plan item 9 (parity) must be read with that in mind.

## Model

- `pose_landmarker_lite.task`, 5,777,746 bytes.
- **sha256 `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`.**
- md5 `04a75ddf7c811ac7a1a4523266dd7d88`, which equals the GCS object metadata (ETag and `x-goog-hash`) of web's `MODEL_URL` when downloaded. It is a zip holding `pose_detector.tflite` and `pose_landmarks_detector.tflite`.

## UNCOMPILED / UNVERIFIED (nothing below has run)

- **UNCOMPILED:**
  - Every Swift file.
  - The podspec and `build.gradle`.
  - `WsfPoseCameraView.kt`, `WsfPoseModel.kt` and `WsfPoseRun.kt` in a real Android build.
  - Partly done: `WsfPoseContract.kt` (plus its JVM test) is compiled and run on the JVM, and `WsfPoseCameraModule.kt` type-checks clean (see the evidence section).
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
- **UNVERIFIED, review fixes that need a device to judge:**
  - **App-switcher snapshot.** iOS hides the preview layer on `willResignActive`. Android hides the `PreviewView` on window-focus loss, and on API 33+ disables the Recents screenshot while a run is open. Check the switcher / Recents thumbnail mid-set.
  - **CameraX camera-state errors** (in use → paused; critical → failure). Check with another app holding the camera.
  - **The shared iOS session queue.** Finish then Start, 10× in a row: every time `onCameraReady`, with no error or interruption.
- **Left open:**
  - **IOS-2 iPad orientation.** The fix is an `app.json` change (NATIVE-BUILD-1's file) or a RotationCoordinator, which needs a device. Fails closed (a sideways stream never becomes ready).
  - **F5/IOS-5 CPU retry when the GPU fails at detect.** Optional; fails closed today.
  - **Real-device telemetry behaviour** (the blocking item above).
- **Not claimed:** camera accuracy, count accuracy, or any device behaviour.

## First-compile risks to check in the EAS development build

iOS (`eas build --profile development --platform ios`, then the pod install and Xcode logs):

1. `pod install` resolves `MediaPipeTasksVision 0.10.35` and `MediaPipeTasksCommon 0.10.35`, downloaded from dl.google.com. `WsfPoseCamera` is a `static_framework`; check for "transitive static library" errors.
2. Link: MediaPipe's graph registration needs its own `-force_load` flags, which its podspec supplies. If they are lost, the app builds but the landmarker fails at runtime with "No registered object with name: …PoseLandmarkerGraph". In the app that shows as the `model` failure panel.
3. Swift: `import MediaPipeTasksVision` from a Swift static pod. Check that `Delegate`, `BaseOptions.delegate`, `shouldOutputSegmentationMasks`, `MPImage(sampleBuffer:orientation:)` and `detect(videoFrame:timestampInMilliseconds:)` resolve (Swift names read from the 0.10.35 headers).
4. `ExpoView` (`ExpoFabricView` under the new architecture) subclass: `required init(appContext:)` only, and `EventDispatcher` properties named exactly as `Events(...)`.
5. `AVCaptureConnection.videoRotationAngle` / `isVideoRotationAngleSupported` need the iOS 17 SDK (Xcode 15+). The `videoOrientation` fallback gives deprecation warnings only.
6. The resource bundle `WsfPoseCameraModel.bundle` must be in the app bundle. Otherwise `WsfPoseModel.modelPath()` throws `modelMissing` (shown as the `model` failure). Xcode 14+ resource-bundle signing needs CocoaPods ≥ 1.12.
7. Swift language mode 5.9 under the Xcode 16 compiler: concurrency warnings are possible, not errors. `nonisolated(unsafe) private var run` (review IOS-7) is guarded by `#if compiler(>=5.10)`.
8. Review fixes to compile-check:
   - the static shared `sessionQueue`;
   - `AVCaptureSession.wasInterruptedNotification` / `.runtimeErrorNotification` under `#if compiler(>=6.0)`;
   - `UIApplication.willResignActiveNotification` / `didBecomeActiveNotification` selector observers;
   - `CATransaction.setDisableActions`.
9. **Telemetry check:** `nm -m` on `MediaPipeTasksCommon` for `ClearcutLoggingClient` (see the BLOCKING section).

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
6. A release (preview profile) build with minify on keeps MediaPipe and Flogger classes through `consumerProguardFiles` (Flogger added for review F9: MediaPipe's `Graph` static initializer fails under R8 renaming without it).
7. **Telemetry checks** (see the BLOCKING section): the `datatransport` dependency grep and the merged-manifest inspection.
8. **16 KB pages (review F7):** `zipalign -c -P 16 -v 4 app.apk`, or `llvm-readelf -l lib/arm64-v8a/libmediapipe_tasks_vision_jni.so | grep LOAD` (Align must be `0x4000`).
   - MediaPipe added `max-page-size=16384` between v0.10.26 and v0.10.32, so 0.10.29's alignment is unknown.
   - If it is 4 KB-aligned, move to 0.10.35; its JNI library is renamed `libmediapipe_tasks_jni.so`, which is internal to the AAR.
   - Also check CameraX's `libimage_processing_util_jni.so`.
9. Review fixes to compile-check: the `CameraState` `LiveData` observer and its removal; `Activity.setRecentsScreenshotEnabled` (API 33, guarded); `MPImage.close()` / `Bitmap.recycle()`.

JS (both): the bundle already exports with the module absent. With the telemetry gate `false`, `cameraCounterSupported()` must stay **false on every build**, the dev client included. Only a reviewed dev-only change that sets `NATIVE_CAMERA_TELEMETRY_APPROVED = true` makes it true, and then only where the module is linked; in Expo Go it must stay false.

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
10. **Privacy.** This step cannot pass as "no requests": the SDKs send usage telemetry.
    - With a network inspector (and, on Android, `adb shell dumpsys jobscheduler | grep datatransport`, because DataTransport uploads later through JobScheduler), the only traffic is MediaPipe's:
      - iOS: Clearcut to `play.googleapis.com/log`;
      - Android: DataTransport to the Firelog / `firebaselogging*.googleapis.com` endpoints.
    - No request carries image or landmark payloads. Any other request fails the step.
    - Under option B the expectation is none at all.
    - The app container does not grow over a session, apart from DataTransport's local event queue on Android (record its size).
    - The static scan here passes.

## Review of #638 (PASS WITH REQUIRED CHANGES @ `abe84f45`): fixes applied

| Finding | Status |
|---|---|
| **1 / F1 (blocking): MediaPipe SDK usage telemetry** | **Gated and disclosed.** `NATIVE_CAMERA_TELEMETRY_APPROVED = false` (both states tested). Disclosure in types / podspec / gradle / headers / QA. datatransport deliberately not excluded (tested). First-build checks and options A/B recorded. The owner decision is pending. |
| Frozen-lens 1: AppState not re-checked when the permission answer arrives | **Fixed.** A grant while away opens the camera only on the next `active` (tested). |
| Frozen-lens 2: a throw in handlePose escapes | **Fixed.** It fails the run with `inference`: released, manual entry (tested). |
| Frozen-lens 3: build-time opt-in before member builds | **Superseded** by the telemetry gate, which is stricter: no native build opens the camera until a reviewed approval. |
| Frozen-lens 4: parity outcome compares only counts | **Fixed.** Keypoints, aspect and guidance are compared too. |
| Frozen-lens 5: native `playback` shows the browser tap panel | **Fixed.** It maps to the generic "Camera isn't available" (tested). |
| Frozen-lens 6: the unit is guessed when missing | **Fixed.** `timestampUnit` is required in the contract; a missing unit is dropped (tested). |
| Privacy-2: the scan misses .m/.mm/.h/.java/manifest | **Fixed.** Exact module file list, no `AndroidManifest.xml`, all source kinds scanned. |
| Privacy-3: equivalent recording / network / location APIs | **Fixed.** Extended list, FQN regex, pinned Swift and Kotlin imports. |
| Privacy-4: `strip()` treats `//` in strings as a comment | **Fixed.** Only comment-only lines and block comments are removed (tested with `"a//b"`). |
| Privacy-5: app-switcher snapshot | **Fixed in code, device check open.** iOS hides on resign-active; Android hides on focus loss and disables the Recents screenshot on API 33+. |
| Privacy-6 / F2: Errors (UnsatisfiedLinkError, NoClassDefFoundError, OOM) crash Android | **Fixed.** `Throwable` caught in bind, loadModel, the GPU→CPU fallback, detectForVideo and analyze. |
| Privacy-7 / F6: per-frame bitmaps not freed | **Fixed.** `MPImage.close()` (recycles the upright bitmap) and the source bitmap recycled after rotation. |
| Privacy-8: MPPAudioRecord / AssetsLibrary linked (informational) | **Recorded** (ITMS-90683 watch item). |
| F3: CameraX camera-state errors unobserved | **Fixed in code, device check open.** In use → `onCameraInterrupted`; critical → `onCameraError('ended')`. The observer is removed on stop. |
| F4: a stopped runId can reopen | **Fixed on Android and on iOS.** `startedRunId`; the pure `runChange` is JVM-tested. |
| F5 / IOS-5: no CPU retry when the GPU fails at detect | **Left open (optional).** Fails closed; needs a device without GPU support to judge. |
| F7: 16 KB alignment of 0.10.29 | **Doc**: first-build check. |
| F8: 0.10.35 existence; the rewind note | **Doc**: evidence recorded; rewind wording corrected (comment and QA). |
| F9: R8 + Flogger | **Fixed.** Keep rules added. |
| IOS-1: per-run session queues can overlap | **Fixed.** One static serial session queue. |
| IOS-2: iPad landscape / long-edge cameras | **Left open.** It needs `app.json` (NATIVE-BUILD-1) or a RotationCoordinator plus a device. It fails closed. |
| IOS-3: hand-typed notification strings | **Fixed.** SDK constants (new names under Swift 6, old names otherwise; the keys are SDK globals). |
| IOS-4: force-load / link risk | **Doc** (first-build check, unchanged). |
| IOS-6: preset before input | **Fixed.** The preset is set after `addInput`. |
| IOS-7: deinit isolation warning | **Fixed.** `nonisolated(unsafe)` behind `#if compiler(>=5.10)`. |
| Web-1: the web bundle is not byte-identical | **Wording**: the web bundle is behaviour-identical. One 1-line null stub module (`NativeCameraPreview`) is added to the lazy camera chunk (+161 B); content hashes change. |
| Web-2: stale web comments | **Fixed** (comment-only). |
| Web-3: no compile-time API check | **Fixed.** A tsc-checked `Pick<WebController, …>` assignment and a preview-props equality. |
| Web-4: playwright-config test flake under load | **Not this lane's file.** The full run uses `--testTimeout=30000`. |
| Web-5: e2e not run | **Open.** Run `npm run test:e2e -- move-camera-counter.spec.ts` against the emulator build before merge. |

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
npx vitest run tests/move-camera-native-adapter.test.ts     # 61 tests
npx vitest run --testTimeout=30000                          # 68 files, 1361 tests (after the #638 review fixes)
npx vitest run tests/move-camera-native-contract.test.ts    # 6 tests: Kotlin <-> JS contract
docs/westayfit/qa/camera-evidence/run-kotlin-jvm.sh         # from the repo root; Kotlin JVM tests + module compile report
npx expo export --platform ios --output-dir /tmp/exp-ios
npx expo export --platform android --output-dir /tmp/exp-android
npx expo-modules-autolinking resolve -p apple --json        # wsf-pose-camera → pod WsfPoseCamera
npx expo-modules-autolinking resolve -p android --json      # wsf-pose-camera → expo.modules.wsfposecamera.WsfPoseCameraModule
```
