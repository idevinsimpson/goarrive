# Staging control plane: pin generation, milestone manifest, owner card, changed-journey smoke

Implements the contracts in `docs/westayfit/ops/OWNER_TEST_CARD_AND_SMOKE_CONTRACT.md`
(#512). **Nothing here changes the release gate.** The pin still goes through a
reviewed PR, the hosted Package E suite and the evidence scan still decide
hosted-verify, and the fast path is recorded but never applied.

## 1. `pin-candidate.mjs`: the next pin, from git and the run receipt

```sh
node .github/wsf-staging/pin-candidate.mjs \
  --approval .github/wsf-staging/approved-candidate.json \
  --repo . \
  --candidate <40-hex accepted product SHA> \
  --ops-head <40-hex operational main the pin PR is cut from> \
  --run-id <run id> --run-number <n> --run-main <40-hex main the run was dispatched from> \
  --run-date YYYY-MM-DD \
  --inventory-before <INVENTORY_BEFORE> --inventory-after <INVENTORY_AFTER> \
  --created <CREATED_THIS_DEPLOY: none | wsfa,wsfb> \
  --verify <VERIFY> --hosted-marker <HOSTED_MARKER_MATCHES> --hosted-verify <pass|fail> \
  --label-file <file holding the reviewed packageLabel, one line> \
  --accepted-on YYYY-MM-DD \
  --out .github/wsf-staging/approved-candidate.json \
  --receipt <optional receipt path>
```

The run values are copied from the deploy job log of the run that served the
current pin. The script **refuses** (exit 1, nothing written) when:
- the run did not verify, observe its marker, or pass hosted verification;
- the approval file at `--run-main` does not approve the SHA being replaced;
- `--inventory-before` is not the file's `expectedPriorFunctions`;
- the candidate is not a commit, or is the SHA already approved;
- that pin was already rotated into history, or the label is not one line.

It **derives**:
- `approvedAppSha`, `expectedPriorFunctions` (the run's AFTER) and `sourceAcceptedOn`;
- the rollback, inventory and boundary notes;
- the `_previous*<sha8>` history rotation.

It carries forward `candidateAddedFunctions` and every other key unchanged.

`packageLabel` is reviewed prose. It is an input and is never generated.

`_pinInvariants.fastPath.eligible` is true only when all of these hold:
- the lineage is forward;
- the protected paths are unchanged;
- the `functions-westayfit` tree and its exports are unchanged;
- the candidate exports exactly the verifier's expected set;
- the serving run created nothing and moved nothing;
- the release environment is unchanged between `--run-main` and `--ops-head`.

`fastPath.applies` is always `false`.

The protected paths are listed once, in `PROTECTED_PATHS` in the script.

## 2. `milestone-manifest.mjs`: strict schema v1

```sh
node .github/wsf-staging/milestone-manifest.mjs <manifest.json>   # MANIFEST=valid | MANIFEST=invalid
```

It refuses:
- unknown keys;
- duplicate or malformed journey ids;
- an `entry` that is not an app path;
- empty `actions` or `expected`;
- `productSha` equal to `previousKnownGoodSha`.

## 3. `owner-test-card.mjs`: the card from the manifest plus the hosted results

```sh
node .github/wsf-staging/owner-test-card.mjs --manifest m.json [--results changed-journeys.json] \
  --staging-url https://… --out card.md
```

How each journey is reported:

| Condition | Card says |
| --- | --- |
| No result | NOT RUN |
| Result observed on a build other than `productSha` | NOT VERIFIED |
| Status `blocked` | BLOCKED, with its reason |

The card refuses:
- an unknown status;
- a result for a journey the manifest does not name;
- a duplicate result;
- a pass with no assertions, or with an assertion that failed.

The summary is PASSED, FAILED or INCOMPLETE. Device review is always `NOT RUN — Devin's verdict`.

## 4. `hosted-changed-journeys.mjs`: the report-only hook in hosted-verify

It runs after the Package E suite, with `continue-on-error`. It has no step id, and the hosted gate does not read it.

It reads the manifest from the **operational** checkout at `.github/wsf-staging/journeys/manifest.json`.

| Situation | What it does |
| --- | --- |
| No manifest | Prints `CHANGED_JOURNEY_SMOKE=skipped` |
| Journey has no driver in `journeys/index.mjs` | Reports it BLOCKED |
| At least one driver to run | Launches the browser only after `/health` names the deployed SHA |

It writes `changed-journeys/changed-journeys.json` and `owner-test-card.md` into the hosted evidence. The existing scan checks them before upload.

The driver registry ships empty. Drivers arrive with the first milestone manifest, reviewed against its journeys.
