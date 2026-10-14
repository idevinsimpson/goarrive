# GATED-RECOVERY-1 — consolidated staging recovery package

Status: PREPARED FOR REVIEW. Not passed. Nothing executed against staging.
Prepared by Lovable (sole implementation owner), 2026-10-13; documentation-only correction 2026-10-14. Draft review only; all holds remain.

## Scope and holds
No deployment, dispatch, merge, release, publication, Auth/IAM/account/index/session change or protected-control change is requested by this PR. PRs #623–#626 stay held. Progress history stays off. Recurring audits stay paused. P1 (already-issued anonymous tokens) remains OPEN until the exact-serving-build and emulator evidence below is complete. This correction incorporates W11 #627 comment 6176338395 (R1–R3 detailed in #629 comment 6176330430) and L0/Fable #365 comments 6176350289 and superseding ordered checklist 6176858858, plus W11 D1–D5 (#629 comment 6176430283); their old-head verdicts do not approve this new head.

## Candidate identity
- Repository: `idevinsimpson/goarrive`; base branch `claude/wsf-app-shell`.
- Base / functions-source candidate: `a6eaf0be95cb0a81de4f24bc6d7f30ac82ce922f` (read via GitHub API 2026-10-13 21:48Z). 7 ahead / 0 behind approved `ec162d17a0540e936741027f9b8f90dd372cfaf4`.
- This PR adds this one docs file only. Functions source on this branch is byte-identical to `a6eaf0be` (zero code delta).
- `a6eaf0be` is a RECOVERY CANDIDATE only. It is not claimed to be serving. Historical serving-commit alignment is UNAVAILABLE (final).

