# Operator handoff — the two staging operations outside the deploy workflow

**Operational copy.** First prepared by L0 on `claude/wsf-north-star-canonical`
(`882179a`, blob `4d3aedb0`) at ~15:40Z on 2026-09-23; carried into the release
lane on this branch, consolidated with W3's reviewed
`social-inventory/SINGLE-INDEX-OPERATOR-PROCEDURE.md` (the index command lives
there and is not repeated here), and re-sequenced to the Director's ordering
(#365 `5798443901`); corrected per the Director's documentation review
against the official Google references (#365 `5798910690`). Authority: the owner's incremental staging authorization
relayed at #365 `5797657663` and the Director's handoff instruction `5797754279`.
That scope is **not** being requested again.

**Reconciled on 2026-09-24 with what has actually run** (packet OPS-DOC-1:
Director #365 `5819944052` §4, routed by L0 #396 `5819975382`). The sources are
the owner's deploy instruction (#365 `5805097411`), run 47 (`35937603929`), W3's
run-47 transport receipt (#396 `5805440687`) and the current
`skills/wsf-staging-deploy/SKILL.md`. Statements that were true before run 47
are kept below and labelled **historical**; they are not erased.

**Refreshed on 2026-09-25 for run 48** (Director #365 `5834612359`, routed by
L0 #396 `5834633436`). Run 48 is the current observed state. The run-47 section
that follows it is historical.

**Authority for deploying and receipts:** `skills/wsf-staging-deploy/SKILL.md`
on operational `main`, and the owner's cadence of deploying to staging after
every stable accepted milestone (#365 `5832907406`). This document does not
restate that procedure. It covers only the two operations outside the workflow.

## Current state (2026-09-25, run 48)

- **Served:** run 48 (`36133376723`) was dispatched from operational `main`
  `0359f8d1` with the pin `502b1e8d`. Its deploy job printed `INVENTORY_BEFORE=49`,
  `INVENTORY_AFTER=49`, `CREATED_THIS_DEPLOY=none`, `HOSTED_MARKER_MATCHES=true`
  and `VERIFY=pass` (#365 `5832332554`). Staging serves `502b1e8` (#365 `5832333596`).
- **Hosted verification:** `RESULTS=24`, `FAILURES=0` (#365 `5832335211`). That
  suite **does not cover social**. The Package E row that failed on run 47 is
  measured green: it now opens Manage from the member menu (#466).
- **Cleanup:** `CLEANUP_STATUS=COMPLETE` (#365 `5832336026`).
- **Capability, unchanged:** the three social services still read
  `invoker_iam_check_enabled` (SHUT) on run 48. The `wsfContributions` index
  still has no READY receipt.
- **Operation 2, the invoker change on the three services, is known-denied for
  the deploy identity.** Run 47 measured it: the deploy step logged
  `Failed to set the IAM Policy` for each service.
- **Operation 1, the index, is unmeasured for the deploy identity.** No run
  has attempted an index operation, because this workflow never deploys an
  index. Whether that identity holds `datastore.indexes.create` / `list` is
  unknown. It is not excluded.
- **Feature readiness: not met.** The member, non-member, name-off and
  activity-off smokes, the members deep link and the `/move/<goalId>` direct
  load have not run. The email and shared / unattended kiosk holds are carried.

## Run 47 state (2026-09-24) — historical

These are three different things and are reported separately.

These are three different things and are reported separately.

- **Authorized deployment: done.** The owner explicitly asked for the staging
  deploy (#365 `5805097411`), and that instruction was the dispatch decision.
  Run 47 (`35937603929`) was dispatched from operational `main` `cc30f1d3` at
  ~00:15Z on 2026-09-24 in mode `deploy` with candidate `7ee70e4`. The
  functions and the Hosting release deployed. The run's later hosted read
  observed marker `7ee70e4` (Director #365 `5805596087`). Staging serves
  `7ee70e4`. The pin's `approvedAppSha` is unchanged. This document neither
  claims nor requests a redispatch.
- **Capability: partial.** Inventory went from 46 to 49 functions. The three
  social services now **exist** and were measured **transport-SHUT** on run 47
  (`invoker_iam_check_enabled`). The deploy step's own log shows `Failed to set
  the IAM Policy` for each of them, and its hint names `roles/functions.admin`.
  That the deploy identity lacks `run.services.setIamPolicy` is the
  repository's standing, source-backed diagnosis; the log does not print that
  permission name. The single `wsfContributions` composite index
  has **no READY receipt, so its state is unverified**. `wsfCommunityActivity`
  fails `FAILED_PRECONDITION` until that index is READY.
- **Post-deploy feature readiness: not met.** The social features are **not**
  usable and are not claimed usable.
  - Run 47 concluded FAILURE. Two separate facts in the `deploy` job:
    - "Verify the deployed state" failed with `VERIFY=failed (1)`. The
      verifier's one count was the early hosted-marker mismatch, read within
      two seconds after the Hosting release. The three SHUT transport rows
      were reported notes and added **no** verifier failure.
    - **Separately**, the workflow later marked the release failed because the
      functions deploy step's captured outcome was failure: that step exited 2
      on the three invoker-policy updates. The failed-release marking did not
      come from the verifier's count of the marker mismatch.
  - In the `hosted-verify` job, the Package E hosted authorization checks
    were 5 PASS / 1 FAIL, and the fixtures were removed. The root cause of
    the FAIL was that the smoke waited for `wsf-community-manage`, which
    `7ee70e4` no longer draws. That is corrected on `main` `cd881775` (#466)
    and stays **unmeasured on staging until the next run**.
  - Not yet run: the member, non-member, name-off and activity-off smokes; the
    members deep link; the `/move/<goalId>` direct load.
  - The owner's served-claim conditions below are not met. The email-delivery
    hold and the shared / unattended kiosk hold are carried.

**Still needed, by a named legitimate operator** (never L0; no credential is
named or sought here). For Operation 2 the deploy identity is known-denied. For
Operation 1 it is unmeasured:
1. **Operation 1:** create the one `wsfContributions` COLLECTION index
   (`communityGroupId ASC`, `createdAt DESC`) on `westayfit-staging` only.
   Then post the READY read-back receipt with the recorded fields.
2. **Operation 2:** for each of `wsfsetcommunityvisibility`,
   `wsfcommunitymembers` and `wsfcommunityactivity`, run
   `gcloud run services update <service> --project=westayfit-staging --region=us-central1 --no-invoker-iam-check`.
   Then post the schema-matched, metadata-only read-back for each service.
   Empty output proves nothing.

The operator needs `datastore.indexes.create` / `list` for Operation 1 and
`run.services.setIamPolicy` + `get` / `update` for Operation 2. After both
receipts, the three transports are measured by the next staging run under the
owner's cadence (`skills/wsf-staging-deploy/SKILL.md`). This document does not
dispatch one.

**Historical (true until run 47):** "Nothing here has been run." L0 holds no
cloud credential and seeks none; the
deploy workflow's identity (`wsf-staging-deployer@westayfit-staging.iam.gserviceaccount.com`,
reachable only inside `wsf-staging-deploy.yml` on `main` through WIF) cannot
perform either operation. Never invent access; never retry a denied identity.
*Current:* runs 47 and 48 have deployed (above). Neither operation has a
receipt. The no-credential and no-retry rules still hold. The deploy identity
is measured unable to do Operation 2 (run 47). For Operation 1 it is
unmeasured.

| | |
| --- | --- |
| project | `westayfit-staging` (only) |
| region | `us-central1` |
| single index | `wsfContributions`, query scope **COLLECTION**, fields `communityGroupId ASC`, `createdAt DESC` — the candidate's `firestore.indexes.json` entry at `37367fd` |
| three services | `wsfsetcommunityvisibility`, `wsfcommunitymembers`, `wsfcommunityactivity` (Cloud Run service names of the callables `wsfSetCommunityVisibility`, `wsfCommunityMembers`, `wsfCommunityActivity`) — **created by run 47, measured SHUT** |
| **operator** | **UNASSIGNED** until an actual identity accepts on #365 **and its own preflight succeeds**, recorded: (a) the real operator identity named; (b) project / index access shown by a successful read of the project's composite-index list with that identity; (c) the applicable existing authority for the service operation shown by a metadata-only check of that identity's own role bindings / permissions on `westayfit-staging` for `run.services.setIamPolicy` + `get` / `update` (a read alone is not proof of update / setIamPolicy permission). *Historical (before run 47):* "The three services do not exist before the deploy, so their absence is **not** a failed check and no pre-deploy read of their metadata or transport is required; the exact three-service metadata / transport read-back belongs AFTER creation (Operation 2)." *Current:* the three services exist, so the preflight is no longer pre-deploy. Their transport is already measured SHUT, and the read-back after Operation 2 is the receipt that is owed. **Historical receipt, dated 2026-09-23 16:57Z (#365 `5799068153`), not re-checked here:** the Director holds no Google Cloud operator identity; Maia's last completed access check reported her available identities could not read the `westayfit-staging` project / IAM state, with no newer successful-access receipt; Manus previously completed staging-project operations but is currently unavailable (credits exhausted) — prior capability is not a current operator; whether the owner's own Google identity already holds the permissions named here is **UNKNOWN**, and the owner is not described as the operator merely by being the owner. The deploy SA is not widened. |

## Sequence

### Historical plan (Director #365 `5798443901`), superseded as a dispatch rule

This was the authorized sequence before run 47. It is kept as written:

> 1. **BEFORE dispatch** — all three on #365:
>    - the single index created and read **READY** (Operation 1), receipt posted;
>    - the reviewed, merged operational branches and the pinned candidate
>      (`approved-candidate.json` naming the candidate SHA and exactly the three
>      `candidateAddedFunctions`; `expectedPriorFunctions` = the measured BEFORE);
>    - a **named** legitimate existing operator with the applicable access and an
>      agreed post-deploy handoff for Operation 2.
> 2. **Dispatch** `wsf-staging-deploy.yml` (mode `deploy`, `app_sha` = candidate) — L0.
> 3. **AFTER deploy** — read the run's per-service transport line for the three
>    services. Newly created services cannot be measured before they exist, so
>    this is never a pre-dispatch requirement.
> 4. **Only if measured SHUT** — Operation 2 through the named operator, then
>    read-back.
> 5. Authenticated member / non-member / name-off / activity-off smokes and the
>    members deep link; narrow smoke + cleanup; the served-marker read.
> 6. No feature-ready claim until 5 passes. Email and shared / unattended kiosk
>    holds are carried explicitly.

What actually happened: the owner's explicit deploy instruction
(#365 `5805097411`) came first, and run 47 was dispatched **before** any index
READY receipt and **before** any named operator. The current
`skills/wsf-staging-deploy/SKILL.md` states the rule. When the owner explicitly
asks for the deploy, it is dispatched. A separate feature-readiness item, such
as an index still building, "may limit whether a feature is fully usable, but
it is not a reason to forget how to dispatch".

### Current order

The index READY receipt, the named operator and the post-deploy handoff are
**feature-readiness preconditions** for the served claim of the social
features. They are **not** dispatch holds.

1. **Deploy** — done. Run 47 created the three services, and run 48 serves
   `502b1e8`.
2. **Measure transport after the deploy** — done. All three are SHUT on run 47
   (#396 `5805440687`) and on run 48 (#365 `5832332554`).
3. **Operation 1** by the named operator, then the READY receipt.
4. **Operation 2** by the named operator, one service at a time, then the
   read-back for each. The measurement in step 2 already requires it.
5. **The next staging run** under the owner's cadence re-measures the three
   transports. The hosted Package E row is already green on run 48.
6. The authenticated member / non-member / name-off / activity-off smokes and
   the members deep link; the `/move/<goalId>` direct load; a narrow smoke and
   cleanup; the served-marker read.
7. No feature-ready claim until step 6 passes. The email and shared /
   unattended kiosk holds are carried explicitly.

## Operation 1 — the single composite index, then READY

Procedure, command, console equivalent, permission and state semantics:
**`social-inventory/SINGLE-INDEX-OPERATOR-PROCEDURE.md`** (W3, reviewed by W5).
Summary of what the operator needs and what is recorded:

| | |
| --- | --- |
| permission | `datastore.indexes.create` + `datastore.indexes.list` on `westayfit-staging` (carried by `roles/datastore.indexAdmin`); the operator's actual permissions are checked, not inferred from a broad role |
| CLI spelling | `--query-scope=collection` (lower-case CLI choice per the `gcloud firestore indexes composite create` reference); the resulting API / receipt value is `queryScope=COLLECTION` |
| never | `firebase deploy --only firestore:indexes` (shared 49 / 48-index catalog; a catalog deploy prunes), the default project, a delete |
| READY read | the composite `list` for the project; `CREATING` is not READY |
| **receipt fields** | index resource name · `queryScope=COLLECTION` · fields in order · `state=READY` · identity used · timestamp · the exact command or console action |
| rollback | leave the index (deleting it while a callable queries that shape causes the outage a rollback exists to undo) |
| order | *Historical:* "may precede the deploy". *Current:* the deploy has run, and no READY receipt exists. The index must be READY before `wsfCommunityActivity` can answer; the callable fails `FAILED_PRECONDITION` until then. |

## Operation 2 — transport of the three new services (measured SHUT)

| | |
| --- | --- |
| the setting | the verifier reads Cloud Run v2 `invokerIamDisabled`; the existing member callables run with the invoker IAM check disabled, which is what makes an authenticated-member callable reachable from the browser; authorization stays inside the function (`request.auth`, active-member and privacy checks), unchanged |
| why not the workflow | the deploy SA cannot set invoker policy on newly created services (`wsf-staging-deploy.yml` comment near the deploy step; `verify-deployment.mjs` transport section); the fifteen turn services arrived SHUT for this reason, and run 47's deploy step logged `Failed to set the IAM Policy` for each of these three |
| measured | run 47's per-service transport line (the verifier's v2 `invokerIamDisabled` read) shows all three `invoker_iam_check_enabled`, which is SHUT (#396 `5805440687`). The deploy step's IAM failure corroborates it. A later run measures again; nothing is declared open from history |
| permission | changing a service's invoker authentication requires **`run.services.setIamPolicy`** together with `run.services.get` / `run.services.update` on each of the three services (Google's "Required roles" for public access names these and identifies **Cloud Run Admin**, `roles/run.admin`). The operator's actual permissions are checked, not inferred from a broad role; no role is granted here, no identity retried. |
| action, one per service (required: all three measured SHUT) | `gcloud run services update <service> --project=westayfit-staging --region=us-central1 --no-invoker-iam-check` for `wsfsetcommunityvisibility`, `wsfcommunitymembers`, `wsfcommunityactivity` — matches the existing services' setting; not a project-wide grant, not a new role, not `allUsers` on anything else |
| **receipt fields** | per service, a **schema-matched, metadata-only** read-back after the change: the existing verifier's Cloud Run **v2** receipt (`invokerIamDisabled` is the v2 API field, read by `verify-deployment.mjs`), **or** the Knative **v1** form `gcloud run services describe <service> --project=westayfit-staging --region=us-central1 --format=export` showing `metadata.annotations['run.googleapis.com/invoker-iam-disabled']`, **or** the console's authentication setting. `--format='value(invokerIamDisabled)'` is not a valid projection of the v1 export and is not used. **Empty output proves neither OPEN nor SHUT.** Record per service: identity · timestamp · the explicit observed setting; then the verifier / hosted smoke line proving reachability and the authenticated member / non-member / name-off / activity-off results. No environment variables or credentials are published. |
| not authorized | any broader IAM / WIF grant, impersonation, credential hunting, a repeat of a denied probe, email-trial scope, or a change to the application-level member checks |

## Served-claim conditions (owner, unchanged)

Index READY · callable reachability + member / non-member / name-off /
activity-off checks · the members deep link (`/community/<id>/members`) and a
direct load / refresh of a real synthetic `/move/<goalId>` each render the right
UI, not merely HTTP 200 (packet 3's hosted verification) · exact
hosting marker · narrow smoke + cleanup · a tested rollback that retains the
`candidateAddedFunctions` list while the services remain (§6a of
`SOCIAL-ROLLOUT-SEQUENCE.md`) · the email and shared / unattended kiosk holds
carried explicitly.

**Status on 2026-09-25 (run 48):** not met. The marker `502b1e8` matched. The
hosted 24 / 0 excludes social. The index is unverified, the three callables are
SHUT, and the smokes, the deep link and the direct load have not run.

**Historical, status on 2026-09-24 (run 47):** not met. The hosted marker `7ee70e4` was observed on
the run's later read, but the deploy job's own read was a mismatch. The index
is unverified, the three callables are SHUT, and the Package E row failed on
run 47 (its cause is fixed on `main` and not yet measured). The smokes, the deep
link and the direct load have not run.
