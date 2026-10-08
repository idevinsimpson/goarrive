# LOVABLE-KIOSK-HOSTED-PROOF-1: the Lovable kiosk proof mode (source)

Director queue #365 `6044515892`, release `6044894488`; W3, inbox #396. **Source only.** No run has happened, and nothing here is a hosted pass.

Rework after Director finding #365 `6045688233` and security detail #589 `6045713631`, then W9's independent finding #497 `6051520120`, then W4's ops-source finding #394 `6051933442` as applied by the Director (#365 `6052330823`). All are covered below.

## What it adds

There is one new mode in the existing trusted staging workflow, `mode=lovable-kiosk`. It is proof only: it builds nothing, deploys nothing, and changes no rules, indexes, IAM or providers.

It runs against exactly `https://we-stay-fit-foundation-trial.lovable.app` and the `westayfit-staging` project. Any other host or project is refused.

| Step | Where | What it does |
|---|---|---|
| 1. bind | `gate` (no credential) | `hosted-lovable-kiosk.mjs --bind` reads the served entry page and every same-origin asset it loads (bounded, no redirects, no other origin). It hashes the entry page **and** each asset, then compares them to `REVIEWED_BUILD`. It exits 0 only on an exact match. |
| 2. bind again | `lovable-kiosk`, before authentication | The same check. Any drift since the gate stops the job, and no credential is minted: the re-authentication step requires `steps.bind.outcome == 'success'`. |
| 3. proof | `lovable-kiosk` | `--run` seeds run-tagged fixtures with the existing kit (`journeys/fixture-kit.mjs`), with no new account maker. It then drives the real Lovable UI in Playwright, using the candidate's pinned CLI. Every browser context runs through the **served-code guard** (below), and the browser gets no cloud or workflow credential in its environment. |
| 4. cleanup | always, blocking | `cleanup-synthetic.mjs` runs over the run's manifest. The product-written membership is merged in only if it is run-tagged. |
| 5. scan, upload | always | `scan-evidence.mjs` runs; the upload happens only if the scan passes. |
| 6. verdict | always | `--require` gives PASS only when every row passed **and** cleanup succeeded **and** the scan succeeded. |

**`REVIEWED_BUILD` is empty in this change** (`indexSha256: null`, no assets). The first dispatch therefore stops in the credential-free gate with `LOVABLE_BUILD=BLOCKED`. It prints `LOVABLE_OBSERVED_INDEX <sha256>` and `LOVABLE_OBSERVED_ASSET <name> <sha256>` lines. A separately reviewed commit has to pin both the entry page digest and the asset digests before any authenticated run. Neither part alone binds: assets without the entry page digest are BLOCKED, so an inline script change in `index.html` cannot pass.

The digests could not be computed from W3's session, because its proxy refuses the Lovable host (CONNECT 403). That refusal was not worked around.

## The served-code guard (W9 finding #497 `6051520120`)

The bind alone checks a separate, earlier fetch. The Lovable host is mutable, so the build the browser executes could differ: a publish could land between the bind and the browser's loads, or the entry page could load a script from another origin. The guard binds **what the browser loads**.

- **Every request is routed.** Each browser context routes every request through `codeGuard`, with service workers blocked so none can answer around it.
- **Documents** from the Lovable host (every navigation, SPA deep links like `/kiosk/…` and `/?join=…` included) are fetched once with no redirect followed. They must hash to the reviewed `indexSha256`, and they are fulfilled with exactly the hashed bytes.
- **Scripts and stylesheets** from the Lovable host must be a reviewed `/assets/<name>`, carry that asset's reviewed digest, and are fulfilled with exactly the hashed bytes.
- **Passive same-origin types** (images, fonts, the manifest) and **data requests** (`fetch`, `xhr`, `eventsource`) to the four API origins pass: Identity Toolkit, Secure Token, Firestore, and the staging callables host.
- **Everything else is refused:** a redirect, an error status, other bytes, an unreviewed or foreign script, any document or script from an API origin, and any other origin. The refusal is recorded with no query string.
- **A refusal stops the journey.** The journey checks after each navigation, so a refusal stops it before the next step:
  - the kiosk is never approved, so the station secret never reaches an unreviewed kiosk;
  - no password is typed into an unreviewed join page.
