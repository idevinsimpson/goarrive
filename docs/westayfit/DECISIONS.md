# We Stay Fit — Decisions Log

Append-only. Each entry: date, decision, alternatives considered, reason chosen.

## 2026-08-26 — Single Firebase project for both apps

Chose: keep WSF inside the existing `goarrive` Firebase project as a second Hosting site + second functions codebase.

Alternatives considered:
- Separate `westayfit` Firebase project (rejected: doubles the infra footprint, splits auth users, creates cross-project boundary for a shared user base intent).
- WSF as a route inside `apps/goarrive/` (rejected: forces shared theming, shared bundle, shared function claims — kills the "second first-party app" property).

Reason: single project keeps auth users unified and infra minimal; separation is at Hosting site + functions codebase level, which is Firebase's supported isolation boundary for multi-app-per-project.

## 2026-08-26 — Playwright config self-contained inside `apps/westayfit/`

Chose: `apps/westayfit/playwright.config.ts` with its own `testDir` and `WSF_PLAYWRIGHT_BASE_URL`, invoked via `npm --prefix apps/westayfit run test:e2e`.

Alternative considered:
- Add a new project entry to the existing root `playwright.config.ts` (rejected: a bare `npm run test:e2e` at the repo root would then silently pull WSF specs into a GoArrive regression run — exactly the regression surface M-U1 exists to prevent).

Reason: matches the pattern of separate `firebase.westayfit.json` config for Hosting and separate `functions-westayfit` codebase for functions — one boundary per surface.

## 2026-08-26 — Zero custom claims for WSF users, static-guard enforced

Chose: WSF functions must never call `setCustomUserClaims`; a Vitest static guard fails if any WSF-path file contains the string.

Reason: 8 GoArrive claims call sites, 7 replace the whole claims object (index.ts:1892/2945/3099/3221/3318/11060, leads.ts:214). Any WSF claim on a shared user would be silently clobbered by them. The lone merge-style site (`setAdminRole` at index.ts:6460) is the exception that proves the codebase has no consistent merge convention. Enforcing zero-claims at the WSF boundary is cheaper than trying to normalize the GoArrive writers.

## 2026-08-26 — Own copy of `inject_meta` for WSF (no shared script)

Chose: `scripts/westayfit/inject_meta` is a minimal Python script (title, description, `<meta name="robots" content="noindex,nofollow">`) — not a shared script with mode flags.

