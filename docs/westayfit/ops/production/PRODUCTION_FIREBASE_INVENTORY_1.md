# PRODUCTION-FIREBASE-INVENTORY-1: WSF production Firebase, source vs deployed

**Status: read-only inventory, dated 2026-10-09 at about 05:45Z, by W9.**
- **Authority:** queue #365 `6074830303`, release `6074831300` and critical path `6074833005`. The owner decisions are `6072718440`, `6073175126`, `6074580396` §2, `6074607727` and `6074643881`. This builds on the prior fact sheet `6070407860`.
- **Machine-readable twin:** [`wsf-production-inventory.v1.json`](wsf-production-inventory.v1.json). It holds the same facts, plus every callable as a record.

**Nothing was changed.** No production, GoArrive, IAM, WIF, Auth, DNS, secret, rule, index, Storage, Hosting or data state was touched, and nothing was deployed or dispatched.

**No credential was used.** This session has no `gcloud` or `firebase` login. W9 did not use any token, the staging WIF identity, or another worker's access. No secret, API key or action link appears here; the web app registration is described by its appId *shape* only.

**What this session could and could not reach:**
- **Hosting checks were refused.** Anonymous HTTPS GETs to `app.westay.fit`, `westay.fit`, `westayfit-app.web.app`, `westayfit-app.firebaseapp.com`, `goarrive.web.app` and `we-stay-fit-foundation-trial.lovable.app` were refused by this session's egress proxy (`CONNECT 403`, 2026-10-09T05:38:43Z).
- **DNS does not work.** External DNS does not resolve in this sandbox.
- **So every live row is BLOCKED.** Each one names the exact read-only command or console path, and **Devin** as the operator who holds production access.

**Evidence classes:**
- **SOURCE INSPECTED:** read from the repository at a named SHA.
- **DEPLOYMENT RECEIPT:** a GitHub Deployments or Actions record.
- **HOSTED VERIFIED:** observed on the live host. Every such row here is *cited* from the owner's dated hosted check and not re-verified by W9.
- **BLOCKED:** needs a credentialed readback that this session cannot make.

**Never inferred:** nothing below treats source as proof of what is deployed.

| Ref | SHA | What it is |
|---|---|---|
| operational main | `41bff6c643ab4537d47a0732da48cfb86dc64b6b` | ops tooling, workflows, GoArrive app; the base of this PR |
| development | `ec162d17a0540e936741027f9b8f90dd372cfaf4` | `claude/wsf-app-shell`: the WSF app and backend source |
| staging-served WSF app | `ab77fbfce97e60c1c22492397b2ab6b491f9e0db` | an ancestor of `ec162d17`, deployed to `westayfit-staging` (see 7) |
| Lovable hosted source | `77172f45a2c100c85975bd4437a8aed95831f36b` | deployment `b4b9d8d1-ed6a-49a7-966d-af688c3a0d39` on `app.westay.fit` (cited) |

## Bottom line

1. **The production backend state is unknown.** No production deployment receipt exists. The Deployments API shows 0 for `production`, `Production`, `prod`, `wsf-production` and `goarrive`, and there is no reviewed production deploy workflow. Every live production row is BLOCKED on Devin's read-only readbacks, which are listed in one place in [the readback list](#blocked-readbacks-one-list-for-devin).
2. **Operational `main` must never be the source of a WSF production deploy.** On `main`:
   - `functions-westayfit` exports **1** callable (`wsfHealth`), against 59 on development;
   - `firestore.rules` has **no** WSF section;
   - `apps/westayfit/src/firebase.ts` is the M-U1 placeholder config.

   A `functions:westayfit` deploy from `main`, forced or with an accepted prompt, would prune every other WSF function.
3. **One backend release blocker is in source.** `wsfSaveProfile` stamps the consent version **server-side** as `pending-approval-2026-08-25`, at `functions-westayfit/src/index.ts:124-125`, mirrored by `apps/westayfit/src/profileConstants.ts:1-2`. Any production profile written today records consent to unapproved text. The fix is a reviewed source change to both files, made after the policy version is legally approved.
4. **Phase 1 depends on things a deploy cannot prove alone:**
   - `app.westay.fit` must be an authorized Auth domain;
   - WSF production mail must be configured (a `WSF_EMAIL_API_KEY` secret and `WSF_EMAIL_FROM`/`WSF_APP_URL`);
   - the WSF Firestore rules section must be **deployed**, because the client reads three WSF collections directly;
   - the 11 Phase-1 journey callables must be served.

   None of these is read back.

