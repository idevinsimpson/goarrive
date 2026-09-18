# WE STAY FIT — live status, 2026-09-18 (deadline: verified staging by 1:00 PM ET)

Recovery point. If the session stops: read this file, then the newest PR #327 comments, then `git status` / `git log -1` on `claude/wsf-ui-member-experience`. Do not restart completed work.

| Field | Value |
|---|---|
| Updated (ET) | 12:12 ET (16:12 UTC) |
| Current task | **OWNER AUTHORIZED FORWARD TO B (11:58 ET).** Waiting on Devin for the two credentialed steps this session cannot do: (1) temporary staging-only IAM grant to the deployer (custom role with run.services.getIamPolicy + run.services.setIamPolicy; exact commands in the 12:02 comment), (2) hand deploy of `firestore.rules` from `65d258d` (`firebase deploy --only firestore:rules --project westayfit-staging --config firebase.westayfit.emulators.json`). Workflow rules-step commit blocked by sandbox policy a third time. Harness rows for W2/W3/W5/W6/W4-W7-W8/W9 written, ops suite green, PR #333 merged to main. Staging still MIXED/UNVERIFIED (Hosting A, functions B, orphan service without invoker) |
| Branch / head | `claude/wsf-ui-member-experience` @ `65d258d` (+ docs commits); `main` = #331 + #333 (approval `65d258d`, harness with candidate B rows); #332 standby unmerged |
| Latest ChatGPT review read | `[CHATGPT MANUAL REVIEW 11:55]` (recommended forward-to-B; acknowledged 11:57) + `[OWNER AUTHORIZATION 11:58]`. No 12:15 review yet |
| What changed | D-5: `wsfIsGroupMember` now requires `membershipStatus == 'active'` (one helper, one call site: `wsfCommunityGroups` read); two rules tests added. D-1: trailing `router.replace('/verify-email')` removed from `signup.tsx` `onSubmit`; slow-send regression spec added |
| Tests completed | On `5a3fbde` (D-5+D-1): rules 24/24; focused browser 32/32; app tsc; Vitest 233; functions build; callable 238; deploy-config 8; complete browser suite 123/123; gate1 CLEAR (31/31). Adversarial review (18 Opus agents): 0 product regressions; test-quality findings all fixed. After hardening: rules **26/26** (positive controls, missing-status row, cross-group scope), D-1 spec 1/1 with a deterministic post-release window and interception assertion, e2-join-flow 2/2 |
| Tests running | none |
| Blocker | Devin: IAM grant + rules hand deploy (no Google credentials in this session). Then: ONE fresh dispatch from main; if the deploy still fails on invoker policy after the grant → stop, report verbatim (org policy) |
| Exact next action | on Devin's "IAM granted" → dispatch run 4 from main; read every job; post result; if hosted green → remind Devin to remove the temporary grant and record before/after scope in the receipt; 12:46 reminder → readiness receipt (BLOCKED unless a run verified) |
| Uncommitted | none |

## Authorized today (Devin, 08:2x ET session prompt)
Exact D-5 rules correction; exact D-1 signup correction; final candidate hardening; narrow staging harness/approval ops PR on `main` (harness compat + `approved-candidate.json` + proven pins only); conditional merge of that ops PR; one isolated `westayfit-staging` deploy + hosted verification; D-5 hosted proof; staging visual board. NOT: production, IAM/WIF, spending, new scope, force push, merging PR #327.

## Timeline (ET)
- 08:10–08:15 ChatGPT audits posted; 08:18 patches filed; 08:24 checkpoint comment; 08:2x owner authorization → patches applied.
