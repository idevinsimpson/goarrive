# PRODUCTION-FIREBASE-INVENTORY-1: WSF production Firebase, source vs deployed

**Status: read-only inventory by W9.** First delivered 2026-10-09 at about 05:45Z. **Redelivered with:**
- W4's ops-source finding #394 `6075479691`: F1 (invoker) and the line-range nit;
- the owner's production readbacks, #365 `6076170543` (07:05Z), receipted by L0 in `6076227694`;
- the inventory-side results of W9's own adversarial review of #599 and #600: one skeptic per finding, each read against the pinned `firebase-tools` 15.30.1 and `firebase-functions` 4.9.0 sources. They are in 3 (deploy stoppers), 6 (standing hazards and the regression plan) and 9 (rollback).

**Authority:**
- **Queue and release:** queue #365 `6074830303`, release `6074831300`, critical path `6074833005`.
- **Owner decisions:** `6072718440`, `6073175126`, `6074580396` §2, `6074607727`, `6074643881`, and `6075884941` (launch on the pending consent version).
- **Prior fact sheet:** `6070407860`.

**Machine-readable twin:** [`wsf-production-inventory.v1.json`](wsf-production-inventory.v1.json). It holds the same facts, plus every callable as a record.

**Nothing was changed by W9.** No production, GoArrive, IAM, WIF, Auth, DNS, secret, rule, index, Storage, Hosting or data state was touched, and nothing was deployed or dispatched. The owner's readback made one authorized mutation of its own: it added `app.westay.fit` to the Auth authorized domains.

**No credential was used.** W9 used no `gcloud` or `firebase` login, no token, and no other identity. No secret, API key or action link appears here, and the web app registration is described by its appId *shape* only.

**What this session could and could not reach:**
- **Hosting checks were refused.** Anonymous HTTPS GETs to the six hosts were refused by this session's egress proxy (`CONNECT 403`, 2026-10-09T05:38:43Z).
- **DNS does not work.** External DNS does not resolve in this sandbox.
- **Live facts come from the owner.** Every live fact below comes from the owner's readback, and the rows it did not answer stay BLOCKED.

**Evidence classes:**
- **SOURCE INSPECTED:** read from the repository at a named SHA.
- **DEPLOYMENT RECEIPT:** a GitHub Deployments or Actions record.
- **HOSTED VERIFIED:** observed on the live host. Every such row here is *cited* from the owner's dated hosted check and not re-verified by W9.
- **READBACK RECEIPT:** the owner's credentialed, read-only readback of live `goarrive` (#365 `6076170543`), receipted by L0 (`6076227694`). It proves served state. It is **not** a deployment receipt for any candidate.
- **SOURCE-MATCHED:** a readback whose content hash equals a repository blob, so the served file's full text is known.
- **BLOCKED:** needs a credentialed readback that has not been made.

**Never inferred:** nothing below treats source as proof of what is deployed.

| Ref | SHA | What it is |
|---|---|---|
| operational main | `41bff6c643ab4537d47a0732da48cfb86dc64b6b` | ops tooling, workflows, GoArrive app; the base of this PR |
| development | `ec162d17a0540e936741027f9b8f90dd372cfaf4` | `claude/wsf-app-shell`: the WSF app and backend source; **candidate A** |
| staging-served WSF app | `ab77fbfce97e60c1c22492397b2ab6b491f9e0db` | an ancestor of `ec162d17`, deployed to `westayfit-staging` (see 7) |
| Lovable hosted source | `77172f45a2c100c85975bd4437a8aed95831f36b` | deployment `b4b9d8d1-ed6a-49a7-966d-af688c3a0d39` on `app.westay.fit` (cited) |

## Bottom line

1. **Production already serves an older WSF backend that does not come from this repository** (READBACK RECEIPT):
   - **17 `wsf*` callables,** all last updated 2026-09-15T02:45Z.
   - **A 2026-09-01 Firestore rules release with an older WSF section.** Its source is SOURCE-MATCHED to `firestore.rules` at `620c1689`/`d6e26933`.
   - **No WSF composite index.**
   - **No production deployment receipt for any reviewed candidate.** The Deployments API holds 0.
   - **The 17 functions' source is not in this repository.** One of them, `wsfListCommunityGoals`, appears in no commit on any fetched ref.
2. **Candidate A changes production as follows** (proposal only, see 10):
   - it updates **16** live WSF functions in place and creates **43**;
   - it releases a WSF rules section that is **only** stricter than the live one;
   - it adds 2 WSF indexes;
   - it orphans **`wsfListCommunityGoals`**, which needs an explicit, recorded decision first. What the deploy does with it depends on the live function's codebase label (B4d, 6 "Codebase labels"):
     - labelled `westayfit`: the deploy lists it for deletion, and with `--non-interactive` and no `--force` it **aborts**;
     - unlabelled: the deploy never sees it and leaves it running.
   - **Three more toolchain facts can stop or fail that deploy** (3, "Deploy stoppers"):
     - **Node.js 20 cutoff:** `firebase-tools` 15.30.1 refuses to deploy Node.js 20 functions from **2026-10-30**, and the candidate pins Node 20.
     - **`wsfCheckIn` minimum instances:** the deploy aborts if the live `wsfCheckIn` keeps no warm instance today (B4c).
     - **Artifact cleanup policy:** the deploy exits non-zero *after* deploying if `gcf-artifacts` has no cleanup policy (B11).
3. **Operational `main` must never be the source of a WSF production deploy.**
   - Main exports **1** WSF callable (`wsfHealth`), has no WSF rules section, and carries a placeholder web config.
   - A forced or prompt-accepted `functions:westayfit` deploy from main would prune every other `westayfit`-labelled WSF function (B4d).
