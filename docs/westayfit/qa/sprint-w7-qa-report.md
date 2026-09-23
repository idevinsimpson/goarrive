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

# Check 6 — further checkpoints

Awaiting L0's routing. W7's standing lane is independent QA for W4 / W2 / W6 / W8 (Director `5787928919`).
