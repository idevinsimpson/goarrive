# Board 01 — Home

**Status: PRECISION REVIEW.** Creative direction and the privacy/visibility concept were **accepted** by PR #365 comments [`5771373306`](https://github.com/idevinsimpson/goarrive/pull/365#issuecomment-5771373306) (revision 6) and [`5771398679`](https://github.com/idevinsimpson/goarrive/pull/365#issuecomment-5771398679) (revision 7), which held the board for nine truth/precision corrections and said *"Do not conceptually redesign Board 01 again."* This is the precision candidate those corrections asked for. It takes the `_FINAL` name only when that review clears it.

`WE_STAY_FIT_NORTH_STAR_BOARD_01_HOME_CANDIDATE.png` · 2560×4380 (1280×2190 @2x)

`review-copy/` holds three lightweight JPEG copies — the whole board, the lifecycle panel and the seam panel — each under 1 MB, cut from this exact PNG for reviewers and connectors that cannot decode a 1.7 MB image. They are copies for reading, never the artifact; see `review-copy/README.md`.

## How it was made — captured, not drawn

The lock's first item was that every mark on revisions 1–7 was a generated approximation and the final must *"composite the exact owner wordmark and real calibrated LivingWeProgress output."* The captures are the product; targets and seams are compositions from the same exact assets and the same calibration table, labelled as such. (Round 3/4 clarification, `5781782947` §2 and `5781984220` §3: the earlier claim that *only* a photograph can carry the mark was too strong — a labelled target may composite the owner assets and calibrated output, exactly as Board 00 does.) So:

```
# 1. photograph every phone and every lifecycle state from the emulator build
WSF_CAPTURE_FRAMES=1 npm --prefix apps/westayfit run test:e2e -- tests-e2e/north-star-board-01-capture.spec.ts

# 2. composite them, deterministically, with the owner wordmark and the locked copy
node scripts/westayfit/north-star/render-board.mjs \
  scripts/westayfit/north-star/board-01.mjs \
  docs/design-target/north-star-final/board-01/WE_STAY_FIT_NORTH_STAR_BOARD_01_HOME_CANDIDATE.png
```

`captures/` holds the fourteen frames plus a JSON sidecar per fixture. Every frame is `LivingWeProgress` and the real Home route at 2×, on a synthetic community ("Smyrna Strong", the name the lock uses) whose members beyond the signed-in one are membership documents with no profile, no name and no activity. **Each state was asserted before it was shot** — the percent text, the status line, the `data-fill-ratio` attribute, the eyebrow, and which of two goals is featured — so a frame cannot be a picture of the wrong thing.

## The nine revision-7 corrections, one by one

| # | Held for | On the board |
| --- | --- | --- |
| 1 | Exact wordmark; real calibrated Living WE; 48% exact area fill; 100%/overshoot fully `#91CB7D`; no denominator = no mark | Owner PNG wordmark. Every mark is the product's own render: 241/500 at 52.67% height for 48.2% area; 512/500 fully green with "12 beyond our goal" kept in the number; the no-goal card carries no mark at all. |
| 2 | Lifecycle matrix omitted CLOSED / REACHED | Eight states in the strip, including **Closed · reached** ("Reached", 515 of 500) beside **Closed · unfinished** ("Closed at 22.5%"). Both are History rows, as the product renders them — a closed goal is never a hero. |
| 3 | Remove "We'll keep your progress safe." | The unavailable frame is the product's: *"Progress couldn't be loaded just now."* and **Try again**. Nothing else. |
| 4 | Remove "A new challenge will appear here." | The no-goal frames are the product's, member and Champion: *"No goal running yet"* with *"Your Champion can start one for this community."* / *"Start one and your community can begin contributing."* |
| 5 | Screen note must separate accepted capability from the intended seam | The SCREEN NOTE panel has one row for each, plus a row for where the build's words differ from the lock's. |
| 6 | Photos are permissioned concept only, never stock or fabricated; +18 = opted-in visible members, not movers | Stated on the seam panel. **No photo appears anywhere on the board.** The visible example is a name-and-role row with no image of any kind — correction 11 took the initials disc off it too, because #390's own members screen draws neither avatar nor initials. |
| 7 | Remove "Consistency — Showing up together." | Absent. The Champion frame's quiet context is a member count and the goal's status — both real. |
| 8 | Primary CTA must keep both journeys, short phone included | Every open-goal frame carries **Start moving** and **Already moved? Record squats**; the 390×640 frame shows the quiet route at the fold. |
| 9 | "Same experience. Different states. One community." is internal board copy | Rendered as the lead with the label INTERNAL BOARD COPY — NOT IN-APP MESSAGING; Board 00's pair named as the only governing public copy. |

