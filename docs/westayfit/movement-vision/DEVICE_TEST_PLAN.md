# Camera squat counter: proposed device proof and acceptance plan

Prepared: 2026-10-03

Status: PROPOSED TEST PLAN. This document contains no completed human, iPhone,
kiosk, native, hosted or accuracy result. The accepted predecessor inspected
for this plan is `eda5821893937e89b2635237d42924221e00c3a9` (PR #475). Record
the successor's actual commit, exported artifact and served build before
executing a trial. A local edit or passing unit test is not a deployment.

## 1. The next decision

The next useful milestone is a scored real-person session on an actual iPhone,
followed by the same script on the intended kiosk. The existing synthetic
tests establish designed state-machine behavior. The fake-camera tests establish
parts of the browser/engine pipeline. Neither establishes real squat accuracy.

Keep this work isolated from community totals while that question is answered.
One movement, one active mover and a clearly stated camera setup are sufficient
for the first useful experiment. Additional movements, native adapters and
automatic contribution credit are separate later decisions.

## 2. What the current evidence does and does not establish

The predecessor README records 74 movement unit/static checks and six Chromium
browser cases from 2026-09-25. Those are historical claims at the predecessor,
not a fresh run at the successor. Its warped-photo camera fixture counted zero
reps. Its smaller edge-of-frame bystander was not detected. Consequently there
is no positive real-squat proof and no detected-bystander rejection proof from
those two fixtures.

The successor hardens those evidence boundaries:

- The warped-photo negative fixture requires exactly zero counts.
- The edge-person fixture explicitly records the engine's one-person detection
  limitation; it does not inherit a crowd-safety claim.
- The dependency check follows the actual CJS import and also scans the MJS
  bundle for the reviewed metrics endpoint. This is a narrow static guardrail,
  not proof that every possible dependency behavior is safe.
- Controlled browser requests must be GETs without bodies to exact, predeclared
  app/model/runtime URLs. Queries are permitted only on the exact test document
  URL. Same-origin traffic receives no blanket exemption.
- Engine assets are still intercepted for repeatability. This is deliberately
  a controlled pipeline test. A separate hosted run must fetch its real assets
  without interception.
- Required fixture or exact-export absence is reported as BLOCKED, not a
  successful skipped acceptance case.

Record fresh test outcomes separately. In a partial source checkout, a search
that finds no route links cannot establish that the complete app has no links.

## 3. Freeze the qualifying movement before scoring

The current signal estimates vertical hip travel relative to shin length and
the user's acquired standing baseline. The default down threshold is 0.6 and
the standing threshold is 0.25, each with a 100 ms dwell. The README's instruction
to bring hips roughly to knee height is not the same as a threshold at 60% of
the standing-to-parallel signal.

Decision proposed: agree on the intended qualifying cycle and align the member
instruction, human scoring guide and threshold before acceptance testing.
Record the rule explicitly. Do not describe this as a form assessment or an
independent verification of exercise. A motion estimate cannot establish intent
or identity.

Human scorers must be able to distinguish a qualifying completed cycle, a
clearly shallow cycle, an interrupted attempt and an ambiguous observation.
Resolve scoring disagreements before comparing the counter's result. Record
ambiguous cases and repeat them under clearer conditions; do not silently drop
only the disagreements that make the counter look worse.

## 4. Candidate record

Each scored candidate needs one record containing:

- Source commit and successor relationship to PR #475.
- Export/build identifier and exact served URL; confirm the served artifact.
- MediaPipe package version and executed bundle, WASM and model hashes.
- Counter, visibility, lock, continuity and camera configuration values.
- Device model, OS/browser version, front/rear camera selection, actual input
  resolution, orientation and setup category. Omit serial numbers and device IDs.
- Whether the run used controlled fixtures, a real live camera or a native adapter.
- Which checks passed, failed, were blocked or were not run.

Any change to a model, threshold, camera adapter or counting behavior creates a
new candidate for the affected proof. UI-only changes need focused interaction
verification; they do not justify pretending a new accuracy benchmark occurred.

## 5. Stages and exit evidence

### Stage A: repair the test instrument

Complete the concrete core/lifecycle fixes and their discriminating tests. In
particular, late camera/model startup must not resume after Stop, manual mode or
navigation, and repeated starts must not leak tracks or frame loops.

The lab must expose the candidate identifier, count, ready/paused state,
tracking interruption summary, selected engine/delegate and manual fallback.
Human testing uses no synthetic feed. Keep source and served evidence distinct.

Exit evidence: focused deterministic results plus a usable isolated HTTPS lab
whose exact artifact is known. Do not claim actual camera behavior until Stage B.

### Stage B: one-person iPhone smoke test

Use the actual iPhone in Safari with the selected camera, supported orientation
and a stable mount. A separate observer counts the person directly.

Suggested first script:

1. Start, grant camera access and wait for clear readiness.
2. Perform three sets of ten comfortable normal qualifying squats.
3. Perform five clearly shallow attempts; then stand still for thirty seconds.
4. Start a rep, leave or deliberately obscure the view, then return standing.
5. Complete a fresh full rep after readiness returns.
6. Stop and verify release. Test manual fallback, permission denial and a fresh
   start. Test cancellation while permission/model startup is still pending.

Record every miss and extra increment. This script answers whether one real
person/device combination works well enough to continue. It is not a general
accuracy certification. Fix obvious failures before expanding the sample.

### Stage C: actual kiosk smoke test

Repeat the same script using the actual kiosk, its real camera, browser,
orientation, mounting height, distance and likely lighting. "Kiosk" alone is
not a hardware specification.

Verify that a person far enough away to fit in the frame can read readiness,
pause messages and count feedback. Check whether the visible preview accurately
shows the input used by the counter. Record the minimum usable setup envelope;
do not assume the phone's result transfers to this camera.

### Stage D: calibration and freeze

Use a small calibration group to find obvious setup and model weaknesses.
Compare lite/full or CPU/GPU only when a measured weakness warrants it. A richer
model can also change inference cadence and interruption frequency.

Use the results to select the first supported setup, then freeze the candidate.
Do not tune against an acceptance session and count that same session as
independent acceptance evidence. Retain the previous candidate's report.

### Stage E: held-out pilot

Proposed engineering starting point: ten testers, three ten-rep sessions per
supported platform, covering normal, slow and quicker comfortable movement.
That gives 300 qualifying cycles and thirty sessions per platform; iPhone plus
kiosk gives 600 cycles in total. This is a pilot design, not a statistical
guarantee. Use people/settings that differ from calibration.

Complete the hostile matrix below on each intended platform, with repeated
trials rather than one successful demonstration. Report the number of trials
and exposure duration for every negative scenario. Avoid combining many weakly
tested setups into a reassuring overall average.

### Stage F: camera-assisted integration

Proposed first integration: an optional counter that produces a reviewable,
editable candidate count. Only the existing authenticated contribution path
and its confirmed response may affect the shared goal. Manual counting remains
available. Camera-estimated counts are not verified exercise.

Before this stage, separately prove cancellation, count review/correction,
source switching, submission retries, session binding and no double counting.
Do not build a second contribution ledger. A native camera adapter gets its own
real iOS/Android proof even if it reuses the same counter.

## 6. Required scenario matrix

All entries are NOT RUN until an actual candidate report says otherwise.

| Area | Cases | Evidence to capture in the aggregate report |
|---|---|---|
| Ordinary counting | Normal, slow, quicker; pauses at top and bottom | Human valid cycles, matched increments, misses, extra increments, exact-session result |
| Negative motion | Clearly shallow attempts, standing still, repositioning, bending, walking through | Extra counts and their scenario; clarify any visually indistinguishable motion limitation |
| Visibility | Feet/head cropped, leg occlusion, dim light, backlight, loose clothing | Loss/pause behavior, missed cycles, false readiness, recovery |
| Geometry | Supported distance and camera height boundaries; portrait/landscape as relevant | Readiness success, visible framing, count behavior; unsupported setup exclusions |
| Bystanders | Behind, brief front occlusion, edge exerciser, close neighbor | Detection availability, ambiguous-state handling, any other-person increments |
| Subject replacement | User leaves; another person occupies the same place; two people swap | Whether another person can inherit the active count; cannot infer identity from spatial continuity |
| Partial observation | Loss at descent/bottom/ascent; return standing or already down | Interrupted rep never completed later; next fully observed cycle handled correctly |
| Frame continuity | Missing pose; 200/250/300 ms gaps; long suspension; duplicate/out-of-order timestamps | No catch-up counts; interruption and missed-cycle totals |
| Permission lifecycle | Allow, deny, ignore then Stop, revoke, unavailable/busy camera | Correct outcome and recovery; no late restart or owned live tracks after exit |
| Resource lifecycle | Repeated Start/Stop, manual switch, route exit, model/inference failure | Exactly one current session, released resources, useful errors |
| Browser lifecycle | Background/foreground, screen lock/unlock, orientation change | Camera/loop state, clear readiness, no inferred completion across absence |
| Cold/degraded startup | Cold cache, slow/blocked runtime, slow/blocked model | Real asset availability, bounded understandable loading/error state, manual route |
| Connectivity | Offline after successful model load; cold offline attempt | Explicitly separate already-loaded inference from cold-start availability |
| Sustained operation | Repeated sessions for 10–15 minutes, then ordinary script again | Inference gaps, acquisition/miss rates, resource reuse and performance change |
| App truth | Finish/edit, cancel, switch source, retry/duplicate submission | Existing confirmation authority, correct actor/goal/session and count once |

Full occlusion and same-place replacement remain an identity limitation of this
spatial tracker. For a shared kiosk, an unresolved replacement case blocks any
claim of automatic member attribution. A proposed conservative response is to
halt for explicit session review/re-arming; a new identity system is not implied.

## 7. Metrics and proposed targets

Measure events as well as final totals. Ten predicted reps can hide one real
miss plus one invented increment.

- Recall: matched qualifying cycles / human-observed qualifying cycles.
- Precision: matched qualifying cycles / all counter increments.
- Exact-session agreement: sessions with correct totals and event matching /
  all attempted scored sessions.
- False-count exposure: unwanted increments during a stated number and duration
  of negative/hostile trials.
- Usability: acquisition failures/time, pauses, interruptions, manual fallback,
  restart failures and feedback delay.
- Performance: inference-duration and inter-result-gap summaries, including
  tail values when instrumented. Mean fps alone is insufficient.

A completed qualifying squat missed because the app lost tracking remains a
miss. Do not remove it from recall. A failed setup or abandoned unusable session
must appear in the report rather than disappearing from the denominator.

Proposed starting gates for limited camera-assisted staging integration:

- Zero observed wrong-person, stale-gap, duplicate and post-Stop increments in
  the required hostile cases.
- All required permission/cancellation/release checks pass. No recording,
  storage or unexpected upload behavior is introduced.
- At least 95% recall in each supported platform/setup group.
- Aim for at least 90% exact ten-rep sessions; inspect every remaining error and
  state its cause/limit. The session target is intentionally more demanding than
  a superficially good aggregate rep average.
- No serious systematic failure hidden by another group's better results.

These numbers are proposals, not current performance or a published accuracy
claim. Freeze the chosen gates before scoring acceptance. If the pilot fails,
improve the implementation or narrow the honestly supported setup and rerun
the affected evidence; do not relabel failing cases to create a pass.

## 8. Ground truth and minimal records

Use a live observer counting the person directly, preferably without watching
the counter total until the set ends. On difficult classification cases, two
observers should agree on the scoring rule. Match increments to cycles during
observation; retain only the aggregate matched/missed/extra totals.

This plan proposes manual aggregate QA, not automatic product telemetry.
Store only candidate/config identifiers, device/setup categories, scenario,
counts/error totals, coarse timing/performance summaries and pass/fail notes.
A temporary unlinked run number is enough. No names, contact/account IDs,
serials, body measurements, demographic profiles or exact locations are needed.

Do not retain live camera frames, videos, screenshots containing people, raw
landmarks, body trajectories or pose traces. Existing fake-camera screenshots
use the fixed third-party fixture and must not be reused against a live human
camera. If richer diagnostics become necessary, define and obtain the specific
scope first rather than quietly adding a recording or upload path.

Do not introduce product-wide age restrictions through this plan. Testing must
follow the project's existing eligibility and data boundaries.

## 9. Statistical limits

A small zero-failure pilot is not "100% reliable." Under an independent,
identically distributed Bernoulli model with zero failures, the one-sided 95%
upper failure bound is `1 - 0.05^(1/n)`: approximately 9.5% at thirty trials,
3.0% at one hundred and 1.0% at three hundred. These are calculations under that
model, not measured counter results.

Reps within the same person/session are correlated, and the intended population
is broader than a small pilot. Report distinct-testers counts in aggregate,
session outcomes and per-device/setup ranges. Do not equate three hundred reps
from a few people with three hundred independent people or deployments.

## 10. Parallel work and handoff

Coordination recommendation: one implementation owner for movement source, one
independent verifier for evidence. Other WSF workers continue their existing
surfaces. Integration can define the input/output contract while this lane
tests; it must not merge unproven camera estimates into production truth.

Use one concise report per candidate and one authoritative handoff through the
existing program process. Do not create duplicate worker packets, recurrent
no-op status comments or a second control-state system.

The first owner-ready handoff should provide the exact HTTPS lab URL, served
candidate identifier, a short test script, the aggregate result fields to report
and the remaining limitations. Do not send the owner an ordinary staging route
that still refuses to render the gated lab.

## 11. Technical sources and interpretation

- Google documents that web `detect()` and `detectForVideo()` are synchronous
  and block the UI thread. Measure the actual target hardware before selecting
  a performance strategy. Moving inference to a worker is an option to evaluate,
  not evidence that the present candidate already has that behavior.
  https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js
- Google lists Chrome and Safari for the web setup. This is platform support
  context, not a device pass for this counter.
  https://developers.google.com/edge/mediapipe/solutions/setup_web
- `MediaStreamTrack.stop()` immediately sets a track's ready state to ended but
  does not emit the ended event for that application-initiated stop. Verify owned
  tracks and cleared video references; another tab may still use the camera.
  https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/stop
- Playwright device emulation covers parameters such as viewport, touch and
  user agent. Its patched WebKit is not branded Safari. A CI WebKit run does not
  establish iPhone camera, hardware, permission or lifecycle performance.
  https://playwright.dev/docs/emulation
  https://playwright.dev/docs/browsers
- NIST describes exact binomial confidence intervals when failures or samples
  are sparse. The calculations above also require explicit independence and
  sampling assumptions.
  https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm

Sources reviewed for this plan on 2026-10-03. No public source substitutes for
the required real-person and real-device evidence on the exact candidate.