## Candidate inventory: 59 (primary)
Source: `functions-westayfit/src/index.ts` at `a6eaf0be` (inline `export const … = onCall`), 59 exports, no lowercase collisions.
Live baseline: 59 ACTIVE services (owner read 2026-10-13 01:39Z). Name-set equality live vs `a6eaf0be` is W11-attested (#627 P2); an executed generator comparison is UNRESOLVED.

| Class | Count |
|---|---|
| Retained by name | 59 |
| Added | 0 |
| Removed | 0 — any removal is a hard stop |

All 59 retained names would receive new revisions built from gated source; this is a revision operation on the retained set, not another inventory class. Historical source remains unknown.

`wsfmycontributions`, its index, and `wsfStationGuestContribute` are NOT in the initial 59-service recovery. `wsfmycontributions` is NOT in the primary candidate. Optional variant (#626 head `3e92c938693bba0c71df8a60cdd6a144566e895c`) would make the inventory **60** with `wsfmycontributions` as an explicit proposed addition; it is a separate later step after `wsfContributions (userId ASC, createdAt DESC)` is READY. Index currently ABSENT. Progress history stays off.

### Per-service accounting and source authorization path (SOURCE INSPECTED, runtime UNRESOLVED)
| # | Service | Observed transport | Handler identity gate | Class |
|---|---|---|---|---|
| 1 | `wsfhealth` | Public | none-direct* | retained |
| 2 | `wsfsaveprofile` | Public | requireRealIdentity | retained |
| 3 | `wsfcreatecommunity` | Public | requireRealIdentity | retained |
| 4 | `wsfsendverificationemail` | Public | requireRealIdentity | retained |
| 5 | `wsfpreviewcommunity` | Public | none-direct* | retained |
| 6 | `wsfjoincommunity` | Public | requireRealIdentity | retained |
| 7 | `wsfresolvemarker` | observed defect: platform-auth-required; target public | optionalRealUid | retained |
| 8 | `wsfjoinviamarker` | observed defect: platform-auth-required; target public | requireRealIdentity | retained |
| 9 | `wsfpublicpreviewlabel` | observed defect: platform-auth-required; target public | none-direct* | retained |
| 10 | `wsfresetjoincode` | Public | requireRealIdentity | retained |
| 11 | `wsfremovemember` | Public | requireRealIdentity | retained |
| 12 | `wsfleavecommunity` | Public | requireRealIdentity | retained |
| 13 | `wsfreinstatemember` | Public | requireRealIdentity | retained |
| 14 | `wsfdesignatechampion` | Public | requireRealIdentity | retained |
| 15 | `wsflistchallenge` | Public | requireRealIdentity | retained |
| 16 | `wsfcheckin` | Public | requireRealIdentity | retained |
| 17 | `wsfmycommunities` | Public | requireRealIdentity | retained |
| 18 | `wsfchallengepulse` | Public | requireRealIdentity | retained |
| 19 | `wsfsendpasswordresetemail` | Public | none-direct* | retained |
| 20 | `wsfcreategoal` | Public | requireRealIdentity | retained |
| 21 | `wsfcontribute` | Public | requireRealIdentity | retained |
| 22 | `wsfgoalpulse` | Public | optionalRealUid | retained |
| 23 | `wsfgoalrecentadditions` | Public | optionalRealUid | retained |
| 24 | `wsfmycontribution` | Public | requireRealIdentity | retained |
| 25 | `wsflistgoals` | Public | requireRealIdentity | retained |
| 26 | `wsfsetgoaldisplayauthorization` | Public | requireRealIdentity | retained |
| 27 | `wsfadjustgoal` | Public | requireRealIdentity | retained |
| 28 | `wsfstationrequestpairing` | Public | none-direct* | retained |
| 29 | `wsfstationpairingstatus` | Public | none-direct* | retained |
| 30 | `wsfapprovestation` | Public | requireRealIdentity | retained |
| 31 | `wsfstationclaimpairing` | Public | none-direct* | retained |
| 32 | `wsfstationstate` | Public | none-direct* | retained |
| 33 | `wsfliststations` | Public | requireRealIdentity | retained |
| 34 | `wsfrevokestation` | Public | requireRealIdentity | retained |
| 35 | `wsfcreatecombinedgoal` | Public | requireRealIdentity | retained |
| 36 | `wsfclosecombinedgoal` | Public | requireRealIdentity | retained |
| 37 | `wsfrepaircombinedgoal` | Public | requireRealIdentity | retained |
| 38 | `wsfcombinedgoalpulse` | Public | optionalRealUid | retained |
| 39 | `wsfeventcontext` | Public | requireRealIdentity | retained |
| 40 | `wsfjointurnline` | Public | requireRealIdentity | retained |
| 41 | `wsfmyturn` | Public | requireRealIdentity | retained |
| 42 | `wsfturnready` | Public | requireRealIdentity | retained |
| 43 | `wsfleaveturnline` | Public | requireRealIdentity | retained |
| 44 | `wsfturnstate` | Public | none-direct* | retained |
| 45 | `wsfcallnext` | Public | none-direct* | retained |
| 46 | `wsfstartturn` | Public | none-direct* | retained |
| 47 | `wsfcompleteturn` | Public | none-direct* | retained |
| 48 | `wsfcompletemyturn` | Public | requireRealIdentity | retained |
| 49 | `wsfcancelturn` | Public | none-direct* | retained |
| 50 | `wsfsetcommunityvisibility` | observed defect: platform-auth-required; target public | requireRealIdentity | retained |
| 51 | `wsfcommunitymembers` | observed defect: platform-auth-required; target public | requireRealIdentity | retained |
| 52 | `wsfmyprofilephoto` | observed defect: platform-auth-required; target public | requireRealIdentity | retained |
| 53 | `wsfsetprofilephoto` | observed defect: platform-auth-required; target public | requireRealIdentity | retained |
| 54 | `wsfremoveprofilephoto` | observed defect: platform-auth-required; target public | requireRealIdentity | retained |
| 55 | `wsfsetportraitdecision` | observed defect: platform-auth-required; target public | requireRealIdentity | retained |
| 56 | `wsfsetcommunityphotovisibility` | observed defect: platform-auth-required; target public | requireRealIdentity | retained |
| 57 | `wsfcommunityfaces` | observed defect: platform-auth-required; target public | requireRealIdentity | retained |
| 58 | `wsfcommunityfacephotos` | observed defect: platform-auth-required; target public | requireRealIdentity | retained |
| 59 | `wsfcommunityactivity` | observed defect: platform-auth-required; target public | requireRealIdentity | retained |

*none-direct means no direct `requireRealIdentity` or `optionalRealUid` call, NOT no authorization. W11 independently verified 42 `requireRealIdentity`, 4 `optionalRealUid`, and 13 `none-direct` rows (42 + 4 + 13 = 59), with no unguarded `request.auth` use in the latter. Health checks sign-in and returns only `{ok}`; station/turn paths use station credentials; preview, label and password reset are signed-out by design. Pairing-code credential logic was not re-reviewed in that verdict.

The 13 verified none-direct rows are: `wsfhealth`, `wsfpreviewcommunity`, `wsfpublicpreviewlabel`, `wsfsendpasswordresetemail`, `wsfstationrequestpairing`, `wsfstationpairingstatus`, `wsfstationclaimpairing`, `wsfstationstate`, `wsfturnstate`, `wsfcallnext`, `wsfstartturn`, `wsfcompleteturn`, `wsfcancelturn`.

L0 independently re-derived the same 42 / 4 / 13 classification in #365 comment 6176858858 and withdrew the earlier “15” as a miscount. There are 13 `none-direct`, and 17 without `requireRealIdentity` (13 plus 4 optional helpers); these are source classifications only, not hosted authorization conclusions. W11 confirmed each of the 13 as intended in #629 comment 6176330430; pairing-code credential logic was not re-reviewed. The earlier CLAUDE-NEEDS GATED-RECOVERY-1-IDENTITY-COUNT is RESOLVED by that reconciliation; corrected-head review remains required.

## Protected-workflow results: NO RUN EXISTS (blocked)
- Protected workflow: `main:.github/workflows/wsf-staging-deploy.yml` (read 2026-10-13 21:55Z). Modes: deploy, player-journey, cleanup-recovery, mail-preflight, social-privacy, journey-activation, lovable-kiosk, lovable-device-matrix. **None is a non-deploy validation mode, and none invokes the generator.**
- Repository code search: `pin-candidate.mjs` is referenced only in `.github/wsf-staging/` (CONTROL-PLANE.md, read-inventory.mjs, approved-candidate.json, tests). No workflow calls it.
- At reviewed head `0ac81e798d1159037540e031085acaccad43ebaf`: 0 check runs, 0 workflow runs were recorded. No protected run is performed by this correction.
- Therefore: run link/ID **none**; generator result **NOT RUN**; exact inventory comparator **NOT RUN**; approval-chain verification **NOT RUN**; workflow checksums **NOT RUN**; workflow no-loss check **NOT RUN**. Nothing below is a workflow result.
- Reference only (source-inspected prediction, NOT a result): generator `pin-candidate.mjs` sha256 `136aa124030eb4e88d92156d6b4ff726b6d00cdfda75024f5814522bd9369625` would REFUSE at lines 852-856 (run #61 hosted verification failed) and on prior count (approval `7c02460335a5b96554adf6fc0aa4cc338f32f39ec70cbaaa63345c9a856f1484` expects 49; live 59).
- Required control change: a non-deploy generator/validation mode in the protected workflow. Recorded as a SEPARATE proposal outside this candidate, not built. The approval-baseline change (CP-1) is likewise separate. This candidate stays BLOCKED; no control change is used to make it pass.
- Cloud Shell: not needed. The missing evidence is a GitHub workflow run, not a live Google Cloud fact.

## No-loss validation
- Name-level: 59 live = 59 candidate (W11-attested, source-read; NOT a workflow result). Deletions: 0.
- Target transport contract: **all 59 Firebase callable Cloud Run transports publicly reachable**. Cloud Run IAM is not Firebase-client authentication; handler-level real-identity checks, optional-identity privacy, and intended station/token authorization remain the security boundary.
- The previously observed 13 platform-auth-required transports are a client-blocking staging defect, not a no-loss invariant or configuration to preserve. Repair is a **separate reviewed, owner-authorized IAM step**; this documentation PR does not authorize it or claim a functions update will repair it.
- Preserve all 59 names and zero deletions. No currently public service may become platform-blocked. Stop on any such regression or any IAM change not separately authorized.
- `tests/deploy-config/sprint-w8-social-invoker.test.ts` contains source-only client-blocking false assurance; replacing it and proving client reachability belongs to the separate transport-repair work item.

## P1 closure for existing anonymous sessions
Disabling the Anonymous provider alone is not containment proof. Existing refreshed anonymous tokens retain `firebase.sign_in_provider = anonymous`; the gated handler refuses them independently of provider settings. P1 closure for each applicable service requires BOTH: (1) the emulator anonymous-gate suite at the exact gated source SHA, and (2) run-created provenance tying its serving revision to that source: record each service revision and build created by this exact deploy run, completed revision, SUCCESS Build, matching immutable image digest and exact gated source SHA, then verify the serving revision equals that run-created revision. Archive-only provenance is insufficient; do not infer a Git SHA from an archive or old timestamp. Inventory, traffic, timestamps and Hosting markers do not establish this binding. Intended signed-out/station exceptions require their reviewed boundaries, not a blanket claim that every callable refuses anonymous callers.

Emulator tests are **not run here**. Any hosted anonymous-token probe requires separate owner authorization; the Anonymous provider stays OFF: do not re-enable it, and no provider change is authorized. No session/account/token mutation is part of recovery.

## Existing deploy-mode recovery and action sequence (NOT EXECUTED)
The proposed future path uses option (a), the **existing `mode=deploy`** in `main@be45236ea92771319e45e0f84199cfc849f9b5f5:.github/workflows/wsf-staging-deploy.yml`. This is not a new functions-only workflow. The existing mode writes the functions runtime environment, runs `firebase deploy --only functions:westayfit --non-interactive`, and also redeploys the **staging Hosting channel** with a 7-day expiry through `firebase hosting:channel:deploy`. These are source descriptions, not instructions to deploy manually or authorization to run them.

The channel redeploy uses `a6eaf0be95cb0a81de4f24bc6d7f30ac82ce922f`. L0 independently verified that `git diff ec162d17 a6eaf0be -- apps/westayfit firebase.westayfit.staging.json` is empty: app tree and staging config are byte-identical to `ec162d17a0540e936741027f9b8f90dd372cfaf4`; the marker changes, not app source. This disclosure supersedes the earlier “no Hosting” wording. No rules, indexes, RTDB rules or data migration; **no `--force`**. Membership, privacy settings and contribution rows remain untouched. The Firestore emulator is test-only. Stop if the plan includes anything beyond functions plus this existing staging-channel redeploy. No dispatch or deployment is authorized here.

### Stop and acceptance rule
The functions deploy step has **`continue-on-error: true`**; its exit code alone is neither a success criterion nor the stop signal. Keep that exit code and logs as evidence. Recovery success requires the post-deploy **exact 59-name inventory** (all ACTIVE, no additions/removals) and, for every service, a serving revision bound to the revision/build **this run created** from gated source, with the immutable digest/build binding above. A zero exit is insufficient; any missing, old, unknown, mismatched or unbound serving revision fails acceptance. A nonzero step must not be waved through as success merely because inventory stayed 59. Preserve logs and availability on incomplete/partial deployment; halt follow-on IAM repair and acceptance, never delete or force. The non-interactive deploy without `--force` invokes the existing firebase-tools refusal rather than authorizing deletion.

### Source delta and live-pose hold
The `ec162d17..a6eaf0be` delta is 18 files and includes three packets, not only the anonymous gate: anonymous identity gate; **KIOSK-TURN-LIFECYCLE-1 (#606)**; **KIOSK-LIVE-POSE-2 (#622)**, including `live-pose.ts`, an RTDB writer and `database.westayfit.rules.json`. Packet acceptance references are recorded below; they are historical source acceptance, not approval of this recovery or evidence that these builds serve.

| Packet | Exact accepted subject / record | Source integration (not serving proof) |
|---|---|---|
| ANON-GATE-1 (#601) | `118c2af99ce8bffd62243fe00f64531f620c3afd`; L0 ACCEPT #365 comment `6078861278`, W4 PASS #394 `6078693648` | `e65bfee9eecb2370f602d09880da604709fba58a` |
| KIOSK-TURN-LIFECYCLE-1 (#606) | `17a565dc88c058b136664355dd4fa0634f0a39d5`; L0 ACCEPT #365 `6083346531`, W4 PASS #394 `6083142596` (PR detail `6083145982`) | `8a067b29420563408e16cff5d91cc77b2ad0fbd8` |
| KIOSK-LIVE-POSE-2 (#622) | `87b48fa852174311bef1b8c337e2be0f505ad280`; L0 staging ACCEPT #365 `6109907167`, W3 PASS #622 `6109750791` / #396 `6109752639` | `a6eaf0be95cb0a81de4f24bc6d7f30ac82ce922f` |

The live-pose acceptance included ops #623, but that ops PR remains held and is not silently included here. Historical packet decisions do not authorize this recovery, its environment, IAM or a dispatch.

Full 18-file source delta (GitHub comparison read 2026-10-14):
- `database.westayfit.rules.json`
- `docs/westayfit/ops/security/ANON-GATE-1.md`
- `docs/westayfit/ops/security/KIOSK-TURN-LIFECYCLE-1.md`
- `firebase.westayfit.emulators.json`
- `functions-westayfit/src/anon-gate.ts`
- `functions-westayfit/src/index.ts`
- `functions-westayfit/src/live-pose.ts`
- `functions-westayfit/tests/callable/wsf-anon-gate.test.ts`
- `functions-westayfit/tests/callable/wsf-kiosk-expected-turn.test.ts`
- `functions-westayfit/tests/callable/wsf-station-turn-lifecycle.test.ts`
- `functions-westayfit/tests/callable/wsf-turn.test.ts`
- `functions-westayfit/tests/deploy-config/live-pose-config.test.ts`
- `functions-westayfit/tests/emulator-isolation.setup.ts`
- `functions-westayfit/tests/live-pose/harness.ts`
- `functions-westayfit/tests/live-pose/jest.config.cjs`
- `functions-westayfit/tests/live-pose/live-pose-callables.test.ts`
- `functions-westayfit/tests/live-pose/live-pose-isolation.setup.ts`
- `functions-westayfit/tests/live-pose/live-pose-rules.test.ts`

`WSF_LIVE_POSE` stays **unset**. `live-pose.ts:61` activates only on `'1'`; `write-functions-env.mjs` at the inspected base has no reference to it. **Stop if the generated runtime environment contains `WSF_LIVE_POSE`**, even a value other than `1`. Do not enable live pose, modify the env writer or deploy RTDB rules; the RTDB-rules step #623 remains held.


1. Create separate validation-mode proposal #630 (done).
2. W11 and L0 review the corrected exact documentation heads; old verdicts are not approval.
3. Only after those reviews, a separate owner decision on implementation.
4. Separate implementation PR and tests.
5. W11/L0 review that exact implementation head.
6. Separate owner approval for a protected validation run.
7. Actual protected-run receipts/results added to #629.
8. Completed recovery evidence sent to W11.

CP-1 (failed-run anchor and 49/59 baseline) remains separately identifiable and unimplemented. Validation mode does not grant CP-1 or recovery approval. Deployment additionally requires exact-head W11 PASS, L0 PASS naming SHA/inputs and protected-surface review, P1/rollback decisions, separate owner GO, and designated operator execution. No owner implementation or deployment decision is requested now.

Proposed order after those future approvals: fresh 59-name baseline → protected generator/comparison/no-loss checks → W11/L0 exact-input review → separate owner GO → existing deploy-mode gated recovery with disclosed staging-channel redeploy → post-run exact names and binding of each service to the revision/build this run created → separately reviewed, owner-authorized IAM repair of the 13, service by service only after its binding → transport probes. Stop on count ≠ 59, unknown/missing name, deletion prompt, currently public transport becoming platform-blocked, unauthorized IAM change, scope beyond functions and the disclosed staging-channel redeploy, generated WSF_LIVE_POSE, or inventory/run-created binding/validation/verification failure. Preserve logs on partial failure; halt and obtain a separately reviewed recovery decision, never delete.

### Anonymous-owned residue and fast-path exclusion
Gating does not undo past anonymous-owned writes (for example profiles). Keep **read-only aggregate evidence** of anonymous-owned/anonymous-shaped-uid residue, its coverage and uncertainty, without member identifiers or private row dumps. No cleanup or direct data mutation is authorized; cleanup is a separate owner decision. Missing residue evidence does not block deployment but blocks an unqualified “P1 closed” claim: distinguish per-service gate closure from unresolved historical residue. No collector or aggregate query is run by this PR.

Never make this recovery or `a6eaf0be` a ledger target or fast-path input before owner GO. `fastpath-dispatch.mjs` remains deploy-only; documentation is not a fast path, approval or pin.

## Availability-only emergency traffic rollback map
No proven P1-safe rollback target exists. `ab77fbfc` (49 names, ungated) is not a no-loss rollback; `ec162d17` is ungated and not a safe source rollback either. The following **59 prior revision IDs** are copied from owner evidence #365 comment 6136352451, collection 2026-10-13T01:39:31Z–01:39:43Z, project `westayfit-staging`, region `us-central1`. At collection, created = ready = Functions revision and each received 100% traffic. This is availability evidence only, not current freshness or source/build provenance; no collector was rerun.

An emergency traffic reversion to these pre-recovery revisions **reopens P1 exposure** and requires an explicit owner decision plus a separately reviewed operator procedure. It is not authorized here; it is not a safe gated rollback. A later functions deployment can overwrite such traffic settings. Preserve all services; never delete. Verify revision availability/freshness under a separately authorized preflight before considering use.

| Service | Recorded emergency revision (availability only) |
|---|---|
| `wsfadjustgoal` | `wsfadjustgoal-00042-guv` |
| `wsfapprovestation` | `wsfapprovestation-00029-gav` |
| `wsfcallnext` | `wsfcallnext-00027-kat` |
| `wsfcancelturn` | `wsfcancelturn-00027-qam` |
| `wsfchallengepulse` | `wsfchallengepulse-00042-pex` |
| `wsfcheckin` | `wsfcheckin-00042-wos` |
| `wsfclosecombinedgoal` | `wsfclosecombinedgoal-00027-tax` |
| `wsfcombinedgoalpulse` | `wsfcombinedgoalpulse-00027-nuj` |
| `wsfcommunityactivity` | `wsfcommunityactivity-00010-lal` |
| `wsfcommunityfacephotos` | `wsfcommunityfacephotos-00001-kiv` |
| `wsfcommunityfaces` | `wsfcommunityfaces-00001-xis` |
| `wsfcommunitymembers` | `wsfcommunitymembers-00010-rod` |
| `wsfcompletemyturn` | `wsfcompletemyturn-00027-wuv` |
| `wsfcompleteturn` | `wsfcompleteturn-00027-jej` |
| `wsfcontribute` | `wsfcontribute-00042-hin` |
| `wsfcreatecombinedgoal` | `wsfcreatecombinedgoal-00027-yew` |
| `wsfcreatecommunity` | `wsfcreatecommunity-00042-ras` |
| `wsfcreategoal` | `wsfcreategoal-00042-wiw` |
| `wsfdesignatechampion` | `wsfdesignatechampion-00042-yan` |
| `wsfeventcontext` | `wsfeventcontext-00027-fom` |
| `wsfgoalpulse` | `wsfgoalpulse-00042-bax` |
| `wsfgoalrecentadditions` | `wsfgoalrecentadditions-00034-hel` |
| `wsfhealth` | `wsfhealth-00042-zeg` |
| `wsfjoincommunity` | `wsfjoincommunity-00042-yan` |
| `wsfjointurnline` | `wsfjointurnline-00027-rux` |
| `wsfjoinviamarker` | `wsfjoinviamarker-00001-cez` |
| `wsfleavecommunity` | `wsfleavecommunity-00042-wux` |
| `wsfleaveturnline` | `wsfleaveturnline-00027-qob` |
| `wsflistchallenge` | `wsflistchallenge-00042-jis` |
| `wsflistgoals` | `wsflistgoals-00042-jam` |
| `wsfliststations` | `wsfliststations-00029-bac` |
| `wsfmycommunities` | `wsfmycommunities-00042-qec` |
| `wsfmycontribution` | `wsfmycontribution-00042-kuq` |
| `wsfmyprofilephoto` | `wsfmyprofilephoto-00001-lax` |
| `wsfmyturn` | `wsfmyturn-00027-kiz` |
| `wsfpreviewcommunity` | `wsfpreviewcommunity-00042-quy` |
| `wsfpublicpreviewlabel` | `wsfpublicpreviewlabel-00001-siv` |
| `wsfreinstatemember` | `wsfreinstatemember-00042-wum` |
| `wsfremovemember` | `wsfremovemember-00042-keq` |
| `wsfremoveprofilephoto` | `wsfremoveprofilephoto-00001-wiw` |
| `wsfrepaircombinedgoal` | `wsfrepaircombinedgoal-00027-zey` |
| `wsfresetjoincode` | `wsfresetjoincode-00042-tep` |
| `wsfresolvemarker` | `wsfresolvemarker-00001-rod` |
| `wsfrevokestation` | `wsfrevokestation-00029-pex` |
| `wsfsaveprofile` | `wsfsaveprofile-00042-yud` |
| `wsfsendpasswordresetemail` | `wsfsendpasswordresetemail-00042-vot` |
| `wsfsendverificationemail` | `wsfsendverificationemail-00042-hir` |
| `wsfsetcommunityphotovisibility` | `wsfsetcommunityphotovisibility-00001-nah` |
| `wsfsetcommunityvisibility` | `wsfsetcommunityvisibility-00010-nak` |
| `wsfsetgoaldisplayauthorization` | `wsfsetgoaldisplayauthorization-00041-fah` |
| `wsfsetportraitdecision` | `wsfsetportraitdecision-00001-rub` |
| `wsfsetprofilephoto` | `wsfsetprofilephoto-00001-kog` |
| `wsfstartturn` | `wsfstartturn-00027-zeg` |
| `wsfstationclaimpairing` | `wsfstationclaimpairing-00029-cer` |
| `wsfstationpairingstatus` | `wsfstationpairingstatus-00029-gej` |
| `wsfstationrequestpairing` | `wsfstationrequestpairing-00029-baf` |
| `wsfstationstate` | `wsfstationstate-00029-pag` |
| `wsfturnready` | `wsfturnready-00027-wof` |
| `wsfturnstate` | `wsfturnstate-00027-fos` |

Owner metadata input SHA-256: `998f645f4694a830af4427f8d1ef6f40403e04d44c19f5cb0f11c9660f9d8957` (`wsf-readonly-metadata-20261013T013931Z.txt`, as recorded in that comment). Historical source alignment remains UNAVAILABLE; revision IDs must not be treated as inferred commit identities.

## Post-recovery evidence (not executed)
Require the exact 59 ACTIVE name set, the revisions this run created serving at 100%, and per-service run-created SUCCESS Build/image-digest/exact-gated-SHA binding plus exact-SHA emulator anonymous-gate evidence. No step exit code or archive-only provenance substitutes for this. Any hosted anonymous probe requires separate owner authorization. Under separately authorized transport verification, unauthenticated requests must reach the handler (no platform 401/403); real identities reach gated handlers. The 13 remain a known client-blocking defect until separate IAM repair and reachability proof, never counted as a transport pass. Intended public/station exceptions retain their handler boundary. Contribution history stays off; no data, rules, indexes or RTDB-rules change; only the disclosed staging Hosting-channel redeploy of the unchanged app tree.

## Checksums
- `functions-westayfit/src/index.ts` @ a6eaf0be, raw API fetch, sha256 (reviewer to re-derive): `290e1fee43f1371a276f2e8d185d3947da6f31e9c48d77243f635a6fde51b16c`

## W11 / L0 readiness
- W11: reviewable for source/inventory/authorization paths; NOT ready for an evidence PASS (no workflow results).
- L0: NOT ready (no workflow results; audits paused).

## Remaining blockers
1. No protected-workflow mode runs the generator/validation (control change, separate proposal).
2. Approval baseline expects 49 and anchors on failed run #61 (CP-1, separate proposal).
3. P1 closure evidence (exact serving provenance + exact-SHA emulator suite) missing; hosted anonymous probes require separate authorization.
4. No proven P1-safe rollback; availability-only 59-revision map requires owner risk decision before any use.
5. Separate 13-service transport repair remains unapproved; identity-count reconciliation is resolved (42 / 4 / 13).
6. Run-created serving bindings and anonymous-owned residue aggregate remain unavailable; no unqualified P1 closure claim.

## Next review, not owner decision
Route the corrected exact heads of #629 and #630 to W11 and L0/Fable for the bounded reviews. #629 remains draft and blocked. CLAUDE-NEEDS GATED-RECOVERY-1-IDENTITY-COUNT is resolved; request fresh review of the corrected table and all 13 intended boundaries, not repetition of the withdrawn count. No implementation/deployment decision is sought before those verdicts; recurring audits stay paused.
