# LOVABLE-KIOSK-HOSTED-PROOF-1: the Lovable kiosk proof mode (source)

Director queue #365 `6044515892`, release `6044894488`; W3, inbox #396. **Source only.** No run has happened, and nothing here is a hosted pass.

## What it adds

There is one new mode in the existing trusted staging workflow, `mode=lovable-kiosk`. It is proof only: it builds nothing, deploys nothing, and changes no rules, indexes, IAM or providers.

It runs against exactly `https://we-stay-fit-foundation-trial.lovable.app` and the `westayfit-staging` project. Any other host or project is refused.

| Step | Where | What it does |
|---|---|---|
| 1. bind | `gate` (no credential) | `hosted-lovable-kiosk.mjs --bind`: reads the served page and every same-origin asset it loads (bounded, no redirects, no other origin), hashes each one, and compares the set to `REVIEWED_BUILD`. Exit 0 only on an exact match. |
| 2. bind again | `lovable-kiosk`, before authentication | The same check. Drift since the gate stops the job, and no credential is minted (the re-authentication step requires `steps.bind.outcome == 'success'`). |
| 3. proof | `lovable-kiosk` | `--run`: seeds run-tagged fixtures with the existing kit, `journeys/fixture-kit.mjs`; no new account maker. It drives the real Lovable UI in Playwright, from the candidate's pinned CLI. |
| 4. cleanup | always, blocking | `cleanup-synthetic.mjs` over the run's manifest. The product-written membership is merged in only if it is run-tagged. |
| 5. scan, upload | always | `scan-evidence.mjs`; the upload happens only if the scan passes. |
| 6. verdict | always | `--require`: PASS only when every row passed **and** cleanup succeeded **and** the scan succeeded. |

**`REVIEWED_BUILD` is empty in this change.** The first dispatch therefore stops in the credential-free gate with `LOVABLE_BUILD=BLOCKED`, and prints `LOVABLE_OBSERVED_ASSET <name> <sha256>` lines. A separately reviewed commit has to pin those digests before any authenticated run.

The digests could not be computed from W3's session: its proxy refuses the Lovable host (CONNECT 403). That refusal was not worked around.

## Rows

| Row | How it is measured | Status in this source |
|---|---|---|
| host-build | the exact reviewed digests | BLOCKED until a digest manifest is pinned |
| fixture-provenance | kit `expoEvent` (Champion, community, goal) plus two `memberInTwoCommunities` accounts that are **not** members of the event community | measured |
| qr-join | the kiosk's `data-join-url` must be on the same host and name this goal; A signs in through the product UI and presses **Join**; the membership is tracked | measured |
| queue-place, call, phone-ready, expected-turn-start, round-60s, review, station-finish | — | **BLOCKED**: the safe station backend (#587) is not accepted or served, and an older station path is never driven |
| contribution-7 | exactly one `wsfContribute` request | measured |
| operation-receipt | the decoded `wsfContribute` result: this goal, an attempt, `addedCount === 7`, and a `sharedTotal` the screen shows | measured |
| own-history-shared | after a reload, `wsfMyContribution` up by exactly 7 and `wsfGoalPulse` equal to the receipt | measured (BLOCKED if a read is absent) |
| reopen-static | no replayed receipt and no second contribution | measured |
| account-isolation | A → B in one browser, then A in a fresh context: same identity and same own total | measured |
| unverified-account | — | **BLOCKED**: the kit makes verified accounts only (#396 `6043231980`); verification is never faked |

### Honest limits

- **Champion approval.** The Champion's approval goes through the kit's Champion callable (`approveStation`, tracked for cleanup), not through the Champion UI. The visitors' sign-ins do go through the product UI.
- **Secrets.** Passwords stay in memory in the kit. Identities appear only as sha256 prefixes, and the results scrub emails and query values. No stored password, organizer storage or repository secret is used.
- **Lovable project.** Nothing is written to the Lovable project.

## Proof (offline)

- **`tests/hosted-lovable-kiosk.test.mjs`: 10 passed.**
  - It covers the exact host, the same-origin bounded asset walk (a cross-origin `/assets/` path is ignored) and the binding (empty, exact, changed, extra, missing).
  - It also covers the receipt rule, the fixed BLOCKED rows and the scrubbing, the require verdict and the run-tagged merge.
  - The journey runs against a scripted fake of the Lovable UI and the kit.
  - **Mutants:** 10/10 killed.
  - Writing it caught one real defect, now fixed: the walker took the `/assets/` path out of another origin's URL.
- **`tests/workflow-contract.test.mjs`: 103 passed.** The mode list is pinned at seven; `lovable-kiosk` is reached only by its own mode; the bind comes before authentication; the job builds and deploys nothing and holds no stored secret; cleanup is blocking; and the scan comes before the upload and the verdict.
- **`run-all.mjs`: all suites passed.**
- **Not yet in `run-all`.** The new suite is not registered there, because `run-all.mjs` is outside this packet's five reserved paths. It runs directly: `node .github/wsf-staging/tests/hosted-lovable-kiosk.test.mjs`.

## Before an authenticated run

1. Ops-source review, security review, and Director acceptance of the exact head.
2. One dispatch of `mode=lovable-kiosk`, which stops at the gate and prints the observed manifest.
3. A reviewed commit that pins `REVIEWED_BUILD` to that manifest.
4. The authorized proof run. Rows that remain BLOCKED (the station turn, the unverified account) fail it by name.
