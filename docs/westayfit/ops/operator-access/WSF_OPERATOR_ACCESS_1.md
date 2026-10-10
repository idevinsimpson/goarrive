# WSF-OPERATOR-ACCESS-1: who can run a WE STAY FIT event, and how the owner's account gets that right

**Authority:**
- queue #365 `6093846231`, release #365 `6093847482`;
- W9 wake `25ac1951`, ACK #497 `6094009666`;
- the owner requirement it answers is #365 `6093821312`.

**Base:** operational `main` `6e8acc31`.

**Source read:**
- `functions-westayfit/src/index.ts` at `ec162d17`, the commit `.github/wsf-staging/approved-candidate.json` pins for `westayfit-staging`. L0 records it as served.
- The same file at `8a067b29`, the development line, which contains `ec162d17`.
- Every claim below cites `file:line` at both commits, written **served / development**.

**Scope:** docs and one owner-run, read-only script. Nothing is granted, deployed or changed in any project. No email address appears anywhere in this packet.

## In one paragraph

WE STAY FIT has **one** operator right: being an **active `foundingChampion` of a community**.
- It is stored on the membership document, checked by the server on every Champion action, and scoped to that one community.
- There is no global admin, staff or operator role, and no custom claim.
- Whether the owner's verified account holds the right anywhere is **UNKNOWN**, because nobody has read it from the server. `audit-access.mjs` (section 5) is how the owner reads it, in their own Cloud Shell, without the address leaving their terminal.

The narrowest durable grant is that same right, obtained through the paths that already exist:
- **create the community from the verified account.** This path has a screen.
- **be designated by an existing Champion.** This path has no screen at either commit.

On production (`goarrive`) the WSF backend is not deployed, so there is nothing to provision there yet.

## 1. The authorization model

### 1.1 No global role

A search of `index.ts` at both commits finds no custom claim and no admin, staff or operator test. Its terms were `customClaims`, `setCustomUserClaims`, `token.admin`, `token.role`, `platformAdmin` and `isAdmin`, with 0 hits at each commit. Authority lives only on `wsfMemberships/{groupId}_{uid}`:

| Field | Values | Where |
|---|---|---|
| `role` | `foundingChampion` or `member` | the only role writes in the file: `foundingChampion` at create (`275` / `279`) and at designation (`1616` / `1628`); `member` at first join (`907` / `912`) |
| `membershipStatus` | `active`, `removed`, `departed` | constants `76-78` / `78-80` |

### 1.2 How an account becomes Champion

| Path | Gate | Writes |
|---|---|---|
| **Create a community**: `wsfCreateCommunity` (`197` / `200`) | a signed-in account with **`email_verified === true`** (`203-204` / `207-208`) and an existing profile | `role: 'foundingChampion'`, `membershipStatus: 'active'` for the creator (`275` / `279`) |
| **Designation**: `wsfDesignateChampion` (`1587` / `1598`) | the caller passes `requireChampion` (`1602` / `1614`). The target must already be an **active member** (`1607` / `1619`) and not already a Champion (`1610` / `1622`). | `role: 'foundingChampion'`, plus `designatedAt` and `designatedByUid` (`1616` / `1628`) |

Joining by link always writes `role: 'member'` (`907` / `912`). Nothing else writes a role.

### 1.3 How the right is checked

`requireChampion` (`1286-1303` / `1293-1310`) reads the group and the caller's own membership inside the caller's transaction. Each of the following answers with the same `notFound()` a missing community gives, so no Champion callable can be used to probe which communities exist:
- the group is missing;
- the membership is missing;
- the status is not `active`;
- the role is not `foundingChampion` (`1301` / `1308`).

Six callables inline the same test:
- `wsfCreateGoal` (`3220` / `3281`);
- `wsfSetGoalDisplayAuthorization` (`5189` / `5241`);
- `wsfAdjustGoal` (`5376` / `5429`);
- `wsfCreateCombinedGoal` (`6895` / `6998`);
- `wsfCloseCombinedGoal` (`7093` / `7197`) and `wsfRepairCombinedGoal` (`7296` / `7401`).

