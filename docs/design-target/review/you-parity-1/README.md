# YOU-PARITY-1 · Phase A — `YouParityView` (W6)

**Status: delivered for Phase A component QA and pixels. Not accepted, not integrated, not staged.**

This is the Phase A component only. It is not the route. `app/(tabs)/you.tsx` belongs to W9 while
PERF-MOBILE-1 is live, and this lane leaves it byte-identical to base.

Packet sources:
- Director #365 `5840666502` (lane C) and #456 `5840669068`.
- Concurrency correction #456 `5840756497`, and L0 #365 `5840771249`.
- Token baseline `5840801009`, bundle format `5840805320`, and Phase A acceptance `5840942863`.

| | |
|---|---|
| Base | `claude/wsf-app-shell` @ `0b460ce3f2f0766406100fef14d9a444c8cad43a` |
| Product SHA | **`5e76a10ca34c33a2cb3dc9f3ff48450e413ea264`**. It supersedes `66e56c4d` (per-goal community, columns, no filler line; see below), `92123f26` (the truth corrections) and `8c4d8210` (the compact block) |
| Component | **`apps/westayfit/src/ui/YouParityView.tsx`**, blob `93e70b72` |
| Pure rules | `apps/westayfit/src/youParity.ts`, blob `0729eb93`; the shared goal-truth module `apps/westayfit/src/goalTruth.ts`, blob `c41deb39` (Progress uses it too) |
| Fixture | `apps/westayfit/app/design-target/you-parity.tsx`, blob `6339d930`. Emulator builds only; `?state=normal\|no-own\|no-eligible\|failed\|unknown-shared` |
| Tests | `tests/goal-truth.test.ts` `6a6613a5` (4) · `tests/you-parity.test.ts` `c0a06a9e` (21) · `tests/you-parity-view.test.tsx` `05e54730` (16) · `tests-e2e/sprint-w6-you-parity.spec.ts` `dc825e16` (12) |
| Route | `app/(tabs)/you.tsx` = base blob `22716995` — **protected-path delta: no** |
| Reference | Lovable `e15b9fa0-b2a0-4314-bc21-9c573b8eceb1` @ `642f830baa1153b0d9465dc75690028768083fb7`: `src/demo/screens/you.tsx`, `src/styles.css` |
| Environment | emulator `demo-wsf-local`. Web bundle built from the product tree with `EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1`. Chromium, iPhone UA, `en-US`, `America/New_York`. Frames at device pixel ratio 1, because the originals are 390 wide at ratio 1 |

Blobs were read with `git rev-parse <sha>:<path>`.

## What the component is

`YouParityView({ state, email, signingOut, actions })` takes resolved canonical facts and six
callbacks: `onSettings`, `onSignOut`, `onSignIn`, `onCommunity`, `onRetry` and `onStartMoving`.
It has no Firebase read and no router, auth or storage dependency, and it carries none of the
prototype's demo authority. Its `YouState` is a union of `loading`, `signedOut`, `noCommunity`,
`pickCommunity{count}`, `failed{community?}` and `member{profile, community, open, finished,
partial, eligible}`.

The order is the reference's:
1. The head: avatar initials, name, member since, and a 48×48 Settings control.
2. The current community as a full-bleed navy band: the name, then its role and size.
3. **YOUR PART IN LIVING WE**: the shared position in a navy card, beside **YOUR EXACT CONFIRMED
   PART** in a white card with a 4 px confirmed-green rule. They are two figures and are never
   joined.
4. **Other goals you helped**, each under its own community, with the reference's four lifecycle
   pills: `OPEN`, `REACHED · STILL OPEN`, `CLOSED · REACHED` and `CLOSED · UNFINISHED`. A closed
   goal whose result is unknown reads `CLOSED · RESULT UNAVAILABLE`.
5. The account row, last: email and Sign out. It needs no read, so it renders in every signed-in
   state.

