# WE STAY FIT — live status, 2026-09-18 (deadline: verified staging by 1:00 PM ET)

Recovery point. If the session stops: read this file, then the newest PR #327 comments, then `git status` / `git log -1` on `claude/wsf-ui-member-experience`. Do not restart completed work.

| Field | Value |
|---|---|
| Updated (ET) | 09:43 ET (13:43 UTC) |
| Current task | Two candidates under verification. (A) product branch `acac836` = D-5 + D-1 + W5 with the REVISED crossing mechanism (post-commit claim on the goal document; stress-tested N=20/N=50: no failures, 0.8–1.9 s vs 13.5 s / 48 aborts before); callable 253/253; web build + rules + complete browser suite running now in the main worktree. (B) `claude/wsf-ui-features-wip` = (A) + W2 recent additions (subcollection tail) + W3 repeat policy (absent = multiple) + W4 guided rules + W6 history (`wsfListGoals` `includeHistory`) + W7 share/momentum + W8 QR (encoder fixed, zxing-verified) + W9 kiosk: functions build, tsc, Vitest 390/390, callable 341/341 (24 suites) green; its browser suite runs right after (A) |
| Branch / head | `claude/wsf-ui-member-experience` @ `acac836`; `claude/wsf-ui-features-wip` (see git log); ops `claude/wsf-staging-ops-2026-09-18` @ `a2ce04e` (approval points at `7197ab0`, superseded — to be moved to the frozen SHA) |
| Latest ChatGPT review read | `[CHATGPT HOURLY REVIEW 9:15]` (13:18 UTC) — incorporated: contention test written and run, W5 mechanism revised, stale spec comment fixed; W5 stays PARTIAL until a candidate battery is green. Next expected ~10:15 ET |
| What changed | D-5: `wsfIsGroupMember` now requires `membershipStatus == 'active'` (one helper, one call site: `wsfCommunityGroups` read); two rules tests added. D-1: trailing `router.replace('/verify-email')` removed from `signup.tsx` `onSubmit`; slow-send regression spec added |
| Tests completed | On `5a3fbde` (D-5+D-1): rules 24/24; focused browser 32/32; app tsc; Vitest 233; functions build; callable 238; deploy-config 8; complete browser suite 123/123; gate1 CLEAR (31/31). Adversarial review (18 Opus agents): 0 product regressions; test-quality findings all fixed. After hardening: rules **26/26** (positive controls, missing-status row, cross-group scope), D-1 spec 1/1 with a deterministic post-release window and interception assertion, e2-join-flow 2/2 |
| Tests running | (A) web build → rules → complete browser suite in the main emulator |
| Blocker | D-5 staging delivery still needs the owner's decision (rules-deploy patch filed / manual deploy). W1/W10/W11/W13/W12 BLOCKED (documented). Kiosk post-sign-in return and the share browser case: to be re-examined in the WIP browser run |
| Exact next action | (A) green → it is the minimum candidate. Then switch the main worktree to the WIP branch, build, complete browser suite; if green (or only test-only fixes needed) → merge WIP into the product branch (merge commit, no history rewrite), complete battery from clean state, move #329 approval, post CANDIDATE FROZEN; else freeze (A). Then read the newest ChatGPT review, merge #329, dispatch, monitor, screenshots, receipt |
| Uncommitted | none on either branch (the main worktree's dist/artifacts are regenerated) |

## Authorized today (Devin, 08:2x ET session prompt)
Exact D-5 rules correction; exact D-1 signup correction; final candidate hardening; narrow staging harness/approval ops PR on `main` (harness compat + `approved-candidate.json` + proven pins only); conditional merge of that ops PR; one isolated `westayfit-staging` deploy + hosted verification; D-5 hosted proof; staging visual board. NOT: production, IAM/WIF, spending, new scope, force push, merging PR #327.

## Timeline (ET)
- 08:10–08:15 ChatGPT audits posted; 08:18 patches filed; 08:24 checkpoint comment; 08:2x owner authorization → patches applied.
