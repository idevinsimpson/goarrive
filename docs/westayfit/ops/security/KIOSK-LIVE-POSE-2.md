# KIOSK-LIVE-POSE-2 — live pose over the Realtime Database

**Authority:**
- queue #365 `6105637770` and release #365 `6105638191`;
- the ACK, #497 `6105945912`;
- L0's answer, #497 `6105996490`: two PRs delivered once, and Q1 = (b);
- **production:**
  - the owner's approval and L0's decisions D1 and D2, #365 `6109245392`;
  - D3′, #365 `6109490508`;
  - KIOSK-LIVE-POSE-PROD-1, release #365 `6109578489`;
- the handback: W3's finding #622 `6106926401` (F1, F2, O1, O2), L0's order #497 `6107098164`, QA #365 `6107090207`.

**What it does.** During a station turn, the member's phone counts reps with its camera, using the existing counter unchanged. The paired kiosk has no camera. It shows that member's stick figure live, with the same rep count and countdown. The frames travel through the Realtime Database under a per-turn capability key.

**What this packet is not:**
- There is no client code here. The phone that writes frames and the kiosk that draws them are later work.
- It deploys nothing. Staging gets it when L0 deploys the repin that carries the code PR, together with the ops PR.
- **Production ships dark from this packet alone:** KIOSK-LIVE-POSE-2 sets no production switch. KIOSK-LIVE-POSE-PROD-1 adds the production path (section 7).

**Where the code is.** Line numbers are at the code PR head `87b48fa8`, on `claude/wsf-app-shell`. That PR holds:
- `functions-westayfit/src/live-pose.ts`;
- the wiring in `functions-westayfit/src/index.ts`;
- `database.westayfit.rules.json`;
- the emulator config;
- the tests.

The ops PR holds the staging config, the deploy step, the env writer and this doc.

KIOSK-LIVE-POSE-PROD-1's ops PR holds:
- the production pre-flight's env check and its record L;
- the production runbook's section "Live pose (production)".

## 1. Data inventory

| What | Where | Written by | Read by | How long it lives |
|---|---|---|---|---|
| `meta = { writerUid, expiresAt }` | RTDB `/wsfLivePose/{key}/meta` | The server only (Admin SDK), once, right after the turn starts (`live-pose.ts:207`, called from `index.ts:9845`). | No client, ever. Only the rules read it. | Deleted when the turn leaves `active`, or by the lazy delete after `expiresAt` (section 4). It stops working at `expiresAt` = turn start + 120 s. **In the cases in section 11 it is never deleted:** it stays, inert, with the member's uid in `writerUid`. |
| `frame = { seq, t, p, rep }` | RTDB `/wsfLivePose/{key}/frame` | The member whose turn it is, signed in with a non-anonymous provider, until `expiresAt` | Anyone holding the key, until `expiresAt`. In practice, the serving station's kiosk. | Deleted with its key node. Where `meta` stays (section 11), the last frame written stays with it. |
| `poseKey`, `poseExpiresAt` | Firestore `wsfTurnEntries/{entryId}` | The server, at start (`index.ts:9813`) | Server only. The collection has no client rule and falls to the catch-all deny. | Removed on every path out of `active` (`clearedPoseFields`, `index.ts:8187`). |
| `serving.poseKey`, `serving.poseExpiresAt` | Firestore `wsfKioskStations/{stationId}` | The server, at start (`index.ts:9817`) | Server only (catch-all deny) | Gone when `serving` is cleared or replaced, and deleted by a Record (`index.ts:10003`). |
| `livePoseKey` | Firestore `wsfKioskStations/{stationId}` | The server, at start (`index.ts:9819`) | Server only | Cleared only after the key's node is confirmed deleted (`live-pose.ts:170`). This is how a failed delete gets retried. |
| `livePose: { key, expiresAt }` | The `wsfMyTurn` answer | — | The member whose own turn is `active` (`index.ts:9227`) | Null otherwise. |
| `livePose: { key, expiresAt }` | The `wsfTurnState` answer | — | The station serving that turn, by station secret (`index.ts:9457`) | Null otherwise. |
| A failure log line | Cloud Logging | `[wsfLivePose] <operation> failed <error code>` (`live-pose.ts:145`) | Operators | Never a key, a uid or a name. |
| The SDK's warning on a write the server refuses | Cloud Logging | `FIREBASE WARNING: update at /wsfLivePose failed: <status>`, written by the Realtime Database SDK itself | Operators | Never a key: every write is an `update()` at `/wsfLivePose` with the key in its child path, so the path the SDK prints holds none (W3 F1; `live-pose.ts:105`, `:156`, `:227`, `:230`). |

