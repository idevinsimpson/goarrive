# Board 10 — Public display

**Status: SELF-CHECKED · independent board review pending.** The `_FINAL`
filename is the lock verdict's canonical name for this artifact, not an
acceptance status. Locked by PR #365 comment
[`5771496484`](https://github.com/idevinsimpson/goarrive/pull/365#issuecomment-5771496484).

Status layer, from that lock: *"public display route / wide
propagation-revocation logic is CURRENT BUILD; portrait-frame composition +
QR-to-join are TARGET / SEAM as labelled."*

`WE_STAY_FIT_NORTH_STAR_BOARD_10_PUBLIC_DISPLAY_FINAL.png` · 2560×9260 (1280×4630 @2x)

Authorised as W2's packet by the Director's `5785727716` on PR #416. Cut from
canonical `7fbc45d3e7565519b48fb04731b1c9967f9ccb6a` — the exact ref that
release named, and also canonical's head when the branch was cut, so there is
no newer head and no delta to record.

## How it was made

```
node scripts/westayfit/north-star/render-board.mjs scripts/westayfit/north-star/board-10.mjs \
  docs/design-target/north-star-final/board-10/WE_STAY_FIT_NORTH_STAR_BOARD_10_PUBLIC_DISPLAY_FINAL.png
```

Twenty-three frames, every one read in place, none copied or altered. Nothing
on this board was drawn by this worker.

**Control before authoring.** The renderer was first run against an untouched
committed board — Board 03 — and reproduced it **byte-identically**
(`6072abdc…`).

**Every frame was opened.** All twenty-one current-build captures and all three
batch-f targets were read at native scale. Three of the findings below exist
only because the pixels were looked at; three more because the source was read
rather than the frame guessed at.

## Two provenances, and the lock requires them kept distinct

| Source | Actual state | Tag on the board |
| --- | --- | --- |
| `review/sprint-w2-board10/after/` | the **real `/display/[goalId]`** at canonical `7fbc45d`, captured for this board by `tests-e2e/sprint-w2-board10-capture.spec.ts` under the Director's release. Current build; this board gives the route no page verdict. | `CURRENT BUILD · CAPTURED` |
| `review/batch-f-public-display/TARGET-*` | the **portrait and wide artwork** — a redesign that is not implemented, captured from the gated preview route `/design-target/display-boards` rendering `DisplayBoardTargets.tsx`. Each frame carries its own TARGET strip burnt into the image. | `TARGET · NOT IMPLEMENTED` |

**Why a new capture set existed to make.** Checked across every tracked PNG in
the repository first: batch-f is a drawing of a redesign; the 28 committed
`e5-display-authorization` frames are the real route but at 1280×720 @1× and
are authorization-propagation evidence; `ui-display.spec.ts` shoots 390×844 and
**1440×900** and its artifacts are not committed. Nothing anywhere was a
current-build capture of the real route at a locked viewport. The producer is
gated by `WSF_CAPTURE_FRAMES=1`; the ordinary run asserts all eleven cases and
writes nothing, verified before the capture run.

## Checked against the lock, line by line

| Locked requirement | On the board |
| --- | --- |
| 390×844 phone preview = CURRENT BUILD route, read-only; cream page + navy hero + exact Living WE + anonymous recent additions | The six-frame phone row. Every ready frame asserts exactly one `wsf-display-we` before the shutter |
| **no member actions, raised MOVE or member tab bar** | Asserted by locator count on every ready state, not eyeballed. None appears anywhere |
| 800×1280 portrait = TARGET DEVICE COMPOSITION; current code below 900px still uses phone layout | Both halves shown side by side: the current frame with `data-layout="phone"` asserted, and the batch-f target beside it. The board never claims the portrait composition is wired |
| 1280×800 booth = CURRENT WIDE BUILD + North Star refinement | Three current frames and the target, with the refinement named in source terms rather than as taste |
| 1920×1080 collective = CURRENT WIDE BUILD + North Star refinement | Two current frames and the target, and the `weWidth` cap arithmetic that makes the refinement checkable |
| every composition shows the same confirmed numerator/denominator/phase, exact total, capped percent, status, last-confirmed time and anonymous recent additions | Each caption quotes the frame's own values; nothing differs between sizes but the composition |
| one exact / calibrated Living WE per coherent display; no individual identity anywhere | One per frame, asserted. Every ready state also asserts no uid, join code, member total or group type is in the document |
| public pulse polls every 2s; **no Living-WE animation timing is approved** | Stated on the lock panel; no animation is drawn or implied anywhere |
| recent additions: separate read, first tick then every 10s, at most 5 visible lines, ages advance locally | Stated on the lock panel; the frame asserts exactly 5 lines from 6 seeded additions |
| recent additions are `{amount, unit, age}` only — never id/name/avatar | Each line asserted against `+<amount> <unit> · <age>` and nothing else |
| stale = retain the last confirmed total and exact Living WE, but stop presenting it as current | The stale frames at all three sizes: the total and mark retained, `Connection interrupted` + `Last confirmed …`, `data-stale="true"` |
| before the first confirmation, transient failure has no number or Living WE to preserve | `display-unreachable`: total and mark both asserted absent |
| refusal/not-found is terminal: protected context, total and recent list leave the screen together | `display-not-available`: community, title, total, mark and list all asserted absent |
| recovery requires explicit `Check again` | The control is on both refusal frames and named on the lock panel |
| recent-list failure clears only that list and leaves a pulse-confirmed total intact | `display-recent-failure`: list gone, total and mark intact, and **not** stale — all asserted |
| reached/open, closed/reached and closed/unfinished distinct; percent caps at 100% while overshoot stays visible | Three separate phone frames; 515 of 500 reads `100% complete` with `15 beyond our goal` kept exact |
| QR-to-join shown only on shared portrait/wide displays as `INTENDED SEAM · NOT WIRED`, omitted from the phone preview | Its own navy panel, and it appears only inside the target frames — never on a current-build one, and never on the phone preview |

## What the pixels and the source said that the paperwork did not

Three refinement findings, each read out of `app/display/[goalId].tsx` at this
SHA rather than judged from a frame:

1. **The instrument shrinks relative to the glass as the room grows.**
   `weWidth = Math.min(640, Math.round(windowWidth * 0.42))`. At 1280 that is
   538px — 42% of the screen. At 1920 the cap binds at 640px — **33%**. The
   bigger screen shows the proportionally smaller mark.
2. **The freshness row has no wide variant at all.** `freshness` and
   `freshnessText` carry no `wide ? …` branch, so the `Connection interrupted`
   pill and `Last confirmed …` render at phone size on a 1920×1080 wall. The
   one element that tells a room its number is old is the least legible thing
   on the screen.
3. **The wide refusal is pinned to the top edge.** `canvasWide` sets
   `justifyContent: 'space-between'`, and the non-ready branch renders only the
   generic block and the test note, so the two go to the extremes and the lower
   two thirds of a booth screen is empty navy. The phone refusal is centred
   (`canvasPhone` uses `justifyContent: 'center'`), so the two do not read as
   one screen at two sizes.

And one about the evidence rather than the product:

4. **`SAMPLE DATA` is in every capture and never ships.** It renders when
   `wsfUsingEmulators` is true. On the navy canvases it is legible; on the
   cream phone page it is `rgba(247,245,240,0.78)` on `#F7F5F0` — cream on
   cream. Its absence from a phone frame is not evidence it is gone.

None of the four was fixed. The product was not touched.

## What this board deliberately does not do

- It does not grant the display route a page verdict, and it does not imply any
  hosting, privacy or release acceptance.
- It does not claim the portrait composition or QR-to-join is wired. Both are
  labelled targets, and the QR block in the artwork is an empty placeholder
  with no encoded code.
- It does not stage a picture of behaviour over time: the 2s / 10s cadence and
  the rule that a refusal cannot be resurrected by an earlier-issued success
  are cited from the repository's own `ui-display` suite, not dramatised.
- It does not repeat `display-building-390x844`, which is the recent frame's
  state without the list.

## Fixtures

Two synthetic sets, and neither continues the other: the current-build frames
carry **Maple Street Movers** (241 of 500 squats; 312 of 500 push-ups), the
batch-f targets carry **Riverside Church** (6,420 of 10,000 push-ups). No real
community, person or contribution appears anywhere. Error and in-flight frames
carry their injection in the filename (`INJECTED-NETWORK`, `INJECTED-DELAY`),
and no injected failure is presented as an organic one.

## Nothing was filled from memory

Every claim on the board is either a quotation from the lock, a property
visible in the frame it captions, or a line read out of the repository at a
named SHA. Where the lock did not settle something, it is not asserted.

## Independent board review — PASSED 2026-09-23

Creative Director verdict `5786952407` on PR #422, a pixel review of the
exported original at `aac62c0` (PR #425, run `35801222465`, artifact
`10725827245`, archive sha256 `7c2516c9…`; PNG git blob `6b863a55`,
3,245,603 bytes, 2560×9260) — *PASS as a reconstructed, dated CURRENT BUILD
+ explicitly labelled TARGET reference.* Status 3 in the manifest is now
REVIEWED. Status-only: the PNG bytes and the twenty-one
`review/sprint-w2-board10/` captures are exactly the reviewed bytes; the
footer's submission label was deliberately not re-rendered.

**What the verdict accepts.** The phone's one calibrated Living WE and no
member chrome, the lifecycle distinctions and the overshoot, the narrow
portrait build against the intended portrait composition, the wide variants,
retained stale truth, initial failure with no invented total, the generic
refusal and the list-only failure are visibly represented. The fixture
difference (Maple Street captures, Riverside drawings) is disclosed, so the
two are not presented as one implemented before/after. QR is NOT WIRED and
absent from every current-capture claim.

**What it does not accept.** The current public-display page as its finished
premium design, installed hardware, a QR implementation, a privacy or
production release, or any deploy. The product gaps stay explicit: the
800 px portrait still takes the narrow (phone) layout, room-scale text and
status are too small, and the wide failure placement needs recomposition.
They feed W2's separate public-display responsive TARGET checkpoint
(`docs/design-target/review/public-display-next/`), not a repaint of this
board.

This completes independent review of the initial Boards 00–11 package:
twelve reference boards, not twelve implemented pages. Board 11's PRE-FIX
qualifier and the shared/unattended kiosk use HOLD remain in force.
