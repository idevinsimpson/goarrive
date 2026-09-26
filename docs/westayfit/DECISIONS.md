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

## 2026-09-16 — Package E: per-goal aggregate-display authorization

Decided by Devin under Strategic Master v3.0 (*The Living WE System*, 2026-09-11), which
governs this and is held outside this repository. Recorded here because the defect and its
status had lived only in source and test comments — `RISKS.md` and this file carried
nothing, so nothing outside the code knew it was open.

**The defect.** `wsfGoalPulse` was `invoker: 'public'` with no eligibility check of any
kind. Possession of a `goalId` was, in effect, permission: a private community's progress
was readable by anyone who had once seen the id, and a removed member kept reading it.
`wsfChallengePulse` had the same shape by a different route — it fetched the group document
but checked only `isSample`, so `joinPolicy` never entered into it.

**The decision.** Publication authorization is **per goal**, on the goal, default **off**.

- The field is `aggregateDisplayAuthorized`, named for exactly the permission it grants:
  *this goal's approved aggregate progress may be presented through the authorized
  unauthenticated aggregate-display path.* It does not mean the community is discoverable,
  that anyone may join, that member information or individual contributions are public,
  or that any future goal is authorized.
- Only an **active foundingChampion of the community that owns the goal** may change it,
  through the existing community-scoped authority. There is no global Champion claim and
  no platform-wide publisher.
- It **survives goal closure**, so an authorized completed goal can go on supporting
  "what we've done" and recap presentation, and it stays **revocable** after closure.
  Closing is not revoking; revoking is not closing.
- **Absent means false.** Nothing was backfilled. Every goal written before this decision
  behaves exactly as unauthorized.

**Explicitly not sources of authorization**, each separately: community `joinPolicy`,
public discoverability, membership, possession of a `goalId`, goal lifecycle or status,
`isSample`, and the fact that a display is what is asking. `isSample` remains a
truthfulness property — it can suppress a display, it can never start one.

**contributorCount is excluded** from the anonymous aggregate response. It had no approved
public-display purpose and was being returned by inertia. Nothing replaces it; a substitute
metric would be the same unapproved disclosure under another name.

**Two routes, neither implying the other.** Membership permits the member experience —
an active member reads their community's shared progress whether or not it is published.
Per-goal authorization permits the display experience. A signed-out display gets the
aggregate only for an authorized goal, and the refusal is byte-identical to an unknown id,
so the endpoint is not an oracle for which goals exist.

**Replay.** A previously recorded attempt stays idempotent and is never counted twice, but
a caller who is no longer an active member no longer receives current shared state with it.
They keep what is theirs — the attempt is acknowledged, counted once, own credit returned.
The same correction was applied to `wsfCheckIn`, which had the identical shape.

**Legacy challenges.** `wsfChallengePulse` became an active-member read. Package E did
**not** invent a second publication model for the legacy challenge aggregate; if a FitLife
requirement genuinely needs those shown anonymously, that is a separate compatibility
decision, not a silent policy set here.

**Transport is not authorization.** The Cloud Run invoker stays public. Nothing in IAM,
organization policy, Hosting or Auth configuration was changed to implement this; the
handler decides what is returned.

## 2026-09-16 — Package E follow-up: the control, not just the boundary

Package E's authorization decision above is unchanged. This records what the follow-up pass
corrected in how that decision reaches a person, and one thing it deliberately did not do.

**A failed request is not an outcome.** The control reported "could not save" and kept
showing the old value, which is a claim it had not established — the server may have saved
the change before the connection dropped. There are three facts, not two: saving; the
confirmed current permission; and outcome unknown. A failed request now triggers a read-back
of the stored permission. Only when that read also fails does the screen say the setting
could not be confirmed, and it then says what is shown may be out of date. When the read
succeeds and disagrees with what was asked for, the screen says the change did not take
effect rather than leaving a silent no-op.

**A retry sends the value that was asked for.** Never the inverse of what the card shows.
The card can be stale, and inverting it can undo a request that succeeded. The rule lives in
`src/displayAuthControl` because it is not observable from the screen: whenever a retry is
offered the card happens to show the negation of the intended value, so the correct rule and
the defect compute the same answer. That coincidence is a property of today's screen, not of
the rule, and it ends the moment the goal list can refresh on its own.

**The words describe the permission, not the world.** "Public display is not authorized for
this goal" is supportable. "This total is not on any public display" is not — the
application cannot speak for screens, saved images or snapshots already shared.

