# VALIDATION-MODE-PROPOSAL-1: non-deploy validation mode for the WSF staging workflow

Status: PROPOSAL ONLY, documentation-only correction 2026-10-14. Not implemented or executed. Incorporates W11 #627 comment 6176338395 (C1–C4 in #630 comment 6176335731) and L0/Fable #365 comment 6176350289 and superseding ordered checklist 6176858858, plus W11 E1–E2 (#630 control-design addendum). Those verdicts reviewed the prior head; they do not approve this corrected head.

Base: `main@be45236ea92771319e45e0f84199cfc849f9b5f5`. #629 is the separate recovery package and stays draft/blocked. CP-1 is a separate approval-baseline proposal, not embedded here. No generator, workflow, approval, IAM/Auth, index, deployment or application change is made.

## 1. Proposed mode, permissions and outputs
- Proposed mode: `candidate-validate` in `.github/workflows/wsf-staging-deploy.yml` (future separately approved implementation).
- Claims supplied by dispatcher: `app_sha` (required full 40-hex), `expected_inventory` (59 or 60), `proposed_additions` (optional comma list, default empty). They only narrow/refuse; never establish approval or override prior count. Initial recovery is 59 with no additions; a 60-service proposal is a separately reviewed variant, not current authorization.
- Both new jobs explicitly require `github.ref == 'refs/heads/main' && inputs.mode == 'candidate-validate'` in the workflow file. All existing jobs retain their explicit mode-equality lists. No negation-based job conditions; do not rely solely on external workload-identity restrictions.
- Cloud-credentialed inventory job: `environment: wsf-staging`, `contents: read`, `id-token: write` only there. Non-credentialed artifact-reader/source/generator validation job: **`contents: read` and `actions: read` only**, no `id-token`, no cloud credential. `actions: read` is required to retrieve recorded anchor artifacts/receipt; no silent scope widening. Existing environment protections remain.
- Artifact `wsf-candidate-validation`: `validation.json`, raw inventory and exit status, source/control identities, recorded anchor receipts/artifacts and checksums, generator stdout/stderr and exit status, per-service dispositions, no-loss/ancestry/approval results, output SHA-256 manifest, `RESULT=pass|refuse`.
- Every output, including generator `--out` and `--receipt`, is under `$RUNNER_TEMP` outside ALL repository checkouts. Nothing updates the approval file, ledger, repository or pin. A generated temporary proposal is evidence only.
- Missing/unreadable/unmeasurable inputs, stale/wrong-project evidence, generator refusal, mismatched claims, failed checks or checksums mean nonzero exit and `RESULT=refuse`. Unknown is never pass. `RESULT=pass` is evidence for independent review, **not approval, pin or deployment authorization**.

## 2. Credential boundary — no read-only role exists
W11 confirms the only existing federated identity is the write-capable staging deployer; it is NOT a read-only account. Its observed grants include Cloud Functions, Hosting, Auth, RTDB/data capabilities and the custom `run.services.setIamPolicy` capability. Do not describe a read-only role as existing or infer effective permissions from role names.

This proposal discloses that credential and constrains its potential use, subject to independent review and separate owner implementation/run approvals:
- Ops-only checkout pinned to **`github.sha`**, the guarded main workflow commit, with required trusted operational files only; no candidate checkout in the credentialed job. No candidate code installed, imported or executed.
- **No package installation/resolution in that job.** Only if package resolution elsewhere is demonstrated unavoidable may it use a reviewed lockfile and `--ignore-scripts`; this is not permission to install in the credentialed job. No lifecycle scripts.
- Reuse only unchanged `.github/wsf-staging/read-inventory.mjs` as repository executable. It validates raw output of the existing read-only inventory listing command; the script itself does not call Google Cloud. The listing may read, never deploy/write, and its exit code is preserved. No generator, verifier, tests or candidate execution under the cloud credential.
- Output paths are outside checkout under `$RUNNER_TEMP`; credential material is never included in artifacts or logs. `environment: wsf-staging` applies before credential issuance.
- Download recorded GitHub anchor artifacts and read candidate `index.ts` strictly as data (`git show`) in the job without cloud credentials. Trusted generator and dependencies execute only from pinned main operational source, not candidate source.

A dedicated read-only service account/provider binding is an alternative **separate owner IAM decision**; this documentation neither creates it nor changes scopes, bindings or permissions. The write-capable credential is a disclosed design risk, not a claim that technical write authority has disappeared.

