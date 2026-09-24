# WE STAY FIT Staging Deploy Skill

Use this skill whenever Devin asks to deploy WE STAY FIT to staging, asks whether staging is current, or asks how to run the WSF staging release.

## The one correct deploy path

WE STAY FIT staging deploys through the manual GitHub Actions workflow:

- Workflow: `.github/workflows/wsf-staging-deploy.yml`
- GitHub name: `WSF staging deploy`
- Operational branch: `main`
- Staging project: `westayfit-staging`
- Staging site/channel: `westayfit-staging` / `staging`
- Candidate approval: `.github/wsf-staging/approved-candidate.json`

Do **not** use the generic GoArrive local Firebase/service-account deploy instructions for WSF staging. This workflow uses GitHub OIDC/WIF and is the reviewed release path.

## Owner request means act

When Devin explicitly says "deploy staging now", do not stop at a status report and do not ask him to repeat permission already given.

1. Read `main` and the approved candidate.
2. Confirm the workflow file exists on `main`.
3. Dispatch the workflow from `main`.
4. Capture the run id immediately.
5. Watch the run through completion.
6. Post deployment, served-revision, hosted-verification and cleanup receipts separately.

A separate feature-readiness item (for example a Firestore index still building) may limit whether a feature is fully usable, but it is not a reason to forget how to dispatch the staging workflow when the owner explicitly asks for the deploy. Report the limitation honestly.

## Exact command sequence

From a checkout with GitHub CLI authenticated for `idevinsimpson/goarrive`:

```bash
set -euo pipefail

REPO="idevinsimpson/goarrive"

git fetch origin main
OP_SHA="$(git rev-parse origin/main)"
APP_SHA="$(git show origin/main:.github/wsf-staging/approved-candidate.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).approvedAppSha))')"

test -n "$APP_SHA"
echo "Operational main: $OP_SHA"
echo "Approved app SHA: $APP_SHA"

gh auth status

gh workflow run .github/workflows/wsf-staging-deploy.yml \
  --repo "$REPO" \
  --ref main \
  -f mode=deploy \
  -f app_sha="$APP_SHA"
```

Then locate the new run. Prefer matching the operational `main` SHA rather than assuming the newest run is ours:

```bash
RUN_ID="$(
  gh run list \
    --repo "$REPO" \
    --workflow "WSF staging deploy" \
    --event workflow_dispatch \
    --branch main \
    --limit 10 \
    --json databaseId,headSha,createdAt,status \
    --jq ".[] | select(.headSha == \"$OP_SHA\") | .databaseId" \
  | head -n 1
)"

test -n "$RUN_ID"
echo "Run: $RUN_ID"
gh run watch "$RUN_ID" --repo "$REPO" --exit-status
```

If more than one recent run has the same `main` SHA, compare `createdAt` to the dispatch time before selecting the id.

## What success must prove

Do not say "staged" just because the dispatch command returned successfully.

Read the run and report the exact evidence that applies to that candidate:

- gate resolved the same `approvedAppSha`
- build passed
- deploy job passed
- exact hosted/build marker matches the approved app SHA
- function inventory matches the reviewed BEFORE/EXPECTED contract
- `CREATED_THIS_DEPLOY` is exactly the reviewed set (or `none`, depending on the pin)
- deployment verifier passed
- hosted verification completed with its explicit result/failure counts
- synthetic cleanup completed
- any candidate-specific route/deep-link checks passed

Useful commands:

```bash
gh run view "$RUN_ID" --repo "$REPO"
gh run view "$RUN_ID" --repo "$REPO" --json url,headSha,status,conclusion,jobs
gh run view "$RUN_ID" --repo "$REPO" --log
```

When the evidence artifact is required, use the existing artifact review path rather than inferring from logs alone.

## Current WSF workflow jobs

The deploy-mode workflow has these relevant jobs:

- `gate`
- `config`
- `build`
- `deploy`
- `hosted-verify`

Other modes such as `player-journey`, `cleanup-recovery`, and `mail-preflight` are not substitutes for a normal staging deploy.

## Failure handling

If the workflow fails:

1. Record the run id and exact failed job/step.
2. Do not dispatch repeated runs blindly.
3. Read the failing job logs.
4. Fix or route only the concrete blocker.
5. Re-run only when the failure is understood and the same candidate remains approved.

If the deploy succeeds but a newly deployed service is transport-SHUT or a required index is not READY, report:
- deployment succeeded;
- staging serves the new app SHA if the hosted marker proves it;
- the affected feature is not yet fully usable;
- the exact post-deploy operator action still required.

Do not collapse these into "deploy failed".

## Release boundaries

- Never merge PR #365 to `main` merely to deploy.
- Deploy only the SHA approved by `.github/wsf-staging/approved-candidate.json`.
- Never silently change the approved SHA during dispatch.
- Do not broaden IAM/WIF, create credentials, hunt for secrets, or bypass the workflow.
- Staging is not production.
- A successful staging deploy does not clear separate kiosk, email, privacy/legal, or production holds.

## Receipt format

After dispatch, post a concise receipt to PR #365:

```text
WSF staging deploy dispatched
operational main: <sha>
approved app: <sha>
run: <id> <url>
state: dispatched | running | completed
```

After completion, update it with:
- deploy conclusion
- served marker / app SHA
- inventory before/after + created set
- hosted result counts
- cleanup status
- any remaining feature-specific staging limitation

The goal is that no future Claude/Fable session has to rediscover the deploy mechanism from old PR comments.
