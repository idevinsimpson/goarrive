# EXPO-FULL-STAGING-RECOVERY-4: the ec162d17 staging pin, the unverified participant's hosted proof, and the marker rewrite

**Status: delivered for review, not accepted, not merged, not deployed.** All thirteen reserved paths are done:
- the bounded `pin-candidate.mjs` change (a third never-served link, history that may only be appended to, and `--added-functions`) and its tests;
- the generated pin for **ec162d17**, the live manifest for that build, and the three live-bound files RECOVERY-4 added (the verifier's live cases, the Home activation manifest and its test);
- the fixture kit, the `unverified-participant` driver and its registration;
- the operational `/go/**` rewrite.

This session's classifier refused the `pin-candidate.mjs` edit on 2026-10-07. The owner approved it inside the W3 session on 2026-10-09, together with the bounded `--added-functions` input, which is accepted only when it equals the export delta git measures. The consent is also recorded on GitHub (#365 `6074607727`, pointer #396 `6074612378`).

| | |
|---|---|
| **Packet** | EXPO-FULL-STAGING-RECOVERY-4: queue #365 `6076522846`, release `6076523104`; W3, inbox #396 (wake `5da49345…`, ack `6076764787`). It is RECOVERY-3 (queue `6075042219`, L0 delta #396 `6075046683`, withdrawn in `6076522602` for the reservation gap W3 reported in #396 `6076430760`) plus exactly the three paths named there. RECOVERY-3 succeeded RECOVERY-2 (queue `6074823456`, withdrawn in `6075036000`) and RECOVERY-1 (withdrawn in `6074820448`). The contract is #365 `6043040592` with recovery delta `6043989729`. |
| **Base** | operational `main` `41bff6c6`. |
| **Candidate / rollback** | **`ec162d17a0540e936741027f9b8f90dd372cfaf4`** (the latest accepted development head) / `ab77fbfce97e60c1c22492397b2ab6b491f9e0db` (served, run `37025084843`). |
| **Proof type** | Source only. Hermetic tests against fixture repositories, an in-memory backend and a scripted page model, and read-only `git` against the real history. Nothing deployed or dispatched, and no hosted run. |

## What the native app does at 819c26f0 and ec162d17 (read from source)

#586 opened the **server** to an account whose address is not verified: `wsfSaveProfile`, `wsfJoinCommunity`, `wsfJoinViaMarker` and `wsfContribute`. Its own QA record says the app's UI was out of scope.

That is still true at the new candidate **ec162d17**:
- **The screens are unchanged.** None of the 14 screens this journey touches changed between 819c26f0 and ec162d17 (`git log 819c26f0..ec162d17`, 0 commits each): sign-in, sign-up, verification, profile, join, marker (`go/[markerSlug].tsx`, `MarkerEntryScreen.tsx`, `markerEntry.ts`), contribute, progress, community home and both layouts. The line numbers below hold for both.
- **The server stays open.** At ec162d17, `JOIN_REQUIRES_EMAIL_VERIFIED = false` (`index.ts:656`), and `wsfSaveProfile` has no verification check. The only remaining checks guard organiser actions: `wsfCreateCommunity` (`:203`), `wsfCreateGoal` (`:3114`) and `wsfCreateCombinedGoal` (`:6805`).

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

## What changed (thirteen reserved paths)

### `.github/wsf-staging/pin-candidate.mjs` (owner-approved in the W3 session)

**A third never-served link.** Pinning ec162d17 over `0d3598d4` makes `0d3598d4` the third never-served approval in a row. Main's generator refuses that ("at most two never-served approvals may be superseded"). The bounded repair (#365 `6043989729`) allows exactly three (`MAX_NEVER_SERVED = 3`). It proves each approval from the commit that wrote it:
- **The record**, re-proved against git:
  - it was never served, with the same deployed pin, served SHA and anchoring run;
  - it descends from the served SHA and is a strict ancestor of the approval that replaced it;
  - it is not the served SHA, the deployed pin, the candidate, the superseded SHA or any link already in the chain (no cycle).
- **The link's own approval file**, read from git at the commit its record names (`matchesOperationalHead`):
  - That commit must be an operational commit after run 60's main and strictly before the commit of the approval that replaced it.
  - The file names the link. It was generated by this script from the same run, marker, rollback, measured 49 and retained set, and it rotated the deployed pin out.
  - The approval that replaced it quotes its notes and label word for word.
  - **History is append-only**: every history entry the link's file kept, the approval that replaced it still carries verbatim.

  - **Nothing unexplained**: the history of the approval that replaced a link holds nothing beyond the link's own history and the link rotated out. The link that replaced the deployed pin, or the superseded file itself when it did, carries the deployed approval's history verbatim and nothing else.

  Both rules were added in this round.
  - **Append-only** came from mutation testing: the copies of older history carried in the file this pin replaces were never compared with the file they came from.
  - **Nothing unexplained** came from the adversarial review. Without it, a hand edit to the replaced file's `_pinInvariants` could skip a never-served link while its history stayed. That would hide a fourth link under the three-link bound. The gap predates this change, and it fails closed now.

  The real chain meets both exactly: 27 entries at `0d3598d4` from `f84346d3`, 24 at `f84346d3` from `5705dc3b`, and `5705dc3b` from the deployed approval. In each case the keys are exactly the predecessor's plus three, with the carried values verbatim.
- **The chain's ends.** A link whose own file replaced the deployed pin ends the chain and must name nothing earlier. A fourth never-served approval is refused, and nothing is written.

**`--added-functions`.** A candidate that exports new callables fails the verifier as "present but not expected" unless the pin lists them in `candidateAddedFunctions`. The flag names them, and it is accepted only when it is **exactly** the export delta git measures from the served SHA to the candidate. It is refused if:
- a name is listed twice;
- either export list cannot be measured;
- the verifier's base cannot be read at the operational head;
- the candidate removes a function ("this workflow cannot remove a function");
- the list differs from the measured delta ("new and not listed" / "listed and not new");
- a name is one the verifier already expects (its base, or the retained list).

The new names are appended, sorted, after the retained list. The invariants record `newFunctions` (the names, what they were measured against, 49 → 59 exports, none removed), and the receipt prints `PIN_ADDED_FUNCTIONS`.

With the flag, the expected-prior note says three things:
- the deploy's creations are derived from the git delta (only configuration beyond the names is not);
- the deploy is expected to create exactly the ten;
- with this file operational, the verifier expects all 13 listed names, so a verification before that deploy fails by design, while the measured prior stays the 46-name base plus the three.

That wording applies only with the flag, so every earlier pin regenerates byte for byte.

### `.github/wsf-staging/tests/pin-candidate.test.mjs`

There are **171** cases (113 on main, plus 58):
- **The valid three-link chain (CHAIN3)**: generated, recorded (`priorNeverServed`), deterministic.
- **A fourth link (CHAIN4)**: refused, and nothing is written.
- **An inner chain built from sibling branches**: refused.
- **Tampering with one link at a time.** There are 32 cases across both inner links, built on one operational branch:
  - a record pointing at the wrong commit, another branch, or a commit with no approval file;
  - a record that drops or misnames the earlier link;
  - a link file that was changed after it was rotated, misquoted, rewritten, or that drops kept history;
  - a stale run or marker, another rollback, another inventory or retained set, the deployed pin not rotated, another candidate in its invariants, or another operational main;
  - a link that is the candidate, the served SHA, or a repeat of the first link;
  - a link approved on a side branch merged only after the approval that replaced it;
  - invariants hand-edited to skip a link;
  - history nothing explains, carried down to the link that replaced the deployed pin.
- **A one-link superseded file carrying history the deployed approval does not explain**: refused.
- **Added functions**:
  - the one or two callables git measures as new, accepted;
  - without the flag, a function-adding candidate generates exactly as before;
  - eleven refusals: left out, not new, retained listed again, nothing added, a removal, twice, not a service name, unmeasurable exports, an unreadable verifier, and already expected by the verifier or by the retained list.
- **The live branch**: the verifier base plus the retained names equals the measured prior, and the new functions are the rest.

### `.github/wsf-staging/approved-candidate.json` (generated)

Generated by `pin-candidate.mjs` from run 60. The approval passed with `--approval` is byte for byte the file run 60's main `b4b479a6` read, and the superseded approval is byte for byte the file at the operational head `41bff6c6`. The command is:

```
pin-candidate.mjs --approval <b4b479a6's approval> --superseded-approval <41bff6c6's approval> --ops-head 41bff6c6…
  --candidate ec162d17… --manifest .github/wsf-staging/journeys/manifest.json --label-file <the label>
  --run-id 37025084843 --run-number 60 --run-main b4b479a6… --run-date 2026-10-02 --inventory-before 49 --inventory-after 49
  --created none --verify pass --hosted-marker true --hosted-verify pass
  --run-title "WSF staging · mode=deploy · target=ab77fbfc…" --served-sha ab77fbfc… --run-marker ab77fbfc… --accepted-on 2026-10-08
  --added-functions wsfcommunityfacephotos,wsfcommunityfaces,wsfjoinviamarker,wsfmyprofilephoto,wsfpublicpreviewlabel,wsfremoveprofilephoto,wsfresolvemarker,wsfsetcommunityphotovisibility,wsfsetportraitdecision,wsfsetprofilephoto
```

**Receipt** (exact):

```
PIN_CANDIDATE=ec162d17a0540e936741027f9b8f90dd372cfaf4
PIN_PREVIOUS=0d3598d4a1dc72411b6d80d375335b84a497efdb
PIN_SUPERSEDED_NEVER_SERVED=0d3598d4a1dc72411b6d80d375335b84a497efdb
PIN_SERVED=ab77fbfce97e60c1c22492397b2ab6b491f9e0db
PIN_ROLLBACK=ab77fbfce97e60c1c22492397b2ab6b491f9e0db
PIN_EXPECTED_PRIOR_FUNCTIONS=49
PIN_ADDED_FUNCTIONS=wsfcommunityfacephotos,wsfcommunityfaces,wsfjoinviamarker,wsfmyprofilephoto,wsfpublicpreviewlabel,wsfremoveprofilephoto,wsfresolvemarker,wsfsetcommunityphotovisibility,wsfsetportraitdecision,wsfsetprofilephoto
PIN_PROTECTED_DELTA=17
PIN_FAST_PATH=ineligible
PIN_FAST_PATH_APPLIES=false
```

**The chain, as the generator proved it from git:**

| Link | Approved by | Its file stands at | It replaced | Record |
|---|---|---|---|---|
| `0d3598d4` (the file this pin replaces) | `7214a6fc` | `41bff6c6` (the operational head) | `f84346d3` | this pin's: `served:false`, run `37025084843`, served `ab77fbfc`, last deployed `a3127651`, `priorNeverServed` `f84346d3` |
| `f84346d3` | `757931b0`, recorded at `c70edcb5` | `01a07ef3` (#570) | `5705dc3b` | `0d3598d4`'s: `matchesOperationalHead` `01a07ef3`, `priorNeverServed` `5705dc3b` |
| `5705dc3b` | `807573c8` | `dcf86674` (#569) | `a3127651`, the deployed pin | `f84346d3`'s: `matchesOperationalHead` `dcf86674`; it names nothing earlier |

Run 60 (`37025084843`, main `b4b479a6`) served `ab77fbfc` in ledger fast-path mode over the deployed pin `a3127651` (`70a6a515`). Every ancestry relation holds. The boundary note says so: "It had itself superseded f84346d3…, also NEVER SERVED, which had superseded 5705dc3b…, also NEVER SERVED."

**What git measures from `ab77fbfc` to `ec162d17`:**
- **History**: 14 first-parent merges, 61 commits, 145 files. The queue's expectation said 15 merges; git measures 14.
- **Functions**: `functions-westayfit` tree `5a3f232e` → `cbe24a6b`. Exports go **49 → 59**, none removed. The ten new names are exactly the ten in the queue.
- **Expected inventory**: `candidateAddedFunctions` grows from the three social names to 13 (the three, then the ten, sorted). `expectedPriorFunctions` stays the measured **49**. The verifier's expected set after the deploy is the 46-name base plus 13 = **59**, so the reviewed deploy is **49 → 59, with `CREATED_THIS_DEPLOY` exactly the ten**.
- **Protected paths (17 files)**:
  - `apps/westayfit/package.json`: +`@mediapipe/tasks-vision` 0.10.35, from #577.
  - `firebase.westayfit.json` and `firebase.westayfit.emulators.json`: +`/go/**`.
  - `functions-westayfit/src/index.ts` and `profilePhotos.ts`.
  - Twelve callable test files.
  - `firestore.rules`, `firestore.indexes.json` and Storage rules are unchanged.
- **A gap, named and not fixed here.** `apps/westayfit/package-lock.json` also changes (+7). It is not in `PROTECTED_PATHS` (nor in `fastpath.mjs`'s `protectedPath`), so the protected delta does not list it. This is pre-existing. It does not change this pin, which is full-path either way. A later fast-path candidate whose only change is the lockfile would not be flagged.

**The label.** It covers all 14 integrations. The first six are summarised as the never-served `0d3598d4` label describes them, and that label is kept in the file's history. The eight new merges (`0745c732` … `ec162d17`) were checked by a workflow of 16 agents: one summarised each merge from its diff, and an independent agent refuted each summary against the code. The label carries the verified versions, including these corrections:
- **#577's camera** opens only on web and only for an exact `squats` goal. Opening it fetches the pose runtime from `cdn.jsdelivr.net` and its model from `storage.googleapis.com`, and the count is recorded as an ordinary contribution. The Settings switches show on native, where they do nothing.
- **#587**: a turn called before the new functions are served carries no binding, and no station can start, cancel or record it.
- **#593's seven photo callables and #584's preview label** have no app caller at ec162d17.
- **#596**: a refused station pairing now returns the screen to its pairing code at once.
- **#564**: the review corrected the label here. On the hall screen, a lost Start, Record or Let them go now prints #596's sentence, while a lost Call next keeps #564's.

### `.github/wsf-staging/journeys/manifest.json` (the live manifest, for ec162d17)

`productSha` is `ec162d17a0540e936741027f9b8f90dd372cfaf4`; `previousKnownGoodSha` stays `ab77fbfc…`. The changed-journey drivers enforce that it names the approved build. `MILESTONE_MANIFEST=valid`, with **9 journeys**, each with a registered driver.

**What ec162d17 changes for members and stations, beyond the build the attendee drivers were modelled on (0d3598d4).** There are eight first-parent merges:

| Merge | Member/station change | Hosted driver |
|---|---|---|
| #596 / #587 (`ec162d17`, `934f24f0`) | Station Start, Record and Let them go carry their own turn. A lost Record prints "No answer yet for {code}. “Try again” sends the result ({n}) again for that turn — it can’t count twice." and offers **Try again**. A Record's result comes from its own receipt | The five station journeys. Every station test ID they read still renders at ec162d17. The `station-lost-answer` exclusion is restated for #596's sentence, and `two-station-turns` names the binding as a request fact the screens do not show (proved on emulators) |
| #586 (`819c26f0`) | Server: an unverified ordinary participant may save a profile, join and contribute | `unverified-participant` (new). It is FAILED on the visitor rows until the native screens change |
| EVERGREEN-MARKER-ENTRY-1 (`09cc4cb1`) | `/go/{markerSlug}`: resolve, join by marker, How will you take part? | `unverified-participant` (the verified control joins by marker); the operational `/go/**` rewrite |
| MEMBER-PREVIEW-LABEL-1 (#584, `245c7717`) | `wsfPublicPreviewLabel`: link-unfurl labels, with no app caller | **none**: named as UNPROVEN under `unverified-participant` |
| #577 MOVE-CAMERA-NATIVE-PORT-1 (`856e20e0`) | Move mode: camera screen, body guide, squat counting, Adjust | **none**: named as UNPROVEN under `event-use-my-phone`. That journey records on the entry step, which is unchanged |
| #575 EXPO-MOVEMENT-VIDEO-1 (`0745c732`) | A catalog and clip player for the movement media slot. The approved catalog is empty, so no clip shows | **none**: named as UNPROVEN under `event-use-my-phone`, which says the catalog is empty |
| #593 PROFILE-PHOTOS-FIREBASE-1 (`b8381195`) | Profile and community-face photos (seven callables), with no app caller | **none**: named as UNPROVEN under `unverified-participant`, and the PHOTO exclusion stays |

No journey is invented for a change without a driver.

**The `unverified-participant` row** (`expected` is `EXPO_ROWS['unverified-participant']`, word for word):

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
  ]
}
```

Its exclusions name:
- the native screens that still hold the account (so the visitor rows are expected to FAIL);
- **the marker services arriving SHUT**: until the transport remediation, every row that goes through the marker fails on the marker's own error card, named, and that includes the verified control's;
- the Web Twin;
- the same uid;
- any mailbox or verified address;
- Safari and native builds;
- the per-IP preview bucket;
- the preview label and photos as UNPROVEN.

**Expected hosted outcome at ec162d17**, in the deploy run's report-only smoke. That smoke does not block the deploy; it says what is served.
- **Until the marker transport is opened**: FAILED on the eight visitor rows **and the control**. The marker rows name the marker's error card, and the rest name the screens that hold the account.
- **After the transport is opened, before the client prerequisites ship**: FAILED on the eight visitor rows, while the control passes.
- **After both**: all nine hold.

### The three paths RECOVERY-4 added (#365 `6076522846`)

- **`.github/wsf-staging/tests/verify-deployment.test.mjs`.** The three cases bound to the live approval move to the reviewed 49 → 59 shape, as `ed8649ec` did for the last pin that added functions:
  - **The 59-function case**: the live approval against a project that deployed this pin passes, with `EXPECTED_INVENTORY=59` and `createdThisDeploy` exactly the ten.
  - **The live-file tripwire**: it names the three social names and then the ten, over the measured 49, and the expected set after the deploy is 59.
  - **The end-to-end case**: the real gate admits `PREFLIGHT_BEFORE=49`, and the real verifier, fed the gate's output, passes **49 → 59**. It creates exactly the ten, loses nothing, and reports the three social services and the ten as `invoker_iam_check_enabled` (SHUT). It names the ten in `candidateServiceTransportNeedingApproval` and never calls them drift.

  The ten names are written out in the test (`ADDED_59`), not imported. The other 29 cases, including the 46-refusal case and the not-49 gate refusal, are unchanged. One comment that described the old live cases is corrected. **32 passed.**
- **`.github/wsf-staging/journeys/examples/home-northstar-parity-1.json`**: `productSha` `0d3598d4` → `ec162d17`, and no other field (the one-line retarget of `7b7b26f3`).
- **`.github/wsf-staging/tests/home-journey.test.mjs`**: `SERVED` and the refusal regex follow the manifest to ec162d17. As in `757931b0`, so do the header comment and the test title that name the same SHA. **33 passed.** `workflow-contract.test.mjs` needs no edit and is unchanged (103 passed).
- **What the Home retarget does not prove.** No Home-route file changed between `0d3598d4` and `ec162d17`. But the Home driver's `actions` and `returns` rows walk two screens that did change:
  - the Start moving sheet, `src/ui/FollowAlongCard.tsx`, changed by `0745c732` (#575);
  - the Already moved screen, `app/contribute/[goalId].tsx`, changed by `856e20e0` (#577).

  Only the hosted activation proves those two rows at ec162d17; this pin claims nothing about them. The review traced the source further.
  - **The expected result is FAIL.** At ec162d17 Home's Start moving opens `/contribute/{goal}?mode=move`, and #577's camera counter takes that step when all of these hold:
    - the counter setting is on, and it defaults on;
    - the goal's unit is exactly `squats`, as the Home fixture seeds;
    - the browser exposes `getUserMedia`, which hosted Chromium does.

    So the camera screen renders, not the MOVE sheet (`wsf-contribute-move-screen` / `wsf-contribute-sheet`) the `actions` and `returns` rows expect. Those two rows are expected to **FAIL** in a hosted activation run.
  - **Making them pass needs a change outside this reservation.** Either `journeys/home.mjs` seeds the counter off (`wsf.moveCamera.v1`, as the app's own e2e config does), or the Home rows are rewritten for the camera. This packet's Home edit is bounded to `productSha`.
  - **The attendee and unverified journeys are not affected.** They open the contribution without `mode=move`, which starts at entry, and the camera never opens there.

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

A registered driver runs only when the live manifest names its journey. The live manifest for ec162d17 now does (above); the eight attendee drivers are unchanged.

**The marker's error card is a named stop.** The review found that the marker services arrive SHUT with this pin. When the marker cannot be resolved, the row reads the marker screen's own error card (`wsf-marker-error`), not "none of the expected screens". The visitor's marker row and the control then name what stopped them.

### `.github/wsf-staging/tests/changed-journey-drivers.test.mjs`

There is a scripted model of the native screens in two states:
- **as served at 819c26f0**: sign-in, profile and marker hold the account;
- **repaired**: the account is routed like a verified one.

The model's service writes what `wsfSaveProfile`, `admitByLinkTx` and `wsfContribute` write, so the REAL `cleanup-synthetic.mjs` proves the driver claimed all of it.

| Run | Result |
|---|---|
| `changed-journey-drivers.test.mjs` | **106 passed** (82 on main, plus 24 new) |
| The live manifest at ec162d17 | `productSha` is the approved build; the nine journeys each have a registered driver; the `unverified-participant` row is `EXPO_ROWS['unverified-participant']` word for word, and its exclusions are asserted (including the SHUT marker services and the empty demo catalog); the eight-journey runner cases filter the manifest to the attendee journeys |
| **Marker services SHUT** (as this pin's deploy is expected to leave them) | As served, the eight visitor rows **and the control** fail. The marker row and the control name the marker's error card. With the screens repaired, every row that goes through the marker still fails (`marker`, `contribute`, `history`, `fresh`, `round`, `control`), while the join link holds. Cleanup is COMPLETE both ways |
| **As served at 819c26f0 / ec162d17** (the screens are the same; marker services answering) | Visitor rows `signin`, `profile`, `marker`, `link`, `contribute`, `history`, `fresh` and `round` **fail**, each naming its screen. The **control passes**. The visitor is admitted to nothing; Resend and I have verified are never pressed; no address or join code is in the results; cleanup is COMPLETE |
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

## After the deploy: transport, the turn transition, and what this pin proves nothing about

- **The ten new services are expected to arrive SHUT.** The deploy identity cannot set Cloud Run invoker policy (`run.services.setIamPolicy`), as with the three social and fifteen turn services before them, so they will have `invoker_iam_check_enabled`.
  - The verifier reports them in `candidateServiceTransportNeedingApproval` and never fails them as drift.
  - Until the separate operator remediation in `docs/westayfit/staging-station-transport.md` (a human step that L0 holds), none of these answers a browser: marker entry (`wsfResolveMarker`, `wsfJoinViaMarker`), the preview label and the seven photo callables.
  - The expected-turn binding (#587 server, #596 station) runs on services that already exist.
- **The turn transition (#587).** A turn called before these functions are served has no station binding, so no station can start, cancel or record it.
  - An assigned turn lapses after 45 s.
  - A ready or active turn holds its station until the member leaves or finishes on their phone.
  - A station page still on the previous build is refused ("This screen needs an update before it can run a turn.") until it reloads the new build.
- **Not proved by this pin:**
  - mail delivery or a mailbox;
  - a device or native build;
  - counting on a real body;
  - an approved demo clip;
  - a photo screen;
  - the Lovable Web Twin;
  - any hosted journey result;
  - the Home rows named above;
  - owner feel.

## Verification

| Check | Result |
|---|---|
| Full staging suite `run-all.mjs`, twice | **all suites passed**, exit 0, both runs. Among them: `pin-candidate` 171, `changed-journey-drivers` 106, `verify-deployment` 32, `home-journey` 33, `workflow-contract` 103, `hosted-changed-journeys` 13, `check-hosting-routes` 16, `read-inventory` 13, `milestone-manifest` 24, `check-milestone-manifest` 10 |
| Counts against main `41bff6c6` | `pin-candidate` 113 → 171; `changed-journey-drivers` 82 → 106; `verify-deployment` 32 → 32 (three cases rewritten); `home-journey` 33 → 33 |
| Fail-before: main's generator on the same input | Without the flag: `the superseded approval's inner link cannot be proved: it is itself a chain; at most two never-served approvals may be superseded`, `PIN=refused`, no file written. With it: `unknown argument "--added-functions"`, `PIN=refused` |
| Fail-before: the old live cases against this pin | With `approved-candidate.json` naming ec162d17 and the three RECOVERY-4 paths still as on main, `verify-deployment` fails three cases (`expected but absent:` the ten; 13 ≠ 3), `home-journey` fails one, and `workflow-contract` fails one (#396 `6076430760`). After the edits all pass |
| Byte identity: every earlier pin this script wrote, regenerated with the new generator from its own recorded inputs | `7214a6fc` (0d3598d4), `c70edcb5` (f84346d3), `757931b0` (f84346d3), `807573c8` (5705dc3b), `70a6a515` (a3127651): **all BYTE-IDENTICAL** |
| Determinism | Generating the ec162d17 pin twice gives identical bytes. sha256 of the committed file is in the delivery comment |
| Real chain, history exact | `0d3598d4` carries all 27 of `f84346d3`'s history entries verbatim, `f84346d3` all 24 of `5705dc3b`'s, and `5705dc3b` the deployed approval's. Each holds exactly its predecessor's keys plus three, nothing else |
| The live manifest at the pin | `WSF_APPROVED_SHA=ec162d17… check-milestone-manifest.mjs --require journeys/manifest.json`: `MILESTONE_MANIFEST=valid`, 9 journeys, each with a registered driver |
| Mutants of the generator change (applied to isolated copies, never to the worktree) | Pass 1: 58 mutants, 47 killed, 11 survived. Each survivor was a missing test or a real gap (the history copies were never compared, so append-only was added), and was closed. **Pass 2: 60 mutants, 58 killed.** The two survivors are equivalent. `ops-order-not-strict` would need a record to name the commit that contains its own file, which a commit hash cannot do (and a wrong file is refused by name anyway). `holder-approval-stale` is fixed by append-only: every key the second link's check reads is held to the same value one link out. Targeted mutants on the final code, all killed:
- two of the note wording;
- three of the review's "nothing unexplained" checks (holder, end link, direct replacement);
- the driver without its marker-error stop, where the row reads "none of the expected screens" |
| Adversarial review | Four independent reviewers (generator security, test integrity, facts, scope); each finding was then put to a refuting verifier. Twelve findings came in, and eleven survived. All eleven are addressed in this delivery: |
| | 1. **Fixed: outer invariants could hide a never-served link.** A hand edit to the replaced file's invariants could skip a link, which would hide a fourth under the three-link bound. Fixed with the "nothing unexplained" check. It predates this change, and it fails closed now |
| | 2–3. **Fixed: the added-functions note misdescribed the verifier.** It said the verifier expects 46+3 "before this deploy" and that creations were "NOT derived here". Reworded, with the flag only |
| | 4. **Fixed: the live-pin case dropped a check.** It no longer asserted that the three SHUT social services are named for transport approval. Restored, alongside the ten |
| | 5. **Reported, outside this reservation: Home Start moving.** At ec162d17 it opens the camera, not the MOVE sheet, so the Home `actions` and `returns` rows are expected to FAIL in hosted activation. Recorded above; the fix lies outside the Home bound |
| | 6. **Fixed: the control could not pass while the marker is SHUT.** The manifest exclusion now says so. The driver names the marker's error card, and a SHUT-marker model case is added |
| | 7. **Fixed: the label overstated #564's replacement.** Call next keeps #564's copy |
| | 8. **Fixed: an exclusion named an approved demo clip.** None exists; the exclusion now says the catalog is empty |
| | 9–11. **Fixed: the earlier QA record was stale or wrong.** It said the pin was blocked, gave "six" photo callables, put photos under the wrong journey, and omitted `wsfCreateCombinedGoal`'s verification check. This record replaces it |
| | Not upheld: the CHAIN3 fail-before test's name (it asserts shape, as main's precedent does) |

## Not in this change

- No product code, functions, rules, index, provider, IAM/WIF, secret, package, production, Lovable or real-participant data.
- `tools/wsf-control/shadow-run.mjs` and `app-token.mjs` are untouched (the unrelated W3 block stands).
- No deploy, dispatch or hosted run. No address is verified, and no email is sent. L0 merges and dispatches the full path once, after one ops-source review and Director acceptance.
