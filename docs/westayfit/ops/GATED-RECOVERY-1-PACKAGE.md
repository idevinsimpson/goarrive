# GATED-RECOVERY-1 — consolidated staging recovery package

Status: PREPARED FOR REVIEW. Not passed. Nothing executed against staging.
Prepared by Lovable (sole implementation owner), 2026-10-13. Draft review only; all holds remain.

## Scope and holds
No deployment, dispatch, merge, release, publication, Auth/IAM/account/index/session change or protected-control change is requested by this PR. PRs #623–#626 stay held. Progress history stays off. Recurring audits stay paused. P1 (already-issued anonymous tokens) remains CONDITIONAL.

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
| Retained | 59 |
| Changed (new revision built from gated source; historical source unknown) | 59 |
| Added | 0 |
| Removed | 0 — any removal is a hard stop |

`wsfmycontributions` is NOT in the primary candidate. Optional variant (#626 head `3e92c938693bba0c71df8a60cdd6a144566e895c`) would make the inventory **60** with `wsfmycontributions` as an explicit proposed addition; it is a separate later step after `wsfContributions (userId ASC, createdAt DESC)` is READY. Index currently ABSENT. Progress history stays off.

### Per-service accounting and source authorization path (SOURCE INSPECTED, runtime UNRESOLVED)
| # | Service | Invoker (unchanged) | Handler identity gate | Class |
|---|---|---|---|---|
| 1 | `wsfhealth` | Public | none-direct* | retained |
| 2 | `wsfsaveprofile` | Public | requireRealIdentity | retained |
| 3 | `wsfcreatecommunity` | Public | requireRealIdentity | retained |
| 4 | `wsfsendverificationemail` | Public | requireRealIdentity | retained |
| 5 | `wsfpreviewcommunity` | Public | none-direct* | retained |
| 6 | `wsfjoincommunity` | Public | requireRealIdentity | retained |
| 7 | `wsfresolvemarker` | Require auth | optionalRealUid | retained |
| 8 | `wsfjoinviamarker` | Require auth | requireRealIdentity | retained |
| 9 | `wsfpublicpreviewlabel` | Require auth | none-direct* | retained |
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
| 50 | `wsfsetcommunityvisibility` | Require auth | requireRealIdentity | retained |
| 51 | `wsfcommunitymembers` | Require auth | requireRealIdentity | retained |
| 52 | `wsfmyprofilephoto` | Require auth | requireRealIdentity | retained |
| 53 | `wsfsetprofilephoto` | Require auth | requireRealIdentity | retained |
| 54 | `wsfremoveprofilephoto` | Require auth | requireRealIdentity | retained |
| 55 | `wsfsetportraitdecision` | Require auth | requireRealIdentity | retained |
| 56 | `wsfsetcommunityphotovisibility` | Require auth | requireRealIdentity | retained |
| 57 | `wsfcommunityfaces` | Require auth | requireRealIdentity | retained |
| 58 | `wsfcommunityfacephotos` | Require auth | requireRealIdentity | retained |
| 59 | `wsfcommunityactivity` | Require auth | requireRealIdentity | retained |

*none-direct: no direct requireRealIdentity/optionalRealUid call; these use station credentials, public preview/health or token flows; W11 must confirm each is intended.

## Generator / approval chain (NON-EXECUTED)
- Generator `main:.github/wsf-staging/pin-candidate.mjs` sha256 `136aa124030eb4e88d92156d6b4ff726b6d00cdfda75024f5814522bd9369625`. Not executed here (no full history/credentials in sandbox). Exact command for the authorized runner: as defined in `wsf-staging-deploy.yml` with `mode=dry-run`/`target_source=pin`, `app_sha=a6eaf0be…`. Exit code: NOT RUN.
- Approval `approved-candidate.json` sha256 `7c02460335a5b96554adf6fc0aa4cc338f32f39ec70cbaaa63345c9a856f1484`: approvedAppSha `ec162d17`, expectedPriorFunctions 49.
- Predicted (source-inspected) result: REFUSE at lines 852–856 (run #61 hosted verification failed) and prior-count MISMATCH (49 vs live 59). Ancestry, exact-set/no-delete, RTDB, MAX_NEVER_SERVED: UNRESOLVED (unreached).
- Existing controls cannot represent this candidate. Control-change proposal CP-1 (non-anchoring failed-run record naming #61, fresh 59-name baseline, new approval for `a6eaf0be` with expectedPriorFunctions 59, all other checks unchanged) needs a separate owner decision and review. Not implemented here.

## No-loss validation
- Name-level: 59 live = 59 candidate (attested, not generator-executed). Deletions: 0.
- Invokers: 46 Public / 13 Require auth must be identical after any deploy.

## Deployment proposal (NOT EXECUTED)
Prerequisites: CP-1 approved and merged via its own PR; W11 PASS; owner P1 decision; L0 PASS naming SHA + inputs with `protected surface reviewed`; owner GO; operator dispatch.
Order: preflight 59-name read → generator dry-run → functions-only staging deploy → post-deploy names/revisions → hosted verify.
Stop on: count ≠ 59, unknown/missing name, deletion prompt, invoker/IAM change, dry-run or hosted-verify failure.

## Rollback
No proven-safe rollback target. `ab77fbfc` (49, ungated) and `ec162d17` (ungated) are excluded. Partial deploy: halt, preserve logs, never delete. Rollback readiness UNRESOLVED; GO requires explicit owner risk acceptance.

## Post-deploy verification
59 ACTIVE, new revisions at 100%; build provenance binds each to the deployed SHA; anonymous token refused (`failed-precondition`), real identity accepted; invokers unchanged; Progress history still off.

## Checksums
- `functions-westayfit/src/index.ts` @ a6eaf0be, raw API fetch, sha256 (reviewer to re-derive): `290e1fee43f1371a276f2e8d185d3947da6f31e9c48d77243f635a6fde51b16c`