- **host-build** is PASS only when the bind matched **and** the browser loaded at least one verified document **and** nothing was refused. A late refusal (for example a lazily loaded foreign script) still fails it.
- **The browser's environment** drops `WSF_GOOGLE_*`, `GOOGLE_*`, `CLOUDSDK_*`, `ACTIONS_ID_TOKEN_REQUEST_*`, `ACTIONS_RUNTIME_*`, `GITHUB_TOKEN` and `GH_TOKEN`. That is W9's note N2; page script cannot read the environment, so this is defence in depth.

**Limit.** The API-origin list is the expected Firebase set. If the real app reaches another origin for a data request, the first authenticated run fails host-build and names that request. A reviewed change must then add it; it is never allowed silently.

## The connected app's shapes (what the proof reads)

Every `wsf*` callable is read as one **exchange**: the request this page sent, paired with that request's own response through Playwright's request identity. A later response to another request is never used.

| Callable | Request | Response (fields the proof uses) |
|---|---|---|
| `wsfJoinCommunity` | `{joinCode}` | `{groupId, alreadyMember}` |
| `wsfContribute` | `{goalId, attemptId, count}` | `{addedCount, ownCredit, alreadyRecorded, sharedTotal, target, unit, status, crossedTarget}` |
| `wsfMyContribution` | `{goalId}` | `{ownCredit, unit, repeatPolicy}` |
| `wsfGoalPulse` | `{goalId}` | `{sharedTotal, …}` |

The goal and the attempt come from the **request**, because the response carries neither. A read counts only if its request named the selected test goal; otherwise it is `null`, never `0`.

## What the existing kit can reach (W4 F1)

The kit makes every community **private** (`joinPolicy: 'private'`). The served backend gives a private community no newcomer QR: `wsfStationState` returns `joinCode: null`, and `wsfJoinCommunity` does not admit a non-member by link. So with the kit as it is, the QR join **cannot** succeed, and it never gates anything else:

- **`qr-join` is BLOCKED by name.** The reason given is the kit's private community. A link-joinable fixture needs a kit change, which is outside this packet.
- **The phone rows use a control.** `contribution-7`, `operation-receipt`, `own-history-shared`, `reopen-static` and `account-isolation` are measured by the kit's **verified member** of the event community. The kit makes that member (`expoEvent(…, { attendees: 1 })`), like the Champion, as fixture preparation. The member signs in through the product UI. Each of these rows names the control in its `seen` text.
- **Visitor B** stays a non-member and is the isolation check. **Visitor A** (a non-member) joins through the real QR only if a community is ever link-joinable.

So the first authorized credentialed run can reach these rows: `host-build`, `fixture-provenance`, the five phone rows, and `cleanup-tracking`.

## Rows

