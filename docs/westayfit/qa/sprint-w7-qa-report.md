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

# Check 3 — further W4 / W2 / W6 checkpoints

Awaiting L0's routing, prioritised by what can be integrated next.