## 3. Unchanged checks and comparator identity
1. Reuse `.github/wsf-staging/pin-candidate.mjs` byte-identical to base (SHA-256 `136aa124030eb4e88d92156d6b4ff726b6d00cdfda75024f5814522bd9369625`). W11/L0 resolved side effects: trusted CLI writes only caller-specified `--out`/`--receipt`; local git reads, no network/push/ledger write. Both paths must be `$RUNNER_TEMP` paths outside checkout. Refusal is exit 1 / `PIN=refused`.
2. **Name the existing comparison code:** `.github/wsf-staging/pin-candidate.mjs`, `exportedFunctions()` and `measure()` (candidate/previous inline export sets), and its `addedFunctions()` exact-delta/no-removal checks. Reuse unchanged trusted implementation, checksum it; `exportedFunctions() == null` refuses, never empty/unchanged. The live baseline count/retained-name validator is unchanged `.github/wsf-staging/read-inventory.mjs` (base Git blob `601c9a6c5598c8e92cb1242e8f986226e29bc1e2`, SHA-256 `340a5928092babf1acf5e53372c4655194a5104c6d3941e4af1dd1054d8bfbcc`). The operational expected-set/no-loss verifier is `.github/wsf-staging/verify-deployment.mjs` (base Git blob `b75ea3ff3692e77c37978d089bb6791fb0602a17`, SHA-256 `dfac73b665a2f8b8aa4d7c60bfb9a77a7710a1ba4d9fa2c5955c654525041bc3`); it has credentialed hosted side effects and is **not executed in this mode**.
3. **Separate verifier proposal boundary:** there is no standalone credential-free candidate-export-versus-live comparator in the inspected base tree. Any new adapter or extracted comparator is a **separate verifier proposal**, not part of this validation-mode implementation scope and not claimed to exist. This mode reuses only the named existing comparator byte-identically; if it cannot produce the required measured exact-set comparison through its supported invocation, report REFUSE/BLOCKED, never improvise new comparison code. The separate verifier proposal must cover exact equality for the initial 59, sorted unique names, no deletion and unmeasurable exports; it needs independent review before any later inclusion. No duplicate scanner or bypass.

4. Preserve unchanged ancestry, approval-chain, RTDB, MAX_NEVER_SERVED and no-loss checks. Approval file stays byte-identical; checksums cover generator/imported trusted ops files, reader, verifier source, approval record, candidate `index.ts` and every artifact. Record the trusted base/execution SHAs and script SHA-256s; any mismatch refuses.
5. Dispatcher claims are compared to **measured** candidate count/export delta and immutable approval/live facts. `expected_inventory` never sets `expectedPriorFunctions`; `proposed_additions` is never passed as `--added-functions`. Any generator addition argument, if required for a separately reviewed variant, must be derived solely from the trusted generator's measured export delta, not dispatcher input; otherwise refuse unsupported additions. No claim can bypass a refused gate.

## 4. Anchor facts and inventory freshness
- Derive anchor identity and all run facts solely from the earlier deploying run's **recorded artifacts and receipt**: source/ops SHAs, approval identity, run ID, inventory before/after, created names, VERIFY, hosted-marker and hosted-verify outcomes. Bind artifact/run/commit identities and checksums. Missing, conflicting or unreadable receipt/artifact refuses.
- Never populate `--verify pass`, `--hosted-marker true` or `--hosted-verify pass` from dispatcher inputs or literals. Do not reclassify failed run #61 as successful or repair its receipt. Current unchanged approval expects prior 49 and anchors on failed hosted verification; expected result remains REFUSE, not an executed result.
- Same-run live inventory uses the existing listing plus unchanged `read-inventory.mjs`, exact `westayfit-staging` / `us-central1`; preserve listing exit code, raw payload, read UTC timestamp and run ID. Raw listing contains observed names/state/runtime; reader normalizes names and validates count against unchanged approval. Stale read predating run start, wrong project/region, empty/error payload, duplicates, missing names or checksum mismatch refuses.
- Refusal of the reader at 59-versus-approved-49 is evidence, not permission to omit/change the approval, invent an empty baseline or weaken the check. Preserve refusal and independently recorded raw names for review.
- No Cloud Shell, manual upload, candidate execution with credentials or new live mutation is used. Freshness applies to the run's read, not old collection timestamps.

## 5. Non-deploy proof and required future tests
Every existing job (gate/config/build/deploy/hosted-verify/cleanup) keeps explicit equality lists and is skipped for `candidate-validate`. Both new jobs explicitly main-guard the mode. No deploy/build/cleanup action, cloud write, IAM/setIamPolicy, rules/index/data write, push or ledger mutation is in the new jobs. Per-job GitHub permissions stay exactly as section 1: credentialed contents/read + id-token/write; artifact reader contents/read + actions/read only. No pin or approval is persisted.

