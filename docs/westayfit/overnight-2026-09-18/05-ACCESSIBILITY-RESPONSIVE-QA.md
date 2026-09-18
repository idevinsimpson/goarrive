# Task 5/8 — Accessibility + responsive QA

Scope: Community Home (incl. the Manage sheet), the contribution flow, the public display (phone and 1440×900). Method: an Opus read-only audit (checklist coverage, computed WCAG contrast for every text/background pair actually used, touch-target inventory, screen-reader reading order, objective defects with narrowest fixes); one Opus implementer fixed the defects with fails-before/passes-after proof under exclusive emulator access; a second Opus worker authored the standing accessibility contract spec; Fable integrated and ran the suites. Approved surfaces were not redesigned: every approved size and colour is unchanged for the fixtures the owner reviewed; the fixes are role/name/label additions, minimum target sizes, one contrast token, and a length-tiered type scale that only engages above the reviewed name lengths.

## 1. Checklist

| Item | Result |
|---|---|
| 390×844, 360, 320, 195 (200% page-zoom proxy) — no horizontal overflow, nothing clipped in its own box | `ui-qa` (390/360/195) re-run; **new** `ui-a11y` R1 adds 320 and server-maximum names (80/120/40) plus a 90-char unbroken token on all three surfaces |
| 200% browser text zoom | **manual** — not honestly automatable: RNW emits px sizes so text-only zoom is inert; page zoom is what 1.4.4 permits and 195 px covers it |
| Keyboard navigation + visible focus | `ui-qa` and torture R14 re-run; **new** R4 walks real Tab presses per surface and asserts a focus ring exists on every stop (ring visibility against navy remains manual) |
| Manage sheet focus containment, Escape, background inert | re-run; **new** R5: named `dialog`, `aria-modal`, `#root` outside the dialog, focus returns to the opener on Escape, trap holds at 195 px. RNW 0.21 sets neither `inert` nor `aria-hidden` on the page behind; `aria-modal` plus the capture-phase trap is the mechanism (recorded, not a defect) |
| Numeric entry / on-screen keyboard | `inputmode=numeric` (was set), `enterkeyhint=done` (**added**), 40 px font so iOS does not zoom on focus (iOS behaviour itself manual) |
| Long goal / community / unit names | **new** R1/R2 at server maxima; display length-tiered scale (**fixed**) |
| Reduced motion | **new** R6: nothing animates on a settled screen, the Living WE shows its true fill on first paint |
| Meaning without green | text states every number on every surface (asserted); greyscale screenshots produced for human review; note for the owner: green fill vs white unfilled on navy is 1.90:1 — the adjacent text carries the meaning, so this is a colour decision, not a code fix |
| Screen-reader labels / names | headings (**added**), dialog name (**added**), per-goal button names (**added**), alert + live regions (**added**); WE `aria-label` and wordmark names asserted |
| Contrast | every pair computed; one failure fixed (entry placeholder 2.26:1 → 4.97:1); all others ≥ 4.5:1 body / ≥ 3:1 large; the hero rule sits at 3.00:1 (do not darken) |
| Touch targets ≥ 44×44 | six under the bar found and **fixed**; R3 inventory over every control on every state |
| Wide 1440×900 no primary scroll | the existing `scrollHeight ≤ 900` assertion could not see symmetric overflow (centred column, `overflow: hidden`); **new** rect-containment inside the canvas's padded box, phone and wide, at maximum names |

## 2. Defects found and fixed

