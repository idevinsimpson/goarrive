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

**Next:** L0's combined candidate (W4's successor ⊕ W9's `a87cd3b` ⊕ W8's
`eff65b0` on `f2f901a`), checked as one tree (`5800787974` §2, `5801193038`).
