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
| Product SHA | **`66e56c4daeff7e50de427234384f18fef6558157`**. It supersedes `92123f26` (the Director's truth corrections) and `8c4d8210` (the compact block); see below |
| Component | **`apps/westayfit/src/ui/YouParityView.tsx`**, blob `38e91cda` |
| Pure rules | `apps/westayfit/src/youParity.ts`, blob `dd18c8c6`; the shared goal-truth module `apps/westayfit/src/goalTruth.ts`, blob `13f868f9` (Progress uses it too) |
| Fixture | `apps/westayfit/app/design-target/you-parity.tsx`, blob `c066da64`. Emulator builds only; `?state=normal\|no-own\|no-eligible\|failed\|unknown-shared` |
| Tests | `tests/goal-truth.test.ts` `d1ec5360` (4) · `tests/you-parity.test.ts` `f7956b01` (20) · `tests/you-parity-view.test.tsx` `f2cd6913` (14) · `tests-e2e/sprint-w6-you-parity.spec.ts` `500f6f14` (12) |
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
4. **Other goals you helped**, with the reference's four lifecycle pills: `OPEN`,
   `REACHED · STILL OPEN`, `CLOSED · REACHED` and `CLOSED · UNFINISHED`.
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

## Focused tests on `66e56c4d`

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

### `fixture/` — `YouParityView` at `66e56c4d`, through the component fixture

The six frames that also existed at `92123f26` are **byte-identical** to it, carried by hash (the
correction changes nothing a known total draws). The two `unknown-shared` frames are new.

The fixture is the reference's own state:
- member Alex M., since September 2026;
- community Oak Grove Together: member, 23;
- lead goal "500 squats together": 241 / 500 shared, 25 own, ends in 2 days;
- other goal "150 squats this week": 155 / 150 shared, 20 own, still open.

Its top band is exactly the reference's masthead: prototype strip 30 plus top bar 62, which is 92;
or 56 at ≤ 700, which is 86. It is labelled `YOU-PARITY-1 · COMPONENT FIXTURE · NOT THE ROUTE`.

```
ff9420e3587239a7779de393bf56cf7356893561f32fa288db96fb4cc58a69b6  you-normal-390x844.png
869a9fe29d5076c281b0026862b591bbe31cad027197815041bd0dfeb6ed59b2  you-normal-390x640.png
d27217095b654b43ef4b8020dcbf144ce36646c2fee2efc98d5abcc70754ee6e  you-no-own-390x844.png
9ad3835367fe41e197db17c7d78890a3471e241546fbe951f09912fc45b18235  you-no-own-390x640.png
c4dc7c2384da3d1bf8951d0712d1caf870c8abe1a3e230d495ea6c4c634f1e21  you-no-eligible-390x844.png
c1bcc99477a51dc828656054a0f5da31a216729b2905e74f67a3ba0c91cd43d4  you-failed-390x844.png
a2264bee2cc6df6089e231984b9a00c5c583ff66f0407b2b346ea1005ece0ec0  you-unknown-shared-390x844.png
ee97ebcb5ec3c3a6617f3b5ad8160af9d2cb6cc8538150059d1682624213ae16  you-unknown-shared-390x640.png
```

`unknown-shared` is canonical-only; the reference has no such state.

Each frame with an original has two comparison sets. Both are listed with measurements in
`fixture/manifest.json`.

- **`cmp-<state>-<vp>-{side-by-side,overlay-50,difference}.png`** is cropped to one body window:
  below the masthead and above the 75 px tab bar. The masthead and tab bar are the shell's, W9's.
- **`cmp-<state>-<vp>-aligned-{side-by-side,overlay-50,difference}.png`** uses the same frames
  with the view shifted so both community bands start on one row. The row is found at x = 5 as
  the band's navy. This measures everything below the head without the head's height difference
  smeared over the frame.

Differing-pixel share is the share of pixels whose summed channel difference exceeds 48. It is a
measured figure, not a verdict.

| state · viewport | body window | aligned (view shift) | base route, full frame (`canonical-before/`) |
|---|---|---|---|
| normal 390×844 | 0.2548 | **0.1067** (+17 px) | 0.478 |
| normal 390×640 | 0.2793 | **0.0939** (+17 px) | 0.4954 |
| no-own 390×844 | 0.2708 | **0.1581** (+17 px) | 0.4422 |
| no-own 390×640 | 0.2954 | **0.1200** (+17 px) | 0.4926 |
| no-eligible 390×844 | 0.1949 | **0.0971** (+17 px) | 0.3795 |

The view shift is **17 px at both classes**, which confirms the compact block matches. It is the
reference's extra head line: its eyebrow "Sample member · Design prototype" wraps to two lines,
and it has a "Fictional profile · no account or sign-in" line. Both are demo copy, replaced by
the truthful "YOUR PROFILE" and "Member since …".

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
- **The band's sub-line** is `groupTypeCardLabel` ("Community"), not the reference's descriptor
  "Moving together this week". No canonical field holds such a descriptor.
- **"Other goals you helped" covers the current community only.** Each row reads
  "community · Ends Oct 1" instead of "Harbor Lunch Crew · This week". Goals across communities
  would need one read per community, which is a performance seam for Phase B and W9. Nothing is
  invented.
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

- **Consumer:** W5 (QA2), with Phase A component QA on `66e56c4d` per `5840942863`. Then the
  Director's Phase A pixels.
- **Phase B**, when W9 posts the immutable PERF product SHA:
  1. Branch from exactly that SHA.
  2. Add a small hook in `app/(tabs)/you.tsx` that maps its resolved state into `YouParityView`.
     `1720c44b` shows the mapping; its two additive facts are `failed{profile, community}` at the
     goals catch, and `eligible`. The adapter also owns two rules the view no longer applies:
     - an absent `sharedTotal` maps to `UNKNOWN_SHARED`, never 0;
     - `periodLabel` is formatted from `endsAt` in the goal's stored timezone.
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
