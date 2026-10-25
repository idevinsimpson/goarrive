# Connect enrollment compatibility artifact — review only

This PR does not change deployable app or Functions source. It publishes sanitized captured source and a reproducible compatibility diff for independent review. No credentials, Firebase document records, real payment events, or environment files are included. Do not deploy main wholesale or treat this documentation PR as permission to deploy another component.

The reviewed/published source tree is main cbb4221c48f199bdb8dad5d9228335f40b0ee643 (tree05ff3ee9fd62fcb43c8039afa608d610729424c1). The standard stripeWebhook's eight event handlers match its pre-release deployed source. The separate stripeConnectWebhook is older and must retain three differences:

1. Ignore invoice.payment_succeeded, retaining invoice.paid behavior.
2. Retain deployed handleInvoicePaymentFailed, without adding the newer lapse/queue/email side effects.
3. Retain deployed handleSubscriptionUpsert.

Only the already-reviewed enrollment clone helper is intended to change Connect behavior. All nine dispatch/handler bodies match the generation-pinned captured Connect source; enrollSubscriber remains identical to reviewed source. Full private source archives remain local rollback artifacts; this directory includes only the nine non-secret function declarations needed to inspect preservation.

Run after installing the repository's existing Functions dev dependencies:

    node docs/releases/connect-enrollment-compat/verify.cjs
    node docs/releases/connect-enrollment-compat/test-dispatch.cjs

The first command reconstructs the candidate in memory and verifies exact hashes, allowed source changes, nine handler equivalences and enrollment identity. It writes nothing. The second runs44 synthetic dispatch/duplicate/failure comparisons; it makes no network/database/provider calls. Four enrollment clone contracts and a full TypeScript build also passed on the exact generated artifact. The initial clone test invocation lacked its relative app source fixture; restoring that unchanged reviewed fixture fixed it without changing assertions.

compatibility.patch is the complete candidate index.ts difference. evidence.json contains capture timestamp, deployed function source generation/revision, hashes and results. Before any release, require independent review, freshly confirm the deployed Connect generation is unchanged, rebuild TypeScript and deploy ONLY functions:default:stripeConnectWebhook from the generated artifact. Never deploy this altered bundle to the standard stripeWebhook. Future general deployment from main must preserve this per-function source distinction until a separately reviewed source consolidation resolves it. No Connect deployment has happened yet.

## Expanded live-function proof
captured-dependencies.ts.txt now includes the exported Connect signature wrapper, secret-name bindings (no values), getStripe/API version, db binding, all reachable event handlers, and pre-change live enrollSubscriber. verify.cjs traverses15 reachable local declarations and proves every one matches captured live source except the exact replacement of the old template spread/three timestamp deletions with enrollmentCloneFields(template,newPlaybookRef.id,memberId). It also verifies that helper's reviewed source hash.

Run `node docs/releases/connect-enrollment-compat/test-signature.cjs` for four exact-wrapper cases using the installed Stripe SDK's local signature verifier: valid, missing, invalid, and tampered payload. Inputs are synthetic; no network or actual billing handlers execute. The44 dispatch cases prove dispatch/duplicate/error equivalence only. Together with the full handler-source equivalence this supports the intended clone-only delta; it is not a live Stripe E2E claim.

candidate-manifest.json freshly hashes103 complete source, emitted JS/map and package/config files from the built candidate. No environment/credential files are included. Production dependency versions and runtime match captured deployment; the sole lockfile version addition is dev-only ffprobe-static3.1.0, already present in reviewed main for test validation. Captured source contains only secret parameter names, not secret values; signature test material is explicitly synthetic. The complete candidate index hash remains0cf38cd72c88b6fe2978da158c17effb76f92b5a7567c380161c1df4635d934e.