## The two Round 2 corrections

PR #365 comment [`5781542755`](https://github.com/idevinsimpson/goarrive/pull/365#issuecomment-5781542755) is a **source-level check, not visual acceptance.** It named two things and nothing else, and nothing else was changed. No capture was retaken and no product capture was altered: all four phones and all eight captured states are the same PNGs, still labelled **CURRENT BUILD · CAPTURED**.

| # | Held for | On the board |
| --- | --- | --- |
| 10 | *"Current capability cannot erase intended North Star coverage."* The README had dropped **stale / last confirmed** because Home does not distinguish it | The strip has a ninth cell, **drawn**: a dashed inset carrying the building state's own confirmed values unchanged — 241 of 500, 48.2% complete, 259 to go, and the confirmed Living WE composed from the owner assets and calibration — under **Connection interrupted · Last confirmed 5:57 PM · Refresh**, tagged **TARGET · NOT IMPLEMENTED**. Nothing on it implies a movement event; only the screen's standing changed. |
| 11 | *"#390 authorizes opted-in name+role membership, not attributed movement/photos."* The seam panel's `Alex Rivera · added 20 squats` presented attributed movement as part of the approved seam | The approved pair now shows what #390 returns and only that: a members-list row of **display name + role**, and beside it the private counterpart — **not listed**, counted in full. The named-movement concept is a separate cell below the legend, struck through and labelled **NOT AUTHORIZED · NOT IMPLEMENTED**. The screen note's "Intended seam" row was saying the same untrue thing and is corrected with it. |

### Why a composition, and not an unresolved-seam cell

The direction allowed either: draw the stale state as a labelled target, or refuse to draw it and record an **UNRESOLVED SEAM** cell in the lock's own words. **It is drawn**, because the choice turns on whether drawing it would over-claim — and here it cannot, for a reason that only became visible from the source:

**the product already ships this treatment, just not on Home.** `app/display/[goalId].tsx`, `app/kiosk/[goalId].tsx` and `app/station/[goalId].tsx` each render

```ts
`${stale ? 'Last confirmed' : 'Confirmed'} ${formatClock(confirmedAt)}`
```

and the display adds the words **"Connection interrupted"** above it. Its own type says why: *"the confirmed values and their receipt time stay exactly as they were; the screen just stops presenting itself as current."* Home's `renderFreshness` has no such branch — it prints `Confirmed <time>` with **Refresh** whenever progress is `ok`, and nothing else.

So the cell invents no vocabulary and no behaviour. It is Home adopting a treatment three shipped routes already use, which is a target a reviewer can accept or reject on its merits rather than a drawing asking to be believed. An UNRESOLVED SEAM cell would have recorded a gap that is not actually unresolved anywhere but Home.

It **carries the confirmed Living WE at 241/500**, composed from the owner monogram PNGs and `living-we-calibration.json` exactly as Board 00's marks are (the same `heightFractionForFill` interpolation, so the green *area* is the area the product paints). A stale state has a valid last-confirmed ratio — it is **not** a no-denominator state — so the mark persists unchanged while the screen stops presenting itself as current; dropping it would have drawn a rule the product does not have. It is the one cell in the strip with a dashed edge, its own rule, and a tag — the eight beside it are photographs, and the difference has to survive being looked at quickly.

