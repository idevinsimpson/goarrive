# COMMUNITY-SETTINGS-PARITY-1 — evidence (PR #506)

Product head **`2e235c58`** (the `495cf847` product plus a unit-test casing fix) on base `87a86531` (branch `claude/wsf-w9-community-settings-parity-2`).
Supersedes the parked #497 run (`aa22c723` / `e7dc36ee` / `e07453b4`); the older
`RAW-*-aa22c723.log` / `RAW-*-e7dc36ee.log` files that sit in this directory in some
checkouts were never committed (`*.log` is gitignored) and are not part of this record.

Status: **delivered** for W7 verification and Director pixel review. Not accepted, not
integrated, not staged. Emulators only (`demo-wsf-local`); nothing deployed.

## What changed (Director `5841956174`, L0 `5843378340`)

- `app/(tabs)/community/index.tsx` no longer draws its own parity markup. A small adapter
  (`toParityProps`) hands route state to W4's accepted **`CommunityParityView`**. The route
  keeps Firebase / memberReads state, selection, navigation and the `ad3d2f88` `wasRefused`
  drop. The secondary rows ("OPEN ANOTHER COMMUNITY", Momentum) stay outside the core, in
  the view's `footer` slot, after the roster.
- `src/ui/CommunityPrivacyControls.tsx` is now the state owner only, drawing W4's accepted
  **`CommunityPrivacyPanelView`**. It keeps the per-setting generations, account epoch,
  save concurrency (a community takes no second action while its save is unresolved),
  the authoritative quiet re-read, and the three kept failure kinds
  (`notSaved` / `unconfirmed` / `membershipRefused`).
- The Settings overlay (scrim, 180 ms, focus return) is unchanged in behaviour; its body is
  the panel.

### Dependencies — W4-owned files touched (please review as such)

| File | Change | Why |
|---|---|---|
| `src/ui/communityParityTypes.ts` | `footer?: ReactNode` | secondary features after the core, outside W4's view |
| `src/ui/CommunityParityView.tsx` | renders `footer` after the roster | same |
| `src/ui/CommunityParityView.tsx` | Fact labels "Members" / "Your role" / "Goals" + `textTransform: 'uppercase'` | W7 Check 45 C-F2 / C-F7 read the accessible text; it looks identical |
| `src/ui/CommunityParityView.tsx` | `bannerRing` becomes a quarter ring inside the banner's bounds | the full ring was laid out past the right edge at 360 px (`ui-app-shell`). **This changes the accepted pixels: the new ring is not the reference arc (centred on the corner at radii 130–170, where the reference is centred 40 px in at 90–130). The accepted Phase-A frames no longer describe the banner. This is the Director's call (W4 `5844202722`).** |
| `tests-e2e/sprint-w4-community-parity.spec.ts`, `tests/community-parity-view.test.tsx` (`2e235c58`) | text assertions follow the label casing | `'Members23'`, `'Your roleMember'`, `'Goals3'`, `'Goals2'` |

### Spec rows whose meaning changed (not weakened — the product changed)

- `community-list.spec.ts` — the populated tab's **Join** is now real (asserted to land on
  `/?view=communities`), where the old route had none.
- `sprint-w8-social-privacy.spec.ts` — waits for `aria-checked="false"` on
  `wsf-privacy-panel-name-<g>` instead of the anonymous note W4's hardening C2 removed.
- H1 — the focus outline must be visible (not `none`, width > 0); the browser draws `auto`,
  not `solid`.
- H3 — the whole community is busy during a save, so there is no second action to take.
- H4 — the refused block says "no longer a member of…" and shows no switches.

## Results

The e2e runs below are on `495cf847`. `2e235c58` changes only a unit test file, so no app code differs.

