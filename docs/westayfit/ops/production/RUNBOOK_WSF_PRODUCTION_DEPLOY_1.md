# RUNBOOK: WSF production deploy on `goarrive` (PRODUCTION-DEPLOY-PATH-1)

**Status: reviewed procedure. NOTHING in this file has been executed.**

**Authority:**
- **Queue:** #365 `6075293313` (owner authorization `6075062042` and `6075204369`).
- **Release:** `6075293540`.
- **Facts:** cited from the inventory, **PR #599 at head `711ecca12f2a619fe5a85a2546f81443dccd47f8`**. If W4's review of #599 changes a fact, this runbook follows the reviewed inventory.

**Who runs it:**
- **Operator:** Devin, or whoever holds production rights on `goarrive`, using **their own** credentials ("Path A" in `6075293313`). No worker or L0 session holds a production credential, and none may use one.
- **What licenses a run:** two things, before any step past 1:
  1. the dated readbacks of step 0;
  2. the Director's **named acceptance of one exact candidate SHA**.

  This document alone does not.

## The rules that do not bend

1. **Never `firebase.json`.** It is GoArrive's default: it carries GoArrive's `default` codebase, Storage, and Hosting that resolves to `goarrive.web.app`. Every Firebase command here passes `--config firebase.westayfit.production.json`.
2. **Never Hosting, never Storage.** Lovable serves `app.westay.fit`. WSF stores no Cloud Storage object.
3. **Never deploy from operational `main`.** Main's `functions-westayfit` has **one** export (`wsfHealth`). A `functions:westayfit` deploy from it would prune every other WSF function.
4. **Never `--force`.** Always `--non-interactive`, so a deletion prompt aborts instead of being answered.
5. **Run the pre-flight before every Firebase command, against that exact command.** A non-zero exit means stop.
6. **No secret, token, key or action link in any receipt.** Paste names, counts, states and SHAs only.
7. **One step at a time, receipt after each.** A failure stops the run: do not retry blind. Roll back what landed (step 9) and report.

## Candidate records

