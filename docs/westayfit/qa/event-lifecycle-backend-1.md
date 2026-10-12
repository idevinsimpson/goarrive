# EVENT-LIFECYCLE-BACKEND-RECOVERY-1: the canonical Event lifecycle, as an isolated module

**Authority:** queue #365 comment 6059919181, release 6060049268, original scope 6044547053, and withdrawal of the W5 predecessor 6059491796. The proposal reference is Lovable `3740225f` `docs/decisions/EVENT-LIFECYCLE-CONTRACT-DRAFT.md`, as amended by the owner: close, cancel and archive replace delete.

**Base:** `claude/wsf-app-shell` at `b8381195`.

**What this is:** source only. The work is one module, two emulator suites and this record.

**What this is not:**

- It is **not live.** `functions-westayfit/src/index.ts` does not import or re-export the module, and Firebase only deploys what `index.ts` exports. Until a separately reviewed integration adds the one export statement in [Integration handoff](#integration-handoff-indexts-not-edited-here), these are source, not callables.
- It is not a client, a route, a rules change, an index change, a package change, staging or a deploy.

| File | Change |
|---|---|
| `functions-westayfit/src/eventLifecycle.ts` | New. 8 handlers, pure normalizers and the response whitelist. Not exported from `index.ts`. |
| `functions-westayfit/tests/callable/wsf-event-lifecycle.test.ts` | New. Lifecycle, idempotency, field rules, edits, the goal left untouched, station compatibility and in-flight truth. |
| `functions-westayfit/tests/callable/wsf-event-lifecycle-privacy.test.ts` | New. Who may manage an Event, what a refusal leaves behind, what an answer may carry, and proof that the module is not live. |
| `docs/westayfit/qa/event-lifecycle-backend-1.md` | This record. |

Nothing else changed. `index.ts`, `firestore.rules`, `firestore.indexes.json`, `package.json`, workflows, IAM and every client file are untouched.

## What an Event is, and why it reuses the scope rule

The canonical source already has one notion of an event for a goal. In `index.ts`, `resolveTurnEvent(goalId)` serves the goal's turns:

- from a **setup** line `setup__{setupId}` when an active combined-goal claim names a setup that exists, is active, is in the goal's own community and has at least one frozen child;
- otherwise from the **goal** line `goal__{goalId}`.

Stations, the turn line and `wsfEventContext` all resolve through that rule.

An Event here is a **lifecycle record over one existing, active goal of the community.** It adds a title, a window inside the goal's window, an IANA zone and a status. Its `eventScope`, `setupId` and `lineId` are snapshotted at creation by `lineForGoal`, which mirrors `resolveTurnEvent` condition for condition. A test proves the snapshot equals what `wsfEventContext` reports, in the normal case and under four hand-edited divergences:

- the setup is closed but its claim was left active;
- the setup was moved to another community;
- the setup has no children;
- the claim was released but the setup was left active.

Because an Event is a record over an existing goal:

- **It is not a new goal, ledger or line.** Contributions stay on the goal and turns stay on the line the turn callables already use.
- **It writes only `wsfEvents/{eventId}`.** It never writes to `wsfGoals`, `wsfContributions`, `wsfTurnEntries`, stations, `wsfCombinedGoals` or `wsfCombinedGoalClaims`.
- **It cannot change the goal's terms.** Target, unit, rules, window and status are not Event fields, and no request can name them.
- **It cannot rebind an in-flight turn.** Nothing in the module writes a turn entry.
- **Existing stations keep working with no Event at all.** A test enrols a station, runs a full turn and records a contribution on a goal that has no Event.

**Storage:** `wsfEvents/{eventId}` is server-only. The catch-all `match /{document=**} { allow read, write: if false; }` in `firestore.rules` already denies every client read and write. No rule names `wsfEvents`.

## Lifecycle

```
draft ──publish──▶ published ──close──▶ closed ──archive──▶ archived
  │                    │
  └──────cancel────────┴──cancel──▶ cancelled ──archive──▶ archived
```

| Op | From | To | Also checked |
|---|---|---|---|
| `publish` | `draft` | `published` | The goal still exists, is in this community and is active. The window still sits inside the goal's window. The Event has not ended. |
| `close` | `published` | `closed` | None. |
| `cancel` | `draft`, `published` | `cancelled` | None. |
| `archive` | `closed`, `cancelled` | `archived` | None. |

Nothing is ever deleted: there is no delete handler, and a source test asserts the module contains no `.delete(`.

Every create, edit and transition appends `{ op, status, atMillis, requestId, byUid }` to the stored `history`. Each transition stamps its own `publishedAtMillis`, `closedAtMillis`, `cancelledAtMillis` or `archivedAtMillis`. Earlier stamps are kept: an archived cancellation keeps `cancelledAtMillis`.

### Closing, cancelling or archiving ends nothing

These transitions do not close the goal, end a queued place, interrupt a running turn or touch a recorded attempt. The goal's own status still governs every turn and contribution.

Instead, the answer reports what was left running in `inFlight: { queued, inProgress }`:

- `queued` counts entries with `lineStatusKey` of `waiting`, `assigned` or `ready`;
- `inProgress` counts `active` entries.

The count covers the line the goal is served from now and, if a combined setup has since claimed or released the goal, also the line snapshotted at creation. Each line is counted once. Tests cover both directions of that change.

The count is read after the commit with equality-only `count()` aggregates, so it reports state and changes none. `publish` returns `inFlight: null`.

The proof test does the following:

1. Ann completes a turn (5 recorded). Ben's turn is started and running. Cat is queued.
2. Close reports `{ queued: 1, inProgress: 1 }`, and so does archive.
3. Ben's and Cat's entries are byte-identical before and after, and the contribution count is unchanged.
4. Ben's running turn then completes (7) on the goal.
5. Ann's recorded attempt replays its own receipt: `addedCount: 5, alreadyRecorded: true`, with a requested count of 999 ignored.
6. Cat is called next.
7. The archived Event keeps its four history steps.

### Time lock

| Status | Editable |
|---|---|
| `draft` | `title`, `startsAt`, `endsAt`, `timezone` |
| `published` | `title` only. Times and zone are what people were told and what stations may already serve. |
| `closed`, `cancelled`, `archived` | Nothing. |

## Contract (exact)

All eight handlers are Gen 2 `onCall`, in `region: 'us-central1'`, with no `invoker`. They are signed-in only, and a source test asserts that `invoker` does not appear in the module.

### Authorization, read in every acting transaction

The caller must have an **active Founding Champion row of the Event's own community.** The row is read by document id `wsfMemberships/{groupId}_{uid}`. Its own `userId` and `groupId` fields must name the caller and that community, its `membershipStatus` must be `active` and its `role` must be `foundingChampion`. The community document must exist.

This is the same rule as `requireChampion` in `index.ts`.

**Writes** (create, update and the four transitions) also require `email_verified === true`, the organizer requirement `wsfCreateGoal` enforces. **Reads** (get and list) do not.

Nothing in a request can assign a role, name another account, or move an Event to another community or goal. Stray `role`, `uid`, `userId` and `createdByUid` fields grant nothing: create ignores them, and `wsfUpdateEvent` refuses any key outside its whitelist.

### Callables

| Callable | Request | Response |
|---|---|---|
| `wsfCreateEvent` | `{ groupId, goalId, title, startsAt, endsAt, timezone, requestId }` | `{ event: EventView, replayed: boolean }` |
| `wsfGetEvent` | `{ eventId }` | `{ event: EventView, goalActivity: { contributions: number, turns: number } }` |
| `wsfListEvents` | `{ groupId, goalId?, includeArchived?: boolean }` | `{ events: EventView[] }`, newest first. Archived Events appear only with `includeArchived: true`. |
| `wsfUpdateEvent` | `{ eventId, expectedVersion, requestId, title?, startsAt?, endsAt?, timezone? }` | `{ event: EventView, replayed: boolean }` |
| `wsfPublishEvent` | `{ eventId, requestId }` | `{ event: EventView, replayed: boolean, inFlight: null }` |
| `wsfCloseEvent` | `{ eventId, requestId }` | `{ event: EventView, replayed: boolean, inFlight: { queued, inProgress } }` |
| `wsfCancelEvent` | `{ eventId, requestId }` | `{ event: EventView, replayed: boolean, inFlight: { queued, inProgress } }` |
| `wsfArchiveEvent` | `{ eventId, requestId }` | `{ event: EventView, replayed: boolean, inFlight: { queued, inProgress } }` |

**Field rules:**

- `requestId` matches `^[A-Za-z0-9_-]{8,64}$`.
- `title` is trimmed and must be 2 to 120 characters.
- `startsAt` and `endsAt` are ISO 8601 strings, with `endsAt` strictly after `startsAt`. The window may last at most 31 days and must sit inside the goal's own `startsAt` and `endsAt`.
- `timezone` must be an IANA zone **name** such as `America/Chicago`, `Etc/GMT+5` or `UTC`. The name shape is checked before the runtime check, because the runtime also accepts raw offsets such as `+05:00`, which carry no daylight-saving rules.
- `expectedVersion` is an integer of at least 1.

`goalActivity` counts are for the **goal**, labelled as such, and never presented as counts for the Event's window. They use equality-only `count()` aggregates.

### `EventView`, the response whitelist

```ts
type EventView = {
  eventId: string; communityGroupId: string; goalId: string;
  eventScope: 'goal' | 'setup'; setupId: string | null;
  title: string; startsAt: string /* ISO */; endsAt: string /* ISO */; timezone: string;
  status: 'draft' | 'published' | 'closed' | 'cancelled' | 'archived'; version: number;
  createdAtMillis: number; updatedAtMillis: number;
  publishedAtMillis: number | null; closedAtMillis: number | null;
  cancelledAtMillis: number | null; archivedAtMillis: number | null;
  history: { op: 'create' | 'update' | 'publish' | 'close' | 'cancel' | 'archive'; status: EventView['status']; atMillis: number }[];
};
```

**No answer names an account.** `createdByUid`, `history[].byUid`, `history[].requestId`, `requests` and `lineId` are stored server-side only. A test scans every string in every answer for the creator's, a member's, a removed Champion's and the other community's Champion's uids.

### Idempotency

| Operation | A retried or duplicate request |
|---|---|
| Create | The Event id is `ev_` plus 24 characters of base64url sha256 over `(groupId, uid, requestId)`. A double tap or lost answer, **even when concurrent**, lands on the same Event, unchanged, with `replayed: true`. One document is written. |
| Update | The same `requestId` returns the settled Event with `replayed: true`. This check runs before the version check, so a retry carrying the old `expectedVersion` is not refused as stale. |
| Transition | The same `requestId`, or asking for the status the Event is already in, returns the Event unchanged with `replayed: true`. A racing duplicate publish is one history step, not two. |

Each Event remembers its last 50 request ids.

### Errors

| Code | Message | When |
|---|---|---|
| `unauthenticated` | `Sign in first.` | Any of the eight handlers, called signed out. |
| `failed-precondition` | `Verify your email before managing events.` | A write by an unverified account. |
| `permission-denied` | `Only a Champion of this community can manage its events.` | Create or list by anyone who is not an active Champion of that community. |
| `not-found` | `That event is not available.` | Get, update or any transition when the Event does not exist **or** the caller is not a Champion of its community. These are deliberately one answer, so a foreign Event is indistinguishable from a missing one. |
| `not-found` | `That goal is not part of this community.` | Create naming a goal of another community, or a missing goal. |
| `failed-precondition` | `That goal is closed.` | Create, or publish, against a goal that is not active. |
| `failed-precondition` | `That goal is not part of this community.` | Publish when the goal has since been moved or removed. |
| `invalid-argument` | `title must be 2..120 chars.` | The title rule above is broken. |
| `invalid-argument` | `startsAt must be a valid ISO 8601 timestamp.` | `startsAt` is not a valid ISO 8601 string. |
| `invalid-argument` | `endsAt must be a valid ISO 8601 timestamp.` | `endsAt` is not a valid ISO 8601 string. |
| `invalid-argument` | `endsAt must be strictly after startsAt.` | The window is empty or reversed. |
| `invalid-argument` | `An event can last at most 31 days.` | The window is longer than 31 days. |
| `invalid-argument` | `timezone must be a valid IANA identifier.` | The zone is not an IANA name, including a raw offset. |
| `invalid-argument` | `The event must fall within the goal's own start and end.` | On create or a draft time edit, the window falls outside the goal's window. |
| `failed-precondition` | `The event must fall within the goal's own start and end.` | On publish, the goal window no longer contains the Event. |
| `failed-precondition` | `That event has already ended.` | Publishing an Event whose end has passed. |
| `invalid-argument` | `requestId is required.` | The request id is missing or malformed. |
| `invalid-argument` | `expectedVersion is required.` | The version is missing or malformed. |
| `invalid-argument` | `groupId is required.` / `goalId is required.` / `eventId is required.` / `goalId is not valid.` | An id is missing or malformed. |
| `invalid-argument` | `Only title, startsAt, endsAt and timezone can be edited.` | An update names any other key, such as `goalId`, `communityGroupId`, `target`, `unit`, `status` or `createdByUid`. |
| `invalid-argument` | `Nothing to change.` | An update with no editable field. |
| `failed-precondition` | `This event changed. Refresh and try again.` | A stale `expectedVersion`. |
| `failed-precondition` | `Times and time zone are locked once an event is published.` | A time edit on a published Event. |
| `failed-precondition` | `This event can no longer be edited.` | An update to a closed, cancelled or archived Event. |
| `failed-precondition` | `An event that is {status} cannot be {published\|closed\|cancelled\|archived}.` | Any transition that is not allowed, e.g. `An event that is draft cannot be closed.` |
| `failed-precondition` | `This community has too many events to list right now.` | A list over more than 500 stored Events. See residuals. |

A refusal writes nothing. The tests compare documents and their `updateTime` before and after.

## Proof (emulator `demo-wsf-local`, synthetic accounts only)

| Run | Result |
|---|---|
| `wsf-event-lifecycle.test.ts` + `wsf-event-lifecycle-privacy.test.ts` | **30 / 30** |
| Full callable suite | **36 suites, 634 / 634** |
| Rules suite (unchanged rules) | **28 / 28** |
| Deploy-config | **17 / 17** |
| `tsc` (`npm run build`) | clean |
| Mutant battery, 32 mutants, both suites per mutant | **32 / 32 killed** |
| W4's survivors J10, J10b, J10 with J10b, J7, J18 (both suites) | **5 / 5 killed**, each by the test written for it |

### What each test pins

**Lifecycle suite (`wsf-event-lifecycle.test.ts`):**

- **Create, read, list:**
  - The answer is the whitelisted shape and names no account.
  - A duplicate or concurrent create is one Event.
  - The setup scope is snapshotted and equals `wsfEventContext`.
  - All four hand-edited divergences resolve to scope `goal`, exactly as the turn line does.
  - A list filtered by `goalId` over a community with Events on two goals returns exactly that goal's Events, an unknown goal returns none, and a malformed `goalId` is refused (W4 F3).
- **Field rules:**
  - 16 invalid inputs are refused with exact messages and nothing is written, including a raw offset as a zone.
  - A closed goal takes no Event, and a closed goal or an ended window cannot be published.
- **Enrollment helper:** `eventAllowsEnrollment` admits only a published Event that has not ended. It already admits before the Event starts.
- **Lifecycle:**
  - `draft` → `published` → `closed` → `archived`, with each step in history once.
  - Cancel from `draft` and from `published`.
  - Every illegal transition is refused by name.
  - A retried or racing duplicate is one step.
- **Edits:**
  - Version, replay and stale checks.
  - A draft edit that moves the window before the goal's start, after its end, or across its end is refused, and nothing is written (W4 F1).
  - A goal whose window is narrowed after the Event was made refuses publish, whether its new end falls before the Event's end or its new start after the Event's start, and the Event stays a version-1 draft (W4 F1).
  - Times locked on a published Event while title-only edits still work.
  - Closed Events are frozen.
  - An edit can never name the goal, community, target, unit, rules or status.
  - The goal is byte-identical after every operation.
- **Stations and in-flight places:**
  - A station works with no Event at all.
  - Close and archive keep a queued place, a running turn and a recorded replay exactly as they were.
  - A place queued after a setup claims the goal is counted.
  - A place queued on a setup line is still counted after that setup is closed.

**Privacy suite (`wsf-event-lifecycle-privacy.test.ts`):**

- **Refused for every operation, with nothing changed:**
  - a member;
  - a nonmember;
  - a removed Champion;
  - another community's Champion.
- A foreign Event is indistinguishable from a missing one.
- Another community's Champion cannot attach an Event to this community's goal.
- **Request fields grant nothing:**
  - Stray role and account fields grant nothing.
  - A membership row whose **own fields** name another account or another community grants nothing, even when its document id matches the caller. This is the E18 finding below.
- **A creator who is no longer a Champion gets nothing back.** A Champion creates an Event and is then removed or, separately, demoted to member. Retrying the **same** create request is refused with `permission-denied`, the answer carries no Event, and the Event document is unchanged (W4 F2).
- **Signed out and unverified:**
  - Signed out, all 8 operations are refused.
  - An unverified Champion can read but not write.
- No answer names an account.
- `index.ts` neither imports nor re-exports the module or any of the 8 names, and the module has no `invoker` and no `.delete(`.

### Mutants

Each mutant was applied to `src/eventLifecycle.ts` alone and run against both suites. The original was restored afterwards and confirmed with `cmp`.

| # | Mutant | Result |
|---|---|---|
| E1 | `isChampion` ignores the role | killed |
| E2 | `isChampion` ignores the membership status | killed |
| E3 | `eventForChampion` skips the Champion check | killed |
| E4 | Writes skip the verified-email check | killed |
| E5 | Transitions skip the from-status check | killed |
| E6 | The published time lock is removed | killed |
| E7 | Edits skip the version check | killed |
| E8 | Transition replay is disabled | killed |
| E9 | Create replay is disabled | killed |
| E10 | Edits accept unknown keys | killed |
| E11 | Create skips the goal-window check | killed |
| E12 | `createdByUid` leaks into the view | killed |
| E13 | Publish skips the goal-active check | killed |
| E14 | The list does not filter archived Events | killed |
| E15 | `inFlight` is stubbed to zero | killed |
| E16 | Create skips the goal-community check | killed |
| E17 | The IANA name-shape check is removed, so offsets pass | killed |
| E18a | The membership row's `userId` and `groupId` fields are ignored | killed |
| E18b | The membership row's `userId` field is ignored | killed |
| E18c | The membership row's `groupId` field is ignored | killed |
| E19 | `eventAllowsEnrollment` ignores the status | killed |
| E20 | `eventAllowsEnrollment` ignores the end | killed |
| E21 | Scope ignores the setup's status | killed |
| E22 | Scope ignores the setup's community | killed |
| E23 | `inFlight` counts only the snapshotted line | killed |
| E24 | `inFlight` counts only the current line | killed |
| E25 | `inFlight` double-counts one line | killed |
| E26 | Scope ignores the claim's status | killed |
| E27 | Scope ignores a setup with no frozen children | killed |
| E28 | Publish skips the ended check | killed |
| E29 | The list is served to non-Champions | killed |
| E30 | Closed and cancelled Events can be edited | killed |

**E18, found during this work:** the first battery had one survivor, E18, which drops the check that a membership row's own `userId` and `groupId` fields match. Every test row's fields happened to match its document id, so nothing could tell the difference. The privacy suite now seeds rows whose document id names the caller but whose fields name C1's Champion, or another community. With E18a, E18b and E18c applied, a borrowed or moved row would make a non-Champion a Champion; all three are now killed.

### W4 journey-QA finding (#394 comment 6061337130), remedied in the tests

W4 found the source correct, but five of W4's own mutants survived because three guards were unpinned. All three remedies are test-only; `src/eventLifecycle.ts` is byte-identical to the reviewed `9d0af6c5`.

| Finding | Mutant that survived | Pinned now by | Result |
|---|---|---|---|
| **F1.** The goal-window rule was tested on create only. | J10 (the draft-edit check removed), J10b (the publish check removed), and both together | `wsf-event-lifecycle.test.ts` › a draft edit that moves the window outside the goal is refused; a goal narrowed after creation refuses publish | all three killed |
| **F2.** A create replay was not tested against a creator who is no longer a Champion. | J7 (the replay answered before the Champion check) | `wsf-event-lifecycle-privacy.test.ts` › a creator who is no longer a Champion gets nothing back by retrying their own create, removed or demoted | killed |
| **F3.** The documented `goalId` filter on `wsfListEvents` was untested. | J18 (the filter ignored) | `wsf-event-lifecycle.test.ts` › a list filtered by goalId returns exactly that goal's Events | killed |

W4's J22, a request id replayed across different operations, was not counted by W4 and is not pinned here: clients mint a fresh id per operation, and the contract makes no promise about one id reused across operations.

## Integration handoff (`index.ts`, NOT edited here)

The packet keeps `index.ts` exports, admission and inventory as a separately reviewed single-owner integration. This section is handoff text only.

### 1. Exports: the minimal diff

Add this one statement to `functions-westayfit/src/index.ts`, at the end of the file, after `wsfCommunityActivity`:

```diff
+export {
+  wsfCreateEvent,
+  wsfGetEvent,
+  wsfListEvents,
+  wsfUpdateEvent,
+  wsfPublishEvent,
+  wsfCloseEvent,
+  wsfCancelEvent,
+  wsfArchiveEvent,
+} from './eventLifecycle';
```

There is no other source change. Measured on the built module, none of these names is already an export of `index.ts`, so there is no clash.

**Initialisation:** the module calls `getFirestore()` lazily inside handlers, after `index.ts` has already initialised the Admin app.

### 2. The same change must also update these tests

- **`wsf-event-lifecycle-privacy.test.ts` › the module is not live.** This test asserts that `index.ts` does not mention the module. It must be inverted by the integration, to assert the 8 names **are** exported. It is the guard against an accidental integration; it is not part of the contract.
- **`tests/deploy-config/sprint-w8-social-invoker.test.ts` style.** That test finds a callable's options by regex over `index.ts`'s own `export const X = onCall(` declarations, so it cannot see a re-export. If the integration adds the 8 names to a "never public" list, the check must read `src/eventLifecycle.ts` for them. The module declares `{ region: 'us-central1' }` with no `invoker`.

### 3. Inventory

The `westayfit` codebase currently has **59** callable exports, measured from the built `index.ts`. After the line above it has **67**: 8 new callables, all `us-central1` Gen 2, signed-in, with no `invoker` and no `minInstances`.

- `min-instances.test.ts` iterates every export, so it will cover the 8 automatically.
- Do not reuse an older count.

### 4. Admission (station enrollment), a decision for the integration owner

This module gates nothing. Stations, pairing and turns are unchanged, and a goal without an Event behaves exactly as today.

The module exports a pure predicate for an admission rule. `eventAllowsEnrollment(event, nowMillis)` is true only for a `published` Event that has not ended, including before it starts, so a station can be set up ahead of time.

If the owner wants Events to gate new station enrollment, the seam is the transaction in `wsfApproveStation`, after `requireChampion(tx, groupId, uid)`. A rule that keeps existing stations working would be:

> When the goal has at least one Event that is not `archived` (`tx.get` on `wsfEvents.where('goalId', '==', goalId)`, which is equality-only and needs no composite index), require one for which `eventAllowsEnrollment` is true. When the goal has no Event, change nothing.

Already-claimed stations and in-flight turns must not be re-checked. That is an owner decision with its own tests, and is deliberately not taken here.

### 5. Deployment needs once integrated

These apply to functions only:

- **Rules:** none. The catch-all already makes `wsfEvents` server-only.
- **Indexes:** none. Every query is equality-only on a single field: `communityGroupId`, `goalId` and `lineStatusKey`.
- **IAM:** none.
- **Packages:** none.

## Residuals (known, not fixed here)

1. **`wsfCreateGoal` still accepts raw offsets as a zone.** It is in `index.ts`, outside this scope. An Event refuses `+05:00` and the like. A goal created with an offset zone can still take an Event, whose own zone must be an IANA name.
2. **No admission gating yet.** See section 4 of the handoff. Until the integration decides, an Event is a lifecycle record and gates nothing.
3. **List is bounded at 500 stored Events per community, archived ones included.** Above that, `wsfListEvents` refuses with an explicit `failed-precondition` rather than silently truncating. Create has no per-community cap. Only a community's own Champion can reach this limit, and only for their own community.
4. **History grows with every edit and is never truncated,** because recorded history is preserved. At about 150 bytes an entry, an Event reaches Firestore's 1 MiB document limit after roughly 7,000 edits. The request-id memory is bounded at 50.
5. **`goalActivity` counts are for the whole goal, not the Event's window.** They are labelled `goalActivity` for that reason. A window-scoped count would need a range query, and so a composite index, which is out of scope.
6. **`inFlight` is read after the transition commits.** It is a report, not a lock. A place can join or finish between the commit and the count.
7. **Times without an offset are read as UTC, not in the Event's zone.** W4 noted this. `normalizeIso` accepts anything `new Date()` parses, so `2026-10-08T10:00` is read in the server's zone (UTC on Cloud Functions), not in `timezone`. This is the same parsing `wsfCreateGoal` already uses. The adapter should send `toISOString()` values.
8. **The snapshotted scope can drift.** W4 noted this. `eventScope` and `setupId` are taken at creation and go stale if a combined setup later claims or releases the goal. `inFlight` already counts both lines. The admission integration should resolve the live line, not the snapshot.
9. **An update replay returns the current Event,** not that request's own result. W4 noted this. It is settled-state idempotency, the same as the transitions.

## Boundaries kept

- No destructive delete.
- No public discovery or listing outside the community's own Champions.
- No promotion or raffle activation.
- No shadow ledger: the module never writes contributions or turns.
- No client-trusted role: the role is read from the server-side membership row.
- No mutation of another community.
- No package, rules, IAM, workflow or deployment change.
- No real events or accounts.
- Emulator only.
- Nothing is merged, staged or deployed by this worker.