| Run | Result | RAW |
|---|---|---|
| W7 Check 45 (`18d8caca`), exact | FAIL-BEFORE **15/15**, PRESERVE **13/13**; 6 passed | `RAW-w7-check45-495cf847.txt` |
| W7 Check 43 (`8e5d5955`), exact | 1/7 — selectors only (the switches' test IDs are now W4's `wsf-privacy-panel-*`) | `RAW-w7-check43-exact-495cf847.txt` |
| W7 Check 43, labelled local variant | **6/7**; the one failure is row 3's anonymous note, removed by W4 hardening C2 by design — W7's call | `RAW-w7-check43-variant-495cf847.txt`, `W7-CHECK43-LOCAL-VARIANT.diff` |
| Dependency set (15 spec files) | **133 passed, 1 skipped** (W4's frame capture, gated on `WSF_CAPTURE_FRAMES`) | `RAW-dependency-495cf847.txt` |
| Frame capture (`WSF_CSP_STAGE=CANDIDATE`) | **6/6** | `RAW-capture-495cf847.txt` |
| vitest at `495cf847` | **1022 passed / 6 failed** — my earlier "1028/1028" was wrong (found by W4 `5844202722`, reproduced by L0 `5844257231`): `tests/community-parity-view.test.tsx` still expected the uppercase Fact text | `RAW-vitest-495cf847.txt` |
| vitest at `2e235c58` | **1028 / 1028** — only the label casing in those assertions changed | `RAW-vitest-2e235c58.txt` |
| `tsc --noEmit` | clean at `495cf847` and `2e235c58` | — |

The Check 43 variant changes only selectors (every changed line is marked
`/* W9 LOCAL VARIANT */`); no assertion is changed. W7's own spec copies are not committed.

## Frames (CANDIDATE only — no BEFORE stage this run)

Route-level, full frame, at **390×640** and **390×844**, stamped `495cf847`:

- `CANDIDATE-community-*`, `CANDIDATE-community-lower-*` — the Community tab through W4's view.
- `CANDIDATE-settings-entry-{000,120,240}ms-*`, `-open-*`, `-exit-{000,090,170}ms-*`,
  `-closed-*` — the Settings panel's open, closing and closed states; the timeline
  (including focus return) is in `CANDIDATE-settings-timeline-*.json`.
- `CANDIDATE-reduced-settings-{open,closed}-*` + `CANDIDATE-reduced-motion-*.json` — reduced motion.
- `CANDIDATE-switch-{000,050}ms-*`, `-settled-*` — a privacy switch from press to settled.
- `CANDIDATE-states-*.json` — measured states.

**No Lovable overlays** are included: final pixel acceptance is route-level against frozen
Lovable and is the Director's review.

## Visual successor — product `0e5d6f38`, specs `6f34ff7b` (Director HOLD `5844878042`, ring `5845316335`)

W9 ACK: `5845334144`. The earlier `495cf847` / `2e235c58` frames above are kept as they were.

### What changed
1. **Settings panel = the frozen panel.** The overlay has 12 px padding on every side (plus
   the safe area). The panel is `max-width: 380`, so **366 px at 390**; it fills the height
   inside the inset and has an 8 px radius on every corner.
   - **Measured:** the panel box is **(12, 12, 366×820)** at 390×844 and
     **(12, 12, 366×616)** at 390×640.
   - **Unchanged:** Close stays named and ≥44 px, and there is no prototype kicker.
2. **The exact ring (W4 option (a)).** `scripts/westayfit/render-banner-ring.mjs` renders the
   visible 170×170 crop of the frozen circle: 260×260, 40 px `BANNER_RING` border,
   right −90 / top −90, so the centre sits at (130, 40) with radii 90–130.
   - **Asset:** 16×16 supersampling, Node `zlib` only, deterministic (`--check`). Written at
     1×/2×/3× to `apps/westayfit/assets/brand/derived/banner-ring{,@2x,@3x}.png` with
     `banner-ring.receipt.json`.
   - **Placement:** in bounds at right 0 / top 0, with `pointerEvents="none"` and
     `aria-hidden`; the banner keeps its clip.
   - **R1:** untouched and passing (`ui-app-shell`, in the dependency run).
3. **Spec rows whose meaning changed:**
   - `app-feel-parity-3`'s panel row now asserts the inset geometry, where it used to
     assert "flush right".
   - H6 presses the scrim in the 12 px margin at x = 6, and first asserts that the point
     is the scrim.

### The ring, verified against the frozen arc
Each banner's top-right 170×170 was compared pixel by pixel, counting only pixels that are
banner paint in both frames (navy, ring, or the blend between them), not text.

| viewport | compared px | ring px Lovable / candidate | classification agreement | mean / max channel delta |
|---|---|---|---|---|
| 390×844 | 27 039 | 9 090 / 9 116 | **99.89 %** | 0.036 / 21 |
| 390×640 | 27 023 | 9 084 / 9 116 | **99.87 %** | 0.039 / 21 |

The maximum delta is on the ring's anti-aliased edge pixels.

### Matched-fixture route comparison (`matched/`)
- **Producer:** `tests-e2e/sprint-w9-community-settings-parity-1-matched.spec.ts`, gated on
  `WSF_CAPTURE_FRAMES`.
- **Capture:** the **real Community and Settings routes**, at DPR 1 like the originals, as
  **full 390×H frames with no crop and no alignment**.
- **Fixture:** the frozen reference's own sample state, **fixture data only**, seeded into
  the local emulator:
  - Oak Grove Together: 23 members, 3 goals.
  - "500 squats together" at 241 / 500 this week.
  - "1,000 squats in April" at 1,084 and "800 squats in March" at 612.
  - Harbor Lunch Crew beside it.
  - Privacy: Oak has name off and activity on; Harbor has name on and activity off.
- **Role:** the 390×640 original is the reference's Champion capture, so that fixture's
  member is Oak's founding Champion.
- **Outputs:** each original gets `side-by-side` (labels in a strip above both frames),
  `overlay-50` and `difference`. `manifest-*.json` records the hashes, facts, switch states,
  boxes and the ring measurement.

| comparison | differing share (measurement, not verdict) |
|---|---|
| Community 390×844 | 0.3402 |
| Community 390×640 | 0.3489 |
| Settings 390×844 | 0.2311 |
| Settings 390×640 | 0.2842 |

**What the share is made of.** These are route-level differences that the matched frames now
show honestly. None of them is in the three HOLD items, and I have not changed any of them.
- **Masthead:** the reference's masthead is 92 px (a 30 px prototype strip plus a 62 px top
  bar); the canonical one is 52 px. That shifts everything below it up by about 40 px, so
  the Community share is mostly offset rather than a component mismatch.