| Row | How it is measured | Status in this source |
|---|---|---|
| host-build | the reviewed entry page digest and every reviewed asset digest, exactly, at bind **and** for every document, script and stylesheet the browser loads; nothing else executable is loaded | BLOCKED until a digest manifest is pinned |
| fixture-provenance | kit `expoEvent` (Champion, one verified member, community, goal) plus two `memberInTwoCommunities` accounts that are **not** members of the event community | measured |
| qr-join | the kiosk's `data-join-url` must be on the same host, carry a join code, and name this goal; A signs in through the product UI (identity checked) and presses **Join**; `wsfJoinCommunity` must answer this community with `alreadyMember === false`; then the phone choice appears | **BLOCKED with the existing kit** (private community, no join code shown). It is measured only for a link-joinable community. |
| contribution-7 | the **control** sends exactly one `wsfContribute` request, and the receipt's `data-attempt` equals that request's `attemptId` | measured (control) |
| operation-receipt | request: this goal, `count === 7`, an attempt. Response: `addedCount === 7`, `alreadyRecorded === false`, whole-number `ownCredit` and `sharedTotal`, the goal's unit. Screen: exactly that shared total (en-US) and the unit | measured (control) |
| own-history-shared | after a reload: `wsfMyContribution` for this goal = before + 7 = the receipt's `ownCredit`; `wsfGoalPulse` = the receipt's `sharedTotal`; the Progress row shows both exactly. Each read is paired with its own request, even when other goals' reads are answered around it. | measured (control; BLOCKED if a selected-goal read is absent) |
| reopen-static | MOVE reopened: no replayed receipt, no pending-contribution key, still exactly one contribution request | measured (control) |
| account-isolation | the control signs out and B (a non-member) signs in, in the same storage. B has no pending join keys, no test-goal reads and no Progress row. The control then signs in, in a fresh context, with the community chosen explicitly: same identity, same own total, same row | measured (control) |
| cleanup-tracking | the control's contribution (and A's membership, if A joins) are tracked **from their requests**, so they are tracked even when a later assertion fails, and are merged into the manifest before cleanup | measured; FAIL if the merge fails |
| queue-place, call, phone-ready, expected-turn-start, round-60s, review, station-finish | — | **BLOCKED**: the safe station backend (#587, integrated in source) is not served on staging and this proof has no station driver yet, and an older station path is never driven |
| organizer-ui-approval | — | **BLOCKED**: the station is approved through the kit's Champion callable as fixture preparation, tracked for cleanup. A UI approval would create a station record the kit cannot track. |
| unverified-account | — | **BLOCKED**: the kit makes verified accounts only (#396 `6043231980`); verification is never faked |

Every browser context is closed in `finally`, including on an early stop.

### Honest limits

- **Champion approval.** It goes through the kit's callable, not through the Champion UI; see `organizer-ui-approval`. The control's and the visitors' sign-ins do go through the product UI.
- **The control is a kit member, not a QR newcomer.** Its membership is fixture preparation, exactly like the Champion's; it is named as the control in every phone row, and nothing claims it joined by QR.
- **Before spending a credentialed dispatch** (W4's residual): check against the donor source that the app does not load the Firebase `authDomain` `/__/auth/iframe` or a Google API script on page load. If it does, the guard refuses it by name and `host-build` FAILs, failing closed.
- **Secrets.** Passwords stay in memory in the kit. Identities appear only as sha256 prefixes, and the results scrub emails and query values. No stored password, organizer storage or repository secret is used.
- **Lovable project.** Nothing is written to the Lovable project.

## Proof (offline)

- **`tests/hosted-lovable-kiosk.test.mjs`: 21 passed.**
  - It covers the exact host and the same-origin bounded walk; a cross-origin `/assets/` path is ignored.
  - **Binding** is BLOCKED while empty, and BLOCKED with assets but no entry digest or with an entry digest but no assets. It is PASS only on an exact match. It FAILs on a changed entry page with identical assets, on a missing observed entry digest, and on a changed, extra or missing asset.
  - **Receipt reproducer (#365 `6045688233`):** the canonical response `{addedCount:7, ownCredit:7, alreadyRecorded:false, sharedTotal:107, target:5000, unit:'squats', status:'active', crossedTarget:false}` with its request is accepted. A replay (`alreadyRecorded:true`) and each wrong screen total (100, 1,107, 1070, 10.7) are rejected. A further table rejects each field defect.
  - **The journey** runs against a fake of the connected app that has one server, per-context storage, and request/response objects paired as Playwright pairs them. The fake routes every document and asset load through the context's route handler, as Playwright does.
    - **The fake's default is the kit's real shape:** a private community with no join code. `qr-join` is BLOCKED with the kit reason, and the control passes the five phone rows. A link-joinable variant shows A's QR join passing, with the membership tracked, while the phone rows stay the control's.
    - **22 single-defect negatives each fail their row**, including the control's sign-in silently failing (nothing is measured as an unknown identity). A failed QR join never erases the control's phone rows.
    - **Pairing (W4 F3).** Home's reads for the member's other goal are in flight and answered **in reverse order** around the test goal's in every journey. A unit test interleaves `wsfContribute` and `wsfMyContribution` for two goals, answers them in reverse, and checks that each request gets only its own response.
  - **The CLI (W4 F2).** `cli` is exported with injectable fetch, reviewed manifest, kit import and browser launch.
    - `--bind` exits **0** only on an exact match.
    - It exits **1** for the shipped empty manifest, a drifted entry page, a drifted asset, an unreadable asset, an unreachable host, a wrong host or a wrong project. The last two are refused before any read.
    - `--run` with a non-PASS bind exits 1 **without importing the kit or launching a browser**, and writes results in which nothing passes. Only after an exact bind does it reach the kit.
  - **The served-code guard (W9).** Each of these defects is refused, and the run reaches no Champion approval when the kiosk is affected and no password entry: drift after the bind, a deep link with other bytes, a redirected document, a foreign script, a foreign script on the join page only, a foreign script on the control's home page only, an unreviewed same-origin chunk, and a changed chunk. host-build FAILs, naming the request without its query.
    - A foreign script loaded lazily mid-run is refused and fails host-build.
    - The production default (an empty `REVIEWED_BUILD`) refuses the very first document.
    - Unit tables cover `classifyRequest`, `codeGuard` (it fulfils exactly the hashed bytes and never follows a redirect), `hostBuildRow`, `runResults` and `browserEnv`.
- **Mutants: 61 of 62 killed.**
  - **Journey, CLI and pairing: 38 of 39.** These include W4's four:
    - Q: `--bind` always exits 0;
    - B: `--run` proceeds on a non-PASS bind;
    - P: the verdict is forced to PASS;
    - I: a response pairs with the latest same-name request.

    The control ones are also killed: the private QR stopping the journey, no kit member, the control's contribution or A's membership untracked, the control's sign-in unchecked, and the rows not labelled as the control. The survivor is equivalent: making the receipt accept a fractional `sharedTotal` cannot pass, because the screen check accepts only whole numbers.
  - **Guard: 23 of 23.** Killed:
    - the guard not installed, or service workers not blocked;
    - no check after the kiosk load, before A signs in, or before the control signs in;
    - navigations continued; non-`/assets/` paths or unreviewed scripts passed;
    - API origins serving scripts, any origin serving data, or foreign requests continued;
    - the digest or status not checked, or redirects followed;
    - an empty pin verified, or other bytes fulfilled;
    - refusals not recorded or ignored by host-build, or nothing verified still passing;
    - the journey's own host-build kept;
    - credentials left in the browser environment.
- **Real-Chromium smoke test (W3's scratch, not in the repo).** It used Playwright 1.59.1 and Chromium 1194, with a copy of the module pointed at local stand-ins for the Lovable host, one API origin and a foreign script host.
  - The reviewed document, script and stylesheet were verified, fulfilled and executed, and the stylesheet applied.
  - The foreign script was refused and never ran.
  - The page's data request to the API origin went through.
  - A reload after the entry page changed was refused (`net::ERR_BLOCKED_BY_CLIENT`). The reason named the path without the join query.
  - A 302 entry page was refused.
  - **Loopback-only artefact.** Chromium's Local Network Access check held the loopback API request until it was disabled for that test. The real API origins are public, so this does not apply to the run.
- **Two real defects found while writing it, both fixed:**
  - `showsNumber` accepted `1107.5` as showing 1107. It now rejects a decimal tail.
  - In the first rework, the fresh-context identity negative was masked by a missing read.
- **`tests/workflow-contract.test.mjs`: 103 passed.** The mode list is pinned at seven, and `lovable-kiosk` is reached only by its own mode. The bind comes before authentication. The job builds and deploys nothing and holds no stored secret. Cleanup is blocking, and the scan comes before the upload and the verdict.
- **`run-all.mjs`: all suites passed.** That run does not include this suite (see the next item).
- **Not yet in `run-all`** (W9 note N1). The new suite is not registered there, because `run-all.mjs` is outside this packet's reserved paths; adding it needs a one-line scope delta. Until then it runs directly: `node .github/wsf-staging/tests/hosted-lovable-kiosk.test.mjs`.

## Before an authenticated run

1. Ops-source review, security review, and Director acceptance of the exact head.
2. One dispatch of `mode=lovable-kiosk`. It stops at the gate and prints the observed entry page digest and asset manifest.
3. A reviewed commit that pins `REVIEWED_BUILD` (entry page digest and every asset) to that output.
4. The authorized proof run. It can reach `host-build`, `fixture-provenance`, the control's five phone rows and `cleanup-tracking`. The rows that remain BLOCKED fail it by name: `qr-join` (the kit's private community), the station turn, the organizer UI approval, and the unverified account.
