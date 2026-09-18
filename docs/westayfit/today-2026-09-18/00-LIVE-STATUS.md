# WE STAY FIT — live status, 2026-09-18 (deadline: verified staging by 1:00 PM ET)

Recovery point. If the session stops: read this file, then the newest PR #327 comments, then `git status` / `git log -1` on `claude/wsf-ui-member-experience`. Do not restart completed work.

| Field | Value |
|---|---|
| Updated (ET) | 08:30 |
| Current task | P0 block: D-5 + D-1 applied to the working tree; rules suite green; web build + typecheck running; Opus adversarial review running; hosted-harness compat patch worker running |
| Branch / head | `claude/wsf-ui-member-experience` @ `6da07b5` (docs) over code head `96d0380`; **uncommitted**: `firestore.rules`, `functions-westayfit/tests/rules/wsf-rules.test.ts`, `apps/westayfit/app/signup.tsx`, new `apps/westayfit/tests-e2e/d1-signup-single-navigation.spec.ts`, `00-OVERNIGHT-INDEX.md` |
| Latest ChatGPT review read | `[CHATGPT HOURLY REVIEW 8:15]` (12:14 UTC) and `[CHATGPT MORNING AUDIT 08:08 ET]` (12:14 UTC); next expected ~09:15 ET |
| What changed | D-5: `wsfIsGroupMember` now requires `membershipStatus == 'active'` (one helper, one call site: `wsfCommunityGroups` read); two rules tests added. D-1: trailing `router.replace('/verify-email')` removed from `signup.tsx` `onSubmit`; slow-send regression spec added |
| Tests completed | Rules suite on the branch with D-5: **24/24** (12:28 UTC). D-1 fails-before on the unpatched build: 1 failed at the post-release assertion (12:20 UTC) |
| Tests running | web build + app tsc (D-1 passes-after needs the build); Opus adversarial review (4 lenses) |
| Blocker | **D-5 staging delivery (owner action needed):** `firebase.westayfit.staging.json` on `main` deliberately carries no `firestore` block ("rules and indexes are not part of any WSF deploy") and the workflow runs `--only functions:westayfit` + hosting. The rules correction therefore cannot reach `westayfit-staging` through the deploy "as configured". The D-5 hosted proof will run against whatever ruleset staging currently holds and will report the truth. Options (owner decision, none taken): (a) Devin runs `firebase deploy --only firestore:rules --project westayfit-staging` from CANDIDATE_SHA (staging holds WSF data only; the repo hazard note about replacing GoArrive's ruleset applies to the production project, not to this one — still do a live-vs-repo drift check first); (b) authorize an ops-PR change adding a `firestore` block to the staging config and `firestore:rules` to the deploy `--only` (workflow-structure change; may hit a deployer-SA permission gap, which would be documented, not broadened). |
| Exact next action | when the build is done: emulator run of `d1-signup-single-navigation`, `e2-join-flow`, `e35-auth-polish`, `e35-home`, `mu2-flow`, `ui-community-home`, `d-admission-controls`; integrate review findings; commit D-5 + D-1; post `[CLAUDE TODAY CHECKPOINT — D5/D1]`; then the complete battery from clean state → CANDIDATE_SHA |
| Uncommitted | yes (listed above) — do not lose; `git diff` shows the two product changes |

## Authorized today (Devin, 08:2x ET session prompt)
Exact D-5 rules correction; exact D-1 signup correction; final candidate hardening; narrow staging harness/approval ops PR on `main` (harness compat + `approved-candidate.json` + proven pins only); conditional merge of that ops PR; one isolated `westayfit-staging` deploy + hosted verification; D-5 hosted proof; staging visual board. NOT: production, IAM/WIF, spending, new scope, force push, merging PR #327.

## Timeline (ET)
- 08:10–08:15 ChatGPT audits posted; 08:18 patches filed; 08:24 checkpoint comment; 08:2x owner authorization → patches applied.
