# Task 7/8 — Cross-surface product quality audit

Scope: the candidate as ONE product — Community Home → Contribution → return to Community → Shared Display. Method: an Opus read-only audit derived, from the shared helpers, the exact strings every surface produces for every state and checked the owner's consistency list item by item; one Opus implementer fixed the objective inconsistencies (updating the assertions they touched), built a self-checking matrix spec that captures the same synthetic goal on all three surfaces, and composed the boards; Fable integrated, pinned one test clock, and committed. Approved surfaces were not redesigned; where a difference is designed it is asserted as such.

## 1. State matrix (observed on screen by `ui-matrix.spec.ts`)

Unit squats, target 500, community "Maple Street Movers", closed window Aug 1 – 15 (America/New_York). CH = Community Home hero/card, CTB = contribute compact context/closed hero, DSP = display phone hero.

| State | Percent (CH / CTB / DSP) | Total line (CH / CTB / DSP) | Status (CH / CTB / DSP) | Fill |
|---|---|---|---|---|
| 0 of 500 | `0% complete` ×3 | `0 of 500 squats` ×3 | `500 to go` / — / `500 to go` | 0.0000 |
| 241 of 500 (48.2%) | `48.2% complete` ×3 | `241 of 500 squats` ×3 | `259 to go` / — / `259 to go` | 0.4820 |
| 450 of 500 (90%) | `90% complete` ×3 | `450 of 500 squats` ×3 | `Only 50 to go` / — / `Only 50 to go` | 0.9000 |
| 515 of 500, still open | `100% complete` ×3 | `515 of 500 squats` ×3 | `15 beyond our goal · still open` ×2 (CTB context has no status) | 1.0000 |
| 515 of 500, closed | none / none / none | `515 of 500 squats` / same / `515 squats completed together.` + `Goal: 500 squats` | `15 beyond our goal` ×3 | 1.0000 |
| 312 of 500, closed | none / none / `62.4% complete` | `312 of 500 squats` ×3 | `Closed at 62.4%` ×3 | 0.6240 |
| stale display | frozen at the last confirmed values, `Connection interrupted` pill, `Last confirmed h:mm` | | | |

The 52.2% and 99.9% rows share the shape of 48.2% and 90% respectively (derived from the same helpers; 4999/5000 → `99.9%`, fill `0.9998`, `Only 1 to go`) and are pinned by the existing we-states fixtures on Community Home and the display.

Designed differences, each asserted in the matrix spec: Community Home and contribute print no `N% complete` on a closed goal (the display still does for closed-unreached — approved in C2); the closed-reached display uses the achievement wording plus `Goal: 500 squats`; the contribute compact context carries no status line; headlines (`See what WE can do.` / `WE did it.` / `Look what WE did.`) are display-only; Community Home's eyebrow reads `Goal reached` only at reached-open. Every other cell agrees exactly. `artifacts/ui-matrix/matrix.json` records the measured strings.

## 2. Consistency checklist

| Item | Verdict |
|---|---|
| Wordmark | one component; navy on cream/white, white on navy; 22 px phone, 44 px wide. Asset note: the white colourway is ~2.5% narrower at the same height (different trim in the source art) — recorded, asset pipeline |
| Living WE geometry / fill | one component, one calibration table, unfilled colour matched to every parent surface; hero widths 280 (CH, contribute) vs 320 (display) — display scale is larger by design, recorded |
| Percent | one formatter, `N% complete` at every site (one decimal floored, no trailing `.0`) |
| Goal state / overshoot / reached vs closed | one `progressPhase`; totals never capped; closed markers differ by surface (cream pill on the display, green eyebrow on contribute, the "Past goals" section on Community Home) — approved in A2/B2/C, recorded |
| Timezone | goal-zone labels on both dated surfaces via one helper; the freshness clock is the device's own by design |
| Copy | `postTarget` subline now names the community like every sibling variant (**fixed**, A7) |
| Buttons / colours / spacing / typography | agree at the sizes that matter (gutter 20, hero padding 22 / radius 24, card radius 16, eyebrow 12/700), but tokens are re-declared per file and `wsfTheme.spacing`/`typography` are unused — refactor, not an inconsistency; recorded |
| Status language | one `statusLine`; near-goal emphasis now on the receipt too (**fixed**, A4) |
| Freshness language | `Confirmed h:mm` on Community Home, the display, and now the polled contribute context (**fixed**, A6); recovery verbs differ by design (`Refresh` on the member surface, `Check again` on the public one) |
| Error language | fixed member-facing copy on both member surfaces instead of the raw SDK sentence (**fixed**, A1); the display was already generic |
| Privacy messaging | same promise on the Champion card and the pre-grant explainer with two phrasings; sample note scoped correctly; the display carries no explanation (nobody consents there) |

