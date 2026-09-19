# WS 1 / 10 / 11 / 13 — feasibility and BLOCKED/READY determination

Worktree read: `scratchpad/ui`, branch `claude/wsf-ui-member-experience` @ `7ca9240`. Read-only; nothing modified.
Written 2026-09-18 ~12:55 UTC. Staging deadline 17:00 UTC.

**Verdicts: 1 BLOCKED · 10 BLOCKED · 11 BLOCKED · 13 BLOCKED.** None of the four is
READY-TO-BUILD-TODAY. Reasons differ and are given per item with citations.

---

## Cross-cutting facts that bear on 10 and 11

These were established while assessing maps/rankings and are load-bearing for both.

1. **Staging cannot ship rules or indexes.** `firebase.westayfit.staging.json` (on
   `origin/main`) `_comment`: *"firestore and storage are deliberately absent: rules and
   indexes are not part of any WSF deploy."* Corroborated by
   `docs/westayfit/today-2026-09-18/00-LIVE-STATUS.md:14` (the open D-5 delivery blocker).
   The workflow deploys `--only functions:westayfit` + hosting
   (`.github/workflows/wsf-staging-deploy.yml`).
   *Consequence:* any feature whose safety depends on a rules change is unverifiable on
   staging today. **Favourable corollary:** a feature that needs *no* rules change is not
   blocked by this. WSF writes are all admin-SDK/callable, which bypasses rules:
   `firestore.rules:1243-1246` (`wsfCommunityGroups`: `allow create, update, delete: if
   false`), and `wsfGoals` / `wsfChallenges` / `wsfMoves` / `wsfGoalShards` have **no rules
   block at all** — they fall to the catch-all `allow read, write: if false`
   (`firestore.rules:1327-1329`). So new server-only state is rules-neutral by construction.

2. **No composite indexes may be introduced.** `firestore.indexes.json` contains zero `wsf`
   entries (`grep -c wsf` → `0`), and indexes are not deployed to staging either (fact 1).
   `wsfListGoals` already works around this deliberately — two equality-only queries and an
   in-handler sort, `functions-westayfit/src/index.ts:3125-3143` and `:3177-3180`. Any new
   listing must do the same.

3. **The public contract is exactly nine fields and is test-pinned.** `wsfGoalPulse` returns
   `sharedTotal, target, unit, status, communityDisplayName, goalTitle, startsAt, endsAt,
   timezone` (`functions-westayfit/src/index.ts:2912-2922`).
   `functions-westayfit/tests/callable/wsf-overnight-privacy-audit.test.ts:322-346` seeds a
   community carrying `location: 'Maple Street'`, `joinCode`, `memberCount`, `ownerEmail`,
   `inviteLink` and asserts `Object.keys(value).sort()` equals `APPROVED_PUBLIC_FIELDS` and
   that none of those strings appears in the JSON. Also `02-SECURITY-PRIVACY-AUDIT.md:29`.
   *Any* second public callable is a **new public contract**, which no agent may mint.

4. **Today's authorization excludes new scope.** `00-LIVE-STATUS.md:19`: "NOT: production,
   IAM/WIF, spending, new scope, force push, merging PR #327." `:10` records the position
   already taken on the PR that the 13 extra workstreams are not started. The candidate is
   mid-freeze (`:8`, `:15`).

---

## 1) LIVING WE MOTION — **BLOCKED**

### What exists

- Brand assets live at `apps/westayfit/assets/brand/`, **not** at
  `scripts/westayfit/brand/`. `scripts/westayfit/brand/` contains exactly one file:
  `derive-brand-assets.py`. There is no `scripts/westayfit/brand/assets`, no
  `MANIFEST.json`, no `living-we-calibration.json`, no `README` at that path.
