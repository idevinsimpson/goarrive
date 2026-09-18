# We Stay Fit — overnight run 2026-09-18 (PR #327)

Canonical status page for the autonomous overnight hardening run on `claude/wsf-ui-member-experience`.
PR #327 stays a **draft**. Nothing merged, deployed, or changed on `main`, IAM/WIF, `approved-candidate.json`, rules/indexes, or production.

Base: `claude/wsf-package-e-display-auth` @ `3560936b37900591d41240adf98ea82b1b8f0c72`.
Head at handoff: `5af29f48df73745e500f99cfbf26a64e8d0cd085`.

Review channel: ChatGPT inspects the PR hourly and may leave `[CHATGPT HOURLY REVIEW]` comments; each task comment below states whether one was found and incorporated.

## Task status

| # | Task | Status | Head after task | Doc |
|---|---|---|---|---|
| 1 | Baseline freeze + Gate 1 investigation | done | `4852371` | [01-BASELINE-AND-GATE1.md](01-BASELINE-AND-GATE1.md) |
| 2 | Security + privacy adversarial audit | done | `f721350` | [02-SECURITY-PRIVACY-AUDIT.md](02-SECURITY-PRIVACY-AUDIT.md) |
| 3 | Contribution resilience torture | done | `e531433` | [03-CONTRIBUTION-RESILIENCE.md](03-CONTRIBUTION-RESILIENCE.md) |
| 4 | Display + authorization race torture | done | `0b0797c` | [04-DISPLAY-AUTH-RESILIENCE.md](04-DISPLAY-AUTH-RESILIENCE.md) |
| 5 | Accessibility + responsive QA | done | `963d0df` (+ index 9669c53) | [05-ACCESSIBILITY-RESPONSIVE-QA.md](05-ACCESSIBILITY-RESPONSIVE-QA.md) |
| 6 | Performance + operational quality | pending | | [06-PERFORMANCE-OPERATIONS.md](06-PERFORMANCE-OPERATIONS.md) |
| 7 | Cross-surface product quality audit | pending | | [07-CROSS-SURFACE-QUALITY.md](07-CROSS-SURFACE-QUALITY.md) |
| 8 | Final candidate hardening + evidence pack | pending | | [08-FINAL-CANDIDATE-RECEIPT.md](08-FINAL-CANDIDATE-RECEIPT.md) |

Visual evidence: `OVERNIGHT-VISUAL-BOARD.png` (produced in Task 7).

## Task 1 — Baseline freeze + Gate 1 investigation

