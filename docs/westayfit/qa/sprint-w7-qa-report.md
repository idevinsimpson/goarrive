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

## 36 · APP-FEEL-PARITY-1 checkpoint 1 (#482), exact `766ee0858a6189f5b26f17ac4ea6efa9d674c15e` on `502b1e8d` (Director #434 `5834554003`; W7 ACK `5834558949`): **one measured defect (D1: double exit), one measured accessibility finding (F2: focus lands on the scrim); everything else routed PASSES**

This is a pushed checkpoint, not a delivery. The candidate is one commit on `502b1e8d`: 8 files changed, the app only, with no functions change. It was built emulator-flagged in a detached worktree, with the bundle stamped `766ee085`. It was served on 5014 beside Check 35's emulators and base build (5010, `502b1e8d`).

The instrument is `apps/westayfit/tests-e2e/sprint-w7-app-feel-cp1-verify.spec.ts`. It reuses Check 35's harness (mount, on-top, frames and request counting) and adds:
- a sheet probe: the tab behind, painted scrims, the panel, focus and `inert`;
- a 20-stop Tab/Shift+Tab sweep;
- a 1.5–2.5 s path/on-top trace after every exit.

**Runs on the head:**
- Run 1: 12 passed, 2 failed. The failures were fixture waits, not product results:
  - S4 waited without limit for a Back label, but the kiosk page has "Finish" instead;
  - S3's context close hung on an injected in-flight route.
- Both were fixed (bounded reads, and unroute before close). The tab sweep was also corrected to use the sheet **in front**: in run 1 it measured the chooser beneath the goal sheet.
- S1–S4 were rerun, 4/4.
- The race cases R1–R3 were run twice, 6/6 both times, with the same outcome.

**Proof able to fail:** on the base, S1 and R1 fail at "no sheet panel" (element not found).

**Preserved behaviour on both builds:** existing event and kiosk specs (`event-return`, `ui-event-activity-choice`, `sprint-w1b-kiosk-confinement`, `ui-kiosk`, `sprint-w1b-kiosk-idle-finish`) pass **27/27 on the base and 27/27 on the head**. W9's `sprint-w9-app-feel-parity-1` passes 8/8 on the head.

### 36.1 Routed rows

