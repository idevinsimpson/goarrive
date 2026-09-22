# Board 11 — Single-goal kiosk

**Status: SELF-CHECKED · independent board review pending.** The `_FINAL`
filename is the lock verdict's canonical name for this artifact, not an
acceptance status. Locked by PR #365 comment
[`5771528649`](https://github.com/idevinsimpson/goarrive/pull/365#issuecomment-5771528649).

Status layer, from that lock: **CURRENT BUILD / REVIEW.** This board records the
route's state; it grants it nothing, and it takes nothing away from any
acceptance recorded elsewhere.

`WE_STAY_FIT_NORTH_STAR_BOARD_11_SINGLE_GOAL_KIOSK_FINAL.png` · 2560×4654 (1280×2327 @2x)

Released to W1B by the Creative/Product Director on PR #412, comment
[`5786014162`](https://github.com/idevinsimpson/goarrive/pull/412#issuecomment-5786014162)
— *"Board 11 reconstruction ONLY is now released; this explicitly supersedes the
old '10–17 unreleased' sentence for 11, not 12–17. W2 owns Board 10."*

**Cut from canonical `4fe1943`**, the verified head at branch time. Delta from
the head Board 09 was cut at (`d82890e`): roster commits plus the app-shell
merge `0b69f7b`, which brings the accepted Join correction and the extended
evidence guard. Neither touches the kiosk route nor any frame this board reads.

## How it was made

```
node scripts/westayfit/north-star/render-board.mjs scripts/westayfit/north-star/board-11.mjs \
  docs/design-target/north-star-final/board-11/WE_STAY_FIT_NORTH_STAR_BOARD_11_SINGLE_GOAL_KIOSK_FINAL.png
```

Ten frames, all read in place, none copied, altered, re-captured or re-encoded.

**Control before authoring.** The renderer was run against an untouched
committed board and reproduced
`board-03/WE_STAY_FIT_NORTH_STAR_BOARD_03_COMMUNITY_FINAL.png` **byte for
byte**. Board 11 then rendered identical bytes twice.

## The bounded inventory, and what it found

The Director allowed one gated producer *"if essential CURRENT-BUILD frames are
missing after a bounded inventory."* They were.

| Looked at | Found |
| --- | --- |
| `app/kiosk/[goalId].tsx` (408 lines), `src/kioskSession.ts` (289) | the route **is built** — resting hero, calibrated Living WE, `Confirmed`/`Last confirmed`, `Contribute here`, `Check again`, and a sign-out on focus |
| `review/batch-e-room-screens/` | thirteen kiosk **drawings** at 800×1280 and **no `before/` or `after/`**. Its own README: *"TARGET / CONCEPT — NOT IMPLEMENTED. Nothing here has been built."* |
| `review/batch-a-identity/after/AFTER-return-kiosk-*` | real frames of the **return to** the kiosk — the identity funnel's evidence, not this route's |
| everywhere else under `docs/design-target/` | no capture of `/kiosk/[goalId]` |

A board reconstructed from those drawings would have been a board about a
redesign. So the frames were produced from the running product.

## Sources

| Source | What it is | SHA |
| --- | --- | --- |
| `review/kiosk-current/**` | ten photographs of the running kiosk and its kiosk-mode contribution, produced by this board's own gated producer; `sha256` per frame in that package's README | this branch |
| `apps/westayfit/tests-e2e/sprint-w1b-kiosk-capture.spec.ts` | that producer | this branch |
| `app/kiosk/[goalId].tsx`, `src/kioskSession.ts`, `app/contribute/[goalId].tsx` | the route, cited where it explains why a frame looks as it does | `4fe1943` |

**There are no drawings on this board at all**, and one provenance only:
`CURRENT BUILD · CAPTURED`.

## Two device classes, and the threshold between them

Batch E drew the kiosk at **800×1280** portrait. The built route selects its
wide treatment at **`windowWidth >= 900`**, so at exactly the drawn class it
renders its **narrow** layout. Both are on the board — the drawn class and one
above the threshold (1024×1366) — because picking whichever flattered the other
would have hidden a real current-build fact. Whether the target class should
move or the threshold should is a product decision and is **left open**.

Device classes are design targets, **not installed hardware**. Nothing here
asserts what is standing in a room.

## The lock, line by line, against what the board shows

| Locked requirement | On the board |
| --- | --- |
| one display-authorized goal on one shared device | the resting frames; the unauthorized goal gets the refusal instead |
| always rests signed out; an attached account is signed out when the kiosk returns to focus | `kiosk-rested-after-finish` — the producer asserts the screen carries neither the account name nor the last visitor's amount |
| no individual identity on the start screen | asserted over the screen's whole text, not just a testID |
| exact wordmark + one calibrated Living WE from the same confirmed public pulse as Display | `data-fill-ratio="0.4820"` at 241 of 500, asserted before the shot |
| current confirmed total / status / confirmed time | `241 of 500 squats`, `48.2% complete`, `259 to go`, `Confirmed 11:30 PM` |
| stale retains the last confirmed truth with stale wording | `kiosk-stale` — same total, same fill, `Last confirmed 11:30 PM` |
| single primary `Contribute here` | the only control on the resting screen |
| the exact privacy/behaviour explanation | both lines photographed and asserted: own account, own count, *"Nothing about you stays on it after you finish."* |
| `Contribute here` records the handoff then goes through the ordinary auth/contribution journey | `kiosk-entry` — Back replaced by `Finish`, the product's own sign-in, the community hero unchanged |
| no kiosk-only counting logic | the entry and review frames are the ordinary route in kiosk mode |
| review previews own credit only and does not predict the shared total | `kiosk-review` — `0 → 20 squats` with the hero still at `241 of 500`; the producer asserts `261 of 500` never appears there |
| the confirmed receipt owns the new shared total and recalibrated mark (illustrative 261 of 500 = 52.2%) | `kiosk-receipt-finish` — exactly those numbers, reached by a real write |
| kiosk success substitutes `Finish` for the ordinary repeat/back controls | same frame |
| `Finish signs you out and returns this device to its start screen.` | photographed verbatim |
| automatic finish countdown is 90 seconds; `Stay` restarts it | `Finishing in 89 seconds` on the receipt; the producer asserts the countdown falls and that `Stay` makes it **rise again** — the Stay frame is in the evidence set and not reproduced on the board |
| loading = placeholders, not a fake Living WE | `kiosk-loading` — mark and number both asserted **absent** |
| transient failure before first confirmation = connection interrupted / retry, no invented total | `kiosk-unreachable`, kept visibly distinct from the refusal |
| refusal uses the same generic public-display refusal and requires explicit `Check again` | `kiosk-refused` — and the producer asserts the text names no reason and never prints the goal id |
| the kiosk never verifies who moved or whether movement happened | stated in the lock panel; nothing on any frame claims otherwise |
| no phone pairing, QR handoff, activity chooser, queue/turn/station assignment, participant-name callout or individual display | none appears; the producer asserts the resting screen's text contains none of those words, and the limits table names them as **Board 14's** |

### Two locked states with no frame

**The unknown outcome** — `KIOSK_UNRESOLVED_NOTICE` (*"Your attempt is saved to
your account; check it from your own device."*) with its explicit *"We don't
know whether it was recorded."* — and **the sign-out failure**, which must never
return to the resting screen while an account is still attached. Both exist in
the code and are covered by `ui-kiosk.spec.ts`. Neither is photographed here and
neither is drawn: reaching them needs a failure injected at a precise instant,
and a board does not fabricate a screenshot for a state it did not reach. The
board says so on its own face.

## Where the built route and the drawn target diverge

Recorded, not quietly adopted:

- the **start screen matches** the target's discipline — navy edge to edge, no
  chrome, no back, one action low on the canvas, nothing that scrolls;
- the **kiosk-mode contribution screen does not, yet**. Batch E's rule is that a
  venue screen has *no way off*; the built screen replaces Back with `Finish`
  **and still renders the member shell's tab bar** along its bottom edge, visible
  in the entry, review and receipt frames. Named as a **seam**, with no
  substitute drawn and no claim beyond what the pixels show;
- the **800×1280 class renders the narrow layout**, as above.

## What this board deliberately does not do

- It does not reproduce batch-e's drawings. A target is never an after, and this
  board is the current build.
- It does not invent QR or phone pairing, an activity chooser, a queue, turn or
  station assignment, a participant-name callout, an individual display or
  cross-device attempt recovery. Those are Board 14's intended experience,
  **preserved by naming** rather than backfilled or erased.
- It does not draw a reset, a timeout screen or any substitute for behavioural
  identity cleanup: what the device does at rest is photographed instead.
- It does not promote `/kiosk/[goalId]` to accepted-page status; it has none.
- It does not edit, re-capture or re-encode any source PNG, and it does not touch
  `lib.mjs`, `render-board.mjs`, `index.mjs`, the package README or manifest,
  `review-copies/`, the INDEX, any other board, `.github/`, app, backend or
  config code, any existing producer, or `check-evidence-intact.mjs`.

## Fixtures

"Maple Street Movers", "Squats together this week" and every number are
synthetic emulator fixtures, recorded in the evidence set's `fixture.json` and
unchanged here. The frames' own `SAMPLE DATA` strip is the build's emulator
banner, as captured. No real community, person or device appears.

## Verification

| Check | Result |
| --- | --- |
| Control render | Board 03 re-rendered **byte-identical** to its committed PNG |
| Determinism | Board 11 rendered twice, identical bytes (`cmp`) |
| Canvas | content height 2327 CSS px; footer at 2261–2291, inside the canvas; every panel and frame inside, nothing clipped |
| Evidence guard | `check-evidence-intact.mjs` → frozen BEFORE intact (9 paths), accepted TARGET / AFTER intact (20 paths) |
| Producer | 3 passed, 12 frames gated; ordinary ungated run writes no image (`helpers/capture`) |
| Typecheck | `npm --prefix apps/westayfit run ts:check` passes with the spec in place |
| Diff scope | `board-11/**`, `board-11.mjs`, `review/kiosk-current/**` and `tests-e2e/sprint-w1b-kiosk-capture.spec.ts` — the exact allowlist |

The new evidence set is **not** on `check-evidence-intact.mjs`'s freeze list.
That file belongs to the lead; adding these paths is their call.

## Nothing was filled from memory

Every claim on the board is a quotation from the lock, a property visible in the
frame it captions, a value from the evidence set's `fixture.json`, or a fact read
from a named file in this repository.
