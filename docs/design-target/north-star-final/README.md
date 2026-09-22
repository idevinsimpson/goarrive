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

`FINAL` — reconstructed, reviewed against its lock verdict, persisted here.
`PRECISION REVIEW` — creatively locked, awaiting one final precision audit.
`PENDING` — not produced. **No placeholder image is ever presented as final.**

| # | Title | Status | Lock verdict | Capability shown | PNG | Last-reviewed SHA | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 00 | Brand foundation | PENDING | `5770785512` | accepted build | — | — | First artifact of this pass. |
| 01 | Home | PENDING | `5770964377`, corrected by `5771119797`, precision holds `5771373306` + `5771398679` | accepted build | — | — | Creative direction locked; needs the final precision pass before FINAL. |
| 02 | MOVE | PENDING | `5771235529` | accepted build | — | — | |
| 03 | Community | PENDING | `5771275765` | accepted build | — | — | |
| 04 | Progress | PENDING | `5771310017` | accepted build | — | — | Phase A only; private dated history remains an unbuilt seam. |
| 05 | You | PENDING | `5771338856` | accepted build | — | — | |
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

`INDEX.png` is a contact sheet of real thumbnails of every completed board,
00–11 in order, with restrained labelled `PENDING` placeholders for 12–17 and
no fabricated screenshots. **It is navigation, not a substitute for opening the
full board.**

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