## 3. Intentional gaps — the UI does not pretend

| Gap | Evidence |
|---|---|
| Authoritative one-time crossing event | `resultVariant` never attributes a crossing; `reached` copy is collective; a replay passes no before-total; `WE did it.` is a state, re-derived every poll |
| Repeat policy | no "Add another"; "recorded once toward this goal"; "It counted once." |
| Guided activity instructions | "Ready when you are." / "Count your own squats…"; timer disclaimed |
| Calibrated Living WE motion | transition returns null; nothing animates (asserted under reduced motion) |
| Recent privacy-safe public additions | no feed, no names; "Your part" shows only the signed-in member's credit |
| Complete durable community history | "Past goals" lists the closed goals the Champion keeps display-authorized and is omitted when empty; the code comment states the contract. The heading is the one place that could read as complete — an owner copy decision, recorded, no copy added |

## 4. Fixed in this task

| # | Inconsistency | Fix |
|---|---|---|
| A1 | raw `e.message` shown under "Something went wrong" on Community Home (red) and contribute (navy) | fixed copy on both, raw text to `console.warn`, navy body style on both |
| A2 | Community Home carried a byte-identical local copy of `ButtonLink` (without the array-style hardening) | shared component |
| A3 | Community Home had no reached signal while the receipt says "Our goal is reached." and the display "WE did it." | eyebrow reads `Goal reached` at reached-open (`wsf-community-goal-eyebrow`) |
| A4 | near-goal status emphasised on Community Home and the display, muted on the receipt | same emphasis on the receipt and closed heroes |
| A5 | contribute's closed hero printed `62.4% complete` above `Closed at 62.4%`; Community Home omits it by stated rule | percent dropped on the closed hero; display left as approved |
| A6 | the polled contribute context showed a live total with no freshness line | `Confirmed h:mm` under the compact text (`wsf-contribute-context-updated`); percent gains `wsf-contribute-context-percent` |
| A7 | `postTarget` subline "We're now at …" while siblings name the community | `Maple Street Movers is now at 515 of 500 squats together.` |
| A8 | `formatPeriod` omitted the year for a same-year window in another year (a 2025 goal read `Jun 1 – Jul 14`) | year carried whenever the window's year differs from now's year in the goal's zone; 5 unit tests; the existing 2026 fixtures now pin their clock |
| A9 | the phone display painted navy full-bleed while loading then flipped to the cream page on every open and every Check again | phone loading uses the cream page chrome; refusal/unreachable states unchanged (approved) |
| A10 | dead `freshnessStale` style | removed |

## 5. Boards

- `OVERNIGHT-VISUAL-BOARD.png` — 3000×18988, 5.7 MB: §1 the matrix (six states × three surfaces, element clips at 880 px with the derived strings in the gutter, plus the stale display), §2 the journey strip (01–07), §3 the honest states (unknown outcome, closed goal, display unavailable, display stale), §4 reflow thumbnails at 195/360 px and the disclaimer line. Cells are LANCZOS-downscaled, never upscaled; the phone frames in §2/§3 are scaled as whole frames to fit four across 3000 px.
- `OVERNIGHT-VISUAL-BOARD-WIDE.png` — 3056×5420, 1.0 MB: the four wide 1440×900 matrix captures plus the existing wide display states.

## 6. Recorded, not fixed

- `goalsState.message` is now never rendered (dead field; wider type change).
- The contribute freshness line and the poll are coupled by the compact context only rendering on pre-write screens; if it were ever rendered post-write it would claim a freshness it no longer has.
- A closed display goal with a corrupt stored zone renders no period at all (withheld rather than wrong; the open path says `Closed`/`Open`) — asymmetric, by design of "never substitute a zone".
- Token/typography drift and the closed-marker differences — refactors and approved choices.

## 7. Test receipts for this task

| Suite | Result |
|---|---|
| `ui-matrix` (new, self-checking captures) | 2 passed |
| `ui-community-home` 2, `ui-contribute` 7, `ui-display` 4, `ui-display-torture` 2, `ui-journey` 1, `e5-community-goal-seam` 4, `ui-qa` 5, `ui-a11y-fixes` 8, `ui-contribute-torture` 4, `ui-a11y` 22, `ui-contribute-torture-2` 7, `ui-display-torture-2` 5 | all passed |
| Vitest | 233 passed / 16 files |
| App TypeScript, build | clean |