| # | Defect | Fix | Proof (`ui-a11y-fixes`) |
|---|---|---|---|
| D-19 | No programmatic headings on any surface (WCAG 1.3.1) | `accessibilityRole="header"` with `aria-level` 1 on the top heading per surface (community name, contribute state heading, display goal title) and 2 on secondary headings | (b) one level-1 heading per surface: 0 before, 1 after |
| D-20 | No status messages announced (4.1.3): validation error had no role; receipt/pending/refusal/recording swaps were silent; the stale pill was not announced | `role=alert` on the entry error; `aria-live="polite"` on the four contribute cards and the display freshness row | (c) `getByRole('alert')` reads "Enter how many you completed." |
| D-21 | Manage sheet dialog had no accessible name | `aria-label="Champion tools"` on the Modal | (a) `getByRole('dialog', { name: 'Champion tools' })` |
| D-22 | Six targets under 44 px: Manage 40, Refresh 32, Record more 40, Community details 40, +5/+10/+25 chips 40, footer "Back to home" ~19 (an inline anchor) | min heights to 44; the inline `SecondaryLink` at four Community Home sites replaced with the file's `ButtonLink` (same label, href, spacing; new testIDs `wsf-community-signin`, `-not-member-home`, `-error-home`, `-home-link`) | (d) undersized-target inventory: 7 offenders before, none after; `ui-qa` 195 px reflow still green |
| D-23 | Entry placeholder contrast 2.26:1 | placeholder colour = muted token `#5A6B85` (4.97:1 on cream) | (e) computed `::placeholder` colour |
| D-24 | Display clipped at long names: wide left column 608 px tall pushed the period/headline past the canvas (symmetric overflow invisible to `scrollHeight`); phone hero spilled over its card | length-tiered type scale in `src/ui/displayTypeScale.ts` (first tier equals the approved size; steps down above 40/70/95-char titles and 45-char community names), applied as an inline style after the approved styles; 10 unit tests | (f) padded-box containment at 1440×900 and 390×844 with 80/120/40-char names, building and closed-reached: offenders before, none after; wide column ≈400 px in a 744 px box |
| D-25 | `enterKeyHint` missing on the only input | `enterKeyHint="done"` | (e) |
| D-26 | Duplicate accessible names: every goal's toggle read "Authorize public display"; per-goal "Try again"; context-free "Refresh" | `accessibilityLabel` carries the goal title (visible text unchanged) | (g) with two goals, bare-name count ≤ 1 |
| — | `ButtonLink` accepted an array style that `Link asChild` spreads into `{0:…,1:…}` and blanks the route (found by the implementer while replacing the footer link) | `StyleSheet.flatten(style)` in the shared component | build + `ui-qa`/`ui-journey` green |

## 3. Skipped / recorded

- **Page title per route (2.4.2)** — `page.title()` is "We Stay Fit" on every route (not empty). expo-router hard-disables document titles on web (`documentTitle.enabled = false` in ExpoRoot) and the app does not use `expo-router/head`; adding that dependency to the static export for a P3 is an owner decision. Recorded, not done.
- **Living WE fill contrast on navy (1.90:1)** — approved colourway; the text beside it carries the meaning. For the owner's record.
- **`aria-expanded` on the Manage button has no `aria-controls`** (the sheet is portaled outside `#root`); RNW sets no `inert` on the page behind. Screen-reader virtual-cursor behaviour is a manual check.
- Two `<title>` elements in every exported page (the injected one and react-helmet's empty one); `document.title` resolves to the injected one today.

## 4. Manual checks that remain

Real-browser 200% text-only zoom (expected inert), focus-ring visibility against the navy hero, greyscale verdict on the R10 artifacts, iOS Safari focus/keyboard behaviour, one VoiceOver/NVDA pass against the reading-order transcript in the audit, a real 1440×900 wall display at the owner's longest goal name.

## 5. Test receipts for this task

| Suite | Result |
|---|---|
| `ui-a11y-fixes` (8 proof tests, each failing before the fix) | 8 passed |
| Implementer's regression runs: `ui-qa` 5, `ui-display` 4, `ui-community-home` 2, `ui-contribute` 7, `e5-display-authorization` 5, `d-admission-controls` 5, `ui-journey` 1, `ui-champion-torture` 5, `mu2-flow` 4 | all passed |
| Vitest | 219 passed / 15 files (10 new type-scale tests) |
| App TypeScript | clean |
| `ui-a11y` standing contract (21 tests) | UI_A11Y_RESULT |
