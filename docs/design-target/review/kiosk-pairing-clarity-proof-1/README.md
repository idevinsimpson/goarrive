# KIOSK-PAIRING-CLARITY-PROOF-1: evidence

- **Packet:** Director #365 `5944922457` (queued) and `5945136749` (released). W9 ACK: #497 `5945165041`.
- **Base:** canonical development `9a506766`.
- **Product:** `4537c26c`, one commit. It touches exactly the three reserved files.
- **Evidence:** this commit, on its own branch (`claude/wsf-w9-kiosk-pairing-clarity-proof-1-evidence`), so the product PR's diff stays at three files.
- **Status:** delivered. Not reviewed, accepted, integrated or staged.
- **Emulator only** (`demo-wsf-local`). Nothing was deployed.

## What changed (copy only)

| Surface | ACTUAL BEFORE | ACTUAL AFTER |
|---|---|---|
| **Station, waiting** (`wsf-station-pairing-instructions`) | "In your community's Manage panel, open "Screens at this event", enter this code, and choose Station 1 or Station 2." | **"This is the venue screen. Approve it from your own phone."**, then:<br>1. On your phone, open your community, tap the menu, then Manage community.<br>2. Under Screens at this event, enter the code shown on this screen.<br>3. Choose Station 1 or Station 2 to match where this screen stands, then Approve. |
| **Station, waiting note** (`wsf-station-pairing-note`) | the sign-in disclaimer | "Each code works once and lasts ten minutes.", then the same disclaimer |
| **Station, expired** (`wsf-station-pairing-expired`) | "That code has expired. Get a new one and enter it within ten minutes." | "That code has expired and can't be used again. Tap Get a new code, then enter the new code on your phone within ten minutes." |
| **Champion, Screens card intro** (`wsf-kiosk-stations-intro-<goal>`) | "Open this address on each screen, then type the code it shows and choose which station it is. You can revoke…" | "Open this address on each venue screen. Every unpaired screen shows its own code, and you approve it here, on your own phone. You can revoke…" |
| **Champion, under "Approve a screen"** (new `wsf-kiosk-stations-steps-<goal>`) | — | "Enter the code shown on the screen you're pairing, choose the station that matches where that screen stands, then Approve. A code works once and lasts ten minutes; if it runs out, tap Get a new code on that screen." |

**Not changed:**
- pairing semantics, callables or their inputs;
- any existing test ID (one is added);
- shell navigation;
- station storage or credentials;
- backend, rules, indexes, auth, dependencies;
- Lovable references.

**Navigation named exactly as the shell has it:**
- the top bar's **Menu** button (accessible name "Menu");
- its **Manage community** row (`useMemberShellAction` label);
- the **Screens at this event** card inside the Manage sheet.

The focused proof clicks through those three by their real labels.

## Frames

`before/` is the unchanged base `9a506766`. `after/` is the build of the tree committed as `4537c26c`. Both come from the same journey and the same producer, gated on `WSF_KP_CAPTURE_DIR`.

- **Station frames** are full viewport at 1280×800, 390×640 and 390×844.
- **Champion frames** are the Screens card element at 390×640 and 390×844. They are element-scoped because the Manage sheet also renders the community's live invite link and QR (see the spec header).
- **Order:** every frame is taken only after that state's assertions.
- **Codes:** the pairing codes in frame are fixture codes. They are spent or expired by the end of the journey.

**Issued targets:**
- `docs/design-target/review/batch-e-room-screens/TARGET-station-pairing-waiting-1280x800.png`
- `TARGET-station-pairing-expired-1280x800.png`

Both are unchanged and unmoved. The hierarchy is kept: wordmark → headline → code → instructions → caption, in the same order, centred, in existing type. No new motion, no new control, same focus order. The expired state still has exactly one control, Get a new code.

## Focused proof (`tests-e2e/station-enrollment.spec.ts`, new test "pairing clarity…")

1. **Champion navigation:**
   - Menu (accessible name) → the Manage community row → the Manage panel;
   - display authorized;
   - the card reads "Screens at this event".
2. **New copy:** the Screens card intro and steps, then the station's waiting instructions and note.
3. **Each screen has its own code:** two fresh, signed-out screens each show their own six-character code, and the two codes differ.
4. **Real expiry:**
   - the first screen's pairing `expiresAt` is moved into the past in the emulator;
   - the station learns it through its own server poll;
   - the code disappears, the expired copy shows, and Get a new code is offered.
5. **The expired code is refused** on the Champion's phone ("not valid, or it has expired"), unchanged.
6. **Get a new code** gives a different code. Approved as **Station 1**, that screen becomes the event screen labelled Station 1.
7. **A spent code never works twice:** the used replacement, entered again for Station 2, is refused.
8. **The second screen**, by its own code, is approved as **Station 2** and labelled Station 2. Both rows are listed.

`WSF_KP_STAGE=BEFORE` skips only the new-copy assertions, because the base doesn't say them yet. Every behavioural assertion ran on the base too.

## Results

| Run | Build | Result | RAW |
|---|---|---|---|
| ACTUAL BEFORE capture (`WSF_KP_STAGE=BEFORE`) | `9a506766` | **1 / 1** (behaviour holds on the base) | `RAW-before-capture-9a506766.txt` |
| Fail-before: the new test, with copy assertions | `9a506766` | **fails**, as expected, on the first new-copy line | `RAW-fail-before-9a506766.txt` |
| `station-enrollment.spec.ts`, all three tests (the new one plus the existing enrolment/revocation and refusal journeys) | `4537c26c` | **3 / 3** | `RAW-station-enrollment-4537c26c.txt` |
| Specs that pair stations or render the Screens card: `queue-call-by-name`, `ui-combined-goal`, `ui-manage-event-first`, `ui-community-home`, `ui-a11y` | `4537c26c` | **37 / 38**, see below | `RAW-regressions-4537c26c.txt` |
| vitest, whole app | `4537c26c` | **1042 / 1042** | `RAW-vitest-4537c26c.txt` |
| tsc | `4537c26c` | **0** | `RAW-tsc-4537c26c.txt` |

**The one failure is pre-existing, not this change.**
- **Test:** `ui-manage-event-first.spec.ts:235`.
- **What fails:** it expects the Manage story line to contain "1 member"; it reads "No goal running yet".
- **On the unchanged base `9a506766`:** fails the same way in both of two runs (`RAW-manage-event-first-base-run{1,2}-9a506766.txt`).
- **Why it isn't this change:** the story line is not pairing copy, and this packet does not touch it.
- **Not fixed here:** fixing it would widen the packet beyond its payload. It is reported for routing.

## Browser and emulator versus device

- Everything here is **Chromium on the Firebase emulators**. Safari and native devices are not measured.
- **Hosted changed-journey proof** (the packet's completion) is the staging path's to produce. Nothing here is hosted.

`MANIFEST.sha256` lists every file in this directory.
