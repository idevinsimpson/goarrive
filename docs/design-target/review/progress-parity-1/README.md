# PROGRESS-PARITY-1 · Phase A — `ProgressParityView` (W6)

**Status: delivered for Phase A component QA and pixels. Not accepted, not integrated, not staged.**

This is the Phase A component only, not the route. `app/(tabs)/activity.tsx` belongs to W9 while
PERF-MOBILE-1 is live, and this lane leaves it byte-identical to base.

Packet sources:
- Director #451 `5840571885` (release), `5840750907` (reference fast path) and `5840756702`
  (concurrency correction).
- Re-sequenced from W8 to W6 by #365 `5840912166` §A.
- Token baseline `5840801009`, bundle format `5840805320`, and Phase A acceptance `5840942863`.

| | |
|---|---|
| Base | `claude/wsf-app-shell` @ `0b460ce3f2f0766406100fef14d9a444c8cad43a` |
| Product SHA | **`12cd9d697ccda8d93db75d40b99cd530a84a8850`**. It supersedes `5c4041f3` (the reference's period labels in the fixture, #495 `5841257894`) and `f79a3c49`. It is **stacked on You `66e56c4d`** by merge commit `9aacd613` (#365 `5841122582`), so the Progress delta is reviewed relative to You |
| Component | **`apps/westayfit/src/ui/ProgressParityView.tsx`**, blob `7514eea5` |
| Pure rules | `apps/westayfit/src/progressParity.ts`, blob `37dbc2bb`, on the shared `src/goalTruth.ts` (from You) |
| Fixture | `apps/westayfit/app/design-target/progress-parity.tsx`, blob `e12dde7b`. Emulator builds only; `?state=populated\|first-eligible\|no-open-goal\|partial\|failure\|receipts-contract\|unknown-shared` |
| Tests | `tests/progress-parity.test.ts` `930a120b` (20) · `tests/progress-parity-view.test.tsx` `b0eeca60` (14) · `tests-e2e/sprint-w6-progress-parity.spec.ts` `24b4f00d` (14) |
| Route | `app/(tabs)/activity.tsx` = base blob `ffbab845` — **protected-path delta: no** |
| Reference | Lovable `e15b9fa0-b2a0-4314-bc21-9c573b8eceb1` @ `09b8a73cc4e661115e52cb1ec4aebcb625c5fc9a`: `src/demo/screens/progress.tsx`, `src/demo/model.ts` (`progressView`, `baseView`), `src/demo/ui.tsx` (`StatusPill`), `src/styles.css` (including its `PROGRESS-FIRST-CONTRIBUTION` block) |
| Environment | emulator `demo-wsf-local`. Web bundle built from the product tree with `EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1`. Chromium, iPhone UA, `en-US`, `America/New_York`. Frames at device pixel ratio 1 |

## What the component is

`ProgressParityView({ state, actions, bottomInset? })` takes resolved canonical facts and four
callbacks: `onRetry`, `onStartMoving`, `onOpenCommunity` and `onOpenReceipt(id)`. It has no
Firebase read and no router, auth or storage dependency, and it carries no demo authority.

Its `ProgressState` is a union of four cases:
- `loading`;
- `signedOut`;
- `failed{memberName}`;
- `ready{memberName, open, finished, partial, canStart, receipts}`.

Every goal carries `yourPart` and `sharedTotal` as separate fields. `sharedTotal` is
`null` when the aggregate read did not answer.

The order is the reference's:
1. **PRIVATE TO YOU · ALEX M.**, then **Your progress**, then *Your recorded contributions, by goal.*
2. **The exact recorded total, one per unit** (58 px), "squats recorded". Unlike units are never
   added together.
3. *Across N goals in M communities. Each unit stays separate.*
4. The one clarification: *This personal summary is only for you. Community activity follows your
   visibility settings.*
5. **Your receipts / Recent contributions**. This is the seam; see below.
6. **By goal / Goals you helped**. Each row shows **YOURS** and **SHARED** apart, with the
   reference's lifecycle pill: `OPEN`, `REACHED · STILL OPEN`, `CLOSED · REACHED` or
   `CLOSED · UNFINISHED`. A closed goal whose total did not answer says only `CLOSED`; its
   SHARED cell says `Unknown`, never zero.
7. *No scores, streaks or rankings — just what was recorded.*

The state bodies:
- **First contribution:** "Your first contribution will appear here" and Start moving. This shows
  only when nothing is recorded and a live open goal with a usable target exists (`canStart`).
- **No open goal:** "No goal is open for contributions" and Open community. There is no Start
  moving.
- **Partial:** "This list is partial." above the lists, with Retry. Totals count only what loaded.
  If nothing loaded, no "first contribution" is claimed.
- **Failure:** keeps the identity, says it won't guess amounts or show them as zero, and offers
  Retry.
- **Loading and signed out:** no name, no totals and no clarification.

## The seam: dated receipts

The canonical code cannot read the member's recorded contributions one by one.
- `wsfMyContribution` returns a per-goal total only.
- `wsfContributions` is client-denied.
- `docs/design-target/review/page-04-progress/PRIVATE-HISTORY-CONTRACT.md` says that backend is
  not to be built without separate privacy approval.

So `receipts` is `null` in every canonical state. The section keeps its place and height in the
reference's rhythm and says, in one line, *Dated receipts aren't available here yet. Your exact
total for each goal is below.* It never draws an invented row.

The slot is still a contract. `ProgressReceipt { id, amount, unit, goalTitle, community,
whenLabel }` is rendered by the reference's row geometry: a 64 px amount column, flexible
metadata, a chevron, a 60 px minimum height and a bottom hairline. `relTime(at, now)` gives the
reference's wording. The fixture state **`receipts-contract`** fills the slot from fixture props,
and its band says so. Laid over the reference's populated original, it measures **0.0058**
differing share on the body window and **0.0013** aligned, so a future authorized source fills it
with no redesign. It is not a canonical state, and no canonical path produces it.

## The truth correction: `f79a3c49` → `5c4041f3`

This applies the Director's You review (#492 `5841012915`) to Progress, through the shared module.

- **The shared position is explicit.** `sharedTotal: number | null` is now
  `shared: SharedPosition`. The lifecycle pill, the Shared cell and the reached rule all come from
  `src/goalTruth.ts`:
  - an unknown position is `Unknown`, never 0;
  - an open goal says `OPEN`;
  - a closed goal says only `CLOSED`.
- **No date is interpreted in the view.** `endsAt` is now `periodLabel: string | null`, formatted
  by the Phase B adapter in the goal's own timezone and shown verbatim. `whenLabel()` is removed.
- **A new fixture state, `unknown-shared`,** has an open goal and a finished goal whose totals did
  not answer. Own parts are known, so the total still reads 145.

**`5c4041f3` → `12cd9d69` (Director #495 `5841257894`).** The fixture now uses the reference's
own semantic period labels: "This week" (both open goals), "August" and "July". Previously it used
"Ends Sep 27" / "Ended …". The component, helpers and `goalTruth` are unchanged. The shared module
is `src/goalTruth.ts`; the review calls it `memberGoalTruth.ts`, and it was not renamed, to keep
You's product SHA stable.

## Focused tests on `12cd9d69` (the fixture and one e2e assertion changed; focused runs only)

| check | first run | rerun |
|---|---|---|
| `tests/progress-parity.test.ts` + `tests/progress-parity-view.test.tsx` | 34 / 34 | 34 / 34 |
| full vitest (`apps/westayfit`, including You's 38) | 963 / 963 (891 at base + 38 + 34), on `5c4041f3`; not rerun for the fixture-label change, per #495 `5841257894` | — |
| `sprint-w6-progress-parity.spec.ts`, ungated | 14 passed, 1 skipped (evidence), **0 bytes written** | — |
| same spec, `WSF_CAPTURE_FRAMES=1 -g evidence` | 1 passed; writes only `fixture/` | 1 passed (after the landmark fix below) |
| `npm run ts:check` | exit 0 | — |
| `check-evidence-intact` | frozen 9 / accepted 20 intact | — |

The e2e runs at 390×844 and 390×640. Per class it checks six things:
- **Populated:** the reference order; the private total and clarification on the first screen;
  exactly one clarification; the receipt slot's honest line; four goal rows; and the compact
  geometry (below).
- **First contribution:** Start moving is whole on screen, at least 54 px, and pressing it only
  calls back.
- **No open goal:** no Start moving, and Open community works.
- **Partial:** the note sits above the lists, the total is 45 (what loaded), and Retry calls back.
- **Failure:** the identity stays, no totals are shown, and Retry is whole on screen and calls
  back.
- **Unknown shared totals:** the open row says `OPEN` and not `REACHED`, the closed row says
  `CLOSED` and not `UNFINISHED`, both Shared cells say `Unknown`, the period label is shown
  verbatim, and the total is still 145.
- **Keyboard:** Tab reaches receipts r1 to r5 in order, and Enter opens r1.

**Compact geometry (the reference's `max-height: 700px` block).** The screen top is 10 px (14 at
full height). The heading is 25 px on 37.5 px lines (29 px on 43.5 at full height). State cards
use `margin-top 12` / `padding 16`. It is hydration-gated per #418, as in YOU-PARITY-1.

### Mutants on the pure rules (all caught)

| mutant | result |
|---|---|
| units summed across units | 6 fail |
| closed with an unanswered total claims UNFINISHED | 2 fail |
| Start moving offered regardless of eligibility | 2 fail |
| unknown shared total shown as 0 | 2 fail |

## Frames

### `lovable-09b8a73c/` — the frozen reference originals

These were decoded byte-for-byte from the Lovable project's
`comparison-evidence-base64/<name>.png.b64` at `09b8a73c`, through the read-only connector. No
message was sent and no build was started. All are 390 wide at ratio 1.

```
2ff0dce8aa7e68a68a5ce82469d474c876754fa1cd23900cb0a5ff60d8fc7eea  progress-populated-390x844.png
9afe801ab69b297800f04d87a284acb0ce7432c28c888b1a8b80a5ee95ef5535  progress-first-eligible-390x844.png
5ee4ca7ab14821b8ef95eb8b2580df8ccdc56da2e114532c1ed97a030863bb35  progress-first-eligible-390x640.png
166ca7b63f0a2fccea602e2b1941ae9140e3bf092ab9548666267f264df15ce1  progress-no-open-goal-390x844.png
20f81a123cfc3c9324e7271198b93a28f895700652b5c04fc2334c1397925e47  progress-partial-390x844.png
a60eca2030dd152ca7f7484f554d0d2ea88787e934593ded26d434f04cfb6277  progress-failure-390x844.png
```

The reference publishes a 390×640 original only for first-eligible. The other states' 390×640
frames below are canonical-only.

### `fixture/` — `ProgressParityView` at `12cd9d69`, through the component fixture

**Changed at `12cd9d69`:** the three 390×844 frames whose goal rows show period labels. These are
populated, partial and unknown-shared, plus populated's comparison images. Every other frame is
**byte-identical** to `f79a3c49` / `5c4041f3` and carried by hash, including first-eligible,
no-open-goal, failure, receipts-contract and every 390×640 frame. The `unknown-shared` frames are
canonical-only.

The fixture is the reference's own state:
- member Alex M., in Oak Grove Together and Harbor Lunch Crew;
- "500 squats together": 25 own, 241 / 500, open;
- "150 squats this week": 20 own, 155 / 150, reached and still open;
- "1,000 squats in August": 60 own, 1,024 / 1,000, closed reached;
- "800 squats in July": 40 own, 612 / 800, closed unfinished;
- 145 squats recorded in total.

Its top band matches the reference's masthead: 92 px, or 86 at ≤ 700.

```
2ea1147577bbfa021aaa3b1b74bd3f5624f5823beb1f4219bef8b8f9d5174e9b  progress-populated-390x844.png
3b99518cb876dc0dde8355298ee36c59f79a82535b90d361ee199464192f41c2  progress-populated-390x640.png
be03b94df58ea99c57c762afa92c25dddaf08272b89bcffb3f10a6933c51a536  progress-receipts-contract-390x844.png
bb29fb97c0e548b4e6a4460a6f52539f561eb7d2c3dfc8bb76c39da15bc73aa1  progress-first-eligible-390x844.png
da927de70e8ee1907c43f51c3f69b0157e017df78439e3c621f1303e5ef312f7  progress-first-eligible-390x640.png
620005ede7100da349ca1b4b56880447cf65f576ce56832d5d434f0d3ebba1b5  progress-no-open-goal-390x844.png
ff9a25238828fde4a46de95a03e290c681189f15667ea03da811f690733e55b9  progress-no-open-goal-390x640.png
f3e31426770d2606c9735a486cba62be7df6a9b648dfe733ae9a8a16dd2266c8  progress-partial-390x844.png
2ab57996cc1d6c2cc889cc07275225c345a115173f394babeca62f6c59f4d8d7  progress-partial-390x640.png
bc113e3b1b026520e069f258d9c66581de452d033486f27c513cd98a640aa84f  progress-failure-390x844.png
c929c97935044f67ff2e594ef91b9d032ce522e7bba98dafc52f1b0a66d32e44  progress-failure-390x640.png
0e7f60a8b1902d9039bbc42107865371280e277d95a228c726b9d8dc45051d27  progress-unknown-shared-390x844.png
27a9c749127cc5dc0b286c49236dba2cee0a67c7324a6540265d78fe7d871623  progress-unknown-shared-390x640.png
```

Each frame with an original has two comparison sets. Both are listed with measurements in
`fixture/manifest.json`.

- **`cmp-<name>-{side-by-side,overlay-50,difference}.png`** is cropped to the body window: below
  the masthead and above the 75 px tab bar.
- **`cmp-<name>-aligned-*`** uses the same frames with the view shifted so both heroes' bottom
  rules sit on one row. The rule is found where x = 30, 200 and 350 are all the border colour.
  The first capture used one column, which also matched an anti-aliased edge of the "45" in the
  partial frames. Three columns fixed that before anything was committed.

Differing-pixel share is the share of pixels whose summed channel difference exceeds 48. It is a
measured figure, not a verdict.

| state · viewport | body window | aligned (view shift) | what the shift is |
|---|---|---|---|
| populated 390×844 | 0.0691 | 0.1204 (0 px) | none. The rules coincide at 409; the remainder is the receipt seam |
| **receipts-contract 390×844** | **0.0058** | **0.0013** (0 px) | none |
| first-eligible 390×844 | 0.2111 | **0.0281** (+47 px) | the reference's "Reviewer sample state" pill |
| first-eligible 390×640 | 0.3004 | **0.0430** (+47 px) | the same pill |
| no-open-goal 390×844 | 0.1626 | **0.0034** (+63 px) | the same pill, wrapped to two lines |
| partial 390×844 | 0.1714 | **0.0718** (+34 px) | the same pill; plus the receipt seam and the partial copy |
| failure 390×844 | 0.2001 | **0.0237** (+47 px) | the same pill |

Every shift is the reference's demo-only `sample-state-note`. Under the rule the view and the
original coincide nearly pixel for pixel, because the reference's font stack and this build resolve
to the same face in this environment.

## Intentional differences and unmeasured limits

- **Demo copy is removed.**
  - The hero eyebrow drops "Sample data".
  - The reviewer "sample state" pill is not drawn.
  - The failure body says "Your identity is still here" rather than "Your sample identity".
- **The partial note says "Some goals couldn't be read"**, not "Some finished goals…". A canonical
  partial read can lose open or finished goals; the reference's wording describes its own fixture.
- **The receipts slot is a seam** (above). The populated state shows its honest line where the
  reference shows five rows.
- **The goal row sub-line** is "community · {periodLabel}", with the label supplied by the adapter.
  The fixture uses the reference's own labels ("This week", "August", "July").
- **"(not live)" and the legacy held-aside note** are not drawn. Canonical Progress has no
  staleness state and no legacy local entries.
- **Font weights 750 and 850 are drawn at 700 and 800.** React Native's `fontWeight` has neither;
  the face here renders all of them as its bold.
- **`max-width: 46ch` / `52ch`** are drawn as 332 / 347 px (the Arial "0" at 13 / 12 px).
- **Glyphs are drawn from Views** with lucide geometry: `arrow-right` and `chevron-right` exactly,
  and `refresh-cw`'s arcs as short chords.
- **The bottom padding** is the shell's tab-bar clearance plus the caller's `bottomInset`, not
  `.screen` 124 px.
- **The masthead and tab bar are W9's shell.** They are cropped from every comparison.
- **Not measured:** Chromium only, so Safari and devices were not measured. Widths above 390 were
  not measured; the reference's desktop grid is not in Phase A. The loading skeleton is not
  compared, because the reference has none.

## For Phase B (not built here)

When W9 posts the immutable PERF product SHA:
1. Branch from exactly that SHA.
2. Add a small hook in `activity.tsx` that maps its resolved state into this view's props:
   - `running` → `open`;
   - `finished` → `finished`;
   - `partial` → `partial`;
   - `error` → `failed`;
   - `sharedTotal` absent → `UNKNOWN_SHARED`, never 0;
   - `periodLabel` formatted from `endsAt` in the goal's stored timezone;
   - `canStart` from any goal read with `status === 'active'` and a target above 0;
   - `memberName` from whatever the route already resolves (no new read);
   - `receipts: null`.
3. Do not rewrite PERF's read or cache effect.

**Route specs that assert today's composition** and will need reconciling in Phase B, because the
reference composition removes what they pin. These are route tests; they are not changed here.
- `progress-list.spec.ts`: "3 goals you have added to", "2 running · 1 finished", `RECORDED`.
- `sprint-w8-progress-copy.spec.ts`: the finished-goal Living WE (`wsf-activity-we`), and
  `wsf-activity-row-*` / `wsf-activity-done-*`.
- The gated `design-progress-*-capture` producers.

These handles keep their meaning: `wsf-activity`, `wsf-activity-title`, `wsf-activity-subtitle`,
`wsf-activity-privacy` (the one clarification), `wsf-activity-rows`, `wsf-activity-empty`,
`wsf-activity-error`, `wsf-activity-loading`, `wsf-activity-start`, `wsf-activity-retry`,
`wsf-activity-partial` and `wsf-activity-signed-out`.

## Reproducing

```
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 npm --prefix apps/westayfit run build:web
METADATA_SERVER_DETECTION=none npx firebase-tools emulators:start \
  --config firebase.westayfit.emulators.json --project demo-wsf-local

cd apps/westayfit
WSF_PLAYWRIGHT_CHROMIUM=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1) \
WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  ./node_modules/.bin/playwright test --config=playwright.config.ts tests-e2e/sprint-w6-progress-parity.spec.ts
# evidence: prefix WSF_CAPTURE_FRAMES=1 and add -g evidence
```
