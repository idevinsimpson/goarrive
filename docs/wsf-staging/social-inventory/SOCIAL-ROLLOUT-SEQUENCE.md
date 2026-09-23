# The 49-function social rollout: what this pipeline can and cannot do

**Packet** `5797176094`. Read from `main` `340e1417a8c0a2c9c9a4b0a3a414f3d96b5574bc`.
Nothing here was run: no deploy, no dispatch, no `gcloud`, no `firebase`, no IAM, no
secret read. Every claim below is from the workflow file and the configs on `main`.

**This document exists because the packet asked whether the actual dispatch can perform
the operation the release needs. It cannot — three ways — and each is named with the line
that settles it rather than as a worry.**

---

## 1. The verifier defect, reproduced

`.github/wsf-staging/verify-deployment.mjs` (blob `5e40cf7d4699c38a4835910cd9207359ed72307b`):

```
EXPECTED count: 46
wsfsetcommunityvisibility  ABSENT
wsfcommunitymembers        ABSENT
wsfcommunityactivity       ABSENT
```

`verify-deployment.mjs:182` computes `after.filter((n) => !EXPECTED.includes(n))` and
`:186` turns a non-empty result into `present but not expected: …`, a **failure**. A
correct 49-function deploy therefore fails verification. Proven by the first new fixture,
which runs the verifier with no approved additions against a 49-function project and
asserts exit 1 — the defect first, then the fix.

## 2. What the fix is, and what it deliberately is not

`EXPECTED` becomes the 46-name base **plus** an optional `candidateAddedFunctions` array
read from `approved-candidate.json` **beside the script**
(`new URL('./approved-candidate.json', import.meta.url)`).

That resolution is the whole security of it, and it is the pipeline's existing rule rather
than a new one: the workflow runs `node ops/.github/wsf-staging/verify-deployment.mjs`
(line 476) and hands `read-inventory.mjs` `../ops/.github/wsf-staging/approved-candidate.json`
explicitly (line 394). Both read the **operational** checkout — the commit the workflow ran
from. There is no environment override and no path input, deliberately: a path this process
could be told is a path the candidate could supply, and a candidate that names its own
additions approves itself.

| Property | How it is held |
| --- | --- |
| Today's contract unchanged | The key is **absent** from the live approval, so the list is empty and behaviour is byte-for-byte what it was. A fixture asserts the live file still carries no additions and `expectedPriorFunctions: 46`. |
| No arbitrary extras | Only the exact names a reviewed file lists. A fourth, unlisted function is still `present but not expected` — fixture: *approving three does NOT admit a fourth*. |
| No self-approval | The file is resolved beside the script, never from the candidate checkout or an input. |
| An approval is a commitment | A listed name that did **not** deploy is a failure naming it, not a quiet pass. |
| Unreadable ≠ empty | A missing or malformed approval is `VERIFY=error`, the same rule the before-inventory is held to. |
| Nothing weakened | Lost service, missing required service, project/region, transport drift, min-instances, hosted marker, exact-SHA approval all run unchanged, and fixtures re-assert them *while additions are approved*. |

**Not changed, on purpose:** `approved-candidate.json` (not even its schema — leaving the
live approval byte-identical is the strongest proof that absence behaves as before);
`read-inventory.mjs`; `tests/workflow-contract.test.mjs`.

## 3. `expectedPriorFunctions` stays 46 for the deploy that creates them

The packet's second point is right and is an argument *against* touching `read-inventory.mjs`.
For the deploy that **creates** the three services, the BEFORE inventory is still **46** —
they do not exist yet. `expectedPriorFunctions: 46` is correct for that run; writing 49
early fails preflight, which is the check working. 49 becomes the correct baseline only for
a **later** pin, after a run's own receipt establishes it. Sequence, not code — and never a
number this document infers on a reader's behalf (see §6a).

## 4. Three things the actual dispatch cannot do

### 4a. There is no targeted three-function deploy

Line 435–439 is the whole functions deploy:

```
firebase deploy --project westayfit-staging \
  --config firebase.westayfit.staging.json \
  --only functions:westayfit --non-interactive
```

`--only functions:westayfit` deploys the **entire westayfit codebase** from the pinned
candidate. There is no per-function selection and no input that would add one. The three
services arrive because the candidate's source defines them, not because anything selects
them. Any procedure describing a "targeted three-function operation" is describing
something this workflow does not offer.

### 4b. Firestore indexes are never deployed by this workflow — at all

`firebase.westayfit.staging.json` states it in its own comment: *"firestore and storage are
deliberately absent: rules and indexes are not part of any WSF deploy."* The only
`--only firestore` in the file is line 260, `firebase emulators:exec --only firestore
--project demo-goarrive` — the GoArrive rules regression, an **emulator**, not a deploy.

**So the composite index the social feature needs cannot be created by this dispatch.** It
must be created by a separate, reviewed operator action, and it must be **READY** before
the first query that needs it, or that query fails at runtime with the index still
building. This is the precise required operational change, **reported for review, not run.**

### 4c. The `/community/*/members` rewrite is on an operational file, not the app's

Hosting config is supplied by the **ops** checkout: line 375, `cp ../ops/firebase.westayfit.staging.json .`
— the operational file is copied *into* the candidate checkout and is what both hosting and
functions deploys use.

Its current rewrites, in order:

```
/community/*/challenge  ->  /community/__dynamic/challenge.html
/community/**           ->  /community/__dynamic.html
/join/** /contribute/** /display/** /kiosk/** /station/** /event/** /queue/** /combined/**
```