### 1.4 How the right is lost, and what brings it back

| Event | What it writes | The `role` field |
|---|---|---|
| **Removal** by another Champion: `wsfRemoveMember` (`1431`, gate `1449` / `1439`, gate `1458`) | `membershipStatus: 'removed'` and `removedByUid` | **untouched** |
| **Leaving**: `wsfLeaveCommunity` (`1485` / `1494`) | `membershipStatus: 'departed'` | **untouched** |
| **Reinstatement** of a removed member: `wsfReinstateMember` (`1536`, gate `1548`, write `1559` / `1546`, gate `1559`, write `1570`) | `membershipStatus: 'active'` and `reinstatedByUid` | **untouched**, so a removed Champion comes back **as Champion** |
| **Rejoin** through the link after leaving: `admitByLinkTx` (`876` / `881`) | `membershipStatus: 'active'` | **untouched**, so a departed Champion comes back **as Champion** |

**No callable demotes.** No path writes `role: 'member'` over a Champion. Removal and departure suspend the right, and they do not revoke it.
- This is a property of the source, recorded here and not changed (section 7, R1).
- The audit script prints such a dormant Champion row and says so.

### 1.5 The last Champion is protected

A community can never be left with no Champion:
- **`wsfRemoveMember`** refuses to remove the last active Champion (`1461` / `1470`).
- **`wsfLeaveCommunity`** refuses to let the last Champion leave (`1507` / `1517`).
- **Both count inside the transaction** (`countActiveChampionsTx`, `1324` / `1331`), so two Champions leaving or removing each other at once cannot both pass.
- **Tests:** `wsf-admission-controls.test.ts` `624`, `633`, and RACE 4a-4c at `488`, `518` and `538`.

The way out is designation, which `wsfDesignateChampion` exists for. Test: `wsf-admission-controls.test.ts:649`, "designation unblocks departure".

### 1.6 Every Champion-gated callable

Lines are export:gate, served / development. "WSF app" is `apps/westayfit`, the build the staging pin serves. Its call sites are identical at both commits.

| Callable | Served | Development | Where a Champion reaches it in the WSF app | Test that a non-Champion is refused |
|---|---|---|---|---|
| `wsfResetJoinCode` | `1356:1385` | `1363:1393` | Manage sheet (`community/[groupId]/index.tsx:1691`) | `wsf-admission-controls:147` |
| `wsfRemoveMember` | `1431:1449` | `1439:1458` | **no screen** | `wsf-admission-controls:633` (a removed Champion is refused). **No test has an active plain member call it** (R3). |
| `wsfReinstateMember` | `1536:1548` | `1546:1559` | **no screen** | `wsf-admission-controls:365` |
| `wsfDesignateChampion` | `1587:1602` | `1598:1614` | **no screen** | `wsf-admission-controls:664` |
| `wsfLeaveCommunity` (the last-Champion rule) | `1485:1507` | `1494:1517` | community screen (`index.tsx:1727`) | `wsf-admission-controls:624` |
| `wsfCreateGoal` | `3108:3220` | `3168:3281` | New goal (`goals/new.tsx:640`) | **none** (R3) |
| `wsfSetGoalDisplayAuthorization` | `5154:5189` | `5205:5241` | Manage sheet (`index.tsx:1813`) | `wsf-goal-pulse:534`, `:547`, `:560`; `wsf-package-e-member-access:566` |
| `wsfAdjustGoal` (counts and repeat policy, each with an audit row) | `5210:5376` | `5262:5429` | **no screen** | `wsf-adjust-goal:236`; `wsf-goal-repeat-policy:621` |
| `wsfApproveStation` | `6059:6101` | `6112:6155` | Manage sheet, "Screens at this event" (`index.tsx:1601`, `:2500`) | `wsf-station-enrollment:208` |
| `wsfListStations` | `6447:6466` | `6501:6521` | Manage sheet (`index.tsx:1544`) | `wsf-station-enrollment:460` |
| `wsfRevokeStation` | `6514:6535` | `6590:6612` | Manage sheet (`index.tsx:1638`) | `wsf-station-enrollment:460`; `wsf-station-turn-lifecycle:486` (development only) |
| `wsfCreateCombinedGoal` | `6799:6895` | `6901:6998` | community screen (`index.tsx:770`) | `wsf-combined-goal:365` |
| `wsfCloseCombinedGoal` | `7066:7093` | `7169:7197` | **no screen** | `wsf-combined-goal:1229` |
| `wsfRepairCombinedGoal` | `7261:7296` | `7365:7401` | **no screen** | `wsf-combined-correction-and-recovery:802` |