- **Baseline** recorded: clean tree at `5af29f4`, 47 changed files vs base grouped by category, all suites green except `gate1.sh`.
- **Gate 1 failure root-caused** with a Playwright trace: a pre-existing race in `app/signup.tsx` (present on the base commit, file untouched by this PR). Signup navigates to `/verify-email` twice; the second navigation fires after the best-effort `wsfSendVerificationEmail` round trip and pulls the member back if they already tapped **I have verified**. A test can do that within a second; a person cannot.
- **Harness correction** (test files only, no assertion weakened, nothing skipped): the four signup-driving specs wait for the send round trip before verifying. Seven sites.
- **Regression evidence**: Gate 1's 7-spec browser command 3/3 green after the fix (31 passed each); full `gate1.sh` result: **GATE 1 CLEAR** (exit 0; unit 205, callable 204, browser step 31/31).
- **Product fix deliberately not made** (authentication screen outside this PR's scope); one-file plan recorded in the task doc.
- ChatGPT review instruction: none present at task start.

## Task 2 — Security + privacy adversarial audit

- **Operating model from this task on:** Fable is the integrator; Opus workers (explicit `opus` model selection is available here) do isolated analysis and adversarial review; every worker result is verified and integrated by Fable; workers never push.
- **New adversarial callable suite** (33 cases): malformed ids, request-field trust, non-active membership statuses, cross-community rows, cache isolation across goals and decisions, sample suppression through a member-warmed cache, membership loss inside the TTL, unusable community references, the Champion control as oracle, role escalation, unapproved document fields. All green.
- **Independent Opus review**: 3 attack lenses, every finding verified by a refuter; 6 confirmed, 5 refuted.
- **Fixed** (narrow, no contract change): D-2 empty community reference returned `internal` → generic not-found; D-3 malformed display URL polled for ever → terminal refusal; D-4 malformed contribution link showed the server message → not-found card; D-6 contribute poll kept painting after membership loss → terminal not-found; D-8 contribute poll ordering guard. Plus `unauthenticated` on the contribution load → sign-in screen.
- **Owner boundary, not applied:** D-5 Firestore rule `wsfIsGroupMember` is existence-only (removed members can read the community document incl. join code directly). Proposed fix and rules test in the task doc.
- **Deferred:** D-7 (Champion notice hidden when the goals reload fails) → Task 4. **Gap recorded:** D-9 legacy orphan never surfaced (product copy decision). **Accepted:** D-10 timing side channel (no enumerable id space).
- Harness: callable Jest ceiling 30 s (matches the per-test convention already used by the multi-step suites).
- ChatGPT review instruction: none present (checked at task start and mid-task).

## Task 3 — Contribution resilience torture

- Opus design pass mapped all 18 owner scenarios to existing coverage or deterministic recipes; one Opus implementer (exclusive emulators) fixed the reproducible defects and wrote the P0 tests; a second Opus worker authored the remaining tests as code; Fable integrated, added D-12 and its test, ran the battery.
- **New tests**: `ui-contribute-torture.spec.ts` (double tap, goal A→B late success, leave during sending, stale before-total), `ui-contribute-torture-2.spec.ts` (leave/return while unknown, no poll while unknown, closure on Review, closure while unknown both branches, wsfAdjustGoal reflected, keyboard through pending and refusal, unresolved attempt after membership loss), a late-SUCCESS A→B→A case in the seam spec, and a concurrent same-attemptId callable case.
- **Fixed**: D-11 double tap could render a first success as "already recorded" (synchronous in-flight ref); D-12 "Goal not found" hid an unresolved attempt from a removed member returning on a fresh load (render order; unit-less number when the goal has not loaded); D-13 replay passed a frozen before-total that could invert reached/overshoot copy (replay passes null → `reached`); D-14 context check compared the goal with itself (now reads the live context ref; defence in depth).
- **Gaps recorded**: closure while on Review loses the typed number without a sentence; the reminder's durability sentence is not true when storage is unavailable; D-9 legacy orphan. All copy/product decisions.
- Receipts: browser 22/22 across four contribution specs, callable 238/238 (18 files), Vitest 205, TS clean.
- ChatGPT review instruction: none present (checked at task start, mid-task and at close).

## Task 4 — Display + authorization race torture

- Opus design pass (20 scenarios → coverage/recipes + 7 suspected defects), Opus implementer with exclusive emulators (5 fixes, each with a fails-before/passes-after test), Opus tests-only worker (device-zone, cache-window, recheck-while-down, sheet-closed-mid-request cases), Fable integration.
- **Fixed**: D-7/D-7b Champion outcome notices survive a failed or in-flight goals reload (orphan outcome block, same copy/testIDs); D-15 a landed revoke on a closed goal is confirmed by its absence instead of "could not confirm"; D-16 sample-community Champion card carries "no public display will show it"; D-17 an active goal past its end reads "Ended …" instead of "Open · Ends …" on both surfaces (shared helper, label only, routes untouched); D-18 Check again shows the loading state at once.
- **New tests**: `ui-champion-torture`, `ui-display-torture`, `ui-display-torture-2` (Tokyo/Kiritimati device zones, 3 flips inside one cache window, poll cadence 4–7/10 s, refusal → Check again while down), `ui-champion-torture-2` (sheet closed mid-request), 4 dates unit tests.
- **Not fixed**: contribution routes stay offered on an ended window (product decision); server-side `wsfSetGoalDisplayAuthorization` ignores `isSample` (functions untouched); cache `now` capture → Task 6.
- Receipts: browser 18/18 in one run + 12 across the implementer's per-spec runs; Vitest 209; TS clean.
- ChatGPT review instruction: none present (checked at task start and mid-task).

## Task 5 — Accessibility + responsive QA

- Opus audit (coverage checklist, computed contrast for every pair in use, target inventory, screen-reader reading order), Opus implementer with fails-before/passes-after proof for 8 groups, Opus-authored standing contract spec (`ui-a11y`, 22 cases: widths 390/360/320/195 with server-maximum names, display containment, 44 px targets, Tab + focus rings, dialog contract, reduced motion, axe WCAG A/AA, alert/input contracts, greyscale artifacts).
- **Fixed**: D-19 programmatic headings; D-20 status messages announced (alert + polite live regions); D-21 dialog name "Champion tools"; D-22 six targets under 44 px incl. the inline footer link; D-23 placeholder contrast 2.26 → 4.97:1; D-24 display clipping at long names (length-tiered type scale, approved sizes unchanged); D-25 enterKeyHint; D-26 duplicate accessible names. Plus ButtonLink array-style hardening.
- **Skipped/recorded**: per-route page title (expo-router disables document titles on web; needs a new dependency — owner decision); Living WE fill 1.90:1 on navy (approved colourway, text carries meaning); manual checks listed in the doc.
- Contract first run: 19/22 — two real findings (heading overflow at 195 px with an 80-char name; no h1 on the display's unavailable state) fixed in Task 6's commit.
- Receipts: `ui-a11y-fixes` 8/8; regression runs `ui-qa` 5, `ui-display` 4, `ui-community-home` 2, `ui-contribute` 7, `e5-display-authorization` 5, `d-admission-controls` 5, `ui-journey` 1, `ui-champion-torture` 5, `mu2-flow` 4; Vitest 219; TS clean.
- ChatGPT review instruction: none present (checked at task start and mid-task).

## Defect ledger (running)

| # | Found in | Defect | Class | Status |
|---|---|---|---|---|
| D-1 | Task 1 | `signup.tsx` double `router.replace('/verify-email')`; late replace after slow send callable pulls a member back from profile-setup | product, pre-existing, out of PR scope | documented, not fixed; harness made deterministic |
| D-2 | Task 2 | empty `communityGroupId` on an authorized goal answered `internal` instead of the generic not-found | backend, corrupt-document edge | fixed + test |
| D-3 | Task 2 | malformed display URL treated as transient; polled for ever | frontend honesty / ops | fixed + test |
| D-4 | Task 2 | malformed contribution link showed the server's argument message | frontend honesty | fixed + test |
| D-5 | Task 2 | Firestore rule `wsfIsGroupMember` existence-only; removed members read the community doc incl. join code via SDK | rules, pre-existing | **owner boundary — not applied**; proposed fix + rules test documented |
| D-6 | Task 2 | contribute poll swallowed `not-found`; screen kept the total after membership loss | frontend honesty | fixed + test |
| D-7 | Task 2 | Champion display-auth outcome notice unreachable when the goals reload fails | frontend | deferred to Task 4 |
| D-8 | Task 2 | contribute poll without ordering guard | frontend | fixed |
| D-9 | Task 2 | quarantined legacy pending row never surfaced | product copy | gap recorded, not fixed |
| D-10 | Task 2 | pulse refusal timing differs by one read for existing vs unknown goal | backend, low | accepted, not fixed (no enumerable id space) |
| D-11 | Task 3 | double tap on Record could render a first success as "already recorded" | frontend truth | fixed + test (R1) |
| D-12 | Task 3 | "Goal not found" rendered above an unresolved attempt after membership loss on a fresh load; attempt unreachable | frontend, invariant (unknown outcome never discarded) | fixed + test (R15) |
| D-13 | Task 3 | replay used a frozen before-total; could invert reached vs overshoot copy | frontend truth | fixed + test (R11) |
| D-14 | Task 3 | context check compared the goal id with itself | frontend, latent | fixed (regression guards R3/R6) |
| D-7b | Task 4 | successful authorize whose reload fails left no confirmation on screen | frontend truth | fixed + test |
| D-15 | Task 4 | landed revoke on a closed goal reported as "could not confirm" | frontend truth | fixed + test |
| D-16 | Task 4 | sample-community Champion card claimed a publication the server refuses | frontend truth | fixed (qualifier) + test |
| D-17 | Task 4 | active goal past its end labelled "Open · Ends <past date>" on both surfaces | frontend truth | fixed (label only) + unit + browser tests |
| D-18 | Task 4 | Check again gave no feedback for a full round trip | frontend | fixed + test |
| D-19 | Task 5 | no programmatic headings on any surface | a11y (1.3.1) | fixed + test |
| D-20 | Task 5 | status messages not announced (validation error, receipt, pending, refusal, stale pill) | a11y (4.1.3) | fixed + test |
| D-21 | Task 5 | Manage sheet dialog unnamed | a11y (4.1.2) | fixed + test |
| D-22 | Task 5 | six touch targets under 44 px | a11y / phone | fixed + test |
| D-23 | Task 5 | entry placeholder contrast 2.26:1 | a11y (1.4.3) | fixed + test |
| D-24 | Task 5 | display clipped at server-maximum names (wide and phone) | responsive | fixed (type scale) + tests |
| D-25 | Task 5 | no enterKeyHint on the entry field | a11y / phone | fixed + test |
| D-26 | Task 5 | duplicate accessible names for per-goal controls | a11y (2.4.6) | fixed + test |
| D-27 | Task 5 | h1 overflows at 195 px with an 80-char community name; display unavailable state has no h1 | a11y / responsive | fixed in Task 6 commit |
