# Prod Ship Checklist — REQUIRED-BEFORE-PROD

Living list of items that MUST land (or be explicitly deferred by Devin) before
any prod deploy. Staging deploys are exempt — this list only gates production.

Maintenance rule: append new items with date + PR context. When an item ships,
strike it (do not delete) so the audit trail survives.

---

## Open — pending

### 2026-08-11 — Phase 4 funnel (PR #240, #242, #243) audit flags

- [ ] **Hard-error the $19.99 fallback in `createFunnelCheckoutSession`** —
  `functions/src/index.ts:933` currently falls back to a hardcoded $19.99 price
  when `pricePerMonthCents` is missing on the folder or path (see warn/error
  paths at :1025, :1032, :1035, :1041). Replace fallback with a hard error and
  surface the failure in the coach UI so misconfigured Program Paths cannot
  silently overcharge/undercharge.

- [ ] **Chunk/background the `enrollSubscriber` duplication engine** —
  `functions/src/index.ts:1581`. Current implementation duplicates the coach's
  playbook tree inline in the callable. For coaches with large libraries this
  will hit the 60s callable timeout. Move duplication to a background task
  (Cloud Tasks or Firestore trigger) with chunked writes.

- [ ] **Dedup / mark-as-sent guard on the drip queue** — a subscriber retrying
  or resuming after failure should not receive the same drip email twice. Add a
  `sentAt` marker per (subscriberId, dripIndex) and short-circuit if present.

- [ ] **Rate-limit guest onboarding writes** — funnel entry (onboarding
  questionnaire submissions) currently accepts unauthenticated writes without a
  per-IP or per-fingerprint rate limit. Add throttling before we open the CTA to
  paid traffic (Justin's video / marketing spend).

### 2026-08-11 — PR #244 (lapsed-payment) audit follow-ups

- [ ] **Dunning schedule** — current `handleInvoicePaymentFailed` sends ONE
  email at lapse only. Add a proper dunning cadence (e.g. Day 0 / Day 3 / Day 7)
  before we take real Stripe payments in prod.

- [ ] **Resend template + unsubscribe** — the lapsed-payment email is inline
  HTML with no unsubscribe link. Move to a Resend template with a proper
  unsubscribe header/footer before prod (CAN-SPAM).

- [ ] **Members-list N+1 → `paymentStatus` on member doc** — the members list
  currently reads `memberSubscription` per row for the PAUSED badge. Denormalize
  `paymentStatus` onto the member doc via a subscription-write trigger so the
  list stays O(1) per row.

- [ ] **`notification_log` read-rule check** — verify Firestore rules allow the
  coach dashboard to read `notification_log` rows filtered by `coachId`;
  otherwise the "member payment lapsed" notification never surfaces in the UI.

### 2026-08-12 — Funnel rules gap (P0 — surfaced by sweep Test 5)

- [ ] **Unauthenticated funnel readers cannot load `playbook_folders` / `coaches`.**
  The onboarding page at `apps/goarrive/app/(funnel)/onboarding/[coachId]/[folderId]/index.tsx:117-118`
  and the checkout page at `apps/goarrive/app/checkout/[submissionId].tsx:79`
  both `getDoc` directly from the unauth client, but `firestore.rules:1111-1116`
  requires `isAuthenticated()` on all `playbook_folders` reads. Shared links
  therefore 404 on the details fetch (submission create still works — that has
  a public-create carve-out). Requires a rules change, which is
  outside standing approval (AGENTS.md §6). Two options for Devin — see the
  A/B in `#dev-goarrive` kickoff thread. No rules deploy until he picks.

### 2026-08-11 — PR #237 prod flags

_(Preserve whatever Devin logged in the #237 thread — capture here on next PR-237
prod review so this file becomes the single source of truth.)_

---

## Shipped (struck through)

_(Move items here when they land in prod; keep for audit trail.)_
