# EVERGREEN-MARKER-ENTRY-1 (phase A): the printed `/go/{slug}` visitor journey, QA record

| | |
|---|---|
| **Packet** | Queued #365 `5999079739` / `5999340795`. Released #365 `6027873710`. |
| **Phase-A reservation** | #497 `6028638316`, which approves 13 paths and **holds** the operator utility. |
| **Base** | `claude/wsf-app-shell@856e20e01416e99a8a09194c9d34cd463063b107`. |
| **Proof type** | Source only. Emulator `demo-wsf-local` only. Every fixture is synthetic. |

## What this adds

### Route `/go/<markerSlug>`

A reusable printed QR carries only `/go/<slug>`. The server resolves the slug to **one** community and **one** goal. The visitor then goes through one continuous screen:

1. **Resolve.** The screen shows the community, the featured goal and the goal's truthful state (`open` / `upcoming` / `ended` / `closed`).
2. **Before anyone moves, say what is needed.** A signed-out visitor is told to sign in and join first, then is returned to the same marker.
3. **Join explicitly.** A signed-in non-member taps **Join {community}**. That tap is the only write.
4. **Choose.** A member on an open goal gets **Move on my phone**, which opens the existing `/contribute/<goal>`. **Use a kiosk** appears only when the marker allows it.

### Server (`functions-westayfit/src/index.ts`)

- **`wsfResolveMarker`** (public, rate-limited on the preview bucket):
  - Returns the label, community name, goal id and title, goal state, kiosk mode and viewer.
  - Returns the community id only to an active member.
  - Never returns a join code, member, count or scan.
  - **Fails closed** with the generic not-found when any of these is true:
    - the slug is unknown or malformed;
    - the marker is inactive or malformed;
    - the community is missing, not link-joinable or not active;
    - the goal is missing or belongs to another community.
- **`wsfJoinViaMarker`** (signed in):
  - Applies the same gates in the same order as `wsfJoinCommunity`: verified email, then profile.
  - Re-resolves the marker inside the same transaction.
  - Runs **`admitByLinkTx`**, the join core extracted unchanged from `wsfJoinCommunity`. Removed members stay refused, departed members are reactivated, a second tap is idempotent, and the membership shape is unchanged.
- **`wsfMarkers/{slug}`** holds `{label, active, communityGroupId, goalId, kioskMode}`:
  - Phase A **only reads it**.
  - Clients cannot read or write it: the WSF rules catch-all denies the collection, and no rules change was made.
  - No real marker document exists. Tests seed emulator fixtures only.

### App

| File | What it does |
|---|---|
| `src/markerEntry.ts` | Slug rule (identical to the server's), the backend-neutral `MarkerResolver` boundary, and the pure `markerStep` / `markerWays`. Also the id-based return: it stores a **slug** and rebuilds `/go/<slug>`, never a URL. Return records expire after 2 h. |
| `src/pendingJoinCode.ts`, `src/authDestination.ts` | The marker return is the fourth destination, ordered **after** join, event and kiosk, so those three land exactly where they did before. Arming the marker return clears an older pending join code or event return. |
| `src/ui/MarkerEntryScreen.tsx`, `app/go/[markerSlug].tsx` | The screen and the route. Neither initialises Firebase at module load. |
| `firebase.westayfit.json`, `firebase.westayfit.emulators.json` | `/go/** → /go/__dynamic.html`. The two configs are pinned byte-equal by `tests/exported-head.test.ts`. |

## Kiosk modes

| `kioskMode` | What the member sees | Writes |
|---|---|---|
| `off` | No kiosk way at all: omitted, not disabled | none |
| `available` | **Use a kiosk** opens plain guidance: find a screen at the event and start from it; scanning saves no place and reserves no screen | none |
| `queue` | **Use a kiosk** opens the **existing** `/event/<goal>` screen, whose confirmed name is the only queue write | none, until that existing name confirm |

## Proof

**Callable suite:** `functions-westayfit/tests/callable/wsf-marker-entry.test.ts`, 22 tests.

- **What it covers:**
  - each fail-closed variant;
  - goal state on the server-time window;
  - viewer states, including removed and departed;
  - no join code in the response;
  - a scan writes nothing (membership, contribution, turn line, marker);
  - join gate order and messages;
  - idempotence, removed and departed;
  - repointing leaves both goal documents identical, and the next join follows the marker;
  - `wsfJoinCommunity` unchanged after the core extraction;
  - the rules name no `wsfMarkers` allowance.
- **Mutants:** four mutants each fail the suite:
  - goal/community check removed;
  - link-joinable check removed;
  - community id leaked to non-members;
  - ended window read as open.

**Unit suite:** `apps/westayfit/tests/marker-entry.test.ts`, 23 tests.

- slug rule and client/server parity;
- every viewer × goal-state step;
- kiosk omission, guidance and queue routes;
- tampered, future and stale returns are refused;
- the return order beside the three older destinations;
- a scan has no side effects: only the two callables, and one Join call from the explicit tap.

**Browser suite:** `apps/westayfit/tests-e2e/marker-entry.spec.ts`, 7 tests, passing twice in a row.

- a cold scan on a never-seen browser;
- signed out → sign in → back on the marker, with the return spent → explicit Join, with no membership before the tap → choose with kiosk off → phone opens `/contribute/<goal>`;
- an existing member with kiosk `available`: guidance only, no turn-member doc;
- kiosk `queue`: reaches `/event/<goal>` with no queue place;
- a closed goal: truthful, with no Start and an **Open {community}** link;
- inactive, unknown and malformed markers;
- a repoint changes what the same address opens and leaves goal A unchanged.

**Affected suites rerun:**

| Suite | Result |
|---|---|
| Callable: join-community, preview-community, admission-controls (with marker) | 62/62 |
| Deploy-config | 17/17 |
| Vitest: `exported-head` | 112/112 |
| Vitest: event-return, kiosk-session, marker-entry | 85/85 |
| Playwright: event-return, e2-join-flow, ui-event-activity-choice, d1-signup-single-navigation | 13/13 |
| Playwright: join-batch-b, ui-join-qr, d-admission-controls | 22/22 |
| `tsc` (app and functions) | clean |

## Frames (not committed; delivered with the handoff)

Produced by `WSF_MARKER_CAPTURE_DIR=… [WSF_MARKER_STAGE=BEFORE]` at 390×844 and 390×640.

- **ACTUAL BEFORE**, on the base build with the base Hosting config: `/go/<slug>` shows `Cannot GET /go/<slug>`. There is no route.
- **ACTUAL AFTER**:
  - signed out;
  - join;
  - choose with kiosk off;
  - choose with kiosk available (guidance open);
  - choose with kiosk queue;
  - closed goal;
  - invalid;
  - repointed.

## Not in this phase (follow-up gates)

- **Operator utility and repointing (HELD, #497 `6028638316`).** Out of scope here:
  - `app/ops/marker/[markerSlug].tsx`;
  - `wsfUpdateMarker`;
  - who counts as "staff";
  - revision history.

  An owner or security decision must first say how staff maps to identities.
- **Real `flag-01` configuration.** No real marker document exists anywhere.
- **Outside this packet:** the public domain `westay.fit/go/{slug}`, its forwarder or DNS, and any deploy. A product route is not proof that the printed link is live.
- **Lovable TARGET.** No issued target exists for this journey, so no parity claim is made. The screen uses the existing shell kit.
- **Device question.** The marker screen is phone-first and does not ask "whose screen is this". The kiosk `queue` path reaches the event screen, which still asks.
