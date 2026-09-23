# WE STAY FIT — canonical North Star visual package

> **Every future design or visual implementation pass must open Board 00, the
> applicable canonical board, and the two owner north-star boards before
> editing product UI.**
>
> The owner boards are `../owner-north-star/OWNER-BOARD-1-before-current-wsf-experience.png`
> and `../owner-north-star/OWNER-BOARD-2-after-target-wsf-vision.png`.

This directory exists because of a **provenance problem, not a strategy
problem.** Boards 02–11 were locked in review on PR #365 with explicit final
artifact names and detailed lock verdicts, but their final rendered PNGs were
never persisted in this repository. A locked decision whose artifact lives only
in a chat history is a decision the next pass cannot open, and it drifts.

So this is a **reconstruction and persistence pass.** It does not reopen
product strategy and does not creatively redesign a locked board.

## How a board here is built

Reconstructed boards are **rendered deterministically from this repository**,
not generated as imagery. Each is composed from:

- the exact owner-supplied WSF wordmark and monogram assets (`src/ui/brandAssets.ts`);
- real `LivingWeProgress` output, or deterministic calibrated captures of it,
  for every Living WE state;
- actual accepted or current route captures wherever a board represents the
  **current build**;
- clearly labelled target/seam compositions where a capability is intended but
  not shipped;
- board text taken from the **lock verdict**, never invented marketing copy.

Explicitly not used: the old mountain-logo treatment, superseded slogans,
generic progress rings standing in for the Living WE, invented social, health
or streak data, and approximated or generated WSF letterforms.

**Where the surviving source cannot support an exact detail it is flagged in
the notes column and left out.** Gaps are not filled from memory.

## Status of every board

Four things are kept as separate statuses, because conflating them is how a
board gets treated as accepted when only its source screens were:

1. **Source-screen acceptance** — the product route the board depicts was
   accepted through the per-route gate in `../review/` (a fact about the
   product, recorded there).
2. **Reconstructed-board self-check** — the lead opened the rendered PNG and
   checked it line by line against the lock verdict (recorded in the board's
   README).
