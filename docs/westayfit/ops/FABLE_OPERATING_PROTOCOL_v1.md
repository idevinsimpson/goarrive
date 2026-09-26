# WE STAY FIT — Fable operating protocol v1

Status: owner-authorized operations improvement packet.
Date: 2026-09-26.
Base: development `938e00d8c985993f69becc8924d3037f18425afc`.
This packet changes coordination and evidence discipline only. It does not authorize a production release, product-policy change, new data collection, or a competing implementation.

## 1. Critical-path rule

The next user-visible North Star milestone outranks secondary scale or cleanup work unless the secondary work is itself blocking a truthful member journey, privacy, data integrity, cross-device contribution, or release safety.

Do not hold an already accepted visible milestone in order to bundle unrelated backend, index, documentation, or future-scale work. Keep those lanes separate.

## 2. North Star is an entry gate, not a late visual check

Before implementation of a member-visible journey, Fable must freeze a route-specific North Star packet:

- Lovable project id and frozen project head;
- journey-specific Lovable product/evidence SHA when one exists;
- exact states and fixtures being matched;
- 390x640 and 390x844 references, plus affected desktop reference when relevant;
- source donor files/tokens or an explicit statement that only rendered evidence exists;
- allowed truth/platform differences;
- navigation, focus, motion and reduced-motion expectations;
- the canonical product files reserved for the implementation.

The implementer must include matched evidence before READY FOR REVIEW. W7 and the Director should verify parity rather than discover obvious visual drift after functional acceptance.

A newer Lovable edit never silently moves a packet already issued. Moving a reference requires an explicit Director decision and manifest update.

## 3. One worker inbox

Every active worker has exactly one canonical inbox. Fable posts each actionable assignment there.

A task PR may contain detailed requirements and evidence, but it is not a substitute for the worker inbox. If the work lives on another PR, the inbox handoff links to it.

A worker is not considered late or idle on an assignment that was never posted to the canonical inbox.

Wake/check-in automation reads the canonical inbox first. Do not create duplicate wakes for the same assignment.

## 4. State-transition reporting

Routine sweeps are silent when nothing changed.

Post or update CURRENT only when one of these changes:
- assignment dispatched or acknowledged;
- product/evidence SHA delivered;
- independent QA verdict;
- Director disposition;
- integration;
- pin created/verified;
- deployment started/completed;
- hosted/device verification;
- blocker introduced/cleared;
- owner decision required;
- freeze/readiness risk materially changes.

Do not post “nothing to act on,” subscription confirmations, or a next-sweep timestamp as standalone progress.

## 5. Acceptance path for visible member work

Normal path:

1. route-specific North Star packet frozen;
2. one implementation owner builds and self-proves functional + visual parity;
3. W7 changed-dependency QA and Director pixel/product review run in parallel when independent;
4. Director accepts the exact product SHA;
5. L0 integrates that exact product;
6. deterministic staging pin is generated and invariant-checked;
7. deploy once;
8. hosted changed-journey smoke runs in the environment that can reach staging;
9. owner test card is generated from accepted QA facts;
10. Devin reviews feel/visuals on device.

Until the deterministic pin tooling is independently accepted, keep the existing pin/W7/Director release gate. After that tooling is accepted, a pin that changes only the approved candidate pointer and passes all unchanged invariants does not require humans to rediscover the product. Any protected-path, inventory, function, rules/index, config, package, or candidate-lineage change still gets explicit human review.

## 6. Changed-journey smoke

Every user-visible staging milestone carries a machine-readable smoke list of the specific journeys changed by that milestone.

Hosted verification must exercise those journeys, not merely prove the site responds and generic backend checks pass. A sandbox known to be blocked from `*.web.app` should not retry the same unreachable smoke every release.

Device verification remains distinct from hosted browser verification.

## 7. Owner test card

Owner test cards are derived from accepted QA rows, not hand-written from memory after deployment.

Each row contains:
- route / entry state;
- exact setup;
- action;
- expected visible result;
- known exclusions;
- build SHA;
- rollback SHA.

The card may simplify language, but it cannot move a behavior to another route, invent a capability, or convert an unverified state into a pass.

## 8. Pull-request hygiene

Each open WSF PR must be one of:
- ACTIVE IMPLEMENTATION;
- ACTIVE QA / OPERATIONS;
- BLOCKED WITH NAMED NEXT OWNER;
- EVIDENCE / EXPORT ONLY;
- WORKER INBOX.

When a product is accepted and integrated by an exact carry/merge, close the superseded implementation PR after posting the canonical integrated SHA. Do not delete the branch or evidence.

Do not keep superseded Phase A/B/restack PRs open merely as historical storage.

## 9. Parallelism

Parallel work is allowed only with isolated ownership and interfaces.

Do not create a second writer for the same route, auth path, contribution ledger, shared navigation shell, rules/index catalog, or deployment workflow.

Visual/reference work may proceed in parallel with backend work when it cannot change product truth or move an issued reference.

## 10. Secondary scale lanes

Performance and scale work such as MEMBER-SNAPSHOT-1 remains important, but it does not displace an already accepted visible release or the expo-critical contribution-to-WE-to-shared-display loop.

A scale lane may become critical when measurements show it blocks normal member use, correctness, privacy, or release readiness.

## 11. Evidence vocabulary

Keep these separate:
- SOURCE INSPECTED
- IMPLEMENTER REPORTED
- TEST VERIFIED
- VISUAL VERIFIED
- DEPLOYMENT RECEIPT
- HOSTED VERIFIED
- DEVICE VERIFIED
- OWNER ACCEPTED

A green unit test is not a visual pass. A deployment receipt is not a device pass. An accepted Lovable reference is not evidence that canonical Firebase behavior works.

## 12. Immediate application

- Community/Settings integrated at `938e00d8` stays isolated and proceeds to its focused staging pin/release.
- MEMBER-SNAPSHOT-1 and its new index remain separate and do not enter that visible milestone.
- The new control-plane automation work is itself a separate operations packet and must not delay the Community/Settings release.