4. **Consent: the owner decided to launch on the pending version** (#365 `6075884941`).
   - `wsfSaveProfile` stamps `pending-approval-2026-08-25` server-side (`functions-westayfit/src/index.ts:124-125`, mirrored at `apps/westayfit/src/profileConstants.ts:1-2`).
   - Every production profile created after launch records consent to that version. Counsel review continues after launch.
   - This is an owner-accepted risk, no longer a W9 release blocker.
5. **Phase-1 prerequisites now read back:**
   - **`app.westay.fit`:** authorized (the owner added it 2026-10-09).
   - **Email/Password:** enabled.
   - **`allUsers` invoker:** permitted by org policy.
   - **The WSF web app registration:** exists, matching the development config.
6. **Open before Phase 1:**
   - production `WSF_APP_URL` points at an expired staging channel and must become `https://app.westay.fit` at deploy;
   - whether `westay.fit` is a verified Resend sending domain is **still unread** (B3b);
   - **2 of the 11** Phase-1 journey callables (`wsfListGoals`, `wsfGoalRecentAdditions`) are not served at all, and the 9 that are served run the older source;
   - Anonymous sign-in is **enabled** on the shared project, and GoArrive's share pages use it (2.2);
   - candidate A must deploy **before 2026-10-30**, or move to a newer Node runtime as a new candidate record (3).
7. **Two standing GoArrive hazards exist today** (6). Until `main` carries the WSF backend:
   - a GoArrive rules deploy from `main` removes the live WSF rules section;
   - a GoArrive functions deploy from `main` lists live WSF functions for deletion. A bare `--only functions` does so if they carry the `westayfit` label; even `--only functions:default` does so if they carry none (B4d).

## 1. Project identity

| Row | Evidence | Fact |
|---|---|---|
| 1.1 Production project selected by source | SOURCE INSPECTED | `.firebaserc` defaults to `goarrive`. Development `apps/westayfit/src/firebase.ts:21` fixes `PROD_PROJECT_ID = 'goarrive'`, with production config at `:79-86`. Staging is selected only by a complete `EXPO_PUBLIC_WSF_STAGING_*` config plus `EXPO_PUBLIC_WSF_ENV` (`src/stagingEnv.ts`), which refuses production identifiers. The emulator id `demo-wsf-local` is used only on a loopback host. |
| 1.2 Staging project | SOURCE INSPECTED + DEPLOYMENT RECEIPT | Staging is a **separate** project, `westayfit-staging`, with Hosting site `westayfit-staging`, channel `https://westayfit-staging--staging-4a616y5m.web.app`, and WIF pool `projects/857281977774/…/wsf-staging-github` (`.github/workflows/wsf-staging-deploy.yml:148-155` on main). Production is the **shared** `goarrive` project. |
| 1.3 WSF web app registration in `goarrive` | SOURCE INSPECTED + READBACK RECEIPT | `goarrive` holds two web apps, **"We Stay Fit"** and **"GoArrive Web"** (B1). The WSF appId has the shape `1:<goarrive project number>:web:<22 hex>`. The owner confirmed it equals development's `productionConfig` appId. It is distinct from GoArrive's (same shape, different value). L0 confirmed Lovable's pinned public config (`c783f0b4`) matches. **Drift:** `main` still carries the scaffold placeholder: a different sender id, a non-hex appId suffix (`westayfit-app`), and a different apiKey. |

## 2. Auth

| Row | Evidence | Fact |
|---|---|---|
| 2.1 Authorized domains | READBACK RECEIPT | `app.westay.fit` **is present**: the owner added it 2026-10-09, before vs after recorded, and it is the readback's one authorized mutation. `westay.fit` is **absent**. The Lovable trial host is **absent**, as expected, because it runs on `westayfit-staging`. The list also holds `goarrive.web.app`, `westayfit-app.web.app` and several preview-channel domains, including expired staging channels. Pruning those is hygiene, not a Phase-1 need. The mail callables mint links with continue URL `WSF_APP_URL`, which must be on this list. |
| 2.2 Providers | SOURCE INSPECTED + READBACK RECEIPT | **Email/Password is enabled, with a password required. Anonymous sign-in is enabled.**<br><br>**Source facts:**<br>• The WSF client uses Email/Password only.<br>• **GoArrive's share page uses anonymous sign-in** (`apps/goarrive/app/share/[shareId].tsx:105`, `signInAnonymously`), so **disabling the provider on the shared project would break GoArrive.**<br><br>**WSF exposure to an anonymous ID token** (SOURCE INSPECTED, `ec162d17`):<br>• Six signed-in entry points require a verified email: `wsfCreateCommunity`, `wsfJoinCommunity`, `wsfJoinViaMarker`, `wsfCreateGoal`, `wsfCreateCombinedGoal`, `wsfSendVerificationEmail`. So an anonymous caller can never become a member, and member-gated callables refuse it.<br>• 37 signed-in callables check only `request.auth`. Among those that write without membership, `wsfSaveProfile` creates a `wsfMemberProfiles` doc, and, once candidate A creates them, the photo setters write a `wsfProfilePhotos` doc of up to 160 KB per anonymous uid.<br>• **This is a review item for the security seat:** a follow-on code change that refuses `request.auth.token.firebase.sign_in_provider === 'anonymous'` in WSF callables. It is not a provider toggle. |
| 2.3 Verification and reset path | SOURCE INSPECTED | The client never calls Firebase's built-in mail. `wsfSendVerificationEmail` and `wsfSendPasswordResetEmail` mint the link with the Admin SDK and send it through Resend (`functions-westayfit/src/index.ts:327-400`). At runtime they need the secret **`WSF_EMAIL_API_KEY`** and the env **`WSF_EMAIL_FROM`** and **`WSF_APP_URL`**. `WSF_AUTH_ACTION_HANDLER` is optional and defaults to `https://goarrive.firebaseapp.com/__/auth/action`. Missing config fails closed with `failed-precondition`. |
| 2.3 live action URL | READBACK RECEIPT | The project's custom action URL is GoArrive's `https://goarrive.web.app/reset-password`. WSF retargets its own links, so it needs no change. |
| 2.4 Production mail config | READBACK RECEIPT | **Secret:** `WSF_EMAIL_API_KEY` versions 1 and 2 are enabled, and version 2 is referenced by Cloud Run. No value was read.<br>**Service:** `wsfsendverificationemail` is present in `us-central1`.<br>**Env:** `WSF_EMAIL_FROM` is a display-name `noreply@` sender on `westay.fit`. **`WSF_APP_URL` is `https://westayfit-app--staging-uoria6cq.web.app`, an expired staging channel**, so the deploy must set `https://app.westay.fit`.<br>**Still BLOCKED (B3b):** whether `westay.fit` is a verified Resend sending domain. |
| 2.5 Lovable Web Twin against production without a native release | READBACK RECEIPT + SOURCE INSPECTED | **Read back:** the domain is present (2.1), the config is correct (1.3), and Email/Password is enabled (2.2). **Not yet in place:** the WSF rules live today are the older section (4.1); 2 journey callables are absent and the rest run older source (3); and the mail URL is wrong (2.4). **So candidate A's deploy is the remaining backend step.** A native release is **not** a dependency. |
| 2.6 Web API key referrer restriction | READBACK RECEIPT | The Firebase browser key has **no HTTP-referrer restriction** (`browserKeyRestrictions: {}`), so `app.westay.fit` is not excluded. Hardening it is a later, separate change. |

## 3. Callables

`functions-westayfit` exports **59** at development (candidate A), **49** at staging-served `ab77fbfc`, and **1** at operational main. **Production serves 17 `wsf*` callables** (READBACK RECEIPT B4), all `GEN_2`, `ACTIVE`, and last updated 2026-09-15T02:45:23Z–02:45:31Z:
- `wsfAdjustGoal`, `wsfChallengePulse`, `wsfCheckIn`, `wsfContribute`, `wsfCreateCommunity`, `wsfCreateGoal`, `wsfGoalPulse`, `wsfHealth`, `wsfJoinCommunity`, `wsfListChallenge`;
- **`wsfListCommunityGoals`**;
- `wsfMyCommunities`, `wsfMyContribution`, `wsfPreviewCommunity`, `wsfSaveProfile`, `wsfSendPasswordResetEmail`, `wsfSendVerificationEmail`.

**Against candidate A:**
- **16 are kept and updated in place.**
- **43 are new.**
- **`wsfListCommunityGoals` is not exported** by `ec162d17`. The canonical client calls `wsfListGoals`. Whether candidate A's deploy tries to delete it depends on its codebase label (B4d, 6).
- **The live source is not in this repository.** `git log --all -S wsfListCommunityGoals` finds nothing, and none of the 60 commits that touch `functions-westayfit/src/index.ts` exports these 17. There is therefore no source anchor in the repository for the live functions, and **deleting `wsfListCommunityGoals` cannot be undone from repository source.**

**Other facts:**
- All 59 candidate exports are in `us-central1`, and none declares App Check. `functions-westayfit/package.json` pins `"engines": {"node": "20"}`.
- `wsfCheckIn` alone sets `minInstances` (`projectID == goarrive ? 1 : 0`, `index.ts:1985`), so production keeps one warm instance. That has a cost.

**Deploy stoppers.** SOURCE INSPECTED in `firebase-tools` 15.30.1. Each one stops or fails `firebase deploy --only functions:westayfit --non-interactive` without `--force`:

| # | Fact | When it bites | What settles it |
|---|---|---|---|
| S1 | **Node.js 20 decommission.** `nodejs20` has `decommissionDate: "2026-10-30"` (`lib/deploy/functions/runtimes/supported/types.js:50-55`). From that instant the CLI throws `Runtime Node.js 20 was decommissioned …` (`runtimes/supported/index.js:56-59`). | Any functions deploy of the candidate on or after **2026-10-30T00:00Z**. That includes a deploy-based rollback. | Deploy before then, or record a new candidate on a newer runtime. That is a source change and needs review. |
| S2 | **Minimum-bill prompt.** `promptForMinInstances` runs before anything is created (`prepare.js:338`). If a wanted endpoint's min-instance cost exceeds the live one's, `--non-interactive` throws `Pass the --force option to deploy functions that increase the minimum bill` (`prompts.js:116-145`). | `wsfCheckIn` resolves to 1 on `goarrive`. The repository declared a literal `minInstances: 1` until `1cbf2319` (2026-09-16). The live function was deployed 2026-09-15 from source that is not in this repository, so its value is **not known**. | **B4c.** If the live value is 1, nothing increases and the step passes. If it is 0 or absent, the deploy aborts before creating anything. |
| S3 | **Artifact cleanup policy.** After release, the CLI checks the `gcf-artifacts` repository in each deployed region. A repository with no `firebase-functions-cleanup` policy, no other cleanup policy and no `firebase-functions-cleanup-opted-out` label makes `--non-interactive` throw `Functions successfully deployed but could not set up cleanup policy …` (`lib/functions/artifacts.js:121-161`, `prompts.js:179-190`). | `us-central1`, after a **successful** deploy: the run exits non-zero although the functions are live. | **B11.** `--force` is not the remedy: it sets a **1-day** cleanup policy (`artifacts.js:23`) on a repository GoArrive's images share. |

The orphan deletion (above) is a fourth stop of the same kind (`prompts.js:62-71`).

**Every one of the 59 is public at the Cloud Run layer.** 17 exports declare `invoker: 'public'`, but for `onCall` that option is **inert** with these versions (corrected per W4's finding #394 `6075479691` F1):
- `firebase-functions` 4.9.0 builds every `onCall` endpoint as `callableTrigger: {}` and maps `invoker` only for `onRequest` (`lib/v2/providers/https.js:110-111` vs `:176`).
- `firebase-tools` 15.30.1 grants `allUsers` `roles/run.invoker` to every callable on **create**, unconditionally (`lib/deploy/functions/release/fabricator.js:486-489`).
- It sets no invoker for a callable on **update** (`:600-629`), so a redeploy leaves an existing service's IAM as it is.
- A browser's Firebase ID token is not a Cloud Run IAM credential, so the 42 callables that declare no `invoker` (all of them signed-in) reach their handlers only through the public invoker the CLI grants anyway. **Each handler's own `request.auth` check is the control.**
- The source comments and `functions-westayfit/tests/deploy-config/sprint-w8-social-invoker.test.ts` treat the declaration as the transport control. With these versions it is not. This is noted here and not changed.
- **The org policy permits `allUsers`** (`iam.allowedPolicyMemberDomains`: `allValues=ALLOW`, READBACK RECEIPT).
- **Per-service IAM of the 16 kept services is still BLOCKED (B5):** a redeploy will not repair one that lost `allUsers`.

**Not exported:**
- the Event lifecycle (PR #595, held on security review);
- the raffle/promotion modules (`functions-westayfit/src/expo-prize/*`).

**Phase-1 web journey** (signup/verify → profile → join → manual MOVE → confirmed receipt → Living WE): the rows marked **P1 journey**. "P1 supporting" covers the Home/Community/Progress/You states and the Champion's setup of the real community and goal. Event, photo, raffle and admin features are **hidden / not required for Phase 1**.

| # | Callable | Phase 1 | Handler auth | `invoker` in source | In staging-served `ab77fbfc` | Canonical client calls it | Production (READBACK B4) |
|---|---|---|---|---|---|---|---|
| 1 | `wsfSaveProfile` ⚠︎ | **P1 journey** | signed in | — | yes | yes | served (2026-09-15; source not in repo) |
| 2 | `wsfSendVerificationEmail` | **P1 journey** | signed in | — | yes | yes | served (2026-09-15; source not in repo) |
| 3 | `wsfPreviewCommunity` | **P1 journey** | none (by design) | public | yes | yes | served (2026-09-15; source not in repo) |
| 4 | `wsfJoinCommunity` | **P1 journey** | signed in | — | yes | yes | served (2026-09-15; source not in repo) |
| 5 | `wsfMyCommunities` | **P1 journey** | signed in | — | yes | yes | served (2026-09-15; source not in repo) |
| 6 | `wsfSendPasswordResetEmail` | **P1 journey** | none (by design) | public | yes | yes | served (2026-09-15; source not in repo) |
| 7 | `wsfContribute` | **P1 journey** | signed in | — | yes | yes | served (2026-09-15; source not in repo) |
| 8 | `wsfGoalPulse` | **P1 journey** | none (by design) | public | yes | yes | served (2026-09-15; source not in repo) |
| 9 | `wsfGoalRecentAdditions` | **P1 journey** | none (by design) | public | yes | yes | **not served** |
| 10 | `wsfMyContribution` | **P1 journey** | signed in | — | yes | yes | served (2026-09-15; source not in repo) |
| 11 | `wsfListGoals` | **P1 journey** | signed in | — | yes | yes | **not served** |
| 12 | `wsfCreateCommunity` | P1 supporting | signed in | — | yes | yes | served (2026-09-15; source not in repo) |
| 13 | `wsfResolveMarker` | P1 supporting | none (by design) | public | **no** | yes | **not served** |
| 14 | `wsfJoinViaMarker` | P1 supporting | signed in | — | **no** | yes | **not served** |
| 15 | `wsfResetJoinCode` | P1 supporting | signed in | — | yes | yes | **not served** |
| 16 | `wsfLeaveCommunity` | P1 supporting | signed in | — | yes | yes | **not served** |
| 17 | `wsfCreateGoal` | P1 supporting | signed in | — | yes | yes | served (2026-09-15; source not in repo) |
| 18 | `wsfSetGoalDisplayAuthorization` | P1 supporting | signed in | — | yes | yes | **not served** |
| 19 | `wsfSetCommunityVisibility` | P1 supporting | signed in | — | yes | yes | **not served** |
| 20 | `wsfCommunityMembers` | P1 supporting | signed in | — | yes | yes | **not served** |
| 21 | `wsfCommunityActivity` | P1 supporting | signed in | — | yes | yes | **not served** |
| 22 | `wsfListChallenge` | legacy challenge | signed in | — | yes | yes | served (2026-09-15; source not in repo) |
| 23 | `wsfCheckIn` ¹ | legacy challenge | signed in | — | yes | yes | served (2026-09-15; source not in repo) |
| 24 | `wsfChallengePulse` | legacy challenge | signed in | public | yes | no | served (2026-09-15; source not in repo) |
| 25 | `wsfPublicPreviewLabel` | Phase 2 | none (by design) | public | **no** | no | **not served** |
| 26 | `wsfStationRequestPairing` | Phase 2 | none (by design) | public | yes | yes | **not served** |
| 27 | `wsfStationPairingStatus` | Phase 2 | station secret | public | yes | yes | **not served** |
| 28 | `wsfApproveStation` | Phase 2 | signed in | — | yes | yes | **not served** |
| 29 | `wsfStationClaimPairing` | Phase 2 | station secret | public | yes | yes | **not served** |
| 30 | `wsfStationState` | Phase 2 | station secret | public | yes | yes | **not served** |
| 31 | `wsfListStations` | Phase 2 | signed in | — | yes | yes | **not served** |
| 32 | `wsfRevokeStation` | Phase 2 | signed in | — | yes | yes | **not served** |
| 33 | `wsfCreateCombinedGoal` | Phase 2 | signed in | — | yes | yes | **not served** |
| 34 | `wsfCombinedGoalPulse` | Phase 2 | station secret | public | yes | yes | **not served** |
| 35 | `wsfEventContext` | Phase 2 | signed in | — | yes | yes | **not served** |
| 36 | `wsfJoinTurnLine` | Phase 2 | signed in | — | yes | yes | **not served** |
| 37 | `wsfMyTurn` | Phase 2 | signed in | — | yes | yes | **not served** |
| 38 | `wsfTurnReady` | Phase 2 | signed in | — | yes | yes | **not served** |
| 39 | `wsfLeaveTurnLine` | Phase 2 | signed in | — | yes | yes | **not served** |
| 40 | `wsfTurnState` | Phase 2 | station secret | public | yes | yes | **not served** |
| 41 | `wsfCallNext` | Phase 2 | station secret | public | yes | yes | **not served** |
| 42 | `wsfStartTurn` | Phase 2 | station secret | public | yes | yes | **not served** |
| 43 | `wsfCompleteTurn` | Phase 2 | station secret | public | yes | yes | **not served** |
| 44 | `wsfCompleteMyTurn` | Phase 2 | signed in | — | yes | yes | **not served** |
| 45 | `wsfCancelTurn` | Phase 2 | station secret | public | yes | yes | **not served** |
| 46 | `wsfRemoveMember` | hidden | signed in | — | yes | no | **not served** |
| 47 | `wsfReinstateMember` | hidden | signed in | — | yes | no | **not served** |
| 48 | `wsfDesignateChampion` | hidden | signed in | — | yes | no | **not served** |
| 49 | `wsfAdjustGoal` | hidden | signed in | — | yes | no | served (2026-09-15; source not in repo) |
| 50 | `wsfCloseCombinedGoal` | hidden | signed in | — | yes | no | **not served** |
| 51 | `wsfRepairCombinedGoal` | hidden | signed in | — | yes | no | **not served** |
| 52 | `wsfMyProfilePhoto` | hidden | signed in | — | **no** | no | **not served** |
| 53 | `wsfSetProfilePhoto` | hidden | signed in | — | **no** | no | **not served** |
| 54 | `wsfRemoveProfilePhoto` | hidden | signed in | — | **no** | no | **not served** |
| 55 | `wsfSetPortraitDecision` | hidden | signed in | — | **no** | no | **not served** |
| 56 | `wsfSetCommunityPhotoVisibility` | hidden | signed in | — | **no** | no | **not served** |
| 57 | `wsfCommunityFaces` | hidden | signed in | — | **no** | no | **not served** |
| 58 | `wsfCommunityFacePhotos` | hidden | signed in | — | **no** | no | **not served** |
| 59 | `wsfHealth` | ops | signed in | — | yes | no | served (2026-09-15; source not in repo) |
| — | `wsfListCommunityGoals` | orphan | not in the candidate | — | no | no | served (2026-09-15; source not in repo); **not exported by candidate A** |

⚠︎ **Consent:** `wsfSaveProfile` stamps `pending-approval-2026-08-25` (`index.ts:124-125`, `profileConstants.ts:1-2`), and `apps/westayfit/src/legalContent.ts` ships text marked "pending approval". The owner decided to launch on this version (#365 `6075884941`). ¹ `minInstances` resolves to 1 on `goarrive`.

**Still BLOCKED for callables:**
- the current Cloud Run revision name of each of the 16 kept services, which is the functions rollback anchor (B4b);
- the live `wsfCheckIn` minimum instances (B4c, S2);
- the codebase label of each of the 17 live functions (B4d, 6);
- their invoker IAM (B5);
- the `gcf-artifacts` cleanup policy (B11, S3).

## 4. Firestore rules and indexes, Storage rules

| Row | Evidence | Fact |
|---|---|---|
| 4.1 Firestore rules, source | SOURCE INSPECTED | `main` has 1201 lines and **no WSF section**. Development has 1261 lines: `main` plus **one** 60-line WSF section (lines 1197-1256), placed before the catch-all deny (1257). Outside that section the two are byte-identical. The section covers: <br>• `wsfMemberProfiles`: owner read; owner create/update only with a verified email and `adultConfirmation == true`; delete false. <br>• `wsfCommunityGroups`: current-member read; client writes false. <br>• `wsfMemberships`: owner read by the `userId` field; client writes false. |
| 4.1 Deployed | READBACK RECEIPT + SOURCE-MATCHED | **Live release:** `cloud.firestore` → ruleset `1e14eab9-a23f-437f-8418-918b9eaefe65`, updated 2026-09-01T03:44:08Z, 1259 lines, sha256 `c598fc3b96c6f169…`.<br>**Source match:** that hash **equals** `firestore.rules` at `620c1689` (2026-08-27) and `d6e26933` (2026-09-06), so the live text is known exactly.<br>**Computed with `.github/wsf-production/preflight.mjs`'s own split** (#600):<br>• Outside its WSF section, the live ruleset is **byte-equal to `main`**, so a rules deploy of candidate A changes only the WSF section.<br>• The live 58-line section differs from the candidate's 60 lines in **one** place: live `wsfIsGroupMember` checks only that a membership row *exists*, so a removed or departed member still passes; the candidate also requires `membershipStatus == 'active'`.<br>**Deploying candidate A's rules is strictly tighter** for WSF and leaves GoArrive unchanged. |
| 4.1 Why it is launch-critical | SOURCE INSPECTED | The WSF client reads `wsfMemberProfiles` directly (signin, signup, verify-email, profile-setup), as well as `wsfMemberships` and `wsfCommunityGroups` (community, goals/new). |
| 4.1 Stale invariant | SOURCE INSPECTED | The rules still require `adultConfirmation`. `wsfSaveProfile` no longer writes it (DECISIONS 2026-09-06 removed the age gate), and profiles are written by the Admin SDK, so the rule is inert for create. It must be reconciled with the approved 13+ eligibility later. |
| 4.2 Composite indexes, source | SOURCE INSPECTED | `main` has 48 composite indexes, 0 of them WSF. Development has 50: `main` plus **`wsfContributions(communityGroupId ASC, createdAt DESC)`** and **`wsfGoalMemberTotals(userId ASC, updatedAt DESC)`**. Field overrides (2) are unchanged and non-WSF. |
| 4.2 Deployed | READBACK RECEIPT | **48 composite indexes, 0 WSF, all READY.** The count equals `main`'s 48; identity was not compared field by field. The 2 WSF composites must be created. |
| 4.3 Storage rules, source | SOURCE INSPECTED | Identical on main and development. There is no WSF path, and the file ends in a catch-all deny (line 77). WSF stores no Cloud Storage object. |
| 4.3 Deployed | BLOCKED | Not in the readback. Read it from the Rules API release `projects/goarrive/releases/firebase.storage/goarrive.firebasestorage.app`, or console › Storage › Rules. **No WSF step touches Storage.** |

## 5. Hosting

| Row | Evidence | Fact |
|---|---|---|
| 5.1 `app.westay.fit` | HOSTED VERIFIED (cited, not re-verified by W9) | #365 `6073175126` (posted 2026-10-09T02:42Z): Lovable deployment `b4b9d8d1-ed6a-49a7-966d-af688c3a0d39` of source `77172f45` serves a **fail-closed shell**. Signed out, it makes zero Firebase or other external calls. The production flag is OFF. **Lovable**, not Firebase Hosting, serves this name. |
| 5.2 `westay.fit` (marketing) | BLOCKED | No WSF source or workflow in this repository touches it. |
| 5.3 Firebase Hosting site `westayfit-app` | SOURCE INSPECTED (+ indication) | It is named in `firebase.westayfit.json`. The authorized-domain list includes `westayfit-app.web.app` and a `westayfit-app--staging-…` channel, which Firebase adds when a site or channel exists. That is a strong indication the site exists in `goarrive`, but it is not a Hosting readback (B9). **No Phase-1 role:** Lovable is the sole Web Twin frontend. |
| 5.4 GoArrive Hosting | SOURCE INSPECTED | `firebase.json` hosting has no `site`, so it resolves to `goarrive.web.app`. A WSF action must never run a bare `firebase deploy` or `--only hosting` with `firebase.json`. |
| 5.5 Lovable trial host | HOSTED VERIFIED (cited) | `we-stay-fit-foundation-trial.lovable.app` is the staging owner-test host on `westayfit-staging`. It is not production. |

## 6. GoArrive boundary

**WSF-only:**
- **Codebase:** `functions-westayfit`, codebase `westayfit` (`firebase.json` `functions[1]`).
- **Rules:** the rules section at lines 1197-1256 (development).
- **Secret:** `WSF_EMAIL_API_KEY`.
- **29 collections:** `wsfChallengeCounters`, `wsfChallengeMoves`, `wsfChallengeParticipants`, `wsfChallenges`, `wsfCheckIns`, `wsfCombinedCounters`, `wsfCombinedCredits`, `wsfCombinedGoalClaims`, `wsfCombinedGoals`, `wsfCommunityGroups`, `wsfContributions`, `wsfGoalAdjustments`, `wsfGoalCounters`, `wsfGoalMemberTotals`, `wsfGoals`, `wsfKioskPairings`, `wsfKioskStations`, `wsfMarkers`, `wsfMemberProfiles`, `wsfMemberships`, `wsfPasswordResetSends`, `wsfPreviewRateLimits`, `wsfProfilePhotos`, `wsfStationRateLimits`, `wsfTurnEntries`, `wsfTurnLines`, `wsfTurnMembers`, `wsfTurnReceipts`, `wsfVerificationSends`.
- **Source-only:** `wsfPromotion*`, used by the unexported raffle modules.

**Shared with GoArrive:**
- the Auth user pool and providers (**including Anonymous, which GoArrive's share page uses**);
- the Firestore database and its **single** ruleset and index set;
- the Storage bucket and rules;
- Secret Manager;
- Cloud Run and IAM, including the **default compute service account**. No WSF export sets `serviceAccount`, so WSF and GoArrive functions that set none share this runtime identity. When the CLI deploys a function that uses `WSF_EMAIL_API_KEY`, it grants that account `roles/secretmanager.secretAccessor` on the secret, so those GoArrive functions can read it as well;
- the `gcf-artifacts` Artifact Registry repository in `us-central1` (container images; cleanup policy B11);
- billing;
- the project's custom Auth action URL and email templates;
- the browser API key.

**GoArrive code that touches WSF: none.**
- `functions/src` references no `wsf` collection.
- There are no Auth blocking or user-onCreate triggers.
- The one all-users scan, `seedMissingCoachDocs`, acts only on `role: coach`/`admin` claims.

**What `firebase deploy --only functions:westayfit` touches:**
- Only the `westayfit` codebase.
- It updates the 16 kept WSF functions and creates 43.
- If the live `wsfListCommunityGoals` carries the `westayfit` label, the deploy would **delete** it. With `--non-interactive` and no `--force` the CLI **aborts** instead. Either way the orphan needs an explicit decision first (#600 runbook).

**Codebase labels (B4d).** SOURCE INSPECTED in `firebase-tools` 15.30.1:
- A deployed function belongs to a codebase only through its `firebase-functions-codebase` label. A function without that label counts as `default` (`lib/gcp/cloudfunctionsv2.js:288-297` sets the label, `:449` reads it).
- On deploy, a live function is first assigned to the codebase whose source exports **the same name**. Only the rest are assigned by label (`lib/deploy/functions/functionsDeployHelper.js:117-134`).
- Candidate A's deploy therefore updates the 16 kept functions whatever their labels, and labels them `westayfit`.
- The labels of the 17 live functions were not read. They decide the orphan's fate and which of H2a/H2b below applies.
- **Never deploy WSF functions from main** (1 export).

**Standing hazards. These hold today, before any WSF deploy, and last until `main` carries the WSF backend:**
- **H1 Rules.** The live ruleset already has a WSF section (4.1), and `main`'s `firestore.rules` has none. `firebase.json` declares `firestore.rules`, so any GoArrive `firebase deploy` that includes `firestore:rules` from `main` **removes the live WSF section**. WSF's direct client reads then fail closed, and they would again after candidate A's rules are released.
  - Hold GoArrive rules deploys, or merge the WSF section to `main` first.
  - Re-read the release after any GoArrive rules deploy.
- **H2 Functions.** `firebase.json` declares **both** codebases (`functions[0]` `default`, `functions[1]` `westayfit`), and GoArrive's documented functions deploy is a bare `firebase deploy --only functions` (`.claude/deployment-and-build.md:49`). Which variant applies depends on the live labels (B4d):
  - **H2a, WSF functions labelled `westayfit`.** A bare `--only functions` from `main` also deploys `main`'s 1-export `westayfit` codebase. It redeploys `wsfHealth` from `main` and lists every other `westayfit`-labelled WSF function for deletion. GoArrive deploys must name `--only functions:default`.
  - **H2b, WSF functions unlabelled.** They count as `default`, GoArrive's own codebase. **Any** GoArrive functions deploy from `main`, `--only functions:default` included, lists every unlabelled WSF function for deletion, because `main`'s `functions/` exports none of them. Candidate A relabels the 16 kept functions `westayfit`, so after it only an unlabelled orphan would remain exposed.
  - **In both variants:** under `--non-interactive` the deploy aborts; with `--force`, or a Yes at the prompt, it **deletes** the listed functions.

**Regression plan (proves GoArrive is unchanged):**
1. **Functions:** capture `gcloud functions list --project=goarrive` across **all** regions before and after. GoArrive also declares `us-east1` functions (`functions/src/index.ts:8661`, `:8905` on `main`), and the B4 readback covered `us-central1` only. Every non-`wsf` function keeps its UPDATE_TIME.
   - `functions:list` has **no revision column**. Compare revisions with `gcloud run services list --project=goarrive --region=<each region> --format="table(metadata.name,status.latestReadyRevisionName)"`.
2. **Rules:** the live ruleset equals `main` outside the WSF section (4.1, computed). GoArrive rule tests and the WSF rules suite (`functions-westayfit/jest.rules.config.cjs`, 28 tests) pass on the exact candidate file in the emulator.
3. **Indexes:** compare against the **live** before-capture (B7: 48, all READY), not `main`'s file. Every index in the capture is still READY, and the only new ones are the 2 WSF indexes.
4. **Hosting:** no Hosting deploy of any kind.
5. **Smoke test:** a GoArrive coach, member and platformAdmin each sign in and load home, and a GoArrive share link still works. That link uses anonymous sign-in.

## 7. Drift (code vs served)

| Row | main `41bff6c6` | development `ec162d17` | Staging served | Production (READBACK RECEIPT) | Still missing |
|---|---|---|---|---|---|
| Web app config | placeholder | real registration | n/a | WSF app exists; appId = development's | — |
| Callables | 1 | 59 | **49** (DEPLOYMENT RECEIPT below) | **17**, 2026-09-15, source not in repo; 16 ∩ A, 1 orphan | revisions of the 16 (rollback anchor) |
| `firestore.rules` WSF section | absent | 60 lines (active-member check) | not deployed by the staging workflow | 58 lines, SOURCE-MATCHED to `620c1689`; outside = main | — |
| WSF composite indexes | 0 | 2 | (same as above) | 0 (48 total, all READY) | — |
| `storage.rules` | = development | no WSF path | (same as above) | not read | B8 (no WSF step touches it) |
| `firebase.westayfit.json` | no rewrites | 13 rewrites incl. `/go/**` | staging config (on main) has 12, **no `/go/**`**, site `westayfit-staging` | site `westayfit-app` indicated by authorized domains | B9 |
| Mail env | n/a | needs `WSF_EMAIL_FROM`, `WSF_APP_URL` | written by the staging workflow | `WSF_APP_URL` = expired staging channel | B3b Resend domain |
| Consent version | n/a | `pending-approval-2026-08-25` (server and client) | same | the live source is not in repo | none: the owner launches on pending |

**Staging DEPLOYMENT RECEIPT:**
- GitHub deployment `6811752332`, environment `wsf-staging`, ops `b4b479a6`.
- Run `37025084843` (#60, `mode=deploy`, target `ab77fbfc`), success at 2026-10-02T15:24:10Z.
- This is staging only.

## 8. Deployment method and IAM

- **There is no reviewed production deploy workflow.**
  - 22 workflows are registered, and the only deploy workflow is `wsf-staging-deploy` (WIF to `westayfit-staging` only).
  - The Deployments API holds no production receipt.
  - The 2026-09-15 production WSF functions were deployed outside any recorded workflow.
- **The chosen path is Path A** (#365 `6075844761`): the owner runs the reviewed runbook (#600) with his own credentials.
- **Permissions a WSF-only production deploy needs:**
  - **`functions:westayfit`:** Cloud Functions Admin; Cloud Run Admin (the CLI sets `allUsers` `run.invoker` on each **created** WSF callable service); Service Account User on the runtime account; Cloud Build and Artifact Registry writer; Secret Manager admin.
  - **`firestore:rules`:** Firebase Rules Admin.
  - **Indexes:** Cloud Datastore Index Admin.
  - **Hosting:** not needed.
- **Who holds them (READBACK RECEIPT):** project Owners include the operator's own account (and one other owner account). The org policy `iam.allowedPolicyMemberDomains` is `allValues=ALLOW`, so `allUsers` is permitted. The full IAM output is retained by the owner and not reproduced.

## 9. Rollback

**Reversible surfaces, each with its anchor:**

| Surface | Anchor | Method |
|---|---|---|
| The 16 kept WSF functions | their **current Cloud Run revisions** (B4b), recorded before deploy; their source is **not** in this repository | Route traffic back to the recorded revision: `gcloud run services update-traffic <service> --region=us-central1 --project=goarrive --to-revisions=<revision>=100`.<br>That revision carries its own env (the old `WSF_APP_URL`) and the secret version it pinned. A later `firebase deploy` replaces it. A **source redeploy is not a rollback here**, for four reasons: no prior source exists in the repository, `functions:list` records none, a smaller source aborts on deletion under `--non-interactive`, and any functions deploy fails after 2026-10-30 (S1). |
| The 43 new WSF functions | none existed before | Delete only those, by name: `firebase functions:delete <name> --region us-central1 --project goarrive`.<br>The command asks for confirmation. Under `--non-interactive` without `--force` it aborts, so it runs interactively, one named function at a time. Deleting a function also deletes its Cloud Run service and that service's IAM policy. |
| Firestore rules | ruleset `1e14eab9-a23f-437f-8418-918b9eaefe65`; source = `firestore.rules` at `620c1689` | Re-release that ruleset (console Rules history › roll back, or the Rules API release update).<br>First re-read the release: if GoArrive released rules after the WSF deploy, re-releasing `1e14eab9…` would undo GoArrive's change too. |
| `WSF_APP_URL` env | the current value (2.4) | It comes back with the routed-back revisions (row 1). It is already known to be broken. |
| `WSF_EMAIL_API_KEY` | versions 1 and 2 enabled, v2 referenced (2.4) | No new version is planned. If one is added, disable it only after no deployed revision pins it: a deploy pins the version that `latest` resolved to. |
| `app.westay.fit` authorized domain | absent before the readback; added 2026-10-09 by the owner, **not** by a deploy | Not part of a deploy rollback. Remove it only if WSF Phase 1 is abandoned. |
| `app.westay.fit` hosting | Lovable deployment `b4b9d8d1-ed6a-49a7-966d-af688c3a0d39` (fail-closed shell) | The Lovable owner re-publishes it, with flags OFF. |
| 2 WSF composite indexes | none needed (additive) | Leave them, or delete the two. |

**Non-reversible risks, listed separately:**
- **`wsfListCommunityGoals` deletion:** its source is in no repository commit, so it cannot be redeployed from here once deleted.
- **Data:** real member data in `wsf*` collections and the shared Auth user pool, once signup opens.
- **Consent:** records stamped `pending-approval-2026-08-25` at signup (owner decision).
- **Email:** verification and reset emails already sent.
- **Rules:** a release whose GoArrive sections drift. Not the case for candidate A (4.1).
- **Functions:** any `westayfit`-codebase function deleted by a prune, including by H2.
- **`--force` side effects:** it accepts every deletion and the minimum-bill increase, and it sets a 1-day cleanup policy on the shared `gcf-artifacts` repository (S3).

## 10. Candidate (PROPOSAL ONLY: the reviewed runbook is #600)

- **Candidate A = development `ec162d17a0540e936741027f9b8f90dd372cfaf4` exactly, backend only.** It is the **launch candidate** by owner decision (#365 `6075884941`). It must never be operational main.
- **Candidate B** (A plus the consent-version commit) is **off the launch path** and stays a future record.

**Preconditions:**
1. The Director's named acceptance of A's exact SHA after #600's review.
2. B3b: a verified Resend sending domain for `WSF_EMAIL_FROM`.
3. The recorded decision on `wsfListCommunityGoals` (#600).
4. The revision names of the 16 kept services recorded as the rollback anchor (B4b).
5. **The deploy runs before 2026-10-30T00:00Z** (S1). Otherwise it needs a new candidate record on a newer runtime.
6. B4c shows the live `wsfCheckIn` minimum instances at 1 (S2), and B11 shows a cleanup policy or an opt-out on `gcf-artifacts` (S3). Either one failing is a stop for the runbook to resolve **without `--force`**.

**Order** (the exact commands are in #600):
1. Readbacks still owed (B3b, B4b, B4c, B4d, B5, B11).
2. Pre-flight.
3. The 2 WSF indexes, created with `gcloud` (additive; wait for READY).
4. Env: `WSF_APP_URL=https://app.westay.fit` plus the existing sender.
5. Rules (lawful: the live ruleset equals main outside the WSF section).
6. The orphan decision.
7. `firebase deploy --only functions:westayfit --project goarrive --config firebase.westayfit.production.json --non-interactive`, with no `--force`.
8. Verification.

**Verification:**
- Exactly the 59 WSF names in `us-central1`, with every non-`wsf` function unchanged.
- `allUsers` holds `roles/run.invoker` on **all 59** WSF callable services. Never remove it. Repair a kept service that lacks it only with an explicit owner decision.
- The rules release names the new ruleset, and both WSF indexes are READY.
- Then the two-account web journey on `app.westay.fit` after the owner's go.
- The GoArrive regression plan (6).

**Review classes:** ops-source and security.

## Readbacks: answered and still owed

**Answered** by the owner's readback (#365 `6076170543`; the owner's own section labels in brackets):

| Readback | What it answered |
|---|---|
| [B1] web apps | 1.3 |
| [B2] Auth config | 2.1, 2.2 |
| [B3] secret and env | 2.4 |
| [B4] functions | 3 |
| [B6] rules release | 4.1 |
| [B7] indexes | 4.2 |
| [B8] IAM and org policy | 8 |
| [B10] browser key | 2.6 |
| Step 11 action URL | 2.3 live |

**Still owed** (read-only, Devin):

| # | Row | Command or console path |
|---|---|---|
| B3b | 2.4 Resend sending domain | Resend dashboard › Domains: is `westay.fit` verified for sending? |
| B4b | 3 / 9 rollback anchor | `gcloud run services list --project=goarrive --region=us-central1 --format="table(metadata.name,status.latestReadyRevisionName)"` (record the serving revision of each of the 16 kept services; repeat per region for the GoArrive regression baseline, 6) |
| B4c | 3 S2 minimum instances | `gcloud functions describe wsfCheckIn --gen2 --region=us-central1 --project=goarrive --format="value(serviceConfig.minInstanceCount)"` |
| B4d | 6 codebase labels | `gcloud functions list --project=goarrive --regions=us-central1 --filter="name~/functions/wsf" --format="yaml(name,labels)"` (is `firebase-functions-codebase: westayfit` on each of the 17?) |
| B5 | 3 invoker | `gcloud run services get-iam-policy <service> --region=us-central1 --project=goarrive` (each kept service should already list `allUsers`) |
| B8 | 4.3 Storage rules | release `projects/goarrive/releases/firebase.storage/goarrive.firebasestorage.app`; or console › Storage › Rules |
| B9 | 5.2, 5.3 Hosting | `firebase hosting:sites:list --project goarrive`; host and DNS of `westay.fit` |
| B11 | 3 S3 cleanup policy | `gcloud artifacts repositories describe gcf-artifacts --location=us-central1 --project=goarrive --format="yaml(cleanupPolicies,labels)"` |

**Hidden for Phase 1, and nothing more:** Event lifecycle (not exported); profile photos (7 exports); raffle/promotion (not exported); admin/Champion management (`wsfRemoveMember`, `wsfReinstateMember`, `wsfDesignateChampion`, `wsfAdjustGoal`, `wsfCloseCombinedGoal`, `wsfRepairCombinedGoal`).

**Not established here:** the readbacks still owed above; DNS; hosted re-verification by W9; and any deployment of candidate A. This is delivered source only: not reviewed, accepted, integrated, staged or deployed.