Alternative considered:
- Extend `scripts/inject_pwa_meta.py` with a `--app` flag (rejected: shared script becomes the merge hazard; GoArrive's inject script has PWA manifest, service worker, fonts, Safari CSS, error handlers that WSF actively does not want).

Reason: WSF's meta needs are a strict subset of GoArrive's; a smaller own-script is more auditable and cannot regress GoArrive.

## 2026-08-26 — No SPA catch-all rewrite in `firebase.westayfit.json`

Chose: omit the `"rewrites": [{ "source": "**", "destination": "/index.html" }]` block that a typical SPA hosting config includes. Unknown routes are served by the Expo static export's own `+not-found.html` page (which returns a real HTTP 404 with correct semantics).

Alternative considered:
- Add the standard SPA catch-all so any URL renders the app shell and lets client-side routing decide (rejected: `/definitely-not-a-real-wsf-route` would then return HTTP 200 with the brand shell, not 404 — worse SEO and worse user signaling for a `noindex` site whose whole point is not to accumulate garbage indexed URLs).

Reason: WSF has two real routes (`/`, `/health`) plus the auto-generated `+not-found` and `_sitemap` — the static export covers them by construction, so the SPA rewrite is unnecessary and actively harmful for 404 semantics. Verified by the live-channel Playwright spec `unknown-route.spec.ts`: `GET /definitely-not-a-real-wsf-route` returns 404 with no GoArrive leakage.

Called out on PM review of PR #299 as an accepted deviation from the dispatch spec (which implied a rewrite would be present).

## 2026-08-26 — M-U1.1 correction: `/health` shows real commit; home tagline is chartered sentence; specs enforce spec, not implementation

Chose (after PM visual smoke of the first M-U1 deploy):

1. `/health` reads a build-time-injected commit SHA (`EXPO_PUBLIC_BUILD_COMMIT`, set inline in the `build:web` script via `git rev-parse --short HEAD`). The `dev` string is kept as a fallback for local dev only (when the app is served via `expo start` without the build wrapper). Playwright spec `health.spec.ts` now asserts the deployed value is not `dev` and matches the short-SHA regex `^[0-9a-f]{7,40}$`.
2. `/health` no longer shows the Firebase project row. `wsfFirebaseProjectId` is not verification data — publishable, but non-diagnostic — so the stamp is now App, Version, Commit, Built at (as per the PM's stated intent).
3. Home tagline is the chartered sentence: *"Wherever your people gather, We Stay Fit."* (from `UNIVERSAL_COMMUNITIES_CHARTER.md`). Playwright spec `home.spec.ts` now asserts that literal string, not the implementation copy.

Alternatives considered:
- Injecting the commit at runtime via a Firebase Function or a `/health.json` endpoint (rejected: adds infra weight for a static-truth artifact; env at build time is the smaller mechanism and stays inside the WSF app boundary).
- Keeping the `Firebase project` row for informational purposes (rejected on PM's read: the project ID is fixed to `goarrive` for the life of the app; it teaches nothing at diagnosis time).
- Asserting only that the commit stamp is non-empty (rejected: that was the original spec and it silently passed against the `dev` fallback string — the whole point of `/health` is defeated).

Reason: `/health` is the deploy-truth artifact. If it can lie, it is worse than not existing. The spec now enforces the invariant.

Process lesson (recorded here so future WSF work does not repeat it):
- Specs must assert the *specified* copy, not the *rendered* copy. When the two diverge, the spec should fail — that is the whole reason the spec exists.
- Visual smoke by a human is authoritative for defects that only show up on-screen (wrong copy, placeholder values, contrast, layout). Automated tests catch what they were written to catch; they cannot catch what they were not.
- `expo export` must run with `--clear` when the bundle depends on a build-time env var whose value can change between builds (e.g. `EXPO_PUBLIC_BUILD_COMMIT`). Metro's transform cache does not include env var values in its cache key, so a rebuild after `git commit` will silently reuse the previous value's bundle. `build:web` uses `--clear` for this reason. The `dist/health.html` SSG output does re-render with the fresh env var, so mismatch is only visible in the hydrated JS bundle — and the Playwright health spec only regex-checks the SHA shape, not the value, so this failure mode is silent unless caught by human smoke.

## 2026-08-26 — Record `ls-remote` check permanently in truth gate

Recorded in Maia's session memory: before any `git worktree add -b <branch>`, run both `git branch --list <branch>` AND `git ls-remote origin refs/heads/<branch>`. Stop on any output.

Reason: catches stale remote branches from prior workers/attempts that the local checkout has never heard of; `branch --list` alone misses that entirely.

## 2026-08-27 — Brand language hierarchy (WITHDRAWN — attribution was incorrect)

This entry recorded a slogan/explainer/campaign-line hierarchy and marked it "Devin-approved",
citing "Devin's written approval during the 2026-08-27 delegated-autonomy window". That
attribution is incorrect: the copy recorded here is not what the owner approved, and the cited
approval could not be verified. The entry is withdrawn rather than silently amended so the error
itself stays on the record.

The wording it carried has been removed from this log and from the app so it cannot be picked up
again by grep; it remains recoverable from git history if it is ever needed for audit.

Superseded by the 2026-08-31 entry below, which carries the actual final copy.

## 2026-08-31 — We Stay Fit brand copy (corrects the 2026-08-27 entry)

Chose: the final brand copy.

- **Wordmark:** WE STAY FIT
- **Tagline:** Turn your community into a place that moves.
- **Supporting line:** Shared challenges. More movement. Stronger communities.

**Source:** *We Stay Fit Universal Communities PM Handoff (Revised 2026-08-31)*, §1 "Your
Appointment and Mission", §1.1 "Approved messaging and interpretation", and Appendix A.1 "Current
messaging decisions", supplied by the owner (Devin Simpson) on 2026-08-31. Appendix A.1 lists the
tagline and supporting line above as current, and lists the strings below as superseded. That
document is the citation for this entry; it is not held in this repository.

Corrects: the 2026-08-27 "Brand language hierarchy (Devin-approved)" entry above. That entry's
copy is listed as superseded by the source document, and its own approval citation ("Devin's
written approval during the 2026-08-27 delegated-autonomy window") could not be verified against
any artifact; it is withdrawn.

**Supersession carried forward — both of these are superseded and neither is canonical:**

- "Your place. Your people. Your move." — from the withdrawn 2026-08-27 entry.
- "Wherever your people gather, We Stay Fit." — the M-U1-era chartered tagline. The 2026-08-27
  entry had recorded this supersession; that clause is restated here so it is not lost with the
  withdrawal. This also supersedes item 3 of the 2026-08-26 M-U1.1 entry above, which recorded
  that sentence as the home tagline and had `home.spec.ts` asserting it. The spec now asserts the
  copy in this entry.

Alternatives considered and rejected by the owner:
- "Start a community. Choose a challenge. Invite your people." as the primary explainer — rejected
  because it makes the reader feel responsible for starting or recruiting something. Someone should
  be able to simply *join* what their community is already doing.
- The word "participation" — rejected as too institutional.
- Apartment-specific language — deliberately dropped; the copy is not tied to one venue type.

Reason: the tagline keeps the **community** at the center rather than the app, the coach, or the
workout — the community is the product. The supporting line names the mechanism (shared
challenges), the behaviour (more movement), and the outcome framing the owner wants (stronger
communities).

Rules carried forward from the withdrawn entry (still in force): WSF-only — GoArrive brand
language is unchanged; sparing contextual variants are acceptable where they serve the tagline;
no outcome claims (health, ROI, retention, leasing, productivity, growth) derive from this copy.

Historical M-U1-era uses, releases, and evidence artifacts are not rewritten.

## 2026-08-31 — One targeted hosting rewrite for the dynamic community route (amends the 2026-08-26 "no SPA catch-all" entry)

Chose: add exactly one rewrite to `firebase.westayfit.json` —
`/community/**` → `/community/__dynamic.html` — and have `inject_meta.py` emit that
alias file plus fail the build if any exported dynamic route lacks a rewrite.

Why the earlier decision needed amending: it was made when WSF had two static routes
(`/`, `/health`), and it reasoned correctly for that shape. M-U2 introduced the first
*dynamic* route, `app/community/[groupId].tsx`, which Expo exports to the literal file
`dist/community/[groupId].html`. Firebase Hosting has no way to serve that for
`/community/<id>`, so a direct load, refresh, bookmark, or shared community link
returned **HTTP 404**. In-session `router.replace()` worked, which is exactly why it
went unnoticed: the happy path never touches the URL.

Alternatives considered:
- The standard SPA catch-all `**` → `/index.html` (rejected, same reason as
  2026-08-26: it would make every unknown URL return 200 with the brand shell. The
  targeted rewrite fixes the one broken route and leaves 404 semantics intact
  everywhere else — `/definitely-not-a-real-wsf-route` still 404s).
- A rewrite whose destination is the bracketed path itself (rejected: relies on
  unverified handling of `[` and `]` in a Hosting `destination`; the alias file is
  deterministic and needs no such assumption).

**Correction to the 2026-08-26 entry:** it stated that unknown routes are "served by
the Expo static export's own `+not-found.html` page (which returns a real HTTP 404
with correct semantics)". The 404 status is real, but the page is not: Firebase
Hosting only auto-serves a custom 404 from a file named exactly `404.html`, and the
export produces `+not-found.html`, which Hosting never reaches for. Unknown routes get
Firebase's default 404 page. The existing `unknown-route.spec.ts` still passes because
it asserts a 404 status with no GoArrive leakage — both still true. Serving the
Expo not-found page would require emitting it as `404.html`; not done here, and not a
blocker.

Reason: a community link that breaks when someone refreshes or shares it defeats the
point of a community app. The build-time guard exists because this defect was created
by a decision that was correct when written and silently expired when the route shape
changed — the next dynamic route should not be able to repeat that.

## 2026-08-31 — Force an ID-token refresh after email verification

Chose: `await user.getIdToken(true)` in `verify-email.tsx` immediately after `reload(user)`
reports `emailVerified`, before routing onward.

`reload()` updates the local `User` object but does **not** refresh the cached ID token.
The client gate (`user.emailVerified`) therefore passed while the token still carried
`email_verified: false` — and both `firestore.rules` (`wsfEmailVerified()`) and
`wsfCreateCommunity` gate on the **token** claim. Every newly verified member hit
`PERMISSION_DENIED` on the very next write and was dead-ended one step after verifying,
unless they happened to sign out and back in. Reproduced deterministically on the
emulator harness.

Reason: the token is the security boundary, so the token is what has to be current.
Client-side `emailVerified` is a display value; treating it as the gate makes the UI and
the rules disagree.

## 2026-09-01 — Emulator wiring in the WSF app, guarded twice

Chose: `apps/westayfit/src/firebase.ts` connects to the Auth, Firestore and Functions
emulators when `EXPO_PUBLIC_WSF_USE_EMULATORS` is set **and** the page is served from a
loopback hostname. Both conditions, always.

Why it was needed: the app had no emulator wiring of any kind, so there was no way to
point a build at a local Firebase. That made the M-U2 verification gate unanswerable as
written — the signup → verify → profile-setup → start-community flow could only be
asserted in pieces, and the ID-token refresh above (the fix that decides whether a new
member dead-ends) is invisible to every in-process test. The gate had been asked for
twice before anyone noticed the code could not satisfy it.

Why two guards and not one: an env var can leak into a hosted build by accident, and a
production bundle silently pointing real members at a nonexistent emulator would fail
every auth call with a network error and read as an outage. The build-time flag alone is
a promise; the hostname check is structural, and makes the bad state unreachable rather
than merely unlikely. A unit test asserts the flag defaults closed.

Consequence for deploys: `scripts/westayfit/gate1.sh` leaves `dist/` as an emulator
build. Any deploy must rebuild with `EXPO_PUBLIC_WSF_AUTH_ENABLED=1` and that flag
**unset**. The hostname guard means a stale `dist` would not actually reach a real
member's browser in a broken state, but it would still be the wrong artifact.

## 2026-09-01 — Exact version pins for `firebase` and `@firebase/rules-unit-testing`

Chose: pin both exactly in `functions/package.json` rather than carry caret ranges.

`^12.11.0` is not a hypothetical risk. An `npm install` resolved it forward mid-repair,
the tree ended up with two copies of `@firebase/firestore`, and the modular
`collection()` began receiving an instance from the other copy. Hours went into chasing
that as a code fault, because the resulting error names the test file, not the
dependency. Measured against the live registry at the time of writing: `^12.11.0` →
`12.18.0`; pinned → `12.11.0`.

`@firebase/rules-unit-testing` is pinned for a stronger reason. The `modularDb()` helper
in `firestore.rules.test.ts` reaches for `._delegate` on the compat Firestore that RUT
returns. That is an internal implementation detail, not public API, so a minor release
is free to change it and silently re-break the suite with nothing in the changelog to
warn anyone.

`npm ci` honours the lockfile and would have been safe. The pin exists because nothing
forces anyone to use it, and the failure mode does not look like a dependency problem.

Reason: a range is a promise that upstream will not break you. For a suite whose whole
job is to prove the security rules still hold, that promise is not worth the debugging
cost when it fails.

## 2026-09-01 — The WSF site ships no favicon (open gap, deliberately not patched)

Recorded, not decided: there is no icon asset anywhere in `apps/westayfit`, and no
`web.favicon` in `app.json`. Every page load 404s on `/favicon.ico` and every browser
tab shows a generic icon.

Not fixed here because the mark is a brand decision and inventing one would put an
unapproved asset in front of every member. Pinned instead by a test in
`tests-e2e/mu2-flow.spec.ts` that **fails when a favicon appears**, alongside a named
allowance in that spec's `KNOWN_GAPS`. The pairing is the point: the allowance cannot
outlive the gap silently, because closing the gap breaks the test that documents it.

Cosmetic, not a deploy blocker. Owner: Devin.

## 2026-09-06 — Age gate removed from profile creation (Devin)

Devin, after the first LIVE phone test of the E3 staging channel: "Let's allow anyone to
create a profile regardless of older than 18." The 18+ checkbox on profile-setup and the
two server guards (`wsfCreateCommunity`, `wsfJoinCommunity`) are removed in E3.5 turn A.

Supersedes, in part, master §6 "Adults only, first release": members under 18 may hold
accounts. Not decided by this entry: the age floor. The PM recommendation is the sentence
"By saving I confirm I am 13 or older" (the COPPA floor for collecting an email and a display
name from US users), with no separate checkbox; Devin may change the number or remove the
sentence. Under-13 data collection stays excluded either way, as do child location, child
health information and public child names. Master doc bumped to 1.2 with the note.

## 2026-09-06 — Phone-test findings become E3.5; join-policy and type semantics proposed

Recorded from Devin's LIVE test (2026-09-06 01:06–01:08Z): every sign-in lands on the setup
screens because there is no signed-in home; profile-setup overwrites the profile; terms are
not readable; the community page shows raw enums; a community created in the UI cannot be
joined by anyone because only `public` groups are link-joinable and the UI never offers
`public`; types are the M-U2 stub. Spec: `dispatch/E3.5-PHONE-TEST-FIXES.md`.

Proposed, pending Devin's one-word confirmation before turn B changes E2 behaviour:
`public` = listed in search and joinable by link/QR; `inviteOnly` (label "Anyone with the
link") = joinable by link/QR, not listed; `private` = members added by the Champion (M-U3).
Types follow master §2 (`neighborhood · apartment · workplace · church · family · friends ·
custom`, places first) with an optional free-text place label and no address or GPS.

Discovery/search, the landing redesign and Champion "start a challenge" are the M-U5/M-U6
surface the FitLife reduction cut ("M-U6 cut entirely"); they are written up as an E4
proposal in the same spec for Devin to sequence against E4–E6.