**What `frame` holds.** `p` is 13 landmarks packed into 65 bytes, base64url, so 87 characters. Each landmark is a uint16 x (0..1000), a uint16 y (0..1000) and a uint8 visibility (0..100), big-endian. The order is fixed: nose, L/R shoulder, L/R elbow, L/R wrist, L/R hip, L/R knee, L/R ankle.

**What `frame` never holds:**
- no image, video, name or uid;
- `meta`, which holds the uid, is never readable by a client.

**The key:**
- 32 CSPRNG bytes, base64url, 43 characters (`live-pose.ts:65`);
- it never goes in a URL or a QR code;
- the server sends it only in the two answers above, over the callable's TLS. It is stored only in the server-only Firestore fields above, and it is the name of its own node;
- **no log line carries it** (W3 F1). This module logs an operation and an error code. The SDK logs a refused write as `<set|update> at <path> failed`, path included, so no write here is made at a path that holds a key. The SDK's debug log, which prints values, is off unless `enableLogging` is called, and nothing calls it. A test refuses real writes through the module's own code and checks every `console.warn` and `console.error` line for the key and the uid.

## 2. The rules (`database.westayfit.rules.json`)

- **The root denies everything** (`.read: false`, `.write: false`).
  - Nothing grants a read at `/wsfLivePose` or `/wsfLivePose/$key`, so keys cannot be listed and a key node cannot be read whole.
  - `meta` has no rule at all, so no client can ever read or write it.
- **`frame` `.read`:** `meta/expiresAt > now`. It is unauthenticated: the 256-bit key is the capability.
- **`frame` `.write`:** every one of these must hold:
  - `newData.exists()`: a client cannot delete a frame, which would reset the ordering checks;
  - `auth != null`;
  - `auth.token.firebase.sign_in_provider` is a non-empty string, and not `'anonymous'`;
  - `auth.uid === meta/writerUid`;
  - `meta/expiresAt > now`.
- **`frame` `.validate`** applies to the whole frame after the write:
  - exactly `seq`, `t`, `p` and `rep` (`$other` is `false`);
  - and, when a frame is already stored, `seq` strictly greater than the stored one and `t` at least 50 ms after the stored one. That caps an honest client at 20 Hz.
  - Because this rule sees the whole frame, a write to one field alone (`frame/p`) or a partial `update` is refused too.
- **The fields:**
  - `seq`: an integer, 1..2^31−1;
  - `t`: an integer, 0..120000;
  - `p`: a string of exactly 87 characters from `A–Z a–z 0–9 _ -`;
  - `rep`: an integer, 0..9999.

**Where this is narrower than the queue text** (each is tested):
1. `t` ≤ 120000, the key's own lifetime. `t` is claimed by the client, so the 20 Hz cap only binds an honest one. This bound limits a dishonest writer, who can only be the member themselves, to at most 2,401 frames per key.
2. The provider claim must be present and non-empty. A bare `!== 'anonymous'` would pass a token with no claim. Real Firebase tokens always carry it, so this only closes the gap.
3. A client cannot delete `frame`, or write one field of it alone. Either would step around the `seq` and `t` checks.

## 3. Who receives the key

| Answer | Gets the key when | Code |
|---|---|---|
| `wsfMyTurn` | the switch is on, the caller's own entry is `active`, and the key has not expired | `index.ts:9227` |
| `wsfTurnState` | the switch is on, and this station serves the entry: `serving` names it, `assignedStationId` and `attemptStationId` are this station, it is `active`, `serving.poseKey` equals the entry's key, and the key has not expired | `index.ts:8725`, `:9457` |

