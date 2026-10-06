# MOVE-CAMERA-NATIVE-PORT-1 — camera squat MOVE, QA record

Packet: #365 `5997524401`. Release: #365 `5997538756`. Base: `claude/wsf-app-shell@0745c7323eed24fbb5e1e9b8fc2bac4a6d1fea7e`.
Frozen reference: Lovable `e15b9fa0-b2a0-4314-bc21-9c573b8eceb1@1454357098b9d066f310aee977455f5024c69d28` (`src/demo/camera-count.tsx`, `camera-flow.ts`, `move.tsx`, `overlays.tsx`, `styles.css` 692–728).
Technical donor only: PR #475 commit `eda5821893937e89b2635237d42924221e00c3a9` (`src/movement/*`). It is not merged and not reopened.

## What is in this PR

| Layer | Where | What it does |
|---|---|---|
| **Counter (frozen)** | `apps/westayfit/src/movement-camera/frozen/rep-counter-proof/**` | The owner-accepted live candidate `makeSessionR1421`, all 32 files, never edited:<br>• r14.2.1 startup arm and camera-height calibration<br>• r14.1 measurement-gap grace<br>• r13.3 camera-transform-invariant skeleton-phase counter<br>• `SubjectLockR14` transient continuity<br>See `src/movement-camera/FROZEN-SOURCE.md` for provenance. |
| Typed boundary | `frozen.js`, `frozen.d.ts` | The reference's own pattern. The app never imports the frozen files directly; a test pins this. |
| Orchestration | `orchestrator.ts` | The reference orchestrator, ported:<br>• **ready = locked + armed + 600 ms stable full body** (nose plus one complete side chain, edge 0.02)<br>• the GO baseline does not reset the session<br>• pause banks the count<br>• Finish freezes the estimate (`camera-estimate`, unverified) |
| Controller | `controller.ts`, `support.ts` | The reference controller, running on the frozen `MovementCameraLifecycle`:<br>• front camera at 640x480, 60 fps; no audio<br>• pauses on `visibilitychange`/`pagehide`<br>• disposes on every exit |
| Engine (web) | `engine.ts`, `tasksVision.ts` | `@mediapipe/tasks-vision` **exactly 0.10.35** (scope delta `5997885276`):<br>• settings as the reference: VIDEO, lite float16 v1, numPoses 3, 0.5 confidences, no masks, GPU→CPU<br>• lazily imported into its own chunk |
| Mapping | `visual.ts` | The frozen `BLAZEPOSE_INDEX`/`mapBlazePose`, held text-equal to the frozen file. Ears, elbows and wrists ride beside each pose in a WeakMap and never reach counting. |
| Flow rules | `flow.ts` | Settings defaults, the entry rule, the 0..500 clamp, the automatic 3-2-1 and the plain cues. These mirror the reference's `camera-flow.ts`. |
| Camera screen | `src/ui/CameraRepCounter.tsx`, `CameraSkeletonOverlay.tsx`, `figure.ts` | The full-screen camera, count, Finish, Count by hand, failure and paused panels, and the body guide (head ring, arms, legs, `#91CB7D`). Lazy-loaded together with the counter (165 KB chunk). |
| Settings | `settingsStore.ts`, `MoveCameraSettingsSection.tsx`, `app/settings.tsx` | MOVE section first, as in the reference: **Camera rep counter**, and under it **Show stick figure**. Both ON by default and stored on this device only. |
| Routing, Adjust | `app/contribute/[goalId].tsx` | A fresh squat **Start moving** goes camera → Adjust → the **existing** review → Record. |

**PR #475 is a technical donor only.** Its `MovementSession`/`SquatCounter` counter is **not** on the product path. Its suites now run against the frozen `core/*`, which is byte-identical.

## Known differences from the reference, stated plainly

- **Asset hosting.** The reference served the WASM and model **same-origin** from its asset store. This build fetches the **same pinned bytes** from the version-pinned jsDelivr path (`@0.10.35/wasm`) and the GCS `float16/1` model URL, which are the donor #475 URLs. Same-origin hosting needs those bytes in the hosted build, which is a separate scoped change.
- **Native.** No camera there yet; the manual flow stays (fail closed). See the NATIVE ADAPTER proposal, `#497 5998835467`.
- **tsc.** Strict `tsc` reports 5 type-only errors **inside the frozen files**. The reference never typechecks them. The exclude is requested at `#497 5998544943`.
- **Older e2e suites.** Specs that walk the manual squat flow need the counter OFF in their test context. A one-file `playwright.config.ts` default is requested at `#497 5999027969`; with it applied locally, those suites pass.

## Synthetic test source (emulator + loopback only)

`window.__WSF_TEST_POSE__` (`support.ts`) is read only when `EXPO_PUBLIC_WSF_USE_EMULATORS` is `1`/`true` AND the page is served from loopback. This is the same gate as the demo-media test catalog.

