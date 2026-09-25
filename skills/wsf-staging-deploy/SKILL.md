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



## Automatic stable-change cadence — OWNER RULE

**Owner decision (September 25, 2026): after every stable WE STAY FIT change, Claude/Fable should deploy that stable milestone to staging automatically. Do not wait for Devin to ask again.**

A change is **stable enough to stage** only when all of these are true:

1. The product/behavior change has the Director's acceptance for the changed dependencies.
2. L0 has integrated the accepted change into `claude/wsf-app-shell` and has the exact development SHA.
3. The exact staging candidate/pin has been reviewed for its real protected-path delta and current live function-inventory assumptions.
4. Any required independent release check on the pin/candidate is green.
5. No newer fully accepted integrated successor has superseded it before the pin is finalized.
6. No other WSF staging deploy is currently in progress.

This cadence is **event-driven**, not commit-driven. Do **not** deploy every raw commit. In particular, do not auto-stage:
- unaccepted work;
- test-only or documentation-only changes;
- Lovable/reference-only changes;
- isolated R&D/prototypes that are explicitly unexported/unreachable;
- a candidate whose pin/inventory contract has not been updated and reviewed;
- a blind retry of a failed run.

Once those conditions are met, L0 should perform the next staging release without another owner prompt:

1. Read the latest accepted integrated development SHA.
2. Re-read the **actual last measured staging inventory** from the most recent deployment receipt. Never reuse an older BEFORE count just because it appears in prose.
3. Prepare the smallest reviewed pin/update needed for the exact candidate.
4. Run the existing independent focused pin/release check.
5. Merge the reviewed operational pin to `main`.
6. Dispatch **one** `WSF staging deploy` from `main`.
7. Capture the run id and watch through completion.
8. Post the deployment, served-marker, hosted-verification, and cleanup receipts.
9. Record any feature-readiness limitations separately from whether the build itself is served.

If a newer accepted milestone lands **before** the pin merge, prefer the newer exact reviewed head rather than staging a knowingly stale milestone. If a deploy is already running, let it finish; serialize the next stable milestone behind it.

A green staging deploy does not make separately blocked functionality usable. Index readiness, callable transport, email delivery, kiosk authorization, privacy/legal, or production release remain their own gates.

## Proven successful example — run 48

Run 48 is the concrete known-good example of this skill succeeding end to end:

- operational `main`: `0359f8d1a3f5c9a0e6469bf1864902f4b63cca19`
- approved app: `502b1e8d0c98c199445c664c696b3f73bb460f14`
- workflow run: `36133376723`
- live inventory: `49 -> 49`
- `CREATED_THIS_DEPLOY=none`
- `VERIFY=pass`
- hosted marker matched `502b1e8`
- hosted verification: `24/24`, `FAILURES=0`
- cleanup: `COMPLETE`

The successful operational sequence was:

1. W3 prepared a **two-file** pin correction for the exact integrated candidate and current measured inventory.
2. W7 independently verified the pin/gate.
3. Director accepted the exact pin.
4. L0 merged the pin to `main`.
5. L0 dispatched exactly one workflow run from `main` with:
   - `mode=deploy`
   - `app_sha=502b1e8d0c98c199445c664c696b3f73bb460f14`
6. The workflow's read-only preflight verified the live inventory before mutation.
7. Functions + Hosting deployed.
8. The deployment verifier passed.
9. Hosted verification passed 24/24.
10. Synthetic cleanup completed.

Run 48 also demonstrates an important distinction: the app can be successfully served while some feature capabilities remain unavailable. The three social callables still reported SHUT and the required social index still lacked a READY receipt. That is a **feature-readiness** limitation, not a reason to forget or skip the staging deploy.


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
