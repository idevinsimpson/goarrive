# Board 01 — Home

**Status: PRECISION REVIEW.** Creative direction and the privacy/visibility concept were **accepted** by PR #365 comments [`5771373306`](https://github.com/idevinsimpson/goarrive/pull/365#issuecomment-5771373306) (revision 6) and [`5771398679`](https://github.com/idevinsimpson/goarrive/pull/365#issuecomment-5771398679) (revision 7), which held the board for nine truth/precision corrections and said *"Do not conceptually redesign Board 01 again."* This is the precision candidate those corrections asked for. It takes the `_FINAL` name only when that review clears it.

`WE_STAY_FIT_NORTH_STAR_BOARD_01_HOME_CANDIDATE.png` · 2560×3870 (1280×1935 @2x)

## How it was made — captured, not drawn

The lock's first item was that every mark on revisions 1–7 was a generated approximation and the final must *"composite the exact owner wordmark and real calibrated LivingWeProgress output."* The only source that satisfies that sentence is the running product, so:

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
| 6 | Photos are permissioned concept only, never stock or fabricated; +18 = opted-in visible members, not movers | Stated on the seam panel. **No photo appears anywhere on the board.** The visible example uses initials on a fixture member. |
| 7 | Remove "Consistency — Showing up together." | Absent. The Champion frame's quiet context is a member count and the goal's status — both real. |
| 8 | Primary CTA must keep both journeys, short phone included | Every open-goal frame carries **Start moving** and **Already moved? Record squats**; the 390×640 frame shows the quiet route at the fold. |
| 9 | "Same experience. Different states. One community." is internal board copy | Rendered as the lead with the label INTERNAL BOARD COPY — NOT IN-APP MESSAGING; Board 00's pair named as the only governing public copy. |

Revision 6's list is covered by the same rows, and additionally: no notification bell and no streak appear (neither exists in the product); the visible-vs-private counterpart example is on the seam panel; the seam legend reads exactly *"Visible members shown by permission; private members contribute anonymously."*

## Where the build reads differently from the lock's wording

Reported rather than reconciled by hand:

- The lock keeps *"Add your contribution"* as the hero's emotional weight. The accepted build's hero primary is **Start moving**; "Add your contribution" is the build's wording on a *secondary* goal's card. Both journeys are present on every open goal. The board shows the build.
- The lock's "312 members" fixture is reproduced on the primary phone (312 membership documents); the other fixtures use 23.
- "Stale · last confirmed" from the older TARGET matrix is not a state the product distinguishes — Home prints *Confirmed <time> · Refresh* under the actions in every confirmed state — so it is not in the strip.

## Found while making it

The first unavailable capture showed an empty outlined pill where **Try again** should read: the hero's retry label had been recoloured navy when the share control moved out onto the cream page, leaving navy on navy. Fixed on the app branch (`e609c57`) with two tests that assert the rendered colour, not the presence of the text; the frame on this board is the corrected product. The same pass repointed `e5-community-goal-seam`'s sign-out helper at You, which cleared the three timeouts PR #365 had been carrying as known.

## Nothing was filled from memory

The seam panel is a labelled composition and says so on its face. Everything else is a capture or a quotation from the lock.
