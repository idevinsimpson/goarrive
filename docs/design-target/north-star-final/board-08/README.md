# Board 08 — Goal setup

**Status: SELF-CHECKED · independent review pending.** The `_FINAL` filename is
the lock verdict's canonical name for this artifact, not an acceptance status.
Locked by PR #365 comment
[`5771436211`](https://github.com/idevinsimpson/goarrive/pull/365#issuecomment-5771436211).

Status layer, from that lock: *"CURRENT BUILD · STAGING-ONLY. Production cannot
access this route yet."* This board records the route's state; it **grants it
nothing** and takes nothing away from any acceptance already recorded elsewhere.

`WE_STAY_FIT_NORTH_STAR_BOARD_08_GOAL_SETUP_FINAL.png` · 2560×8302 (1280×4151 @2x)

Authorised as W1B's packet by the owner direction
[`5784428860`](https://github.com/idevinsimpson/goarrive/pull/365#issuecomment-5784428860)
§3 (*"W1B exclusive packet: reconstruct Board08 Goal setup from existing lock
5771436211, under board-08/\*\* + scripts/westayfit/north-star/board-08.mjs
only"*), over the lock `5771436211`. Cut from canonical `4fb22a6`.

**Delta from the SHA the direction named.** §3 names canonical
`c87419fb33184e3c2d87b48cfa2bbff2818a6e47` *"or verified newer head with delta
recorded"*. The canonical head at hand-off was `4fb22a6`. The delta is exactly
**one commit** — `4fb22a6`, a roster update — changing exactly **one file**,
`docs/design-target/THREAD-CONTINUATION-BRIEF-2026-09-21.md`. It touches no
renderer, no board, no frame and no app file this board reads. This branch is a
child of `4fb22a6`.

## How it was made

```
node scripts/westayfit/north-star/render-board.mjs scripts/westayfit/north-star/board-08.mjs \
  docs/design-target/north-star-final/board-08/WE_STAY_FIT_NORTH_STAR_BOARD_08_GOAL_SETUP_FINAL.png
```

Seven frames, every one read in place from `docs/design-target/review/`, none
copied, altered, re-captured or re-encoded. Nothing on this board was drawn by
this worker; the board is a composition of existing evidence, quotations from
the lock, and statements read from the route's own source.

**Control before authoring.** The renderer was first run against an untouched
committed board — Board 03 — and reproduced
`board-03/WE_STAY_FIT_NORTH_STAR_BOARD_03_COMMUNITY_FINAL.png` **byte for
byte** (`cmp`, no output). So the toolchain is faithful here and nothing on
Board 08 is an artefact of a different browser or font stack. Rendering Board 08
twice produced identical bytes.

## The central finding: this route is built

Board 06's status panel says *"`/goals/new` and `/combined/[setupId]` are
unbuilt as well"*, and batch-b's README says `/goals/new` is *"not
implemented"*. **For `/goals/new` that is not what the source says**, and the
owner direction asked explicitly that Board 08 not inherit the wording.

| Evidence | Fact |
| --- | --- |
| `apps/westayfit/app/goals/new.tsx` | exists, 1,036 lines, and renders every line the lock names — heading and copy, the three-field goal, the four durations, the quarter-hour preset, the device zone in words, the two repeat choices, `Check it over` on the same form, per-field validation after submit, `Start this goal` → `Starting…`, and the whole created state |
| blob identity | `e5be66f0e9afb03ae92c1ba3573fc641bd749ef3` at the staging pin `3562156` (`.github/wsf-staging/approved-candidate.json` on `main`), at the capture commit `02e24df`, and at the current app-shell head `5356e3c` — **one unchanged file across all three** |
| `docs/design-target/review/page-02-move/before/BEFORE-goal-new-390x{844,640}.png` | a frozen **photograph of the route rendering**, committed in `02e24df` — the same commit as the batch-b README that calls the route unimplemented |
| `apps/westayfit/tests-e2e/e5-goal-form.spec.ts` | exercises the form end to end: defaults, every validation message, the focus on the first refused field, Custom dates, the absent zone picker, the stored goal and the created screen's links |

**Independently corroborated by the Director.** This board was authored from
the sources above; the Director then reached the same reading from the same
commit, in the Board 06 pixel verdict
[`5784588305`](https://github.com/idevinsimpson/goarrive/pull/404#issuecomment-5784588305)
(2026-09-22 21:37Z): *"the lower status panel still says /goals/new is unbuilt.
At THIS SAME source commit, app/goals/new.tsx contains the working
staging/emulator-gated goal-creation route, consistent with Board08 lock
5771436211."* Board 06's own caption correction is W2's to make; nothing here
was applied to it.

What **is** unbuilt is the batch-b *redesign* of the route — the `TARGET-goal-*`
drawings. They were never implemented, and in three places they are not what the
lock locked either (below). Conflating "the drawing was never built" with "the
route does not exist" is the error this board exists to correct.

The correction is **recorded here, not applied to anyone else's file.** Board 06
and the batch-b README are W2's and an earlier package's files; neither was
touched.

## Revision — the current-build strip (2026-09-22)

The first cut of this board carried only the two arrival frames. The Director
opened it, passed the composition, and held the final reference gate **PARTIAL**
for a specific coverage gap
([`5785026250`](https://github.com/idevinsimpson/goarrive/pull/409#issuecomment-5785026250)):
*"two arrival-only images do not visually establish the locked repeat choices,
in-form Check it over, submitting or created screen. Five unimplemented redesign
images cannot substitute for those current-build states. Source descriptions are
useful but not pixel evidence."* That is correct, and the board now shows those
states instead of describing them.

W4 was assigned the capture packet and delivered sixteen frames
([`5785147873`](https://github.com/idevinsimpson/goarrive/pull/365#issuecomment-5785147873),
PR #415 at `7eb8ae1`, source app-shell `0757379`), integrated into canonical at
`26c87ce`. This branch took them by **merging canonical** (`--no-ff`), so the
reviewed commit `fb0846f` stays intact underneath.

**One bounded revision, exactly the three things asked for:**

1. the **CURRENT BUILD strip** — ten frames, two rows;
2. the status headline replaced verbatim with *"Available in staging and local
   emulators; production UI gated; page acceptance pending."*, because the old
   wording overstated this board's own paragraphs (b) and (c);
3. the Board 06 "unbuilt" reference **dated as historical**, now that its
   corrected board is accepted and integrated.

**Three constraints from W4's captures, honoured on the board:**

- the Custom window carries **no** derived "Starts …" line — they are
  alternatives, and the caption says so rather than leaving the absence to be
  noticed;
- **exactly two** repeat choices, and the third option in the old drawing stays
  labelled as a deviation from the lock;
- the summary is **on the same page** as the form, not a review step.

## Two provenances, two tags, never blurred

| Source | Actual state | Tag on the board |
| --- | --- | --- |
| `page-02-move/before/BEFORE-goal-new-390x{844,640}.png` | photographs of the real `/goals/new`, captured at `02e24df` (2026-09-21) and frozen by `check-evidence-intact.mjs`. Named BEFORE because they were shot as the MOVE package's baseline; what they photograph is this route. **Arrival only.** | `CURRENT BUILD · CAPTURED` |
| `goal-setup-current/**` (ten of W4's sixteen) | photographs of the same route **below the fold** — the window, both repeat choices, the same-page summary, validation, the in-flight call, the real created receipt, the refusals, no-community, signed out, and the short-phone receipt. Source app-shell `0757379`; capture `7eb8ae1`; `sha256` per frame in that package's README. | `CURRENT BUILD · CAPTURED`, plus `· INJECTED DELAY`, `· INJECTED NETWORK` and `· 390×640` where the frame needs it |
| `batch-b-join-and-setup/TARGET-goal-*` | the redesign — **drawn, never built**. Each frame carries its own `TARGET / CONCEPT — NOT IMPLEMENTED` strip burnt into the image. | `TARGET DRAWING · NEVER BUILT` |

There is no third *kind* of tag, because there is no third state: this route has
no accepted-page verdict and no `after/` set. The two injection suffixes are not
a third provenance — they say how a **real** state was reached, on the frame
itself rather than in a footnote.

### Why the injection markers are on the board's face

`INJECTED DELAY` held the **real** `wsfCreateGoal` call open long enough to
photograph `Starting…` and then **released it**, so the created receipt beside it
is that same call's answer, carrying a server-assigned goal id. `INJECTED
NETWORK` aborted the call to reach the refusal. **No success response is
fabricated anywhere**, and a reader should not have to take that on trust from
prose — so the frames say it themselves.

## The lock, line by line, against what the board shows

| Locked requirement | On the board |
| --- | --- |
| Champion enters from a community already known by route context; the page shows the community **NAME**, never its id | Both captures: `ALPHARETTA MORNING MOVERS` as the eyebrow, no id anywhere. Stated on the caption and in the lock panel; `e5-goal-form.spec.ts` asserts the form does not contain the group id |
| heading/copy remain `Start a goal` / `Set what your community will do together. Every contribution adds to one shared total.` | Visible verbatim on both captures |
| goal definition is one breath: Goal name + whole-number Target + free-text `What you're counting`, echoed as a phrase such as `5,000 squats` | The `The goal` card on both captures, with the route's own guidance line naming the phrase. The echo itself is below the fold — named, not drawn |
| duration choices are exactly 1 week / 2 weeks / 1 month / Custom | `1 week` selected on the arrival capture; **all four rows photographed** on `form-duration-derived-window` and `form-custom-window` |
| preset start is the current quarter-hour floor; preset end derives from that start | `form-duration-derived-window` — *Starts today at 10:15 PM* / *Ends Tuesday, Sep 29 at 10:15 PM*, a clean quarter hour; the rule itself is `quarterHourFloor` / `addDuration` |
| Custom exposes both start/end | `form-custom-window` — both controls filled, and **no** derived "Starts …" line, which the caption states as the route's own behaviour |
| time zone comes from the device, stated in words, not guessed and not a hidden picker | *Times are in Coordinated Universal Time* photographed under both windows and in the summary; the spec asserts no picker and no Change control exist |
| repeat policy defaults to `One contribution per member`; `Members can contribute again` is explicit | **Photographed twice**: the default selected on `form-duration-derived-window` and the explicit alternative taken on `form-summary-check-it-over`. Exactly two rows, never three |
| `Check it over` is a card/region on the SAME form, not a separate wizard screen | `form-summary-check-it-over` — the card follows the repeat card on the same scroll, its capture asserted with the form still present |
| summary reads back Community, Goal, Target, Starts, Ends, Time zone and Members policy | All seven rows photographed, ending *Members · Members can contribute again* |
| validation appears after submit, under its field; the first refused field receives focus/scroll | `form-validation-first-refused` — three messages each under their own field, the first refused field marked and brought into view. Its capture asserts zero error nodes before the submit |
| button state `Start this goal` → `Starting…` | `form-submitting` shows `Starting…` with the form disabled; `form-server-refusal` shows the primary back at `Start this goal` |
| mutually-exclusive server errors never stacked; refusals are human copy, no raw Firebase codes | `form-server-refusal` — **one** message, *"Something went wrong. Please try again."*, no code, and the typed work still on the form. The route holds one error string and maps codes through `describeServerError` |
| created: `Your goal is live` + `Send it to your members and put it on a screen.`, the summary, one primary `Open the contribute page`, secondary `Show on a big screen`, `Back to community` | `created-receipt` — every element, produced by the **real** `wsfCreateGoal`, the container carrying a server-assigned goal id that nothing on screen prints. `created-actions-390x640` shows the primary reachable on the short phone |
| no Living WE on setup/creation merely because a denominator exists | **No Living WE appears anywhere on this board**, and the status panel says why |
| common states — signed out → Sign in; unverified → Verify your email; no community context → `Choose a community before starting a goal` + go to communities; validation, server unavailable, submitting and created distinct | `signed-out` and `no-community` photographed; validation, refusal, submitting and created each have their own frame and stay visibly distinct. **Unverified has no frame**: the route answers that refusal with copy rather than a screen of its own, so none is invented |
| Status layer: CURRENT BUILD · STAGING-ONLY; production cannot access this route | The dark status panel, in five parts, including that the gate is client-side only — `wsfCreateGoal` has no environment, origin or hostname condition |

## Where the drawings disagree with the lock

Stated on the board so a future pass does not read the prettier picture as the
decision:

1. **Three repeat choices.** The drawing offers `Once / Once a day / No limit`.
   The lock fixes exactly two, and the route ships two.
2. **A different heading and ground.** `"Open a goal."` on a navy hero, in four
   numbered steps; the lock and the route say `Start a goal` on cream.
3. **A different no-community answer.** `"A goal needs a community." → Start a
   community`, where the lock and the route say `Choose a community before
   starting a goal` → `Go to your communities`.

The drawings' own wording differs from the route's in smaller ways too (*"Give
the goal a title."* vs *"Give your goal a name."*), and the created drawing
prints a policy line — *"No limit per member"* — the built form cannot produce.

## What this board deliberately does not do

- It does not promote `/goals/new` to accepted-page status. The staging record
  accepts five member pages and the identity funnel; goal setup is not among
  them, and nothing here changes that.
- It does not draw a state nobody photographed. On the first cut that meant the
  repeat policy, the summary, submitting, the created screen and the refusals
  were named from source and left undrawn; W4's captures now show them, so they
  are **photographed rather than described**, and nothing is drawn to fill a gap.
- It does not reproduce W4's whole set. `form-populated-top-390x{844,640}`,
  `form-duration-options` and `form-summary-check-it-over-390x640` are real and
  available; the strip keeps one frame per locked fact rather than a matrix.
- It does not show an **unverified-email** state. The route maps that refusal to
  copy (*"Verify your email address before starting a goal."*) rather than to a
  screen of its own, so there is no frame of it and none is invented.
- It does not reproduce the 430×932 class or the `-end` scrolled variants of the
  target set.
- It does not cover `/combined/[setupId]`, a read-only watch surface rather than
  setup.
- It does not adopt page-02-move's **unit-shortcut proposal** for this route.
  That package records it as an open owner decision; this board leaves it open.
- It does not edit, re-capture or re-encode any source PNG, and it does not
  touch `lib.mjs`, `render-board.mjs`, `index.mjs`, the package README or
  manifest, `review-copies/`, the INDEX, any other board, `.github/`, app or
  backend code, or any test. W4's frames are **read in place** by path; not one
  was copied, moved, re-encoded or re-captured, and `check-evidence-intact`
  confirms every frozen and accepted path is byte-unchanged.

## Fixtures

"Alpharetta Morning Movers" on the arrival frames, "Harbor Walkers" / "Autumn
squat challenge" / "30,000 squats" on W4's strip, and "The Henderson Family" /
"October Push-Up Challenge" on the drawings are synthetic and stay exactly as
captured. The strip's clock reads its own capture run's time. No real community, person or goal appears. No faces, names, quotes,
reactions, counts of people moving, streaks, rankings, public comparison,
health or body data, coaching upsell or forced sharing appears anywhere.

## Verification

| Check | Result |
| --- | --- |
| Control render | Board 03 re-rendered **byte-identical** to its committed PNG (first cut); Board 01 re-rendered byte-identical again before this revision |
| Determinism | Board 08 rendered twice at this head, identical bytes (`cmp`) |
| Canvas | content height 4151 CSS px; footer at 4085–4115, inside the canvas; every panel and every frame inside, nothing clipped |
| Evidence guard | `node scripts/westayfit/check-evidence-intact.mjs` → frozen BEFORE intact (8 paths), accepted TARGET / AFTER intact (16 paths) |
| Diff scope | `docs/design-target/north-star-final/board-08/**` and `scripts/westayfit/north-star/board-08.mjs` only |

## Nothing was filled from memory

Every claim on the board is a quotation from the lock, a property visible in the
frame it captions, or a fact read from a named file in this repository. Where the
lock did not settle something, it is not asserted.

## Not this worker's steps

The 1× review copy, the INDEX, the package README row for 08 and the export
allowlist entry for this PNG are the lead integrator's. The independent board
review is the Creative/Product Director's. **This board does not self-approve.**