3. **Independent board review** — the Program Director has visually reviewed
   the rendered board itself. **Boards 00–09 and 11 + INDEX have it as of
   2026-09-23** — Boards 00–05 + INDEX by Program Director verdict
   `5783373780`, a pixel review of the commit-pinned 1× review copies at
   `a912773` (*PASS as the canonical reconstructed 00–05 package*); Board 06
   by Creative Director verdict `5784845039` on PR #404, a pixel review of the
   exported original at `d6aba97`; Board 07 by Creative Director verdict
   `5785727716` on PR #416, a pixel review of the exported original at
   `fe82c1e` (artifact `10723837867`, blob `df1a587`); Boards 08 and 09 by
   Creative Director verdicts `5786034310` (PR #409, exported original at
   `5674a86`, artifact `10724116667`, blob `bb72dacc`) and `5786014162`
   (PR #412, `8aae42d`, artifact `10724485128`, blob `f34cfaf3`); Board 11 by
   Creative Director verdicts `5786608901` / `5786639647` on PR #423, a pixel
   review of the exported original at `be3ff1b` (artifact `10725905242`, blob
   `124d3b1`), accepted **as a dated PRE-FIX current-build record only** — its
   row and README carry the kiosk use HOLD. It clears this status for these
   reconstructed artifacts only; it does not newly accept or stage the
   underlying app pages, and it authorises no deployment.

   The Director then retrieved the full package natively (workflow artifact
   `10717194625`, source `7dea164`, images identical to `41c053b`), verified
   every file against its manifest and opened both owner boards and all seven
   1× copies (`5783947669`). Creative notes recorded from that viewing, so the
   gap stays visible rather than being read as closed: Home has the right
   community-first structure, a dominant calibrated Living WE, restrained
   secondary goals and distinct paths, and MOVE's full-navy receipt is the
   strongest moment in the set; the owner TARGET is **more energetic than
   several CURRENT BUILD frames**, particularly the sparse You / Progress empty
   states and the utility-like entry areas — reference-package acceptance is
   not "the app has reached the entire premium vision", and energy is never
   regained by inventing faces, streaks, named activity or unapproved data.
   Board 02's short-phone captures are the frozen earlier source, not proof of
   the later #400 fix; Board 04 exposes and labels the old fold. Later
   authorised product changes are compared with matched new AFTER frames,
   never by silently replacing these.
4. **Deployment** — never implied by anything in this directory.

Every board here is a **RECONSTRUCTED REFERENCE** or a **CURRENT-BUILD
COMPOSITE**, never a recovered original PNG. A `_FINAL` filename is the lock
verdict's canonical name for the artifact, not an acceptance status.

Status column values:

`SELF-CHECKED · independent review pending` — rendered, opened, checked against
its lock by the lead; delivered for the Program Director's visual review.
`REVIEWED · independent board review passed <date>` — the Program Director
opened the rendered board and passed it (status 3). Statuses 1 and 4 are
unaffected.
`PRECISION REVIEW` — creatively locked, awaiting one final precision audit.
`PENDING` — not produced. **No placeholder image is ever presented as final.**

| # | Title | Status | Lock verdict | Capability shown | PNG | Last-reviewed SHA | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 00 | Brand foundation | **REVIEWED** · independent board review passed 2026-09-22 (`5783373780`) | `5770785512` | accepted build | [`board-00/…BOARD_00_BRAND_FOUNDATION_FINAL.png`](board-00/WE_STAY_FIT_NORTH_STAR_BOARD_00_BRAND_FOUNDATION_FINAL.png) | `a912773` | Governing constitution for 01–17. Rendered from the repo's own brand assets and Living WE area calibration; see `board-00/README.md` for the line-by-line check against the lock. **2026-09-22 (L0, from W2 audit):** overshoot caption reads "100% shown · the total keeps the overshoot" (D-00.1); the footer carries the reconstruction caveat on the board's face (D-00.2). |
| 01 | Home | **REVIEWED** · independent board review passed 2026-09-22 (`5783373780`) | `5770964377`, corrected by `5771119797`, precision holds `5771373306` + `5771398679` | accepted build + labelled visibility seam | [`board-01/…BOARD_01_HOME_FINAL.png`](board-01/WE_STAY_FIT_NORTH_STAR_BOARD_01_HOME_FINAL.png) | `a912773` | Creative direction locked. Every phone and lifecycle state is a **real capture** of the build (`north-star-board-01-capture.spec.ts`), asserted before it was shot; the member-visibility seam is a labelled composition. See `board-01/README.md` for the nine corrections line by line. Took the `_FINAL` name on 2026-09-22 when the review passed. **2026-09-22 (L0):** column 2 labelled SCROLLED VIEW with a caption that describes the frame (D-01.1 / P-1); stale cell keeps its confirmed mark (P-9) and captions share a baseline (P-10) since `e9ad923`. P-8 open (capture-spec change; original sidecars preserved). |
| 02 | MOVE | **REVIEWED** · independent board review passed 2026-09-22 (`5783373780`) | `5771235529` | accepted build | [`board-02/…BOARD_02_MOVE_FINAL.png`](board-02/WE_STAY_FIT_NORTH_STAR_BOARD_02_MOVE_FINAL.png) | `a912773` | Nine accepted Page 2 AFTER frames read in place, plus the reached and post-target confirmations captured by `north-star-board-02-capture.spec.ts`. Numeric differences from the lock's illustrative fixture are recorded in `board-02/README.md`. **2026-09-22 (W2, #399, integrated `7187286`):** the two fixture communities are disclosed in the differences panel (P-6); board height 2560. Self-checked by W2 — not independent of its own audit; L0 opened the render. |
| 03 | Community | **REVIEWED** · independent board review passed 2026-09-22 (`5783373780`) | `5771275765` | accepted build; Join placement seam | [`board-03/…BOARD_03_COMMUNITY_FINAL.png`](board-03/WE_STAY_FIT_NORTH_STAR_BOARD_03_COMMUNITY_FINAL.png) | `a912773` | Seven accepted Page 3 AFTER frames read in place; the Join placement is a labelled product question, not a screen. |
| 04 | Progress | **REVIEWED** · independent board review passed 2026-09-22 (`5783373780`) | `5771310017` | accepted build (Phase A); dated history seam | [`board-04/…BOARD_04_PROGRESS_FINAL.png`](board-04/WE_STAY_FIT_NORTH_STAR_BOARD_04_PROGRESS_FINAL.png) | `a912773` | Five accepted Page 4 AFTER frames read in place. "Nothing finished yet" has no standalone accepted frame and is shown inside the partial-read frame, flagged. **2026-09-22 (W2, #399):** the `Running and finished` caption states the frame is the whole first viewport, uncropped, and why the card beneath is cut (P-2). No pixel changed. |
| 05 | You | **REVIEWED** · independent board review passed 2026-09-22 (`5783373780`) | `5771338856` | accepted build | [`board-05/…BOARD_05_YOU_FINAL.png`](board-05/WE_STAY_FIT_NORTH_STAR_BOARD_05_YOU_FINAL.png) | `a912773` | Six accepted Page 5 AFTER frames read in place; every lock state has one. **2026-09-22 (W2, #399):** the board's own lead line no longer claims a *dominant* mark; the lock's quoted wording is unaltered and a differences panel records the gap (P-4). |
| 06 | Create / join / auth | **REVIEWED** · independent board review passed 2026-09-22 (`5784845039`) | `5771368550` | current build review — identity accepted at `3562156` and captured later; `/join/[joinCode]` awaiting its page verdict; `/start-community` target redesign drawn, not implemented | [`board-06/…BOARD_06_CREATE_JOIN_AUTH_FINAL.png`](board-06/WE_STAY_FIT_NORTH_STAR_BOARD_06_CREATE_JOIN_AUTH_FINAL.png) | `d6aba97` | W2 (PR #404); reviewed from the exported original (artifact `10721560350`, blob `3f0b556`); the PNG's own footer still reads its submission label. |
| 07 | Champion management | **REVIEWED** · independent board review passed 2026-09-22 (`5785727716`) | `5771412585` | current Manage-sheet truth — the three Home frames are the accepted Page 1 captured later; the fourteen sheet frames are current build; the expanded-details / QR / screens paths are disclosed, not pictured | [`board-07/…BOARD_07_CHAMPION_MANAGEMENT_FINAL.png`](board-07/WE_STAY_FIT_NORTH_STAR_BOARD_07_CHAMPION_MANAGEMENT_FINAL.png) | `ee4e4f8` | W2 (PR #416); reviewed from the exported original (artifact `10723837867`, blob `df1a587`); the PNG's own footer still reads its submission label. Two annotations travel with it (board README): the lock's "member directory not built" line is source-scoped to `5356e3c` and does not retire the separate #390 work; the event-first dense sheet and its invite-not-ready caveat remain product findings, not a premium standard. Champion administration beyond the current sheet is an unbuilt seam. |
| 08 | Goal setup | **REVIEWED** · independent board review passed 2026-09-22 (`5786034310`) | `5771436211` | staging-only current-build truth — the two arrival frames frozen at `02e24df`; a CURRENT BUILD strip from W4's real goal-setup captures (#415, source `0757379`); the target drawings kept non-authoritative where they conflict with the lock | [`board-08/…BOARD_08_GOAL_SETUP_FINAL.png`](board-08/WE_STAY_FIT_NORTH_STAR_BOARD_08_GOAL_SETUP_FINAL.png) | `5674a86` | W1B (PR #409); composition PASS `5784966469`, the coverage hold closed by the bounded revision `56fb683`, two captions corrected at `5674a86`; reviewed from the exported original (artifact `10724116667`, blob `bb72dacc`); the PNG's own footer still reads its submission label. Not page acceptance: the route stays available in staging and local emulators, production UI gated. |
| 09 | Lifecycle / history | **REVIEWED** · independent board review passed 2026-09-22 (`5786014162`) | `5771469193` | lifecycle truth — eleven accepted-build captures read in place, plus the corrected-below-target specimen photographed from a real reach and a real group-level correction (`review/lifecycle-corrected-current/`, W1B's gated producer) | [`board-09/…BOARD_09_LIFECYCLE_HISTORY_FINAL.png`](board-09/WE_STAY_FIT_NORTH_STAR_BOARD_09_LIFECYCLE_HISTORY_FINAL.png) | `8aae42d` | W1B (PR #412); layout PASS `5785588557`, the completeness hold closed by the supplement; reviewed from the exported original (artifact `10724485128`, blob `f34cfaf3`); the PNG's own footer still reads its submission label. No new History route, no dated personal history, no streak. |
| 10 | Public display family | PENDING | `5771496484` | target | — | — | Device classes are design targets, not installed hardware. |
| 11 | Single-goal kiosk | **REVIEWED** · independent board review passed 2026-09-23 (`5786639647`, `5786608901`) — **as a dated PRE-FIX current-build record only** | `5771528649` | current-build truth of `/kiosk/[goalId]` — fifteen real kiosk frames at 800×1280 (+ one 1024×1366) from W1B's gated producer (`review/kiosk-current/`), including the injected unknown-outcome and sign-out-failure states; no target drawing | [`board-11/…BOARD_11_SINGLE_GOAL_KIOSK_FINAL.png`](board-11/WE_STAY_FIT_NORTH_STAR_BOARD_11_SINGLE_GOAL_KIOSK_FINAL.png) | `be3ff1b` | W1B (PR #423); reviewed from the exported original (artifact `10725905242`, blob `124d3b1`); the PNG's own footer still reads its submission label. **The member tab bar on the kiosk contribution screen and the illegible `Stay` / chrome `Finish` labels it photographs are product holds, not accepted behaviour.** **SHARED / UNATTENDED KIOSK USE IS HELD** (`5786524650`): after this board was captured, W5 proved the bar leaves the previous visitor's own identity on the device without Finish/timeout (`5786450648`); correction by W1B on `claude/wsf-kiosk-confinement` (from `d0477cc`), independent verification by W5. This board and its captures are the historical BEFORE; a matched AFTER attaches separately once the fix passes. Device classes are design targets, not installed hardware. |
| 12 | — | PENDING | — | — | — | — | Not started. Paused until 00–11 clears. |
| 13 | — | PENDING | — | — | — | — | Not started. |
| 14 | — | PENDING | — | — | — | — | Not started. |
| 15 | — | PENDING | — | — | — | — | Not started. |
| 16 | — | PENDING | — | — | — | — | Not started. |
| 17 | — | PENDING | — | — | — | — | Not started. |

Every row will be filled as its board is reconstructed and reviewed. A row
stays `PENDING` until its PNG exists and has been opened and compared to its
lock verdict — not when the work is merely scheduled.

## Canonical filenames

A board takes its canonical name only once it clears review:

```
WE_STAY_FIT_NORTH_STAR_BOARD_00_BRAND_FOUNDATION_FINAL.png
WE_STAY_FIT_NORTH_STAR_BOARD_01_HOME_FINAL.png
WE_STAY_FIT_NORTH_STAR_BOARD_02_MOVE_FINAL.png
WE_STAY_FIT_NORTH_STAR_BOARD_03_COMMUNITY_FINAL.png
WE_STAY_FIT_NORTH_STAR_BOARD_04_PROGRESS_FINAL.png
WE_STAY_FIT_NORTH_STAR_BOARD_05_YOU_FINAL.png
WE_STAY_FIT_NORTH_STAR_BOARD_06_CREATE_JOIN_AUTH_FINAL.png
WE_STAY_FIT_NORTH_STAR_BOARD_07_CHAMPION_MANAGEMENT_FINAL.png
WE_STAY_FIT_NORTH_STAR_BOARD_08_GOAL_SETUP_FINAL.png
WE_STAY_FIT_NORTH_STAR_BOARD_09_LIFECYCLE_HISTORY_FINAL.png
WE_STAY_FIT_NORTH_STAR_BOARD_10_PUBLIC_DISPLAY_FINAL.png
WE_STAY_FIT_NORTH_STAR_BOARD_11_SINGLE_GOAL_KIOSK_FINAL.png
```

**No FINAL filename is invented for 12–17.** A board directory for an
unfinished board holds a status note and nothing else.

## INDEX.png

**The status word under each thumbnail is read from the table above at
render time** (`index.mjs`, since `2f088d7`), never from a filename: a `_FINAL`
name is the lock verdict's name for the artifact, not an acceptance status
(W2 audit D-IX.1).

`INDEX.png` is a contact sheet of real thumbnails of every completed board,
00–17 in order, with restrained labelled `PENDING` placeholders for the rest and
no fabricated screenshots. **It is navigation, not a substitute for opening the
full board.** It is rendered by `scripts/westayfit/north-star/index.mjs`, which
reads the package directory at render time, so a board appears on it only once
its PNG exists — the sheet cannot claim a board the directory does not hold.

## Review copies

`review-copies/` holds a 1× render of every board (`WSF_BOARD_SCALE=1`) —
the same module, the same layout, half the pixel density — for a reviewer
whose tools cannot decode the 2× original. A review copy is never the
canonical artifact and is re-rendered by the lead whenever its board changes.

## Review protocol

Before a reconstructed board is called FINAL:

1. open the rendered PNG;
2. compare it line by line to the cited lock verdict;
3. verify the exact WSF assets are used;
4. verify Living WE semantics — it fills from a true confirmed ratio and is
   never a decorative ring;
5. verify shipped-versus-target/seam labels;
6. verify no superseded slogan or capability survived;
7. verify legibility at full board and at useful zoom.

## Relationship to the rest of the atlas

This package does not replace or delete historical evidence. The per-route
gate — ACTUAL BEFORE → reviewed TARGET → ACTUAL AFTER → visual acceptance —
still lives in `../review/`, and the frozen evidence guard
(`scripts/westayfit/check-evidence-intact.mjs`) still governs it. This is the
**visual reference** layer above those: what the product is aiming at, in one
place, so a future pass opens one directory rather than reconstructing intent
from review threads.
