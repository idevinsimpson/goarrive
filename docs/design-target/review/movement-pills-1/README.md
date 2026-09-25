# MOVEMENT-PILLS-1 — `/goals/new` movement selection (W6, checkpoint 1)

**Status: implemented and tested. Not accepted, not integrated, not staged.**
Packet: Director #365 `5834082617` §B, L0 handoff #456 `5834097050`, W6 ACK #456 `5834258147`.

| | |
|---|---|
| Base | development `claude/wsf-app-shell` @ `502b1e8d0c98c199445c664c696b3f73bb460f14` |
| Route blob | `cf71b4325a5f1dff58f23bbcb6c3d118be46566d` at base → **`3285d846f1880b201995d29b662f388c2537d448`** |
| New files | `src/movementSelection.ts` `3502176a…`, `src/ui/MovementPicker.tsx` `4d77602c…`, `tests/movement-selection.test.ts` `c1a272e1…`, `tests-e2e/sprint-w6-movement-pills.spec.ts` `e133c784…` |
| Producer | `apps/westayfit/tests-e2e/sprint-w6-movement-pills.spec.ts`, write gate `WSF_CAPTURE_FRAMES=1` |
| Environment | emulator `demo-wsf-local`; web bundle built at the route blob above with `EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1`; Chromium; `deviceScaleFactor` 2 |

Blobs were read with `git hash-object` on the working files before being written here.

## What a selection means

Decided by `src/movementSelection.ts`, as plain tested functions. The picker only reports a
selection; the route maps it onto a contract that **already exists** before submit is enabled.

| selection | contract | recorded |
|---|---|---|
| nothing | unchanged: the typed unit, one `wsfCreateGoal`, no guide key sent | as before |
| one movement | one `wsfCreateGoal` | `unit` = the movement, `activityGuideKey` = its own guide |
| several, counted the same way (squats, push-ups, sit-ups) | still **one** `wsfCreateGoal`: one goal, one total | `unit` = `squats + push-ups`, guide `reps`; the review says "Every squat and push-up counts once toward the same total." |
| counted differently (repetitions with steps or laps) | **none** | the reason under the pills, submit off, no request sent |

**Supported** means the app already ships a counting guide for that movement
(`activityGuides.ts`). Nothing is inferred from free text, and "burpees" typed by hand still
works exactly as before.

## Not built — reported for review

A goal with **its own total per movement plus a combined total** (`wsfCreateCombinedGoal`)
needs its child goals to exist first. `wsfCreateCombinedGoal` takes 2..6 existing goal ids and
does **not** check that their units agree. `wsfCreateGoal` has no idempotency key. So creating
children from this form would be several separate writes: a failure part-way could leave
children behind, and a retry could create them twice. Doing it safely needs one server call
that creates the children and the combined goal together, and refuses mixed units. That is a
backend contract change and is **not** made here.

## Measured

| check | result |
|---|---|
| `tests/movement-selection.test.ts` | 11 / 11 |
| full vitest | **886 / 886** (875 at base + these 11) |
| `sprint-w6-movement-pills.spec.ts`, ungated | 9 passed, 1 skipped (the recording), **0 bytes written** (all of `docs/design-target` sha256-hashed before and after) |
| same spec, gated | 10 passed; 10 frames + 1 recording, all in this directory and nowhere else |
| focused regression: the producer `sprint-w6-goal-setup-after-capture` and the ten behavioural `/goals/new` specs (`e5-goal-form`, `e5-community-goal-seam`, `ui-mobile-acceptance`, `ui-community-home`, `ui-combined-goal`, `ui-manage-event-first`, `kiosk-setup-link`, `move-follow-along`, `queue-call-by-name`, `station-enrollment`) | **50 / 50** |
| `ts:check` | exit 0 |
| `check-evidence-intact` | frozen 9 / accepted 20 intact |

The e2e reads each created goal back from the emulator: exactly **one** `wsfGoals` document
per submit, with the unit and guide key the table above says.

## Fail-first

Two real defects were found by the spec on the first run, before either was fixed:

- the pills rendered `role="checkbox"` with **no `aria-checked`**, so selection was invisible to
  assistive tech (react-native-web does not emit it from `accessibilityState`);
- **Space did not toggle** a pill (react-native-web activates on Space only for `role="button"`).

Mutants, local and never committed, each failing on its own assertion:

