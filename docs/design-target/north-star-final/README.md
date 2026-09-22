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
   the rendered board itself. **No board has this yet.**
4. **Deployment** — never implied by anything in this directory.

Every board here is a **RECONSTRUCTED REFERENCE** or a **CURRENT-BUILD
COMPOSITE**, never a recovered original PNG. A `_FINAL` filename is the lock
verdict's canonical name for the artifact, not an acceptance status.

Status column values:

`SELF-CHECKED · independent review pending` — rendered, opened, checked against
its lock by the lead; delivered for the Program Director's visual review.
`PRECISION REVIEW` — creatively locked, awaiting one final precision audit.
`PENDING` — not produced. **No placeholder image is ever presented as final.**

| # | Title | Status | Lock verdict | Capability shown | PNG | Last-reviewed SHA | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 00 | Brand foundation | **SELF-CHECKED** · independent review pending | `5770785512` | accepted build | [`board-00/…BOARD_00_BRAND_FOUNDATION_FINAL.png`](board-00/WE_STAY_FIT_NORTH_STAR_BOARD_00_BRAND_FOUNDATION_FINAL.png) | `2f088d7` | Governing constitution for 01–17. Rendered from the repo's own brand assets and Living WE area calibration; see `board-00/README.md` for the line-by-line check against the lock. **2026-09-22 (L0, from W2 audit):** overshoot caption reads "100% shown · the total keeps the overshoot" (D-00.1); the footer carries the reconstruction caveat on the board's face (D-00.2). |
| 01 | Home | **PRECISION REVIEW** | `5770964377`, corrected by `5771119797`, precision holds `5771373306` + `5771398679` | accepted build + labelled visibility seam | [`board-01/…BOARD_01_HOME_CANDIDATE.png`](board-01/WE_STAY_FIT_NORTH_STAR_BOARD_01_HOME_CANDIDATE.png) | `2f088d7` | Creative direction locked. Every phone and lifecycle state is a **real capture** of the build (`north-star-board-01-capture.spec.ts`), asserted before it was shot; the member-visibility seam is a labelled composition. See `board-01/README.md` for the nine corrections line by line. Takes the `_FINAL` name when the precision review clears. **2026-09-22 (L0):** column 2 labelled SCROLLED VIEW with a caption that describes the frame (D-01.1 / P-1); stale cell keeps its confirmed mark (P-9) and captions share a baseline (P-10) since `e9ad923`. P-8 open (capture-spec change; original sidecars preserved). |
| 02 | MOVE | **SELF-CHECKED** · independent review pending | `5771235529` | accepted build | [`board-02/…BOARD_02_MOVE_FINAL.png`](board-02/WE_STAY_FIT_NORTH_STAR_BOARD_02_MOVE_FINAL.png) | `95ae027` | Nine accepted Page 2 AFTER frames read in place, plus the reached and post-target confirmations captured by `north-star-board-02-capture.spec.ts`. Numeric differences from the lock's illustrative fixture are recorded in `board-02/README.md`. **2026-09-22 (W2, #399, integrated `7187286`):** the two fixture communities are disclosed in the differences panel (P-6); board height 2560. Self-checked by W2 — not independent of its own audit; L0 opened the render. |
| 03 | Community | **SELF-CHECKED** · independent review pending | `5771275765` | accepted build; Join placement seam | [`board-03/…BOARD_03_COMMUNITY_FINAL.png`](board-03/WE_STAY_FIT_NORTH_STAR_BOARD_03_COMMUNITY_FINAL.png) | `e609c57` | Seven accepted Page 3 AFTER frames read in place; the Join placement is a labelled product question, not a screen. |
| 04 | Progress | **SELF-CHECKED** · independent review pending | `5771310017` | accepted build (Phase A); dated history seam | [`board-04/…BOARD_04_PROGRESS_FINAL.png`](board-04/WE_STAY_FIT_NORTH_STAR_BOARD_04_PROGRESS_FINAL.png) | `95ae027` | Five accepted Page 4 AFTER frames read in place. "Nothing finished yet" has no standalone accepted frame and is shown inside the partial-read frame, flagged. **2026-09-22 (W2, #399):** the `Running and finished` caption states the frame is the whole first viewport, uncropped, and why the card beneath is cut (P-2). No pixel changed. |
| 05 | You | **SELF-CHECKED** · independent review pending | `5771338856` | accepted build | [`board-05/…BOARD_05_YOU_FINAL.png`](board-05/WE_STAY_FIT_NORTH_STAR_BOARD_05_YOU_FINAL.png) | `95ae027` | Six accepted Page 5 AFTER frames read in place; every lock state has one. **2026-09-22 (W2, #399):** the board's own lead line no longer claims a *dominant* mark; the lock's quoted wording is unaltered and a differences panel records the gap (P-4). |
| 06 | Create / join / auth | PENDING | `5771368550` | current build review | — | — | |
| 07 | Champion management | PENDING | `5771412585` | current Manage-sheet truth | — | — | Champion administration beyond the current sheet is an unbuilt seam. |
| 08 | Goal setup | PENDING | `5771436211` | staging-only current-build truth | — | — | |
| 09 | Lifecycle / history | PENDING | `5771469193` | lifecycle truth | — | — | |
| 10 | Public display family | PENDING | `5771496484` | target | — | — | Device classes are design targets, not installed hardware. |
| 11 | Single-goal kiosk | PENDING | `5771528649` | target | — | — | Device classes are design targets, not installed hardware. |
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