The older TARGET matrix at `docs/design-target/review/page-01-home/TARGET-home-state-matrix.png` is where this state was last reviewed — bottom-right cell, captioned *"Stale · last confirmed / The screen says when it last knew, rather than implying it knows now."* Worth knowing before comparing: **that cell's phone is cut off by the matrix image's own bottom edge at 1688×1200**, so only its header and the top of the hero survive in the file. The caption, and the treatment the product ships on the room surfaces, are what this cell was drawn from. That file is not this worker's to fix and was not touched.

Revision 6's list is covered by the same rows, and additionally: no notification bell and no streak appear (neither exists in the product); the visible-vs-private counterpart example is on the seam panel; the seam legend reads exactly *"Visible members shown by permission; private members contribute anonymously."*

## Where the build reads differently from the lock's wording

Reported rather than reconciled by hand:

- The lock keeps *"Add your contribution"* as the hero's emotional weight. The accepted build's hero primary is **Start moving**; "Add your contribution" is the build's wording on a *secondary* goal's card. Both journeys are present on every open goal. The board shows the build.
- The lock's "312 members" fixture is reproduced on the primary phone (312 membership documents); the other fixtures use 23.
- **Stale · last confirmed is in the strip, drawn.** Home does not distinguish it: `renderFreshness` prints *Confirmed \<time\>* with **Refresh** whenever progress is `ok`, and there is no other branch. The rest of the product does — `/display`, `/kiosk` and `/station` all swap in *Last confirmed*, and the display adds *Connection interrupted* — so the ninth cell is Home adopting a shipped treatment, tagged **TARGET · NOT IMPLEMENTED** and never counted as an after. The reasoning is in "Why a composition" above.
- **The seam is membership, not movement.** PR #390 returns `{ displayName, role }` for the visible active members of one community, and carries nothing about contributions; no callable attributes a contribution to a named member. Any board element that showed a named contribution was describing a capability that is neither approved nor built, and it now says so on its face.

## Found while making it

The first unavailable capture showed an empty outlined pill where **Try again** should read: the hero's retry label had been recoloured navy when the share control moved out onto the cream page, leaving navy on navy. Fixed on the app branch (`e609c57`) with two tests that assert the rendered colour, not the presence of the text; the frame on this board is the corrected product. The same pass repointed `e5-community-goal-seam`'s sign-out helper at You, which cleared the three timeouts PR #365 had been carrying as known.

## Nothing was filled from memory

Two things on this board are compositions, and both say so on their own face: the **seam panel**, and the strip's **ninth cell**. Neither carries a Living WE, because a mark on this board has to be real calibrated `LivingWeProgress` output and a drawing has none. Every other mark on the board — the four phones and the eight lifecycle states — is a capture of app `e609c57`, and every line of copy is either the product's own text or a quotation from the lock. The one fixture name on the board, `Alex Rivera`, was already here; no name, face, quote or reaction was invented for these corrections.

## What changed in the render, and why

Adding a ninth cell and a third seam cell would not fit the old canvas, so two geometry facts changed and nothing else:

- **The strip's cells are 106px (were 134), the drawn ninth is 156px.** Eight cells at 134 plus their gaps came to 1170 inside 1128px of panel, which is why the last caption used to sit flush against the panel border — that overflow is gone. The drawn cell is the wider one because its own words have to be legible; the captures are read through their captions.
- **The board is 1280×2190 (was 1280×1935).** At 1935 the screen note's last two rows and the footer were clipped off the bottom. Width is the set's constant — every board is 1280 — and height is per board already (Board 00 is 1400, Board 02 is 2470). The new height is the content's exact height: the footer sits on the bottom padding with no dead space under it.

Both were verified by measuring the rendered DOM, not by eye: no element overflows its parent, and `scrollHeight` equals the declared height exactly.