**Correction to the queue comment:** `wsfPublicPreviewLabel` (`1241` / `1248`) is **public** (`invoker: 'public'`), not Champion-gated. It returns a label only for a goal a Champion has display-authorized.

**The Manage entry is Champion-only on the client too.** The "Manage community" row is registered only when the loaded role is `foundingChampion` (`index.tsx:1405-1411`). The server gates above are the authority either way.

### 1.7 The station credential is not a person

**Pairing:**
1. A screen asks for a pairing code: `wsfStationRequestPairing` (`5968` / `6021`), no account.
2. A Champion approves the code for one goal, as Station 1 or 2. `wsfApproveStation` applies `requireChampion`, and `STATION_SLOTS = [1, 2]` (`5729` / `5782`).
3. The screen claims a secret: `wsfStationClaimPairing` (`6205` / `6259`).

**Every station call** passes `authorizeStationForTurn` (`8304` / `8431`): the station document must be `active` (`8324` / `8451`) and the secret's hash must match (`8325` / `8452`). The station is bound to its one `goalId`.

**What it authorizes:** that event's turn operations only:
- `wsfTurnState` (`9091` / `9293`);
- `wsfCallNext` (`9138` / `9340`);
- `wsfStartTurn` (`9335` / `9537`);
- `wsfCompleteTurn` (`9660` / `9862`);
- `wsfCancelTurn` (`9793` / `9996`).

**The two credentials are separate.** A station secret passes no Champion gate, and a Champion's account is not a station credential. Revocation ends a station on its next call (`wsf-station-enrollment:481`).

At development only (KIOSK-TURN-LIFECYCLE-1), a revoke also returns the screen's live turn to the line. At served, it does not.

### 1.8 Served versus development, where it matters here

- **Anonymous accounts.**
  - At development, `requireRealIdentity` refuses an anonymous token on every signed-in callable, every Champion action included.
  - At served there is no such gate. Every Champion callable still needs an active `foundingChampion` membership, but `wsfDesignateChampion` does not check the target's verification. So at served, a Champion can designate an unverified or anonymous member.
- **Revoke and the turn line:** see 1.7.

## 2. The gaps against the owner's requirement (`6093821312`)

- **EXISTS:** the server callable is in both commits, with where it sits.
- **MISSING:** no server path. The row names the held packet, or says none exists.
- **NOT APPROVED:** built, but not approved to wire.

**Lovable Web Twin.** This repository holds only its proof drivers.
- They record a "Manage community UI" where a Champion approves a kiosk code (`.github/wsf-staging/hosted-lovable-kiosk.mjs:203`). That row is not driven: the proof approves through a callable, `:212`.
- They also record the routes `/`, `/display/$goalId` and `/kiosk/$communityId/$goalId` (`:158`).
- W9 did not read the Lovable source, because KME-WIRE-1 is the sole Lovable lane. Every other Lovable placement is **not verified here**.