## 1. Project identity

| Row | Evidence | Fact |
|---|---|---|
| 1.1 Production project selected by source | SOURCE INSPECTED | `.firebaserc` defaults to `goarrive`. Development `apps/westayfit/src/firebase.ts:21` fixes `PROD_PROJECT_ID = 'goarrive'`, with production config at `:79-86`. Staging is selected only by a complete `EXPO_PUBLIC_WSF_STAGING_*` config plus `EXPO_PUBLIC_WSF_ENV` (`src/stagingEnv.ts`), which refuses production identifiers. The emulator id `demo-wsf-local` is used only on a loopback host. |
| 1.2 Staging project | SOURCE INSPECTED + DEPLOYMENT RECEIPT | Staging is a **separate** project, `westayfit-staging`, with Hosting site `westayfit-staging`, channel `https://westayfit-staging--staging-4a616y5m.web.app`, and WIF pool `projects/857281977774/…/wsf-staging-github` (`.github/workflows/wsf-staging-deploy.yml:148-155` on main). Production is the **shared** `goarrive` project. |
| 1.3 WSF web app registration in `goarrive` | SOURCE INSPECTED | Development appId has the shape `1:<goarrive project number>:web:<22 hex>`. It is a **distinct** app from GoArrive's web app: same shape, different value, compared without printing. The source comment cites console receipt #dev-westayfit 2026-08-26. `apiKey` and `messagingSenderId` are per-project and equal GoArrive's, and are not reproduced. **Drift:** `main` still carries the scaffold placeholder, with a different sender id, a non-hex appId suffix (`westayfit-app`) and a different apiKey. |
| 1.3 live | BLOCKED | `firebase apps:list WEB --project goarrive`, or console › goarrive › Project settings › General › Your apps (name and appId only). |

## 2. Auth

| Row | Evidence | Fact |
|---|---|---|
| 2.1 Authorized domains: `app.westay.fit`, `westay.fit` and the Lovable trial host | BLOCKED | All three are **unknown**. Read back with `GET https://identitytoolkit.googleapis.com/admin/v2/projects/goarrive/config` → `.authorizedDomains` (operator token, never pasted), or console › Authentication › Settings › Authorized domains. Why it matters: the mail callables mint links with continue URL `WSF_APP_URL`, and Auth refuses a continue URL on an unauthorized domain. |
| 2.2 Providers | SOURCE INSPECTED | The client uses **Email/Password only** (`createUserWithEmailAndPassword`, `signInWithEmailAndPassword`). There is no OAuth, anonymous, phone or custom-token sign-in. The live provider list is BLOCKED (same config → `.signIn`, or console › Sign-in method). |
| 2.3 Verification and reset path | SOURCE INSPECTED | The client never calls Firebase's built-in mail (`apps/westayfit/src/verificationEmail.ts`, `passwordResetEmail.ts`). `wsfSendVerificationEmail` and `wsfSendPasswordResetEmail` mint the link with the Admin SDK and send it through Resend (`functions-westayfit/src/index.ts:327-400`). At runtime they need the secret **`WSF_EMAIL_API_KEY`** and the env **`WSF_EMAIL_FROM`** and **`WSF_APP_URL`**. `WSF_AUTH_ACTION_HANDLER` is optional and defaults to `https://goarrive.firebaseapp.com/__/auth/action`. Missing config fails closed with `failed-precondition`. Source note N-U11 records that the project's custom Auth action URL points at a route GoArrive's catch-all answers with an app shell, which is why WSF retargets its links. |
| 2.4 Production mail config | BLOCKED | Read back with `gcloud secrets versions list WSF_EMAIL_API_KEY --project=goarrive` (metadata only), and `gcloud run services describe wsfsendverificationemail --region=us-central1 --project=goarrive --format="yaml(spec.template.spec.containers[0].env)"` (non-secret env only). The last dated note (`docs/westayfit/dispatch/E3.5-PHONE-TEST-FIXES.md` F13, Resend state 2026-09-06 16:44Z) said the secret held a placeholder, the env was never set, and Resend had verified `goarrive.fit` only, not `westay.fit`. **There is no production mechanism for this env:** staging writes it through `.github/wsf-staging/write-functions-env.mjs`, and nothing does that for production. |
| 2.5 Can the Lovable Web Twin sign in against production without a native release? | BLOCKED | **This cannot be proven from here.** It needs all of the following, and none is read back: 2.1 authorized domain; a Lovable build carrying the development WSF production config (1.3); the WSF rules section deployed (4.1); the Phase-1 callables served (3); and the production mail config (2.4). A native release is **not** a dependency: no native-only surface is on the Phase-1 path. |

