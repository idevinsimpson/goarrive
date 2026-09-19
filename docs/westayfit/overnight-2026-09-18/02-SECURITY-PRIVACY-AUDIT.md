# Task 2/8 — Security + privacy adversarial audit

Scope: the public `wsfGoalPulse` nine-field contract, the Champion authorization control, the member and display routes to a goal's aggregate, and what the three phone surfaces render or retain. Method: a new adversarial callable suite against the emulator, two browser cases for malformed links, a static read of the three routes, and an independent Opus adversarial review (three lenses, every finding verified by a second Opus worker told to refute it).

## 1. The contract under test

| Route | Who | Gets |
|---|---|---|
| member | an **active** membership row for the goal's community | the nine fields |
| display | anyone, when the goal carries `aggregateDisplayAuthorized === true`, the community document exists, and it is not a sample | the nine fields |
| everyone else | | one generic `not-found`, byte-identical for unknown, unauthorized, revoked, removed, sample |

Nine fields: `sharedTotal, target, unit, status, communityDisplayName, goalTitle, startsAt, endsAt, timezone`. Access is decided before the 2 s per-goal cache is consulted.

## 2. Probes added — `functions-westayfit/tests/callable/wsf-overnight-privacy-audit.test.ts` (33 cases)

| Area | Probe | Result |
|---|---|---|
| Route-parameter trust | 12 malformed `goalId` shapes (object, array, number, boolean, empty, whitespace, path segment, `../`, inner space, 129 chars, non-ASCII, NUL byte), anonymously and signed in | all `invalid-argument`; no lookup reached |
| Request-field trust | `uid`, `callerUid`, `auth`, `aggregateDisplayAuthorized`, `asMember` in the request body | ignored; generic refusal |
| Membership | `pending`, `removed`, `left`, `invited`, empty, missing, boolean, `Active` (case) | all refused, message identical to an unknown goal |
| Cross-community | active member of A reading B's goal; a row keyed on B but written for another `userId` | refused |
| Cache isolation | warmed authorized goal does not warm its unauthorized neighbour; revoke inside the TTL refuses the warmed goal; member route unaffected both ways | holds |
| Sample suppression through the cache | a member warms a sample community's authorized goal; anonymous and stranger reads inside the TTL | refused |
| Membership loss inside the TTL | member polls, row set to `removed`, member polls again | refused on the second poll |
| Unusable community reference on an authorized goal | dangling id, empty string, number, object, null | generic `not-found` (see defect D-2) |
| Authorization control as oracle | Champion of X on an unknown goal, on Y's goal, on Y's authorized goal (revoke) | one code, one message; Y's decisions untouched |
| Role escalation | `admin`, `champion`, `FoundingChampion`, `owner` roles | cannot authorize |
| Unapproved fields | community doc with `joinCode`, `memberCount`, `contributorCount`, `ownerEmail`, `location`, `inviteLink`; goal doc with `contributorCount`, `contributorUids`, `notes`, `ownerEmail`, `createdByDisplayName` | response is exactly the nine keys; none of the values, uids or the group id appear anywhere in the JSON |

Already covered by the existing suites and re-run tonight: unknown vs unauthorized byte-identical refusal, private-community authorized goal displays, public-community unauthorized goal refused, non-boolean flag never authorizes, revocation on the next read, closed authorized goal keeps displaying and stays revocable, removed member's own credit stays theirs, removed member replay withholds shared state unless the goal is display-authorized, `wsfMyContribution` refuses strangers identically for real and unknown goals, `wsfChallengePulse` no longer anonymous.

## 3. Browser probes added

- `ui-display.spec.ts`: `/display/not%20a%20goal%21` renders the same generic "Nothing to show here" text as an unknown goal, and **no further pulse requests** leave the page after the refusal (counted over 5 s).
- `ui-contribute.spec.ts`: `/contribute/not%20a%20goal%21` renders the same "Goal not found" card as an unknown goal, with no server message and no retry control.

## 4. Defects found and fixed

| # | Where | Defect | Fix | Proof |
|---|---|---|---|---|
| D-2 | `functions-westayfit/src/index.ts` `evaluateGoalAggregateAccess` | A goal document whose `communityGroupId` is an empty string made the Firestore path builder throw, which reaches the caller as `internal` — a distinguishable answer for a goal that exists (needs a corrupt or hand-edited goal document; goal creation validates the id) | the shared access evaluator normalizes the reference with the same id rule as every request id and opens no route when it is unusable; both the pulse and the contribution replay inherit it | audit case "communityGroupId = empty string" (was `internal`, now `not-found`); the other four shapes already refused |
| D-3 | `apps/westayfit/app/display/[goalId].tsx` | A malformed goal id in the URL (server answers `invalid-argument`) was classed as a transient failure: the display showed "connection" state and polled every 2 s indefinitely for an id that can never resolve | `invalid-argument` is the same terminal refusal as `not-found` (generic screen, session closed, timer cleared) | new display browser case |
| D-4 | `apps/westayfit/app/contribute/[goalId].tsx` | Same malformed id on the contribution link showed the retryable error card carrying the server's argument message | classed as not-found on the initial goal load | new contribute browser case |

Two further frontend defects (D-6, D-8) came out of the Opus review and are fixed in the same commit; see section 7.

No change to the nine-field contract, the access rule, the cache, or Package E semantics.

## 5. Harness

`functions-westayfit/jest.callable.config.cjs` now sets `testTimeout: 30_000`. The multi-step suites that already set a 30 s per-test ceiling were fine; `wsf-package-e-member-access.test.ts` did not and hit Jest's 5 s default twice tonight on this 4-core sandbox with 18 suites in parallel (CASE 7 in the earlier session, "four combinations" in this task). A real hang still fails at 30 s.