| # | The owner asked for | Status | Where, or what is missing |
|---|---|---|---|
| 1 | Audit actual access: the verified UID, memberships, roles, the permission model; PROVISIONED, NOT PROVISIONED or UNKNOWN from server evidence | **EXISTS (this packet)** | The model: section 1. The account: `audit-access.mjs`, run by the owner per project (section 5). Until it runs, the answer is **UNKNOWN**. |
| 2 | Provision the narrowest durable WSF-scoped right to that verified UID through an audited path; no email hardcode, override, global claim or GoArrive elevation | **EXISTS (paths), not done** | Section 3. Path A: create from the verified account (screen: `start-community.tsx:377`). Path B: designation (server only, **no screen**). No grant is made by this packet. |
| 3a | A discoverable Manage entry for the authenticated owner, not a kiosk tab | **EXISTS** | WSF app: the "Manage community" menu row, Champion-only (`index.tsx:1405-1411`). Lovable: a "Manage community UI" is recorded but not proven. |
| 3b | Select or create an event in an eligible community | **EXISTS** for goals | An "event" in the served backend is a goal, or a combined goal over 2 to 6 goals. `wsfCreateGoal` (screen `goals/new.tsx:640`); `wsfCreateCombinedGoal` (screen `index.tsx:770`). There is no event object of its own: that is #595. |
| 3c | Define or review the goal, rules, target, timezone, window and visibility | **EXISTS at create; MISSING after** | Create takes title, target, unit, `startsAt`, `endsAt`, IANA `timezone`, `activityGuideKey` and `repeatPolicy`. Afterwards, only the repeat policy can change (`wsfAdjustGoal`, no screen). Editing the target, window or title: **MISSING, no packet exists**. Visibility of the shared display: `wsfSetGoalDisplayAuthorization`, EXISTS with a screen. A community's join policy cannot be changed after create: **MISSING, no packet exists**. |
| 3d | Create, publish, start, pause, close or return to an event | **MISSING** | Not in the served backend. Held as EVENT-LIFECYCLE-BACKEND-RECOVERY-1, #595 (its `eventLifecycle.ts` is unexported), behind the security seat. A single goal ends only at its `endsAt`. A combined goal can be closed: `wsfCloseCombinedGoal` (`7110` / `7214`) EXISTS, with no screen. |
| 3e | Invitation and QR | **EXISTS**; markers **MISSING** | The community join link and QR are in the Manage sheet. `wsfResetJoinCode` EXISTS with a screen. A printed reusable marker (`/go/{slug}`) has **no writer** at either commit (`967` / `973`: "no callable here creates or edits `wsfMarkers`"). Who may repoint one is an open owner and security decision, with no packet. |
| 3f | Attach independent stations through pairing and revocation | **EXISTS** | `wsfApproveStation`, `wsfListStations` and `wsfRevokeStation` in the Manage sheet. The station screen is `/station/[goalId]`. At most two stations per goal (slots 1 and 2). |
| 3g | Oversee the queue and station turns | **Station: EXISTS. Owner's phone: MISSING** | Turn operations run on the station screen under the station credential (1.7). There is no callable that shows a Champion the line or lets them act on it from their own account. No packet exists. |
| 3h | Corrected contributions through an audited path | **EXISTS (server); MISSING (screen)** | `wsfAdjustGoal` writes an immutable, attributed audit row. `wsfRepairCombinedGoal` repairs a combined goal. Neither has a screen. No packet exists for one. |
| 3i | A separately approved raffle module | **NOT APPROVED** | `functions-westayfit/src/expo-prize/` exists at both commits and is deliberately not exported (`expo-prize/index.ts:4-6`). Wiring it is a separate, reserved, reviewed step. |
| 3j | Controls permission-gated server-side; hidden and denied for members | **EXISTS** | Every gate in 1.6. The denial tests are in section 4.2, with two untested gates (R3). |
| 4a | Run a later event without developer help | **MISSING in part** | Single-goal events can be set up end to end in the WSF app. Lifecycle (3d), editing (3c), corrections (3h) and Champion designation have no screen. |
| 4b | A small operational runbook | **MISSING** | None exists. This document maps access; it is not that runbook. |
| 4c | Understandable errors and status | **EXISTS in part** | The station screen's answers come from #564, #587 and #596. No operator-wide status view exists. |
| 4d | Safe reset of visitor sessions without resetting totals | **EXISTS** | Kiosk mode's Finish signs the visitor out and clears the kiosk keys. The staging harness checks this: "kiosk mode (W9)", `.github/wsf-staging/hosted-package-e-smoke.mjs:1439`. No callable resets a total; corrections go only through `wsfAdjustGoal`. |
| 4e | Verify sign-in, setup, two stations, phone, shared display, close and history | **EXISTS except close** | The hosted turn-service contract, two stations (`hosted-package-e-smoke.mjs:2021`). Durable history (`:1319`). Close: see 3d. This packet ran no hosted proof. |
| 5 | Sequence without collisions: KME-WIRE-1 stays the sole Lovable writer; one bounded packet | **EXISTS** | This is that packet. It touches only its three reserved files. |
| 6 | Evidence tiers kept separate; owner-path and member-denial tests; no new data collection, publishing, activation or change | **EXISTS** | Section 6 lists the tiers. The script reads only and stores nothing. |

