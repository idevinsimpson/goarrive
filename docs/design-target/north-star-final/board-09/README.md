# Board 09 — Lifecycle & history

**Status: SELF-CHECKED · independent board review pending.** The `_FINAL`
filename is the lock verdict's canonical name for this artifact, not an
acceptance status. Locked by PR #365 comment
[`5771469193`](https://github.com/idevinsimpson/goarrive/pull/365#issuecomment-5771469193).

Status layer, from that lock: *"CURRENT BUILD / REVIEW; this board locks
lifecycle truth, not a new History route."* Nothing gains standing by appearing
here, and nothing loses the standing it already had.

`WE_STAY_FIT_NORTH_STAR_BOARD_09_LIFECYCLE_HISTORY_FINAL.png` · 2560×8562 (1280×4281 @2x)

Released to W1B by the Creative/Product Director on PR #409, comment
[`5784862880`](https://github.com/idevinsimpson/goarrive/pull/409#issuecomment-5784862880)
— *"Explicitly superseding ONLY the '09–17 unreleased/no further packet'
sentence for Board09: W1B may now reconstruct Board09 Lifecycle/History,
independently of Board08 integration. Boards 10–17 are NOT released by this
comment."* Board 08 stays checkpoint-ready and not accepted; bounded corrections
from its review take priority over any further packet.

**Cut from canonical `d82890e`**, the verified head at the time of branching
(`docs(westayfit): roster — #408 integrated into app-shell at 0757379; Board 08
export artifact recorded; …`). This branch carries **no Board 08 code**: it is a
child of canonical, not of `claude/wsf-sprint-board-08`.

## How it was made

```
node scripts/westayfit/north-star/render-board.mjs scripts/westayfit/north-star/board-09.mjs \
  docs/design-target/north-star-final/board-09/WE_STAY_FIT_NORTH_STAR_BOARD_09_LIFECYCLE_HISTORY_FINAL.png
```

Eleven frames, every one read in place, none copied, altered, re-captured or
re-encoded. Nothing on this board was drawn by this worker.

**Control before authoring.** The renderer was run against an untouched
committed board at this branch's head and reproduced
`board-01/WE_STAY_FIT_NORTH_STAR_BOARD_01_HOME_FINAL.png` **byte for byte**.
Board 09 then rendered identical bytes twice.

## The one rule the whole board serves

A goal's present state is read from the **confirmed current total** against its
target and its open/closed status — `progressPhase()` in
`apps/westayfit/src/ui/progressFormat.ts` — and never from a historical stamp.
`reachedAt` is an event, and events do not un-happen.

Both surfaces that could print the reached date guard it on the **current**
phase:

| Surface | Guard | Source |
| --- | --- | --- |
| Community Home | prints the date only when `reachedAt` exists **and** the phase is `reachedOpen` or `closedReached` | `app/community/[groupId]/index.tsx:2170` |
| Progress | computes `reached` from `isReached(sharedTotal, target)`, and treats an absent `sharedTotal` as not reached | `app/activity.tsx` |

The build's own note records that this was once wrong: *"a goal corrected down
to 380 of 500 still wore REACHED, and still drew the celebratory Living WE,
because of something that had been true a week earlier."*

## Sources, and the SHA each was captured at

| Source | What it is | SHA |
| --- | --- | --- |
| `north-star-final/board-01/captures/state-{zero,building,near,reached-open,closed-reached,closed-unfinished,unavailable}.png` | real captures of the **accepted Home route**, one element each, made for Board 01; every state asserted before it was shot | `05a76bb` (2026-09-22) |
| `north-star-final/board-01/captures/phone-short-reached-open-390x640-actions.png` | the same reached-and-open goal on a short phone, scrolled to its actions | `05a76bb` (2026-09-22) |
| `north-star-final/board-02/captures/confirmed-post-target-390x844.png` | a confirmation past the target, 512 → 532 of 500 | `4fe51f0` (2026-09-22) |
| `review/page-01-home/correction-2026-09-22/ACTUAL-home-{history,alsounderway}-390x844.png` | Home's History and secondary rows **after** the one-mark correction | `6e1ce26` (2026-09-22) |
| `review/page-04-progress/after/AFTER-rows-390x844.png` | the accepted Page 4 AFTER evidence | `02e24df` (2026-09-21) |
| `apps/westayfit/src/ui/progressFormat.ts`, `app/community/[groupId]/index.tsx`, `app/activity.tsx` | the lifecycle rules, cited where they explain why a frame looks as it does | `d82890e` |
| `review/lifecycle-corrected-current/{home-reached-open-before-correction,home-corrected-below-target,progress-corrected-below-target}-390x844.png` | **Corrected Below Target**, photographed: the same goal reached and then corrected, and the member's own page. Product source proved identical to app-shell head | `44cc063` |

Fixture values come from the JSON sidecars committed beside the captures
(`state-reached-open.json` → 512 of 500; `state-history.json` → 515 of 500 and
90 of 400), not from reading numbers off a picture.

## Three provenances

| Tag | Meaning |
| --- | --- |
| `ACCEPTED BUILD · LATER CAPTURE` | Home and Progress are **accepted** at the staging pin `3562156`; these frames were shot afterwards, for Boards 01–02 and the one-mark correction. A later capture of an accepted route is a fact about the frame, not a demotion of the route. |
| `ACCEPTED BUILD · CAPTURED` | the accepted Page 4 AFTER evidence. |
| `CURRENT BUILD · CAPTURED` | the corrected-below-target trio, shot for this board at app-shell `44cc063`. |

## The supplement — Corrected Below Target, photographed (2026-09-22)

The first cut of this board had **no frame of this state on any surface**. It
said so on its own face and named the fixture a real one would need. The
Director opened the exported pixels
([`5785588557`](https://github.com/idevinsimpson/goarrive/pull/412#issuecomment-5785588557)),
passed the composition and layout, and held state coverage **PARTIAL** for
exactly that gap: *"the board's main lifecycle contract needs a visible
specimen, not only a text promise."* That is right — this board documents the
product's central lifecycle rule, and it should not be the one place the rule is
only asserted.

The Director then assigned the capture to this worker under an additional
exclusive allowlist. The evidence is
`docs/design-target/review/lifecycle-corrected-current/**`, produced by
`apps/westayfit/tests-e2e/sprint-w1b-lifecycle-capture.spec.ts`, and its own
README carries the per-frame `sha256` and the full method. In short:

1. the goal **actually reaches** its target — a real `wsfContribute` crosses it
   and the **server** stamps `reachedAt`; nothing is seeded reached;
2. a real **`wsfAdjustGoal`** by the community's own `foundingChampion`, with a
   reason, moves the confirmed total below target; no shard is hand-edited, and
   the producer sums the ten counter shards to prove the total is exactly 460;
3. the spec then reads the goal document and asserts **`reachedAt` is still
   there** — otherwise a missing date line would be evidence of deleted data
   rather than of a page reporting the present tense;
4. every post-correction assertion names the exact non-zero value, and the
   progress-error node is asserted absent, so **a zero is not a pass**;
5. the **positive case is preserved** twice over: the same goal is photographed
   reached before it is corrected, and a second goal — genuinely reached, closed,
   never corrected — keeps its `Reached` result on Home and its `REACHED` badge
   and full mark on Progress.

**Three things the frames show that the lock's prose does not, all stated on the
board:**

- the status line reads **`Only 40 to go`**, not `40 to go`: 460 of 500 is 92%,
  past the 90% threshold, so the goal lands back in **nearGoal** and takes that
  phase's wording. The lock's figure is illustrative of the numbers, not a copy
  string;
- the member's own part still reads **520** while the shared total reads 460,
  because a goal-level correction moves the **community's** confirmed total and
  makes no claim about whose contribution was wrong;
- Home reports a **confirmed snapshot** and says when, so the correction is taken
  the way a member takes it — by pressing the page's own `Refresh`. Reaching past
  that into the cache would have been staging the result.

**Writes are gated; the assertions are not.** `helpers/capture` documents both
shapes, and this spec asserts a regression the build has had before, so the guard
does not depend on somebody asking for pictures. An ungated run was verified to
write no image. If the lead prefers the plain `test.skip` shape the other capture
producers use, it is a one-line change.

## The lock, line by line, against what the board shows

| Locked requirement | On the board |
| --- | --- |
| Building / Near Goal are current open states driven by confirmed `sharedTotal` + target | `state-building` (241 of 500, 48.2%) and `state-near` (461 of 500, 92.2%, *Only 39 to go*), captioned with the 90%-of-true-target threshold |
| Reached/Open = target currently met and goal still open: Living WE full, `Goal reached`, optional `Reached on …`, contribution actions remain | `state-reached-open` (mark full, `GOAL REACHED`, *Reached Sep 22*) **and** `phone-short-reached-open-…-actions`, which shows `Start moving` and `Already moved? Record squats` still present |
| Post-target/Open: mark stays full, percent capped at 100%, overshoot visible in exact totals (`515 of 500`, `15 beyond our goal`) | `confirmed-post-target` — **532 of 500**, `100% complete`, *32 beyond our goal · still open*. The lock illustrates this rule with 515 of 500 / *15 beyond our goal*; the captured open fixtures are 532 of 500 and 512 of 500, and the board prints what each frame prints. 515 of 500 does appear on the board — as the **closed** reached row, which is a different phase |
| Closed/Reached = ended + target met: `Reached`, exact final total/period, no contribution action | `state-closed-reached` — *August push-ups · 515 of 500 push-ups · Reached · Aug 19 – Sep 2* |
| Closed/Unfinished: neutral `Closed at N%`, exact final total/period, no shame copy | `state-closed-unfinished` — *July stairs · 90 of 400 flights · Closed at 22.5% · Jul 20 – Aug 3* |
| Corrected Below Target: show the current phase/status, and **must not** print `Reached on …` as the present | **Photographed** — the same goal at `520 of 500 · 100% · Reached Sep 22`, then at `460 of 500 · 92% · Only 40 to go` with no date anywhere, while `reachedAt` is asserted still present in Firestore. The Progress frame shows the same rule by contrast |
| Only CLOSED goals appear in History; open goals stay active and are never duplicated | `ACTUAL-home-history` (two closed rows under `HISTORY`) beside `ACTUAL-home-alsounderway` (an open goal in the active section) |
| History is absent when there is nothing to record | Stated in the lock panel. The accepted Home AFTER frames seed one goal and contain **no** History section at all — which is that rule, though it is an absence and is not shown as a frame |
| A failed history/goals read is an error/recovery state, never a fake empty history | `state-unavailable` — *Progress couldn't be loaded just now.* + `Try again`, and **no mark at all** |
| Closed-history entries require a real `sharedTotal` + timezone before rendering | Stated in the lock panel |
| Each row keeps exact total + period; reached overshoot visible in numbers while the mark stays full | The two closed rows at reading size; the open-life row for the mark |
| Labels come from confirmed total + target + status — not rounded percent text, not `reachedAt` alone | The dark panel, with `progressPhase()` and both guards cited |
| `reachedAt` stays audit data; printed only in `reachedOpen` or `closedReached` | Same panel, with the Home guard's line reference |
| Closed goals definitively refuse new contributions, distinct from an unknown write outcome | Stated in the lock panel; the closed rows carry no action |
| Private dated personal history stays Board 04's separate unbuilt seam | *Not this board's subject* in the limits table. Nothing private, dated or personal is drawn |
| Status layer: CURRENT BUILD / REVIEW; not a new History route | Footer and limits table: History is a section of Community Home and a split on Progress, and it stays that |

## No mini Living WE was reintroduced

Community Home's secondary and History rows lost their mini marks in the
2026-09-22 one-mark correction, and **the frames used here are the corrected
ones** — the correction's own spec asserts exactly one `wsf-community-goal-we-*`
element on the screen.

Progress's finished section does carry one small mark. It is **current build**,
on a different surface, and it is the same one-per-screen rule: `activity.tsx`
renders `LivingWeProgress` only for `g === lead`, the most recent finished goal,
filled by that goal's real final shared total. The board says so on that frame's
caption, so an accepted frame is not mistaken for a relapse.

## What this board deliberately does not do

- It does not draw a state nobody photographed, and it does not let a target
  drawing stand in for one. There are **no target drawings on this board at
  all**.
- It does not propose a History route, an activity log, dates, streaks, a
  ranking or any comparison.
- It does not reproduce the 390×640 and 430×932 classes of the Home correction
  frames, or Board 04's loading / empty / failure / partial-failure states,
  which belong to the Progress page's own board.
- It does not edit, re-capture or re-encode any source PNG, and it does not
  touch `lib.mjs`, `render-board.mjs`, `index.mjs`, the package README or
  manifest, `review-copies/`, the INDEX, any other board, `.github/`, app or
  backend code, or any pre-existing test. `board-09.mjs` defines its one local
  helper — a card-crop frame — inside its own module. The supplement adds **one**
  new file outside the board's own directory, the gated producer the Director
  allowlisted, and touches no product, functions, config or shared producer.
- The new evidence set is **not** on `check-evidence-intact.mjs`'s freeze list.
  That file belongs to the lead; adding these paths is their call, not this
  packet's.

## Fixtures

"Smyrna Strong", "Alpharetta Morning Movers", "500 Squats by Friday", "August
push-ups", "July stairs", "Minutes walked in September" and every total on these
frames are synthetic emulator fixtures, recorded in the JSON sidecars beside the
captures and unchanged here. The corrected-below-target set carries its own
`fixture.json` naming the goal, the contribution, the correction and the
untouched control. No real community, person or activity appears, and
no names, faces, reactions, streaks, rankings or comparison appears anywhere.

## Verification

| Check | Result |
| --- | --- |
| Control render | Board 01 re-rendered **byte-identical** to its committed PNG, before the first cut and again before this supplement |
| Determinism | Board 09 rendered twice at this head, identical bytes (`cmp`) |
| Canvas | content height 4281 CSS px; footer at 4215–4245, inside the canvas; every panel and frame inside, nothing clipped |
| Evidence guard | `node scripts/westayfit/check-evidence-intact.mjs` → frozen BEFORE intact (9 paths), accepted TARGET / AFTER intact (18 paths) |
| Producer | `sprint-w1b-lifecycle-capture.spec.ts`: **1 passed, 3 frames** gated; **1 passed, 0 images written** ungated (frames hashed before and after) |
| Typecheck | `npm --prefix apps/westayfit run ts:check` passes with the spec in place |
| Diff scope | `board-09/**`, `board-09.mjs`, `review/lifecycle-corrected-current/**` and `tests-e2e/sprint-w1b-lifecycle-capture.spec.ts` — the exact allowlist, nothing else |

## Nothing was filled from memory

Every claim on the board is a quotation from the lock, a property visible in the
frame it captions, a value from that frame's committed JSON sidecar, or a fact
read from a named file in this repository.

## Not this worker's steps

The 1× review copy, the INDEX, the package README row for 09 and the export
allowlist entry for this PNG are the lead integrator's. The independent board
review is the Creative/Product Director's. **This board does not self-approve.**

## Independent board review — PASSED 2026-09-22

Creative Director verdict on PR #412, comment `5786014162`: a pixel review of
the exported original at head `8aae42d` (run `35796426467`, artifact
`10724485128`; PNG git blob `f34cfaf3` matched to the PR head) — *the only
outstanding completeness hold closed; final reconstructed CURRENT-BUILD
reference acceptance.* The path: layout PASS at `193c3bc` (`5785588557`) with
completeness PARTIAL for the Corrected Below Target specimen, closed by the
supplement at `8aae42d` (a real reach with a server-stamped `reachedAt`, then
a real group-level correction to 460 of 500, photographed on Home and
Progress; producer `tests-e2e/sprint-w1b-lifecycle-capture.spec.ts`, evidence
`review/lifecycle-corrected-current/`). Status 3 in the manifest is now
REVIEWED. Status-only: the PNG bytes are exactly the reviewed bytes; the
footer's submission label is historical and was deliberately not re-rendered.
The verdict accepts the reference artifact only: no new History route, no
personal dated-history backend, no streak, no deployment approval.
