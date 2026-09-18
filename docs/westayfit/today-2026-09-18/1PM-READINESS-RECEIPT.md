# WE STAY FIT — 1 PM READINESS RECEIPT (2026-09-18, posted 12:46 ET on PR #327)

**VERDICT: BLOCKED.** Candidate B is deployed on isolated staging and 19 of 21 hosted rows passed
(D-5, D-1, all Package E rows, W3, W5, W6, W9, visual proof). The workflow marks the deployment
NOT verified because 2 rows failed: W2's new callable is not publicly invokable (HTTP 403, transport)
and the W4/W7/W8 browser row timed out on `wsf-community-momentum`. No production change. No WIF change.

| Item | Value |
|---|---|
| Staging URL | https://westayfit-staging--staging-4a616y5m.web.app (channel `staging`, expires 2026-09-25) |
| Candidate SHA | `65d258db48a5cfe867c98975b7361425884842cb` |
| Ops `main` SHA | `e67db20141576e91ddeeafa8540dc4eb38afd6c7` |
| Hosted run | 35369383808 — deploy ✓ (`VERIFY=pass`, inventory 24→24, transport 22/22, marker `65d258d`); hosted-verify 19/21; cleanup ✓; evidence artifact 10558241440 |
| Product tests on `65d258d` | tsc clean · Vitest 390/390 · functions build · deploy-config 8/8 · rules 28/28 · callable 342/342 · browser 145/145 · gate1 CLEAR 32/32 |
| Ops suite on `e67db20` | 8 + 6 + 9 + 22 + 11 + 22 + 21 + 11 + 14, all green |
| D-5 proof | hosted `PASS membership status rules (D-5)` against live ruleset `abf890ba…`; local 28/28 |
| D-1 proof | hosted `PASS signup verification gate (D-1)` |
| Cleanup proof | COMPLETE: 274/274 documents deleted, 37/37 synthetic users absent, manifest not preserved |
| Blockers | W2 transport 403 (Google-side; owner decision: align `wsfgoalrecentadditions` with the project's invoker-IAM-check-disabled transport); W4/W7/W8 row unclassified (momentum locator timeout; W4/W8 not exercised hosted); W1/W10/W11/W12/W13 BLOCKED |
| Temporary IAM | custom role `wsfStagingRunInvokerPolicy` still bound to the deployer; removal requested from Devin |
| Production | untouched |

Runs today: 1 (35358182490, A, 12/13) · 2 (35360097324, A, 14/15) · 3 (35362036618, B, deploy failed on invoker policy) ·
4 (35368478133, B, preflight refused 24 vs 23) · 5 (35369383808, B, deploy ✓, hosted 19/21).

## Addendum — run 6 (posted 1:04 PM ET)

Run 6 `35370740710` (`main` @ `294b646`, harness fix #336 for the momentum fixture; candidate unchanged, health marker `65d258d`):
deploy ✓ (`VERIFY=pass`) · hosted **19/21** · cleanup COMPLETE 285/285 · evidence artifact 10557633813 (22 files).
Failing rows: W2 (HTTP 403, transport unchanged — owner decision pending) and W4/W7/W8, which now passes momentum,
share, no-QR-for-member and the W4 guide (screenshots 17–18) and fails at `wsf-community-qr` because the fixture
community is `joinPolicy: 'private'` and the product shows the QR only for `public`/`inviteOnly` (harness fixture
error; fix proposed, not applied). VERDICT unchanged: **BLOCKED** — remaining: W2 transport (owner), temporary IAM
removal proof (owner), W8 fixture fix + one run for 21/21 (authorization pending).
