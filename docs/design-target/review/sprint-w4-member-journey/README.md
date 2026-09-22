# Sprint W4 — Member Journey / Integration Readiness

Worker: **W4** (Claude Code Remote session)
Branch: `claude/wsf-sprint-member-journey`, cut from `e609c57319b2cb9f2a6dac044f310c535ec61185` (PR #365 head, `claude/wsf-app-shell`).
Assignment: PR #365 comment 5781435779, section W4.

Status: **CHECKPOINT-READY** — first deliverable complete; all three parts are in this directory.

## Contents

| File | What it holds |
|---|---|
| `README.md` | This index and the worker roster line. |
| `journey-regression.md` | Join acceptance package: focused journey regression results, pinned to the source SHA. |
| `e609c57-verification.md` | Verification of the hero "Try again" colour fix and the existing Progress/Home corrections. |
| `pr-390-integration-plan.md` | Scratch integration test *plan* for PR #390 — prepared, not executed against any release branch. |
| `join-review-evidence.md` | The Join review-evidence package for `/join/[joinCode]`: frame inventory with capture revisions, the functional evidence it accompanies, and one finding about the intact guard's coverage. |
| `members-rewrite-parity-fix.md` | Packet 3: the assigned bounded fix for the emulator members-rewrite drift, on branch `claude/wsf-sprint-w4-emulator-members-rewrite` (PR #405). |
| `combined-runtime-e609c57-e982ddc.md` | Deliverable 4: the isolated combined-runtime test of app `e609c57` + visibility `e982ddc`, and the one defect it found. |

## Rules this worker operates under

- Adds only `apps/westayfit/tests-e2e/sprint-w4-*.spec.ts` and `docs/design-target/review/sprint-w4-member-journey/**`.
- Does not edit the app shell, auth model, `functions-westayfit/src/index.ts`, `firestore.rules`, `firestore.indexes.json`,
  `scripts/westayfit/north-star/**`, any existing spec, or any frozen BEFORE / accepted TARGET / AFTER image.
- A proved product defect is reported in the PR body for the lead to assign; W4 does not patch it.
- No deployments, no rules/index deploys, no production changes.
- `/start-community`, `/goals/new`, `/combined` and any additional page remain gated and are not built here.
