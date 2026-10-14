# VALIDATION-MODE-PROPOSAL-1: non-deploy validation mode for the WSF staging workflow

Status: PROPOSAL ONLY. Not implemented. Prepared by Lovable, 2026-10-14.
This document does not modify the protected workflow or the generator, change approval records, run a workflow, merge, deploy, or change Auth/IAM.

Base: `main` at `be45236ea92771319e45e0f84199cfc849f9b5f5`. Related candidate: PR #629 (stays draft and blocked).

## 1. Proposed mode
- Name: `candidate-validate`, a new `mode` choice in `.github/workflows/wsf-staging-deploy.yml`.
- Inputs: `app_sha` (required, full 40-hex), `expected_inventory` (required, 59 or 60), `proposed_additions` (optional, comma list; empty by default).
- Outputs: one evidence artifact, `wsf-candidate-validation`, containing `validation.json`, the generator's stdout/stderr, the exit code of each step, a sha256 manifest of every output file, and a `RESULT=pass|refuse` line.
- Permissions: the job runs read-only. `contents: read`. `id-token: write` only in a separate read-inventory job, and only for the existing read-only inventory reader.
- Fail-closed: any missing input, unreadable source, stale baseline, generator refusal, inventory mismatch or checksum mismatch ends the run with `RESULT=refuse` and a non-zero exit code. An unknown state never counts as pass.

## 2. What it invokes (unchanged code)
1. The existing `.github/wsf-staging/pin-candidate.mjs`, byte-identical (sha256 `136aa124030eb4e88d92156d6b4ff726b6d00cdfda75024f5814522bd9369625` at the base), invoked the way `.github/wsf-staging/CONTROL-PLANE.md` documents. Any output it would write goes to the run's temporary workspace only, never the repository. Whether the generator has a side-effect-free invocation path is UNVERIFIED and must be confirmed in review; if it does not, the mode is blocked.
2. The existing exact inventory comparison: the candidate's inline `onCall` export names against the live baseline from section 4. Each name is reported as retained, changed, added or removed. Any removal ends the run with REFUSE.
3. The existing ancestry and approval-chain checks against the unchanged `approved-candidate.json`.
4. Checksum validation: sha256 of the generator, the approval record, the candidate's `functions-westayfit/src/index.ts` and every artifact file.
5. The existing no-loss, RTDB and MAX_NEVER_SERVED checks.
The mode reports what these checks say. With today's approval record the expected outcome is REFUSE (run #61 anchoring; expected prior count 49). The mode does not change that outcome.

## 3. Why it cannot deploy or change anything
- Every existing job gates on an explicit equality list of modes. The new mode is named only by the two new jobs, so no build, deploy, hosted-verify or cleanup job runs.
- The new jobs contain no `firebase deploy`, `gcloud` write, Firestore/RTDB write, IAM or `setIamPolicy` call. A required test greps the job bodies for these and fails if any appears.
- The read-inventory job uses the existing read-only role. The proposal grants no new permission.
- No step writes to the repository or the ledger ref, edits approval records, or pushes. `contents: read` makes a push impossible.
- The mode runs only from `main`, through the existing workload-identity condition pinned to this workflow file on `refs/heads/main`. Branch protections are not touched.

## 4. Live-inventory evidence and freshness
- Source: the existing `.github/wsf-staging/read-inventory.mjs`, authenticated through the existing keyless identity. It reads the WSF function names, state and runtime in us-central1 for `westayfit-staging`.
- Freshness: the read happens inside the same run. Its UTC timestamp and the run ID are recorded in `validation.json`. The comparison refuses if the read is older than the run start, or if the project ID is not `westayfit-staging`.
- No Cloud Shell or manual upload is used.

## 5. Tests required before implementation can be approved
- Mode isolation: every pre-existing job is skipped when `mode=candidate-validate`.
- Static grep: no deploy, write or IAM command appears in the new jobs.
- Permissions: the new jobs declare only the permissions listed in section 1.
- Fail-closed: a missing input, bad SHA, stale baseline or wrong project ends with REFUSE.
- Removal: a fixture with a missing live name ends with REFUSE.
- Generator identity: a changed generator checksum ends with REFUSE.
- An unchanged approval record produces the expected REFUSE, which proves the mode does not bypass the gate.
- The existing workflow contract suite and `run-all.mjs` pass on Node 20 and 22.

## 6. Evidence returned to PR #629
The run link and ID, the head and app SHAs, `RESULT`, every step's exit code, the per-service disposition table, the approval-chain and no-loss results, and the artifact's sha256 manifest. Lovable adds these to #629 only after a separately authorized run.

## 7. Relationship to CP-1
CP-1 (correcting the approval baseline from 49 to 59 and recording run #61 as a failed run that does not count as an anchor) stays a SEPARATE proposal. This mode neither includes nor implements it. Without CP-1 the mode is expected to report REFUSE.

## 8. Transport for the 13 auth-only callables
Following W11's corrected requirement: intended Firebase clients must be able to reach the callables, while handler-level authentication and authorization remain enforced (`request.auth` plus `requireRealIdentity`/`optionalRealUid`). This proposal changes no invoker setting. The mode only reports each callable's current invoker state against that requirement as information. Any transport change needs its own reviewed proposal and owner decision.

## Holds
No implementation, workflow change, generator change, approval change, run, merge, deploy, release, publication or Auth/IAM change. PR #629 stays draft and blocked. PRs #623–#626 stay held. Recurring audits stay paused.
