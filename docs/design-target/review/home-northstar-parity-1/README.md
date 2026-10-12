# HOME-NORTHSTAR-PARITY-1: evidence

- **Packet:** Director #497 `5846941982`, W9 ACK `5846952566`. **Base:** development `6deefe7d`.
- **Product:** `6ba49f10` (one commit). This evidence is its own commit.
- **Status:** delivered. Not accepted, integrated or staged.
- **Emulator only** (`demo-wsf-local`); nothing is deployed.

## Source and reference manifest

| | |
|---|---|
| Reference project | Lovable `e15b9fa0-b2a0-4314-bc21-9c573b8eceb1`, packet ref `973e114191d6fb43665ead26513f9247c8eb244c` |
| Frozen frames | `motion-handoff-evidence/mhc-home-default-390x640.png` `fcb0d78608e1feae43ce10f924dba13699dde3d0ca2cc45519a3ffaa862b5e8a` and `motion-handoff-evidence/mhc-home-default-390x844.png` `8f79bb314c3985701008c157e17cf4a354acc2e6231fa5586102ac6b819e080b`. Each is decoded byte for byte from its `.b64` twin at that ref into `reference/`, and its SHA-256 matches the packet. |
| Source donors, read at the same ref | `src/demo/screens/home.tsx` (`HomeScreen`, `GoalHero`, `PresenceStack`) and `src/styles.css` (`.community-intro`, `.people-presence`, `.avatar-stack`, `.goal-hero` with `::before`/`::after`, `.goal-topline`, `.hero-kicker`, `.status`, `.living-we`, `.goal-number`, `.progress-track` / `-meta`, `.hero-presence`, `.action-pair`, `.primary-action` / `.secondary-action`, `.own-contribution`, `.section-heading`, `@media (max-height: 700px)`) |
| Translated, not copied | Every value is carried over as a native style. Nothing of the prototype's storage, sample authority or local ledgers is used. The exact wordmark and monogram assets were already accepted and are not changed. |
| Canonical files | `apps/westayfit/app/(tabs)/(home)/community/[groupId]/index.tsx` (the Home route) and `apps/westayfit/tests-e2e/sprint-w9-home-northstar-parity-1.spec.ts` (new). No shell, tab-bar, memberReads, functions, rules, index, Community, Progress or You files are touched. `LivingWeProgress.tsx` is not touched either: its locked geometry was reached without it. |

## What changed on the Home first screen

- **Identity:**
  - The community name uses the reference's type: 27 px, weight 400, line-height 1.05.
  - The descriptor slot carries the join policy in the existing label words ("Private community"), because the prototype's free-form line has no canonical field.
  - The presence stack has three 29 px discs overlapping by 6 px, then "+N". "+N" counts **visible members not drawn**, and only once the member list came back complete.
  - The two facts sit beside the stack.
- **Goal card (`.goal-hero`):**
  - Shape: navy `#0B1F3A`, corners 24 / 24 / 10 / 10, padding 18 / 16 / 14.
  - **Its two rings are painted as the card's own background** (radial gradients from its measured box), so nothing is laid out past the card or past a 360 px screen (R1).
  - The kicker reads "COMMUNITY GOAL". The state pill sits beside the kicker line and doesn't push the title down. The title is 23 px, weight 400.
  - Living WE is 152 px (126 px short). The count is 38 px (32 px short), followed by "of 500 squats".
  - The track is 8 px, 8 px under the count, then the meta line.
  - The card closes with the reference's moved-today row: two faces and "12 people moved today.", over a quiet rule. It renders only when the server established the count.
- **Actions:** the reference's pair, 1.35fr / 1fr, both 54 px. "Already moved" keeps its full accessible name, "Already moved? Record squats".
- **Your part:**
  - Label "Your contribution to this goal", then "You've added 25 squats".
  - "Part of our shared 241" sits beside it: the member's exact part next to the shared confirmed total, never merged, and **only while the figure is live**.
- **Momentum:** "Recent momentum" plus the heading "We're showing up".
- **Freshness:** the "Confirmed …" line and Refresh move below the momentum section, after the matched first screen.
- **Page ground:** the reference's `#FBFAF4`.
- **Short heights (390×640):** only the reference's own `max-height: 700px` rules apply. The card sits 4 px closer, its top padding is 14, the Living WE is 126 px, the count is 32 px, and the presence rows are tighter. The first screen is its own fit, not a crop of the 844 layout.

## Matched full frames (`base/`, `candidate/`)