- `apps/westayfit/assets/brand/derived/MANIFEST.json` records **4 inputs and 7 outputs**.
  Inputs: the four owner PNGs. Outputs: `wordmark-navy-green.png`,
  `wordmark-white-green.png`, `monogram-silhouette.png`, `monogram-fill-green.png`,
  `monogram-unfilled-navy.png`, `monogram-unfilled-white.png`,
  `living-we-calibration.json`. **None is a motion asset.**
- The owner supplement is enumerated in
  `apps/westayfit/assets/brand/originals/SHA256SUMS.json`: `"source":
  "WSF_ORIGINAL_BRAND_SOURCE_SUPPLEMENT_2026-09-17.zip"`, four PNG entries, roles
  "Full WE STAY FIT wordmark navy/green", "WE monogram navy/green", and the two
  white/green counterparts. No video, no frame sequence, no timing document.

### `living-we-calibration.json` is geometry, not timing

Keys: `source, width, height, steps, direction, heightFractionByFill` (1001 numbers).
`apps/westayfit/src/ui/livingWeCalibration.ts:1-10` states its purpose: *"Maps a fill ratio
(share of the WE's AREA that should be green) to the height ... at which a bottom-anchored
clip must stop."* Same in `scripts/westayfit/brand/derive-brand-assets.py` (docstring,
`living-we-calibration.json` paragraph): *"the cumulative opaque AREA from the bottom edge
upward"*. **There is no time-domain value anywhere in the file.** `direction:
"bottom-up"` is the clip's geometric direction, already implemented; it is not an approved
motion direction.

### Repo-wide search result

- Media search (`*.lottie|*.mp4|*.webm|*.gif|*.mov`) over the repo excluding
  `node_modules`: the only video is `docs/coach-discovery/artifacts/coach-discovery-mobile-full.webm`,
  a **GoArrive coach-discovery** test artifact, unrelated to WSF.
- `grep -rniE "motion reference|motion ref|approved timing|calibrated motion|fill direction|motion spec"`
  over `*.md *.ts *.tsx *.py`: **two hits, both the source comment**
  `apps/westayfit/src/ui/LivingWeProgress.tsx:23-24`.
- `docs/` grep for `motion|timing|easing|keyframe|lottie|animat`: no spec. The gap is
  already recorded as not-built in three places:
  - `docs/westayfit/overnight-2026-09-18/01-BASELINE-AND-GATE1.md:44` — "calibrated Living
    WE motion" listed among deferred items.
  - `docs/westayfit/overnight-2026-09-18/08-FINAL-CANDIDATE-RECEIPT.md:70` — same list.
  - `docs/westayfit/overnight-2026-09-18/07-CROSS-SURFACE-QUALITY.md:46` — "Calibrated
    Living WE motion | transition returns null; nothing animates (asserted under reduced
    motion)".

### Current behaviour (cited)

- `apps/westayfit/src/ui/LivingWeProgress.tsx:33-35` —
  `export function livingWeTransition(): { durationMs: number } | null { return null; }`
- `:77-90` — the effect: `if (reducedMotion || transition == null) { anim.setValue(clipPx);
  return; }`. **The fill does not animate.** `Animated.timing` at `:85-89` is unreachable
  while `livingWeTransition()` returns null.
- **No zero-to-current replay is structurally possible**: `animateFrom` defaults to `null`
  (`:43`, `:53`), and `:64-65` makes `startPx = clipPx` when it is null — "Never from zero
  unless the previous confirmed total really was zero" (`:62-63`).
- Reduced motion: `apps/westayfit/src/ui/useReducedMotion.ts:9-38` — web reads
  `window.matchMedia('(prefers-reduced-motion: reduce)')` and subscribes to `change`;
  native uses `AccessibilityInfo.isReduceMotionEnabled()` + `reduceMotionChanged`.
  Consumed at `LivingWeProgress.tsx:57`, gates the effect at `:81`.
- Already regression-tested: `apps/westayfit/tests-e2e/ui-a11y.spec.ts:980-1044` (R6),
  `test.use({ contextOptions: { reducedMotion: 'reduce' } })` at `:984`, asserting
  `animatingNodes(page)` is `[]` on Community Home (`:1023`) and the display (`:1041`).
  Header at `:27`: "R6 with prefers-reduced-motion nothing animates, and the Living WE
  shows [its true fill on first paint]".

### Verdict: BLOCKED

**Exact missing asset.** An owner-approved motion reference for the Living WE fill
transition, supplying at minimum:
  (a) a **duration in milliseconds** for previous-confirmed → next-confirmed, and
  (b) an **easing curve** (named curve or cubic-bezier control points), and
  (c) explicit confirmation of the animated fill direction.
Delivered the way the 2026-09-17 brand supplement was — a file in
`apps/westayfit/assets/brand/` (e.g. `living-we-motion.json`), or a reference
video/frame-sequence with a stated frame rate, or a written owner spec — and checksummed
into `apps/westayfit/assets/brand/derived/MANIFEST.json`, which currently records no such
input or output.

No such asset exists at `7ca9240`. Choosing any `durationMs` today would be inventing an
approved timing, which the instruction forbids. **Do not implement.**

*Optional 15-minute honest guard, not the feature:* a unit test pinning
`livingWeTransition() === null` so no future change can introduce an unapproved timing
silently. There is currently no such assertion (the only coverage is the indirect
browser-level `animatingNodes === []`). Offer it; do not present it as WS1 delivered.

---

## 10) MAPS — **BLOCKED**

### Data model: what exists today

- `wsfCommunityGroups` documents are written in exactly one place,
  `functions-westayfit/src/index.ts:243-256`: `displayName, groupType, joinPolicy,
  joinCode, createdByUserId, lifecycleStatus, isSample, createdAt, updatedAt`.
  **No location, city, state, region, or geo field exists.**
- The only location-shaped field in the entire model is `MoveDoc.locationLabel`
  (`functions-westayfit/src/index.ts:1252`), an optional free-text **venue label on a
  challenge move**, surfaced member-gated by `wsfListChallenge` (`:1348`, `:1426`) and
  rendered at `apps/westayfit/app/community/[groupId]/challenge.tsx:366-367`. It is not a
  community location, it is never public, and **no callable writes it** (moves are seeded).
- Community documents are read directly by the client at
  `apps/westayfit/app/community/[groupId]/index.tsx:297` and
  `apps/westayfit/app/contribute/[goalId].tsx:346`, under
  `firestore.rules:1243-1246` (active members + platform admin read; all writes denied to
  clients).

### What a coarse-location model would need (design, if it were authorized)

- **Field**: `coarseLocation: { locality: string, region: string }` on
  `wsfCommunityGroups`, plus `coarseLocationPublished: boolean` + `...At` / `...By` stamps.
  Absent means false, read through a helper, never read directly — mirroring
  `isAggregateDisplayAuthorized` (`functions-westayfit/src/index.ts:2111`) and the
  `aggregateDisplayAuthorized` doc comment (`:2084-2101`).
- **Champion consent callable**: `wsfSetCommunityCoarseLocation`, modelled line-for-line on
  `wsfSetGoalDisplayAuthorization` (`:3204-3259`) — its own callable rather than a field on
  creation (`:3185-3189`: "Making publication a checkbox in a creation form is how it
  becomes an incidental side effect"), authority = **active `foundingChampion` membership
  of that community** (`:3236-3242`), strictly-boolean publication argument (`:3216-3220`),
  generic `not-found` for both "no such community" and "no authority" (`:3236-3242`),
  revocable, `merge`-write that touches nothing else (`:3244-3256`).
- **Public listing callable**: equality-only
  `where('coarseLocationPublished', '==', true)` → single-field index, no
  `firestore.indexes.json` change (fact 2), sorted in-handler like `wsfListGoals:3177-3180`.
- **Rules implications: none.** All writes are admin-SDK (bypasses rules); the field lands
  inside a document whose client writes are already `false` and whose reads are already
  member-gated. This is genuinely rules-neutral, so fact 1 does **not** block it.
- **Rendering**: map tiles require an external provider → API key → developer account →
  metered spending. Excluded by standing constraints, full stop. A tile-less
  region/state list renders with zero new dependencies.

### Why it is nevertheless BLOCKED

The blocker is **not** technical. It is a missing owner decision plus the freeze window.

1. **No approved public-listing contract exists, and one cannot be minted here.** The
   product's entire public surface today is one callable returning exactly nine fields for
   one goal, pinned by a passing test (fact 3). A public callable that **enumerates
   communities** and publishes each one's city/state is a second public contract and a new
   public field set. It also inverts the design premise the codebase states explicitly —
   *"possession of a goalId is never permission"*
   (`functions-westayfit/tests/callable/wsf-goal-pulse.test.ts:11-15`) — by handing out a
   community roster on request.
2. **The owner's own documents leave it undecided and partly forbid it.**
   - `docs/westayfit/WE_STAY_FIT_MASTER.md:660` lists **"public member directory
     defaults"** among the structurally undecided items.
   - `:591`: **"No fake national activity map. No fabricated counts. No fake community
     locations."**
   - `:387-388` never-collect list: "exact GPS trails · background location". (A
     Champion-entered city/state is not on that list, so the *data* is not per se
     forbidden — the *publication* is what is unapproved.)
   - `docs/westayfit/WE_STAY_FIT_MASTER.md:664-670` change control: such a change requires
     Devin's decision and a `DECISIONS.md` entry. There is none.
3. **The existing passing test treats a community `location` field as an unapproved field**
   (`wsf-overnight-privacy-audit.test.ts:329`, seeding `location: 'Maple Street'` and
   asserting its absence). Publishing a community location publicly is in direct tension
   with a green test written to keep it private; that tension is an owner call, not an
   implementer's.
4. **Schedule.** Even with the decision granted, the honest cost is field + consent
   callable + public listing callable + ~3 new callable test suites + a UI surface + a11y
   contract re-check (`ui-a11y.spec.ts` pins exact accessible names,
   `:1239`, `:1264`), then a **full re-run of the freeze gates**: `gate1.sh` (vitest +
   tsc + functions build + full browser flow), 33+ browser specs, 238 callable tests.
   Realistically **4–6 h of focused work plus ~1 h of gates**. At 12:55 UTC against a
   17:00 UTC staging deadline with the candidate already freezing
   (`00-LIVE-STATUS.md:8,15`), it does not fit — and `:19` forbids new scope outright.

**Report BLOCKED, not fake pins.** Exact prerequisites, in order:
(a) owner decision approving a second public contract and its exact field set, recorded in
`docs/westayfit/DECISIONS.md` per `WE_STAY_FIT_MASTER.md:664-670`;
(b) a resolution of `WE_STAY_FIT_MASTER.md:660` "public member directory defaults";
(c) a separate deadline window — this is not a same-day item under `00-LIVE-STATUS.md:19`.
Tiles/providers/keys are independently out under the no-spending/no-new-accounts rule; the
tile-less variant is the only one worth designing when (a)–(c) clear.

---

## 11) RANKINGS — **BLOCKED**

### Current state

- **No ranking or comparison exists anywhere.** The only occurrence of the concept in app
  code is a code comment stating its absence:
  `apps/westayfit/app/community/[groupId]/index.tsx:1383` — *"Your part: exact own credit,
  no ranking, no comparison."* The rendered card shows only the member's own credit
  (`:1387-1393`), fed by `wsfMyContribution`, which is deliberately uncached to avoid a
  cross-member leak (`functions-westayfit/src/index.ts:2929-2941`).
- `docs/westayfit/UNIVERSAL_COMMUNITIES_CHARTER.md:15` principle 5: *"No leaderboards by
  default. Comparative ranking is off by default and opt-in per community."* — but the
  section header at `:9` reads **"Design Principles (proposed, to be ratified in a later
  milestone)"**, and the document's own §Ratification requires a `DECISIONS.md` entry per
  ratified change. **Principle 5 is unratified.** There is no such entry.
- `docs/westayfit/WE_STAY_FIT_MASTER.md:660` lists "leaderboards involving body metrics"
  among the structurally undecided items.

### Which flag is honest — argued

**A distinct flag is required; reusing `aggregateDisplayAuthorized` would be dishonest.**
The field's own contract, written into the source at
`functions-westayfit/src/index.ts:2085-2093`, states it means one thing and enumerates what
it does *not* mean: *"It does NOT mean the community is discoverable, that anyone may join,
that member information or individual contributions are public, that future goals are
authorized, **or that the goal may be used for unrelated public proof**."* Cross-community
comparison is exactly "unrelated public proof". A Champion who authorized a JumboTron
display did not consent to their community being ranked against another. So: a separate
`comparisonPublished` boolean, set by its own callable, mirroring
`wsfSetGoalDisplayAuthorization`'s shape — **not** a reuse, and **not** a second meaning
bolted onto an existing field.

### The technical blocker: units are free text

`normalizeGoalUnit` (`functions-westayfit/src/index.ts:2305-2314`) accepts any trimmed
string of 1–40 characters with no ASCII control characters and **explicitly no
vocabulary**: *"No script/language whitelist — a unit like 'sentadillas' or 'поднятия' is
valid"*. There is no unit enum, no canonical unit id, and no mapping table anywhere in the
repo. Consequences:

- "Comparable units" can only be enforced as a case/whitespace-normalized **exact string
  match**. That is a heuristic, and it fails in both directions: it separates
  `squats`/`Squats`/`squat`/`sentadillas` (same thing), and it merges two unrelated goals
  that both happen to say `reps` or `minutes`.
- Percent-of-target comparison (the right comparison shape — it is unit-free and avoids
  comparing magnitudes) mitigates the *scale* problem but not the *semantic* one: it would
  still rank "70% of 500 squats" against "40% of 500 push-ups" as if they were the same
  contest, which is precisely the "compare unlike units" the instruction forbids.
- The goal-creation screen prefills `unit` as free text, default `'squats'`
  (`apps/westayfit/app/goals/new.tsx:70`, input at `:338-342`).

There is no data in the repo from which a canonical unit vocabulary could be derived today.

### Verdict: BLOCKED

Exact missing prerequisites:
1. **Ratification of Charter principle 5** — it is marked proposed
   (`UNIVERSAL_COMMUNITIES_CHARTER.md:9`, `:15`) and its own §Ratification requires a
   `DECISIONS.md` entry. None exists.
2. **A canonical unit vocabulary** (enum of unit ids with display labels, plus a migration
   path for goals already created with free-text units). Without it, "comparable units"
   cannot be enforced, only guessed — `functions-westayfit/src/index.ts:2305-2314` is the
   blocking fact.
3. **An approved public field set for a second public callable** (fact 3). Community names
   published in a comparison list are a new public surface; the nine-field contract is
   test-pinned and does not cover it.
4. The same freeze/new-scope constraint as WS10 (`00-LIVE-STATUS.md:19`).

For completeness: (1)–(4) also rule out the "smaller" version. A two-community,
both-opted-in comparison still needs the unit vocabulary and the public field set. There is
no honest subset buildable today.

---

## 13) WEARABLES / STEPS — **BLOCKED**

### Platform facts, cited

- **Web static export.** `apps/westayfit/app.json` → `"web": { "bundler": "metro",
  "output": "static" }`; `plugins: ["expo-router"]` only. Build is
  `expo export --platform web` (`apps/westayfit/package.json`, `build:web`), deployed to
  Firebase Hosting (`firebase.westayfit.json` / `firebase.westayfit.staging.json`, hosting
  `public: apps/westayfit/dist`). A native module cannot execute in that artifact.
- **No health dependency exists.** `apps/westayfit/package.json` dependencies are: `expo`,
  `expo-constants`, `expo-linking`, `expo-router`, `expo-status-bar`, `firebase`, `react`,
  `react-dom`, `react-native`, `react-native-gesture-handler`,
  `react-native-reanimated`, `react-native-safe-area-context`, `react-native-screens`,
  `react-native-web`, `react-native-worklets`. Grep over `apps/westayfit/package.json`,
  `apps/westayfit/package-lock.json`, `functions-westayfit/package.json` and the root
  `package.json` for `expo-health|react-native-health|expo-sensors|Pedometer|HealthKit|
  HealthConnect|expo-location|react-native-maps` returns **zero hits**.
- **No native project and no build pipeline.** `apps/westayfit/ios`,
  `apps/westayfit/android` and `apps/westayfit/eas.json` do not exist (`ls`: No such file
  or directory). `docs/westayfit/EXPO_READINESS.md:7`: *"M-U1 ships the WSF Expo shell as a
  **web-only** deploy ... Native iOS/Android builds are declared in `app.json` ... but not
  built, not submitted, and not tested."* `:15`: *"`eas.projectId`: intentionally absent.
  WSF has no EAS project registered."* `docs/westayfit/DEPENDENCIES.md:90`: *"No EAS build
  service (out-of-scope for M-U1)."*
- **The product forbids it outright.** `docs/westayfit/WE_STAY_FIT_MASTER.md:387-388`,
  "Never collect in the community product": *"... **wearable feeds** · exact GPS trails ·
  background location ..."*. This alone forecloses the feature independent of platform.
- **Web alternatives are all excluded.** HealthKit and Health Connect have no web API.
  Google Fit's REST API is deprecated/retired in favour of Health Connect (Android-native,
  no REST surface). Fitbit, Garmin, Oura, Strava and Withings all require a new developer
  account and OAuth client credentials → **new external accounts/keys**, excluded by the
  standing constraint. The repo holds no such credential and no integration stub
  (`functions-westayfit/src/index.ts` has one secret, `wsfEmailApiKey`, `:410`).
- **Manual entry does not count**, per the instruction — and manual entry is already what
  `wsfContribute` is (`functions-westayfit/src/index.ts:2579`, integer counts against a
  free-text unit).

Nothing real was found in the repo. Searched the full source tree, both package manifests,
app config, docs, and the functions codebase.

### Verdict: BLOCKED — exact prerequisite list

1. **Owner reversal of `WE_STAY_FIT_MASTER.md:387-388`** (wearable feeds are on the
   never-collect list), recorded in `docs/westayfit/DECISIONS.md` per the change-control
   rule at `:664-670`.
2. **EAS build pipeline**: `eas init` → `eas.projectId` in `app.json`; `eas.json` build
   profiles (`EXPO_READINESS.md:39-40`; `DEPENDENCIES.md:90`). Neither file exists.
3. **Paid store accounts**: Apple Developer Program + an App Store Connect record, and
   Google Play Console registration, both under `com.westayfit.app`
   (`EXPO_READINESS.md:41`). Both are **spending** and **new external accounts** — excluded
   today by two separate standing constraints.
4. **Platform entitlements and declarations**: iOS HealthKit entitlement on the
   provisioning profile plus `NSHealthShareUsageDescription` /
   `NSHealthUpdateUsageDescription`; Android `android.permission.health.READ_STEPS`, the
   Health Connect package-visibility query, and an approved Google Play health data-access
   declaration. Also App Tracking Transparency + privacy manifest, already listed as
   outstanding at `EXPO_READINESS.md:43`.
5. **A native health dependency plus config plugin** in `apps/westayfit/package.json` —
   none present — which means the WSF surface stops being a pure static web export.
6. **Physical-device testing**: HealthKit does not serve step data in the iOS Simulator;
   Health Connect requires a real Android 14+ device (or an emulator image carrying the
   Health Connect provider) with seeded samples. No device is available in this window.
7. **Privacy policy + retention schedule covering health data.**
   `WE_STAY_FIT_MASTER.md:660` lists *"health-data collection ... privacy policy ...
   retention schedule"* as structurally undecided.
8. **A server-side ingestion + deduplication design.** HealthKit/Health Connect return
   overlapping time-ranged samples from multiple sources. `wsfContribute`'s model is an
   integer count keyed by a client `attemptId` for idempotency
   (`functions-westayfit/src/index.ts:2316-2330`); it has no concept of a sample set, a
   time range, or a source, so a feed cannot be mapped onto it without new backend design.

None of items 1–8 is achievable before 17:00 UTC. **No Connect button, real or fake.**

---

## Over-claiming copy audit

Greps over `apps/westayfit/app/**` and `apps/westayfit/src/**` (`*.ts`, `*.tsx`) for
`map`, `rank`, `leaderboard`, `compet`, `steps`, `wearable`, `watch`, `animate`, plus
`track|sync|connect your|device|smartwatch|apple|google fit|nearby|near you|discover`.

**Result: no user-facing copy claims a map, a ranking or leaderboard, step tracking, a
wearable/watch connection, or animation. Nothing needs to be changed or removed.**

| Term | Hits | Nature |
|---|---|---|
| `map` | all | `Array.prototype.map` calls, plus code comments: `livingWeCalibration.ts:2` "Maps a fill ratio", `LivingWeProgress.tsx:95` "maps dataSet", `labels.ts:7` "extends the map". Zero rendered strings. |
| `rank` / `leaderboard` | 1 | `app/community/[groupId]/index.tsx:1383`, a code comment asserting the *absence*: "Your part: exact own credit, no ranking, no comparison." Not rendered. |
| `compet` | 1 | `app/display/[goalId].tsx:171`, a code comment about promise ordering. Not rendered. |
| `steps` | several | Wizard step labels on the **dev** goal-creation screen (`app/goals/new.tsx:297` "Step 1 — community", `:314` "Step 2 — goal"); `app/profile-setup.tsx:163` "One step before you can start or join a community."; the ± stepper buttons in contribute (`stepButton`, `app/contribute/[goalId].tsx:1264-1281`); `steps` as the calibration table's resolution. **No fitness "steps" unit anywhere**; the prefilled goal unit is `'squats'` (`app/goals/new.tsx:70`). |
| `wearable` | 0 | Absent from app code entirely. Appears only in `WE_STAY_FIT_MASTER.md:388` as a never-collect item. |
| `watch` | 1 | `app/community/[groupId]/index.tsx:1086`, a code comment ("the Champion clicks the control and watches the goal"). No wrist-device sense anywhere. |
| `animate` | internals only | `LivingWeProgress.tsx` (`Animated.Value`, the unreachable `Animated.timing`) and `animationType="none"` on the Modal at `app/community/[groupId]/index.tsx:1030`. No copy promises motion. |
| `track` / `sync` / `connect your` / `nearby` / `discover` | 0 | Only `async` matched. `src/legalContent.ts` contains no mention of health, location, wearable or device. |

**One thing to be aware of, not a fix:** `MoveDoc.locationLabel` is rendered as a location
line on the challenge screen (`app/community/[groupId]/challenge.tsx:366-367`, typed at
`:42`). It is a free-text venue label on a seeded challenge move, member-gated through
`wsfListChallenge`, never public, and not written by any callable. It claims no map and no
member location — but it is the single place the product prints a location string, so any
statement of the form "WSF holds no location data" should be qualified with it.