| mutant | failed at |
|---|---|
| the mixed-kind refusal removed from `mapMovementSelection` | 2 unit tests: the refusal and the cross-kind pair sweep |
| the submit gate on a mixed choice removed | e2e mixed case: `aria-disabled` expected `true`, received `null` |
| `activityGuideKey` dropped from the payload | e2e one-movement and several-movement cases: `toMatchObject` on the request body |

## Frames and recording

BEFORE is the base route, which is byte-identical to the accepted barless Goal Setup
(`cf71b432`): see `../goal-setup-next/after-barless/AFTER-form-top-390x844.png` and
`-390x640.png`. They are reused, not re-shot.

| file | what it shows |
|---|---|
| `AFTER-one-movement-390x844.png` · `-390x640.png` | Squats chosen: tick + navy pill, the unit shown not typed, "Every squat counts once." |
| `AFTER-one-movement-review-*.png` | the review's new **Counting** row |
| `AFTER-several-movements-*.png` | Squats + Push-ups: one goal, `30,000 squats + push-ups` |
| `AFTER-several-movements-review-*.png` | the review for that goal |
| `AFTER-mixed-refused-*.png` | Squats + Steps: the reason, no goal phrase, submit off |
| `RECORDING-selection-review-submit-390x844.webm` | a real browser recording: mixed refused → resolved → several → review → the real created receipt |

```
b0c9262255c10ae06d95378d71880782cbf44418c0e879f6d2b71a4c7c833b5f  AFTER-mixed-refused-390x640.png
003109069abb66132bb87384616e89419a3115001441a9eb90b5a33db18a628f  AFTER-mixed-refused-390x844.png
39eae4f738b7fb574589e3db8d3fefefbde1f34e6ed3608287f09af5c7e51414  AFTER-one-movement-390x640.png
cbc974c0f2e911cb3a27380e0f9b17ce87bee893e6c5ed56edf169d5cbd7d869  AFTER-one-movement-390x844.png
0e27b258e0a62b6d0f1dceca78242a26752c672621bc9d5dcf5c938d3a5c5258  AFTER-one-movement-review-390x640.png
eaf41b61c0cc47c4f24251d1f574e91bad89d7285b651c7e04edf1b4eb89db19  AFTER-one-movement-review-390x844.png
2557830f9028a4fe301156f5a87460b1797e87fcf93f5b8c4e2fff3c724d1a21  AFTER-several-movements-390x640.png
f9f71becbfdff93d6d4da326a4e86c24cde3ef056cfae768fd46402683e41832  AFTER-several-movements-390x844.png
063fd11835273f4934edeae042ff4357df3524368a522bb89762aa8fbe6dbfe9  AFTER-several-movements-review-390x640.png
eba71c6ee19db915ed102460d2e2b822b559d2c08f6002213b11300850d9b71f  AFTER-several-movements-review-390x844.png
c5e35f65fb13143c602a4ae958a1c48b954e1b5c2ba4e8e296b32cf9652fc3b0  RECORDING-selection-review-submit-390x844.webm
```

## Discrepancies from the Lovable reference

- **The reference has no multi-movement picker to match.** Per the Director, the Lovable project
  exposes only a read-only Squats sample. That sample is not treated as the requirement, and no
  parity claim is made for the pill layout itself.
- **The Activity mark** is the reference's lucide `activity` polyline redrawn from Views. The app
  has no icon library, and adding one is the owner's call. It is not the vector asset.
- **No per-movement pictograms.** Each pill is a word with a tick when chosen. Drawing a figure
  for each movement would invent artwork the reference does not have.
- **Movement-specific instructions** stay where they already are, on the contribution screen,
  keyed by `activityGuideKey`. Showing them inside the MOVE sheet is W9's APP-FEEL-PARITY-1.
- Chromium only. Safari was not measured.

## For W9 (kiosk setup)

`MovementPicker` takes `selected`, `onChange`, `disabled`, `label` and `testID` and owns no goal
state. `mapMovementSelection` gives the same answer on any screen. The kiosk's combined builder
is a different contract (existing child goals); mounting the picker there is W9's decision and
edit, not this packet's.

## Reproducing

```
npm --prefix functions-westayfit run build
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 npm --prefix apps/westayfit run build:web
METADATA_SERVER_DETECTION=none npx firebase-tools emulators:start \
  --config firebase.westayfit.emulators.json --project demo-wsf-local

WSF_CAPTURE_FRAMES=1 \
WSF_PLAYWRIGHT_CHROMIUM=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1) \
WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  npm --prefix apps/westayfit run test:e2e -- sprint-w6-movement-pills.spec.ts
```
