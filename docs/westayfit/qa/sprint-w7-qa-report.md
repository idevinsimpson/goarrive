# Sprint Round 1 — W7 Independent Journey QA

Worker: **W7 — INDEPENDENT JOURNEY QA**
Branch: `claude/wsf-sprint-w7-journey-qa`
Starting SHA: `a193b43086ee0564b8edf99083ab164c08f9ceff` (`claude/wsf-app-shell`, verified by `git rev-parse HEAD` at session start, not assumed)
Assignment: PR #365 comment 5787366259, section "W7 — INDEPENDENT JOURNEY QA".
Session: `session_01PjqZ76c16dHJyxHaMvCoE5` (Claude Code Remote, `claude-opus-5`; the owner's included subscription, no API billing). Predecessor: `session_0196eWn3hsB1BduPkKM8y5md`, retired at `5787486366` for the model correction only.

## Scope and constraints held

- Tests and evidence only. No product source, no screenshot rebaseline, no creative verdict, no deployment.
- Files reserved to W7 and nothing else: `apps/westayfit/tests-e2e/sprint-w7-*.spec.ts` and `docs/westayfit/qa/sprint-w7-*.md`.
- Emulators only (`demo-wsf-local`). No gcloud, no IAM/WIF/network change, no secret read, no live account.
- Existing `e5-goal-form` coverage is reused, not re-created. W5's kiosk suite is not duplicated.
- Findings route through L0 to W6; W7 takes no fix ownership.

## Session continuity

This report was opened by `session_0196eWn3hsB1BduPkKM8y5md`, which L0 retired at `5787486366` solely to put W7 on the sprint's recorded worker model. The replacement session is **`session_01PjqZ76c16dHJyxHaMvCoE5`** (`claude-opus-5`, configured and last-served; reasoning effort not exposed to the session and therefore not stated). It resumed from the pushed `5fddc36` on the same branch, in the same PR #434, under the same file reservation. Its container started empty, so every environment row below was re-established and re-proved in this session — the predecessor's proof is not carried over.

| Step | Command | Result |
|---|---|---|
| Install | `npm ci` at root, `apps/westayfit`, `functions-westayfit` | exit 0 each |
| Functions build | `npm --prefix functions-westayfit run build` | exit 0 |
| Web build | `EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 npm --prefix apps/westayfit run build:web` | exit 0 |
| Emulators | `METADATA_SERVER_DETECTION=none npx -y firebase-tools emulators:start --config firebase.westayfit.emulators.json --project demo-wsf-local` | ready; hosting 5010, firestore 8080, auth 9099, functions 5001 all answer; `wsfCreateGoal` initialised |
| Browser | `WSF_PLAYWRIGHT_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome` | the pre-installed Chromium; `playwright install` not run |
| Stack smoke | `… npm --prefix apps/westayfit run test:e2e -- e5-goal-form.spec.ts` | **3 passed, 0 failed (13.8s)** |
| Evidence guard | `node scripts/westayfit/check-evidence-intact.mjs` | exit 0 — 9 frozen, 20 accepted, no byte changed |

---

# Check 1 — W4's `/?view=communities` (PR #432, head `de8f567`): **PASS**

Routed by the Director (`5787475396` §2) and repeated in L0's handover note (`5787486366`, routing note 1) as W7's first ready-candidate check. One independent focused run. No screenshot rebaseline, no full-app audit, no duplication of W5's kiosk suite.

**Verdict: PASS.** Every case the routing named holds on `de8f567`, and the opt-in half of the suite is demonstrated to fail on the unmodified base, so the pass is a measurement and not a vacuum.

## How it was run, and on what

| | |
|---|---|
| Product under test | `de8f567` (`claude/wsf-sprint-w4-home-view-communities`), source review PASS `5787470558` |
| How | `git merge --no-commit --no-ff de8f567` into the W7 working tree — **a local merge that was never pushed and was aborted after the run**. `git diff de8f567 -- apps/westayfit/app/index.tsx` was empty, i.e. the product file exercised was byte-identical to the candidate's. |
| Spec | `apps/westayfit/tests-e2e/sprint-w7-home-view-communities.spec.ts` — W7's own file, written from the candidate's stated contract, **not** a re-run of `sprint-w4-home-view-communities.spec.ts` |
| Branch hygiene | W7's branch carries only the W7 spec and this report. No product source, no W4 file. |

## Why a separate spec, and what it adds

The candidate's prose states that *"the array expo-router returns for a repeated `?view=`"* keeps today's behaviour. **The candidate's own spec never exercises a repeated param** — its four default-preserving variants are `?view=banana`, `?view=`, `?view=Communities` and `?viewer=communities`. The repeated cases were therefore an asserted-but-untested half of the contract, and are the reason this check was routed to an independent worker. Two further gaps are covered here: the opt-in arriving **alongside other params** (the shape a real F6 link will have), and *"nothing is written, nothing is remembered"* checked **from the absent state**, which is the direction that can actually regress.

## Results on `de8f567` — 7 passed, 0 failed (9.5s)

| # | Case | Result |
|---|---|---|
| 1 | Repeated `view`, every order — `?view=communities&view=communities`, `?view=banana&view=communities`, `?view=communities&view=banana`, `?view=&view=communities` | **default holds** — the community opens, the list is never rendered |
| 2 | Repeated unknown — `?view=x&view=y`, `?view=COMMUNITIES&view=Communities` | **default holds** |
| 3 | Single exact value, alone and beside unrelated params — `?view=communities`, `?view=communities&from=create`, `?from=x&view=communities` | **opts in** — the list renders, Home stays at `/`; bare `/` before and after still opens the community |
| 4 | Three communities, nothing remembered, opt-in navigation | the per-account key `wsf.currentCommunity.<uid>` is **still absent afterwards** — nothing written |
| 5 | Three communities, remembered one is **neither the newest nor the only one** | bare `/` opens the remembered one; the opt-in lists all three including the two never opened; the repeated form still opens the remembered one; the key is **unchanged** across the whole round trip |
| 6 | Zero communities | `?view=…` in bare, single and repeated form is inert — empty state, still at `/`, nothing remembered |
| 7 | Signed out, with the param in single, doubled and mixed form | signed-out Home every time; **`wsf-home-my-list` renders zero times** |

## The negative control — the pass is not vacuous

The same spec was then run against the **unmodified base** `a193b43` (merge aborted, web rebuilt from base, emulators untouched):

```
2 failed
  › the single exact value opts in, alongside unrelated params
  › a remembered community that is not the newest still opens, and the list shows the rest
5 passed (28.0s)
```

Both failures were read, not assumed, and both are the correct failure: `Error: "?view=communities" did not reach the list … waiting for getByTestId('wsf-home-my-list') … element(s) not found` — the list never renders on base because Home opens the community, which is precisely the behaviour `de8f567` changes. No fixture failed; no harness collapsed; sign-in, seeding and the signed-out gate all worked identically in both runs.

The other five tests pass on **both** heads, and that is the intended shape: they assert the *default*, the signed-out gate and the no-write claim, none of which the candidate is supposed to move. They are non-regression checks, and stating otherwise would overclaim them.

## One finding, recorded as an observation rather than a defect

The repeated-param results let the mechanism be pinned down rather than assumed, and it is worth recording because the candidate's comment asserts it without testing it:

- `?view=banana&view=communities` did **not** opt in → the value is not last-wins.
- `?view=communities&view=banana` did **not** opt in → it is not first-wins either.
- `?view=communities&view=communities` did **not** opt in.

So a repeated key does not reduce to a bare string on this path, which is consistent with the array `useLocalSearchParams` is documented to return, and `wantsCommunityList` (a strict `view === 'communities'`) rejects it. **The safety-relevant direction is the one that matters and it is sound: no accidental or mixed URL was able to switch the default off.** The cosmetic converse — a member who somehow arrives at `?view=communities&view=communities` gets the community opened rather than the list — is the conservative outcome, not a defect, and no change is requested for it.

## Constraints held during this check

No product source was written or modified on the W7 branch; no screenshot was captured or rebaselined; no creative verdict was given; nothing was deployed. `node scripts/westayfit/check-evidence-intact.mjs` → exit 0 (9 frozen, 20 accepted, no byte changed) after the runs; `npm --prefix apps/westayfit run ts:check` → exit 0; `artifacts/` reverted and `test-results/` cleaned after every e2e run, and neither is committed.

## Routing

PASS reported to L0 on PR #434 with the product SHA `de8f567`, plus one deduplicated pointer on #365. W7 takes no fix ownership and claims no acceptance: L0 integrates, the Director accepts.

---

# Check 2 — `/goals/new` creation-result / recovery contract (pinned `a193b43`): **BOUNDED PASS with one concrete finding**

Spec: `apps/westayfit/tests-e2e/sprint-w7-goal-setup-contract.spec.ts` — **7 passed, 0 failed (8.7s)** against the pinned base `a193b43`, on the emulators (`demo-wsf-local`), driving the genuine `wsfCreateGoal` callable. No product edit was required to exercise any case.

This is the contract as it **exists**, investigated separately from W6's styling work. Every goal that came into existence below was created by pressing the screen's own control; no idempotency was invented, and no extra mutation was made to force a pass. `e5-goal-form`'s coverage (field validation, the date controls, the zone wording, the stored request shape) is **reused, not re-created**.

## Method — why two request counts, and why the server is queried

A missing response is not proof that nothing was created, so every case records **two** counts and then asks the server directly:

- **attempted** — POST requests the client issued (CORS preflights excluded; counting them would inflate every number).
- **delivered** — requests actually handed to the callable. Only a delivered request can create a goal.
- **server state** — a `runQuery` over `wsfGoals` filtered on `communityGroupId`, read with owner credentials, i.e. what is really there rather than what the screen implies.

The two lost-outcome cases are kept **strictly distinct and never substituted for one another**: `route.abort()` without a fetch is abort-before-send; `route.fetch()` *then* `route.abort()` is commit-with-lost-response, and the server's own 200 reply is captured before it is destroyed, so the commit is **stated, not inferred**.

## What the contract actually is

| Case | attempted | delivered | goals on the server | what the Champion sees |
|---|---|---|---|---|
| Normal success | 1 | 1 | **1**, id equal to the confirmation's `data-goal-id`, `ownerUid` = the Champion | "Your goal is live", with contribute / display links |
| Known refusal (ordinary member, server-side `permission-denied`) | 1 | 1 | **0** | "Only a Champion of this community can start a goal here."; control re-enabled |
| **Abort before send** | 1 | **0** | **0** | **"Something went wrong. Please try again."** |
| **Commit with lost response** | 1 | **1** (server replied `200` carrying the stored `goalId`) | **1** | **"Something went wrong. Please try again."** |
| Retry after a lost response | 2 | 2 | **2**, same title, two distinct ids | "Your goal is live" — naming only the second |
| Rapid repeated submit (second press inside a genuinely in-flight 2s window) | 1 | 1 | **1** | control reads "Starting…", is `disabled`, and **refuses the second press** |
| Confirmed success, then the confirmation is lost (reload) | 1 | 1 | **1** throughout | empty form again, no link to the goal |

## FINDING — the creation-result contract cannot distinguish "created" from "not created"

**Concrete and reproducible.** Rows 3 and 4 above are the whole finding: the two outcomes render **the identical sentence, word for word** — asserted by equality against a single constant, not by a permissive set — while the server holds **0 goals in one case and 1 in the other**. `wsfCreateGoal` takes no attempt key (`db.collection('wsfGoals').doc()` mints a fresh id per invocation), and `app/goals/new.tsx` holds the confirmation in component state, so nothing on either side can close the gap after the fact.

**The consequence is reachable by doing exactly what the message asks.** "Please try again." is an instruction; a Champion who follows it after a committed-but-unconfirmed submit creates a **second goal** with the same name (row 5) — two distinct ids, and the confirmation names only the newer one. This is the same shape as the gap #432 exists to mitigate for `wsfCreateCommunity`, one collection over.

**What makes it cheap.** The answer already exists one screen away, and that was read from the product rather than assumed: after the lost response, `/community/<groupId>` **does** link to the goal that was in fact created, and going there creates nothing. The same is true after a lost confirmation (row 7). So the information the Champion needs is present; the screen that lost the outcome simply never points at it.

**Not claimed here.** No fix is designed, prescribed or owned by W7, and no idempotency key is proposed as though the code had one. Whether the remedy is a different sentence, a link to the community page, an attempt key, or nothing at all is W6's and the Director's call. Routed through L0 to W6 as the surface's future writer.

## What came back clean

- The **refusal path is exact**: the server refuses inside the transaction, so a refused submit leaves the server byte-for-byte as it was — 0 goals — and the page states the reason in plain words with no raw code.
- The **double-submit window is closed at the interface**: with a real request held in flight for two seconds, the control reads "Starting…", is genuinely `disabled`, and a real second press is refused. Only what the interface permits was attempted; the press was a real press with a real timeout, and its refusal is the measurement. Delivered stayed at 1 and exactly one goal exists.
- **Losing the confirmation destroys nothing and creates nothing**: exactly one goal before and after a reload, and the community page still reaches it.
- The success path's id is the **server's** id: the confirmation's `data-goal-id` equals the stored document's id, and the stored `ownerUid` is the Champion.

## Bound

This is a bounded result, not a full audit of goal setup. It covers the creation-result and recovery contract only, on `a193b43`, in Chromium on the emulators. It does not cover W6's styling, offline queueing, multi-tab submission, or any surface beyond `/goals/new` and the community page it returns to.

---

# Check 3 — W2's responsive public display (PR #435): **PASS**

Routed by the Director at `5787682989`. Acknowledged at `5787688552` before execution. Spec: `apps/westayfit/tests-e2e/sprint-w7-display-responsive-verify.spec.ts` — **13 passed / 0 failed (21.6s)** on the candidate.

## Product identity — verified by blob hash, twice, and a head that moved

| | |
|---|---|
| Pinned by the packet | `1fd669f231105f016f4b0e03903f7faf71eec31c` (successor of `223f880`; booth-generic hold closed at `5787678609`) |
| Verified at start | #435 head read **`1fd669f`** — the pinned SHA exactly |
| How the code was exercised | `git merge --no-commit --no-ff 1fd669f` into the W7 tree, **never pushed, aborted after each run** |
| Blob proof | `app/display/[goalId].tsx` → `5cc5db21aff2e2a020358e8c9cb221734988eb16`; `src/ui/displayLayout.ts` → `b2cc623e52f4221cb5b33701df3a952994dc3f7c` — identical to the candidate's, checked before the run and again on the second merge |

**The head advanced during the run, and that is announced rather than followed silently.** #435 moved to **`8165b52cf59d7b28c67a74adaa08688d87f9a967`** at 02:11:56Z. `git diff 1fd669f 8165b52` is **one file, `review/display-responsive-after/README.md`, +47 / −14** — documentation only. **Both product blobs are byte-identical at `8165b52`**, so this result applies to `8165b52` unchanged and no re-run was required. Had a product byte moved, the result would have been reported as pinned to `1fd669f` and nothing more.

Note recorded, not a defect: #435's body states its source revision as `a193b43` → `8165b52`, and at the moment I began it read `223f880` while the head was already `1fd669f`. The body trails the branch; the blobs, not the prose, were used.

## Method — why this suite is split in two

The packet requires positive, discriminating checks, and the display's failure states are the place where that is hardest: at 800×1280 and 1920×1080 the **base** renders the PHONE composition, in which most of these invariants already hold. A test that merely passed on both heads would be measuring behaviour that predates the change.

So the file is two groups, and **each was run against both heads**:

- **PRESERVED** — asserted with values that exist on the candidate *and* on unmodified `a193b43`. These are **meant** to pass on both; that is precisely what makes them evidence of preservation.
- **NEW** — portrait and collective. **Every one of them asserts `data-tier`**, so it states which composition it ran in and cannot pass on a base that has no such tier.

That second decision was a correction to my own first cut: before the tier assertions, **8 of the 11 new-tier tests passed on the base as well**, and I would have been reporting non-regression as proof of the change. They were tightened until the split was exact.

## The two runs

| Head | Preserved (2) | New tiers (11) |
|---|---|---|
| Candidate `1fd669f` | **2 passed** | **11 passed** |
| Base `a193b43` (merge aborted, web rebuilt from base, emulators untouched) | **2 passed** | **11 failed** |

Every base failure was read. They are the right failures — `data-tier` absent, `data-layout` reading `phone` where `portrait` is required, freshness computing `13px` where the tier requires `22px` / `26px`. No fixture failed and no harness collapsed: seeding, the callables and the signed-out paths behaved identically in both runs.

## PRESERVED — 390×844, 1280×800, 1440×900 did not move

Identical measured values on **both** heads:

| Viewport | Measured | Candidate | Base |
|---|---|---|---|
| 390×844 | Living WE width | 306 | 306 |
| 1280×800 | Living WE width | 538 | 538 |
| 1440×900 | Living WE width | 605 | 605 |
| 390 / 1280 / 1440 | `data-layout` | `phone` / `wide` / `wide` | same |

**The corrected generic placement**, at the two viewports the packet names — and the packet's constraint is respected: **the generic states render no instrument, so mark width proves nothing there.** The block itself was measured instead, on the refusal screen, at 1280×800 and 1440×900:

| Measured on the refusal screen | Candidate | Base |
|---|---|---|
| canvas `justify-content` | `space-between` | `space-between` |
| generic block computed `max-width` | `720px` | `720px` |
| generic block **rendered** width | 572 | 572 |
| wordmark height | 44 | 44 |
| headline `font-size` | `56px` | `56px` |

The booth refusal canvas is therefore **not** the centred canvas the collective tier received — the correction `1fd669f` was made for holds under measurement. One thing worth stating because it caught me: `maxWidth: 720` is a **cap**, and the block is content-sized and centred, so its rendered box is 572, not 720. My first assertion demanded 720 and failed; that was **my error, not the product's**, and both the cap and the rendered width are now asserted separately.

## NEW — portrait 800×1280 and collective 1920×1080

| Case | Result |
|---|---|
| Both tiers resolve; same confirmed total / ratio / status (`241 of 500 squats`, `48.2% complete`, `259 to go`); mark 440 portrait and 760 collective | PASS |
| Confirmed read, then network failure: the value is **retained** (all three lines unchanged), **labelled** (`Connection interrupted`, `Last confirmed`, `data-stale=true`), the confirmed clock **does not advance**, and the warning is sized for the room (22px portrait / 26px collective, not the phone's 13px) with the freshness row inside the canvas | PASS, both tiers |
| **Initial** read failure: no value and **no instrument** invented — no Living WE, no total, no ratio, no status, no confirmed-at, and no fixture figure anywhere in the text | PASS, both tiers |
| Authorization refusal after a confirmed read: context **cleared** — no community name, no goal title, no period, no instrument, no figure | PASS, both tiers |
| Recent-addition failure while the pulse keeps answering: the recent list empties, the **aggregate survives** unchanged and **is not marked stale** | PASS, both tiers |
| Long community name and title with **five** recent additions: every one of the five lines, the heading, the identity and the total are **inside the canvas** (each measured on its own box, not the panel's), and nothing overflows | PASS, both tiers |

The last row is the independent measurement of the defect W2 found in their own first cut — a taller type scale pushing the recent column off a 1080 canvas that cannot scroll. Containment is asserted on **each line's own box**, because a clipped column can still report a panel that begins on screen.

## Public-surface safety

Asserted on the ready, stale and refusal screens at both new tiers: no member uid, no champion uid, no join code, no personal credit (`7331`), no group id, no `familyFriends` / `private`; **no QR control of any kind** and no `scan…` / `qr code` affordance. QR is absent, not stubbed — there is no dead control promising a capability this route does not have.

## No defect found

Nothing reproducible was found on this candidate within the packet's scope. The one failure in my own runs was my own incorrect assertion about a CSS cap, corrected above and stated rather than quietly fixed.

## Bound

Portrait 800×1280 and collective 1920×1080, plus phone 390×844 and booth 1280×800 / 1440×900 for preservation, in Chromium on the emulators, at `1fd669f` (product-identical to `8165b52`). **Not** a full-app audit, **not** a pixel or creative verdict — the Director owns pixel acceptance — and not a re-run of W2's own capture spec. Tier-boundary values (599/600, 899/900, 1599/1600) are W2's own coverage and were not duplicated. No frame captured, no baseline rebaselined, no product file touched. Fixes route through L0 to **W2**, the one writer for this surface.

---

# Check 4 — W6's implemented `/goals/new` recovery behaviour (PR #433) at **`8067364`**: **PASS on all four conditions**

Routed by the Director at `5788288648` and recorded by L0 at `5788323817` §2. Acknowledged at `5788590283` before execution. Spec: `apps/westayfit/tests-e2e/sprint-w7-goal-recovery-verify.spec.ts` — **7 passed / 0 failed (9.8s)**.

## Product identity — and one error in the record

| | |
|---|---|
| PR #433 head | **`806736453726bc439a2df8039bd1c606fb7818ed`**, unchanged before and after the run |
| How exercised | `git merge --no-commit --no-ff 8067364` into the W7 tree — **never pushed, aborted afterwards** |
| Route blob at base `a193b43` | `e5be66f0e9afb03ae92c1ba3573fc641bd749ef3` — matches W6's `e5be66f` |
| Route blob at `8067364` | **`cbda3fdea53a40aa1a404da45938cb4766b26718`**, re-verified in the worktree |
| Backend | `git diff a193b43 8067364 -- functions-westayfit/ firestore.rules` is **empty** — `wsfCreateGoal` is untouched and still takes no attempt key |

**W6's checkpoint and #433's body both state the route blob as `e5be66f` → `a70bcd5`. `a70bcd5` is not a valid object in this repository** (`git cat-file -t a70bcd5` → `fatal: Not a valid object name`), and walking the branch (`5070eae`, `e49fa38`, `f880732`, `8067364`) shows the route blob is `e5be66f` on the first three and **`cbda3fde`** at the head. The base half is right; the new half names an object that does not exist. This is a **defect in the record, not in the product** — the head SHA is unambiguous and is what was verified — and it is W6's to correct. W7 did not correct it and takes no fix ownership.

## The four conditions

| # | Condition | Result |
|---|---|---|
| 1 | commit-with-lost-response **versus** abort-before-send, strictly distinct | **PASS** |
| 2 | the deliberate retry and its duplicate warning | **PASS** |
| 3 | duplicate-submit protection | **PASS** |
| 4 | the real `Check community goals` action | **PASS** |

### 1 — the two lost cases, and the two refusals

| Case | attempted | delivered | goals on the server | what the screen says |
|---|---|---|---|---|
| Terminal refusal (`permission-denied`, ordinary member) | 1 | 1 | **0** | "Only a Champion of this community can start a goal here. **The server refused this request, so no goal was created.**" — and the submit control is **gone**, replaced by a working `Back to community` |
| Non-terminal refusal (`invalid-argument`) | — | — | **0** | the same plain refusal sentence, and the submit control **stays**, still reading "Start this goal" |
| **Abort before send** | 1 | **0** | **0** | "We couldn't confirm your goal was created. / It may have been created anyway. Starting another one could create a duplicate." |
| **Commit with lost response** | 1 | **1** (server replied `200` carrying the stored `goalId`) | **1** | **the identical words** |

The two lost cases were kept strictly distinct in the harness — `route.abort()` without a fetch versus `route.fetch()` then `route.abort()`, with the server's own reply captured before it was destroyed, so the commit is stated rather than inferred.

**They still render the same words, and that is now the correct behaviour rather than the defect.** The client genuinely cannot tell them apart; the fix was to stop pretending it could. What changed is the claim: the base said *"Something went wrong. Please try again."* — an instruction whose plain reading is that nothing was created — and the new screen claims nothing in either direction and warns that starting another could duplicate. The refusal path, by contrast, is now *entitled* to say no goal was created, and **that entitlement was checked against the server rather than taken on trust: 0 goals in both refusal cases.**

### 2 — the deliberate retry

After an unknown outcome the control is no longer the same control: it reads **"Start another goal"**, and the consequence — *"This starts a new, separate goal. If the first one was created, your community will have two."* — is **on screen with it**, asserted visible, not merely present. Taken at its word, it does exactly what it says: pressing it produced a **second goal**, two distinct ids and one title, attempted 2 / delivered 2, with the confirmation naming only the newer.

### 3 — duplicate-submit protection

Measured with a real request genuinely held in flight for two seconds. The control reads "Starting…", is genuinely `disabled`, and a real second press with a real timeout is **refused**. Delivered stayed at 1 and exactly one goal exists. Only what the interface permits was attempted.

### 4 — `Check community goals`: the proof the last report did not earn

My check-2 report said the community page "already links to the goal that was created" on the strength of a **`toBeAttached`** assertion. Attachment proves the anchor is in the DOM and nothing else. The Director corrected that, and it is not repeated. On this revision, after a genuine commit-with-lost-response leaving exactly one unconfirmed goal:

- the action is **visible**, with a real box of non-zero width and height;
- it is **hit-testable** — `document.elementFromPoint` at the control's own centre lands on the control or inside it, so nothing (the floating tab bar being the obvious candidate) is sitting on top of the thing the Champion is told to press;
- it was **actually clicked**, not just inspected;
- it **arrives** at `/community/<groupId>`;
- the goal that was really created is **visible and hit-testable there**, not merely attached;
- and it **cost nothing**: the server still holds **exactly one** goal, the same id, with **no further create call** (attempted 1 / delivered 1 across the whole flow).

## A consequence for integration, raised rather than left to be discovered

W6 changed what the screen says without changing what the system does — and my own earlier spec proves both halves of that. Re-running `sprint-w7-goal-setup-contract.spec.ts` (check 2, pinned to `a193b43`) against `8067364` gives **4 passed / 3 failed**:

- **3 failed**, each on copy that #433 deliberately changed: the refusal now appends *"The server refused this request, so no goal was created."*, and both lost cases now read *"It may have been created anyway…"* instead of *"Something went wrong. Please try again."* Every one of those three is the intended improvement.
- **4 passed** — normal success, the retry producing a second goal, duplicate-submit protection, and confirmed-success-then-lost-confirmation. Those are the *server-side* contract, and their passing is evidence in #433's favour: **request counts and server state are unchanged**, consistent with the empty backend diff.

So `sprint-w7-goal-setup-contract.spec.ts` asserts pre-#433 copy in exactly three places and becomes a false record the moment #433 integrates. It is W7's file, so W7 will fix it — but the sequencing is L0's, exactly as L0 took the analogous `sprint-w2-board10-capture.spec.ts` line at #435's integration. **W7 has not changed it**, because changing it now would break it on the current base instead. Say the word and it goes in the same integration.

## One minor observation — cosmetic, not a defect, and explicitly not a pixel verdict

On the **same refusal banner**, the title renders with a typographic apostrophe (`We couldn&rsquo;t start your goal.`) while the body can render a straight one — `We couldn't find that community.` and `Something about this goal didn't look right.` are plain `'` in `REFUSAL_COPY`. Both straight strings are **pre-existing** (`a193b43` carries them verbatim); what is new is the curly-apostrophe title now sitting directly above them, so the mismatch became visible on one banner. Recorded as a fact. Typography on this surface is the Director's to rule on, W7 offers no verdict, and nothing here is asked of W6.

## Bound

The four named conditions on `8067364`, in Chromium on the emulators. **Not** a pixel or creative verdict, **no** opinion on the open F6 colour ruling, no frame captured or rebaselined, no re-run of W6's own suite, no product file touched, no idempotency invented, no deploy or service/IAM/mail operation. Defects route through L0 to **W6**; the Director keeps acceptance.

---

# Check 5 — W8's social-community implementation (PR #441) at **`60604ca`**: **PASS**, no defect in scope; one latent config gap recorded

Routed by L0 at `5788851819` (Director release `5788831679` §4). Acknowledged at `5789059046` before execution. Spec: `apps/westayfit/tests-e2e/sprint-w7-social-privacy-verify.spec.ts` — **14 passed / 0 failed (5.0s)**.

## Identity, and the merge L0 asked for

| | |
|---|---|
| Pinned by the packet | `60604ca` |
| `claude/wsf-social-community` head | **`60604ca54490cb39b21bd7a4fb9b3396153cc5b9`** — the pinned SHA, unchanged throughout |
| W8's own branch base | `c8f38e3` |
| **Current app-shell head, merged onto** | **`d86620cc705272ead38ac266006eafcb56c173b3`** — past the `ba774ef` named in the packet; `d86620c` is #436 on top of #435 |
| How | app-shell taken as a real merge on the W7 branch, then `60604ca` merged `--no-commit` on top and **aborted afterwards** — the merge, not the branch, is what was tested |
| Blob proof | `CommunityPresence.tsx`, `settings.tsx`, `settings/privacy.tsx`, `community/[groupId]/members.tsx`, `community/[groupId]/index.tsx`, `you.tsx`, `functions-westayfit/src/index.ts` — **all seven identical to `60604ca`** |
| `firestore.rules` | **no diff**, confirmed by `git diff` — 0 lines, as the condition requires |

## The two declared files — the verdict L0 asked for

**`firebase.westayfit.json` (+1):** one rewrite, `/community/*/members` → `/community/__dynamic/members.html`, placed above the existing `/community/**` catch-all. It adds no other lane's route and alters no existing rewrite or header. **It does not touch another lane's surface.**

**`apps/westayfit/src/ui/CommunityPresence.tsx` (new):** imported only by W8's own two surfaces (`community/[groupId]/index.tsx`, `community/[groupId]/members.tsx`) and W8's own design-target preview. It reads colour tokens from `kit` and modifies nothing. **It does not touch another lane's surface.** Confirmed directly: `kit.ts`, `app/_layout.tsx`, `MemberTabBar.tsx` and `WsfWordmark.tsx` — W9's shell — have **no diff at all** in this candidate.

## The properties, proven at the genuine callable boundary

Most of this file uses no browser on purpose: every privacy property is enforced in the callables, so that is where it is proven — real ID tokens from the auth emulator against `wsfSetCommunityVisibility` / `wsfCommunityMembers` / `wsfCommunityActivity`, with fixtures written straight to Firestore. A screen that happens not to draw a name is far weaker evidence than a payload that does not contain one.

| Property | Result |
|---|---|
| Community-visible default — a membership row with **no** preference is listed and named | **PASS**; and no `userId` appears anywhere in the members payload |
| Name-private: absent from the directory, **still inside the member count** | **PASS** — omitted from `wsfCommunityMembers`, `memberCount` still 2 |
| Activity-private: no feed row, **still inside `contributorsToday`** | **PASS** — row gone, aggregate still 2 |
| Name-private + activity-visible → **anonymous row, not a missing one** | **PASS** — `displayName: null`, the contribution still present |
| Current preference evaluated at read time — **retroactive over old activity** | **PASS** — the name disappears from activity that already existed; the effort remains |
| Same-community auth | **PASS** — signed-out `UNAUTHENTICATED`; non-member and removed member `PERMISSION_DENIED`; **a non-existent community refuses identically**, message included, so the pair cannot enumerate real ids |
| Persistence across removal / reinstatement, **no Champion override** | **PASS** — an explicit private choice survives Champion reinstatement, and a Champion request carrying `targetUid` does **not** change that member's row |
| `contributorsToday` on the **goal's stored zone** | **PASS** — proven with `Pacific/Kiritimati` (UTC+14) and a contribution placed strictly between the zone day start and the UTC day start, so a UTC or host implementation would have counted 0 |
| Unreadable zone → **`null`, never a guess** | **PASS** — activity still readable, aggregate withheld |
| Public payloads identity-free | **PASS** — `wsfGoalRecentAdditions` and `wsfGoalPulse` with **no caller at all**, checked with members deliberately **visible** so the pass cannot come from there being nothing to leak: no name, no uid |
| No rank / streak / position anywhere | **PASS**, in both public and member-only payloads |
| Visibility changes **move no number** | **PASS** — the shared total is identical across private↔visible toggles |

**On discrimination, stated rather than quietly skipped:** the usual W7 practice of running the discriminating cases against the base is not meaningful here — these three callables and both settings routes **do not exist** on `d86620c`, so every case fails on the base for the trivial reason that there is nothing to call. What is *not* trivial is "hidden" versus "gone", so every omission above is asserted **together with the aggregate that must still include the person**.

## The two implementation conditions

- **Settings is an ordinary working row in You's content.** Visible, hit-tested with `elementFromPoint` so an overlay would be caught, below the page heading rather than mounted as chrome, **no gear control anywhere on You**, and both destinations are real screens: `/settings` renders, and `/settings/privacy` renders from it. Not a dead utility.
- **`firestore.rules` has no diff** — confirmed by `git diff`, as above.

## One latent config gap — recorded, not a user-visible defect

`firebase.westayfit.json` gained the `/community/*/members` rewrite; **`firebase.westayfit.emulators.json` did not**, and that file's own comment is explicit: *"hosting mirrors firebase.westayfit.json exactly… Keep the two in sync: if a rewrite or header changes there, change it here, or the harness stops testing what actually ships."*

Proven at the byte level: a cold `GET /community/<id>/members` on the emulator returns the **community** page (`__dynamic.html`, md5 `f620fec7…`), not the members page (`members.html`, md5 `e8a0c8c4…`), because the request falls through to the `/community/**` catch-all.

**But the rendered behaviour is correct**: a cold browser load of that route **does** render `wsf-members-screen`, because the SPA bundle resolves the path on hydration. So this is **not a user-visible defect today** and nothing is broken. What it costs is the harness's ability to test the rewrite that actually ships — exactly what the config's own rule exists to prevent — and it would be silent if the fallback ever stopped covering the route. One line, in a file W8 already edits the twin of. Recorded for L0 to route; W7 takes no fix ownership.

## Also recorded

- **A deployment dependency, not a defect:** `firestore.indexes.json` gains a composite index (`wsfContributions`: `communityGroupId` ASC, `createdAt` DESC) that `wsfCommunityActivity` requires. The emulator does not enforce indexes, so the query passes locally with or without it and would fail in production until deployed. W8 says as much in the source. W7 runs no index or backend deployment.
- **Cross-lane dependency checked because it is mine:** W8 changed `app/community/[groupId]/index.tsx` by +213 lines, and that page is the destination W6's `Check community goals` recovery action depends on (check 4, `8067364`). #433 is not in this merge, so the action itself could not be exercised — but the dependency was: the community page **still reaches an existing goal** with a visible link. The recovery path's destination survives W8's changes.

## Bound

The named properties and the two implementation conditions at `60604ca` merged onto `d86620c`, in Chromium and at the callables on the emulators. **Not** a pixel or creative verdict (the Director's, via #442), not a full-app audit, not a re-run of W8's own suite, and nothing of W5's kiosk lane touched. No product edit, no frame captured or rebaselined, no rules / index / backend deployment. One failure in my own run was my own wrong assumption about the `wsfMyCommunities` response shape (`items`, not `communities`), corrected and recorded rather than quietly fixed. Findings route through L0 to **W8**.

---

# Check 6 — the W6 + W8 cross-lane proof, and two answers L0 asked for

L0's `5789119272` crossed with check 5. It made two points, both answered here on evidence rather than argument.

## 1 · "Without #433 in the tree, that proof tells us nothing about W6 + W8 together" — correct, and now done properly

Check 5 said plainly that #433 was not in the merge and that only the *dependency* had been checked, not the action. L0 is right that this is the weaker claim. So the real one was run: **W6's `f332559` and W8's `60604ca` merged together onto app-shell `d86620c`**, on a throwaway local branch that was never pushed and was deleted afterwards.

| | |
|---|---|
| W6 revision | **`f332559d7febc8bef5ff3d75216588d251cff5b8`** — the colour successor of `8067364`, which is now #433's head |
| W8 revision | **`60604ca54490cb39b21bd7a4fb9b3396153cc5b9`** |
| Base | app-shell **`d86620c`** |
| Blob proof on the combined tree | `app/goals/new.tsx` = `f332559`'s `e33b0614…`; `community/[groupId]/index.tsx`, `src/ui/CommunityPresence.tsx`, `functions-westayfit/src/index.ts` = `60604ca`'s — all four confirmed |

**Result: 21 passed / 0 failed** — check 4's seven recovery cases and check 5's fourteen social cases, together on one tree.

The case that matters is check 4's condition 4, which now runs end to end across both lanes: after a genuine commit-with-lost-response, **`Check community goals` is visible, hit-testable, clicked, and reaches the created goal on W8's *changed* community page, with the server still holding exactly one goal and no further create call.** W6's recovery path and W8's community rewrite work together.

**And check 4 is re-pinned.** My PASS was reported on `8067364`; #433's head is now `f332559`. That diff is colour-only in substance — same testids, labels, behaviour and 54px hit target — but it swaps `kit.primaryButton` for a route-local `ACTION_GREEN` style on three primaries, **one of which is `Check community goals` itself**. A restyled control is exactly what can move a box or let something cover it, so the hit test was re-run rather than assumed to carry. It holds at `f332559`.

## 2 · "Say how W8's members-page cases reached the route if the rewrite is missing"

They reach it normally, and the missing rewrite does not stop them. `/community/__dynamic.html` and `/community/__dynamic/members.html` are **the same SPA bundle**; expo-router resolves the real path from `window.location` on hydration. So a cold load served by the emulator's `/community/**` catch-all still renders the members screen — which is what my own behaviour test asserts and what it found.

That is why check 5 recorded the parity gap as **latent rather than a live defect**: the bytes differ (`f620fec7…` served, `e8a0c8c4…` expected), the rendered outcome does not. W8's 4/4 is therefore a real pass, not an artefact. What the gap costs is that the emulator never exercises the rewrite that ships, so the day the SPA fallback stops covering that path, the harness would not say so — which is the failure mode the config's own comment exists to prevent. Still W8's to fix if L0 routes it; W7 takes no fix ownership and changed nothing.

---

# Check 7 — the focused DOM delta on W8's final successor **`bfc422a`**: **PASS**

Routed by L0 at `5789806629` (Director §D `5789105772`, §1 `5789388729`). Acknowledged at `5789851037` before execution. Spec: `apps/westayfit/tests-e2e/sprint-w7-social-delta-verify.spec.ts` — **9 passed / 0 failed**, plus a mutation run.

## Identity and scope — every claim in the packet re-derived, not taken on report

| | |
|---|---|
| `claude/wsf-social-community` head | **`bfc422a02c4ae520542dfed7dfb06488ce530e0b`** — the pinned SHA, unchanged throughout |
| Base | app-shell **`d86620c`**, unmoved since check 5 |
| How | `bfc422a` merged `--no-commit` onto the W7 branch, **never pushed, aborted afterwards**; the five product blobs re-verified in the worktree first |
| The four rendering blobs | `community/[groupId]/index.tsx` **`b090c30d`**, `members.tsx` **`829795d0`**, `settings/privacy.tsx` **`5284e86e`**, `CommunityPresence.tsx` **`8f168db0`** — matching the packet |
| **Backend delta, checked my own way** | `git diff 60604ca bfc422a -- functions-westayfit/` is one file, **+21 / −6**, and filtering out comments and blanks leaves **nothing**. The F2 comment alone; no executable line moved |
| The no-diff list | `firestore.rules`, both firebase configs, `firestore.indexes.json` and W9's four shell files — **all eight unchanged** since `60604ca` |

The privacy contract is **not** reopened: the 14/14 at `60604ca` stands as the Director's functional acceptance.

## 1 · Zero separated from null — proven positively, in three states

| Fixture | Rendered |
|---|---|
| Live goal, resolvable zone, window covering now, **no contributions** | **`0 people moved today`** |
| Goal whose **stored zone cannot be resolved** | **no line at all** |
| One mover | `1 person moved today` |
| Two movers | `2 people moved today` |

## 2 · The mutation, run rather than trusted

The packet asked me to try the mutation myself instead of accepting that it had been tried. I did, on the merged worktree:

```
{momentum !== null && momentum.contributorsToday !== null ? (
→ {momentum !== null && momentum.contributorsToday !== null && momentum.contributorsToday > 0 ? (
```

Rebuilt, then re-ran the four count cases:

```
✘ a proven zero renders "0 people moved today"
    Error: a proven zero was suppressed — "known zero" collapsed into "unknown"
    Expected: "0 people moved today" … element(s) not found
✓ an unresolvable zone renders no moved-today line at all
✓ one mover renders in the singular
✓ two movers render in the plural
1 failed, 3 passed
```

**Exactly the specified signature: the mutant kills the zero case and leaves the null case green.** So the two states are genuinely distinguished by the assertion, not merely co-passing. The source was then restored and the blob re-verified — `b090c30d…` before the mutation and `b090c30d…` after, identical to `bfc422a`'s — and the full file re-run **9/9** on the restored build.

## 3 · Community — the corrections, measured the way the failure demands

W8's own report says its fold guard reported safety three times when there was none: it measured against 844 rather than the floating tab bar, it ran in a bare browser context while the evidence was shot on an emulated phone, and its fixture was the easy case. So this file runs as an **emulated iPhone** (390×844, iPhone UA, `isMobile`, touch, DPR 3), seeds the **hard** fixture — six members, presence, a moved-today line and a real feed — and measures the first row against **the tab bar's own box**.

- `6 members` on the primary surface, and **no privacy clause anywhere in the page text**.
- Both counts **above the goal hero**, and **not merged**: member count above, moved-today below it, hero below both.
- **The first momentum row's bottom is at or above the tab bar's top**, and the row is independently hit-tested so "above the bar" cannot pass for something covered.
- `Start moving` is full width (>80% of 390) and hit-testable.
- `Anonymous member` for name-private-with-activity-visible; **no row at all** for activity-private; the visible mover still named; the old `A member` copy gone.

## 4 · Members, and Settings / Privacy

- Heading **`Members`**; `6 members`; **no** privacy clause; **no** `Your visibility here · Settings` row; rows present and the quiet empty state **absent** while anyone is listed.
- With **every** member private: the one quiet explanation appears, no rows — and the count still reads `6 members`, because everyone is hidden and nobody is gone.
- Settings → `/settings` → `/settings/privacy` all reachable and hit-tested; the community's block renders with both switches; the note reads *"Your activity appears as “Anonymous member.”"*

One correction owned: my first cut expected that note unconditionally and failed. It is **conditional by design** — it renders only for name-private **with** activity-visible, the one state that actually produces an anonymous row — so the fixture was wrong, not the product. Two other failures in my run were also mine: a second `signInVia` in one test that never reaches `/signin` while already signed in, and a read taken before the privacy screen had loaded — the same class of race W8 found in its own guard.

## Bound

The four changed rendering files at `bfc422a` merged onto `d86620c`, on an emulated iPhone against the emulators. **No pixel verdict** — the Director's, from #442, including W8's own open question about the Living WE at 152. No product edit is carried: the mutation was a local, never-committed experiment whose restoration is proven by blob hash. **Not in this packet:** the cold direct Members load, which waits on L0's mirrored `/community/*/members` line landing on the integration candidate. Findings route through L0 to W8.

---

# Check 8 — the cold direct Members load on integration candidate **`9a65324`**: **PASS**

Routed by L0 at `5790010909` (the Director's named proof, `5789966395` §W8). Acknowledged at `5790314486`. Spec: `apps/westayfit/tests-e2e/sprint-w7-members-route-parity.spec.ts` — **4 passed / 0 failed**.

## The candidate, re-derived

`claude/wsf-app-shell` **`d86620c` → `9a65324c3a2e0c1ce0acecb831a55ce49f8d5ea0`**, and the four commits are what the packet says: `2fffcf3` = #433 (W6 `e0546b3`), `3e6a86b` = #441 (W8 `bfc422a`), **`1041a1f` = the one-line mirror**, `9a65324` = the bottom-tabs dependency. Both revisions I verified independently are now in the base. The mirror's diff places `/community/*/members` **between `*/challenge` and the `/community/**` catch-all** — read from the diff, which is the ordering the fix requires.

## The two hosting configs are now identical

Compared as parsed JSON rather than by eye: **12 rewrites each, lists equal**.

## The bytes — measured on the same scale as the original finding

| Cold request | Served | Expected |
|---|---|---|
| `/community/<id>/members` | `cabeeb0e…` | **= `members.html`** (`cabeeb0e…`), **≠ fallback** (`3db13b84…`) |
| `/community/<id>/challenge` | `7a4e71e9…` | = `challenge.html` — unshadowed by the new line |
| `/community/<id>` | `3db13b84…` | = the catch-all, as before |

The build emits `apps/westayfit/dist/community/__dynamic/members.html`.

**One correction to my own ACK:** I said I would expect the literal `e8a0c8c4…` from check 5. That was wrong to promise — the bundle was rebuilt at a new head, so the file's hash legitimately differs. What carries across is the **identity relation**, not the literal digest: the served bytes now equal `members.html` and differ from the fallback, which is exactly the comparison that exposed the gap.

## The browser half — including the part bytes cannot see

A rewrite is a routing change, not an authorization change, so "the route resolves" must not become "the route resolves for anybody":

- **member, cold direct load** → `wsf-members-screen` renders at the right path, the panel loads, `3 members`, all three names present;
- **non-member, same cold URL** → refused (`wsf-members-failed`), **no panel, no rows, and none of the three names or the community name anywhere in the page**;
- **signed out, same cold URL** → no panel, no rows, no names;
- **the community page itself still loads cold**, unshadowed by the new rewrite.

## What this does and does not establish

It establishes that the harness now exercises the rewrite that actually ships. It does **not** retroactively make the earlier gap user-visible — check 5 found hydration masked it, and that finding stands as recorded.

---

# Check 9 — the check-2 spec updated for #433, now in the base: **7 passed / 0 failed**

Routed at `5790010909`. `apps/westayfit/tests-e2e/sprint-w7-goal-setup-contract.spec.ts` asserted pre-#433 copy in the three places named at `5788654782`. Against `9a65324` it gave **4 passed / 3 failed**, each failure exactly one of those three. Updated, it is **7/7**.

**What changed, and nothing else:**

1. `LOST_MESSAGE` — `"Something went wrong. Please try again."` → `"It may have been created anyway. Starting another one could create a duplicate."`
2. the refusal copy — now including `"The server refused this request, so no goal was created."`
3. **one behaviour assertion, named separately because it is not copy:** the terminal refusal now **removes** the submit control instead of re-enabling it, so `toBeEnabled()` became `toHaveCount(0)` plus a check that the `Back to community` link is there. This is the fourth place, beyond the three I had named — reported rather than folded in silently, because it is a behaviour change I verified as correct and deliberate in check 4, not a copy edit.

**What deliberately did not change:** every request count, every `runQuery` server read and every server-state assertion. The diff touches exactly one assertion line. The four cases that already passed are the server-side contract — normal success, the retry producing a second goal, duplicate-submit protection, confirmed-then-lost — and the point of this file is that it proves the contract rather than agreeing with the screen. Relaxing those to make the copy fit would have destroyed the only thing it is for.

The header now records the history rather than erasing it: the old sentence, why it was the defect, and the fact that the *shape* of the finding is unchanged — the client still cannot distinguish the two lost cases, and the file still proves it by asserting the identical sentence against different server state.

## The whole W7 suite on the integrated base

`sprint-w7-*` — **61 passed / 0 failed** on `9a65324`: every check delivered in this sprint still holds on the integrated tree.

---

# Check 10 — W4's `/start-community` implementation (PR #447) at **`0901765`**: **PASS**, no defect found

Routed by L0 at `5795497510`. Acknowledged at `5795864184`. Spec: `apps/westayfit/tests-e2e/sprint-w7-start-community-verify.spec.ts` — **15 passed / 0 failed**, plus W4's own suites re-run.

## Identity, re-derived

| | |
|---|---|
| #447 head | **`0901765af0f23f654a12baa8bc016ff3ee4be810`**, unchanged throughout |
| Parent | `de8f567` (#432's head, already in app-shell) |
| Diff | **23 files, +1,347 / −33**; the non-image set is exactly the five files the packet names — `git diff --name-only` shows **nothing outside it** |
| Base | app-shell **`37367fd`**, merged locally and **never pushed** |
| Blobs | `app/start-community.tsx` `b30b5d65`, `src/startCommunityOutcome.ts` `a6df3de7` — both identical to `0901765` in the worktree |

## The eleven items

| # | Item | Result |
|---|---|---|
| 1 | Outcome classification | **PASS** |
| 2 | Response lost | **PASS** |
| 3 | Unconfirmed screen | **PASS** |
| 4 | Named refusal (profile) | **PASS** |
| 5 | Name window 2–80 | **PASS** |
| 6 | Two taps in one frame | **PASS** |
| 7 | Created ≠ navigated | **PASS in the reachable half**; W4's "cannot be staged in a browser" **CONFIRMED** |
| 8 | Unmount mid-flight | **PASS**, with one precise correction to the premise |
| 9 | Frames | **PASS**, byte-identity verified against #426 itself |
| 10 | Counts | **PASS**, every number reconciled |
| 11 | Shell seam | **MEASURED**, no verdict offered |

### 1 · Classification

**All seven transport codes** — `internal`, `unavailable`, `deadline-exceeded`, `unknown`, `cancelled`, `aborted`, `data-loss` — read as **unconfirmed**, each exercised separately rather than by a representative. **All four reachable named refusals** render their own copy. `callableErrors.ts` is **byte-identical** (`70b1908f` both sides).

The developer-text rule is proven positively: every fixture answers with the marker `DEV-ONLY-LEAK-MARKER-9f3a` in the callable's `message`, and it appears nowhere on any screen. A route that echoed the server's text would fail every one of these eleven cases.

### 2 · Response lost

`route.fetch()` then `route.abort()`: the server replied **200**, the reply was discarded, and the community was **read back out of Firestore** — exactly one, with the reply naming that same `groupId`. Attempted 1 / delivered 1. The screen says it cannot confirm and claims nothing in either direction.

### 3 · The unconfirmed screen

`Check your communities` → **`/?view=communities`**, asserted as the exact href — the seam W7 verified for W4 in check 1, not bare `/`. The retry is demoted to `Start another community` with the duplicate risk **beside the control**. Pressing it makes a **genuine second community**: two distinct ids, one name, attempted 2 / delivered 2.

### 4 · The profile refusal

Nothing created; the create control is **gone, not disabled**; the action leads to `/profile-setup`; and the screen promises **no return trip and no saved draft** — asserted against `/come back|return here|saved|draft/i`, because promising a return that does not exist is the failure mode here.

### 5 · The name window

A one-character name and an 84-character name **never leave the browser** — attempted **0**, delivered **0**. Focus lands on the field both times, and the long message carries the count: *"Use 80 characters or fewer. This name is 84."*

### 6 · Two taps in one frame

Dispatched as **two clicks in a single JS task**, not two sequential Playwright clicks — the latter would be stopped by the disabled state and would prove nothing about the ref guard, which exists precisely because `submitting` lands a tick late. With the create held open 1.5 s: **one delivered request, one community**.

### 7 · Created ≠ navigated

The reachable half passes: a 200 carrying an id the route cannot navigate to (`not/usable`) reads as **unconfirmed, not refused** — the community very likely exists, so the honest next step is the list rather than a broken button.

**W4's "cannot be staged in a browser" is CONFIRMED, from my own measurement rather than from the report.** Breaking the history write unmounts the screen anyway, so the created-but-not-opened state has no browser-reachable rendering. I record that as confirmed rather than merely repeated — it was a claim I was asked to confirm or refute, and refuting it was a live possibility.

### 8 · Unmount mid-flight — and a correction to the premise

The property holds: **nothing of the outcome is painted on the replacing page**, the body carries none of the outcome text, and the member ends on `/community/<id>`.

But the premise in the item's name is not what happens, and it matters. **Expo Router RETAINS the previous screen rather than unmounting it.** Measured directly: after leaving, `wsf-start-created` is **present in the document (count 1) and not visible (`isVisible() === false`)**, and `wsf-start` is likewise retained. So the settled create *does* write its outcome — onto a screen that is no longer displayed.

The consequence for the review: the property is satisfied **by non-visibility, not by the `alive` guard**, because on this navigation the screen was never unmounted for that guard to catch. The guard is still right to exist for real unmounts; it simply is not what is doing the work here. My first assertion demanded absence from the DOM and failed — **my error, not the product's** — and asserting absence would have failed on a route behaving correctly.

### 9 · Frames

**Byte-identity verified against #426 itself, not against the stated hashes.** `sprint-w4-start-community-next` was fetched read-only and the BEFORE arrival frames compared directly:

| class | #426 BEFORE | candidate AFTER | |
|---|---|---|---|
| 390×640 | `7d216e4a37830fb4` | `7d216e4a37830fb4` | **identical** |
| 390×844 | `a0f0f51eedbc1a4c` | `a0f0f51eedbc1a4c` | **identical** |

The packet quoted those two digests; confirming a file matches a number someone supplied is weaker than confirming it matches the other file, so the other file was fetched.

**The AFTER producer ungated writes zero bytes**: run without `WSF_CAPTURE_FRAMES`, 6 passed, and the sha256-of-sha256s over all 18 frames is **unchanged**. `check-evidence-intact` exit 0 — 9 frozen, 20 accepted, no byte changed. No `tests-e2e/artifacts` or `test-results` committed.

### 10 · Counts — every number reconciled

| Run | W4 | W7 |
|---|---|---|
| outcomes spec | 9/9 | **9/9** |
| unit suite | 28 | **28/28** |
| whole vitest | 823/823 | **838/838** |
| seven-spec regression set | 31/31 | **31/31** |

**The vitest difference is fully explained and is not a discrepancy in W4's claim** — the two numbers are measured on different trees, and the arithmetic closes exactly:

- `kiosk-idle-finish.test.ts` is **absent at `de8f567`** and present on app-shell: **+10**
- `exported-head.test.ts` grew **+2** between `de8f567` and `37367fd`
- `kiosk-session.test.ts` grew **+3**

**823 + 10 + 2 + 3 = 838.** W4's count is right for its tree; mine is right for the merged tree.

**One honest note on the regression set.** Its **first** run gave **30 passed / 1 failed** (`expect(locator).toBeVisible()`); two further runs gave **31/31**, the second with exit 0. I did not capture which test failed, because that first command filtered the output — so it is reported as a **non-reproducing failure I could not attribute**, not smoothed into a clean pass. It did not recur.

### 11 · The shell seam — measured exactly, no verdict

W4 asserts the member tab bar on `/start-community`; under W9's migrated shell that route is a focused **barless** flow. Exactly what depends on the bar:

- **One assertion in the behaviour suite** — `sprint-w4-start-community-outcomes.spec.ts:399`, inside the test *"the member tabs remain, and the submit is hit-testable on a short phone"* (line 389).
- **One assertion in the capture producer** — `sprint-w4-start-community-after-capture.spec.ts:111`. It sits in the per-class body **before the first `saveFrame`**, so it gates **every frame of that class** — and therefore **all 18 AFTER frames**, not only the arrival ones.
- **A consequence worth stating, because it is easy to miss:** the two arrival frames are W4's evidence that the header and hierarchy did not move, and that evidence rests on byte-identity with #426's BEFORE. A barless shell necessarily changes those bytes, so the sequencing decision also decides whether that particular proof survives in its current form.

The sequencing is the Director's. W7 offers no opinion on it and changed neither lane.

## Bound

The eleven items at `0901765` merged onto `37367fd`, in Chromium on the emulators. Verification only: **no product edit, no edit to any W4 test, no capture written, no target called an AFTER.** Findings route through L0 to W4.

---

# Check 11 — the bounded colour delta on `/start-community` at `d467754`

**Packet 12** — L0 `5796309092`, relayed `5796353584`, on the Director's `5796296396`.
ACK `5796687337`. Discrimination head `0901765` (the accepted functional gate,
`5796186487`). **PASS**, with one item recorded as MEASURED rather than passed,
because it falls outside what the packet routed.

New spec: `apps/westayfit/tests-e2e/sprint-w7-start-community-color-delta.spec.ts`.

## 11.1 · The SHA, and L0's claims re-derived

`d467754` was the **live head** of `claude/wsf-sprint-w4-start-community-impl`
at ACK time, not a stale reference — `git fetch` moved `0901765..d467754`.
Checked out detached; product blob verified both ways:

| | |
|---|---|
| `git rev-parse d467754:apps/westayfit/app/start-community.tsx` | `08745e67…` |
| `git hash-object apps/westayfit/app/start-community.tsx` | `08745e67…` |

One commit, 20 files. Every claim in the routing re-derived with git rather
than taken on report:

| Claim | Evidence | Result |
|---|---|---|
| shared kit untouched | `src/ui/kit.ts` absent from `--name-status` | holds; `kit.primaryButton` still `backgroundColor: PROGRESS_GREEN` |
| `SubmitButton` unchanged | `src/AuthFormPrimitives.tsx` absent | holds |
| callables untouched | no `functions-westayfit/` path | holds |
| BEFORE / TARGET untouched | no `BEFORE-*` or `TARGET-*` path at all | holds |
| four route controls | `style`/`textStyle` changed on exactly four `ButtonLink`s | four |
| six gate frames | six **added** `AFTER-start-gate-*` PNGs | six |
| retry tertiary | `variant={… 'tertiary' : 'primary'}`, **unchanged** from `0901765` | a carry-forward invariant, gated as one |

Eleven previously-committed `AFTER-start-*` frames are **modified**. They live
under `docs/design-target/review/start-community-next/after/`, which is in
**neither** list in `check-evidence-intact.mjs` — W4 re-shooting its own
in-flight evidence, not a rewrite of accepted evidence. Worth stating plainly:
that guard diffs the working tree against `HEAD`, so it gates **runs**, never a
deliberate committed re-baseline. Guard at every checkpoint of this check: **9
frozen / 20 accepted, no byte changed.**

## 11.2 · Why this is a render test

The diff says the four links take a local `action.primary` carrying
`ACTION_GREEN`. That is a statement about source, not about pixels. On web,
`Link asChild` merges the child's style by **object spread**, so an array style
silently becomes `{0: …, 1: …}` and paints nothing — `ButtonLink`'s own comment
records that exact failure. So every assertion reads `getComputedStyle` off the
element a member would press, plus `opacity`, because `#22C55E` at 0.6 reports
`rgb(34, 197, 94)` while painting something else.

And the wrong green is **named**, not merely excluded. The defect was never "no
green"; it was the **progress** green (`#91CB7D`, for a reported number) on an
**action**. A test that accepted "some green" would have passed on the broken
head.

## 11.3 · Result, and the discrimination that makes it mean something

| Group | `d467754` | `0901765` |
|---|---|---|
| **NEW** — 6 tests | **6/6 pass** | **6/6 fail** |
| **PRESERVED** — 3 tests | **3/3 pass** | **3/3 pass** |
| | **9 passed** | **6 failed, 3 passed** |

Every NEW failure on the base head is the defect itself, not a timeout or a
missing element:

```
Error: wsf-start-signed-out-signin is not action green
  Expected: "rgb(34, 197, 94)"
  Received: "rgb(145, 203, 125)"
```

— identically for `wsf-start-unverified-verify`, `wsf-start-profile` and
`wsf-start-check-communities`. No NEW assertion can pass vacuously.

**The four controls, each in the state that renders it:**

| control | state reached | fill | ink | href |
|---|---|---|---|---|
| `wsf-start-signed-out-signin` | signed out | `rgb(34, 197, 94)` | `rgb(4, 38, 15)` | `/signin` |
| `wsf-start-unverified-verify` | a real **unverified** account | `rgb(34, 197, 94)` | `rgb(4, 38, 15)` | `/verify-email` |
| `wsf-start-profile` | `failed-precondition` refusal | `rgb(34, 197, 94)` | `rgb(4, 38, 15)` | `/profile-setup` |
| `wsf-start-check-communities` | `internal` → unconfirmed | `rgb(34, 197, 94)` | `rgb(4, 38, 15)` | `/?view=communities` |

Each at full opacity, each ≥52 px tall, each still a **link** with its real
destination — a repainted control that had lost its href would pass a colour
test and strand a member.

**The census.** The screen is swept rather than sampled: nothing anywhere on
the page — app shell included — still **fills** with the progress green, and
inside `wsf-start` the action green appears on exactly one control and no
other. The first version of this test swept the whole document and **failed**,
reporting a second action-green fill on `wsf-member-tab-move`. That was my
assertion's error, not W4's: the shell's raised MOVE action is a primary and is
correctly action green. It is now the sweep's **calibration** — a census that
found nothing would otherwise be indistinguishable from a census that did not
work.

**PRESERVED, true on both heads and therefore proving nothing on its own:**
`wsf-start-submit` is the same action green it already was; the retry in the
unconfirmed state is still the **tertiary** control (no fill, navy ink, 44 px
not 52) reading *Start another community* — a route that has just learned to
paint primaries green is exactly where a risky retry could acquire a fill by
accident; and one press still leaves **exactly one** community on the server,
read back by `runQuery`, with one delivered create and the navigation that
follows.

## 11.4 · The six gate frames, verified in their own pixels

Not "six files with the right names". Each PNG was decoded and its exact-RGB
regions located:

| frame | dimensions | action-green regions found |
|---|---|---|
| `AFTER-start-gate-signed-out-390x640` | 390×640 | 350×52 at (20,144) |
| `AFTER-start-gate-signed-out-390x844` | 390×844 | 350×52 at (20,341) |
| `AFTER-start-gate-signed-out-430x932` | 430×932 | 390×52 at (20,374) |
| `AFTER-start-gate-unverified-390x640` | 390×640 | 350×52 at (20,144) **+ 50×51 at (170,553)** |
| `AFTER-start-gate-unverified-390x844` | 390×844 | 350×52 at (20,312) **+ 50×51 at (170,757)** |
| `AFTER-start-gate-unverified-430x932` | 430×932 | 390×52 at (20,345) **+ 50×51 at (190,845)** |

**Progress-green pixel count in all six: zero.**

Three things fall out of that table that a filename check cannot give:

- Each frame's pixel dimensions match the viewport in its own name.
- The button widens by exactly 40 px between the 390 and 430 classes — the
  viewport difference, so the frames really are the classes they claim.
- The **unverified** frames carry a second green region the signed-out frames
  do not: a 50×51 disc, horizontally centred (170+25 = 195 = 390/2;
  190+25 = 215 = 430/2), low on the screen. That is the member shell's MOVE
  action, which a signed-in-but-unverified member has and a signed-out visitor
  does not. The two states are distinguishable **in the pixels**, so the
  signed-out/unverified labelling is confirmed rather than assumed.

## 11.5 · MEASURED, not a verdict: the delta is not colour only

Decoding the eleven re-shot frames on **both** heads puts a number on what
changed. The control keeps its width and its exact (x, y) — so nothing moved —
and is **two pixels shorter**:

| frame | `0901765` progress-green region | `d467754` action-green region |
|---|---|---|
| `AFTER-start-refused-profile-390x640` | 350 × **54** at (20,247) | 350 × **52** at (20,247) |
| `AFTER-start-refused-profile-390x844` | 350 × **54** at (20,418) | 350 × **52** at (20,418) |
| `AFTER-start-refused-profile-430x932` | 390 × **54** at (20,431) | 390 × **52** at (20,431) |
| `AFTER-start-unconfirmed-390x640` | 350 × **54** at (20,264) | 350 × **52** at (20,264) |
| `AFTER-start-unconfirmed-390x844` | 350 × **54** at (20,435) | 350 × **52** at (20,435) |
| `AFTER-start-unconfirmed-430x932` | 390 × **54** at (20,468) | 390 × **52** at (20,468) |

Across all eleven: **progress-green pixels 17 222 / 17 068 / 19 382 / 19 228 …
→ 0**, and the same block is action green instead. The four `-end` frames are
scrolled past the control, so they change little; `refused-profile-430x932-end`
catches it clipped at the viewport top, 390×42 on both heads.

Source agrees with the pixels. `kit.primaryButton` is `borderRadius: 14,
minHeight: 54` with **no** shadow; the new local `action.primary` is
`borderRadius: 16, minHeight: 52` **plus `elevation.action`** — a green drop
shadow the shared token has none of.

**This is coherent, not careless.** Those are `SubmitButton`'s own primary
values, so the four links did not acquire a second invented treatment; they
acquired the treatment *Create community* already had. A test now pins that
down: each of the four must match `wsf-start-submit` on fill, ink, height,
radius **and** box-shadow, read from the reference control at runtime rather
than from a constant.

But a 2 px height change, a 2 px radius change and a new shadow are **not
colour**, and the packet routed a colour delta. W7 measures it and says so;
whether it belongs inside this delta is the Director's call, not mine.

## 11.6 · Bound and hygiene

Nine tests, run on the emulators in Chromium at **both** heads, each head built
from its own source (`rm -rf dist` then a full `build:web`; both builds exit 0).
`ts:check` exit 0. `check-evidence-intact` exit 0 at every checkpoint — 9
frozen, 20 accepted, no byte changed. Artifacts and `test-results` cleaned after
each run; nothing from them committed. Verification only: **no product edit, no
edit to any W4 test, no capture written, no frame rebaselined.**

**Complete result logs retained** (L0 `5796198857`), not filtered tails:
`FINAL-d467754.log` (9 passed) and `FINAL-0901765.log` (6 failed, 3 passed)
with every failure's full error text. **No non-reproducing failure occurred in
this check.** The one failure that did occur — the unscoped census, §11.3 —
reproduced exactly, was mine, and was fixed rather than re-run.

**One thing noticed and deliberately not acted on.** The detached checkout at
`d467754` does **not** carry L0's `1041a1f` members-rewrite mirror in
`firebase.westayfit.emulators.json`; W4's branch predates it. It is irrelevant
to this check (no members route is involved, and the running emulator had
already read its config at start), but it is worth L0 knowing before that
branch is taken as a base.

---

# Check 12 — packet 10 FINAL: W9's migrated shell at `41f80f3`

**Packet 10 FINAL** — L0 `5797409315`, Director `5797396895`, W9 `5797354159`.
ACK `5797575130`. Verified on a **local merge of `41f80f3` with app-shell
`37367fd`, never pushed**. New spec:
`apps/westayfit/tests-e2e/sprint-w7-shell-successor-verify.spec.ts`.

**Verdict: PASS on all eight items, with two shortfalls named** — one missing
frame (item 7) and one flaky test in W9's own suite (item 8). Neither is a
product defect; both are W9's to close.

## 12.0 · Setup, re-derived

`41f80f3f76b0279e968976483afdebe8d0334bf6` was the **live head** of
`claude/wsf-app-shell-nav` at ACK time. `37367fd` is **not** an ancestor of it
— merge-base `740a763` — so L0's "local merge with `37367fd`" is a real merge
with content on both sides, not a fast-forward. It merged clean, taking two
files from the base side (`sprint-w6-goal-setup-after-capture.spec.ts` and a
README), and every product blob checked after the merge is byte-identical to
`41f80f3`. 38 commits, 120 files, 35 product files under `app/` and `src/`.

Backend, `firestore.rules`, both hosting configs and `package.json` are
**unchanged** against `37367fd`, and the `1041a1f` members-rewrite mirror is
present, so the running emulators were valid for this tree without restart.

## 12.1 · Results by item

| # | Item | Result |
|---|---|---|
| 1 | Manage / query delta | **PASS** — §12.2 |
| 2 | MOVE true focus sheet | **PASS** — §12.3, and confirmed in the frames' own pixels §12.6 |
| 3 | Members link ≥44px | **PASS**, and the 43 mutant run by W7 — §12.4 |
| 4 | Contribution / kiosk protections | **PASS 19/19**, proof shown non-vacuous — §12.5 |
| 5 | Shell invariants | **PASS** — §12.3 |
| 6 | Ordinary `build:web`, no tree deletion | **PASS** — exit 0 over a pre-existing 31-entry tree, zero error lines |
| 7 | Frames | **PASS on 12 of 13** — the Champion hamburger frame does not exist, §12.6 |
| 8 | Counts, separated | **PASS**, with one flaky test named — §12.7 |

Runs: **W9's own 22/22** first clean run. **Kiosk 19/19.** **Unit 821/821**
across 48 files — W9's number exactly. **W7's own spec 6/6**, twice
consecutively with identical measurements.

## 12.2 · Item 1 — the Manage and query delta

- **One sheet, not two.** `manageOpen` exists exactly once
  (`community/[groupId]/index.tsx:417`) and `wsf-community-manage-panel`
  exactly once (:2511). `memberShellActions.tsx` only calls back into the
  screen's own state. No second implementation.
- **The nineteen suites.** Commit `120887bf` touches 20 files: **18 existing
  spec files** mechanically updated, **1 new** spec, plus the new
  `helpers/memberShell.ts`. W9's "nineteen" counts the 19 `.spec.ts` files
  including the new one. Stated precisely rather than smoothed.
- **`INK_QUIET` → `TEXT_MUTED`, computed here rather than taken on report.**
  `INK_QUIET` `#6B7C93` on cream `#F7F5F0` is **3.91:1** — W9 said 3.9, and it
  fails AA's 4.5:1. `TEXT_MUTED` `#5A6B85` is **4.97:1**. Confirmed.
  **Chased, and it is not a shipping issue:** `INK_QUIET` survives on
  `slotNote` in `MemberTopBar` (11.5px on a CREAM sheet — the same failing
  3.91:1). But `slotNote` renders only for `kind: 'slot'`, and the shipping
  menu (`app/(tabs)/_layout.tsx`) is built from `action` and `link` only;
  `slot` appears solely in the gated `design-target/shell-next` prototype. The
  failing token never reaches a shipping surface.
- **The `tapInView` fix relaxes nothing — checked, not accepted.** A flake fix
  in a shared helper is exactly where an assertion quietly weakens. The patched
  helper still throws on `!found` and on `!inView`, and `elementState` computes
  `inView: inside && !covered`, so the uncovered check *is* enforced. The diff
  is 28 added lines and 1 removed; everything after the settle loop is
  untouched.
- **The `?groupId=` regression is narrow, not relaxed** — four explicit claims
  (exact pathname; `groupId` the only permitted param and only as a redundant
  copy; one community rendered and it is the one the path names; survives a
  cold load), with the reverted tidy-up recorded. Passes.

## 12.3 · Items 2 and 5 — measured with a harder instrument

Re-running another lane's suite measures whether their code agrees with their
tests. W7's own spec therefore asks what theirs does not:

- **Hit-testing, not presence.** "The bar is covered" and "the bar cannot be
  touched" are different claims, and only the second is the property a focus
  sheet exists to have. Every reachability claim goes through
  `document.elementFromPoint` at the control's own centre.
- **The Close is a control, exercised by clicking it** — never `page.goBack()`,
  which would prove the browser works rather than that the sheet has a way out.

Measured at `41f80f3`:

| Claim | Result |
|---|---|
| Close named, visible, ≥44×44, reachable at its own centre | holds, `aria-label="Close"` |
| All five tab controls unreachable while the sheet is open | holds — and each was reachable *before* it opened, so the claim is not vacuous |
| The tab underneath is the same instance (host-node mark survives) | holds |
| The sheet draws no top bar, tab bar, wordmark or hamburger of its own | holds |
| Close returns to the same instance at the same scroll | holds — Home planted **160** and returned **160** |
| From **You**, returns to `/you`, same instance, same scroll | holds — range **159px** at 360×480, planted and returned |
| Cold `/move` has a reachable Close that leads into the shell, not back to `/move` | holds |
| Reduced motion keeps the hierarchy | holds — scrim still `rgba(...)` with `0 < alpha < 1`, Close reachable, bar unreachable, tab alive |
| One top bar, one box, one wordmark on all four tabs | holds — identical x/y/w/h across Home, Community, Activity, You |
| Hamburger ≥44×44 wherever offered | holds |
| Settings is a utility entry | holds — a real `link` to `/settings`, not a slot |
| `move/[goalId].tsx` untouched | **blob-identical** to `37367fd`: `94e9cb6a…` |
| No obsolete `MEMBER_TAB_BAR_BODY + MEMBER_TAB_MOVE_OVERHANG` reservation in MOVE | holds — the import is gone; only a comment recording that it used to be there |

## 12.4 · Item 3 — the members link, and the 43 mutant W7 ran itself

Measured independently: **350×44**, matching W9's number. W7 also asked the
harder question in its own instrument — that the **top, middle and bottom** of
the box each belong to the pressable rather than to a padded ancestor. They do.

**The 43 mutant, run here rather than read from W9's report.** With
`minHeight` set to 43 the measurement reports `350x43` and fails:

```
Error: "See everyone in this community" is 43px tall, under the 44px floor
  Expected: >= 44
  Received:    43
```

Restored and re-verified blob-identical (`19ea8329…`).

**Recorded, not a finding:** at the arrival scroll the **bottom of the link is
covered by the raised MOVE control** — a hit test there returns
`wsf-member-tab-move`. W9's commit says it scrolls clear for this reason; W7
reproduces the observation first, so the reason for the scroll is evidence
rather than folklore, then does the same. The link is the right height; this is
a note about where the raised action sits.

## 12.5 · Item 4 — and the vacuity W1B warned about

**19/19**: `sprint-w1b-kiosk-confinement` **10**, `sprint-w1b-kiosk-idle-finish`
**9**. All nine idle-finish tests ran **by name**, including *"the probe itself
cannot mistake an unreadable auth store for an empty one"* — the one W1B said
matters most (`5791649248`). **The 8-of-9 short count does not recur here.**

W1B's concern (`5792637993`) was that the six-point proof can pass vacuously,
and on inspection the concern is well founded in shape: every one of the six
points is an **absence** assertion, and `MemberTabBar.tsx:123`'s own comment now
calls the kiosk predicate "DEFENCE IN DEPTH" because a route outside `(tabs)`
structurally cannot have a bar. A proof that passes because the defect is
unreachable is not the same as a proof that would notice.

**So it was made to fail.** First attempt was too coarse — turning the kiosk
flag off wholesale broke the fixture (`wsf-contribute-entry-screen resolved to 2
elements`) before the contract ran, which proves nothing and is reported as a
fixture failure, not a result. The surgical mutant — **one** member destination
injected into the very screen the proof runs on — makes it fail at **both**
classes including the 390×640 fixture, on the contract assertion itself:

```
Error: expect(locator).toHaveCount(expected) failed
  Expected: 0
  Received: 1
```

after a full 7.2s walk-up to the real screen. **The proof is non-vacuous.**
Product restored and verified blob-identical (`8f506c6b…`); the suite passes
again on the restored build.

## 12.6 · Item 7 — the frames, and the one that is missing

**The strip is present in every frame, by geometry.** All 12 route frames are
their device height **+18** (390×658 and 390×862), which is exactly the
`BANNER` the easel adds; the label text is asserted by W9's own spec.

**The MOVE pair proves the focus sheet in its own pixels.** Decoded and compared
against `cd5089b`, the head before the focus-sheet commit:

| | upper band, dominant colours |
|---|---|
| `cd5089b` | `rgb(11,31,58)` (opaque NAVY page) and white |
| `41f80f3` | `rgb(148,155,161)` and cream `rgb(247,245,240)` showing through |

`rgb(148,155,161)` is **exactly** `rgba(11,31,53,0.42)` composited over cream —
computed independently, matching to the last digit. The prior screen is legible
behind the scrim, and where the You card sits behind it the pixels read
`rgb(11,31,55)`, which is the same scrim over NAVY `#0B1F3A`. Row-profiling
shows the layout the source describes: full-bleed scrim, then a **bottom-
anchored cream sheet** (`maxHeight: '88%'`) reaching the viewport edge with
white cards inside it — **no reserved band** where the tab bar used to be.

**THE SHORTFALL.** L0's item 7 names
`MIGRATED-g-champion-menu-open-390x640.png`. It **does not exist** — not in the
successor directory, not anywhere in `docs/`, and `git log --all --diff-filter=A`
finds it was **never added in any branch**. W9's capture spec defines six scenes
`a`–`f` over two devices (12 frames) plus the contact sheet; there is no `g`
scene and nothing references that filename. The 13th file present is
`MIGRATED-contact-sheet.png`, not the Champion frame. `docs/design-target/review/champion-manage/`
is W8's earlier evidence and is unrelated.

## 12.7 · Item 8 — counts, kept apart

**Whole e2e: 404 tests — 359 passed, 4 failed, 41 skipped.** Reconciled exactly:
W9 reports 355 / 3 / 41, and W7's spec contributed **5** tests at the time of
that run (the sixth was added afterwards). 355 + 3 = 358 non-skipped; 358 + 5 =
**363** = 359 + 4. Skips match at **41**.

First-run failures, listed apart and each read rather than assumed:

| Test | First run | Serial rerun | What it is |
|---|---|---|---|
| `event-return.spec.ts:230` | fail (element not found) | **pass** (4.1s) | load-related, consistent with W9's "serial reruns passing" |
| W7 `from Home` | fail (Close covered) | **pass** | **mine** — I hit-tested mid-slide; fixed by settling the sheet's box |
| W7 `a cold /move` | fail | **pass** | same cause, same fix |
| `sprint-w9-shell-production.spec.ts:91` | fail (160 vs 218) | **fails again** | **flaky in W9's suite — see below** |

### The one W9 should look at

`sprint-w9-shell-production.spec.ts:91` fails on *"tapping the tab you are on
threw the scroll away"*, `Expected: 160  Received: 218`. It failed in the full
suite **and** on the serial rerun. Run alone and serially three more times it
gave **pass, pass, fail** — so across four serial attempts it failed twice.
**W9's "serial reruns passing" does not hold for this test here.**

**It is not a product defect, and W7 can show that.** My own first draft hit the
identical 160→218 signature, and the cause is the fixture, not the shell: the
scroll is planted as soon as Home's hero appears, but Home's presence and
activity reads land afterwards and the content grows by ~58px underneath the
planted offset. Waiting ~800ms for the page to settle before planting makes my
equivalent assertion pass every time, and W9's *other* production test — MOVE
opening over the tab and closing back onto it — passes throughout. The
behaviour the test is guarding is real and holds; the test will redden CI at
roughly one run in two until it settles the page before it measures.

## 12.8 · W7's own errors in this check, recorded

Four, all mine, all fixed rather than worked around:

1. **Hit-testing a moving sheet.** Passed in isolation, failed twice in the full
   parallel suite. The sheet slides; a hit test mid-travel reads coordinates the
   control has already left. Fixed by settling the sheet's box.
2. **A five-minute hang instead of a diagnosis.** `boundingBox()` waits for a
   re-attach, so a sheet that opened and went away burned the whole test
   timeout with nothing but "waiting for locator". Replaced with a direct
   geometry read that can report **ABSENT** and the page's URL — which is what
   produced finding 3.
3. **A fixture that asked the product the wrong question.** Six communities with
   none chosen made MOVE replace to Home, correctly: `app/move/index.tsx` says
   *"No community, or several with none chosen: Home already owns both of those
   questions."* My test waited for a sheet the product was right not to show.
   Fixed by having the member open a community first, as a member would.
4. **A scroll claim that was nearly vacuous.** `/you` does not overflow at
   390×844; it gave 10px at 390×640 and **none** once a community had been
   visited. Rather than condition the assertion away or drop it, the test moved
   to 360×480, where the range is a real **159px**, and prints the range it
   measured. The ancestor-only scroll walk (which W9's helper also uses) was
   also wrong here: You's scroller is a **descendant**, so the instrument now
   looks both ways.

## 12.9 · Bound and hygiene

Emulators only (`demo-wsf-local`), 49 callables. `ts:check` exit 0.
`check-evidence-intact` exit 0 at every checkpoint — **9 frozen / 20 accepted,
no byte changed**. Artifacts and `test-results` cleaned after every run and
nothing from them committed; the 37 artifact files under `tests-e2e/artifacts`
are pre-existing and identical at `37367fd` and `41f80f3`. Every mutant was
restored and re-verified **blob-identical** before the next measurement.
Verification only: **no product edit retained, no edit to any W9 or W1B test, no
capture written, no frame rebaselined, no target called an AFTER.**

**Complete result logs retained** per `5796198857`, unfiltered, including every
failure's full error text and the mutant runs.

**One mid-check environment failure, diagnosed once and not looped.** W9's suite
first reported 22/22 *failed* with `TypeError: fetch failed`. That was a harness
collapse, not a product result: the emulators had been reaped because I
launched them as `nohup … &` inside a background task, so the wrapper exited and
took the child with it. Restarted as the task's own foreground process; 49
callables loaded, an unauthenticated callable correctly returned 401, and the
re-run was 22/22 passed. The failed run is reported as what it was.

---

# Check 13 — packet 10 on W9's final review head `fca3326`

**Supersede** — L0 `5798259144`, pinned by `5798471416`. ACK `5799110819`.
Both routings landed **while check 12 was in flight**, so `5798509746` is a
report on the superseded head `41f80f3`; this check takes the new one.

**Verdict: PASS.** Both shortfalls named in check 12 are closed by the delta,
and the review points hold — with **one latent vacuity gap** recorded against
`settleScroll`, and **one state** (error) that W9 does not assert and W7 has
now covered.

## 13.1 · (d) Product identity, proved with tree hashes

A tree object hash covers every file and path beneath it, so this is stronger
than "no files differ":

| path | `41f80f3` | `fca3326` |
|---|---|---|
| `apps/westayfit/app` | `0bbf51b07e8f` | **identical** |
| `apps/westayfit/src` | `896a5bb5bb02` | **identical** |
| `functions-westayfit` | `0abf78552b20` | **identical** |
| `scripts/westayfit` | `dc4bd289a24e` | **identical** |

`firestore.rules`, both hosting configs, both `package.json`s, `app.json` and
`tsconfig.json`: identical. **So every product-side result in check 12 carries
forward on an unchanged product tree**, and nothing is reused across a head
whose product moved.

**The tip, re-derived:** `fca3326..75f6cbc` is
`docs/design-target/review/app-shell-next/README.md` **+15 / −10 and nothing
else**. Pinned to `fca3326` as routed.

**The delta:** `sprint-w9-shell-production.spec.ts` (+130),
`sprint-w9-shell-successor-capture.spec.ts` (+90), the README, seven re-shot
frames, and `MIGRATED-g-champion-menu-open-390x640.png` **added**. No app, src,
functions, config or scripts.

## 13.2 · (a) `settleScroll` — the one that mattered

`settleScroll` reads until two consecutive reads agree, and the planting is now
preceded by waiting for `wsf-community-hero-presence` — the page's **own**
enrichment, not an arbitrary value. That is the correct fix and it is the same
diagnosis W7 reached independently in check 12.

**Property 3 — a remount still fails — established by demonstration, not by
reading the helper.** A reload rebuilds every host node and resets every
scroller, so it is a remount by construction. W7 plants a mark and a real
offset, reloads, and measures both guards:

| guard | after a remount |
|---|---|
| host-node mark | **gone** (`markSurvives` false) |
| scroll offset | **0**, not the planted 160 |

Either alone fails the shipping proof, and `markSurvives` is asserted **before**
the scroll comparison in W9's test, so a remount cannot reach the comparison at
all. **A settled-scroll comparison cannot hide a remount here.**

**THE GAP, recorded.** `settleScroll` is used twice, and only one use guards
against a zero:

| line | assertion |
|---|---|
| 448 (`MOVE opens as a sheet…`) | `not.toBeNull()` **and** `toBeGreaterThan(40)` |
| 187 (`the active tab is a no-op…`) | `not.toBeNull()` **only** |

If Home ever settled at 0 — a shorter viewport, a lighter fixture, less content
— line 187's later `toBe(planted)` becomes `toBe(0)`, which a page that never
scrolled satisfies trivially. It is **latent**, not live: Home planted and
returned a real 160 in every run here. But it is exactly the vacuity the review
point asks about, and it is one line to close. W7's own equivalent asserts
`toBeGreaterThan(40)` for this reason.

## 13.3 · (b) and the flake, re-measured

The Close proof now presses the **named control** rather than `page.goBack()`,
in W9's file as well as W7's.

**The flake reported in check 12 is fixed.** `sprint-w9-shell-production.spec.ts`'s
active-tab test, which at `41f80f3` failed **2 of 4** serial attempts on
`Expected: 160  Received: 218`:

| head | serial runs | full parallel suite |
|---|---|---|
| `41f80f3` | **2 failures in 4** | failed |
| `fca3326` | **5 passed, 0 failed** | **passed** |

## 13.4 · (c) The sheet's other states

| state | asserted at `fca3326`? |
|---|---|
| chooser | yes, W9 |
| no-goal | **yes — new at `fca3326`**, with the scrim, a bounded panel and the Close each measured |
| loading | **no, and declined with a stated reason** — it exists only between the two reads that resolve it, so a test waiting for it would be timing a callable rather than photographing a screen. Reasonable. |
| error | **no — neither asserted nor explained. W7 covers it below.** |

**W7's error-state test.** The fault is installed **after** Home has loaded, on
purpose: my first version routed the callable before navigating and the test
failed with Home itself never rendering — `wsfMyCommunities` is the read Home
depends on too, so breaking it up front starves the very screen the sheet opens
over. With the context established and only MOVE's own read failing, the error
state is **the same sheet**: scrim present, panel bounded away from the top of
the viewport, Close ≥44×44 and reachable at its own centre, the tab bar
unreachable beneath it, and Close returning to the **same instance** of the tab.

**And a correction I own.** My first leak assertion used an opaque marker and
failed — I had to check whether that was a product defect, and it is not.
`src/callableErrors.ts` deliberately lets a **callable's own** `internal`
message through when it does not look like developer text, because such a
message often is a real member sentence; my marker was not developer-shaped, so
it passed through exactly as the documented rule says it should. The test now
uses a genuinely developer-shaped message
(`wsfMyCommunities failed: groupId must be a string`) and asserts the rule the
product actually states: the message is **suppressed**, the function name never
appears on screen, and the member is shown the transport sentence instead.

Worth noting the contrast with check 10: `/start-community` maps the **code and
never the message**, a stricter rule that route adopted because creating a
community is expensive to repeat. MOVE uses the shared, deliberately more
permissive helper. Both are consistent with their own stated contracts.

## 13.5 · The thirteenth frame

`MIGRATED-g-champion-menu-open-390x640.png` **exists** at **390×658** — device
height plus the 18px strip, matching the other twelve.

- Its producer creates a **second, Champion account**, opens the shell menu and
  **asserts** `wsf-member-topbar-menu-manage-community` and
  `wsf-member-topbar-menu-settings` are visible **before** shooting. Asserted,
  not merely photographed.
- Decoded against the plain Home frame of the same class, it differs on **144
  rows** between y=62 and y=558, so it is not a duplicate.
- In the region the menu sheet must occupy (`top: 52`, `right: 8`,
  `minWidth: 208` → x 174–382, y 72–300) it reads **74% CREAM with NAVY text
  pixels**; the plain Home frame reads 51% cream over varied content. The panel
  is there.

## 13.6 · (e) Counts, kept apart

| | `41f80f3` | `fca3326` |
|---|---|---|
| whole e2e | 404 — 359 / 4 / 41 | **408 — 366 / 1 / 41** |
| W9's own suite | 22/22 | **23/23** |
| unit | 821/821 | **821/821**, 48 files |
| W7's own spec | 6/6 | **8/8** |

**Reconciled exactly.** 404 + 1 (W9's new no-goal test) + 3 (W7's additions) =
**408**. Non-skipped: 363 + 4 = **367** = 366 + 1.

**The single first-run failure:** `sprint-w9-shell-capture.spec.ts:83` — the
**prototype** capture spec, not the shipping shell — timed out after 4.0m under
parallel load waiting for `wsf-shell-next-page-community` inside the stage
iframe. **Serial rerun: passed in 2.3s.** Load-related, matching W9's stated
pattern.

**Unmeasured, stated rather than implied:** the loading sheet state (declined,
with W9's reason accepted); and `settleScroll`'s zero-guard gap is recorded as
**latent**, since Home never settled at 0 in any run here.

## 13.7 · Bound and hygiene

Emulators only, 49 callables. Ordinary `build:web` exit 0 at this head.
`ts:check` exit 0. `check-evidence-intact` exit 0 at every checkpoint — **9
frozen / 20 accepted**. Artifacts and `test-results` cleaned; nothing committed.
Product tree verified **identical to `fca3326`** after every run. Verification
only: **no product edit retained, no edit to any W9 test, no capture written, no
frame rebaselined.** Complete result logs retained, unfiltered.

## 13.8 · After acceptance: the integrated head is the tree W7 tested

Check 13 was accepted as the functional gate (L0 `5799845823`) and W9's
`fca3326` was integrated into `claude/wsf-app-shell` as **`dd86721`**. Its two
parents are `37367fd` and `fca3326` — the same two parents as W7's local
verification merge (`2d85d265`, never pushed). So the question worth asking is
whether the integration resolved anything differently from the tree that was
actually tested. It did not:

| | root tree |
|---|---|
| `dd86721` (integrated) | `645c71e4326e` |
| `2d85d265` (W7's verification merge) | `645c71e4326e` |

**Identical root trees**, so every file and every path on the integrated base
is exactly what the check-13 runs exercised; `git diff --stat` between them is
empty. There is no gap between "verified" and "integrated".

## 13.9 · A correction to check 12, owned

Check 12 reported that `MIGRATED-g-champion-menu-open-390x640.png` was **"never
added in any branch"**, on the strength of `git log --all --diff-filter=A`. L0
corrected this (`5798577554`): the frame was added in `a52e9fd1` on
`claude/wsf-app-shell-nav`. The timestamps agree with L0 — `a52e9fd1` is dated
15:13Z, while W7's fetch at about 15:24Z still showed that branch at
`41f80f3`, so the commit reached the remote after W7's fetch. `--all` searches
only the refs a clone has fetched. The accurate claim was **"absent at
`41f80f3` and from every ref fetched as of ~15:24Z"**; stating it as a universal
without re-fetching first was my error. It did not change the check-12 verdict,
which was on `41f80f3` where the frame genuinely was absent, but the wording
overclaimed.

---

# Check 14 — pre-staging W4's barless `/start-community`: five seam findings, and a check that discriminates before the fix

**Not a verdict.** This is the pre-staging of W7's reserved check on W4's
barless recomposition of `/start-community` on the integrated shell (L0
`5799845823`). The findings were posted as they were measured:

| post | what |
|---|---|
| #434 `5800444443` | early warning: Q1, Q2, Q3 |
| #434 `5800531433` | Q3 corrected: pre-existing, not shell-introduced |
| #434 `5800875664` | round 2: M4, M5; Q1 numbers corrected; a check-10 weakness owned |
| #394 `5801188904` | the exact Q3 reproducer, for W4, on W4's own head |
| #434 `5801192836` | the reproducer on record; holding for the combined candidate |

Routing is L0's and the Director's (`5800515228`, `5800587063`,
`5800785846`): Q3 and Q1 to W4, Q2 to W9. M4 and M5 await a ruling.

## 14.1 · The builds, re-derived

W4's `d467754` does **not** sit on `37367fd`: its merge base with the shell
line is `de8f5677`. So "d467754 against dd86721" is not a single-variable
comparison, and every attribution below uses a clean pair built locally and
never pushed:

| build | what it is | root tree |
|---|---|---|
| `05d2aef9` | old shell: `d467754` ⊕ `37367fd` | — |
| `738d8710` | BEFORE: `d467754` ⊕ `dd86721` | `e5cfabd6` |
| `787c530` | W4's own merge of `dd86721` | `e5cfabd6` |
| `5c28e45` | W4's delivery (composition + Q1) | product delta vs `787c530`: **none** (specs and frames only) |

`05d2aef9` → `738d8710` differs, across app, src and package, by exactly
`37367fd` → `dd86721`, i.e. W9's shell and nothing else. **W4's head runs the
same app as my BEFORE build**, so the pre-staged measurements apply to it
unchanged, and the matrix in 14.7 was re-measured on `5c28e45` itself.

## 14.2 · The findings

| | finding | attribution | severity | owner (L0) |
|---|---|---|---|---|
| **Q3** | the first invalid press on Create is swallowed | pre-existing route pattern, already in `4ad05964` (the file's first commit in this history); the shell only made it certain at 390×844 | low | W4 |
| **Q2** | "Check your communities" loses `?view=communities` on the in-app click | shell-triggered: Expo Router's URL sync, on a root-Stack → `(tabs)` crossing | low–moderate | W9 |
| **Q1** | W4's `communityNames` reads one page, then filters in the client | W4 test harness only | test integrity: medium | W4 — **fixed at `5c28e45`** |
| **M4** | on the barless shell the unverified gate's only control is "Verify email" | shell-attributable (the bar was the other way out) | moderate | ruling pending |
| **M5** | leaving mid-create by "Back to home" pulls the member into the new community | pre-existing on both shells | moderate | ruling pending |

## 14.3 · Q3 — what is measured

**Mechanism.** With an invalid name in the field, pressing Create blurs the
field. `onBlur` sets `nameTouched`, and the error renders **above** the button
(`d467754:app/start-community.tsx:402, 407`). The button drops 52 px during the
press, the release lands on `wsf-start-summary`, and RN-web fires `onPress`
only from a native click on the Pressable, so `onSubmit` never runs.

**Scroll anchoring works on both shells.** Chrome anchors on the first
visible node in DOM order, which sits above the error's insertion point, so it
applies no compensation. At 390×844 max scroll that node is the name field:
excluding the field from anchor selection makes the same press submit
(measured on `dd86721`, at max scroll at 390×844: `scrollTop` 387 → 439
during the hold, the button stays at 712, and the press submits).
My first account ("the shell suppresses anchoring") was wrong, and I corrected
it publicly in `5800531433`.

**What the shell changed.** Removing the bar grows the scroller at 390×844 from
768 to 844 px. At max `scrollTop` 387 the field is then still at −11..39, so
**every** pressable position swallows. On the old shell it depended on
position. On `37367fd` (bar present), `scrollTop` 374 and 394 swallowed
(pointer verified on the button, field partly visible), and positions with the
field fully off screen submitted.

**On W4's head `5c28e45`**, with a fresh page per press and the pointer
verified on the button:

| class | pressable `scrollTop` (field y) | mouse 5 | mouse 120 | touch 80 | touch 150 |
|---|---|---|---|---|---|
| 390×844 | 327 (49..99) · 347 · 367 · 387 (−11..39) | swallowed 4/4 | swallowed 4/4 | swallowed 4/4 | swallowed 4/4 |
| 430×932 | 252 (157..207) · 272 · 292 · 312 (97..147) | swallowed 4/4 | swallowed 4/4 | swallowed 4/4 | swallowed 4/4 |
| 390×640 | 310 (−134..−84) · 330 · 350 · 370 | submitted 4/4 | submitted 4/4 | submitted 4/4 | submitted 4/4 |

**The state at release:**

- **Mouse, 120 ms.** The pointer is over `wsf-start-summary` at the end of the hold.
- **Touch.** The element under the finger at the end of the hold is still `wsf-start-submit`, so the displacement comes after the lift, and the press is swallowed all the same. It is the same blur-driven reveal: cancelling the default of `mousedown` (for a touch, the compatibility `mousedown` after the lift) keeps the field focused and makes the touch press submit (14.7, SEAM-1 CONTROL).
- **After a swallowed press,** focus stays on `wsf-start-submit`, the field gets no `focus()` call, and the error *is* on screen. Blur alone shows it, which is why a blur-only assertion cannot see this defect.

**390×640 cannot fail first.** At every position where the whole button is on
screen, the field's bottom is at y ≤ −84, so the risky condition does not exist
at that class. W4's non-reproduction at 390×640 (`5800735927`) is therefore
correct and consistent with this finding. In the pre-staged spec that class is a
regression guard only.

**CANNOT-MEASURE:** WebKit / iOS Safari. Only Chromium is installed, and WebKit
has no scroll anchoring, so the old build's behaviour there is unknown.

## 14.4 · Q2 — what is measured

On the clean pair, reached in-app from Home and brought to the unconfirmed state
by a lost response:

| | history on the click | after a reload |
|---|---|---|
| `05d2aef9` (old shell) | `pushState /?view=communities` | kept; list shown |
| `738d8710` (shell) | `pushState /` | a member with a remembered older community lands **inside that older community** |

It is one defect: the click drops the query. The reload is its consequence,
because a bare `/` opens the remembered community by design. W4's own
measurement (`5800735927`) agrees once the two reloads are told apart: a reload
of a *directly loaded* `/?view=communities` keeps the list, and so does the
served cold-load contract (check 1, 7/7 on `dd86721`).

The root cause is reasoned from source, not observed. Expo Router 6.0.24's URL
sync serializes the raw emitted state, and after a crossing from the root Stack
into the not-yet-mounted `(tabs)` the query sits only in nested params, so it
never reaches the URL. It is the same rule as W9's documented `?groupId=` seam,
with the opposite effect.

## 14.5 · Q1 — what is measured

`GET …/documents/wsfCommunityGroups?pageSize=300` on the emulator returns
**150** documents with a `nextPageToken`, in `__name__` ascending order. The
collection held 918 at 18:30:07Z; an earlier "878" was never saved and is
withdrawn. Each target existed once per run. The page-1 hit counts (1, 2, 2)
equal the observed pass counts of W4's `:135`, `:176` and `:318` (1/5, 2/5,
2/5).

Worse than the false FAILs are the false PASSes: `:247 toHaveLength(0)` and
the exact-count checks at `:224`, `:318` and `:369` cannot see a document
beyond page 1. **W4 fixed the helper at `5c28e45`** with a server-side
`runQuery` on `createdByUserId` (`5800735927` B). I have not yet independently
verified that fix; it is part of the combined-candidate check.

## 14.6 · M4, M5, and a weakness in my own check 10

**M4.** The unverified gate's reachable controls, hit-tested at their own
centres:

| build | reachable controls |
|---|---|
| old shell | `wsf-start-unverified-verify` plus the five member tabs |
| barless shell | **only** `wsf-start-unverified-verify` → `/verify-email` |

W9's own focused-flow standard is one explicit way out, at a real touch size
(`sprint-w9-shell-production.spec.ts:429`), and "Verify email" is a way
forward, not a way out.

**M5.** "Back to home" is a push (`ButtonLink` with `replace=false`), so the
form stays mounted with `alive.current` true. When a create that was in flight
succeeds after the member has left, the guarded `router.replace` still
navigates them to `/community/<new id>`. This happens on both shells. On the
barless shell this push is the only in-app exit, and the DOM then holds 2
`(tabs)` instances, 1 of them visible. What that count means (Back behaviour,
memory) is **CANNOT-ESTABLISH** from what I measured.

**Owned.** My check-10 item-8 test ("leaving mid-flight paints no outcome on
the next page", accepted) ended with `expect(pathname).not.toBe('/start-community')`.
`/community/<id>` satisfies that, so the test would have passed with the member
pulled into the new community. The property it proved, that nothing is painted,
holds. The property its title implies, that the member stays where they went,
was never asserted, and it fails.

## 14.7 · The pre-staged check

`apps/westayfit/tests-e2e/sprint-w7-start-community-barless-verify.spec.ts`
was first pushed at `2d01ef36`, the revision the #394 reproducer names; the
positive controls and one fixture correction were added in the next commit. It
was written before the delivery existed, so it discriminates rather than being
fitted to the delivery. Which revision produced each column:

| column | revision run |
|---|---|
| `5c28e45` | one full run of blob `677039dd`; the committed blob differs from it only in the header comment |
| old shell | a full run of the `2d01ef36` blob, plus SEAM-4 re-run (2×) after its wait fix |

The controls were not run on the old shell.

| test | old shell `05d2aef9` | **`5c28e45`** | correct fix |
|---|---|---|---|
| SEAM-1 390×844, 4 press methods | FAIL ×4 | **FAIL ×4** | PASS |
| SEAM-1 430×932, 4 press methods | FAIL ×4 | **FAIL ×4** | PASS |
| SEAM-1 390×640, 4 press methods | PASS ×4 | PASS ×4 (guard only) | PASS |
| SEAM-1 CONTROL ×8: the reader can see a pass | — | PASS ×8 | PASS |
| SEAM-2 / 2b: list opt-in through click and reload | PASS / PASS | **FAIL / FAIL** | PASS (W9's) |
| SEAM-3: unverified way out | PASS | **FAIL** | PASS (ruling pending) |
| SEAM-4: leaving mid-create | FAIL 2/2 | **FAIL 2/2** | PASS (ruling pending) |
| SEAM-4 CONTROL: the assertions are satisfiable | — | PASS | PASS |
| BARLESS × 4 states | FAIL ×4 (tab bar visible) | PASS ×4 | PASS |
| CONTROL: FormShell page inside `(tabs)` | n/a (the old shell has no top bar) | PASS | PASS |
| FRAMES calibration on `d467754` (21 of 24 show the old bar) | PASS | PASS | PASS |
| FRAMES delivery (`WSF_W7_DELIVERY_SHA=5c28e45`) | — | **PASS** | PASS |

On `5c28e45` the result is 12 failed and 20 passed. **Every failure stops at its
own defect assertion.** The tallies:

| failure message | count |
|---|---|
| "first presses that did not submit and show the error" | 8 |
| "the opt-in left the URL on the click" | 1 |
| "the reload opened the remembered older community" | 1 |
| "the only way off the unverified gate is to verify" | 1 |
| "the late success navigated the member after they left" | 1 |

**The old-shell sweep shows the position dependence directly** (390×844, 120 ms
mouse). Positions 374 and 394, with the field at −27..23 and −47..3, swallow.
Positions 414 and 434, with the field fully off screen, submit.

**Why the controls exist.** SEAM-1 (at 390×844 and 430×932) and SEAM-4 had
never passed on any build, so a correct fix could have failed them for an
instrument reason. The controls are test-side only:

- **SEAM-1.** The same fixture, placement, press and reader, at max scroll, with a capture listener that cancels the default of a `mousedown` on Create. The press then does not blur the field, and nothing is revealed mid-press.
- **SEAM-4.** The same journey, but the create's response is lost after the server commits, so there is no late success to act on.

**Two SEAM-1 controls were rejected as geometry-dependent.** Their logs are
retained.

- **Excluding the field from scroll anchoring** submits at 390×844 but not at 430×932. There, content above the field is also in view and becomes the anchor.
- **Taking the error out of flow** submits at both, but at 390×844 the out-of-flow error lands off screen (−35..5).

**A local product mutant was refused.** I first tried the SEAM-1 and SEAM-4
controls as a local product mutant, never to be committed. The session's
permission layer refused the edit before anything ran. The product tree was
confirmed clean afterwards, and the test-side controls above replace it.

**FRAMES delivery** on `5c28e45` confirms, from git objects, that W4's 24 frames
have the right names and sizes, that none shows the old bar, and that the 21
signed-in frames were re-shot. This is a pre-check of the composition, not a
verdict. The `start-community-next` directory is still not covered by
`check-evidence-intact.mjs`.

## 14.8 · The adversarial review

A read-only workflow of ten agents attacked Q1–Q3 before they were posted: an
archaeology pass per finding, refutation lenses, and a synthesis.

- **Q1: CONFIRMED,** with the corrections in 14.5.
- **Q2: CONFIRMED** on the clean pair.
- **Q3: REFUTED AS FIRST STATED.** The narrower finding in 14.3 survives, and it independently re-derived the anchoring correction.

Its hygiene demands, and where each stands:

| demand | status |
|---|---|
| use the clean pair | **done** throughout |
| save the spec revision behind the Q3j/Q3k and M4/M5 logs | **done** — the final diagnostic spec is saved in the evidence directory as `sprint-w7-diag-seam.final-11194c3f.spec.ts`; the diagnostic spec itself is never committed |
| stamp the build SHA in every log | **not done** for the diagnostic logs; every run of the pre-staged spec from the `5c28e45` runs on starts with a `served build:` line, read from the served bundle, and the spec blob |
| WebKit | **CANNOT-MEASURE** (only Chromium is installed) |

## 14.9 · W7's own errors in this pre-staging

1. **Q3's first mechanism was wrong** ("the shell suppresses anchoring"). Corrected in `5800531433`.
2. **Two old-base rows placed the pointer relative to the window**, so it landed on the tab bar. Redone relative to the scroller, with the pointer verified on the button.
3. **Q1's numbers were wrong** (300 and 878). Corrected in `5800875664`.
4. **The check-10 item-8 assertion was too weak** (14.6).
5. **Two launch errors before measuring, today.** The first SEAM-1 run had no Chromium path set. The second ran against a build without the emulator and auth flags. No test body ran in either, and neither is reported as a result.
6. **SEAM-4's first old-shell run was a fixture failure.** It waited for the new shell's top bar, which the old shell does not have. The wait is now shell-independent (`wsf-home-start`), and both builds were re-run 2×2: each run failed at the defect assertion.
7. **Two positive controls were geometry-dependent** and were replaced (14.7).

## 14.10 · Bound and hygiene

Emulators only (`demo-wsf-local`), Chromium only.

- **Clean pairs:** built locally, never pushed.
- **Edits:** no product edit, no edit to another worker's spec, no frame written.
- **Checks at every checkpoint:** `ts:check` exit 0, and `check-evidence-intact` exit 0 (9 frozen, 20 accepted).
- **After every run:** artifacts and `test-results` cleaned.
- **Logs:** retained, unfiltered, in the session's evidence directory (not committed).

## 14.11 · A preview of the combined candidate, and SEAM-2c

To find instrument surprises before the real candidate exists, I composed a
local preview: `f2f901a` ⊕ W9 `a87cd3b` ⊕ W8 `eff65b0` ⊕ W4 `5c28e45`, as
merge commits, never pushed (`6c98f485`, tree `77129e6a`). Results:

- **SEAM-2 and SEAM-2b PASS** with W9's fix.
- **SEAM-1 ×8 (390×844, 430×932), SEAM-3 and SEAM-4 still FAIL,** each at its own assertion. W4's successor had not landed.
- **W9's `sprint-w9-community-list-address` and W8's `sprint-w8-community-freshness` both pass.**

**A new test, SEAM-2c: Back and Forward around the click.** A fix for the address
must not be bought with history. The test requires three things:

1. the click adds exactly one entry;
2. Back returns to the unconfirmed screen;
3. Forward returns to the **list**, not to a bare `/` that opens the remembered older community.

| build | result |
|---|---|
| old shell `05d2aef9` | PASS 2/2 |
| BEFORE `5c28e45` | **FAIL 2/2**: Forward lands in `/community/<older>`, a further consequence of Q2 |
| preview | PASS 2/2 |

On the preview the click writes `pushState /?view=communities`, then
`replaceState /?view=communities`, and `history.length` goes up by exactly 1.
That is W9's `setParams` committing the address without adding an entry.

## 14.12 · W8's freshness delta, pre-staged with independent instruments

`sprint-w7-community-freshness-verify.spec.ts` measures W8's promises
(`eff65b0`, #455) where W8's own spec cannot see:

| | what it adds to W8's spec | `f2f901a` (no W8) | preview (with W8) |
|---|---|---|---|
| F1 | reselect counts **every** `wsf*` callable, for 4 s (W8 counts three, for 1.5 s) | PASS: preserved guard | PASS ×2 |
| F2 | a `MutationObserver` catches **any transient** loading testID during the return (W8 checks once, afterwards); the return must re-read the list | **FAIL**: no list re-read; per-goal progress skeletons flashed | PASS ×2 |
| F3 | the member's **in-app** exit after a lost goal create ("Check community goals"), not history Back; the server holds exactly one goal | PASS: preserved (see below) | PASS ×2 |
| F4 | W8's untested promise: a failed return read leaves the page standing (`wsfListGoals` faulted for the return only) | **FAIL** at non-vacuity (no re-read to fault) | PASS ×2 |

With W8, one return makes these calls: `wsfCommunityMembers`,
`wsfCommunityActivity`, `wsfListGoals`, `wsfGoalPulse`, `wsfMyContribution`. The
settle read follows as a second `wsfGoalPulse` and `wsfMyContribution`.

**F3, recorded, not asserted.** "Check community goals" pushes a **second**
Community instance: two roots, one visible, the kept one unmarked. The URL
carries W9's documented `?groupId=`. So the member's own path reads fresh with
or without W8, and the DOM holds two `(tabs)` stacks, as M5 showed.

**My instrument error, caught on `f2f901a` and fixed.** Progress calls
`wsfListGoals` with Community's own arguments. The first revision counted
Progress's read as Community's, so F2's re-read check and F4's fault counter
were contaminated. Every counter and fault now starts at the moment of the
return, after Progress has finished its reads.

## 14.13 · SEAM-1b: the Q3 mechanism, measured without a press

W4's stated design for Q3 (#394 `5801525555`) is: on blur, a short name gets a
route-local border-colour change only, with zero layout change, and the
sentence appears on the press. SEAM-1b tests that claim directly.

**How it measures.** The field is left by keyboard (Tab), so no pointer is
involved. The test compares two numbers before and after the blur: Create's
position in the content (box top + `scrollTop`) and the content height.

On the preview, whose route and shell are `5c28e45`'s:

| | 390×844 | 430×932 |
|---|---|---|
| name `a`, left by Tab | **FAIL**: Create 1099 → 1151, content 1231 → 1283 | **FAIL**: Create 1112 → 1164, content 1244 → 1296 |
| CONTROL, a valid name, left by Tab | PASS | PASS |

The control shows that the Tab and the focus change themselves move nothing, so
the check can pass. A fix that reserves the error's space also passes it. A fix
that only suppresses the reveal when focus goes to Create would not; that is the
alternative W4 rejected.

**Next:** L0's combined candidate (W4's successor ⊕ W9's `a87cd3b` ⊕ W8's
`eff65b0` on `f2f901a`), checked as one tree (`5800787974` §2, `5801193038`).

---

# Check 15 — W8's Progress-copy packet, #451 `90f8e74`: **PASS**

Routed by L0 in `5800714161` and taken in a gap before W4's successor
(ACK `5801844186`). Read-only; nothing in W8's spec or product was touched.
The SHA was re-derived: `90f8e74e0b3cd84c115f81ee2b4ee979120e3670` is one
commit on `f2f901a`, with the nine files as routed.

**Verdict: PASS on `90f8e74`**, with one wording point for L0 and one
pre-existing observation that is not W8's.

## 15.1 · Results

| | measured on `90f8e74` | on the parent `f2f901a` |
|---|---|---|
| W7 `sprint-w7-progress-copy-verify` C1–C5 | 5/5, twice | 5/5 FAIL, each at a copy assertion |
| W8 `sprint-w8-progress-copy` | 3/3, twice | 3/3 FAIL (subtitle / headline / clarification) |
| `ui-app-shell` "Activity shows…" (the `:230` update) | 1/1, twice | not run (its new lines are this packet's) |

## 15.2 · Item by item

1. **Subtitle and clarification.** The subtitle "Your recorded contributions, by goal." is present in the populated, empty, error and loading states. The clarification appears **exactly once** in the populated and empty states: its testID count is 1, and a whole-page text count is also 1. None of the eight retired assurances appears anywhere on the page. W8's sweep covers `wsf-activity` only; mine covers the whole body.

   **Wording point for L0.** The packet says the error state also carries "exactly one quiet clarification". The build shows **none** there, and instead says one reassurance sentence exactly once. That matches W8's README ("Empty + populated foot"), W8's own spec (`toHaveCount(0)` in the error state) and the Director-passed error frame, which I viewed and which shows no clarification. I verified the accepted design; if one was intended in the error state, this row fails.
2. **States preserved.** The partial-failure note stays beside the goals that did load (one community's `wsfListGoals` aborted). The loading state renders under the subtitle. On `f2f901a` both tests got past these assertions before failing at the new subtitle, so the states exist on both builds.
3. **History, units and summary retained.** The finished goal shows REACHED and the Living WE. Each row carries its own unit (33 squats, 7 laps, no cross-unit text). The summary counts goals ("3 goals you have added to"). Each running row leads with the member's own number, and the goal's shared total follows as context ("2,222 of 5,000 squats"), as in the passed frame.

   In the error state, **Try again** is the green primary (`rgb(34, 197, 94)`) and **retries**: the reads are let through, then clicking it renders the rows. Go to Home and Start moving are present in the error state; Start moving is also present in the empty state.
4. **Reachability at 390×640, empty state.** Start moving sits at y = 333..378 (45 px tall), above the tab bar's top at 564. `elementFromPoint` at its centre returns `wsf-activity-start`. The headline wraps to **three lines**, as accepted.
5. **The `:230` update holds**, and **W8's retired-phrase guard can fail.**

   I first tried the parent build `f2f901a` as the mutant, but it doesn't reach the guard: W8's tests stop at the missing subtitle first. So I used a mutant of the local build output. I backed up the 90f8e74 bundle, changed "WHAT YOU'RE PART OF NOW" to "Nothing was lost", ran the tests and restored the bundle byte-identical (`cmp`). W8's populated test then failed at its own guard, `retired assurance "Nothing was lost" is still on screen` (its line 167), and my C1 failed at its retired-phrase assertion.
6. **Scope.** `activity.tsx` is the only non-test, non-doc file changed. Its diff is copy, one `PersonalNote` component and one style: no router, handler, effect, callable or default. There is no diff under `functions-westayfit`, rules, indexes, firebase configs, `.github`, `src/` or either layout. All **29 Page 04 files are byte-identical**, and `check-evidence-intact` at `90f8e74` exits 0 (9 frozen / 20 accepted).

## 15.3 · Observed, not W8's: a vacuous shell assertion

`ui-app-shell.spec.ts` asserts `not.toContainText('1,847')`, with a comment saying the goal's shared total "must never appear on this private screen". This line is unchanged by #451. The design shows shared totals in running rows: the passed frame reads "1,847 of 5,000 squats".

The assertion passes because that test first records the member's own 20, so the total is no longer 1,847. This is **reasoned from the fixture, not measured.** The comment's property is not what the line proves. Low severity; recorded only.

## 15.4 · My errors in this check

- **C1 first asserted that shared totals never appear on Progress.** That is wrong about the accepted design, and it failed on `90f8e74` for that reason. It was replaced with the design's actual rule: the member's own number leads each row.
- **The spec header first said the preserved-state tests pass on `f2f901a`.** They fail there, at the new subtitle, after passing their preserved-state assertions. Corrected before commit.

## 15.5 · Bound and hygiene

- Chromium only; Safari/WebKit is **CANNOT-MEASURE**.
- Emulators only.
- W8's reported 3/3 + 52 regression was not replayed wholesale, as the packet instructs.
- No product source edit. The mutant was local build output, restored byte-identical.
- Artifacts and `test-results` cleaned after every run.
- `ts:check` 0; guard 9 / 20.

---

# Check 16 — the combined release candidate `9f27c6ea`: **PASS on every routed item**, with one candidate-introduced product finding (R1)

Routed by L0 in #434 `5802410201` (check shape `5802080266`; Director
`5802056978`). ACK `5802450373` / `5802471942`; interim `5802976626`. The
candidate is `9f27c6eae26beebd610779a61fb458bd18266f27` on
`claude/wsf-release-candidate-round-2`: `f2f901a` ⊕ W4 `7f37e2a` ⊕ W8 `eff65b0`
⊕ W9 `cd02949`.

## 16.1 · What was tested, exactly

- **Tree identity.** `9f27c6ea`'s root tree is `b275b42c`, identical to W7's
  local composition `495419b7` (the same four inputs, merge commits, never
  pushed), built the moment W4 delivered. `git diff 495419b7 9f27c6ea` is empty.
- **Build identity.** The routed suite ran on the `495419b7` build. I then built
  `9f27c6ea` itself: 119 files each, the same file set, and **0 files differ**
  once the commit stamp, build time and content-hash names are normalised (90
  differ raw, by those alone). Every later run is on the exact `9f27c6ea` build.
- **Scope, re-derived.** 37 files, +3,439 / −67 against `f2f901a`; six product
  files, one of them the gated `leave-for-list.tsx` fixture. No change under any
  protected path, and no frozen or accepted evidence path touched. Each product
  file is byte-identical to its owner's head:

  | file | candidate blob | from |
  |---|---|---|
  | `start-community.tsx` | `4eb34043` | W4 |
  | `(home)/community/[groupId]/index.tsx` | `76e2483a` | W8 |
  | `contribute/[goalId].tsx` | `253278fb` | W9 |
  | `(home)/index.tsx` | `3990af8c` | W9 |

## 16.2 · Per routed item

| # | item | result | evidence (all Chromium, emulators) |
|---|---|---|---|
| 1 | **Q3**: first invalid press | **PASS** | SEAM-1 at 390×844 and 430×932, mouse 5 / 120 ms and touch 80 / 150 ms: 8/8, where `5c28e45` gave 0/8. The risky position (field on screen) is now **asserted** as reached: 4× per run at those classes and 0× at 390×640, which is the regression guard (4/4). SEAM-1b (blur moves nothing) 2/2 plus its control 2/2. **SEAM-1c** measures W4's signal: blurred short → red border `rgb(180, 35, 44)` with no sentence; corrected → normal `rgb(230, 226, 218)`; too long → red plus its sentence while typing. On W4's old route it fails (blur shows the sentence, no red). SEAM-1 controls 8/8 |
| 2 | **M4** | **PASS** | SEAM-3, plus **SEAM-3n** by name at 390×640 and 390×844: `wsf-start-unverified-back`, 44 px, hit-tested at its own centre, `href="/"`, and the press lands on `/`. SEAM-3n fails on the old route (no such control) |
| 3 | **M5** | **PASS** (routed contract) | SEAM-4's four assertions (path `/`, one request, one community by server query, no created card) plus its control. **Scope:** measured for the "Back to home" link with the create held before the server. Browser Back, and a commit that lands before Home reads, are not claimed. See R1 for what M5 leaves the member with |
| 3b | **item 4**: duplicate-create guard | **PASS** by unit test; e2e **CANNOT-MEASURE** | W4's unit file on `5c28e45`'s route (separate worktree): 5 fail / 32 pass, the five exactly the new tests; both windows fail with "called 2 times". On the candidate it passes within vitest 858/858. On web the window closes before a press can land (`submitting` stays true; the router drops the form first) |
| 4 | **Q2** | **PASS** | SEAM-2, 2b, 2c; W9 `list-address` 1/1; W4 `outcomes` 27/27 |
| 5 | **W8** | **PASS** | W8 4/4; W7 F1–F4 4/4. **X1s** is new: the first pulse after a return is answered with a sentinel stale total (1,848). The page shows it, then **W8's settle** re-reads at +2,577 ms (labelled exit) and +2,609 ms (browser Back), corrects to the server's 1,867 within 4.5 s, and holds at 10 s. On the old-exit baseline the labelled-exit leg **fails** (stale total never corrected: a fresh mount gets no settle); the browser-Back leg passes there too, as the settle is in both |
| 6 | **the exits** | **PASS** | W9 5/5; W1B 3/3; W7's exit spec 8/8 on the exact build (16.3); W1B's kiosk suites **22/22** (confinement 10, idle-finish 9, `ui-kiosk` 3) with all seven changed exits statically in non-kiosk branches. "Sign in unchanged" rests on W9's own test and the static diff |
| 7 | **fixture independence** | **PASS** | the emulator holds **1,125** groups, and one list page returns 150; W4's `communityNames` is a server-filtered `runQuery`; no unfiltered paged read left in `tests-e2e`; W4 `outcomes` 27/27 on this emulator |
| 8 | **shell, units, frames** | **PASS** | `shell-production` 3/3, `ui-app-shell` 3/3, W9 back-behaviour / URL seam / nav / Members link / Manage action 14/14, W7 `shell-successor` 8/8, vitest 858/858, tsc 0, guard 9 / 20. FRAMES delivery passes. **Limit:** it cannot tell `7f37e2a`'s frames from `5c28e45`'s. Git shows 7 blobs changed (the three unverified-gate frames about +1.5 KB each, carrying "Back to home") and none changed between `7f37e2a` and `9f27c6ea` |
| — | **Safari / WebKit** | **CANNOT-MEASURE** | only Chromium is installed; touch presses use CDP |

The routed e2e set on the equivalent build gave 134 passed, 1 failed. The
failure was my colour census's calibration anchor (the shell's MOVE disc, absent
on the barless route by design). It is re-anchored on the route's own recovery
primary and is 9/9 on the exact build (`4e25f04f`).

## 16.3 · The exits, with W7's own instruments

These tests are in `sprint-w7-contribute-exits-verify.spec.ts`: 8/8 on
`9f27c6ea`. On the baseline `6c98f485` (W4 `5c28e45` + W8 + W9's Q2 only, i.e.
the old `ButtonLink` exits), X1, the labelled-exit leg of X1s, and X4 fail.

- **X1, the ordinary `/` arrival.** Receipt → "Back to community".
  - The exit is hit-tested at its own centre before the press.
  - It lands on the **same** Community (a mark on the visible root survives), at the planted scroll (160), with one root and one tab bar.
  - The history writes are `go(-1)` then `replaceState`, with **no push** and no change in history length.
  - The total equals the server's shard sum (1,867).
  - **Forward** re-opens `/contribute/<goal>` only as a **fresh** start screen: no receipt, no review with Submit, and no `wsfContribute` sent in 3 s. Back after the exit goes where Back from the Community went before (here, out of the app); that is correct history semantics, not a defect.
  - On the baseline: `pushState`, a second Community and **two tab bars**.
- **X1s**: see item 5.
- **X2, MOVE from You.** The exit lands on the Home tab's Community (marked, one root, one bar), and the point under the thumb is Community. The first Back afterwards changes nothing on screen, because the You entry was overwritten. Recorded.
- **X3 / X3b / X3c, the chrome arrow keeps `back()`.**
  - X3: in-app, it returns to the same instance.
  - X3b: from MOVE on You it returns to **You**, while reading "Back to community" (label/destination note, 16.5).
  - X3c: on a cold arrival it **replaces**: no push, history length unchanged, and Back does not return to the contribution.
- **X4, a cold "Back to home".** The writes are `replaceState /` then `replaceState /community/<g>`: Home resolved first, nothing pushed, history length unchanged, and Back does not reach the dead-end screen. On the baseline it writes `pushState /`.

## 16.4 · Product findings, measured (outside the routed contracts)

These came from a read-only adversarial review of this check (four lenses plus a
synthesis). Each was measured on the exact build and on the baseline
(`sprint-w7-candidate-risks.spec.ts`).

- **R1 — introduced by the candidate's M5 fix.** The journey: a first-community member presses Create, then "Back to home" while the create is in flight, and the create commits. M5 correctly does not move them. But:
  - Home read the community list before the commit, so it still offers **"Start a community"** and does not list the new community, while the server holds it.
  - Pressing it opens a **blank form**: empty name, no created card, no note.
  - Submitting it **created a second community**: the server then held "W7 Risk First" and "W7 Risk Second".

  On the baseline the late success moved the member into the new community, so they saw it. The candidate trades that for silence and a possible silent duplicate. W4's comment "a member who comes back finds Open" holds only for browser Back.
- **R1b — pre-existing copy.** On the same journey, browser Back shows the created card saying "We couldn't open it automatically.". On the candidate the app did not try to open it; on the baseline it did. The same sentence appears on both.
- **R2 — pre-existing, narrower on the candidate.** From the member's mounted Community, a goal screen that fails to load offers "Back to home". Pressing it mounts a **second** Community; the one left stays hidden beneath with its state.

  | build | Community roots | tab bars |
  |---|---|---|
  | candidate | 2 | 1 |
  | baseline | 2 | 2 |

  The same class covers the own-only receipt and other context-less "Back to home" exits (from source; not measured separately).

Routing and any fix are L0's and the Director's. None of these is in the routed
scope, and W7 edits no product code.

## 16.5 · Follow-up candidates, recorded (from source; not measured)

- **Exits that land on a newly mounted Community skip W8's settle.** Examples: "Back to community" after MOVE on the Challenge or Members page, or with Home showing the list. A stale pulse can then persist.
- **The arrow's label and destination disagree.** From MOVE on You, the arrow reads "Back to community" and returns to You (measured in X3b).
- **An account change releases the duplicate guard unconditionally.** A sign-out / sign-in in another tab during a create re-enables Create.
- **Two communities in one browser.** An exit can swap the mounted Community's params A → B; the settle skips if B's list has not loaded, and A's presence can remain under B's name.

## 16.6 · Instrument corrections, mine

- **The colour census anchor.** Its calibration was the shell's MOVE disc, absent on the barless route. Re-anchored on the route's own recovery primary.
- **X4's Back check.** It could not fail on a not-found arrival. It now asserts a history trace, an unchanged history length, and a Back path outside `/contribute`.
- **X4's "Home resolved afresh".** This now rests on the history order (`/` then `/community`), because `wsfMyCommunities` is also called by the Community page. The callable count is kept as recorded evidence only.
- **X3.** It could not tell `back()` from `dismissTo`. It is retitled, and X3b and X3c now test the difference.
- **SEAM-1's field-visible condition.** It is now asserted, not only annotated.
- **SEAM-3.** It accepted any second control. SEAM-3n names the control.
- **The exit spec header** wrongly said W5's K1–K18 run "on the same SHA" from this tree. Corrected: W5's suite is W5's, and W1B's kiosk suites were run here.

## 16.7 · Bound and hygiene

Chromium only; Safari is CANNOT-MEASURE. Emulators only.

- **Verification builds:** local, never pushed (`495419b7`, `6c98f485`).
- **Edits:** no product edit; no other worker's spec edited.
- **After every run:** artifacts and `test-results` cleaned.
- **Checks:** `ts:check` 0; guard 9 / 20.
- **Diagnostics:** the diagnostic specs are kept in the session's evidence directory, not committed.

Everything here is **tested** on the candidate. Nothing is accepted, integrated
or staged by W7.

---

# Check 17 — the neutral-blur successor `0bf8f427`: delta-only, **PASS on every delta item**

Routed by L0 in #434 `5803510971` (Director `5802873607`; delta shape
`5802882084`, `5803227673`). ACK `5803518058`. The successor is
`0bf8f42741449f2f840c197281f215349f778595` on
`claude/wsf-release-candidate-round-2`: `9f27c6e` ⊕ W4 `e653330`, one merge
commit. Everything else in Check 16 and W5's kiosk gate carries unchanged, and
nothing outside the delta was rerun.

## 17.1 · What was tested, exactly

- **Source.** `git diff 9f27c6ea 0bf8f427` is exactly W4's five files:
  - the route;
  - W4's outcomes spec (+1 test);
  - W4's unit file;
  - the capture case;
  - one frame.

  Each is **byte-identical to `e6533303`**: route `eae25212`, outcomes spec `bbcbb5a9`, capture spec `b4a78462`, unit file `d15234fd`, frame `f0ed081e`. No protected path is touched.
- **The route change.** `nameLooksWrong` is now `nameMessage !== null`: the field is red exactly while a validation sentence is on screen. The blur handler (`setNameBlurred`) is gone.
- **Build.** `0bf8f427` itself, built in its own worktree (exit 0, stamp `0bf8f427`) and served from the emulator.

## 17.2 · Per item

| # | delta item | result | measured on `0bf8f427` |
|---|---|---|---|
| 1 | **SEAM-1**: first invalid press, three classes, mouse 5 / 120 ms, touch 80 / 150 ms | **PASS 12/12** | The field-on-screen press position was reached 4× per run at 390×844 and 430×932, and 0× at 390×640 (the guard) |
| 2 | **SEAM-1b**: leaving the field by keyboard moves nothing | **PASS 4/4** | 2 blur cases plus the 2 valid-name controls |
| 3 | **SEAM-1c**, re-pointed to the ruling | **PASS 1/1** | The blurred short name keeps the resting border `rgb(230, 226, 218)`, shows no sentence, and is not focused. **One** Create press then gives "Give your community a name.", `rgb(180, 35, 44)` and focus, with 0 creates. A corrected name returns to resting; a too-long name is red with its sentence while typing. Focus alone does not paint red |
| 4 | **W4's new e2e** (`sprint-w4-start-community-outcomes.spec.ts:332`) | **PASS** | W4's whole outcomes spec 28/28, from the successor's own tree |
| 5 | **the recaptured frame** (`AFTER-start-name-too-short-blurred-390x844.png`, `f0ed081e`) | **PASS** (measured, not a visual verdict) | 0 red pixels in the border ring, where 063747b9's frame had 759. The ring and everything outside the field are identical to the same SHA's arrival frame (0 and 0 differing pixels). Nothing red under the field. The 24 frames: FRAMES delivery PASS |
| 6 | **directly affected controls** | **PASS** | SEAM-1 controls 8/8; W4's unit file 37/37; check 9's "a too-short and a too-long name are refused without a request" 1/1; FRAMES calibrations 2/2 |
| — | Safari / WebKit | **CANNOT-MEASURE** | Chromium only |

**Fail-first on `9f27c6ea` (pre-staged, same file).** SEAM-1c fails there at
the blur: a red border with no sentence, the ruled defect. The frame delivery
check fails on `063747b9`'s frame with 759 red ring pixels.

## 17.3 · My instrument error in this check

The frame delivery check **first failed on `0bf8f427`**: 3 red-dominant pixels
in the field box. I located them before judging. They are colour fringes of
the typed "a" (x 36–40, y 398–403, e.g. `[163, 101, 70]`). They are identical
in `063747b9`'s frame and absent from the arrival frame, which has no text.
The count covered the whole box, glyph included.

It now counts the **border ring** only (the box less a 5 px inset, where the
glyph cannot reach). The calibration was re-run: 759 on `063747b9`'s frame, 0 on
the arrival frame. After the change it fails on `063747b9` and passes on
`0bf8f427`. The whole-box count is kept as a recorded number.

## 17.4 · Pre-staged for the R1 successor (not yet routed; tested on `9f27c6ea`)

`sprint-w7-candidate-risks.spec.ts`, run serially:

- **R1, the Director's proof contract (`5803218763`).** It asserts:
  - no yank: no history write into a community after the release, and the member stays on `/`;
  - before a blank form can submit, the confirmed community's **name** is on screen, hit-tested on top at its own centre, on Home or on Start's re-entry;
  - R1b's "couldn't open it" copy is not reused;
  - one create request and one community until a deliberate second;
  - a deliberate second still creates one.

  **On `9f27c6ea` it fails at the acknowledgment**: Home still offers "Start a community", Start opens a blank form, and nothing names the community. The member is on `/`, with 1 create.
- **R1m, the journey over time.** Home stays stale at:
  - +4 s and +30 s: "Start a community" offered, the community not named, no re-read;
  - after a Progress → Home round trip: the same.

  **Only a reload** shows it (Home opens the community). 1 create and 1 community throughout.
- **R1acct, the account-bound control.** The same journey, then an in-app sign-out and sign-in as another member, with no page load.
  - **PASS on `9f27c6ea`:** nothing of the first account is shown on Home, on Start, or at either Back step.
  - **Recorded, not asserted:** the first account's name stays in one **unrendered** `wsf-start-summary` node.

  It also passes on `6c98f485` and `0bf8f427`.
- **R1acct-late: the Director's clarification (`5803485378`).** The first account's create is still **held** when the account changes in the app, and it completes after the next account's Home has resolved.

  **PASS on `0bf8f427`** (its R1-relevant route is `9f27c6e`'s) **and on `6c98f485`**:
  - the first account's create commits;
  - the next account gets no history write and stays on `/`;
  - nothing of the community is shown on Home, on Start (blank) or at either Back step.
- **Harness.** Under three workers, R1 once saw Home redirect into the new community. A slowed `wsfMyCommunities` read had landed after the commit: a race with Home's ordinary resolution, not the late success, and never seen serially. The harness now waits for Home's read to answer before the create starts.

## 17.5 · Addendum: the stale-total consequence (L0 #434 `5803105016` bound 3)

This measures only the consequence. The duplicate itself is W9's measurement
(#458 `5802502922`), recorded and deferred by the Director (`5802767529` §3),
and is not relabelled here.

**The journey.** A Champion's first goal:
1. From the Community, go to Goal Setup and use the receipt's "Open the contribute page". That link names no community, so the exits read "Back to home".
2. Record 20.
3. Press "Back to home". On a warm arrival this mounts a **second, fresh** Community.

**Why it can be stale.** W8's settle re-read runs on a **return**, not on a
mount. `wsfGoalPulse` answers from a 2 s server cache that a contribution does
not invalidate. The review screen polls the pulse every 2 s until the write.

Specs: `sprint-w7-contribute-exits-verify.spec.ts` X5 and X5s, run serially.
Each asserts the server's total within the settle bound (4.5 s), holding.

| test | `9f27c6e` (candidate) | `6c98f485` (old exits) |
|---|---|---|
| **X5, no stub**: Submit straight after a poll, "Back to home" at once | **FAIL.** The fresh screen's first pulse left **374 ms** after the last pre-write poll, inside the cache window. It showed **0** while the server held **20**. No further pulse; still 0 at 10 s | **FAIL**, the same (379 ms; 0 against 20) |
| **X5s**: every pulse until 1.5 s after landing answered with a sentinel 7 | **FAIL.** 7 shown at +257 ms and **still shown at 15 s**, with no pulse after landing. A Progress → Home round trip corrected it to 20 **329 ms** after the return | **FAIL**, the same (corrected 308 ms after the round trip) |
| DOM | 2 Community roots, 1 tab bar | 2 roots, 2 tab bars |

**Consequence.** On this path the stale total is **not a bounded cache
interval**. After a success receipt it lasts until the member leaves and
returns, or reloads. It is **pre-existing**, like the duplicate it follows
from.

- **Without a stub,** it needs the fresh read inside 2 s of the last pre-write poll. The harness hit that by pressing at once; a member does only by pressing "Back to home" quickly.
- **Any other reader of the same goal inside that window** would also leave the pre-write total in the cache. That case is inferred from source, not measured.

It bears on the Director's queued W9 option 1 (`5803510323`: a refresh on a
genuine return, and the warm Goal Setup journey), and it makes no release
claim. Whether it gates anything is the Director's call.

## 17.6 · Bound and hygiene

Chromium only; Safari is CANNOT-MEASURE. Emulators only.

- **Verification builds:** local and never pushed (`0bf8f427` built exactly; `6c98f485` for the baseline column).
- **Edits:** no product edit; no other worker's spec edited. W4's spec and unit file were run from the successor's own tree.
- **After every run:** artifacts and `test-results` cleaned.
- **Checks:** `ts:check` 0; guard 9 / 20.

**Status:** tested on `0bf8f427`; not accepted, integrated or staged by W7.

---

# Check 18 — the R1 successor `7ee70e4f`: delta-only, **PASS on every routed item**

Routed by L0 in #434 `5803830996` (Director `5803218763`, `5803485378`,
`5803634916`). ACK `5803834489`. The successor is
`7ee70e4f4db73c9d3fd475ef4729d3eb51064619` on
`claude/wsf-release-candidate-round-2`: `0bf8f427` ⊕ W4 `7a4b2710`, one merge
commit. Checks 16 and 17 and W5's gate carry; nothing outside the delta was
rerun.

## 18.1 · What was tested, exactly

- **Source.** `git diff 0bf8f427 7ee70e4f` is W4's six files: the route (`41e2bc60`), the route's outcome helper `src/startCommunityOutcome.ts` (`88e97368`), W4's outcomes spec, capture spec and unit file, and one new frame `AFTER-start-created-after-leaving-390x844.png` (`4281e110`). Each is byte-identical to `7a4b2710`. **No Home file and no protected path.**
- **The fix, from the diff.** A create that confirms while its form is not the screen in front is remembered in module memory as `{uid, groupId, displayName}`, only if the same account is still signed in when it lands; it is dropped on any sign-out or account change, read only for its own uid, and cleared by Open, by "Start another community", or by being shown. `/start-community` for that account then shows the community by name instead of a blank form.
- **Tree identity.** `7ee70e4f`'s root tree `18c20c79` equals the local composition I had built from W4's pushed commit before L0 composed (never pushed).
- **Build.** `7ee70e4f` itself, built in its own worktree (exit 0, stamp `7ee70e4f`), served from the emulator. Everything ran serially.

## 18.2 · Per item

| # | routed item | result | measured on `7ee70e4f` |
|---|---|---|---|
| 1 | **R1**, the Director's proof contract on my exact journey | **PASS ×2** | After the release: still `/`, no history write into a community, Start offered, **1 create**. Pressing Start shows the acknowledgment **instead of a form**: heading "W7 Risk First", body "Your community is ready. It was created after you left this page.", primary **"Open W7 Risk First"**, **no Create** (0 visible), no blank field. Server: 1 community. Then **"Start another community"** opens a blank form, and its submit makes the second: **2 communities**. On `0bf8f427` the same test fails at the acknowledgment; on `6c98f485` at no-yank |
| 2 | **R1m**, the journey over time | measured | Unchanged from `0bf8f427`: Home stays as read at +4 s and +30 s and after a tab round trip; a reload opens the community. By design the fix reconciles on Start's re-entry, not on Home. 1 create, 1 community throughout |
| 3 | **R1acct** | **PASS** | An in-app account change after the commit: nothing shown to the next account on Home, on Start or at either Back step; the same one unrendered `wsf-start-summary` node is held |
| 4 | **R1acct-late** (the old request lands after the account change) | **PASS** | The first account's create commits after the switch; the next account gets no history write, stays on `/`, sees a blank Start, nothing at either Back step |
| 5 | **R1b**, the leave path's copy | **PASS** | Browser Back after "Back to home" shows the created card reading "Your community is ready. It was created after you left this page." — not "couldn't open it automatically" |
| 6 | **SEAM-4 + CONTROL** (no yank) | **PASS 2/2** | `/`, one request, one community, no created card on the page the member is on |
| 7 | **check 9's outcome tests** | **PASS 15/15** | seven transport codes read as unconfirmed with no developer text; each named refusal renders its own copy; a lost response leaves one community and a screen that claims nothing; the demoted retry creates a genuine second; failed-precondition blocks and points at the profile; too-short / too-long refused without a request; two taps in one frame create one; an unusable id reads as unconfirmed; leaving mid-flight paints no outcome on the next page |
| 8 | **W4's outcomes spec** (from the successor's tree) | **PASS 29/29** | including the new test "after leaving mid-create, Start shows the confirmed community by name before any blank form; a second is only deliberate" |
| 9 | **W4's unit file** | **PASS 54/54** | |
| — | Safari / WebKit | **CANNOT-MEASURE** | Chromium only |

## 18.3 · My instrument error in this check

R1's first run on the successor **timed out** after "Home after the commit".
The acknowledgment replaces the form, so `wsf-start-name` never appears, and my
optional read of its value (`inputValue().catch(...)`) had no timeout: the
catch handles a rejection, but the wait was the test's whole timeout. The
optional reads now time out at 2 s. R1 then passed twice in a row. Nothing
else changed in the assertion.

## 18.4 · Recorded, not measured (outside the routed list)

- Leaving mid-create by **browser Back** rather than "Back to home": W4 states the note covers it; I did not drive it.
- The new frame `AFTER-start-created-after-leaving-390x844.png` goes to the Director through #428; I did not measure it.
- The hidden `wsf-start-summary` node holding the first account's name (R1acct) is unchanged by this fix and stays recorded.

## 18.5 · Bound and hygiene

Chromium only; Safari is CANNOT-MEASURE. Emulators only.

- **Verification builds:** local and never pushed (`7ee70e4f` built exactly; the earlier local composition `a04c20cc` was tree-identical and is not the reported build).
- **Edits:** no product edit; no other worker's spec edited. W4's spec and unit file ran from the successor's own tree.
- **After every run:** artifacts and `test-results` cleaned.
- **Checks:** `ts:check` 0; guard 9 / 20.
- **Session model:** the owner switched this session with `/model` at ~22:20Z; `session_context.model` now reads `claude-fable-5-1`. Checks 14–17 and the runs above before that switch were on `claude-opus-5-5`; the R1 ×2 rerun and this report are after it.

**Status:** tested on `7ee70e4f`; not accepted, integrated or staged by W7.

---

# Check 19 — W8's first-focus settle `9d30c38b` on app-shell `a1dcced`: **PASS on the routed items; the in-flight race reproduces (X7d, X7e); the cross-account settle leak reproduces from a second tab (X7g)**

Routed by the Director in #434 `5804104996` (L0 #462 `5804113250`; the
account-cancellation source concern #462 `5804115569`, W8's source reading
`5804147831`). ACK `5804124123`. The delivery is
`9d30c38b8693f6288e27dc7ca5a167910d3135a1` on `claude/wsf-community-freshness`,
one commit after `eff65b0`. It stays outside the frozen candidate `7ee70e4`.

## 19.1 · What was tested, exactly

- **Composition, recorded.** `9d30c38b` merged locally onto the integrated app-shell head `a1dcced013f659c3e1b600fa5a3deca0b53cbdd5` as one local merge commit `09cf5fd0`, never pushed. Root tree **`b5f8de30`**, equal to the tree W8 reported. The diff against `a1dcced` is exactly W8's two files, each byte-identical to `9d30c38b`: the Community route (`5bd84cca`) and W8's spec (`072859a5`). No Home file, no W4 or W9 file, no protected path.
- **The change, from the diff.** The 2.6 s settle timer is now scheduled on every focus, the first (the mount) included, with the cleanup clearing it on blur. Nothing else moves; no presentation change.
- **Build.** The composition itself (exit 0, stamp `09cf5fd0`), served from the emulator. Everything ran serially. Baseline: `7ee70e4f`, built exactly earlier.

## 19.2 · Per item

| # | routed item | result | measured on `09cf5fd0` (`a1dcced` ⊕ `9d30c38b`) |
|---|---|---|---|
| 1 | **X5**, the warm "Back to home" fresh mount, no stub | **PASS** | The fresh screen's first pulse left 386 ms after the last pre-write poll (inside the cache window) and showed **0**; the first-focus settle read at +2,562 ms corrected it to **20** at +2,825 ms. On `7ee70e4f` (and `9f27c6e`, `6c98f485`): stale 0 at 10 s |
| 2 | **X5s**, first reads forced stale | **PASS** | Sentinel at +255 ms; corrected to 20 at **+2,809 ms**; holding at 15 s. Two Community roots, one tab bar: the known duplicate, unchanged by this data-only delta |
| 3 | **X7**, a direct `/community/<id>` entry with a stale first read (independent of any exit) | **PASS** | Stale 1,848 at +433 ms; a second pulse at +2,820 ms; **1,867 at +3,006 ms**, holding at 12 s. On `7ee70e4f`: one pulse, 1,848 at 12 s |
| 4 | **own part distinct** | **PASS** | While the shared total corrected 1,848 → 1,867, "Your part" read "You've added 20 squats to this goal." throughout |
| 5 | **reselect after the settle** | **PASS** | Reselecting Home after the settle issued **0** reads (pulse, own credit, goal list, activity, members) in 4 s |
| 6 | **X7b / X7c**, a blur or an account change before 2.6 s | **PASS** | One pulse before leaving; **no** pulse after a You-tab blur or a sign-out (controls; also pass on `7ee70e4f`, which has no first-focus timer) |
| 7 | **X1s**, the return settle (both legs) | **PASS** | Pulses at +60 / +2,567 ms and +88 / +2,612 ms; the return path is unchanged |
| 8 | **F1–F4**, the four freshness cases | **PASS 4/4** | |
| 9 | **W8's spec** from the composed tree, ×2 | **PASS 10/10** | |
| 10 | tsc; guard | 0; 9 / 20 | on the composed tree |
| — | Safari | **CANNOT-MEASURE** | Chromium only |

## 19.3 · The in-flight race, measured (the Director's concrete limit)

Both tests hold a read's answer past the settle and let every other read
through. They assert what the member should get: the server's 1,867,
holding at 12 s.

| test | `09cf5fd0` (W8's delivery) | `7ee70e4f` (baseline) |
|---|---|---|
| **X7d**, fresh mount: the **initial** pulse held 4 s and answered stale | **FAIL.** The settle fired at +2,914 ms while the slot was still `loading`, so its answer was dropped; the held stale read landed at +4,634 ms; **1,848 at 12 s** | **FAIL**: one pulse, 1,848 at 12 s (no settle at all) |
| **X7e**, a **return**: the return's first pulse held 4 s and answered stale, the settle at 2.6 s answering fresh | **FAIL.** 1,867 on screen; the settle answered fresh at +2,651 ms; the held stale read landed at +4,427 ms and **overwrote** it; **1,848 at 12 s**, on the same marked instance | **FAIL**, the same (+2,658 / +4,170 ms) |

**Reading, from the source at `9d30c38b`:**
- The settle read replaces only a slot already `'ok'` (index.tsx ≈1145): a slot still `loading` at 2.6 s is left to the read in flight. That is W8's disclosed limit, and X7d shows it leaves stale progress in view with no second look.
- The ordinary progress read (mount and return) has **no sequence guard**: whichever answer lands last wins. X7e shows a stale answer issued earlier landing after the settle's fresh one and overwriting it. This half is **not in W8's disclosure**; it is on the return path too.

**Pre-existing or changed.** Both outcomes are **inherited**: on `7ee70e4f` the fresh mount is stale regardless, and the return path is `eff65b0`'s, in the accepted candidate. `9d30c38b` narrows the fresh-mount case to the slow-initial-read window and changes nothing on the return path. Neither is newly introduced; neither is solved. **Severity:** the stale figure lasts until the next focus or a reload; the member's own part is unaffected in these two cases; the trigger needs the first read to take longer than 2.6 s (fresh mount) or to land after the settle's answer (return), which on the emulator needs a held answer and on a slow network needs none.

**The smallest same-file correction, for W8's lane** (W8 has pre-staged the same shape locally, `5804147831`; W7 edits nothing): (a) let the settle **fill** a slot still `loading` with its confirmed result; (b) give the progress reads a per-goal sequence so an answer issued earlier never overwrites one applied later. Fail-first is X7d and X7e as committed.

## 19.4 · Account isolation of the settle (X7f, X7g): **the leak reproduces from a second tab**

Both probes follow the Director's rules (`5805389722`): A's return settle
answers (the pulse and own-credit pair issued 2.6 s after a return) are held
behind a **latch** released only once B's own figure is on screen; each held
answer records whether it was **delivered** or aborted; every sampled state
is asserted, not the last one alone. A and B are members of the same
community; B has recorded 5, A 20.

**X7f, the in-app switch (You → Sign out → Home's Sign in → B).** The held
pair was delivered after B's figure had loaded, and B's own part read **5 in
every sample**. But the marked Community did **not** survive: You's sign-out
replaces to `/` and unmounts it; B's arrival mounts a new instance. So on
this path the same-instance race is **CANNOT-MEASURE by construction**, and no
leak was observed. (Its first four runs stopped at the sign-in form because
B's `arrive()` opened `/signin` while A was still signed in; a harness
error, fixed.)

**X7g, the account change made from another tab (the instance survives).**
Firebase auth is shared across the tabs of one browser. The first tab keeps
A's Community mounted while a second tab signs A out and signs B in. On the
first tab the same screen then shows B's figures (bReady: B's own part read
5 at +5.1–5.9 s); in one of the runs the DOM mark was still on the root, in
the others the auth change had re-rendered the root node while the component
lived on. Then the latch released A's held pair, both delivered:

| build | B's own part before the release | after the release |
|---|---|---|
| `09cf5fd0` (W8's delivery), **2 / 2 runs** | "You've added 5 squats to this goal." | **"You've added 20 squats to this goal."** within 320 ms of the release |
| `7ee70e4f` (baseline), 1 run | "You've added 5 squats to this goal." | **"You've added 20 squats to this goal."** within 330 ms of the release (the marked instance survived) |

**Reading.** The settle effect's cleanup is keyed to its token alone (W8's
source reading `5804147831`); an account change does not cancel it, and
`shown.kind === 'ok'` is true again once B's figures load, so A's answer is
written into B's slot: **A's own contribution figure is shown to B**, the
shared total being the same for both. This is the exposure the Director
described (`5804115569`), reproduced in the browser, not inferred from the
source.

**Inherited or changed.** The return-path settle is `eff65b0`'s, in the
accepted candidate; `9d30c38b` adds the first-focus settle, which widens the
window to a fresh mount but does not create the path. **Severity:** one
account's own contribution figure on another account's screen on a shared
browser, on the same community, when the sign-out happens in another tab
within ~3 s of a return; it persists until the next read.

**The smallest same-file correction, for W8's lane:** cancel the settle on
an account or community change (the effect also keyed on `user.uid` and
`groupId`, a handled-token ref so no new read is issued), and the sequence
guard from 19.3. W8 has pre-staged exactly this (`5804147831`). Fail-first is
X7g as committed; X7f stays as the in-app control (no leak; instance
unmounted).

## 19.5 · Bound and hygiene

Chromium only; Safari is CANNOT-MEASURE. Emulators only.

- **Verification builds:** local and never pushed (`09cf5fd0`; `7ee70e4f` for the baseline column).
- **Edits:** no product edit; no other worker's spec edited. W8's spec ran from the composed tree.
- **After every run:** artifacts and `test-results` cleaned.
- **Checks:** `ts:check` 0; guard 9 / 20.
- Checks 16–18 are not rerun.

**Status:** tested on `09cf5fd0`; not accepted, integrated or staged by W7.

---

# Check 20 — W9's option 1 `945d6736` on app-shell `a1dcced`: **PASS on every routed item**

Routed by the Director in #434 `5804129224` and L0 `5804180055` (PR #464;
Director `5803510323` for the contract). The delivery is
`945d6736ed6cb96b9a144a10f97a8fb02d5e213d` on `claude/wsf-w9-home-return-refresh`,
two commits from exactly `7ee70e4f` (`635de78`, the exit half of `37082fd`
with its authorship; `945d673`, Home's return re-read). Outside the frozen
candidate `7ee70e4`.

## 20.1 · What was tested, exactly

- **Composition, recorded.** `945d6736` merged locally onto `a1dcced` as `f8d818c5`, never pushed; root tree **`7859d2cd`**, equal to L0's dry-merge tree. Four files, byte-identical to `945d6736`: Home `d86fdc19`, the contribution exit helper `367352d1`, W9's exits spec `b22f450a`, W9's new home-return spec `01405208`. No W8 or W4 file, no protected path.
- **The change, from the diff.** "Back to home" dispatches `POP_TO (tabs)/(home)` (the Home tab as it stands) instead of `dismissTo('/')`; Home bumps a return token on every focus but the first and re-reads its list quietly (nothing cleared; a failed list read re-reads the figures alone; cancelled on account change); cards keep their figure until the new read returns; the open-the-community decision is taken once per account.
- **Build.** The composition itself (exit 0, stamp `f8d818c5`), served from the emulator; serial runs. Baseline `7ee70e4f`.

## 20.2 · Per item

| # | routed item | result | measured on `f8d818c5` (`a1dcced` ⊕ `945d6736`) |
|---|---|---|---|
| 1 | **X6**, the explicit `/?view=communities` list → MOVE → committed +20 (own-only receipt) → "Back to home" | **PASS** | At +4 s: address **`/?view=communities`**, the **marked** list in front at the card's own centre, 1 list, 0 Community roots, 1 tab bar, history length unchanged (4 → 4); the card read the server's **1,867 at +508 ms** after the press and held at 10 s. A query reload keeps the address and shows 1,867. On `7ee70e4f`: the address became `/community/<id>` and the list was gone |
| 2 | **X5 / X5s**, Goal Setup → first contribution → "Back to home" | **PASS** | **1 Community root** (the mounted one; the duplicate is gone), 1 tab bar; the return settle corrected 0 → 20 at +2,824 ms (X5, no stub) and the sentinel at +2,810 ms (X5s), holding |
| 3 | **X6b**, one held Home-return read across an in-app account switch (corrected probe) | **PASS** | A's return `wsfMyCommunities` was held from +42 ms and **delivered** at +3,941 ms, after B's list had loaded at +3,918 ms (the latch); B's two cards were the same in every sample and after; A's community name appeared nowhere. On `7ee70e4f` Home has no return re-read, so nothing is held there: the path is this delivery's |
| 4 | **cold exits**: X3c, X4 | **PASS** | the arrow and "Back to home" replace on a cold arrival; Home resolves afresh (`/` then `/community/<id>`), Back leaves no contribution entry |
| 5 | **the exits kept**: X1, X1s ×2, X2, X3, X3b | **PASS** | same instance, scroll, server total; the return settle at +2,585 / +2,611 ms |
| 6 | **R1m** (Home over time; M5's journey) | measured | Home still on `/` at +4 s and +30 s with 1 create; after a Progress → Home round trip Home **now names the community** (its return re-read) **without moving the member**; a reload opens it |
| 7 | **W9's two specs** from the composed tree (home-return 6 + exits 7) | **PASS 13/13** | tsc 0; guard 9 / 20 |
| — | Safari | **CANNOT-MEASURE** | Chromium only |

Reselect no-op, the failed list read keeping the list, and Back-to-list not
redirecting are W9's own cases (6 / 6 here); F1 (my reselect case, on
Community) passed in Check 19 on the same day's shell.

## 20.3 · My instrument error in this check

X6's first run on the composition **failed on my reader**: it took the card's
first integer, which is the "7" in "W7 Exit Movers", and hit-tested the screen
centre, which is Home's Start control rather than the card. It now reads the
"<total> of <target>" pair and hit-tests the card's own centre. The address,
mark, history and tab-bar readings were right on the first run. The baseline
result on `7ee70e4f` (fails at the address) is unaffected: that assertion comes
first.

## 20.4 · Bound and hygiene

Chromium only; Safari is CANNOT-MEASURE. Emulators only.

- **Verification builds:** local and never pushed (`f8d818c5`; `7ee70e4f` for the baseline).
- **Edits:** no product edit; no other worker's spec edited. W9's specs ran from the composed tree.
- **After every run:** artifacts and `test-results` cleaned. `ts:check` 0; guard 9 / 20.
- W8's `9d30c38b` is **not** in this composition; the two deltas were checked apart, as routed.

**Status:** tested on `f8d818c5`; not accepted, integrated or staged by W7.

---

# Check 21 — W8's successor `95b08857` on app-shell `b1e64b3f`: **the three settle boundaries hold; X7d, X7e and X7g pass; the ordinary path carries**

Released by the Director (`5805389722`: review only the correction delta once
pushed) and L0 (`5805483567`); W8's delivery #462 `5805516792` /
`5805532438`. ACK `5805583135`. The successor is
`95b08857`, one commit after `9d30c38b` on `claude/wsf-community-freshness`,
two files (the Community index and W8's spec).

## 21.1 · What was tested, exactly

- **Composition, recorded.** `95b08857` merged locally onto the app-shell head `b1e64b3f` (= `a1dcced` + one docs-only commit; the product trees under `apps/westayfit/app` and `src` are identical to `a1dcced`'s) as `f02a96fa`, never pushed; root tree **`a8887ba9`**. The diff against `b1e64b3f` is W8's two files, byte-identical to `95b08857`: the route `32ff6c93`, the spec `e0724949`. No Home, W4 or W9 file, no protected path.
- **The change, from the diff.** Every progress read carries `issuedAt` and returns `prev` when the figure on screen came from a later-issued read; the settle may fill a still-`loading` slot with a confirmed result (never a failed one); the settle effect is keyed on the token, `user?.uid`, `groupId`, `ready` and the goal list's readiness, with a handled-token ref so a context change cancels an in-flight settle without issuing a new read, and a settle owed before the list is ready is issued once the list lands.
- **Build.** The composition itself (exit 0, stamp `f02a96fa`), served from the emulator; serial runs. Baseline evidence: Check 19 on `9d30c38b` (`09cf5fd0`) and `7ee70e4f`, not rerun.

## 21.2 · The fail-first cases, now

| test | `9d30c38b` (Check 19) | `f02a96fa` (`b1e64b3f` ⊕ `95b08857`) |
|---|---|---|
| **X7d**, fresh mount, the initial read held 4 s and stale | FAIL: 1,848 at 12 s | **PASS.** The settle at +2,858 ms **filled the loading slot** with 1,867 at +3,030 ms; the held stale answer was delivered (+4.3 s) and **never shown**; 1,867 at 12 s |
| **X7e**, a return, the return's first read held past the settle | FAIL: the late stale answer overwrote the settle | **PASS.** 1,867 throughout; the held answer (issued +103 ms, delivered ~+4.1 s) did not replace the settle's fresher figure (+2,643 ms); same marked instance |
| **X7g**, an account change from a second tab, A's held settle released after B's figure loaded | FAIL 2/2: B's own part became A's 20 | **PASS.** Both held answers delivered at +5.88 s, after B's figure at +5.87 s; B's own part **5 in every sample** |
| **X7f**, the in-app switch | CANNOT-MEASURE (instance unmounted); no leak | **CANNOT-MEASURE**, the same, no leak; the control stands |

## 21.3 · The ordinary path carries

| item | result on `f02a96fa` |
|---|---|
| X5 (no stub) / X5s | PASS: corrected at +2,827 / +2,811 ms (two Community roots here: W9's exit change is not in this composition) |
| X7, the direct entry with a stale first read; own part; reselect | PASS: 1,867 at +3,006 ms, holding; "You've added 20 squats"; 0 reads on reselect |
| X7b / X7c, blur / sign-out before 2.6 s | PASS: no pulse after leaving |
| X1s, both legs | PASS: pulses at +66 / +2,577 ms and +68 / +2,610 ms |
| W8's spec from the composed tree | PASS 8/8 |
| tsc; guard | 0; 9 / 20 |
| Safari | CANNOT-MEASURE |

## 21.4 · My instrument note

X7d's precondition asked for the stale sentinel to **reach the screen** before
the property was judged. On the successor it never does: the settle fills the
slot first and the sequence guard rejects the late answer, which is the fix
working. The precondition is now that the held stale answer was **delivered**;
whether it was ever shown is recorded (`staleEverShown: false` here, `true` on
`9d30c38b` and `7ee70e4f`). No property changed.

## 21.5 · Bound and hygiene

Chromium only; Safari is CANNOT-MEASURE. Emulators only. Local builds, never
pushed (`f02a96fa`). No product edit; no other worker's spec edited; W8's spec
ran from the composed tree. Artifacts and `test-results` cleaned. Checks 16–20
not rerun.

**Status:** tested on `f02a96fa`; not accepted, integrated or staged by W7.

## 21.6 · Addendum: the required proof list on development `0827e4d2` (W9 integrated)

L0's routing (#434 `5805616781`, Director #365 `5805596087` §2) named the
required proof and asked for the composition onto the development head
`0827e4d2` (= `b1e64b3f` ⊕ W9's `945d6736`, integrated) or onto `a1dcced`,
recorded either way. Both were done: 21.2–21.3 above on `b1e64b3f`, and this
addendum on `0827e4d2`, so W8's successor and W9's option 1 are also shown to
hold **together**.

- **Composition, recorded.** `95b08857` merged locally onto `0827e4d2` as `d03e957b`, never pushed; root tree **`3f73beeb`**; the two files byte-identical to `95b08857` (`32ff6c93`, `e0724949`); nothing else changed. Built (stamp `d03e957b`) and served; serial runs.

| required item | result on `d03e957b` (`0827e4d2` ⊕ `95b08857`) |
|---|---|
| **X7d**, initial read held past the settle | **PASS**: the settle filled the slot with 1,867 at +3,014 ms; the held stale answer (delivered) never shown |
| **X7e**, a return's earlier read landing after the settle | **PASS**: 1,867 throughout, same marked instance |
| **X7g**, the two-tab account change, A's settle released after B's figure | **PASS**: delivered at +5.74 s after B at +5.73 s; B's own part 5 in every sample |
| **X7h**, timer-before-goal-list readiness (the first `wsfListGoals` held 4 s; the first pulse after it stale) | **PASS**: the list landed at ~+4.3 s, the stale 1,848 showed at +4,537 ms, the **owed settle was issued at +6,926 ms** (one window after the list) and corrected to 1,867 at +7,099 ms, holding at 14 s |
| **account / blur cancellation** (X7c, X7b) | **PASS**: one pulse before leaving, none after a sign-out or a You-tab blur |
| **group cancellation** | **not driven separately**: every path to another community blurs the instance first (the timer is cleared, X7b) and the effect is now keyed on `groupId`; a same-instance param change was not reproduced from any member path |
| **reselect read-free** (X7's reselect step; F1) | **PASS**: 0 reads after the settle; F1 0 callables for 4 s |
| **own / shared meanings** (X7) | **PASS**: "You've added 20 squats" while the shared total corrected 1,848 → 1,867 |
| **failed / unknown meanings** (F4; W8's cases) | **PASS**: a failed return read leaves what is on screen; W8's spec 8/8 |
| **the ordinary path** (X5, X5s, X1s ×2, F2, F3) | **PASS**: X5 / X5s now land on **one** Community root (W9's exit) and correct at +2,816 / +2,818 ms |
| **X6** (W9's list journey, with W8 present) | **PASS**: address kept, marked list, 1,867 at +510 ms |
| **X7f** | **CANNOT-MEASURE** the same instance in-app (unmounted); no leak |
| tsc; guard; Safari | 0; 9 / 20; CANNOT-MEASURE |

**Status:** tested on `d03e957b`; not accepted, integrated or staged by W7.

## 21.7 · Disposition and integration identity (recorded 02:15Z)

- **Accepted.** The Director accepted `95b08857` for development integration on Check 21 and §21.6 (#365 `5806120492` §1, 02:00Z): X7d / X7e ordering, the two-tab X7g, X7h readiness, blur / account cancellation, read-free reselect, own / shared and failed-read meanings and the one-root return journey; group change recorded as construction evidence, not a driven measurement; no presentation change, no export.
- **Integrated by L0** as merge commit **`16cf96dc`** on `claude/wsf-app-shell` (#365 `5806149542`; #462 `5806147774`).
- **Identity, re-derived here rather than taken from the receipt:** `16cf96dc` has parents `0827e4d2` and `95b08857`; its root tree is **`3f73beeb`, byte-identical to the tree of my local composition `d03e957b`** (§21.6); the two files are `32ff6c93` / `e0724949`, as on `95b08857`; the diff to `0827e4d2` is exactly those two files; `apps/westayfit/app` tree `38e67f1f`. The build measured in §21.6 was therefore the integrated tree, stamp aside.
- **Kept distinct:** delivered (Check 21, `8179aae3`; §21.6, `7a366ced`) → accepted (`5806120492`) → integrated (`16cf96dc`). Not staged: the frozen pin stays `7ee70e4f`; the served build keeps the inherited limitation until a later pin.
- **W7's part is complete.** Nothing is routed; the sprint's 03:00Z stop applies.

# Check 22 — EXP1's prize-drawing core `8a434dd7` (PR #467), the transferred independent review: **every routed item PASS or re-derived; one measured enable-seam finding; no defect in a delivered row**

Routed by the Director on #434 (`5808007406`) after the transfer from W5 (#395 `5808004745`). Executed on this session after the sprint's 03:00Z stop because it is an explicit Director routing, not autonomous work. Checks 1–21 are untouched.

## 22.1 · What was checked, exactly

- **Source:** `8a434dd78e73056ddf6284fc127b55fb7dc7e975`, four commits on exactly `16cf96dc` (`087b6673` → `966a63e1` → `3fbfb0ad` → `8a434dd7`; the last is docs-only: `EVIDENCE.md` + README status). 19 files, all new, all inside EXP1's reservation. Read-only: not rebased, not edited; a detached worktree, never pushed.
- **Disjointness claim, verified by git:** development `4f8acdc5` = `16cf96dc` + W2's `/display` (`bcadc245`) + W6's Goal Setup foot; its 27 changed paths and EXP1's 19 have an empty intersection; `git merge-tree --write-tree 4f8acdc5 8a434dd7` is clean (tree `2383b3db`).
- **Wiring, verified by grep:** nothing outside the lane imports `expo-prize` (the only non-lane reference is the new jest config's `testMatch`); no `wsfPromotion*` appears in `firestore.rules`, `apps/westayfit/app`, `apps/westayfit/src` or `functions-westayfit/src/index.ts`. The new collections have no rules block, so they fall to the catch-all deny (`firestore.rules:1257-1258`).
- **Environment:** Firestore + Auth emulators, `demo-wsf-local`, this container; the documented command shape (`jest --config jest.expo-prize.config.cjs`, isolation setup file in force: project `demo-wsf-local`, loopback hosts, external fetch blocked). Jest's default parallel workers, as documented; my own instrument serial.

## 22.2 · Item 1 — the 67 tests, the 29 / 38 split, and 81 / 81

| run | result |
|---|---|
| EXP1 suite, run 1 | **67 passed, 0 failed** (5 suites, 31.0 s) |
| run 2 | **67 / 67** |
| run 3 | **67 / 67** |
| after the four mutations were restored | **67 / 67** |
| existing `wsf-contribute` / `wsf-turn` / `wsf-combined-goal` from the same tree | **81 passed, 0 failed** (25 / 25 / 31) |

**The split, identified from the files, not the docs:** `pure.test.ts` has **38** tests and imports only `Timestamp` from `firebase-admin/firestore` — no `getFirestore`, no fixtures, no I/O — so "pure-core" is honest. The other four files (`award` 14, `form` 6, `cap` 6, `reconcile` 3 = **29**) import `getFirestore` and the fixtures, seed real communities and goals, and create their movement through the real `wsfContribute` (and rows 3 / 4 through the real turn and combined-goal callables) before driving the core with real transactions. 29 + 38 = 67. PASS.

## 22.3 · Item 2 — the three concurrency results, re-derived; four mutations applied and restored

**My own instrument** (`docs/westayfit/qa/sprint-w7-exp1-concurrency.test.ts`, run with `sprint-w7-exp1-jest.config.cjs` against the worktree; inert in the repo, no jest config matches it): it seeds the community, goal and promotion itself through the Admin SDK, makes real contributions through the real `wsfContribute`, drives the core, and reads the result back by scanning the raw collections and filtering by prefix — not EXP1's fixtures, not EXP1's `promotionState`. The only EXP1 code used besides the unit under test is `validatePromotionConfig` / `configDigest`, because the contract requires the enablement digest on the promotion document (`policy.ts:224-227`) and nothing else in the packet writes it. Three runs each; every sample asserted.

| scenario | ×3 | measured |
|---|---|---|
| **A** six concurrent first ingestions of one contribution | **PASS** | outcomes exactly `[accepted, replay ×5]`; each replay carries the accepted `entryId`; one source, one entry, one entrant, one link, tally `entryCount` 1; counter never written (no cap); the contribution row's **data and `updateTime` identical** before and after |
| **B** four concurrent receipts for one subject | **PASS** | 1 accepted, **3 refused `bonusAlreadyAwarded`, recorded**; one entry (`formBonus`, `tickets` 1), one entrant, four source rows (1 accepted / 3 refused), tally `{entryCount 1, formBonusAwarded true}`; no member total created |
| **C** six concurrent first-time entrants, cap 2 | **PASS** | exactly 2 admitted, 4 refused `capReached` recorded; `entrantCount` 2; 2 entrants / links / entries, 6 sources; **all six contributions and member totals exactly as committed**; a replay admits nobody and the counter stays 2 |

**Mutations** (applied with `sed` to the worktree copy, the named suites run, the file restored with `git checkout --`, `git diff --quiet` confirmed before the next; the real core rerun afterwards):

| mutation | EXP1 recorded | measured here |
|---|---|---|
| M1 dedupe removed (`award.ts` both `if (sourceSnap.exists)` → `if (false && …)`) | 7 failed / 13 passed | **7 failed / 13 passed** — rows 2, 2b, 3, trigger body, 13 ×3 |
| M2 cap inverted (`>= policy.entrantCap` → `<`) | 5 / 1 | **5 failed / 1 passed** — 13 ×3, 14, 15 |
| M3 cutoff on wall-clock (`row.createdAtMs` → `Date.now()`) | 1 / 13 | **1 failed / 13 passed** — rows 7 + 22 |
| M4 fence admits `disabled` (`AWARDING_STATUSES` + `'disabled'`) | 2 / 50 | **2 failed / 50 passed** — row 21, `readPromotion` ordering |

Four of the seven recorded mutations were reproduced (the packet asked for at least three); each was caught by exactly the rows EXP1 named. PASS.

## 22.4 · Item 3 — the four trust questions, verdicted from source

| question | verdict | evidence |
|---|---|---|
| **(a)** the contribution row in the award's read set, no movement write | **HOLDS** | `award.ts:214` `tx.get(db.doc(contributionPath))` is the only touch of `wsfContributions`; every write targets a `COLLECTIONS` ref (`:151/:153` sources, `:164` entrant, `:168` link, `:170` counter, `:242/:344` entry, `:252/:353` tally); no write to `wsfGoalCounters`, `wsfGoalMemberTotals`, `wsfCombinedCredits` or any turn document anywhere in `src/expo-prize`. The row itself has **one writer** in the product: `index.ts:3538` inside `performContribution`'s transaction; the correction path reads it by name (`:4832-4834`) and `crossedTarget` is never raised on it (`:3716-3717`, recorded on the goal). Row 20 (a real abort via `beforeCommit`) and my scenario A (`updateTime` unchanged under six concurrent awards) measure it. Sufficient for "never rolls back movement". Two notes, not defects: production server-SDK transactions hold locks on read documents (`@google-cloud/firestore` 7.11.6 `transaction.js:74/:114`), so an award that reads a not-yet-committed key could briefly contend with that row's create — only an ad-hoc caller can do that, and the effect is a retry, not a lost write; and the SDK's default is 5 attempts, so a transaction that loses five times **throws** rather than recording a verdict (re-running converges; the reconcile pass is interruptible by design, row 17). |
| **(b)** once-per-new-entrant counter vs "no global ticket counter" | **HOLDS, as an honest reading** | `resolveEntrant` reads `wsfPromotionCounters/{p}` only when the uid has no link **and** a cap is configured (`award.ts:120-127`); the only write is `increment(1)` inside `writeEntrantIfNew` on the accepted path (`:169-171`), never for an existing entrant (`:163`), never on refusal (`:236-239`), never decremented; entries are creates under deterministic ids; the promotion document is read (`:202`, `:300`) and never written by ingestion. No ticket counter exists. Two consequences to record: a `capReached` refusal is a durable verdict (`:228-239`), so that contribution can never be re-adjudicated (a person on a `once` goal is locked out for that goal); and the counter counts **entrants created under a cap**, not entrants — see 22.6 D. |
| **(c)** `wsfContributions.createdAt` as the cutoff / freeze boundary | **HOLDS for adjudication; the freeze needs one more guard, next phase** | `createdAt` is `FieldValue.serverTimestamp()` written in the same transaction that creates the row (`index.ts:3550`; `CONTRACT.md:186`'s `:3549` is off by one — that line is `crossedTarget: false`), the row's sole writer; `readContributionRow` refuses a row without it (`adjudicate.ts:100-106`); `withinWindow` compares that instant with the window, start inclusive / end exclusive (`policy.ts:237-240`); rows 7 + 22 and M3 measure it. For the **close → frozen** transition (not built in A+B): a server timestamp is the commit instant and a committed row is visible to every later-started query, so a convergence pass that **starts after `windowEndsAt` by Firestore's own clock** cannot miss a pre-cutoff row. That is the guard the freeze needs (e.g. write a marker with `serverTimestamp()` and read it back ≥ `windowEndsAt` before the pass). A "max observed `createdAt`" fence cannot prove absence and is not the right tool. |
| **(d)** enablement digest as tamper evidence vs immutable-after-enable | **PARTIAL — tamper-evident for the adjudicated fields; not immutability; the enable step is unbuilt** | `readPromotion` fences on any mismatch between the stored digest and the digest of the fields it reads (`policy.ts:224-227`); rows 24 / 25 and the stale / absent digests measure it. Three bounds: (i) **nothing in `src/` writes `enabledConfigDigest`** — only the test fixture computes it (`fixtures.ts:270`); "at `enabled` the configuration is digested" (`CONTRACT.md:161`) is a design, not built code; (ii) `eligibleGoalIds`, the array the proposed trigger pre-filters on (`trigger.ts:25`), is neither validated nor digested, so an edit to it after enablement is not tamper-evident — harmless to awards (the award re-reads the digested `eligibleGoals`) but a goal dropped from that array is silently never ingested by the trigger transport; (iii) the digest is a hash, not a signature: an Admin-SDK actor who rewrites the fields and the digest passes the fence, and already-recorded sources are never revisited after drift (by design). Immutable-after-enable would need the enable transition to own the digest and refuse later writes — next phase. |

## 22.5 · Item 4 — the product / privacy contract

| item | verdict | evidence |
|---|---|---|
| one completed challenge = one entry regardless of reps | **HOLDS** | `adjudicateContribution` never reads `count` (`adjudicate.ts:114-141`); row 1; M7 (count-based entitlement) caught 9 rows in EXP1's record |
| same attempt across phone / station dedupes | **HOLDS** | one durable row `wsfContributions/{goalId}_{uid}_{attemptId}` (`index.ts:3355`); both completions go through `completeTurnEntry` with the turn-minted attempt (`:8819-8833`); row 3 (phone first, station `alreadyRecorded: true`, one entry) |
| combined-parent credit cannot award | **HOLDS** | only `wsfContributions/{id}` is a source path (`adjudicate.ts:61-70`); `wsfCombinedCredits/…` refused `notAContributionPath` (row 4, row 27); a setup id listed as an eligible goal is inert by construction — no contribution row ever carries a setup id as its `goalId` |
| an event goal id is not a promotion id | **HOLDS** | a promotion id is its own random document id; no route parameter is read anywhere in the lane; no client path to the core exists at all (grep) |
| one trusted form bonus; forged receipt refused; no consent | **HOLDS** | receipt resolved server-side by id (`award.ts:297`); unknown / other-subject refused **without a write** (`:312-315`, row 9); the one-time bonus is `tally.formBonusAwarded` + the deterministic `b_{entrantId}` (`adjudicate.ts:174`, `:83-85`); the `FormReceipt` type has no consent field and the written documents are fixed-shape literals (`award.ts:143-154`, `:344-352`, `:353-361`), so an extra field on a seeded receipt cannot reach storage; my scenario B |
| disabled writes nothing | **HOLDS** | the fence returns before any write in both ingests (`award.ts:202-206`, `:300-304`), `reconcilePromotion` returns early (`reconcile.ts:113-116`), the trigger body pre-filters and the award fences again (`trigger.ts:33`); row 21 across all five inactive statuses; M4 |
| cap never blocks movement | **HOLDS** | no coupling into `performContribution` (grep: nothing outside the lane imports the module); row 14; my scenario C (all six contributions and totals intact after four `capReached`) |
| pending / unknown are not confirmed | **HOLDS** | `status.ts:17-29`; an inactive promotion never yields `pending` (`:22-24`); rows 19 / 21 |
| uid-bearing source keys server-only; no leaderboard / count surface | **HOLDS, bound stated** | the uid appears in the source and entry document ids and in `canonicalPath` / `sourceKey` (by construction, the ledger key), and in the link document id; nowhere else. Row 26's scan is weaker than its name: `deepStrings` visits values only (`fixtures.ts:302-309`), never document ids, and it exempts exactly `c_{docId}` and the path (`award.test.ts:318-319`) — so it proves "no *other* value carries the uid", not that the ids are opaque, which they are not and are not claimed to be in `EVIDENCE.md`. No rules block → catch-all deny; nothing in the app or in `src/index.ts` reads `wsfPromotion*`, `entrantCount` or `tickets`. A member-facing id must be a derived opaque one, as `EVIDENCE.md` already says |

## 22.6 · Findings (measured or read; none is a failure of a delivered row)

| # | kind | what | where |
|---|---|---|---|
| **D** | **measured, enable-seam** | A cap configured **after** cap-less admissions is enforced against a counter that never counted them. Measured: promotion enabled with `entrantCap: null`, three first-time entrants admitted (counter never written); the promotion rewritten with `entrantCap: 1` and a fresh digest (the only way past the drift fence, i.e. a re-enable); the **fourth** first-time entrant is **admitted** — entrants 4, `entrantCount` 1. Reachable only through the unbuilt enable / re-enable transition; A+B's runtime rows are not wrong. The enable transition must either initialise `entrantCount` from the entrant documents or refuse to change the cap once an entrant exists. `sprint-w7-exp1-cap-edges.test.ts` D fails at its contract assertion on `8a434dd7` (a fail-first for that packet). | `award.ts:122-127`, `:169-171` |
| E | measured, closes a gap | The form path under a cap had no test. Measured: a form-only first entrant against a full cap is refused `capReached`, recorded, no entrant (E1); with room, admitted and counted (E2). PASS. | `award.ts:326-328`, `:343` |
| **G** | **measured, freeze-seam** | `converged` (writes 0 and fenced 0, `reconcile.ts:136`) counts a post-cutoff row's **recorded `afterCutoff` refusal** as a write (`:76`). Measured on a goal still open after the promotion's cutoff (`status: closing`, `windowEndsAt` in the past): pass 1 `{processed 1, writes 1, converged false}`, pass 2 `{1, 0, true}`, **a member moves**, pass 3 `{2, 1, false}` (the new row refused `afterCutoff`, recorded), pass 4 `{2, 0, true}`. So on an open goal the freeze precondition `CONTRACT.md:187-189` describes ("zero unprocessed rows with `createdAt < windowEndsAt`") is not what `converged` computes: pool-irrelevant rows keep flipping it, and a pass that starts before the cutoff has passed by the server's clock can report `converged: true` while a pre-cutoff row is still in flight. The close → frozen transition (not built) needs (i) to start its pass after `windowEndsAt` by Firestore's clock and (ii) a convergence definition over pool-relevant rows only. `sprint-w7-exp1-freeze.test.ts` F records it. | `reconcile.ts:76`, `:136` |
| F1 | doc / code | `CONTRACT.md:155` says the dedupe race "fails with ALREADY_EXISTS"; the code's mechanism is the loser's **ABORTED** retry after its read of the absent source row is invalidated, then `replay` (`award.ts:209-212`); ALREADY_EXISTS is not retryable and nothing catches it. The behaviour is right (scenario A); the sentence is not. | `CONTRACT.md:155` |
| F2 | doc / code | "Every write is create-or-noop under a deterministic id" (`CONTRACT.md:115`, `award.ts:9-11`) is not literally true: the counter and tally are `FieldValue.increment` merges and the entrant id is random; their idempotence is borrowed from the co-transactional `tx.create` on a deterministic id. Convergence holds (rows 16 / 17, scenarios A–C) by that mechanism, which the docs should state. | `award.ts:170`, `:255`, `:356`, `:82-85` |
| F3 | doc / code | `EVIDENCE.md:64-66` says production shares the emulator's "optimistic transaction semantics"; the server SDK locks read documents (pessimistic). End state is the same; liveness under a cap burst differs, and a transaction that loses the default 5 attempts throws rather than recording. | `EVIDENCE.md:64` |
| F4 | doc / schema | Entries carry `tickets` and `goalId` (`award.ts:246`, `:249`, `:348`), absent from the §(b) schema; `tally.entryCount` is incremented by `formBonusEntries` (`:356`), so it counts tickets while one bonus entry document is written. | `CONTRACT.md:80-81` |
| **F5** | **enable-seam** | `eligibleGoalIds` — the array the proposed trigger routes on (`trigger.ts:25`, `array-contains`) — is not in the contract's schema table (`CONTRACT.md:75`), not validated (`policy.ts:115-136` reads `eligibleGoals` only), not digested (`:182-196`), and written only by the fixture (`fixtures.ts:259`). A promotion seeded exactly per the schema (no `eligibleGoalIds`) validates, digests and awards through reconcile, while the trigger transport silently awards nothing; a goal added to or dropped from that array after enablement is not `configDrift`. Harmless to the award (it re-reads the digested `eligibleGoals` and refuses `goalNotInPromotion`), but the enable transition must derive and digest it. | `trigger.ts:25` |
| F6 | doc | Cites: `EVIDENCE.md:14-21` line counts do not match the files at `8a434dd7` (e.g. `policy.ts` 240, not 226; `8a434dd7` changes no source after `3fbfb0ad`); `CONTRACT.md:186` `:3549` → `:3550`; `CONTRACT.md:39` `:7985-8010` is `wsfEventContext`, `resolveTurnEvent` is defined at `:7646-7710`. Cosmetic; the claims hold. | `EVIDENCE.md:14` |
| F7 | doc / code | The bonus entry id is documented as `f_{entrantId}` (`CONTRACT.md:141`, `:157`); the code writes `b_{entrantId}` (`adjudicate.ts:83-85`, `award.ts:344`); `f_` is the receipt **source** key (`adjudicate.ts:78-80`). | `adjudicate.ts:84` |
| F8 | doc / code | "The code refuses to enable a promotion without a value" (`CONTRACT.md:167`, `:271`): no enable step exists in `src/`; the code refuses to **adjudicate** under an invalid or drifted configuration (`policy.ts:220-227`). Writing an `enabled` promotion with no `repeatRule` succeeds; it is fenced `invalidConfig` at ingest, which is the property the rows prove (23, 24). | `CONTRACT.md:167` |
| N1 | note | `storedVerdict` returns `sourceKey: ''` on replay; no consumer reads it today (tests match `entryId` only); latent for a next-phase caller. | `award.ts:179` |
| N2 | note | The form receipt is read from the owning store **before** the transaction and before the fence (`award.ts:297` precedes `:300-304`), once, and reused across retries; its `completedAtMs` is the adapter's, stored as `sourceCommittedAtMs` (`:336`) though it is not a WSF commit instant. No write results on a fenced promotion; §(e) should state that receipts are immutable and store-timestamped. | `award.ts:297` |
| N3 | note | `classifyEntryStatus` returns `pending` for a real contribution to a goal the promotion never lists (no source row will ever exist for it), if a future "My entries" caller passes it. The caller must apply eligibility first; the function cannot. | `status.ts:26` |
| N4 | note | Row 10's consent scan iterates entries, sources and tallies but not the entrant and link documents written in the same transaction (`form.test.ts:192-194`); today those are fixed-field writes. | `form.test.ts:192` |

**Smallest exact defect:** none in a delivered row — every routed row, every re-derived concurrency result and every mutation behaves as recorded. **D** and **G** are measured behaviours at the two transitions the packet explicitly did not build (enable / re-enable, close → freeze), and **F5** is the field that transition must own; they are reported on #467 as bounded, measured seam findings with their fail-firsts, for the Director's disposition and for the next packets' scope. The doc / code mismatches F1–F4, F6–F8 are corrections to the record, not to behaviour.

## 22.7 · Bound and hygiene

- Chromium irrelevant (no UI); no image export. No cloud action, deployment, wiring, IAM, secret, public UI or owner-policy default. EXP1 source untouched (`git diff --quiet` in the worktree after every mutation and at the end; head `8a434dd7`).
- W7's evidence: `docs/westayfit/qa/sprint-w7-exp1-concurrency.test.ts` (A–C, 9 / 9), `sprint-w7-exp1-cap-edges.test.ts` (D fails at its contract assertion on this head; E1, E2 pass), `sprint-w7-exp1-freeze.test.ts` (F, 1 / 1 — records the measured passes), `sprint-w7-exp1-jest.config.cjs` (inert in the repo: no config in `apps/` or `functions-westayfit/` matches them; run from a scratch directory against a detached worktree of the head under review).
- Method for the trust questions: my own reading of every file in the lane and the cited `index.ts` ranges, with four independent adversarial source reviews (transaction, cap / counter, cutoff / digest, product / privacy) run in parallel over the read-only worktree; every finding kept here was re-verified by me against `file:line`, and D, E and G were measured rather than reasoned.
- `ts:check` 0; evidence guard 9 frozen / 20 accepted intact; no artifacts committed.
- Not measured: live Firestore contention (the server SDK holds locks on read documents and defaults to 5 attempts; the emulator resolves at commit — end state identical, liveness not identical); that a live server timestamp equals the transaction's commit instant (measured against the emulator's process clock only); the trigger as a registered trigger; any store behind the receipt adapter; the enable / close / freeze / draw transitions (not built).
- **Status:** tested only. W7 accepts, integrates and stages nothing.

# Check 23 — EXP1's delta `3b9963c9` on reviewed `8a434dd7` (#467), delta only: **PASS on every item; the six changed behaviours proved on the successor and shown failing on the reviewed head; nothing weakened**

Routed by the Director on #434 (`5808655361`; disposition #467 `5808655210`). Check 22's batteries (67 / 67 ×3, 81 / 81, the concurrency re-derivation, the mutations) are carried, not rerun.

## 23.1 · Scope, verified by git

- `8a434dd7..3b9963c9` is **one commit**, exactly **eight files**, all inside the reservation: `docs/westayfit/expo-prize/{CONTRACT,EVIDENCE,README}.md`, `src/expo-prize/{award,status}.ts`, `tests/expo-prize/{award,form,pure}.test.ts` (+114 / −58). Nothing outside the lane; `functions-westayfit/src/index.ts`, `firestore.rules`, `firestore.indexes.json`, `firebase*.json` and `apps/westayfit/app` contain no `expo-prize` / `wsfPromotion` reference at `3b9963c9` — no export, registration, rules, index, config, route or deployment path.
- Detached worktree at `3b9963c9`, never pushed, not edited (`git diff --quiet` after every mutation and at the end).

## 23.2 · Suite and typecheck

| run | result |
|---|---|
| EXP1 suite at `3b9963c9`, once, documented command shape | **68 passed, 0 failed** — `pure` 39 (+1), `award` 14, `form` 6, `cap` 6, `reconcile` 3 |
| `tsc --noEmit -p functions-westayfit/tsconfig.json` | **0 errors** |

Initial run; no rerun was needed.

## 23.3 · The changed behaviour, proved (W7's instrument `sprint-w7-exp1-delta23.test.ts`, run against **both** heads through `W7_EXP1_WT`)

| item | on `3b9963c9` | on `8a434dd7` (fail-first) |
|---|---|---|
| **1** replay reports the actual non-empty source key | **PASS**: movement replay `sourceKey` = `c_{goalId}_{uid}_{attemptId}` = `entryId`; form replay `sourceKey` = `f_{receiptId}`, `entryId` = `b_{entrantId}` (`award.ts:179-184`, `:215`, `:308`) | FAIL: `sourceKey: ''` |
| **2** disabled / frozen and replay paths do not call `FormReceiptSource` | **PASS**: a spy store counted **0 reads** across `disabled`, `frozen`, `draft` and a missing promotion (all `fenced`, nothing written), then **exactly 1 read** for the accepted claim and **0 further reads** across three replays (`award.ts:306-316`: the read sits behind the fence and the dedupe) | FAIL: 4 reads for the four fenced claims, 4 for the accepted claim + 3 replays |
| **3** a retried transaction re-reads the receipt and cannot reuse a stale one | **PASS**: the spy's first read invalidates the transaction's read of the promotion document (an unrelated, undigested field) so the SDK retries; **3a** same answer on the retry → 2 reads, `accepted`, one of everything; **3b** the store's answer changes to another subject on the retry → 2 reads, `refused / subjectMismatch`, **nothing written** | FAIL: 1 read in both; 3b **accepted the stale receipt** |
| **4** an unlisted goal yields `notEntered / goalNotInPromotion`, never `pending` | **PASS**: `classifyEntryStatus({ active, goalEligible: false, contributionExists: true, source: null })` → `notEntered / goalNotInPromotion` (`status.ts:30`); the four original answers and the inactive-never-pending rule unchanged | FAIL: `pending` |
| **5** privacy scans include document ids and entrant / link documents | **PASS by diff and by mutation**: row 26 now scans the ids of entrants, sources, entries and tallies as well as values (`award.test.ts:313-319`), row 10 now scans entrants and links (`form.test.ts:93`). Controls on the worktree copy, each restored: entrant id derived from the uid → **row 26 fails (1 / 1)**; a `marketingOptIn` field on the entrant document → **row 10 fails (1 / 1)** | the same mutations were not scannable before (values-only; entries / sources / tallies only) |
| **6** docs record the Check 22 corrections and keep D / G / F5 explicitly not built | **PASS by reading**: `CONTRACT.md` — ABORTED-retry-then-replay (`:158-160`), idempotence borrowed from the co-transactional creates (`:115-120`), `b_{entrantId}` / `f_{receiptId}` (`:144`, `:161-162`), `tickets` / `goalId` and `entryCount` counting tickets (`:80-81`), "refuses to adjudicate" (`:176-178`, `:285`), cites `:3550` and `resolveTurnEvent :7646-7710`, `eligibleGoalIds` "must be derived … by the enable step, **which is not built**" (`:75`), the cap seam "**W7 D, not built**" (`:165-168`), the freeze's two guards "this packet does not build" (`:195-203`); `EVIDENCE.md` — pessimistic locking and the fifth-attempt throw (`:64-69`), a "Corrections after W7 Check 22" section naming D / G / F5 as not built (`:132-151`), the line-count table now matching `wc -l` for every source and test file (one residual: the jest config is 20 lines, listed as 21). `README.md:36` says the corrections commit is "pushed only on release"; it was pushed under the owner's environment rule (EXP1 said so, #467 `5808389267`) — a one-line status inaccuracy, not a claim about behaviour |

## 23.4 · Nothing weakened — reconfirmed on the successor with W7's own instrument

| property | on `3b9963c9` |
|---|---|
| contribution persistence + dedupe (A ×3) | **PASS**: six concurrent first ingestions → `[accepted, replay ×5]`, one of everything, the contribution row's data and `updateTime` identical |
| one bonus under contention (B ×3) | **PASS**: 1 accepted, 3 refused `bonusAlreadyAwarded` recorded |
| cap atomicity (C ×3) | **PASS**: exactly 2 of 6 under cap 2, counter 2, all six contributions and totals intact, replay admits nobody |
| form path under a cap (E1, E2) | **PASS** |
| D (cap after cap-less admissions) | still fails at its contract assertion — **by design, not built**, exactly as the docs now say |

The diff itself touches no adjudication rule, no write, no id, no fence order: `award.ts` moves the receipt read from before the transaction to after the fence and the dedupe inside it, and passes the known `sourceKey` into `storedVerdict`; `status.ts` adds one input and one early return; the tests widen two scans.

## 23.5 · Bound and hygiene

- No edits to EXP1; no visual export; emulators only; no cloud action. Initial results are reported above; no reruns were needed and none were taken.
- Unmeasured: the same as Check 22 (live contention, live server-timestamp semantics, the trigger as a trigger, a real receipt store, the unbuilt transitions). Item 3's retry was forced by invalidating the transaction's read set through the spy; a naturally contended retry was not separately driven.
- Evidence: `docs/westayfit/qa/sprint-w7-exp1-delta23.test.ts` and the updated `sprint-w7-exp1-jest.config.cjs` (worktree selectable by `W7_EXP1_WT`); the earlier Check 22 files unchanged.
- `ts:check` 0; evidence guard 9 / 20 intact; no artifacts committed.
- **Status:** tested on `3b9963c9`; delivered by EXP1, not accepted, not integrated; W7 accepts, integrates and stages nothing.

# Check 24 — EXP2A's enable transition `41cb6dff` on exact parent `63a2c4df` (#469): **PASS on every item; the seven boundaries proved by W7's own instrument; the five mutation controls fail for their intended reasons; persistence, dedupe and cap atomicity unchanged**

Routed by the Director on #434 (`5811159705`; source disposition #469 `5811159960`). Checks 22 / 23 batteries carried where dependencies are unchanged; W7 G, wiring, UI and deployment stay unbuilt / unmeasured.

## 24.1 · Scope, verified by git and grep

- `63a2c4df..41cb6dff` is **one commit**, exactly **nine files**, all inside the reservation: `src/expo-prize/enable.ts` (new, 105), `policy.ts`, `index.ts` (barrel), `tests/expo-prize/enable.test.ts` (new, 260), `fixtures.ts`, `pure.test.ts`, and the three docs (+585 / −20). `3b9963c9` is an ancestor; the parent is the merged #467 head.
- No `expo-prize` / `wsfPromotion` reference in `functions-westayfit/src/index.ts`, `firestore.rules`, `firestore.indexes.json`, `firebase*.json`, `.github`, `apps/westayfit/app` or `apps/westayfit/src` at `41cb6dff`: no root export, callable / trigger registration, rules, index, config, UI or workflow wiring. The barrel export (`index.ts:15`) is inside the module and nothing imports the module.
- Detached worktree at `41cb6dff`, never pushed, not edited (`git diff --quiet` after every mutation and at the end).

## 24.2 · Suite and typecheck

| run | result |
|---|---|
| EXP2A core at `41cb6dff`, once, documented command shape | **83 passed, 0 failed, 0 pending** — `pure` 45, `award` 14, `form` 6, `cap` 6, `reconcile` 3, `enable` 9 (all emulator; proof 5 ×3) |
| `tsc --noEmit -p functions-westayfit/tsconfig.json` | **0 errors** |
| real core after the five mutations were restored | **83 / 83** |

Initial run only; no failures, no reruns, no skips.

## 24.3 · The changed boundaries, proved (W7's instrument `sprint-w7-exp2a.test.ts` on `41cb6dff`; own seeding, raw reads, the promotion document compared byte-for-byte **including `updateTime`** around every fenced or refused call)

| boundary | result |
|---|---|
| **invalid / missing decisions → no write, field named** | **PASS**: 16 cases (`repeatRule` missing / bogus; `entrantCap` missing / 0 / 1.5; `eligibleGoals` empty / half-formed; window inverted / start missing; `ruleVersion` missing / 0; `formBonusEntries` −1; `operatorUids` missing / empty / invalid / duplicate) → `refused / invalidConfig` naming the field; document unchanged including `updateTime` (`enable.ts:88-91`) |
| **stored routing array replaced by the sorted derived ids; drift fences, never reroutes** | **PASS**: three goals listed out of order with a forged array → enabled with the sorted derived triple, digest = `configDigest(validate(doc))`, `enabledAt` a server `Timestamp` (`enable.ts:93-102`; `policy.ts:208-211`). Then **missing**, **reordered**, **widened**, **edited** and **narrowed** arrays each → `readPromotion` `fenced / configDrift`, a direct ingest `fenced / configDrift`, no source row written; where the trigger body still finds the document by `array-contains` (reordered / widened / edited / narrowed) its routed award is `fenced / configDrift`, and when the array is missing it is not routed at all; a goal smuggled into the array only never awards; the exact derived array restores adjudication (`policy.ts:269-274`) |
| **any entrant, uid link or nonzero counter blocks enable, incl. a cap-null promotion returned to draft** | **PASS**: enabled cap-less, one real admission (counter never written); set back to `draft` with `entrantCap: 1` → `fenced / enableArtefactsPresent`, unchanged; artefacts scrubbed → `fenced / entrantsExist`, unchanged, counter still absent (never initialised); on fresh drafts an entrant document alone, a uid link alone and a counter of 1 alone each → `fenced / entrantsExist`, unchanged; a counter of **0** alone does not block (`enable.ts:51-68`, `:80-85`) |
| **all non-draft states and enable artefacts block without mutation** | **PASS**: `enabled`, `closing`, `disabled`, `frozen`, `drawn`, `archived` and an unknown status → `fenced / notDraft`, unchanged; a draft carrying a digest only, `enabledAt` only, or both → `fenced / enableArtefactsPresent`, unchanged; a missing document → `promotionMissing`; a second enable on an enabled document is fenced and the enablement byte-identical (`enable.ts:76-82`) |
| **concurrent enables → one immutable enablement, no partial state** | **PASS ×3**: eight concurrent `enablePromotion` on one draft → exactly 1 `enabled`, 7 `fenced / notDraft` (status `enabled`); the document carries `enabled`, the sorted derived array, one digest equal to `configDigest(validate(doc))` and equal to the winner's returned digest, one server `enabledAt`; `readPromotion` active (the one `tx.update`, `enable.ts:97-102`, and the SDK's ABORTED retry of the losers) |
| **operator uids nonempty / valid / unique, canonical for the digest, not exposed** | **PASS**: validation refuses missing, empty, invalid and duplicate (`policy.ts:158-177`); `['b','a']` and `['a','b']` digest identically and differ from `['a']` (sorted into the policy, `:200`; digested, `:235`); after enable and a real award, the operator uid appears in **0** documents across sources, entries, entrants, links, tallies, counters, contributions and member totals (a full-collection string scan) — it lives in `wsfPromotions` only, which has no rules block (catch-all deny) and no reader; a post-enable operator edit is `configDrift`. Nothing reads the list for authorisation (no callable exists) |
| **award persistence, replay / dedupe, contribution integrity unchanged** | **PASS**: W7's Check 22 instrument on `41cb6dff` (fixture now names an operator, as the candidate requires): A ×3 six concurrent first ingestions → `[accepted, replay ×5]`, one of everything, the contribution row's data and `updateTime` identical; B ×3 one bonus, three recorded refusals; C ×3 exactly 2 of 6 under cap 2, counter 2, all six contributions and totals intact, replay admits nobody |

## 24.4 · The five disclosed mutation controls, re-applied on the worktree copy and restored

| mutation (EXP1 `EVIDENCE.md` §EXP2A) | EXP1 recorded | measured here | caught by |
|---|---|---|---|
| M8 fence admits `enabled` (`enable.ts` `status !== 'draft'` → also `enabled`) | 4 failed / 5 | **4 / 5** | proof 4, proof 5 ×3 — an enabled document re-enabled / eight enables not converging |
| M9 admission check removed (`if (false && await anyAdmission(…))`) | 1 / 8 | **1 / 8** | proof 3 — the admitted draft enables |
| M10 stored array trusted on enable | 2 / 7 | **2 / 7** | the first-enable row and proof 2 — the forged array survives |
| M11 array drift check removed in `readPromotion` (`policy.ts`) | 2 / 52 | **2 / 52** | proof 2 and the pure `readPromotion` ordering — a reordered array adjudicates |
| M12 artefact check removed (`if (false)`) | 1 / 8 | **1 / 8** | proof 3 — the returned-to-draft document passes the artefact gate (and is then caught only by `entrantsExist`, which the row asserts first) |

Each fails for its intended reason; no broader mutation work was done.

## 24.5 · Docs and bound

- `CONTRACT.md` §(d′) describes exactly the transaction read here (reads, decide, one write; the outcome table); D and F5 are marked closed with the Director's rulings; "W7 G … not built" and "the next packet" are explicit (`CONTRACT.md:239-241`; `EVIDENCE.md` §EXP2A "Unmeasured"). `EVIDENCE.md` §EXP2A's 83 / 83, five controls and unmeasured list match what was measured here.
- One reading note, not a defect: `readPromotion` now requires `operatorUids` and an exact stored `eligibleGoalIds`, so any promotion document written before EXP2A (e.g. fixture-seeded with `operatorUids: []`) is `invalidConfig` / `configDrift` until re-enabled through `enablePromotion`. No such document exists outside tests; the contract's "every decision explicit" intends it.
- **Unmeasured:** the enable-vs-award race (an admission landing while enable runs — the award fences under `draft`, so only a pre-existing admission is possible, which is covered); live Firestore query-in-transaction contention; W7 G / `closing → frozen` / the pool; wiring, UI, deployment.
- Evidence: `docs/westayfit/qa/sprint-w7-exp2a.test.ts`; `sprint-w7-exp1-concurrency.test.ts` (operator named); run from the scratch directory against the detached worktree with `W7_EXP1_WT`. `ts:check` 0; guard 9 / 20; no artifacts committed.
- **Status:** tested on `41cb6dff`; delivered by EXP1, not accepted, not integrated; W7 accepts, integrates and stages nothing.

# Check 25 — EXP2B's close → reconcile → freeze `e0171fd1` on exact parent `41cb6dff` (#470): **PASS on every item; the changed boundaries proved by W7's own instrument; all nine disclosed controls fail for their intended reasons; nothing weakened; no defect**

Routed by the Director on #434 (`5813669831`; source disposition #470 `5813666025`). Checks 22–24 carried where their dependencies are unchanged (`enable.ts`, `policy.ts`, `adjudicate.ts`, `form.ts`, `status.ts`, `trigger.ts` and the six earlier test files are byte-identical to `41cb6dff`).

## 25.1 · Scope, verified by git and grep

- `41cb6dff..e0171fd1` is **two commits** (`6cc0a36e` code / tests / docs → `e0171fd1` evidence), a linear chain on the parent (`merge-base --is-ancestor` true, `rev-list --count` 2), exactly **14 files** inside the reservation (+1850 / −25): new `close.ts` (63), `freeze.ts` (412), `pool.ts` (195), `close.test.ts`, `freeze.test.ts`, `pool.test.ts`; changed `award.ts` (two collection names, two refs), `reconcile.ts` (the page query extracted as `contributionPageQuery` / `clampPageSize`, behaviour unchanged), `index.ts` (barrel), `fixtures.ts`, and the four docs.
- No `expo-prize` / `wsfPromotion` reference in `functions-westayfit/src/index.ts`, `package.json`, `tsconfig.json`, `firestore.rules`, `firestore.indexes.json`, `firebase*.json`, `.github`, `apps/westayfit/app`, `apps/westayfit/src` or the root `package.json`: no root export, callable / trigger registration, rules, index, config, package, app, workflow or deployment wiring. "draw" occurs in `src/expo-prize` only as the `'drawn'` status name and in comments stating there is none; no selection, prize, winner or contact code exists.
- Detached worktree at `e0171fd1`, never pushed, not edited (`git diff --quiet` after every mutation and at the end).

## 25.2 · Lane and typecheck

| run | result |
|---|---|
| EXP2B lane at `e0171fd1`, once, documented command shape | **116 passed, 0 failed, 0 pending** (59 s) — `pure` 45, `award` 14, `enable` 9, `pool` 8, `form` 6, `reconcile` 3, `close` 8, `cap` 6, `freeze` 17 |
| `tsc --noEmit -p functions-westayfit/tsconfig.json` | **0 errors** |
| real core after the nine mutation restores | **116 / 116** |

Initial run only; no failures, reruns or skips. (EXP1's table says `close` 11 / `freeze` 16; the files hold 8 and 17 test cases — 25 either way — a count-by-row vs count-by-case difference, not a discrepancy in what ran.)

## 25.3 · The changed boundaries, proved (W7's instrument `sprint-w7-exp2b.test.ts` on `e0171fd1`; own seeding through the real enable and close transitions, raw reads, the promotion and pool documents compared byte-for-byte **including `updateTime`** around every fenced or refused call; every cutoff waited out on Firestore's own clock by a `serverTimestamp()` probe read back)

| boundary | result |
|---|---|
| **close is digest-valid, one-way, idempotent; fences are byte-identical no-writes** | **PASS**: `enabled` → `closing` with only `status` and `closingRequestedAt` changed (`close.ts:57-60`); three repeats → `alreadyClosing`, document identical; `enablePromotion` on it → `notDraft`; `draft` / `disabled` / `frozen` / `drawn` / `archived` / an unknown status → `fenced / notEnabled` identical; a cap edit after enablement → `configDrift`; `operatorUids: []` → `invalidConfig`; missing → `promotionMissing`; six concurrent closes → 1 `closed`, 5 `alreadyClosing` |
| **only the read-back marker time permits a pass; a before-cutoff attempt writes only its marker** | **PASS**: with the cutoff 2.5 s ahead the attempt returned `notReady / beforeCutoff` with `startedAtMs` 2,460 ms before the cutoff, equal to the marker's stored `startedAt`, `pass: null`; exactly one new marker; promotion document and pool untouched (`freeze.ts:163-176`, `:381-386`); after Firestore's clock passed the cutoff the next attempt ran the pass and froze with `passStartedAtMs ≥ windowEndMs` |
| **a missing pre-cutoff verdict is adjudicated safely and requires a subsequent clean pass; post-cutoff-only rows cannot toggle readiness** | **PASS**: one adjudicated and one unadjudicated pre-cutoff row → first attempt `notReady / newAcceptedEntries`, pass `{processed 2, replayed 1, newAccepted 1, preCutoffWithoutSource 1, postCutoffIgnored 0}`, the row now `replay`, nothing frozen; then a member moves after the cutoff → the next attempt **froze** with `{processed 3, replayed 2, newAccepted 0, preCutoffWithoutSource 0, postCutoffIgnored 1}`, `totalTickets 2`; the post-cutoff row carries a recorded `afterCutoff` refusal and is not in the pool (`freeze.ts:185-235`) — the exact G behaviour the old `converged` got wrong |
| **bonus-bearing promotions refuse `formSourceUnbound` before a marker** | **PASS**: `formBonusEntries: 1`, closing, cutoff passed → `{refused, formSourceUnbound, attemptId: null}`; **0** markers, no pool, document identical (`freeze.ts:376-378`) |
| **pool ordering, ranges, totals, digest and bounds deterministic; malformed / empty / oversize fail closed; stored output carries nothing sensitive** | **PASS**: 60 mixed entries (confirmed / pending / revoked) → byte-identical pool and digest over 8 shuffles; ranges contiguous from 1 in sorted entrant order, totals consistent, digest recomputable, an edited pool fails `storedPoolIntact`; empty, all-pending, a malformed id, a negative ticket and 20 000 long entrants each refused before any write (`pool.ts:106-160`). A real frozen pool (two entrants, 1 + 2 tickets from three contributions) holds exactly the ten documented keys, its ranges name the entrant documents' opaque ids, and its serialization contains **none** of 19 forbidden strings (both uids, the goal id, the group id, the three attempt ids, the three contribution ids, `c_` / `f_` / `b_`, `@`, the operator uid, `count`, `createdAt`, `userId`, `email`) |
| **foreign / existing pools never overwritten; pool creation and `closing → frozen` atomic; concurrent finalizers and retries yield one byte-stable pool** | **PASS ×3**: a planted foreign pool under `closing` → `fenced / poolExistsWithoutFrozen`, pool and promotion byte-identical (`freeze.ts:286`); an abort after both writes were queued leaves no pool and `closing` (`:317-329`); six concurrent finalizers → exactly 1 `replay: false`, 5 `replay: true`, one digest, all receipts `{3 tickets, 3 entrants}`; three retries replay and the pool and promotion documents are byte-identical after them |
| **after `frozen`, award / reconcile / enable / close cannot change the pool** | **PASS**: a post-freeze contribution persists as movement but its award is `fenced / promotionInactive`; `reconcilePromotion` `{processed 0, writes 0, converged false}`; enable `notDraft`; close `notEnabled`; freeze replays; pool and promotion byte-identical |
| **award persistence, replay / dedupe, cap atomicity unchanged** | **PASS**: the Check 22 instrument on `e0171fd1` — A ×3 (`[accepted, replay ×5]`, one of everything, the contribution row's data and `updateTime` identical), B ×3 (1 bonus, 3 recorded refusals), C ×3 (exactly 2 of 6 under cap 2, all movement intact) |

## 25.4 · The nine disclosed controls (M13–M18), re-applied on the worktree copy and restored

| mutation (EXP1 `EVIDENCE.md` §EXP2B) | EXP1 recorded | measured here | caught by |
|---|---|---|---|
| M13 marker guard removed | 1 failed / 16 | **1 / 16** | proof 1 |
| M14 missing-source guard removed (`preCutoffWithoutSource += 0`) | 3 / 14 | **3 / 14** | proofs 1, 2a, 2b |
| M15 form fence removed | 1 / 16 | **1 / 16** | proof 5 |
| M16 size fence removed (`pool.ts`) | 2 / 23 | **2 / 23** | proof 8, pool "oversize" |
| M17a pool existence check removed | 1 / 16 | **1 / 16** | proof 12 |
| M17b … plus `create` → `set` | 1 / 16 | **1 / 16** | proof 12 |
| M17c pool written outside the transaction | 4 / 13 | **4 / 13** | proof 13, proof 9 ×3 |
| M17d status change not on the promotion | 6 / 11 | **6 / 11** | proofs 1, 6, 9 ×3, 10 |
| M18 post-cutoff rows counted against readiness | 1 / 16 | **1 / 16** | proof 3 (G is load-bearing) |

Each fails for its intended reason with EXP1's exact count; no broader mutation work.

## 25.5 · Notes, bound and hygiene

- **One reading note, not a defect:** `freeze.ts:243` and two lines of `fixtures.ts` (`:292`, `:367`) end their prefix cursor with a **literal** U+F8FF character (bytes `EF A3 BF`), which renders as nothing in most terminals and diff views; `enable.ts:58` writes the same bound as the visible escape ``. Measured: the query is correct (the escape-free shape `endAt(prefix)` would return zero documents in the emulator, inside and outside a transaction; the literal returns the prefix set). A reviewer reading the source cannot see the character; the escape would make the bound reviewable. Behaviour is right.
- **Kept unmeasured / unbuilt, as required:** live-Firestore semantics (query-in-transaction, commit-timestamp monotonicity, the marker argument), sustained-contention liveness (six concurrent finalizers ×3 here), form-store binding (`formSourceUnbound` is a refusal, not a seam), wiring, UI, draw, deployment, drift injected mid-pass.
- Evidence: `docs/westayfit/qa/sprint-w7-exp2b.test.ts`, run from the scratch directory against the detached worktree with `W7_EXP1_WT`; the Check 22 concurrency instrument reused. `ts:check` 0; guard 9 / 20; no artifacts committed.
- **Status:** tested on `e0171fd1`; delivered by EXP1, not accepted, not integrated; W7 accepts, integrates and stages nothing.

## 25D · Delta-only verification of the EXP2B successor `24d95cfe` on exact parent `e0171fd1` (Director #434 `5815138664`): **PASS**

Check 25's functional / privacy / atomicity PASS on the parent carries; nothing was rerun.

| item | verified |
|---|---|
| lineage | `24d95cfe` has the single parent `e0171fd1`; `rev-list --count e0171fd1..24d95cfe` = 1 |
| the delta | exactly three files, **+4 / −4**: `EVIDENCE.md:232` (`close` 11 / `freeze` 16 → `close` 8 / `freeze` 17; the 33 / 33 and 116 / 116 rows and every other measurement untouched); `freeze.ts:243` (literal U+F8FF → ``); `fixtures.ts:292`, `:367` (the same). Nothing else in the diff |
| escapes reviewable and byte-equivalent | the three lines now read `` `${promotionId}_` `` in plain source; no literal U+F8FF (bytes `EF A3 BF`) remains in any file of the lane at `24d95cfe`; in Node, `'' === Buffer.from([0xef,0xa3,0xbf]).toString('utf8')` is `true` (code point `f8ff`), and the template form compares equal — the compiled query bound is byte-identical to the parent's |
| labels truthful | Check 25's own run counted `close` 8 and `freeze` 17 cases (with `pool` 8 = 33 new; 116 total); `EVIDENCE.md:232` and the #470 body's measurements table now say 8 / 17 |
| behaviour delta | none: the source change is the literal-to-escape rewrite of one bound in `freeze.ts` and two in the fixtures; no other source or test line changed |

The successor's commit message text is not product or evidence; no rewrite requested. **Status:** verified on `24d95cfe`; not accepted, not integrated; W7 accepts, integrates and stages nothing.

# Check 26 — EXP3A's private "My entries" read `80615cae` on exact parent `24d95cfe` (#471): **one DEFECT on item 5 (the stored-pool integrity boundary); every other routed item PASS; the smallest correction named and shown sufficient locally; `80615cae` unchanged**

Routed by the Director on #434 (`5816403548`; source disposition #471 `5816403835`). Checks 22–25D carried where their dependencies are unchanged (every file of the lane other than the seven delivered ones is byte-identical to `24d95cfe`).

## 26.1 · Scope, verified by git and grep

- `24d95cfe..80615cae` is **one commit**, sole parent `24d95cfe` (`rev-list --count` 1), exactly **7 files** inside the reservation (+859 / −9): new `receipt.ts` (250 lines), new `receipt.test.ts`, `src/expo-prize/index.ts` (one barrel line), `CONTRACT.md`, `TEST-MATRIX.md`, `README.md`, `EVIDENCE.md`. `fixtures.ts` untouched.
- No `readMyEntries` / `receipt` / `expo-prize` / `wsfPromotion` reference in `functions-westayfit/src/index.ts`, `package.json`, `tsconfig.json`, `firestore.rules`, `firestore.indexes.json`, `firebase*.json`, `.github`, `apps/westayfit/app`, `apps/westayfit/src` or the root `package.json`: no root export, callable, trigger, rules, index, config, package, app, workflow or deployment wiring. Nothing is reachable.
- Detached worktree at `80615cae`, never pushed; `git diff --quiet` after every mutation, after the trial patch below, and at the end.

## 26.2 · Lane and typecheck

| run | result |
|---|---|
| EXP lane at `80615cae`, once, documented command shape | **127 passed, 0 failed, 0 pending** (10 files; `receipt` 11 = R1–R8 emulator + P9–P11 pure) |
| `tsc --noEmit -p functions-westayfit/tsconfig.json` | **0 errors** |
| real core after the six mutation restores | **127 / 127** |

Initial run only; no failures, reruns or skips.

## 26.3 · The routed items, proved (W7's instrument `sprint-w7-exp3a.test.ts` on `80615cae`; own seeding through the real `wsfContribute`, `ingestContribution`, `enablePromotion`, `closePromotion` and `freezePromotion`, every cutoff waited out on Firestore's own clock; raw reads; every lane document compared byte-for-byte **including `updateTime`** around the reads)

| item | result |
|---|---|
| **2 · non-vacuous account isolation; sequential and concurrent switching on one deps object** | **PASS**: six (uid, promotion) pairs with distinct true values `[3, 1, 0, 2, 0, 4]` (a stranger and a second promotion included) read **24 times sequentially** and **18 times concurrently** on one `deps`, every answer exact; no value carried between subjects |
| **3 · current count is confirmed positive-integer entries only** | **PASS**: six entries for one member — `revoked`, `pending`, `tickets: "two"`, `0`, `2.5` count zero and one `confirmed 3` counts 3 → **3** while the entrant tally says 99; the other member 2 (`receipt.ts:98-106`) |
| **4 · provisional → settled through `frozen` / `drawn` / `archived`, zero states included** | **PASS**: 2 / 0 (never linked) / 0 (linked, every entry revoked before the freeze) provisional; the same under `closing`; **2 / 0 (no link) / 0 (absent from the pool)** settled under each of the three statuses; entries edited to 50 tickets after the freeze do not move the settled 2; `draft`, `disabled`, an unknown status, a missing promotion, a malformed uid and a malformed promotion id → `unavailable` with the reason only in the trace |
| **5a · configuration drift and missing / corrupt / unbound pool fences** | **PASS**: before the freeze, `entrantCap` 4 and a rerouted `eligibleGoalIds` → `unavailable`, restored → 2; after the freeze: missing pool → `poolMissing`; an edited range with the stale digest → `poolCorrupt`; another promotion's intact pool → `poolUnbound`; the intact pool with the promotion's stamped digest edited → `poolUnbound`; **the intact pool with `ruleVersion` + 1 and its digest recomputed and stamped** → `poolUnbound`; **the same with a foreign `enabledConfigDigest`** → `poolUnbound`; drift after the freeze → `configDrift`; every restore → 2 (`receipt.ts:213-229`) |
| **5b · the whole stored-pool integrity boundary with a recomputed digest** | **DEFECT** — §26.4 |
| **6 · exact allow-list, deep privacy, no mutation** | **PASS**: every receipt is exactly `{status, tickets, settled}` or `{status}`; 29 forbidden strings (uids, entrant ids, promotion and goal ids, digests, operator uid, attempt ids, contribution paths, collection names, trace reasons) absent from every serialised receipt; 15 provisional / unavailable and 6 settled reads changed **no** lane document (`updateTime` included) and created none; the transaction is `{ readOnly: true }` (`receipt.ts:248`) |
| **carried** | Checks 22–25D: `award.ts`, `enable.ts`, `close.ts`, `freeze.ts`, `pool.ts`, `policy.ts`, `status.ts`, `reconcile.ts`, `form.ts`, `trigger.ts`, `adjudicate.ts`, `fixtures.ts` and their tests are byte-identical to `24d95cfe`; nothing rerun beyond the lane |

## 26.4 · The defect: a structurally malformed pool with a consistent digest answers with a count

**The Director's item 5 standard** (#471 `5816403835`): "recomputed-digest malformed ranges, total/entrant-count inconsistency, overlap/gap/duplicate entrants must not yield a member count." **The contract's own shape** (`CONTRACT.md:256`, `:341`): ranges "sorted by entrant id, contiguous from 1".

**What the head checks.** `storedPoolIntact` (`pool.ts:166-195`) verifies field types and that the stored digest equals the digest recomputed from the stored content — nothing about the ranges' shape. `ticketsFromPool` (`receipt.ts:113-125`) inspects **only the reading member's own range(s)**: a malformed or duplicated own range → `null` → `unavailable`; every other range is skipped unread. Between them (`receipt.ts:218-238`) no code checks ordering, contiguity, overlap, gaps, `totalTickets` or `entrantCount`.

**Measured** (instrument D2; twelve pools, each with `poolDigest` recomputed from its own content and stamped on the promotion, so only structure can refuse it; two members, a = 2 tickets, b = 1 in the intact pool):

| stored-pool shape (digest consistent, stamped) | member a | member b |
|---|---|---|
| overlap (b's range overlaps a's: 1–2 and 2–3) | **COUNT 2** | **COUNT 2** |
| gap (1–2, then 5–5) | **COUNT 2** | **COUNT 1** |
| duplicate other entrant (b listed twice) | **COUNT 2** | unavailable |
| `totalTickets` 99 with the intact ranges | **COUNT 2** | **COUNT 1** |
| `entrantCount` 7 with the intact ranges | **COUNT 2** | **COUNT 1** |
| not starting at 1 (2–3, 4–4) | **COUNT 2** | **COUNT 1** |
| unsorted ranges (the intact ranges reversed) | **COUNT 2** | **COUNT 1** |
| other range malformed (b: 3–2) | **COUNT 2** | unavailable |
| other range non-integer (b: 2.5–3) | **COUNT 2** | unavailable |
| own range malformed (a: 2–1) | unavailable | **COUNT 1** |
| own entrant duplicated (a listed twice) | unavailable | **COUNT 1** |
| empty `ranges` with `totalTickets` 3, `entrantCount` 2 | **COUNT 0** | **COUNT 0** |

**12 of 12** shapes yield a member count for at least one member; the intact pool restored → 2 / 1. Nothing in the read is wrong about the member's *own* range, but a pool that cannot be the frozen pool (its shape is not one `buildPool` can produce, `pool.ts:136-145`) is answered from rather than refused. Not a privacy leak; a truth fence the Director required that is absent. The freeze replay guard (`freeze.ts:280`, `:367`) relies on the same `storedPoolIntact`, so the gap is the pool module's, surfaced here at the first reader.

**Smallest source correction, named** (either form; preserve `80615cae`, new commit only):

- **(a) inside the EXP3A reservation** — in `receipt.ts`, a pure `poolStructurallyValid(pool)` applied at the `poolCorrupt` fence (`:218`): `ranges` non-empty; `entrantCount === ranges.length`; entrant ids strictly increasing by code unit (unique and sorted); every `ticketStart` / `ticketEnd` an integer with `ticketEnd >= ticketStart`; the first `ticketStart` 1 and each next `ticketStart` the previous `ticketEnd + 1`; `totalTickets` equal to the last `ticketEnd`. About 18 lines and one changed condition.
- **(b) one shared boundary** — the same invariants inside `storedPoolIntact` (`pool.ts`), which also hardens the freeze replay fence; that file is outside EXP3A's reservation and is the Director's call.

**Shown sufficient, locally only:** form (a) applied to the worktree copy of `receipt.ts` (+20 / −1) → D2 **0 of 12** shapes yield a count (every row `unavailable`, trace `poolCorrupt`); C, D1 still pass; the full lane **127 / 127**; `tsc` 0. The worktree was then restored (`git diff --quiet` true). Nothing delivered, nothing pushed; W7 writes no product source.

## 26.5 · The six disclosed controls (M19–M24), re-applied on the worktree copy of `receipt.ts` and restored

| mutation (EXP1 `EVIDENCE.md` §EXP3A `:348-353`) | EXP1 recorded | measured here | caught by |
|---|---|---|---|
| M19 pending / revoked filter removed | 2 failed / 9 | **2 / 9** | R4, P10 |
| M20 pool-intact check removed | 1 / 10 | **1 / 10** | R6 |
| M21 pool-binding check removed | 1 / 10 | **1 / 10** | R6 |
| M22 settled flag lies | 4 / 7 | **4 / 7** | R5, R6, R7, R8 |
| M23 allow-list removed (`sealReceipt` spreads its input) | 1 / 10 | **1 / 10** | P9 only |
| M24 configuration gate removed on the current path | 2 / 9 | **2 / 9** | R6, R8 |

Each fails for its intended reason with EXP1's exact count. (M20 removes the digest check and is caught by R6's edited-range row; no delivered row exercises a digest-consistent malformed pool, which is why §26.4 was not visible to the delivered controls.)

## 26.6 · Notes, bound and hygiene

- **Reading note, not a defect:** the prefix cursor in `receipt.ts:154` and two lines of `receipt.test.ts` (`:94`, `:411`) end in a **literal** U+F8FF (bytes `EF A3 BF`, invisible in most views) — the shape `24d95cfe` had just rewritten to the escape `` in `freeze.ts` and `fixtures.ts`. Measured correct (the member's own entries are found); the same one-line readability rewrite applies if wanted.
- **Two fixture corrections of mine, before any verdict:** (1) test C closed the promotion explicitly and then the shared `closeAndFreeze` closed it again → `alreadyClosing`; the helper now accepts either outcome. (2) test D1 froze a second promotion over the **same goal**, whose first pass admitted the first promotion's two rows and correctly returned `notReady / newAcceptedEntries` — exactly the EXP2B behaviour Check 25 proved and the same fixture error EXP1 disclosed for R6; the helper now re-runs the pass while `notReady`, bounded at five, never masking a non-`frozen` outcome. Neither touched a measurement.
- **The committed instrument fails by design on `80615cae`** at D2's final assertion (`expect(counted).toEqual([])`), the measured defect; A, B, C, D1 and E pass (5 / 6). It passes 6 / 6 with correction (a) applied.
- **Kept unmeasured / unbuilt, as required:** live-Firestore semantics (read-only transactions, the equality + document-name query, index-freedom), reachability (no callable), post-freeze revocation, the form store, draw, wiring, UI, deployment.
- Evidence: `docs/westayfit/qa/sprint-w7-exp3a.test.ts`, run from the scratch directory against the detached worktree with `W7_EXP1_WT=../wt-exp3a`. `ts:check` 0; guard 9 / 20; no artifacts committed.
- **Status:** tested on `80615cae`; delivered by EXP1, **not accepted** (one defect on the routed item 5), not integrated; W7 accepts, integrates and stages nothing and modifies no delivery.

## 26D · Delta-only verification of the EXP3A integrity successor `ed5e0838` on exact parent `80615cae` (Director #434 `5817579314`; delivery #471 `5817447300`): **PASS on every routed item; the Check 26 defect closed on the head; no defect**

Check 26's PASS rows (items 1–4, 5a, 6, 7) carry: `receipt.ts`, `freeze.ts`, `fixtures.ts` and every other source file of the lane are byte-identical to `80615cae`; nothing outside the focused rows was rerun.

### 26D.1 · Scope, verified by git and grep

| item | verified |
|---|---|
| lineage | `ed5e0838` has the single parent `80615cae`; `rev-list --count 80615cae..ed5e0838` = 1; `80615cae` untouched |
| the delta | exactly **8 files, +246 / −5**: `pool.ts` (+42 / −2), `pool.test.ts` (+45), `receipt.test.ts` (+61), `freeze.test.ts` (+45), `CONTRACT.md`, `EVIDENCE.md`, `README.md`, `TEST-MATRIX.md`; every path under `functions-westayfit/src/expo-prize/`, `functions-westayfit/tests/expo-prize/` or `docs/westayfit/expo-prize/` |
| wiring | grep for `expo-prize`, `wsfPromotion`, `readMyEntries`, `poolStructurallyValid`, `storedPoolIntact` outside the reservation on the head → only `functions-westayfit/jest.expo-prize.config.cjs`, the lane's own pre-existing test config (present since Check 22; not in this delta); no root export, callable, rules, index, config, package, app, workflow or deployment path |
| the correction, read as source | form (b) as ruled: a pure `poolStructurallyValid` (`pool.ts:175-196`) — `ranges` non-empty; `entrantCount === ranges.length`; entrant ids matching `ENTRANT_ID_RE` and strictly increasing by `byCodeUnit` (unique and sorted); `ticketStart` / `ticketEnd` safe integers, `ticketStart >= 1`, `ticketEnd >= ticketStart`; the first start 1 and each next start the previous end + 1; `totalTickets` equal to the final end — applied inside `storedPoolIntact` after the field-type checks and before the digest recompute (`:223`). These are exactly the invariants `buildPool` guarantees (`pool.ts:136-145`), so the builder's output cannot be refused. Both readers of `storedPoolIntact` — the member read (`receipt.ts:218`) and the frozen replay fence (`freeze.ts:280`, `:367`) — are hardened without a source change to either |

### 26D.2 · Runs (worktree at `ed5e0838`; emulators only)

| run | result |
|---|---|
| focused changed rows `pool` + `receipt` + `freeze`, **first run** | **39 / 39** (pool 9, receipt 12, freeze 18); 0 failures, 0 reruns, 0 skips |
| full lane, 10 files | **130 / 130** |
| `tsc --noEmit -p functions-westayfit/tsconfig.json` | **0 errors** |
| full lane after the M25 restore | **130 / 130** |

### 26D.3 · The boundary, proved by W7's own instrument (`sprint-w7-exp3b.test.ts`; the twelve Check 26 D2 shapes, each with `poolDigest` recomputed from its own content and stamped on the promotion; real award, close and freeze; pool, promotion and marker set compared byte-for-byte including `updateTime` around every read and replay)

| item | result |
|---|---|
| the 12 recomputed-and-stamped shapes refuse **both** member reads | **12 / 12**: a and b both `unavailable`, trace `poolCorrupt` on every shape (Check 26 measured 12 / 12 counted on the parent) |
| the same shapes refuse the frozen replay | **12 / 12**: `freezePromotion` → `fenced / poolCorrupt` on every shape; pool and promotion byte-identical, marker count unchanged |
| the builder's pool still works | intact pool restored → **2 / 1** settled; `freezePromotion` → `{ outcome: 'frozen', replay: true }` with the same `poolDigest`; before any shape the same baseline held |
| Check 26's instrument on the head | `sprint-w7-exp3a.test.ts` **6 / 6** on `ed5e0838` (D2 now **0 of 12** shapes yield a count; A, B, C, D1, E unchanged) — the committed Check 26 instrument fails by design only on `80615cae` |

### 26D.4 · The disclosed control (M25), re-applied on the worktree copy of `pool.ts` and restored

| mutation (EXP1 `EVIDENCE.md` §EXP3A successor) | EXP1 recorded | measured here | caught by |
|---|---|---|---|
| M25 structural check removed (`if (!poolStructurallyValid(…)) return false;` → `if (false && …)`) | 3 failed / 36 | **3 / 36** | P12, R9, freeze 12b |

Fails for its intended reason with EXP1's exact count; the real core 130 / 130 after the restore. Not rerun, as ruled: M13–M24, the callable batteries, the concurrency runs.

### 26D.5 · Notes, bound and hygiene

- **One instrument fault of mine, before the verdict:** my first draft expected the frozen replay to return `outcome: 'replay'`; the freeze contract returns `{ outcome: 'frozen', replay: true }` for a replay of the frozen state (`freeze.ts:281`, type at `:113`). Corrected to that shape; no measurement affected (the run had not reached the shapes).
- The reading note (literal U+F8FF at `receipt.ts:154`, `receipt.test.ts:94`, `:411`) is unchanged on the head, as EXP1 disclosed; not a defect.
- **Kept unmeasured / unbuilt, as required:** live-Firestore semantics, reachability, post-freeze revocation, the form store, draw, wiring, UI, deployment; `poolVersion` remains type-checked only (no version invariant was asked for).
- Evidence: `docs/westayfit/qa/sprint-w7-exp3b.test.ts` (helpers shared with the Check 26 instrument), run from the scratch directory with `W7_EXP1_WT=../wt-exp3b`. `ts:check` 0; guard 9 / 20; no artifacts committed.
- **Status:** tested on `ed5e0838`; delivered by EXP1, not accepted, not integrated; W7 accepts, integrates and stages nothing.

# Check 27 — W9's HOME-POLISH-1 candidate, exact review head `07df4d0f` (product `7588af6a`) on exact base `018cd297` (#472): **PASS on every routed item and every delta item; no defect; the stale seam measured and reported**

Routed by L0 on #434 (`5819864092` on `30cb0740`; re-pointed to the successor `07df4d0f` as a delta, `5820309417`; Director #365 `5820278384`, #472 `5820308417`). Not a pixel verdict: the Director's VISUAL PASS on the successor is #472 `5820433336`. I had not started on `30cb0740`, so items 1–10 and D1–D5 ran once, together, on the successor.

## 27.1 · Scope, verified by git and grep (items 1, 10, D1)

| item | verified |
|---|---|
| lineage | `07df4d0f` on `claude/wsf-w9-home-polish-1`, **eight commits on exactly `018cd297`** (`efe21a15` → `fabe9068` → `402a6ad0` → `f7c3a97e` → `ccda4279` → `30cb0740` → `7588af6a` → `07df4d0f`) |
| the delta | **22 files, +901 / −204**: the route (`32ff6c93` → `348a8f57` at `30cb0740` → `20ad2bdc` at the head; +344 / −204 against the base), the two `sprint-w9-home-polish-*` specs, nine MIGRATED + nine CANDIDATE PNGs and a README under `docs/design-target/review/home-polish-1/`; nothing else |
| product trees | `apps/westayfit/src` `66d7feb1`, `.github` `1df5a0f5`, `functions-westayfit` `5a3f232e`, `firestore.rules`, both firebase configs, both `package.json`s identical to `018cd297`; `apps/westayfit/app` differs by the route only |
| the route's data surface | imports: exactly one added (`TabGlyph`, an existing hook-free View-drawn glyph, `src/` unedited); the hook, callable and data-call multisets of the file are identical base → head (15 `useEffect`, 24 `useCallback`, 40 `useState`, 19 `httpsCallable`, 2 `getDoc`, 0 `onSnapshot` / `fetch`); no diff hunk falls inside the state / effect / callable declarations (lines ~300–1736) |
| **D1** `ccda4279..7588af6a` | the route only (+152 / −81, blob `348a8f57` → `20ad2bdc`) plus the nine recaptured CANDIDATE PNGs; no call, effect or gating change; the string-literal delta is the `TabGlyph` import, the goal-state pill's styles (two `rgba` washes, weight `'500'` for `'900'`), and **one visible label: the own-row eyebrow "Your part" → "Your contribution"** (the three sentences beneath it byte-identical). W9's "no sentence changed" is accurate for the sentences; the label change is what W9 disclosed as the muted "YOUR CONTRIBUTION" label |
| the whole delta's rendered text | exactly two changes: the new **"Community goal"** label (new testID `wsf-community-goal-label`) in the hero's top slot when there is no "Goal reached" news, and **"Your part" → "Your contribution"**; every other rendered sentence identical; one testID added, none removed; the goal-state text moved into a pill under the **same** testID; 110 → 109 conditionals (the removed one is the old strip's `featured ? … : null` wrapper, now inside the featured branch — equivalent gate) |
| evidence hygiene (item 10) | every frame named MIGRATED or CANDIDATE, nothing named AFTER; 18 PNGs at 780×1724 / 780×1316 (390×844 / 390×640 at 2× plus the 18 px strip); no `artifacts/` or `test-results` in the delta; the evidence guard on the candidate's own checkout **9 frozen / 20 accepted intact**; my checkout of it `git diff --quiet` true throughout (one untracked copy of my instrument, removed after the runs) |

## 27.2 · Environment

The head built in its own worktree (`build:web`, exit 0, stamp `07df4d0f`), functions built from the same tree (identical to the base's), served by the local emulator stack (`demo-wsf-local`; hosting 5010, firestore 8080, auth 9099, functions 5001; 49 callables). The two fail-first builds (`fabe9068`, `402a6ad0`, both exit 0, stamped) served beside it by a static host carrying the same hosting rewrites, on 5011 / 5012, against the same emulators. Chromium only; Safari CANNOT-MEASURE. Every run serial (`--workers=1`), first run recorded, no rerun unless stated.

## 27.3 · First runs on the served head (items 4, 5, 8, D2, D3, D5)

| run | spec (from the candidate's checkout unless marked W7) | first run |
|---|---|---|
| A01 | `sprint-w9-home-polish-hero` (item 8) | **4 / 4** |
| A02 | `sprint-w9-home-polish-capture` at CANDIDATE, ordinary run, writes nothing (item 8; the strip is asserted from the served commit on `/health`) | **4 / 4** |
| A03–A06 | `ui-community-home`, `ui-journey`, `ui-matrix`, `ui-champion-torture` (the lane specs that pin the goal-state text; D2) | **3 / 3, 1 / 1, 2 / 2, 5 / 5** |
| A07–A08 | `sprint-w8-community-freshness`, `sprint-w8-social-privacy` (W8 carry incl. the fold guard; item 4, D5) | **8 / 8, 6 / 6** |
| A09–A14 | `sprint-w9-contribute-exits`, `-home-return`, `-community-list-address`, `-shell-production`, `-members-link-target`, `-shell-nav` (W9 carry; item 5) | **7 / 7, 6 / 6, 1 / 1, 3 / 3, 1 / 1, 9 / 9** |
| A15–A17 | `ui-a11y`, `ui-mobile-acceptance`, `ui-visual-baseline` (the layout-critical set; D3) | **24 / 24, 8 / 8, 3 / 3** |
| B01 (W7) | `sprint-w7-contribute-exits-verify`: X1, X1s ×2, X2, X3, X3b, X3c, X4, X5, X5s, X6, X6b, X7, X7b, X7c, **X7d, X7e, X7g, X7h** | **19 / 20** — the one failure is **X7f**, CANNOT-MEASURE exactly as in Checks 19–21 (the in-app sign-out unmounts the instance before B loads; no leak; its precondition assertion is what fails) |
| B02 (W7) | `sprint-w7-community-freshness-verify` F1–F4 | **4 / 4** |
| B03 (W7) | `sprint-w7-shell-successor-verify` (Close, You return, cold /move, reduced motion, remount mutant, MOVE error, members link 44 px, one top bar on every tab) | **8 / 8** |
| B04 (W7) | `sprint-w7-social-privacy-verify` | **13 / 14** — the one failure is the fixture precondition of the stored-zone test ("the chosen zone does not actually disagree with UTC"): Pacific/Kiritimati's day only starts before UTC's between 00:00Z and 10:00Z, and this ran at 19:42Z. A callable-level test; the backend is byte-identical to the base; not a candidate result |
| B05–B07 (W7) | `sprint-w7-social-delta-verify` (DOM privacy incl. the zero / null mutation), `-members-route-parity`, `-home-view-communities` | **9 / 9, 4 / 4, 7 / 7** |

131 of 133 cases passed on the first run; the two failures are the standing CANNOT-MEASURE and a time-of-day fixture precondition, both W7's own instruments, neither a candidate result. No reruns.

## 27.4 · W7's instrument on the head (`sprint-w7-home-polish-verify.spec.ts`; own seeding; items 3, 6, 7, 9, D2, D4)

| case | measured |
|---|---|
| **3 + D2 open goal** | label **"Community goal"**, no "Goal reached"; the pill under `wsf-community-goal-period-*` reads **"Open · Ends Thu, Oct 1"**, on the label's row and to its right; total **"1,847 of 5,000 squats"** as one element; "36.9% complete"; actions **"Start moving"** and **"Already moved? Record squats"**; own row **"Your contribution" / "You’ve added 20 squats to this goal."**; no once statement; "5 people moved today"; freshness "Confirmed 7:43 PM" |
| **3 reached** (5,040 of 5,000) | **"Goal reached"** takes the slot, the label is absent, the pill still the window: **the two never stand together** |
| **3 + D2 ended** (window past) | pill **"Ended Tue, Sep 22"**, label present, no news eyebrow |
| **3 proven zero / null** | quiet → **"0 people moved today"**; no goal → the no-goal state, **no** moved-today element, no hero label, "6 members" intact (rerun of a corrected case, §27.6) |
| **3 failed first read** (pulse 500), both viewports | no total printed, pill **"Open"**, label present, the retry **centred (0.0 px off)** under its sentence and **above the tab bar** at 390×844 and 390×640 |
| **3 + D4 once policy** (already contributed) | hero **"You’ve recorded 20 squats."**; own row **"Counted in the shared total above."**; no primary action and no record route are offered — the actions block is outside every hunk, so this is the base's behaviour, unchanged |
| **D4 own-total source** (feed row 20, exact own total 33) | the own row says **33** (the progress read's `wsfMyContribution` figure); the feed row for the same member says 20: the row is the exact own total, not the feed |
| **6 privacy** (viewer and Priya name-off; Tom activity-off) | page text carries none of: "Priya Nair", "Tom Okafor", "Alex Rivera", the viewer's email, any uid; feed **3 rows** (the viewer anonymous, Marcus named, Priya anonymous), **Tom has no row**, two "Anonymous member" rows; faces **DW LB MR TO** and no PN / AR (the anonymous mark is a shape); "5 people moved today" and the shared 1,847 unmoved (rerun of a corrected case, §27.6) |
| **7 layout** | 390×844 and 390×640: one top bar, "Start moving" ends above the tab bar, document overflow 0, no horizontal scroller; **195 px**: overflow 0, no scroller, label **104×13** (one line), the total **"1,847 ⏎ of 5,000 squats"** (breaks after the count); **fold guard** with the Switch chip: first `wsf-momentum-row` bottom 737 above the tab bar's top 768 |
| **9 the stale seam** | populated, settled at "Confirmed 7:45 PM"; every later pulse made to fail; **Refresh pressed** → the figure **"1,847 of 5,000 squats" stays**, the label stays **"Confirmed 7:45 PM"** (does not advance), **no error, no retry, no word of stale / unavailable anywhere**; then away to You and back with the read still failing → the same. **Meaning:** the figure is never misrepresented as newly confirmed (its stamp is the truthful last confirmation), but a failed refresh is silent — nothing tells the member the refresh did not happen. Exactly the README's statement; the refresh and catch paths are outside every hunk, so this is the base's (W8's accepted F4) behaviour carried, not introduced. **Reported, not fixed; not a defect of this delta.** |

## 27.5 · Fail-first (item 8): W9's hero spec at the head, run against the two earlier builds W9 names

| build | result | detail |
|---|---|---|
| `fabe9068` (5011) | **2 / 4** | "Checking progress…" **textAlign `right`** (expected `center`); the 195 px case: label **26 px** (> 16, two lines) and the total's rest top **462 < 481** (broke inside "of … squats"); the sideways-scroll half **passed** |
| `402a6ad0` (5012) | **3 / 4** | the centred case passes; the 195 px case fails on the same two halves (26; 462 < 481); the sideways-scroll half **passed** |
| `07df4d0f` (5010) | **4 / 4** | A01 |

Exactly W9's disclosure (`5820238983`): the label and total defects reproduce on the earlier build; horizontal overflow did **not** reproduce on either earlier build, so, as the Director corrected, no claim that it was fixed.

## 27.6 · Adversarial source review (four lenses, 21 agents) and notes for the Director

- **No new data, no privacy surface, meaning intact** (three lenses, every finding verified, none refuted as wrong): presence faces, member count, moved-today, own total and momentum come from the same `wsfCommunityMembers` / `wsfMyCommunities` / `wsfCommunityActivity` / `wsfGoalPulse` + `wsfMyContribution` reads and the same render conditions as the base; `PresenceRow`'s `max` prop exists (`CommunityPresence.tsx:102`) and only bounds the drawn faces, "+N" being the real remainder; `TabGlyph` is data-free.
- **Notes, not defects:** (i) "Ended …" now reads in the progress-green pill (the base drew it in muted hero ink) — the text and testID are unchanged; a pixel-level judgement for the Director. (ii) "Community goal" also renders while the pulse is loading and after a failed read (the pill then says "Open"), consistent with "the label unless there is news". (iii) Below 240 px the band draws four faces and "+N" where the base drew five. (iv) From source only, unmeasured: the progress area's reserve is a floor that a 195 px two-line total exceeds, so the actions can shift when the pulse lands at that width — present since `ccda4279`. (v) The one lens finding marked "defect" was the claim that `ccda4279..7588af6a` is text-free; it is not (the eyebrow label), but W9 disclosed that label in the commit message and the delivery, so it is recorded above as a note.
- **Kept unmeasured:** pixels and typographic parity with the frozen Lovable reference (the Director's); Safari; the stale seam's fix (outside the reservation).

## 27.7 · Own corrections, disclosed

- **Push gate miss:** commit `6c8689d0` was pushed with a TS2322 in this instrument because my gate read the typecheck through a pipe and lost its exit code; corrected in the next commit `fe71c5a1` (ts:check 0). No evidence was affected.
- **Two instrument errors on the first run (8 / 10):** (a) the "null" case seeded an unreadable stored zone, which the goal's own progress read refuses, so the hero showed the failed-read state rather than a null moved-today; re-pointed to the no-goal state. (b) The privacy case expected Dana in the feed; the feed shows the three most recent rows and Dana's contribution is the oldest. Both corrected and **those two cases rerun (2 / 2)**; the other eight cases stand on their first run.
- The instrument ran from the candidate's checkout (an untracked copy, so it uses the helpers and W8's fixture the candidate's specs use); it is committed here only.

**Status:** tested on `07df4d0f`; delivered by W9, visually passed by the Director, **not accepted overall, not integrated**; W7 accepts, integrates and stages nothing, writes no product source and takes no fix ownership.

## 28 · OPS-DOC-1 transfer review of exact `1d52c854e9041e017298f5f682e366f8b85cb59d`, `docs/wsf-staging/OPERATOR-HANDOFF-social-staging.md` only (Director #434 `5822117639`; the six-item packet #395 `5821336279`; L0 diagnosis #365 `5821993438`; W5 withdrawn #395 `5822128384`): **PASS on all six items, with five precision findings, none of which makes a claim in the document false**

Documentation review only. No cloud read, no probe, no code, no IAM, no deploy, no secret, no email. Every statement below is checked against the frozen commit, the actual run-47 logs and the named operational sources. W7 accepts, integrates and stages nothing.

### 28.1 · What was reviewed, by git

| fact | measured |
|---|---|
| commit | `1d52c854` "docs(wsf-staging): reconcile the operator handoff with what has actually run (OPS-DOC-1)"; parent `0c90a25b` |
| files | exactly one: `docs/wsf-staging/OPERATOR-HANDOFF-social-staging.md`, blob `36b7df13` → `49b0f2c9`, +132 / −29 |
| relation to `main` | the parent imports `main`'s blob `36b7df13` unchanged, so `git diff cc30f1d3 1d52c854 -- <doc>` and `git diff cd881775 1d52c854 -- <doc>` are the same 199-line delta; `git cherry-pick -x --no-commit 1d52c854` onto `cd881775` in a detached worktree applied cleanly and is byte-identical to that delta (worktree reset afterwards, nothing pushed) |
| sources read | run 47 `35937603929` (created `2026-09-24T00:15:41Z`, `main` `cc30f1d3`, `workflow_dispatch` by the owner, conclusion `failure`); its `deploy` job `107439035072` and `hosted-verify` job `107439761547` logs and step lists; `.github/workflows/wsf-staging-deploy.yml` and `.github/wsf-staging/verify-deployment.mjs` at `cc30f1d3` (both byte-identical at `cd881775`); `skills/wsf-staging-deploy/SKILL.md` at `cd881775`; `.github/wsf-staging/approved-candidate.json` at `cc30f1d3` and `cd881775`; `.github/wsf-staging/hosted-package-e-smoke.mjs` at both |

### 28.2 · The run record, from the actual logs (the reference for items 1 and 2)

`deploy` job `107439035072`, in step order:

| step (workflow line) | measured |
|---|---|
| "Deploy WSF functions" (446–448, `continue-on-error: true`) | `Failed to set the IAM Policy on the Service projects/westayfit-staging/locations/us-central1/services/wsfsetcommunityvisibility` (00:21:55.298Z), `…/wsfcommunityactivity` (00:22:01.274Z), `…/wsfcommunitymembers` (00:22:21.575Z); the CLI's own hint `You may not have the roles/functions.admin IAM role` (00:22:28.306Z); `Process completed with exit code 2` (00:22:28.758Z). The step's recorded conclusion is **success** because the failure is captured by `continue-on-error`; its `outcome` is `failure` |
| "Deploy the staging Hosting channel" | `hosting[westayfit-staging]: release complete` at **00:22:33.093Z** |
| "Verify the deployed state" (477–493) | `INVENTORY_BEFORE=46`, `INVENTORY_AFTER=49`, `CREATED_THIS_DEPLOY=wsfcommunityactivity,wsfcommunitymembers,wsfsetcommunityvisibility`, `PREEXISTING_TRANSPORT_VERIFIED=22/22`; `::error::hosted build marker does not match 7ee70e4` at **00:22:34.999Z**; `CANDIDATE_SERVICE_TRANSPORT=` 25 rows, of which exactly three read `invoker_iam_check_enabled` (`wsfsetcommunityvisibility`, `wsfcommunitymembers`, `wsfcommunityactivity`) and the other 22 `invoker_iam_check_disabled`; **`VERIFY=failed (1)`**; `HOSTED_MARKER_MATCHES=false`; exit 1 at 00:22:35.003Z |
| scan, upload | success |
| "Preserve an incomplete functions deployment as a failed release" (514–518) | `if: always() && steps.deploy-functions.outcome == 'failure'` → `::error::WSF functions were not fully deployed; hosting may be visible but callable transport remains blocked.`, exit 1 at 00:22:35.915Z |

Why the three SHUT rows are not themselves verifier failures: `verify-deployment.mjs` puts the approved additions' transport into `notes` ("Deliberately NOT a failure", lines 322–330) and only pushes to `failures` for a missing service, drifted **pre-existing** transport, inventory drift, the `wsfCheckIn` floor, the Hosting channel and the marker (line 373: `hosted build marker does not match …`). With one entry, `VERIFY=failed (1)` is the marker alone.

`hosted-verify` job `107439761547`: `PASS correct staging build — health marker 7ee70e4` at **00:24:04.361Z**; `FAIL hosted Package E suite — locator.waitFor: Timeout 20000ms exceeded.` (00:26:09.887Z); `PASS targeted synthetic cleanup — run-created documents and Auth users removed`; `RESULTS=6`, `FAILURES=1`; "Require the hosted checks to have passed" (675–682) exit 1. So the run's later hosted read did observe `7ee70e4`, ≈91 s after the deploy job's mismatch, and that is a distinct fact from the three transports and from feature readiness.

### 28.3 · The six items

| # | item | verdict | evidence |
|---|---|---|---|
| 1 | truth against the run record | **PASS** | doc lines 41–46 state `VERIFY=failed (1)`, that the one failure was the hosted-marker mismatch and that the three SHUT services added no failure: matches §28.2 exactly. Line 32–35: 46 → 49, the three exist, `invoker_iam_check_enabled`, the deploy step's `Failed to set the IAM Policy` for each: matches. Lines 28–30: "the run's later hosted read observed marker `7ee70e4`": matches the hosted-verify PASS row (the doc cites Director `5805596087`; the log corroborates it). Lines 47–48: 5 PASS / 1 FAIL and fixtures removed: `RESULTS=6`, `FAILURES=1`, cleanup PASS. Line 26–27: dispatched from `main` `cc30f1d3` at ~00:15Z, mode `deploy`, candidate `7ee70e4`: run created 00:15:41Z, head `cc30f1d3`, `approvedAppSha` = `7ee70e4f…`. Two precision findings, F1 and F2 below |
| 2 | three layers distinct; nothing claimed served / ready / repaired beyond the record | **PASS** | lines 20–55 report "Authorized deployment: done", "Capability: partial" and "Post-deploy feature readiness: not met" as three bullets; "Staging serves `7ee70e4`" (line 29–30) rests on the later hosted read and is the only served claim, and it is true by the hosted-verify row; no repair is claimed (lines 57–72: "Neither operation has a receipt", line 79); the index is "unverified", not READY (36–37); the served-claim list is followed by "**Status on 2026-09-24:** not met" (182–186) |
| 3 | historical statements kept and labelled verbatim | **PASS** | the delta shows the pre-run-47 sentences moved, not deleted: "Nothing here has been run." (line 74, labelled **Historical (true until run 47)**), the operator row's pre-deploy preflight sentence (line 88, *Historical (before run 47)*, quoted), the 16:57Z receipt (`5799068153`, "Historical receipt … not re-checked here"), the six-step plan (92–112, "kept as written", block-quoted, textually identical to `main`'s "Authorized sequence"), Operation 1's order row ("*Historical:* 'may precede the deploy'"). Each carries a *Current:* counterpart |
| 4 | consistency with `skills/wsf-staging-deploy/SKILL.md` at `cd881775` | **PASS** | the doc's quoted fragment (lines 118–120) is verbatim from SKILL line 29; "when the owner explicitly asks for the deploy, it is dispatched" is SKILL lines 18–24; the doc's three-layer split is SKILL lines 128–134 ("Do not collapse these into 'deploy failed'"); the owner's instruction is cited as #365 `5805097411` (lines 15, 25, 115), the id the Director's routing and L0's diagnosis name; the SKILL is unchanged between `cd881775` and the review head |
| 5 | "Still needed" exact and executable by a named operator only | **PASS** | lines 57–72: Operation 1 = the one `wsfContributions` COLLECTION index, `communityGroupId ASC`, `createdAt DESC`, `westayfit-staging` only, then the READY read-back with the recorded fields (the receipt-field row, 155, unchanged); Operation 2 = `gcloud run services update <service> --project=westayfit-staging --region=us-central1 --no-invoker-iam-check` for exactly `wsfsetcommunityvisibility`, `wsfcommunitymembers`, `wsfcommunityactivity`, then the schema-matched metadata-only read-back per service, "Empty output proves nothing"; the verification run is named as a separate authorization "which this document does not give" (70–72, 134–136); "never L0, never the deploy identity; no credential is named or sought here" (57–58); the "not authorized" row adds "a repeat of a denied probe" (169). The index entry matches the candidate's `firestore.indexes.json` as the pin's `_fullCandidateNote` records it; the three service names match `candidateAddedFunctions` |
| 6 | nothing else changed | **PASS** (with F4) | from the delta: the provenance header (lines 1–11) unchanged; the project, region and single-index rows unchanged; Operation 1's permission, CLI-spelling, never, READY-read, receipt-fields and rollback rows unchanged (only the order row is reconciled); Operation 2's the-setting, permission and receipt-fields rows unchanged; the served-claim list (173–180) unchanged with only the status paragraph appended. The **three services** row did change: "— **created by run 47, measured SHUT**" was appended (line 87) |

### 28.4 · Findings (precision; none blocking)

- **F1 — "read one second after the Hosting release" (line 43).** Measured: the release-complete line is 00:22:33.093Z, the verify step began 00:22:33.409Z and its mismatch line printed at 00:22:34.999Z, so the read fell within 0.3–1.9 s of the release. "One to two seconds" or "within two seconds" is the exact wording; the claim's substance (a read immediately after the release, before propagation, later observed matching) is correct.
- **F2 — "The next step then marked the release a failed release" (lines 45–46).** The step that marked the release failed is "Preserve an incomplete functions deployment as a failed release", which is two steps later (after the evidence scan and upload), and its condition is `steps.deploy-functions.outcome == 'failure'` (workflow line 515), i.e. the **functions deploy step's captured exit 2 on the three invoker-policy failures**, not the verifier's result. Placed inside the bullet about `VERIFY=failed (1)`, the sentence reads as if the marker mismatch produced the failed release. The exact statement is: the verifier's one failure was the marker; the three SHUT services added no **verifier** failure; the release was independently marked failed by the workflow's guard on the functions step's own exit (workflow lines 446–448 and 514–518). This is the one finding I would ask L0 to carry into the main-based draft, because as written it under-attributes the failed release to the transport problem the document is about.
- **F3 — "because the deploy identity lacks `run.services.setIamPolicy`" (lines 35–36).** Run 47's log names `roles/functions.admin` in the CLI's hint and does not name the permission; the `setIamPolicy` attribution is the repository's standing diagnosis (`verify-deployment.mjs` lines 168–169 and the workflow comment at 511–513). True as the standing diagnosis, but it is an inference from source, not a run-47 log reading; a "per the workflow's own comment" attribution would keep the sentence exact.
- **F4 — W3's delivery text, not the document.** The delivery's "Unchanged: … services table rows" is inaccurate: the three-services row gained the created-by-run-47 / measured-SHUT clause. The change itself is truthful (`CREATED_THIS_DEPLOY` and the transport line) and inside the packet's scope, so item 6 passes on the document; the delivery summary should not be relied on as the unchanged-row list.
- **F5 — pre-existing citation, carried from `main`.** The "why not the workflow" row cites "`wsf-staging-deploy.yml` comment near the deploy step"; the comment that says the deployer "cannot set public invoker IAM on newly created services" sits above the failed-release step (lines 511–513), some 65 lines after the deploy step. Only the run-47 clause of that row is new; the citation was already on `main`.

Supported, for the record: the Package E root cause (line 49–51). At `cc30f1d3` the smoke waits for `wsf-community-manage` (`hosted-package-e-smoke.mjs` line 422); at `cd881775` (Merge #466) that wait is gone, the contract test asserts it is not waited for, and the smoke's own comment (line 430) records "Run 47 waited for wsf-community-manage against 7ee70e4 and timed out". The run-47 log line shows only the 20 s `locator.waitFor` timeout; the identification of the locator is from the accepted packet-17 record and the source, and the doc labels the fix "unmeasured on staging until the next run", which is exact.

### 28.5 · Limitations

Comment ids `5805097411`, `5805440687`, `5805596087`, `5798443901`, `5799068153` and `5819944052` are cited as the Director and L0 cite them; I re-read the run logs and sources they point at, not each comment body. Run 47's evidence artifact was not downloaded (log-level review, as the packet asks). No statement about staging's present state is made here: everything above is what run 47 recorded on 2026-09-24T00:15–00:27Z.

**Status:** reviewed on `1d52c854` (blob `49b0f2c9`); verdict delivered to the Director. Not accepted by W7, not integrated, not staged; L0's main-based draft is L0's.

## 29 · RECOVERY-PORT-1 (#474), exact head `86c160aee2c8edb6deb6800edf1d3d2f26e39cc0` on exact development `6f994f5a` (Director #434 `5824351707`; exact-head amendment `5824906768`; disposition #474 `5824349240`, successor source-accepted `5824904901`): **PASS on routed items 1–7 and on the five successor items; no defect. The focus-to-`body` shell limitation is measured on every exit and stays open, recorded separately.**

W7 accepts, integrates and stages nothing. This is not a pixel verdict; the Director's visual PASS stands separately. Chromium only, local emulators (`demo-wsf-local`), every run serial, first run recorded.

### 29.1 · Scope, by git (item 1; successor items 1 and 4)

| fact | measured |
|---|---|
| lineage | seven first-parent commits on exactly `6f994f5a`: `d7d2ee70` (producer + 12 MIGRATED frames), `507b5898`, `bd4400e3`, `d029097e` (the four-commit port lineage to the port's product SHA), `4aa46baa` (12 CANDIDATE frames), `6504b86f` (README provenance), `86c160ae` (the correction) |
| product | only `apps/westayfit/app/contribute/[goalId].tsx`: blob `367352d1` → `261360ca` (`d029097e` = `6504b86f`) → `d888f4fb` |
| outside the reservation | only `tests-e2e/ui-contribute.spec.ts`, exactly two lines: `:302` `'Back to community'` → `'Back'`, `:445` `'Back to home'` → `'Back'` |
| untouched | `apps/westayfit/src` (incl. `pendingContribution.ts`, `contributionFlow.ts`, `moveSession.ts`, `ui/memberShell*`, kit, theme), `app/(tabs)`, `app/move`, `.github`, `functions-westayfit`, `firestore.rules`, both hosting configs, `package.json`: `git diff --quiet` true |
| data surface | the route's hook calls (36) and callable references (6) are the same count on base and head; no added or removed `httpsCallable` / `fetch` / storage / Firestore call in the diff. The receipt's new "Shared total · ‹goal title›" label reads `context.goalTitle`, which the base already held from the verified context and rendered in the anchor; it is inside the shared-only branch |
| successor delta `6504b86f..86c160ae` | 3 files, +67 / −8: the chrome control's text and `accessibilityLabel` become the literal "Back"; `onPress` and the Enter handler still call `returnToMemberContext(backHref)`; `backHref`, `backLabel` and every `ReturnButton` (`leaveFor`) unchanged |

### 29.2 · Environment

Base and head each built in its own detached worktree (`build:web`, emulator-flagged, exit 0; `/health` stamps `6f994f5a` and `86c160ae`), served beside the emulator stack by a static host that applies the hosting rewrites (head on 5013, base on 5014). The functions, rules and emulator config are identical to the running stack's (`git diff --quiet 07df4d0f 86c160ae` over them). No reruns anywhere below.

### 29.3 · W7's instrument (`sprint-w7-recovery-port-verify.spec.ts`), head vs base, first runs

| case | head `86c160ae` | base `6f994f5a` |
|---|---|---|
| **T1** unknown after a lost reply names no own / shared figure, nobody else and no identifier, offers no discard; the server already holds the write once; same-attempt Confirm (by Enter) → `alreadyRecorded`, the server still holds **one** contribution document, shards **1,867** (= 1,847 + 20), member total **20**; the receipt's shared line, own tile, addition and percent equal the server's figures; own and shared never share a figure; nothing left to replay | **PASS** | PASS |
| **T2** a request that never reached the server → Confirm records it once, `ordinary`, document id `{goal}_{uid}_{sameAttempt}`, shards 1,867, "+20" | **PASS** | PASS |
| **T3** own-only (membership removed before the replay): no community name, shared figure, percent, status, standing or record-more; own tile 20; one document; **Enter on "Back to home"** leaves the route (to `/`), never to the lost community | **PASS** | **FAIL** — Enter ignored, still on `/contribute/…` |
| **T4** genuine refusal (once-policy goal already contributed): `alreadyContributed`, no document written, shards unmoved at 1,847, member total unchanged, no replay row kept, no figure invented | **PASS** | PASS |
| **T5** the kept attempt is keyed by account and goal: another account's row on this device (injected, labelled) is neither shown nor sent; this account's attempt on goal 1 is not shown or sent on goal 2 in the same community; both rows survive untouched | **PASS** | PASS |
| **T6** openers by keyboard: MOVE from the Community page → the route's own Back (**pressed**) reads "Back" and returns to that page with **one** Community screen; MOVE from You → unknown → **"Back to community" by Enter** → one Community screen; back in through a **different** launcher (the hero's "Already moved?") → the **same attempt** restored, **0 sends**; Confirm by Enter → receipt → "Back to community" by Enter → one screen; server: one document, 1,867 | **PASS** | **FAIL** — the route's own Back reads "Back to community" |
| **T7** layout 390×844, 390×640, 320×568: sideways overflow 0 on unknown and receipt; the one action, the labelled exit and record-more reachable by `elementFromPoint` at their centres, inside the width, ≥ 44 px; the badge, percent and status carry meaning in words; the shared count never breaks inside itself | **3 × PASS** | 3 × PASS |

**Head 9 / 9, base 7 / 9.** The base failures are exactly the two discriminating cases: Enter on a labelled exit, and the route's own Back naming a place. Truth cases pass on both builds by design: they guard truth that the port must not have moved, and it did not.

Layout readings worth the Director's eye: at **320×568** the receipt's "Back to community" is not in the first viewport (record-more stacks above it) and is reached by scrolling; at 390×640 the pair sits side by side at 154 px each and both are in the first viewport; the unknown screen's Confirm is in the first viewport at all three sizes.

### 29.4 · Keyboard exits and openers (item 4; successor items 2, 3 and 5)

| journey | label | lands | Community screens | focus after |
|---|---|---|---|---|
| MOVE from Community → own Back, pressed | "Back" (text and accessible name) | `/community/<id>` | 1 | `body` |
| MOVE from You → unknown → labelled exit, Enter | "Back to community" | `/community/<id>` | 1 | `body` |
| receipt → labelled exit, Enter | "Back to community" | `/community/<id>` | 1 | `body` |
| own-only → labelled exit, Enter | "Back to home" | `/` | — | `body` |
| (W9's spec, run here) hero → own Back, Enter; MOVE from You → own Back, Enter | "Back" | `/community/<id>`; **`/you`** | — | `body` |
| (W9's spec, run here) cold with `groupId` → own Back; cold without → own Back | "Back" | replaces to `/community/<id>`, no history entry; replaces to Home, which resolves `/community/<id>`, no history entry | — | — |

**Focus lands on `body` after every exit**, including from the MOVE launcher. This is measured and recorded as the separate shell limitation (Director `5824349240`; W9's required shell / accessibility successor). It is not fixed here and not waived: a keyboard or screen-reader member loses their place.

### 29.5 · Carried and focused runs (successor item 4; item 7)

| run | build | first run |
|---|---|---|
| W9 `sprint-w9-recovery-port-rendering` (6 tests, incl. the Back-from-You and cold cases) | head | **6 / 6** |
| `ui-contribute` (the two pinned lines) | head | **7 / 7** |
| `ui-contribute` **from the head's checkout** against the base build | base | **5 / 7**: the two failures are exactly `:302` (Received "Back to community") and `:445` (Received "Back to home"). The pins are non-vacuous. |
| `ui-combined-goal` | head / base | **5 / 5 and 5 / 5** |

Item 7: the reported `ui-combined-goal.spec.ts:745` failure (`not.toContainText('24')`) did not reproduce on either build today (2026-09-25). The assertion depends on "24" appearing in the event's own dates, as W9 disclosed. The spec and the combined / event screens are byte-identical base → head, and the two builds gave the same result, so the failure is equivalent across them and not this PR's. Not repaired. The rest of W9's 35-file regression (184 / 184 first run on `86c160ae`; 182 / 183 on `d029097e` with only that failure) is **carried**: its dependencies are unchanged and I did not re-run it.

### 29.6 · Truth, privacy and transitions (items 2 and 3), from source and the runs above

- **Unknown:** one action; no own or shared figure, no anchor, no discard, no "nothing was counted", no claim about the shared total (source and T1). Confirm is a write of the same attempt (T1, T2) and counts once (T1: one document, shards +20 once).
- **Receipt:** every figure is from the `wsfContribute` receipt, and T1 / T2 equal the server's own documents. Own (the addition tile and "Your total on this goal") and shared (the navy panel) are separate elements with separate figures.
- **Own-only:** no panel, standing, community, percent or record-more (T3, source).
- **Refusal:** the server's own reason, with nothing written (T4).
- **Legacy pre-uid orphan:** retired to the orphan key, not adopted, not sent, not rendered. This is carried from W9's capture spec and was not re-run. `retireLegacyPending` and `pendingContribution.ts` are unchanged.
- **Privacy:** no other member's name or any identifier on the unknown, receipt or own-only screens (T1, T3). The route adds no call, so the member-name and activity privacy the feed enforces is untouched. W8's privacy suites are carried.
- **Account and goal transitions:** keyed isolation holds (T5). Context, account and goal cancellation live in unchanged code (`pendingContribution.ts`, the route's effects outside every hunk).

### 29.7 · Frames and provenance (item 6)

The 24 frames and the README are delivered under `docs/design-target/review/recovery-port-1/`, and the Director opened them. The producer asserts each frame's served build from `/health` (MIGRATED = `6f994f5a`, CANDIDATE ≠ base). The README records the reference provenance limitation: 7 of 8 source rows and all six frame digests match, and the demo test file has nine cases against the manifest's eight. None of the 24 frames shows the chrome control, so the successor needs no recapture. I did not re-hash the frames. Safari and a real assistive-technology session are **CANNOT-MEASURE** here.

### 29.8 · Notes (not defects)

- The route-wide primary button text moves from 17 / 900 to 16 / 800 (the entry and move steps included). This is disclosed in the delivery as Home's accepted action; it is a pixel matter.
- At 320×568 the receipt's way back needs a scroll (29.3).
- The item-2 Lovable focus diagnosis (`5822117639`) was paused for this check. Its capability note is on #434 `5825213661`.

**Status:** tested on `86c160ae`; delivered by W9, pixel-passed and source-accepted by the Director; **not accepted overall, not integrated, not staged**.

## 28D · OPS-DOC-1 wording delta, exact `9691139f0b46c978718536575c84d07b59ddcf7e` on `1d52c854` (L0 queue #434 `5825283492`; Director #396 `5822324385`; W3 delivery #396 `5825201764`): **PASS on both ruled items**

The delta is one commit with parent `1d52c854`. It changes one file, `docs/wsf-staging/OPERATOR-HANDOFF-social-staging.md`, from blob `49b0f2c9` to `88597026`, +13 / −8. Cherry-picking `1d52c854` then `9691139f` onto `main` `cd881775` in a detached worktree is clean and lands blob `88597026` only; the worktree was reset and nothing was pushed. The §28 run-log evidence carries and was not re-read, except for one count in the saved log.

| ruled item | at `9691139f` | verdict |
|---|---|---|
| F2: the verifier's count vs the failed-release guard | The bullet now states "Two separate facts". First, `VERIFY=failed (1)` was the verifier's one count, the hosted-marker mismatch; the three SHUT rows were notes and added no verifier failure. Second, **separately**, the workflow later marked the release failed because the functions step's captured outcome was failure (exit 2 on the three invoker-policy updates), "not from the verifier's count". This matches workflow lines 446–448 and 514–518 and the §28.2 log. | **PASS** |
| F1 + F3: timing and attribution | The timing now reads "within two seconds after the Hosting release", which matches the measured 0.3–1.9 s. The log line keeps `Failed to set the IAM Policy` and adds "its hint names `roles/functions.admin`". The `run.services.setIamPolicy` claim is labelled the repository's "standing, source-backed diagnosis", and "the log does not print that permission name". The saved run-47 logs contain `setIamPolicy` 0 times and `roles/functions.admin` once. | **PASS** |

Nothing else in the document changed. Findings F4 (W3's delivery text) and F5 (a citation carried over from `main`) were not in the ruled scope, and F5's line is untouched.

**Status:** reviewed on `9691139f`. It is not accepted, integrated or staged; L0's main-based draft is L0's.

## 30 · FOCUS-RETURN-1 (#477), exact head `8f2cc15e89075086282777142ff946e7052acbef` (product `0d5df335`) on development `6b96ba1b` (L0 queue #434 `5825283492` item 2; W9 delivery #477 `5826296788`; W7 ACK `5826390838`): **PASS — no defect in the delivered behaviour; one precision finding on the watch window (F1); one pre-existing seam recorded (S1); a correction to my own Check 29 T3 scope**

W7 accepts, integrates and stages nothing. This is not a pixel verdict; the eight frames are the Director's. I started this check on the delivered head under L0's queued routing, before any separate SHA routing, and said so in the ACK.

### 30.1 · Scope, by git

| fact | measured |
|---|---|
| lineage | five commits on exactly `6b96ba1b`: `b76b8410`, `12ae965c` (Enter selects a tab), `77dfdf1c` (producer), `0d5df335` (review findings = product SHA), `8f2cc15e` (8 frames + README); `apps/` identical `0d5df335` → head |
| product | new `src/ui/focusReturn.ts`, `app/(tabs)/_layout.tsx` (a ref on the shell `View` + the hook), `app/move/index.tsx` (Escape = the same `close()`, only while the sheet is the focused screen; the sheet hook; `armTabsFocusReturn` on the replace-to-Home close), `src/ui/MemberTabBar.tsx` (the unchanged `onPress` body lifted into `select`, which Enter also calls; the active-tab no-op still returns first) |
| untouched | `app/contribute/**`, `pendingContribution.ts`, `contributionFlow.ts`, `moveSession.ts`, kit, `app/_layout.tsx`, `.github`, functions, rules, both hosting configs, `package.json`: `git diff --quiet` true |
| base build | development `6b96ba1b` has the same tree as `86c160ae` (`git diff --quiet`), so the Check 29 head build (5013) is the base here. Its `/health` stamp reads `86c160ae`; disclosed |

### 30.2 · W7's instrument (`sprint-w7-focus-return-verify.spec.ts`), head vs base, first runs

| case | head `8f2cc15e` (5015) | base (5013) |
|---|---|---|
| **R1** pointer path: launcher and Back both **clicked** → focus on that launcher | **PASS** | FAIL (`body`) |
| **R2** 390×640, community scrolled to **60**, keyboard open, Back → focus on the launcher, scroll **60 → 60** (the case refuses to run if nothing scrolls) | **PASS** | FAIL (`body`) |
| **R3** no steal: the member moves focus to the You tab at once after Back; 3.5 s later it is still there | **PASS** | PASS (nothing acts on the base) |
| **R4** **real** own-only (membership removed on the server, not an injected reply) → "Back to home" (Enter) → focus on a named, visible control (the launcher), never `body` | **PASS** | FAIL (`body`) |
| **R5** unknown → "Back to community" (Enter) → focus on the launcher, one Community screen; Enter on the restored launcher brings back the **same attempt**, 0 sends | **PASS** | FAIL (`body`) |
| **R6** a plain load of Community leaves focus on `body` | **PASS** | PASS |
| **R7** (measured) a pointer click on blank page space within the helper's watch after landing | see F1 | focus stays `body` |

**Head 7 / 7; base 3 / 7.** The base passes only the cases that assert nothing moves (R3, R6) and the measurement (R7).

### 30.3 · Carried and focused runs

| run | build | first run |
|---|---|---|
| W9 `sprint-w9-focus-return-1` (16) | head | **16 / 16** |
| the same file | base | **1 / 16**: every focus case fails on `body`; the one pass is the plain-load / tab-switch case that asserts nothing moves |
| W7 `shell-successor-verify` (MOVE a focus sheet over the **mounted** tab: same instance, no remount, one top bar, Close, reduced motion), `contribute-exits-verify` (X1–X7h), `recovery-port-verify` (Check 29 T1–T7) | head | **34 / 37**. X7f is the standing CANNOT-MEASURE (the instance does not survive the in-app sign-out). **X3 and X3c** failed on **my own stale pins**, which still expected the chrome control to say "Back to community". The accepted, integrated Check 29 correction made it "Back". The pins were corrected and **those two cases rerun (2 / 2)**. |

Check 29's T6 readings now show where focus lands: MOVE from Community → own Back → `wsf-member-tab-move`; MOVE from You → unknown → "Back to community" → `wsf-member-tab-move`; re-entry through the hero → receipt → "Back to community" → that launcher. The destinations, the single Community screen, the kept attempt and the server's single count are unchanged from Check 29.

W9's 56-file regression (309 / 0 / 10) is **carried**, including the kiosk specs, `ui-a11y` and `ui-a11y-fixes`. The kiosk path has no shell, and `loadedAtFlow` excludes `?kiosk`.

### 30.4 · Findings

- **F1 — the watch window overrides a pointer blur (precision, not blocking).** For 3 s after it lands (`WATCH_MS`), the helper re-lands focus whenever focus is "lost", up to three times. A member's own click on blank page space counts as lost. Measured on the head: `mousedown on DIV`, then `focusout` from the launcher at +1 ms, then `focusin` on the launcher again at **+9 ms**. The member's deliberate blur is undone. No scroll moves, because focus uses `preventScroll`, and nothing is activated. The re-land guard was built for a launcher the screen rebuilds, but it cannot tell that case from the member's own click. Smallest fix: treat a `pointerdown` outside any focusable during the watch as the member acting and stop watching, as `followAttention` already records pointer presses. This is a finding for the Director's call and not a defect of the delivered cases.
- **S1 — pre-existing seam, not this PR's.** After the real own-only receipt opened from the community, "Back to home" (`dismissTo('/')`) returns a member whom the server has just removed to the **still-mounted** screen of that community. It shows the figures it held before the contribution (1,847 while the server holds 1,867) and still offers "Start moving" / "Already moved?". A reload or a fresh load of the same URL shows "Not a member · You are not a member of this community", so no new data is read. It is the same on the base (R4's path reading is identical there). FOCUS-RETURN-1 only adds focus on the launcher there. It is recorded for the owner of the Home stack.

### 30.5 · Correction to my Check 29 record

Check 29's T3 asserted that the own-only "Back to home" "never [goes] to the lost community". That held for the flow T3 drove, a **cold** arrival at `/contribute`, which landed on `/`. It does not hold when the flow was opened from the community page (S1, above). The Check 29 verdict on the delivered route is unchanged: the route's exit calls `dismissTo('/')` exactly as the base did. The narrower claim stands corrected here.

### 30.6 · Limitations

Chromium only. Safari is CANNOT-MEASURE; so are its tap-without-focus behaviour and a real assistive-technology session. The limitations W9 disclosed are not re-measured and carry:
- a cold `/event` or `/queue` flow still leaves focus on `body`, pending an `app/_layout.tsx` dependency;
- Progress's own "Start moving" ignores Enter and replaces the navigator;
- focus is not moved into the MOVE sheet when it opens;
- Settings, `/goals/new`, `/start-community` and `/join` keep the browser default.

**Status:** tested on `8f2cc15e`; delivered by W9; **not accepted, not integrated, not staged**.

### 30.7 · Addendum for the Director's routing `5826499443` (posted 04:04Z, before my delivery at 04:10Z)

The routing's list mapped to evidence. Three cases were added to W7's instrument for the items that had only W9's coverage. They are first runs, head `8f2cc15e` (5015) vs base (5013):

| routed item | evidence | head | base |
|---|---|---|---|
| base leaves `body`; the head restores the opener after MOVE Close / Escape and contribution Back / Finish | W9 focused 16 / 16 vs 1 / 16; W7 R1, R2, R4, R5 | PASS | fails on `body` |
| selected goal → contribution → Back returns to that goal, then Close returns to MOVE | W9 focused case 6 (carried) | PASS | FAIL |
| scroll and mounted tab exact; active-tab reselect a no-op | W7 R2 (60 → 60); **R10** (Home tab pressed by pointer and by Enter while active: path, scroll 60, history length 3 unchanged, focus stays on the tab); `shell-successor-verify` (same mounted instance) | PASS | R10 PASS (preserved) |
| a rebuilt or removed opener falls back to the landed `h1`, then the current tab; never `body` | W9 focused cases 10–13 (carried): the launcher taken away → `h1`; cold → `h1`; a Home with no heading → the current tab | PASS | FAIL |
| the latest pointer or focus intent wins | **R8**: launcher keyboard-focused, then MOVE **clicked** → Back → focus on **MOVE** | PASS | FAIL (`body`) |
| a new covering flow cancels a pending restore | **R9**: Back, then MOVE clicked at once. While the second flow covers the tabs, 12 samples over 3 s show focus is never pulled into the hidden tabs (all `body`). Its Back then lands on MOVE. The covered-window half does **not** discriminate (the base reads `body` too); only the landing half does | PASS | FAIL (landing) |
| Enter selects Home / Community / Progress / You and focus stays on the tab | W9 focused case 15 (carried) | PASS | FAIL |
| off-web, kiosk and plain load inert | R6 (plain load stays `body`); source (`onWeb()` guards, `loadedAtFlow` excludes `?kiosk`, the kiosk has no shell); W9's kiosk specs inside its 309 / 0 / 10 regression (carried) | PASS | — |

**Carried open, not waived:**
- cold `/event` and `/queue` exits (need the `app/_layout.tsx` dependency);
- Progress's "Start moving" ignores Enter and replaces the navigator;
- MOVE's focus entry and containment (R9 shows focus sits on `body` while a flow covers the tabs);
- Safari and a real assistive-technology session are unmeasured;
- F1 (the watch window re-lands after a blank-space click) is the Director's call.

**Receipt:** Check 30 on exact `8f2cc15e` is a **PASS**, W7 instrument **10 / 10** first run on the head (base 4 / 10). Not merged, not staged.

## 31 · MOVEMENT-VISION-1 fail-closed successor (#475), exact `eda5821893937e89b2635237d42924221e00c3a9`, delta only from the rejected `8642e330` (Director #434 `5827103237`; findings `5825938854`, disposition `5826065652`, source approval `5827103081`; W7 ACK `5827108000`): **PASS on items 1–5; no defect**

R&D QA only. Nothing here says anything about real-person accuracy, bystander reliability, native behaviour, integration or serving. Every input is synthetic landmarks or the lab's scripted scene. W7 accepts, integrates and stages nothing.

### 31.1 · Scope, by git (item 5)

- **Commit:** one, with parent exactly `8642e330`. Ten files, +279 / −28: `src/movement/{session,squatCounter,subjectLock}.ts`, `MovementVisionLab.web.tsx` (a readout line and a counter), W10's e2e spec, the new `tests/movement-fail-closed.test.ts`, two updated vitest files, and `LIMITATIONS.md` / `README.md`.
- **Surface audit:** the added lines contain **no** `fetch`, XHR, beacon, WebSocket, local, session or IndexedDB storage, Firebase or callable use, URL, `getUserMedia`, frame export, recorder, upload or analytics. The only new imports are the new test's four internal ones.
- **Unchanged:** the package and lock files (`@mediapipe/tasks-vision` stays `0.10.35`), `app/` routes, rules, functions and `.github`.
- **Not integrated:** `eda58218` is not an ancestor of development.

### 31.2 · Suites

| run | `8642e330` | `eda58218` |
|---|---|---|
| movement vitest (W10) | 66 / 66 | **74 / 74** |
| **W7 unit instrument** (`docs/westayfit/qa/sprint-w7-mv-fail-closed.test.ts`, run from a worktree's `tests/`) | **3 / 10** | **10 / 10** |
| **W7 browser instrument** (`sprint-w7-movement-freshness-verify.spec.ts`, the lab's real frame loop with Playwright's fake clock) | **1 / 2** | **2 / 2** |

The successor's 10 / 10 is nine first-run cases plus T3. T3's first run failed on my fixture: after re-acquisition the counter must see the member standing again before it can count. That is the successor's documented re-arm rule. I added seven standing frames and reran T3 once, and it passed on the successor and failed on the rejected head.

### 31.3 · Items

| item | evidence | verdict |
|---|---|---|
| **1** overlapping distinct poses never collapse into one trusted subject, at acquisition or while locked | Source: `candidates()` keeps every detection; `crowds()` (IoU > 0.1 or centre within 0.35 h) applies to partial detections too; `follow()` and `recover()` go ambiguous on any crowding candidate. W7 cases: **L1** a partly visible overlapping pose (ankles hidden) while locked → not locked, no subject; **L2** three overlapping poses at acquisition → never locked; **L3** an exact duplicate → read as a crowd both locked and at acquisition, which is the conservative side of the trade-off; **L4** a rep spanning an ambiguity is void and the member is re-trusted only once alone, with the next full rep counted. The rejected head fails L3 and L4; L1 and L2 already refused there (they are not discriminating and are disclosed as such). | **PASS** |
| **2** any unobserved or unmeasurable mid-cycle sample voids the cycle and needs re-arm | Source: a null depth outside "standing at rest" calls `interrupt()`. W7 cases: **M1** partway down (0.4, between the thresholds), then `[]`, then a full descent and standing → **0**, and the next observed rep counts; **M2** standing at rest survives an unobserved frame, and a full rep then counts (passes on both heads by design); **M3** a NaN timestamp mid-rep is rejected (`outOfOrder`) and voids the rep. The rejected head fails M1 and M3. | **PASS** |
| **3** non-increasing timestamps and a gap > 250 ms void the cycle, while the documented under-bound case still works | Source: in `session.update`, `t <= lastT` or a non-finite `t` → `outOfOrder` + `interrupt()`; `t − lastT > 250` → `lock.suspend()` + `interrupt()`; `SubjectLock` ignores non-increasing `t`. W7 cases: **T1** a gap of exactly **250 ms counts**, **251 ms is void**; **T2** a backward timestamp voids the rep, later in-order frames re-arm and the next rep counts; **T3** a gap while standing suspends the lock, re-acquisition invents nothing, and after re-arm a full rep counts. The rejected head fails T1, T2 and T3. | **PASS** |
| **4** the real browser / fake-clock stall fails on the old head and passes on the successor | W7's own case asserts on the **rep count only**, so it runs unchanged on both builds. The lab's `requestAnimationFrame` loop runs under the fake clock and is stepped to "phase: down" in rep 1; then an 11.2 s `fastForward`, then 600 ms of standing frames. **Rejected head: reps = 1**, locked, standing: the unobserved completion counted. **Successor: reps = 0**, lock re-acquiring, phase unknown, "stream interruptions (rep in progress voided): 1". **Control B0** (no stall, ~9 s of scene) counts **3 on both**, so the zero is not a loop that never counts. Both builds are emulator-flagged `build:web`, exit 0. | **PASS** |
| **5** no privacy, persistence, backend, production or canonical integration surface added | 31.1 | **PASS** |

### 31.4 · Limits carried, not measured

- Real camera and real people, the MediaPipe engine's real overlap behaviour, bystanders, dropout rates, native, Safari and a real device.
- The successor's disclosed trade-off: one dropped detection at the bottom of a real rep now voids that rep. How often that happens on a real camera is unmeasured.
- W10's six e2e cases were not re-run. I ran only W7's two browser cases.

**Status:** tested on `eda58218`. R&D QA only; not accepted, not integrated, not served.

## 32 · RETURN-CONTINUITY-1 (#478), exact head `9f73aaa6f8a57372e3eeeb95765b3562b6060995` (product `ff043515`) on `6b96ba1b` (Director #434 `5827675711`; W7 ACK `5827682199`): **PASS on items 1–7; no defect**

W7 accepts, integrates and stages nothing. This is not a pixel verdict. The run is Chromium only, on the local emulators.

### 32.1 · Scope, by git (item 7)

- Seven commits on exactly `6b96ba1b`. `apps/` is identical from `ff043515` to the head, and the later commits change frames and the producer only.
- The **one product file** is `app/(tabs)/(home)/community/[groupId]/index.tsx`, plus two new `sprint-w9-return-continuity-*` specs, frames and a README.
- `src/`, the contribute route, `app/move`, the tabs layout, functions, rules, `.github`, the hosting configs and `package.json` are identical to the base.
- The route diff adds **no call**. It adds:
  - a `refreshFailed` flag on a kept `ok` progress entry, set in the two existing `catch` blocks (the ordinary read and the return settle read). It is never set if a read issued later has already landed (`issuedAt >=`).
  - an always-present, visually hidden `aria-live="polite"` region that receives the sentence when a read fails;
  - the visible sentence (hidden from assistive technology) and **Retry**, whose `onPress` is the existing `refreshProgress`;
  - the hero pill "Last known", which replaces the window pill while stale;
  - the own-row eyebrow "Your last-known contribution".

### 32.2 · W7's instrument (`sprint-w7-return-continuity-verify.spec.ts`), head (5018) vs base (5013)

| case | head | base |
|---|---|---|
| **C1** confirmed return: Home's shared total equals the **server's shard sum** (1,867) and the receipt; the own row and the viewer's momentum row ("added 20 squats") carry the 20; no stale line | **PASS** | PASS |
| **C2** request dropped → Home 1,847 = server (the 20 excluded); then the kept attempt confirmed with the reply lost after the write → Home 1,867 = server, **once** | **PASS** | PASS |
| **C3** failed Refresh over a confirmed figure: 1,867 and "Confirmed h:mm" unchanged; stale line, "Last known" pill (window pill gone), live region text "Couldn’t refresh. This is the last confirmed figure.", own eyebrow "Your last-known contribution"; Retry's accessible name "Retry: October Squat Challenge progress"; Retry issues **another `wsfGoalPulse` request** (counted), and the state holds while it still fails | **PASS** | FAIL (silent) |
| **C4** the read comes back → Retry clears the line, the pill (the window returns), the live text and the eyebrow; the figure equals the server's (1,867), no invented credit | **PASS** | — |
| **C5** every read after the receipt fails, **no press**: the return's own settle read is said. The retained figure stays the last confirmed (**1,847**, the pre-contribution one) and is labelled "Last known"; nothing is added client-side | **PASS** | FAIL (silent) |
| **C6** 390×640 and 390×844 in the stale state: the member tab bar is present with Home current; Retry is 44 px and reachable, bottom 393 / 484 above the bar's top 564 / 768; overflow 0 | **2 × PASS** | FAIL (no Retry) |

**Head 6 / 6; base 2 / 6.** The base passes only C1 and C2, the unchanged confirmed and unknown returns.

**Head first runs:** C2, C5 and both C6 cases passed on their first run. C1 and C3 / C4 failed their first run on **two instrument errors of mine**. I used the wrong testID for the momentum row (`wsf-community-momentum` instead of `wsf-momentum-row`). I also compared a CSS-uppercased eyebrow case-sensitively; the product showed "YOUR LAST-KNOWN CONTRIBUTION". Both were corrected and those two cases **rerun once, 2 / 2**.

**Base:** the first base run also hung C1 and C3 on my snapshot helper's unbounded read of an element that does not exist on the base. The reads were bounded to 2 s and C1 and C3 rerun on the base: C1 PASS, C3 FAIL on silence, as expected.

### 32.3 · Carried and focused runs on the head (items 5 and 6)

| run | first run |
|---|---|
| W9 `sprint-w9-return-continuity-rendering`, incl. "healthy return says nothing" and "first failed read keeps the existing error" | all pass |
| W8 `sprint-w8-social-privacy`, `sprint-w8-community-freshness`; W7 `community-freshness-verify` (F1–F4), `social-delta-verify` (DOM privacy incl. the zero / null mutation), `home-polish-verify` | **40 / 41** |

The one failure is my Check 27 privacy case, which expected two anonymous feed rows and got one. **It fails identically on the base, first run and rerun.** It is a time-dependent row expectation in my own fixture, not this delta. The privacy guarantees are carried by W8's privacy spec and my DOM-privacy delta spec, both passing on the head.

My Check 27 item-9 "stale seam" case, which measured the old silence, now reads "Last known" / "Couldn’t refresh" on the head. That is the change delivering what Check 27 reported.

### 32.4 · Limits carried

- **Separate seams, disclosed by W9:** presence and momentum come from separate reads and are not labelled last-known by this change.
- **One of mine:** the "Confirmed h:mm" after a recovery landed in the same minute, so the stamp's advance was not observed.
- **Not measured:** Safari and a real assistive-technology session. The live-region announcement was read from the DOM, not heard.
- **Earlier seam, not this delta's:** S1 from Check 30 (a removed member returned to the still-mounted community screen).

**Status:** tested on `9f73aaa6`; delivered by W9; **not accepted, integrated or staged**.

## 33 · FOCUS-RETURN-1 F1 successor (#477), exact `64b019676d12bb76e716a558860211a1d0afe307`, delta only from the reviewed `8f2cc15e` (Director #434 `5828286084`; W7 ACK `5828292045`): **PASS on items 1–5; F1 closed; no defect**

**Scope, by git.** One commit on `8f2cc15e`, touching 2 files (+45 / −5):
- `src/ui/focusReturn.ts`: `returnFocusSoon` adds a capture `pointerdown` listener on `document` that calls `finish()`. `finish()` sets `stopped` and removes that same listener. The "member got there first" branch, the re-land cap, the watch's expiry and the returned cancel all go through `finish()`.
- W9's focused spec gains one case.

**W7's delta instrument** is the Check 33 block of `sprint-w7-focus-return-verify.spec.ts`. The successor is served at 5019 and the reviewed head `8f2cc15e` at 5015 as the fail-first reference.

| case | successor | reviewed `8f2cc15e` |
|---|---|---|
| **S1** (item 1): after landing, a pointer press on blank space → focus `body` at 0, 0.1, 1 and 3.5 s | **PASS** | **FAIL**: focus re-landed on the launcher by 0.1 s, the F1 reproduction |
| **S2** (item 2): after landing, a press on a real control (progress Refresh, which re-reads and re-renders the hero) → focus stays on that control for 4 s, never back to the launcher | **PASS** | PASS (it did not snap back there either; a preservation case) |
| **S3** (item 3): no press; the landed launcher is removed from the DOM (labelled injection) → the watch re-lands on the fallback heading `wsf-community-name`, never `body` | **PASS** | PASS (preserved) |
| **S4** (item 4): `document` `pointerdown` listeners across three exits. Baseline 2, which is the two `followAttention` listeners of the mounted hooks. Each **watch: 3**; after **expiry: 2**; after a **press: 2**; the third watch is 3, so nothing stacks | **PASS** | trivially PASS (it adds no listener) |

**Item 5, prior paths, on the successor:** Check 30's R1–R10 and W9's focused spec (now 17) ran **27 / 27 on the first run**:
- R2: scroll 60 → 60;
- R7: after a blank click, focus is `body` at once and at 1 s. Under `8f2cc15e` it was re-landed on the launcher at +9 ms;
- R10: the active-tab reselect remains a no-op.

Everything else is carried from Check 30, since dependencies are unchanged: W9's 56-file regression, the shell and exit specs, the frames and the Director's pixel pass.

**Notes, not defects:**
- The listener is added when the restore starts, not when it lands. A press during the seek window, before any landing, also ends it. That is also the member's act, and the "member got there first" rule already covered focus-driven cases.
- Keyboard-only intent after landing is unchanged: moving focus with Tab to a control is "member" focus, which the watch never overrides.

**Carried open, not waived:**
- cold `/event` and `/queue` exits;
- Progress's "Start moving" (Enter, and the navigator replace);
- MOVE focus entry and containment;
- Safari and a real assistive-technology session;
- S1, the removed-member stale screen.

**Status:** tested on `64b01967`; not accepted, integrated or staged. No reruns in this check.

## 34 · OPS-PIN-502B-1 (#479), exact head `ae1fb2fa4304af88f1ce6f486247e4217ce7c035` on main `cd881775` (Director #434 `5832031524`; W7 ACK `5832038903`): **PASS on items 1–6; no defect**

Documentation- and test-level review only. No deploy, no dispatch, no merge, no cloud call, no source mutation. Everything ran in a detached worktree of the exact SHA; every temporary pin edit was restored and the worktree left clean (`git diff --quiet`).

| item | evidence | verdict |
|---|---|---|
| **1** head, base, tree and scope | parent exactly `cd881775`; tree `34401b246cd1baa16895589d9e5d5f171977537c`; **two files**: `approved-candidate.json` `275d6fdb` → `932a57cb`, `tests/verify-deployment.test.mjs` `a309d4f7` → `0d30925b`; +98 / −15 | **PASS** |
| **2** candidate, prior, additions | `approvedAppSha` `502b1e8d0c98c199445c664c696b3f73bb460f14`; `expectedPriorFunctions` **49**; `candidateAddedFunctions` unchanged, exactly `wsfsetcommunityvisibility`, `wsfcommunitymembers`, `wsfcommunityactivity`. `resolve-candidate.mjs` on the pin prints `CANDIDATE=502b1e8d…`. The boundary `7ee70e4..502b1e8d`: **15** first-parent commits; `.github`, hosting / rules / indexes, both `package.json`, `app.json` and `functions-westayfit/src/index.ts` identical; functions gain only the 25 expo-prize files, and nothing outside `src/expo-prize/` imports them. The 7ee70e4 label and notes are kept verbatim under `_previous…7ee70e4` keys | **PASS** |
| **3** next-run truth | the suite's new end-to-end case runs the real `read-inventory.mjs` gate then the real `verify-deployment.mjs` on a mocked 49-function staging with the three social services SHUT. Result: `VERIFY=pass`, `INVENTORY_BEFORE=49`, `INVENTORY_AFTER=49`, `EXPECTED_INVENTORY=49`, `CREATED_THIS_DEPLOY=none`, created / lost empty, no unexpected; the three reported `invoker_iam_check_enabled` and named for separate transport approval, **not declared usable** | **PASS** |
| **4** the real gate admits 49 and refuses 46 and 50 | W7 drove the real `read-inventory.mjs` directly with live-count shapes. **New pin:** 46 → exit 1 "has 46 WSF functions but this candidate was approved against 49"; **49 → exit 0, `PREFLIGHT_BEFORE=49`**; 50 → exit 1 "…has 50…approved against 49". **Main's pin (fail-first):** 46 → exit 0; **49 → exit 1 "has 49 WSF functions but this candidate was approved against 46"** (the refusal L0 reported); 50 → exit 1 | **PASS** |
| **5** historical coverage intact | the suite's kept cases pass: the 46 → 49 addition shape with the live approval, the 46-project negative case naming the three missing additions, and the earlier addition / negative / malformed-approval cases | **PASS** |
| **6** W3's evidence reproduces | **suite 32 passed** (exit 0); **`run-all.mjs`: all suites passed** (exit 0). **Fail-first** with main's approval restored: exit 1 at the tripwire (actual 46, expected 49). The suite stops at its first failure, so the gate refusal was proven separately in item 4. **Mutations**, each restored after: prior 48 → exit 1 (strict-equal on the prior); `candidateAddedFunctions` removed → exit 1 "present but not expected: wsfcommunityactivity, wsfcommunitymembers, wsfsetcommunityvisibility"; one addition dropped → exit 1 "present but not expected: wsfcommunityactivity" | **PASS** |

**Carried, not cleared by this pin (as the pin itself states):**
- the three social services are transport-SHUT until Operation 2 and its read-back;
- the `wsfContributions` index has no READY receipt;
- email delivery and the kiosk hold are unchanged;
- there is no production change.

**Not measured:** a real staging run. The gate and verifier ran against local list files and a mocked API, which is the suite's own method.

**Status:** reviewed on `ae1fb2fa`. Not merged, not dispatched; L0 is the sole merge and dispatch owner.

## 35 · BASELINE PARITY, served/integrated `502b1e8d0c98c199445c664c696b3f73bb460f14` against Lovable managed `8c73dd7f5c68d818bf1ebc0a17377fb3eadb25d1` (Director #434 `5834104466`; owner packet #365 `5834082617`, W7 section; W7 ACK `5834118558`): **observations and measurements, no verdict**

This is independent QA of the baseline, not a creative verdict and not an acceptance. Every figure comes from one synthetic emulator stack (project `demo-wsf-local`) serving an emulator-flagged build of detached `502b1e8d`. The bundle carries the `502b1e8d` stamp and the worktree is clean. Timings are wall-clock ms from the `pointerdown` in one headless Chromium on the loopback. They are **not a speed claim**. The instrument is `apps/westayfit/tests-e2e/sprint-w7-baseline-parity-verify.spec.ts` (P1–P6). Its assertions only confirm that the harness reached the state it measured. The behaviour below comes from its `MEASURE` lines.

**How it measures.** An init script logs `pointerdown` and Enter/Space. On every mutation and every animation frame it records:
- each watched screen's mount (a new DOM instance counts as a new mount);
- when each screen is shown or hidden;
- the watched screen actually **on top** at the viewport centre, via `elementFromPoint`. Inactive tab scenes stay laid out under the active one, so "shown" alone is not what the member sees;
- 30 frames of `getBoundingClientRect` and cumulative opacity for each surface that appears.

The runner counts callables (port 5001) and Firestore requests (port 8080). Clips were recorded for every case, and stills for the transient frames (P6). P6 used labelled **INJECTED** 1.5 s delays for the stills only, and no timing was taken from it. Run 2 of 12 cases passed, and P6 passed separately. Run 1 (11 cases) agreed except for the two points listed under "run differences".

### 35.1 One-goal MOVE: resolver → full-page contribution (P1, P1s at 390×640, P1r with reduced motion)

| from | first feedback | contribution on top | callables | Firestore | Back returns to | origin remounted |
|---|---|---|---|---|---|---|
| Home (community) | 10 ms, `/move` sheet | 121 ms | 5 (`wsfMyCommunities` 1, `wsfListGoals` 2, `wsfGoalPulse` 1, `wsfMyContribution` 1) | 2 | Home, same instance, 7 ms; then **5 refresh callables** | 0 |
| Community | 8 ms | 158 ms | 5 | 2 | Community, 6 ms; 0 callables | 0 |
| Progress | 6 ms | 123 ms | 5 | 2 | Progress, 5 ms; 0 callables | 0 |
| You | 6 ms | 141 ms | 5 | 2 | You, 5 ms; 0 callables | 0 |
| Home at 390×640 | 13 ms | 152 ms | 5 | 2 | Home, 7 ms; 5 callables | 0 |
| Home, reduced motion | 11 ms | 139 ms | 5 | 2 | Home, 7 ms; 5 callables | 0 |

Observed sequence (all six runs):
1. On MOVE, the transparent-modal `/move` sheet appears as a short "working" sheet at the bottom: "Close" and "Finding what you are moving toward…" (still `still-move-working.png`). It covers the tab bar, and the page behind is dimmed. The sheet appears in place: its top is 744 px at 844 and 540 px at 640 from the first sampled frame, with opacity 1. There is **no slide or fade**.
2. At about +72 to +87 ms the resolver does `router.replace` to `/contribute/<goal>?groupId=…&mode=move`. For about 40–70 ms **no watched screen is on top**: this is the contribution route's own unlabelled "Loading goal…" state.
3. The **full-page** contribution screen follows, with a cut rather than a transition. Its card starts 40 px higher for the first 2–4 frames (214 → 254 at 844; 185 → 225 at 640), which is a **layout shift**, not motion.
4. On the contribution page, the **tab bar and the masthead are absent**. The exit is "Back". Focus sits on `BODY`.
5. The heading is the page's "Ready when you are." with an optional timer and "I'm done — enter my squats" (still `still-contribute-move.png`). There is no "Start moving" sheet title in view.

Reduced motion and 390×640 made no difference: there is no motion to reduce.

**Lovable `8c73dd7f` for comparison** (source read through the connector; the prototype was not run):
- MOVE is `open("move")` into the **same** in-page sheet (`MoveFlow` in `Sheet`). The tab bar and masthead stay mounted behind a scrim, and there is no route change.
- The button is an `Activity` icon plus "MOVE" (`shell.tsx`). The baseline button is the text "MOVE" only (`MemberTabBar.tsx`).
- The sheet has explicit motion: `wsf-sheet-in` translateY(28px) + opacity over `--dur-sheet-in` 240 ms; exit 180 ms (`EXIT_MS`); scrim fade; `wsf-step-fwd/back` 18 px over 200 ms between steps; press feedback `scale(.97)`/`.94` over 90 ms. Under reduced motion these are all set to `animation: none`.
- The `Sheet` focuses its first control or `[data-autofocus]` and contains Tab. On close, focus returns to the trigger and scroll is restored.

### 35.2 Zero- and two-goal MOVE (P2, from Home)

- **Zero goals:**
  - The no-goal sheet is on top at +13 ms and filled at +77 ms, after 2 callables (`wsfMyCommunities`, `wsfListGoals`) and 0 Firestore requests.
  - The sheet **jumps** in size, from top 744 to 430, with no animation. It covers the tab bar, and the scrim covers the masthead.
  - Text: "Nothing is running right now … Go to your community".
  - **Focus stays on the MOVE button**, behind the sheet.
  - Close returns to the community in 5 ms, with 3 refresh callables. Focus is still on the MOVE button.
- **Two goals:**
  - The choose sheet appears at +75 ms after 2 callables (744 → 342, a jump). Text: "What are you moving toward? 2 goals are open here…", and each goal has its own "Move".
  - Focus stays on the MOVE button.
  - Choosing the second goal shows the full-page contribution on top at +68 ms, after 3 callables and 2 Firestore requests.

Lovable's `MoveFlow` keeps these choices inside the one sheet. This check did not read `move.tsx` again, so the details of Lovable's zero- and multi-goal copy are not asserted here.

### 35.3 Community loading: the FormShell "Your community" frame (P3, P3s, P3r, P3b)

**Cold document load of `/community/<id>`** (3 runs):

| measure | 844 | 640 | reduced motion |
|---|---|---|---|
| loading frame appears | +125 ms | +131 ms | +126 ms |
| loading frame visible for | 242 ms | 272 ms | 364 ms |
| content appears | +367 ms | +403 ms | +490 ms |
| callables | 7 | 7 | 7 |
| Firestore requests | 6 | 6 | 6 |

The 7 callables are `wsfListGoals`, `wsfGoalPulse`, `wsfMyContribution`, `wsfMyCommunities`, `wsfListChallenge`, `wsfCommunityMembers` and `wsfCommunityActivity`. In run 1 at 390×844, the **loading FormShell appeared about 90 ms before the tab bar and masthead mounted** (+146 ms, against +236 ms for the chrome). For those frames the member sees a bare auth-style shell.

The frame itself (still `still-community-loading-masthead-home.png`) is the navy FormShell field with the wordmark and a large **"Your community"** heading, then "Loading…" on cream. It is then replaced by the community hero, whose eyebrow is also "Your community" and whose layout differs. That is the header flash.

**Soft (in-app) entries:**

| entry | FormShell on top | visible for | community on top | callables | new community instance |
|---|---|---|---|---|---|
| Home list → community | +27 ms | 193 ms | +220 ms | 7 | yes |
| Community tab row "Switch" → other community | +22 ms | 110 ms | +132 ms | 5 | yes (+1) |
| masthead Home (35.4) | +53 to +82 ms | about 135–190 ms | +193 to +215 ms | 9 | yes (+1) |
| Home after Settings Back (35.5) | +61 to +97 ms | about 150 ms | +209 to +255 ms | 9 | yes (+1) |

The Home list case involved two memberships, where Home shows the list. The "Switch" row lands on the **Home** tab, not the Community tab.

With a single community, the Community tab's "CURRENT" panel has **no control that opens the community**. The measured openers are 0; the panel is information only.

Lovable keeps all four tab sections mounted (`<section hidden>`), and its shell has no loading frame between tabs. Community switching there is a chip on the Community screen (`switch-chip`); this check does not assert its timing.

### 35.4 Warm tab returns, masthead Home, active reselect (P4, 390×844)

- **Warm return You → Home:** the community is on top at +12 ms, as the same instance with no loading frame. Scroll was **kept at 166 px**, which is this fixture's maximum. The return issues **5 refresh callables**.
- **Progress:** the first visit shows `wsf-activity-loading` for about 80–100 ms, with 3 callables. The warm return is +6 ms, with 0 callables, 0 remounts and no loading frame.
- **You:** the first visit shows its loading state for about 115 ms, with 3 callables.
- **Active reselect:** Progress and Home were each a **true no-op**: no navigation, no event, no callables, no Firestore requests, no remount and scroll kept (166 → 166). The idle control, 1.5 s on Home with no tap, also issued 0 callables.
- **Masthead Home, from You or from Home itself:** the wordmark does `router.navigate('/')`. Home's index flashes "Opening your community…" (`wsf-home-opening-community`), then the **community loading FormShell**, then a **new community instance**. Scroll was **reset to 0**. It cost **9 callables** (`wsfMyCommunities` and `wsfListGoals` twice each) and 3–4 Firestore requests. The community was on top at +215 ms from You. Tapping the masthead while already on Home rebuilt the screen in the same way.

**Lovable comparison:**
- Tabs use `goTab`. Reselect is a no-op (`if (cur === t) return cur`), and scroll is saved and restored per tab.
- Each tab section fades in with `wsf-tab-in` (opacity .35 → 1, 140 ms), which reduced motion turns off.
- Lovable's masthead wordmark is an `<img>`, **not a Home control**. The baseline's masthead Home has no counterpart there.

### 35.5 Settings presentation (P5, P5s, P5r; from You and from the menu)

- **Opening Settings:** `router.push('/settings')`, a root stack route. From You or from the menu (opened on Home), Settings is on top in 8–15 ms with 0 callables. It is a **full page**: the tab bar and the masthead are absent, and there is no motion (top 0 on every frame, opacity 1). The chrome is a bare "‹" back link, then "SETTINGS / Your preferences / Privacy" (still `still-settings.png`). Focus sits on `BODY`.
- **Back:** "‹" does `router.replace('/you')`. That **rebuilds the tab navigator**: a new tab bar (instance 2, then 3), a new masthead, and **You remounted with its loading state** for about 95–125 ms, with 3 callables and 2 Firestore requests.
- **After Back:**
  - Opened from the menu **on Home**, Back lands on **You**, not Home.
  - Going Home afterwards shows the community loading FormShell and a **new community instance**, with 9 callables.
  - The same happened at 390×640 and with reduced motion.

**Lovable comparison:** there is no Settings route. "Privacy" is a **panel** from the menu (`Sheet variant="panel"`), with `wsf-panel-in` translateX(32px) + opacity over 240 ms and exit 180 ms. The tabs stay mounted behind a scrim, and focus returns to the trigger on close.

### 35.6 What this does and does not establish

These are baseline observations recorded for W9's APP-FEEL-PARITY-1 and the Director. They are not graded against a verdict.

**Observations that match the packet's concerns:**
- **O1:** MOVE with one goal goes from sheet to full page. That is a route change, the chrome disappears, there is a cut and a 40 px layout shift, and there is no motion.
- **O2:** the FormShell "Your community" frame appears on every fresh community mount: cold load, Home list, Switch, masthead Home and Home after Settings Back. On a cold load it shows about 90 ms before the chrome.
- **O3:** masthead Home is **not** a warm return. It remounts the community, shows the loading frame, resets scroll and makes 9 calls.
- **O4:** Settings Back rebuilds the tab navigator, which loses the kept tab state (You reloads, and Home reloads on the next visit).
- **O5:** the MOVE sheets, Settings and the contribution page have no enter or exit motion. Lovable specifies it.
- **O6:** focus is not moved into the MOVE sheet or the contribution page (MOVE button or `BODY`).

**Consistent with the packet's rules:**
- warm tab returns keep the instance, keep the scroll and show no skeleton;
- active reselect is a true no-op;
- Back from the contribution page returns to the exact origin tab instance.

**Run differences, disclosed:**
- In run 1, the session's **first** MOVE took 2,953 ms to contribution content, against 121 ms in run 2. Run 1 was the first callable use after the emulator started, so this is attributed to function cold start. It is **not** a product timing.
- In run 1, "reselect Home" showed 2 callables. Run 2 added a 3 s settle after arriving Home and an idle control, and showed 0 for both. The run 1 calls were the tail of the preceding return's refresh.

**Limitations:**
- Chromium only, headless, loopback emulators, synthetic fixtures. No Safari, no real device, no network shaping, no assistive-technology session.
- Keyboard-initiated MOVE was not driven in this check (it was covered in Checks 30 and 33).
- "On top" is sampled at the viewport centre only.
- Frames are `requestAnimationFrame` samples, not compositor frames.
- The Lovable figures are **source reads** at `8c73dd7f` (`shell.tsx`, `ui.tsx`, `overlays.tsx`, `styles.css`), not a run. The preview host is blocked by this environment's proxy.
- Clips (`.webm`) and stills are kept in the session scratchpad, not committed. That follows the rule never to commit artifacts.

**Next:** when W9 posts an APP-FEEL-PARITY-1 successor, verify only the affected behaviour (35.1–35.5) on that exact SHA with this instrument.

**Status:** measured on `502b1e8d`. This is not a verdict, and nothing is accepted, integrated or staged. No product source, screenshot baseline, deploy or cloud call was touched.
