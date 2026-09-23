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

**Nothing here has been run.** L0 holds no cloud credential and seeks none; the
deploy workflow's identity (`wsf-staging-deployer@westayfit-staging.iam.gserviceaccount.com`,
reachable only inside `wsf-staging-deploy.yml` on `main` through WIF) cannot
perform either operation. Never invent access; never retry a denied identity.

| | |
| --- | --- |
| project | `westayfit-staging` (only) |
| region | `us-central1` |
| single index | `wsfContributions`, query scope **COLLECTION**, fields `communityGroupId ASC`, `createdAt DESC` — the candidate's `firestore.indexes.json` entry at `37367fd` |
| three services | `wsfsetcommunityvisibility`, `wsfcommunitymembers`, `wsfcommunityactivity` (Cloud Run service names of the callables `wsfSetCommunityVisibility`, `wsfCommunityMembers`, `wsfCommunityActivity`) |
| **operator** | **UNASSIGNED** until an actual identity with the permissions below accepts on #365. The candidate identities are the owner's console identity or a person the owner designates. The deploy SA is not widened. |

## Authorized sequence

1. **BEFORE dispatch** — all three on #365:
   - the single index created and read **READY** (Operation 1), receipt posted;
   - the reviewed, merged operational branches and the pinned candidate
     (`approved-candidate.json` naming the candidate SHA and exactly the three
     `candidateAddedFunctions`; `expectedPriorFunctions` = the measured BEFORE);
   - a **named** legitimate existing operator with the applicable access and an
     agreed post-deploy handoff for Operation 2.
2. **Dispatch** `wsf-staging-deploy.yml` (mode `deploy`, `app_sha` = candidate) — L0.
3. **AFTER deploy** — read the run's per-service transport line for the three
   services. Newly created services cannot be measured before they exist, so
   this is never a pre-dispatch requirement.
4. **Only if measured SHUT** — Operation 2 through the named operator, then
   read-back.
5. Authenticated member / non-member / name-off / activity-off smokes and the
   members deep link; narrow smoke + cleanup; the served-marker read.
6. No feature-ready claim until 5 passes. Email and shared / unattended kiosk
   holds are carried explicitly.

## Operation 1 — the single composite index, then READY

Procedure, command, console equivalent, permission and state semantics:
**`social-inventory/SINGLE-INDEX-OPERATOR-PROCEDURE.md`** (W3, reviewed by W5).
Summary of what the operator needs and what is recorded:

| | |
| --- | --- |
| permission | `datastore.indexes.create` + `datastore.indexes.list` on `westayfit-staging` (`roles/datastore.indexAdmin`, or owner / editor) |
| CLI spelling | `--query-scope=collection` (lower-case CLI choice per the `gcloud firestore indexes composite create` reference); the resulting API / receipt value is `queryScope=COLLECTION` |
| never | `firebase deploy --only firestore:indexes` (shared 49 / 48-index catalog; a catalog deploy prunes), the default project, a delete |
| READY read | the composite `list` for the project; `CREATING` is not READY |
| **receipt fields** | index resource name · `queryScope=COLLECTION` · fields in order · `state=READY` · identity used · timestamp · the exact command or console action |
| rollback | leave the index (deleting it while a callable queries that shape causes the outage a rollback exists to undo) |
| order | may precede the deploy; must be READY before the first `wsfCommunityActivity` query (the callable fails `FAILED_PRECONDITION` before READY) |

## Operation 2 — transport of the three new services (measure first)

| | |
| --- | --- |
| the setting | the verifier reads Cloud Run v2 `invokerIamDisabled`; the existing member callables run with the invoker IAM check disabled, which is what makes an authenticated-member callable reachable from the browser; authorization stays inside the function (`request.auth`, active-member and privacy checks), unchanged |
| why not the workflow | the deploy SA cannot set invoker policy on newly created services (`wsf-staging-deploy.yml` comment near the deploy step; `verify-deployment.mjs` transport section); the fifteen turn services arrived SHUT for this reason |
| measure first | the run's own per-service transport line (the verifier's v2 `invokerIamDisabled` read) decides; nothing is declared shut or open from history |
| permission | changing a service's invoker authentication requires **`run.services.setIamPolicy`** together with `run.services.get` / `run.services.update` on each of the three services (Google's "Required roles" for public access names these and identifies **Cloud Run Admin**, `roles/run.admin`). The operator's actual permissions are checked, not inferred from a broad role; no role is granted here, no identity retried. |
| action, one per service, only if measured SHUT | `gcloud run services update <service> --project=westayfit-staging --region=us-central1 --no-invoker-iam-check` for `wsfsetcommunityvisibility`, `wsfcommunitymembers`, `wsfcommunityactivity` — matches the existing services' setting; not a project-wide grant, not a new role, not `allUsers` on anything else |
| **receipt fields** | per service, a **schema-matched, metadata-only** read-back after the change: the existing verifier's Cloud Run **v2** receipt (`invokerIamDisabled` is the v2 API field, read by `verify-deployment.mjs`), **or** the Knative **v1** form `gcloud run services describe <service> --project=westayfit-staging --region=us-central1 --format=export` showing `metadata.annotations['run.googleapis.com/invoker-iam-disabled']`, **or** the console's authentication setting. `--format='value(invokerIamDisabled)'` is not a valid projection of the v1 export and is not used. **Empty output proves neither OPEN nor SHUT.** Record per service: identity · timestamp · the explicit observed setting; then the verifier / hosted smoke line proving reachability and the authenticated member / non-member / name-off / activity-off results. No environment variables or credentials are published. |
| not authorized | any broader IAM / WIF grant, impersonation, credential hunting, email-trial scope, or a change to the application-level member checks |

## Served-claim conditions (owner, unchanged)

Index READY · callable reachability + member / non-member / name-off /
activity-off checks · the members deep link (`/community/<id>/members`) and a
direct load / refresh of a real synthetic `/move/<goalId>` each render the right
UI, not merely HTTP 200 (packet 3's hosted verification) · exact
hosting marker · narrow smoke + cleanup · a tested rollback that retains the
`candidateAddedFunctions` list while the services remain (§6a of
`SOCIAL-ROLLOUT-SEQUENCE.md`) · the email and shared / unattended kiosk holds
carried explicitly.
