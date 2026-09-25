# MOVEMENT-VISION-1: engine decision record

**Decision:** for the first, browser-testable slice, the pose engine is **MediaPipe Tasks Vision `PoseLandmarker`**, using `@mediapipe/tasks-vision` at exactly **`0.10.35`** and the `pose_landmarker_lite` model, running in the browser tab. The lock and the counter do not depend on it. They consume engine-neutral `PoseFrame`s through the `PoseEstimator` seam in `src/movement/adapter.ts`.

## What the requirement needs from an engine

1. **Several people per frame.** The active-mover lock has to *see* a second person to refuse or ignore them. An engine that reports only the most salient person hides the passerby, so the lock cannot notice when it has latched onto the wrong one.
2. **Reliable hips, knees and ankles.** The squat signal is hip drop measured in shin lengths.
3. **On-device inference in the browser, today, with no key and no vendor account.**
4. **A credible path to iOS and Android** without rewriting the counting logic.

## Options considered

| | MediaPipe Tasks `PoseLandmarker` | MoveNet MultiPose (`@tensorflow-models/pose-detection` + tfjs) | Vendor SDK (e.g. KinesteX) |
|---|---|---|---|
| People per frame | `numPoses` configurable (used: 3) | Up to 6 | n/a |
| Keypoints | 33 (BlazePose), including heels and feet | 17 (COCO) | n/a |
| Tracking IDs | None | Built-in box tracker | n/a |
| Packages | One, with 0 transitive dependencies | pose-detection, tfjs-core, tfjs-converter, a backend package, and a `@mediapipe/pose` peer | Paid, needs a key |
| Native path | The same model family ships as MediaPipe Tasks for Android and iOS | TFLite MoveNet models exist for native | Vendor's own |
| Status | Maintained, released 2026 | Maintenance mode | Benchmark only, not added |

**Why MediaPipe.**
- It meets requirement 1 in a single dependency.
- It gives the richer lower-body topology for requirement 2.
- Its model family continues natively, which serves requirement 4.

**Why not MoveNet.** Its built-in tracker is attractive, but this POC deliberately does **not** trust an engine's tracking IDs. An engine tracker can swap IDs when two people cross, which is exactly the passerby case. The lock does its own conservative spatial-continuity tracking and treats a crowd as ambiguous, so the tracker adds no safety here, and the extra dependencies cost more.

**KinesteX** is named as a benchmark only. No paid or vendor dependency or key was added, as the packet requires.

## Measured against the actual app

These results come from headless Chromium, using the app's Expo SDK 54 web export and this branch's e2e spec, on 2026-09-25.

- **Multi-pose works for the refusal case.** With two people side by side, the engine reported both (`people detected: 2`) and the lock refused to acquire ("More than one person in the zone").
- **Small or distant people can be missed.** With the member centred and a person at half their size at the frame edge, the lite model reported only the member. A background passerby may therefore be invisible to the lock. That is safe for counting, since an undetected person cannot add reps. It also means the lock cannot flag them when they overlap the member until the engine does detect them. A real-device check should compare `pose_landmarker_full`.
- **Frame rate.** On the CPU (XNNPACK) path the engine ran at about 10–14 fps. On the "GPU" delegate with an emulated GPU it ran at about 1 fps, which is too slow to count squats. Real devices with real GPUs have not been measured. The counter's 100 ms dwell assumes at least about 10 fps.
- **Warped frames.** A fake camera feed made by compressing a real photo's thighs reached only depth 0.47 in the engine's output. This does not tell us how real squats score.

## Two constraints found while wiring it in

**1. The version pin: 0.10.35, not 1.x.** From 1.0.0 the package contains a metrics logger that POSTs API usage and performance data to `https://odml.pa.googleapis.com/v1/log`.
- The 1.x README ("Privacy Notice") says no images are sent. It also makes the app responsible for "obtaining informed consent from your app users about Google's processing of MediaPipe metrics data".
- That is still data leaving the device, and it needs an owner decision that has not been made.
- `0.10.35` (April 2026) has no such logger. It contains no hard-coded endpoints apart from spec links.
- `tests/movement-privacy.test.ts` fails if the installed bundle is not `0.10.35` or contains that endpoint, so an upgrade has to be a deliberate decision.
- **Owner decision needed before any 1.x upgrade.**

**2. Metro cannot bundle the package's ESM build.**
- `vision_bundle.mjs` contains `import(t.toString())`, and Metro rejects it with "Invalid call".
- The CommonJS build (`vision_bundle.cjs`) loads its WASM loader with a `<script>` tag instead.
- `web/tasksVision.ts` requires that file by path. Metro warns that the subpath is not in the package `exports` and falls back to file resolution.
- `web/mediapipe.ts` reaches it only through `await import()`, so the 137 KB engine is a separate chunk that loads only when the lab starts the camera. No member page loads it.

## The path to native (not built, not claimed)

1. Make an Expo development build. Expo Go cannot load custom native ML.
2. Add a camera frame processor that runs a pose model on-device, for example:
   - `react-native-vision-camera` plus a MediaPipe Tasks Pose plugin, or
   - a TFLite pose model through `react-native-fast-tflite`.
3. Map its output to `PoseFrame` the way `mapBlazePose` does.
4. Implement `PoseEstimator` and feed `MovementSession`. The lock, the counter and their tests do not change.
5. Only after running the hostile set on real iOS and Android devices can **NATIVE VERIFIED** be claimed.

Until then, the native build of the lab shows the manual count and says camera counting is browser-only.
