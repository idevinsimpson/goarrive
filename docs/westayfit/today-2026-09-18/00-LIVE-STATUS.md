# WE STAY FIT — live status, 2026-09-18 (deadline: verified staging by 1:00 PM ET)

Recovery point. If the session stops: read this file, then the newest PR #327 comments, then `git status` / `git log -1` on `claude/wsf-ui-member-experience`. Do not restart completed work.

| Field | Value |
|---|---|
| Updated (ET) | 11:36 ET (15:36 UTC) |
| Current task | **RUN 3 ([35362036618](https://github.com/idevinsimpson/goarrive/actions/runs/35362036618), candidate B `65d258d`) FAILED in the functions deploy: `wsfGoalRecentAdditions` created but the deployer could not set its invoker IAM policy; the 23 existing functions WERE updated to B; Hosting skipped → staging is MIXED (Hosting A / functions B / orphan service) and UNVERIFIED.** Classification GOOGLE-SIDE permission boundary. No retry, no --force, no IAM change. B is fully green locally on the exact merge SHA (tsc, Vitest 390, deploy-config 8, rules 28, callable 342, browser 145/145, gate1 CLEAR). Standby ops PR #332 (revert of #331 → approval A) open as DRAFT, NOT merged. Board published (artifact DPx4EmpAXBTRkG2kzcPpxX) |
| Branch / head | `claude/wsf-ui-member-experience` @ `65d258d` (+ docs commits); `main` @ `1caa385` (approval = B); ops-d `7b53818` (revert, standby) |
| Latest ChatGPT review read | `[CHATGPT HOURLY REVIEW 11:15]` + `[CHATGPT QUEUE-SAFETY UPDATE 11:20]` (read 15:24 UTC) — acknowledged in the 11:26 checkpoint; sequencing disagreement documented (dispatch preceded reading by 1 min); items 1/3 satisfied after the fact by the full battery on `65d258d` |
| What changed | D-5: `wsfIsGroupMember` now requires `membershipStatus == 'active'` (one helper, one call site: `wsfCommunityGroups` read); two rules tests added. D-1: trailing `router.replace('/verify-email')` removed from `signup.tsx` `onSubmit`; slow-send regression spec added |
| Tests completed | On `5a3fbde` (D-5+D-1): rules 24/24; focused browser 32/32; app tsc; Vitest 233; functions build; callable 238; deploy-config 8; complete browser suite 123/123; gate1 CLEAR (31/31). Adversarial review (18 Opus agents): 0 product regressions; test-quality findings all fixed. After hardening: rules **26/26** (positive controls, missing-status row, cross-group scope), D-1 spec 1/1 with a deterministic post-release window and interception assertion, e2-join-flow 2/2 |
| Tests running | none |
| Blocker | (1) orphan `wsfGoalRecentAdditions` on staging: any deploy lacking it aborts non-interactively until the owner deletes it, OR the owner grants the deployer invoker-policy permission for B; (2) D-5 rules not on staging (owner). Both outside this session |
| Exact next action | wait for the owner decision on PR #327 (path 1: delete orphan → merge #332 → dispatch run 4 (A); path 2: IAM grant → dispatch run 4 (B)); no product work after 12:15; 12:45 read `[CHATGPT FINAL 12:45]`; post the 1 PM readiness receipt (BLOCKED unless an owner action landed and a run verified) |
| Uncommitted | none |

## Authorized today (Devin, 08:2x ET session prompt)
Exact D-5 rules correction; exact D-1 signup correction; final candidate hardening; narrow staging harness/approval ops PR on `main` (harness compat + `approved-candidate.json` + proven pins only); conditional merge of that ops PR; one isolated `westayfit-staging` deploy + hosted verification; D-5 hosted proof; staging visual board. NOT: production, IAM/WIF, spending, new scope, force push, merging PR #327.

## Timeline (ET)
- 08:10–08:15 ChatGPT audits posted; 08:18 patches filed; 08:24 checkpoint comment; 08:2x owner authorization → patches applied.