`/community/*/members` is **matched today** — by the `/community/**` catch-all, which serves
`/community/__dynamic.html`, the community **home** document. So the members route would not
404; it would silently render the wrong page. It needs its own rule **before** the catch-all,
exactly as `/community/*/challenge` has one.

That rule has to be added to `firebase.westayfit.staging.json` **on `main`**. Adding it to
the app's `firebase.westayfit.json` does nothing for staging — that file is the production
site's config and the staging deploy never reads it. Its own comment already warns the two
must be kept in sync by hand, and this is exactly the case where that would be missed.

## 5. Which checkout supplies what

| Supplied by the **operational** checkout (`main`) | Supplied by the **candidate** |
| --- | --- |
| `firebase.westayfit.staging.json` (hosting site, rewrites, codebase) | `functions-westayfit/` source and lockfile |
| `.github/wsf-staging/*` — verifier, inventory reader, smoke, cleanup | `apps/westayfit/` source and lockfile |
| `approved-candidate.json` — the SHA, `expectedPriorFunctions`, and now the additions | the built web artifact |
| the workflow file itself, pinned by the WIF attribute condition | |

The WIF provider pins `assertion.workflow_ref == '…/wsf-staging-deploy.yml@refs/heads/main'`,
so no separate workflow can authenticate. Anything operational has to land on `main`.

## 6. The sequence, in the order the receipts have to arrive

1. **Merge the verifier change to `main`** with `candidateAddedFunctions` still **absent**.
   Nothing about the live pin changes; the suite is the evidence.
2. **Add the rewrite** to `firebase.westayfit.staging.json` on `main` (§4c). Reviewed edit,
   no deploy.
3. **Create the composite index** by the separate operator action of §4b, and confirm
   **READY** — not merely requested — before anything queries it.
4. **Pin the candidate**: `approvedAppSha` = the social SHA, `expectedPriorFunctions` stays
   **46** (§3), `candidateAddedFunctions` = exactly
   `["wsfsetcommunityvisibility", "wsfcommunitymembers", "wsfcommunityactivity"]`.
5. **Dispatch `deploy`.** Expected receipt: `INVENTORY_BEFORE=46`, `INVENTORY_AFTER=49`,
   `CREATED_THIS_DEPLOY=` the three, `APPROVED_ADDITIONS=` the three, `EXPECTED_INVENTORY=49`,
   `VERIFY=pass`.
6. **Read the transport line, and expect it to be bad.** `CANDIDATE_SERVICE_TRANSPORT` will
   report each new service. The fifteen turn callables arrived **shut** because the deploy
   service account has no `run.services.setIamPolicy`; there is no reason these three will
   not. That is reported, never asserted open, and a fixture pins it. Opening them is a
   separate approval.
7. **A narrow member / non-member / privacy smoke**, and only then any claim about the
   feature. Application-level authorization is not transport.
8. **Cleanup** as the existing suite does it. **Rollback — corrected, see below.** A
   rollback re-pin that leaves the three services deployed must **retain the exact
   `candidateAddedFunctions` list**, and `expectedPriorFunctions` must describe the
   **measured** BEFORE inventory from a run's own receipt.
9. **A later pin moves `expectedPriorFunctions` to 49** once a run's receipt establishes it —
   never before, and never as an inference from this document.

## 6a. The rollback correction — my error, confirmed by W5

**An earlier version of step 8 said rollback is "re-pin the previous `approvedAppSha` with
`candidateAddedFunctions` removed". That is wrong, and it would have failed the deploy it
was meant to rescue.**

Removing the key restores `EXPECTED` to the 46-name base while the project still holds
**49** deployed services. `verify-deployment.mjs:182` then reports all three as
`present but not expected` and the run fails — the verifier working exactly as designed,
on a procedure that asked for the impossible. Setting `expectedPriorFunctions` to 49 does
**not** rescue it either: that value is checked against the BEFORE inventory by
`read-inventory.mjs` and has no effect on `EXPECTED`. The two are separate mechanisms and
this document previously conflated them.

**The valid rollback**, while the three services remain deployed:

| | |
| --- | --- |
| `approvedAppSha` | the earlier app SHA being rolled back to |
| `candidateAddedFunctions` | **retained, exactly as listed** — the services still exist |
| `expectedPriorFunctions` | whatever a run's receipt **measured**, not a number chosen here |

The key is removed only if the services themselves are removed, and **this workflow has no
supported way to remove a function**: nothing in it deletes a service, the verifier treats a
service present before and absent after as `lost` and fails, and `--only functions:westayfit`
does not prune. Intentional removal would be a separately designed and verified operation,
and nothing in this document should be read as saying the present pipeline supports it.

Also carried from the review, and worth stating where a reader will meet it: **`VERIFY=pass`
with the new callables' transport SHUT does not establish a working member feature.** A
release request has to name any separately authorized transport step and a successful
member / non-member / privacy smoke before any feature-ready claim. No IAM action is
authorized by this document.

## 7. Verification of this change

`node .github/wsf-staging/tests/run-all.mjs` — **exit 0, 14 suites, 335 assertions**,
measured before and after rather than counted by eye: **323 → 335**, and the whole of the
+12 is `verify-deployment` going **16 → 28**. Every other suite is unchanged.

Twelve new fixtures, positive and negative. **Six mutations, each reverted, each caught:**
the duplicate-name guard removed; an unreadable approval degraded to an empty list; the
approved-addition presence requirement dropped; the additions counted as pre-existing; the
name-shape check removed; the additions never widening `EXPECTED`. The fourth is why the
*shut addition is reported, never failed as drift* case exists — it survived until that
case was written, and a mutation that survives is a missing test.
