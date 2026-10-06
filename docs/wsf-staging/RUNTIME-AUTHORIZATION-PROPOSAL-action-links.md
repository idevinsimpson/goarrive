# WSF staging — runtime authorization for Firebase Auth action links (proposal)

**Status: APPROVED, NARROWLY AND CONDITIONALLY, by the owner at 2026-09-22
19:57:55 UTC** (relayed on PR #365, comment 5783178239): the operator (Manus)
may apply the §5 one-permission correction **only if the §4 inspection
establishes a missing allow** for the runtime principal in
`westayfit-staging`, with the shared-principal scope disclosed, and then run
one verification and one reset attempt. Any other finding — permission
already present, effective access not establishable, a deny or organisation
policy, a wrong target project, custom roles unavailable, or any further
permission or identity change needed — is a STOP-and-report. The operator's
acknowledgment of that assignment is pending at the time of writing.

**Nothing here is executed by this document, by the pull request that carries
it, or by any Claude session.** No Claude worker performs an IAM change or an
email send; the lead coordinates and records. The approval is not blanket IAM,
deployment or production authority.

Prepared by the lead (L0) on 2026-09-22 from existing source and the
operator's receipt, at the Program Director's request
(PR #365 comment 5783105501). Scope: the two WSF mail functions on the
**staging** project only.

## 1 · What failed, exactly

The owner-designated browser operator ran the staging acceptance test on
2026-09-22 (PR #385 comment 5782663187): one password-reset request at
18:38:03Z and one verification-email request at 18:41:06Z, both through the
WSF staging UI at `westayfit-staging--staging-4a616y5m.web.app`, serving
candidate `3562156` (hosted `/health` marker matched). Both returned
`functions/internal` to the UI. No retry. No mail arrived.

Cloud Logging, per the receipt, places both failures **before the provider
call**:

| Function (Cloud Functions v2, `us-central1`) | Revision | Logged failure |
| --- | --- | --- |
| `wsfSendVerificationEmail` | `wsfsendverificationemail-00030-lup` | Firebase Admin Auth `auth/insufficient-permission` while generating the email action link |
| `wsfSendPasswordResetEmail` | `wsfsendpasswordresetemail-00030-jus` | `[wsfSendPasswordResetEmail] Admin SDK failed auth/insufficient-permission` |

The deployed source at `3562156` (`functions-westayfit/src/index.ts`) matches
that reading:

- `wsfSendVerificationEmail` requires a signed-in caller, reads the address
  from the token, then calls `getAuth().generateEmailVerificationLink(email, …)`
  **before** the Resend `fetch` (index.ts:435). The Admin SDK error is not
  caught there, so `onCall` surfaces it as `internal`.
- `wsfSendPasswordResetEmail` calls `getAuth().generatePasswordResetLink(email, …)`
  (index.ts:1976) inside a `try`; any code other than the three
  enumeration-safe ones is logged as `Admin SDK failed <code>` and rethrown as
  `internal` — which is the exact log line the operator saw.
- The Admin SDK is initialised with a bare `initializeApp()` (index.ts:9):
  application-default credentials, i.e. **the function's runtime service
  account**, targeting the project named in the runtime's `FIREBASE_CONFIG` /
  `GCLOUD_PROJECT`.

Both operator-observed revisions bind numeric `WSF_EMAIL_API_KEY` version 2 and
carry the expected sender and app URL. That is configured-binding evidence for
the two tested invocations — nothing more — and it means the secret is **not**
the blocker. Version 1 stays enabled. The Resend key, sender domain, user
verification, App Check and Firestore rules are not involved in this failure
and are not to be changed to work around it.

The reset callable's lack of caller auth is by design (a signed-out member
resets a password) and is a separate matter from this service-credential
error. It is not addressed here.

## 2 · The permission the call needs

`generateEmailVerificationLink` and `generatePasswordResetLink` call the
Identity Toolkit method `accounts:sendOobCode` with `returnOobLink: true`
(`AccountManagementService.GetOobCode`). Google's access-control reference for
Identity Platform lists the IAM permission that method requires as
**`firebaseauth.users.sendEmail`**, and that permission is supported in
custom roles.

- https://docs.cloud.google.com/identity-platform/docs/access-control
- https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/sendOobCode
- https://cloud.google.com/iam/docs/custom-roles-permissions-support

## 3 · The principal, and what is and is not known about it

| | |
| --- | --- |
| Project | `westayfit-staging` (project number `857281977774`) |
| Runtime principal of both functions | `857281977774-compute@developer.gserviceaccount.com` — the project's **default Compute Engine service account**, shared by every workload in the project that does not set its own identity |
| Known grants (operator reconciliation, PR #385 comment 5777342703) | `roles/secretmanager.secretAccessor` on the one secret `WSF_EMAIL_API_KEY`; "no broader IAM change" |
| Deploy workflow | sets no runtime service account (checked on `main`), so the default identity applies |

**The receipt does not prove which of three causes is responsible**, and each
has a different remedy:

| Cause | How it presents | Remedy class |
| --- | --- | --- |
| **A · missing allow** — no role bound to the principal in `westayfit-staging` contains `firebaseauth.users.sendEmail` (plausible: projects created recently do not auto-grant Editor to the default compute SA, and the only recorded grant is the secret accessor) | Policy Troubleshooter: `NOT_GRANTED`; no deny rule matches | grant the smallest role that carries the permission (§4) |
| **B · a deny policy** — an IAM deny policy on the project, folder or organisation denies the permission (or `firebaseauth.*`) to this principal | Policy Troubleshooter: a matching deny rule; project-level allow makes no difference | owner-level exception in the deny policy; out of this proposal's scope |
| **C · wrong target project** — the Admin SDK is resolving a different project than `westayfit-staging` (runtime `FIREBASE_CONFIG`/`GCLOUD_PROJECT` mismatch) | the principal has no standing in the *other* project; fixing IAM in staging changes nothing | runtime configuration fix (a deploy), not an IAM change |

## 4 · Read-only inspection first — by the operator, with its existing access

All read-only. None prints a secret payload, a user record, an address or a
link. If any command is refused, record the refusal as the limitation and
stop; do not escalate access to make the read work.

```
# 1. The actual principal and the project the runtime resolves.
gcloud functions describe wsfSendVerificationEmail --gen2 --region us-central1 \
  --project westayfit-staging \
  --format='value(serviceConfig.serviceAccountEmail,serviceConfig.environmentVariables.GCLOUD_PROJECT)'
gcloud functions describe wsfSendPasswordResetEmail --gen2 --region us-central1 \
  --project westayfit-staging \
  --format='value(serviceConfig.serviceAccountEmail,serviceConfig.environmentVariables.GCLOUD_PROJECT)'

# 2. The definitive answer for cause A vs B, if the operator's access allows it.
gcloud policy-troubleshoot iam //cloudresourcemanager.googleapis.com/projects/westayfit-staging \
  --principal-email=857281977774-compute@developer.gserviceaccount.com \
  --permission=firebaseauth.users.sendEmail

# 3. Otherwise, the pieces: the principal's project-level roles …
gcloud projects get-iam-policy westayfit-staging \
  --flatten='bindings[].members' \
  --filter='bindings.members:857281977774-compute@developer.gserviceaccount.com' \
  --format='table(bindings.role)'
#    … whether any of them carries the permission …
gcloud iam roles describe <each role above> --format='value(includedPermissions)' | tr ';' '\n' | grep -x firebaseauth.users.sendEmail
#    … and whether a deny policy is attached at the project.
gcloud iam policies list --attachment-point=cloudresourcemanager.googleapis.com/projects/857281977774 --kind=denypolicies

# 4. Blast-radius inventory for §5: every workload that runs as the same principal.
gcloud run services list --project westayfit-staging \
  --format='table(metadata.name,spec.template.spec.serviceAccountName)'
gcloud functions list --gen2 --project westayfit-staging \
  --format='table(name,serviceConfig.serviceAccountEmail)'
gcloud compute instances list --project westayfit-staging --format='table(name,serviceAccounts[].email)'

# 5. The API itself is enabled.
gcloud services list --enabled --project westayfit-staging --filter='config.name:identitytoolkit.googleapis.com'
```

## 5 · Proposed smallest correction — only if the inspection shows cause A

**Owner-approved on the condition above; executed by the operator only.**
Two refinements from the approval: an existing role containing *exactly* this
one permission may be reused unmodified instead of creating a new one; and the
binding must be an additive, concurrency-safe update that preserves every
existing policy entry and condition (`gcloud projects add-iam-policy-binding`
performs a read-modify-write with the policy's etag). Record the exact role,
the permission, the before/after binding delta, and a rollback that removes
only the newly added binding. No pre-existing role is broadened.

Create one custom role in the staging project containing exactly the one
permission, and bind it to the existing principal at project level:

```
# role: one permission, nothing else
gcloud iam roles create wsfAuthActionLinkMinter --project westayfit-staging \
  --title='WSF action-link minter (staging)' \
  --description='Lets the WSF mail functions generate Firebase Auth action links (accounts:sendOobCode). One permission.' \
  --permissions=firebaseauth.users.sendEmail --stage=GA

# binding: the principal the functions already run as
gcloud projects add-iam-policy-binding westayfit-staging \
  --member=serviceAccount:857281977774-compute@developer.gserviceaccount.com \
  --role=projects/westayfit-staging/roles/wsfAuthActionLinkMinter
```

Why this and not the alternatives:

- `roles/firebaseauth.admin`, `roles/firebase.admin`, `roles/editor`,
  `roles/owner` all carry the permission and far more. **Not proposed, and
  not authorised** by the Director's comment.
- Identity Platform permissions attach to the project, not to a Cloud Run
  service, so the binding is inherently project-level; the narrowing lever is
  the role's content (one permission), not the binding's scope.
- A **dedicated runtime service account** for the two mail functions (with only
  this role plus the secret accessor) would confine the permission to those
  two workloads. It requires redeploying both functions with a new
  `serviceAccount` — a runtime-identity migration, which the Director's
  comment explicitly does not authorise. Recorded here as the follow-up if the
  blast radius below is unacceptable, not folded into this proposal.

**Blast radius, stated plainly.** The binding is to the *shared* default
compute service account at *project* level. After it, **every workload in
`westayfit-staging` that runs as that principal** — not only these two
functions — can call `accounts:sendOobCode` for any user of the project's
Identity Platform: it can mint verification, password-reset and email-sign-in
links. The permission does not let a workload read or change users or
passwords; the risk is a workload other than these two minting a reset link
for a real user and using it. The §4-4 inventory says how many such workloads
exist today; the owner should see that list before deciding. The binding is
confined to the staging project; production is untouched.

**Propagation and verification.** IAM changes propagate within minutes
(Google documents up to ~7 minutes). **No redeploy is needed for an IAM-only
correction.** After propagation, the operator — still the single operator —
runs **one** verification attempt and **one** reset attempt through WSF
staging, completes the link and the auth-state check, and records the result;
no unbounded retries. Success is still: provider accepted → inbox received →
link completed → `emailVerified` refreshed with the destination retained,
plus the reset flow — never a 2xx alone.

**Rollback** (no deploy either way):

```
gcloud projects remove-iam-policy-binding westayfit-staging \
  --member=serviceAccount:857281977774-compute@developer.gserviceaccount.com \
  --role=projects/westayfit-staging/roles/wsfAuthActionLinkMinter
gcloud iam roles delete wsfAuthActionLinkMinter --project westayfit-staging   # soft-deleted; recoverable for 7 days
```

## 6 · If the inspection shows cause B or C

- **B (deny policy):** the project-level allow above would not help. The
  remedy is an exception in the deny policy for this principal and
  permission, at whichever level the deny is attached — an owner/organisation
  decision outside this proposal. Record the deny rule's name and level and
  stop.
- **C (wrong target project):** the functions' runtime configuration is the
  fault, not IAM. The remedy is a configuration correction in a deploy —
  separately reviewed, not started from this document.

## 7 · Not authorised, not proposed, not done

No Owner / Editor / Firebase Admin / Auth Admin grant. No service-account key.
No IAM write of any kind by anyone but the owner after approval. No service
identity migration. No redeploy. No retry send. No change to the Resend key,
sender domain, secret versions (version 1 stays enabled), user verification,
App Check or Firestore rules. No production resource touched. No recipient
address, link, code or payload appears in this document or its PR.

## 8 · Relation to the reporter work (#393)

The operator's receipt already establishes that both tested revisions bind
secret version 2. The #393 correctness review and its bounded patch continue
independently and are not asked to rediscover that fact; nothing in #393
fixes, or claims to fix, this authorization failure.


## 9 · Operator result — 2026-09-22 20:11 UTC: STOPPED WITHOUT CHANGE

PR #385 comment 5783381703. The one-permission correction was **not
applied**, because its mandatory precondition — a *conclusively* established
missing allow for the runtime principal — could not be met with the operator's
existing access:

- both functions confirmed ACTIVE on the expected runtime principal
  (`…-00030-lup`, `…-00030-jus`);
- Policy Troubleshooter is **disabled** on the project and was not enabled;
- a short-lived impersonation of the runtime principal was **denied** (the
  operator lacks `iam.serviceAccounts.getAccessToken` on it);
- direct project inspection found **no** exact-one-permission custom role and
  **no** binding for it — but hierarchy-level allow / deny / group controls
  could not be fully evaluated, so effective access is not proven either way.

Per the owner's stop condition: no role created, no binding added, the
project policy etag / fingerprint / binding count unchanged, no email sent,
nothing else touched.

**What a conclusive inspection now needs — an owner decision, not an operator
or Claude action.** Three paths, in order of least change:

1. **The owner runs the read-only query with owner-level access** (nothing
   granted to anyone): enable the Policy Troubleshooter API on the staging
   project if it is off (`gcloud services enable policytroubleshooter.googleapis.com --project westayfit-staging` — a project API setting, not IAM), then
   `gcloud policy-troubleshoot iam //cloudresourcemanager.googleapis.com/projects/westayfit-staging --principal-email=857281977774-compute@developer.gserviceaccount.com --permission=firebaseauth.users.sendEmail`
   and paste the sanitized outcome (GRANTED / NOT_GRANTED / UNKNOWN and the
   matching binding or deny rule, no other detail). An owner with
   organisation-level read sees the whole hierarchy, which is what the
   operator could not.
2. **Give the operator hierarchy read** for one inspection
   (`roles/iam.securityReviewer` at the organisation or folder that holds the
   project, plus the API above) — a real IAM grant, so it needs its own
   bounded approval and rollback.
3. **Accept the project-level finding as sufficient**: no allow exists at
   project level and the runtime failure is real; the owner relaxes the stop
   condition explicitly and the §5 correction proceeds. If a hierarchy deny
   turns out to be the cause, the binding does nothing and is rolled back —
   the risk is one wasted attempt, not a wrong grant.

Until one of these is chosen, M5 stays open with an exact blocker; no retry
send, no further diagnostic deployment.
