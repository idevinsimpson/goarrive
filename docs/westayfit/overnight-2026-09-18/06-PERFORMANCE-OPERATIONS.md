# Task 6/8 — Performance + operational quality

Scope: practical staging/Expo behaviour of the candidate — export size, renders, timers, polling, request cadence, caches, assets, cold load, leaks. Method: an Opus read-only audit with numbers gathered from the built export and the code; one Opus implementer applied the low-risk items with measurements and covenant-spec regression runs (two audit items were reverted because existing specs proved their "behaviour-preserving" premise false); Fable applied the backend cache edits, ran the callable suite, integrated and committed. Nothing touched scaling, minInstances, TTLs, poll intervals, or cost infrastructure.

## 1. Numbers

| Item | Value |
|---|---|
| `apps/westayfit/dist` total | 3.1 MB |
| Main JS bundle | 1,964,081 B raw / 489,416 B gzip |
| New npm dependencies vs base | none |
| Estimated bundle growth vs base (from the diff: three routes, `src/ui/*`, the inlined 1,001-entry calibration table) | ≈60–90 KB raw / 15–25 KB gzip |
| Brand PNGs shipped (5 files, all referenced) | 427,167 B; per screen 231–298 KB on first load, cached after |
| Originals (1.8 MB) and the silhouette derivative | not shipped (never `require`d) — correct |
| Display idle cadence | 30 `wsfGoalPulse`/min per display; 43,200/day for a wall panel; server reads per miss 12 (anonymous) / 13 (member); a lone 2 s poller against a 2 s TTL misses every time (0% hit rate) — the cache collapses concurrent pollers only, as its comment says |
| Contribute idle cadence | 30/min before the write; 0 while an attempt is in flight, unknown, refused or confirmed (verified) |
| Community Home | never polls; N + A callables on mount, on Refresh and on focus |
| Cold load sequential round trips before the hero | display 1 (auth-free); contribute 2 (parallel pulse + own credit); Community Home 3 for the goal hero, 4–5 for the community name |
| Long-running display memory | flat (single replaced state object, no accumulating arrays) |

## 2. Changes made (each measured, behaviour-preserving, tested)

| # | Change | Measurement / proof |
|---|---|---|
| P-1 | **Display idle re-renders**: a successful tick that carries the same nine fields and the same displayed minute keeps the previous state object, so React bails out (`src/displayPulse.ts` `samePulse`; `apply` takes a state updater) | 13 unit tests (`display-pulse.test.ts`); `ui-perf` proves the network cadence is unchanged (8–12 requests per 20 s, 4–7 per 10 s) and the screen stays confirmed and non-stale over 30 s of identical answers |
| P-2 | **Contribute poll in-flight guard**: a slow backend no longer queues ticks behind itself | `ui-perf`: 6 s-delayed pulse over 30 s — 15 requests before, ≤ 6 after (and ≥ 2, so the poll still runs); undelayed cadence unchanged |
| P-3 | **Copy-link timer** held in a ref, cleared on a new tap and on unmount (was uncaptured; two taps 1 s apart fought and the second "Copied" was cut short) | `ui-perf`: copy → 1 s → copy → 1.5 s reads "Copy link" before, "Copied" after |
| P-4 | **LivingWeProgress** lazy-initialises its `Animated.Value` ref (the constructor ran on every render) | calibration unit tests and `data-fill-ratio` assertions green |
| P-5 | **Pulse caches**: `delete` before `set` so a re-set key moves to the tail and the insertion-order eviction is LRU (both the goal and the challenge cache); the goal pulse stamps the cache with the moment it is consulted, after the access reads, so a slow read cannot stretch an entry past its 2 s TTL | callable suite 238/238; the audit proved the LRU flaw could not manifest on the live path today (set only follows a null get), so this is latent-correctness hardening with no measurable win — stated plainly |
| — | Also in this commit (D-27 from Task 5's contract run): the community name shrinks/wraps in its header row at 195 px with an 80-char name; the display's generic state headline is its level-1 heading; the contract spec's ambiguous-name check uses an exact accessible-name match | `ui-a11y` 195 px cases 2/2, R7b 1/1 |

## 3. Audit items deliberately NOT applied

| Item | Why |
|---|---|
| Display poll in-flight guard | **Reverted after measurement.** `e5-display-authorization` CASE 3 and CASE 4 hold one pulse *response* open from before a revocation and require a later poll to overtake it and deliver the refusal; with one request at a time the held response wedges the poll and a revoked display keeps its total. Overlap is load-bearing on that screen. A comment in the tick records this, and `ui-perf` now asserts the opposite direction for the display (≥ 8 requests in 20 s behind a 6 s answer). Bounding the queue would need a concurrency cap (≥ 3), which is a decision, not a fix. |
| One `wsfListGoals` per Champion read-back (2 → 1) | Worked and measured, but it makes the D-7 covenant test unreachable (that test kills the *second* list call to prove the orphan warning survives). Only fires on a failed write; not worth rewriting a covenant spec overnight. Comment added explaining why the second call is not redundant. |
| Parallelise the group read and `wsfMyCommunities` on Community Home | would issue a callable before `groupSnap.exists()` is known, i.e. a new call on the not-found path — an ordering change, skipped |
| TTL / poll alignment (0% single-poller hit rate) | changing either alters observable freshness; recorded, not proposed |
| Brand PNGs oversized for phone (1200 px sources at 88–306 CSS px) | 427 KB once, cached; re-deriving means re-running the brand pipeline and re-pinning provenance; not worth it at this size |
| Brand PNGs load only after hydration (SSG shell has no `src`) | a preload hint would help cold wall-display starts; touches the export pipeline — recorded |
| Orphan pending keys never reaped | bounded to pre-fix legacy rows (0–3 × ~150 B); deliberate per the store's comment |
| Background-tab polling | browsers throttle hidden tabs; a wall display is always visible — acceptable |

## 4. Test receipts for this task

| Suite | Result |
|---|---|
| `ui-perf` (new, 3 measured proofs) | 3 passed |
| Regression (one spec per run): `ui-display` 4, `ui-display-torture` 2, `ui-display-torture-2` 5, `ui-contribute` 7, `ui-contribute-torture` 4, `ui-contribute-torture-2` 7, `ui-champion-torture` 5, `ui-champion-torture-2` 1, `e5-display-authorization` 5, `e5-community-goal-seam` 4, `ui-community-home` 2, `ui-a11y-fixes` 8, `ui-a11y` 195 px 2 + R7b 1, `ui-qa` 5, `ui-journey` 1 | all passed |
| Callable suite (backend cache edits) | 238 passed / 18 files |
| Vitest | 232 passed / 16 files |
| App TypeScript, functions build | clean |
