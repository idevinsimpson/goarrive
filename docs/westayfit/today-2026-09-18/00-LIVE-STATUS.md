# WE STAY FIT — live status, 2026-09-18 (deadline: verified staging by 1:00 PM ET)

Recovery point. If the session stops: read this file, then the newest PR #327 comments, then `git status` / `git log -1` on `claude/wsf-ui-member-experience`. Do not restart completed work.

| Field | Value |
|---|---|
| Updated (ET) | 12:47 ET (16:47 UTC) |
| Current task | **RUN 5 (35369383808) on candidate B `65d258d`: deploy ✓ (VERIFY=pass), hosted 19/21 — D-5 hosted PASS (rules live), D-1 PASS, Package E ✓, W3/W5/W6/W9 ✓, visual ✓; FAIL W2 (new callable HTTP 403, transport) and W4/W7/W8 row (momentum locator timeout). Cleanup COMPLETE 274/274.** 1 PM receipt posted (BLOCKED, evidence-first) and saved as `1PM-READINESS-RECEIPT.md`. Temporary IAM grant still present; removal requested from Devin |
| Branch / head | `claude/wsf-ui-member-experience` @ `65d258d` (+ docs commits); `main` = #331 + #333 (approval `65d258d`, harness with candidate B rows); #332 standby unmerged |
| Latest ChatGPT review read | `[CHATGPT HOURLY REVIEW 12:15]` (BLOCKED-on-credentials verdict; six actions now in progress) + `[MANUS GOOGLE-SIDE RECEIPT]` 12:26 ET (IAM granted — rules deployed) |
| What changed | D-5: `wsfIsGroupMember` now requires `membershipStatus == 'active'` (one helper, one call site: `wsfCommunityGroups` read); two rules tests added. D-1: trailing `router.replace('/verify-email')` removed from `signup.tsx` `onSubmit`; slow-send regression spec added |
| Tests completed | On `5a3fbde` (D-5+D-1): rules 24/24; focused browser 32/32; app tsc; Vitest 233; functions build; callable 238; deploy-config 8; complete browser suite 123/123; gate1 CLEAR (31/31). Adversarial review (18 Opus agents): 0 product regressions; test-quality findings all fixed. After hardening: rules **26/26** (positive controls, missing-status row, cross-group scope), D-1 spec 1/1 with a deterministic post-release window and interception assertion, e2-join-flow 2/2 |
| Tests running | none |
| Blocker | W2 transport (Google-side: service runs with invoker IAM check enabled unlike the other 23; owner decision to align); W4/W7/W8 hosted row unclassified; temporary IAM removal pending Devin |
| Exact next action | wait for Devin: IAM removal receipt and/or transport decision for wsfgoalrecentadditions; if a further run is authorized, dispatch ONE from main; root-cause the momentum timeout only if authorized after 1 PM |
| Uncommitted | none |

## Authorized today (Devin, 08:2x ET session prompt)
Exact D-5 rules correction; exact D-1 signup correction; final candidate hardening; narrow staging harness/approval ops PR on `main` (harness compat + `approved-candidate.json` + proven pins only); conditional merge of that ops PR; one isolated `westayfit-staging` deploy + hosted verification; D-5 hosted proof; staging visual board. NOT: production, IAM/WIF, spending, new scope, force push, merging PR #327.

## Timeline (ET)
- 08:10–08:15 ChatGPT audits posted; 08:18 patches filed; 08:24 checkpoint comment; 08:2x owner authorization → patches applied.