**Nothing else ever returns it.**
- `wsfCallNext`, `wsfStartTurn`, `wsfCompleteTurn` and `wsfCancelTurn` share `readTurnState`, which stays exactly as it was. `wsfTurnState` alone reads the detail (`readTurnStateDetail`, `index.ts:8656`) and adds `livePose`.
- Every other field of both answers is unchanged. The only addition is `livePose` (null while the switch is off).
- Two existing tests that pinned `wsfTurnState`'s key set at five now pin six, and assert `livePose === null` with the switch off.

## 4. Lifetime: every path out of `active` deletes the key

Every delete runs after the commit. Each is best effort and logged, and none of them fails a turn operation. `expiresAt` already makes a stale key unreadable and unwritable.

**Every Realtime Database call is bounded by a 3 s deadline** (`live-pose.ts:126`). The SDK queues a write it cannot send and never settles it while the database is unreachable. Without the deadline, a Record or a Cancel whose Firestore commit had already succeeded would wait until the function timed out.

**The deadline does not cancel the write.** The SDK keeps it queued and may deliver it later (W3 F2). For a delete, a late delivery is harmless. For `meta`, it could recreate a node after the turn's own delete, so arming is confirm-or-delete (below).

| Path | Code |
|---|---|
| The Record, from the station (`wsfCompleteTurn`) or the phone (`wsfCompleteMyTurn`), through the shared `completeTurnEntry` | `index.ts:9968`, `:9973`, `:10036` |
| `wsfCancelTurn` | `index.ts:10286`, `:10298` |
| `wsfLeaveTurnLine`: leaving, or switching to the phone. **Added beyond the queue's list:** it is a path out of `active`. | `index.ts:9388`, `:9420` |
| Revoke and requeue (KIOSK-TURN-LIFECYCLE-1): the returned turn loses its key, and the station's recorded key goes too | `index.ts:8831`, `:6694`, `:6698`, `:6721` |
| Station removal or unpair: `wsfRevokeStation` is the only such path | as above |
| Expiry, or an orphan, deleted lazily by `wsfTurnState` and `wsfStationState` | `index.ts:8747`, `:9458`, `:6458` |

**How a station's key is tracked.**
- `serving` is replaced on every call and cleared on cancel, leave and revoke, so it cannot remember an old key. The station therefore records `livePoseKey`.
- That record is cleared only after the delete succeeds. The next poll that sees it retries a failed delete. The sweep costs nothing on a poll that has no recorded key.

**A new key replaces the station's old one.** At start, the start's transaction moves the station's pointer to the new key. After the commit, `armPoseKey` (`live-pose.ts:207`) does three things in order:
1. deletes the earlier key;
2. writes `meta`;
3. re-reads the entry. If the turn ended in the window between the commit and `meta`, it takes the new key down. That turn's own delete would have found nothing to delete.

**Arming is confirm-or-delete.** Unless step 3 confirms the turn, the key's node is taken down:
- **`meta` fails or misses its deadline** (`live-pose.ts:230`): the delete is queued at once behind it, on the same connection. The SDK sends one connection's writes in order, and the server applies them in order, so whenever that `meta` lands, the delete lands after it. It is not awaited, because waiting changes nothing about the order and would hold the start for another deadline.
- **The confirmation cannot be read** (`live-pose.ts:237`): the node is deleted.

**Tested on the real SDK** (W3 F2, QA `6107090207` item 1): the functions' connection goes offline, so `meta` is held past the 3 s deadline; then it comes back and every queued write lands. A control `meta`, written the same way with nothing queued behind it, stays: that is the orphan. The armed key leaves no node.

## 5. Never a contribution

- No completion path reads the Realtime Database, a frame, `rep` or the key.
- The number a turn records is the Record's, through `performContribution`, exactly as before.
- **Tested:** with `frame.rep = 999` written through the rules, a Record of 7, from the station and from the phone, gives the same results as a twin turn with no frame at all:
  - the answer;
  - the receipt;
  - the contribution;
  - the member total;
  - the entry's result.
- **Statically:**
  - `index.ts` never touches the Realtime Database;
  - `live-pose.ts`'s only Realtime Database operations are three `update()` calls at `/wsfLivePose`: the `meta` write, the delete, and the delete queued behind a `meta` write that missed its deadline. Nothing reads.

## 6. The switch `WSF_LIVE_POSE`

