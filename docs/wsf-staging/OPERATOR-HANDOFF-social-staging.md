# Operator handoff — the two staging operations L0 and the deploy workflow cannot perform

Prepared 2026-09-23 ~15:40Z under the owner's incremental staging authorization
(#365 `5797657663`) and the Director's instruction to assemble one concrete
handoff (#365 `5797754279`). **Nothing here has been run.** Both operations
need an identity with real access on `westayfit-staging`; the current operator
thread records a denied policy read and a stand-down pending legitimate access,
so this is an access dependency to resolve through the existing operator
path, not a request to repeat the staging approval.

Project `westayfit-staging` · region `us-central1` · the deploy workflow's
identity is `wsf-staging-deployer@westayfit-staging.iam.gserviceaccount.com`,
reachable only inside `wsf-staging-deploy.yml` (WIF pinned to that workflow on
`main`). L0 holds no cloud credential in its session and does not seek one.

## Operation 1 — create the single composite index, then read READY

| | |
| --- | --- |
| what | one Firestore composite index, **COLLECTION** scope, collection group `wsfContributions`, fields `communityGroupId ASC`, `createdAt DESC` (exactly the candidate's `firestore.indexes.json` entry at `37367fd`) |
| why it is not the workflow's | `firebase.westayfit.staging.json` deliberately omits `firestore`; the staging workflow never deploys rules or indexes. Deploying the shared index catalog is out of scope and could touch other indexes. |
| executing identity | an operator on `westayfit-staging` holding `datastore.indexes.create` and `datastore.indexes.list` (roles such as Cloud Datastore Index Admin, Firebase Admin, or project Editor / Owner carry them). The owner's console identity qualifies. |
| create (CLI form) | `gcloud firestore indexes composite create --project=westayfit-staging --collection-group=wsfContributions --query-scope=COLLECTION --field-config=field-path=communityGroupId,order=ascending --field-config=field-path=createdAt,order=descending` — or the Firestore console, Indexes → Composite → Add, with the same four values. Never `firebase deploy --only firestore:indexes`, never the default project, never a delete. |
| READY read | `gcloud firestore indexes composite list --project=westayfit-staging` and record the index name with `state: READY` (CREATING is not READY). |
| receipt to retain | the exact command or console action, the identity used, the timestamp, and the `list` output line showing READY — posted on #365 before any member / activity query is exercised on staging. |
| rollback | leave the index in place (harmless); state that in the record. |
| order | may be created before the deploy; must be READY before the first `wsfCommunityMembers` / `wsfCommunityActivity` query that needs it. |

W3's packet `5797676140` refines this procedure from source; where they differ,
W3's reviewed document wins.

## Operation 2 — open the transport of the three new callables (measure first, then act)

| | |
| --- | --- |
| what | the three Cloud Run services the candidate's deploy creates: `wsfsetcommunityvisibility`, `wsfcommunitymembers`, `wsfcommunityactivity` (lower-case service names of the callables `wsfSetCommunityVisibility`, `wsfCommunityMembers`, `wsfCommunityActivity`). |
| the setting | the verifier reads Cloud Run v2 `services.invokerIamDisabled`; the pre-existing member callables carry `invokerIamDisabled: true` ("invoker IAM check disabled"), which is what makes an authenticated-member callable reachable from the browser at all — authorization is then enforced inside the function (`context.auth`, active-member and privacy checks), unchanged by this step. |
| why it is not the workflow's | the deploy SA cannot set invoker policy on newly created services (workflow comment ~L495; verifier L61–86); the fifteen turn services arrived SHUT for exactly this reason. |
| measure before declaring | after the deploy, read the verifier's per-service transport line for the three (`invoker_iam_check_disabled` vs enabled). Do **not** declare them shut or open from history; the run's own receipt decides. |
| executing identity | an operator on `westayfit-staging` holding `run.services.update` (and `run.services.get`) — e.g. Cloud Run Admin on those services or project Editor / Owner. |
| action (CLI form), one per service, only if measured SHUT | `gcloud run services update wsfcommunitymembers --project=westayfit-staging --region=us-central1 --no-invoker-iam-check` (and the same for the other two). This matches the existing services' setting; it is not a project-wide grant, not a new role, not `allUsers` on anything else. |
| receipt to retain | the three `gcloud run services describe … --format='value(invokerIamDisabled)'` reads (or the console setting) after the change, the identity, the timestamp — and then the verifier / hosted smoke line proving reachability plus the member / non-member / name-off / activity-off checks. |
| not authorized here | any broader IAM / WIF role grant, impersonation, credential hunting, email-trial scope, or changes to the application-level member checks. |

## Served-claim conditions (unchanged)

Index READY · callable reachability + member / non-member / name-off /
activity-off checks · the members deep link renders the members page · exact
hosting marker · narrow smoke + cleanup · a tested rollback accounting for
retained services and the verifier's EXPECTED set · the email and shared /
unattended kiosk holds carried explicitly.