## 3. The narrowest durable grant

**The right:** an active `foundingChampion` membership in the one community the owner operates.
- **Durable:** a stored document, independent of any session or device.
- **Scoped:** one community.
- **Server-enforced:** 1.3.
- **Attributed:** `createdByUserId`, `designatedByUid`, `removedByUid`, `reinstatedByUid`.

**Path A: create it** (has a screen, today).
1. The owner signs in with the verified account.
2. They choose Start a community (`start-community.tsx:377`).
3. The server requires `email_verified` (1.2), so the address must already be verified.
4. The owner is then the community's first Champion, and the Manage sheet appears for them alone.

**Path B: be designated** (server only, today).
1. An existing Champion of the community designates the owner's account.
2. The account must already be an active member: it joins through the link first.
3. `wsfDesignateChampion` has **no screen at either commit**. Today it can only be called from the existing Champion's own signed-in session, and this repository offers no supported tool for that.

A designation screen in the Manage sheet would be a small app packet, if L0 wants one.

**Not proposed:**
- a new role;
- a custom claim;
- an email allowlist, or any email in code;
- a browser-side override;
- a GoArrive change;
- a direct Admin SDK write to `wsfMemberships`. That "bootstrap" write would bypass the audited callables and their attribution, and would need its own security review.

**Cross-community operator rights.** Operating every community without a membership in each would be a **new backend role**. It needs its own security-reviewed packet, deciding:
- where the role lives;
- who grants and revokes it;
- how it composes with `requireChampion`'s not-found boundary;
- what it must never see, such as member privacy settings, which a Champion cannot override either (`wsfSetCommunityVisibility`, `9984` / `10187`).

No design is offered here.

**Production (`goarrive`).** The WSF backend is not deployed there. The deploy runbook is `docs/westayfit/ops/production/RUNBOOK_WSF_PRODUCTION_DEPLOY_1.md`, not yet run. So no WSF right can take effect, and the audit reports exactly that. After a deploy, Path A on production is the same act.

## 4. Proofs on staging

### 4.1 The owner path (which screens show a Champion the controls)

