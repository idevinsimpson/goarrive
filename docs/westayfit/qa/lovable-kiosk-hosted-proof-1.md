# LOVABLE-KIOSK-HOSTED-PROOF-1: the Lovable kiosk proof mode (source)

Director queue #365 `6044515892`, release `6044894488`; W3, inbox #396. **Source only.** No run has happened, and nothing here is a hosted pass.

Rework after Director finding #365 `6045688233` and security detail #589 `6045713631`; both are covered below.

## What it adds

There is one new mode in the existing trusted staging workflow, `mode=lovable-kiosk`. It is proof only: it builds nothing, deploys nothing, and changes no rules, indexes, IAM or providers.

It runs against exactly `https://we-stay-fit-foundation-trial.lovable.app` and the `westayfit-staging` project. Any other host or project is refused.

| Step | Where | What it does |
|---|---|---|
| 1. bind | `gate` (no credential) | `hosted-lovable-kiosk.mjs --bind` reads the served entry page and every same-origin asset it loads (bounded, no redirects, no other origin). It hashes the entry page **and** each asset, then compares them to `REVIEWED_BUILD`. It exits 0 only on an exact match. |
| 2. bind again | `lovable-kiosk`, before authentication | The same check. Any drift since the gate stops the job, and no credential is minted: the re-authentication step requires `steps.bind.outcome == 'success'`. |
| 3. proof | `lovable-kiosk` | `--run` seeds run-tagged fixtures with the existing kit (`journeys/fixture-kit.mjs`), with no new account maker. It then drives the real Lovable UI in Playwright, using the candidate's pinned CLI. |
| 4. cleanup | always, blocking | `cleanup-synthetic.mjs` runs over the run's manifest. The product-written membership is merged in only if it is run-tagged. |
| 5. scan, upload | always | `scan-evidence.mjs` runs; the upload happens only if the scan passes. |
| 6. verdict | always | `--require` gives PASS only when every row passed **and** cleanup succeeded **and** the scan succeeded. |

**`REVIEWED_BUILD` is empty in this change** (`indexSha256: null`, no assets). The first dispatch therefore stops in the credential-free gate with `LOVABLE_BUILD=BLOCKED`. It prints `LOVABLE_OBSERVED_INDEX <sha256>` and `LOVABLE_OBSERVED_ASSET <name> <sha256>` lines. A separately reviewed commit has to pin both the entry page digest and the asset digests before any authenticated run. Neither part alone binds: assets without the entry page digest are BLOCKED, so an inline script change in `index.html` cannot pass.

The digests could not be computed from W3's session, because its proxy refuses the Lovable host (CONNECT 403). That refusal was not worked around.

## The connected app's shapes (what the proof reads)

Every `wsf*` callable is read as one **exchange**: the request this page sent, paired with that request's own response through Playwright's request identity. A later response to another request is never used.

| Callable | Request | Response (fields the proof uses) |
|---|---|---|
| `wsfJoinCommunity` | `{joinCode}` | `{groupId, alreadyMember}` |
| `wsfContribute` | `{goalId, attemptId, count}` | `{addedCount, ownCredit, alreadyRecorded, sharedTotal, target, unit, status, crossedTarget}` |
| `wsfMyContribution` | `{goalId}` | `{ownCredit, unit, repeatPolicy}` |
| `wsfGoalPulse` | `{goalId}` | `{sharedTotal, …}` |

The goal and the attempt come from the **request**, because the response carries neither. A read counts only if its request named the selected test goal; otherwise it is `null`, never `0`.

## Rows

