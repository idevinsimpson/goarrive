# WE STAY FIT — live status, 2026-09-18 (deadline: verified staging by 1:00 PM ET)

Recovery point. If the session stops: read this file, then the newest PR #327 comments, then `git status` / `git log -1` on `claude/wsf-ui-member-experience`. Do not restart completed work.

| Field | Value |
|---|---|
| Updated (ET) | 13:17 ET (17:17 UTC) |
| Current task | **RUN 6 (35370740710) done: candidate still `65d258d`, hosted 19/21, cleanup 285/285. W4/W7/W8 row now fails only at the Champion QR: fixture community is `private`, product shows QR only for `public`/`inviteOnly` (harness, not product). W2 403 unchanged. STOPPED and handed back per owner instruction.** Receipt addendum saved |
| Branch / head | `claude/wsf-ui-member-experience` @ `65d258d` (+ docs commits); `main` = #331 + #333 (approval `65d258d`, harness with candidate B rows); #332 standby unmerged |
| Latest ChatGPT review read | `[CHATGPT HOURLY REVIEW 12:15]` (BLOCKED-on-credentials verdict; six actions now in progress) + `[MANUS GOOGLE-SIDE RECEIPT]` 12:26 ET (IAM granted — rules deployed) |
| What changed | D-5: `wsfIsGroupMember` now requires `membershipStatus == 'active'` (one helper, one call site: `wsfCommunityGroups` read); two rules tests added. D-1: trailing `router.replace('/verify-email')` removed from `signup.tsx` `onSubmit`; slow-send regression spec added |
| Tests completed | On `5a3fbde` (D-5+D-1): rules 24/24; focused browser 32/32; app tsc; Vitest 233; functions build; callable 238; deploy-config 8; complete browser suite 123/123; gate1 CLEAR (31/31). Adversarial review (18 Opus agents): 0 product regressions; test-quality findings all fixed. After hardening: rules **26/26** (positive controls, missing-status row, cross-group scope), D-1 spec 1/1 with a deterministic post-release window and interception assertion, e2-join-flow 2/2 |
| Tests running | none |
| Blocker | **NEW 13:17 — human demo gate:** staging email sending is deliberately NOT configured (Package E handoff step 5: "Staging email stays not configured"), so a real signup on staging cannot pass `/verify-email` and `Start a community` refuses unverified accounts (`start-community.tsx`: "Verify your email before starting a community"). Every hosted row passed only because the harness creates its users with Admin SDK `emailVerified: true`. Devin's staging account (screenshot 13:10) is stuck at exactly this gate; Home for a no-community account is the unchanged entry screen, the new work is behind Start a community. Unblock = Google-side, one call: mark the staging test user verified (Identity Toolkit `accounts:update` with `emailVerified: true`), or configure Resend on staging (not by 1 PM, and a standing decision). Also still owner: W2 transport alignment; temporary IAM removal + before/after scope; authorization for the one-line W8 fixture fix + one more run |
| Exact next action | wait for Devin; on authorization: set the W4/W7/W8 fixture community to inviteOnly before the Champion visit, assert the QR symbol carries the /join/ link, ops suite, PR, merge, ONE dispatch; report 21 rows |
| Uncommitted | none |

## Authorized today (Devin, 08:2x ET session prompt)
Exact D-5 rules correction; exact D-1 signup correction; final candidate hardening; narrow staging harness/approval ops PR on `main` (harness compat + `approved-candidate.json` + proven pins only); conditional merge of that ops PR; one isolated `westayfit-staging` deploy + hosted verification; D-5 hosted proof; staging visual board. NOT: production, IAM/WIF, spending, new scope, force push, merging PR #327.

## Timeline (ET)
- 08:10–08:15 ChatGPT audits posted; 08:18 patches filed; 08:24 checkpoint comment; 08:2x owner authorization → patches applied.