**Revocation survives closure in the interface too.** The decision above says a display
permission survives goal closure and stays revocable. `wsfListGoals` selected only active
goals, so a closed goal left the list and took the control with it: the permission stayed in
force and the person responsible for it lost the way to turn it off. The list now also
returns closed goals that are still authorized. Revoking then removes the only thing keeping
such a goal in the list, so the card disappears at the moment of success — the screen names
what happened and which goal it happened to, rather than letting the goal vanish silently.
Closed goals carry the revoke control and nothing else; no contribution controls return.

**Physics is not a permission.** The display polls, polls overlap, and an older successful
response could land after a refusal and repaint a total the display was no longer permitted
to show. Responses now carry the sequence they were issued with and may only change the
screen if they are newer than what is rendered. The test that proves this had to hold a
fetched *response*; holding the request and forwarding it later asks the server after the
revocation and gets the refusal, which proves nothing.

**One rule, not two copies.** The replay branch of `wsfContribute` and `wsfGoalPulse` answer
the same eligibility question and each had its own copy. Both now go through
`evaluateGoalAggregateAccess`, and the agreement is pinned across authorization and
`isSample`, where the two previously diverged.

**The boundary extends to every read that answers the same question.** `wsfMyContribution`
answered any signed-in caller, so a stranger holding a `goalId` learned the goal existed and
what it was counted in — the same disclosure the display path refuses, through the
own-credit endpoint. It now requires an active membership or a record of the caller's own.
The test is that the record exists, not that it is positive: a correction that zeroes
someone's credit must not erase their history.

**Not done here, recorded once as R-WSF-E2:** the Living WE surface and the member-facing
experience around an authorized goal, including the founder-smoke observations. Deferred out
of Package E on purpose so the authorization boundary could be reviewed on its own terms. It
needs its own packet. No Package E change is justified by it.

## 2026-09-16 — Package E follow-up 2: what a screen may show after a refusal

Three corrections from review. All client-side; no callable changed, so the deployment
delta's function lists are unchanged by them.

**A refusal ends the polling session.** Ordering responses by the sequence they were issued
with closed one case and left its mirror image open, because issue order is not server
processing order. A request can stall before its authorization lookup while a later request
reaches the server, succeeds, and has its response held in flight; if the permission is
revoked in between, the stalled request returns not-found with the *lower* sequence and the
held success carries the higher one. Ordering alone then admits the success after the screen
has already accepted the refusal. Stopping the poll timer never helped — it prevents new
requests, it does not invalidate outstanding ones.

A refusal now closes the session, and every outstanding response from it is refused
admission from that moment regardless of sequence. Both rules are kept and both are tested:
ordering handles the success-then-refusal case, session closure handles the
refusal-then-success case, and a mutation that removes closure fails only the second.

**Recovery is explicit.** A closed session stays closed; the only way back is a **Check
again** action that starts a fresh session. No response from the refused session can perform
that recovery. A different goal also clears the previous goal's rendered state at once.

This concerns what the running application renders once it has learned access is refused. It
is not a claim about anything already received elsewhere — a screenshot, a recording, a
number someone wrote down — which this application cannot reach.

**Outcomes are per goal, and scoped by generation.** One shared slot meant starting an
action on one goal erased another's unresolved outcome while its request was still in
flight, taking its warning, its intended retry value and its disabled control with it.
Outcomes are keyed by goal and leave only by being settled or explicitly dismissed. Scoping
by account and community alone cannot tell A → B → A from never having left, so an operation
also carries a generation that advances each time the context is established.

**A tested rule with no call site is not a tested control.** `displayAuthValueToSend` and
`unsettledFor` shipped with unit tests and no importer — the screen kept its own inline copy.
The wiring was written but still uncommitted when the client mutation harness ran
`git checkout` over `app/`, and the commit went out afterwards. Mutation runs now require a
clean tree and verify restoration. The division of evidence is: helper mutations prove the
helper's behaviour, and a browser case proves the control uses it. An equivalent browser
mutant proves neither, and is not counted as coverage.

**A control belongs to the job it serves, not to the data it happens to sit beside.** The
kiosk address for a goal lived inside that goal's public-display permission card, because the
two are related: a kiosk shows what the permission allows. Related is not the same as *the
same job*. A Champion opening the Champion sheet at an event is there to put a goal on a
screen, and had to find that control inside a permission they were not looking for. The
address and the station enrolment moved into a **Your event** section of their own; the
permission stayed where it belongs, under **Goals**, unchanged. Nothing was removed, renamed
or re-gated — the same testIDs, strings and `data-*` attributes render in a different place.

