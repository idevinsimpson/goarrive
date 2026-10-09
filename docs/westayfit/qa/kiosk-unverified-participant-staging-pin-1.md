# EXPO-FULL-STAGING-RECOVERY-3: the unverified participant's hosted proof, the marker rewrite, and the pin it waits on

**Status: partial, not delivered.** The fixture kit, the driver, its registration, the operational `/go/**` rewrite and their tests are done (below). The staging pin is **not generated**, and so neither are the manifest rows, which name the pinned build.

It needs the bounded `pin-candidate.mjs` change that this W3 session's tool-permission classifier refused on 2026-10-07 ("Security Weaken"). The owner's consent is recorded on GitHub (#365 `6074607727`, pointer #396 `6074612378`), and as the queue says, it stays subject to this session's own permission check. The edit is not retried until the owner approves it inside the W3 session, where the approval has been requested.

| | |
|---|---|
| **Packet** | EXPO-FULL-STAGING-RECOVERY-3: queue #365 `6075042219`, release `6075043474`, L0 delta #396 `6075046683`; W3, inbox #396 (wake `e1511ca4…`, ack `6075387734`). It succeeds RECOVERY-2 (queue `6074823456`, withdrawn in `6075036000`), which succeeded RECOVERY-1 (withdrawn in `6074820448`). The contract is #365 `6043040592` with recovery delta `6043989729`. The reservation adds `tests/hosted-changed-journeys.test.mjs` and `firebase.westayfit.staging.json`. |
| **Base** | operational `main` `41bff6c6`. |
| **Candidate / rollback** | **`ec162d17a0540e936741027f9b8f90dd372cfaf4`** (the latest accepted development head; RECOVERY-3 replaced `819c26f0`) / `ab77fbfce97e60c1c22492397b2ab6b491f9e0db` (served, run `37025084843`). |
| **Proof type** | Source only. Hermetic tests against an in-memory backend and a scripted page model. Nothing deployed or dispatched, and no hosted run. |

## What the native app does at 819c26f0 and ec162d17 (read from source)

#586 opened the **server** to an account whose address is not verified: `wsfSaveProfile`, `wsfJoinCommunity`, `wsfJoinViaMarker` and `wsfContribute`. Its own QA record says the app's UI was out of scope.

That is still true at the new candidate **ec162d17**:
- **The screens are unchanged.** None of the 14 screens this journey touches changed between 819c26f0 and ec162d17 (`git log 819c26f0..ec162d17`, 0 commits each): sign-in, sign-up, verification, profile, join, marker (`go/[markerSlug].tsx`, `MarkerEntryScreen.tsx`, `markerEntry.ts`), contribute, progress, community home and both layouts. The line numbers below hold for both.
- **The server stays open.** At ec162d17, `JOIN_REQUIRES_EMAIL_VERIFIED = false` (`index.ts:656`), and `wsfSaveProfile` has no verification check. The only remaining checks guard organiser actions: `wsfCreateCommunity` (`:203`) and `wsfCreateGoal` (`:3114`).

There is no global redirect: `app/_layout.tsx` and `app/(tabs)/_layout.tsx` only check for a signed-in user. The screens that stop an unverified account:

| Step | File:line at 819c26f0 | What the page shows | Test ID a driver sees |
|---|---|---|---|
| Sign in | `app/signin.tsx:121-123` (also `:63`, and `signup.tsx:46`) | sent to `/verify-email` | `wsf-verify` |
| Verification page | `app/verify-email.tsx:343-441` | "Check your email." The only ways on are verifying or signing out. It sends mail only when **Resend** is tapped. | `wsf-verify-check`, `wsf-verify-resend`, `wsf-verify-signout` |
| Profile | `app/profile-setup.tsx:113-123` | "Verify your email before completing your profile." There is no name form. | `wsf-profile-unverified` |
| Marker join | `src/ui/MarkerEntryScreen.tsx:269-289` | "Confirm your email to join" replaces the Join button | `wsf-marker-verify` |
| Link join | `app/join/[joinCode].tsx:652-662` | Not a verification check. With no profile (blocked above), the server refuses: "We couldn’t join this community. Complete your profile before joining a community." | `wsf-join-submit-error` |
| Contribution, progress | `app/contribute/[goalId].tsx`, `app/(tabs)/activity.tsx` | not gated; reachable only as a member | — |

**The client prerequisites that remain.** Before this journey can pass hosted, the native app must route an unverified ordinary participant to its profile step and let it save its profile and join by the marker. That means the three checks at `signin.tsx:63/121` (with `signup.tsx:46`), `profile-setup.tsx:113` and `MarkerEntryScreen.tsx:269`. It is a separate UI slice; this packet changes no product code. The Lovable Web Twin is a different host and is not exercised here.

## What changed (five reserved paths)

### `.github/wsf-staging/journeys/fixture-kit.mjs`

`createVerifiedUser` and `signIn` are unchanged (tested byte-for-byte). New:
- **`createUnverifiedUser`**:
  - Uses the same admin create, run-specific synthetic email and in-memory password, with `emailVerified:false`.
  - Tracks the account the moment its uid exists.
  - Reads the account back; one that was stored as verified is refused, and it is still cleaned up.
  - If a create's answer is lost, it looks the account up by its synthetic email and tracks it before failing (*signup unknown outcome*).
- **`joinableEvent`**:
  - A run-tagged **public** community with its own join code, one open squats goal (`repeatPolicy: 'multiple'`) and an approved active marker `wsfMarkers/<runTag>-<label>`.
  - Its only member is a placeholder Champion. **No visitor membership or profile is made**: joining and saving are the product's to do.
- **`expectVisitor`**: claims the visitor's membership and profile by their deterministic names before the visitor acts. The cleaner admits the untagged `wsfMemberProfiles/<uid>` through that run-tagged membership.
- **`claimMemberships`**:
  - An admin query of `wsfMemberships` by the account's uid.
  - Tagged rows are claimed by path. Any other row (*a join that landed in the wrong community*) is claimed as LINKED through the uid, which the cleaner checks against the stored record.
- **`signInLanding`**: signs in through `/signin` and reports where it lands, never treating `/verify-email` as success. It only diagnoses.

Nothing verifies an address. The kit contains one `emailVerified: true` (the unchanged verified maker), no account update and no out-of-band code; a test pins this.

### `.github/wsf-staging/journeys/expo-attendee.mjs`

The new `unverified-participant` driver (rows `EXPO_ROWS['unverified-participant']`). On its own phone, the unverified visitor:
1. signs in;
2. saves its profile;
3. joins by the approved marker;
4. opens the community's join link;
5. records 15 with Move on my phone;
6. reads Your progress;
7. in a fresh browser (a new context: no cookies, storage or saved sign-in), signs in again and reads Your progress;
8. records a new round of 10.

A verified account with no profile walks the same path as the **control**.

Every row reads the page. Where a screen stops the account, the row fails and names that screen; the seen text never carries an address (scrubbed) or a join code (`/join/[link]`). The driver never presses Resend or I have verified, so a hosted run sends no mail and verifies nothing.

**It is registered:**
- `expoDrivers` carries it, and its rows are `EXPO_ROWS['unverified-participant']`.
- The reviewed, frozen list in `tests/hosted-changed-journeys.test.mjs` (added to the reservation by RECOVERY-2) now names it.

A registered driver runs only when the live manifest names its journey, and that row lands with the pin that names its build. The live manifest and the eight attendee journeys are unchanged.

### `.github/wsf-staging/tests/changed-journey-drivers.test.mjs`

There is a scripted model of the native screens in two states:
- **as served at 819c26f0**: sign-in, profile and marker hold the account;
- **repaired**: the account is routed like a verified one.

The model's service writes what `wsfSaveProfile`, `admitByLinkTx` and `wsfContribute` write, so the REAL `cleanup-synthetic.mjs` proves the driver claimed all of it.

| Run | Result |
|---|---|
| `changed-journey-drivers.test.mjs` | **103 passed** (82 on main, plus 21 new) |
| Full staging suite `run-all.mjs` | **all suites passed** (`hosted-changed-journeys` 13, `pin-candidate` 113, `cleanup-synthetic` 42, …) |
| **As served at 819c26f0** | Visitor rows `signin`, `profile`, `marker`, `link`, `contribute`, `history`, `fresh` and `round` **fail**, each naming its screen. The **control passes**. The visitor is admitted to nothing; Resend and I have verified are never pressed; no address or join code is in the results; cleanup is COMPLETE |
| **Repaired** | All nine rows hold. The product admits the visitor, who is credited 15, then 25. Cleanup is COMPLETE |
| Seeded defects (repaired), each failing exactly its rows and still leaving nothing | sign-in alone still holding → `signin`, `fresh`; marker join writes nothing → `marker`, `control`; link opens another page → `link`; link admits elsewhere → `link` (its stray membership is claimed and removed); profile not saved → everything after `profile`; double count → `contribute`, `history`, `fresh`, `round`, `control`; credit lost after a fresh sign-in → `fresh`, `round`; a second round refused → `round`; progress missing → `history`, `fresh`; shared total misses the contribution → `contribute`, `round` |
| Kit tests | `emailVerified:false`, tracked, read back; stored-as-verified refused yet cleaned; lost answer found and cleaned; nothing made means nothing tracked; verified maker unchanged; public link and active marker with no visitor membership, every document tracked and no join code in the manifest; a wrong-community membership claimed and removed while the real community and another person's membership stay; failure after the product wrote, or before the join, still cleans to empty |
| Mutants (fixture-kit.mjs and expo-attendee.mjs) | **18 / 18 killed**: made verified, no read-back, lost answer not looked up, untracked before read-back, private community, one round only, inactive marker, profile not claimed, wrong community not claimed, verification landing counted as signed in, join code printed, verification text unscrubbed, fresh sign-in reusing the browser, marker join not checked, shared total not checked, control not checked, no sweep after the link, new round not checked |
| Fail-before | The new test file against main's kit and driver: exits 1 (`expo-attendee.mjs` has no unverified journey, and the kit has no unverified account) |

### `firebase.westayfit.staging.json` (operational, RECOVERY-3)

One rewrite is added, `{ "source": "/go/**", "destination": "/go/__dynamic.html" }`. It goes last, in the same order and shape as the candidate's `firebase.westayfit.json`; nothing else changes.

The candidate has declared `/go/**` since EVERGREEN-MARKER-ENTRY-1, and the operational config did not route it. The deploy job's `check-hosting-routes.mjs` refuses exactly that case. That was the dead end L0 found (#365 `6075036000`).

| Real `check-hosting-routes.mjs`, with a dist holding the 13 destinations the candidate declares | Result |
|---|---|
| ec162d17 against main's operational config (before) | `ROUTES=failed (2)`: "/go/__dynamic.html … routes nothing to it" and "/go/** is declared by the candidate and matches no operational rewrite" |
| ec162d17 against this config (after) | `ROUTES=pass`: 13 candidate rewrites, 13 operational, 13 built |
| Rollback ab77fbfc (12 rewrites, no `/go` page) against this config | `ROUTES=pass`, with the note that `/go/**` points at a page this candidate does not build. Never a failure, so the rollback is not blocked |

The existing `workflow-contract` suite (103) and `check-hosting-routes` suite (16) pass unchanged. The site, codebase, headers and every other rewrite are untouched.

### Untracked product writes, named

Opening the marker and the join link calls `wsfResolveMarker` and `wsfPreviewCommunity`. Each increments the per-IP bucket `wsfPreviewRateLimits/<hash>`. That is shared product state keyed by a hashed address and a time window, not a fixture and not provably this run's, so it is left to roll over. Nothing else the journey makes the product write is untracked.

## The pin (blocked)

**The chain, re-read from git on main (read-only):**
- Run 60 (`37025084843`) served `ab77fbfc`; the last deployed approval is `a3127651` (`70a6a515`).
- `5705dc3b`: approved at `807573c8`, merged at `dcf86674` (#569). It replaced the deployed approval directly. Never served.
- `f84346d3`: approved at `757931b0`, recorded at `c70edcb5`, merged at `01a07ef3` (#570). Its record: supersedes `5705dc3b`, `served:false`, anchored on run `37025084843` (served `ab77fbfc`), `matchesOperationalHead` `dcf86674`, last deployed `a3127651`.
- `0d3598d4`: the current approval, at `7214a6fc`. Its record: supersedes `f84346d3`, `served:false`, `matchesOperationalHead` `01a07ef3`, `priorNeverServed` `5705dc3b`, the same run and anchor.

Pinning `819c26f0` over `0d3598d4` makes `0d3598d4` a **third** never-served link. The reviewed generator refuses that ("at most two never-served approvals may be superseded"). The Director's bounded repair (#365 `6043989729`) is to allow exactly three, proving each approval from the commit that wrote it.

That edit to `.github/wsf-staging/pin-candidate.mjs` was refused by this session's classifier. It is not retried and not routed another way. The pin is not hand-written, and no older candidate is redeployed to manufacture an anchor.

**What lands once the owner approves that edit in the W3 session:**
- the bounded `pin-candidate.mjs` change and its tests (old cases byte-identical, the exact three-link chain, tampering with each link, a fourth link refused);
- the generated `approved-candidate.json` for `819c26f0`;
- the live `manifest.json` moved to `819c26f0` with the journey below;

**The manifest row, ready to land with the pin** (`expected` is `EXPO_ROWS['unverified-participant']`, word for word):

```json
{
  "id": "unverified-participant",
  "entry": "/go/{markerSlug}",
  "setup": "native app, hosted web build: a fresh synthetic account whose address is not verified (no profile, no membership) on its own phone; a public community with a join link and an approved marker for one open squats goal (target 1000, seeded 100); a separate verified account with no profile as the control",
  "actions": [
    "sign in, then save a profile",
    "open the approved marker and press Join, then open the community's join link and press Join",
    "from the marker press Move on my phone and record 15, then open Your progress",
    "in a fresh browser with nothing stored, sign in again, open Your progress, and record a new round of 10",
    "the verified control signs in, saves a profile, joins by the marker and records 5"
  ],
  "knownExclusions": [
    "the Lovable Web Twin: another host, proved by its own runner (LOVABLE-KIOSK-HOSTED-PROOF-1), not this journey",
    "the same uid: the screens never show one; the same account signs in both times and its own total carries over",
    "a mailbox or a verified address: no mail is sent and nothing is verified; Resend and I have verified are never pressed",
    "Safari and native iOS/Android builds: hosted Chromium only",
    "the per-IP preview bucket (wsfPreviewRateLimits) the marker and link pages increment: shared product state, not a fixture"
  ]
}
```

**Expected hosted outcome at 819c26f0.** Until the client prerequisites above ship, this journey is honestly **FAILED** on the eight visitor rows, each naming the screen that holds the account, while the verified control passes. The changed-journey smoke is report-only, so that does not block the deploy; it says what is served.

## The manifest for ec162d17 (lands with the pin)

The live manifest names the pinned build (`productSha` = `approvedAppSha`, enforced by `changed-journey-drivers`), so it moves only with the pin. Below is what it must say for ec162d17, read from source on 2026-10-09.

**What ec162d17 changes for members and stations, beyond the build the attendee drivers were modelled on (0d3598d4).** There are eight first-parent merges:

| Merge | Member/station change | Hosted driver |
|---|---|---|
| #596 / #587 (`ec162d17`, `934f24f0`) | Station Start, Record and Let them go carry their own turn; a lost Record prints "No answer yet for {code}. “Try again” sends the result ({n}) again for that turn — it can’t count twice." and offers **Try again**; a Record's result comes from its own receipt | The five station journeys. Every station test ID they read still renders at ec162d17, and their rows still describe the behaviour. The `station-lost-answer` exclusion must change: the lost-answer sentence is now #596's, not #564's `describeCallableError` copy |
| #586 (`819c26f0`) | Server: an unverified ordinary participant may save a profile, join and contribute | `unverified-participant` (new). FAILED on the visitor rows until the native screens change |
| EVERGREEN-MARKER-ENTRY-1 (`09cc4cb1`) | `/go/{markerSlug}`: resolve, join by marker, How will you take part? | `unverified-participant` (the verified control joins by marker); the operational `/go/**` rewrite above |
| MEMBER-PREVIEW-LABEL-1 (`245c7717`) | `wsfPublicPreviewLabel`: link-unfurl labels | **none**: listed as unproven |
| #577 MOVE-CAMERA-NATIVE-PORT-1 (`856e20e0`) | Move mode: camera screen, body guide, squat counting, Adjust | **none**: listed as unproven. The phone journeys use the record step, which is unchanged |
| #575 EXPO-MOVEMENT-VIDEO-1 (`0745c732`) | An approved movement demo loops in the player's media slot | **none**: listed as unproven (already an owner device-review exclusion) |
| #593 PROFILE-PHOTOS-FIREBASE-1 (`b8381195`) | Profile and community-face photos (six callables) | **none**: listed as unproven, and the PHOTO exclusion stays |

**Manifest edits that land with the pin:**
- `productSha` becomes `ec162d17a0540e936741027f9b8f90dd372cfaf4`; `previousKnownGoodSha` stays `ab77fbfc…`.
- The `unverified-participant` journey is added, with the row drafted above.
- The `station-lost-answer` exclusion is restated for #596's sentence.
- Each change without a driver is named in the exclusions of the journey it touches, as **unproven**, never asserted:
  - camera and demo video under `event-use-my-phone`;
  - the preview label and photos under `event-join-line`.

No journey is invented for them.

## Not in this change

- No product code, functions, rules, index, provider, IAM/WIF, secret, package, production, Lovable or real-participant data.
- `tools/wsf-control/shadow-run.mjs` and `app-token.mjs` are untouched (the unrelated W3 block stands).
- No deploy, dispatch or hosted run. No address is verified, and no email is sent.
