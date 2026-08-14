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

### 2026-08-14 — production is behind `main` on the music-genre fix

The 2026-08-14 audio hotfix (bundle `165a90d`) was deliberately scoped to audio only —
Path B: #231 fan-out + #235 build fix + #258 voice bypass + #259 blessed-shadow handoff +
the v3 default flip. **PR #233 was excluded on purpose**, because it also carries the
`pauseStripeSubscription` / `resumeStripeSubscription` Cloud Functions, which exceeded the
typed audio-only approval for that deploy.

Consequence, measured against the deployed head:

```
git diff origin/main..<deployed-hotfix> -- apps/goarrive/hooks/useWorkoutMusic.ts
  → main carries #233's genre-revert guard; production does not
```

- [ ] **Production still has the music-genre revert bug.** `advance()` can attach a track
  for a style while `fetchReadyList` is in flight, and the late resolution overwrites it
  with a stale or server-fallback style. Fixed on `main` by #233; not in production.
  Not a regression from the 2026-08-14 deploy — it predates it. Clears automatically on
  the next full production deploy from `main`; no separate action needed, but do not
  re-diagnose it as new.

All four deployed audio components verified present on `main` as of `3073f94`
(#258, #259, #231, #235, plus the default flip via #274). No prod-only code remains.

### 2026-08-14 — iOS volume-bucket feature: prod-readiness gates

Shipped to `main` and working on staging: #273 (`generateMusicVolumeVariants` Cloud
Function), #276 (`maxInstances=10`), #279/#280 (ffmpeg-static packaging — pnpm pinned to
9.15.9 so Cloud Build runs postinstall), #277 (client-side bucket picker + stale-HEAD
guard). Verified end-to-end 2026-08-14 20:01 UTC: five variants generated for a
variant-less track.

The Cloud Function and Storage Rules are **already live on production** — `.firebaserc`
declares a single project, so "staging" is only a Hosting preview channel. What keeps
members off the feature today is that the production Hosting bundle predates #277.

Before the client picker reaches members (needs Devin's typed go for a Hosting deploy):

- [ ] **Variant coverage is not a one-time backfill — it decays.** The catalog is
  18 styles (`apps/goarrive/constants/musicStyles.ts`) × up to `MAX_TRACKS_PER_STYLE = 24`
  = **432 possible tracks**; at 5 buckets each that is ~2,160 objects (~5 GB, storage cost
  trivial). `music_cache` is lazily populated, so only tracks that have actually been
  generated exist — 42 at the time of writing. Every *newly generated* Mubert track is a
  cold miss until its variants render, and `MAX_NEW_GENERATIONS_PER_SESSION = 3` means a
  single member session can mint three of them. Members will therefore hear full-volume
  fallback on genuinely new tracks. Acceptable by design, but decide whether that is the
  intended steady state before wide rollout.

- [ ] **Pre-render warms only 2 of 5 buckets.** `attachTrack` fire-and-forget requests the
  current-slider bucket plus the `0.12` default. A member who moves the slider to a
  different bucket mid-session hits a miss on that bucket until it renders. Backfilled
  tracks have all five; organically-generated tracks do not. Consider warming all five on
  first attach, or accept the gap knowingly.

- [ ] **Hoist the `exists()` short-circuit above `srcFile.download()`** before wide
  rollout. Today a repeat call re-downloads the source MP3 even when all five variants are
  already cached, so steady-state cost is proportional to plays rather than to misses.
  `maxInstances=10` bounds the blast radius but does not remove the waste.

- [ ] **Dedup guard records attempts, not successes** (`useWorkoutMusic.ts`). A failed
  pre-render is never retried for the rest of the session, so a transient error leaves that
  track cold until the next session. `fetchTrack` already does this correctly — mirror it.

- [ ] **No kill switch on the client picker.** It fires on every `swapTrack` on web with no
  flag guard. If it misbehaves in production the only remedy is a Hosting rollback. Worth a
  Remote Config gate before wide rollout, matching the pattern used for PiP.

### 2026-08-11 — PR #237 prod flags

_(Preserve whatever Devin logged in the #237 thread — capture here on next PR-237
prod review so this file becomes the single source of truth.)_

---

## Shipped (struck through)

_(Move items here when they land in prod; keep for audit trail.)_