| Row | How it is measured | Status in this source |
|---|---|---|
| host-build | the reviewed entry page digest and every reviewed asset digest, exactly | BLOCKED until a digest manifest is pinned |
| fixture-provenance | kit `expoEvent` (Champion, community, goal) plus two `memberInTwoCommunities` accounts that are **not** members of the event community | measured |
| qr-join | the kiosk's `data-join-url` must be on the same host, carry a join code, and name this goal; A signs in through the product UI (identity checked) and presses **Join**; `wsfJoinCommunity` must answer this community with `alreadyMember === false`; then the phone choice appears | measured; **BLOCKED** if the kiosk shows "This goal has no join code to show." |
| contribution-7 | exactly one `wsfContribute` request, and the receipt's `data-attempt` equals that request's `attemptId` | measured |
| operation-receipt | request: this goal, `count === 7`, an attempt. Response: `addedCount === 7`, `alreadyRecorded === false`, whole-number `ownCredit` and `sharedTotal`, the goal's unit. Screen: exactly that shared total (en-US) and the unit | measured |
| own-history-shared | after a reload: `wsfMyContribution` for this goal = before + 7 = the receipt's `ownCredit`; `wsfGoalPulse` = the receipt's `sharedTotal`; the Progress row shows both exactly | measured (BLOCKED if a selected-goal read is absent) |
| reopen-static | MOVE reopened: no replayed receipt, no pending-contribution key, still exactly one contribution request | measured |
| account-isolation | A signs out and B signs in in the same storage. B has no pending join keys, no test-goal reads and no Progress row. A then signs in, in a fresh context, with the community chosen explicitly: same identity, same own total, same row | measured |
| cleanup-tracking | the membership and the contribution are tracked **from their requests** (so they are tracked even when a later assertion fails) and merged into the manifest before cleanup | measured; FAIL if the merge fails |
| queue-place, call, phone-ready, expected-turn-start, round-60s, review, station-finish | — | **BLOCKED**: the safe station backend (#587) is not accepted or served, and an older station path is never driven |
| organizer-ui-approval | — | **BLOCKED**: the station is approved through the kit's Champion callable as fixture preparation, tracked for cleanup. A UI approval would create a station record the kit cannot track. |
| unverified-account | — | **BLOCKED**: the kit makes verified accounts only (#396 `6043231980`); verification is never faked |

Every browser context is closed in `finally`, including on an early stop.

### Honest limits

- **Champion approval.** It goes through the kit's callable, not through the Champion UI; see `organizer-ui-approval`. The visitors' sign-ins do go through the product UI.
- **Secrets.** Passwords stay in memory in the kit. Identities appear only as sha256 prefixes, and the results scrub emails and query values. No stored password, organizer storage or repository secret is used.
- **Lovable project.** Nothing is written to the Lovable project.

## Proof (offline)

- **`tests/hosted-lovable-kiosk.test.mjs`: 13 passed.**
  - It covers the exact host and the same-origin bounded walk; a cross-origin `/assets/` path is ignored.
  - **Binding** is BLOCKED while empty, and BLOCKED with assets but no entry digest or with an entry digest but no assets. It is PASS only on an exact match. It FAILs on a changed entry page with identical assets, on a missing observed entry digest, and on a changed, extra or missing asset.
  - **Receipt reproducer (#365 `6045688233`):** the canonical response `{addedCount:7, ownCredit:7, alreadyRecorded:false, sharedTotal:107, target:5000, unit:'squats', status:'active', crossedTarget:false}` with its request is accepted. A replay (`alreadyRecorded:true`) and each wrong screen total (100, 1,107, 1070, 10.7) are rejected. A further table rejects each field defect.
  - **The journey** runs against a fake of the connected app that has one server, per-context storage, and request/response objects paired as Playwright pairs them. **21 single-defect negatives each fail their row.**
- **Mutants: 28 of 29 killed.** The survivor is equivalent: making the receipt accept a fractional `sharedTotal` cannot pass, because the screen check accepts only whole numbers.
- **Two real defects found while writing it, both fixed:**
  - `showsNumber` accepted `1107.5` as showing 1107. It now rejects a decimal tail.
  - In the first rework, the fresh-context identity negative was masked by a missing read.
- **`tests/workflow-contract.test.mjs`: 103 passed.** The mode list is pinned at seven, and `lovable-kiosk` is reached only by its own mode. The bind comes before authentication. The job builds and deploys nothing and holds no stored secret. Cleanup is blocking, and the scan comes before the upload and the verdict.
- **`run-all.mjs`: all suites passed.**
- **Not yet in `run-all`.** The new suite is not registered there, because `run-all.mjs` is outside this packet's reserved paths. It runs directly: `node .github/wsf-staging/tests/hosted-lovable-kiosk.test.mjs`.

## Before an authenticated run

1. Ops-source review, security review, and Director acceptance of the exact head.
2. One dispatch of `mode=lovable-kiosk`. It stops at the gate and prints the observed entry page digest and asset manifest.
3. A reviewed commit that pins `REVIEWED_BUILD` (entry page digest and every asset) to that output.
4. The authorized proof run. Rows that remain BLOCKED (the station turn, the organizer UI approval, the unverified account) fail it by name.
