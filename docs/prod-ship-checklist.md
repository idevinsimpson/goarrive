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

- [x] **Pre-render warms only 2 of 5 buckets.** ~~`attachTrack` fire-and-forget requests the
  current-slider bucket plus the `0.12` default.~~ **Fixed on PR #285 (pending merge).**
  Confirmed live, not theoretical: a 2026-08-14 Storage audit (18 styles × tracks 1–24 ×
  five buckets, HEAD per object) found `edm/track_2` holding exactly `gain_025` + `gain_012`
  and nothing else — the precise fingerprint of the two-bucket warm. `attachTrack` now warms
  all of `VOLUME_BUCKETS`. **Cost re-measured and it was cheaper than assumed:** the callable
  takes a bucket array, so five buckets is the *same single invocation* and one source
  download, not 2.5×.

  This stopped being optional when #285 landed the slider-driven re-pick: the shadow now
  re-points on every bucket crossing, so any unrendered bucket 404s to full volume and reads
  to the member as "the volume control does nothing."

- [ ] **Hoist the `exists()` short-circuit above `srcFile.download()`** before wide
  rollout. Today a repeat call re-downloads the source MP3 even when all five variants are
  already cached, so steady-state cost is proportional to plays rather than to misses.
  `maxInstances=10` bounds the blast radius but does not remove the waste.

- [x] **Dedup guard records attempts, not successes** (`useWorkoutMusic.ts`).
  **Fixed on PR #285 (pending merge)** — the keys are now released when the callable
  rejects, mirroring `fetchTrack:220`. The same Storage audit found `edm/track_15` with
  **zero** buckets despite having a full-volume source, which is what this bug produces:
  one transient failure marks the track done for the session and it never retries.

  **Still requires a one-time manual backfill.** The fix stops the gap recurring; it does
  not retroactively render tracks that are already partial. `edm/track_2` and
  `edm/track_15` need `generateMusicVolumeVariants` run for all five buckets, and must be
  re-verified by HEAD rather than by the callable's response — per-bucket failures still
  return 200 (open item below).

- [ ] **No kill switch on the client picker.** It fires on every `swapTrack` on web with no
  flag guard. If it misbehaves in production the only remedy is a Hosting rollback. Worth a
  Remote Config gate before wide rollout, matching the pattern used for PiP.

### 2026-08-14 — render-pipeline Cloud Functions are on `main` but NOT deployed

#262 merged (`d779cb0`) adds two deployable Cloud Functions plus their helpers:

- `renderWorkoutVideo` — Firestore `onWrite` trigger that enqueues a render job
- `renderJob` — authenticated Cloud Run **service** (HTTP; not a Cloud Run Job)
- supporting: `renderContract`, `renderFfmpeg`, `renderState`, `renderServiceTarget`,
  `renderedVideoResolver`

**None of it is deployed.** Merging to `main` changed no production behavior. But a
blanket `firebase deploy --only functions` would now deploy `renderWorkoutVideo`, because
deploy targets are manual and `npm run deploy` is `--only hosting`. Anyone doing a broad
functions deploy for an unrelated reason should know this is in the tree.

Mitigating factor, verified: `parseRenderServiceTarget` **throws** on a missing
`RENDER_SERVICE_URL`, a non-https URL, a hostname that is not `*.run.app`, any hostname
matching `/placeholder/i`, or a URL carrying credentials/port/query/fragment. So if the
trigger is ever deployed unconfigured it fails fast and loudly rather than silently
enqueueing to a dead endpoint. That is the desired failure mode, not a reason to deploy it
casually.

Before the render pipeline may run at all — each requires Devin's explicit go, since
AGENTS.md §6 excludes Cloud Functions changes from standing approval:

- [ ] Create the Cloud Tasks queue `render-workout-video`.
- [ ] Build and deploy the Cloud Run service from `docker/renderWorkoutVideo.Dockerfile`
      (system `ffmpeg` via apt — deliberately not the npm `ffmpeg-static` package, which is
      what broke Cloud Build packaging on 2026-08-14 and needed the pnpm@9.15.9 pin).
