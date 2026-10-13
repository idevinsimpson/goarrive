# MOVEMENT-VISION-1: camera squat counting, dev-only proof of concept

Packet: Director comment `5825748052` on #365, relayed by L0. Worker: W10. PR: #475 into `claude/wsf-app-shell`. Base: `6b96ba1bf8e3bf7f86e6bdd98fc087232546ae25`.

This is a **test instrument**. It is not a member feature, and it is not linked from any screen. It writes nothing anywhere. **Do not call it accurate.** It has been exercised on synthetic landmarks and on a fake camera feed. It has not been exercised on a real person squatting (see [Evidence](#evidence)).

## Try it

The lab only renders in an emulator-flagged build. That is the same gate as every `design-target` route. A staging or production build shows a notice instead.

```bash
cd apps/westayfit
EXPO_PUBLIC_WSF_USE_EMULATORS=1 npm run build:web
npx expo serve --port 8765          # or: EXPO_PUBLIC_WSF_USE_EMULATORS=1 npx expo start --web
# open http://localhost:8765/design-target/movement-vision
```

- **Start camera.** The browser asks for camera permission, then shows a mirrored self-view. The first start also downloads two static files: the MediaPipe WASM runtime (jsDelivr) and the `pose_landmarker_lite` model (Google Cloud Storage). Both URLs can be overridden with `EXPO_PUBLIC_WSF_MV_WASM_BASE` and `EXPO_PUBLIC_WSF_MV_MODEL_URL`, for example to self-host them.
- **Camera access needs HTTPS or `localhost`.** To test on a phone, the page must be served over HTTPS.
- **`?delegate=cpu`** forces the CPU (WASM/XNNPACK) path. Use it on machines whose GPU is emulated: headless browsers and VMs ran at about 1 fps on the "GPU" path and about 14 fps on CPU.
- **Synthetic scene** plays a scripted scene without a camera, labelled on screen, and loops every 24 s:
  - the member steps in and does 3 squats;
  - a half squat, which is not counted;
  - someone walks behind the member, and counting pauses;
  - the member is re-acquired;
  - someone squats at the edge of frame while the member does 2 more reps, for a total of 5;
  - the member leaves.
- **Count by hand instead** is the manual fallback. Refusing the camera always leaves this path open.
- **Reset count** zeroes the count. In camera mode it also looks for the member again.
- **Debug overlay:**
  - dashed grey boxes are every detected person;
  - the coloured box and skeleton are the tracked person (green locked, amber acquiring, red lost);
  - the yellow frame is the movement zone;
  - the readout shows engine, fps, lock state and reason, phase, depth, and half reps seen.

How to be counted:
1. Stand in the middle of the frame with your whole body, head to feet, visible.
2. Stand tall and still for about 0.6 s. The pill turns green: "Tracking you".
3. Squat until your hips reach roughly knee height, then stand all the way up. That is one rep.

## How it works

```
camera frame ──▶ PoseEstimator (web/mediapipe.ts)  ──▶ PoseFrame (engine-neutral landmarks, up to 3 people)
                                                         │
                                                         ▼
                                              SubjectLock (subjectLock.ts)
                    searching → acquiring → locked ⇄ lost        (refuses rather than guesses)
                                                         │ the locked person's pose, or nothing
                                                         ▼
                           squat signal (geometry.ts): hip drop measured in shin lengths → depth
                                                         │
                                                         ▼
                                              SquatCounter (squatCounter.ts)
                       unknown → standing ⇄ down, hysteresis + debounce, +1 on down→standing only
                                                         │
                                                         ▼
                                   MovementSession (session.ts): snapshot for the UI; manual mode
```

Everything in `src/movement/` except `web/` and the two `MovementVisionLab*.tsx` files is pure TypeScript: no DOM, camera, engine, React or I/O. A native adapter would only need to produce `PoseFrame`s (see [`DECISION.md`](DECISION.md)).

**The squat signal.**
- `ratio = (ankle.y − hip.y) / (ankle.y − knee.y)`: about 2 standing, about 1 with hips at knee height.
- The member's own standing ratio is measured while acquiring the lock, and depth is scaled from it: 0 is standing, 1 is parallel.
- The ratio is scale-free, so stepping closer or nudging the phone does not change it.
- It works from the front, where the 2-D knee angle barely changes because the thigh points at the lens.

**The counter** (defaults in `squatCounter.ts`):

| Setting | Value | Meaning |
|---|---|---|
| Down | depth ≥ 0.6, held 100 ms | The member is at the bottom |
| Standing | depth ≤ 0.25, held 100 ms | The member is standing |
| Dead band | 0.25 to 0.6 | Never changes the phase |
| Minimum between counts | 400 ms | Safety net against double counting |

- A rep is counted only on the down → standing edge.
- A descent that never reaches down is a *partial*: it is shown as a half rep and not counted.
- After lost tracking or a reset, the phase is `unknown`: standing has to be seen again before anything can count, and a rep in progress when tracking was lost is discarded.

**The lock** (defaults in `subjectLock.ts`):
- **Acquire:** exactly one full-body person (a shoulder plus one fully visible leg) who is at least 30% of frame height, centred in the middle 60% of the frame, standing tall, and holding still for 600 ms.
  - Two qualifying people means no lock ("More than one person in the zone").
- **Follow:** the match must continue the track, with its centre within 0.35 body-heights of the last box and its size within ×0.7 to ×1.4.
  - Anyone else overlapping the tracked box, or within 0.35 body-heights of it, makes the frame ambiguous. Ambiguity means `lost`, and counting pauses at once.
- **Lost:**
  - Missing for more than 300 ms means `lost` ("Lost you — step back into frame").
  - Re-acquiring needs exactly one person near the last position, holding still for 400 ms.
  - After 4 s lost, the track is forgotten and acquisition starts again.
- **Identity:** there is no face recognition, appearance model or biometric of any kind. The track is spatial continuity only.

## Privacy

Camera frames are processed on the device, in the browser tab. They are never recorded, stored or uploaded. Nothing is written to Firebase, and the count lives in memory on this screen only.

What backs that statement:
- **`tests/movement-privacy.test.ts`** scans every file under `src/movement/` and the route. It fails on:
  - `MediaRecorder`, `toDataURL`, `toBlob`, `getImageData` or `captureStream`;
  - `fetch`, `XMLHttpRequest`, `sendBeacon` or `WebSocket`;
  - `localStorage`, `sessionStorage` or `indexedDB`;
  - any `firebase` reference;
  - the contribution modules.
- **The same test checks the installed MediaPipe bundle.** It must be the pinned `0.10.35` and must not contain the `odml.pa.googleapis.com` metrics endpoint. MediaPipe 1.x sends usage and performance metrics to Google; see [`DECISION.md`](DECISION.md).
- **The fake-camera e2e test records every request the page makes** while the camera runs. It asserts that each one goes to the app's own origin or to the two engine assets.
- **Network use is limited to two files.** The only network traffic the lab causes is the one-time download of the WASM runtime and the model file. Chromium itself may contact Google services, as it does on any page; that is outside this code.

## Files

All files are new. The only edits to existing files are the dependency lines in `apps/westayfit/package.json` and `package-lock.json`.

| Path | What |
|---|---|
| `apps/westayfit/app/design-target/movement-vision.tsx` | Gated route |
| `apps/westayfit/src/movement/types.ts`, `geometry.ts` | Pose vocabulary, squat signal |
| `apps/westayfit/src/movement/subjectLock.ts` | Active-mover lock |
| `apps/westayfit/src/movement/squatCounter.ts` | Rep state machine |
| `apps/westayfit/src/movement/session.ts` | Lock, counter and manual fallback; UI strings |
| `apps/westayfit/src/movement/adapter.ts` | `PoseEstimator` platform seam |
| `apps/westayfit/src/movement/synthetic.ts` | Synthetic people and the lab's scripted scene |
| `apps/westayfit/src/movement/labGate.ts` | The emulator-flag gate |
| `apps/westayfit/src/movement/web/mediapipe.ts`, `web/tasksVision.ts` | MediaPipe web adapter, split chunk |
| `apps/westayfit/src/movement/web/overlay.ts` | Debug overlay drawing |
| `apps/westayfit/src/movement/MovementVisionLab.web.tsx` | Web lab UI |
| `apps/westayfit/src/movement/MovementVisionLab.tsx` | Native placeholder (manual count only) |
| `apps/westayfit/src/movement/LabParts.tsx` | Shared lab UI pieces |
| `apps/westayfit/tests/movement-squat-counter.test.ts` | 18 cases |
| `apps/westayfit/tests/movement-subject-lock.test.ts` | 25 cases |
| `apps/westayfit/tests/movement-privacy.test.ts` | 23 cases |
| `apps/westayfit/tests/movement-fail-closed.test.ts` | 8 cases: the Director's three constructed cases (#475 `5825938854`) |
| `apps/westayfit/tests-e2e/sprint-w10-movement-vision.spec.ts` | 6 browser cases |
| `docs/westayfit/movement-vision/*` | This README, `DECISION.md`, `LIMITATIONS.md` |

**Dependency:** `@mediapipe/tasks-vision` at exact version `0.10.35`. It is Apache-2.0, has no transitive dependencies, and is not a paid or vendor SDK. It needs no API key.

## Evidence

These claims are separate. Each one says exactly what was and was not shown.

| Claim | State |
|---|---|
| **SOURCE IMPLEMENTED** | Yes, on this branch. |
| **TEST VERIFIED** | Yes. The details follow this table. |
| **BROWSER VERIFIED** | Partly: headless Chromium, synthetic scene and fake camera only. The details follow this table. |
| **NATIVE VERIFIED** | **No.** There is no native adapter; the native build shows the manual count only. |
| **INTEGRATED** | **No.** |
| **SERVED** | **No.** |

**TEST VERIFIED.**
- 74 vitest cases in `tests/movement-*.test.ts` pass, and the app's whole suite passes: 949 of 949. `tsc --noEmit` is clean.
- **Fail-closed review fixes** (#475 `5825938854`): the 8 regressions in `movement-fail-closed.test.ts` all failed on the previous head `8642e33` before the core was changed. Two older tests had required a rep to *survive* a one-frame dropout; they now assert the opposite.
- A mutation check broke the logic 8 ways, and each mutation turned tests red:
  - no hysteresis;
  - no debounce;
  - counting on the down edge;
  - interrupt as a no-op;
  - no intruder check;
  - acquiring when two people qualify;
  - no hold-still requirement;
  - `unknown` allowed to go down.

**BROWSER VERIFIED (partly).** In headless Chromium on 2026-09-25, all 6 cases in the e2e spec passed. That covers:
- **Freshness bound, end to end:** with Playwright's fake clock the lab's frame loop was paused at the bottom of a rep and resumed 11.2 s later with the member standing. The rep was voided, the member was re-acquired, and the count stayed 0. With the bound disabled, the same test counted a phantom rep (expected 0, received 1).
- **Synthetic scene:** the lock, 3 counted reps, the half rep not counted, a pause while the walker crossed, re-acquisition, and a count of 5 rather than 8 with a second exerciser.
- **Camera refused:** the manual count worked.
- **Fake camera through the real MediaPipe engine**, with a feed built from a real photo of a standing person:
  - the engine detected the person and the lock took them at about 10–14 fps on CPU;
  - with **two people side by side** the engine reported **2** and the lock refused to choose;
  - the page made no requests beyond its own origin and the two engine assets.
- **Screenshots:** the synthetic-scene frames are in [`evidence/`](evidence/). The fake-camera screenshots show a third-party test photo, so they are not committed. The spec regenerates them in `apps/westayfit/test-results/w10-movement-vision/`.
- **What it did NOT show:**
  - **Counting a real squat.** The feed's "squats" are the photo with its thighs compressed. MediaPipe read them as depth ≤ 0.47, below the 0.6 threshold, so the counter logged half reps and counted **0**. That result is evidence that a warped photo is not a squat. It says nothing either way about real squats.
  - **Rejecting a detected bystander.** In the bystander case, MediaPipe lite **did not detect** the small person at the edge, so that case never exercised the lock's rejection of a detected bystander.
  - **A real camera on a real device.**

Before calling the POC successful, the owner's hostile test set still has to be run **on a real device with real people**. The results should be recorded here, case by case:
- slow, fast and half squats;
- pauses at the bottom and at the top;
- leaving and re-entering;
- someone walking behind, and someone walking briefly in front;
- a second person exercising;
- poor lighting;
- a slightly moved phone.

See [`LIMITATIONS.md`](LIMITATIONS.md).