- It supplies raw BlazePose 33-point lists for a scripted stick figure, which pass through the same `mapPerson` → orchestrator → **real frozen `makeSessionR1421`** as engine output.
- It never opens a camera, and keeps `active` truthful so the specs can prove the camera was released.
- Without the hook, the web build takes the real camera path. Headless Chromium refuses the camera, so that e2e lands on "Camera isn't available" → manual entry.
- **Not evidence that counting works on a real body.**

## Frozen target states → proof

| # | Target | Proof |
|---|---|---|
| 1 | Settings defaults ON/ON; stick figure hidden while the counter is off | unit `camera settings`; e2e `Settings: MOVE section …` (value kept while hidden, persisted across reload) |
| 2 | Squat + camera ON opens the camera directly | e2e happy path: no `wsf-contribute-move-screen` |
| 3 | Plain step-back guidance, no diagnostics | unit `camera cues are plain`; e2e `Step back so I can see you` |
| 4 | Countdown starts only on stable full body (plus the frozen arm) | unit: orchestrator `ready requires armed AND 600 ms`, `ready only once full body has been stable for 600 ms` (fails under a stable-window mutant), and the real frozen session `arms on a standing plateau` |
| 5 | Readiness loss cancels the countdown | unit `losing readiness mid-countdown …`; e2e `readiness loss cancels the countdown` |
| 6 | Baseline at GO; count starts at 0; pre-GO motion excluded | unit: fake session `reps observed before GO never appear`, and the **real frozen session** `pre-GO squats never reach the set` (raw 4, set 3). Both fail under a zero-baseline mutant; e2e counting `0` after a pre-GO squat |
| 7 | Full-height camera, large count, one Finish, brief reacquire cue | e2e `Step back into view` while counting, count unchanged |
| 8 | Body guide ON: one figure, head ring, arms, legs, `#91CB7D` | unit `the body guide geometry`; e2e `data-head=ring`, `data-lines=8` |
| 9 | Body guide OFF: identical counting, no overlay | unit `mapBlazePose ignores the visual indices entirely`, plus the visuals-merge mutant; e2e `data-figure=off`, no `wsf-camera-figure` |
| 10 | Finish freezes and releases | unit orchestrator `Finish freezes the number`; e2e `active === false` after Finish |
| 11 | Adjust: minus / number / plus, 0..500 | unit `adjust bounds`; e2e Adjust 3 → 4 |
| 12 | Continue enters the EXISTING review; nothing before confirm | e2e: zero contributions through Finish, Adjust, Continue and Edit; exactly `[4]` after Record |
| 13 | Failure offers manual entry | e2e `camera failure offers manual entry` (scripted permission failure) |
| 14 | Counter OFF: current manual flow | e2e `Camera rep counter OFF …` |
| 15 | Non-squat goals: existing flow | unit entry rule (`push-ups`, `squat`, `jump squats` …); e2e push-ups goal, `starts === 0` |
| 16 | Resumed/pending/unknown/confirmed: existing recovery | e2e planted unresolved attempt → pending screen, `starts === 0`; unit structural: the pending branch returns before `cameraOpen`, which requires `beforeWrite`, `!kiosk` and no round attempt |
| 17 | Close/background/unmount release; nothing invented | e2e hidden page → `Camera paused`, `2 squats kept so far.`, `active === false`, a fresh 3-2-1 resumes at 2; Close → released, zero contributions |
| 18 | No frame storage or upload; estimate unverified | unit `privacy: nothing leaves the device` (no MediaRecorder, canvas capture, fetch, Firestore or `odml.pa.googleapis`); `finish()` returns `source: 'camera-estimate', verified: false` |

Visual-only points (ears, elbows, wrists) never reach the frozen session: `mapPerson` gives it exactly the nine frozen keypoints, and a visuals-merge mutant fails the suite. The frozen closure is sha256-pinned file by file, and a repeated (out-of-order) frame mid-rep voids that rep.

## Frames

The capture producer is `tests-e2e/move-camera-counter.spec.ts` with `WSF_CAMERA_LABEL=before|after`. It writes to `tests-e2e/artifacts/move-camera-counter/`, which is never committed.

- **BEFORE** (`0745c732`): Settings shows only the community privacy toggles. Squat MOVE lands on "Ready when you are." with the manual timer.
- **AFTER** (synthetic source): Settings with the MOVE section. Camera at acquiring, countdown, counting 0 and counting 3. Adjust. Camera failure.

## Reproduce

```sh
METADATA_SERVER_DETECTION=none npx -y firebase-tools emulators:start --config firebase.westayfit.emulators.json --project demo-wsf-local
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 npm --prefix apps/westayfit run build:web
cd apps/westayfit
npx vitest run tests/move-camera-counter.test.ts   # 127 tests
WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 npx playwright test tests-e2e/move-camera-counter.spec.ts --workers=1
```
