# WE STAY FIT — live status, 2026-09-18 (deadline: verified staging by 1:00 PM ET)

Recovery point. If the session stops: read this file, then the newest PR #327 comments, then `git status` / `git log -1` on `claude/wsf-ui-member-experience`. Do not restart completed work.

| Field | Value |
|---|---|
| Updated (ET) | 11:27 |
| Current task | **CANDIDATE FREEZE DECISION at 11:20 ET: candidate = `7197ab0` (D-5 + D-1 + W5 crossing event).** Complete battery from a clean state running on it now. The feature batch (W9 kiosk, W7 share/momentum, W4 guided rules, W8 QR) is parked on pushed branch `claude/wsf-ui-features-wip` @ `5ff0fec` (that commit also accidentally carries 41 regenerated screenshot PNGs — harmless on a WIP branch, to be dropped before any merge). W6 (history on a `wsfListGoals` flag), W2 (recent additions, subcollection), W3 (repeat policy, absent = multiple) refactors returned/returning after the freeze — not in today's candidate |
| Branch / head | `claude/wsf-ui-member-experience` @ `7197ab0`; WIP features on `claude/wsf-ui-features-wip` @ `5ff0fec`; ops branch `claude/wsf-staging-ops-2026-09-18` @ `98a4594` (+ approval commit next) |
| Latest ChatGPT review read | `[CHATGPT URGENT HANDOFF 08:32 ET]`, `[CHATGPT OWNER SCOPE UPDATE 08:23 ET]` — now IN SCOPE per Devin's direct session instruction (~08:58 ET), which supersedes my 08:53 ET PR position. No 09:15 review seen yet (checked 09:27) |
| What changed | D-5: `wsfIsGroupMember` now requires `membershipStatus == 'active'` (one helper, one call site: `wsfCommunityGroups` read); two rules tests added. D-1: trailing `router.replace('/verify-email')` removed from `signup.tsx` `onSubmit`; slow-send regression spec added |
| Tests completed | On `5a3fbde` (D-5+D-1): rules 24/24; focused browser 32/32; app tsc; Vitest 233; functions build; callable 238; deploy-config 8; complete browser suite 123/123; gate1 CLEAR (31/31). Adversarial review (18 Opus agents): 0 product regressions; test-quality findings all fixed. After hardening: rules **26/26** (positive controls, missing-status row, cross-group scope), D-1 spec 1/1 with a deterministic post-release window and interception assertion, e2-join-flow 2/2 |
| Tests running | complete battery on `7197ab0`: app tsc, Vitest, functions build, clean web build, callable, rules, deploy-config, complete browser suite, gate1 |
| Blocker | **D-5 staging delivery (owner action needed):** the staging config and workflow deploy functions + hosting only. A ready-to-apply ops change (staging config declares `firestore.rules`; workflow gets a last deploy step `--only firestore:rules` gated on a `deploy_rules` boolean input; contract test) is filed at `docs/westayfit/today-2026-09-18/patches/staging-rules-deploy-step.patch` (ops suite 9/9 green with it applied). The sandbox policy declined to commit a `.github/workflows` change, consistent with Devin's "no unrelated workflow structure" wording. Devin decides: (a) authorize that ops-PR change explicitly, or (b) deploy the candidate's `firestore.rules` to `westayfit-staging` by hand. The hosted D-5 case in the harness will report the truth either way. Workstreams 1, 10, 11, 13: BLOCKED with cited prerequisites (`W1-W10-W11-W13-FEASIBILITY.md`) |
| Exact next action | ops PR #329: approved-candidate.json → `7197ab0`; push; when the battery is green post `[CLAUDE TODAY — CANDIDATE FROZEN]`; read newest ChatGPT review; merge #329 if no blocker; dispatch `wsf-staging-deploy.yml` from main (no app_sha); monitor; D-5 hosted proof depends on the owner rules-deploy decision |
| Uncommitted | none (worktree reset to `7197ab0`) |

## Authorized today (Devin, 08:2x ET session prompt)
Exact D-5 rules correction; exact D-1 signup correction; final candidate hardening; narrow staging harness/approval ops PR on `main` (harness compat + `approved-candidate.json` + proven pins only); conditional merge of that ops PR; one isolated `westayfit-staging` deploy + hosted verification; D-5 hosted proof; staging visual board. NOT: production, IAM/WIF, spending, new scope, force push, merging PR #327.

## Timeline (ET)
- 08:10–08:15 ChatGPT audits posted; 08:18 patches filed; 08:24 checkpoint comment; 08:2x owner authorization → patches applied.
