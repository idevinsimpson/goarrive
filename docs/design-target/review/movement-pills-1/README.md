# MOVEMENT-PILLS-1 — `/goals/new` movement selection (W6)

**Status: implemented and tested. Not accepted, not integrated, not staged.**
Packet: Director #365 `5834082617` §B, L0 handoff #456 `5834097050`, W6 ACK #456 `5834258147`.

| | |
|---|---|
| Base | development `claude/wsf-app-shell` @ `502b1e8d0c98c199445c664c696b3f73bb460f14` |
| Route blob | `cf71b432…` at base → `3285d846…` at `03cfddba` (held) → **`f30c069de863bbd4154e1dde937f7e122050bf1d`** (successor) |
| New files (successor) | `src/movementSelection.ts` `273dfb1f…`, `src/ui/MovementPicker.tsx` `f31dc5a6…`, `tests/movement-selection.test.ts` `ece0524b…`, `tests/movement-picker.test.tsx` `2ff0428e…`, `tests-e2e/sprint-w6-movement-pills.spec.ts` `796cbc25…` |
| Producer | `apps/westayfit/tests-e2e/sprint-w6-movement-pills.spec.ts`, write gate `WSF_CAPTURE_FRAMES=1` |
| Environment | emulator `demo-wsf-local`; web bundle built at the route blob above with `EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1`; Chromium; `deviceScaleFactor` 2 |

Blobs were read with `git hash-object` on the working files before being written here.

## The correction (successor to `03cfddba`)

