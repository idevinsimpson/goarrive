# LOVABLE-KIOSK-HOSTED-PROOF-1: the Lovable kiosk proof mode (source)

Director queue #365 `6044515892`, release `6044894488`; W3, inbox #396. **Source only.** No run has happened, and nothing here is a hosted pass.

Rework after Director finding #365 `6045688233` and security detail #589 `6045713631`, then W9's independent finding #497 `6051520120`, then W4's ops-source finding #394 `6051933442` as applied by the Director (#365 `6052330823`). All are covered below.

**Updated by LOVABLE-REVIEWED-BUILD-1** (queue #365 `6090733639`, release `6090734914`; W4, inbox #394). The bind and the guard are now route-aware, because the Web Twin is server-rendered and no single entry-page digest can bind it. That section is below: "The route-aware reviewed build". Sections that describe the single entry-page digest are corrected where they stood.

## What it adds

There is one new mode in the existing trusted staging workflow, `mode=lovable-kiosk`. It is proof only: it builds nothing, deploys nothing, and changes no rules, indexes, IAM or providers.

It runs against exactly `https://we-stay-fit-foundation-trial.lovable.app` and the `westayfit-staging` project. Any other host or project is refused.

| Step | Where | What it does |
|---|---|---|
| 1. bind | `gate` (no credential) | `hosted-lovable-kiosk.mjs --bind` loads the document of every route template the journeys use (`BIND_PROBES`) and every same-origin asset they load (bounded, no redirects, no other origin). It reduces each document to its template's canonical form, hashes each asset, checks every reference the documents make, then compares everything to `REVIEWED_BUILD`. It exits 0 only on an exact match. |
| 2. bind again | `lovable-kiosk`, before authentication | The same check. Any drift since the gate stops the job, and no credential is minted: the re-authentication step requires `steps.bind.outcome == 'success'`. |
| 3. proof | `lovable-kiosk` | `--run` seeds run-tagged fixtures with the existing kit (`journeys/fixture-kit.mjs`), with no new account maker. It then drives the real Lovable UI in Playwright, using the candidate's pinned CLI. Every browser context runs through the **served-code guard** (below), and the browser gets no cloud or workflow credential in its environment. |
| 4. cleanup | always, blocking | `cleanup-synthetic.mjs` runs over the run's manifest. The product-written membership is merged in only if it is run-tagged. |
| 5. scan, upload | always | `scan-evidence.mjs` runs; the upload happens only if the scan passes. |
| 6. verdict | always | `--require` gives PASS only when every row passed **and** cleanup succeeded **and** the scan succeeded. |

**`REVIEWED_BUILD`** holds a canonical document per route template and every asset digest. Neither part alone binds: documents without assets, or assets without a document for every template, are BLOCKED. Its value and status are in "The route-aware reviewed build", below.

The digests could not be computed from W3's session, nor from W4's for LOVABLE-REVIEWED-BUILD-1: both sessions' proxies refuse the Lovable host (CONNECT 403). Neither refusal was worked around.

## The served-code guard (W9 finding #497 `6051520120`)

The bind alone checks a separate, earlier fetch. The Lovable host is mutable, so the build the browser executes could differ: a publish could land between the bind and the browser's loads, or the entry page could load a script from another origin. The guard binds **what the browser loads**.

- **Every request is routed.** Each browser context routes every request through `codeGuard`, with service workers blocked so none can answer around it.
- **Documents** from the Lovable host (every navigation, deep links like `/kiosk/…` and `/?join=…` included) are fetched once with no redirect followed. Each must be a reviewed route template and valid UTF-8, and must reduce, for the URL requested, to that template's reviewed canonical document with its reviewed count of stream-part timestamps. A document is fulfilled with exactly the bytes read. Any other path is refused.
- **The host's injected events script** (`/__l5e/events.<id>.js`, the tag that carries the context token) is **blocked**: it is never fetched, fulfilled or run, and it is counted apart from refusals. Only that exact path shape on the Lovable host is blocked, and only as a script.
- **Scripts and stylesheets** from the Lovable host must be a reviewed `/assets/<name>`, carry that asset's reviewed digest, and are fulfilled with exactly the hashed bytes.
- **Passive same-origin types** (images, fonts, the manifest) and **data requests** (`fetch`, `xhr`, `eventsource`) to the four API origins pass: Identity Toolkit, Secure Token, Firestore, and the staging callables host.
- **Everything else is refused:** a redirect, an error status, other bytes, an unreviewed or foreign script, any document or script from an API origin, and any other origin. The refusal is recorded with no query string.
- **A refusal stops the journey.** The journey checks after each navigation, so a refusal stops it before the next step:
  - the kiosk is never approved, so the station secret never reaches an unreviewed kiosk;
  - no password is typed into an unreviewed join page.
- **host-build** is PASS only when the bind matched **and** the browser loaded at least one verified document **and** nothing was refused. A late refusal (for example a lazily loaded foreign script) still fails it.
- **The browser's environment** drops `WSF_GOOGLE_*`, `GOOGLE_*`, `CLOUDSDK_*`, `ACTIONS_ID_TOKEN_REQUEST_*`, `ACTIONS_RUNTIME_*`, `GITHUB_TOKEN` and `GH_TOKEN`. That is W9's note N2; page script cannot read the environment, so this is defence in depth.

**Limit.** The API-origin list is the expected Firebase set. If the real app reaches another origin for a data request, the first authenticated run fails host-build and names that request. A reviewed change must then add it; it is never allowed silently.

## The route-aware reviewed build (LOVABLE-REVIEWED-BUILD-1)

**Why a single digest cannot bind this build.** The Web Twin is TanStack Start and server-rendered (HTML-VARIANCE-1, #365 `6089082668`; the backend lane's measurements, #365 `6089534129`).
- **Per request**, exactly two values change: the value of the host's `data-context-token` attribute on the `/__l5e/events.*.js` script tag, and each `u:<epoch ms>` inside the `data-tsr-stream-part` script.
- **Per route**, a deep link's document also differs from `/`, and two ids give two documents. The route source at Lovable `9b9eade5` shows why. `/display/$goalId` and `/kiosk/$communityId/$goalId` have no loaders; they render from their params only, so the ids appear in the rendered markup and in the stream part.
- **The query string** never reaches the document.

**The canonical document** (`canonicalDocument(text, url)`) is what both the bind and the browser guard hash:
1. **The URL must be a reviewed route template.** The templates are `ROUTE_TEMPLATES`: `/`, `/display/$goalId` and `/kiosk/$communityId/$goalId`. Those are every document the two proofs load (`/` also with an invite query). Each path param must be 12–128 characters of `A-Z a-z 0-9 _ -`, and no param may contain another. Fixture ids are `e5cgrp-…` and `e5cgoal-…`, about 30 characters.
2. **Every byte is literal, NUL included.** The first bind on the real host (run `38006215259`) found NUL characters in every document, and they passed the fatal UTF-8 decode, so they really are in the bytes. Following the Director's ruling (#394 `6091249662`):
   - each NUL is kept, not refused;
   - the number of NULs is pinned per template and compared strictly, like the `u:` count;
   - the bind prints that count and the class of each NUL's context: the stream part, another inline script, or markup. It prints counts and classes only, never bytes.

   Nothing is escaped, because no literal text can become a slot (step 6). That is the ruling's aim: a NUL followed by `wsf:` can never be a slot. The guard also requires valid UTF-8.
3. **The context token.** There must be exactly one `data-context-token=` in the document. Its value must be one quoted token of 8–4096 characters of `A-Z a-z 0-9 . _ ~ : + / = -`, and the attribute must close right after it. That value, and nothing else, is replaced by a fixed slot. A refusal names the kind of character found (quote, angle bracket, whitespace and so on), never the value.
4. **The stream part.** There must be exactly one `<script … data-tsr-stream-part …>`. Inside it, every `u:` key (never the tail of another name such as `menu:`) must carry exactly 13 digits. Each is replaced by a fixed slot and counted. A `u:` anywhere else stays exact.
5. **The URL's own params** go back into their template slots, longest first, and their occurrences are counted.
6. **The digest** is the sha256 of the result. The result is a list of literal text and slots, serialized as JSON. A slot is an object; literal text is a JSON string, with every character escaped as JSON escapes it. So no byte of a document can stand for a slot, and the mapping is injective. Every other byte is kept, so any other change alters it: a script, an attribute, route data, or a per-request value anywhere else.

**`REVIEWED_BUILD`** (shared: the device matrix re-exports the kiosk harness's, so both proofs use one pin, and a later publish needs one new value):
- **`documents`:** template → `{ sha256, streamU, nul }`, the canonical digest and the reviewed numbers of stream-part timestamps and of NULs;
- **`assets`:** name → sha256 of the exact bytes, with no normalization.

**The bind** (`servedManifest`, credential-free):
- **What it loads.** It loads `BIND_PROBES`: `/` twice, `/` with an invite query, and each param template under two fixed probe ids. The two ids differ in their first and last characters, their case and their length.
- **Binding a template.** A template is bound only when all of its loads reduce to one canonical document. Route data beyond the URL's own params, or a per-request value outside the two normalized ones, leaves it **UNBOUND**, and the bind fails before any credential.
- **Assets.** It walks the assets referenced by every probed document (including a route chunk that only a deep link preloads) and their imports.
- **References.** It classifies every `<script src>` and stylesheet or modulepreload link the documents make exactly as the browser guard would. Any reference the guard would refuse fails the bind, even when every digest matches.
- **What it prints.** It prints each template's canonical digest and timestamp count, and each probe load (path without query, template, digest, timestamp count and param counts). It also prints any refused reference, each asset, and, when every template is bound, one `LOVABLE_OBSERVED_BUILD {…}` JSON line: the exact manifest to pin. It never prints a document's bytes or the token's value.
- **Its verdict.** It is BLOCKED while the pin lacks a document for any template, a timestamp count, or the assets. It is PASS only when every document, every asset and the reference check match.

**The browser guard.**
- **Documents.** A document must be a reviewed template, valid UTF-8, and must reduce for its own URL to the reviewed canonical document with the reviewed timestamp count. It is fulfilled with exactly the bytes read.
- **The host's own scripts.** Two are **blocked**, never run, and counted apart from refusals (host-build names the count):
  - the injected `/__l5e/events.<id>.js`;
  - `/~flock.js`, which the first real-host bind found referenced by the documents.

  Only those exact paths on the Lovable host are blocked: no query, no fragment, and only as scripts. Anything else is refused, and the bind prints each script it would block:
  - `/~flock.js?v=1`, `/~flock.js#a`, `/~flock2.js`, `/~flockX.js`, `/x/~flock.js` and `/~flock.mjs`;
  - any other `/__l5e/` script, and the events script with a query;
  - either path as a stylesheet or a document;
  - either path on another origin.

  The tags stay in the canonical document, so a second flock tag changes the digest.
- **Why they are blocked.** They are Lovable's injected scripts, not the app's. The app reaches them only through optional calls (`window.__lovableEvents?.…`, `src/lib/lovable-error-reporting.ts` at `9b9eade5`), so blocking them changes no app behaviour. The document digest already binds their tags. Running them would execute host bytes outside the reviewed build, and could send events to an origin the guard refuses.

**The negative mutations of the queue**, each refused by the guard with its reason, and each also giving a different canonical form at bind:
- a changed script `src`;
- an added inline script;
- an inline-script change outside `u:`;
- a changed attribute other than the token;
- a token value carrying `"`;
- a token value carrying `>`;
- a token followed by a second attribute;
- a non-digit `u:`;
- a 14-digit `u:`;
- an extra stream-part script;
- an extra `u:` (the reviewed count differs);
- a param that is not the URL's (display, and kiosk with another community);
- an unknown template (`/c/…/g/…`).

Further refusals tested:
- a second token, no token, and the only token inside the stream part;
- an added or a removed NUL (each refused by the strict NUL count), and a moved NUL (refused by the digest);
- a second `/~flock.js` tag;
- a param too short to bind, overlapping params, and a document that is not UTF-8.

Also tested:
- a literal NUL+`wsf:token`+NUL is text, never a slot;
- literal text that spells a slot, where another document has the id, never reduces to the same document.

**The pin: `REVIEWED_BUILD` is pinned to Lovable `9b9eade5`** on the trial host. It is exactly the `LOVABLE_OBSERVED_BUILD` line of run `38007859514` (gate only, this harness at `b3f389c6`):

| Template | Canonical sha256 | `u:` | NUL (all in the stream part) |
|---|---|---|---|
| `/` | `a94e8672951be540e6d0ba1b852a2eae2581faf5667a3f78d93fba9d74c30d79` | 2 | 3 |
| `/display/$goalId` | `139787e43781b8f67e9b26eb330ee80686a9d8e9b2725985f2af045272a11f72` | 2 | 5 |
| `/kiosk/$communityId/$goalId` | `cf10eb5d658a28ede555b6a6c21e48d45f7450d5789cf505ef8369839873b81b` | 2 | 7 |

- **What the bind showed:**
  - the three loads of `/` agree, and so do the two ids of each param template;
  - each id appears once;
  - no reference is refused;
  - it blocks exactly `/~flock.js` and `/__l5e/events.1718a1eacac7ff3a.js`;
  - the assets are the same 79.
- **Cross-checks.** The pin was written by a generator that refuses unless both of these hold:
  - the three digests equal those of run `38007704034` (the head before, whose digest path is identical);
  - the 79 assets equal the list transcribed from run `38006215259`, which in turn diffed identical to a separate transcription of run `38002199884`.
- **How the bind ran.** W4's session cannot reach the Lovable host (CONNECT 403), so each bind ran as the gate job of an L0 dispatch on this branch. That job is credential-free and stops at the bind by design; `config` and every credentialed job were skipped.
- **Runs `38002199884` and `38002201983`** (build `9b9eade5`, 23:00Z, `main`'s code) printed the asset digests and the old single-digest probe: all three documents DIFFERENT. They cannot supply canonical digests.
- **Run `38006215259`** (23:48Z, this branch at `88ccde75`, gate only) was the first bind of this code. It found three things:
  - every document carries NUL characters, which that head refused;
  - the documents reference `/~flock.js`, which that head refused;
  - the 79 asset digests are the same set run `38002199884` printed.

  The next commits take the NULs as literal bytes, pin their count, and block `/~flock.js` exactly, as the Director's ruling #394 `6091249662` asks.
- **Run `38007704034`** (00:08Z, at `fff29518`) bound all three templates with no refused reference, before the NUL count was part of the pin.
- **Run `38007859514`** (00:10Z, at `b3f389c6`) bound them again with the NUL counts. The pin above is its manifest.

**Superseded elsewhere.** `docs/westayfit/qa/lovable-device-qa-1.md` (outside this packet's paths) describes the device matrix's old raw-bytes document probe. That probe is removed: the device matrix now uses this route-aware bind.

**Limits.**
- The token's character set is an assumption, because the token value was never seen here. If the real token uses another character, the bind refuses every document, names the kind of character, and does so before any credential.
- The same applies to the `u:` shape: an unquoted key preceded by a non-name character.
- If the real app loads another document path during the journey (a reload after a client-side route change), the guard refuses it by name, and host-build fails closed.

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
| host-build | every route template's reviewed canonical document and every reviewed asset digest, exactly, at bind **and** for every document, script and stylesheet the browser loads; the host's events script blocked; nothing else executable is loaded | BLOCKED until the route-aware manifest is pinned |
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

**LOVABLE-REVIEWED-BUILD-1** (Node 20.20.2 and Node 22.22.2):
- **`tests/hosted-lovable-kiosk.test.mjs`: 25 passed.**
  - New: route templates; the canonical document (two requests and two ids reduce to one document; the query never reaches it; only a `u:` key counts; a `u:` outside the stream part stays exact; the token's value is never returned); the queue's negative mutations; the served manifest (all probes, a route chunk only a deep link loads, route data beyond the params, a per-request nonce, refused references); the binding table; the bind lines (the JSON line to pin, no document, no token, no query).
  - Updated: the journey verifies both kiosk-proof templates and blocks the host's events script on every page; the guard negatives name the template; `classifyRequest` covers templates, the events script and its look-alikes.
- **`hosted-lovable-device-matrix.test.mjs`: 20 passed.** The pin is the kiosk harness's object. Each document the matrix loads is a reviewed template. The CLI prints the route-aware bind, and a display deep link carrying route data now **fails** the gate instead of being reported. The harness restates no part of the bind.
- **`tests/workflow-contract.test.mjs`: 103 passed** (unchanged; no workflow change). **`tests/run-all.mjs`** (staging) and **`tools/wsf-control/run-all.mjs`**: all suites passed.
- **Mutants of the new code: 45 of 46 killed.**
  - They include all the token, stream-part and param checks; the template match; the events-script block (its path shape, its type, and its counting); the UTF-8 check; the probe agreement; the reference check; the timestamp-count pin; and the probe-line query.
  - Two survivors of the first pass were real test gaps, and both are now killed: assets walked only from `/`, and the stream part read to the end of the document.
  - One defect was found in W4's own re-read and fixed: the stream part's end was looked up in a lower-cased copy of the document, whose length can differ (`İ`). Its mutant is killed.
  - The mutants added for the real-host findings are all killed: slots back in-band (NUL markers), `/~flock.js` no longer blocked or its block broadened, the token or a `u:` cut one character short, a token inside the stream part admitted, and blocked host scripts not printed.
  - The mutants added for the Director's ruling are all killed: a host script with a query or fragment blocked; the NUL count not compared in the guard, not compared at bind, or not required in the pin; and NULs in another inline script or in the stream part classed wrongly.
  - The survivor is equivalent: substituting params shortest first instead of longest first. The overlap check already refuses a param contained in another, and two ids cannot overlap in a document that separates them.

**LOVABLE-KIOSK-HOSTED-PROOF-1** (the original packet; its single entry-page digest is superseded above):
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
2. Done in LOVABLE-REVIEWED-BUILD-1: the route-aware binds (runs `38006215259`, `38007704034` and `38007859514`) and the pin commit, which copies run `38007859514`'s `LOVABLE_OBSERVED_BUILD` exactly.
3. After L0 merges it, one kiosk `--run` and one device-matrix `--run`. Each must PASS host-build against the pin; a later Lovable publish needs a new bind and a new value.
4. The authorized proof run. It can reach `host-build`, `fixture-provenance`, the control's five phone rows and `cleanup-tracking`. The rows that remain BLOCKED fail it by name: `qr-join` (the kit's private community), the station turn, the organizer UI approval, and the unverified account.