The truth cases:
- **No own part, a goal open:** Start moving, calling back only.
- **No goal eligible:** Open community. No Start moving is offered.
- **Pick a community:** "Which community?" with the count.
- **No community:** Find a community.
- **Partial:** a note that the list may be short.
- **Failure:** keeps the identity and the community, guesses no amount, and offers Retry.
- **Signed out and loading:** no identity handle and no name.
- **Not shown anywhere:** rank, streak, score, share of total or inferred impact.

Settings only calls back. The side panel belongs to W9.

## The final correction: `66e56c4d` → `5e76a10c` (Director #492 `5841276795`, `5841182763`, `5841257520`)

- **Each goal owns its community.** `YouGoal.communityName` is rendered per row. The fixture's
  first other goal is **Harbor Lunch Crew · This week**, as in the reference; the lead is Oak Grove
  Together · This week. The component no longer assumes every goal belongs to the current
  community.
- **Lead columns: 230 / 110 / 10 at 390, measured on both classes.**
  - The fix is two unpadded columns at `flexGrow 2.09 : 1` with a zero basis, the own column
    keeping `minWidth 104`, with the padded cards filling them. That is the grid's
    `minmax(0,1.35fr) minmax(104px,.65fr)` as it lays out at 390.
  - `flex: 2.09 / 1` on the padded cards themselves still measured 218 / 122, because with
    border-box sizing their padding and borders count toward the flex basis. The first two e2e
    runs on this tree failed 2/12 on exactly that (218.125 px) before the wrappers.
- **No filler type line.** `bandSubline()` prints a type only when the product names one (today,
  "Family and friends"). An unknown, omitted or `custom` type prints nothing, rather than the
  generic "Community".
- **`goalTruth`:** a closed goal with an unknown result reads `CLOSED · RESULT UNAVAILABLE`, and
  `canRenderLivingWe` names the instrument rule.
- **Fail-first:** on the `66e56c4d` bundle the Harbor-row assertion fails; the row read "Oak Grove
  Together · Ends Oct 1". The Director measured 218 / 122 there.
- **Tests, focused per `5841276795`:** goal-truth + You pure + view **41 / 41**; e2e **12 / 12**;
  `ts:check` 0; evidence guard 9 / 20. No full vitest; the last full run was 929 / 929 at
  `66e56c4d`.

## The truth correction: `92123f26` → `66e56c4d` (Director #492 `5841012915`)

- **The shared position is known or it is not.** `YouGoal.sharedTotal: number` is now
  `shared: SharedPosition` from `src/goalTruth.ts`, which is `{kind:'known', total}` or
  `{kind:'unknown'}`. When it is unknown:
  - it never renders 0;
  - there is no Living WE and no track;
  - the lead says "Not available right now" in place of a number, and the exact own part still
    shows;
  - an open goal says `OPEN`, and a closed one says only `CLOSED` with `Unknown` in its Shared
    cell. Neither is claimed reached or unfinished.
- **No date is interpreted in the view.** `endsAt` is now `periodLabel: string | null`, which the
  Phase B adapter formats in the goal's own timezone. The view shows it verbatim, and the
  device-local `whenLabel()` is gone.
- **Fail-before.** At `8c4d8210` and `92123f26` the model could not represent an unknown total at
  all; the route's old fallback-to-0 was the only way to feed it. The new tests cannot be expressed
  against that type.
- **Mutants on `goalTruth`**, each caught:

  | mutant | result |
  |---|---|
  | closed and unknown claims UNFINISHED | 2 fail |
  | unknown rendered as `0 squats` | 2 fail |
  | an instrument without a known total | 1 fail |

  The last one survived the view tests alone, because the view also guards. `tests/goal-truth.test.ts`
  was added to catch it directly.

## Focused tests on `66e56c4d` (for `5e76a10c`, see the final correction above)

| check | first run | rerun |
|---|---|---|
| `goal-truth` + `you-parity` + `you-parity-view` | 38 / 38 | 38 / 38 |
| full vitest (`apps/westayfit`) | 929 / 929 (891 at base + 38) | — |
| `sprint-w6-you-parity.spec.ts`, ungated | 12 passed, 1 skipped (evidence), **0 bytes written** | — |
| same spec, `WSF_CAPTURE_FRAMES=1 -g evidence` | 1 passed; writes only `fixture/` | — |
| `npm run ts:check` | exit 0 | — |
| `check-evidence-intact` | frozen 9 / accepted 20 intact | — |