The Director held `03cfddba` (#456 `5834379218`, #483 `5834767021`, pixel review `5834931103`).
The several-movement path was **enabled** and persisted only a joined `unit` and one generic
`activityGuideKey: "reps"`. No movement identifier reached the goal, so a reload or MOVE could not
recover the chosen movements. That path is now **off**:

- **The route is a single choice.** The picker runs in `single` mode on `/goals/new`, as a radio
  group. A second movement replaces the first. There is no "several" state to masquerade as
  persisted support.
- **The mapping refuses several** even when a screen allows them. `mapMovementSelection` returns
  `several` or `mixed`, neither carries a payload, and `isSubmittable` is true only for exactly
  one movement. `multiple` mode stays in the component for the screen that will have the seam.
- **"Something else" is an explicit choice** beside the catalog. It is reachable after a movement
  is picked, brings back the typed draft untouched, is a 44 px radio, and is reached by Tab and
  chosen by Space. It is also the default, which is today's form.
- **The hint says only what is supported:** "Pick a movement, or Something else to name your own."
  It no longer invites "several".
- **The picker sits below the goal phrase.** The first successor build placed it above the
  Target field. The focused regression caught that at 390×640: the accepted producer's claim that
  the goal phrase is on screen with its fields failed. The phrase's top was at 672 px against a
  640 px fold, because the picker is 212 px of 44 px targets. Below the phrase, the claim holds
  again at both classes, and choosing a movement updates the phrase directly above it.

| selection on `/goals/new` | contract |
|---|---|
| Something else (default) | unchanged: the typed unit, no guide key sent |
| one movement | one `wsfCreateGoal`: `unit` = the movement, `activityGuideKey` = its own guide |
| several / mixed | not reachable on this route; refused by the mapping everywhere |

**Supported** means the app already ships a counting guide for that movement
(`activityGuides.ts`). Nothing is inferred from free text.

## Proposed seam — for review, nothing built

The smallest contract that makes several movements real rather than a string. All of it is
additive and optional, so every existing goal reads exactly as today.

1. **On the goal.** Add `wsfCreateGoal({ …, movementKeys?: string[] })`.
   - It is validated server-side against a server-owned copy of this catalog.
   - It takes 1..6 distinct keys, **all of one count kind**. Mixed kinds are refused with
     `invalid-argument`, so repetitions are never added to steps.
   - It is stored as `movementKeys` on `wsfGoals/{id}`. `unit` stays the display word and
     `activityGuideKey` stays the single-movement override. Neither is ever parsed for identity.
2. **Read-back after reload.** `wsfMyContribution`, which already carries `activityGuideKey` to the
   contribution screen, also returns `movementKeys` when present. The `wsfGoalPulse` display
   payload is unchanged.
3. **MOVE.**
   - With one key, the screen behaves as it does today, with that key's guide.
   - With several, MOVE asks "Which movement?" from exactly those keys and shows that movement's
     own guide (`ACTIVITY_GUIDES[key]`).
   - No keys means today's behaviour. This is W9's surface (`app/contribute/[goalId].tsx`).
4. **Per contribution.** Add `wsfContribute({ …, movementKey? })`.
   - When present, it must be one of the goal's `movementKeys`, or the call is refused.
   - It is recorded on the contribution document only. The total, the idempotency key
     `(goal, uid, attemptId)`, shards and combined-parent credit are unchanged, and a
     contribution without it stays valid.
5. **One total, stated.** Several keys still mean **one** shared total in the goal's one count
   kind. There are no child goals, so there is nothing for a partial failure to leave behind.
   Separate per-movement totals remain the combined-goal contract's job.

**Files it would touch:**
- `functions-westayfit/src/index.ts`: `wsfCreateGoal`, `wsfMyContribution` and `wsfContribute`,
  plus callable tests;
- `app/contribute/[goalId].tsx` (W9);
- this lane's `movementSelection.ts` (the catalog becomes the client mirror);
- `app/goals/new.tsx`, switching to `mode="multiple"` behind the new field.

Rules and indexes need no change, because goals and contributions are written only by callables.
None of this is authorized yet.

## Measured (successor)

| check | result |
|---|---|
| `tests/movement-selection.test.ts` + new `tests/movement-picker.test.tsx` | 10 + 6 = **16 / 16** |
| full vitest | **891 / 891** (875 at base + these 16) |
| `sprint-w6-movement-pills.spec.ts`, ungated | 7 passed, 1 skipped (the recording), **0 bytes written** |
| same spec, gated | 8 passed; only the changed frames and the recording written |
| `ts:check` | exit 0 |
| `check-evidence-intact` | frozen 9 / accepted 20 intact |

Each created goal is read back from the emulator: exactly **one** `wsfGoals` document per submit,
with the unit and guide key above.

## Fail-first

- **Old tests against the corrected module:** the delivered `03cfddba` tests fail. Five fail,
  including "several … map onto ONE goal" and the cross-kind sweep expecting `individual`, so the
  old shortcut and the correction cannot both pass.
- **The shortcut restored** (`movements.length >= 1` submits the first movement): 2 unit tests
  fail, "several … are NOT submittable" and the cross-kind sweep.
- **The route put back in `multiple` mode:** 3 e2e tests fail. "a second movement replaces the
  first" fails because squats stays checked, and the radio role checks fail.
- **Something else removed:** 3 e2e tests fail. The default radio is missing, the typed-draft
  path has no way back, and Tab never reaches it.
- **From `03cfddba`, still valid:** the first run caught missing `aria-checked` and no Space
  toggle, and three mutants covered the mixed gate, the gate itself and the guide key.

## Frames and recording

BEFORE is the base route, byte-identical to the accepted barless Goal Setup (`cf71b432`):
`../goal-setup-next/after-barless/AFTER-form-top-390x844.png` and `-390x640.png`, reused.

**Only changed states were re-shot.** The `several-movements-*` and `mixed-refused-*` frames showed
the held path and are removed from this directory; they remain in git at `03cfddba`.

| file | what it shows | shot at |
|---|---|---|
| `AFTER-something-else-default-390x844.png` · `-390x640.png` | the default: Something else on, the typed field, the new hint | successor |
| `AFTER-one-movement-390x844.png` · `-390x640.png` | Squats chosen as a radio, Something else off | successor |
| `AFTER-something-else-after-movement-390x844.png` · `-390x640.png` | Laps picked, then Something else: the draft "burpees" back | successor |
| `AFTER-one-movement-review-390x844.png` · `-390x640.png` | the review's **Counting** row, unchanged | `03cfddba`, not re-shot |
| `RECORDING-selection-review-submit-390x844.webm` | typed draft → Squats → Push-ups replaces it → Something else restores the draft → Squats → review → the real created receipt | successor |

```
b804f1a93837f8654267002e5c3bf6113aa07074ab32f6b35fd78c383b40027a  AFTER-one-movement-390x640.png
1e8cfb7f6ac6c815657793627f047cf55c7a4d3e0020aaff0487e34145773d28  AFTER-one-movement-390x844.png
0e27b258e0a62b6d0f1dceca78242a26752c672621bc9d5dcf5c938d3a5c5258  AFTER-one-movement-review-390x640.png
eaf41b61c0cc47c4f24251d1f574e91bad89d7285b651c7e04edf1b4eb89db19  AFTER-one-movement-review-390x844.png
a41e72505c8f68c034772e8ddc2d929e63858ed7371763d2d4033c9bad4f1885  AFTER-something-else-after-movement-390x640.png
8d5b8b83eacbacb508a2618dd5aa4881a7010108e50633e3e8146b7a4b1bba97  AFTER-something-else-after-movement-390x844.png
031a16a18d2a6060bd3e7d37c5035c89b2eb4c3d4dad1dcb36dac1ab8895de57  AFTER-something-else-default-390x640.png
300b2eb9620945dfe521ed349be172f717a68365bde3428556fd2a9beaa05876  AFTER-something-else-default-390x844.png
2750202ff9d63e4ce7cb7cbcd63dd71fd4f6d435997188c4cd88d0e719244164  RECORDING-selection-review-submit-390x844.webm
```

## Discrepancies from the Lovable reference

- **The reference is a fixed "Squats (only supported sample)" field**, not a multi-movement
  catalog. It proves neither persistence nor multi-movement UX, and no parity claim is made for
  the pill layout.
- **The owner's one-or-multiple request is not complete.** This delivers the component, the
  one-movement flow and Something else. Several movements wait for the seam above.
- **The Activity mark is the reference's lucide `activity` polyline** redrawn from Views, since
  the app has no icon library. It is a heading mark, not per-movement pictograms.
- Movement-specific instructions inside the MOVE sheet are W9's APP-FEEL-PARITY-1.
- Chromium only. Safari was not measured.

## For W9 (kiosk setup)

`MovementPicker` takes `selected`, `onChange`, `mode` (`single` | `multiple`), `somethingElse`,
`hint`, `disabled`, `label` and `testID`, and owns no goal state. `mapMovementSelection` and
`isSubmittable` give the same answer on any screen.

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
