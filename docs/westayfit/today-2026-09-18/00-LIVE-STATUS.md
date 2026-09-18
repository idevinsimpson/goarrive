# WE STAY FIT — live status, 2026-09-18 (deadline: verified staging by 1:00 PM ET)

Recovery point. If the session stops: read this file, then the newest PR #327 comments, then `git status` / `git log -1` on `claude/wsf-ui-member-experience`. Do not restart completed work.

| Field | Value |
|---|---|
| Updated (ET) | 08:55 |
| Current task | Candidate freeze gate: complete browser suite running; then `gate1.sh`. Adversarial review (4 lenses) running. Hosted-harness compat patch APPLIED on the ops worktree (`scratchpad/ops`, branch `claude/wsf-staging-ops-2026-09-18` from `main` `3e87122`), ops suite 9/9 green, not committed/pushed yet. Opus worker drafting the stacked D-5 hosted proof + D-1 gate check harness patch |
| Branch / head | `claude/wsf-ui-member-experience` @ `5a3fbde` (D-5 + D-1 committed and pushed); base unchanged `3560936` |
| Latest ChatGPT review read | `[CHATGPT URGENT HANDOFF 08:32 ET]` and `[CHATGPT OWNER SCOPE UPDATE 08:23 ET]` (13 extra workstreams). **Position taken (documented on the PR):** not started — Devin's direct session prompt, received after that comment, explicitly excludes those 13 items and limits today's authorization to D-5, D-1, hardening, narrow ops, isolated staging. Only a new instruction from Devin in the session changes this. Next expected ChatGPT checkpoint ~09:15 ET |
| What changed | D-5: `wsfIsGroupMember` now requires `membershipStatus == 'active'` (one helper, one call site: `wsfCommunityGroups` read); two rules tests added. D-1: trailing `router.replace('/verify-email')` removed from `signup.tsx` `onSubmit`; slow-send regression spec added |
| Tests completed | On `5a3fbde`: rules **24/24**; D-1 passes-after + `e2-join-flow`, `e35-auth-polish`, `e35-home`, `mu2-flow`, `ui-community-home`, `d-admission-controls` **32/32**; app tsc clean; Vitest **233/233** (16 files); functions build clean; callable **238/238** (18 suites); deploy-config **8/8**. Earlier: D-1 fails-before 1 failed on the unpatched build |
| Tests running | complete emulator browser suite (33+1 specs); then `scripts/westayfit/gate1.sh` |
| Blocker | **D-5 staging delivery (owner action needed):** `firebase.westayfit.staging.json` on `main` deliberately carries no `firestore` block ("rules and indexes are not part of any WSF deploy") and the workflow runs `--only functions:westayfit` + hosting. The rules correction therefore cannot reach `westayfit-staging` through the deploy "as configured". The D-5 hosted proof will run against whatever ruleset staging currently holds and will report the truth. Options (owner decision, none taken): (a) Devin runs `firebase deploy --only firestore:rules --project westayfit-staging` from CANDIDATE_SHA (staging holds WSF data only; the repo hazard note about replacing GoArrive's ruleset applies to the production project, not to this one — still do a live-vs-repo drift check first); (b) authorize an ops-PR change adding a `firestore` block to the staging config and `firestore:rules` to the deploy `--only` (workflow-structure change; may hit a deployer-SA permission gap, which would be documented, not broadened). |
| Exact next action | when the browser suite and gate1 are green and the adversarial review has no confirmed finding: freeze CANDIDATE_SHA = `5a3fbde…` (or the head after any review-driven fix), post `[CLAUDE TODAY — CANDIDATE FROZEN]`; then apply the harness compat patch + `approved-candidate.json` on the ops worktree, run `node .github/wsf-staging/tests/run-all.mjs`, open the ops PR |
| Uncommitted | none on the product branch (artifacts folders are regenerated and never committed) |

## Authorized today (Devin, 08:2x ET session prompt)
Exact D-5 rules correction; exact D-1 signup correction; final candidate hardening; narrow staging harness/approval ops PR on `main` (harness compat + `approved-candidate.json` + proven pins only); conditional merge of that ops PR; one isolated `westayfit-staging` deploy + hosted verification; D-5 hosted proof; staging visual board. NOT: production, IAM/WIF, spending, new scope, force push, merging PR #327.

## Timeline (ET)
- 08:10–08:15 ChatGPT audits posted; 08:18 patches filed; 08:24 checkpoint comment; 08:2x owner authorization → patches applied.
