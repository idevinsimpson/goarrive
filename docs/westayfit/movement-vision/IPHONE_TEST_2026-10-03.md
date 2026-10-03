# First iPhone test — REP-COUNTER-PROOF-1-r2

Recorded 2026-10-03. The first owner-operated iPhone smoke test is ready to attempt.
The build and source checks below are complete. Physical iPhone/Safari operation
and real-person counting accuracy are still untested.

## Open the candidate

[Private Safari preview](https://id-preview--c1b16a13-34ff-4878-b798-750cc63aa595.lovable.app/lab/rep-counter-proof)

Open this link in a new standalone Safari tab on the iPhone. If prompted, sign in
to the Lovable account authorized for this research project. No installation or
TestFlight build is needed for this browser experiment. The preview remains
private and unpublished.

Open Details and check that it says `REP-COUNTER-PROOF-1-r2`. This label identifies
the phone page. The separate reviewed-core line identifies PR574 at
`c4c241b6722886b8d01c027b5dd57539af04d818`.

Lovable reports the project ready at commit
`041e94b5f1ee8c98c6f2fe8465b4adcc9ee433ba`. The builder's browser checks ran against
its local development app. Its unauthenticated hosted-preview request returned
401. The Director's cloud browser also encountered the project's sign-in wall.
Authenticated owner access, the hosted asset response, and the revision actually
shown on the iPhone are therefore the first checks in this handoff.

If the direct preview link does not open after signing in, open the
[project editor](https://lovable.dev/projects/c1b16a13-34ff-4878-b798-750cc63aa595)
with the same account and use its Preview. Report the page or error you reach.
A missing/wrong revision is an access/build problem, not counting evidence.

## First trial: 5–10 minutes

1. Prop the phone securely in portrait orientation with the front camera able
   to see your whole body, including your feet, while standing and squatting.
   Begin with steady light and one person in view.
2. Tap Start camera and allow camera access. Let the model load, then stand
   upright and still until the page says "Tracking you".
3. Do ten comfortable squats, returning fully upright after each. Keep a
   mental tally, or have an observer count directly. Compare the displayed
   number, and note any missed or extra increments as they happen.
4. Tap Stop. The completed count should remain available for Finish. Tap
   Start camera again: the new set must begin at zero. Wait for tracking,
   then do three more squats and compare the count.
5. While the camera is active, switch to another app and return. The counter
   should remain stopped until you explicitly start it again. Try Count
   manually and its plus/minus controls.

Do not spend the first trial varying every condition. If the camera/model never
starts, tracking never becomes ready, or the page freezes, report that first.

Please report in this thread:

- Revision shown in Details.
- iPhone model and iOS version.
- First set: human 10 / detected __ / missed __ / extra __.
- After Stop and Start: began at zero yes/no; human 3 / detected __.
- Switching apps: stopped on return yes/no.
- Any error, tracking message or lag. If useful, include the engine and frame-gap
  count from Details as text.

No video, participant screenshots, raw poses or saved trajectories are needed.
Counts remain local to this experiment and do not create app contributions.

## What was verified

| Evidence | Result and boundary |
| --- | --- |
| Source parity | All eight core/controller files copied from PR574 match SHA256; the final r2 diff does not change them. |
| Independent core/controller tests | 75 passed: 51 counting/lock/fail-closed and 24 camera lifecycle. These run synthetic inputs and mocked dependencies. |
| Independent actual phone-page regression | The same two cases fail on r1 and pass on r2. Stop → Start cannot complete the prior partial; a fully observed fresh rep still counts exactly once. Pagehide alone stops resources and returns the actual controls to Start camera. React hooks, DOM, estimator and scheduling are mocked. |
| Builder wrapper tests | Three passed, covering fresh-set reset, the old failure as a control, and stopped count/manual carry-over. |
| Existing Lovable lab | Its 21 tests passed; its counter source and old route were not changed. |
| Builder typechecks/build | Builder reports exit 0 for both TypeScript configurations and production build. The commands and result summary are retained in the project. This is the Lovable app, not the Expo app export. |
| Builder browser instrument | Retained result reports 15/15 checks in headless Chromium with a fake camera: real pinned model startup, pending/active SPA route exits, pagehide/pageshow, manual reset and model-load failure. The feed has no person; no browser squat was counted. |
| Physical iPhone / human accuracy | Not tested. The owner trial above is the next evidence. |

The browser instrument does not directly observe a model's late close() call;
that disposal is covered by the deterministic lifecycle tests. Its no-cross-origin
request check describes the local test run. It is not a general proof about every
hosted request or the Lovable sign-in flow. The independent source instrument
does not replace the browser or iPhone checks.

See [the evidence manifest](IPHONE_CANDIDATE_EVIDENCE_2026-10-03.json), which retains
logs, exact source identifiers and proof limits. The portable independent
instrument is [qa/rep-counter-wrapper-regression.cjs](qa/rep-counter-wrapper-regression.cjs).
Run it with Node and TypeScript available from a checkout/snapshot of the selected
Lovable revision:

```sh
node docs/westayfit/movement-vision/qa/rep-counter-wrapper-regression.cjs /path/to/lovable-candidate
```

## Candidate changes and remaining risks

The new route uses the reviewed counter/core and cancellation controller through
a thin React DOM page and Vite asset adapter. It is separate from the existing
Lovable counter and from the repaired Expo component.

r2 makes every camera start stop/invalidate the old run, reset the movement
session, and clear per-run interruptions. Stop keeps the completed count for
review/manual use. Hiding/leaving the page stops the camera and updates its
controls; returning does not start capture. A mounted guard ignores obsolete
callbacks. The JS runtime loader is now an asset marked text/javascript, with
the same pinned bytes, and the temporary Blob URL approach was removed.

The runtime remains MediaPipe Tasks Vision 0.10.35 with the lite float16 v1 model,
three-pose capacity, GPU default and CPU fallback. Counting/lock thresholds are
unchanged. Only the SIMD runtime is hosted; unsupported browsers will need the
manual path. The loader's actual hosted behavior, physical GPU speed, camera
permissions, orientation and background behavior must still be checked on the
iPhone. The source's freshness rule interrupts counting after a frame gap over
250 ms, so slow inference can manifest as missed reps; do not weaken that rule
to conceal a performance issue.

The project's stricter type flags reject the byte-identical upstream core.
The experiment uses its own strict TypeScript configuration with three flags
aligned to upstream; the root app check excludes that folder and imports through
a typed entry point. Both checks are required. This is recorded scope, not proof
that the full Expo project passes its build.

## What follows the first trial

If Safari startup or basic counting fails, reproduce and repair that exact
failure before adding more conditions. Keep the regression and retest the same
phone/setup.

If the smoke test works, score repeat sets at ordinary and slower speeds, then
stillness, clearly shallow attempts, interrupted reps, leaving/re-entering,
bystanders, lighting and moved-phone cases. Count missed and extra events
separately: an exact total can hide offsetting errors. Use the fuller
[device proof plan](DEVICE_TEST_PLAN.md) to define the scored pilot and keep its
evaluation examples separate from tuning.

Then integrate through the app's existing editable count → review/Record →
server-confirmed receipt flow. The detector supplies a local estimate; user
confirmation and the existing contribution rules remain the integration boundary.
The real Expo/browser integration and its tests still need their own work.
Native camera support and station turn-reset behavior have separate prerequisites.

This thread owns counter quality and proof. The isolated research project and
draft PR let the other app/staging workers continue their assigned work. No
canonical app branch, staging deployment, shared backend, publication, access
audience or program assignment was changed by this phone candidate.

## Source identifiers

- GitHub core: idevinsimpson/goarrive PR574, `c4c241b6722886b8d01c027b5dd57539af04d818`.
- Initial phone page r1: Lovable `1cf152cb8be0e398654b73f5dab338ce7f992b3d`.
- Ready-for-owner-trial page r2: Lovable `041e94b5f1ee8c98c6f2fe8465b4adcc9ee433ba`.
- Project: `c1b16a13-34ff-4878-b798-750cc63aa595`.
- On-screen wrapper revision: `REP-COUNTER-PROOF-1-r2`.
