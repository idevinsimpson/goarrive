# WE STAY FIT — live status, 2026-09-18 (deadline: verified staging by 1:00 PM ET)

Recovery point. If the session stops: read this file, then the newest PR #327 comments, then `git status` / `git log -1` on `claude/wsf-ui-member-experience`. Do not restart completed work.

| Field | Value |
|---|---|
| Updated (ET) | 10:32 ET (14:32 UTC) |
| Current task | **FREEZE PATH = product branch `1bd17e8`** (D-5 + D-1 + W5 goal-level event, uncredited per the 10:15 review; callable 254/254). Complete clean-state battery on it starts when the main emulator frees (B's gate1 finishing). Candidate B (`688f2e7`) had a valid browser run: 137/145 — 8 real failures (display-auth confirmed-absent broken by W6 History; seam receipt elements missing; non-member state on Community Home for QR Q-3/share; kiosk post-sign-in return). B stays PARTIAL on the WIP branch |
| Branch / head | `claude/wsf-ui-member-experience` @ `1bd17e8`; `claude/wsf-ui-features-wip` @ `688f2e7`; ops approves `e37e7fd` (to move to the frozen SHA) |
| Latest ChatGPT review read | `[CHATGPT HOURLY REVIEW 10:15]` (14:22 UTC) — incorporated: W5 credit withdrawn (uncredited event, counterexample tests), B verdict from its valid run, rules-deploy retry blocked by sandbox policy (reported). Next expected ~11:15 ET |
| What changed | D-5: `wsfIsGroupMember` now requires `membershipStatus == 'active'` (one helper, one call site: `wsfCommunityGroups` read); two rules tests added. D-1: trailing `router.replace('/verify-email')` removed from `signup.tsx` `onSubmit`; slow-send regression spec added |
| Tests completed | On `5a3fbde` (D-5+D-1): rules 24/24; focused browser 32/32; app tsc; Vitest 233; functions build; callable 238; deploy-config 8; complete browser suite 123/123; gate1 CLEAR (31/31). Adversarial review (18 Opus agents): 0 product regressions; test-quality findings all fixed. After hardening: rules **26/26** (positive controls, missing-status row, cross-group scope), D-1 spec 1/1 with a deterministic post-release window and interception assertion, e2-join-flow 2/2 |
| Tests running | B gate1 (main emulator) — then the product-branch battery |
| Blocker | D-5 staging delivery: the sandbox policy blocks committing the workflow rules-deploy step (tried twice); owner applies the filed patch on the ops branch or deploys rules by hand. W1/W10/W11/W12/W13 BLOCKED; W2/W3/W4/W6/W7/W8/W9 PARTIAL (B failures above) |
| Exact next action | switch main worktree to `1bd17e8` → tsc, Vitest, functions build, deploy-config, rules, callable, complete browser suite, gate1 → CANDIDATE FROZEN → #329 approval to that SHA + ops suite → read newest ChatGPT review → merge #329 → dispatch `wsf-staging-deploy.yml` on main (no app_sha) → monitor → screenshots → receipt |
| Uncommitted | none on either branch (the main worktree's dist/artifacts are regenerated) |

## Authorized today (Devin, 08:2x ET session prompt)
Exact D-5 rules correction; exact D-1 signup correction; final candidate hardening; narrow staging harness/approval ops PR on `main` (harness compat + `approved-candidate.json` + proven pins only); conditional merge of that ops PR; one isolated `westayfit-staging` deploy + hosted verification; D-5 hosted proof; staging visual board. NOT: production, IAM/WIF, spending, new scope, force push, merging PR #327.

## Timeline (ET)
- 08:10–08:15 ChatGPT audits posted; 08:18 patches filed; 08:24 checkpoint comment; 08:2x owner authorization → patches applied.
