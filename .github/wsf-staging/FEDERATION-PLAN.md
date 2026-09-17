# WSF staging — Workload Identity Federation installation plan

**One plan.** The two drafts proposed different pool and provider names
(`wsf-staging-github`/`github` and `wsf-github`/`goarrive-wsf-staging`). The
names below are the final ones and every reference in
`.github/workflows/wsf-staging-deploy.yml` agrees with them. **Create one pool
and one provider, not both.**

Nothing here is applied. No merge, trust activation or dispatch is authorized
by this file.

## Fixed values

| | |
| --- | --- |
| Project | `westayfit-staging` |
| Project number | `857281977774` — **Manus must confirm directly**; it is inferred from the runtime identity `857281977774-compute@developer.gserviceaccount.com` in the provisioning report |
| Service account | `wsf-staging-deployer@westayfit-staging.iam.gserviceaccount.com` — **reuse, do not create another** |
| Pool | `wsf-staging-github` |
| Provider | `github` |
| Repository | `idevinsimpson/goarrive`, numeric id **`1183770993`** (verified via the GitHub API this session) |
| Workflow ref | `idevinsimpson/goarrive/.github/workflows/wsf-staging-deploy.yml@refs/heads/main` |

## Commands

```bash
gcloud iam workload-identity-pools create wsf-staging-github \
  --project=westayfit-staging --location=global \
  --display-name="WSF staging GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc github \
  --project=westayfit-staging --location=global \
  --workload-identity-pool=wsf-staging-github \
  --display-name="GitHub OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository=assertion.repository,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref,attribute.event_name=assertion.event_name,attribute.workflow_ref=assertion.workflow_ref,attribute.environment=assertion.environment" \
  --attribute-condition="assertion.repository_id=='1183770993' && assertion.repository_owner_id=='4096408' && assertion.event_name=='workflow_dispatch' && assertion.ref=='refs/heads/main' && assertion.workflow_ref=='idevinsimpson/goarrive/.github/workflows/wsf-staging-deploy.yml@refs/heads/main' && assertion.environment=='wsf-staging'"

gcloud iam service-accounts add-iam-policy-binding \
  wsf-staging-deployer@westayfit-staging.iam.gserviceaccount.com \
  --project=westayfit-staging \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/857281977774/locations/global/workloadIdentityPools/wsf-staging-github/attribute.repository_id/1183770993"
```

## Why each condition

- **`repository_id`** — numeric and immutable. A rename does not satisfy it and
  a fork has a different id. `repository` is mapped for readability only; the
  condition uses the id.
- **`repository_owner_id`** — pins the owner account as well, so a repository id
  reused after a transfer cannot inherit the trust.
- **`event_name == 'workflow_dispatch'`** — excludes push, pull_request,
  schedule and `pull_request_target` entirely. Fork pull requests cannot obtain
  `id-token: write` in any case; this makes it explicit rather than incidental.
- **`ref == 'refs/heads/main'`** — only the default branch's copy of the
  workflow can authenticate.
- **`workflow_ref`** — pins the exact workflow file. Renaming it breaks trust,
  by design; a second workflow added later cannot borrow this identity.
- **`environment == 'wsf-staging'`** — this is the claim that matches the
  revised job structure. Only jobs declaring `environment: wsf-staging` get an
  OIDC token carrying it, so the `build` job — which has no `id-token`
  permission *and* no environment — is excluded twice over.

## The GitHub environment is part of the installation, not just a name

The `config`, `deploy` and `hosted-verify` jobs declare `environment:
wsf-staging`. Declaring it does not by itself create any protection. Create it
under **Settings → Environments → New environment → `wsf-staging`** and set:

- **Deployment branches and tags:** *Selected branches* → `main` only. Without
  this, the environment claim can be obtained from any branch and the
  `assertion.environment` condition above stops meaning anything.
- **Required reviewers:** optional, and recommended — it makes each staging
  deployment an explicit human approval inside GitHub.
- **Environment secrets:** none. This design uses no secrets.

Please confirm these settings once created; the `assertion.environment`
condition depends on the branch restriction to be meaningful.

## Checks before applying

1. Confirm project number `857281977774`.
2. Confirm `constraints/iam.workloadIdentityPoolProviders` does not restrict the
   GitHub issuer. If it blocks `token.actions.githubusercontent.com`, **report
   it — do not change the policy.**
3. Confirm `wsf-staging-deployer` still holds only its approved bindings and no
   user-managed key was created.
4. If any part of this was already installed under a separate approval, produce
   its receipt before applying anything, so a duplicate pool is not created.

## What only the first authenticated run can establish

The federated path is a supported design, traced through firebase-tools'
`requireAuth` → `autoAuth` → `GoogleAuth` (ADC, which accepts `external_account`
credentials via `google-auth-library ^9.11.0`). That is a reading of the code,
not an executed deployment. Only the first run can show that the token exchange
succeeds, that the deployer's bindings are sufficient in practice, and that the
Firebase CLI, the Firestore/Identity Toolkit REST fixtures and the Cloud
Run/Functions metadata reads all accept the same credential. The read-only
preflight runs before any change for exactly that reason.
