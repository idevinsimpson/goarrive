# Task 3/8 — Contribution resilience torture

Scope: the contribution lifecycle beyond the happy path (`app/contribute/[goalId].tsx`, `src/contributionFlow.ts`, the unchanged Package E store `src/pendingContribution.ts`, `wsfContribute` / `wsfAdjustGoal` / `wsfMyContribution`). Method: an Opus read-only design pass mapped every owner scenario to existing coverage or a deterministic recipe; one Opus implementer fixed the reproducible defects and wrote the P0 tests with exclusive emulator access; a second Opus worker authored the remaining tests as code; Fable reviewed every diff, added one more fix and test, ran the battery, and committed. No new server semantics; `pendingContribution.ts` untouched.

Invariants protected: exact own effort · shared current truth · idempotency per attemptId · no peer credit to the member · an unknown outcome is never silently discarded nor re-sent as a new attempt.

## 1. Scenario matrix

| Scenario | Before tonight | Tonight |
|---|---|---|
| Rapid double taps on Record | backend sequential double-submit only | **R1** (browser, two click events in one task) — failed before the D-11 fix, passes after |
| Replay of the same attempt | covered (`ui-contribute` unknown-outcome test; callable double-submit) | + **R2** concurrent same-attemptId at the callable (`Promise.all`) |
| Network loss before the response | covered (`route.abort`) | re-run |
| Network loss after the server write | covered (`route.fetch` then abort) | re-run |
| Reload while unknown | covered | re-run |
| Leave and return while unknown | partial (account switch only) | **R5** same-account leave/return; **R6** leave *during* sending, return, reconcile |
| Account A → B on the same device | covered (`e5-community-goal-seam`, unit isolation tests) | re-run |
| Goal A → B | unit only | **R3** late SUCCESS for A while on B: nothing lands on B, A stays reconcilable, counted once |
| A → B → A late responses | late failure only | **R4** late SUCCESS after the round trip (seam spec): no receipt flip, credit exactly 18, no pending |
| Peer contribution during review/record | covered | + **R7** no poll and no shared number while unknown |
| Membership removal mid-attempt | covered (new attempt → notMember; landed → own-only) | + Task 2's "membership lost on the entry screen"; + **R15** removal discovered on a fresh load with an unresolved attempt (see D-12) |
| Goal closure mid-attempt | closure inside the write only | **R8** closure seen by the poll on Review (no write); **R9** closure while unknown, landed and lost branches |
| Correction after contribution | backend only | **R10** `wsfAdjustGoal` (−5) reflected on the contribute screen: own credit 15, shared 256 |
| Already-recorded replay · own-only replay · reached / overshoot · cold links | covered | re-run |
| Keyboard / mobile navigation | happy path (`ui-qa`) | **R14** pending reminder and refusal screen reachable and operable by keyboard |
| Stale "before" total on reconcile | — | **R11** — failed before the D-13 fix, passes after |

## 2. Defects found and fixed

| # | Where | Defect | Fix | Proof |
|---|---|---|---|---|
| D-11 | contribute route, `onRecord` / `onReconcile` | Double tap: the `submitting` guard is React state, so two click events in one task both pass. Credit was safe (both requests reuse the attemptId; the server counts once) but the last response won `setLastResult`, so a first successful submission could render as "This contribution was already recorded." | synchronous `inFlightRef` set at the top of both handlers, cleared in `finally`, reset on context change; `disabled={submitting}` kept | R1: before `data-variant="alreadyRecorded"`, after `ordinary`; one request issued |
| D-12 | contribute route render order | "Goal not found" rendered above the pending reminder. A member with an unresolved attempt who is removed and returns on a fresh load got the not-found card with no way to reconcile — an unknown outcome silently unreachable, although the server honours the replay regardless of membership drift. | reminder, replay receipt and refusal render before the not-found card; when the goal has not loaded the unit is unknown and the number is shown alone ("You entered 20."); `refusalCopy` tolerates an unknown unit | R15: landed attempt → own-only receipt, credit 20 once; lost attempt → "not a current member" refusal, nothing credited |
| D-13 | contribute route, `onReconcile` | The "before" total passed to the result copy was frozen from before the unknown period (polling is off while pending), so a replay could read `postTarget` ("we were already past it") when the community had only just got there, or vice versa | a replay passes `null` for the before-total; `contributionFlow` already documents that null falls to `reached`, which is true whenever the confirmed total is at or beyond target | R11: before `postTarget`, after `reached` |
| D-14 | contribute route, `isSameContext` call sites | The "current" goal passed to the context check was the closure's own `goalId` (a tautology); `contextRef` held the live context and was never read. Correct in practice only because the generation counter always advanced. | the three call sites compare against `contextRef.current` (defence in depth; the generation guard stays) | R3/R6 are regression guards (they passed before too; no deterministic failing case exists without inventing one) |

## 3. Gaps recorded, not fixed (copy or product decisions)

- **D-9** (from Task 2) — quarantined legacy pending row never surfaced; needs a non-attributing copy decision.
- **Closure while on Review** — the closed screen replaces Review outright and the typed number disappears without a sentence ("The goal closed before you recorded your 20 squats"). Accounting is correct (nothing written, nothing promised); a sentence is a copy decision. Pinned in R8 as a comment.
- **Durability promise vs storage** — the reminder says "The same attempt will be here when you come back"; in a private window, with site data blocked, or at quota `savePendingNew` returns false and the reminder dies on reload. The row is Package E core; the copy is an owner decision.

## 4. Harness notes

- Deterministic double tap: two `MouseEvent('click')`s dispatched in one `page.evaluate` task (separate Playwright clicks let React flush between them and hide the race).
- Late responses across full page loads cannot be delivered by `route.continue()` (the browser drops the paused request); R4 releases the route *and* replays the captured payload and authorization header from Node so a real late success reaches the server.
- Expo Router keeps the popped contribute screen mounted under the community screen; assertions use `.last()` and never assert absence of the popped screen's elements.

## 5. Test receipts for this task

| Suite | Result |
|---|---|
| Browser: `ui-contribute-torture` (R1, R3, R6, R11), `ui-contribute-torture-2` (R5, R7, R8, R9, R10, R14, R15), `ui-contribute` (7), `e5-community-goal-seam` (4 incl. R4) | 22 passed (21 in one run + R5 re-run after a stack-mount assertion was corrected in the test) |
| Callable suite (18 files, incl. R2) | 238 passed |
| Vitest | 205 passed / 14 files |
| App TypeScript | clean |