- **Community order:** Harbor comes before Oak. The server lists communities by name
  (`functions-westayfit/src/index.ts:9415`), where the reference puts the current community
  first.
- **Banner text:** W4's accepted mapping gives "FAMILY AND FRIENDS" and a join-policy line,
  with no place or descriptor field.
- **Role label:** "Founding Champion", the canonical label, where the reference says
  "Champion".
- **Period line:** the goal's real window ("Sep 20 – 27"), where the reference says
  "This week · squats only".
- **Settings:**
  - The header has no sample kicker (omitted per `5844878042`).
  - Close is a named text button, where the reference has an icon.
  - The shown-name hint reads "Members see your name", not "Alex M.", because the route
    does not pass `shownName` (no formatted name source is wired).
- **Fonts:** the fixture uses the app's default stack, where the reference names Avenir Next.

### Results on `0e5d6f38` (specs at `6f34ff7b`)

| run | result | RAW |
|---|---|---|
| matched-fixture capture | 2/2 (asserts the panel inset, the ring in bounds, 23 / 3) | `RAW-matched-0e5d6f38.txt` |
| frame capture (`cp4`) | 6/6: Settings entry/exit, focus return, reduced motion | `RAW-capture-cp4-0e5d6f38.txt`, `CANDIDATE-cp4-*` |
| W7 Check 45 (`18d8caca`), unchanged | FAIL-BEFORE **15/15**, PRESERVE **13/13** | `RAW-w7-check45-0e5d6f38.txt` |
| dependency set (16 files) | 132 passed, **1 failed (H6)**, 3 skipped (gated) | `RAW-dependency-0e5d6f38.txt` |
| H1–H10 after the H6 fix (`6f34ff7b`) | **10/10** | `RAW-h1-h10-6f34ff7b.txt` |
| vitest / tsc | 1028/1028, clean | — |

**H6** failed because its x = 20 scrim press now lands on the panel. It is fixed in
`6f34ff7b` by the change described above, with no product change.

## Route parity pass 2: product `ffb517e5` (Director `5845751705`, W9 ACK `5845892810`)

The functional results (W7 Check 51 on `2e235c58`) carry forward. No data, Firebase, privacy
or navigation behaviour changed. The `matched/` frames and manifests are **re-captured on
`ffb517e5`**; the earlier `0e5d6f38` ones are in git history at `ebcc038a`.

### What changed
1. **The real masthead (62 px).** `MEMBER_TOP_BAR_BODY` goes from 52 to 62, hairline included.
   This is the shared shell, so every member tab moves 10 px down. Measured, it now matches
   the reference bar under its strip:
   - the bar sits on the page's warm white `#FBFAF4` with the reference's `#D7DFE7` rule;
   - the 24-high wordmark sits 20 px under the top edge (y 20–43, against the reference's
     50–73 minus its 30 px strip);
   - the menu glyph is three 3 px rules, 21 wide, on an 8 px pitch.

   The 30 px prototype strip is **not** reproduced.