| Step | Screen in the WSF app | Champion-only because |
|---|---|---|
| Open the controls | Community Home, then the top-bar menu, then **Manage community** (`index.tsx:1405-1411`) | the row is registered only when the loaded role is `foundingChampion` |
| Join link and QR; reset the code | Manage sheet (`index.tsx:1691`) | `wsfResetJoinCode` gate |
| Shared display on or off | Manage sheet, one switch per goal (`index.tsx:1813`, `:2272`) | `wsfSetGoalDisplayAuthorization` gate |
| Screens at this event: list, approve a code as Station 1 or 2, turn off | Manage sheet (`index.tsx:2500`; calls `:1544`, `:1601`, `:1638`) | `requireChampion` |
| New goal; combined goal | `goals/new.tsx:640`; `index.tsx:770` | inline role checks |
| The station itself | `/station/[goalId]` shows its code; a Champion approves it in Manage | the station credential (1.7) |

**The hosted harness** drives this on staging. Its source is on `main`:
- `.github/wsf-staging/hosted-package-e-smoke.mjs`: `openManage(champion)`, and the checks that a member has no Manage row, no legacy control and no open sheet (`:493-517`);
- its contract test, `.github/wsf-staging/tests/hosted-smoke-contract.test.mjs:79` and `:148`.

This packet ran no hosted proof. The results of those runs are L0's to cite.

### 4.2 Member denial (callable tests, cited and re-run)

The tests in the "Test that a non-Champion is refused" column of 1.6 prove the refusals. W9 re-ran their suites on the emulators (`demo-wsf-local`, firebase-tools 15.30.1):

| Commit | Suites | Result |
|---|---|---|
| `ec162d17` (served) | `wsf-admission-controls`, `wsf-adjust-goal`, `wsf-goal-repeat-policy`, `wsf-goal-pulse`, `wsf-station-enrollment`, `wsf-combined-goal`, `wsf-combined-correction-and-recovery`, `wsf-package-e-member-access`, `wsf-create-community`, `wsf-kiosk-expected-turn` | **229/229** in 10 suites |
| `8a067b29` (development) | the same 10, plus `wsf-station-turn-lifecycle` | **246/246** in 11 suites |

Two gates have no denial test (R3):
- `wsfCreateGoal`'s role check (`3220` / `3281`);
- an active plain member calling `wsfRemoveMember`.

Both are correct in the source. Neither is proven by a test.

## 5. The owner-run audit: `audit-access.mjs`

**What it does.** It reads one account's WSF access in one project and prints a non-identifying report.

**What it never does:**
- write anything (Firestore, Auth, files);
- print, log or store the address;
- print more than the first 6 characters of the uid.

**Run it in Cloud Shell, once per project:**

```sh
mkdir -p ~/wsf-operator-audit && cd ~/wsf-operator-audit
npm init -y >/dev/null
npm install firebase-admin@12.7.0
curl -fsSLO https://raw.githubusercontent.com/idevinsimpson/goarrive/main/docs/westayfit/ops/operator-access/audit-access.mjs
node audit-access.mjs westayfit-staging
node audit-access.mjs goarrive
```

- **The address:** the script asks for it at a prompt and **does not echo it**.
  - There is no flag, environment variable or file for it.
  - A piped stdin is refused.
  - It is used for one Auth lookup.
  - Every output line also passes through a redaction step, as a second guard.
- **The project:** exactly `westayfit-staging` or `goarrive`. Anything else is refused before any read.
- **Credentials:** the Cloud Shell account's own.
  - If the Admin SDK reports that default credentials cannot be found, run `gcloud auth application-default login` and run the script again.
  - Each request names the project as its quota project. The Admin SDK does this from `projectId` (firebase-admin 12.7.0, `lib/utils/api-request.js:795-799`), and the functions list sets the header itself.
- **Permissions:** the owner's own project role suffices. A refusal is printed by its code, never by its message.

**What it reads:**

| Read | Kind | Prints |
|---|---|---|
| Cloud Functions in `us-central1` | one `GET`, paged | whether any `wsf*` function exists: present, absent or unknown |
| The Auth user for the typed address | `getUserByEmail` | `emailVerified`, `disabled`, the uid's first 6 characters, and the provider ids. Never a provider entry, whose uid can be the address itself. |
| `wsfMemberships` where `userId == uid` | query | each `groupId`, `role` and `membershipStatus`, exactly as stored |
| `wsfCommunityGroups/{groupId}` | get | `displayName`, quoted |
| `wsfGoals` where `communityGroupId == groupId`, for active Champion memberships only | query | each goal's id, title (quoted) and status |

