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
  --receipt <optional receipt path> \
  --manifest <the milestone manifest this pin PR commits | none>
```

The run values are copied from the deploy job log of the run that served the
current pin. The script **refuses** (exit 1, nothing written) when:
- the run did not verify, observe its marker, or pass hosted verification;
- the approval file at `--run-main` does not approve the SHA being replaced;
- `--inventory-before` is not the file's `expectedPriorFunctions`;
- the candidate is not a commit, or is the SHA already approved;
- that pin was already rotated into history, or the label is not one line;
- the milestone does not check out. A supplied `--manifest` (or one already at
  `--ops-head`) must pass the same check the pre-deploy gate runs (section 5),
  and its `previousKnownGoodSha` must be the served pin. A manifest at
  `--ops-head` for another product is refused unless the pin supplies a new
  one or passes `--manifest none` and removes it.

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

**The release environment** is the workflow, `.github/wsf-staging/` (the
generator, the smoke runner, the driver registry and every driver) and
`firebase.westayfit.staging.json`. Exactly two files are excluded, because
they are reviewed release **data**, not procedure:
- `approved-candidate.json`;
- `journeys/manifest.json`, which every visible milestone changes.

A change to any other file there leaves the fast path.

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

It runs after the Package E suite and the re-authentication, with `continue-on-error`. It has no step id, and the hosted gate does not read it.

It reads the manifest from the **operational** checkout at `.github/wsf-staging/journeys/manifest.json`.

| Situation | What it does |
| --- | --- |
| No manifest | Prints `CHANGED_JOURNEY_SMOKE=skipped` |
| Journey has no driver in `journeys/index.mjs` | Reports it BLOCKED |
| At least one driver to run | Mints its token and SDK config, then launches the browser only after `/health` names the deployed SHA |

It writes `changed-journeys/changed-journeys.json` and one screenshot per driven journey into the hosted evidence; the owner card is rendered later, after fixture cleanup. The existing scan checks all of them before upload.

**Drivers** (`journeys/index.mjs`, reviewed code):

| Journey id | What it does | What it does not do |
| --- | --- | --- |
| `community` | Signs in through `/signin`, opens `/community`, checks the banner name, the Members and Your role facts ("Champion" for the founding Champion) and This period; presses the other community's chip and checks all of them again; reloads and checks the selection held. | The roster: `wsfCommunityMembers` is transport-shut on staging. |
| `settings` | Selects the community it leads with its chip, opens You, presses Settings, checks the panel overlay, that the selected community's section is first, every switch's stored state, the "Anonymous member" hint and the CHAMPION badge; presses × Close and checks it dismissed. | Changing a switch: `wsfSetCommunityVisibility` is transport-shut on staging. |

**Fixtures** (`journeys/fixture-kit.mjs`): one preverified synthetic member in two synthetic communities, seeded through the admin REST path with the run tag `e5c-…` (registered in `run-tag.mjs`). Every document is tracked in the step's **own** cleanup manifest before it is written. An account is tracked immediately after sign-up returns its uid, before any document that depends on it; if the process dies inside that window, the account is found by its run-specific email `wsf-<runTag>-…@example.com`. The password is never written.

The next step, "Remove changed-journey fixtures", runs `cleanup-synthetic.mjs` over that manifest. It is **blocking** whenever a fixture manifest exists: a cleanup that is not complete fails `hosted-verify`, and the manifest is preserved in the evidence for recovery.

The owner card is rendered only after that, by "Render the changed-journey owner card", from the results **and** the cleanup receipt. It names the cleanup outcome, and says PASSED only when every journey passed on the manifest's build and cleanup is complete or nothing was created.

An example manifest for COMMUNITY-SETTINGS-PARITY-1 is at `journeys/examples/`; no live manifest ships with this tooling.

## 5. `check-milestone-manifest.mjs`: the frozen manifest, checked before deploy

It runs in the credential-free `gate` job, deploy mode only, right after the candidate is resolved.

| Manifest | Result |
| --- | --- |
| Absent | `MILESTONE_MANIFEST=absent`: no member-visible milestone is declared. Never read as a pass. |
| Schema-valid, `productSha` equals the approved candidate, a registered driver for every journey | `MILESTONE_MANIFEST=valid` |
| Anything else (stale, mismatched, undriven, invalid) | `MILESTONE_MANIFEST=refused`, and the deploy stops before any build |

## 6. `journey-activation`: the no-deploy activation proof (CONTROL-PLANE-ACTIVATION-1)

A workflow mode that runs the accepted Community and Settings drivers once against staging **as it is served**. It builds nothing and deploys nothing of any kind. It changes no rules, index, IAM or app source, and takes no social write or roster path.

| Step | What it does | On failure |
| --- | --- | --- |
| gate: activation manifest | `check-milestone-manifest.mjs --require journeys/examples/community-settings-parity-1.json`: present, valid, `productSha` = the approved candidate, a driver for every journey | refused before anything else |
| gate: served marker | `check-served-marker.mjs` in the **credential-free gate**: `/health` must name the approved SHA (the verifier's rule) | the gate fails, so `config` and the activation job (the only jobs here that can obtain a token) never start: **no credential is minted** |
| served marker, again | the same check inside the activation job, before its own authentication: a drift check between the gate and execution | the job stops before any fixture |
| authenticate, run | the existing identity; `hosted-changed-journeys.mjs` seeds the bounded `e5c-` fixture and drives both journeys | a failed or blocked journey is recorded, never passed |
| cleanup | `cleanup-synthetic.mjs` over the run's own manifest, **blocking** | the step fails; the manifest is kept in the evidence for recovery |
| card | `owner-test-card.mjs` after cleanup, from the results and the cleaner's receipt | report only |
| scan, upload | `scan-evidence.mjs`; the `wsf-activation-evidence` artifact is uploaded only when the scan passes | no upload |
| verdict | `require-activation.mjs` recomputes the verdict from the evidence | `ACTIVATION=FAILED` with every reason |

**ACTIVATION=PASSED** requires all of:
- the marker matched;
- the manifest names exactly `community` and `settings`;
- both journeys PASSED on the served build, with their own assertions;
- the cleanup receipt says COMPLETE (or NO_FIXTURES) and the cleanup step succeeded;
- the scan passed.

It uses the example manifest at its non-live path. The live deploy manifest `journeys/manifest.json` is never read or written by this mode.

**Dispatch** (L0, once, after Director and W7 source acceptance, from the `main` that carries this mode). Run it only while `approved-candidate.json` on that `main` names the build staging serves, which is `938e00d8` today; otherwise the gate or the marker refuses.

```sh
gh workflow run wsf-staging-deploy.yml --ref main -f mode=journey-activation
```

Equivalently: **Actions → WSF staging deploy → Run workflow**, branch `main`, mode `journey-activation`, leaving `app_sha` blank. The receipt is the run's `Require the activation to have passed` log, which ends `ACTIVATION=PASSED` or `ACTIVATION=FAILED`, plus the `wsf-activation-evidence` artifact:
- `served-marker.json`;
- `changed-journeys/changed-journeys.json`;
- the screenshots;
- `cleanup-receipt.json`;
- `owner-test-card.md`.

`fastPath.applies` stays `false`. This mode proves the drivers; it does not switch on any fast path.