2. **Tab bar rhythm.** It uses the reference's ground, rule and upward lift, with a
   32×24 active pill and 11 px labels. Measured against the reference:
   - glyphs sit at y 793–810 (reference 792–811);
   - labels sit at y 819–826 (reference 819–826);
   - the active pill sits at y 790–813 (reference 790–814).

   The glyph artwork is a declared platform difference: the reference uses Lucide line
   icons and the MOVE pulse, and no icon package is added.
3. **Selected community first**, in both the chips and the Settings sections
   (`currentFirst`). It changes presentation only, never server order, and is unit-tested.
4. **Copy and controls:**
   - **Role:** the banner fact reads **Champion** (`roleFact`; `roleLabel` is unchanged;
     unit-tested).
   - **Close:** a drawn **× CLOSE**. Its name is still "Close" and the target is ≥44 px.
   - **Privacy hint:** reads "Members see “Alex M.”". This is the member's
     `displayName.trim()`, the same rule the server's roster uses, taken from the already
     loaded profile (`peekMemberProfile`), so no read is added.
5. **Settings header geometry.** The rule sits 82 px under the panel top (y 94), the title is
   22 px regular at line-height 1.5, and the body starts 19 px under the rule. The panel
   now matches the reference row for row:

   | element | candidate y | reference y |
   |---|---|---|
   | rule | 94 | 94 |
   | note box | 113 | 113 |
   | section 1 | 236 | 235 |
   | first row | 267 | 267 |

### Matched-fixture comparison on `ffb517e5` (full frames, no crop, no alignment)

| comparison | differing share at `0e5d6f38` | **at `ffb517e5`** |
|---|---|---|
| Community 390×844 | 0.3402 | **0.3025** |
| Community 390×640 | 0.3489 | **0.3380** |
| Settings 390×844 | 0.2311 | **0.1169** |
| Settings 390×640 | 0.2842 | **0.1336** |

Other facts from the capture:
- **Ring:** classification agreement 99.89 % / 99.87 %, mean channel delta 0.04.
- **Panel:** at (12, 12), 366×820 and 366×616.
- **Chips:** Oak, then Harbor.
- **Role:** Member at 390×844, Champion at 390×640.

**Diagnostic only, not evidence.** Most of the remaining Community share is the reference's
30 px prototype strip, which is intentionally absent, so everything below it sits 30 px
higher. Reading the reference 30 px lower gives:

| frame | shifted share, whole frame | shifted share, above the tab bar |
|---|---|---|
| 390×844 | 0.0855 | 0.0730 |
| 390×640 | 0.1657 | 0.1438 |

At 390×640 the fixed tab bar also covers different content once the page shifts. The frames
and composites themselves stay unaligned.

### Annotated intentional differences (Director `5845751705`)
1. **Truth:** the real group type and join-policy text ("FAMILY AND FRIENDS", "Anyone with
   the link can join") stand in for the prototype's place and descriptor. The goal's real
   window ("Sep 20 – 27", "Apr 1 – 30") replaces "This week" / "April".
2. **Truth:** there is no 30 px prototype/sample strip, and no "SAMPLE MEMBER · DESIGN
   PROTOTYPE" kicker; the kicker's space is kept.
3. **Platform:**
   - font rasterisation (no Avenir Next);
   - tab and MOVE glyph artwork (no icon package);
   - the chips' ✓ / ＋ text glyphs;
   - the canonical privacy scope sentence and final note (W4 C3).

### Results on `ffb517e5`

| run | result | RAW |
|---|---|---|
| matched capture | 2/2: asserts inset, ring in bounds, 23 / 3, role, both orders, hint | `RAW-matched-ffb517e5.txt` |
| `cp5` Settings motion / focus frames | 6/6 | `RAW-cap-ffb517e5.txt`, `CANDIDATE-cp5-*` |
| W7 Check 45 (`18d8caca`), unchanged | FAIL-BEFORE **15/15**, PRESERVE **13/13** | `RAW-check45-ffb517e5.txt` |
| dependency set (17 files, including `ui-community-home`) | **136 passed**, 3 skipped (gated) | `RAW-dep-ffb517e5.txt` |
| vitest | **1034/1034** | `RAW-vitest-ffb517e5.txt` |
| tsc | clean | — |

## Not ours

- The H3c successor belongs to its owner, not this packet.

`MANIFEST.sha256` lists every committed file here.
