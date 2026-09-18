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
| 2 | Security + privacy adversarial audit | pending | | [02-SECURITY-PRIVACY-AUDIT.md](02-SECURITY-PRIVACY-AUDIT.md) |
| 3 | Contribution resilience torture | pending | | [03-CONTRIBUTION-RESILIENCE.md](03-CONTRIBUTION-RESILIENCE.md) |
| 4 | Display + authorization race torture | pending | | [04-DISPLAY-AUTH-RESILIENCE.md](04-DISPLAY-AUTH-RESILIENCE.md) |
| 5 | Accessibility + responsive QA | pending | | [05-ACCESSIBILITY-RESPONSIVE-QA.md](05-ACCESSIBILITY-RESPONSIVE-QA.md) |
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

## Defect ledger (running)

| # | Found in | Defect | Class | Status |
|---|---|---|---|---|
| D-1 | Task 1 | `signup.tsx` double `router.replace('/verify-email')`; late replace after slow send callable pulls a member back from profile-setup | product, pre-existing, out of PR scope | documented, not fixed; harness made deterministic |
