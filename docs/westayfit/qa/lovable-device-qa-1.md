# LOVABLE-DEVICE-QA-1 / -2: the Web Twin device matrix, a proof-only staging mode

**Status: delivered for review. Not accepted, not merged, not dispatched.** Nothing was run against the trial host or westayfit-staging. This container cannot reach either host (#394 `6078709181`), which is why the matrix runs as a mode of the trusted staging workflow (route (a)).

| | |
|---|---|
| **Packet** | `LOVABLE-DEVICE-QA-2`: queue #365 `6081290444`, release `6081291520`, owner W4, inbox #394. It is `LOVABLE-DEVICE-QA-1` (queue `6078892265`, release `6079513029`, withdrawn in `6081289315`) plus one reserved path, the staging workflow's mode-list pins, granted in #394 `6081292622`. The route and journey list come from #394 `6078737368` and `6078365393`. |
| **Base** | `main` `7cd5aad3`. |
| **Host / project** | exactly `https://we-stay-fit-foundation-trial.lovable.app` / `westayfit-staging`, refused otherwise. |
| **Proof type** | Source only. Offline tests run against a scripted fake of the Web Twin, the Playwright surface and the fixture kit. Mutation tests ran against the driver and the workflow. |

## What the mode does

`lovable-device-matrix` in `.github/workflows/wsf-staging-deploy.yml` has the `lovable-kiosk` shape. It builds and deploys nothing, and changes no rules, index, IAM or provider. It writes nothing to the Lovable project.

1. **The gate (no credential)** runs `hosted-lovable-device-matrix.mjs --bind`. It hashes the host's entry page and every same-origin `/assets/` file it loads, and compares the set to `REVIEWED_BUILD`. **`REVIEWED_BUILD` ships empty**, so the first dispatch stops here. It prints the observed manifest (asset names and sha256 only) and the document probe below.
2. **The job** binds again before installing anything or authenticating. Then it:
   - authenticates and reads the staging SDK config;
   - seeds **two run-tagged joinable communities** with the existing kit (`joinableEvent`), and the kit writes nothing after that;
   - runs the matrix.

   Every browser context routes every request through the **kiosk harness's reviewed `codeGuard`**. It is reused, not restated: a document or script outside the reviewed build is refused, and the whole matrix stops before anything more is typed.
3. **Cleanup is blocking** (`cleanup-synthetic.mjs` over this run's manifest). The evidence is scanned before upload, and `--require` passes only when every row is PASS and both cleanup and scan succeeded.

## The matrix: 4 viewports × 9 cells, plus 3 run rows

The viewports are small phone **360×640**, phone **390×844**, tablet **820×1180** and desktop **1440×900**. Each viewport runs one fresh visitor in a fresh browser context, with one screenshot per cell (two for `progress-you`).

| Cell | What PASS means |
|---|---|
| `landing` | Signed out, `/` is the product sign-in ("Welcome back") with "New here? Create an account", and no sample data. |
| `display` | Signed out, `/display/<fixture goal>` is `data-display="live"`, with the fixture community, the goal title, the seeded total "120 / 500 confirmed" and "Live · confirmed totals". |
| `invite-link` | Signed out, `/?join=<code>&goal=<goal>` opens the sign-in, the code is gone from the address bar, and the join is held in this tab's sessionStorage. |
| `signup` | "Create account" through the product form reaches the name step ("Step 2 of 2"). The verification send state is honest: the "We couldn’t send your verification email yet…" notice shows exactly when `wsfSendVerificationEmail` did not answer `{sent:true}`. |
| `unverified-participation` | Still unverified, "Your name" → "Continue": `wsfSaveProfile` answers without error and the member app opens. If the server refuses it with `FAILED_PRECONDITION`, the cell and the cells after it are **BLOCKED (backend)**. |
| `invite-join` | The held invite previews "Join Fixture Open Community?". "Join" makes one `wsfJoinCommunity` into this community with `alreadyMember:false`, then the phone choice appears. |
| `camera-fallback` | "Move on my phone" opens the squat camera screen with **"Camera estimate on this device · nothing is recorded or sent"**. With no camera, "Camera isn’t available" → "Enter reps manually" opens the manual sheet, and Escape closes MOVE. **Zero `wsfContribute`** requests. |
| `progress-you` | Progress shows "Your first contribution will appear here". You shows the **verify reminder** ("Verify your email"), the fixture community as **Member**, and the initials avatar **DV** (from "Device Visitor"). |
| `memberships` | A second invite link in the same tab joins the second fixture community, and You lists **both memberships**, one current. |

The run rows are `host-build` (the bind and every document and asset the browser loaded), `fixture-provenance` and `cleanup-tracking`.

**Source reference.** The selectors and copy are the Web Twin's own, read from the Lovable project at commit `397c3b600ee57b9074fc45b61a77286da14de08a`. That source corrected four earlier assumptions:
- There is **no join preview before sign-in**. The invite is captured, stripped and held, and the join card appears only after the name step.
- The **verify screen is skipped**: `verificationDeferred` is always true for a signed-in uid, so the reminder lives on You.
- You's memberships list renders **only with more than one membership**, hence the `memberships` cell.
- Opening MOVE from the phone choice goes straight to the camera.

A pinned build whose screens moved fails its cells by name.

## The visitor accounts and what is cleaned

Each visitor signs up through the product with a run-specific synthetic email, `wsf-<runTag>-dm<viewport>-<hex>@example.com`. That is the cleaner's own provenance pattern. The password exists only in memory.

The uid exists only once the product's sign-up returns it. It is read from that response, and the manifest gets it at once (`mergeExtras`, union, owner-only mode), before the next step. With it go the documents the product may then write:
- `wsfMemberships/<fixture group>_<uid>` for both fixture communities;
- `wsfMemberProfiles/<uid>`, which the cleaner admits through that run-tagged membership.

A join answered for any other community is claimed as linked through the uid. If a sign-up response names no account, that viewport stops before any profile is saved, and `cleanup-tracking` fails by name.

**Not cleaned, named:**
- **`wsfVerificationSends/<uid>`**: three integer counters the product's send keeps per uid. The doc has no uid field, so the cleaner cannot prove it; it is left, keyed by a deleted account.
- **The shared per-IP `wsfPreviewRateLimits` bucket** that the invite preview counts against.

## Limits, and what is not claimed

- **Phone viewports run a desktop Chromium user agent**, by design: the viewport and touch are set, the user agent is not.
  - Per source, the Web Twin's layout is CSS-width-driven (`@media (min-width:900px)`, `max-height:700px`), with no JS width hook on these screens.
  - A mobile user agent would make the Firebase Auth SDK proactively load `apis.google.com` and a `firebaseapp.com` iframe. The code guard would refuse those.
  - Not exercised: the iOS legacy pose engine and the SDK's mobile behaviour.
- **The camera is not granted.** Headless Chromium has no camera, and per source the pose model is fetched only after `getUserMedia` succeeds. So the no-camera path loads nothing beyond `/assets/` chunks, and the counting path is not exercised.
  - With a camera, the model's loader script is served from `/__l5e/assets-v1/…`, which the reused guard would refuse.
  - HopeCard's "Suggest a first step" (a same-origin POST) is not tapped.
- **Not tested on a real device** (no DEVICE tier). **No owner acceptance** is claimed.
- **Screenshots are reported `EVIDENCE_UNSCANNABLE`** by the evidence scanner, which cannot read images. The screens shown hold the synthetic display name and fixture names only: no code, email or password is rendered on them.

## The document question, and the probe

The reused `codeGuard` verifies **every** document the browser loads against the entry page's single reviewed digest. That holds for a single-page shell served identically for every path and request.

The Web Twin is a **TanStack Start** app with server-rendered routes. So two things are facts of the served host that source cannot settle:
- whether `/` is byte-stable between requests;
- whether `/display/<id>` is the same shell.

`--bind` therefore prints a **document probe**: `/` again, `/display/wsfDocumentProbe`, and `/` with an invite query, each with fixed placeholder ids. Each line says whether that document is the same bytes as the entry page. The probe never changes the bind verdict.

If the first dispatch prints **DIFFERENT**, the guard would refuse that document in the run (`host-build` FAIL, matrix stopped). The fix is a reviewed change to the kiosk harness's document rule. That is outside this packet, and it would apply to `lovable-kiosk` equally.

## The pin protocol (agreed, #394 `6081292622`)

1. L0's first dispatch stops in the gate. It prints `LOVABLE_OBSERVED_INDEX`, every `LOVABLE_OBSERVED_ASSET` and the `LOVABLE_DOCUMENT_PROBE` lines.
2. L0 holds Lovable publishes.
3. A reviewed commit pins `REVIEWED_BUILD` in `hosted-lovable-device-matrix.mjs` to exactly those lines. L0 makes it on this branch or as a follow-up.
4. The second dispatch runs the matrix. A build published in between fails both binds by name, before any credential.

## Tests (Node 20)

| Run | Result |
|---|---|
| `node .github/wsf-staging/hosted-lovable-device-matrix.test.mjs` | **14 passed**: the empty pin, the rows and matrix, the verdict rules, the cleanup merge against the cleaner's own provenance rules, the journey at all four viewports (one negative per defect), the guard stop, the CLI with the document probe, and the workflow structure |
| `node .github/wsf-staging/tests/workflow-contract.test.mjs` | **103 passed**. The granted hunks only: the mode in the options pin, the job in `order` and in both job lists, and `'lovable-device-matrix': false` in the six `reachedJobs` tables |
| `node .github/wsf-staging/tests/run-all.mjs` | all suites passed |
| `node .github/wsf-staging/tests/hosted-lovable-kiosk.test.mjs` | 21 passed (the reused harness, unchanged) |
| `node tools/wsf-control/run-all.mjs` | all suites passed |
| `actionlint` 1.7.7 on the workflow | clean |
| Driver mutants (14) | **all killed**. The defects: tracking dropped; the address-bar strip, held join, send-state honesty, sample-data, contribution and memberships checks dropped; backend refusal mislabelled; a foreign join not claimed; the guard stop removed; the tour never dismissed; no wait for a tracked account; a run behind a refused bind; untagged documents admitted |
| Workflow mutants (8) | **all killed**. The defects: the bind after authentication, re-authentication after a refused bind, an upload without a passing scan, a non-blocking cleanup, the gate bind removed, a negation gate, an install with lifecycle scripts, an added secret |

The new suite lives at its reserved path beside the harness, not under `tests/`. `tests/run-all.mjs` lists suites explicitly inside another packet's reservation, and it does not list the kiosk suite either. So the suite is run directly; adding it to that list belongs to a later change there.