Both writers that create a membership set `userId`: create at `274` / `278`, and first join at `906` / `911`. Every other membership write merges into an existing document. So the query finds every membership.

**The result line is one of:**
- `PROVISIONED`: the account is an active `foundingChampion` of N communities, and the backend is present.
- `NOT PROVISIONED`, with the reason: no account, a disabled account, no WSF backend, or no active Champion membership.
- `UNKNOWN`: something could not be read.

A dormant Champion row (removed or departed, role kept) is printed and explained, and it never counts. An unverified Champion is told which create callables will refuse them.

**Before pasting on #365:** the output holds community names and goal titles, which are the owner's own. Review them before pasting. L0 records PROVISIONED or NOT PROVISIONED per project from the paste.

**Exit codes:**
- `0`: a result was reached;
- `3`: UNKNOWN;
- `2`: a usage or refusal;
- `1`: stopped;
- `130`: cancelled at the prompt.

## 6. Evidence

| Tier | What | Result |
|---|---|---|
| Source | Every `file:line` above, read at `ec162d17` and `8a067b29` | cited |
| Unit, no network | `node --test docs/westayfit/ops/operator-access/audit-access.test.mjs` | **23/23** |
| Mutants | 35 behaviour mutants and 9 write or leak injections, each run against a scratch copy | **44/44 killed** |
| Real Admin SDK, emulators only | firebase-admin 12.7.0 against the Auth and Firestore emulators, project `demo-wsf-local`, synthetic labelled fixtures. Three cases: a Champion, a missing account, and a member with no backend. | expected output in all three; emulator documents and users **unchanged** before and after; no address or full uid in any output |
| Real terminal | the CLI driven through a pseudo-terminal, typing a synthetic address. Run twice: without the SDK, and with firebase-admin 12.7.0 pointed only at an unreachable local host, with no credential. | without the SDK, it stops before the prompt. With the SDK: a hidden prompt, then `UNKNOWN` by error code (exit 3). Neither transcript holds the address. |
| Auth and permission tests | the cited callable suites on the emulators (4.2) | **229/229** served, **246/246** development |
| Hosted, device | none run by this packet | — |

The unit tests prove that:
- no Firestore or Auth write method is ever called. The fake's write methods throw and are recorded.
- the source has no write call, file write, environment read or non-GET request;
- the address never reaches stdout or stderr, even when an error message, a community name or a goal title carries it;
- only the 6-character uid prefix is printed;
- roles and statuses print exactly;
- only an active `foundingChampion` is operable;
- a missing account, a missing backend and an unreadable backend each give an honest result;
- the prompt does not echo, and the CLI has no email flag and refuses a pipe.

## 7. Residuals for L0 (named, not changed here)

- **R1. Champion is suspended, not revoked.** Removal and departure keep `role: 'foundingChampion'`, and reinstatement or a rejoin restores it (1.4). No callable demotes. If a removed Champion should come back as a member, that is a backend packet.
- **R2. Champion actions with no screen:** `wsfDesignateChampion`, `wsfRemoveMember`, `wsfReinstateMember`, `wsfAdjustGoal`, `wsfCloseCombinedGoal` and `wsfRepairCombinedGoal`. Path B of section 3 depends on the first.
- **R3. Two gates with no denial test:** `wsfCreateGoal`'s role check, and `wsfRemoveMember` called by an active plain member. A test-only packet would close both.
- **R4. The queue comment lists `wsfPublicPreviewLabel` as Champion-gated;** it is public (1.6).
- **R5. At served, a Champion can designate an unverified or anonymous member** (1.8). At development, the anonymous half is closed by the anon gate.
