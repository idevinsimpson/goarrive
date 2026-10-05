# MOVE-CAMERA-NATIVE-PORT-1 — camera squat MOVE, QA record

Packet: #365 `5997524401`. Release: #365 `5997538756`. Base: `claude/wsf-app-shell@0745c7323eed24fbb5e1e9b8fc2bac4a6d1fea7e`.
Frozen reference: Lovable `e15b9fa0-b2a0-4314-bc21-9c573b8eceb1@1454357098b9d066f310aee977455f5024c69d28` (`src/demo/camera-count.tsx`, `camera-flow.ts`, `move.tsx`, `overlays.tsx`, `styles.css` 692–728).
Technical donor only: PR #475 commit `eda5821893937e89b2635237d42924221e00c3a9` (`src/movement/*`). It is not merged and not reopened.

## What is in this PR

| Layer | Where | What it does |
|---|---|---|
| Counting core | `apps/westayfit/src/movement-camera/{types,adapter,geometry,squatCounter,subjectLock,session,synthetic}.ts` | The donor's runtime-independent squat counter and subject lock, ported unchanged except for imports and doc paths. |
| Flow rules | `src/movement-camera/flow.ts` | Settings defaults, the entry rule, readiness (600 ms of stable full body), the automatic 3-2-1, the GO baseline, pause banking, the frozen Finish estimate, the 0..500 clamp, and plain cues. |
| Body guide | `src/movement-camera/figure.ts`, `src/ui/CameraSkeletonOverlay.tsx` | Head ring, both arms and legs, torso sides and hips, no neck, rounded `#91CB7D` lines over a navy under-stroke, mirrored. |
| Sources | `src/movement-camera/source.ts` | The on-device engine (**absent**, see below) and the emulator-only synthetic test source. |
| Camera screen | `src/ui/CameraRepCounter.tsx` | Full-screen camera, count, Finish, Count by hand, failure and paused panels. It releases the camera on every way out. |
| Settings | `src/movement-camera/{settingsStore.ts,MoveCameraSettingsSection.tsx}`, `app/settings.tsx` | A MOVE section with Camera rep counter, and under it Show stick figure. Both default ON and are stored on this device only. |
| Routing, Adjust | `app/contribute/[goalId].tsx` | A squat "Start moving" goes to the camera, then Adjust, then the EXISTING review and Record. |

## The one thing not in this PR: the on-device engine

The repo has no pose model or camera dependency. The scope delta for `@mediapipe/tasks-vision` pinned exact at `0.10.35`, plus its lockfile, was asked on #497 `5997633763` and is **unanswered**.

Until that lands, `enginePoseSourceFactory` is `null`, so `cameraEntryAllowed(..., supported: false)` is false everywhere outside the emulator test gate. A real member's squat MOVE is therefore the existing manual flow. That is pinned by the e2e "without the test source … stays manual — fail closed".

Native fails closed the same way: no vision-camera, no permissions, no EAS change.

**Nothing here is evidence that counting works on a real body.** The donor's real-camera evidence remains the donor's.

## Synthetic test source (emulator + loopback only)

`window.__WSF_TEST_POSE__` is read only when `EXPO_PUBLIC_WSF_USE_EMULATORS` is `1`/`true` AND the page is served from loopback. This is the same gate as the demo-media test catalog.

- It draws a scripted stick figure and never opens a camera.
- It keeps `active` truthful, so the specs can prove the camera was released.
- Unit tests pin the gate: a production host, a missing flag or a malformed hook all read as null.

## Frozen target states → proof

| # | Target | Proof |
|---|---|---|
| 1 | Settings defaults ON/ON; stick figure hidden while the counter is off | unit `camera settings`; e2e `Settings: MOVE section …` (value kept while hidden, persisted across reload) |
| 2 | Squat + camera ON opens the camera directly | e2e happy path: no `wsf-contribute-move-screen` |
| 3 | Plain step-back guidance, no diagnostics | unit `camera cues are plain`; e2e `Step back so I can see you` |
| 4 | Countdown starts only on stable full body | unit `is ready only after FULL_BODY_STABLE_MS`; `GO is refused before ready` |
| 5 | Readiness loss cancels the countdown | unit `losing readiness mid-countdown …`; e2e `readiness loss cancels the countdown` |
| 6 | Baseline at GO; count starts at 0; pre-GO motion excluded | unit `squats before GO never reach the set` (fails under a zero-baseline mutant); e2e counting `0` after a pre-GO squat |
| 7 | Full-height camera, large count, one Finish, brief reacquire cue | e2e `Step back into view` while counting, count unchanged |
| 8 | Body guide ON: one figure, head ring, arms, legs, `#91CB7D` | unit `the body guide geometry`; e2e `data-head=ring`, `data-lines=8` |
| 9 | Body guide OFF: identical counting, no overlay | unit counts are identical with or without visuals; e2e `data-figure=off`, no `wsf-camera-figure` |
| 10 | Finish freezes and releases | unit `Finish freezes`; e2e `active === false` after Finish |
| 11 | Adjust: minus / number / plus, 0..500 | unit `adjust bounds`; e2e Adjust 3 → 4 |
| 12 | Continue enters the EXISTING review; nothing before confirm | e2e: zero contributions through Finish, Adjust, Continue and Edit; exactly `[4]` after Record |
| 13 | Failure offers manual entry | e2e `camera failure offers manual entry` (scripted permission failure) |
| 14 | Counter OFF: current manual flow | e2e `Camera rep counter OFF …` |
| 15 | Non-squat goals: existing flow | unit entry rule (`push-ups`, `squat`, `jump squats` …); e2e push-ups goal, `starts === 0` |
| 16 | Resumed/pending/unknown/confirmed: existing recovery | e2e planted unresolved attempt → pending screen, `starts === 0`; unit structural: the pending branch returns before `cameraOpen`, which requires `beforeWrite`, `!kiosk` and no round attempt |
| 17 | Close/background/unmount release; nothing invented | e2e hidden page → `Camera paused`, `2 squats kept so far.`, `active === false`, a fresh 3-2-1 resumes at 2; Close → released, zero contributions |
| 18 | No frame storage or upload; estimate unverified | unit `privacy: nothing leaves the device` (no MediaRecorder, canvas capture, fetch, Firestore or `odml.pa.googleapis`); `finish()` returns `source: 'camera-estimate', verified: false` |

Visual-only points (ears, elbows, wrists) are stripped before the session. A spy test proves the session only ever receives the nine counting keypoints, and a visuals-merge mutant fails it.

## Frames

The capture producer is `tests-e2e/move-camera-counter.spec.ts` with `WSF_CAMERA_LABEL=before|after`. It writes to `tests-e2e/artifacts/move-camera-counter/`, which is never committed.

- **BEFORE** (`0745c732`): Settings shows only the community privacy toggles. Squat MOVE lands on "Ready when you are." with the manual timer.
- **AFTER** (synthetic source): Settings with the MOVE section. Camera at acquiring, countdown, counting 0 and counting 3. Adjust. Camera failure.

## Reproduce

```sh
METADATA_SERVER_DETECTION=none npx -y firebase-tools emulators:start --config firebase.westayfit.emulators.json --project demo-wsf-local
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 npm --prefix apps/westayfit run build:web
cd apps/westayfit
npx vitest run tests/move-camera-counter.test.ts
WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 npx playwright test tests-e2e/move-camera-counter.spec.ts --workers=1
```
