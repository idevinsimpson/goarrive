# LOVABLE-KIOSK-HOSTED-PROOF-1: the Lovable kiosk proof mode (source)

Director queue #365 `6044515892`, release `6044894488`; W3, inbox #396. **Source only.** No credentialed run has happened, and nothing here is a hosted pass. The only runs against the host are the credential-free binds of LOVABLE-REVIEWED-BUILD-1 (below).

Rework after Director finding #365 `6045688233` and security detail #589 `6045713631`, then W9's independent finding #497 `6051520120`, then W4's ops-source finding #394 `6051933442` as applied by the Director (#365 `6052330823`). All are covered below.

**Updated by LOVABLE-REVIEWED-BUILD-1** (queue #365 `6090733639`, release `6090734914`; W4, inbox #394). The bind and the guard are now route-aware, because the Web Twin is server-rendered and no single entry-page digest can bind it. That section is below: "The route-aware reviewed build". Sections that describe the single entry-page digest are corrected where they stood.

**Updated by LOVABLE-REVIEWED-BUILD-2** (queue #365 `6092691424`, release `6092692777`; W4, inbox #394). Step A closes the items carried from LOVABLE-REVIEWED-BUILD-1's acceptance (#365 `6092671171`): a reviewed asset's declared charset, two negative tests, and two corrections to this note. Step B pins the next Lovable publish (`db3fd2f2`). Step C normalizes the one value that then still drifted on the deep links, the hosting's preview screenshot file name, and the pin is re-taken from two gate samples of step C's code (see "Step C", below).

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

**Why a row failed, from the job log alone (LOVABLE-GUARD-PING-1 item 7, #394 `6094793181`).**
- `--run` and `--require` print each row's `seen` text right after its status line, as `LOVABLE_SEEN <row> <text>`. The device matrix prints `LOVABLE_DEVICE_SEEN`.
- These lines are additive: every existing line is unchanged.
- The text is one line of at most 300 characters. Query values and email-shaped strings are replaced. The whole text is withheld if any rule of `scan-evidence.mjs` matches it, and a test holds the harness's copy of those rules equal to the script's own.
- Main run `38030045509` showed why this is needed: its `display` and `signup` cells failed, and the reason was only in the evidence artifact.
- **`##[` (W3 O1 on #613):** the runner's legacy workflow-command opener is acted on anywhere in a line, not only at its start. Every seen line and every host-text bind line (`LOVABLE_BUILD`, an unbound document, a refused probe, a refused reference) breaks it up as `## [`. A test drives a host that declares `charset=##[add-mask]…` through `--bind`, `--run` and `--require` and finds no printed line with `##[`.
- **Known scrub gaps (W3 O4 on #613, wording only in this packet):** the query and email replacement shared with `short()` does not replace these, and no current seen source carries one:
  - parameter names with `_`, `-` or digits (`?api_key=`, `?x1=`);
  - URL fragments;
  - the tail of an email whose domain has a hyphen after its first dot (`a@x.co-op.test` becomes `<email>-op.test`).

**`REVIEWED_BUILD`** holds a canonical document per route template and every asset digest. Neither part alone binds: documents without assets, or assets without a document for every template, are BLOCKED. Its value and status are in "The route-aware reviewed build", below.

The digests could not be computed from W3's session, nor from W4's for LOVABLE-REVIEWED-BUILD-1: both sessions' proxies refuse the Lovable host (CONNECT 403). Neither refusal was worked around.

## The served-code guard (W9 finding #497 `6051520120`)

The bind alone checks a separate, earlier fetch. The Lovable host is mutable, so the build the browser executes could differ: a publish could land between the bind and the browser's loads, or the entry page could load a script from another origin. The guard binds **what the browser loads**.

- **Every request Playwright routes passes the guard.** Each browser context routes its requests through `codeGuard`, with service workers blocked so none can answer around it.
  - Two kinds of traffic never reach a route, as before this packet:
    - a WebSocket handshake;
    - the redirect hops of a request the guard continued, which can only be a passive type or an API-origin data request.
  - Both carry data, never code (W3 and the Director's delta, R6).
- **Documents** from the Lovable host (every navigation, deep links like `/kiosk/…` and `/?join=…` included) are fetched once with no redirect followed. Each must be a reviewed route template, served as `text/html` with no charset or UTF-8, and valid UTF-8. It must also reduce, for the URL requested, to that template's reviewed canonical document with its reviewed counts of stream-part timestamps and NULs.
  - A document is fulfilled with exactly the bytes read.
  - It is fulfilled with an explicit `content-type: text/html; charset=utf-8` (its other headers kept), so the browser decodes the very text the guard verified (L0 R7).
  - Any other path is refused.
- **The host's own scripts are blocked:** the injected `/__l5e/events.<id>.js` (the tag that carries the context token) and `/~flock.js`.
  - Each is never fetched, fulfilled or run, and is counted apart from refusals.
  - Only those exact, anchored paths on the Lovable host are blocked, and only as scripts whose URL is exactly origin plus path: no query, no fragment, no userinfo. The events id must be exactly 16 lower-case hex digits, the real id's shape.
  - Details are in "The route-aware reviewed build", below.
- **Scripts and stylesheets** from the Lovable host must be a reviewed `/assets/<name>`, declared with no charset or UTF-8, and carry that asset's reviewed digest. They are fulfilled with exactly the hashed bytes and the host's own headers (LOVABLE-REVIEWED-BUILD-2; see "Asset charset" below).
- **Passive same-origin types** (images, fonts, the manifest) and **data requests** (`fetch`, `xhr`, `eventsource`, `ping`) to the four API origins pass: Identity Toolkit, Secure Token, Firestore, and the staging callables host.
  - **`ping` (LOVABLE-GUARD-PING-1):** a beacon, sent with `navigator.sendBeacon`.
    - Firestore's WebChannel closes a Listen channel with one, to `https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel`. Playwright reports it as resource type `ping`.
    - Before this packet, the guard refused it. That stopped the kiosk journey of main run `38030033477` (`host-build` and `account-isolation` FAIL, 10 rows BLOCKED; #365 `6094589482`).
    - A beacon carries data out, and its answer is never run.
    - It passes only to the exact four API origins and never as a navigation. A `ping` to the Lovable host is still refused, because it is not a passive type there.
- **Everything else that reaches the route is refused:** a redirect, an error status, other bytes, an unreviewed or foreign script, any document or script from an API origin, and any other origin's request. The refusal is recorded with no query string.
- **A refusal stops the journey.** The journey checks after each navigation, so a refusal stops it before the next step:
  - the kiosk is never approved, so the station secret never reaches an unreviewed kiosk;
  - no password is typed into an unreviewed join page.
- **host-build** is PASS only when the bind matched **and** the browser loaded at least one verified document **and** nothing was refused. A late refusal (for example a lazily loaded foreign script) still fails it.
- **The browser's environment** drops `WSF_GOOGLE_*`, `GOOGLE_*`, `CLOUDSDK_*`, `ACTIONS_ID_TOKEN_REQUEST_*`, `ACTIONS_RUNTIME_*`, `GITHUB_TOKEN` and `GH_TOKEN`. That is W9's note N2; page script cannot read the environment, so this is defence in depth.

**Limit.** The API-origin list is the expected Firebase set. If the real app reaches another origin for a data request, the first authenticated run fails host-build and names that request. A reviewed change must then add it; it is never allowed silently.

## The route-aware reviewed build (LOVABLE-REVIEWED-BUILD-1)

**Why a single digest cannot bind this build.** The Web Twin is TanStack Start and server-rendered (HTML-VARIANCE-1, #365 `6089082668`; the backend lane's measurements, #365 `6089534129`).
- **Per request**, exactly two values change: the value of the host's `data-context-token` attribute on the `/__l5e/events.*.js` script tag, and each `u:<epoch ms>` inside the `data-tsr-stream-part` script.
- **Per screenshot regeneration** (step C), one more value changes, on the param templates only: the file name of the preview screenshot the hosting adds as the `og:image` and `twitter:image` links of a page that sets no preview image. See "Step C", below.
- **Per route**, a deep link's document also differs from `/`, and two ids give two documents. The route source at Lovable `9b9eade5` shows why. `/display/$goalId` and `/kiosk/$communityId/$goalId` have no loaders; they render from their params only, so their ids appear in the document. The real bind (run `38007859514`) counts each id exactly once per document.
- **The query string** never reaches the document.

**The canonical document** (`canonicalDocument(text, url)`) is what both the bind and the browser guard hash:
1. **The URL must be a reviewed route template.** The templates are `ROUTE_TEMPLATES`: `/`, `/display/$goalId` and `/kiosk/$communityId/$goalId`. Those are every document the two proofs load (`/` also with an invite query). Each path param must be 12–128 characters of `A-Z a-z 0-9 _ -`, and no param may contain another. Fixture ids are `e5cgrp-…` and `e5cgoal-…`, about 30 characters.
2. **Every byte is literal, NUL included, and a leading BOM too.** The first bind on the real host (run `38006215259`) found NUL characters in every document, and they passed the fatal UTF-8 decode, so they really are in the bytes. Following the Director's ruling (#394 `6091249662`):
   - each NUL is kept, not refused;
   - the number of NULs is pinned per template and compared strictly, like the `u:` count;
   - the bind prints that count and the class of each NUL's context: the stream part, another inline script, or markup. It prints counts and classes only, never bytes.

   Nothing is escaped, because no literal text can become a slot (step 6). That is the ruling's aim: a NUL followed by `wsf:` can never be a slot.

   The bind and the guard decode as valid UTF-8 only. They keep a leading BOM as a character (`ignoreBOM: true`, W3 R1), so a BOM-prefixed document is a byte difference like any other and is refused.
3. **The context token.** There must be exactly one `data-context-token=` in the document. Its value must be one quoted token of 8–4096 characters of `A-Z a-z 0-9 . _ ~ : + / = -`, and the attribute must close right after it. That value, and nothing else, is replaced by a fixed slot. A refusal names the kind of character found (angle bracket, whitespace, ampersand or other), never the value. A quote cannot be named: the first quote ends the value, so a value carrying one is refused because its attribute does not close right after it.
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
- **Declared type.** A probed document served with a charset other than UTF-8, or not as `text/html`, is refused by name, and its template stays unbound (L0 R7). An asset declared in a charset other than UTF-8 is a refused reference: the bind fails by name, and the asset's digest is still printed.
- **References.** It classifies every `<script src>` and stylesheet or modulepreload link the documents make exactly as the browser guard would. Any reference the guard would refuse fails the bind, even when every digest matches.
- **What it prints.** It prints each template's canonical digest, timestamp count and preview-image count (`img=`), and each probe load (path without query, template, digest, counts and param counts). Each template's line also names the preview screenshot files its loads carried, printed only in the checked shape and never in the line to pin, so two samples show a regeneration being absorbed (step C). Each of these lines also says `bom=yes` or `bom=no`, for whether the document starts with a BOM; the digest already binds it, and the flag tells a changed digest apart from a BOM (LOVABLE-REVIEWED-BUILD-2). It also prints any refused reference, each asset, and, when every template is bound, one `LOVABLE_OBSERVED_BUILD {…}` JSON line: the exact manifest to pin. It never prints a document's bytes or the token's value.
- **Its verdict.** It is BLOCKED while the pin lacks a document for any template, a timestamp count, or the assets. It is PASS only when every document, every asset and the reference check match.

**The browser guard.**
- **Documents.** A document must be a reviewed template, declared `text/html` with no charset or UTF-8, and valid UTF-8 (a leading BOM kept as a character). It must reduce, for its own URL, to the reviewed canonical document with the reviewed counts of stream-part timestamps, of NULs and of preview-image links. It is fulfilled with exactly the bytes read, as `text/html; charset=utf-8`, with its other headers kept (L0 R7).
- **Assets.** A script or stylesheet must be a reviewed `/assets/<name>`, declared with no charset or UTF-8, and carry its reviewed digest. It is fulfilled with exactly those bytes and the host's own headers.
- **The host's own scripts.** Two are **blocked**, never run, and counted apart from refusals (host-build names the count):
  - the injected `/__l5e/events.<id>.js`, where `<id>` is exactly 16 lower-case hex digits: the shape of the real id, `1718a1eacac7ff3a`, printed by bind runs `38007859514`, `38017456574` and `38018743683`;
  - `/~flock.js`, which the first real-host bind found referenced by the documents.

  Only those exact paths on the Lovable host are blocked: no query, no fragment, no userinfo, and only as scripts. Anything else is refused, and the bind prints each script it would block:
  - `/~flock.js?v=1`, `/~flock.js#a`, `/~flock2.js`, `/~flockX.js`, `/x/~flock.js` and `/~flock.mjs`;
  - any other `/__l5e/` script, and the events script with a query;
  - an events id that is not 16 lower-case hex digits: `-`, `_`, empty, 5,000 characters, 15 or 17 digits, upper case, or carrying `.`, `%`, `~` or `g`; and `eventsX…`, `…Xjs` and `/~flockXjs`, so each dot is a literal dot;
  - either path with userinfo (`https://user@…/~flock.js`, `https://u:p@…/__l5e/events.<id>.js`). The refusal says the URL "carries userinfo (not printed)", so it can't be mistaken for a regressed block, and it never prints the userinfo;
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

**The pin: `REVIEWED_BUILD` is pinned to Lovable `db3fd2f2` in step C's canonical form** (LOVABLE-REVIEWED-BUILD-2). It is exactly the `LOVABLE_OBSERVED_BUILD` line of L0's credential-free gate sample 2, run `38025003360` (job `114133873686`, 04:42Z), which equals sample 1, run `38023220481` (job `114128496599`, 04:12Z). Both ran this harness at `c551722b` on the branch, and both failed before `config` against the stale pin, as designed (#394 `6093295458`).

| Template | Canonical sha256 (step C) | `u:` | NUL | `img` |
|---|---|---|---|---|
| `/` | `55f9d9a35c95aeea889644ef8c9408aae6617f32c22de187a134516892b93b03` | 2 | 3 | 0 |
| `/display/$goalId` | `a2d77af0af3ed5ec1f2b49342ae87c02050d37c54b6fdbfee272be40b4da9133` | 2 | 5 | 2 |
| `/kiosk/$communityId/$goalId` | `8a170c39292d99eba106fd42e45879d8891b60f4880d251756a53c80f949b732` | 2 | 7 | 2 |

- **The normalization, proven on the real host** (L0's comparison #394 `6093893594`). Lovable's preview commit `fb58c21d` (04:19:41Z) regenerated the screenshot at 04:20:14Z, between the samples: sample 1's deep links named `d998c69be897a93a1f29e6410ab16c99_1791604878899` and sample 2's `adf6774a5e95b3320cf6314bba2be8a6_1791606014676`. The two `LOVABLE_OBSERVED_BUILD` lines are identical. Both parts of the file name changed, which L0 also saw in Lovable's screenshot source: the trigger is a Lovable commit, about 30 s before the new name's timestamp (#394 `6093608755`).
- **What each sample showed:** every probe of each template agrees; nothing is refused or UNBOUND (the shape-anywhere rule found no stray file name); `bom=no` on every line; the blocked host scripts are exactly `/~flock.js` and `/__l5e/events.1718a1eacac7ff3a.js`; 79 assets, the same as the step B pin.
- **How the pin was made.** This session cannot read job logs as files, so sample 1's document and asset lines and sample 2's JSON line were transcribed independently; a generator wrote `REVIEWED_BUILD` only because the two agree exactly, and the 79 assets also equal the step B pin's, a third transcription from another run.
- **If a digest were mistyped**, the first gate bind after merge would FAIL before any credential and print the right line.

**Before it (step B): Lovable `db3fd2f2` in step B's form.** For the record, step B pinned it from run `38018743683`; run `38020490774` then showed its deep links moving, for the reason above. It is exactly the `LOVABLE_OBSERVED_BUILD` line of the credential-free gate bind run `38018743683` (`main` `6e8acc31`, gate job `114114813301`, 02:56Z; L0 #394 `6093058625`):

| Template | Canonical sha256 | `u:` | NUL (all in the stream part) |
|---|---|---|---|
| `/` | `55f9d9a35c95aeea889644ef8c9408aae6617f32c22de187a134516892b93b03` | 2 | 3 |
| `/display/$goalId` | `b15d36a06b362063ab8b0817d8d35a8e51982dc5b80630420b473e6ec79db2ae` | 2 | 5 |
| `/kiosk/$communityId/$goalId` | `f9a8996609e0e4e6168174263d4cba53e7a3868c67e10fc44cc194cb22934398` | 2 | 7 |

- **What the bind showed:** the three loads of `/` agree, and so do the two ids of each param template; no reference is refused; it blocks exactly `/~flock.js` and `/__l5e/events.1718a1eacac7ff3a.js` (the same events id, so the 16-hex pattern holds); 79 assets, with the new entry `index-BwrWDHpN.js`.
- **How the pin was made.** This session cannot read job logs as files, so the log was transcribed twice, once from its `LOVABLE_OBSERVED_DOCUMENT` and `LOVABLE_OBSERVED_ASSET` lines and once from its `LOVABLE_OBSERVED_BUILD` JSON. A generator wrote `REVIEWED_BUILD` only because the two agree exactly.
- **Cross-checks.** The 56 asset names the `9b9eade5` pin also has carry the same digests there (content-hashed names, so the same bytes); the other 23 names are new in this build. The three document digests match the prefixes L0 posted. Lovable's byte diagnostic of this build (#394 `6093058625`) found no BOM, and two fetches 70 s apart identical once the two per-request values were blanked.
- **If a digest were mistyped**, the first gate bind after merge would FAIL before any credential and print the right line, so a slip fails closed.
- **Drift without a publish, observed.** Run `38017456574` (02:34Z, `main`) found the `9b9eade5` param-template digests changed since 00:10Z with no publish, and run `38020490774` (03:25Z) found `db3fd2f2`'s moved past this pin (`/display/$goalId` `57245f3e…`, `/kiosk/$communityId/$goalId` `ea821023…`), with `/` and the assets unchanged and no BOM. Lovable's DEEPLINK-DRIFT-DIAG-1 and CONFIRM-1 (#394 `6093458108`, `6093468966`) found the cause: the hosting's preview screenshot file name, renamed on each regeneration. Both times the bind failed before any credential, and the guard would have refused those documents; nothing ran. Step C normalizes it.

**Previously (LOVABLE-REVIEWED-BUILD-1): pinned to Lovable `9b9eade5`.** It was exactly the `LOVABLE_OBSERVED_BUILD` line of run `38007859514` (gate only, this harness at `b3f389c6`):

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
- **Run `38007859514`** (00:10Z, at `b3f389c6`) bound them again with the NUL counts. The `9b9eade5` pin was its manifest.

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
| host-build | every route template's reviewed canonical document and every reviewed asset digest, exactly, at bind **and** for every document, script and stylesheet the browser loads; the host's own scripts blocked; nothing else executable is loaded | pinned to Lovable `9b9eade5` (bind run `38007859514`); PASS needs a `--run` after merge |
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
- **`tests/hosted-lovable-kiosk.test.mjs`: 26 passed.**
  - New: route templates; the document type (R7); the canonical document (two requests and two ids reduce to one document; the query never reaches it; only a `u:` key counts; a `u:` outside the stream part stays exact; the token's value is never returned); the queue's negative mutations; the served manifest (all probes, a route chunk only a deep link loads, route data beyond the params, a per-request nonce, refused references); the binding table; the bind lines (the JSON line to pin, no document, no token, no query).
  - Updated: the journey verifies both kiosk-proof templates and blocks the host's events script on every page; the guard negatives name the template; `classifyRequest` covers templates, the events script and its look-alikes.
- **`hosted-lovable-device-matrix.test.mjs`: 20 passed.** The pin is the kiosk harness's object. Each document the matrix loads is a reviewed template. The CLI prints the route-aware bind, and a display deep link carrying route data now **fails** the gate instead of being reported. The harness restates no part of the bind.
- **`tests/workflow-contract.test.mjs`: 103 passed** (unchanged; no workflow change). **`tests/run-all.mjs`** (staging) and **`tools/wsf-control/run-all.mjs`**: all suites passed.
- **Mutants of the new code: 69 of 70 killed** (W4's catalogue, re-run at the review-round head, with the reviewers' mutants and seven for R7 added: either half of the type check removed, at bind or in the guard; documents fulfilled with the host's own type; other headers dropped; two charsets admitted).
  - They include all the token, stream-part and param checks; the template match; the host-script block (its paths, its type, its counting, its anchors, its case and its exact-URL check); the UTF-8 and BOM handling; the probe agreement; the reference check; the timestamp and NUL counts; the slot boundaries; the canonical JSON form; and the probe-line query.
  - **Corrected claim.** The earlier version of this note said every mutant added for the real-host findings and the ruling was killed. That was true of W4's own mutants, but not of the reviewers' (W3 #609 `6092037523`, the Director's delta #394 `6092160295`). Those were:
    - the slots hashed by a plain string join (slot position and presence unbound);
    - the `u:` cut widened by one or two, or started three digits in;
    - the token cut widened;
    - the host-script patterns without an anchor, with an `.+` id or case-insensitive;
    - an unnamed param slot;
    - a dropped BOM;
    - an empty `?` or `#` blocked.

    All of them are in the catalogue now, and all are killed by this round's tests. One of them, the events pattern matched case-insensitively, survived the first re-run and is killed by the upper-case look-alikes.
  - Earlier rounds: two survivors were real test gaps and are killed (assets walked only from `/`; the stream part read to the end of the document), and one defect from W4's own re-read was fixed (the stream part's end looked up in a lower-cased copy, `İ`).
  - The survivor substitutes params shortest first instead of longest first. It is **not** equivalent in every case (corrected in LOVABLE-REVIEWED-BUILD-2, L0 #394 `6092810294` item 9). When two ids partially overlap where they meet in a document (one's end is the other's start), the order decides which id becomes the slot, so the digest differs; the overlap check refuses only an id contained in another. It matters only when the partially overlapping ids differ in length, because the sort is stable and its comparator returns 0 for equal lengths (W3 N2). It has no security effect: splitting on one id and then the other is lossless in either order, so two documents for one URL that differ outside the normalized values (the token, the `u:` values and, on a param template, the screenshot file name, which share one form by design) never share a canonical form, and the bind and the guard run the same code. No probe or fixture id pair overlaps that way.

**Review round** (W3's finding #396 `6092038757`, review #609 `6092037523`; the Director's delta #394 `6092160295`). All of it is in the same five paths.
- **R1: a leading BOM is refused.** The decoder keeps it (`ignoreBOM: true`), so a BOM-prefixed reviewed document reduces to another digest. Both the guard and the bind refuse it: on every load it binds to another digest and the bind fails; on one load it leaves the template unbound.
- **R2: the token-bearing events tag is bound.** Its `src` made a `data:` URL, its `src` made another `/assets/` name, an attribute added before the token, and an attribute changed before the token: each is refused by the guard and gives another digest at bind.
- **R3: slot position and presence are bound.** The URL's param removed, inserted in the stream part, or moved is refused, and so are the kiosk params swapped (N1). A fixed vector pins the canonical JSON of a small document: its sha256 was `1d65a5a4…` in that round. Step C re-pinned it to `b7316f8e…` (see "The fixed vectors" below).
- **R4: slot boundaries are exact.** Each fixture request now draws one random 13-digit timestamp for both of its `u:` values, independent between requests. They are not built to differ in every digit: two requests can share a digit by chance (corrected in LOVABLE-REVIEWED-BUILD-2, and W3 N3). The byte after a `u:` value changed, the byte after the token changed, a 12-digit `u:`, and a 7-character token are each refused.
- **R5: the host-script matches are anchored and exact.** Each of these is refused:
  - `/~flock.js/x`, `/~flock.json`, `/~flock.js.map` and `/~FLOCK.JS`;
  - `/__l5e/events.<id>.js/x`, `.jsonp`, `/x/__l5e/…`, `/__l5e/events.a/b.js`, `/__L5E/…` and `EVENTS…JS`;
  - an empty `?` or `#` on either path. The URL must be exactly origin plus path, which is W3's N2.
- **R6, N3, N4:** these sections now say what the route does not see, and the host-build row text and the stale lines are corrected. The quote class, which could never be named, is gone, and the text says why.
- **R7 (L0's addendum #394 `6092214109`): documents are decoded the way the guard decoded them.**
  - A document is refused, at bind and in the guard, when it is not declared `text/html`, or when it names a charset other than UTF-8: `windows-1252`, `utf-16le`, two charsets, or an empty one.
  - Every verified document is fulfilled as `text/html; charset=utf-8`, with its other headers kept.
  - This has not yet been seen against the real host, because the earlier binds did not read the header. The next gate bind does, and it fails before any credential if the host declares anything else.

**LOVABLE-REVIEWED-BUILD-2, step A** (queue #365 `6092691424`; the items carried from #365 `6092671171`). All of it is in the same five paths; `REVIEWED_BUILD` is unchanged in step A.
- **Asset charset.** A reviewed `/assets/` script or stylesheet declared in a charset other than UTF-8 is **refused**, in the guard and at bind. A verified asset is fulfilled with the host's own headers. This covers `windows-1252`, `utf-16le`, two charsets, an empty one, and an upper-case `CHARSET` name.
  - **Refused rather than relabelled.** The queue offered both: fulfil every asset as `text/javascript` or `text/css` with `charset=utf-8`, or refuse a non-UTF-8 declaration. Relabelling would make the run's browser decode an asset differently from a visitor's. A host-side charset change would then pass host-build while the product broke for the people using it. Refusing keeps the run's browser seeing what a visitor's sees, and the bind catches it before any credential.
  - **What the browser decodes.** In every admitted case the encoding is fixed by reviewed input, never by an unverified header: UTF-8, unless the reviewed bytes (a BOM or `@charset`) or the reviewed document say otherwise; a module script is always UTF-8 (W3 N1: a reviewed `@charset "windows-1252"` or UTF-16 BOM does change the decoding, which is still reviewed input). The MIME type is left to the browser's own checks, which treat this run as they treat a visitor.
  - **At bind**, the refusal reads `script <url> is served with charset windows-1252, not UTF-8` (or `stylesheet`), and the bind FAILs as for any reference the guard would refuse.
  - **Not yet seen against the real host.** No bind has read an asset's declared type. The next gate bind does.
- **The `CHARSET` parameter name.** A document declared `text/html; CHARSET=windows-1252` is refused, in the guard and by `documentTypeProblem`. Dropping the `i` flag from the charset pattern no longer survives.
- **The token's upper bound.** A 4097-character context token is refused (`not 8-4096 characters`), and an 8- and a 4096-character token each reduce to the reviewed document. `{8,4097}`, `{8,}` and `{8,4095}` no longer survive.
- **This note.** The guard's "Documents" bullet lists the declared-type check, the UTF-8 fulfilment and the NUL count, and the R4 sentence says the fixtures' timestamps are independent random digits.

**L0's step A addendum** (#394 `6092810294`, from L0's mutation re-check of `d498cd6c`):
- **Item 5, the events id.** The host-script pattern admits exactly 16 lower-case hex digits, the real id's shape (`1718a1eacac7ff3a`, read from the blocked-script lines of bind runs `38007859514` and `38017456574`, not from a fixture). The fixtures now use a 16-hex id too. Each of the look-alikes listed under "The browser guard" is refused, and each of L0's seven extra mutants is killed: `[^/]+`, an empty id, `.` in the id, `%` and `~` in the id, and an unescaped dot after `events`, before `js`, and in `~flock`.
- **Items 6 and 7, userinfo.** A Lovable-host URL with userinfo is refused, not blocked, and the refusal reads `<type> <origin><path> carries userinfo (not printed), which no reviewed request has`. A check that refuses only `?` and `#` no longer survives.
- **Item 8, a UTF-8 vector.** A second fixed vector carries `é`, `—`, an emoji, U+2028 and `ü`; its canonical JSON's sha256 is pinned (`edb801ca…`, recomputed independently outside Node). Hashing the canonical JSON as latin1 no longer survives.
- **Item 9.** The note on the param-order survivor is corrected, above.
- **Also, for run `38017456574`.** Its gate bind on `main` printed the pinned `/` and the same 79 assets, but other digests for both param templates, with the same counts (#394 `6092918005`). The canonicalization is unchanged since the pin's bind apart from R1's kept BOM, so either those documents start with a BOM or the host's render of them changed. Each document and probe line of the bind now says `bom=yes|no`, so the next bind tells which. The pin's shape doesn't change.

**Proof, step A** (Node 20.20.2 and Node 22.22.2): `tests/hosted-lovable-kiosk.test.mjs` **27 passed** (one new test, the asset type table; the others extended); `hosted-lovable-device-matrix.test.mjs` **20 passed**; `tests/workflow-contract.test.mjs` 103 passed (no workflow change); staging `tests/run-all.mjs` and `tools/wsf-control/run-all.mjs` all suites passed. **Mutants: 104 of 105 killed.** That is the round-1 catalogue re-based on the bounded events pattern, plus 35 new ones: the asset charset at bind and in the guard (removed, joined wrongly, relabelled, headers dropped, stylesheets skipped, the stylesheet named a script), the charset parser (the `i` flag dropped, the value compared case-sensitively, an empty charset admitted), the token bounds (`{8,4097}`, `{8,}`, `{8,4095}`, `{9,4096}`, `{7,4096}`), L0's seven events-id mutants and five more (unbounded, 15–16 or 16–17 digits, upper case, any letter), userinfo (removed, username only, `?`/`#` only, unnamed), latin1 hashing, and the BOM flag (never set, not carried, inverted). The survivor is the param-order mutant, described above. No credentialed run, and no bind of this code against the host yet.

**LOVABLE-REVIEWED-BUILD-2, step B.** `REVIEWED_BUILD` was re-pinned to Lovable `db3fd2f2`: exactly the `LOVABLE_OBSERVED_BUILD` line of gate bind run `38018743683`, since superseded by step C's pin (see "The pin", above). Only the pin's value and its provenance text change; the code is step A's. The suites pass against it, and the shipped pin binds to itself.

**LOVABLE-REVIEWED-BUILD-2, step C** (W3's finding #396 `6093402257`, detail #610 `6093400242`; L0's step C input #394 `6093458108`, with DEEPLINK-DRIFT-CONFIRM-1's verbatim bytes `6093468966`). Same five paths; the matrix harness is unchanged.
- **The field.** Lovable's hosting adds a page-preview screenshot link, as the `og:image` and `twitter:image` meta elements immediately before `</head>`, to a page that sets no preview image, and renames the file on each screenshot regeneration. `/display/…` and `/kiosk/…` set none, so they carry it; `/` sets its own `/og-share.jpg`. The bucket host and the `lovp_` segment stay the same; the file name is `<32 lower-case hex>_<13 digits>` (Unix milliseconds).
- **When it changes.** On each screenshot regeneration, which follows a Lovable commit by about 30 s; both the 32-hex part and the 13 digits change (L0 #394 `6093608755`: `a74c72a1…_1791601764778`, then `f722a6b9…_1791604676866`, then `d998c69b…_1791604878899`). Thirty fresh fetches and a 10-minute series were identical, so it does not change per request or per server instance.
- **The rule** (exactly that, nothing broader). On a param template only, the file name is a named slot (`preview-image`) inside exactly `content="https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/lovp_372ahwppkw9debd61922xf2ayz/` … `.png"`, where `content` follows white space and everything else is literal. JS `\s` also admits U+00A0, which HTML does not treat as an attribute separator. That has no effect: such a byte would be literal text inside the pinned digest, and the pinned documents use a space. A param document must carry exactly 2 such links naming the same file, outside the stream part; `/` must carry none. The file-name shape anywhere else is refused.
- **The counts.** The pin binds `img` per template like `u` and NUL (`img=2` on each param template, `img=0` on `/`), at bind and in the guard, and the bind lines print it with `bom=`.
- **The names.** Each template's bind line names the files its loads carried (public: every visitor receives them), only after the shape check, never in `LOVABLE_OBSERVED_BUILD`.
- **Negatives** (each refused in the guard, by name or by digest, and each giving another canonical form at bind): 33 or 31 hex, 14 or 12 digits, upper case; a `"`, `<` or space in the name; one link moved into `<body>` (by digest), into the stream part, or into another attribute (`data-src=`, `data-content=`); a third link, a missing link, two different files; another bucket host, a look-alike host (a dot replaced) or another `lovp_` segment; the shape outside the links; a link on `/`; the kiosk with one link. A regeneration between two loads binds, and the template line names both files.
- **W3's F2–F7.** Asset charset negatives for a tab or two spaces after `;` and for duplicate Content-Type headers joined with `, `, at bind and in the guard; the 16-character `-` and `_` events-id look-alikes; a blocked events id with every hex digit; userinfo on an image and a `fetch`; an inner U+FEFF that is no leading BOM (`bom=no`).
- **W3's N1–N3.** The asset decoding sentence, item 9's correction and R4's wording, above.
- **The fixed vectors.** Both are display documents, so they now carry the two links; their pinned sha256 are `b7316f8e…` and `6aa341db…`, each recomputed independently in Python.

**Proof, step C** (Node 20.20.2 and Node 22.22.2): kiosk **27 passed**, matrix **20 passed**, `workflow-contract` 103 passed, staging and control `run-all` all suites passed. **Mutants: 134 of 136 killed**: the catalogue so far plus 25 for step C (the count, `/`'s count, the shape elsewhere, the stream part, two files, the attribute boundary, the name's case, length and characters, the host and segment literals, the cut and its boundaries, `img` at bind, in the guard and in the pin, the names in the line to pin, unchecked or missing or first-load-only names) and W3's six. The survivors: the param-order mutant (item 9), and `img` left out of the per-template agreement, which is equivalent, because a load's `img` is the number of `preview-image` slots in its canonical JSON, so equal digests mean equal counts. L0's two gate samples on the branch then read step C's form on the real host and agreed across a regeneration; the pin is their manifest (see "The pin", above).

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
2. Done in LOVABLE-REVIEWED-BUILD-1: the route-aware binds (runs `38006215259`, `38007704034` and `38007859514`) and the pin commit, which copied run `38007859514`'s `LOVABLE_OBSERVED_BUILD` exactly. Done in LOVABLE-REVIEWED-BUILD-2: the re-pin to Lovable `db3fd2f2`, first in step B's form (run `38018743683`), then in step C's form, exactly the `LOVABLE_OBSERVED_BUILD` shared by gate samples `38023220481` and `38025003360`.
3. After L0 merges it, one kiosk `--run` and one device-matrix `--run`. Each must PASS host-build against the pin; a later Lovable publish needs a new bind and a new value.
4. The authorized proof run. It can reach `host-build`, `fixture-provenance`, the control's five phone rows and `cleanup-tracking`. The rows that remain BLOCKED fail it by name: `qr-join` (the kit's private community), the station turn, the organizer UI approval, and the unverified account.