| | Candidate A | Candidate B |
|---|---|---|
| SHA | `ec162d17a0540e936741027f9b8f90dd372cfaf4` **exactly** (development, `claude/wsf-app-shell`) | to be named: A plus **one** reviewed consent-version commit |
| What deploys | backend only: `functions:westayfit` (59 exports, 17 `invoker: 'public'`), the WSF Firestore rules section, the 2 WSF composite indexes | the same; B changes no export, rule or index |
| Consent | `pending-approval-2026-08-25` in `functions-westayfit/src/index.ts:124-125` and `apps/westayfit/src/profileConstants.ts:1-2` | the approved version, equal in both files |
| Sign-up | **must stay closed**: the Lovable production flag stays OFF, so no member writes a profile and no consent is stamped. The pre-flight reports `signUpMustStayClosed: true` | may open only after legal review (PR #598) and the Director's acceptance of B's exact SHA |
| Allowed diff from A | — | only `functions-westayfit/src/index.ts` and `apps/westayfit/src/profileConstants.ts` (consent values only; everything else byte-equal), and `apps/westayfit/src/legalContent.ts` (the policy text) |
| Pre-flight | `--record A` | `--record B` |

The Director accepts **one** of these by exact SHA. A candidate that needs anything beyond this table is a new candidate record and a new review, not an edit to this runbook. One example is a `main` whose `firestore.rules` has changed since `41bff6c6`.

## Step 0: readbacks (read-only, about ten minutes)

Run **B1–B10** from the readback table at the end of `docs/westayfit/ops/production/PRODUCTION_FIREBASE_INVENTORY_1.md` (#599). Paste the outputs on #365 without tokens. Save two of them to files outside the repository, for the pre-flight and for rollback:

```sh
mkdir -p ~/wsf-prod
# B6: the live Firestore ruleset (no token in the paste)
TOKEN="$(gcloud auth print-access-token)"
curl -s --oauth2-bearer "$TOKEN" \
  https://firebaserules.googleapis.com/v1/projects/goarrive/releases/cloud.firestore > ~/wsf-prod/rules-release.json
RULESET="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).rulesetName)' ~/wsf-prod/rules-release.json)"
curl -s --oauth2-bearer "$TOKEN" "https://firebaserules.googleapis.com/v1/$RULESET" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const f=JSON.parse(s).source.files;if(f.length!==1){console.error("expected exactly one rules file, got "+f.length);process.exit(1)}process.stdout.write(f[0].content)})' \
  > ~/wsf-prod/live-firestore.rules
unset TOKEN
echo "prior ruleset: $RULESET"        # the rules rollback anchor

# B4: the WSF functions that exist today, with their revisions (the functions rollback anchor)
firebase functions:list --project goarrive > ~/wsf-prod/functions-before.txt
gcloud run services list --region=us-central1 --project=goarrive --format="table(metadata.name,status.latestReadyRevisionName)" > ~/wsf-prod/run-services-before.txt
```

**Go only if all of these hold:**
- B2 shows Email/Password enabled.
- B10 shows the operator holds the permissions in #599 §8.
- `iam.allowedPolicyMemberDomains` permits `allUsers` on Cloud Run. If not, the 17 public callables cannot be reached signed out: **stop and escalate**.
- No unexpected `wsf*` function or index exists.

## Step 1: checkout and pre-flight (no credential needed)

This needs `firebase.westayfit.production.json` and `.github/wsf-production/` on `main`, which means this packet must already be integrated.

```sh
git clone https://github.com/idevinsimpson/goarrive.git wsf-prod-src && cd wsf-prod-src
git fetch origin main claude/wsf-app-shell
MAIN="$(git rev-parse origin/main)"                       # record it; the pre-flight compares against THIS main
CANDIDATE=ec162d17a0540e936741027f9b8f90dd372cfaf4       # or B's exact SHA, as accepted by the Director
git worktree add --detach ../wsf-candidate "$CANDIDATE"
git show "$MAIN":firebase.westayfit.production.json > ../wsf-candidate/firebase.westayfit.production.json
node .github/wsf-production/preflight.mjs --record A --candidate "$CANDIDATE" --main "$MAIN" \
  --config ../wsf-candidate/firebase.westayfit.production.json --live-rules ~/wsf-prod/live-firestore.rules
```

- **Exit 0 and `"ok": true`:** continue. Paste the verdict (it is JSON, with no secrets).
- **Exit 1:** a check refused. Do not continue. The `checks[].detail` lines name what.
- **Exit 2:** the inputs were unusable. Fix the SHAs or paths, then re-run.

If `rules.live-outside-wsf-equals-main` refused, the live GoArrive rules are not `main`'s. **Skip step 5 (rules)** and escalate: deploying `firestore.rules` would change GoArrive's rules.

## Step 2: indexes (additive, WSF-only)

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
gcloud firestore indexes composite list --project=goarrive --format="table(name,collectionGroup,state)"   # wait for READY
```

**Do not** use `firebase deploy --only firestore:indexes` unless B7 showed every one of `main`'s composite indexes already present. Otherwise it would also create GoArrive indexes. **Receipt:** both WSF indexes are READY, and the GoArrive index count is unchanged from B7.

## Step 3: mail secret and functions env

```sh
# Only if B3 showed no secret: create it (no value yet).
gcloud secrets create WSF_EMAIL_API_KEY --replication-policy=automatic --project=goarrive
# Add the value from a hidden prompt; it never reaches the screen, a file or shell history.
read -rs WSF_KEY && printf %s "$WSF_KEY" | gcloud secrets versions add WSF_EMAIL_API_KEY --data-file=- --project=goarrive; unset WSF_KEY
gcloud secrets versions list WSF_EMAIL_API_KEY --project=goarrive        # receipt: version number + state only
```

Then write the non-secret functions env **in the candidate worktree only**. It is never committed, and the worktree is thrown away after the run:

```sh
cat > ../wsf-candidate/functions-westayfit/.env.goarrive <<'ENV'
WSF_EMAIL_FROM=<the verified Resend sender on westay.fit>
WSF_APP_URL=https://app.westay.fit
ENV
```

- **`WSF_AUTH_ACTION_HANDLER`:** add it only if a real action-handler route exists. Otherwise the callables use `https://goarrive.firebaseapp.com/__/auth/action` (#599 §2.3).
- **The Resend sender domain must already be verified.** A guessed sender fails DMARC.

## Step 4: Auth authorized domain

Console › goarrive › Authentication › Settings › Authorized domains: add `app.westay.fit` and confirm Email/Password is enabled.

**Receipt:** the domain list before and after, names only.

## Step 5: Firestore rules (only if step 1 showed the live ruleset equals `main` outside the WSF section)

```sh
cd ../wsf-candidate
node ../wsf-prod-src/.github/wsf-production/preflight.mjs --repo ../wsf-prod-src --record A --candidate "$CANDIDATE" --main "$MAIN" \
  --config firebase.westayfit.production.json --live-rules ~/wsf-prod/live-firestore.rules \
  --command "firebase deploy --only firestore:rules --project goarrive --config firebase.westayfit.production.json --non-interactive"
npx -y firebase-tools@15.30.1 deploy --only firestore:rules --project goarrive --config firebase.westayfit.production.json --non-interactive
```

**Receipt:** the prior ruleset name (step 0) and the new one, read back the same way.

## Step 6: functions, `westayfit` codebase only

```sh
npm --prefix functions-westayfit ci
node ../wsf-prod-src/.github/wsf-production/preflight.mjs --repo ../wsf-prod-src --record A --candidate "$CANDIDATE" --main "$MAIN" \
  --config firebase.westayfit.production.json \
  --command "firebase deploy --only functions:westayfit --project goarrive --config firebase.westayfit.production.json --non-interactive"
npx -y firebase-tools@15.30.1 deploy --only functions:westayfit --project goarrive --config firebase.westayfit.production.json --non-interactive
```

If the CLI aborts because it would **delete** functions, production holds a `westayfit` function this candidate lacks. **Stop**: compare with `functions-before.txt`, and never re-run with `--force`.

## Step 7: verification

1. `firebase functions:list --project goarrive` shows exactly the **59** WSF names, in `us-central1`, at new revisions. Every GoArrive (`default` codebase) function keeps the name, region and revision it had in `functions-before.txt`.
2. `gcloud run services get-iam-policy <service> --region=us-central1 --project=goarrive` shows `allUsers` as `roles/run.invoker` on **only** the 17 declared-public services, which the pre-flight's `CANDIDATE_A_PUBLIC` lists. No other WSF service has it.
3. The rules release names the new ruleset, and its source equals the candidate's `firestore.rules`. Both WSF indexes are READY.
4. **GoArrive regression** (#599 §6):
   - all of `main`'s composite indexes are still READY;
   - there was no Hosting deploy, and the `goarrive.web.app` release is unchanged;
   - a GoArrive coach, member and platformAdmin each sign in and load home;
   - a WSF account is refused by GoArrive's role guards.
5. **WSF smoke, with sign-up still closed.**
   - `wsfHealth` answers a signed-in operator account.
   - `wsfPreviewCommunity` answers a signed-out call with its uniform not-found.

   No member account is created by this step.
6. **Two-account web journey (candidate B only).** This needs the Lovable production flag ON, which happens only after the legal gates and the Director's acceptance of B. The journey: signup, the verification email received, profile, join by approved link, manual MOVE, one confirmed receipt, and the same Living WE total in a second browser, with a nonmember refused.

## Step 8: the receipt to paste on #365

```text
WSF PRODUCTION DEPLOY RECEIPT (no tokens, no keys)
operator: <name>    utc start/end: <..>/<..>
candidate record: A|B    candidate sha: <40>    main sha compared: <40>
preflight: ok=true (paste the JSON verdict)
indexes: wsfContributions READY, wsfGoalMemberTotals READY; GoArrive composite count before/after: <n>/<n>
secret WSF_EMAIL_API_KEY: version <n> ENABLED   env: WSF_EMAIL_FROM set, WSF_APP_URL=https://app.westay.fit
auth domains added: app.westay.fit
rules: prior <ruleset name> -> new <ruleset name>   (or SKIPPED: live ruleset differs from main)
functions: 59 wsf in us-central1; allUsers invoker on 17; GoArrive functions unchanged (yes/no)
regression: goarrive coach/member/admin sign-in ok (yes/no); hosting untouched (yes)
sign-up: CLOSED (A) | opened by <decision id> (B)
```

L0 records this as the DEPLOYMENT RECEIPT. It is not acceptance, and it is not a hosted proof.

## Step 9: rollback, in reverse order of what landed

| Landed | Undo |
|---|---|
| Functions | Redeploy the prior state recorded in `functions-before.txt`. If no WSF function existed before, delete only the newly created `westayfit` functions by name: `firebase functions:delete <name> --region us-central1 --project goarrive`. Never delete a `default`-codebase function. |
| Rules | Re-release the prior ruleset recorded in step 0: console › Firestore › Rules › history › roll back to it, or update the `cloud.firestore` release to that `rulesetName`. This restores GoArrive's rules too, which is intended: they were equal. |
| Auth domain | Remove `app.westay.fit` from the authorized domains. |
| Secret | `gcloud secrets versions disable <n> --secret=WSF_EMAIL_API_KEY --project=goarrive` |
| Indexes | Leave them: they are additive and harmless. To remove them anyway: `gcloud firestore indexes composite delete <name> --project=goarrive`. |
| `app.westay.fit` | The Lovable owner keeps or re-publishes deployment `b4b9d8d1-ed6a-49a7-966d-af688c3a0d39` (fail-closed shell) with the production flag OFF. |

**Not reversible** (#599 §9):
- member data and Auth accounts, once sign-up opens;
- consent records stamped at sign-up;
- emails already sent;
- the time a drifted ruleset was live;
- any function a prune deleted.

That is why sign-up stays closed on A, why the rules step needs the live-equals-main check, and why `--force` is refused.

## Stop conditions (any one ends the run)

- Any pre-flight exit other than 0.
- Any readback that shows a `wsf*` function, index or rule this runbook did not expect.
- A CLI prompt or abort mentioning deletion.
- Any GoArrive function, index, rule or hosting release changing.
- A missing permission. Never widen IAM mid-run to make a step pass; escalate.

## Not covered here

- **Path B** (a `wsf-production` GitHub environment with Devin as the required reviewer, plus a scoped WIF pool and a reviewed workflow) is a follow-on packet, if chosen.
- **Hidden for Phase 1, and not deployed differently:**
  - the Event lifecycle (#595, not exported);
  - profile photos (deployed with A, not used by the Lovable Web Twin);
  - raffle/promotion (not exported);
  - admin/Champion management.
- This runbook changes no consent version, legal text, Lovable flag, DNS, or GoArrive file.
