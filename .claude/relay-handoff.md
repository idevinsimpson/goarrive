# Staging Handoff — Post-Deploy Protocol

**Updated 2026-08-11: Relay/Manus automated smoke tests are RETIRED (Devin, #goarrive-notes, 2026-08-11 ~11:40 AM ET: "Relay no longer does smoke tests. Devin will do them."). Do NOT mention `<@U0B1YQS8L12>` (Relay) after staging deploys — it will not respond.**

## The Rule

After every successful staging deploy, before reporting done:

1. **Post the staging URL in `#dev-goarrive`** with: what changed, what to focus on, and anything that can't be tested yet. The channel suffix changes per deploy — always include the full URL.
2. **Run an automated pre-validation pass yourself when feasible** (Browser Use E2E — stateless browser testing against staging is Maia's lane per `.claude/agent-task-routing.md`). Post the PASS/FAIL-per-route table in the same thread. Mark anything you can't drive as BLOCKED for Devin rather than skipping it silently.
3. **Devin's manual staging review is the authoritative smoke test.** Tag him with the focus list. His verdict gates production consideration — never production deployment itself, which always requires his separate explicit go.

## Merge gating

PR merge/deploy authority is governed by the **Standing Release Policy in `AGENTS.md`** (approved by Devin 2026-08-01): release-scoped, ready PRs in a named batch merge to `main` and deploy to staging under standing approval — no per-PR approval buttons. Stop-on-surprise conditions still halt everything. This file governs the *validation* step, not merge authority.

> Note (2026-08-11): an earlier draft of this update proposed holding PRs as drafts until Devin's staging approval. That conflicts with the 8/1 Standing Release Policy and is NOT in force — flagged to Devin for reconciliation; until he rules, the Standing Release Policy governs.

## Smoke Test Account (staging validation)

The dedicated platformAdmin test account (formerly Manus's) remains valid for automated or manual staging passes:

| Field | Value |
|---|---|
| Email | `relay@goarrive.fit` |
| Password | `GoArriveRelay2026!` |
| UID | `tsUERODrkSaqfTgiRF2pYcWgjXs1` |
| Role | `platformAdmin` (`role: 'platformAdmin'`, `admin: true`) |

**If login fails:** run `setAdminRole` on UID `tsUERODrkSaqfTgiRF2pYcWgjXs1` to restore the custom claim.

## Updated /ship Workflow

```
Step 1: tsc --noEmit
Step 2: npm run test:vitest -- --run
Step 3: npx expo export --platform web
Step 4: npm run deploy:staging
Step 5: Post staging URL + what-changed + focus list in #dev-goarrive
Step 6: Run Browser Use pre-validation when feasible; post PASS/FAIL table in-thread
Step 7: Hand off to Devin for the authoritative staging review
Step 8: Report [DONE:] with PR URL(s) + staging URL + validation state
```

## Hard Rules

- **Never ping Relay** (`<@U0B1YQS8L12>`) — retired 2026-08-11.
- **Never skip the staging-URL post.** Devin cannot review what he cannot find.
- **Never deploy to production** without Devin's separate explicit instruction — a staging PASS is not a production green light.
- Be specific in the focus list: a vague brief produces a vague review.