- [ ] Set `RENDER_SERVICE_URL` to the deployed service origin.
- [ ] Deploy `functions:renderWorkoutVideo`.
- [ ] Decide storage lifecycle for rendered MP4s before volume grows — a 40-minute workout
      renders to ~44 MB at 720p, so a few hundred workouts is real storage and egress.

See `docs/render-workout-video-service.md` for the service contract and the
`contracts/rendered-video/emitter-player-contract-v1.json` fixture that locks the
emitter↔player agreement.

### 2026-08-14 — `useRenderedVideoPlayback` has NO effective test coverage (false green)

`apps/goarrive/hooks/__tests__/useRenderedVideoPlayback.test.tsx` **has never executed a
single assertion.** It fails at collection with `SyntaxError: Unexpected token 'typeof'`,
so vitest reports it as one failed *suite* while the aggregate test count still reads
green. Verified pre-existing on clean `main` (stash + re-run in isolation).

This matters more than a normal broken test: `useRenderedVideoPlayback` is the **client
half of the continuous-video feature** — the dual-mode playback hook the render pipeline
exists to feed. The render service is being built on top of a hook whose tests are
decorative.

Root cause, traced end to end — it is **not** a `.tsx` transform gap:

1. `@testing-library/react-native` is CommonJS, so vitest **externalizes** it.
2. Externalized deps never enter vite's transform pipeline, so the
   `^react-native$` → `react-native-web` alias in `vitest.config.ts` **does not apply to
   them**.
3. It therefore resolves bare `react-native` through Node and loads the real
   `node_modules/react-native/index.js`, whose line 27 is Flow syntax:
   `import typeof * as ReactNativePublicAPI from './index.js.flow';`

General lesson: **the RN→RN-web alias protects our own source only.** It cannot protect a
CommonJS dependency that imports React Native itself.

**A config-only fix does not work — do not spend time re-attempting it.** Tried and
measured 2026-08-14, both reverted:

- `test.server.deps.inline: [/@testing-library\/react-native/]` — still throws.
- `test.server.deps.inline: true` (inline everything, as a diagnostic) — still throws.

Reproduced in isolation with a one-line probe (`await import('@testing-library/react-native')`),
and confirmed outside vitest entirely with `node -e "require('@testing-library/react-native')"`,
which produces the same error with a full stack ending at `react-native/index.js:27`. Pulling
the dependency into vite's transform pipeline does not make the alias intercept its
resolution of bare `react-native`.

So the migration below is the only route; there is no config shortcut.

Fixing the import alone is not sufficient — there are three blockers, and the second and
third only surface once the first is cleared:

- [ ] **Migrate off `@testing-library/react-native`** to `test-utils/renderHook.ts`
      (the pattern #270 applied everywhere else). This is the only file in the repo still
      importing it.
- [ ] **Add an element-level render helper.** `test-utils/renderHook.ts` exports `act` and
      `renderHook` (with `rerender`/`unmount`), covering 29 call sites — but the test at
      `:652` does a standalone `render(<CommitTimeVideoSwapHarness …/>)`. Do **not** delete
      that case to clear the import: it covers the ref-identity reattach bug (#266) where
      React replaces the committed element under a stable ref.
- [ ] **Convert 20 × `jest.fn()` → `vi.fn()`.** `test-setup.ts` is a single line
      (`@testing-library/jest-dom`) with no `jest` shim; vitest supplies `vi`. This file is
      the only one in the repo using `jest.*`.

**Done means the assertions pass, not that the file collects.** If they fail once they run,
that is a real defect in already-merged code and must be resolved before more render work
stacks on top. Sequence after PR #267 merges — #267 touches both this test file and
`useRenderedVideoPlayback.ts`. (`vitest.config.ts` is *not* in #267's diff.)

### 2026-08-11 — PR #237 prod flags

_(Preserve whatever Devin logged in the #237 thread — capture here on next PR-237
prod review so this file becomes the single source of truth.)_

---

## Shipped (struck through)

_(Move items here when they land in prod; keep for audit trail.)_
