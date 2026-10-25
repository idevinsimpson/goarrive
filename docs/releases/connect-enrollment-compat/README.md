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