The e2e runs at 390×844 and 390×640. Per class it checks five things:
- **Reference order and layout:** the order, with the account last; identity fully on screen; the
  lead on screen; Settings at least 48×48; and the compact geometry (see below).
- **No own part, a goal open:** Start moving is whole on screen, at least 54 px, and pressing it
  only calls back.
- **No goal eligible:** no Start moving, and Open community works.
- **Failure:** identity and community are kept, and Retry calls back.
- **Unknown shared totals:** the lead shows `OPEN` with no number and no Living WE, and the own
  part is kept; the closed row says `CLOSED` and `Unknown`, and shows its period label verbatim.
- **Keyboard:** Tab order runs Settings, then Start moving, then Sign out.

### Fail-first and mutants

- **The compact block, the correction that superseded `8c4d8210`.**
  - The assertion *band 8 px under the head at ≤ 700 px tall* fails on the `8c4d8210` bundle at
    390×640 (`expected 8, received 14`) and passes at 390×844.
  - On `92123f26` it passes at both classes.
  - A build without the hydration gate rendered 390×844 compact (`data-compact` `true`,
    expected `false`). That is the #418 static-export failure the gate exists for; that build was
    never pushed.
- **The pure rules**, carried from the first delivery and each caught:
  - "Start moving is always offered" makes 2 tests fail.
  - "reached is never true" makes 3 tests fail.
  - "the lead is the last open goal" makes 2 tests fail.
- **Real-route fail-first** is preserved at `1720c44b` (4 / 4 fail on `0b460ce3`, pass on
  `1720c44b`). It returns with the Phase B hook.

## The correction: `8c4d8210` → `92123f26`

This lane's own band-aligned comparison found two gaps before any QA consumed `8c4d8210`.