**Station enrolment is a sibling of the kiosk mode, never part of it.** The first cut of that
move put enrolment inside the "One goal" branch, which silently took screens away from a
combined event. `ui-combined-goal.spec.ts` failed within one run and its own comment had
already said why. A test that states the rule it is protecting is worth more than the
assertion alone.

**Present is not shown, and a capture is a claim about what is shown.** A sheet keeps its
scroll offset across a viewport change, so waiting for an element to be *visible* and then
photographing the viewport produced a capture named for the success state that was a picture
of a different panel. Visibility is a property of the element; being in frame is a property
of the camera. Every capture now scrolls its anchor into frame first, on top of the
byte-identical hash guard — which catches two captures being the same image, but cannot catch
one image being the wrong one.

**No horizontal clipping is a number, not an impression.** Captures are for a reviewer;
whether anything is wider than the sheet that holds it, and whether the document scrolls
sideways, are assertions that run at every width. Written, then mutation-tested by forcing an
element to 3000 px, because a guard that cannot fail is decoration.

## 2026-09-26 — Reconcile WSF instruction authority, North Star, app-feel and operations

Owner authorization: Devin directed the documentation audit to proceed with the recommended
reconciliation rather than opening another strategy round.

**Decision:** Strategic Master v3.0 (September 11) remains the governing strategic
foundation. A v3.1 addendum records only durable post–September 11 decisions:
- exact frozen journey references are the visual/interaction authority for scoped
  member-visible work;
- Lovable's WE Community Home project is a North Star laboratory, not production data truth;
- WSF is a native-feeling mobile community app with a persistent Home / Community /
  Progress / You member shell and MOVE as a focused flow;
- authenticated community presence may be richer than public-display output, subject to
  per-community member visibility choices;
- the bounded real Start-a-community / goal / invite / join path is part of the useful
  product without making general discovery/full Champion administration a first-delivery
  dependency;
- current execution uses the Fable operating protocol, one ACTIVE NOW packet per worker,
  at most one NEXT, one authoritative handoff, and distinct evidence states.

**Supersession:** `docs/westayfit/WE_STAY_FIT_MASTER.md` v1.2 and the Universal
Communities Charter are retained as historical lineage but no longer govern current WSF
product direction. The September 11 implementation-plan working draft is also historical
execution planning; the September 26 Implementation and Operations Charter replaces its
sequencing/status role.

**Current-state rule:** volatile SHA/run/blocker/worker state lives in the canonical
editable CURRENT STATE comment on #365, not in dated strategic documents.

**Unresolved, deliberately not decided here:** general multi-movement goal semantics and
the durable general activity catalog versus the actual FitLife menu. Prototype capability
does not silently settle those product semantics.



## 2026-09-26 — Documentation authority reconciliation

Owner authorized a bounded documentation reconciliation after a current-state/vision audit. This is not a fourth strategy round and does not alter product code or release authority.

**Decision:** Strategic Master v3.0 — The Living WE System remains the strategic foundation. A September 26 v3.1 addendum records durable post-September-11 decisions: the frozen North Star reference process, mobile app-feel/member-shell direction, authenticated community presence/privacy distinctions, bounded Start/Join continuation, and current evidence/operations discipline.

**Authority:** `DOCUMENT_AUTHORITY_AND_SUPERSESSION.md` is the repository map for resolving document conflicts. The September 6 `WE_STAY_FIT_MASTER.md` is explicitly superseded as a product master and retained only for historical architecture/decision lineage. `CURRENT_STATE.md` becomes a pointer to the single canonical editable CURRENT STATE comment on #365 rather than a competing status ledger.

**North Star:** the WE Community Home Lovable project is a design/interaction laboratory only. Member-visible implementation uses an exact frozen journey reference from `ops/NORTH_STAR_JOURNEY_MANIFEST.json` or an issued packet. A newer Lovable edit does not silently move already-issued work. Public marketing Lovable/Supabase remains a separate production marketing/inquiry lineage.

**Execution:** the September 11 implementation-plan draft v0.2 is superseded for sequencing by `WE_STAY_FIT_IMPLEMENTATION_OPERATIONS_CHARTER_v1_2026-09-26.md`. Historical acceptance rationale remains useful; its old package states are not current dispatch instructions.

**No release implication:** documentation creation/reconciliation does not merge product code, repin staging, clear email/social/index/kiosk blockers, or authorize production.
