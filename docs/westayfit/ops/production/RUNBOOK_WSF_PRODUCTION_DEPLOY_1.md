# RUNBOOK: WSF production deploy on `goarrive` (PRODUCTION-DEPLOY-PATH-1)

**Status: reviewed procedure. NOTHING in this file has been executed.**

**Authority:**
- **Queue:** #365 `6075293313` (owner authorization `6075062042` and `6075204369`).
- **Release:** `6075293540`.
- **Owner decisions:**
  - **Path A** (#365 `6075844761`): the owner runs this runbook with his own credentials.
  - **Launch on the pending consent version** (#365 `6075884941`).
  - **The anonymous-token gate** (#365, pending): the owner's option A deploys record A, and option B deploys record G ("Which candidate", below). This runbook does not choose.
- **Facts:** cited from the inventory, **PR #599 at head `80b603c7a9b28bbe005621500544ebe7c60868e6`**. That head carries the owner's production readbacks (#365 `6076170543`, receipted by L0 in `6076227694`). If a later review of #599 changes a fact, this runbook follows the reviewed inventory. One correction to #599 already applies: its §2.2 says the joins require a verified email, and they do not ("Security review item", below).
- **Corrections this revision answers:**
  - W4's finding #394 `6076291750`;
  - L0's corrections #365 `6076227694` and #497 `6076230776`;
  - L0's delta #497 `6076938217` and addendum `6077207763`, which carry W4's two optional nits from the #599 pass `6077136451`;
  - L0's addendum 2 #497 `6077565253` (items 8–11);
  - W3's finding #396 `6078906904`, and L0's delta #497 `6078945971`, which adds record G;
  - W9's own adversarial review against the pinned `firebase-tools` 15.30.1 and `firebase-functions` 4.9.0 sources.

**Who runs it:**
- **Operator:** Devin, or whoever holds production rights on `goarrive`, using **their own** credentials. No worker or L0 session holds a production credential, and none may use one.
- **What licenses a run:** two things, before any step past 1:
  1. the readbacks and captures of step 0;
  2. **L0's acceptance line on #365, naming one exact candidate SHA and its record** (A or G).

  This document alone does not.

**Deadline: the run must finish before 2026-10-30T00:00Z.** From then on, `firebase-tools` 15.30.1 refuses to deploy Node.js 20 functions, and both candidates pin Node 20 (#599 3, S1). After that date the only way forward is a new candidate record on a newer runtime, with its own review.

## Which candidate: the owner's A/B

| Owner's option (#365) | Record | Candidate SHA | What it is |
|---|---|---|---|
| **A:** launch now, the gate as a fast-follow packet | `A` | `ec162d17a0540e936741027f9b8f90dd372cfaf4` | the launch backend, **ungated**: an anonymous token can save a profile and join (see "Security review item") |
| **B:** launch gated | `G` | `e65bfee9eecb2370f602d09880da604709fba58a` | A plus ANON-GATE-1 (#601): exactly four paths over A, and an anonymous token is refused at all 42 signed-in callables (`wsfHealth`, which reads and writes nothing, is the one exemption) |

- **The operator types the record and the SHA from L0's acceptance line, never from this table.** The table only shows what each record admits. The pre-flight refuses any SHA that is not its record's anchor.
- **"Record B" is not the owner's option B.** Record B is the legal-consent record ("Candidate records", below), and it is off the launch path.

## What production holds today (#599, read back 2026-10-09)

- **Functions:** 17 `wsf*` functions, last updated 2026-09-15. Their source is **not** in this repository.
  - Either candidate updates 16 of them in place and creates 43.
  - **`wsfListCommunityGoals`** is not exported by either candidate (step 5).
- **Rules:** release `cloud.firestore` → ruleset `1e14eab9-a23f-437f-8418-918b9eaefe65` (2026-09-01), sha256 `c598fc3b…`, 1259 lines.
  - Outside its WSF section it equals `main`, so the candidate's rules leave GoArrive unchanged.
  - Inside it, the candidate differs from live in one hunk: `wsfIsGroupMember` also requires the membership row's `membershipStatus == 'active'`. That is strictly tighter, and readback B12 counts the rows it would exclude.
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
   - step 5.5's opt-out, if the owner chooses it;
   - the named, one-function deletes in steps 5 and 10.

   For each, the operator reads the prompt and confirms only what it names.
5. **Run the pre-flight before every `firebase deploy`, from the candidate worktree, passing that exact command line as `--command`.** A non-zero exit means stop.
   - Each deploy is chained behind its pre-flight with `&&`, so a refusal stops it even when a block is pasted whole.
   - Step 0 defines `firebase` as the pinned CLI, so the line the pre-flight checks is the line that runs.
   - The pre-flight refuses to vouch for a deploy run from any directory but the worktree it checked (`worktree.is-cwd`).
6. **Never remove `allUsers` from a WSF service, except by the owner's emergency off-switch** (step 10), which removes it from every WSF service at once.
   - With these versions, every callable is created public at the Cloud Run layer, whatever its source `invoker` says, and each handler's own auth check is the control (#599 3).
   - A browser's Firebase ID token is not a Cloud Run credential, so without `allUsers` no WSF callable is reachable from the web.
   - A redeploy never restores it.
7. **No secret, token, key or action link in any receipt.** Paste names, counts, states, times and SHAs only.
8. **One step at a time, with a receipt after each.** A failure stops the run. Do not retry blind: roll back what landed (step 10) and report.

## Candidate records

| | Record A | Record G | Record B |
|---|---|---|---|
| SHA | `ec162d17a0540e936741027f9b8f90dd372cfaf4` **exactly** (`claude/wsf-app-shell` before #601) | `e65bfee9eecb2370f602d09880da604709fba58a` **exactly** (`claude/wsf-app-shell`, the merge of #601 over A) | to be named: A plus **one** reviewed consent-version commit |
| Status | the owner's **option A** | the owner's **option B** | **off the launch path:** a future record |
| What deploys | backend only: `functions:westayfit` (59 exports), the WSF Firestore rules section, the 2 WSF composite indexes. 17 exports *declare* `invoker: 'public'` in source. That declaration is inert for `onCall`: all 59 receive `allUsers` when created. | the same 59 exports, the same 17 inert declarations, and a `firestore.rules` and `firestore.indexes.json` byte-equal to A's | the same; B changes no export, rule or index |
| Anonymous tokens | admitted wherever a token is enough ("Security review item") | refused at all 42 signed-in callables with `failed-precondition` / "Sign in with an email account."; treated as signed out at the 4 optional-uid sites | as A |
| Consent | `pending-approval-2026-08-25` in `functions-westayfit/src/index.ts:124-125` and `apps/westayfit/src/profileConstants.ts:1-2`. The owner decided to launch on it. The pre-flight reports `consentVersionPending: true`. | the same version as A, at `functions-westayfit/src/index.ts:126-127` and `apps/westayfit/src/profileConstants.ts:1-2` (`consentVersionPending: true`) | the approved version, equal in both files. The pre-flight refuses a pending, blank or placeholder version. |
| Sign-up | opens on the owner's go after the step-9 receipt (the Lovable flag). Every profile then records consent to the pending version, an owner-accepted risk. `wsfSaveProfile` is already served today from the older source. | the same as A | after legal review (PR #598) and L0's acceptance of B's exact SHA |
| Allowed diff from A | — | **exactly** `docs/westayfit/ops/security/ANON-GATE-1.md`, `functions-westayfit/src/anon-gate.ts`, `functions-westayfit/src/index.ts` and `functions-westayfit/tests/callable/wsf-anon-gate.test.ts` | the consent values in `index.ts` and `profileConstants.ts` (everything else byte-equal); `apps/westayfit/src/legalContent.ts`, `apps/westayfit/legal/terms.md` and `privacy.md`; and test files under `functions-westayfit/tests/` and `apps/westayfit/tests-e2e/` that change by the version string only |
| Pre-flight | `--record A` | `--record G` | `--record B` |

L0 accepts **one** of these by exact SHA. A candidate that needs anything beyond this table is a new candidate record and a new review, not an edit to this runbook. Two examples:
- the gate on top of record B;
- a `main` whose `firestore.rules` has changed outside the WSF section since `41bff6c6`.

## Toolchain stoppers, and the reviewed way through each (#599 3)

Each of these stops `firebase deploy --only functions:westayfit --non-interactive` without `--force`. Each was read in the pinned `firebase-tools` 15.30.1 source. Each has one reviewed way through, and **`--force` is never it**.

| Stopper | When it bites | The reviewed way through |
|---|---|---|
| **S1:** Node.js 20 decommission (`runtimes/supported/types.js:50-55`, `index.js:56-59`) | any functions deploy on or after 2026-10-30T00:00Z, including a deploy-based rollback | Finish before then. No flag gets past it. After that date, the way forward is a new candidate record that moves `functions-westayfit` to a newer runtime, reviewed as a source change. |
| **S2:** the minimum-bill prompt (`prepare.js:338`, `prompts.js:116-176`) | `wsfCheckIn` wants 1 warm instance on `goarrive`, and the live function keeps fewer, or keeps one at a lower cost (B4c) | Step 6 always runs the non-interactive command first. The prompt sits in the pre-checks, before anything is created, so a stop there changes nothing. Then, **if and only if** the only error is `Pass the --force option to deploy functions that increase the minimum bill`, pre-flight and run the **interactive form** (step 6). Answer **Yes** to `Would you like to proceed with deployment?` only when the warning above it lists exactly the one line `westayfit:wsfCheckIn(us-central1): 1 instances, <memory> of memory each`. Every label of the `westayfit` codebase carries that prefix (`deploy/functions/prompts.js:151-153`, `functionsDeployHelper.js:97-103`). At any other prompt, press **Ctrl-C**. The deletion prompt comes before any create (`release/index.js:55`), so nothing has changed at that point. |
| **S3:** the `gcf-artifacts` cleanup policy (`artifacts.js:121-161`, `prompts.js:179-190`) | B11 shows no cleanup policy and no `firebase-functions-cleanup-opted-out` label. The deploy then releases the functions, prints its per-function results, and **only then** stops at the cleanup step, exit 1. | **Step 5.5**, an owner decision recorded on #365: the owner's interactive opt-out, which adds only the opt-out label. **Never `--days`, never `--force`:** both set a policy that deletes container images older than N days (default 1) from the repository GoArrive's functions share. If the owner declines, step 6 runs as written and its cleanup-policy exit is expected; step 6 says how to read it. |

The fourth stop of this kind is the pending deletion of the orphan. Step 5 settles it before step 6, and never with `--force`.

## Step 0: readbacks and captures (read-only)

### 0.1 The shell

Run every step in **one** shell. If you open a new terminal, define `firebase` again and re-check its version. Every capture file lives in `~/wsf-prod`, outside any repository and outside the candidate worktree.

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

Run these from `~/wsf-prod`. Paste each answer on #365. "Gates" says which step a failing answer stops, and why.

| Readback | Exact read-only command or console path | A pass looks like | Gates |
|---|---|---|---|
| **B3b** Resend sending domain | Resend dashboard › Domains | `westay.fit` listed as **Verified** for sending | **Yes, step 6.** The mail callables send from `WSF_EMAIL_FROM`, and an unverified domain fails DMARC. |
| **B4b** revisions of the 16 kept services | taken by the 0.4 capture into `run-services-before.txt` | one `latestReadyRevisionName` per service, in every region | **Yes, step 6.** It is the functions rollback anchor. |
| **B4c** `wsfCheckIn` minimum instances | `gcloud functions describe wsfCheckIn --gen2 --region=us-central1 --project=goarrive --format="value(serviceConfig.minInstanceCount)"` | `1` | **No.** It predicts S2. With `1`, step 6's non-interactive form is expected to pass. Otherwise expect S2's way through. |
| **B4d** codebase labels of the 17 | taken by the 0.4 capture into `wsf-labels-before.txt` | each shows `firebase-functions-codebase: westayfit`, or none | **Yes, step 5.** The orphan's label decides whether D1 is required. |
| **B5** IAM of the 16 kept services | taken by the 0.4 capture into `run-iam-before.txt` | each kept WSF service lists `roles/run.invoker` → `allUsers` | **No.** A kept service without it is unreachable from the web today, and a redeploy will not add it. Raise it as an owner decision, and repair it by name only with `add-iam-policy-binding`. |
| **B8** Storage rules | Rules API release `projects/goarrive/releases/firebase.storage/goarrive.firebasestorage.app`, or Console › Storage › Rules | any. Recorded only. | **No.** No WSF step touches Storage. |
| **B9** Hosting and DNS | `firebase hosting:sites:list --project goarrive`, then `for N in westay.fit app.westay.fit; do echo "== $N"; dig +short NS "$N"; dig +short CNAME "$N"; dig +short A "$N"; done` | any. Recorded only. | **No.** There is no Hosting step, and Lovable serves `app.westay.fit`. |
| **B11** cleanup policy | `gcloud artifacts repositories describe gcf-artifacts --location=us-central1 --project=goarrive --format="yaml(cleanupPolicies,labels)"` | any cleanup policy, or the `firebase-functions-cleanup-opted-out` label | **Yes, step 6.** If neither is present, step 5.5 is an owner decision before step 6. |
| **B12** memberships the new rules would exclude | `wsf_memberships` (0.4); it prints counts only | `not active or no status: 0` | **Yes: it gates step 7, and it is settled before step 2.** The candidate's `wsfIsGroupMember` reads only rows with `membershipStatus == 'active'`. A non-zero count is that many live memberships whose holders would lose their direct reads of their group's documents, so **stop and escalate before step 2**, while nothing has landed. Rows either candidate writes always carry `'active'` (`index.ts:276` and `:908` at `ec162d17`; `:280` and `:913` at `e65bfee9`). |
| **B13** runtime service account of the two mail callables | for each of `wsfSendVerificationEmail` and `wsfSendPasswordResetEmail`: `gcloud functions describe <name> --gen2 --region=us-central1 --project=goarrive --format="value(serviceConfig.serviceAccountEmail)"`, then each account's project roles: `gcloud projects get-iam-policy goarrive --flatten="bindings[].members" --filter="bindings.members:serviceAccount:<email>" --format="value(bindings.role)"` | each account holds a role that carries `firebaseauth.users.sendEmail`. The conservative pass is one of `roles/owner`, `roles/editor` or `roles/firebaseauth.admin` (below). | **Yes, the receipt's mail line, not the deploy.** Without the permission, the deploy still lands. Then `wsfSendVerificationEmail` answers 500 (`internal`). `wsfSendPasswordResetEmail` answers its uniform `{accepted: true}` (200), sends nothing, and logs `[wsfSendPasswordResetEmail] Admin SDK failed <code>`. If it fails, step 5.6 is an owner decision before step 6. |

**B13, the permission behind the mail links.**
- **The calls.** `wsfSendVerificationEmail` mints its link with the Admin SDK's `generateEmailVerificationLink`, and `wsfSendPasswordResetEmail` with `generatePasswordResetLink`: `functions-westayfit/src/index.ts:567` and `:2445` at `ec162d17`, `:572` and `:2461` at `e65bfee9`. Both go to the Identity Toolkit endpoint `accounts:sendOobCode` (firebase-admin 12.7.0, `lib/auth/auth-api-request.js:659` and `:1358`).
- **What each answers when the permission is missing.**
  - Verification throws `internal`, "Could not send the verification email. Try again shortly." (`index.ts:571-578` at `ec162d17`).
  - Reset logs `[wsfSendPasswordResetEmail] Admin SDK failed <code>` and returns `resetFailed()`, which is `{ accepted: true }`, the same answer as for an unknown address. That is the anti-enumeration shape (`index.ts:2444-2469` and `:2525-2527` at `ec162d17`; `:2460-2485` and `:2541-2543` at `e65bfee9`).
  - **A reset's 200 proves nothing.** Only the inbox, or that log line, shows whether it sent.
- **The permission.** Google's Identity Platform access-control table maps that method (`GetOobCode`) to **`firebaseauth.users.sendEmail`**. Google's IAM reference lists it in `roles/firebaseauth.admin` (Firebase Authentication Admin), `roles/identitytoolkit.admin` and `roles/identityplatform.admin`, and Owner and Editor carry the Firebase Authentication permissions; `roles/firebaseauth.viewer` does not. Both pages were read through search results on 2026-10-09, because this session cannot resolve `docs.cloud.google.com`. A role not named here passes only if the console's IAM page shows it carries `firebaseauth.users.sendEmail`.
- **The account.**
  - Neither candidate sets a `serviceAccount` on any function, and firebase-functions 4.9.0 emits `serviceAccountEmail` only when one is set (`lib/v2/options.js:99`).
  - firebase-tools 15.30.1 writes `serviceConfig.serviceAccountEmail` into a function only when the source names one (`gcp/cloudfunctionsv2.js:180-182`). So an update keeps the function's existing account, and only the 43 functions this run creates get the project's default runtime account.
  - The two mail callables are among the 16 this run updates in place (#599 inventory, `R3_callables.againstCandidateA.keptUpdatedInPlace`), so they keep the account they run as today. Their source is in no commit, so nothing here says which account that is: **the readback decides**.
  - Step 8.10 re-reads the same two after the run.
- **Why staging failed and production may not.** Staging's `wsfSendVerificationEmail` answers 500 with `auth/insufficient-permission` from this call, because its runtime account holds no role carrying the permission (#365 `6083224272`). Organizations created on or after 2024-05-03 enforce `iam.automaticIamGrantsForDefaultServiceAccounts` by default, so their default service accounts no longer receive Editor when created. That says nothing about what `goarrive` holds: the readback decides.
- **Its limit.** The second command lists project-level bindings only. A role inherited from a folder or the organization does not appear. If no listed role passes, treat the permission as **ABSENT**, unless the console's IAM page for the account shows an inherited role that passes.

### 0.4 Captures

These are the anchors for regression and rollback.

```sh
cd ~/wsf-prod
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
capture_rules() {   # $1 = output file, written in the current directory
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
  echo "ruleset: $RULESET  sha256: $(sha256sum "$1" | cut -c1-64)  lines: $(wc -l < "$1")"
}
capture_rules live-firestore.rules.step0 && cp live-firestore.rules.step0 live-firestore.rules

# B12: counts of wsfMemberships rows, all and active. Prints numbers only, never a document.
wsf_count() {   # $1 = all | active
  local TOKEN Q
  TOKEN="$(gcloud auth print-access-token)" || { echo "STOP: no token" >&2; return 1; }
  Q='{"structuredAggregationQuery":{"structuredQuery":{"from":[{"collectionId":"wsfMemberships"}]'
  [ "$1" = active ] && Q="$Q"',"where":{"fieldFilter":{"field":{"fieldPath":"membershipStatus"},"op":"EQUAL","value":{"stringValue":"active"}}}'
  printf '%s},"aggregations":[{"alias":"n","count":{}}]}}' "$Q" \
    | curl -sSf --oauth2-bearer "$TOKEN" -H 'Content-Type: application/json' --data-binary @- \
        'https://firestore.googleapis.com/v1/projects/goarrive/databases/(default)/documents:runAggregationQuery' \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const n=JSON.parse(s)[0]?.result?.aggregateFields?.n?.integerValue;if(n===undefined){console.error("STOP: no count");process.exit(1)}console.log(n)})'
}
wsf_memberships() {
  local ALL ACTIVE
  ALL="$(wsf_count all)" && ACTIVE="$(wsf_count active)" \
    && echo "B12 wsfMemberships: total $ALL, active $ACTIVE, not active or no status: $((ALL - ACTIVE))"
}
wsf_memberships
```

The line `capture_rules` prints is the **rules rollback anchor**. Today it should read `projects/goarrive/rulesets/1e14eab9-a23f-437f-8418-918b9eaefe65`, sha256 `c598fc3b…`, 1259 lines.

### 0.5 Go only if all of these hold

- **Date and CLI:** the date is before 2026-10-30, and `firebase --version` printed `15.30.1`.
- **The live WSF set is still #599's 17** (`functions-before.txt`). If it is not, production has changed since the readback: **stop**.
- **B3b, B4b, B4d and B12 pass.**
- **B13 is recorded.** If it fails, the owner's step 5.6 decision is on #365. It does not stop the deploy.
- **B11 passes, or the owner has recorded step 5.5's decision on #365** (run the opt-out, or decline it).
- **B4c is recorded.** It predicts whether step 6 needs S2's interactive form.
- **The org policy still permits `allUsers`.** If it does not, no WSF callable is reachable from the web: **stop and escalate**.
- **L0's acceptance line on #365 names the record (A or G) and the 40-character SHA.**

## Step 1: checkout and pre-flight (no credential needed)

This needs `firebase.westayfit.production.json` and `.github/wsf-production/` on `main`, which means this packet must already be integrated.

Fill in the two values from L0's acceptance line. Left empty, the checkout fails and the pre-flight never runs. A record and SHA that do not belong together are refused by the pre-flight.

```sh
RECORD=''      # A or G, copied from L0's acceptance line on #365
CANDIDATE=''   # the 40-character SHA from the same line
cd ~/wsf-prod
git clone --branch main https://github.com/idevinsimpson/goarrive.git src
git -C src fetch origin claude/wsf-app-shell
MAIN="$(git -C src rev-parse HEAD)"   # record it: the pre-flight that runs is this main's, and it compares against this main
CAND=~/wsf-prod/candidate
git -C src worktree add --detach "$CAND" "$CANDIDATE"
git -C src show "$MAIN":firebase.westayfit.production.json > "$CAND/firebase.westayfit.production.json"
PF() { node ~/wsf-prod/src/.github/wsf-production/preflight.mjs --repo ~/wsf-prod/src --record "$RECORD" \
  --candidate "$CANDIDATE" --main "$MAIN" --config "$CAND/firebase.westayfit.production.json" \
  --worktree "$CAND" --live-rules ~/wsf-prod/live-firestore.rules "$@"; }
cd "$CAND" && PF
```

- **Exit 0 and `"ok": true`:** continue. Paste the verdict. It is JSON, prints no env value, and holds no secret.
- **Exit 1:** a check refused. Do not continue. The `checks[].detail` lines name what.
- **Exit 2:** the inputs were unusable: an empty or unknown record, a SHA that is not fetched, an unreadable or malformed file, or an empty live ruleset. Its `usage` line says which. Fix the inputs, then re-run.

**Check these values in the verdict, for either record:**

| Field | Expected |
|---|---|
| `record`, `candidate` | what L0's acceptance line names |
| `consentVersionPending` | `true` |
| `rulesHashes.candidate` | `sha256` `58ef038e065c2e483866045551cf1669eb3f55675a4a3abf5f33c6503e195209`, `lines` 1261 |
| `rulesHashes.candidate.outsideWsfSha256` and `rulesHashes.main.sha256` | both `f261a8af80d9e3a45c2c0b1f1736759459ce3e2f1dc9b0785f2c6b7909f1b8d8` |
| `rulesHashes.live` | `sha256` `c598fc3b…` and `lines` 1259 today; `outsideWsfSha256` `f261a8af…` |

`outsideWsfSha256` is the hash of the file without its WSF section. For the candidate it equals `git show "$CANDIDATE":firestore.rules | sed '1197,1256d' | sha256sum`.

**`rules.live-outside-wsf-equals-main` refused** means the live GoArrive rules are not `main`'s. Its detail names the first differing line. **Stop and escalate** before step 2: deploying `firestore.rules` would change GoArrive's rules.

The pre-flight also checks:
- that the worktree is at the candidate, with nothing added but the config and, from step 3, the env file. Ignored files count too, except `functions-westayfit/node_modules/` and `functions-westayfit/lib/`;
- that the config equals `main`'s reviewed file, predeploy included;
- for record G, that the candidate descends from A and changes exactly the four gate paths.

## Step 2: indexes (additive, WSF-only, before any function)

Create exactly the two WSF composite indexes, without touching GoArrive's index set:

```sh
cd ~/wsf-prod
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
- **Never put a key here, and write no other env file.** `firebase-tools` loads `functions-westayfit/.env` before `.env.goarrive`. The pre-flight refuses any such file, ignored or not, and any key but the reviewed ones. It checks `WSF_APP_URL` and the `westay.fit` sender without printing a value.
- **`WSF_AUTH_ACTION_HANDLER`:** leave it unset. The callables then use `https://goarrive.firebaseapp.com/__/auth/action` (#599 2.3). If it is set at all, the pre-flight accepts only that exact value, because the action links go to it.
- **One plain `KEY=value` per line,** as above: no key twice, no `export`, no trailing comment, and no quote left open across lines. The pre-flight also reads the file with `firebase-tools` 15.30.1's own parser and refuses it unless both readings agree, so no multi-line or escaped value can carry a different handler or URL past it.

## Step 4: Auth (already done; nothing changes in this run)

- **`app.westay.fit`:** the owner added it on 2026-10-09 (#365 `6076170543`, step 9). Confirm it is still listed before step 6: Console › Authentication › Settings › Authorized domains.
- **Email/Password:** stays enabled. Confirm it in the console only: Console › Authentication › Sign-in method. **There is no command for this readback.** The project config response also carries the password-hash signer key and the browser key.
- **Anonymous:** stays enabled, because GoArrive's share page uses it (see "Security review item" below).

None of these is a rollback item for this run.

## Step 5: the orphan `wsfListCommunityGoals` (a decision recorded before the run)

**What is known (#599 3, 6):**
- Neither candidate exports it; the canonical client calls `wsfListGoals`.
- Its source is in **no** commit, so deleting it **cannot be undone from repository source**.

**Read its codebase label first.** It decides what step 6 does with it:

```sh
gcloud functions describe wsfListCommunityGoals --region us-central1 --project goarrive --format='value(labels)'
```

- **`firebase-functions-codebase=westayfit`:** step 6 lists it for deletion and aborts under `--non-interactive`, before any change (`prompts.js:62-71`). D1 is then required.
- **Any other label, or none:** step 6 never sees it, and it is kept silently.

**Usage check.** Read-only; paste the count only:

```sh
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="wsflistcommunitygoals" AND logName="projects/goarrive/logs/run.googleapis.com%2Frequests"' \
  --project=goarrive --freshness=14d --limit=1000 --format="value(timestamp)" | wc -l
```

**The Director records one decision on #365 before the run:**
- **D1, delete.** This is **required** when the label is `westayfit`, and it is allowed only when the usage check counts **0** requests, so nothing hosted calls it. Then no served client depends on the function, even if step 6 later stops. Run it interactively, with no `--force`, and answer Yes to `Are you sure?` only if the prompt (`You are about to delete the following Cloud Functions:`, `deploy/functions/delete.js:50-60`) lists exactly one function, with no `The following managed service accounts will also be deleted` block:
  - `westayfit:wsfListCommunityGoals(us-central1)` when its label is `westayfit`, the case that requires D1;
  - `wsfListCommunityGoals(us-central1)`, with no prefix, when it has no codebase label, because an unlabelled function counts as `default` (`functionsDeployHelper.js:97-103`, `gcp/cloudfunctionsv2.js:449`).

  Success prints `functions[<that label>] Successful delete operation.` (`release/fabricator.js:902`).
  ```sh
  firebase functions:delete wsfListCommunityGoals --region us-central1 --project goarrive
  ```
  Deleting it also deletes its Cloud Run service and that service's IAM policy.
- **D2, keep.** This is possible only when it is not labelled `westayfit`. It stays served on its old source, and it stays exposed to standing hazard H2 below.
- **If the label is `westayfit` and the count is not 0:** **stop and escalate.** A client still calls a function that the candidate removes.

**Receipt:**
- the decision id;
- the 14-day request count;
- the label;
- deleted or kept.

## Step 5.5: the `gcf-artifacts` cleanup policy (S3; only when B11 shows neither a policy nor the opt-out label)

This is an **owner decision recorded on #365**, and one of the two owner writes to a shared resource before step 6; step 5.6's grant is the other. It never runs in step 0.

- **Opt out.** The owner runs it interactively:
  ```sh
  firebase functions:artifacts:setpolicy --location us-central1 --none --project goarrive
  ```
  - It adds only the label `firebase-functions-cleanup-opted-out: "true"` to the shared repository, and deletes no image.
  - Answer Yes to `Do you want to continue?` only when no line above it says `This will remove the existing cleanup policy`. If one does, B11 was wrong: answer No and stop.
  - **Never `--days`, never `--force`.**
  - Re-run B11 and paste the labels.
- **Decline.** Nothing runs here. Step 6 then ends with the cleanup-policy exit, which step 6 explains.

**Receipt:** the decision id, and the B11 labels after (opt-out) or "declined".

## Step 5.6: the mail links' permission (B13; only when B13 shows no role carrying `firebaseauth.users.sendEmail`)

This is an **owner decision recorded on #365 before step 6**, like step 5.5. It never runs in step 0, and it is decided before the run, not to make a failing step pass mid-run.

- **Grant it, by name, this one binding only:**
  ```sh
  gcloud projects add-iam-policy-binding goarrive --member="serviceAccount:<email>" --role=roles/firebaseauth.admin --condition=None
  ```
  - `<email>` is each account B13 printed. The two callables may share one. No other member and no other role.
  - **The account is shared.** If it is the default compute account, GoArrive's functions run as it too (see the secret's rollback row), so they also gain full Firebase Authentication rights. That is why this is the owner's decision and not a step.
  - **The minimal alternative, as the owner's option:** a project custom role holding only `firebaseauth.users.sendEmail`, bound the same way in place of `roles/firebaseauth.admin`. That is the staging handoff's PROMPT 5b (`idevinsimpson/westayfit` `78156f4`, cited from L0's delta #497 `6084980782` and not read here). The default compute account is shared with GoArrive's functions either way, so either grant reaches them too.
  - Re-run B13's second command and paste the roles.
- **Or proceed with mail known-broken.**
  - Sign-up continues under the unverified-participation policy: the joins do not test `email_verified` (`JOIN_REQUIRES_EMAIL_VERIFIED = false`, `index.ts:656` at `ec162d17`).
  - Until the grant lands, `wsfSendVerificationEmail` answers 500 (`internal`), so nobody new can verify an address. The three creator callables require a verified email, so they refuse every new account.
  - `wsfSendPasswordResetEmail` answers `{accepted: true}` and sends nothing. Nobody can reset a password, and nothing on the screen says so.
  - Step 8.9's first journey step, "receives the verification email", is then expected to fail.

**Receipt:** the decision id, and either the roles after the grant or "proceeding with mail known-broken".

## Step 6: functions, `westayfit` codebase only

Functions go before rules. If this step stops in its pre-checks (Node.js 20, the minimum bill, a deletion), nothing has landed beyond the additive indexes, the local env file and the decisions of steps 5, 5.5 and 5.6. The new functions write through the Admin SDK and do not depend on the new rules, and the Lovable flag stays off until step 9.

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
  cd "$CAND" && PF --interactive-reason minimum-bill \
    --command "firebase deploy --only functions:westayfit --project goarrive --config firebase.westayfit.production.json" \
    && firebase deploy --only functions:westayfit --project goarrive --config firebase.westayfit.production.json
  ```
  - Answer **Yes** to `Would you like to proceed with deployment?` only when the warning above it lists exactly the one line `westayfit:wsfCheckIn(us-central1): 1 instances, <memory> of memory each` (`deploy/functions/prompts.js:151-153`).
  - At **any** other prompt, press **Ctrl-C**. A deletion prompt comes before any create, so nothing has changed. A cleanup-days prompt comes after the functions are released; Ctrl-C there sets no policy.
- **It aborts on the Node.js 20 runtime (S1):** the deadline was missed. **Stop.** No function was created or updated.
- **A function fails at `set invoker`:** that function exists **without** `allUsers`, and a re-run will not repair it, because the update path never sets a callable's invoker. **Stop and escalate.** The repair is an owner decision, applied only to the failed services by name:
  ```sh
  gcloud run services add-iam-policy-binding <service> --region=us-central1 --project=goarrive --member=allUsers --role=roles/run.invoker
  ```
- **It ends with `Functions successfully deployed but could not set up cleanup policy` (S3, exit 1):** expected only when the owner declined step 5.5. Despite its words, **this exit does not prove that every function landed.**
  - The CLI prints its per-function results and errors first (`release/index.js:91`), and only then reaches the cleanup step (`:100`).
  - Stopping there, it never reaches its own `There was an error deploying functions` exit (`:117`).
  - So read the per-function lines above it: any `Failed` line is a failed deploy, and stops the run. Then prove every function in step 8. **Do not roll back for the cleanup exit alone.**
- **Any exit 2** (for example `There was an error deploying functions`) leaves `firebase-debug.log` in the worktree. The pre-flight then refuses the worktree, which is right, because the run has stopped. Keep the log local. It can hold request detail, so never paste it.

## Step 7: Firestore rules (after the functions)

Re-read the live ruleset **immediately before** releasing, so that a GoArrive rules release since step 0 cannot slip through. The re-read, the comparison, the pre-flight and the deploy are **one chain**: when any link fails, nothing after it runs.

If this step stops, the new functions stay live under the older WSF section, which serves the same three collections with a weaker membership check (#599 4.1). That is a consistent state to escalate from, not one to roll back in a hurry.

```sh
cd ~/wsf-prod && capture_rules live-firestore.rules \
  && cmp -s live-firestore.rules live-firestore.rules.step0 && echo "UNCHANGED since step 0" \
  && cd "$CAND" \
  && PF --command "firebase deploy --only firestore:rules --project goarrive --config firebase.westayfit.production.json --non-interactive" \
  && firebase deploy --only firestore:rules --project goarrive --config firebase.westayfit.production.json --non-interactive \
  || echo "STOP: the re-read failed, the live ruleset changed since step 0, the pre-flight refused, or the deploy failed. Escalate."
```

- **Only `--only firestore:rules`.** Never `--only firestore`: that would also push the candidate's 52-entry `firestore.indexes.json`. The pre-flight refuses it.
- **The pre-flight verdict** prints the hashes of step 1's table again. Check them before reading on.

**Receipt:**
- the prior ruleset name (step 0) and the new one;
- the new ruleset's source, read back from `~/wsf-prod` and never inside the worktree: `cd ~/wsf-prod && capture_rules live-firestore.rules.after` prints sha256 `58ef038e065c2e48…` and 1261 lines, the candidate's.

## Step 8: verification

Run every capture from `~/wsf-prod`.

1. **Functions, with their revisions and update times.** These two files are the receipt's function table, and the Web Twin's answer input:
   ```sh
   cd ~/wsf-prod
   gcloud functions list --project=goarrive --regions=us-central1 --filter="name~/functions/wsf" \
     --format="table[no-heading](name.basename(),state,updateTime,labels.firebase-functions-codebase)" | sort > wsf-functions-after.txt
   gcloud run services list --project=goarrive --region=us-central1 --filter="metadata.name~^wsf" \
     --format="table[no-heading](metadata.name,status.latestReadyRevisionName)" | sort > wsf-run-after.txt
   wc -l < wsf-functions-after.txt; wc -l < wsf-run-after.txt
   gcloud functions list --project=goarrive --format="table(name,state,updateTime)" > functions-after.txt
   ```
   - Both files have **59** rows, or 60 with the orphan kept under D2.
   - Every candidate name is ACTIVE, labelled `westayfit`, and updated in this run.
   - Every non-`wsf` row of `functions-before.txt` is unchanged in `functions-after.txt` (name, region, update time).
2. **Revisions, and the post-deploy IAM capture.** Into new files, never over the step-0 ones:
   ```sh
   cd ~/wsf-prod
   : > run-services-after.txt; : > run-iam-after.txt
   for R in us-central1 us-east1; do
     gcloud run services list --project=goarrive --region="$R" --format="table[no-heading](metadata.name,status.latestReadyRevisionName)" >> run-services-after.txt
     for S in $(gcloud run services list --project=goarrive --region="$R" --format="value(metadata.name)"); do
       echo "== $R $S" >> run-iam-after.txt
       gcloud run services get-iam-policy "$S" --region="$R" --project=goarrive --format=json >> run-iam-after.txt
     done
   done
   ```
   - Every non-WSF row of `run-services-before.txt` names the same `latestReadyRevisionName` in `run-services-after.txt`.
   - `diff run-iam-before.txt run-iam-after.txt` differs only inside `== <region> wsf…` blocks.
3. **The invoker on every WSF service:**
   ```sh
   cd ~/wsf-prod
   for S in $(gcloud run services list --project=goarrive --region=us-central1 --filter="metadata.name~^wsf" --format="value(metadata.name)"); do
     gcloud run services get-iam-policy "$S" --region=us-central1 --project=goarrive --flatten="bindings[].members" \
       --filter="bindings.role=roles/run.invoker AND bindings.members=allUsers" --format="value(bindings.members)" | grep -qx allUsers \
       && echo "ok $S" || echo "MISSING $S"
   done | sort > wsf-invoker-after.txt
   grep -c '^ok ' wsf-invoker-after.txt; grep '^MISSING' wsf-invoker-after.txt
   ```
   - **59 `ok`** (60 with the orphan under D2), and no `MISSING`.
   - The 43 created by this run get exactly that binding, and the 16 updated keep their B5 policy.
   - A created WSF service that is `MISSING` is a failure: stop and report. **Never remove `allUsers`** (rule 6).
4. **Rules.** The release names the new ruleset, and its source reads back as sha256 `58ef038e…`, 1261 lines (step 7 receipt).
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
9. **The post-go journey on `app.westay.fit`** (the former step 7.6, aligned to the candidate). It runs **after** the step-9 receipt and the owner's go, in the order of the appendix "The go". It is not a deploy step, and nothing here changes the backend.
   - **Which backend it proves:** the candidate the receipt names, `ec162d17` (record A) or `e65bfee9` (record G). Both serve the same journey. Under A, the anonymous exposure stays open until the gate's fast-follow lands.
   - **Twin step 1 (connected, sign-up closed).** Signed out, open an approved community link: the preview loads, and the Twin offers no sign-up, because `productionSignupOpen` is closed.
   - **Twin step 2 (sign-up open): a two-account journey,** in two separate browsers, each with its own real, owner-controlled address:
     1. Account 1 signs up and receives the verification email.
     2. Account 1 saves its profile and joins by the approved link.
     3. Account 1 records one manual MOVE and gets one confirmed receipt.
     4. Account 2 signs up, saves its profile and joins by the same link, and then sees the same Living WE total.
     5. A third account, signed in but not joined, is refused the member view.
   - **Mail.** Journey step 1's verification email is the proof of B13.
     - Under step 5.6's known-broken decision it does not arrive, and `wsfSendVerificationEmail` answers 500.
     - If anyone requests a password reset, its `{accepted: true}` proves nothing: only the inbox, or the log line `[wsfSendPasswordResetEmail] Admin SDK failed <code>`, shows whether it sent.
   - **First-call smoke, in the browser's network panel, on the first call of each after the go:** `wsfListGoals`, `wsfCommunityMembers`, `wsfCommunityActivity` and `wsfSetCommunityVisibility` (a member's own name and activity visibility in the community: set it, then set it back). Each answers **200** with the callable's own result. A `403` before the handler runs means the service lacks `allUsers`; a CORS failure means the same. Either one: stop and report. Never "fix" it by removing anything.
   - **Receipt:** a second block on #365, `WSF POST-GO JOURNEY`: each step's pass or fail, and the four calls' status codes. No address, uid, link or token.
10. **The mail links' permission** (B13 again; run with items 1–8, before the go). The two mail callables are **kept** functions: this run updated them in place, and an update keeps their account. Read both:
    ```sh
    for F in wsfSendVerificationEmail wsfSendPasswordResetEmail; do
      echo "$F $(gcloud functions describe "$F" --gen2 --region=us-central1 --project=goarrive --format='value(serviceConfig.serviceAccountEmail)')"
    done
    ```
    - Each is the account B13 read for it. If they differ, the receipt's mail line names each.
    - Either each account's roles (B13's second command) still carry `firebaseauth.users.sendEmail`, or the owner's step 5.6 decision to proceed with mail known-broken is on #365.
    - **The live proof is the verification email in step 8.9, or `wsfSendVerificationEmail`'s 500 when it is missing.** The reset callable's status is never proof: it answers `{accepted: true}` whatever happens.

## Step 9: the receipt to paste on #365

```text
WSF PRODUCTION DEPLOY RECEIPT (no tokens, no keys)
operator: <name>    utc start/end: <..>/<..>    firebase-tools: 15.30.1    before 2026-10-30: yes
L0 acceptance: #365 <comment id>    record: A | G    candidate sha: <40>    main sha compared: <40>
preflight: steps 1, 6, 7 ok=true (paste the JSON verdicts; step 6: non-interactive | interactive minimum-bill)
rules hashes (verdict): candidate 58ef038e… / 1261 lines; outside-WSF = main f261a8af… (yes/no); live before <sha256 prefix> / <lines>
readbacks owed: B3b <verified yes/no>  B4c <n>  B4d <labels>  B11 <policy | opt-out>  B12 <total/active/other>  B13 <pass | ABSENT>  (B4b, B5 captured)
indexes: wsfContributions READY, wsfGoalMemberTotals READY; every pre-run index still READY (yes/no)
secret WSF_EMAIL_API_KEY: version pinned <n>   env: WSF_EMAIL_FROM set, WSF_APP_URL=https://app.westay.fit
auth: app.westay.fit present (added 2026-10-09 by the owner, not by this run); Email/Password enabled (console)
rules: prior <ruleset name> -> new <ruleset name>; new source sha256 58ef038e… / 1261 lines (yes/no)
orphan wsfListCommunityGoals: decision <id>; 14-day requests <n>; label <..>; deleted | kept
cleanup policy (S3): already set | opted out by decision <id> | declined (cleanup exit seen, per-function lines all ok)
functions: <n> wsf in us-central1, ACTIVE, labelled westayfit; invoker ok <n> / MISSING 0
functions table (name, state, updateTime, codebase): paste wsf-functions-after.txt
revisions (service, latestReadyRevisionName): paste wsf-run-after.txt
goarrive: functions, revisions, service IAM, indexes unchanged (yes/no); coach/member/admin sign-in ok; share link ok; hosting untouched
consent: pending-approval-2026-08-25 (owner decision #365 6075884941)
mail: runtime SA <email>, roles <list>, verification-link permission present|ABSENT (owner decision <comment id>)
anonymous tokens: refused at 42 callables (record G) | admitted until the gate's fast-follow (record A)
```

L0 records this as the DEPLOYMENT RECEIPT. It is not acceptance, and it is not a hosted proof.

## Step 10: rollback, in reverse order of what landed

| Landed | Undo |
|---|---|
| Rules | Re-read the release first (`cd ~/wsf-prod && capture_rules live-firestore.rules.now`). If it names this run's ruleset, re-release the step-0 ruleset: console › Firestore › Rules › history › roll back to it, or update the `cloud.firestore` release to that `rulesetName`. If GoArrive released rules after this run, **stop and escalate**: re-releasing the step-0 ruleset would undo GoArrive's change too. |
| The 43 created functions | Delete them one at a time, interactively: `firebase functions:delete <name> --region us-central1 --project goarrive`. Answer Yes only when the prompt lists exactly that one name. Deleting a function also deletes its Cloud Run service and that service's IAM policy. Never delete a `default`-codebase function. |
| The 16 kept functions | Route each back to the revision in `run-services-before.txt`: `gcloud run services update-traffic <service> --region=us-central1 --project=goarrive --to-revisions=<revision>=100`. That revision carries its own env (the old `WSF_APP_URL`) and the secret version it pinned. **A source redeploy is not a rollback here:** no prior source exists in the repository, a smaller source aborts on deletion under `--non-interactive`, and any functions deploy fails after 2026-10-30. |
| The mail links' role (step 5.6, only if this run granted it) | An owner decision: `gcloud projects remove-iam-policy-binding goarrive --member="serviceAccount:<email>" --role=roles/firebaseauth.admin --condition=None`. Remove it only if B13 showed the account without that role before the run. Mail then fails again: verification answers 500, and reset answers `{accepted: true}` and sends nothing. |
| The S3 opt-out label (step 5.5) | Usually leave it: it only stops `firebase-tools` from offering a cleanup policy, and it deletes nothing. To restore the step-0 state anyway, an owner decision: `gcloud artifacts repositories update gcf-artifacts --location=us-central1 --project=goarrive --remove-labels=firebase-functions-cleanup-opted-out`. |
| The orphan, deleted under D1 (step 5) | **Not reversible** from repository source. |
| Secret version (only if step 3 added one) | Disable it **only after** no deployed revision pins it: `gcloud secrets versions disable <n> --secret=WSF_EMAIL_API_KEY --project=goarrive`. Compare the secret's IAM with `secret-iam-before.json`. Remove a `secretAccessor` binding only if this run added it **and** no WSF function still uses the secret. The binding is for the default compute account, which GoArrive's functions share. |
| Indexes | Leave them: they are additive and harmless. To remove them anyway: `gcloud firestore indexes composite delete <name> --project=goarrive`. |
| `app.westay.fit` | The Lovable owner keeps or re-publishes deployment `b4b9d8d1-ed6a-49a7-966d-af688c3a0d39` (fail-closed shell), with the production flag OFF. |

**Emergency off-switch (not a rollback; the one exception to rule 6).**
- **Authority:** the owner alone, recorded on #365 with its reason: before it runs, or right after when the harm is live. No worker, L0 session or operator acting for the owner decides it.
- **The first lever is the Web Twin's release switch** (appendix rollback). It stops the web app's calls, but not a caller that goes straight to the callables.
- **The off-switch** removes `allUsers` from **every** WSF service at once. WSF is then unreachable from the web, and GoArrive is untouched:
  ```sh
  cd ~/wsf-prod
  for S in $(gcloud run services list --project=goarrive --region=us-central1 --filter="metadata.name~^wsf" --format="value(metadata.name)"); do
    gcloud run services remove-iam-policy-binding "$S" --region=us-central1 --project=goarrive --member=allUsers --role=roles/run.invoker
  done
  ```
- **All or none.** Removing it from a **subset** is never valid: it breaks every signed-in callable in that subset.
- **Reopening** is the same loop with `add-iam-policy-binding`, again by the owner and recorded. A later `functions:westayfit` deploy will not restore it.

**Not reversible** (#599 9):
- the deletion of `wsfListCommunityGoals`;
- member data and Auth accounts, once sign-up opens;
- consent records stamped with the pending version (owner decision);
- under record A, any profile or membership an anonymous token created before the gate lands;
- emails already sent;
- the time a drifted ruleset was live;
- any function a prune deleted;
- the side effects of `--force` (rule 4).

## Stop conditions (any one ends the run)

- Any pre-flight exit other than 0.
- The date reaching 2026-10-30, or a CLI that is not 15.30.1.
- Any readback or capture that differs from #599 or from step 0. Examples:
  - a `wsf*` set other than the 17;
  - a ruleset that changed between step 0 and step 7;
  - a B12 count other than 0.
- Any CLI prompt or message that mentions deletion, the minimum bill, a cleanup policy or `--force`, except the four this runbook names and reads:
  - the named single-function delete in step 5;
  - step 5.5's opt-out prompt, by the owner's decision;
  - step 6's non-interactive minimum-bill abort, when `Pass the --force option to deploy functions that increase the minimum bill` is its only error. It leads only to S2's interactive form, and that form's one `wsfCheckIn` minimum-bill question;
  - step 6's cleanup-policy exit (`Functions successfully deployed but could not set up cleanup policy … Pass the --force option …`), only when the owner declined step 5.5 and no per-function line above it says `Failed`. Read it as step 6 says, then continue to step 7.
- A `set invoker` failure, a `Failed` per-function line, or a `MISSING` invoker in step 8.
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
- L0 confirmed they match `productionConfig` in `apps/westayfit/src/firebase.ts:79-86` at `ec162d17` (pinned config `c783f0b4`). Record G does not change that file. The owner confirmed the appId (#599 1.3).
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

Each change also updates the Twin's own test that asserts both checked-in switches are unset. Step 8.9's journey follows each one. **Rollback:** set the switch back to `""` and republish, and the closed shell returns.

**Caveat:** any nonempty build-time `VITE_*` value would override the file, switches included. The go change keeps `.env` absent.

**What the Twin needs before step 1.** It all comes from the step-9 receipt:
- **The callable names, with their new revisions and update times:** all 59, from the receipt's `wsf-functions-after.txt` and `wsf-run-after.txt`. That includes the 11 Phase-1 journey callables: `wsfSendVerificationEmail`, `wsfSaveProfile`, `wsfPreviewCommunity`, `wsfJoinCommunity`, `wsfMyCommunities`, `wsfListGoals`, `wsfContribute`, `wsfMyContribution`, `wsfGoalPulse`, `wsfGoalRecentAdditions` and `wsfSendPasswordResetEmail`.
- **The record and SHA deployed**, A or G, because under G an anonymous session gets "Sign in with an email account." from all 42 signed-in callables.
- **The Firestore rules release name.**
- **Both WSF indexes READY.**
- **An authorized-domain readback showing `app.westay.fit`.**

**The backend deploy reference is this runbook's WSF-scoped command only:** `--only functions:westayfit` with `--config firebase.westayfit.production.json`. It is never a bare `functions`, never `functions,firestore:rules,firestore:indexes`, and never `--force` against the shared `goarrive`.

**Readback rows.** All are read-only, and none prints a value:

| Row | Command or console path | Answer (#365 `6076170543`) |
|---|---|---|
| Email/Password provider | **Console only:** Authentication › Sign-in method. No command: the project config response also carries the password-hash signer key and the browser key. | enabled, password required |
| Action / continue URL for `app.westay.fit` | WSF mints its links with continue URL `WSF_APP_URL`, which must be an authorized domain: Console › Authentication › Settings › Authorized domains. The project's custom action URL: Console › Authentication › Templates › any template › Customize action URL. | `app.westay.fit` is authorized. The custom action URL is GoArrive's `https://goarrive.web.app/reset-password`, unchanged, because WSF retargets its own links. |
| Web API key HTTP-referrer restrictions | Console › APIs & Services › Credentials › Browser key › Application restrictions; or `gcloud services api-keys list --project=goarrive --format="yaml(displayName,restrictions.browserKeyRestrictions)"`. That format prints the name and the restrictions only, never the key string. | none (`browserKeyRestrictions: {}`), so `app.westay.fit` is not excluded. Hardening is a later change. |

## Security review item: Anonymous sign-in

Anonymous sign-in is enabled on the shared project, and GoArrive's share page uses it (`apps/goarrive/app/share/[shareId].tsx:105`). **Never disable the provider for WSF.** Any browser can therefore mint an ID token whose `firebase.sign_in_provider` is `anonymous`, and every WSF callable is public at the Cloud Run layer (rule 6).

**At `ec162d17` (record A), the exposure is open.**
- **Only three callables test `email_verified`:** `wsfCreateCommunity` (`index.ts:203`), `wsfCreateGoal` (`:3114`) and `wsfCreateCombinedGoal` (`:6805`).
- **The joins do not.** `JOIN_REQUIRES_EMAIL_VERIFIED` is `false` (`:656`, #586). So `wsfJoinCommunity` (`:921`) and `wsfJoinViaMarker` (`:1130`) need only a token and a saved profile, and `wsfSaveProfile` (`:133`) needs only a token.
- **So an anonymous token can become a member.** Under a throwaway uid it can:
  - save a profile and set a photo;
  - join any community whose link or marker it holds;
  - then call the member callables as that member.

  It cannot create a community or a goal. `wsfSendVerificationEmail` refuses a token with no email address (`:541-544`), so it can never verify.
- **#599 §2.2 says the joins require a verified email.** That is wrong at `ec162d17`, and this section supersedes it.

**At `e65bfee9` (record G), the exposure is closed in source.**
- `requireRealIdentity(request)` follows each signed-in check at **42** callables. An anonymous-provider token gets `failed-precondition` / "Sign in with an email account." before any token field or data is read.
- `wsfHealth` is the one exemption. It reads and writes nothing.
- At the four optional-uid sites (`wsfResolveMarker`, `wsfGoalPulse`, `wsfGoalRecentAdditions`, `wsfCombinedGoalPulse`), an anonymous caller is treated exactly as signed out.
- **The evidence is source-only:** `docs/westayfit/ops/security/ANON-GATE-1.md` and its emulator suite (97/97). This runbook mints no anonymous production token to test it.

**The owner's A/B decides which of these is deployed** ("Which candidate"). This runbook does not.

## Owner note: two standing GoArrive hazards (not a step of this run)

**The mechanism.** A deployed function belongs to a codebase only through its `firebase-functions-codebase` label, and an unlabelled one counts as GoArrive's `default` (#599 6, `cloudfunctionsv2.js:449`). `main` carries none of the WSF backend. Its `firestore.rules` has no WSF section, and its `functions-westayfit` has one export.

- **H1 Rules.** A GoArrive deploy from `main` that includes `firestore:rules` replaces the shared ruleset with one that has no WSF section. WSF's direct client reads then fail closed.
- **H2 Functions.** A GoArrive functions deploy from `main` lists WSF functions for deletion. It aborts under `--non-interactive`, and deletes them under `--force` or a Yes.
  - A bare `--only functions` reaches the `westayfit`-labelled ones. After this run, that is 58 of the 59: main's one export, `wsfHealth`, is the one it keeps.
  - Any functions deploy from `main`, `--only functions:default` included, reaches the unlabelled ones: an orphan kept under D2.

**The mitigation is the owner's.** Two examples:
- holding GoArrive rules deploys until `main` carries the WSF section;
- naming `--only functions:default` for GoArrive functions deploys.

## Not covered here

- **Path B** (a `wsf-production` GitHub environment with Devin as the required reviewer, plus a scoped WIF pool and a reviewed workflow) is a follow-on packet, if chosen.
- **Hidden for Phase 1, and not deployed differently:**
  - the Event lifecycle (#595, not exported);
  - profile photos (deployed with either record, not used by the Lovable Web Twin);
  - raffle/promotion (not exported);
  - admin/Champion management.
- This runbook changes no consent version, legal text, Lovable flag, DNS, or GoArrive file.