- **The reference's `@media (max-height: 700px)` block was missing.** It now applies at the same
  breakpoint with the same values:

  | element | full | compact |
  |---|---|---|
  | screen `padding-top` | 14 | 8 |
  | head `padding-bottom` | 14 | 9 |
  | band `margin-top` | 14 | 8 |
  | band padding | 18 | 13 |
  | band gap | 14 | 9 |
  | state cards | `margin-top 16` / `padding 20` | `margin-top 10` / `padding 15 20` |
  | card `h2` | 22 px | 20 px |

  `useYouCompact()` waits for hydration, the rule the display, kiosk and station already follow
  (#418). The static export renders with no window, so the first client render must match its
  full rhythm, and a missing measurement never selects compact.
- **Line heights were React Native's "normal".** They are now the reference's literal values:
  its own where `styles.css` sets one (band `h2` 1.05, lead `h2` 1.1, own figure .95, card `h2`
  1.12, card body 1.45), and otherwise the 1.5 every element inherits from the Tailwind preflight.
- **Also fixed:**
  - The shared figure is now the reference's baseline-aligned `.goal-number` row with a 4 px gap.
  - Settings `gap` is now 1 px.
  - The gear is an outline.
  - The action arrow is lucide `arrow-right`, drawn from Views on its 24-unit grid.

## Frames

### `lovable-642f830b/` — the frozen reference originals

These were decoded byte-for-byte from the Lovable project's
`comparison-evidence-base64/<name>.png.b64` at `642f830b`, through the read-only connector. No
Lovable message was sent and no build was started. `you-no-eligible-390x844.png` matches the
Director's published SHA-256.

```
86f270cb9a0bf86fe84240f86a1e819468e9d1534a37fb118516be32ae33b671  you-normal-390x844.png
87063a31aa66222d205f4c73d9a2157a41845965f8385299e2ae14ca2914eb2b  you-normal-390x640.png
0e83eb0998064a5f848cd3a08d50de1cda7f718bd602e2b4619702d0e1702232  you-no-own-390x844.png
b48fd978bb2de7de24387726339c4ceca9f62b46dd06b86f1ff5f563c20dd7d5  you-no-own-390x640.png
3885859b8a8a81082bce6e21fee44a5fd17f28f951714776d91932b2208a5e8c  you-no-eligible-390x844.png
```

The reference has no failure frame and no 390×640 no-eligible frame. `you-failed-390x844.png` is
canonical-only.

### `fixture/` — `YouParityView` at `5e76a10c`, through the component fixture

**Every frame is recaptured at `5e76a10c`.** The band lost its filler line in every state, and the
normal frames also changed columns and the Harbor row. Nothing carries from `66e56c4d`.

The fixture is the reference's own state:
- member Alex M., since September 2026;
- community Oak Grove Together: member, 23, with no named type;
- lead goal "500 squats together" (Oak Grove Together · This week): 241 / 500 shared, 25 own;
- other goal "150 squats this week" (**Harbor Lunch Crew** · This week): 155 / 150 shared, 20 own,
  still open.

Its top band is exactly the reference's masthead: prototype strip 30 plus top bar 62, which is 92;
or 56 at ≤ 700, which is 86. It is labelled `YOU-PARITY-1 · COMPONENT FIXTURE · NOT THE ROUTE`.

```
4022750205a0f8b89981c5df88776f60967aa0179fce7a0c2a0166937489e04b  you-normal-390x844.png
897fc29d3a0a6c4c628628f0d2f0b7ee8e6c29d3033e45d7beac7ab355533692  you-normal-390x640.png
b1270cc89675ea4dc845acabf7661d90b943cb5e048c394f3248db85b0b68d32  you-no-own-390x844.png
5da7b6f9867170092455a04e39af45b7988b1a6c5aef3874cb6b40e6440bef98  you-no-own-390x640.png
7d7732249ef69b1aa756b32c238e259d8c5d1966296d705ac5889720d23e106e  you-no-eligible-390x844.png
2fd533e80f003fd08c420487da114dc7329761b1fd8ffdaa54c3620123a16cc9  you-failed-390x844.png
ad74553a9474f5a8a21bbb38fa2af926046e43f4d3a135a42c9f8e5862bc33f0  you-unknown-shared-390x844.png
8d8f1f09b488bbbcbd6b142bbfbb89d54e26471bb527f3b9e70505a419f69251  you-unknown-shared-390x640.png
```

`unknown-shared` is canonical-only; the reference has no such state.

Each frame with an original has three comparison sets. The first two are listed with measurements
in `fixture/manifest.json`; the third is in `fixture/lead-aligned.json`.

- **`cmp-<state>-<vp>-{side-by-side,overlay-50,difference}.png`** is cropped to one body window:
  below the masthead and above the 75 px tab bar. The masthead and tab bar are the shell's, W9's.
- **`cmp-<state>-<vp>-aligned-{side-by-side,overlay-50,difference}.png`** uses the same frames
  with the view shifted so both community bands start on one row. The row is found at x = 5 as
  the band's navy. This measures everything below the head without the head's height difference
  smeared over the frame.
- **`cmp-<state>-<vp>-lead-aligned-*.png`** is a supplementary diagnostic from the evidence-only
  script `tools/lead-aligned.mjs`, which is not product code. It aligns at the band's **bottom**
  edge. The canonical band is one line shorter by design (no filler type line), so band-top
  alignment carries that recorded offset through everything below. This set measures the lead and
  the rows on their own.

Differing-pixel share is the share of pixels whose summed channel difference exceeds 48. It is a
measured figure, not a verdict.

| state · viewport | body window | band-top aligned (shift) | **band-bottom aligned (shift)** | base route, full frame (`canonical-before/`) |
|---|---|---|---|---|
| normal 390×844 | 0.2988 | 0.2396 (+17) | **0.1172** (+34) | 0.478 |
| normal 390×640 | 0.3335 | 0.2546 (+17) | **0.0875** (+34) | 0.4954 |
| no-own 390×844 | 0.3321 | 0.2689 (+17) | **0.1973** (+34) | 0.4422 |
| no-own 390×640 | 0.3832 | 0.2893 (+17) | **0.1683** (+34) | 0.4926 |
| no-eligible 390×844 | 0.2263 | 0.1703 (+17) | **0.1070** (+34) | 0.3795 |

- **Band-top shift, 17 px at both classes.** This confirms the compact block matches. It is the
  reference's extra head line: its eyebrow "Sample member · Design prototype" wraps to two lines,
  and it has a "Fictional profile · no account or sign-in" line. Both are demo copy, replaced by
  the truthful "YOUR PROFILE" and "Member since …".
- **Band-bottom shift, 34 px.** That is those 17 px plus the reference's descriptor line "Moving
  together this week", which the canonical band omits.
- **Band-top shares are higher than at `66e56c4d`** (0.107 → 0.240 for normal 844). The shorter
  band moves everything below it; the band-bottom set shows the content below the band on its own.
- **What remains below the band** in no-own is copy: "for you" against "for this sample member",
  and the account row against the prototype's links. In normal, the shared card is about 3 px
  shorter than the reference's.

### `canonical-before/` — the real route at base `0b460ce3` (ACTUAL BEFORE)

These frames were produced by the spec as of `1720c44b`, with `WSF_CAPTURE_FRAMES=1
WSF_YOU_PARITY_PHASE=before`, against a bundle built at `0b460ce3` and a seeded emulator member in
the reference's state. They are full-frame comparisons. The manifest is in the folder.

The real-route frames for the component come with Phase B, from W9's PERF SHA. `1720c44b`'s own
route frames are not committed, because that recomposition predates both the correction above and
the concurrency correction.

## Intentional differences and unmeasured limits

- **Font family.** The reference is `"Avenir Next", "Segoe UI", Arial`. The app uses the shell's
  stack, which is shared by every tab, so glyph widths differ.
- **Eyebrow weight 850 is drawn at 800.** React Native's `fontWeight` has no 850.
- **Demo copy is replaced by truthful copy:**
  - head eyebrow: "YOUR PROFILE";
  - "Member since …" instead of "Fictional profile";
  - "23 members" instead of "23 sample members";
  - the no-own card says "for you" instead of "for this sample member".
- **The band has no sub-line** where the reference prints its descriptor "Moving together this
  week". No canonical field holds such a descriptor, and an unnamed type prints nothing rather
  than a filler "Community" (Director `5841276795`). The band is one line shorter: a recorded
  17 px vertical difference, measured as 34 − 17 between the two alignments.
- **Other goals across communities.** The component renders each goal under its own community,
  as the reference does. Whether Phase B can *supply* goals from other communities without a cold
  per-community read fan-out is a Phase B / W9 performance question; the planned member snapshot
  (MEMBER-SNAPSHOT-1) would answer it in one read. Nothing is invented.
- **The prototype's links are replaced by the account row.** "Expo comparison" and "Prototype
  tools" become "Signed in as … / Sign out". Sign out is reachable but subordinate.
- **Glyphs are drawn from Views.** The app ships no SVG library. The avatar person, the gear
  (an approximation of lucide `settings`) and the arrow (lucide `arrow-right` geometry) are all
  Views. Retry has no refresh icon.
- **The bottom padding** is the shell's tab-bar clearance (`MEMBER_TAB_BAR_BODY +
  MEMBER_TAB_MOVE_OVERHANG`), not the reference's `.screen` 124 px.
- **The masthead and tab bar are W9's shell.** They are cropped out of every comparison.
- **Not measured:** Chromium only, so Safari and devices were not measured. Nothing wider than
  390 was measured; the reference's desktop block is not in Phase A. The loading skeleton is not
  compared, because the reference has none.

## Next

- **Consumer:** W5 (QA2), with Phase A component QA on `5e76a10c` per `5840942863`. Then the
  Director's Phase A pixels.
- **Phase B**, when W9 posts the immutable PERF product SHA:
  1. Branch from exactly that SHA.
  2. Add a small hook in `app/(tabs)/you.tsx` that maps its resolved state into `YouParityView`.
     `1720c44b` shows the mapping; its two additive facts are `failed{profile, community}` at the
     goals catch, and `eligible`. The adapter also owns two rules the view no longer applies:
     - an absent `sharedTotal` maps to `UNKNOWN_SHARED`, never 0;
     - `periodLabel` is formatted from `endsAt` in the goal's stored timezone;
     - `communityName` is the goal's own community's display name.
  3. Do not rewrite PERF's read or cache effect.
  4. Add a focused integration test and real route frames.

## Reproducing

```
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 npm --prefix apps/westayfit run build:web
METADATA_SERVER_DETECTION=none npx firebase-tools emulators:start \
  --config firebase.westayfit.emulators.json --project demo-wsf-local

cd apps/westayfit
WSF_PLAYWRIGHT_CHROMIUM=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1) \
WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  ./node_modules/.bin/playwright test --config=playwright.config.ts tests-e2e/sprint-w6-you-parity.spec.ts
# evidence: prefix WSF_CAPTURE_FRAMES=1 and add -g evidence
```

## Phase B — the real route hook (`claude/wsf-w6-you-hook-1`)

**Status: delivered for W7 route QA and the Director's integration check. Not accepted, integrated
or staged.**

| | |
|---|---|
| Base | W9 PERF-MOBILE-1 cp1 successor **`889e9775`** (#494), exactly |
| Product SHA | **`db6c2e2d50ec102573072cf9dac6cefeee95a1d9`** |
| Component | You Phase A `2d71db08` merged unchanged (merge `9baf2e29`). `2d71db08` adds only the optional `pending` name and `refresh` note to `5e76a10c`, and every Phase A frame is byte-identical |
| Route | `app/(tabs)/you.tsx`: PERF's reads, record, focus revalidation and checking / stale / Retry are kept. The only line changed inside the effect passes the already-read `goals` to `composeMember` |

**What the adapter owns** (and nothing else):
- an unanswered `sharedTotal` → `UNKNOWN_SHARED`, never 0;
- `periodLabel` from `endsAt` in the goal's own IANA zone, via the canonical `formatEndsAt` /
  `formatEndedOn`. An `active` goal whose end instant has passed reads "Ended …";
- `communityName` = the goal's community;
- `eligible` = some goal is `active`, has a target above 0 and a window that is not over.

**Tests (`tests-e2e/sprint-w6-you-hook.spec.ts`, real route, emulator):**

| run | result |
|---|---|
| on `889e9775`, without the hook (fail-first) | **4 / 4 fail** |
| first run on the hook | 3 / 4. The Start moving test expected `/move`; W9's MOVE sends a member with one open goal straight to `/contribute/<goal>?…&mode=move`. That was a test expectation, not a product defect |
| rerun after the expectation fix | **4 / 4** |
| gated evidence run | 5 / 5 (4 + frames) |

The four tests cover:
- the reference order, with the period in the goal's zone: Kiritimati writes the next day, New York
  the same day;
- an unknown shared total: no number, no Living WE, never 0;
- Start moving withheld when the only active goal's window is over, and offered in window;
- a failed revalidation that is kept, labelled and retried.

**Existing specs that drive `/you`, first run on the hook: 50 / 50** (plus one gated evidence
skip). These are `you-page`, `ui-app-shell`, `identity-account-switch`,
`sprint-w9-perf-mobile-1`, `sprint-w9-focus-return-1`, `sprint-w9-shell-production` and
`sprint-w6-you-parity`.

Focused units: goal-truth + You + memberReads 62 / 62; `ts:check` 0; evidence guard 9 / 20.

### `route/` — full-viewport route frames (no crop, no alignment)

These are the real shell masthead, the page and the real tab bar, beside the frozen original, at
device pixel ratio 1:

| frame | full-frame differing share |
|---|---|
| `route/route-you-normal-390x844.png` | 0.3965 |
| `route/route-you-normal-390x640.png` | 0.4302 |

Each has a `cmp-*-full-side-by-side.png`, and `route/manifest.json` holds the SHA-256 digests.

Most of the full-frame difference is the shell, which is W9's:
- the app has no 30 px prototype strip;
- its top bar and tab bar are not the reference's;
- so the whole page sits about 40 px higher.

Below the masthead the page is the Phase A component. Its row sub-line is the canonical
"Oak Grove Together · Ends Sat, Oct 3", written in the goal's zone.