**Only the exact string `"1"` turns it on** (`live-pose.ts:61`). It is read on every call. Anything else, including `"true"`, `" 1"` and unset, means:
- no key is minted;
- `livePose` is `null` everywhere;
- nothing touches the Realtime Database, deletes included;
- the SDK is not even loaded, because `live-pose.ts:105` loads it on first use.

**Staging** sets `"1"` through `.github/wsf-staging/write-functions-env.mjs`. It is a constant there, not an input, and the writer configures `westayfit-staging` only.

**Production** sets the switch only through the env line `WSF_LIVE_POSE=1`, in the production runbook's section "Live pose (production)" (KIOSK-LIVE-POSE-PROD-1).
- The production pre-flight admits exactly that bare line, or no line at all, which means off.
- It refuses a quoted `"1"`, `0`, `true`, an empty value and a second line.
- The staging writer never configures production.

**Switching off during a live turn:** the key stops being handed out at once. Its node stays, inert, until it expires, because no write happens while the switch is off.

## 7. Config and deploy

- **`firebase.westayfit.staging.json`:** adds `"database": { "rules": "database.westayfit.rules.json" }`. firebase-tools then targets `<project>-default-rtdb`, and the Admin SDK derives the same URL from the project id (`live-pose.ts:88`). There is no URL env var.
- **`firebase.westayfit.emulators.json`** (code PR): adds the same entry, and the database emulator on `127.0.0.1:9000`.
- **Production follows D1, D2 and D3′**, which replace Q1 = (b).
  - **D1** (#365 `6109245392`). **The instance is goarrive's default, `goarrive-default-rtdb`**, in us-central1, started in locked mode.
    - GoArrive uses no Realtime Database, so in practice the instance is this feature's alone.
    - The functions derive its URL from the project id (`live-pose.ts:88`), so no code or config changes.
    - It exists, locked and empty (#365 `6109456026`).
  - **D2** (same comment). **The production rules go in by hand**, in the Firebase console, after acceptance.
    - They come from `database.westayfit.rules.json` at the accepted subject `87b48fa8`, with a sha256 readback.
    - `firebase.westayfit.production.json` stays unchanged and declares no `database`.
    - The production pre-flight still refuses a `database` deploy target.
  - **D3′** (#365 `6109490508`). **The production pieces are KIOSK-LIVE-POSE-PROD-1:**
    - the pre-flight admits `WSF_LIVE_POSE=1` and nothing else for that key;
    - **record L**, pinned to this packet's integrated commit, exactly fifteen paths over G;
    - the runbook's section "Live pose (production)": the precheck with the rules by sha256, the env line, the `functions:westayfit` deploy, the readback, and the emergency off.
- **`wsf-staging-deploy.yml`:** a new step, **"Deploy the Realtime Database rules"**.
  - It sits in the deploy job, after the build job's GoArrive regression and before the functions deploy.
  - It refuses a candidate that lacks the rules file.
  - It reads `firebase projects:list --json`, which the preflight already runs, to check that the project has a default instance. If it has none, it fails with one line: `Create the Realtime Database default instance in westayfit-staging (us-central1, locked mode)`.
  - Only then does it run `firebase deploy --only database` with the staging config.
  - It is not `continue-on-error`, and it creates nothing.
  - **Order (L0):** the ops PR merges together with the repin that carries the code PR, never before it.
- **Not GoArrive.** GoArrive's `firebase.json` declares no `database`, so no GoArrive deploy can carry these rules or collide with them. Tests pin this on both lines:
  - `.github/wsf-staging/tests/live-pose-deploy.test.mjs` on `main`;
  - `functions-westayfit/tests/deploy-config/live-pose-config.test.ts` on the app line.

## 8. Cost

The worst case: 2 stations, turns back to back for 10 hours, 15 Hz. Each frame is about 120 bytes of JSON, plus protocol overhead, read by one kiosk:
- 2 × 15 × 36,000 = 1.08 M frames a day;
- about 250 bytes each, so **about 270–290 MB downloaded a day**;
- about **$0.29 a day** at the Realtime Database's $1/GB, and inside the 10 GB a month of free download for a typical event month.

Storage is negligible, because a key's node goes when its turn ends. Latency is about 100–300 ms.

## 9. Owner steps, in order

1. **Create the default instance in `westayfit-staging`:** Firebase console → Realtime Database → Create, us-central1, locked mode.
   - **Done.** The operator's receipt is #365 `6106392944`, and L0 accepted it in #365 `6106397456`: `https://westayfit-staging-default-rtdb.firebaseio.com/`, us-central1, locked, empty. It returned `404` before creation and `401` after.
   - Production: done under D1. `goarrive-default-rtdb` is locked and empty (#365 `6109456026`).
2. **Check both identities' Realtime Database access** (L0's read-only precheck, #365 `6106702656` and `6107062136`).
   - **Done (W3 O3):**
     - the readback found the access absent for both (#365 `6108850774`);
     - the owner-approved change (`6108938220`) was then made and verified (`6109114167`), and both identities now pass;
     - production's runtime account was verified in #365 `6109456026`.
   - This packet itself grants nothing.
   - **The deploy identity**, `wsf-staging-deployer@westayfit-staging.iam.gserviceaccount.com`, must be able to update Realtime Database rules; `roles/firebasedatabase.admin` would. Without it, the new step fails at `firebase deploy --only database`.
   - **The runtime identity**, the service account the WSF functions run as on `westayfit-staging` (W3 O2), writes and deletes `meta` through the Admin SDK and needs Realtime Database data access; `roles/firebasedatabase.admin` would. Without it, every arm and delete is refused: no live pose for any turn, and each refusal logs an error code and `update at /wsfLivePose failed: permission_denied`, never a key.
   - Granting either is an owner decision.
3. **Deploy.** L0 merges the code PR, repins, and merges the ops PR with the repin. The staging deploy then publishes the rules, and the env writer sets `WSF_LIVE_POSE=1`.
4. **Publish.** The phone and kiosk clients come in a later packet.

**The privacy gate.**
- **Owner approval:** given, #365 `6109245392`.
- **Counsel:** the owner waived counsel review in the same comment, for live pose only. Raffle wording, and anything else counsel holds, is unchanged.
- **Production also needs** KIOSK-LIVE-POSE-PROD-1 integrated, and then its runbook section run by the operator.

## 10. Evidence

**Emulators only** (`demo-wsf-local`: Firestore, Auth and the Realtime Database), with synthetic, labelled fixtures. The results are in the PR bodies.

**Run** from the code PR's repository root:

```sh
npx -y firebase-tools@15.30.1 emulators:exec --only firestore,auth,database --project demo-wsf-local \
  --config firebase.westayfit.emulators.json "cd functions-westayfit && npx jest --config tests/live-pose/jest.config.cjs"
```

**One local note.** firebase-tools 15.30.1 sends every request through `HTTPS_PROXY` with undici's `ProxyAgent` and ignores `NO_PROXY` (`lib/apiv2.js:242-244`). That includes its own loopback rules upload to the database emulator. Behind a proxy, it therefore cannot load the config's rules.

The W9 sandbox has such a proxy. Its runs used a scratch copy of the emulator config without `database.rules`. That does not weaken the run: every live-pose suite loads `database.westayfit.rules.json` into the database's namespace itself before any client call. Without a proxy, the committed config works as written.

## 11. Residuals

- **A `meta` write that fails or misses its deadline** means no live pose for that turn, and its delete is queued behind it (section 4). The turn itself is unaffected.
- **An inert node can be left behind.** It holds `meta`, so the member's uid and the expiry, and possibly the last frame. It is unreadable and unwritable after `expiresAt`, but nothing deletes it. There is no scheduled sweeper; that would be a new export, which is out of scope. It happens in three cases:
  1. a delete that fails with no pointer left to retry it: the earlier key at a new start;
  2. the same, for a key on a revoked station that no longer polls;
  3. a late `meta` whose queued delete never leaves the instance. The two writes go out in order on one connection, so this needs the connection to drop after `meta` was sent and before the delete was, and the instance to end before it reconnects.
- **Holding the key is enough to watch** the stick figure, for at most two minutes, without signing in. The key travels only in the two answers in section 3.
- **The identities' Realtime Database access is verified:** both staging identities (#365 `6109114167`), and the production runtime account (#365 `6109456026`).