## 3. Callables

`functions-westayfit` has **59** exports at development, **49** at staging-served `ab77fbfc`, **1** at operational main, and an **unknown** number in production (BLOCKED, R3.B1).
- All 59 are in `us-central1`, and none declares App Check.
- `wsfCheckIn` alone sets `minInstances` (`projectID == goarrive ? 1 : 0`, `index.ts:1985`), so production keeps one warm instance. That has a cost.
- 17 exports declare `invoker: 'public'` in source. The effective Cloud Run IAM is a deployed fact (BLOCKED): `gcloud run services get-iam-policy <service> --region=us-central1 --project=goarrive`.

**Added since staging-served (10), not served anywhere known:**
- `wsfResolveMarker`, `wsfJoinViaMarker`, `wsfPublicPreviewLabel`;
- seven photo callables: `wsfMyProfilePhoto`, `wsfSetProfilePhoto`, `wsfRemoveProfilePhoto`, `wsfSetPortraitDecision`, `wsfSetCommunityPhotoVisibility`, `wsfCommunityFaces`, `wsfCommunityFacePhotos`.

**Changed within existing names since `ab77fbfc`** (#559, #571, #586, #587, and the preview-label, marker and photo merges): count equality would not prove compatibility.

**Not exported:**
- the Event lifecycle (PR #595, held on security review);
- the raffle/promotion modules (`functions-westayfit/src/expo-prize/*`).

**Phase-1 web journey** (signup/verify → profile → join → manual MOVE → confirmed receipt → Living WE): the rows marked **P1 journey**. "P1 supporting" covers the Home/Community/Progress/You states and the Champion's setup of the real community and goal. Event, photo, raffle and admin features are **hidden / not required for Phase 1**.

| # | Callable | Phase 1 | Handler auth | `invoker` in source | In staging-served `ab77fbfc` | Canonical client calls it | Production |
|---|---|---|---|---|---|---|---|
| 1 | `wsfSaveProfile` ⚠︎ | **P1 journey** | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 2 | `wsfSendVerificationEmail` | **P1 journey** | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 3 | `wsfPreviewCommunity` | **P1 journey** | none (by design) | public | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 4 | `wsfJoinCommunity` | **P1 journey** | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 5 | `wsfMyCommunities` | **P1 journey** | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 6 | `wsfSendPasswordResetEmail` | **P1 journey** | none (by design) | public | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 7 | `wsfContribute` | **P1 journey** | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 8 | `wsfGoalPulse` | **P1 journey** | none (by design) | public | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 9 | `wsfGoalRecentAdditions` | **P1 journey** | none (by design) | public | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 10 | `wsfMyContribution` | **P1 journey** | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 11 | `wsfListGoals` | **P1 journey** | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 12 | `wsfCreateCommunity` | P1 supporting | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 13 | `wsfResolveMarker` | P1 supporting | none (by design) | public | **no** | yes | UNKNOWN (BLOCKED R3.B1) |
| 14 | `wsfJoinViaMarker` | P1 supporting | signed in | — | **no** | yes | UNKNOWN (BLOCKED R3.B1) |
| 15 | `wsfResetJoinCode` | P1 supporting | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 16 | `wsfLeaveCommunity` | P1 supporting | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 17 | `wsfCreateGoal` | P1 supporting | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 18 | `wsfSetGoalDisplayAuthorization` | P1 supporting | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 19 | `wsfSetCommunityVisibility` | P1 supporting | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 20 | `wsfCommunityMembers` | P1 supporting | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 21 | `wsfCommunityActivity` | P1 supporting | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 22 | `wsfListChallenge` | legacy challenge | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 23 | `wsfCheckIn` ¹ | legacy challenge | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 24 | `wsfChallengePulse` | legacy challenge | signed in | public | yes | no | UNKNOWN (BLOCKED R3.B1) |
| 25 | `wsfPublicPreviewLabel` | Phase 2 | none (by design) | public | **no** | no | UNKNOWN (BLOCKED R3.B1) |
| 26 | `wsfStationRequestPairing` | Phase 2 | none (by design) | public | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 27 | `wsfStationPairingStatus` | Phase 2 | pairing id | public | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 28 | `wsfApproveStation` | Phase 2 | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 29 | `wsfStationClaimPairing` | Phase 2 | pairing id | public | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 30 | `wsfStationState` | Phase 2 | station secret | public | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 31 | `wsfListStations` | Phase 2 | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 32 | `wsfRevokeStation` | Phase 2 | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 33 | `wsfCreateCombinedGoal` | Phase 2 | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 34 | `wsfCombinedGoalPulse` | Phase 2 | none (by design) | public | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 35 | `wsfEventContext` | Phase 2 | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 36 | `wsfJoinTurnLine` | Phase 2 | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 37 | `wsfMyTurn` | Phase 2 | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 38 | `wsfTurnReady` | Phase 2 | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 39 | `wsfLeaveTurnLine` | Phase 2 | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 40 | `wsfTurnState` | Phase 2 | station secret | public | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 41 | `wsfCallNext` | Phase 2 | station secret | public | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 42 | `wsfStartTurn` | Phase 2 | station secret | public | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 43 | `wsfCompleteTurn` | Phase 2 | station secret | public | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 44 | `wsfCompleteMyTurn` | Phase 2 | signed in | — | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 45 | `wsfCancelTurn` | Phase 2 | station secret | public | yes | yes | UNKNOWN (BLOCKED R3.B1) |
| 46 | `wsfRemoveMember` | hidden | signed in | — | yes | no | UNKNOWN (BLOCKED R3.B1) |
| 47 | `wsfReinstateMember` | hidden | signed in | — | yes | no | UNKNOWN (BLOCKED R3.B1) |
| 48 | `wsfDesignateChampion` | hidden | signed in | — | yes | no | UNKNOWN (BLOCKED R3.B1) |
| 49 | `wsfAdjustGoal` | hidden | signed in | — | yes | no | UNKNOWN (BLOCKED R3.B1) |
| 50 | `wsfCloseCombinedGoal` | hidden | signed in | — | yes | no | UNKNOWN (BLOCKED R3.B1) |
| 51 | `wsfRepairCombinedGoal` | hidden | signed in | — | yes | no | UNKNOWN (BLOCKED R3.B1) |
| 52 | `wsfMyProfilePhoto` | hidden | signed in | — | **no** | no | UNKNOWN (BLOCKED R3.B1) |
| 53 | `wsfSetProfilePhoto` | hidden | signed in | — | **no** | no | UNKNOWN (BLOCKED R3.B1) |
| 54 | `wsfRemoveProfilePhoto` | hidden | signed in | — | **no** | no | UNKNOWN (BLOCKED R3.B1) |
| 55 | `wsfSetPortraitDecision` | hidden | signed in | — | **no** | no | UNKNOWN (BLOCKED R3.B1) |
| 56 | `wsfSetCommunityPhotoVisibility` | hidden | signed in | — | **no** | no | UNKNOWN (BLOCKED R3.B1) |
| 57 | `wsfCommunityFaces` | hidden | signed in | — | **no** | no | UNKNOWN (BLOCKED R3.B1) |
| 58 | `wsfCommunityFacePhotos` | hidden | signed in | — | **no** | no | UNKNOWN (BLOCKED R3.B1) |
| 59 | `wsfHealth` | ops | signed in | — | yes | no | UNKNOWN (BLOCKED R3.B1) |

⚠︎ **Release blocker:** the `wsfSaveProfile` consent stamp `pending-approval-2026-08-25` (`index.ts:124-125`, `profileConstants.ts:1-2`). `apps/westayfit/src/legalContent.ts` also ships text marked "pending approval and will be replaced before public launch". ¹ `minInstances` resolves to 1 on `goarrive`.

**R3.B1, served inventory and revisions (BLOCKED, Devin):**
- `firebase functions:list --project goarrive`
- `gcloud functions list --project=goarrive --regions=us-central1 --format="table(name,state,updateTime,environment)"`
- `gcloud run revisions list --region=us-central1 --project=goarrive --service=<service>`

## 4. Firestore rules and indexes, Storage rules

| Row | Evidence | Fact |
|---|---|---|
| 4.1 Firestore rules, source | SOURCE INSPECTED | `main` has 1201 lines and **no WSF section**, so WSF collections fall to the catch-all deny at line 1197. Development has 1261 lines: `main` plus **one** 60-line WSF section (lines 1198-1256), placed before the catch-all deny (1257). Outside that section the two are byte-identical. The section covers: <br>• `wsfMemberProfiles`: owner read; owner create/update only with a verified email and `adultConfirmation == true`; delete false. <br>• `wsfCommunityGroups`: current-member read; client writes false. <br>• `wsfMemberships`: owner read by the `userId` field; client writes false. |
| 4.1 Why it is launch-critical | SOURCE INSPECTED | The WSF client reads `wsfMemberProfiles` directly (signin, signup, verify-email, profile-setup), as well as `wsfMemberships` and `wsfCommunityGroups` (community, goals/new). Without the WSF section **deployed**, those reads are denied. |
| 4.1 Stale invariant | SOURCE INSPECTED | The rules still require `adultConfirmation`. `wsfSaveProfile` no longer writes it (DECISIONS 2026-09-06 removed the age gate), and profiles are written by the Admin SDK, so the rule is inert for create. It must still be reconciled with the approved 13+ eligibility before anyone relies on it. |
| 4.1 Deployed | BLOCKED | `GET https://firebaserules.googleapis.com/v1/projects/goarrive/releases/cloud.firestore` → `rulesetName`, then GET that ruleset and sha256 its source; or console › Firestore › Rules (current and history). **The ruleset is shared:** deploying `firestore.rules` replaces GoArrive's rules too. |
| 4.2 Composite indexes, source | SOURCE INSPECTED | `main` has 48 composite indexes, 0 of them WSF. Development has 50: `main` plus **`wsfContributions(communityGroupId ASC, createdAt DESC)`** and **`wsfGoalMemberTotals(userId ASC, updatedAt DESC)`**. Field overrides (2) are unchanged and non-WSF. Every other WSF query is equality-only or single-field by design. |
| 4.2 Deployed / READY | BLOCKED | `gcloud firestore indexes composite list --project=goarrive --format="table(name,collectionGroup,state,fields)"` |
| 4.3 Storage rules, source | SOURCE INSPECTED | Identical on main and development. There is no WSF path, and the file ends in a catch-all deny (line 77). WSF stores no Cloud Storage object: photos live in Firestore `wsfProfilePhotos`. |
| 4.3 Deployed | BLOCKED | The Rules API release `projects/goarrive/releases/firebase.storage/goarrive.firebasestorage.app`, or console › Storage › Rules. |

## 5. Hosting

| Row | Evidence | Fact |
|---|---|---|
| 5.1 `app.westay.fit` | HOSTED VERIFIED (cited, not re-verified by W9) | #365 `6073175126` (posted 2026-10-09T02:42Z): Lovable deployment `b4b9d8d1-ed6a-49a7-966d-af688c3a0d39` of source `77172f45` serves a **fail-closed shell** ("WE STAY FIT is almost here"). Signed out, it makes zero Firebase or other external calls; five reviewer, practice, kiosk and Events paths return 404; and 71 assets match the pre-publish manifest. The production flag is OFF. **Lovable**, not Firebase Hosting, serves this name. W9's own readback is BLOCKED by session egress. |
| 5.2 `westay.fit` (marketing) | BLOCKED | No WSF source or workflow in this repository touches it. Its host was not read back. |
| 5.3 Firebase Hosting site `westayfit-app` | SOURCE INSPECTED | It is named in `firebase.westayfit.json`, which targets production via the `.firebaserc` default. Development adds 13 dynamic-route rewrites, including `/go/**`. Nothing proves the site exists, is deployed, or is bound to a domain. Read back (BLOCKED) with `firebase hosting:sites:list --project goarrive` and `GET https://firebasehosting.googleapis.com/v1beta1/sites/westayfit-app/releases?pageSize=5`. **No Phase-1 role:** Lovable is the sole Web Twin frontend. |
| 5.4 GoArrive Hosting | SOURCE INSPECTED | `firebase.json` hosting has no `site`, so it resolves to the project default (`goarrive.web.app`) and serves `apps/goarrive/dist` with a `**` catch-all. A WSF action must never run a bare `firebase deploy` or `--only hosting` with `firebase.json`. |
| 5.5 Lovable trial host | HOSTED VERIFIED (cited) | `we-stay-fit-foundation-trial.lovable.app` is the staging owner-test host on `westayfit-staging` (#365 `6072718440`, `6073175126`, `6074643881`). It is not production. |

## 6. GoArrive boundary

**WSF-only:**
- **Codebase:** `functions-westayfit`, codebase `westayfit` (`firebase.json` `functions[1]`).
- **Rules:** the rules section at lines 1198-1256 (development).
- **Secret:** `WSF_EMAIL_API_KEY`.
- **29 collections:** `wsfChallengeCounters`, `wsfChallengeMoves`, `wsfChallengeParticipants`, `wsfChallenges`, `wsfCheckIns`, `wsfCombinedCounters`, `wsfCombinedCredits`, `wsfCombinedGoalClaims`, `wsfCombinedGoals`, `wsfCommunityGroups`, `wsfContributions`, `wsfGoalAdjustments`, `wsfGoalCounters`, `wsfGoalMemberTotals`, `wsfGoals`, `wsfKioskPairings`, `wsfKioskStations`, `wsfMarkers`, `wsfMemberProfiles`, `wsfMemberships`, `wsfPasswordResetSends`, `wsfPreviewRateLimits`, `wsfProfilePhotos`, `wsfStationRateLimits`, `wsfTurnEntries`, `wsfTurnLines`, `wsfTurnMembers`, `wsfTurnReceipts`, `wsfVerificationSends`.
- **Source-only:** `wsfPromotion*`, used by the unexported raffle modules.

**Shared with GoArrive:**
- the Auth user pool;
- the Firestore database and its **single** ruleset and index set;
- the Storage bucket and rules;
- Secret Manager;
- Cloud Run and IAM;
- billing;
- the project's custom Auth action URL and email templates.

**GoArrive code that touches WSF: none.**
- `functions/src` references no `wsf` collection.
- There are no Auth blocking or user-onCreate triggers.
- The one all-users scan, `seedMissingCoachDocs`, acts only on `role: coach`/`admin` claims. WSF uses zero custom claims.

**What `firebase deploy --only functions:westayfit` touches:**
- It touches only the `westayfit` codebase, and cannot reach GoArrive's `default` codebase.
- It creates or updates the WSF functions.
- It would **delete** any `westayfit`-codebase function missing from the candidate source. With `--non-interactive` and no `--force`, the CLI aborts instead of deleting.
- **Prune hazard:** operational main has one WSF export, so never deploy WSF functions from main.

**Regression plan (proves GoArrive is unchanged):**
1. **Functions:** `firebase functions:list --project goarrive` before and after. Every `default`-codebase function keeps its name, region and revision.
2. **Rules:** the deployed ruleset differs from the candidate only inside the WSF section. GoArrive rule tests and the WSF rules suite (`functions-westayfit/jest.rules.config.cjs`, 28 tests) pass on the exact candidate file in the emulator.
3. **Indexes:** all 48 GoArrive composite indexes are still READY. Only the 2 WSF indexes are added.
4. **Hosting:** no Hosting deploy of any kind. The `goarrive.web.app` release is unchanged.
5. **Smoke test:** a GoArrive coach, member and platformAdmin each sign in and load home, and a WSF account is refused by GoArrive's role guards.

## 7. Drift (code vs served)

| Row | main `41bff6c6` | development `ec162d17` | Staging served | Production | Missing proof |
|---|---|---|---|---|---|
| Web app config | placeholder | real registration | n/a | n/a (client config) | Lovable production build values vs the development registration |
| Callables | 1 | 59 | **49** (DEPLOYMENT RECEIPT below) | UNKNOWN | R3.B1 |
| `firestore.rules` WSF section | absent | present (60 lines) | not deployed by the staging workflow (rules/indexes are absent from `firebase.westayfit.staging.json`) | UNKNOWN | 4.1 deployed |
| WSF composite indexes | 0 | 2 | (same as above) | UNKNOWN | 4.2 |
| `storage.rules` | = development | no WSF path | (same as above) | UNKNOWN | 4.3 |
| `firebase.westayfit.json` | no rewrites | 13 rewrites incl. `/go/**` | staging config (on main) has 12 rewrites, **no `/go/**`**, site `westayfit-staging` | site existence UNKNOWN; `app.westay.fit` is Lovable (cited) | 5.3 |
| Consent version | n/a | `pending-approval-2026-08-25` (server and client) | same | UNKNOWN | approved policy version, then a reviewed source change |

**Staging DEPLOYMENT RECEIPT:**
- GitHub deployment `6811752332`, environment `wsf-staging`, ops `b4b479a6`.
- Run `37025084843` (#60, `mode=deploy`, target `ab77fbfc`), success at 2026-10-02T15:24:10Z.
- This is staging only; it is **not** a production receipt.

## 8. Deployment method and IAM

- **Today there is no reviewed production deploy workflow.**
  - 22 workflows are registered, and the only deploy workflow is `wsf-staging-deploy`. It authenticates through WIF to `westayfit-staging` only.
  - The Deployments API holds no production receipt.
  - The documented GoArrive production path is an operator running `firebase deploy` with the `goarrive` Admin SDK service-account key (`.claude/firebase-deploy-setup.md`: `firebase-adminsdk-fbsvc@goarrive…`). CLAUDE.md forbids that path for WSF staging.
- **Permissions a WSF-only production deploy needs:**
  - **`functions:westayfit`:** Cloud Functions Admin; Cloud Run Admin (to set `allUsers` `run.invoker` on the 17 declared-public services); Service Account User on the runtime account; Cloud Build and Artifact Registry writer; Secret Manager admin (to bind the `WSF_EMAIL_API_KEY` accessor).
  - **`firestore:rules`:** Firebase Rules Admin.
  - **Indexes:** Cloud Datastore Index Admin.
  - **Authorized domains:** Firebase Authentication Admin.
  - **Hosting:** not needed.
- **Who holds them: BLOCKED (Devin).** Read back with:
  - `gcloud projects get-iam-policy goarrive --format=json`;
  - `gcloud resource-manager org-policies describe iam.allowedPolicyMemberDomains --project=goarrive`, which shows whether an `allUsers` invoker is even permitted.

## 9. Rollback

**Reversible surfaces, each with its anchor (to be recorded *before* any change):**

| Surface | Anchor | Method |
|---|---|---|
| WSF functions | UNKNOWN: prior production revisions per WSF service (R3.B1) | Redeploy the recorded prior source with `functions:westayfit`. If no WSF function existed before, delete only the newly created `westayfit`-codebase functions, by name. |
| Firestore rules | UNKNOWN: the current `cloud.firestore` release `rulesetName` (4.1) | Re-release the recorded prior ruleset (console Rules history › roll back, or update the Rules API release). This is shared with GoArrive. |
| Auth authorized domain | the current list (2.1) | Remove the added domain. |
| `WSF_EMAIL_API_KEY` version | the current versions (2.4) | Disable the new version. |
| `app.westay.fit` | Lovable deployment `b4b9d8d1-ed6a-49a7-966d-af688c3a0d39` (fail-closed shell) | The Lovable owner re-publishes it, with the production flag OFF. |
| 2 WSF composite indexes | none needed (additive) | Leave them, or delete the two. |

**Non-reversible risks, listed separately:**
- **Data:** real member data in `wsf*` collections and in the shared Auth user pool, once signup opens.
- **Consent:** records stamped with whatever version is live at signup. Today that is `pending-approval-2026-08-25`.
- **Email:** verification and reset emails already sent, which affects the sender domain's reputation.
- **Rules:** a release whose GoArrive sections drift affects GoArrive for as long as it stays released.
- **Indexes:** an index deletion accepted during a full `firestore:indexes` deploy costs rebuild time.
- **Functions:** any `westayfit`-codebase function deleted by a prune (see 6).

## 10. Candidate (PROPOSAL ONLY: not executed; needs ops-source and security review in the deploy-candidate packet that follows)

**SHA: none is deployable for open signup today.**
- **Candidate base:** development `ec162d17a0540e936741027f9b8f90dd372cfaf4`, plus **one** reviewed commit setting the approved consent version in `functions-westayfit/src/index.ts:124-125` and `apps/westayfit/src/profileConstants.ts:1-2`.
- **The candidate:** the SHA that results. It must descend from `ec162d17` and must never be operational main.

**Preconditions:**
1. An owner-approved, legally reviewed Terms/Privacy/eligibility version (#365 `6074580396`, `6074607727`).
2. Every BLOCKED readback in this sheet recorded with a dated receipt.
3. A verified Resend sender domain for `WSF_EMAIL_FROM`.

**Order:**
0. **Readbacks:** record 1.3, 2.1, 2.4, R3.B1, 4.1, 4.2, 4.3, 5.3 and 8. This step changes nothing.
1. **Indexes** (additive, WSF-only, GoArrive's index set untouched). Run `gcloud firestore indexes composite create --project=goarrive --collection-group=wsfContributions --field-config=field-path=communityGroupId,order=ascending --field-config=field-path=createdAt,order=descending`. Run the same for `wsfGoalMemberTotals` (`userId` ascending, `updatedAt` descending). Wait for READY.
2. **Secret and env.** Enable a `WSF_EMAIL_API_KEY` version in `goarrive` Secret Manager. Generate `functions-westayfit/.env.goarrive` at deploy time (never committed) with `WSF_EMAIL_FROM` and `WSF_APP_URL=https://app.westay.fit`, plus `WSF_AUTH_ACTION_HANDLER` only if a real handler route exists.
3. **Auth.** Add `app.westay.fit` to the authorized domains, and confirm Email/Password is enabled.
4. **Rules.** Deploy only if the deployed ruleset equals main's `firestore.rules` outside the WSF section. Then run `firebase deploy --only firestore:rules --project goarrive` from the candidate checkout, and record the new and prior ruleset names.
5. **Functions.** Run `firebase deploy --only functions:westayfit --project goarrive --non-interactive` with **no `--force`**, from the candidate checkout. Use a production config that declares only the `westayfit` codebase (mirroring `firebase.westayfit.staging.json`, without Hosting) so GoArrive's `default` codebase cannot be reached even by mistake.
6. **Hosting:** none. Lovable serves `app.westay.fit`.

**Verification:**
- `functions:list` shows exactly the 59 WSF names, in `us-central1`, at the candidate revision; GoArrive's list is unchanged.
- `allUsers` invoker is set only on the 17 declared-public services.
- The rules release equals the candidate, and both WSF indexes are READY.
- A two-account real web journey runs on `app.westay.fit`, with the production flag ON only after the legal gates:
  1. signup, with the verification email received;
  2. profile;
  3. join by approved link;
  4. manual MOVE;
  5. one confirmed receipt;
  6. the same Living WE total in a second browser;
  7. denial for a nonmember.
- The GoArrive regression plan in section 6 passes.

**Rollback:** section 9, in reverse step order.

**Review classes:** ops-source and security.

## BLOCKED readbacks: one list for Devin

These are all read-only, and none prints a secret. Paste results without tokens.

| # | Row | Command or console path |
|---|---|---|
| B1 | 1.3 web app | `firebase apps:list WEB --project goarrive` |
| B2 | 2.1, 2.2 Auth domains and providers | `GET https://identitytoolkit.googleapis.com/admin/v2/projects/goarrive/config` → `.authorizedDomains`, `.signIn`; or console › Authentication › Settings / Sign-in method |
| B3 | 2.4 mail | `gcloud secrets versions list WSF_EMAIL_API_KEY --project=goarrive`; `gcloud run services describe wsfsendverificationemail --region=us-central1 --project=goarrive --format="yaml(spec.template.spec.containers[0].env)"` |
| B4 | 3 served callables and revisions | `firebase functions:list --project goarrive`; `gcloud functions list --project=goarrive --regions=us-central1 --format="table(name,state,updateTime,environment)"`; `gcloud run revisions list --region=us-central1 --project=goarrive --service=<service>` |
| B5 | 3 invoker | `gcloud run services get-iam-policy <service> --region=us-central1 --project=goarrive` (per WSF service) |
| B6 | 4.1 Firestore rules | `GET https://firebaserules.googleapis.com/v1/projects/goarrive/releases/cloud.firestore`, then the ruleset; or console › Firestore › Rules |
| B7 | 4.2 indexes | `gcloud firestore indexes composite list --project=goarrive --format="table(name,collectionGroup,state,fields)"` |
| B8 | 4.3 Storage rules | release `projects/goarrive/releases/firebase.storage/goarrive.firebasestorage.app`; or console › Storage › Rules |
| B9 | 5.2, 5.3 Hosting | `firebase hosting:sites:list --project goarrive`; `GET https://firebasehosting.googleapis.com/v1beta1/sites/westayfit-app/releases?pageSize=5`; host and DNS of `westay.fit` |
| B10 | 8 IAM | `gcloud projects get-iam-policy goarrive --format=json`; `gcloud resource-manager org-policies describe iam.allowedPolicyMemberDomains --project=goarrive` |

**Hidden for Phase 1, and nothing more:** Event lifecycle (not exported); profile photos (7 exports); raffle/promotion (not exported); admin/Champion management (`wsfRemoveMember`, `wsfReinstateMember`, `wsfDesignateChampion`, `wsfAdjustGoal`, `wsfCloseCombinedGoal`, `wsfRepairCombinedGoal`).

**Not established here:** any live production state; DNS; hosted re-verification by W9; and a real signup on production. This is delivered source only: not reviewed, accepted, integrated, staged or deployed.
