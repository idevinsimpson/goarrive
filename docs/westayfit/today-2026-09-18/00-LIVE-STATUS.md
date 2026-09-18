# WE STAY FIT — live status, 2026-09-18 (deadline: verified staging by 1:00 PM ET)

Recovery point. If the session stops: read this file, then the newest PR #327 comments, then `git status` / `git log -1` on `claude/wsf-ui-member-experience`. Do not restart completed work.

| Field | Value |
|---|---|
| Updated (ET) | 10:48 ET (14:48 UTC) |
| Current task | **CANDIDATE FROZEN: `0a062015617fcaa9de53f6f1ea56bba015090231`** (product branch; complete clean-state battery green: tsc, Vitest 241, functions build, deploy-config 8, rules 26, callable 254, browser 125/125, gate1 CLEAR 32/32). Ops PR #329 approved that SHA (`857a766`), was marked ready and **merged to `main` as `1107e77`**; `wsf-staging-deploy.yml` **dispatched from `main`** (no app_sha) at 14:47 UTC. Candidate B (`claude/wsf-ui-features-wip`, four regression fixes applied, Vitest 390 / callable 342 green) is running its browser battery in the main worktree; if green it becomes a second, superseding staging run |
| Branch / head | `claude/wsf-ui-member-experience` @ `0a06201` (+ this docs commit); `main` @ `1107e77` (ops merge); WIP @ see git log |
| Latest ChatGPT review read | `[CHATGPT HOURLY REVIEW 10:15]` (14:22 UTC) — incorporated: W5 credit withdrawn (uncredited event, counterexample tests), B verdict from its valid run, rules-deploy retry blocked by sandbox policy (reported). Next expected ~11:15 ET |
| What changed | D-5: `wsfIsGroupMember` now requires `membershipStatus == 'active'` (one helper, one call site: `wsfCommunityGroups` read); two rules tests added. D-1: trailing `router.replace('/verify-email')` removed from `signup.tsx` `onSubmit`; slow-send regression spec added |
| Tests completed | On `5a3fbde` (D-5+D-1): rules 24/24; focused browser 32/32; app tsc; Vitest 233; functions build; callable 238; deploy-config 8; complete browser suite 123/123; gate1 CLEAR (31/31). Adversarial review (18 Opus agents): 0 product regressions; test-quality findings all fixed. After hardening: rules **26/26** (positive controls, missing-status row, cross-group scope), D-1 spec 1/1 with a deterministic post-release window and interception assertion, e2-join-flow 2/2 |
| Tests running | staging workflow run on main (candidate 0a06201); B browser battery (main emulator) |
| Blocker | D-5 staging delivery (owner action: apply `patches/staging-rules-deploy-step.patch` on ops or deploy rules by hand). W1/W10/W11/W12/W13 BLOCKED; W2–W9 PARTIAL pending B's battery |
| Exact next action | monitor the staging run (gate, config, build, deploy, hosted-verify, cleanup, evidence); classify any failure (PRODUCT / HARNESS / GOOGLE-SIDE); hosted D-5 case expected to FAIL unless rules are deployed by the owner; then staging screenshots (phone + wide) and the 1 PM readiness receipt. B: if green by ~11:30 ET, merge into the product branch (identical tree), move the approval and dispatch a superseding run |
| Uncommitted | none on either branch (the main worktree's dist/artifacts are regenerated) |

## Authorized today (Devin, 08:2x ET session prompt)
Exact D-5 rules correction; exact D-1 signup correction; final candidate hardening; narrow staging harness/approval ops PR on `main` (harness compat + `approved-candidate.json` + proven pins only); conditional merge of that ops PR; one isolated `westayfit-staging` deploy + hosted verification; D-5 hosted proof; staging visual board. NOT: production, IAM/WIF, spending, new scope, force push, merging PR #327.

## Timeline (ET)
- 08:10–08:15 ChatGPT audits posted; 08:18 patches filed; 08:24 checkpoint comment; 08:2x owner authorization → patches applied.