- **Producer:** gated on `WSF_CAPTURE_FRAMES` and `WSF_HNS_STAGE`.
- **Frames:** the real Home route, full 390×H viewports at device pixel ratio 1 (the originals' ratio).
- **Composites:** each frame is laid against the frozen original as side-by-side (labels in a strip above both frames), a 50 % overlay and a difference image. **No crop and no alignment.**
- **Fixture:** the reference's own sample state, **fixture data only**:
  - Oak Grove Together, 23 visible members;
  - 12 moved today;
  - "500 squats together" at 241 / 500 confirmed;
  - the member's own confirmed 25;
  - their +20 eight minutes ago leading the momentum.
- `base/` is the same producer on the development base `6deefe7d`.

| frame | differing share, base `6deefe7d` | **candidate `6ba49f10`** |
|---|---|---|
| Home 390×844 | 0.3736 | **0.2889** |
| Home 390×640 | 0.4422 | **0.3121** |

**Diagnostic only, not the evidence.** Most of the remaining share is offset: the reference carries a 30 px prototype strip, intentionally omitted, and at 390×640 its top bar is 56 px where the shared shell's is 62 px, which this packet may not touch. So every row is displaced. With the reference read 30 px lower (24 px at 640), above the tab bar:

| frame | base | **candidate** |
|---|---|---|
| 390×844 | 0.3730 | **0.1062** |
| 390×640 | 0.4545 | **0.0990** |

**Row geometry, measured against each frame's own top bar:**
- **Identity block:** eyebrow, name, descriptor, presence row and the card's top edge land on the reference's rows **to the pixel at both sizes**.
- **Card internals:** title, Living WE, count, track, meta, rule and moved-today row are within **0–1 px** at 390×844, and exact at 390×640.
- **Below the card:** the action pair, contribution label and value, and the momentum eyebrow are within **1 px**.

## Intentional differences (none hidden)

1. **The prototype's strip and sample labels are omitted.** "PROPOSED · DESIGN PROTOTYPE · SAMPLE DATA" and "Sample data ·" appear nowhere. The fixture's people are labelled as fixture data here and in the manifests.
2. **Canonical truth replaces sample prose:**
   - the descriptor is the join policy;
   - the kicker has no "· THIS WEEK" (there is no canonical period word);
   - the pill carries the real window, "Open · Ends Sat, Oct 3".
3. **Copy pinned by other lanes' specs is kept rather than widened into their files:**
   - "241 **of 500 squats**" (about 15 specs pin the total's text);
   - "259 **to go**";
   - "12 **people** moved today";
   - "You've added 25 squats";
   - the full pill window text (`ui-community-home`, `ui-journey`);
   - the shared `MomentumRow` format, "added 20 squats · 8m ago", with no right-hand amount and no "(you)", because `ActivityRow` carries no uid;
   - "See everyone in this community" below the feed, in place of the heading's "Members ›" (`sprint-w9-members-link-target`).

   Changing any of these is a spec-owner decision. The route can take the reference's words the day those contracts move.
4. **The momentum heading's line box is 26 px, not 31.5 px, and the card has no inner gap.** This keeps the first momentum row whole above the tab bar at 390×844 (the Director's standing guard, `sprint-w8-social-privacy`), which the reference's own row, under its strip, is not. The heading glyphs sit about 5 px higher than the reference's.
5. **Platform:**
   - font rasterisation (no Avenir Next);
   - the glyph artwork: no Lucide pulse, history or bar-chart icons on the buttons, the contribution tile keeps the canonical Progress glyph, and the tab bar and MOVE glyphs belong to the shell;
   - the short-height top bar is 62 px where the reference's is 56 px (shell, out of scope).

## Truth and interaction rows (ungated, in the focused spec)

| row | result on `6ba49f10` |
|---|---|
| **default:** the hierarchy; confirmed figure; own part distinct from shared; the pair side by side, both ≥44 px and the primary wider; one h1; nothing laid out past the viewport | pass |
| **unknown:** pulse refused from the start: "Progress couldn't be loaded", no figure, no shared figure, no moved-today row | pass |
| **last known:** refresh fails: "Last known" pill, no window, figure kept and said to be the last confirmed, no shared figure, "Your last-known contribution" | pass |
| **reached and open:** kicker "Goal reached" on a confirmed 512 / 500 | pass |
| **no open goal:** no hero, no actions, no invented count | pass |
| **warm return:** Home → Community → Home, watched every animation frame: never a loading replacement, never an unmounted hero; **Home reselect is a no-op** (same URL, same history length) | pass |

**Interaction timeline.** No motion or navigation changed in this packet:
- both actions keep their existing destinations and the existing MOVE sheet;
- the 140 ms tab fade is the shell's and is untouched;
- focus and scroll return are unchanged.

The warm-return row above is the timeline check. Its every-frame watch is in `RAW-matched-and-truth-6ba49f10.txt`.

## Results on `6ba49f10`

| run | result | RAW |
|---|---|---|
| matched producer (CANDIDATE) and six truth rows | **8 / 8** | `RAW-matched-and-truth-6ba49f10.txt` |
| matched producer on the base (BASE) | 2 / 2 | `RAW-matched-base-6deefe7d.txt` |
| existing Home-dependent specs, 18 files (see the list below) | **119 / 119** | `RAW-home-dependents-6ba49f10.txt` |
| vitest, whole app | **1042 / 1042** | `RAW-vitest-6ba49f10.txt` |
| tsc | **0** | `RAW-tsc-6ba49f10.txt` |

The 18 files:
- community freshness, social privacy;
- app-feel-parity-1, focus-return-1, home-polish-capture, home-return, members-link-target, perf-mobile-1, return-continuity-rendering, shell-production;
- ui-a11y-fixes, ui-a11y, ui-app-shell;
- champion-torture, community-home, contribute-repeat-policy, journey, matrix.

`RAW-home-dependents-prefix-wip.txt` is the same set run on the uncommitted work before `6ba49f10`: 118 passed, 1 failed. The failure was the social-privacy viewport guard, and difference 4 fixed it before the product commit. It is kept so that failure stays on record.

## Browser and emulator versus device

- Every frame and row here is **Chromium on the Firebase emulators**. Safari and native devices are not measured.
- On native, the rings use React Native's `experimental_backgroundImage` radial gradients (RN 0.81). That path is **not exercised here**.
- Safe-area insets are zero in the browser, so on a notched device the frames shift by the device's own inset.

`MANIFEST.sha256` lists every file in this directory.
