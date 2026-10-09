# RUNBOOK: WSF production deploy on `goarrive` (PRODUCTION-DEPLOY-PATH-1)

**Status: reviewed procedure. NOTHING in this file has been executed.**

**Authority:**
- **Queue:** #365 `6075293313` (owner authorization `6075062042` and `6075204369`).
- **Release:** `6075293540`.
- **Owner decisions:**
  - **Path A** (#365 `6075844761`): the owner runs this runbook with his own credentials.
  - **Candidate A on the pending consent version** (#365 `6075884941`).
- **Facts:** cited from the inventory, **PR #599 at head `80b603c7a9b28bbe005621500544ebe7c60868e6`**. That head carries the owner's production readbacks (#365 `6076170543`, receipted by L0 in `6076227694`). If a later review of #599 changes a fact, this runbook follows the reviewed inventory.
- **Corrections this revision answers:**
  - W4's finding #394 `6076291750`;
  - L0's corrections #365 `6076227694` and #497 `6076230776`;
  - L0's delta #497 `6076938217` and addendum `6077207763`, which carry W4's two optional nits from the #599 pass `6077136451`;
  - W9's own adversarial review against the pinned `firebase-tools` 15.30.1 and `firebase-functions` 4.9.0 sources.

**Who runs it:**
- **Operator:** Devin, or whoever holds production rights on `goarrive`, using **their own** credentials. No worker or L0 session holds a production credential, and none may use one.
- **What licenses a run:** two things, before any step past 1:
  1. the readbacks and captures of step 0;
  2. the Director's **named acceptance of one exact candidate SHA**.

  This document alone does not.

**Deadline: the run must finish before 2026-10-30T00:00Z.** From then on, `firebase-tools` 15.30.1 refuses to deploy Node.js 20 functions, and the candidate pins Node 20 (#599 3, S1). After that date the only way forward is a new candidate record on a newer runtime, with its own review.

## What production holds today (#599, read back 2026-10-09)

- **Functions:** 17 `wsf*` functions, last updated 2026-09-15. Their source is **not** in this repository.
  - Candidate A updates 16 of them in place and creates 43.
  - **`wsfListCommunityGoals`** is not exported by A (step 5).
- **Rules:** release `cloud.firestore` → ruleset `1e14eab9-a23f-437f-8418-918b9eaefe65` (2026-09-01). It equals `main` outside an older WSF section, so A's rules are strictly tighter and leave GoArrive unchanged.
- **Indexes:** 48 composite indexes, all READY, none of them WSF.
- **Mail:** `WSF_EMAIL_API_KEY` has versions 1 and 2, with v2 bound. `WSF_APP_URL` points at **a staging preview channel**, not `https://app.westay.fit`.
- **Auth:**
  - `app.westay.fit` is authorized: the owner added it 2026-10-09.
  - Email/Password is enabled.
  - **Anonymous is enabled.** GoArrive's share page uses it, so it is never disabled here.
- **IAM:** the org policy `iam.allowedPolicyMemberDomains` is `allValues=ALLOW`, and the operator is a project Owner.

## The rules that do not bend

1. **Never `firebase.json`.** It is GoArrive's default: it carries GoArrive's `default` codebase, Storage, and Hosting that resolves to `goarrive.web.app`. Every Firebase command here passes `--config firebase.westayfit.production.json`.
2. **Never Hosting, never Storage.** Lovable serves `app.westay.fit`. WSF stores no Cloud Storage object.
3. **Never deploy from operational `main`.** Main's `functions-westayfit` has **one** export (`wsfHealth`). A `functions:westayfit` deploy from it would prune every other `westayfit` function.
4. **Never `--force`.** Every `firebase deploy` runs with `--non-interactive`, so any prompt aborts instead of being answered. The one reviewed exception is step 6's interactive form for the minimum-bill stopper (S2, below). `--force` would accept, all at once:
   - every deletion;
   - a minimum-bill increase;
   - a **1-day** cleanup policy on the `gcf-artifacts` repository that GoArrive's images share.

   Besides that form, the only interactive commands are:
   - S3's opt-out, if the owner chooses it;
   - the named, one-function deletes in steps 5 and 10.

   For each, the operator reads the prompt and confirms only what it names.
5. **Run the pre-flight before every `firebase deploy`, passing that exact command line as `--command`.** A non-zero exit means stop.
   - Each deploy is chained behind its pre-flight with `&&`, so a refusal stops it even when a block is pasted whole.
   - Step 0 defines `firebase` as the pinned CLI, so the line the pre-flight checks is the line that runs.
6. **Never remove `allUsers` from a WSF service.**
   - With these versions, every callable is created public at the Cloud Run layer, whatever its source `invoker` says, and each handler's own auth check is the control (#599 3).
   - A browser's Firebase ID token is not a Cloud Run credential, so without `allUsers` no WSF callable is reachable from the web.
   - A redeploy never restores it.
7. **No secret, token, key or action link in any receipt.** Paste names, counts, states and SHAs only.
8. **One step at a time, with a receipt after each.** A failure stops the run. Do not retry blind: roll back what landed (step 10) and report.

## Candidate records

| | Candidate A | Candidate B |
|---|---|---|
| SHA | `ec162d17a0540e936741027f9b8f90dd372cfaf4` **exactly** (development, `claude/wsf-app-shell`) | to be named: A plus **one** reviewed consent-version commit |
| Status | **the launch candidate** (#365 `6075884941`) | **off the launch path:** a future record |
| What deploys | backend only: `functions:westayfit` (59 exports), the WSF Firestore rules section, the 2 WSF composite indexes. 17 exports *declare* `invoker: 'public'` in source. That declaration is inert for `onCall`: all 59 receive `allUsers` when created. | the same; B changes no export, rule or index |
| Consent | `pending-approval-2026-08-25` in `functions-westayfit/src/index.ts:124-125` and `apps/westayfit/src/profileConstants.ts:1-2`. The owner decided to launch on it. The pre-flight reports `consentVersionPending: true`. | the approved version, equal in both files. The pre-flight refuses a pending, blank or placeholder version. |
| Sign-up | opens on the owner's go after the step-9 receipt (the Lovable flag). Every profile then records consent to the pending version, an owner-accepted risk. `wsfSaveProfile` is already served today from the older source. | after legal review (PR #598) and the Director's acceptance of B's exact SHA |
| Allowed diff from A | — | the consent values in `index.ts` and `profileConstants.ts` (everything else byte-equal); `apps/westayfit/src/legalContent.ts`, `apps/westayfit/legal/terms.md` and `privacy.md`; and test files under `functions-westayfit/tests/` and `apps/westayfit/tests-e2e/` that change by the version string only |
| Pre-flight | `--record A` | `--record B` |

The Director accepts **one** of these by exact SHA. A candidate that needs anything beyond this table is a new candidate record and a new review, not an edit to this runbook. One example is a `main` whose `firestore.rules` has changed since `41bff6c6`.

## Toolchain stoppers, and the reviewed way through each (#599 3)

Each of these stops `firebase deploy --only functions:westayfit --non-interactive` without `--force`. Each was read in the pinned `firebase-tools` 15.30.1 source. Each has one reviewed way through, and **`--force` is never it**.

| Stopper | When it bites | The reviewed way through |
|---|---|---|
| **S1:** Node.js 20 decommission (`runtimes/supported/types.js:50-55`, `index.js:56-59`) | any functions deploy on or after 2026-10-30T00:00Z, including a deploy-based rollback | Finish before then. No flag gets past it. After that date, the way forward is a new candidate record that moves `functions-westayfit` to a newer runtime, reviewed as a source change. |
| **S2:** the minimum-bill prompt (`prepare.js:338`, `prompts.js:116-176`) | `wsfCheckIn` wants 1 warm instance on `goarrive`, and the live function keeps fewer, or keeps one at a lower cost (B4c) | Step 6 always runs the non-interactive command first. The prompt sits in the pre-checks, before anything is created, so a stop there changes nothing. Then, **if and only if** the only error is `Pass the --force option to deploy functions that increase the minimum bill`, pre-flight and run the **interactive form** (step 6). Answer **Yes** to `Would you like to proceed with deployment?` only when the warning above it lists exactly `wsfCheckIn(us-central1): 1 instances`. At any other prompt, press **Ctrl-C**. The deletion prompt comes before any create (`release/index.js:55`), so nothing has changed at that point. |
| **S3:** the `gcf-artifacts` cleanup policy (`artifacts.js:121-161`, `prompts.js:179-190`) | B11 shows no cleanup policy and no `firebase-functions-cleanup-opted-out` label. The deploy then releases every function and exits non-zero. | **Before step 6, an owner decision recorded on #365,** run interactively by the owner:<br>`firebase functions:artifacts:setpolicy --location us-central1 --none --project goarrive`<br>It adds only the opt-out label to the shared repository and deletes no image.<br>**Never `--days`, never `--force`:** both set a policy that deletes container images older than N days (default 1) from the repository GoArrive's functions share.<br>**If the owner declines to touch the shared repository,** run step 6 as written and treat the post-release `Functions successfully deployed but could not set up cleanup policy` exit as expected. Step 8 then proves every function, because that exit also hides any per-function error summary (`release/index.js:100-117`). |

The fourth stop of this kind is the pending deletion of the orphan. Step 5 settles it before step 6, and never with `--force`.

## Step 0: readbacks and captures (read-only)

### 0.1 The shell

Run every step in **one** shell. If you open a new terminal, define `firebase` again and re-check its version.

```sh
firebase() { npx -y firebase-tools@15.30.1 "$@"; }   # every firebase line below runs this pinned CLI
firebase --version                                    # must print 15.30.1
date -u +%Y-%m-%dT%H:%M:%SZ                           # must be before 2026-10-30T00:00:00Z
mkdir -p ~/wsf-prod && cd ~/wsf-prod
```

### 0.2 Already answered

These were answered by the owner's readback, #365 `6076170543`, and are not re-run. Its own section labels are:
- [B1] web apps;
- [B2] Auth config;
- [B3] secret and env;
- [B4] functions in `us-central1`;
- [B6] rules release;
- [B7] indexes;
- [B8] IAM and org policy;
- [B10] browser key;
- the action URL.

The owed rows below use #599's numbering, in which B8 is the Storage rules readback.

### 0.3 Still owed: run in one sitting, read-only

Paste each answer on #365. "Gates" says which step a failing answer stops, and why.

| Readback | Exact read-only command or console path | A pass looks like | Gates |
|---|---|---|---|
| **B3b** Resend sending domain | Resend dashboard › Domains | `westay.fit` listed as **Verified** for sending | **Yes, step 6.** The mail callables send from `WSF_EMAIL_FROM`, and an unverified domain fails DMARC. |
| **B4b** revisions of the 16 kept services | taken by the 0.4 capture into `run-services-before.txt` | one `latestReadyRevisionName` per service, in every region | **Yes, step 6.** It is the functions rollback anchor. |
| **B4c** `wsfCheckIn` minimum instances | `gcloud functions describe wsfCheckIn --gen2 --region=us-central1 --project=goarrive --format="value(serviceConfig.minInstanceCount)"` | `1` | **No.** It predicts S2. With `1`, step 6's non-interactive form is expected to pass. Otherwise expect S2's way through. |
| **B4d** codebase labels of the 17 | `gcloud functions list --project=goarrive --regions=us-central1 --filter="name~/functions/wsf" --format="yaml(name,labels)" > wsf-labels-before.txt` | each shows `firebase-functions-codebase: westayfit`, or none | **Yes, step 5.** The orphan's label decides whether D1 is required. |
| **B5** IAM of the 16 kept services | taken by the 0.4 capture into `run-iam-before.txt` | each kept WSF service lists `roles/run.invoker` → `allUsers` | **No.** A kept service without it is unreachable from the web today, and a redeploy will not add it. Raise it as an owner decision, and repair it by name only with `add-iam-policy-binding`. |
| **B8** Storage rules | Rules API release `projects/goarrive/releases/firebase.storage/goarrive.firebasestorage.app`, or Console › Storage › Rules | any. Recorded only. | **No.** No WSF step touches Storage. |
| **B9** Hosting | `firebase hosting:sites:list --project goarrive`; host and DNS of `westay.fit` | any. Recorded only. | **No.** There is no Hosting step, and Lovable serves `app.westay.fit`. |
| **B11** cleanup policy | `gcloud artifacts repositories describe gcf-artifacts --location=us-central1 --project=goarrive --format="yaml(cleanupPolicies,labels)"` | any cleanup policy, or the `firebase-functions-cleanup-opted-out` label | **Yes, step 6.** If neither is present, apply S3's way through first. |

### 0.4 Captures

These are the anchors for regression and rollback. Each file stays in `~/wsf-prod`, outside any repository.

```sh
# Regions in use. Expect us-central1 and us-east1; add any other region to every loop below.
gcloud functions list --project=goarrive --format="value(name)" | cut -d/ -f4 | sort | uniq -c
gcloud functions list --project=goarrive --format="table(name,state,updateTime)" > functions-before.txt
: > run-services-before.txt; : > run-iam-before.txt
for R in us-central1 us-east1; do
  gcloud run services list --project=goarrive --region="$R" --format="table[no-heading](metadata.name,status.latestReadyRevisionName)" >> run-services-before.txt   # B4b
  for S in $(gcloud run services list --project=goarrive --region="$R" --format="value(metadata.name)"); do
    echo "== $R $S" >> run-iam-before.txt
    gcloud run services get-iam-policy "$S" --region="$R" --project=goarrive --format=json >> run-iam-before.txt   # B5, and GoArrive's baseline
  done
done
gcloud firestore indexes composite list --project=goarrive --format="value(name,state)" | sort > indexes-before.txt
gcloud functions list --project=goarrive --regions=us-central1 --filter="name~/functions/wsf" --format="yaml(name,labels)" > wsf-labels-before.txt   # B4d
gcloud secrets get-iam-policy WSF_EMAIL_API_KEY --project=goarrive --format=json > secret-iam-before.json

# B6: the live Firestore ruleset. The token never reaches the screen or a file.
capture_rules() {   # $1 = output file
  local TOKEN RULESET
  TOKEN="$(gcloud auth print-access-token)" || { echo "STOP: no token"; return 1; }
  curl -sSf --oauth2-bearer "$TOKEN" https://firebaserules.googleapis.com/v1/projects/goarrive/releases/cloud.firestore > rules-release.json \
    || { echo "STOP: rules release read failed"; return 1; }
  RULESET="$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1]));if(!r.rulesetName)process.exit(1);console.log(r.rulesetName)' rules-release.json)" \
    || { echo "STOP: no rulesetName"; return 1; }
  curl -sSf --oauth2-bearer "$TOKEN" "https://firebaserules.googleapis.com/v1/$RULESET" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const f=JSON.parse(s).source.files;if(f.length!==1){console.error("expected exactly one rules file, got "+f.length);process.exit(1)}process.stdout.write(f[0].content)})' \
    > "$1" || { echo "STOP: ruleset source read failed"; return 1; }
  test -s "$1" || { echo "STOP: empty ruleset"; return 1; }
  echo "ruleset: $RULESET  sha256: $(sha256sum "$1" | cut -c1-64)"
}
capture_rules live-firestore.rules.step0 && cp live-firestore.rules.step0 live-firestore.rules
```

The line `capture_rules` prints is the **rules rollback anchor**. Today it should read `projects/goarrive/rulesets/1e14eab9-a23f-437f-8418-918b9eaefe65` with sha256 `c598fc3b…`.

### 0.5 Go only if all of these hold

- **Date and CLI:** the date is before 2026-10-30, and `firebase --version` printed `15.30.1`.
- **The live WSF set is still #599's 17** (`functions-before.txt`). If it is not, production has changed since the readback: **stop**.
- **B3b, B4b, B4d and B11 pass,** or B11's failure is settled by S3's way through (0.3).
- **B4c is recorded.** It predicts whether step 6 needs S2's interactive form.
- **The org policy still permits `allUsers`.** If it does not, no WSF callable is reachable from the web: **stop and escalate**.

## Step 1: checkout and pre-flight (no credential needed)

This needs `firebase.westayfit.production.json` and `.github/wsf-production/` on `main`, which means this packet must already be integrated.

```sh
cd ~/wsf-prod
git clone https://github.com/idevinsimpson/goarrive.git src
git -C src fetch origin main claude/wsf-app-shell
MAIN="$(git -C src rev-parse origin/main)"                 # record it; the pre-flight compares against THIS main
CANDIDATE=ec162d17a0540e936741027f9b8f90dd372cfaf4         # the SHA the Director accepted
CAND=~/wsf-prod/candidate
git -C src worktree add --detach "$CAND" "$CANDIDATE"
git -C src show "$MAIN":firebase.westayfit.production.json > "$CAND/firebase.westayfit.production.json"
PF() { node ~/wsf-prod/src/.github/wsf-production/preflight.mjs --repo ~/wsf-prod/src --record A \
  --candidate "$CANDIDATE" --main "$MAIN" --config "$CAND/firebase.westayfit.production.json" \
  --worktree "$CAND" --live-rules ~/wsf-prod/live-firestore.rules "$@"; }
PF
```

- **Exit 0 and `"ok": true`:** continue. Paste the verdict. It is JSON, prints no env value, and holds no secret.
- **Exit 1:** a check refused. Do not continue. The `checks[].detail` lines name what.
- **Exit 2:** the inputs were unusable: a SHA that is not fetched, an unreadable file, or an empty live ruleset. Fix the inputs, then re-run.

**`rules.live-outside-wsf-equals-main` refused** means the live GoArrive rules are not `main`'s; its detail names the first differing line. **Stop and escalate** before step 2: deploying `firestore.rules` would change GoArrive's rules.

The pre-flight also checks:
- that the worktree is at the candidate, with nothing added but the config (and, from step 3, the env file);
- that the config equals `main`'s reviewed file, predeploy included.

## Step 2: indexes (additive, WSF-only, before any function)

Create exactly the two WSF composite indexes, without touching GoArrive's index set:

```sh
gcloud firestore indexes composite create --project=goarrive --query-scope=collection \
  --collection-group=wsfContributions \
  --field-config=field-path=communityGroupId,order=ascending \
  --field-config=field-path=createdAt,order=descending
gcloud firestore indexes composite create --project=goarrive --query-scope=collection \
  --collection-group=wsfGoalMemberTotals \
  --field-config=field-path=userId,order=ascending \
  --field-config=field-path=updatedAt,order=descending
gcloud firestore indexes composite list --project=goarrive --format="value(name,state)" | sort > indexes-after.txt   # repeat until both are READY
```

**Never `firebase deploy --only firestore:indexes`.** It would also create any of `main`'s indexes that production lacks, and the pre-flight refuses it.

**Receipt:**
- the two new names, whose paths contain `collectionGroups/wsfContributions` and `collectionGroups/wsfGoalMemberTotals`, are READY;
- every line of `indexes-before.txt` is still present and READY.

## Step 3: mail secret and functions env

**The secret.** B3 shows versions 1 and 2 enabled, with v2 bound. Add a version **only** if the owner knows v2 is not the live Resend key for `westay.fit`:

```sh
read -rs WSF_KEY && printf %s "$WSF_KEY" | gcloud secrets versions add WSF_EMAIL_API_KEY --data-file=- --project=goarrive; unset WSF_KEY
gcloud secrets versions list WSF_EMAIL_API_KEY --project=goarrive        # receipt: version number + state only
```

The functions deploy pins whichever version `latest` resolves to at deploy time. Record that number.

**The env.** Write the non-secret functions env **in the candidate worktree only**. It is never committed, and the worktree is thrown away after the run:

```sh
cat > "$CAND/functions-westayfit/.env.goarrive" <<'ENV'
WSF_EMAIL_FROM="<the B3 value: the display-name noreply sender on westay.fit>"
WSF_APP_URL=https://app.westay.fit
ENV
```

- **Both lines are required.** `firebase-tools` replaces each function's whole env with this file.
- **Quote the sender.** It has spaces and angle brackets. Quoted and unquoted forms both parse, and quoting avoids surprises.
- **Never put a key here.** The pre-flight refuses any other key and checks `WSF_APP_URL` and the `westay.fit` sender, without printing a value.
- **`WSF_AUTH_ACTION_HANDLER`:** add it only if a real action-handler route exists. Otherwise the callables use `https://goarrive.firebaseapp.com/__/auth/action` (#599 2.3).

## Step 4: Auth (already done; nothing changes in this run)

- **`app.westay.fit`:** the owner added it on 2026-10-09 (#365 `6076170543`, step 9). Confirm it is still listed before step 6, with B2's console path.
- **Email/Password:** stays enabled.
- **Anonymous:** stays enabled, because GoArrive's share page uses it (see "Security review item" below).

None of these is a rollback item for this run.

## Step 5: the orphan `wsfListCommunityGoals` (a decision recorded before the run)

**What is known (#599 3, 6):**
- A does not export it; the canonical client calls `wsfListGoals`.
- Its source is in **no** commit, so deleting it **cannot be undone from repository source**.
- Its codebase label (B4d) decides what step 6 does with it:
  - **labelled `westayfit`:** step 6 lists it for deletion and aborts;
  - **unlabelled:** step 6 never sees it.

**Usage check.** Read-only; paste the count only:

```sh
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="wsflistcommunitygoals" AND logName="projects/goarrive/logs/run.googleapis.com%2Frequests"' \
  --project=goarrive --freshness=14d --limit=1000 --format="value(timestamp)" | wc -l
```

**The Director records one decision on #365 before the run:**
- **D1, delete.** This is **required** when B4d shows the `westayfit` label, and it is allowed only when the usage check counts **0** requests. Then no served client depends on the function, even if step 6 later stops. Run it interactively, and answer Yes only if the prompt lists exactly `wsfListCommunityGoals(us-central1)`:
  ```sh
  firebase functions:delete wsfListCommunityGoals --region us-central1 --project goarrive
  ```
  Deleting it also deletes its Cloud Run service and that service's IAM policy.
- **D2, keep.** This is possible only when it is unlabelled. It stays served on its old source, and it stays exposed to standing hazard H2 below.
- **If B4d shows the label and the count is not 0:** **stop and escalate.** A client still calls a function that A removes.

**Receipt:**
- the decision id;
- the 14-day request count;
- the label;
- deleted or kept.

## Step 6: functions, `westayfit` codebase only

Functions go before rules. If this step stops in its pre-checks (Node.js 20, the minimum bill), nothing has landed beyond the additive indexes, the local env file and the step-5 decision. The new functions write through the Admin SDK and do not depend on the new rules, and the Lovable flag stays off until step 9.

```sh
cd "$CAND"
npm --prefix functions-westayfit ci
PF --command "firebase deploy --only functions:westayfit --project goarrive --config firebase.westayfit.production.json --non-interactive" \
  && firebase deploy --only functions:westayfit --project goarrive --config firebase.westayfit.production.json --non-interactive
```

**If the run does not end cleanly:**
- **It aborts because it would delete functions:** production holds a `westayfit` function this candidate lacks. **Stop**: compare with `functions-before.txt` and step 5, and never re-run with `--force`.
- **It aborts with `Pass the --force option to deploy functions that increase the minimum bill`, and nothing else (S2):** no function was created or updated. Take S2's way through, the interactive form:
  ```sh
  PF --interactive-reason minimum-bill \
    --command "firebase deploy --only functions:westayfit --project goarrive --config firebase.westayfit.production.json" \
    && firebase deploy --only functions:westayfit --project goarrive --config firebase.westayfit.production.json
  ```
  - Answer **Yes** to `Would you like to proceed with deployment?` only when the warning above it lists exactly `wsfCheckIn(us-central1): 1 instances`.
  - At **any** other prompt, press **Ctrl-C**. A deletion prompt comes before any create, so nothing has changed. A cleanup-days prompt comes after every function is released; Ctrl-C there sets no policy.
- **It aborts on the Node.js 20 runtime (S1):** the deadline was missed. **Stop.** No function was created or updated.
- **A function fails at `set invoker`:** that function exists **without** `allUsers`, and a re-run will not repair it, because the update path never sets a callable's invoker. **Stop and escalate.** The repair is an owner decision, applied only to the failed services by name:
  ```sh
  gcloud run services add-iam-policy-binding <service> --region=us-central1 --project=goarrive --member=allUsers --role=roles/run.invoker
  ```
- **It ends with `Functions successfully deployed but could not set up cleanup policy` (S3):** every function was released, and only the cleanup step failed. This is expected only when the owner declined S3's opt-out; otherwise B11 should have caught it. **Do not roll back for this alone.** Record it, and prove the deploy in step 8, because that exit hides any per-function error summary.

## Step 7: Firestore rules (after the functions)

Re-read the live ruleset **immediately before** releasing, so that a GoArrive rules release since step 0 cannot slip through. If this step stops, the new functions stay live under the older WSF section, which serves the same three collections with a weaker membership check (#599 4.1). That is a consistent state to escalate from, not one to roll back in a hurry.

```sh
cd ~/wsf-prod && capture_rules live-firestore.rules && cmp -s live-firestore.rules live-firestore.rules.step0 \
  && echo "UNCHANGED since step 0" \
  || echo "STOP: the live ruleset changed since step 0, or the read failed. Do not run the next block; re-run step 1 and escalate."
```

Only after `UNCHANGED since step 0`:

```sh
cd "$CAND"
PF --command "firebase deploy --only firestore:rules --project goarrive --config firebase.westayfit.production.json --non-interactive" \
  && firebase deploy --only firestore:rules --project goarrive --config firebase.westayfit.production.json --non-interactive
```

**Receipt:**
- the prior ruleset name (step 0) and the new one;
- the new ruleset's source sha256, read back with `(cd ~/wsf-prod && capture_rules live-firestore.rules.after)`, equals `sha256sum "$CAND/firestore.rules"`. Run the capture from `~/wsf-prod`, never inside the worktree.

## Step 8: verification

1. **Functions.**
   - `gcloud functions list --project=goarrive` shows, among `wsf*`, exactly the 59 candidate names (plus the orphan under D2), all ACTIVE, updated in this run, in `us-central1`.
   - `gcloud functions list --project=goarrive --regions=us-central1 --filter="name~/functions/wsf" --format="yaml(name,labels)"` shows `firebase-functions-codebase: westayfit` on all 59.
   - Every non-`wsf` row of `functions-before.txt` is unchanged (name, region, update time).
2. **Revisions.** Every non-WSF row of `run-services-before.txt` names the same `latestReadyRevisionName` now, in every region.
3. **IAM.**
   - Every one of the 59 WSF services shows `roles/run.invoker` → `allUsers`. The 43 created by this run get exactly that binding, and the 16 kept keep their B5 policy.
   - A created WSF service **without** it is a failure: stop and report. **Never remove it** (rule 6).
   - Every non-WSF service's policy equals `run-iam-before.txt`.
4. **Rules.** The release names the new ruleset, and its source equals the candidate's `firestore.rules` (step 7 receipt).
5. **Indexes.** Both WSF indexes are READY, and every line of `indexes-before.txt` is still present and READY.
6. **Env.** Run `gcloud run services describe wsfsendverificationemail --region=us-central1 --project=goarrive --format="yaml(spec.template.spec.containers[0].env)"`. It must show `WSF_APP_URL=https://app.westay.fit` and a `WSF_EMAIL_FROM` entry; paste names only. The secret appears only as a Secret Manager reference.
7. **GoArrive regression** (#599 6):
   - a GoArrive coach, member and platformAdmin each sign in and load home;
   - a GoArrive share link still opens, which proves anonymous sign-in still works;
   - there was no Hosting deploy, and the `goarrive.web.app` release is unchanged;
   - a WSF account is refused by GoArrive's role guards.
8. **WSF smoke.** This creates no member account.
   - `wsfHealth` answers a signed-in operator account.
   - `wsfPreviewCommunity` answers a signed-out call with its uniform not-found.

## Step 9: the receipt to paste on #365

```text
WSF PRODUCTION DEPLOY RECEIPT (no tokens, no keys)
operator: <name>    utc start/end: <..>/<..>    firebase-tools: 15.30.1    before 2026-10-30: yes
candidate record: A    candidate sha: <40>    main sha compared: <40>
preflight: steps 1, 6, 7 ok=true (paste the JSON verdicts; step 6: non-interactive | interactive minimum-bill)
readbacks owed: B3b <verified yes/no>  B4c <n>  B4d <labels>  B11 <policy | opt-out>  (B4b, B5 captured)
indexes: wsfContributions READY, wsfGoalMemberTotals READY; every pre-run index still READY (yes/no)
secret WSF_EMAIL_API_KEY: version pinned <n>   env: WSF_EMAIL_FROM set, WSF_APP_URL=https://app.westay.fit
auth: app.westay.fit present (added 2026-10-09 by the owner, not by this run)
rules: prior <ruleset name> -> new <ruleset name>; new source sha256 = candidate (yes/no)
orphan wsfListCommunityGoals: decision <id>; 14-day requests <n>; label <..>; deleted | kept
functions: 59 wsf in us-central1, labelled westayfit; allUsers run.invoker on 59
goarrive: functions, revisions, service IAM, indexes unchanged (yes/no); coach/member/admin sign-in ok; share link ok; hosting untouched
consent: pending-approval-2026-08-25 (owner decision #365 6075884941)
```

L0 records this as the DEPLOYMENT RECEIPT. It is not acceptance, and it is not a hosted proof.

## Step 10: rollback, in reverse order of what landed

| Landed | Undo |
|---|---|
| Rules | Re-read the release first (`capture_rules`). If it names this run's ruleset, re-release the step-0 ruleset: console › Firestore › Rules › history › roll back to it, or update the `cloud.firestore` release to that `rulesetName`. If GoArrive released rules after this run, **stop and escalate**: re-releasing the step-0 ruleset would undo GoArrive's change too. |
| The 43 created functions | Delete them one at a time, interactively: `firebase functions:delete <name> --region us-central1 --project goarrive`. Answer Yes only when the prompt lists exactly that one name. Deleting a function also deletes its Cloud Run service and that service's IAM policy. Never delete a `default`-codebase function. |
| The 16 kept functions | Route each back to the revision in `run-services-before.txt`: `gcloud run services update-traffic <service> --region=us-central1 --project=goarrive --to-revisions=<revision>=100`. That revision carries its own env (the old `WSF_APP_URL`) and the secret version it pinned. **A source redeploy is not a rollback here:** no prior source exists in the repository, a smaller source aborts on deletion under `--non-interactive`, and any functions deploy fails after 2026-10-30. |
| The orphan, deleted under D1 (step 5) | **Not reversible** from repository source. |
| Secret version (only if step 3 added one) | Disable it **only after** no deployed revision pins it: `gcloud secrets versions disable <n> --secret=WSF_EMAIL_API_KEY --project=goarrive`. Compare the secret's IAM with `secret-iam-before.json`. Remove a `secretAccessor` binding only if this run added it **and** no WSF function still uses the secret. The binding is for the default compute account, which GoArrive's functions share. |
| Indexes | Leave them: they are additive and harmless. To remove them anyway: `gcloud firestore indexes composite delete <name> --project=goarrive`. |
| `app.westay.fit` | The Lovable owner keeps or re-publishes deployment `b4b9d8d1-ed6a-49a7-966d-af688c3a0d39` (fail-closed shell), with the production flag OFF. |

**Emergency off-switch (not a rollback):** removing `allUsers` from **all 59** WSF services makes WSF unreachable from the web and leaves GoArrive untouched.
- Removing it from a **subset** is never valid: it breaks every signed-in callable in that subset.
- A later `functions:westayfit` deploy will not restore it. Re-add it by hand before reopening, and record both changes.

**Not reversible** (#599 9):
- the deletion of `wsfListCommunityGoals`;
- member data and Auth accounts, once sign-up opens;
- consent records stamped with the pending version (owner decision);
- emails already sent;
- the time a drifted ruleset was live;
- any function a prune deleted;
- the side effects of `--force` (rule 4).

## Stop conditions (any one ends the run)

- Any pre-flight exit other than 0.
- The date reaching 2026-10-30, or a CLI that is not 15.30.1.
- Any readback or capture that differs from #599 or from step 0. Examples: a `wsf*` set other than the 17, or a ruleset that changed between step 0 and step 7.
- Any CLI prompt or message that mentions deletion, the minimum bill, a cleanup policy or `--force`. There are two exceptions:
  - the named single-function delete in step 5;
  - the reviewed S2 interactive form in step 6, and only its `wsfCheckIn` minimum-bill question.
- A `set invoker` failure.
- Any GoArrive function, revision, service IAM, index, rule or hosting release changing.
- A missing permission. Never widen IAM mid-run to make a step pass; escalate.

## Appendix: Web Twin production handoff (values by reference only)

**Evidence.** Read-only, verified on 2026-10-09 from:
- the Web Twin's own source: the Lovable project "WE Community Home", commit `c278e175b345b68f15c22124a0f291f24b92c905`;
- Lovable's documentation (below).

No value is reproduced here.

**What the Twin carries.**
- `src/wsf/production-public-config.ts` pins the six public web identifiers and `VITE_WSF_PROD_EXPECTED_PROJECT_ID`.
- The six are `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId` and `appId`.
- L0 confirmed they match `productionConfig` in `apps/westayfit/src/firebase.ts:79-86` at `ec162d17` (pinned config `c783f0b4`). The owner confirmed the appId (#599 1.3).
- They are public client identifiers, but they are still never pasted into a receipt or comment.

**How they reach the Firebase client.** `src/wsf/firebase-runtime-boundary.tsx:31` calls `withProductionPublicConfig(readBuildEnv())`. That builds the config in three layers, each overriding the one before (`production-public-config.ts:22-27`):
1. the pinned values;
2. any nonempty switch in `src/wsf/production-release-flags.ts`;
3. any **nonempty** `import.meta.env` value, which is Vite's build-time environment (`firebase-runtime.ts:42-43`).

Nothing reads the config at runtime. There is no paste screen, no project selector, and no storage or URL input.

**The fail-closed gate.** `productionGate` (`src/wsf/production-host.ts`) opens only when all of these hold:
- the hostname is exactly `app.westay.fit`;
- `VITE_WSF_PROD_RELEASE` is `"1"`;
- there is no emulator flag;
- all six values are present;
- `projectId` and `VITE_WSF_PROD_EXPECTED_PROJECT_ID` both equal the pinned `goarrive`;
- the authDomain, bucket, appId and apiKey shapes check out.

Otherwise the closed shell renders and makes zero Firebase calls. Sign-up additionally needs `VITE_WSF_SIGNUP_OPEN` set to `"1"` (`productionSignupOpen`). Both switches are `""` at that commit.

**Lovable exposes no build-time env screen for this.**
- The project has no `.env` file.
- Lovable's documentation (the Secrets page) says `VITE_*` values are build-time browser values that belong in the project's committed `.env` file, and that the Secrets manager refuses them.
- Lovable's separate "Build secrets" feature is Enterprise-only, and this workspace is on Pro.
- That documentation text was read from search results on 2026-10-09, not fetched directly: this session's DNS does not resolve `docs.lovable.dev`.

So turning the Twin on is **a scoped code change, not a settings entry**.

**The go.** This is an owner decision, taken after the step-9 receipt:
1. **Step 1, connected with sign-up closed.** One source change in the Twin sets `VITE_WSF_PROD_RELEASE: "1"` in `src/wsf/production-release-flags.ts`, then publishes once.
2. **Step 2.** A second change sets `VITE_WSF_SIGNUP_OPEN: "1"`, then publishes.

Each change also updates the Twin's own test that asserts both checked-in switches are unset. **Rollback:** set the switch back to `""` and republish, and the closed shell returns.

**Caveat:** any nonempty build-time `VITE_*` value would override the file, switches included. The go change keeps `.env` absent.

**What the Twin needs before step 1.** It comes from the step-9 receipt:
- **The member-callable names and their new revisions:** all 59. That includes the 11 Phase-1 journey callables: `wsfSendVerificationEmail`, `wsfSaveProfile`, `wsfPreviewCommunity`, `wsfJoinCommunity`, `wsfMyCommunities`, `wsfListGoals`, `wsfContribute`, `wsfMyContribution`, `wsfGoalPulse`, `wsfGoalRecentAdditions` and `wsfSendPasswordResetEmail`.
- **The Firestore rules release name.**
- **Both WSF indexes READY.**
- **An authorized-domain readback showing `app.westay.fit`.**

**The backend deploy reference is this runbook's WSF-scoped command only:** `--only functions:westayfit` with `--config firebase.westayfit.production.json`. It is never a bare `functions`, never `functions,firestore:rules,firestore:indexes`, and never `--force` against the shared `goarrive`.

**Readback rows.** All are read-only, and none prints a value:

| Row | Command or console path | Answer (#365 `6076170543`) |
|---|---|---|
| Email/Password provider | Console › Authentication › Sign-in method; or `curl -sSf --oauth2-bearer "$TOKEN" https://identitytoolkit.googleapis.com/admin/v2/projects/goarrive/config`, reading `.signIn.email` only | enabled, password required |
| Action / continue URL for `app.westay.fit` | WSF mints its links with continue URL `WSF_APP_URL`, which must be an authorized domain: Console › Authentication › Settings › Authorized domains. The project's custom action URL: Console › Authentication › Templates › any template › Customize action URL. | `app.westay.fit` is authorized. The custom action URL is GoArrive's `https://goarrive.web.app/reset-password`, unchanged, because WSF retargets its own links. |
| Web API key HTTP-referrer restrictions | Console › APIs & Services › Credentials › Browser key › Application restrictions; or `gcloud services api-keys list --project=goarrive --format="yaml(displayName,restrictions.browserKeyRestrictions)"`. Never print the key string. | none (`browserKeyRestrictions: {}`), so `app.westay.fit` is not excluded. Hardening is a later change. |

## Security review item: Anonymous sign-in

Anonymous sign-in is enabled on the shared project, and GoArrive's share page uses it (`apps/goarrive/app/share/[shareId].tsx:105`). **Never disable the provider for WSF.**

At `ec162d17`, the exposure is:
- **Five WSF entry points require a verified email:** `wsfCreateCommunity`, `wsfJoinCommunity`, `wsfJoinViaMarker`, `wsfCreateGoal` and `wsfCreateCombinedGoal`. An anonymous caller can therefore never become a member.
- **`wsfSendVerificationEmail` refuses a token with no email address** (`index.ts:541-544`), which an anonymous token never has. It returns early for an already-verified one.
- **37 signed-in callables check only `request.auth`.** Among them, `wsfSaveProfile` and the photo setters write one document per anonymous uid.

The remedy is a follow-on code change that refuses `request.auth.token.firebase.sign_in_provider === 'anonymous'` in WSF callables. It goes to the security seat. This runbook does not decide whether it gates the launch; the Director does.

## Owner note: two standing GoArrive hazards (not a step of this run)

**The mechanism.** A deployed function belongs to a codebase only through its `firebase-functions-codebase` label, and an unlabelled one counts as GoArrive's `default` (#599 6, `cloudfunctionsv2.js:449`). `main` carries none of the WSF backend. Its `firestore.rules` has no WSF section, and its `functions-westayfit` has one export.

- **H1 Rules.** A GoArrive deploy from `main` that includes `firestore:rules` replaces the shared ruleset with one that has no WSF section. WSF's direct client reads then fail closed.
- **H2 Functions.** A GoArrive functions deploy from `main` lists WSF functions for deletion. It aborts under `--non-interactive`, and deletes them under `--force` or a Yes.
  - A bare `--only functions` reaches the `westayfit`-labelled ones. After this run, that is 58 of the 59.
  - Any functions deploy from `main`, `--only functions:default` included, reaches the unlabelled ones: an orphan kept under D2.

**The mitigation is the owner's.** Two examples:
- holding GoArrive rules deploys until `main` carries the WSF section;
- naming `--only functions:default` for GoArrive functions deploys.

## Not covered here

- **Path B** (a `wsf-production` GitHub environment with Devin as the required reviewer, plus a scoped WIF pool and a reviewed workflow) is a follow-on packet, if chosen.
- **Hidden for Phase 1, and not deployed differently:**
  - the Event lifecycle (#595, not exported);
  - profile photos (deployed with A, not used by the Lovable Web Twin);
  - raffle/promotion (not exported);
  - admin/Champion management.
- This runbook changes no consent version, legal text, Lovable flag, DNS, or GoArrive file.