Required implementation tests, **not run or claimed by this documentation PR**:
- Both job guards accept main+exact mode only; other refs/modes and every pre-existing job are isolated without negation gates.
- Exact environment and permissions; credentialed job ops-only at `github.sha`, no package install, candidate code, generator or lifecycle execution. Any elsewhere installation must use lockfile/`--ignore-scripts`.
- No deploy/write/IAM command; every artifact/output and both generator paths outside checkout; checkout `git status` remains clean after jobs.
- Anchor regression test: failed/missing/conflicting recorded artifacts and receipts refuse even when dispatcher inputs or literal fallback values claim success; all anchor facts come only from the earlier run’s recorded artifacts/receipt. Dispatcher-supplied pass facts cannot reach generator.
- Counts/addition claims cannot override approval prior count or flow into `--added-functions`; mismatches, duplicate/removal/unmeasurable export fixtures refuse.
- Fresh timestamp/project/region/exit-code validation; source, comparator, generator, reader, approval and artifact checksum changes refuse.
- Unchanged approval gives expected REFUSE, demonstrating no gate bypass. Any new verifier remains a separate proposal with concrete exact-set/no-loss fixtures and independent review; unsupported comparisons refuse.
- Existing workflow contract suite and `.github/wsf-staging/tests/run-all.mjs` on Node 20 and 22 at exact future implementation head, with real receipts; documentation is not a test PASS.

## 6. Evidence for #629 and review sequence
After a **separately owner-authorized** protected validation run, return actual run link/ID, exact implementation/ops/app SHAs, artifact identities/manifest, every step exit code, measured 59/60 count, mutually exclusive retained/added/removed dispositions (revision changes described separately), generator refusal/pass, ancestry/approval/RTDB/MAX_NEVER_SERVED/no-loss results and blockers. The initial recovery excludes `wsfmycontributions`, its index and `wsfStationGuestContribute`; Progress history stays off.

This is validation evidence only. The deployment-receipt workflow and serving-build provenance are a **separate work item**; this artifact does not satisfy owner deployment-receipt criterion 6, prove serving state or authorize recovery.

Sequence: (1) proposal created; (2) W11/L0 review corrected exact heads; (3) separate owner implementation decision after review; (4) separate implementation PR/tests; (5) W11/L0 exact implementation-head review; (6) separate owner authorization for protected validation run; (7) actual receipts/results to #629; (8) completed recovery evidence to W11. Old verdicts are not corrected-head approvals. No owner implementation/deployment decision is requested now.

## 7. Result cannot become a deployment input (E2)
A validation `RESULT` never replaces the deploy mode’s **own fresh preflight inventory read**; deployment must rerun that read, because validation evidence can be stale. Result artifacts never become ledger targets, fast-path triggers, pins or approval inputs. `.github/wsf-staging/fastpath-dispatch.mjs` stays **deploy-only** (existing `mode: 'deploy'`); no candidate-validate dispatch is added. The validation run title must contain the literal **`mode=candidate-validate`**, so `fastpath.mjs` / `DEPLOY_TITLE` cannot mistake it for a deploying run. Preserve workflow `concurrency: wsf-staging-deploy` with `cancel-in-progress: false` so validation cannot overlap deployment.

Required future tests (not executed here), one for each rule:
- Deploy still executes its own preflight read and does not consume validation RESULT in its place.
- Validation result cannot be a ledger target or fast-path input/trigger.
- `fastpath-dispatch.mjs` remains byte-identical and deploy-only.
- Validation title includes `mode=candidate-validate` and does not match `DEPLOY_TITLE`.
- Existing shared concurrency and cancel-in-progress protections remain.

## 8. CP-1 remains separate
CP-1 concerns the failed-run anchor and approval baseline 49 versus live 59. It is neither included nor implemented here; historical records, expectations and controls are unchanged. The validation mode is expected to report REFUSE without a separately reviewed resolution. A pass never constitutes approval or a new pin.

## 9. Transport repair remains separate; mode does not report IAM
All 59 Firebase callable Cloud Run transports are intended public. The observed 13 platform-auth-required transports are a client-blocking defect, never a no-loss invariant or configuration to preserve. Handler-level identity/authorization (`requireRealIdentity`, `optionalRealUid` or intended station/token control) remains the security boundary; Cloud Run IAM is not Firebase-client auth.

**This validation mode does not read or report current transport/IAM state.** The existing reader/listing does not establish invoker policy. No per-service IAM read permission is asserted or added. Repair and its transport evidence are separate reviewed, owner-authorized IAM work, not part of either documentation PR or this mode. The false assurance in `tests/deploy-config/sprint-w8-social-invoker.test.ts` must be addressed there with handler reachability and correct identity/authorization evidence. Hosted anonymous probes need separate owner authorization; the Anonymous provider stays OFF; do not re-enable it.

## Holds and next review
#629 and #630 remain drafts; #629 blocked. #623–#626 held; Progress history off. No application/generator/workflow/approval/Auth/IAM/index change, merge, protected run, deploy, release, publication or audit resumption. Route both corrected exact heads to W11 and L0/Fable for bounded review; no implementation/deployment decision yet.