## 6. Static findings (no change needed)

- The display renders only pulse fields; after a refusal every protected value leaves the screen (`expectNoLeak` in the display spec, re-run tonight).
- No route reads `joinCode`, `memberCount` or `contributorCount` from the pulse. Community Home shows the join code only inside the Champion's Manage sheet, from `wsfListGoals`/community data available to members; the display and contribution routes never reference it.
- The 2 s cache can serve a `status` or `communityDisplayName` up to 2 s stale after closure or rename. Accepted: totals never go backwards, and revocation is decided before the cache.
- Refused sessions on the display stay refused after re-authorization until an explicit **Check again** (existing browser case, re-run).

## 7. Independent Opus adversarial review

Three Opus workers attacked the boundary independently (lenses: publication boundary incl. Firestore rules; races and ordering; frontend leakage and honesty). Every finding was then handed to a second Opus worker instructed to refute it. 16 agents, 11 findings, 6 confirmed, 5 refuted.

### Confirmed

| # | Finding | Severity | Decision |
|---|---|---|---|
| D-5 | **Firestore rule `wsfIsGroupMember` is existence-only** (`firestore.rules` ~1210). A removed or departed member keeps a membership row (status changes, row never deleted), so `allow read` on `wsfCommunityGroups/{groupId}` still passes and a signed-in removed member can read the whole community document directly through the SDK, including the live `joinCode` and every rotated one after a "Reset link". Pre-existing; this PR does not touch rules; the client gate on Community Home already checks `membershipStatus` but an SDK read never goes through it. The rules suite has no non-active-membership case. | high | **Not applied — owner boundary.** Firestore rules are outside overnight authority. Proposed one-helper fix for owner review: add `&& get(/databases/$(database)/documents/wsfMemberships/$(groupId + '_' + request.auth.uid)).data.membershipStatus == 'active'` to `wsfIsGroupMember` (single call site), plus a rules test seeding a `removed` and a `departed` row and asserting `getDoc` fails. |
| D-6 | **Contribute screen's pulse poll swallowed `not-found`** (`app/contribute/[goalId].tsx` poll catch). After a Champion removed the member, the screen kept painting the last shared total and offered the entry flow for ever. | high | **Fixed.** A `not-found` on the poll is terminal: interval cleared, state → the same generic not-found card as a cold load. Browser test "membership lost while on the entry screen" (removed via emulator → card within 20 s, zero further pulses over 5 s, zero writes, no pending row). |
| D-7 | **Champion outcome notice hidden when the goals reload fails** (`app/community/[groupId]/index.tsx`). The "That change did not take effect. Public display is still authorized for this goal." notice renders only inside the loaded-goals branch; the read-back that produces it also bumps the goals reload, and if that reload fails on a flapping connection the notice (and its retry/dismiss) is unreachable. | medium | **Deferred to Task 4** (display + authorization race torture), where it will be fixed with a deterministic browser reproduction. |
| D-8 | **Contribute pulse poll had no ordering guard**; an older response could overwrite a newer total (counting backwards) and become the "before" figure captured at Record. The display already had `issued`/`applied`. | low | **Fixed.** Same admission guard as the display. |
| D-9 | **Quarantined legacy pending contribution is never surfaced.** `legacyOrphan` is set and never rendered; the orphan storage key is written and never read. A device carrying a pre-fix unscoped row shows nothing about it. | medium | **Not fixed overnight — product copy decision.** The right notice must be non-attributing (a legacy row has no identifiable owner on a shared device, so the count must not be shown). Recorded as an intentional gap for the owner; the store itself (`pendingContribution.ts`) is unchanged Package E core. |
| D-10 | **`wsfGoalPulse` refusal is timing-distinguishable for signed-in callers**: an existing goal with no route costs one extra membership read before the byte-identical `not-found`. | low | **Accepted, not fixed.** Goal ids are 20-character Firestore auto-ids (~120 bits); there is no id space to enumerate, and the same reasoning refuted the two oracle findings below. A decoy read on the missing-goal path would add cost to the hottest public endpoint for no practical gain. Recorded so the trade-off is explicit. |

### Refuted (recorded so they are not re-raised)

- `wsfContribute` and `wsfAdjustGoal` answer `not-found` for an unknown goal and `permission-denied` for an existing one. Mechanically true; not exploitable (auto-id space, no callable hands out foreign ids), and the distinct codes drive the approved refusal copy on the contribution screen.
- `wsfMyContribution` / `wsfSetGoalDisplayAuthorization` interpolate `communityGroupId` unnormalized: for every corruption class in the audit suite the built path is still valid; only a `/` inside the id would throw, which no writer produces.
- Community Home would render the previous community's document while the next loads; a "Reset link" join code would survive a community switch. Both unreachable: expo-router 6 keys `community/[groupId]` per dynamic path, so a different community is a fresh mount. The join-code state is now cleared on context change anyway (harmless, defensive).
- A removed member opening an **authorized** goal's contribution link sees the entry flow: by design — the pulse is public for that goal and the write is refused with the "not a current member" copy.
- Raw server message for `unauthenticated` on the contribution load: fixed before the reviewer read the live tree (now the sign-in screen).


## 8. Test receipts for this task

| Suite | Result |
|---|---|
| Callable suite (18 files, incl. the new audit) | 237 passed |
| Browser: `ui-display`, `ui-contribute`, `e5-display-authorization` | 15 passed |
| Browser after the D-6/D-8 fixes: `ui-contribute`, `ui-community-home`, `e5-community-goal-seam` | 12 passed |
| Browser after the ordering guard: `ui-contribute`, `ui-journey`, `e4-a1-shared-goal` | 9 passed |
| App TypeScript, functions `tsc` | clean |