| row | measured on `766ee085` (Check 35 baseline in brackets) | result |
|---|---|---|
| one-goal MOVE → the flow is a sheet, from all four tabs | Path `/contribute/…&mode=move` with `role="dialog"`, `aria-label` "Start moving" and the title in the sheet header beside **Close**. The origin tab stays **shown, the same instance (0 remounts), and `inert`**; the tab bar is also inert. [Base: a full page, with the tab bar and masthead absent.] | PASS |
| visible, same mounted background | Painted behind one scrim (alpha 0.42). The panel is 776 px tall at 844 (92 % max) and 589 px at 640, so only the masthead band of the tab stays visible. That is a presentation choice; it is not graded here. | PASS (observed) |
| single scrim | One goal: 1 painted scrim. Goal sheet over the chooser: 2 scrims, **1 painted** (the goal sheet's is clear). | PASS |
| zero keyboard access behind | Every Tab/Shift+Tab stop was either in the panel or on the sheet's own scrim (F2). None was ever in the tab, tab bar or masthead, because `inert` is present. | PASS |
| exact scroll | Home 166 → 166 (844) and 300 → 300 (640). The other tabs were unscrollable in this fixture (0 → 0). | PASS |
| exit | One path change per Close, at +221–253 ms (the 180 ms exit), to the exact origin tab, with 0 remounts and `inert` cleared. Escape does the same (+195 ms). Reduced motion: +42 ms. | PASS, except under D1 |
| focus return | After Close or Escape, focus is on `wsf-member-tab-move` (the opener). Closing the goal sheet over the chooser returns focus to the chosen chooser row. | PASS |
| focus entry | Focus lands on the **scrim**, not in the panel (F2). | FINDING |
| chooser → goal sheet | Chooser at 342 px; the goal sheet opens over it. Close returns to the chooser (`/move`), and the chooser's Close returns to Home. | PASS |
| steps inside the sheet | Every step renders **inside the panel**: timer (running 0:01), count, review, **confirmed receipt** (title "Contribution receipt"), **pending** after an INJECTED dropped request ("Your attempt … Don't record it again. Confirm this contribution") and **unknown** after an INJECTED reply lost on re-check. After submit, focus is on `BODY`, outside the panel while the tab is inert. That is recorded, not graded. | PASS |
| preserved as pages | "Already moved?" (`mode=record`), a cold direct `mode=move` link and a cold `mode=move&kiosk=1` link are all the **page**: no sheet, with the wordmark, and "Back" or kiosk "Finish". The event and kiosk specs pass 27/27 on both builds. **Limit:** a kiosk-flagged flow opened *over the member's tabs* cannot be reached from the member UI, so only the cold link was driven. | PASS |
| 390×640 | Panel 51–640. Close (60–104), "I'm done" (528–582) and "Start timer" (453–501) are each reachable at their own centre. | PASS |
| reduced motion | No travel: frames jump from rest to rest, opacity 1 throughout. Close exits in 42 ms. | PASS |
| motion (Chromium web) | Panel entry is translateY 28 px + opacity over about 240 ms, and the scrim fades. On a one-goal hand-off the panel **grows mid-entry**: its top jumps from about 650 to 73 when the goal's content replaces the loading card, so the travel is visible only in the first 3–6 frames. That is recorded, not graded. | OBSERVED |
| community loading (the FormShell frame) | Cold load: "YOUR COMMUNITY · Loading your community…" in the community's own composition, with **no FormShell wordmark and no heading**. [Base: FormShell "Your community / Loading…" with its own wordmark.] The frame still appears about 90 ms **before** the tab bar and masthead mount (102 against 193 ms; base 118 against 234). | PASS (composition); ordering unchanged |

### 36.2 The source-risk races (measured)

| case | trace (ms after the Close press) | result |
|---|---|---|
| **R1** one-goal sheet from **You**: Close, then browser Back at +40 | +106 / +118: `/you` (Back popped the sheet); **+235 / +251: `/activity`** | **D1 — two exits.** The delayed `router.back()` fires after the sheet is already gone and pops the **tab history**, moving the member to the previous tab (Progress). Reproduced 2/2. |
| **R1** from **Home** | +107 / +104: `/community/<id>`; **+241 / +244: `/activity`** | **D1**, 2/2 |
| **R1z** the resolver's no-goal sheet, from You | +98 / +107: `/you`; **+228 / +243: `/activity`** | **D1** on the resolver's `close()` too, 2/2 |
| **R2** Close on the resolver while its one-goal read is held (INJECTED), released at +0 | +108 / +92: `/contribute/…` (**the goal sheet appears after Close**, and its callables fire); +240 / +227: `/you` | One net exit, with the right destination and focus. But the resolver still hands off after Close, so the goal sheet flashes for about 130 ms and makes 3 callables. **F3**, recorded. |
| **R2** released at +90 | +197 / +189: `/contribute/…`; +233 / +256: `/you` | as above; the flash lasts about 40–65 ms |
| **R3** Close, then MOVE pressed at +60 | +224 / +225: `/you` only | One exit, and the MOVE press is **not delivered** (the tab is still inert or covered). No delayed navigation hits a newer screen. |
| **R3** Close, then MOVE at +220 | `/you` → +278 `/move` → +335 `/contribute/…` | Reopens cleanly, and the old timer does **not** close the new sheet. |

**D1 (defect, measured):**
- **What:** after Close, the navigation is delayed 180 ms (`setTimeout(go / leave, SHEET_OUT_MS)`) and is not cancelled when the screen goes away. If the sheet is dismissed in that window by another path (browser or Android back), the delayed `router.back()` runs anyway. Because `router.canGoBack()` is true within the tabs, it pops the member's **tab history**: a second exit that lands on a different tab.
- **Where:** both the contribution sheet (`closeSheet`) and the resolver (`close` → `leave`).
- **Evidence:** reproduced 6 times out of 6 across three journeys, never on the first exit alone.
- **What it is not:** in S1, a Close alone is always one exit.

**F2 (measured):**
- **What:** the sheet's first focusable is its **scrim**.
  - The contribution scrim renders as a `DIV` with `tabindex="0"` and no role or name, even though it has `focusable={false}` and `accessible={false}`.
  - The chooser scrim is a `BUTTON`, `tabindex="0"`, `role=button`, named "Close".
- **Effect:**
  - Focus entry (`useSheetFocusContainment`: first focusable in the sheet root) lands on the scrim, not in the panel. This happened for pointer and keyboard opens, on all four tabs and on the chooser.
  - The scrim is a Tab stop outside the panel (4 of 20 stops).
  - Focus stays contained within the sheet, and nothing behind it is reachable.
- **Reference:** Lovable's `Sheet` focuses the first control inside the dialog, and its scrim is not focusable.

**F3 (recorded):** Close does not cancel a one-goal resolution already in flight. The goal sheet mounts, fetches, then leaves, as measured in R2.

### 36.3 Not failures of cp1, by the routing

Masthead Home's remount, Settings, and the MOVE icon and instructions are unchanged from Check 35 (§35.4, §35.5, §35.1). They stay open for checkpoints 2–4.

### 36.4 Limits

- Chromium web only, headless, on loopback emulators with synthetic data. **This does not show iOS or Android native stack motion or Safari keyboard behaviour.** Native keeps the stack's `slide_from_bottom`, which was not exercised.
- Frames are `requestAnimationFrame` samples.
- The pictures and transition frames for the Director's visual review come from W9's and L0's exporter. My clips are kept in the session scratchpad only.
- The races were driven with Playwright's `goBack` and a real `mouse.click`. Hardware back on Android was not driven.
- Fixture fixes and reruns are disclosed above.

**Status:** tested on `766ee085`. Nothing is accepted, integrated or staged. D1 is for W9. If W9 pushes a correction, I will carry forward the unchanged rows and rerun only S1 exits, R1–R3 and the focus rows.

## 36B · APP-FEEL-PARITY-1 cp1 successor, exact `b497ce4c746b6f17548b6f353d165bb54d719193` (Director #434 `5834819175`; W7 ACK `5834964411`): **D1 and F3 fixed (fail-before / pass-after on W7's own instrument); F2 unchanged; the focused rows PASS**

**Delta.**
- `766ee085..a2a598d2` touches exactly one file: W9's capture spec `sprint-w9-app-feel-parity-capture.spec.ts`, +222. It changes no product file, so §36's product rows carry forward through it.
- `a2a598d2..b497ce4c` changes three product files: `contribute/[goalId].tsx`, `move/index.tsx` and `sheetMotion.ts`. It also changes W9's two specs.
  - A new `useSheetExit` puts both sheets behind one exit. The timer is cleared on blur and on unmount, and a late timer does nothing unless the sheet is still focused.
  - The resolver checks `leaving()` after each read.
  - Close gets its own testID, `wsf-contribute-close`. `wsf-contribute-back` stays the page Back and the outcome exits.
  - The scrim keeps pointer events during the exit.

**Build.** A detached worktree, emulator-flagged, with the bundle stamped `b497ce4c`. It was served on 5015 beside `766ee085` (5014) and the same emulators.

**Instrument changes.** W7's spec now finds Close with `wsf-contribute-close`, falling back to `wsf-contribute-back` on `766ee085`. The race cases now **assert**:
- R1 / R1z: exactly one path change, and the member stays on their tab;
- R2: no `/contribute` path after Close, and the member ends on `/you`.

**Fail-before / pass-after (W7's own instrument, the same file on both builds):**

| case | `766ee085` | `b497ce4c` |
|---|---|---|
| R1, from You: Close, then Back at +40 ms | **FAIL** "more than one exit": `/you` +108, then **`/activity` +242** | PASS: `/you` +106, one exit, You still current |
| R1, from Home | **FAIL**: `/community/<id>` +130, then **`/activity` +263** | PASS: `/community/<id>` +121, one exit |
| R1z, the resolver's no-goal sheet, from You | **FAIL**: `/you` +111, then **`/activity` +244** | PASS: `/you` +108 |
| R2, Close while the one-goal read is held, released at +0 | **FAIL** "the goal sheet opened after Close": `/contribute/…` +117, then `/you` +239 | PASS: `/you` +244 only, 0 callables after Close |
| R2, released at +90 | **FAIL**: `/contribute/…` +207, then `/you` +238 | PASS: `/you` +242 only |

That is 5/5 failing before and 5/5 passing after. On `766ee085` each failure is the assertion itself, not a fixture error.

**Focused rows rerun on the head (7/7):**
- **S1, all four tabs:**
  - The sheet sits over the same `inert` instance (0 remounts), with 1 painted scrim.
  - Close gives **one** exit at +225–238 ms to the exact tab.
  - Scroll is kept: Home 166 → 166.
  - Focus returns to MOVE, and `inert` is cleared.
- **S1k:** Enter opens the sheet; Escape gives one exit at +195 ms; focus returns to MOVE.
- **S2:** the chooser opens the goal sheet over itself, with 1 painted of 2 scrims. Close returns to the chooser and focus goes to the chosen row. The chooser's Close then returns to Home.
- **S3:** every step renders inside the sheet: timer, count, review, confirmed receipt, pending after an INJECTED drop, and unknown after an INJECTED lost reply.
- **S5s, 390×640:** Close, "I'm done" and the timer are each reachable. Scroll 300 → 300.
- **S5r, reduced motion:** no travel; Close exits in +70 ms.
- **R3:**
  - MOVE pressed at +60 ms: one exit, and the press lands on the scrim, as the delta intends.
  - MOVE pressed at +220 ms: it reopens cleanly, and the old exit does not close the new sheet.

**Unchanged — F2 (§36).** Focus still enters on the scrim. The contribution scrim is a `DIV tabindex="0"` with no role or name; the chooser scrim is a `BUTTON` named "Close". The scrim is a Tab stop outside the panel (4 of 20 stops on the goal sheet, 3 of 12 on the chooser), on all four tabs, with the pointer and the keyboard. Nothing behind the sheet is reachable. This delta does not touch it.

**Carried from §36, not rerun:** preservation (S4 and the event and kiosk specs), the 390×844 motion observations and the community loading composition. None of those files' relevant paths changed except the exits already rerun.

**Not independent of W9, stated plainly:** W9's own 11/11 was not rerun or counted. The results above come from W7's instrument only.

**Limits:** as §36.4. Chromium web only; no native motion, Safari keyboard or Android hardware back.

**Status:** tested on `b497ce4c`. Nothing is accepted, integrated or staged.

## 37 · Independent ops review: SOCIAL-STAGING-DEMO-1 seed (A) and the SOCIAL-DEMO-SEED-MODE workflow (B) (L0 #434 `5835728833`, Director retarget `5835796517`; W7 ACK `5835806524`)

**Scope.** Local emulators and local runs only. There was no dispatch, no staging access and no cloud call. Firestore and Auth ran on 8080 and 9099 under the projects `demo-w7-seed` (isolated) and `demo-wsf-local` (for the real `wsfContribute` callable on the functions emulator, port 5001). `firebase-admin` 12.7.0 was loaded from an installed `functions-westayfit`.

**Disclosure:** `firebase-admin` attempted its GCE metadata lookup, which the environment's proxy answered 403. That is project detection, not a request to any Google API or project.

**Targets, verified by git:**

- **A (candidate):** `9f8b55f602a46a08a5877fabacf1ff4e8f86a969`.
  - Chain: `bcfef524` → `06bcb288` → `c45760e8` → `9f8b55f6`. `c45760e8` is docs only: one file, `OPERATOR-HANDOFF-social-staging.md`.
  - The four `staging-demo/` blobs are identical at #484's head `5765b0ea` (`seed-social-demo.mjs` `603f608a`, fixture `cb7c6a71`, dry run `dbbadcf9`, README `9288648c`).
  - Fail-before baselines: `bcfef524` for Auth and counters; `06bcb288` for the owner-membership and recent-addition correction and the transactional rechecks.
- **B:** `8f8c4530e42c66faa9b0b70834198a82cda6c69c` on `main` `7e423a48`.
  - The workflow diff is **+145 / −0**.
  - `8f8c4530..5765b0ea` touches only the three `staging-demo/` files, so B is unchanged in the successor.

**W7's instrument.** The files are in the session scratchpad and are **not committed**, because my file reservation does not cover them; they are described here.
- `driver.mjs` has suites `auth`, `race`, `recheck`, `static` and `privacy`. Every case prints one `RESULT` line with the expected result, the observed result and PASS or FAIL, and nothing aborts early.
- `inject.mjs` is preloaded with `node --import` into the **seed** process. Every use is labelled INJECTED in the output:
  - `INJ_TX`: before the seed's first transactional read of a path, a concurrent writer writes a document outside the transaction;
  - `INJ_DEL`: the same, before the seed's first delete of a path;
  - `INJ_OWNER_RACE`: after each transaction body, with its reads done and before commit, and before direct counter writes or batch commits, the **owner records 7 through the real `wsfContribute` callable**. It does so only once the goal and the owner's membership exist; `RACE_BURST` repeats it.
- An Auth fault proxy in front of the Auth emulator answers one uid's `accounts:lookup` with 403, 500 or 429, or resets the connection.

W3's own emulator dry run passes 21/21 on `06bcb288` and 22/22 on the candidate. That is W3's evidence, reproduced but not counted here.

### 37.A Seed candidate `9f8b55f6`: **Auth, concurrency, seam, apply-path ownership, drift and privacy PASS. Two preservation gaps reproduced (G1 cleanup race, G2 counter/total ownership); both also exist on `06bcb288`, so neither is a regression.**

| # | case | `bcfef524` | `06bcb288` | `9f8b55f6` |
|---|---|---|---|---|
| AU1 | owner lookup gets 403 PERMISSION_DENIED | exits 3, but **says "no Auth record"** (the error read as absence) | exit 3, `AUTH_ERROR=auth/insufficient-permission`, 0 writes | same, **PASS** |
| AU2 | synthetic `wsfdemo-m07` lookup gets 500 | **exit 0, 100 documents written** | exit 3, `auth/internal-error`, 0 writes | **PASS** |
| AU3 | synthetic `wsfdemo-m12` lookup gets 429 | **exit 0, 100 written** | exit 3, 0 writes | **PASS** |
| AU4 | synthetic `wsfdemo-m03` lookup: connection reset | **exit 0, 100 written** | exit 3, `app/network-error`, 0 writes | **PASS** |
| RC1 | the owner records twice through **real `wsfContribute`**, then the seed applies again | 459 = 459 = 459 | — | 459 = 459 = 459, **PASS** |
| RC2 | `--reanchor` with owner calls interleaved inside its transactions (INJECTED, 3) | 1 landed; consistent | — | 3 landed; 480 = 480 = 480, **PASS** |
| RC3 | a first apply with owner calls interleaved during the ledger phase (INJECTED, 3) | 0 landed | — | 3 landed; 466 = 466 = 466, **PASS** |
| RC4 | re-creating a missing row while the owner records once | consistent | — | 487 = 487 = 487, **PASS** |
| RC5 | re-creating a missing row while the owner records **10 times** (INJECTED burst) | **ledger 543, shards 536: 7 lost** (the absolute shard write) | — | 557 = 557 = 557, **PASS** |
| T1 | a foreign goal appears after classification, before its create | refused, preserved | refused, preserved | refused ("became foreign during the run"), preserved, **PASS** |
| T2 | the owner's sample membership appears **without the marker** before its create (a real join) | — | **exit 0, 100 written** | refused, his row preserved, **PASS** |
| T3 | a foreign ledger row appears before its transactional create | — | refused, preserved | refused, preserved, **PASS** |
| T4 | a foreign recent-addition appears at the linked path during the row transaction | — | **exit 0; the foreign addition overwritten (amount 999 → 40)** | `ALREADY_EXISTS`; the row is **not** created (the transaction stays atomic); preserved, **PASS** |
| T5 | `--reanchor`: the owner edits the goal after classification | — | kept | kept (drift during the run), **PASS** |
| T6 | `--reanchor`: the linked addition is replaced during the row transaction | — | **exit 0; overwritten (999 → 40)** | refused, preserved, **PASS** |
| T7 | re-creating a missing addition: a foreign document appears at that path | — | the foreign document deleted (no injection fired; pre-case) | **preserved, but exit 0 and not reported (P1)** |
| S3 | the owner's sample membership exists without the marker, then apply runs | — | **exit 0, 99 written** | exit 3, `FOREIGN=1`, 0 writes, **PASS** |
| S4 | a foreign document at an addition path, its row absent, then apply runs | — | **exit 0; overwritten** | exit 3, 0 writes, **PASS** |
| S5 | cleanup: the owner's sample membership without the marker | — | **exit 0; his row DELETED** | exit 3, 0 deleted, **PASS** |
| S6 | cleanup: an addition collision beside an existing row | — | **exit 0; DELETED** | exit 3, 0 deleted, **PASS** |
| **C1** | cleanup: the owner's sample membership is rewritten **without the marker after classification** (he left and rejoined) | — | **DELETED** | **DELETED, exit 0: G1** |
| **C2** | cleanup: a foreign document takes a synthetic profile path after classification | — | **DELETED** | **DELETED, exit 0: G1** |
| **S1** | apply: a foreign counter shard already exists under a fixture goal (goal absent) | — | 50 → 110, exit 4 after 100 writes | **50 → 110, exit 4 after 100 writes: G2** |
| **S2** | apply: a foreign member total already exists at a fixture member-total path | — | 999 → 1084, exit 4 after 100 writes | **999 → 1084, exit 4 after 100 writes: G2** |
| P1 | fields and accounts | — | — | 100 fixture documents, 0 with email / phone / photo / avatar / invite / contact keys; 0 synthetic Auth accounts; `OWNER_DATA_OUTSIDE_FIXTURE_UNCHANGED=true`, **PASS** |

**Seam `WSF_DEMO_TEST_INTERLEAVE`: inert without the emulator.**
- The only use is `seed-social-demo.mjs:264`, `if (process.env.FIRESTORE_EMULATOR_HOST && process.env.WSF_DEMO_TEST_INTERLEAVE)`.
- With `FIRESTORE_EMULATOR_HOST` set, `guardProject` refuses anything but a `demo-*` project, so the seam can never be active against staging.
- Neither variable appears anywhere under `.github/` at `8f8c4530` (`git grep`).
- This row is **static**: a run without the emulator host would reach Google, and that was not done.

**G1 — preservation gap: cleanup has no recheck at delete time.**
- *What:* cleanup classifies everything, then deletes each path with a plain `get()` and `delete()`. There is no transaction and no marker check at delete time (`seed-social-demo.mjs:403`).
- *Effect:* a document that becomes foreign between classification and deletion is deleted.
- *Narrow reproducer (C1):*
  1. Seed the fixture.
  2. Start `--cleanup --confirm-cleanup SOCIAL-STAGING-DEMO-1`.
  3. Before its first delete, the owner's row `wsfMemberships/wsfdemo-sample-movers_<owner>` is rewritten **without** `demoFixture`, as a leave-and-rejoin by the product would.
  4. Result: that row is deleted, and the run exits 0.
- *The same happens* for a synthetic profile path (C2).
- *Contrast:* apply rechecks inside every transaction (T1–T6 pass).
- *Scope:* narrow. It needs a concurrent write during the cleanup window. It is pre-existing: `06bcb288` behaves the same.

**G2 — preservation gap: counter shards and member totals at fixture paths are not ownership-classified.**
- *What:* classification covers entities, owner memberships, ledger rows and additions.
  - Shard documents `wsfGoalCounters/<fixture goal>/shards/*` are never classified.
  - A member total at a path the fixture's contributions explain is accepted as the fixture's.
- *Effect:*
  - apply increments into a pre-existing foreign document instead of failing closed;
  - it writes 100 documents;
  - only the post-hoc ledger check notices, with `MISMATCH` and exit 4;
  - cleanup would later delete those documents.
- *Reproducer:* create `wsfGoalCounters/wsfdemo-goal-movers-squats/shards/0 {count: 50}` with the fixture absent, then run `--apply`. The result is `count 110`, exit 4, and 100 writes. S2 is the same with `wsfGoalMemberTotals/wsfdemo-goal-movers-squats_wsfdemo-m01 {total: 999}`.
- *Scope:* these paths are under `wsfdemo-` ids that the product never generates, so the likely source is a partial earlier fixture state. It is pre-existing: `06bcb288` behaves the same.

**Precision findings:**
- **P1 (T7).** When re-creating a missing addition, a foreign document at that path is preserved, but the run exits 0 and does not report it. The *next* plan classifies it as foreign.
- **P2.** A refusal in the middle of a run (T1–T4, T6) leaves the writes already committed (26–35 documents). That is by design: the ledger stays consistent per transaction, and a re-plan reports the collision. But "0 writes" holds only for collisions found at classification time.

### 37.B Workflow `8f8c4530`: **PASS on criteria 4–6; one test-coverage gap (M8)**

| criterion | evidence | result |
|---|---|---|
| **4** exclusions | Every one of the 9 jobs gates on an explicit mode equality: `gate`/`config`: deploy or player-journey; `build`/`deploy`: deploy; `hosted-verify`: `always() && gate success && deploy`; `player-journey`; `cleanup-recovery`; `mail-preflight`; `social-demo-seed`. Under `social-demo-seed` only the new job runs. The workflow diff is +145 / −0, so no existing job's gate or step changed. | PASS |
| **5** hostile input | `demo_*` reach the job only through `env:`. `social-demo-inputs.mjs` validates them **before** `npm ci` and the auth step. `demo_action` must be exactly plan, apply or verify. The uid must match `^[A-Za-z0-9_-]{1,128}$` and must not use the `wsfdemo-` prefix. A digest is 64-hex for apply only and refused on any other action. The seed flag written to the output comes from a fixed table. | PASS |
| **6** guards | `permissions: contents: read, id-token: write`; the existing `environment: wsf-staging`, WIF provider and deploy SA. Checkout is `ref: github.sha` with `persist-credentials: false`. `npm ci --ignore-scripts` runs from the reviewed lockfile. Apply re-plans, then `social-demo-plan-digest.mjs` must equal the reviewed digest; after that come apply and verify. The upload is gated on the scan outcome, and a final step requires both the scan and the seed step. | PASS |
| **digest and replay, end to end** (emulator, candidate seed and this helper) | Same state re-planned: `PLAN_DIGEST_MATCHES_REVIEWED_PLAN=true`, exit 0. Same receipt, other operational commit: refused, exit 1. **Replay after apply** (the state changed): refused, exit 1. A plan with a foreign document: the seed exits 3, and the helper issues **no digest**, exit 1. | PASS |
| **W3's suite** | `run-all.mjs` on `8f8c4530`: all suites passed, social-demo-seed 9/9. | PASS |
| **W7 mutants on W3's suite** | **12 of 13 caught, each by the intended assertion.** M1 the seed gate becomes `always()` (`workflow-contract:376`); M2 deploy names the seed mode (`:1005`, "deploy must not name the seed mode"); M3 the uid interpolated into shell (`:1066`, "an input appears outside an env mapping"); M4 a cleanup action (`social-demo-seed:27`); M5 the digest ignores the commit (`:68`); M6 a digest issued for a foreign plan (`:104`); M7 no `--ignore-scripts` (`workflow-contract:106`); M9 checkout not `github.sha` (`:1052`); M10 an ungated upload (`:45`); M11 apply without the digest check (`:1083`); M12 the uid pattern admits `$(id)` (`social-demo-seed:33`); M13 validation after auth (`:1073`). **Survived: M8, the seed job granted `contents: write`.** The workflow as written is correct; the suite does not pin the job's permissions. After restore, `run-all` exits 0 and the worktree is clean. | test gap |

**Precision findings (B):**
- **B-P1.** The validator deliberately prints `SOCIAL_DEMO_OWNER_UID=validated`, but the seed then prints `owner: <uid>` to the job log, and the uploaded plan receipt carries `ownerUid`. A uid is not an email. If the intent was to keep the uid out of logs, the seed step undoes it.
- **B-P2.** The digest binds the fixture, the project, the owner, the operational commit and **the fixture paths by class**, not document content. A change of content inside the same class, such as further edits to a drifted goal, does not change the digest. The seed's own drift handling keeps those edits.

**Status:** reviewed only. Nothing is accepted, merged or dispatched. There was no staging access and no cloud call. G1 and G2 go to W3 and the Director for disposition. The M8 test gap and P1 / B-P1 / B-P2 are precision items.

## 38 · W6 MOVEMENT-PILLS-1 (#483), exact `eeb5eed02d1f8f3beb1ee9a4c5368f575de98527` (L0 #434 `5836118476`; Director `5836100138`, clarification `5836170056`; W7 ACK `5836287971`): **PASS on rows 1–6; no defect; one note**

**Scope.** This is the corrected single-movement subset, not multi-movement support.

**Builds.** Emulator-flagged builds, each stamped and served beside the emulators (`demo-wsf-local`):

| build | role | port |
|---|---|---|
| `eeb5eed0` | candidate | 5016 |
| `03cfddba` | the fail-before head, an ancestor of the candidate | 5017 |
| `502b1e8d` | base | 5010 |

**Candidate delta.** `502b1e8d..eeb5eed0` is 4 commits.
- Product: `app/goals/new.tsx`, plus the new `src/movementSelection.ts` and `src/ui/MovementPicker.tsx`.
- Also: W6's specs, unit tests and a new `review/movement-pills-1/`.

**Instrument:** `apps/westayfit/tests-e2e/sprint-w7-movement-pills-verify.spec.ts` (M1–M5).
- Candidate: **6/6** on the final file.
- `03cfddba`: M1, M2 and M2r **fail**, as intended (fail-before).
- Base: M1 fails, because the pill is absent.

**Fixture corrections, disclosed:**
- The first `03cfddba` run hung. Two unbounded reads caused it: the Something else pill, which that build does not render, and a `scrollIntoViewIfNeeded` call. That run ended in my runner timeout, exit 124.
- The stale base run started with the same file was stopped.
- Every read is now bounded. M1 and M2 were rerun on `03cfddba` and M1 on the base, and the final file was rerun 6/6 on the candidate.
- None of this changes a product result.

| row | measured on `eeb5eed0` | fail-before `03cfddba` | result |
|---|---|---|---|
| **1** single choice, replacing | The picker is a `radiogroup`. Squats then Push-ups leaves **only `push-ups`** checked, with the chosen unit shown as "push-ups". Submit sends **one** `wsfCreateGoal`: `{unit: "push-ups", activityGuideKey: "push-ups", target: 1200, …}`. The emulator goal reads `unit` push-ups and `activityGuideKey` push-ups. **After a reload in the product:** the community total reads "0 of 1,200 push-ups", and the contribution screen's guide is "How we count push-ups … Count one push-up when your arms are straight again …". | `role=group`; **both** checked; chosen unit "squats + push-ups" | **PASS** |
| **2a** the rendered route | M2r: real clicks on Squats then Push-ups (the valid sequential selection) send one request, `{unit: "push-ups", activityGuideKey: "push-ups"}`, and store one goal, the same. | **Real journey: request and stored goal `{unit: "squats + push-ups", activityGuideKey: "reps"}`** | **PASS** |
| **2b** unsupported several / mixed state, **INJECTED** | The picker's own `onChange` is called with `['squats','push-ups']`, then `['squats','steps']`. That state is not reachable through the rendered single-choice route. Both are checked. The reason is on screen: "A goal with several movements can't be started yet. Choose one movement." / "Squats and steps are counted differently, so they can't share one total. Choose one movement." Submit has `aria-disabled="true"`. A **forced click sends 0 requests**. **Calling the submit handler itself** (INJECTED) also sends 0 requests and sets the unit field error to the same sentence. | The same injected state is **submitted**: `{unit: "squats + push-ups", activityGuideKey: "reps"}`, and the form moves to its created screen | **PASS** |
| **3** Something else | The draft "burpees" is typed first. Laps hides the field (chosen unit "laps", phrase "1,200 laps"). Something else brings back **"burpees"** ("1,200 burpees"). Squats, Sit-ups, then Something else again: still **"burpees"**. The control is **144.9 × 44 px** and reachable at its centre after a movement is picked. Submitting under Something else sends `unit: "burpees"` **with no `activityGuideKey` key at all**, and the stored goal has no such field. | — | **PASS** |
| **4** keyboard and semantics | Each pill and Something else is a `radio` whose accessible name is its label (exactly 1 each). There is one `radiogroup` named "Movements". Tab from the target field goes: unit field, then Squats, Push-ups, Sit-ups, Steps, Laps, Something else, then the duration options, repeat and submit. Space on Sit-ups selects only Sit-ups (`aria-checked`); Space on Something else selects only Something else. | — | **PASS** (note N1) |
| **5** 390×640 | After picking Steps the phrase is at 451–484, inside the 640 px viewport. Each target is reachable at its centre after an ordinary scroll of the page's own 640 px scroller: phrase 303–336, last pill row (Something else) 298–342, submit 522–576. | — | **PASS** |
| **6** evidence integrity | `docs/design-target/review/goal-setup-next/` is tree **`ff5e70fd50a0f198d7535d057296a686147d04bd`** at both `502b1e8d` and `eeb5eed0`. `git diff --quiet` shows no byte change, and a hash of the `ls-tree` listing is identical (`d22d7dd0…`). The evidence guard is intact. | — | **PASS** |

**N1 (note, not graded):** each radio is its own Tab stop (6 stops), and arrow keys were not measured. That meets the routed "Tab reaches each pill". The common radio-group pattern is one Tab stop plus arrow keys, so this is recorded for the Director's judgement.

**Limits:** Chromium web only, at 390×844 and 390×640. No Safari, no real device and no assistive-technology session. The multi / mixed state is reachable only by injection on this build, and is labelled as such.

**Status:** tested on `eeb5eed0`. Nothing is accepted, integrated or staged.

## 37B · Seed successor `6c1d115e9d857e657b1ecc8545cde4c919d38b98` and #484 head `736ebd77435a0b479ceae7e23968237c2395d58c` (Director #434 `5836713029`; W7 ACK `5836717858`): **G1 (ownership), G2 (pre-existing counters), P1 and the partial-write reconciliation fixed. The Director's two source-derived risks REPRODUCE as measured failures (G2a, G1b). A correction: my Check 37 M8 finding was a mis-targeted mutant.**

**Targets, verified by git:**
- `9f8b55f6..6c1d115e` is one commit touching 3 `staging-demo/` files.
- #484's `5765b0ea..736ebd77` is `3f9b7b17`, the same seed change, plus `736ebd77`, which is `workflow-contract.test.mjs` +39 only.
- All four `staging-demo/` blobs are identical between `6c1d115e` and `736ebd77`.
- The runs were local emulators only, with `METADATA_SERVER_DETECTION=none`. There was no dispatch, no staging access and no cloud call.

### 37B.0 Correction I own: M8 was mis-targeted

- In §37.B, the mutant "seed job granted `contents: write`" replaced the **first** occurrence of an anchor that appears **three** times in `wsf-staging-deploy.yml`. The first occurrence is in the **`cleanup-recovery`** job (line 953), not `social-demo-seed`.
- **Re-run correctly targeted**, inside the `social-demo-seed` job only: W3's suite **catches it on both `8f8c4530` and `736ebd77`** (run-all exit 1, "Expected values to be strictly deep-equal"). That comes from the pre-existing test "the seed job takes exactly contents:read and id-token:write".
- **So B was 13 of 13 caught on `8f8c4530`, and the "M8 survived" test gap did not exist.** W3's new M8 test (`736ebd77`) is sound but was not needed. Every other mutant's anchor occurs exactly once; I re-counted.
- What my mis-targeted mutant *did* show is that `cleanup-recovery`'s permissions are not pinned by the suite. That job predates this delta and is outside Check 37's scope. It is recorded here for completeness, not as a finding against #484.

### 37B.1 Results on `6c1d115e` (fail-before on `9f8b55f6`, same drivers)

| row | `9f8b55f6` | `6c1d115e` |
|---|---|---|
| **B3 (G1)** cleanup: the owner's sample membership rewritten **without the marker** after classification (INJECTED) | **DELETED**, exit 0 | **preserved**, `CLEANUP_PRESERVED=1`, exit 3, **PASS** |
| **B4 (G1)** cleanup: a synthetic profile path taken by a foreign document after classification | **DELETED**, exit 0 | **preserved**, exit 3, **PASS** |
| **S1 (G2)** a foreign shard exists before apply, with the goal absent | 50 → 110, exit 4 after 100 writes | `FOREIGN=1`, exit 3, **0 writes**, **PASS** |
| **S2 (G2)** a foreign member total at a fixture path | 999 → 1084, exit 4 after 100 writes | `FOREIGN=1`, exit 3, **0 writes**, **PASS** |
| **T7 (P1)** restoring a missing addition, and a foreign document appears there | preserved, exit 0, **not reported** | preserved, `APPLY_INCOMPLETE … is not this fixture's`, exit 3, **PASS** |
| **RP** partial writes, then reconcile: a foreign goal appears mid-apply; after it is removed the run is repeated | first run exit 1 with no partial-write account | first run exit 3, **`PARTIAL_WRITES=25`**; re-run exit 0 (`CREATE=27`, `UNCHANGED=25`); `VERIFY=pass`; 445 = 445 = 445, **PASS** |
| **A1 — Director risk (a):** apply, shard 0 replaced **without the marker (count 50)** after preflight and before the ledger transaction that increments it (INJECTED at that transaction's first read) | 50 → 110, exit 4 | **50 → 110; exit 4, only from the post-hoc `MISMATCH`, after 106 writes: G2a, REPRODUCED** |
| **B1 — Director risk (b):** cleanup, a seeded recent-addition replaced by `{amount: 999, at: "someone else"}` after classification, its goal still marked | DELETED, exit 0 | **DELETED; exit 0; `CLEANUP_PRESERVED=0`: G1b, REPRODUCED** |
| **B2 — Director risk (b):** cleanup, a seeded ledger row replaced by `{goalId: <same goal>, userId: "someone-else", count: 5}` after classification | DELETED, exit 0 | **DELETED; exit 0: G1b, REPRODUCED** |

**G2a (measured).**
- *What:* the ledger transaction reads the row and the member total, but it only `tx.update`s the shard (`increment`). The shard is never read or marker-checked inside that transaction.
- *Effect:* a shard replaced without the marker between preflight and that transaction is incremented instead of refused. The only signal is the ledger check at the end.
- *Reproducer:* `--apply`; before the first ledger transaction's read of `wsfContributions/wsfdemo-goal-movers-squats_wsfdemo-m01_social-staging-demo-1-wsfdemo-goal-movers-squats-01`, set `wsfGoalCounters/wsfdemo-goal-movers-squats/shards/0` to `{count: 50}`.

**G1b (measured).**
- *What:* cleanup's attached-row predicates are `x.goalId === g` for ledger rows and `typeof x.amount === 'number'` for additions.
- *Effect:* a foreign replacement at a deterministic seeded path passes the check and is deleted while its goal is still marked. The run exits 0 and reports nothing.
- *Reproducers:* seed the fixture, then run `--cleanup`. Before the delete transaction's read of the seeded addition `…/recentAdditions/social-staging-demo-1-wsfdemo-goal-movers-squats-01` (B1), or of the seeded row above (B2), set the foreign document.
- *Contrast:* the owner membership and profile paths (B3, B4) are now preserved.

**Carried from Check 37 and re-run on `6c1d115e`:**
- Auth 4/4.
- Real-`wsfContribute` races 6/6: every burst counted, and the product's merges keep the shard marker.
- Apply-path rechecks T1–T7: 7/7.
- Static S3–S6: 4/4.
- Privacy: 106 fixture documents with no contact keys, 0 synthetic Auth accounts, owner data unchanged.

Harness note: my C1 / C2 rows used a delete hook that never fires on `6c1d115e`, because cleanup now deletes inside transactions. They are superseded by B3 / B4.

**#484 `736ebd77`:** `run-all` passes all suites. The workflow is unchanged from `8f8c4530`; B's criteria 4–6 carry forward.

**Status:** reviewed only. Nothing is accepted and nothing is dispatched. G2a and G1b are for W3 and the Director.

## 36C · APP-FEEL-PARITY-1 cp1 F2 successor, head `7dc46cda757165855fb90ab6b9f9125dc06d8f94`, product `fe155375` (W9 #482 `5836824865`; Director `5835326729` / `5835521562`; W7 ACK `5837128756`): **F2 fixed (fail-before on `b497ce4c`, pass-after on `fe155375`); affected rows 12/12; no defect**

**Lineage.** `f9ca3d5d` → `4c55be43` → `fe155375` → `7dc46cda`.
- `fe155375..7dc46cda` changes only frames and `README.md`. I checked this by git, so `fe155375` is the product under test.
- The product delta against `f9ca3d5d` is `sheetMotion.ts`, `contribute/[goalId].tsx` and `move/index.tsx`.
- The build is emulator-flagged and stamped `fe155375`, served on 5018. `b497ce4c` on 5015 is the fail-before.

**Instrument.** W7's spec now carries **hard F2 assertions** (soft-expect, so every row is reported):
- on open, focus is inside the panel;
- a 20-stop Tab / Shift+Tab sweep finds 0 stops outside the sheet in front;
- focus stays inside the panel after each step replacement;
- focus the member placed is kept.

The same file ran on both builds, covering S1, S1k, S2, S3, S5s, S5r, R1, R1z, R2 and R3.

| row | `b497ce4c` (fail-before) | `fe155375` |
|---|---|---|
| focus entry, one-goal sheet (4 tabs, and via keyboard Enter) | on the scrim, `DIV tabindex=0` with no role or name | on **`wsf-contribute-close`** (`BUTTON`, named), inside the panel, **PASS** |
| Tab / Shift+Tab containment, one-goal sheet | 4 of 20 stops on `!wsf-contribute-scrim` | 0 outside; the stops are timer, done, skip and Close, **PASS** |
| chooser containment | 3 of 12 stops on `!wsf-move-scrim` | 0 outside; the stops are the two choices and Close, **PASS** |
| goal sheet opened **over** the chooser | entry on the scrim; stops outside | entry on Close; 0 outside the **topmost** panel, never the chooser beneath, **PASS** |
| step replacement: done, count | `body` | the new step's `h1` (`wsf-contribute-entry-screen`), **PASS** |
| typing in the count field (member-placed focus) | kept | **kept** on `wsf-contribute-entry`, **PASS** |
| review | `body` | `h1` `wsf-contribute-review-screen`, **PASS** |
| confirmed receipt | `body` | `h1` `wsf-contribute-result-headline`, **PASS** |
| pending (INJECTED drop), and unknown after an INJECTED lost reply | `body` | `h1` `wsf-contribute-pending`, **PASS** |
| return | focus to MOVE; chooser return to the choice | the same: Close gives focus to `wsf-member-tab-move`, and the goal sheet over the chooser returns focus to the chosen row, **PASS** |
| exits: S1 on all 4 tabs, Escape, 390×640, reduced motion | one exit | one exit at +227–241 ms; Escape, one exit; reduced motion exits in +42–70 ms; scroll 166 → 166 and 300 → 300; 0 remounts, **PASS** |
| R1 / R1z (Close, then Back at +40 ms), R2 (Close during resolution), R3 (reopen at +60 / +220 ms) | pass | pass: one exit each (`/you` +92–105 ms; community +95 ms); no late hand-off; a reopen at +220 ms is clean, **PASS** |

**Counts.**
- `fe155375`: **12 / 12**.
- `b497ce4c`: 4 of 12 fail. S1, S1k and S2 fail only on the F2 assertions (scrim entry and stops outside). S3 fails on the step-focus assertions (`body`).
- The 8 exit, race, short-screen and reduced-motion rows pass on both builds. That is expected: F2 changes focus only.

**Limit.** For the chooser I measured containment (all stops inside) but did not sample its entry element separately before the sweep. W9 reports entry on `wsf-move-close`.

**Carried, not rerun:** visual acceptance (Director `5835521562`), D1 / F3 (§36B), preservation and the event / kiosk specs (§36), and the steps rendering inside the sheet (re-observed in S3).

**Limits:** Chromium web only. No Safari keyboard behaviour, no native focus, no assistive-technology session.

**Status:** tested on `fe155375`. Nothing is accepted, integrated or staged.

## 39 · Staging pin #486, exact head `92a02d50e2d627e6aa990a91bee56fad495aa02e` (L0 #434 `5837238267`, re-scope `5837329164`; W7 ACK `5838147782`): **PASS on items 1–6; no defect**

This was run in a detached worktree, locally only. There was **no dispatch and no staging access.** I had not run anything on `7949ba0c`, so every row was run on `92a02d50`.

| item | evidence | result |
|---|---|---|
| **1** head, base, scope | `main` `273ce3ae` → `7949ba0c` → `92a02d50` (tree `927f665e`). **One file**, `.github/wsf-staging/approved-candidate.json` (blob `8528f144`): +7 / −4 against `main`, and +3 / −3 against `7949ba0c` (`approvedAppSha`, `packageLabel`, `_fullCandidateNote`). Against `main`: `approvedAppSha`, `packageLabel`, `_fullCandidateNote` and `_expectedPriorFunctionsNote` changed, and three `_previous…502b1e8d` keys were added; nothing was removed. | **PASS** |
| **2** candidate | `resolve-candidate.mjs`, the real script, on the head pin: an **empty request resolves to `91392f9d…`** (exit 0), and **the exact SHA resolves** (exit 0). `00d6d44e`, `502b1e8d` and W9's head `7dc46cda` are each **refused** (exit 1, "syntactically valid" but not approved). Control, the `main` pin: empty and `502b1e8d` resolve; `91392f9d` is refused. `91392f9d` **is** the live development head: `claude/wsf-app-shell` points there (`git ls-remote`). | **PASS** |
| **3** inventory | The real `read-inventory.mjs` gate, driven with live-count shapes (the Check 34 driver): **49 → exit 0, `PREFLIGHT_BEFORE=49`**; 46 → exit 1 "has 46 … approved against 49"; 50 → exit 1 "has 50 … approved against 49". | **PASS** |
| **4** expected set | The verifier's `EXPECTED` is `BASE_EXPECTED` (46, read from the script's own literal) plus the pin's `candidateAddedFunctions` (`wsfsetcommunityvisibility`, `wsfcommunitymembers`, `wsfcommunityactivity`). That is **49, equal to the 46-name base fixture plus the 3 social names**. | **PASS** |
| **5** boundary notes | `502b1e8d` is an ancestor. There are **exactly two first-parent merges**: `00d6d44e` (second parent `eeb5eed0`, the accepted W6) and `91392f9d` (second parent `7dc46cda`, W9's F2 head, product `fe155375` from Check 36C). **Merge composition:** `00d6d44e`'s tree equals `eeb5eed0`'s (0 files differ), and `diff(7dc46cda, 91392f9d)` is **byte-identical** to `diff(502b1e8d, 00d6d44e)`. **14 commits, 55 files, +2968 / −40.** **No route file is added, removed or renamed.** Five are modified: `goals/new.tsx`, `move/index.tsx`, `contribute/[goalId].tsx`, `_layout.tsx` and the community `[groupId]/index.tsx`. **`functions-westayfit` is `5a3f232e` at both SHAs, and 49 `export const wsf…` lines.** **The protected-path diff is empty:** every `firebase*.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, the root and app `package.json` and lockfiles, `app.json`, `.github`, `scripts/westayfit`, `functions` and `functions-westayfit`. **Historical notes:** each `_previous…502b1e8d` value is `main`'s text **verbatim** behind a labelled "HISTORICAL, …" prefix, the same style as the kept `7ee70e4` history. The `7ee70e4` keys and `_twelveTransportNote` are byte-unchanged. `expectedPriorFunctions` 49 and `candidateAddedFunctions` are unchanged. | **PASS** |
| **6** tests | `run-all.mjs`: **all suites passed** (exit 0). The tripwire `tests/verify-deployment.test.mjs` is **byte-identical to `main`** (`0d30925b`), as are `verify-deployment.mjs`, `read-inventory.mjs` and `resolve-candidate.mjs`. **Mutants on the pin, each restored afterwards:** prior 48 → run-all exit 1, and the gate refuses 49; one social addition dropped → run-all exit 1 ("present but not expected"). **`approvedAppSha` set to another SHA (`7dc46cda`) → run-all passes and resolve follows it.** That is expected: no test can know the right SHA, and binding it is this review's job, which item 2 does against the live development head. | **PASS** |

**Carried, and not cleared by this pin (as the pin states):** the three social services are SHUT; the index has no READY receipt; email is blocked; kiosk use is HELD. Nothing was run against staging.

**Status:** reviewed on `92a02d50`. Not merged and not dispatched. Merging and dispatch belong to L0, after the Director accepts.

## 37C · Seed successor `2a251083` for G2a / G1b (W3; the Check 37B findings on the same routed criteria, Director #434 `5836713029`): **G2a and G1b fixed (fail-before on `6c1d115e`); no regression; #484 not yet carrying it**

**Delta.** `6c1d115e..2a251083` is one commit touching three `staging-demo/` files.
- **Ledger transaction:** it now `tx.get`s the shard and refuses unless the shard exists **and** carries the marker, before incrementing it.
- **Cleanup:** each ledger row is deleted **together with its recent-addition**, inside one transaction, only when both are proven.
  - A fixture row must match its exact seeded identity. Any other row must be the owner's own, at its own path.
  - An addition must have exactly the keys `amount` and `at`, the row's amount, and a consistent minute.
  - An addition with no row beside it is preserved.

**#484** is still at `736ebd77`, so it does **not** yet carry `2a251083`, and it was not re-reviewed here.

**Runs.** Local emulators, `METADATA_SERVER_DETECTION=none`, using the same drivers as §37 / §37B. There was no dispatch and no staging access.

| row | `6c1d115e` (§37B) | `2a251083` |
|---|---|---|
| **A1 (G2a):** shard 0 replaced **without the marker** (count 50) after preflight, before the ledger transaction (INJECTED) | 50 → 110; exit 4 only after 106 writes | **preserved at 50**; `APPLY_INCOMPLETE … is not this fixture's (missing, unmarked or foreign); refusing to increment it`; `PARTIAL_WRITES=34`; exit 3, **PASS** |
| **B1 (G1b):** cleanup; a seeded addition replaced by `{amount: 999, at: "someone else"}` after classification | DELETED, exit 0 | **preserved and named**, `CLEANUP_PRESERVED=1`, exit 3, **PASS** |
| **B2 (G1b):** cleanup; a seeded ledger row replaced by `{goalId: <same>, userId: "someone-else", count: 5}` | DELETED, exit 0 | **the row preserved, and its addition preserved with it** (`CLEANUP_PRESERVED=2`), exit 3, **PASS** |
| **CL1 (regression watch):** the owner records twice through the **real `wsfContribute`**, then cleanup runs. This checks that the new, stricter addition proof does not strand his rows. The product's addition keys are exactly `["amount","at"]`. | exit 0, 111 deleted, 0 left | exit 0, 111 deleted, `CLEANUP_PRESERVED=0`, **0 `wsfdemo-` documents left**, **PASS** |
| B3 / B4 (G1), T7 (P1), RP (partial writes then reconcile) | pass | pass (preserved and named; `PARTIAL_WRITES=25`, then re-run `VERIFY=pass` at 445 = 445 = 445) |
| the regression suites | — | apply rechecks T1–T7: 7/7 (C1 / C2 remain harness-invalid, superseded by B3 / B4); static collisions 6/6; Auth 4/4; real-`wsfContribute` races 6/6; privacy 1/1 |

**Status:** reviewed on `2a251083`. Nothing is accepted or dispatched. A #484 head carrying `2a251083` would need only a blob-identity check plus `run-all`.

## 40 · APP-FEEL-PARITY-1 checkpoint 2 (#487), product `be21eab44ee969cfc55543d759aece8ba51780c8`, evidence head `09dd16b2561d2bd23944ceeb483aa2eb03614fd7` (Director #434 `5839322767`; W7 ACK `5839329631`): **PASS on items 1–7; one precision note (stale comments)**

**Lineage, verified by git:**
- `91392f9d` (development) → `299d1c3f` → `7c5a5962` → `be21eab4`.
- **Product:** `(tabs)/_layout.tsx`, `(tabs)/(home)/index.tsx`, `(tabs)/(home)/community/[groupId]/index.tsx`, `(tabs)/community/index.tsx`, `move/index.tsx`, `src/ui/MemberTopBar.tsx` and the new `src/memberReads.ts`, plus W9's specs.
- **`be21eab4..09dd16b2`:** frames, receipts, the README and the producer only. It touches **no** `app/` or `src/` file.

**Builds and instrument.**
- Builds are emulator-flagged and stamped: `be21eab4` on 5019, and `91392f9d` on 5020 as the fail-before.
- The spec is `apps/westayfit/tests-e2e/sprint-w7-app-feel-cp2-verify.spec.ts` (E1–E5, plus the E4c control). It counts instances per DOM element, records every painted loading frame, reads scroll, records browser Back, counts callables, and watches for a text across the page.
- Results: **`be21eab4` 7 / 7**. **`91392f9d` fails 5 of 7**, all on the defects cp2 fixes. E4 and E5 pass on both, as expected: the base has no shared layer, and E5 is unchanged behaviour.

**Fixture corrections, disclosed:**
- E4's sign-in first used a link that the signed-out Community tab does not render, then an unbounded click on a tab bar that is absent when signed out.
- It now reaches `/signin` through the router's own `popstate` path. It asserts a **same-document marker** across both accounts, so a reload cannot hollow out the isolation proof.
- E4 was rerun alone, then the whole file was rerun on both builds.

| # | row | `91392f9d` (fail-before) | `be21eab4` |
|---|---|---|---|
| **1** | MOVE no goal → "Go to your community" (390×640 and 390×844; MOVE opened from You) | the current tab stays **You**; **2 tab bars, 2 community screens, the loading screen painted (109 frames)**; browser Back returns to **`/move` with the sheet** | **Home** tab; 1 tab bar, 1 community screen (0 instances added); **0 loading frames**; browser Back does **not** return to `/move`. Scroll: that community (no goal) is too short to scroll at either size (0 → 0); retention is shown by it being the same instance. **PASS** |
| **2** | MOVE read error (**INJECTED** `wsfListGoals` 500) → "Go Home" | You stays current; **2 tab bars, 1 instance added, loading 133 frames, "Opening your community…" painted**; Back → `/move` | **Home tab as it stands**: 1 tab bar, 0 instances added, 0 loading, **scroll 300 → 300** (nontrivial, on the same screen); Back does not return to `/move`. **PASS** |
| **3** | wordmark from the Community tab, pointer then Enter | pointer: **a second community, loading 141 frames, scroll 300 → 0**, 9 callables; Enter: **nothing happens** (the Community tab stays current) | pointer and Enter each: **Home selected, 0 instances added, 0 loading, scroll 300 → 300**. Only the community's own focus refresh runs (`wsfListGoals`, `wsfGoalPulse`, `wsfMyContribution`, `wsfCommunityMembers`, `wsfCommunityActivity`, once each); `wsfMyCommunities` is not re-read. **PASS** |
| **4** | shared reads, per account; refusal forgets | isolation holds (there is no shared layer) | **In one document across both accounts** (a same-document marker, no reload): A signs out from the menu and B signs in; **A's community name never appears** in B's session. B's second membership is **deleted on the server**, and B opens it from Home's list: "not a member" is shown. B's **first Community-tab visit then paints the loading state** (not remembered rows), and the refused community is **not listed**. **PASS** |
| **4c** | positive control: the first Community-tab visit after Home | **whole-page skeleton painted (76 frames)** | **0 skeleton frames**; the current panel is up at about 100 ms; the fresh `wsfMyCommunities` and `wsfListGoals` still run. **PASS**. So the shared layer is used, and E4 shows it is per-account and forgets on refusal |
| **5** | Community Home's warm recall is withdrawn; the Champion's deliberate reload semantics | Retry trace `loading → error` | **Source:** the final `goalsState` logic is byte-for-byte the base's (`setGoalsState({kind:'loading'})` on every read, and `failed` on error). `peekGoals` is no longer imported by the community page. The `7c5a5962` "stand on warm" branch is gone (confirmed per commit). **Behaviour (INJECTED 500s):** a Retry on the goals error goes `loading → error` and reports the failure, and recovers when the read succeeds, identically on both builds. **PASS** |
| **6** | committed evidence at `09dd16b2` | — | `MANIFEST.sha256` lists **64 PNGs; `sha256sum -c` verifies 64 / 64**, and its file set equals the PNGs present. All **64 frame references in the 16 JSON receipts match the manifest**. CANDIDATE receipts are labelled `CANDIDATE BUILD be21eab4`, and the README names product `be21eab4` and MIGRATED `91392f9d`. The receipts' before / after counts agree with this table (for example, move-error-home: 1 instance, 0 loading, scroll 120 → 120). **PASS** |
| **7** | the 441 / 1 / 20 first run: `sprint-w9-shell-capture.spec.ts:83` timed out | — | **Outside the delta:** the prototype tree (`app/design-target/shell-next`, `src/ui/shellNext`) has no diff over `91392f9d..be21eab4`, and imports none of the changed modules (it only names its own routes). **Rerun:** it passes **3 / 3 on `be21eab4` and 3 / 3 on `91392f9d`** in isolation (about 1.8 s each). The first-run timeout **was not reproduced**. It is carried as W9 reported it, **undiagnosed and not relabelled a flake**. **PASS (carry allowed)** |

**Precision note P1.** `community/[groupId]/index.tsx` at `be21eab4` still carries two comments from the withdrawn warm recall: "Loading only when there is nothing … (a warm re-entry keeps its last goals until this lands)" and "Warm goals already on screen stay …". The code beneath them does neither. These are comments only, but they describe behaviour that no longer exists.

**Carried, not rerun:** all cp1, shell and mounted-tab proofs (Checks 36–36C), and the D1 / F3 / F2 rows. **Not in scope:** Community / Progress / You visual parity, the stale CURRENT row after a switch (checkpoint 3), and Progress's first-visit skeleton.

**Limits:** Chromium web on local emulators, at 390×640 and 390×844; E4 was one page and two synthetic accounts. No device-speed claim, and no native, Safari or assistive-technology measurement.

**Status:** tested on `be21eab4` / `09dd16b2`. Nothing is accepted, integrated or staged.

## 41 · PERF-MOBILE-BASELINE-1 on development `91392f9dbeda7f13208b79ff365a4cff8952c72c` (Director #434 `5839412481`; W7 ACK `5839563451`): **measurement only; no verdict**

- **SHA:** `91392f9d` is the current accepted and integrated head of `claude/wsf-app-shell`, re-fetched at the start of the check. cp2 (`be21eab4`) is delivered, not integrated, so it was not measured.
- **Environment:**
  - an emulator-flagged `build:web` of a detached worktree at `91392f9d`, served by `static-host.js` beside the emulators (`demo-wsf-local`: firestore 8080, auth 9099, functions 5001, all warm);
  - headless Chromium (`/opt/pw-browsers/chromium`), one worker, at 390×844 and 390×640;
  - spec `apps/westayfit/tests-e2e/sprint-w7-perf-mobile-baseline.spec.ts`, run `--repeat-each=3`: **12 / 12 runs completed**.
- **Fixture:** one synthetic member of one private community with one running goal (target 5,000 squats). The Champion is a second synthetic account.
  - **Before measuring**, the member makes one real contribution of 15 so that Progress has a row; without one it shows its empty state. This contribution is FIXTURE, not measured.
  - After the measured contribution of 20, Home shows 1,882 = 1,847 + 15 + 20, the server's figure.
- **How each column is measured:**
  - **Action:** the page's own `pointerdown` timestamp.
  - **Useful:** the first frame in which the destination's content element is both visible and on top at its own visible centre. This is sampled every animation frame, so it can be at most one frame late. The content elements are:
    - Home: `wsf-community-goal-hero`;
    - Community: `wsf-community-index-rows` or `-current`;
    - Progress: `wsf-activity-rows`;
    - You: `wsf-you-member` or `-identity`;
    - MOVE: `wsf-contribute-timer` or `-entry`;
    - receipt: `wsf-contribute-receipt`;
    - the 3-community Home: `wsf-home-my-list`.
  - **Settled:** the latest of useful, the last loading-state hide, and the last response of a callable started after the action. Measurement waits for 1.5 s with no request in flight.
  - **Serial stages:** the number of reads before useful that each started only after an earlier read had returned.
  - **Mounts:** new DOM instances of the screen roots.
  - **Loading:** any of the nine loading or skeleton test IDs painted after the action.
  - **Blocking:** a loading state was painted, **and** first useful pixels came only after a read started by this switch had returned.

### Warm fixture: raw per transition (3 runs each; median in bold)

Callables are named with counts. "Seen before" means the destination's content had already been on screen in this page.

| Transition | Viewport | Useful ms (3 runs) | Settled ms | Callables started | Serial stages before useful | Mounts added | Loading painted | Replaced known content | Blocking read |
|---|---|---|---|---|---|---|---|---|---|
| Pass 1 Home → Community (first visit) | 844 | 104, 108, 110 (**108**) | **108** | `wsfMyCommunities` 1, `wsfListGoals` 1, `wsfGoalRecentAdditions` 1 | 3 | `wsf-community-index` +1 | `wsf-community-index-loading` | no (first visit) | **yes** |
| | 640 | 103, 120, 102 (**103**) | **103** | same | 3 | same | same | no | **yes** |
| Pass 1 Community → Progress (first visit) | 844 | 85, 67, 78 (**78**) | **78** | `wsfMyCommunities` 1, `wsfListGoals` 1, `wsfMyContribution` 1 | 3 | `wsf-activity` +1 | `wsf-activity-loading` | no | **yes** |
| | 640 | 89, 77, 74 (**77**) | **77** | same | 3 | same | same | no | **yes** |
| Pass 1 Progress → You (first visit) | 844 | 104, 88, 94 (**94**) | **94** | `wsfMyCommunities` 1, `wsfListGoals` 1, `wsfMyContribution` 1 | 3 | `wsf-you` +1 | `wsf-you-loading` | no | **yes** |
| | 640 | 83, 91, 92 (**91**) | **91** | same | 3 | same | same | no | **yes** |
| Pass 1 You → Home (seen at sign-in) | 844 | 14, 16, 13 (**14**) | 97, 98, 88 (**97**) | `wsfCommunityMembers` 1, `wsfCommunityActivity` 1, `wsfListGoals` 1, `wsfGoalPulse` 1, `wsfMyContribution` 1 | 0 | none | none | no | no (background revalidation) |
| | 640 | 12, 11, 18 (**12**) | **93** | same | 0 | none | none | no | no |
| Pass 2 Home → Community (warm) | 844 | 6, 6, 6 | **6** | none | 0 | none | none | no | no |
| | 640 | 6, 6, 6 | **6** | none | 0 | none | none | no | no |
| Pass 2 Community → Progress (warm) | 844 | 6, 7, 6 | **6** | none | 0 | none | none | no | no |
| | 640 | 5, 5, 8 | **5** | none | 0 | none | none | no | no |
| Pass 2 Progress → You (warm) | 844 | 6, 7, 5 | **6** | none | 0 | none | none | no | no |
| | 640 | 7, 6, 6 | **6** | none | 0 | none | none | no | no |
| Pass 2 You → Home (warm) | 844 | 6, 9, 6 (**6**) | 82, 89, 98 (**89**) | the same 5 as pass 1 | 0 | none | none | no | no (background revalidation) |
| | 640 | 7, 6, 8 (**7**) | **88** | the same 5 | 0 | none | none | no | no |
| MOVE open from Home (after an earlier open) | 844 | 115, 100, 109 (**109**) | **109** | `wsfMyCommunities` 1, **`wsfListGoals` 2**, `wsfGoalPulse` 1, `wsfMyContribution` 1 | 3 | `wsf-move-screen` +1, `wsf-contribute-sheet-panel` +1 | `wsf-move-working` | **yes**: the sheet re-mounts and paints "working" every open | **yes** |
| | 640 | 123, 103, 103 (**103**) | **103** | same | 3 | same | same | **yes** | **yes** |
| MOVE Close (back to Home) | 844 | 186, 187, 187 (**187**) | 248, 263, 256 (**256**) | `wsfGoalPulse` 2, `wsfCommunityMembers` 1, `wsfCommunityActivity` 1, `wsfListGoals` 1, `wsfMyContribution` 1 | 1 (useful is the exit animation, not a read) | none (Home stays mounted) | none | no | no |
| | 640 | 186, 186, 186 (**186**) | **251** | same | 1 | none | none | no | no |
| MOVE open again (before the contribution) | 844 | 122, 96, 100 (**100**) | **100** | as MOVE open | 3 | +1 / +1 | `wsf-move-working` | **yes** | **yes** |
| | 640 | 103, 109, 103 (**103**) | **103** | as MOVE open | 3 | +1 / +1 | same | **yes** | **yes** |
| Submit → confirmed receipt (`data-variant="ordinary"`) | 844 | 51, 48, 51 (**51**) | **51** | `wsfContribute` 1 | 1 | none | none (no loading test ID painted) | no | the receipt waits on the write, by design |
| | 640 | 52, 51, 48 (**51**) | **51** | `wsfContribute` 1 | 1 | none | none | no | same |
| Receipt "Back to community" → Home | 844 | 32, 33, 38 (**33**) | 106, 116, 132 (**116**) | the same 5 Home reads | 0 | none | none | no | no (background revalidation) |
| | 640 | 26, 25, 29 (**26**) | **95** | the same 5 | 0 | none | none | no | no |

No non-listen Firestore request was made in any transition. Firestore Listen and Write channels are excluded from every column.

### Cold first entry: a full reload with the session persisted (390×844, 3 fixtures × 2 reloads each)

| Entry | Member of | Final path | Nav → useful ms | Callables (all) | Serial stages before useful | Loading states painted, in order |
|---|---|---|---|---|---|---|
| Home `/` | 1 community | `/community/<id>` (the redirect) | 353, 373, 364, 349, 392, 396 | **9**: `wsfMyCommunities` **2**, `wsfListGoals` **2** (same `groupId` + `includeHistory`, concurrent), `wsfGoalPulse` 1, `wsfMyContribution` 1, `wsfListChallenge` 1, `wsfCommunityMembers` 1, `wsfCommunityActivity` 1 | 4–5 | `wsf-home-loading` +~100 → `wsf-home-my-loading` +~190 → `wsf-home-opening-community` +~230 → `wsf-community-loading` +~245: **four successive loading frames** |
| Home `/` | 3 communities | `/` (the list; no redirect) | 237, 220, 222, 239, 216, 222 | **4**: `wsfMyCommunities` 1, `wsfListGoals` **3** (one per community, concurrent) | 1 (the list paints after `wsfMyCommunities`; the goal reads finish after) | `wsf-home-loading` → `wsf-home-my-loading` |
| Community tab `/community` | 1 community | `/community` | 265, 271, 273, 244, 253, 276 | **3**: `wsfMyCommunities` 1, `wsfListGoals` 1, `wsfGoalRecentAdditions` 1 | 3 | `wsf-community-index-loading` |
| Community tab `/community` | 3 communities | `/community` | 256, 270, 262, 243, 227, 251 | **4**: `wsfMyCommunities` 1, `wsfListGoals` **3** (one per community, concurrent); **no** `wsfGoalRecentAdditions` | 2 | `wsf-community-index-loading` |

Cold sequence for Home with 1 community (representative; ms from navigation):

```
wsfMyCommunities       +204..+229  {}
wsfListGoals           +253..+277  {groupId, includeHistory:true}
wsfListGoals           +253..+287  {groupId, includeHistory:true}   <- same parameters, concurrent
wsfGoalPulse           +293..+317  {goalId}
wsfMyContribution      +293..+310  {goalId}
wsfMyCommunities       +302..+330  {}                               <- second read after the redirect
wsfListChallenge       +331..+346  {groupId}
wsfCommunityMembers    +371..+398  {groupId}
wsfCommunityActivity   +371..+408  {groupId, goalId}
```

**Per-community fan-out, from the 1-community vs 3-community difference:**
- Home list and the Community tab: **+1 `wsfListGoals` per community**, issued concurrently after the one `wsfMyCommunities`. This adds breadth, not depth.
- The single-community Home adds the whole community screen's reads (5 more callables in three more serial stages) because it redirects.
- `wsfGoalRecentAdditions` appears only when there is one community.

### What the numbers say (facts only)

1. **The first visit to Community, Progress and You** mounts the screen, paints its full-screen loading state, and shows content only after **three serial callables**. Every first visit starts with `wsfMyCommunities` and `wsfListGoals` again, even though Home has just read both.
2. **Warm switches between Community, Progress and You** make 0 callables and no remount, with content in about 6 ms. Nothing is replaced.
3. **Every return to Home** is instant (6–38 ms) but always starts **5 background callables**. There is no loading state and no remount.
4. **Every MOVE open:**
   - re-mounts the sheet and panel;
   - paints `wsf-move-working` even when the member was there a moment earlier;
   - issues 5 callables in 3 serial stages, including **`wsfListGoals` twice**.

   MOVE's content waits on those reads.
5. **MOVE Close** keeps Home mounted. The 186 ms is the sheet's exit before Home is on top, not a read. It then costs 6 callables: Home's 5 plus one `wsfGoalPulse`, and `wsfGoalPulse` is started twice in the transition.
6. **The confirmed receipt** is one `wsfContribute` (~50 ms locally), with no loading state. The return lands on the mounted Home immediately, which then revalidates with the same 5 reads and shows the server's total.
7. **Cold single-community Home** is **9 callables with duplicates**: `wsfMyCommunities` ×2, and `wsfListGoals` ×2 with identical parameters. It passes through **four successive loading frames**, 4–5 serial stages, before the goal hero appears.

### CANNOT-MEASURE, and limits

- **Device and network speed: CANNOT-MEASURE.** Every millisecond here comes from local emulators, where one callable round trip is about 20–35 ms. The numbers that transfer are **structural**: counts, serial stages, loading painted, mounts. On a network with round trip *L*, first useful is at least *serial stages* × *L*. Production and function cold starts are not measured; Check 35 measured one local cold start at 2,953 ms, and these runs were warm.
- **Pixel paint: CANNOT-MEASURE** at compositor level. "Useful" is DOM-visible and on top, sampled every animation frame. It is not a screen-capture timestamp.
- **Platforms:** Chromium web only. No iOS or Android native, no Safari, no throttled CPU.
- **Per-goal fan-out: not measured.** Each fixture community has one goal, so how Home's `wsfGoalPulse` / `wsfMyContribution` / `wsfCommunityActivity` scale with more goals is not measured.
- **Home "first visit" in pass 1** is not a first visit: the member landed on Home at sign-in.

**No product, config or evidence file was touched.** Nothing is accepted, integrated or staged.

## 42 · Staging pin #488, exact head `12a4c61d924aff587fac478a0cb4408050a8a4a9` → `0b460ce3` (L0 #434 `5839864203`, renumbered `5839889244`; W7 ACK `5839979676`): **PASS on items 1–6; no defect**

The Check 39 method, re-run in full on a detached worktree at `12a4c61d`. Nothing is carried except the method. Local only: no dispatch and no staging access.

| # | Item | Measured | Result |
|---|---|---|---|
| **1** | Head, base, scope | One commit, `12a4c61d`, whose parent is `main` `e20994a7`. `main` is its ancestor and is still `e20994a7`. **Exactly one file**, `.github/wsf-staging/approved-candidate.json`, +7 / −4, blob `8528f144` → `f35f919c`. **Keys:** `approvedAppSha`, `packageLabel`, `_expectedPriorFunctionsNote` and `_fullCandidateNote` changed; three `_previous…91392f9d` keys added; every other key byte-identical, including `expectedPriorFunctions` 49, `candidateAddedFunctions`, the `502b1e8d` / `7ee70e4` history and `_twelveTransportNote`. | **PASS** |
| **2** | `resolve-candidate` (the real script: the approval path as its argument, `WSF_REQUESTED_SHA` in the environment) | **Head:** empty input, `0b460ce3` and the full SHA resolve to `0b460ce3f2f0766406100fef14d9a444c8cad43a` (exit 0). `91392f9d`, `00d6d44e`, `502b1e8d` and `09dd16b2` are refused (exit 1, "syntactically valid but is NOT the approved candidate"). **Control, `main`'s pin:** empty input resolves to `91392f9d`, and `0b460ce3` is refused. The change is what admits the candidate. | **PASS** |
| **3** | The real `read-inventory` gate | 49 names give `PREFLIGHT_BEFORE=49`, exit 0. 46 and 50 are refused ("… approved against 49", exit 1). Identical on `main`'s pin, since the prior is unchanged. | **PASS** |
| **4** | The verifier's expected set | `BASE_EXPECTED` parsed from `verify-deployment.mjs` (46) plus `candidateAddedFunctions` (3) = **49 unique**, equal to W7's 46 + 3 reference list. | **PASS** |
| **5** | Boundary over `91392f9d..0b460ce3` | `91392f9d` is an ancestor and the first parent. **One first-parent commit**, `0b460ce3`, whose second parent is `09dd16b2`, #487's reviewed head. Its tree `054f6166` **equals W7's local `merge-tree` of `91392f9d` + `09dd16b2`**. 4 W9 commits (`299d1c3f`, `7c5a5962`, `be21eab4`, `09dd16b2`), 5 in all; 91 files, +1970 / −72. The paths changed are:<br>• 5 route files, all **modified, none added, removed or renamed**;<br>• `src/memberReads.ts` (added) and `src/ui/MemberTopBar.tsx`;<br>• 2 e2e specs;<br>• 82 review files under `docs/design-target/review/app-feel-parity-2/`.<br>**Nothing else**, so the protected-path diff is empty. `functions-westayfit` is tree `5a3f232e` at both SHAs and `src/index.ts` exports 49. Each `_previous…91392f9d` note is **main's former value verbatim** behind a "HISTORICAL, …" prefix. The new notes' counts, commits and file lists match git. Run 49 (`36179721264`), cited by the notes, exists: WSF staging deploy, on `main` `e20994a7`, conclusion success (run metadata read; its job-log inventory lines were not re-read). | **PASS** |
| **6** | Tests | `node .github/wsf-staging/tests/run-all.mjs`: **exit 0, all suites passed**. `verify-deployment.test.mjs` is byte-identical to `main` (blob `0d30925b`). | **PASS** |

**Not established:** anything served, transport or hosted, since nothing ran against staging. The social services remain SHUT, the index has no READY receipt, and the email and kiosk holds are unchanged, all as the pin's own notes state.

**Status:** nothing is accepted, merged or dispatched.

## 41B · PERF-MOBILE-BASELINE-1B on integrated cp2, exact `0b460ce3f2f0766406100fef14d9a444c8cad43a` (Director #434 `5840249958`; W7 ACK `5840251469`): **measurement only; no verdict**

- **Same instrument:** `sprint-w7-perf-mobile-baseline.spec.ts` is unchanged since `dd7828b9` (blob `245a3357`), with the same fixture, the same aggregation and the same 12 runs (`--repeat-each=3`). **12 / 12 completed.**
- **Build:** an emulator-flagged `build:web` of a detached worktree at `0b460ce3`, served on its own port beside the same warm emulators (`demo-wsf-local`), in headless Chromium with one worker.
- **Method and column definitions:** as in §41.
- **Fixture:** as in §41. Home after the receipt reads 1,882 again, which is the server's figure.

### Warm fixture on `0b460ce3`, with the delta from `91392f9d` (§41)

The columns are: useful ms (3 runs, with the median); settled median; callables started; serial stages before useful; mounts added; loading painted; blocking read.

| Transition | Viewport | Useful ms (median; was) | Settled (was) | Callables | Stages (was) | Mounts | Loading | Blocking (was) |
|---|---|---|---|---|---|---|---|---|
| **Pass 1 Home → Community (first visit)** | 844 | 25, 25, 26 (**25**; was 108) | **130** (was 108) | `wsfMyCommunities` 1, `wsfListGoals` 1, `wsfGoalRecentAdditions` 1: **unchanged** | **0** (was 3) | index +1 | **none** (was `wsf-community-index-loading`) | **no** (was yes) |
| | 640 | 23, 26, 42 (**26**; was 103) | **125** (was 103) | unchanged | **0** (was 3) | index +1 | **none** | **no** (was yes) |
| Pass 1 Community → Progress | 844 / 640 | **72** / **83** (was 78 / 77) | same | `wsfMyCommunities`, `wsfListGoals`, `wsfMyContribution`: unchanged | 3 (3) | activity +1 | `wsf-activity-loading` | yes (yes) |
| Pass 1 Progress → You | 844 / 640 | **89** / **92** (was 94 / 91) | same | unchanged | 3 (3) | you +1 | `wsf-you-loading` | yes (yes) |
| Pass 1 You → Home | 844 / 640 | **13** / **13** (was 14 / 12) | 94 / 93 (97 / 93) | the same 5 background | 0 (0) | none | none | no (no) |
| Pass 2 warm Community / Progress / You | both | 6–7 (was 5–6) | same | **0** | 0 | none | none | no |
| Pass 2 You → Home | 844 / 640 | **6** / **6** (was 6 / 7) | 87 / 87 (89 / 88) | the same 5 background | 0 | none | none | no |
| MOVE open | 844 / 640 | **101** / **111** (was 109 / 103) | same | `wsfMyCommunities` 1, **`wsfListGoals` 2**, `wsfGoalPulse` 1, `wsfMyContribution` 1: **unchanged** | 3 (3) | sheet + panel re-mount | `wsf-move-working`, replacing known content | yes (yes) |
| MOVE Close | 844 / 640 | **186** / **187** (was 187 / 186) | 256 / 260 (256 / 251) | 6: unchanged | 1 (1) | none | none | no |
| MOVE open again | 844 / 640 | **106** / **106** (was 100 / 103) | same | unchanged | 3 (3) | re-mount | `wsf-move-working` | yes (yes) |
| Submit → confirmed receipt | 844 / 640 | **57** / **52** (was 51 / 51) | same | `wsfContribute` 1 | 1 (1) | none | none | waits on the write |
| Receipt "Back to community" → Home | 844 / 640 | **27** / **35** (was 33 / 26) | 106 / 114 (116 / 95) | the same 5 background | 0 (0) | none | none | no |

### Cold first entry on `0b460ce3` (390×844; 3 fixtures × 2 reloads each)

| Entry | Member of | Nav → useful ms (was) | Callables (was) | Stages | Loading states, in order |
|---|---|---|---|---|---|
| Home `/` → redirect to `/community/<id>` | 1 | 354, 326, 423, 333, 350, 408 (353–396) | **9** (9): `wsfMyCommunities` **2**, `wsfListGoals` **2** (same `groupId` + `includeHistory`, started 3 ms apart), `wsfGoalPulse`, `wsfMyContribution`, `wsfListChallenge`, `wsfCommunityMembers`, `wsfCommunityActivity` | 4–5 | the same **four**: `wsf-home-loading` → `wsf-home-my-loading` → `wsf-home-opening-community` → `wsf-community-loading` |
| Home `/` (list) | 3 | 226, 225, 234, 230, 228, 248 (216–239) | 4 (4): `wsfMyCommunities` 1, `wsfListGoals` 3 | 1 | `wsf-home-loading` → `wsf-home-my-loading` |
| Community tab | 1 | 277, 268, 281, 262, 255, 255 (244–276) | 3 (3) | 3 | `wsf-community-index-loading` |
| Community tab | 3 | 257, 253, 263, 238, 288, 245 (227–270) | 4 (4): `wsfListGoals` 3 | 2 | `wsf-community-index-loading` |

**Per-community fan-out is unchanged:** +1 concurrent `wsfListGoals` per community, on both Home and the Community tab.

### Delta `91392f9d → 0b460ce3` (facts only)

1. **One transition changed: the Community tab's first visit after Home.**
   - First useful pixels: **108 → 25 ms** at 844, and **103 → 26 ms** at 640. Serial stages before content: **3 → 0**.
   - The **skeleton is no longer painted**, and the switch is **no longer blocking**. It opens on rows the app already holds.
   - It still starts **the same three callables in the same serial chain** as a background revalidation. That is why "settled" is later (**108 → 130 / 103 → 125**): it is now measured to the end of that revalidation.
2. **Callable counts are unchanged in every transition and every cold entry.** The duplicates measured in §41 are still on the wire:
   - cold single-community Home: `wsfMyCommunities` ×2 and `wsfListGoals` ×2 with identical parameters, started 3 ms apart;
   - every MOVE open: `wsfListGoals` ×2.

   The cp2 read layer's in-flight sharing does not remove these at the network boundary in these journeys.
3. **Unchanged within run-to-run noise (about ±15 ms locally):**
   - Progress and You still block on first visit, with a skeleton and 3 serial stages.
   - Every Home return still starts 5 background callables, and the Close transition 6.
   - MOVE still re-mounts, paints "working" and blocks on 3 stages.
   - The receipt still costs one `wsfContribute`.
   - The four-frame cold Home cascade is unchanged.
4. **No transition regressed:** no new callable, no new loading state and no new mount anywhere.

### CANNOT-MEASURE, and limits

These are as in §41:
- **Device and network speed** is CANNOT-MEASURE, because these are local-emulator milliseconds. The counts, stages, skeletons and mounts are what transfer.
- **Compositor paint** is not measured.
- **Native iOS / Android, Safari and throttled CPU** are not measured.
- **Function cold starts** are not measured.
- **Per-goal fan-out** is not measured: each fixture community has one goal.

**No product, config or evidence file was touched.** Nothing is accepted, integrated or staged by this check.

## 43 · PRIVACY-TOGGLE emulator proof on served `0b460ce3f2f0766406100fef14d9a444c8cad43a` (L0 #434 `5840570251`; Director bug #365 `5840495639`, rows #396 `5840491600`; W7 ACK `5840643975`): **the swallowed-error defect reproduced (the fail-before for W9's cp3); rows 1–6 PASS; the stored value is authoritative**

- **Build:** the emulator-flagged `build:web` of `0b460ce3` (the Check 41B worktree).
- **Callables:** the emulators (`demo-wsf-local`) run `functions-westayfit` built from a clean worktree whose tree is `5a3f232e`, identical to `0b460ce3`'s.
- **Accounts:** synthetic only. **M** makes the changes; **O** is the Champion who reads what others see; **N** is a nonmember. M and O share communities A and B, and A has a running goal with contributions today by M (15) and O (10).
- **Spec:** `sprint-w7-privacy-toggle-verify.spec.ts`. It was run three times (once, then `--repeat-each=2`); **every row gave the same result in all three runs**.
- **What this does not cover:** staging transport. The setter is SHUT in run 50; that is CANNOT-MEASURE here and belongs to the operator.

### 1 · Fail-first: a failed save on the Settings privacy screen (Chromium, 390×844 default)

**Source, at `0b460ce3` `app/settings/privacy.tsx`:**
- the catch at `:112` runs `setError(...)`;
- `:114` calls `void load()`;
- `load()` runs `setPhase('loading')` and `setError(null)` (`:68–69`) **synchronously, before its first `await`**.

Both state updates therefore fall in the same tick, and React batches them.

**The instrument** samples every animation frame, recording `wsf-privacy-error` visibility, the loading line, and each switch's `checked`. The measurements:

| Failure of `wsfSetCommunityVisibility` | What the setter answered (captured) | Stored `communityNameVisibility` after | Switch at settle (3 s) | Switch = stored | Error ever painted | Error visible at settle | What the member sees |
|---|---|---|---|---|---|---|---|
| (a) refused, INJECTED | `403 PERMISSION_DENIED` | unchanged (absent = visible) | on | **yes** | **no, not one frame** | **no** | the switch never moves; "Loading your communities…" flashes at +36–52 ms |
| (b) lost before the server, INJECTED abort | `net::ERR_FAILED`; no write | unchanged | on | **yes** | **no** | **no** | the same |
| (c) landed, reply lost, INJECTED fetch-then-abort | `net::ERR_FAILED`; **the write landed** | `private` | **off** (+95–131 ms, after the re-read) | **yes** | **no** | **no** | the switch turns off after a loading flash, with no word that the save's reply was lost |
| (d) REAL refusal: M's membership in B removed on the server after the screen read it | `403 PERMISSION_DENIED "Members only."` (real server) | unchanged | **the B block is gone** (re-read) | n/a (row gone) | **no** | **no** | the community silently disappears |
| **Positive control:** the communities read fails, INJECTED 500 | — | — | — | — | **yes**, at +193–218 ms | **yes**, still shown at 4 s | the instrument sees a persistent error |

**Verdict on item 1: DEFECT REPRODUCED, 4 / 4 modes × 3 runs.** A failed save never paints its error, not even for a frame, so nothing tells the member it did not save.
- **The contract the spec asserts** is the Director's: an error stays visible once the switch is back on the stored value. It **fails on `0b460ce3` in all four modes**. That is the fail-before for W9's cp3.
- **The stored value is authoritative:** the switch always equals the stored document, and no optimistic value was ever rendered. In (a) and (b) the switch never moved; in (c) it moved to the server's settled value.
- **Why this matters for staging:** with the setter transport SHUT, the call fails in the browser and takes this same path. That matches the owner's "switches do not work" report: a tap, a flash of "Loading…", and nothing.

### 2 · Rows 1–6 (the Director's list), through the real screen and callables

| Row | Measured | Result |
|---|---|---|
| **1** name OFF persists across a reload | M flips A's name switch. Stored A name `private`; after a reload the switch is off. What O reads: `wsfCommunityMembers(A)` no longer names M; `wsfMyCommunities` member count still 2; no uid in either payload. | **PASS** |
| **2** activity OFF persists across a reload | Stored A activity `private`; the switch is off after a reload. O's `wsfCommunityActivity(A)` has **no row for M**, `contributorsToday` is still **2**, and there is no uid. The note reads "You are not listed and your activity is not shown here. Your effort still counts toward the total." | **PASS** |
| **3** name OFF + activity ON settles correctly | Before and after a reload: name off, activity on, equal to the stored values. O's activity feed shows M as an **anonymous row** (not missing), with `contributorsToday` 2. The "Anonymous member" note is shown. **Reverse, name back ON with activity OFF:** O's members list names M again (the current preference applies retroactively), and there is still no activity row. | **PASS** |
| **4** community A leaves community B unchanged | B's stored fields stay absent (visible) throughout; B's switches stay on after every reload; O's `wsfCommunityMembers(B)` names M. All three set requests carried A's `groupId` only. | **PASS** |
| **5** a nonmember's set is refused | N (not a member of A): `PERMISSION_DENIED "Members only."`. A signed-out caller: `UNAUTHENTICATED`. No membership row was created for N, and M's stored A values are unchanged. N's `wsfCommunityMembers(A)` is also refused. | **PASS** |
| **6** the stored preference governs what others see; no identity on public paths | Rows 1–3 show O's view following M's stored values. With no caller, `wsfGoalRecentAdditions` and `wsfGoalPulse` for A's goal carry neither member's name nor M's uid. The public `/display/<goalId>` page, loaded in a signed-out context, shows neither name. | **PASS** |

### 3 · The stored value is authoritative

Across every failure mode and every row, the rendered switch equals the stored document, measured at settle and after each reload. The only change a failure ever rendered was the landed-write case, where the switch took the **server's** value.

### For W9's cp3 (finding only; W7 fixes nothing)

1. **Keep the save error visible** after the re-read, until the member retries or acts again. The fix needs the error to survive `load()`'s `setError(null)`, or the re-read must not clear a save error.
2. **(c) and (d) need their own words.** When the reply is lost after the write landed, the member sees the switch change to the stored value with no explanation. When a real refusal removes membership, the community silently disappears.

The spec is ready to serve as cp3's pass-after: its U1 contract rows should pass on the fix, with rows 1–6 and the control unchanged.

**Limits:**
- Chromium web on local emulators, at the default 390×844 viewport.
- Staging transport, IAM and the index are CANNOT-MEASURE here.
- Kiosk surfaces were not exercised beyond the public display callables and page.

**Status:** tests and evidence only. Nothing is accepted, integrated or staged.

## 44 · You + Progress route-hook baseline on served `0b460ce3f2f0766406100fef14d9a444c8cad43a` (Director #434 `5841055703`; W7 ACK `5841061367`): **FAIL-BEFORE 19 / 19 fail; PRESERVE 44 / 44 pass; stable ×3**

- **Build:** the emulator-flagged `build:web` of `0b460ce3` (the Check 41B worktree), beside the emulators (`demo-wsf-local`, functions tree `5a3f232e`).
- **Setup:** synthetic accounts, Chromium at 390×844. Each route is **cold-loaded** so no other tab's scene is in the text.
- **Spec:** `sprint-w7-route-hook-baseline.spec.ts`, run three times (once, then `--repeat-each=2`) **with identical row outcomes, and no failure other than a labelled FAIL-BEFORE row**.
- **For Phase B:** the same spec re-runs unchanged as the tiny adapter check.

**How the rows are defined:**
- **[FAIL-BEFORE]** rows are facts of the accepted hierarchy: Lovable You `642f830b…/src/demo/screens/you.tsx` and Progress `09b8a73c…/src/demo/screens/progress.tsx`, both read at those exact refs, plus the Director's Phase B rules (#456 `5841023890`, `5841056153`). They fail now and must pass after the hook.
- **[PRESERVE]** rows are canonical truths the current routes already keep.
- **Route-level only:** rows use visible text, order on screen and route behaviour. **No W6 or W8 component name or testID is assumed.**
- **Rows marked INJECTED** force a read with `page.route`.

**The populated fixture:** member M in one community, with 2 members.

| Goal | Unit | Target | Shared | M's own | State |
|---|---|---|---|---|---|
| A | squats | 500 | 180 | 35 | open, ends in 3 days |
| B | minutes | 120 | 130 | 12 | open and reached, ends in 6 days |
| Z | steps | — | — | 0 | open |
| R | squats | 200 | 230 | 20 | closed, reached |
| U | squats | 400 | 150 | 18 | closed, unfinished |

Own totals by unit: **73 squats and 12 minutes.** A blended sum would be 85.

### 44A · You (`app/(tabs)/you.tsx`)

| Row | Kind | At `0b460ce3` |
|---|---|---|
| Y-F1 the community band reads "Your current community" | FAIL-BEFORE | **fails**: the band shows the name and "2 members" only |
| Y-F2 the lead reads "Your part in Living WE", "Shared position", "Your exact confirmed part" | FAIL-BEFORE | **fails**: "YOUR PART 35 squats / The community is at 180 of 500." |
| Y-F3 "Other goals you helped", with a Yours / Shared split | FAIL-BEFORE | **fails**: "ALSO OPEN" / "FINISHED" sections |
| Y-F4 lifecycle on other goals: REACHED · STILL OPEN, CLOSED · REACHED, CLOSED · UNFINISHED | FAIL-BEFORE | **fails**: B shows "130 of 120" with no status; R "Reached"; U no status |
| Y-F5 no email or account hierarchy above the member story | FAIL-BEFORE | **fails**: "SIGNED IN AS {email} / Sign out" sit in the header above the community |
| **Y-F6 an unknown shared total is never rendered as 0 (INJECTED: `sharedTotal` stripped)** | FAIL-BEFORE | **fails: "The community is at 0 of 500." and "THE COMMUNITY 0 of 120"** (`you.tsx:273` maps unknown to 0). **The current baseline gap.** |
| Y-F7 an unknown shared total is stated as Unknown | FAIL-BEFORE | **fails** |
| Y-F8 zero own, eligible: "Your first confirmed contribution can start here" + Start moving | FAIL-BEFORE | **fails**: "You haven’t recorded anything yet…", with no action |
| Y-F9 zero own, no goal open: "No goal is open for contributions" + Open community | FAIL-BEFORE | **fails**: the same sentence as Y-F8 |
| Y-F10 the goals read fails (INJECTED): the community stays on screen | FAIL-BEFORE | **fails**: the failure state drops the community |
| Y-P1 the member's name leads · Y-P2 community + "2 members" | PRESERVE | pass |
| Y-P3 the lead is the soonest-ending open goal with own credit (A above B) | PRESERVE | pass |
| Y-P4 own > 0 only (Z absent) · Y-P5 exact own parts with units · Y-P6 no cross-unit sum | PRESERVE | pass |
| Y-P7 finished goals stay · Y-P8 no rank / streak / score / inferred-impact pattern | PRESERVE | pass |
| Y-P9, Y-P17, Y-P21 Sign out reachable (populated, zero-own, failure) · Y-P10 Settings exists and opens | PRESERVE | pass |
| Y-P11 own parts exact while shared is unknown | PRESERVE | pass |
| **Y-P12–13 several communities, none remembered:** no community is spoken for (not the first item), and a way to choose is offered | PRESERVE | pass ("Which community? … Choose a community") |
| Y-P14 a remembered community (after opening it) is the current one | PRESERVE | pass |
| Y-P15 no goal open: no Start moving · Y-P16 no invented "0 minutes" | PRESERVE | pass |
| Y-P18–20 on failure: identity survives, Retry offered, no amount guessed as 0 | PRESERVE | pass |

### 44B · Progress (`app/(tabs)/activity.tsx`)

| Row | Kind | At `0b460ce3` |
|---|---|---|
| P-F1 own totals lead, per unit: "73 … squats", "12 … minutes", "recorded" | FAIL-BEFORE | **fails**: "4 goals you have added to · 2 running · 2 finished" |
| P-F2 the privacy clarification sits in the hero, above the goal list | FAIL-BEFORE | **fails**: it is at the foot |
| P-F3 "Goals you helped", with a Yours / Shared split | FAIL-BEFORE | **fails**: "WHAT YOU'RE PART OF NOW" / "WHAT YOU'VE BEEN PART OF" |
| P-F4 every lifecycle stated: OPEN, REACHED · STILL OPEN, CLOSED · REACHED, CLOSED · UNFINISHED | FAIL-BEFORE | **fails**: B "130 of 120 minutes · 100%" with no status; U a percent only |
| P-F5 the member is named in the private hero | FAIL-BEFORE | **fails**: no name on the route |
| P-F6 an unknown shared total is stated as Unknown (INJECTED) | FAIL-BEFORE | **fails**: the shared line is simply absent |
| P-F7 the partial state offers Retry (INJECTED: B's own-part read fails) | FAIL-BEFORE | **fails**: a partial note with no action |
| **P-F8 zero own, no goal open: "No goal is open for contributions" + Open community** | FAIL-BEFORE | **fails** |
| **P-F9 zero own, no goal open: Start moving is not offered** | FAIL-BEFORE | **fails: Start moving is offered when nothing is open** |
| P-P1 title + subtitle · P-P2 no blended units (85 never shown) · P-P3 own > 0 only | PRESERVE | pass |
| P-P4 finished history stays · P-P6 the clarification said once · P-P7 no rank / streak / score | PRESERVE | pass |
| P-P5 no fabricated receipts: no "+35"-style rows, no relative times | PRESERVE | pass |
| P-P9–11 unknown shared (INJECTED): never "0 of target" / "0%", nothing claimed reached, own parts exact | PRESERVE | pass |
| P-P12–13 partial is stated; the omitted goal is neither shown nor counted | PRESERVE | pass |
| P-P14–15 failure (INJECTED `wsfMyCommunities`): stated with Retry; no 0 and no empty-state claim | PRESERVE | pass |
| P-P16 zero own, eligible: "Your first contribution will appear here" + Start moving · P-P17 no invented amount | PRESERVE | pass |
| **P-P18–21 no client-readable private dated receipt source** | PRESERVE | pass (see below) |

**P-P18–21, the private dated receipt source:**
- **Non-vacuous:** the member has 4 real `wsfContributions` rows, counted by an owner-side query.
- **With the member's own ID token:**
  - a client list of `wsfContributions` gets 403;
  - a client query of their own rows gets 403 (`PERMISSION_DENIED`, "false for 'list'");
  - a read of their own `wsfGoalMemberTotals` gets 403.
- **`wsfMyContribution`** returns only `ownCredit`, `repeatPolicy` and `unit`, with no dated field.

So Phase B must map receipts to **unavailable** and must never fill them from public recent additions.

**Carried, not re-run:** Progress's first-visit skeleton and blocking read, from Check 41B (`ced87f1b`): the skeleton is painted and blocks on 3 serial reads (72 / 83 ms locally). Performance is PERF-MOBILE-1's.

**Limits:**
- Chromium web on emulators, at 390×844 only.
- **Text-level rows cannot prove visual parity.** They prove the route states the accepted facts in the accepted order; pixels are the Director's.
- The FAIL-BEFORE rows have not yet been seen to pass, because no hooked build exists yet. Each one is literal copy from, or order in, the frozen Lovable source, so it is satisfiable by construction. The Phase B run is where they are first shown passing.

**Status:** tests and evidence only. Nothing is accepted, integrated or staged.

## 44P · PERF-MOBILE-1 truth rows, prepared on base `0b460ce3` before W9's delivery (Director #489 `5840930960`, `5841004020`, `5841108313`): **not a verdict; the base behaviour PERF must change or keep**

- **Why this exists:** W9's PERF branch was not yet pushed. The timing and callable table stays Check 41B's unchanged harness. This spec, `sprint-w7-perf-mobile-verify.spec.ts`, proves what a member read cache must **not** do.
- **How it was run:** Chromium at 390×844 on the emulators, twice, with identical results. Every failure is a labelled row, with no harness failure.

| Row | What | At `0b460ce3` |
|---|---|---|
| **T1** account isolation (PRESERVE) | A warms Progress and You and signs out in the page; B signs in **in the same document** (marker-proved); every frame of B's session is watched for A's goal, community and name | **pass**: nothing of A in any frame; B sees its own 7 squats; A's 35 never appears |
| **T2** refusal (measure only) | M's membership is removed on the server; M returns to Home, then Progress | Home shows the goal as **"Last known"**; the mounted Progress **still lists the goal and 9 squats** (it reads only on mount) |
| **T3** after a confirmed contribution (FAIL-BEFORE) | Progress and You are both mounted (35 shown); M contributes 20 through MOVE over Progress, and the receipt is `ordinary`; the server's own total is **55** | **fails: Progress still shows 35 and You still shows 35.** Neither mounted route refreshes the member's own part after a confirmed contribution. |
| **T3b** the race (FAIL-BEFORE) | You's first own-credit read is issued and its **real** server answer (35) held (INJECTED delay); M contributes 20 (server 55); the held answer is then delivered | **fails: You shows 35**, the older answer wins. Progress, mounted only after the receipt, shows 55. |

**For PERF:**
- **T1 must stay green.**
- **T3 and T3b** are the route-level form of the Director's "a confirmed contribution refreshes only the affected own-part key" and its version guard. After PERF, both routes must show the server's 55.
- **T2** is recorded for the refusal fail-closed rule. Whether a mounted Progress drops a refused community's rows depends on PERF's refresh policy, so it is measured, not asserted.

**Status:** tests and evidence only. Nothing is accepted, integrated or staged.

## 45 · Community + Settings route baseline on served `0b460ce3f2f0766406100fef14d9a444c8cad43a` (Director #434 `5841197717`; W7 ACK `5841205352`): **FAIL-BEFORE 15 / 15 fail; PRESERVE 13 / 13 pass; ×3 identical; one Director PRESERVE row measured failing and relabelled**

- **Build:** the emulator-flagged `build:web` of `0b460ce3`, beside the emulators (`demo-wsf-local`), with synthetic accounts.
- **Viewport:** 390×844, plus the one 390×640 row.
- **Spec:** `sprint-w7-community-settings-baseline.spec.ts`, run `--repeat-each=3` with **identical row outcomes, and no failure other than a labelled FAIL-BEFORE row.**
- **For Phase B:** the same spec re-runs unchanged as the behaviour pass-after for COMMUNITY-SETTINGS-PARITY-1.

**How the rows are defined:**
- **[FAIL-BEFORE]** rows come from frozen Lovable `d4f60624`, read at that exact ref:
  - `src/demo/screens/community.tsx`: banner, facts, chips, This period, history, roster;
  - `src/demo/ui.tsx` `Sheet` and `overlays.tsx` `PrivacySheet`: `role=dialog` / `aria-modal`, Close as the first focus, Escape and scrim closing, the Tab trap;
  - the Director's panel contract (#489 `5841078939`).
- **[PRESERVE]** rows are canonical truths.
- **Route-level only:** no W9 or W4 component or testID is assumed. The privacy controls are found by their community heading, so the rows drive today's `/settings` → `/settings/privacy` pages and the future panel alike.
- **Carried, not re-run:** Check 43's accepted privacy rows (`8e5d5955`) and its swallowed-save-error fail-before.

**The fixture:**
- **Memberships:**
  - M is a member of C1 (current) and C2;
  - O is C1's Champion;
  - Q is in C1 **with her name private**;
  - C3 exists without M, and M's C4 membership is `removed`.
- **C1's goals:**

  | Goal | Unit | Shared / target | State |
  |---|---|---|---|
  | G1 | squats | 180 / 500 | open |
  | G2 | minutes | 130 / 120 | reached-open |
  | R | squats | 230 / 200 | closed, reached |
  | U | squats | 150 / 400 | closed, unfinished |

### 45A · Community tab (`app/(tabs)/community/index.tsx`)

| Row | Kind | At `0b460ce3` (every run) |
|---|---|---|
| C-F1 the identity banner leads: the community name above the switcher and any page title | FAIL-BEFORE | **fails**: the page title "Community" leads, then a CURRENT panel |
| C-F2 facts in order: Members / Your role / Goals | FAIL-BEFORE | **fails**: "3 members" meta only |
| C-F3 chips for both joined communities, plus Join and Start | FAIL-BEFORE | **fails**: rows and "Switch" / "Start a community"; no Join chip |
| C-F4 "This period" with the current goal | FAIL-BEFORE | **fails**: "WHAT WE'RE DOING" |
| C-F5 "Goal history" / "What we’ve done together" with the closed goals | FAIL-BEFORE | **fails**: no history on the tab |
| C-F6 the roster ("3 people") after the history | FAIL-BEFORE | **fails** |
| C-F7 the first 390×844 screen holds the banner, facts and This period | FAIL-BEFORE | **fails** |
| C-F8 at 390×640, This period and the current goal are in the first viewport | FAIL-BEFORE | **fails** |
| **C-F9 an unknown total (INJECTED: every source removed) draws no Living WE** | FAIL-BEFORE (**the Director listed it PRESERVE**; see below) | **fails: a Living WE labelled "0 of 500 squats, 0% filled"** beside the correctly worded "Target 500 squats" |
| C-P1 no invented place, descriptor or sample copy | PRESERVE | pass |
| C-P2 the switch offers real memberships only: C1 and C2; never C3 or the removed C4 | PRESERVE | pass |
| C-P3 the name-private member is never named on the tab · C-P4 no rank, streak or score | PRESERVE | pass |
| C-P5 closed-reached and closed-unfinished stay distinct. Measured on Community Home, because the tab has no history today; after the hook, on the tab. R reads "230 of 200 squats · Reached", U "150 of 400 squats · Closed at 37.5%" | PRESERVE | pass |
| C-P6 the roster (`/community/<id>/members`) names O and M, never Q | PRESERVE | pass |
| C-P7 a warm entry from Home to the Community tab paints no full loading frame (per-frame watch) | PRESERVE | pass |
| C-P8 the signed-out public display names nobody | PRESERVE | pass |
| C-P9 communities read fails (INJECTED): no count, role or goals guessed; Try again offered | PRESERVE | pass |
| C-P10 goals read fails (INJECTED): no "no goal" claim and no goal count guessed ("Progress could not be loaded just now") | PRESERVE | pass |

**The C-F9 finding, a latent gap:**
- `community/index.tsx:505-506` renders `<LivingWeProgress completed={lead.sharedTotal ?? 0} …>` with no check that the total is known. Its own comment says "beside a real shared total". The text beside it already handles unknown correctly.
- **Latent:** the shared read layer calls `wsfListGoals` with `includeHistory: true`, whose successful answer always carries a number. So only a response without `sharedTotal` exposes it, which is INJECTED here.
- **Relabelled:** the Director's row "Living WE only with confirmed shared total + positive target" does **not** hold on the base, so it cannot be a PRESERVE row. It is FAIL-BEFORE (C-F9): the hook, or the view it feeds, must not draw the instrument without a known total.
- **Same class as Check 44's Y-F6** (You prints an unknown shared total as 0).

### 45B · Settings (today `/settings` → `/settings/privacy`)

| Row | Kind | At `0b460ce3` |
|---|---|---|
| S-F1 Settings opens as a dialog over the still-mounted You | FAIL-BEFORE | **fails**: it navigates to `/settings`, a page; no dialog |
| S-F2 the panel is titled Settings and holds both communities' controls (≥ 4 switches) | FAIL-BEFORE | **fails**: the controls are one more page away ("Privacy") |
| S-F3 focus enters on Close | FAIL-BEFORE | **fails** |
| S-F4 Escape closes and focus returns to the Settings trigger | FAIL-BEFORE | **fails** |
| S-F5 a scrim press closes and focus returns | FAIL-BEFORE | **fails** |
| S-F6 Tab stays inside the panel (25 presses) | FAIL-BEFORE | **fails** |
| (carried) the swallowed save error | FAIL-BEFORE | Check 43 (accepted `8e5d5955`) |
| S-P1 name OFF in C1, through whatever surface exists, is stored `private`, and the switch shows the stored value after reopening | PRESERVE | pass |
| S-P2 C2 is untouched: stored and shown | PRESERVE | pass |
| S-P3 another member (O's `wsfCommunityMembers`) no longer sees M named in C1 | PRESERVE | pass |
| (carried) no optimistic value; anonymous but counted; activity off keeps the aggregates; no identity on public surfaces; the nonmember refusal | PRESERVE | Check 43 rows 1–6, accepted |

**Limits:**
- Text, order and focus are not pixels. The panel's 180 ms exit, reduced motion and the full-frame transition evidence are Phase B's.
- Chromium and emulators only.
- The FAIL-BEFORE rows cannot be seen passing until a hooked build exists. They are literal Lovable copy, order and dialog behaviour, so they can pass by construction.

**Status:** tests and evidence only. Nothing is accepted, integrated or staged.

## 44P-b · PERF-MOBILE-1 diagnostic on `5633057a` (Director #434 `5841354919`; W7 ACK `5841358841`): **T1 PASS · T2 FAIL · T3 FAIL · T3b FAIL with the race reproduced (Progress regresses) — not an acceptance run**

- **Build:** `5633057a` differs from `218eb1df` in two W9 test specs only. Its `apps/westayfit/app` and `src` trees are identical (`2446ce63` and `a5955cff`), so the emulator build of `218eb1df` is its product.
- **Scope:** only the truth spec, with no Check 41B, as instructed.

**Unchanged spec (`a5bad071`), `--repeat-each=2`, identical results:**
- **T1 PASS.**
- **T2 FAIL**, scored on the Director's refusal rule (`5841264164`).
- **T3 FAIL:** mounted Progress and You show 35 while the server holds 55.
- **T3b CANNOT-MEASURE:** You opened from the record inside the candidate's 10 s same-load window, so no own read was in flight to hold. Posted as #434 `5841382900`.

**Harness adjustment, disclosed; this spec is committed here:**
- **T3b now waits 11.5 s after Home settles**, past the 10 s window, so You issues a fresh own read that can be held.
- **T2 is now an asserted row**, and it records every callable's answer after the removal.
- **Re-shown on the base `0b460ce3` before being relied on:**
  - T1 passes;
  - T2 fails;
  - T3 fails;
  - T3b fails with 1 answer held (You 35, Progress 55).

**The adjusted rows on `5633057a`:**

| Row | Base `0b460ce3` | `5633057a` |
|---|---|---|
| **T3b** held pre-receipt own read (1 held, server 55, receipt `ordinary`) | You **35**, Progress **55** | You **35**, **Progress 35**. The late pre-receipt answer is taken into the member record and Progress opens on it. **This is the race in `memberReads.read()` the Director read in source (#494 `5841250834`), reproduced; for Progress it is a regression over the base.** |
| **T2** refusal | Progress still lists the goal | the same |

**T2 in detail, on both builds:**
- After the membership is removed on the server, Home's own reads receive **real refusals**: `wsfListGoals` 404, `wsfCommunityMembers` 403, `wsfCommunityActivity` 403, `wsfGoalPulse` 404.
- Home nevertheless shows the goal as **"Last known"**.
- The returned-to Progress **still lists the refused community's goal** (9 squats).
- That is a fresh proof of membership loss without the cache or screen invalidation the Director's rule requires.

**Status:** diagnostic only. Nothing is accepted, integrated or staged.

## 46 · HARDENED-MEMBER-JOURNEY-1: the standing hardening rows, baselined on served `0b460ce3f2f0766406100fef14d9a444c8cad43a` (Director #434 `5841402228`; W7 ACK `5841416878`)

- **What it holds:** the new spec `sprint-w7-hardened-journey.spec.ts` carries only the rows not already covered by Checks 41B, 43, 44 and 45 and the PERF truth spec. H5 (Settings lifecycle) is appended when W9's panel lands.
- **Setup:** emulators only (`demo-wsf-local`); synthetic accounts; Chromium at 390×844, and H2 at 390×640.
- **The instrument:** an init script records, per frame:
  - mounted instances per route root;
  - loading frames;
  - live `setInterval` ids;
  - net window and document listeners;

  alongside callables and Firestore listen channels per cycle.

### The rows at `0b460ce3`

| Row | What | At `0b460ce3` |
|---|---|---|
| **H1a** | 10 warm cycles Home → Community → Progress → You → Home: no loading frame | **PASS** (0 in all 10) |
| **H1b** | one mounted instance per route, no remount after the warm pass | **PASS** (1 / 1 / 1 / 1) |
| **H1c–e** | no growth from cycle 2 to cycle 10 in mounted screen roots, live intervals and net listeners | **PASS** (4 → 4, 1 → 1, 37 → 37) |
| **H1f–g** | callables and listen channels per cycle do not grow | **PASS**: 5 per cycle, all Home's revalidation; 0 listens. `history.length` is recorded, not asserted (5, flat) |
| **H2a–e** ×3 openers | 10 MOVE open / Close cycles from Home, Progress and You: Close returns to the opener tab; focus returns to the MOVE control; scroll kept; one tab bar and no sheet left; requests per visit flat | **PASS** on all 15 rows. Scroll held at 150 on every opener. Requests per visit: Home 10, Progress 5, You 5, flat. H2 runs at 390×640 with three closed goals so that Progress and You scroll; at 390×844 with one goal, their scroll row was CANNOT-MEASURE in the first run. |
| **H2f** | one confirmed contribution, then 5 more open / Close cycles | **PASS**: 1 `wsfContribute` and exactly 1 ledger row |
| **H3a** | every read held 1.5 s (INJECTED delay): known content 300 ms into the switch, no loading frame | **PASS** on all four routes (only Home issues reads on a warm switch) |
| **H3b** | a refresh whose reads all fail (INJECTED 500) never becomes a fake zero or an empty claim; sampled every 250 ms for 8 s | **PASS** on all four routes |
| **H3c** | where a refresh was issued and failed, the screen says so within 8 s (last-known or retry wording) | **FAIL, Home.** 7 reads, all 500, over 8 s; Home keeps showing "Open · … 180 of 500 squats 36% complete" with no stale or last-known word. That is Check 27's recorded **silent failed refresh**, re-measured. Refusals (403 / 404) do produce "Last known" (T2); a transient 500 does not. |
| **H3d** | Retry performs one fresh read | **PASS**: Home's Refresh gives `wsfGoalPulse` 1 and `wsfMyContribution` 1, none repeated |
| **H4a** | A warm; A's Home revalidation held (3 requests); A signs out in the page; B signs in (same document, marker-proved); A's held answers released into B's session | **PASS**: no frame shows A's goal, community or name |
| **H4b** | M warm; a real pre-removal `wsfListGoals` answer held; membership removed; a fresh read meets the refusals (`wsfListGoals` 404, `wsfCommunityMembers` / `wsfCommunityActivity` 403, `wsfGoalPulse` 404); the old answer released | **FAIL**: Home, Community, Progress and You all still show the removed community's goal. It is the same gap as T2; there is no eviction on the base. |
| **H5** | Settings lifecycle | **not built**: appended when W9's panel lands |

**How this spec was corrected before being relied on (disclosed):**
- **H2:** 390×640 plus closed goals, because the first run could not measure scroll on Progress and You.
- **H3b / H3c:** the first version failed each read name **once**. Home's pulse poll re-read and recovered within the window, so that version's H3c "fail" was the harness, not the product. It now fails every read for the whole refresh and samples for 8 s.
- **H4b:** split into its own test with a clean page, rather than inheriting H4a's session.

### Row → last-passing SHA (the standing matrix; updated in §47, §48, §51 and §52)

| Row(s) | Last passing | Dependencies: re-run when these change |
|---|---|---|
| H1a–g | `ad3d2f88` (and `889e9775`, `0b460ce3`) | `app/(tabs)/_layout.tsx`, the tab route files, `src/memberReads.ts` |
| H2a–f | `ad3d2f88` (and `889e9775`, `0b460ce3`; H2e rule restated in §47) | `app/move/index.tsx`, `app/contribute/[goalId].tsx`, `app/(tabs)/_layout.tsx`, `src/ui/sheetMotion.ts`, `src/ui/MemberTabBar.tsx` |
| H3a, H3b, H3d | `ad3d2f88` (and `889e9775`, `0b460ce3`) | the tab routes' read effects, `src/memberReads.ts` |
| H3c | **`87a86531` and `2e235c58`** (§52, corrected instrument). **Erratum:** every earlier H3c FAIL (§46–§50) was an instrument false negative, so none of them is a product result. | Community Home's refresh handling |
| H4a | `ad3d2f88` (and `889e9775`, `0b460ce3`) | `src/memberReads.ts`, `src/auth*`, the tab routes' read effects |
| H4b | **`ad3d2f88`** (fails at `0b460ce3` and `889e9775`; harness corrected in §48) | the same as H4a, plus the refusal handling, Community Home's return membership re-check and the Community tab's focus drop |
| PERF truth T1 | `ad3d2f88` (and `889e9775`, `5633057a`, `0b460ce3`) | `src/memberReads.ts`, auth |
| PERF truth T2 / T3 / T3b | **`ad3d2f88`** (and `889e9775`; all fail at `0b460ce3` and `5633057a`) | `src/memberReads.ts`, the Progress / You / contribute read paths, Community Home's refusal handling |
| Check 44 / 45 rows | per §44 / §45 (PRESERVE at `0b460ce3`); Check 45 identical at `889e9775` and `ad3d2f88`; Check 44 identical at `889e9775`, and You / Progress are unchanged at `ad3d2f88` | You / Progress / Community / Settings routes |
| H5a–g | **`2e235c58`** (§51; the control `87a86531` has no Settings panel, so H5 cannot complete there) | `app/settings.tsx`, `src/ui/sheetMotion.ts`, `app/(tabs)/you.tsx` Settings row, `src/ui/CommunityPrivacyControls.tsx` |

**Status:** tests and evidence only. Nothing is accepted, integrated or staged.

## 47 · PERF-MOBILE-1 acceptance check on exact product `889e97755a16134bf60aa87262a6c2ac400dbb5e`, evidence `f6ae5f25` (W9 #494 `5841592659`; Director #434 `5841354919`; W7 ACK `5841689259`): **PASS on the routed criteria; no regression in any W7 row; two findings for the Director**

- **Build:** a detached worktree at `889e9775`, emulator-flagged `build:web`, served beside `demo-wsf-local`, in Chromium.
- **Lineage, by git:** `0b460ce3` → `aa4f9833` … `5633057a` → `7dd628b6` (evidence) → **`889e9775`**.
  - Over `5633057a`, the changes are cache, refusal and refresh logic only: `memberReads.ts` plus its test, `activity.tsx`, `you.tsx`, `contribute/[goalId].tsx` and Community Home, plus W9's capture spec.
  - **No path outside `apps/westayfit/{app,src,tests,tests-e2e}` and `docs/`**: no functions, rules, indexes, packages, auth, config or `.github`.
  - `f6ae5f25` adds 30 evidence files under `docs/design-target/review/perf-mobile-1/`, and nothing else.

| # | Check | Result |
|---|---|---|
| **1** | Style and render comparison against `0b460ce3` (Director `5841134188` scope) | **Additive only.** In `activity.tsx` and `you.tsx`, no base style key is removed or changed. The additions are the new "checking" / "stale + Retry" rows and You's name placeholder. MOVE, contribute, Home list and Community Home have identical styles and no render-markup change. So the settled composition carries, and captures are needed only for the new transient states. |
| **2** | PERF truth spec at `600d551d`, all four rows, `--repeat-each=2` | **8 / 8 PASS.** T1: nothing of A in B's session. **T2:** after the server-side removal, Home shows "Not a member" and Progress no longer lists the goal. **T3:** mounted Progress and You show the server's **55** after the receipt. **T3b:** 1 held pre-receipt answer; **You 55, Progress 55**. (Base and `5633057a`: T2 / T3 / T3b fail; T3b's `5633057a` race gave 35 / 35.) |
| **3** | Check 41B, unchanged (blob `245a3357`), 12 / 12 runs, run with nothing else running | **The gains hold** (table below) |
| **4** | `tests/memberReads.test.ts` | **18 / 18**. **Mutation fail-first, local and never committed:** with `stillCurrent` reduced to `sameAccount()` (the version guard removed), **exactly the 4 generation cases fail**: a stale own read after a receipt; a goals read in flight at a receipt; goals and own reads in flight at a refusal. Restored, and the worktree is clean. |
| **5** | W9's evidence at `f6ae5f25` | `MANIFEST.sha256` **52 / 52** (48 PNG + 4 WebM). All **52 frame digests inside the 4 timeline receipts match the manifest**. The receipts are stamped BASE `0b460ce3` and CANDIDATE `889e9775`. BASE records `wsf-activity-loading`, `wsf-you-loading` and `wsf-move-working`; CANDIDATE records **none** at 390×640 or 390×844. Precision note: the 4 JSON receipts and the README are not themselves in the manifest; the digests they carry are. |
| **6** | HARDENED rows whose dependencies PERF touched (§46 matrix) | **H1 7 / 7 PASS. H2 16 / 16 PASS** (after the H2e restatement below). **H3a / b / d PASS. H4a PASS.** **H3c FAIL** and **H4b FAIL**: both also fail on the base, so neither is a regression; see the findings. |
| **7** | Check 44 and Check 45 specs, re-run unchanged (PERF edits `you.tsx`, `activity.tsx` and Community Home) | **Check 44: PRESERVE 44 / 44 pass; FAIL-BEFORE 19 / 19 still fail. Check 45: PRESERVE 13 / 13; FAIL-BEFORE 15 / 15.** These are identical to the base. PERF broke no canonical truth, and the parity rows stay open for Phase B. |

### Check 41B: `889e9775` against `0b460ce3`

Medians of 3 runs, shown as 844 / 640. Base values are in brackets.

| Transition | Useful ms | Settled ms | Callables | Stages | Loading | Blocking |
|---|---|---|---|---|---|---|
| **Progress, first visit** | **19 / 19** (72 / 83) | 19 / 19 | **0** (3) | **0** (3) | **none** (skeleton) | **no** (yes) |
| **You, first visit** | **13 / 14** (89 / 92) | 13 / 14 | **0** (3) | **0** (3) | **none** (skeleton) | **no** (yes) |
| **MOVE open** | **64 / 67** (101 / 111) | 85 / 91 | **3** (5); `wsfListGoals` **0** (2) | **1** (3) | **none** ("working") | **no** (yes) |
| **MOVE open again** | **45 / 44** (106 / 106) | 61 / 56 | **2** (5): pulse and own | 1 (3) | **none** | **no** |
| Home → Community, first visit | 20 / 22 (25 / 26) | 130 / 142 | 3 (3) | 0 | none | no |
| Warm switches | 6–8 | = | 0 (0) | 0 | none | no |
| You → Home and warm → Home | 7–14 | 94–109 (87–94) | 5 background (5) | 0 | none | no |
| MOVE Close | 186 (186) | 262 / 265 (256 / 260) | 6 (6) | — | none | no |
| Submit → receipt | 50 / 52 (57 / 52) | = | 1 | 1 | none | waits on the write |
| Receipt → Home | 27 / 26 (27 / 35) | 122 / 112 (106 / 114) | 5 | 0 | none | no |
| **Cold Home, 1 community** | 321–389 (326–423) | — | **7** (9); **no identical pair** | 3–4 (4–5) | **the same four frames (not met; W9 disclosed; PERF-COLD-SNAPSHOT-2)** | — |
| Cold Home, 3 communities / Community tab | ≈ base | — | 4 / 3 / 4 (=) | = | = | — |

Home shows the server's **1,882** after the receipt on both viewports.

**H2 per-visit requests** (same fixture; `sprint-w7-hardened-journey.spec.ts`):
- **Home:** 10 → **7** (one visit 8);
- **Progress:** 5 → **2**;
- **You:** 5 → **2**.

The occasional extra read is the 10 s same-load window expiring, a `wsfMyCommunities` or `wsfListGoals`.

**H2e, restated during this check (disclosed):** "requests per visit do not grow" is now **a least-squares slope ≤ 0.25 per visit, and no visit above the modal count + 1**.
- Its first form, "visit 10 ≤ visit 2", failed `889e9775` on one periodic revalidation: [2,2,3,2,2,2,3,2,2,3].
- Its second form, "max of visits 6–10 ≤ max of visits 1–5", failed the Home opener on a single 8.
- Neither is growth. The final rule passes 16 / 16 on both builds, with slopes 0.006 / 0.042 / 0 on the candidate and 0 on the base. A per-visit leak (+1 each visit) fails it.

### Findings for the Director (not blocking the routed criteria; W7 fixes nothing)

1. **H4b, a refusal branch without eviction** (it also fails on the base, so it is not a regression). The sequence:
   - A `wsfListGoals` read issued **before** a server-side removal is still in flight (INJECTED hold of a real pre-removal answer).
   - Community Home's refresh calls `readGoals`, which **joins that in-flight read** instead of sending a fresh `wsfListGoals`, so no not-found arrives.
   - The fresh refusals that do arrive, `wsfCommunityMembers` / `wsfCommunityActivity` **403 "Members only."** and `wsfGoalPulse` **404**, are not treated as membership proof. Community Home evicts only on the membership document and on `wsfListGoals` not-found (`community/[groupId]/index.tsx:890–914, 1042, 1095`).
   - The pre-removal list then lands as current, and **Home, Community, Progress and You all still offer the removed community's goal**.

   This is the Director's "terminal membership / not-found proof and cache invalidation happen together; review every fresh server-refusal branch" (#494 `5841264164`) in a case T2 does not stage. The Director decides whether it rides this packet or a successor.
2. **H3c, Home's silent failed refresh:** 7 × 500 over 8 s with no stale wording. This is **pre-existing** (Check 27) and outside PERF's scope. Unchanged.
3. **Carried from W9's disclosure:**
   - cold Home's four loading frames are not met (PERF-COLD-SNAPSHOT-2);
   - per-community fan-out is a written seam only;
   - device and network speed is CANNOT-MEASURE on the emulator.

**Status:** PASS on the routed acceptance criteria: truth rows 4 / 4, the Check 41B gains, unit tests with the mutation fail-first, and evidence. There is no regression in any W7 row. Nothing is accepted, integrated or staged.

## 48 · PERF-MOBILE-1 H4b successor on exact product `ad3d2f889473322046757da7f54d94d2462f24a6`, evidence `b36989e7` (W9 #494 `5842157665`; Director HOLD #494 `5841923744`; W7 ACK #434 `5842302205`): **H4b PASS; it fails on `0b460ce3` and `889e9775`; no regression in any W7 row**

- **Build:** a detached worktree at `ad3d2f88`, with an emulator-flagged `build:web`. It was served beside `demo-wsf-local` in Chromium. The `0b460ce3` and `889e9775` builds from §46 and §47 were served beside it as controls.
- **Lineage, by git:** `889e9775` → `f6ae5f25` (§47's evidence) → **`ad3d2f88`**.
  - Over `889e9775`, the product diff touches three files, +151 / −4:
    - `app/(tabs)/(home)/community/[groupId]/index.tsx`;
    - `app/(tabs)/community/index.tsx`;
    - W9's `sprint-w9-perf-mobile-1.spec.ts`.
  - **No changed line is JSX, a style or a StyleSheet.**
  - **No path lies outside `apps/westayfit/{app,src,tests,tests-e2e}` or `docs/`.**
  - `src/memberReads.ts`, `you.tsx` and `activity.tsx` are unchanged.
  - `b36989e7` adds 16 files under `docs/design-target/review/perf-mobile-1/` and nothing else.

### Harness correction, mine (disclosed; commit `6cabd0ab`, blob `f52fd256`)

- **The defect:** H4b could not complete on the correction. `tab(page, 'home')` waited only for Home's `wsf-community` root. After a removal is proved, Home correctly shows "Not a member" (`wsf-community-not-member`), so the last Home visit timed out before the verdict. W9 reported this (#494 `5842157665`).
- **The correction:** after the removal, and only then, the H4b wait and text read also accept `wsf-community-not-member` for Home. All other `tab()` calls, and every pre-removal Home wait, still require `wsf-community`.
- **How it differs from W9's local variant** (`W7-H4B-LOCAL-VARIANT.diff`): W9 widened every Home wait in the file. For H4b the two forms are equivalent, but mine keeps H1–H4a strict, so a spurious "Not a member" there would still fail.
- **Shown failing first,** on both control builds, before the row counts on `ad3d2f88`.

| # | Check | Result |
|---|---|---|
| **1** | **H4b, corrected**, on three builds | **`0b460ce3`: FAIL.** The goal is still shown on Home, Community, Progress and You. Refusals include a fresh `wsfListGoals` 404, but the base has no eviction. **`889e9775`: FAIL,** shown on all four. There is no `wsfListGoals` refusal because the refresh joins the held pre-removal read (§47 finding 1). **`ad3d2f88`: PASS ×2, plus a third pass in the whole-spec run.** The goal is shown on none of the four, and the refusals include a fresh `wsfListGoals` 404. Home ends on "Not a member": the widened wait completes where W9's exact-file run timed out on `wsf-community`, and T2's text shows it directly. |
| **2** | **The whole HARDENED spec** on `ad3d2f88` (Community Home's return path changed) | **H1 7 / 7 PASS.** **H2 16 / 16 PASS.** Home requests 7 per visit (one 8), Progress and You 2–3; H2e slopes 0.006 / 0.042 / 0. **H3a / b / d PASS. H4a PASS:** 3 of A's requests held, same document, nothing of A shown. **H4b PASS.** **H3c FAIL, unchanged:** Home, 7 × 500 over 8 s, with no stale wording, exactly as on `0b460ce3` and `889e9775`. It is the named successor, not this gate. |
| **2a** | **H1g: the new return membership read** | **2 listen-channel requests per cycle, identical in all 10 cycles, so it passes (no growth).** Both controls show 0 per cycle. This is the one document read per Home return that W9 disclosed. It is not polled and does not accumulate. Callables stay at 5 per cycle, with the same five names. |
| **3** | **PERF truth spec**, unchanged (blob `09a618b9` from `600d551d`) | **4 / 4 PASS.** **T1:** nothing of A in B's session. **T2:** Home "Not a member", and Progress drops the goal to its first-contribution empty state. **T3:** 55 / 55. **T3b:** 1 held answer, 55 / 55. |
| **4** | **Check 41B**, unchanged (blob `245a3357`), 12 / 12 runs, with nothing else running | **Across all 38 transitions: the same callables, loading painted, mounts, blocking and replacement as `889e9775`.** The only field change: "MOVE open again" needed 0 read stages in some runs, where it always needed 1. See the table below. |
| **5** | **Check 45**, unchanged (the Community tab changed), `--repeat-each=2` | **PRESERVE 13 / 13, FAIL-BEFORE 15 / 15, in both runs, row for row identical to `889e9775`.** I read every failure: each is a labelled FAIL-BEFORE row (C-F1–C-F9, S-F1–S-F6), and each fails in both runs. |
| **6** | **W9's evidence at `b36989e7`** | **`MANIFEST.sha256` 52 / 52** at `b36989e7`. It is unchanged since `f6ae5f25`, and no PNG, WebM or JSON changed. **The variant diff applies cleanly** to my blob `0f5e1cec` and changes exactly two lines. **The RAW logs agree with W7's runs:** the exact file cannot complete on `ad3d2f88` (a line-165 timeout, not a verdict); the variant passes; the `889e9775` controls fail on all four surfaces; T1–T3b pass. |

### Check 41B: `ad3d2f88` against `889e9775`

Medians of 3 runs, shown as 844 / 640. The `889e9775` values are in brackets.

| Transition | Useful ms | Settled ms | Callables | Stages | Loading | Blocking |
|---|---|---|---|---|---|---|
| Progress, first visit | 18 / 17 (19 / 19) | = | 0 (0) | 0 | none | no |
| You, first visit | 15 / 13 (13 / 14) | = | 0 (0) | 0 | none | no |
| MOVE open | 77 / 62 (64 / 67) | 103 / 92 (85 / 91) | 3 (3) | 1 | none | no |
| MOVE open again | 42 / 42 (45 / 44) | 69 / 60 (61 / 56) | 2 (2) | 0–1 (1) | none | no |
| Home → Community, first visit | 21 / 22 (20 / 22) | 133 / 135 (130 / 142) | 3 (3) | 0 | none | no |
| Warm switches | 6–8 (5–8) | = | 0 | 0 | none | no |
| You → Home, pass 1 / pass 2 | 13–15 / 5–6 (14 / 6–7) | 117–121 / 100–120 (99–103 / 94–109) | 5 (5) | 0 | none | no |
| MOVE Close | 186 / 187 (186 / 186) | 274 / 266 (262 / 265) | 6 (6) | 1 | none | no |
| Submit → receipt | 61 / 56 (50 / 52) | = | 1 | 1 | none | waits on the write |
| Receipt → Home | 24 / 27 (27 / 26) | 123 / 125 (122 / 112) | 5 (5) | 0 | none | no |
| Cold Home, 1 community | 328–370 (321–389) | — | **7** (7); **no identical pair** in any run | 3–4 (3–4) | the same four frames (PERF-COLD-SNAPSHOT-2) | — |
| Cold Home, 3 communities / Community tab | ≈ | — | 4 / 3 / 4 (=) | = | = | — |

- **Receipt:** Home shows the server's **1,882** on both viewports.
- **Settled time on Home returns:** 1–22 ms higher at the medians, with identical callables. `settledMs` measures callables and loading frames, not the Firestore channel. This is within local-ms noise and is not a criterion.
- **MOVE open:** W9's README gives 45–47 ms; W7's medians are 62–77 ms (`889e9775`: 64–67). The calls and stages are the same; local milliseconds differ between runs.

### Precision notes (none blocking)

1. **Build labels in W9's RAW logs:** W9's `ad3d2f88` RAW logs are labelled "(head)" because `W7_LABEL` was unset. Only the filename and README tie them to the build; the output itself does not. W7's own runs above are stamped `ad3d2f88`.
2. **Not staged here** (W9 disclosed): a transient failure of the membership read itself. These specs do not intercept the Firestore channel, so it is CANNOT-MEASURE in this check.
3. **Carried, not re-run:**
   - Check 44: `you.tsx` and `activity.tsx` are unchanged over `889e9775`.
   - Check 43.
   - The `memberReads` unit tests and §47's mutation: `src/memberReads.ts` is unchanged.

- **Gates:** `ts:check` exit 0; `check-evidence-intact` exit 0 (9 frozen + 20 accepted, no byte changed).
- No `artifacts/` or `test-results/` committed.
- Emulators only (`demo-wsf-local`).

**Status:** **H4b, the Director's pass-after row for the HOLD, passes on `ad3d2f88` and fails on both earlier builds.** No regression in any W7 row. H3c remains the named successor. Nothing is accepted, integrated or staged.

## 49 · PERF-MOBILE-1 staging pin check: #502 at exact `ca2cc4c0bc1c3c4aafba8b70231c0e38525aee6c` (L0 #434 `5842769988`; L0 receipt #502 `5842768054`; Director ACCEPTED #494 `5842637914`; W7 ACK `5842807627`): **PASS**

This is the Check 42 method. It was run on a detached worktree at `ca2cc4c0` and on git objects. It is local only: no dispatch, no staging access and no product rerun.

| # | Check | Result |
|---|---|---|
| **1** | Head, base, scope | **PASS.** `ca2cc4c0` has one commit and one parent, `main` `6c2e6b25`. `main` is still `6c2e6b25`, and the tree is `114d0c07`. **Exactly one file changes**, `.github/wsf-staging/approved-candidate.json` (+9 / −5). **Changed keys:** `approvedAppSha`, `packageLabel`, `sourceAcceptedOn`, `_expectedPriorFunctionsNote` and `_fullCandidateNote`. **Added:** three `_previous…0b460ce3` history keys and `_rollbackNote`. **Unchanged:** `expectedPriorFunctions` **49**, `candidateAddedFunctions` (`wsfsetcommunityvisibility`, `wsfcommunitymembers`, `wsfcommunityactivity`) and `project` `westayfit-staging`. |
| **2** | The candidate is the product Check 48 passed | **PASS.** `approvedAppSha` = `14ce19079fc08bbab7ffeace8b94e062a8928f9a`, whose parents are `0b460ce3` (first) and `ad3d2f88`. **Its tree `61018729` equals `ad3d2f88`'s tree**, byte for byte. It is **not** the development head `87997c58`. |
| **3** | `resolve-candidate` (the real script) | **PASS.** **On the head:** an empty request and the full `14ce1907…` both resolve to `14ce1907…` (exit 0). The full `0b460ce3`, `87997c58`, `ad3d2f88` and `889e9775` SHAs are **refused** ("syntactically valid but is NOT the approved candidate", exit 1). A short SHA is refused on syntax. **Control, `main`'s pin:** an empty request resolves to `0b460ce3`, and the full `14ce1907` is refused. `ad3d2f88` is refused only because the pin names the merge, whose tree is identical. |
| **4** | The real `read-inventory` gate, with synthetic inventories | **PASS.** 49 names (the verifier's `BASE_EXPECTED` 46 + the 3 additions = 49 unique) give `PREFLIGHT_BEFORE=49`, `PREFLIGHT_BASELINE_MATCHES_APPROVAL=true`, exit 0. **48 and 50 are refused** ("… approved against 49", exit 1). |
| **5** | Boundary `0b460ce3..14ce1907` and the expected deploy | **PASS.** 71 files, +2526 / −273. **The protected-path diff is empty:** `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, the root and app `package*.json`, `app.json`, `.github/`, `scripts/westayfit/`, `functions/` and `functions-westayfit/`. `functions-westayfit` is tree **`5a3f232e` at both SHAs**, the same tree Check 42 counted at 49 exports. So the expected deploy is **49 → 49, `CREATED_THIS_DEPLOY=none`**. |
| **6** | Rollback | **PASS.** `_rollbackNote` names `0b460ce3` (run 50, `main` `a4b228a5`). Because the functions tree is unchanged, re-pinning `0b460ce3` stays compatible with the 49-function inventory. This is a note, not a gate. |
| **7** | Tests and guards on the pin tree | **PASS.** `node .github/wsf-staging/tests/run-all.mjs` exits 0 ("all suites passed"). `verify-deployment.test.mjs` and every file under `.github/wsf-staging/tests` and `scripts/` are byte-identical to `main`. `check-evidence-intact` exits 0. |

**Not checked (carried from #502's own list):**
- the three social services are transport-SHUT;
- there is no READY receipt for the `wsfContributions` index;
- email is blocked at runtime;
- the kiosk hold stands.

W7 did not read run 50's job log again.

**Status:** **PASS on the pin at `ca2cc4c0`.** Nothing is dispatched, accepted, integrated or staged by W7.

## 50 · ROUTE QA: You #503 (product `a0f1351a`, evidence `88ef59db`) and Progress #504 (product `bdc82c0e`, evidence `3ba527d3`) on development `87997c58` (Director release #434 `5843356920`; lead ruling #503 `5843356469`; L0 receipt #503 `5843152440`; W7 ACK `5843359948`)

**Verdicts, separate:**
- **You `a0f1351a`: PASS on every routed item.** One Check 44 row stays open for the Director: Y-F10.
- **Progress `bdc82c0e`: PASS on every routed item.** One Check 44 row stays open for the Director: P-F5, which fails on a cold load only.
- **No regression in any W7 row on either build.**

**Build and setup:**
- Detached worktrees at `87997c58` (the control), `a0f1351a` and `bdc82c0e`, each with an emulator-flagged `build:web`. Each bundle carries only its own SHA stamp.
- They were served beside `demo-wsf-local`. The emulator stack was restarted after the container restart, with the functions tree `5a3f232e` and 49 callables.

**Lineage, by git:**
- `87997c58` → `0fb63d96` → `341a41e5` → **`a0f1351a`** → `88ef59db` (evidence) → `d9a419ea` → `216f9d96` → **`bdc82c0e`** → `3ba527d3` (evidence).
- The protected-path diff from `87997c58` is **empty for both products**.
- **Scope:**
  - You: 7 files. The route adapter, `RefreshNote` (new), `YouParityView`, `youParity`, W6's hook spec and two unit tests.
  - Progress: 8 files. The route adapter, `progressParity`, `ProgressParityView`, W6's hook spec, one unit test and **the three re-pointed specs**.
- The evidence commits touch docs only. Progress's lineage includes the You evidence commit, which is also docs only.

| # | Check | You `a0f1351a` | Progress `bdc82c0e` |
|---|---|---|---|
| **1** | **Check 44, unchanged, as the pass-after.** Control `87997c58`: FAIL-BEFORE 19 / 19 fail and PRESERVE 44 / 44 pass, identical to `889e9775`. | **You FAIL-BEFORE 9 / 10 now pass** (Y-F1–Y-F9). **PRESERVE 44 / 44.** Open: **Y-F10**, below. | **FAIL-BEFORE 17 / 19 pass**: You 9 / 10 carried, and Progress **P-F1–P-F4 and P-F6–P-F9**. **PRESERVE 44 / 44.** Open: Y-F10 and **P-F5** (cold). |
| **2** | **The lead-row rule** (`5843356469`). New spec `sprint-w7-route-qa-you-progress.spec.ts`, Q1: the member is in C1 (selected) and C2; C2's credited goal ends **sooner** than either of C1's; C2 is already in the record from its Home. | **PASS.** The lead is C1's soonest-ending goal, even though C2's ends sooner (Q-P2). C2's goal is under "Other goals you helped" with **"W7 Lunch Crew … · Ends Mon, Sep 28"**, its own name and period (Q-F1–Q-F3), and C1's name is not attached to it (Q-P3). On the control, C2's goal is absent. | carried: identical |
| **3** | **Partial when not in the record** (Q2): a cold `/you` where C2 was never read | **PASS.** "Some goals could not be loaded, so this list may be short." (Q-F4). Nothing of C2 is invented (Q-P4). **No read is fanned out to C2** (Q-P5): the only callables name C1. The control shows no partial note. | carried |
| **4** | **Unknown shared is never 0** | **PASS:** Y-F6 / Y-F7 (Unknown, never "0 of"). | **PASS:** P-F6. You is carried. |
| **5** | **No added blocking read against accepted PERF.** Check 41B, unchanged, 12 / 12 runs per build, run alone. | **0 changed call, stage, loading, mount or blocking fields across all 38 transitions.** You's first visit makes 0 calls, has 0 stages and paints no loading: 17 / 15 ms (control 12 / 14). | Progress's first visit makes 0 calls, has 0 stages and paints no loading: 11 / 11 ms (control 15 / 14). The only field change: "MOVE open" needed 0 stages in some runs, where it always needed 1 (fewer, not more). |
| **6** | **Settings still works; no account / admin hierarchy regression** | **PASS.** Check 45, unchanged, on `a0f1351a`: PRESERVE 13 / 13 and FAIL-BEFORE 15 / 15, row for row identical to `ad3d2f88`, which includes the Settings privacy truths. Check 44's Y-F5 (email and Sign out below the member story) now passes. The sign-out and identity PRESERVE rows hold. | carried |
| **7** | **Exact own unit totals; the YOURS / SHARED split; lifecycles** | — | **PASS:** P-F1 ("73 squats recorded", "12 minutes recorded"; no blended 85), P-F3 and P-F4. P-P2 / P-P3 hold. |
| **8** | **No-open-goal CTA truth** | You Y-F8 / Y-F9 PASS | **PASS:** P-F8 / P-F9. #504's no-community card: no Start moving, and a way to a community (re-pointed `sprint-w8-progress-copy`). |
| **9** | **Partial and failure truth** | A5: identity, Retry and Sign out survive, and no amount is guessed (PRESERVE). **Y-F10 open**, below. | **PASS:** P-F7 (partial offers Retry). P-P12 holds. The failure card keeps identity and refuses to guess. |
| **10** | **`periodLabel` pass-through**, in the goal's own zone (Q3): a goal ending 20:00 UTC, which is the **next** day in `Asia/Tokyo` | **PASS** on a secondary row: "Ends Sat, Oct 3", not the UTC "Fri, Oct 2" (Q-F6). The lead card prints no period, by the accepted view (`YouParityView.tsx:452` writes it on secondary rows only). | **PASS:** "W7 Tokyo Movers … · Ends Sat, Oct 3" (Q-F7). The control prints no period on either route. |
| **11** | **The private dated-receipt seam** | — | **PASS:** "Dated receipts aren't available here yet." There is no dated row and no relative time (P-P5), and `receipts: null` in the adapter. |
| **12** | **#504's three re-pointed specs.** Assertion-by-assertion diff, plus runs. | — | **Legitimate re-points. None weakens a truth, accessibility or performance check. Measured:** the **old** versions pass 12 / 12 on the control; the **new** versions pass **12 / 12** on `bdc82c0e`; the **new** versions **fail 7 / 12 on the control**, exactly the 7 re-pointed tests, so none is vacuous. Detail below. |
| **13** | **H carry** (both route exits changed: You gains Start moving → `/move`; Progress drops Go Home and gains Open community) | **H1 7 / 7, H3a / b / d, H4a and H4b PASS.** H3c (Home) fails identically on the control; it is the named successor. | **The same, plus H2 16 / 16** with per-visit requests identical to the control (Home 7, Progress 2–3, You 2–3). |
| **14** | **W6's hook specs** | — | `sprint-w6-you-hook` + `sprint-w6-progress-hook`: **9 passed**, 2 gated skips, on `bdc82c0e`. |
| **15** | **Evidence** | `88ef59db`: every route PNG and Lovable reference matches its manifest SHA-256. **The route PNGs and side-by-sides are byte-identical to the parked hook `b99f59a4`**, as W6 states. | `3ba527d3`: the same. **Byte-identical to `3a7ad0d8`.** The 390×640 frame has no Lovable counterpart (`lovable: null`, declared). |

### The re-pointed specs, one by one

1. **`progress-list`, three tests:**
   - "N goals you have added to / N running · N finished" becomes the summary line, **plus one exact total per unit** (`aria-label` "120 squats recorded" …) and lifecycle-pill counts. This is **stronger**: units are asserted separate, not just counted.
   - The corrected goal: "80%" becomes **"2,400 / 3,000 push-ups" plus "CLOSED · UNFINISHED"**. `not.toContainText('REACHED')` is kept.
   - Partial: "RECORDED" becomes "YOURS". The partial note is still asserted.
2. **`sprint-w8-progress-copy`, three tests:**
   - **Populated:** the Living WE assertion is removed. The Progress reference draws none, and the SHARED cell asserts the real total instead. REACHED becomes **"CLOSED · REACHED"**, and the units are asserted in the YOURS cells.
   - **Empty:** it now asserts the **no-community truth**: no Start moving, a way to a community, and never "your community". This closes a gap Check 44 recorded on the base.
   - **Error:** the in-card Home and MOVE buttons become the persistent tab bar's controls, and the reassurance copy becomes the reference's.
3. **`ui-app-shell`, one test:** the page-wide `not.toContainText('1,847')` is **narrowed to the YOURS cell** (`not.toContainText('1,8')`), because the reference now shows the shared total, labelled SHARED. The own-number truth is kept and made exact (`toHaveText('YOURS20 squats')`).

**Precision notes (not weakenings):**
- (a) The SHARED cell's value is asserted only by its label and target, not by "1,847".
- (b) W8's "no privacy clarification on the error card" assertion is removed, because the accepted Progress view now shows the clarification on the failure card too. Whether a clarification belongs where there is no summary is a copy question for the Director.

### Open rows for the Director (not regressions; W7 fixes nothing)

1. **Y-F10, You: "the community stays on screen when the goals read fails"** (a Check 44 FAIL-BEFORE row, from the Director's Phase B rules #456).
   - On a **cold** load with the goals read failing, the adapter's `fail()` shows the view's `failed` state. It keeps the name, "Contribution details unavailable", Retry and Sign out, **but not the community band**.
   - When the record already holds the page, it stays on screen as stale with Retry. That case passes; the cold case does not.
   - The accepted `YouState` `failed` kind carries no community. Closing this needs a view-contract change, or a Director ruling that the row is satisfied.
2. **P-F5, Progress: "the member is named in the private hero".**
   - It **fails on a cold `/activity` load** and **passes warm**: "PRIVATE TO YOU · MARA ROUTE …" once the account has read the profile (Q-F5, after You).
   - This is W6's disclosed design: the name comes only from the record, with no extra read. The Director decides whether the cold hero may go unnamed.
3. **You's partial copy, "Some goals could not be loaded…",** also appears when another community was simply **not read yet**, not failed. W6 disclosed this as loose wording ("not false") and kept the accepted Phase A string. MEMBER-SNAPSHOT-1 removes the case.
4. **The committed route frames show a single community.** They carry no "other community" row, so the other-community composition is evidenced by this check's text rows, not by frames.

### Instrument disclosures (mine)

- **New spec:** `sprint-w7-route-qa-you-progress.spec.ts` (`07598136`), corrected at `23a451cb` after the first runs.
  - **Q3's two rows** were written as PRESERVE. The control prints no period on either route, so they became FAIL-BEFORE.
  - **Q-F6** first put the zoned goal in You's **lead**, which by the accepted view never prints a period. The zoned goal is now a secondary row, which is the Director's "every secondary row names its … period".
  - **Q-F5** compared the name case-sensitively; the hero upper-cases it.
- **Final runs, labelled:**
  - control: FAIL-BEFORE **7 / 7 fail**, PRESERVE **5 / 5**;
  - `a0f1351a`: You rows 5 / 5 pass (Q-F5 / Q-F7 are Progress rows, still failing there), PRESERVE 5 / 5;
  - `bdc82c0e`: **FAIL-BEFORE 7 / 7 pass, PRESERVE 5 / 5**;
  - ×2 identical on both candidates.
- **Gates:** `ts:check` 0; `check-evidence-intact` 0 (9 + 20). No artifacts committed. Emulators only (`demo-wsf-local`). Nothing is accepted, integrated or staged.

## 50b · The You Y-F10 successor on exact `18ba6de2` (Director HOLD #503 `5844877801`; W6 `5844971743`; L0 `5845024782`; W7 ACK `5845159063`): **Y-F10 PASS; its preservation rows hold; no new call, stage or loading field**

- **Lineage, by git:** `18ba6de2` is one commit on `88ef59db`, touching 2 files (+38 / −4):
  - `app/(tabs)/you.tsx` (+10 / −4): the route's `failed` state may carry `community`, passed only from the goals-read catch, after the current community is resolved;
  - W6's hook spec (+28).

  **No view file, no new read, and an empty protected-path diff.**
- **Build:** a detached worktree with an emulator-flagged build, served beside `demo-wsf-local`. Its bundle is stamped `18ba6de2`.

| # | Check | Result |
|---|---|---|
| **1** | **Check 44 A5, unchanged** (cold `/you`, goals read failing, INJECTED) | **`a0f1351a`: Y-F10 FAIL** (no band). **`18ba6de2`: Y-F10 PASS ×2.** The page shows "YOUR CURRENT COMMUNITY W7 Harbor Movers … ROLE Member … 2 members", then "Your identity and community are still here. We won't guess an amount or show it as zero." with Open community and Retry. **Y-P18 identity, Y-P19 Retry, Y-P20 no amount guessed as 0 and Y-P21 Sign out: PASS ×2.** |
| **2** | **Callables on that failure path** (new measure-only Q5 in `sprint-w7-route-qa-you-progress.spec.ts`) | **Identical on both builds:** `wsfMyCommunities` and `wsfListGoals`, and nothing else. The band shows on `18ba6de2` (×2) but not on `a0f1351a`. |
| **3** | **Check 41B, unchanged,** 12 / 12 runs, run alone, against `a0f1351a` | **0 changed call, stage, loading, mount or blocking fields across all 38 transitions.** You's first visit: 0 calls, 0 stages, no loading (17 / 19 ms, against 17 / 15). |

- **Carried, not re-run (as ruled):** the rest of Check 50. The Progress delta `bdc82c0e` is accepted (#504 `5844877908`); W6 carries it onto this successor.
- **Gates:** `ts:check` 0; `check-evidence-intact` 0 (9 + 20). No artifacts committed.

**Status:** **Y-F10 closes on `18ba6de2`.** Not accepted, integrated or staged.

## 51 · COMMUNITY-SETTINGS-PARITY-1 functional packet on immutable `2e235c58` (Director queue #434 `5845321377`; row-3 ruling #506 `5844878042`; L0 `5844260871` and `5844603601`; W7 ACK `5845335205`): **Check 45 PASS, Check 43 PASS, H5 PASS**

- **Lineage, by git:** `87a86531` (development) → `1f6aa77e` → `ab0843dc` → `495cf847` → `b863fd53` → **`2e235c58`**.
  - 23 files under `apps`. **The protected-path diff is empty.**
  - `functions-westayfit` is `5a3f232e` at both SHAs.
- **Builds:** detached worktrees at `87a86531` (the control) and `2e235c58`, each with an emulator-flagged build. Each bundle carries only its own SHA stamp.
- **Scope, as ruled:** functional only. The visual successor (the panel geometry, the ring asset, matched evidence) is W9's and is not checked here. No unrelated suite was run.

| # | Check | `87a86531` (control) | `2e235c58` |
|---|---|---|---|
| **1** | **Check 45, unchanged,** ×2 | FAIL-BEFORE **15 / 15 fail**; PRESERVE **13 / 13** | **FAIL-BEFORE 15 / 15 now pass** (C-F1–C-F9, S-F1–S-F6). **PRESERVE 13 / 13.** ×2 identical. |
| **2** | **Check 43**, with selectors on W4's `wsf-privacy-panel-*` IDs and row 3 re-disposed (below) | U1 fail-first **4 / 4 fail** (the swallowed save error, as §43). U1c and the R rows pass, including the new row-3 assertions. | **7 / 7 PASS.** U1 lost: "That change wasn't saved. The switches show your saved setting." is still shown at settle, with the switch equal to the stored value. U1 land-but-drop: "We couldn't confirm that change. The switches show what's saved now." R rows 1–6 and R5 pass. |
| **3** | **H5, Settings lifecycle** (new; 390×640; 10 cycles rotating Close / Escape / scrim), ×2 | **Cannot complete:** there is no Settings panel and no Close (`wsf-settings-close` is absent). This is consistent with Check 45's S-F1–S-F6 failing on the control. | **7 / 7 PASS, ×2:** see the rows below. |

The H5 rows on `2e235c58`:
- **H5a:** a modal dialog over the still-mounted You, 10 / 10.
- **H5b:** focus enters on Close, 10 / 10.
- **H5c:** Close, Escape and the scrim each return to `/you` with focus on the Settings row and no panel left, 10 / 10.
- **H5d:** You's scroll is kept, 133 → 133 every cycle.
- **H5e:** the panel travels. Entry paints 9 distinct positions; the median exit is **202 ms** (188–239).
- **H5f:** no growth from cycle 2 to cycle 10: listeners 39 → 39, intervals 1 → 1, history 6 → 6.
- **H5g:** reduced motion paints no intermediate frame on entry or exit, 3 / 3.

**Check 43 changes (disclosed, mine; `sprint-w7-privacy-toggle-verify.spec.ts`):**
1. **Selectors only:**
   - the switch, error and loading locators accept W4's `wsf-privacy-panel-*` IDs **or** the pre-parity IDs, so the same file runs on both builds;
   - they match W9's `W7-CHECK43-LOCAL-VARIANT.diff` in substance;
   - no other assertion changed.
2. **Row 3, re-disposed per the Director** (#506 `5844878042`).
   - "The anonymous note is shown" is **no longer asserted.** W4's accepted C2 deleted that paragraph; it is measured as 1 on the control and 0 on the candidate.
   - Row 3 now proves:
     - **the authoritative stored truth after a reload:** stored `name: private` and `activity` not private, with the name switch resting OFF and the activity switch ON;
     - **the anonymous behaviour where it surfaces:** another member's activity read lists **"anonymous"**, not M's name, while M is still counted today (2).
   - Both builds pass it. The truth did not change; only the deleted copy did.

**H5 instrument note (disclosed):** H5d first compared against a scroll taken before Playwright's click scrolled the Settings row into view (150 → 133 happened before the panel opened). It now compares against the scroll just before each press, with the row in view.

**Status:** functional PASS on `2e235c58`. Visual acceptance is not W7's. Nothing is accepted, integrated or staged.

## 52 · H3c re-measured with context-level injection (W4 #365 `5843808619`; L0 #434 `5844260871`; Director `5845321377`): **H3c PASS on `87a86531` and `2e235c58`; every earlier H3c FAIL was an instrument false negative**

**The defect in my instrument:**
- H3 installed its hold route, **unrouted it, then routed the 500 injection**.
- Measured with the delivered statuses now counted, on unmodified `87a86531`:
  - **with `page.route`** (my original, per W4): most failure windows answered **7 × 200** and the 500 handler never ran;
  - **with `page.context().route` plus unroute / re-route: 0 / 3 runs delivered any 500** on `87a86531`, and 1 / 2 on `2e235c58`.
- H3c's old verdict did not check delivery. So **every "H3c FAIL, Home silent" in §46, §47, §48 and §50 recorded a failure that was never injected.** Those rows are withdrawn as product findings.
- **H3b's "never a fake zero" was also vacuous in those runs.** It is now gated the same way.

**The correction** (`sprint-w7-hardened-journey.spec.ts`):
- **One** context route for the whole test, switched between pass, hold and fail, and never unrouted between phases.
- Each window counts the callable responses actually delivered.
- H3b and H3c report **CANNOT-MEASURE** unless every read issued in the failure window was answered 5xx.
- The handler's own counts are reported: pass 2, hold 5, **fail 7**.

| Build | Runs | Delivered in the failure window (Home) | H3a | H3b | **H3c** | H3d |
|---|---|---|---|---|---|---|
| `87a86531` | 3 | **7 issued, 7 × 500, 0 OK**, every run | PASS | PASS | **PASS**: "Last known … Couldn't refresh. This is the last confirmed figure." at **321–328 ms** | PASS: `wsfGoalPulse` 1, `wsfMyContribution` 1 |
| `2e235c58` | 3 | the same | PASS | PASS | **PASS** at 333–338 ms | PASS |

This matches W4's measurement: 334–370 ms, with Retry, and the behaviour comes from RETURN-CONTINUITY-1, already in the base. **No product change is implied by this instrument task.** Whether HOME-REFRESH-TRUTH-1 closes is the Director's decision.

- **Gates:** `ts:check` 0; `check-evidence-intact` 0 (9 + 20). No artifacts committed. Emulators only (`demo-wsf-local`).

## 53 · The staging pin #508 at exact `fbcfc80c8585e182167d81ae4caf5e76ce740ac8` (Director `5845751799`; source review #508 `5845751625`; W7 ACK `5845753700`): **PASS**

This is the Check 49 method, run locally by git and with the real staging scripts on the pin tree. No product rerun, and no social, email or index check.

| # | Item | Result |
|---|---|---|
| **1** | **Head and scope** | **PASS.** The PR head is exactly `fbcfc80c` on the remote, with one parent, `main` `32563aa0` (still `main`). **One file changes**, `approved-candidate.json` (+8 / −5). **Changed:** `approvedAppSha` (`14ce1907` → **`74d1928145bbc76267498ee63b9423b6f6cdfae8`**), `packageLabel`, `_expectedPriorFunctionsNote`, `_fullCandidateNote` and `_rollbackNote`. **Added:** three `_previous…14ce1907` history keys. **Unchanged:** `expectedPriorFunctions` **49**, `candidateAddedFunctions` (the three social names, equal to `main`) and `project`. |
| **2** | **The boundary `14ce1907..74d19281`, re-derived** | **PASS.** 211 files, +9844 / −1157, of which 182 are under `docs/`. App routes: `(tabs)/you.tsx` and `(tabs)/activity.tsx` are modified; `design-target/{you,progress,community}-parity.tsx` are added, each gated on `EXPO_PUBLIC_WSF_USE_EMULATORS`, which staging does not set; none is removed. **The protected-path set is empty:** hosting and emulator configs, rules, indexes, `.firebaserc`, packages, `app.json`, `.github/`, `scripts/westayfit/`, `functions/` and `functions-westayfit/`. |
| **3** | **The four first-parent merges, each an accepted packet** | **PASS.** Each merge's tree **equals `git merge-tree` of its parents:** `993f0796` = `14ce1907` + You Phase A `02f86fc2` (#500); `87997c58` = + Progress Phase A `92993f09` (#501); `87a86531` = + Community Phase A `646c9579` (#496); **`74d19281` = + `2f57bbca`**. **`2f57bbca`'s tree equals the merge of accepted You `18ba6de2` and Progress evidence `3ba527d3`** (Progress product `bdc82c0e`). The You route and views are byte-identical to `18ba6de2`, and the Progress route and views to `bdc82c0e`. |
| **4** | **Functions and inventory** | **PASS.** `functions-westayfit` is tree **`5a3f232e` at both SHAs**, the tree Check 42 counted at 49 exports. The verifier's 46 base names plus the 3 additions give 49 unique. **`read-inventory`:** 49 gives `PREFLIGHT_BEFORE=49` and matches; **48 and 50 are refused.** **`resolve-candidate`:** an empty request and the full `74d19281` resolve to it; **`14ce1907`, `2f57bbca`, `87a86531` and `18ba6de2` are refused**. The control, `main`'s pin, resolves to `14ce1907`. The expected result is **49 → 49, `CREATED_THIS_DEPLOY=none`**. |
| **5** | **Rollback** | **PASS.** `_rollbackNote` names **`14ce1907`** (run 51, `main` `32563aa0`). `candidateAddedFunctions` keeps the three social names, and the functions tree is unchanged, so a re-pin of `14ce1907` stays compatible. |
| **6** | **Tests** | **PASS.** `run-all` exits 0 ("all suites passed"). `.github/wsf-staging/tests` and `scripts/` are byte-identical to `main`. |

**Not checked, carried from #508's own list:**
- the social transports are SHUT;
- the `wsfContributions` index has no READY receipt;
- email is blocked;
- the kiosk hold stands.

W7 did not re-read run 51's job log.

**Status:** **PASS on the pin at `fbcfc80c`.** W7 dispatched nothing. Nothing is accepted, integrated or staged by W7.

## 54 · COMMUNITY-SETTINGS-PARITY-1 pass 2, exact product `ffb517e5` (evidence `ecd99bf2`) against control `0e5d6f38` (Director route #434 `5846188045`; W7 ACK `5846189645`): **PASS on every changed dependency**

- **Lineage, by git:** `0e5d6f38` → `6f34ff7b` (W9's spec: the scrim press inside the 12 px margin) → `ebcc038a` (evidence) → **`ffb517e5`** → `ecd99bf2`. The evidence commit is docs only.
  - **Product delta:** `settings.tsx`; `MemberTopBar`, `MemberTabBar` and `memberShellMetrics`; `currentCommunity.ts` (`currentFirst`); `CommunityPrivacyControls`; the Community tab adapter; `communityParityTypes.ts` (`roleFact`); and 2 W9 specs plus 2 unit tests.
  - **The protected-path diff over `0e5d6f38` is empty.**
- **Builds:** detached worktrees, each with an emulator-flagged build. Each bundle carries only its own SHA stamp.

| # | Item | `0e5d6f38` | **`ffb517e5`** |
|---|---|---|---|
| **1** | **Shared top bar and tabs.** New spec `sprint-w7-csp-pass2.spec.ts` M1, plus H1, H2 and `ui-app-shell`. | The top-bar body is 52 on Home / Community / Progress / You. H1 7 / 7, H2 16 / 16, `ui-app-shell` 3 / 3. | **62 on all four tabs.** **Reselecting the active tab is a no-op:** the same mounted root, the same path and `history.length`, and the same single callable as the control. **H1 7 / 7; H2 16 / 16** (Home 7 per visit, slope 0.018); **`ui-app-shell` 3 / 3** (R1 no horizontal overflow). |
| **2** | **Settings × Close and the panel** (M1, H5, Check 45 B1) | Close 64×46; H5 7 / 7 | **The accessible name is exactly "Close"** (drawn as "× CLOSE" through the text transform), **83×44**. **H5 7 / 7 ×3:** focus enters on Close; Close, Escape and the scrim each return to the Settings row; scroll kept; median exit 202 ms; reduced motion; no growth. Check 45 S-F1–S-F6 pass. |
| **3** | **`currentFirst`** (M3): C1 then C2 in the server's answer; C2 remembered | The chips and the Settings sections follow the server order: C1 first | **C2 leads the chips and the Settings sections.** **Every `wsfMyCommunities` answer stays C1, C2** (4 / 4). The unit tests are 14 / 14 (`currentCommunity`, role fact). |
| **4** | **`roleFact`** (M4): a founding Champion | The Community fact reads "Founding Champion" | **The Community fact reads "Champion".** **You still reads "Founding Champion"**: the global `roleLabel` / `roleCardLabel` is unchanged (`labels.ts` is untouched). |
| **5** | **The cache-only privacy hint** (M5) | Opening Settings requests `wsfMyCommunities` only; the hint is generic | **Opening Settings requests `wsfMyCommunities` only, the same as the control:** no added callable or Firestore read. Warm, after You read the profile: "Members see "Mara Pass …"". **Cold `/settings/privacy`: the generic "Members see your name"**, with no name invented. |
| **6** | **Carry** | Check 45 PRESERVE 13 / 13, FAIL-BEFORE 15 / 15 passing | **Check 45 identical** (15 / 15 and 13 / 13). **Check 43 7 / 7.** |

- **For L0's pin check (precision, not a defect):** the #506 lineage adds **`scripts/westayfit/render-banner-ring.mjs`**. It came in at `0e5d6f38`, before this pass. It is an offline, deterministic generator for the ring asset, and no build or runtime path uses it. Its `--check` confirms that the committed `banner-ring{,@2x,@3x}.png` bytes match. A future pin's protected-path set over `scripts/westayfit/` will therefore not be empty.
- **Gates:** `ts:check` 0; `check-evidence-intact` 0 (9 + 20). No artifacts committed. Emulators only (`demo-wsf-local`).

**Status:** **PASS on `ffb517e5` for the routed changed dependencies.** Visual acceptance is the Director's. Nothing is accepted, integrated or staged.

## 55 · Staging pin #511 at exact `a3f2e3c6db5341f78d8967321aa955b841ecec91`, candidate `938e00d8`, rollback `74d19281` (handoff #434 `5846630709`; W7 ACK `5846631840`): **PASS**

This is the Check 53 method, run locally by git and with the real staging scripts on the pin tree. No product suite.

| # | Item | Result |
|---|---|---|
| **1** | **Lineage** | **PASS.** The remote `refs/pull/511/head` is exactly `a3f2e3c6`, with one parent, operational `main` **`bc53a787`** (still `main`), and **one file**, `approved-candidate.json` (+8 / −5). |
| **2** | **Fields** | **PASS.** `approvedAppSha` goes `74d19281` → **`938e00d8c985993f69becc8924d3037f18425afc`**. `expectedPriorFunctions` stays **49**; its note cites run 52 (`36238227254`, 49 → 49). **`_rollbackNote` names `74d19281`** (run 52, `main` `bc53a787`). Three `_previous…74d19281` history keys are added. |
| **3** | **Social names** | **PASS.** `candidateAddedFunctions` is `wsfsetcommunityvisibility`, `wsfcommunitymembers` and `wsfcommunityactivity`, identical to `main`. |
| **4** | **The candidate boundary `74d19281..938e00d8`** | **PASS.** There is one first-parent merge. `938e00d8` = `74d19281` + **`ffb517e5`**, the product Check 54 passed, and **its tree equals `git merge-tree` of the parents**. 140 files, +5838 / −586. **The only protected-set path is `A scripts/westayfit/render-banner-ring.mjs`.** |
| **5** | **The script is off the build and runtime path** | **PASS.** Outside the script itself, the only reference is a code **comment** in `CommunityParityView.tsx:619`. No `package.json` script, `build:web` step or `.github` workflow calls it. **The app `require`s the committed `assets/brand/derived/banner-ring.png`** (`CommunityParityView.tsx:559`). **A fresh `build:web` of `938e00d8`** (stamped `938e00d8`) emits `banner-ring.<hash>{,@2x,@3x}.png` **byte-identical (SHA-256) to the committed PNGs**: 1× `7ab71c24…`, 2× `926ffaa6…`, 3× `0a969f4f…`. **No output file contains "render-banner-ring".** The script's `--check` confirms that the committed bytes are its deterministic output. |
| **6** | **Everything else in the protected boundary** | **PASS.** `functions-westayfit` is tree **`5a3f232e` at both SHAs**. The rules, indexes, hosting and emulator configs, `.firebaserc`, root and app packages, `app.json`, `.github/` and `functions/` are unchanged. |
| **7** | **Scripts** | **PASS.** `run-all` exits 0. **`resolve-candidate`:** an empty request and `938e00d8` resolve to it; **`74d19281`, `ffb517e5` and `0e5d6f38` are refused**; the control, `main`'s pin, resolves to `74d19281`. **`read-inventory`:** 46 + 3 = 49; 49 matches; **48 and 50 are refused.** The tests and `scripts/` in the pin tree are identical to `main`. |
| **8** | **Expected deploy** | **49 → 49, `CREATED_THIS_DEPLOY=none`.** The functions tree and allowlist are unchanged. |

**Status:** **PASS on the pin at `a3f2e3c6`.** W7 dispatched nothing. Nothing is accepted, integrated or staged by W7.

## 56 · MEMBER-SNAPSHOT-INDEX-1 source / compatibility check, #509 at exact `1f99d67ff71bf342f09c436195773ff57fdc751d` on base `74d19281` (handoff #434 `5846672401`; W7 ACK `5846673584`): **PASS**

Source only. Nothing was deployed, and no cloud readiness was checked; it cannot be proven here.

| # | Item | Result |
|---|---|---|
| **1** | **Valid JSON** | **PASS.** Both SHAs parse. The keys are `indexes` and `fieldOverrides`. |
| **2** | **The semantic delta** | **PASS.** Exactly **one** composite added (49 → 50) and none removed. **`fieldOverrides` are identical** (2 entries). The text diff is **+8 / −0**: one appended object, no reformatting. |
| **3** | **The composite** | **PASS.** Exactly `{"collectionGroup":"wsfGoalMemberTotals","queryScope":"COLLECTION","fields":[{userId ASCENDING},{updatedAt DESCENDING}]}`. |
| **4** | **Order preserved** | **PASS.** The first 49 entries at `1f99d67f` equal the base's 49, in order. The new entry is appended last, after `wsfContributions (communityGroupId ASC, createdAt DESC)`. |
| **5** | **No duplicate** | **PASS.** 0 duplicate entries. The base had **no** `wsfGoalMemberTotals` composite or override. |
| **6** | **The query shape** `where userId == uid · orderBy updatedAt desc · limit N+1 · cursor(updatedAt, docId)` | **PASS by definition.** Equality on the leading field, then the single ordered field in the index's own direction (DESC); Firestore appends the implicit `__name__` tiebreak in the direction of the last `orderBy`, so the `(updatedAt, docId)` cursor needs no further field. **Emulator run of the exact shape (cursor semantics only; the emulator does not enforce indexes, so it proves nothing about serving):** 5 of one user's docs plus 1 of another's, N = 2, reading N + 1 per page. The pages come back as [g3@09, g2@09], [g5@07, g1@05], [g4@01]: the equal-`updatedAt` tie is broken by document id DESC, with **no duplicate or skip across pages**; the N + 1 read detects the last page; the other user is excluded. |
| **7** | **Nothing else changed** | **PASS.** The diff over `74d19281` touches exactly two files: `firestore.indexes.json` (M) and `docs/…/member-snapshot-index-1/RECEIPT.md` (A). App, functions, rules, packages, hosting configs, `.github/` and `scripts/` show 0 changes. No IAM or credential material. |
| **8** | **The receipt's claims** | **PASS.** It states "**Source only. The index is NOT deployed.**" It says the emulator **cannot** prove serving ("an unindexed query passes every local test"), that READY is established **only** by a later single-index staging operator's receipt, that "submitted is not READY", and that the snapshot callable must not stage before READY. **It makes no emulator-READY claim.** Its "48 GoArrive indexes" is consistent: 49 base entries, one of which is `wsf`. |
| **9** | **The catalog-deploy / pruning guard** | **PASS.** The receipt states "**Never** `firebase deploy --only firestore:indexes`" and that the whole-catalog deploy prunes what the file does not list. The cited `docs/wsf-staging/social-inventory/SINGLE-INDEX-OPERATOR-PROCEDURE.md` **exists on `main`** and carries the same "Never that command here" guard, the pruning explanation and the READY-versus-submitted rule. **No workflow on `main` or at `1f99d67f` mentions indexes or `--only firestore:indexes`.** |

**Carried forward, as the receipt itself says:** the first staging pin that carries this commit will show a **non-empty protected delta** (`firestore.indexes.json`, this one entry). That is expected, not a defect. The pin check must not treat it as a surprise, and the READY receipt stays a separate operator step.

**Status:** **PASS on `1f99d67f` (source).** W7 deployed nothing. Nothing is accepted, integrated or staged.

## 57 · CONTROL-PLANE-CI-1 successor #513 at exact `cf13140b701dce647a3e41064cdb6d27702c5fba` (prior held `6be81239`; handoff #434 `5846941889`; W7 ACK `5846943156`): **PASS on rows 1–9, with three findings (one for the Director's decision)**

Operational QA only. It was run from detached worktrees of `cf13140b` and `6be81239`, locally, with synthetic input. Nothing was dispatched or merged, staging was not touched, and no product suite was run.

| # | Row | Result |
|---|---|---|
| **1** | **Scope** | **PASS.** `cf13140b` = `6be81239` → merge of `main` `7ab19e8f` (the #511 pin) → the successor commit. Over `main`, **25 files, all under `.github/`**: 0 app, backend, rules, index, auth or package files. |
| **2** | **C1: only reviewed data avoids release-environment ineligibility** | **PASS.** `RELEASE_ENVIRONMENT_PATHS` stays `.github/workflows/wsf-staging-deploy.yml`, `.github/wsf-staging/` and `firebase.westayfit.staging.json`. `diffNames` excludes **exactly two literal pathspecs**, `approved-candidate.json` and `journeys/manifest.json`, so the workflow, generator, runner, registry, fixture kit and drivers stay inside. **Fail-before reproduced:** the successor's `pin-candidate` test run against `6be81239`'s code fails with `the release environment changed since run 7: .github/wsf-staging/journeys/manifest.json`. W3's M13 (the whole directory excluded) covers the widening mutant. |
| **3** | **C3: a present manifest is refused pre-deploy; absence is never a PASS** | **PASS.** The check runs in the `gate` job (`permissions: contents: read`), right after candidate resolution, deploy mode only, with no `continue-on-error`. The gate and hosted-verify read the same operational commit (`github.sha`). **Run directly:** absent → `MILESTONE_MANIFEST=absent`, "no member-visible milestone is declared" (exit 0; not a pass); the example for `938e00d8` → `valid`; a manifest for `ffb517e5` → **refused** ("the manifest is for ffb517e5…"); an undriven journey → **refused**. **My mutants:** the gate step removed, and the gate made `continue-on-error` — **both caught** by `workflow-contract`. |
| **4** | **C2: the drivers make real actions and assertions against `938e00d8`'s contract** | **PASS.** `community` signs in; asserts the banner, Members, Your role (**Champion** for the founding Champion), This period's own goal and the `aria-pressed` chip; presses the other chip and re-asserts; reloads and asserts the selection held. `settings` selects the led community, opens You then Settings, and asserts the panel, **the selected community first**, each switch's `aria-checked` against the seeded stored value, "Anonymous member", the CHAMPION badge, then presses **× Close** and asserts it is dismissed and You is back. These are not selector-existence probes. **Fail-first:** with the registry emptied, the suite fails (`drivers[name] is not a function`). **My mutants:** Settings' order assertion forced true is **caught**; Community's reload-persistence assertion forced true **SURVIVES** (finding 2). |
| **5** | **Synthetic fixture safety** | **PASS, with a precision note** (finding 3). The run tag is `e5c-`, registered in `run-tag.mjs`. The kit's emails `wsf-<runTag>-<label>-…@example.com` match the cleaner's `wsf-<runTag>-…@example.com` pattern. **Documents are tracked before every write** (`putDoc` persists first; my write-before-track mutant is **caught**). The step has its own cleanup manifest (0600 in a 0700 dir). The password is held in memory only: it is not in the manifest, the results or any log line, and request errors do not echo bodies. The cleanup step (`if: always()`) runs the real cleaner, and W3's test drives the real cleaner to COMPLETE. |
| **6** | **Credential boundary** | **PASS.** With no manifest, the step runs the hook **before** sourcing `wsf-staging.env` or minting any token. My mutant moving `.env` and the token above the exit is caught ("wsf-staging.env must come after the no-manifest exit"). **No permissions, WIF, service-account or IAM line changes.** The job still installs with `npm … ci --ignore-scripts` and `npm install --no-save --ignore-scripts`, and the new steps run `node` only. The token uses the same shape and service account as the Package E step (W3's flag 1). |
| **7** | **Truth on cleanup** | **Answered explicitly: YES, a driver and card can say PASSED while the changed-journey cleanup failed.** The hook writes `changed-journeys.json` and `owner-test-card.md` **before** "Remove changed-journey fixtures" runs, and nothing rewrites them afterwards. That cleanup step is `continue-on-error` (a warning only), **unlike the existing Package E "Remove synthetic fixtures" step, which is blocking.** The owner-card contract (`docs/westayfit/ops/OWNER_TEST_CARD_AND_SMOKE_CONTRACT.md`) has no explicit cleanup clause. Its rules "do not state a hosted/device pass that was not run" and "do not convert unknown into success" are not literally broken, because the journey itself did pass. But the card's required header (served SHA, rollback SHA, changed-journey status) **carries no cleanup state**, so a PASSED card can sit beside residual `e5c-` accounts and documents on staging (finding 1, the Director's decision). |
| **8** | **No live manifest; no run-53 claim; `fastPath.applies` false** | **PASS.** `journeys/` holds only the drivers, helpers, registry, kit and `examples/`, with **no `manifest.json`**. `applies: false` is hard-coded (`pin-candidate.mjs:299`). No run-53 claim appears anywhere in `.github`. (`approved-candidate.json` is `main`'s #511 pin, brought in by the merge.) |
| **9** | **Focused fail-before / pass-after and mutants** | **PASS.** `run-all`: **21 suites, exit 0** at `cf13140b`; 19 suites, exit 0 at `6be81239`. C1, C2 and C3 fail-first are reproduced as above (C2 and C3 also fail on the old head's code for lack of their modules, a trivially true fail-before). **My 7 mutants:** 6 caught and **1 survived** (finding 2). |

### Findings (at most three)

1. **(Director decision) A PASSED changed-journey card can coexist with a failed changed-journey cleanup.** The card and results are rendered before cleanup and never reconciled, and the cleanup step is non-blocking, while the Package E cleanup is blocking. Smallest options, all within W3's scope:
   - (a) print `CHANGED_JOURNEY_CLEANUP=<COMPLETE|INCOMPLETE>` into the card header, or re-render the card after cleanup;
   - (b) make the changed-journey cleanup blocking, like Package E's;
   - (c) accept the current behaviour and record in the contract that the card excludes cleanup.

   This does not affect the release gate today, because the step is report-only.
2. **A surviving mutant in the C2 proof.** In `journeys/community.mjs`, replacing `returned === other.name` (the "after a reload the selection held" assertion) with `true` leaves `changed-journey-drivers` at exit 0. The scripted page model has no seeded defect for reload persistence. **The driver's own check is correct; its proof is incomplete for that one assertion.** A seventh seeded defect (selection lost on reload) would close it.
3. **(Precision) Accounts are not tracked before they are created.** `createVerifiedUser` records the uid after `accounts:signUp` returns. This is unavoidable by uid and matches the existing `hosted-player-journey.mjs` (`trackUser` after signUp). But the kit's header comment and `CONTROL-PLANE.md` say **"every account and document… BEFORE"**. The window is a created account whose response is lost. The cleaner's recovery text names the `e5grp-` / `e5goal-` prefixes, not this kit's `e5cgrp-` / `e5cgoal-`, although its email pattern (`wsf-<runTag>-…`) does cover these accounts. Correct the wording, or also persist the email before the call.

**Not proven here (W3's own limit):** a hosted run. This environment does not reach staging, and CONTROL-PLANE-ACTIVATION-1 is the separate proof.

- **Gates:** `ts:check` 0; `check-evidence-intact` 0 (9 + 20). No artifacts committed.

**Status:** PASS on rows 1–9 at `cf13140b`, with findings 1–3 for the Director. Nothing is dispatched, merged, accepted or staged by W7.

## 58 · CONTROL-PLANE-CI-1 closure delta (C4–C6), #513 at exact `abbab755d1217699154eb0a2819dc74f0b268718` against Check 57's `cf13140b` (handoff #434 `5847279036`; W7 ACK `5847280559`): **FAIL on one exact C4 case; C5, C6 and the boundary PASS**

- **The delta:** one commit on `cf13140b`, touching 10 files, all under `.github/`.
- **Run:** locally with synthetic input. Nothing was merged, activated or deployed, and no live manifest was created.

| # | Item | Result |
|---|---|---|
| **C4** | **Cleanup truth** | **The order is right, and the blocking is right.** The runner writes only `changed-journeys.json`; it **no longer renders the card**. "Remove changed-journey fixtures" is **no longer `continue-on-error`**, and `set -euo pipefail` plus a bare `node …cleanup-synthetic.mjs` make the cleaner's exit status the step's, so a failed cleanup fails `hosted-verify`. The new "Render the changed-journey owner card" runs after it and reads the cleanup manifest and receipt. **Card behaviour run directly, with both journeys PASSED:** COMPLETE receipt → **PASSED**; INCOMPLETE → **INCOMPLETE** ("every journey passed, but fixture cleanup is not complete"); MANIFEST_UNUSABLE → INCOMPLETE; an unusable receipt with the manifest present → NOT_RUN / INCOMPLETE; a missing receipt with the manifest present → NOT_RUN / INCOMPLETE. **FAIL: a missing receipt with no manifest → `NOT_NEEDED` → PASSED, and an unusable (non-JSON) receipt with no manifest → `NOT_NEEDED` → PASSED**, although the results prove the drivers ran and so fixtures were created. **This is reachable from a real cleanup failure:** `cleanup-synthetic.mjs` runs `fs.rmSync(MANIFEST)` (line 363) **before** `finish('COMPLETE')` writes the receipt (line 101). A receipt write that fails there, for example on a full disk, leaves neither file. The step then fails and `hosted-verify` goes red, yet the card still renders PASSED. My C4 mutants are all caught: the cleanup made `continue-on-error`, the cleaner's exit swallowed with `|| true`, and INCOMPLETE marked ok. |
| **C5** | **Reload persistence** | **PASS.** The seeded `reloadLosesSelection` defect makes the real Community driver fail **on** "on return, the selected community is still Summit Journey Club". **My Check 57 bypass mutant (`returned === other.name` → `true`) is now caught.** |
| **C6** | **Precision and recovery** | **PASS.** The kit and `CONTROL-PLANE.md` now say: documents are tracked **before** write; an account **immediately after** `signUp` returns its uid and **before any dependent document**; and the one window is named, with recovery by the `wsf-<runTag>-…@example.com` email. The cleaner's recovery text now names `e5grp-`, `e5jgrp-` and **`e5cgrp-`**, `e5goal-`, `e5jgoal-` and **`e5cgoal-`**, and the generic rule (the run tag in every document id). |
| **Boundary / regression** | | **PASS.** `.github/` only. **The Package E "Remove synthetic fixtures" step is byte-identical** (md5 of the step block equal at both SHAs). `pin-candidate.mjs`, `check-milestone-manifest.mjs`, `milestone-manifest.mjs`, the registry and both drivers are **unchanged** from `cf13140b`. There is no `journeys/manifest.json`, and `applies: false`. `run-all`: **22 suites, exit 0.** My Check 57 regression mutants are still caught: the empty registry, Settings' order check bypassed, and the C3 gate made non-blocking. |

**The one finding (material, C4):** `cleanupStatus` treats "no receipt and no manifest", and "an unusable receipt and no manifest", as `NOT_NEEDED` (ok), without asking whether fixtures were created. Smallest corrections, both within W3's scope:
- **(a)** in `cleanup-synthetic.mjs`, write the COMPLETE receipt **before** removing the manifest;
- **(b)** in `owner-test-card.mjs`:
  - never map an unusable receipt to `NOT_NEEDED`;
  - treat "the results show a driver ran" as proof that fixtures were created, so a missing receipt is `NOT_RUN`;
  - add those two cases to `owner-test-card.test.mjs`.

- **Gates:** `ts:check` 0; `check-evidence-intact` 0 (9 + 20). No artifacts committed.

**Status:** **FAIL at `abbab755` on that C4 case.** C5, C6 and the boundary are closed, and Check 57's C1–C3 PASS is preserved. W7 merged, activated and deployed nothing.

## 59 · CONTROL-PLANE-CI-1 C4a only, #513 at exact `a1f5e7a4bddaf6a749e1bceb088e81f3ba0347a3` against `abbab755` (handoff #434 `5847431269`; W7 ACK `5847432456`): **PASS**

- **Delta:** one commit on `abbab755`, touching four files, all under `.github/wsf-staging/`: `cleanup-synthetic.mjs`, `owner-test-card.mjs` and two test files.
- **Run:** locally, with synthetic receipts and results. No activation, cloud action or merge.

| # | Item | Result |
|---|---|---|
| **1** | **Receipt before manifest deletion** | **PASS.** `finish(status, extra, exitCode, afterReceipt)` writes the receipt, and only then runs `afterReceipt`. The COMPLETE path passes `() => fs.rmSync(MANIFEST)` as `afterReceipt`, so a receipt write that throws leaves the manifest in place. **My mutant restoring delete-then-receipt is caught** by `changed-journey-drivers` ("with no receipt, the manifest must survive as the record that fixtures existed"). |
| **2** | **When the drivers ran, a missing or unusable receipt never gives `NOT_NEEDED` or PASSED** | **PASS.** An existing but unreadable receipt → `UNKNOWN`; a receipt with an unknown status → `UNKNOWN`. With no receipt, a manifest present **or** `driversRanIn(results)` (any result that is not `blocked`) → `NOT_RUN`. `driversRan` must be a boolean, or `cleanupStatus` throws. |
| **3** | **No receipt plus driver results** | **PASS:** `NOT_RUN`, so the card is INCOMPLETE. |
| **4** | **A valid COMPLETE receipt** | **PASS:** `COMPLETE`, so the card is PASSED. |
| **5** | **Check 58's exact fail-before cases** (both journeys passed, no manifest) | **On `abbab755`:** a missing receipt → `NOT_NEEDED` → **PASSED**, and an unusable receipt → `NOT_NEEDED` → **PASSED** (the failure). **On `a1f5e7a4`:** a missing receipt → **`NOT_RUN` → INCOMPLETE**, and an unusable receipt → **`UNKNOWN` → INCOMPLETE**. **Carried unchanged on both:** COMPLETE → PASSED; INCOMPLETE → INCOMPLETE; manifest present → `NOT_RUN`; unknown status → `UNKNOWN`; all journeys blocked with no files → `NOT_NEEDED`, with the card INCOMPLETE because nothing ran. |
| **6** | **Nothing else reopened** | **PASS.** The delta touches no workflow, generator, gate, registry, driver or manifest file. `run-all`: **22 suites, exit 0.** |

- **Gates:** `ts:check` 0; `check-evidence-intact` 0 (9 + 20). No artifacts committed.

**Status:** **PASS at `a1f5e7a4`.** Check 58's C4 failure is closed. C1–C3 (Check 57) and C5, C6 and the boundary (Check 58) carry. W7 merged, activated and deployed nothing.

## 60 · HOME-NORTHSTAR-PARITY-1, #514 at exact `6ba49f100dd828c6ab6b007fe6a47087de397111` on base `6deefe7d`, evidence `5e8a22ae` (handoff #434 `5847519588`; W7 ACK `5847521409`): **PASS**

- **Scope:** changed dependencies only. The broad accepted lanes were not re-run.
- **Environment:** Chromium on the emulators (`demo-wsf-local`). Both builds were built locally with auth and emulators on: base on :5039, product on :5040.
- **New spec:** `sprint-w7-home-northstar.spec.ts`. It is W7's own, independent of W9's spec, and every row was run on both the base and the product.
- **No evidence gate was set.**

| # | Item | Result |
|---|---|---|
| **1** | **Scope / lineage** | **PASS.** `6deefe7d..6ba49f10` touches exactly two files: the Home route `app/(tabs)/(home)/community/[groupId]/index.tsx` and the new `sprint-w9-home-northstar-parity-1.spec.ts`. No shell, memberReads, functions, rules, indexes, Community, Progress, You or `LivingWeProgress` file changes. The evidence commit `5e8a22ae` has parent `6ba49f10`, and every file it touches is under `docs/design-target/review/home-northstar-parity-1/`. |
| **2** | **W9's focused spec**, exact, producer skipped (no capture gate) | **PASS:** 6 / 6 truth rows on `6ba49f10`. On the base, 4 pass and 2 fail: the "default" hierarchy and the "reached and still open" kicker. That is the expected fail-before. |
| **3** | **Truth rows**, run independently by W7 on product and base | **PASS on `6ba49f10`, all eight** (T1–T7 below, with T4 and T5 counted separately). |
| **4** | **Navigation / motion carry** | **PASS.** See T8, H1 and H2 below. |
| **5** | **Layout guard** | **PASS.** See L1–L4 below. |
| **6** | **Existing Home-dependent specs**: W9's exact 18 files (the list in `RAW-home-dependents-6ba49f10.txt`), run by W7 on `6ba49f10` | **119 / 119 passed** (8.1 min). The product diff changes no existing spec, so no assertion was weakened. |
| **7** | **Evidence provenance** | **PASS**, with one point outside my reach; see the evidence bullets below. |

**Row 3, the truth rows** (all PASS on `6ba49f10`):
- **T1, default:**
  - the hero reads "241 of 500 squats", the confirmed figure;
  - "You've added 25 squats" is a separate line, distinct from the shared total.
- **T2, unknown.** A context route answered all 2 `wsfGoalPulse` reads 500 from the start. The result:
  - no figure;
  - no hero moved-today row;
  - "Progress couldn't be loaded".
- **T3, last known.** A warm return whose 2 pulse reads were answered 500:
  - the "LAST KNOWN" pill shows, and 241 is kept;
  - "Couldn't refresh. This is the last confirmed figure." shows;
  - that sentence appears twice in `innerText` by design: an `aria-live` region plus an `aria-hidden` visible copy. Same on base.
- **T4, reached and open:** 512 / 500 reads "GOAL REACHED … 12 beyond our goal · still open".
- **T5, closed goal only:**
  - no hero, and no Start / Already moved actions;
  - the closed goal appears only under HISTORY.
- **T6, warm Home → Community → Home:** 155 frames watched on Home, with 0 frames missing the hero, 0 loading frames and 1 hero node throughout.
- **T7, Home reselect:**
  - same URL, `history.length` unchanged (3), same hero DOM node;
  - the page does not remount. The `wsfGoalPulse` and `wsfMyContribution` requests seen in that window are identical on base, so they are not caused by this packet.

**Row 4, navigation and motion carry:**
- **T8, action destinations:**
  - "Start moving" goes to `/contribute/<goal>?groupId=…&mode=move`, and "Already moved" goes to `…&mode=record`;
  - both are identical to the base;
  - Back returns to the same Home URL with the hero present.
- **The action handlers themselves:** the diff changes no `href`, `onPress` or router line.
- **H1 (10 warm switch cycles): PASS** on `6ba49f10`, with no loading frame and one instance per route.
- **H2 (MOVE lifecycle from Home, Progress and You): PASS** on `6ba49f10`, with Close returning to the opener 10 / 10.
- **Base-only note, not a finding on this PR:** on base `6deefe7d`, H2e failed once. The first Home visit made 9 requests where the mode is 7. On a re-run it passed (7). The product passed.
- **Shell:** the shell tab fade, focus and scroll files are not in the diff.

**Row 5, layout guard:**
- **L1:** at 390 and at 360, `scrollWidth` equals `clientWidth`, and 0 elements extend past the viewport.
- **L2:** the pair is side by side, both 54 px tall; primary 189 px wide, secondary 153 px.
- **L3:** exactly one h1.
- **L4, 390×640:** a laid-out short height, not a crop:
  - the hero top moves from 209 to 197 and its height from 279 to 245;
  - Start's bottom is at 488, above the tab bar at 565.

**Row 7, evidence provenance:**
- `MANIFEST.sha256`: 29 / 29 hashes verify, and the set equals the directory.
- Every frame is at full viewport: 390×640 or 390×844 for frames, overlays and differences. Side-by-sides are 792 wide (two frames, 12 px apart, plus a label strip).
- The candidate and base frames are labelled "FIXTURE SAMPLE DATA · NOT ACCEPTED".
- **The one point outside my reach:** the reference PNGs' SHA-256 match the hashes W9's README records, but the packet's own hashes live in the external Lovable project, which W7 does not read. The reference-to-packet match is W9's statement, not W7's measurement.

**Not adjudicated:** the intentional North-Star differences are the Director's to decide. They are the prototype strip, the join / window copy, the pinned cross-lane copy, platform fonts and icons, and the 62 px shell.

**Instrument corrections, disclosed.** My first run of the new spec had three instrument errors, the same on both builds, each fixed before the run reported above:
- **L2:** the tiles were located by label, which waited out the test timeout. They are now located by testID prefix.
- **T2:** the moved-today check was scoped to the whole page. The header's "0 people moved today" comes from the momentum read, not the pulse. It is now scoped to the pulse-gated hero row `wsf-community-hero-moved-today`.
- **T5:** the "120 of 500" check matched the closed goal under HISTORY. It now checks only the text above HISTORY.

- **Gates:** `ts:check` 0; `check-evidence-intact` 0. Artifacts were cleaned in both trees, and none is committed.

**Status:** **PASS at `6ba49f10`.** No changed-dependency finding. Next consumer: Director product acceptance → L0 integration. W7 merged, accepted and deployed nothing.

## 61 · CONTROL-PLANE-ACTIVATION-1 source / security check, #516 at exact `a78b321b0765c1c6e7e831e08b2bbbb7ebb0200e` on base `d82d55fd`, prior held `92fb0f53` (handoff #434 `5847651391`; queue order `5847681355`; W7 ACK `5847746513`): **PASS on rows 1–10, one material finding (F1, test-only)**

- **Method:** local and static only, in detached worktrees of `a78b321b` and `92fb0f53`.
- **Not done:** no dispatch, merge, activation, cloud action or product suite.
- **How the job graph was read:** parsed from the workflow YAML, not from the packet's text.

| # | Item | Result |
|---|---|---|
| **1** | **Scope** | **PASS.** `d82d55fd..a78b321b` is two commits touching 12 files, all under `.github/`: the workflow, `CONTROL-PLANE.md`, `check-milestone-manifest.mjs`, the new `check-served-marker.mjs` and `require-activation.mjs`, and tests. `approved-candidate.json` and the drivers are unchanged, and nothing outside `.github/` changed. |
| **2** | **Initial-marker credential boundary** | **PASS.** See the gate bullets below. |
| **3** | **Drift check** | **PASS.** See the drift bullets below. |
| **4** | **No-deploy path** | **PASS.** In this mode, `build`, `deploy` and `hosted-verify` are gated on `inputs.mode == 'deploy'`. `deploy` is the only job holding `firebase deploy` or `hosting:channel:deploy`. No rules, index or production path appears in the workflow, and the project is `westayfit-staging`. |
| **5** | **Activation manifest** | **PASS.** See the manifest bullets below. |
| **6** | **Journey truth** | **PASS.** See the verdict bullets below. |
| **7** | **Fixtures and recovery** | **PASS.** Fixtures are `e5c…-<runTag>` only, through the unchanged fixture kit. Cleanup is blocking. On failure the manifest is kept in the evidence (the CLEANUP FAILURE test: receipt `INCOMPLETE`, manifest present, scan success so it is uploaded). The drivers press only community chips, Settings and × Close; there is no switch press, no callable and no roster assertion. |
| **8** | **Verdict and evidence** | **PASS.** `require-activation.mjs` re-reads the manifest, results and receipt, and recomputes the card through `owner-test-card.mjs`. The upload is gated `always() && steps.scan-activation-evidence.outcome == 'success'`. |
| **9** | **Policy carry** | **PASS.** `approved-candidate.json` and `pin-candidate.mjs` (`applies: false`) are unchanged from base, so the human pin gate is unchanged. There is no `journeys/manifest.json`. |
| **10** | **Fail-before / pass-after, and mutants** | **PASS.** See the last two sets of bullets below. |

**Row 2, the gate boundary.** The only `workflow_dispatch` jobs reachable in `journey-activation` are `gate`, `config` and `journey-activation`.
- **`gate`:** `contents: read`, no token.
- **`config`** and **`journey-activation`:** each has `id-token: write`. Their `if` expressions carry no status function, so the implicit `success()` over `needs` applies. `config` needs `gate`; `journey-activation` needs `[gate, config]`.
- **The one `always()` job:** `hosted-verify`, but it also requires `inputs.mode == 'deploy'`.
- **No escape route:** no job uses `failure()` or `cancelled()`, and no step in `gate` is `continue-on-error`.
- **The new gate step** runs `check-served-marker.mjs`, which exits 1 on a mismatch, an unreachable page or a refusal. So a wrong or unreachable marker fails `gate`, and no token-capable job can start.

**Row 3, the drift check.** In `journey-activation`, the step order is:
1. checkout;
2. setup;
3. **the marker (`id: marker`)**;
4. `npm ci --ignore-scripts` and the browser install;
5. the config download;
6. **the first auth**;
7. the seed / run step.

On a failure after the marker:
- implicit `success()` skips auth and the run;
- re-auth runs only if `steps.marker.outcome == 'success'`;
- cleanup with no manifest exits 0 without a token;
- the verdict fails on the marker (the DRIFT test: 0 fixtures, `ACTIVATION=FAILED`).

**Row 5, the manifest.** The gate runs `check-milestone-manifest.mjs --require journeys/examples/community-settings-parity-1.json`, a non-live path. The manifest's `productSha` is `938e00d8…`, equal to the pin's `approvedAppSha`, and its journeys are exactly `community` and `settings`. Measured by W7:

| Case | Output | Exit |
|---|---|---|
| valid | `valid` | 0 |
| missing, with `--require` | `refused` | 1 |
| missing, without `--require` (deploy mode) | `absent` | 0 |
| approved SHA ≠ `productSha` | `refused` | 1 |
| an added `roster` journey with no driver | `refused: no registered driver` | 1 |
| an unknown flag | usage | 1 |

**Row 6, the verdict.** `ACTIVATION=PASSED` needs all of:
- `marker == success`;
- the manifest journeys exactly `community,settings`;
- results present;
- cleanup `COMPLETE` or `NO_FIXTURES` by the receipt (with `driversRan` from the results);
- the cleanup step a success;
- the scan a success;
- the card `PASSED`;
- every result `passed`.

The packet's tests cover driver failure, blocked / no driver, a wrong marker, drift, cleanup failure, a missing receipt (`NOT_RUN`), an unusable receipt (`UNKNOWN`), a failed scan and the wrong journey set. In each, `ACTIVATION=FAILED` and the card is not PASSED.

**Row 10, A1 fail-before / pass-after:**
- `a78b321b`'s `workflow-contract.test.mjs` run against `92fb0f53`'s workflow fails with "the gate reads the marker right after the activation manifest check".
- It passes on `a78b321b`.
- At `92fb0f53`, `gate` had no marker step, so `config` authenticated before any marker was read. That is the A1 defect.
- `a78b321b`'s `journey-activation.test.mjs` passes on either tree. Its A1 cases model the gate in the test, so the binding A1 proof is the workflow contract.

**Row 10, twelve mutants on `a78b321b`, all caught:**

| Mutant | Caught by |
|---|---|
| M1 no gate marker | contract |
| M2 `config` `always()` | contract, "config could start after a failed gate" |
| M3 activation `always()` | contract |
| M4 gate marker `continue-on-error` | contract, "a wrong marker must fail the gate" |
| M5 job marker moved after auth | contract, "the marker comes before the first authentication" |
| M6 upload on bare `always()` | contract |
| M7 verdict ignores scan | journey-activation |
| M8 verdict accepts NOT_RUN / UNKNOWN / NOT_NEEDED | journey-activation, "cleanup is NOT_RUN" |
| M9 verdict ignores marker | journey-activation |
| M10 `--require` dropped | contract |
| M11 `build` reachable in this mode | contract |
| M12 verdict ignores card | journey-activation |

- **`run-all` on `a78b321b`:** 23 suites, all pass except as F1 below.
- **On `92fb0f53`:** exit 0 in one run.

**F1 (material, test-only; the verdict logic is correct).** `journey-activation.test.mjs`'s `node()` helper concatenates stdout and stderr as they arrive. `require-activation.mjs` prints its reasons on stderr and `ACTIVATION=…` on stdout. The assertions use `/<reason>[\s\S]*ACTIVATION=FAILED/`, which requires the stderr text to arrive first, and two pipes do not guarantee that order.
- **Measured on unmodified `a78b321b`:**
  - standalone `journey-activation.test.mjs` failed **15 / 30**;
  - `run-all` failed **2 / 10**.
- **Every failure** was a reason-before-`ACTIVATION` regex, with the correct `ACTIVATION=FAILED` and exit 1 present in the output.
- **The same helper and assertions exist at `92fb0f53`.**
- **With the helper changed only locally** (never pushed) to return `stderr + stdout`: 0 / 20 failures, and all verdict mutants caught deterministically.
- **Why it matters:** the packet's own gate suite is nondeterministic. A red `run-all` would read as a verdict regression, and a mutant can hide behind a flake.
- **Smallest fix, in W3's scope:** in `journey-activation.test.mjs`, collect the two streams separately. Either return `err + out`, or assert the reason and `ACTIVATION=FAILED` separately.

**Instrument corrections, disclosed.** My first mutant pass had two errors, the same on every mutant, and both were corrected before the results above:
- it ran outside a full tree, so `workflow-contract` could not open repo-root files;
- M5's block move matched an earlier job's install step.

A flake filter in my runner then hid real catches. The final mutant results come from the full worktree, with the race removed locally.

- **Gates:** `ts:check` 0; `check-evidence-intact` 0. No e2e run, and no artifacts.

**Status:** **PASS at `a78b321b` on rows 1–10, with F1** (test-only, one helper). Next consumer: Director source acceptance → L0 merge → exactly one no-app-redeploy activation run. W7 merged, dispatched, activated and deployed nothing.

## 61D · CONTROL-PLANE-ACTIVATION-1, F1 only, #516 at exact `44da30fcffb0f767a1eabec5a6843bfcffc8d638` against `a78b321b` (handoff #434 `5848030555`; Director `5847935578`; W3 `5848026696`; W7 ACK `5848031584`): **PASS**

| # | Item | Result |
|---|---|---|
| **1** | **Test-only** | **PASS.** One commit, one file: `.github/wsf-staging/tests/journey-activation.test.mjs` (+32 / −17). |
| **2** | **Streams separate; three independent asserts** | **PASS.** `node()` collects `stdout` and `stderr` separately. `out` is now only a labelled message. The new `failedWith(r, reason)` asserts four things independently: exit 1, `^ACTIVATION=FAILED$` on stdout, no `^ACTIVATION=PASSED$` on stdout, and the reason on stderr. The success path also asserts an empty stderr. |
| **3** | **Nothing dropped or weakened** | **PASS.** I compared the old and new assertions one by one, below. |
| **4** | **Standalone determinism** | **PASS: 0 / 50 failures** on the exact head. On `a78b321b` it was 15 / 30. |
| **5** | **`run-all` determinism** | **PASS: 0 / 20 failures**, 23 suites, "all suites passed". On `a78b321b` it was 2 / 10. |
| **6** | **Verdict mutants** | **PASS.** Run on the exact head with no race workaround, 5 runs each: **M7** (scan ignored), **M8** (NOT_RUN / UNKNOWN / NOT_NEEDED accepted), **M9** (marker ignored) and **M12** (card ignored) are each **caught 5 / 5**. |

**Row 3, old against new:**
- **Every `[\s\S]*ACTIVATION=FAILED` regex** (scan, journey set, cleanup not run, card INCOMPLETE, UNKNOWN, drift marker) became `failedWith` with the same reason text. That adds exit 1 and a PASSED-absence check.
- **Each assertion that matched a reason alone** became `failedWith` too:
  - journey failed;
  - blocked with no driver;
  - cleanup INCOMPLETE;
  - NOT_RUN.
- **The secondary reason asserts** (settings blocked, blocking cleanup step) now check stderr.
- **The success path** keeps its stdout regex and adds the empty-stderr check.
- **No other line changed.**

- **Gates:** `ts:check` 0; `check-evidence-intact` 0. No e2e run and no artifacts; mutant edits were reverted in the detached worktree.

**Status:** **PASS at `44da30fc`.** Check 61's F1 is closed. Rows 1–10 and A1 carry from Check 61 and were not reopened. W7 merged, dispatched, activated and deployed nothing.

## 60D · HOME-NORTHSTAR-PARITY-1 visual-closure delta `6ba49f10 → 9d27fdb5bb9303785ae348678200f5f68211fb3b`, evidence `e60e5ec823897521eb3c2c60508e761d4da63ef9` (queue #434 `5848069362`; Director visual PASS #514 `5848068378`; W9 `5847955998`; W7 ACK `5848157807`): **PASS**

**Scope:** the delta only; Check 60 is not reopened.
- **Environment:** Chromium on the emulators (`demo-wsf-local`). `9d27fdb5` was built locally with auth and emulators on and served on :5041. `6ba49f10` (:5040) was the control.
- **Instrument:** new delta rows D1–D3 in `sprint-w7-home-northstar.spec.ts`, run on both builds with Check 60's rows.

| # | Item | Result |
|---|---|---|
| **1** | **Lineage and scope** | **PASS.** See the lineage bullets below. |
| **2** | **Descriptor (D1)** | **PASS on `9d27fdb5`; fails before on `6ba49f10`**, which shows "Private community" in all four states. See the D1 bullets below. |
| **3** | **Glyphs (D2)** | **PASS**, for both Start moving and Already moved. See the D2 bullets below. |
| **4** | **Momentum row (D3)** | **PASS.** Seeded rows: a named member, a name-private member, an activity-private member, and the viewer. See the D3 bullets below. |
| **5** | **Affected truth rows (Check 60 carry)** | **PASS on `9d27fdb5`**, with every value equal to Check 60's. See the carry bullets below. |
| **6** | **W9's spec and the affected specs** | **PASS.** See the spec-run bullets below. |
| **7** | **Evidence `e60e5ec8`** | **PASS.** See the evidence bullets below. |

**Row 1, lineage and scope:**
- `9d27fdb5`'s parent is `5e8a22ae`, and `e60e5ec8`'s parent is `9d27fdb5`.
- The product delta `5e8a22ae..9d27fdb5` touches two files: the Home route (+220 / −19) and W9's spec (+18 / −1), +238 / −20 in total.
- The evidence commit touches only `docs/design-target/review/home-northstar-parity-1/`.
- The protected-path diff from `6deefe7d` is unchanged: the Home route, W9's spec and the evidence directory only.
- **W9's spec delta:**
  - one assertion changed, as the Director required: "Private community" became "Moving together";
  - everything else is added: the human line absent with a goal and present with none, the Start moving `aria-label`, one `aria-hidden` glyph per action, and a momentum row with `+20 squats`, `added 20 squats` and no "(you)".

**Row 2, the descriptor (D1):**

| State | What shows |
|---|---|
| **D1a** open goal | the descriptor is "Moving together"; no human line; no "Private community" |
| **D1b** closed goal only | no descriptor; the human line is "Ready to get moving." |
| **D1c** every `wsfListGoals` read answered 500 (1 delivered) | neither line; only "Goals couldn't be loaded" |
| **D1d** `wsfListGoals` held | while pending, neither line; after release, "Moving together" |

**Row 3, the glyphs (D2):**
- Each action has exactly one `wsf-action-glyph` inside an `aria-hidden` subtree, laid out inside the control.
- `getByRole('link', { name, exact })` finds exactly one control each for "Start moving" and "Already moved? Record squats".
- Each control is still an `<a>` with an unchanged `href`, at 189×54 and 153×54.
- The visible label is unchanged ("Start moving" / "Already moved").

**Row 4, the momentum row (D3):**
- The exact `+N squats` is the rightmost text, flush with the row's right edge (≤ 2 px), and every other text sits left of it: `+14 squats` named, `+1,250 squats` anonymous.
- The secondary line reads "added N squats · Xm ago".
- The name-private member shows as "Anonymous member", keeps the exact amount, and the name never appears.
- The activity-private member's row is absent.
- No "(you)" appears, and no uid appears in the text.
- Rows are ≥ 44 px.
- **On `6ba49f10`:** the same three rows, with the amount only inside the sentence. So the right alignment fails before, as expected.

**Row 5, the Check 60 carry:**
- T1–T8 all pass.
- **L1:** no overflow at 390 or 360. **L2:** tiles 189×54 and 153×54. **L3:** one h1.
- **L4:** hero 209 / 279 at 844 and 197 / 245 at 640; Start's bottom at 488, above the tab bar at 565.
- **T8:** destinations unchanged (`mode=move` / `mode=record`), and Back returns to Home with the hero.

**Row 6, spec runs on `9d27fdb5`:**
- **W9's spec, exact:** 6 / 6 truth rows. The producer was skipped and no capture gate was set.
- **127 / 127 in one run (8.7 min)** over the union of two lists, 19 files:
  - W9's 8 directly affected files, from `RAW-affected-9d27fdb5.txt`;
  - Check 60's 18 Home-dependent files.
- My selector search for "directly affected" was too broad (an unescaped `(you)` matched almost every file). I ran the union instead of narrowing the list by argument.

**Row 7, the evidence:**
- `MANIFEST.sha256` verifies 33 / 33, and the set equals the directory.
- The candidate frames are 390×640 and 390×844, full viewport; side-by-sides are 792 wide. The candidate manifests record `crop: none`, commit `9d27fdb5` and fixture-only data.
- The reference PNGs are byte-identical to `5e8a22ae`'s (`fcb0d786…`, `8f79bb31…`), and the base frames are unchanged.
- The Lovable-packet hash match remains W9's statement; W7 does not read the external project.

**Not adjudicated:** the pixel and creative disposition, which is the Director's (visual PASS `5848068378`).

- **Gates:** `ts:check` 0; `check-evidence-intact` 0. Artifacts were cleaned in both trees, and none is committed.

**Status:** **PASS at `9d27fdb5` / `e60e5ec8`.** No changed-dependency finding. Next consumer: Director product acceptance → L0 integration / pin / staging. W7 merged, accepted and deployed nothing.

## 62 · AUTONOMY-STATE-1A exact-source QA, #519 at exact `5933fdae2c5af1a59ee0d479412ccfabc39c9190` on main `37f18ea9` (handoff #434 `5848558377`; W3 #396 `5848407527`; W7 ACK `5848560769`): **ONE CONCRETE FINDING (F1); every other item PASS**

- **Method:** tooling QA only, in a detached clean worktree.
- **Not done:** no state branch, trigger, merge or cloud action.
- **Probe harness:** 90 independent probes, run against the tools' own exports and CLIs on scratch ledgers and a scratch state directory. The harness lives in W7's scratchpad and is not committed; its assertions and refusal reasons are summarised here.

| # | Item | Result |
|---|---|---|
| **1** | **Scope** | **PASS.** Two commits on `37f18ea9`, touching 18 files, all under the reserved 1A paths: `tools/wsf-control/`, `docs/westayfit/ops/CONTROL_STATE.md`, `.claude/skills/wsf-program-director/SKILL.md` and the pointer `skills/wsf-program-director/SKILL.md`. No workflow, `.github/`, app, functions, rules or index file. No trigger change. The `wsf-control-state` branch does not exist on origin. |
| **2** | **Suites** | **PASS.** On a clean checkout, `tools/wsf-control/run-all.mjs` passes: ledger 75, views 37, skill 6. The staging control `run-all` passes all 23 suites. The tree is clean after both. |
| **3** | **Independent probes** | **88 / 90 PASS.** The two misses are F1. See the probe groups below. |
| **4** | **Views** | **PASS.** See the P10 group below. |
| **5** | **Skill** | **PASS.** See the skill bullets below. |

**Row 3, the probe groups.** Each refusal was checked for its stated reason, not just for being refused.
- **P1, closed writers:**
  - actors `W3`, `W7`, `fable`, `L0 ` (trailing space), `Director`, `Owner`, missing and `""` are each refused, and `L0` is accepted;
  - a hand-appended `W3` line with a correct hash chain is refused by `reduce`.
- **P2, typed provenance:** each of these is refused:
  - a `url` kind, a string comment id, a foreign repository, an extra `url` key, a short commit SHA, a missing source, a negative id;
  - `queue` resting on a `workflow_run` or a `commit`.
- **P3, honest genesis.** Positive control first: a valid imported ACCEPTED packet bootstraps, with `origin: bootstrap`. Then each of these is refused, for its own reason:
  - a first line that is not a bootstrap;
  - a second bootstrap;
  - `history` or `acceptedAt` fields;
  - ACCEPTED without `acceptedBy`;
  - DELIVERED without refs;
  - VERIFIED on a STAGED contract;
  - INTEGRATED without `mergeSha`;
  - a ref carrying a `url` key;
  - a bootstrap source outside the repository.
- **P4, idempotent append:**
  - re-sending an event is `noop`, even with a stale head, and writes no byte;
  - the same identity with a different payload, or a different actor, is a `conflict`;
  - a stale `--expect-head` is refused ("another decision was recorded");
  - a missing head is refused, and so are supplied `seq` / `id` / `prev`;
  - an edited, reordered, removed or duplicated line breaks the ledger.
- **P5, byte integrity:**
  - on disk, `state.json` with one trailing byte, or with a hand-edited phase, fails `check`;
  - `CURRENT` verifies `current`; a one-byte edit reads `hand-edited`; after a new event it reads `stale`.
- **P6, one ACTIVE:**
  - a second release to W3 is refused ("W3 holds 2 worker-owned packets; at most one");
  - a release outside the canonical inbox is refused;
  - `worker-view` prints `ACTIVE_NOW=ALPHA` and exactly one `NEXT=BETA`, in queue order, with GAMMA not shown;
  - a released packet cannot be queued again.
- **P7, completion and proof:**
  - `accept` of a non-subject (evidence) SHA is refused;
  - `begin-proof` with the wrong `proofType` is refused;
  - `stage` on a VERIFIED contract and `proof-pass` on a STAGED contract are refused;
  - `proof-pass` naming run 55 while run 54 is in progress is refused;
  - `proof-fail` resting on a workflow run is refused ("must rest on a comment");
  - **run 54:** a failed run 54 reconciles to `proof-run-concluded` (`wins=github`). The comment-sourced `proof-fail` moves the packet to CHANGES_REQUESTED, worker-owned. A later `proof-pass` on run 54 is refused, and a PASS recorded against the failed run 54 is reported as `proof-result-drift`;
  - a STAGED contract completes at `stage`, and a source-only contract completes at INTEGRATED (`begin-proof` refused as terminal);
  - `integrate` resting on a comment, or without an acceptance, is refused.
- **P8, control surface fails closed:** each of these gives `control-surface-exception`:
  - CURRENT missing from the snapshot;
  - another comment id;
  - `exists: false`;
  - no marker;
  - a foreign head.

  The current head gives no exception. A snapshot with an unknown key, or a URL-shaped key, is refused.
- **P9, ACTIONABLE vs MONITOR:**
  - with every released packet blocked on an external condition, the output is `ACTIONABLE=off` / `MONITOR=on`, and the worker has `WATCH=off`;
  - once the condition clears, it is `ACTIONABLE=on` with `NEEDS_TRANSITION EXT event=unblock … reactivates=W3`, and `MONITOR=on`.
- **P10, views:**
  - `program-view`, `worker-view`, `check` and `render-current` leave the state directory byte-identical (SHA-256 of every file before and after, all exit 0);
  - on a state with one byte appended, every view exits 2 ("state.json is not the reduction"), and `append` refuses too.
- **P11, secret and PII screen:**
  - labels holding an email, a `ghp_` token, a bearer token, a URL, a JWT or a Google key are refused, and the message withholds the value;
  - a label of 201 characters, or one spanning lines, is refused.

**Row 5, the skill:**
- Only Fable and L0 run `append`. A worker's comment can be a source, never the writer.
- It grants no acceptance, pixel verdict, merge or deploy authority ("Never merge or deploy because of a phase").
- There is one bootstrap, which imports current state; history is never fabricated.
- It stores no secret, PII or URL.
- The interaction override is scoped to WSF program work while the skill governs the session. The generic rules file is not edited.
- The skill test confirms no secret-shaped content, and a short pointer with no frontmatter.

**Observation for 1B, not a 1A finding.** `actor` is a self-declared string. The tool cannot tell Fable from a worker that writes `actor: "Fable"` with its own comment as the source. The "closed writer set" is therefore enforced in 1A by the schema and the procedure, and in practice by **who can push `wsf-control-state`**. 1B's branch protection is where a worker self-write is actually prevented.

**F1 (the one concrete finding): the contract lets a QUEUED packet be blocked, but the ledger always refuses it.**
- **The contract:**
  - `CONTROL_STATE.md:123` and `transitions.mjs:11` state "any non-terminal ─block→ BLOCKED", and QUEUED is non-terminal;
  - `transitions.mjs:244–250` (`case 'block'`) accepts a QUEUED packet and sets it BLOCKED.
- **Why it fails:**
  - unlike `withdraw` (`transitions.mjs:258`), `block` does not remove the packet from its owner's queue;
  - so the invariant `check.mjs:27` ("W3's queue names QB, which is already BLOCKED") refuses every such append;
  - bootstrap agrees with the refusal, not with the contract: `transitions.mjs:75` forbids `phaseBeforeBlock: QUEUED`.
- **Fixture:**
  1. bootstrap;
  2. `queue QB → W3`;
  3. `block QB` on an external condition, or on another packet's `ACCEPTED`.

  The result is `APPEND=refused` both ways (probes P12 and P12b).
- **Consequence:** the ledger cannot represent a queued packet that waits on a dependency, for example NEXT waiting for ACTIVE's integration, or a packet held for an owner decision. The only representable options are wrong:
  - leave it unblocked, so it shows as `NEXT` and invites a premature release;
  - record a `release` that did not happen, then block it (a fabricated decision);
  - `withdraw` it.

  The refusal is fail-closed: nothing is written. So this is a correctness gap in the contract, not an integrity hole.
- **Smallest correction, the Director's choice:**
  - **(a)** match the contract: `block` of a QUEUED packet removes it from the queue, remembering its position, and `unblock` restores it. Bootstrap would then accept `phaseBeforeBlock: QUEUED` for a blocked packet held out of the queue. Add a test.
  - **(b)** narrow the contract: block is legal from RELEASED onward. `transitions.mjs` then refuses QUEUED explicitly, `CONTROL_STATE.md` and the transition comment say so, and dependency ordering between queued packets is expressed by queue order alone.

- **Gates:** `ts:check` 0; `check-evidence-intact` 0. No e2e run and no artifacts; the scratch ledgers were removed.

**Status:** **one concrete finding (F1) at `5933fdae`; items 1, 2, 4 and 5 PASS, and 88 / 90 independent probes PASS**, the two misses being F1. W7 created no state branch, migrated no trigger, merged nothing and accepted nothing.
