# NATIVE-CAMERA-1 — native squat camera adapter (iOS/Android), QA record

Branch `claude/wsf-native-camera-1`. PR base: `claude/wsf-native-build-1` @ `9e9dc2ca` (NATIVE-BUILD-1), merged into this branch at `7411c47b` (parents `ef44fed2`, `9e9dc2ca`). The branch was first cut from `5a968141`.
Design source: the camera-lane research report (local Expo module `modules/wsf-pose-camera`, MediaPipe Tasks PoseLandmarker in the web engine's mode and settings, raw landmarks into the existing `mapPerson` → `RepCounterOrchestrator`, frozen counter unchanged).

> **BLOCKING, owner decision required: the native MediaPipe SDKs carry Google usage telemetry.** Independent review of #638 (finding 1 / F1) found it. Until the owner decides, the native counter is **OFF**: `src/movement-camera/nativeCameraGate.ts` has `NATIVE_CAMERA_TELEMETRY_APPROVED = false`, so `cameraCounterSupported()` is false on every native build and members see only the manual flow (Settings does not show Camera rep counter there either); `controller.native.ts` also refuses to ask for the camera while it is false. The delta review (PASS @ `3edaf5f5`) proved the gate from source and binaries and completed the Android disclosure; the second delta review (PASS @ `0ef0483e`) left four non-blocking items, applied below. See "MediaPipe SDK usage telemetry" below.
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
| Controller | `src/movement-camera/controller.native.ts` | Same public API as `controller.ts` (`snapshot`, `subscribe`, `startCamera`, `stopCamera`, `beginSet`, `finishSet`, `dispose`, `REQUESTED_CAMERA`). Run token per start. Permission is requested before the camera opens. The binding goes inactive on Stop, pause, failure and dispose. Pauses on `AppState` leaving `active` and on a native interruption, except while the OS permission prompt is up (the iOS alert makes the app `inactive`; the Android dialog pauses the activity). Read-only `frameStats` support a dev HUD. **Defence in depth:** `startCamera` refuses (`unsupported`, manual entry) while the telemetry gate is off. A listener that throws never escapes a native event handler (the run fails closed), and 30 rejected frames in a row (`MAX_INVALID_STREAK`, e.g. no `timestampUnit`) fail the run instead of a silent "live". |
| Support probe | `src/movement-camera/support.native.ts` (+ the one-constant `nativeCameraGate.ts`) | **Telemetry gate first:** `cameraCounterSupported()` is false while `NATIVE_CAMERA_TELEMETRY_APPROVED` (`nativeCameraGate.ts`, re-exported here) is `false`, which it is. Flipping it is a reviewed privacy decision. After approval it is true **only** on iOS/Android when `requireOptionalNativeModule('WsfPoseCamera')` returns a module with `requestCameraPermissionAsync`. Expo Go, web and older binaries get false. Whenever it is false the member stays on the manual flow (fail closed). Synthetic hooks return null on native. |
| Overlay | `src/ui/CameraSkeletonOverlay.native.tsx` | react-native-svg 15.12.1. Same `figureGeometry` as web (both arms, torso, legs, head **ring**). Same viewBox, `xMidYMid slice`. Mirrored with `scaleX(-1)` for display only. |
| Preview slot | `src/ui/NativeCameraPreview.native.tsx` (+ `NativeCameraPreview.tsx`, a web stub that renders null) and a 2-line edit in `src/ui/CameraRepCounter.tsx` | The native view, full-bleed, bound to the controller's `{active, runId}`. Every native event goes back to the controller. The web `<video>` branch is unchanged. |

**Settings (CAM-02, second delta review NB-4):** `src/movement-camera/MoveCameraSettingsSection.tsx` (a camera-lane file, map §5.4) now draws the MOVE section on iOS/Android only when `cameraCounterSupported()` is true (`moveCameraSettingsShown`; `./support` resolves to `support.native.ts` there). With the gate off, native Settings shows no Camera rep counter. The stored values are kept. Web is unchanged: it always draws the section and never consults support. `app/settings.tsx` is not edited. The map's other C-2 items (INT-31 knob elevation, MF-18 describedby) are not in this change; on native the section is hidden until support ships.

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

Baseline before this change: **66 files, 1288 tests**. At `abe84f45`: **67 files, 1339 tests**. After the evidence pass and the NATIVE-BUILD-1 merge: **68 files, 1351 tests**. After the #638 review fixes: **68 files, 1361 tests**. After the delta-review follow-ups: **68 files, 1369 tests**. After the second delta review's items: **68 files, 1371 tests**, all passing (`npx vitest run --testTimeout=60000`). This lane's suites:
- `tests/move-camera-native-adapter.test.ts`: 70 tests (68 after the delta-review follow-ups, 61 after the #638 review fixes, 51 before them);
- `tests/move-camera-native-contract.test.ts`: 7 tests (the new one ties the Kotlin output to the current Kotlin sources).

The merged NATIVE-BUILD-1 commits brought the rest. The adapter suite covers:

| Area | Tests |
|---|---|
| Pure adapter | Same `mapPerson` output as web. Aspect. ns→ms. The ns guard. Invalid events. Duplicate and out-of-order drop. Unmirroring. Visibility always present (missing → 0). Empty frames kept. Cap at 3. Malformed people skipped. Gate statistics. |
| Parity through the **real** frozen session (`makeSessionR1421`) | iOS-ms and Android-ns event streams give frame-for-frame identical orchestrator outcomes to the web path. The outcomes compared include keypoint coordinates, aspect and guidance, not just counts (review finding 4). The standard set gives raw 4 / set 3. Lab scene with a bystander behind and one squatting at the edge: native = web, and bystanders add nothing. Tracking loss: empty frames delivered, count held, "Step back into view.", counting resumes. 15 fps still counts every rep. A 400 ms hole mid-rep voids that rep. Injected duplicate and older frames never void a rep. Orientation: an upright stream becomes ready; a sideways (un-rotated) stream never becomes ready and counts 0. Mirroring: the member's right wrist is at smaller x. |
| `controller.native` | Public-API parity with `controller.ts`. Full flow: permission → bound for run 1 → ready → GO → 3 → Finish → released. Events of other runs ignored. A permission answer after Stop opens nothing. Denied, throwing or missing module → failure panel. Native error stages mapped. AppState `inactive`/`background` and native interruptions pause and keep banked reps. The OS permission prompt (iOS `inactive`, Android `background`) does not pause the run it is asking for. A grant that lands while the app is away opens the camera only on the next `active`. A throw while counting or rendering fails the run closed (released, manual entry); a listener that throws on every snapshot never escapes a native handler and other listeners still hear the failure. A listener that throws on `starting` fails the run before the OS is asked for the camera (no permission request; the next start asks once). 30 invalid frames in a row fail the run; an accepted frame resets the streak and duplicates never count. With the telemetry gate off, `startCamera` never asks for the camera (`unsupported`). Native `playback` maps to the generic "Camera isn't available" panel. No start in the background. `frameStats`. tsc holds the native controller and preview to the web surface the camera screen uses. |
| `support.native` | **The telemetry gate:** the real constant is `false`. With `Platform.OS` set to `ios` and to `android` and `requireOptionalNativeModule` returning the linked module (positive control: `nativePoseCameraLinked()` is true), the wired `cameraCounterSupported()` is false with the gate off (the real constant, and `false`) and true only with it on; approved without the module is false. The gate is driven through a test-only module mock of `nativeCameraGate.ts`; production has no seam. The contribute screen is pinned to take `supported` only from `useState(() => cameraCounterSupported())` and to mount `<CameraRepCounter>` only inside `if (cameraOpen)`. The pure `nativeCameraCounterAllowed` covers the remaining cases (approved + not linked, or on web → false). The constant states its reason. With the gate open, true only with the linked module on iOS/Android; Expo Go, older binaries, web and a throwing probe → false. Uses `requireOptionalNativeModule('WsfPoseCamera')`. Stays import-light. **Settings (CAM-02):** with `Platform.OS` `ios` and `android` and the linked module, `moveCameraSettingsShown(os, cameraCounterSupported)` is false with the gate off and true with it on; web is true without consulting support; the component renders nothing off web when unsupported and both switches on web (jsdom has no `getUserMedia`); its wiring to `./support` is pinned. |
| Overlay / preview | react-native-svg rendering: 2 layers × 8 lines, head ring (`fill: none`, r 26–150), both arms drawn at the unmirrored data x, `scaleX(-1)` and `pointer-events: none` on the wrapper. The preview opens the native view only while the binding is active, for that run, and routes events. It renders nothing for a non-native controller. `CameraRepCounter` native slot. |
| Model | sha256 pinned. Size and GCS md5 match `MODEL_URL`'s object. Task bundle contents. One copy, wired into the podspec and gradle. Swift and Kotlin carry the same pin. |
| Native sources (static) | Every native file starts with the UNCOMPILED header. Config names the real classes. Module name, props, events and permission functions match on both sides. Engine settings. Camera contract (front, upright, unmirrored, drop-before-inference, ms/ns). Versions. Dependency allowlists. |
| Privacy (static) | The module's file list is pinned exactly, so a new `.m`/`.mm`/`.h`/`.java` file or an `AndroidManifest.xml` fails the suite. Every compiled source kind is scanned (Swift, Kotlin, Java, ObjC, TS). Comments are removed by a small string-aware scanner and strings are kept: a `//`, `/*` or `*/` inside a string hides nothing, and a code line that starts with `*` is scanned (self-tests for each, delta review N3). The scanner knows each source kind's strings and follows string interpolation (Swift `\(…)`, Kotlin and Groovy `${…}`, TS template `${…}`, with nested brackets and strings), so a quote inside an interpolation cannot hide the rest of the line; escaped openers (`\${`, `\\(`) and other kinds' forms (TS `"${"`) open nothing (self-tests, second delta review NB-3). On every module and app source file its output is identical to the previous scanner's (225 files compared), so no scan result changed. Not modelled, and checked absent: Swift raw strings and regex literals (`#"`, `#/` in the Swift files); Groovy slashy and dollar-slashy strings in `build.gradle` (a `/` opener at a line start or after an operator or opening bracket, outside comments, and `$/`; self-tested on positive and negative snippets; review D1). The scan finds no photo, movie, audio, asset writer, recorder, encoder or muxer API; no photo library, file write, storage or preferences API; no network, socket or `URL(string:)`; no location, and no fully-qualified `java.io`/`java.net`/`android.location`/`android.media`/`okhttp3` use. Swift imports are limited to the eight reviewed frameworks and Kotlin imports are pinned exactly; indented, attributed (`@preconcurrency`), access-level and `;`-separated imports are caught (self-tested). The SDK telemetry is disclosed in the types, the podspec and `build.gradle`, and datatransport is **not** excluded. Exactly one camera input and one data output. Permission: video/CAMERA only. The model comes from the app's own assets. `app.json` requests exactly `['android.permission.CAMERA']` (exact equality restored, delta review N2). The new app files have no storage, network or Firestore. Only `.native` files import the module at runtime. |

Eleven hand mutants of the adapter, controller, support probe and overlay were run (no ns division, no duplicate drop, no out-of-order drop, no unmirroring, invented visibility, no people cap, no run-token check, no late-permission check, AppState pausing during the permission prompt, support always true, overlay not mirrored). **All eleven were caught** by this suite. Eight more for the #638 review fixes were all caught: gate approved, gate ignored, handlePose without catch, no AppState re-check on grant, native `playback` passed through, unit guessed, the old comment `strip()`, an extra `.m` file in the module. Nineteen more for the delta-review follow-ups were all caught: support returns true when linked (J7c), the gate constant true, support ignores the gate, startCamera without the gate, the contribute screen's `|| true` (C1), `emit()` without isolation, no invalid-streak failure, the streak not reset, a Swift `*`-continuation `URLSession` line, `@preconcurrency import Network`, an indented `import Network`, a `"/*"` string hiding `URLSession`, a Kotlin `*`-continuation `java.net` line, `app.json` gaining location and internet permissions, a Kotlin contract edit (`NO_VISIBILITY = 0.0`, caught by the source hash), an unguarded `close()` after a failed inference (A1), the GPU error dropped (A3), Recents re-enabled on stop (A2), and the iOS preview un-hidden on become-active with no run (N1). Eight more for the second delta review's items were all caught: the NB-2 guard removed; Settings always shown (NB-4); web Settings consulting support (NB-4); and, run against the self-test snippets, the previous scanner (7 of 13 snippets hidden) and four mutants of the new one: no interpolation, no escapes, no bracket depth, TS double quotes interpolating.

Also run here: `npx tsc --noEmit` is clean. `npx expo export --platform ios` and `--platform android` exit 0 with the module absent. The native bundles contain the native controller and preview and **none** of the web controller (`OverconstrainedError`), the synthetic hook (`__WSF_TEST_POSE__`) or the web engine (`FilesetResolver`, `vision_bundle`). `--platform web` exits 0. Re-run after the #638 review fixes: all three exports exit 0; the iOS and Android bundles contain `WsfPoseCamera`, `requestCameraPermissionAsync` and `NATIVE_CAMERA_TELEMETRY_APPROVED`; the web bundle contains none of them (0 matches each) and still contains the web engine. Re-run after the delta-review follow-ups: all three exit 0; the native bundles also contain `MAX_INVALID_STREAK`; the web bundle has 0 matches for `WsfPoseCamera`, `requestCameraPermissionAsync`, `NATIVE_CAMERA_TELEMETRY_APPROVED` and `MAX_INVALID_STREAK`. Re-run after the second delta review's items: all three exit 0, with the same matches; all three bundles contain the Settings section (`moveCameraSettingsShown`, "Camera rep counter"), and the native bundles still contain none of `OverconstrainedError`, `__WSF_TEST_POSE__` or `FilesetResolver`, so Settings' new `./support` import resolves to `support.native.ts` there.

### Checks of the native code that were possible without compiling it

- **Autolinking:** `npx expo-modules-autolinking resolve -p apple|android` finds `wsf-pose-camera`:
  - pod `WsfPoseCamera` at the module root, Swift module `WsfPoseCamera`, `WsfPoseCameraModule`;
  - Android project `android/`, module `expo.modules.wsfposecamera.WsfPoseCameraModule`.
- **Podspec:** loaded and linted with cocoapods-core 1.16.2 (`Pod::Specification::Linter`): **passes**. The one warning left is the expected "git source without a tag" of a local pod.
- **Kotlin:** superseded by the real compile in "Compile and contract evidence" below.
- **Swift:** all four files parse with **no syntax errors** under the tree-sitter-swift 0.7.1 grammar. The checker was confirmed to flag a deliberately broken file.
  - That grammar cannot parse member-level `#if compiler(...)` blocks or `nonisolated(unsafe)`. (It also rejects expo-modules-core 3.0.30's own `AppContext.swift`, for a different construct: its `#if` inside a getter.)
  - So `WsfPoseCameraView.swift` and `WsfPoseRun.swift` are parsed as active-branch copies: the branch a Swift 6 compiler (Xcode 16.1+ / 26) takes, with `nonisolated(unsafe)` removed. The other two parse as they are.
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
  android-emitted.json reproduced byte for byte (d9ff719af9eb431e...; since the delta review it also records the Kotlin sources' sha256)
```

**2. Every module file compiled against the real Android framework and the real expo-modules-core sources (no stubs).**
- Inputs: `android-all` API 34 plus `node_modules/expo-modules-core/android/src/{main/java,withoutCompose}` as source roots.
- `WsfPoseCameraModule.kt` (the Expo DSL: `Module`, `View`, `Prop`, `Events`, `OnViewDidUpdateProps`, `OnViewDestroys`, `AsyncFunction` with `Promise`, `Permissions` overloads) and `WsfPoseContract.kt` have **0 errors**.
- The other three files have 113 errors after the delta-review follow-ups (115 after the review fixes, 92 before). **Every one** is either:
  - an unresolved reference into `androidx.camera.*` (now including `CameraState`), `androidx.lifecycle.*` (`LifecycleOwner`, `LiveData`, `Observer`) or `com.google.mediapipe.*` (Google Maven, unreachable here); or
  - a cascade on a value of such a type (`cannot infer type`, or a member of `PreviewView`, `ImageProxy`, `ProcessCameraProvider`, `UseCase`, `LiveData`, `CameraState`, `PoseLandmarker` or `NormalizedLandmark`).
- The new framework calls resolve against android-all API 34 with no error: `Activity.setRecentsScreenshotEnabled`, `Build.VERSION_CODES.TIRAMISU`, `View.onWindowFocusChanged`, `View.onAttachedToWindow`, `View.hasWindowFocus`, and `Throwable.addSuppressed` / `LinkageError` / `VirtualMachineError` (JDK).
- No React Native, Expo or Android-framework symbol is unresolved in module files.
- The script fails if the Module or Contract file gains an error, or if any other import goes unresolved.
- The 1144 errors inside expo-modules-core itself come from React Native and AndroidX jars being absent. They are not ours.

```
  errors in module files: 113
    WsfPoseCameraModule.kt       0
    WsfPoseCameraView.kt         12
    WsfPoseContract.kt           0
    WsfPoseModel.kt              21
    WsfPoseRun.kt                80
  OK: WsfPoseCameraModule.kt and WsfPoseContract.kt compile clean; unresolved imports are only androidx.camera / androidx.lifecycle / com.google.mediapipe
```

**3. The Kotlin emitter and the JS adapter agree** (`tests/move-camera-native-contract.test.ts`).
- One deterministic, recorded-format stream: `tests/fixtures/native-camera/landmark-stream.json`. It is synthetic float32 data, **not a camera recording**, with:
  - 334 frames, including 19 injected repeated, same-ms or older frames;
  - missing visibility;
  - nobody in frame;
  - four people.
- The JVM run of the real `WsfFrameClock` + `WsfPoseContract` writes `android-emitted.json` (315 events, hash-linked to the input). Since the delta review (N5) it also records the sha256 of `WsfPoseContract.kt` and `WsfPoseContractTest.kt`, and vitest compares them with the files in the tree: an edit to the Kotlin contract fails vitest until `run-kotlin-jvm.sh --update` is re-run. The script also re-extracts `fbjni-classes.jar` from the pinned AAR every run.
- The test asserts:
  - the Kotlin events equal the contract's events exactly;
  - the Kotlin events, through `nativeEngine.ts`, give PoseFrames **identical** to the web `mapPerson` normalisation of the same stream;
  - both drive the real frozen session to identical snapshots (GO at 1.5 s, then set 3).

**4. iOS:** no Swift compiler is reachable. `docs/westayfit/qa/camera-evidence/ios-api-crosscheck.md` cites, for every MediaPipe, Expo, AVFoundation, CoreMedia, CoreVideo, Foundation and CryptoKit call, the exact declaration line and the rule that gives its Swift spelling.
- Sources: MediaPipe v0.10.35 headers and BUILD, expo-modules-core 3.0.30, and iOS 18.0 SDK headers from the third-party `xybp888/iOS-SDKs` mirror. The delta-review symbols are also cited in the iOS **26.0** SDK, which EAS uses by default for SDK 54 (see first-compile risk 7).
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

**What the review found** (#638 finding 1 / F1, confirmed twice by adversarial verification; the Android list completed by the delta review at `3edaf5f5`, finding A, from `javap` of the binaries). The binaries were inspected through their NuGet repackages, because dl.google.com is blocked.

**iOS:** `MediaPipeTasksCommon` 0.10.35 links `ClearcutLoggingClient` and POSTs to `play.googleapis.com/log` (per the delta review the logger keeps its queue in memory: `CreateTasksLogger` passes an empty log directory).
- **What MediaPipe hands its logger** (open source at v0.10.35: `MPPTaskRunner.mm:55-72`, `task_runner.cc:102-111`, `tasks_logger.h`): task name, running mode, host system and environment (iOS), iOS version, bundle id and app version (`CFBundleShortVersionString`); then session start, clone and end; CPU/GPU input, finished and dropped frame counts; total and peak latency; elapsed time; init errors.
- **What the Clearcut client adds to each request on iOS: unconfirmed (no device run, no decoded upload).** The delta review found no `UIDevice`, `sysctl`, `NSLocale` or CoreTelephony reference in the Clearcut objects. That absence is not proof that no device, locale or carrier fields are sent: nobody has run the SDK on a device or decoded an upload. Treat the iOS list above as a lower bound. The first device capture under option A must record what is actually sent.

**Android:** `tasks-vision` 0.10.29 (and 0.10.35) depends on `tasks-core`, whose `TaskRunner` builds a stats logger; its `RemoteLoggingClient` sends through `com.google.android.datatransport` (`transport-api`, `transport-backend-cct`, `transport-runtime`; log source `COREML_ON_DEVICE_SOLUTIONS`). Each event is queued on the device (SQLite) and uploaded later via JobScheduler or AlarmManager.
- **MediaPipe's own fields** (`TasksStatsProtoLogger`): package name, versionCode and platform; task (solution) name, event name and running mode; session start, clone and end with init latency; invocation counts by input type, dropped count, elapsed time, average and peak latency; error code. **MediaPipe itself does not read the OS version.**
- **DataTransport's CCT decoration** (`CctTransportBackend.decorate`, then `AndroidClientInfo` and `LogEvent`; checked in transport-backend-cct 4.0.0.5; `DefaultScheduler` decorates before it persists, so every queued MediaPipe event carries it): device model, manufacturer, hardware, device and product names, build fingerprint, OS build id and SDK version; locale and country; SIM MCC/MNC (`TelephonyManager.getSimOperator`); network type and mobile subtype; timezone offset; the app build number (`application_build`, the versionCode); the event's wall-clock and uptime timestamps.

**Both platforms:** each upload reaches Google from the device's IP address. **Not sent:** camera frames, images or landmarks. No footage leaves the device.

**Where DataTransport comes from (correction, delta review B).** DataTransport and its manifest entries (`ACCESS_NETWORK_STATE`, `JobInfoSchedulerService`, `AlarmManagerSchedulerBroadcastReceiver`, `TransportBackendDiscovery`) are **already in every Android build of this app, with or without this module**: `expo-dev-launcher` 6.0.21 declares `com.google.mlkit:barcode-scanning:17.3.0` (`android/build.gradle:112`), which pulls ML Kit common and DataTransport, and Expo autolinking adds every module as `api` for all variants (`ExpoAutolinkingPlugin.kt:42`). ML Kit's `MlKitInitProvider` runs at launch but has no eager components, so it does not start `TransportRuntime`. What MediaPipe adds is a **caller** (`RemoteLoggingClient`). An earlier version of this record credited the manifest entries to MediaPipe; that was wrong.

The **web** package 0.10.35 has no logger. That is why the Director pinned web to 0.10.35 (`engine.ts`). That reasoning does **not** carry over to the native SDKs.

**With the gate off, nothing starts** (delta review, from source and binaries): no code path creates a PoseLandmarker or TaskRunner, shows the camera prompt or opens the camera. iOS: the force-loaded graph library has no Clearcut or network symbols; the Clearcut static initialisers only build a mutex and a map; `GTMSessionFetcher` / `GTMSessionUploadFetcher` `+load` only add a did-finish-launching observer that reconnects persisted background sessions, of which there are none. Android: the MediaPipe and DataTransport AAR manifests declare no ContentProvider, startup initializer or boot receiver, and the scheduler entry points only run for jobs scheduled after `TransportRuntime.initialize`. First-build checks for this are below.

**What this branch does until the owner decides.**
- **Fail closed.** `src/movement-camera/nativeCameraGate.ts` has `export const NATIVE_CAMERA_TELEMETRY_APPROVED: boolean = false`, commented with the reason, the per-platform list and this review. `support.native.ts` re-exports it, and `cameraCounterSupported()` returns `nativeCameraCounterAllowed(NATIVE_CAMERA_TELEMETRY_APPROVED)`, so it is false on every native build and members see only the manual squat flow.
- **Defence in depth** (delta review E): `controller.native.ts` `startCamera` refuses while the gate is off (`unsupported` failure, manual entry) and never calls `requestCameraPermissionAsync`, so a second mount of the camera screen could not start the SDK either.
- **Tests cover both states through the real code:** with `Platform.OS` set to `ios` and `android` and the linked module, the wired `cameraCounterSupported()` is false with the gate off and true only with it on; the controller asks for the camera only with it on. The contribute screen's wiring is pinned. Mutation-checked (see "What is tested here").
- The module code, the parity tests and the contract evidence all stay. A device test needs a reviewed dev-only change that sets the constant to `true`.
- **Disclosure.** The privacy text in `src/WsfPoseCamera.types.ts`, `WsfPoseCamera.podspec`, `android/build.gradle`, `nativeCameraGate.ts`, the Swift/Kotlin run headers and `controller.native.ts` now says, per platform, what is above:
  - the module's own code records, stores and sends nothing;
  - the MediaPipe SDK sends the usage telemetry above (iOS: MediaPipe's fields; what Clearcut adds is unconfirmed (no device run, no decoded upload). Android: MediaPipe's fields plus the CCT decoration).
  - The PR body needs the same correction (text handed to the integrator; GitHub is not edited from here).
- **Not done, on purpose:** `exclude group: 'com.google.android.datatransport'`. `RemoteLoggingClient` would then throw `NoClassDefFoundError` at landmarker creation. A test forbids the exclude.
- **No user-facing copy was written.** The `NSCameraUsageDescription` in `app.json` belongs to NATIVE-BUILD-1 and is unchanged. It reads "No video or photos are recorded, saved or uploaded": true for media, silent on the SDK's usage telemetry. **Flagged** for the owner and BUILD-1. If option A is chosen, it and any member copy ("nothing is recorded") need an owner-approved review.

**Options for the owner.**
- **Read first: the iOS list is incomplete by an unknown amount.** What MediaPipe hands its logger is known from source. What the Clearcut client adds to each iOS request is **unconfirmed (no device run, no decoded upload)**. Finding no device or carrier API references in its objects is not proof that none are sent. Android's list was read from the binaries (`javap`), but it has not been checked on a device either.
- **A. Accept and disclose.**
  - Keep the SDKs and set the gate to `true` in a reviewed change.
  - Disclose per platform, from the corrected lists above (proposals; the owner and the store forms decide):
    - **App Store privacy label (iOS):** diagnostics (performance data: frame counts, latencies, init errors) and usage data (product interaction: landmarker sessions), with the bundle id, app version and iOS version. What Clearcut adds is unconfirmed (no device run, no decoded upload), so this label may be incomplete. Settle it from the first decoded upload before any App Store submission.
    - **Play data-safety form (Android):** app info and performance (diagnostics). Its description must also cover what CCT attaches to every event: device model and manufacturer, build fingerprint, OS build and SDK version, locale and country, SIM MCC/MNC, network type, timezone offset and event timestamps. Collected; sent to Google by the SDK. These are diagnostic metadata rather than per-device identifiers, so "diagnostics" still roughly fits, but the list under it must be complete.
  - Review the camera purpose string and member copy.
  - Run proof step 10 as written for option A (a differential capture).
- **B. Reject.**
  - Keep the gate `false` until telemetry-free binaries exist: MediaPipe Tasks built from source, where `CreateTasksLogger` / `TasksStatsLoggerFactory` return the dummy logger by default.
  - Vendor them with pinned hashes, and re-review.
  - Alternatives the review lists, each a larger change: strip the datatransport components from the merged manifest plus a 24 h device capture (those components also serve ML Kit in `expo-dev-launcher`, so stripping them affects the dev launcher's barcode scanner); or run the `.tflite` models directly on LiteRT.
  - Optionally, until then, keep the module out of member binaries with `expo.autolinking.exclude: ["wsf-pose-camera"]` in `package.json` (a config change for the owner), so no shipped binary contains a reachable telemetry SDK.

**First EAS build checks (record the output in this file).**
- Android, attribution: `./gradlew :app:dependencyInsight --configuration releaseRuntimeClasspath --dependency com.google.android.datatransport:transport-runtime` (expect two paths: `tasks-core`, and ML Kit via `expo-dev-launcher`). A plain `dependencies | grep datatransport` cannot attribute it.
- Android, manifest: diff the merged manifest (`app/build/intermediates/merged_manifests/*/AndroidManifest.xml`) against a build with `expo.autolinking.exclude: ["wsf-pose-camera"]`. Expect no difference in the DataTransport entries, because ML Kit brings them either way.
- Android: `javap -c` on `TasksStatsLoggerFactory` inside `tasks-core-0.10.29.aar`. If it returns `TasksStatsDummyLogger`, the Android finding drops to a wording fix.
- iOS: `nm -m` on `Pods/MediaPipeTasksCommon/frameworks/MediaPipeTasksCommon.xcframework/ios-arm64/…` and on the graph library; look for `ClearcutLoggingClient`.
- **Gate off, on a fresh install** (both platforms): open the app and complete a manual squat contribution behind a proxy. Then confirm:
  - no traffic to `play.googleapis.com/log` or `firebaselogging*.googleapis.com` (a development client also talks to Metro and `api.expo.dev`, and to ML Kit Firelog if the dev launcher's QR scanner is used; note those separately);
  - Android: `adb shell dumpsys jobscheduler | grep -i com.westayfit.app` lists no DataTransport `JobInfoSchedulerService` job, and `adb shell run-as com.westayfit.app ls databases` has no `com.google.android.datatransport.events`;
  - iOS: a cold launch shows no `play.googleapis.com` request, and the app's `NSUserDefaults` hold no `GTMSessionFetcher` background-session key.
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
  - **App-switcher snapshot.** iOS shows the preview layer only while a run is open and the app is active (hidden on `willResignActive` and on every stop). Android: on API 33+ the Recents screenshot is disabled for as long as the camera view is attached (delta review A2: no longer re-enabled by a stop that races the snapshot), and a black cover hides the preview whenever no run is open or the window lost focus. Device checks (API 33+ and API 31): (a) 3-button Home mid-set, then Recents: the thumbnail is blank or the app theme; (b) pause, then Home: no camera frame in the thumbnail; (c) pull the notification shade down mid-set: `frameStats.accepted` keeps rising (the cover leaves the `PreviewView` visible, so its TextureView keeps consuming frames).
  - **iOS frozen frame (delta review N1).** Start a run, pull down Control Center, dismiss it: the preview area is black (paused), not a frozen frame; Resume shows live video.
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
7. **Toolchain: Xcode 26.0, not 16.** `eas.json` sets no `ios.image`, so EAS uses `auto`; the SDK 54 image is `macos-sequoia-15.6-xcode-26.0` (Xcode 26.0, Swift 6.2, iOS 26.0 SDK; expo docs `build-reference/infrastructure.mdx`). React Native 0.81.5 refuses Xcode below 16.1 (`scripts/cocoapods/helpers.rb:87-88`), so the `#else` branches of the `#if compiler(...)` blocks never compile for this app. Swift language mode 5.9 under the Xcode 16.1+/26 (Swift 6.x) compiler: concurrency warnings are possible, not errors. `nonisolated(unsafe) private var run` (review IOS-7) is guarded by `#if compiler(>=5.10)`. Every delta symbol was re-cited in the iOS 26.0 SDK (`ios-api-crosscheck.md`).
8. Review fixes to compile-check:
   - the static shared `sessionQueue`;
   - `AVCaptureSession.wasInterruptedNotification` / `.runtimeErrorNotification` under `#if compiler(>=6.0)`;
   - `UIApplication.willResignActiveNotification` / `didBecomeActiveNotification` selector observers;
   - `CATransaction.setDisableActions`;
   - `UIApplication.shared.applicationState` read in `init` (delta review N1).
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
7. **Telemetry checks** (see the BLOCKING section): `dependencyInsight` for transport-runtime (both paths), the merged-manifest diff against a build with the module excluded, and the gate-off checks.
8. **16 KB pages (review F7):** `zipalign -c -P 16 -v 4 app.apk`, or `llvm-readelf -l lib/arm64-v8a/libmediapipe_tasks_vision_jni.so | grep LOAD` (Align must be `0x4000`).
   - MediaPipe added `max-page-size=16384` between v0.10.26 and v0.10.32, so 0.10.29's alignment is unknown.
   - If it is 4 KB-aligned, move to 0.10.35; its JNI library is renamed `libmediapipe_tasks_jni.so`, which is internal to the AAR.
   - Also check CameraX's `libimage_processing_util_jni.so`.
9. Review fixes to compile-check: the `CameraState` `LiveData` observer and its removal; `Activity.setRecentsScreenshotEnabled` (API 33, guarded) in `onAttachedToWindow` / `onDetachedFromWindow`; the black cover `View`; `MPImage.close()` / `Bitmap.recycle()`; `closeQuietly`; `addSuppressed` in the GPU→CPU fallback.

JS (both): the bundle already exports with the module absent. With the telemetry gate `false`, `cameraCounterSupported()` must stay **false on every build**, the dev client included, and `startCamera` refuses as well. Only a reviewed dev-only change that sets `NATIVE_CAMERA_TELEMETRY_APPROVED = true` in `nativeCameraGate.ts` makes it true, and then only where the module is linked; in Expo Go it must stay false.

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
10. **Privacy** (restated by the delta review, finding C). The contribute flow around the camera talks to Firebase Auth, Firestore and Functions, and a development client talks to Metro and `api.expo.dev`, so "no other request" cannot pass on any build. The step is a **differential** check:
    - **Gate off (every build, today):** with a network inspector, a manual squat contribution shows **no MediaPipe, Clearcut or CCT traffic**: nothing to `play.googleapis.com/log` (iOS) or `firebaselogging*.googleapis.com` (Android). On Android, `adb shell dumpsys jobscheduler | grep -i com.westayfit.app` lists no DataTransport job and `adb shell run-as com.westayfit.app ls databases` has no `com.google.android.datatransport.events`. Firebase and dev-client traffic is expected and recorded as the baseline.
    - **Gate on (option A only, a reviewed dev-only build):** capture the same squat flow. The only new hosts allowed are `play.googleapis.com/log` (iOS) and `firebaselogging*.googleapis.com` (Android, uploaded later through JobScheduler or AlarmManager), and **no request body contains image or landmark data**. Record the decoded iOS Clearcut payload (what Clearcut adds is not confirmed).
    - **Storage (option A):** list the app container before and after a session (iOS `Library/`, `Library/Caches`, `tmp`; Android files and databases) and record any Clearcut log directory or file (iOS) and DataTransport's event queue and its size (Android).
    - Under option B the expectation is no MediaPipe traffic at all, gate on or off.
    - The static scan here passes.

## Review of #638 (PASS WITH REQUIRED CHANGES @ `abe84f45`): fixes applied

| Finding | Status |
|---|---|
| **1 / F1 (blocking): MediaPipe SDK usage telemetry** | **Gated and disclosed.** `NATIVE_CAMERA_TELEMETRY_APPROVED = false` (both states tested; since the delta review through the wired entry point on iOS and Android). Disclosure in types / podspec / gradle / headers / QA. datatransport deliberately not excluded (tested). First-build checks and options A/B recorded. The owner decision is pending. |
| Frozen-lens 1: AppState not re-checked when the permission answer arrives | **Fixed.** A grant while away opens the camera only on the next `active` (tested). |
| Frozen-lens 2: a throw in handlePose escapes | **Fixed.** It fails the run with `inference`: released, manual entry (tested). |
| Frozen-lens 3: build-time opt-in before member builds | **Superseded** by the telemetry gate, which is stricter: no native build opens the camera until a reviewed approval. |
| Frozen-lens 4: parity outcome compares only counts | **Fixed.** Keypoints, aspect and guidance are compared too. |
| Frozen-lens 5: native `playback` shows the browser tap panel | **Fixed.** It maps to the generic "Camera isn't available" (tested). |
| Frozen-lens 6: the unit is guessed when missing | **Fixed.** `timestampUnit` is required in the contract; a missing unit is dropped (tested). |
| Privacy-2: the scan misses .m/.mm/.h/.java/manifest | **Fixed.** Exact module file list, no `AndroidManifest.xml`, all source kinds scanned. |
| Privacy-3: equivalent recording / network / location APIs | **Fixed.** Extended list, FQN regex, pinned Swift and Kotlin imports. |
| Privacy-4: `strip()` treats `//` in strings as a comment | **Fixed**, and since the delta review (N3) by a string-aware scanner (tested with `"a//b"`, `"/*"`, `*`-continuation lines). |
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

## Delta review of #638 (PASS @ `3edaf5f5`): follow-ups applied

| Finding | Status |
|---|---|
| **A (telemetry lens): the Android disclosure is incomplete** | **Fixed (wording).** Per-platform lists in `types.ts`, `nativeCameraGate.ts`, `build.gradle`, the podspec (iOS), this record and the options A/B text. Android: MediaPipe's own fields plus the CCT decoration (`CctTransportBackend.decorate`, re-checked with `javap` here). iOS: only what `MPPTaskRunner` hands the logger; what Clearcut adds is stated as NOT confirmed. The disclosure test requires the new fields. |
| B: manifest entries credited to MediaPipe | **Fixed.** `build.gradle` and this record: DataTransport is already in every Android build through `expo-dev-launcher` → ML Kit; MediaPipe adds a caller. First-build checks now use `dependencyInsight` and a merged-manifest diff against a build without the module. |
| C: proof step 10 cannot pass | **Fixed.** Restated as a differential check: gate off, no MediaPipe / Clearcut / CCT traffic; gate on (option A only), no image or landmark payloads. |
| D / JS N1: the "both states" test ran on web | **Fixed.** With `Platform.OS` `ios` and `android` and a linked module, the wired `cameraCounterSupported()` is false with the gate off and true with it on. The contribute screen's `useState(() => cameraCounterSupported())` and the `if (cameraOpen)` mount are pinned. Mutation-checked (J7c bypass, constant true, gate ignored, C1 `\|\| true`: all caught). |
| E: a JS-only gate | **Fixed.** `startCamera` refuses while the gate is off (tested). The gate moved to `nativeCameraGate.ts`, shared by the two native readers. The optional autolinking exclusion is listed under option B as an owner decision (a config change). |
| A1: `PoseLandmarker.close()` can throw | **Fixed.** `closeQuietly` at all three sites (stop, loadModel when stopped, failed inference). |
| A2: the Recents re-enable races the snapshot | **Fixed in code, device check open.** On API 33+ the Recents screenshot is disabled while the view is attached (re-enabled on detach and destroy), so no JS round trip races it. A black cover replaces `PreviewView` visibility, so the TextureView keeps consuming frames under the notification shade. Device checks (a)–(c) are listed above. |
| A3: the GPU error is lost when the CPU retry fails | **Fixed.** The CPU error carries the GPU error (`addSuppressed`), and both reach the `model` failure message; linkage and VM errors are not retried. |
| iOS N1: the preview un-hides with no run | **Fixed.** Visible only while a run is open and the app is active; `applicationState` read at init. Device check listed. |
| iOS N2: launch-time inertness not recorded; iOS container | **Recorded** (telemetry section: gate-off launch checks; step 10 storage check). |
| iOS N3: Xcode 26, not 16 | **Fixed.** First-compile risk 7 and the cross-check name EAS `auto` → `macos-sequoia-15.6-xcode-26.0` for SDK 54; delta symbols re-cited in the iOS 26.0 SDK; the AppContext.swift remark corrected. |
| iOS N4: PR body tree-sitter claim | **Fixed** in the corrected PR body handed to the integrator. |
| JS N2: exact Android permissions | **Fixed.** `toEqual(['android.permission.CAMERA'])` restored; it is exactly what `app.json` holds. |
| JS N3: privacy-scan holes | **Fixed.** String-aware comment stripping (no `*`-line rule), wider Swift and Kotlin import patterns; a self-test for each hole. |
| JS N4: invalid frames dropped silently forever | **Fixed.** 30 in a row fail the run (`inference`); tested both ways. |
| JS N5: the Kotlin↔JS evidence can go stale | **Fixed.** The fixture records the sha256 of `WsfPoseContract.kt` and `WsfPoseContractTest.kt`; vitest checks it (a contract edit was mutation-tested: caught). `fbjni-classes.jar` is re-extracted every run. |
| JS N6: `emit()` does not isolate listener errors | **Fixed.** Per-listener try/catch; the run fails closed once (tested with a listener that always throws). |
| JS N7: base line, shared-edit line, scan wording | **Fixed.** Header base `9e9dc2ca` merged at `7411c47b`; the PR body lists every shared edit; the scan wording matches what is enforced. |

## Second delta review of #638 (PASS @ `0ef0483e`): non-blocking items applied

[Record](https://github.com/idevinsimpson/goarrive/pull/638#issuecomment-6305140442). Every earlier item was verified fixed.

| Item | Status |
|---|---|
| NB-1: the iOS Clearcut wording leans toward under-claiming | **Fixed (wording).** The telemetry section and the owner's A/B text say "unconfirmed (no device run, no decoded upload)"; the absence of device or carrier references is stated as not proof. Option A's App Store label must be settled from a decoded upload. A test pins the wording in this record. |
| NB-2: a throw in `startCamera`'s first `emit()` still asks for permission | **Fixed.** `startCamera` stops when the run was failed by that emit, before `requestCameraPermissionAsync` (tested, mutation-checked). |
| NB-3: the privacy scan's `strip()` ignores string interpolation | **Fixed.** Per-kind string forms with interpolation, escapes and bracket depth; 13 new self-test assertions; output unchanged on all 225 module and app sources. |
| NB-4 / map CAM-02: native Settings shows Camera rep counter | **Fixed.** `MoveCameraSettingsSection.tsx` is a camera-lane file (map §5.4, "Additional reserved files"); hidden on native while unsupported, web unchanged (tested, mutation-checked). INT-31 elevation and MF-18 describedby, the rest of map task C-2, are not in this change. |
| Integration (candidate-2): the contribute-screen gate test counted reads | **Fixed in `b4663ce1` (test only).** State-3's restore gating adds a second `cameraEntryAllowed` call, so the test now checks by property: one declaration from the probe, every gate call takes `supported: cameraSupported`, no other read, `cameraOpen` an `&&` chain over one gate call, one mount inside `if (cameraOpen)`. Passes on this branch, the state-3 merge and candidate-2; 11 mutants caught on both trees. |

## Review of #638 (PASS @ `b4663ce1`): D1 applied

[Record](https://github.com/idevinsimpson/goarrive/pull/638#issuecomment-6306549722).

| Item | Status |
|---|---|
| D1: this record said Groovy slashy strings are checked absent, but the test rejected only dollar-slashy (`$/`) | **Fixed (check added).** The scan test also rejects a plain slashy opener in `build.gradle`, after comments are removed: a `/` at a line start or after an operator or opening bracket, not followed by `/`, `*` or a space. Self-tested on five slashy and five non-slashy snippets (a URL in a string, a spaced division, `/=`, a comment). Mutation-checked: six plain slashy forms appended to `build.gradle` (assignment, call argument, line start, `==~`, closure, list) each fail it, and dollar-slashy still fails the `$/` check; the `b4663ce1` test missed all six. |

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
npx vitest run tests/move-camera-native-adapter.test.ts     # 70 tests
npx vitest run --testTimeout=60000                          # 68 files, 1371 tests (after the second delta review's items)
npx vitest run tests/move-camera-native-contract.test.ts    # 7 tests: Kotlin <-> JS contract, tied to the Kotlin sources
docs/westayfit/qa/camera-evidence/run-kotlin-jvm.sh         # from the repo root; Kotlin JVM tests + module compile report
npx expo export --platform ios --output-dir /tmp/exp-ios
npx expo export --platform android --output-dir /tmp/exp-android
npx expo-modules-autolinking resolve -p apple --json        # wsf-pose-camera → pod WsfPoseCamera
npx expo-modules-autolinking resolve -p android --json      # wsf-pose-camera → expo.modules.wsfposecamera.WsfPoseCameraModule
```
