# NATIVE-PARITY-TARGET-1: WE STAY FIT native frozen target and verified gap map

Target path: `docs/westayfit/native/NATIVE-PARITY-TARGET-1.md`
Date: 2026-10-20
Scope: `apps/westayfit` built for iOS and Android (Expo SDK 54, react-native 0.81.5 with the new architecture, expo-router ~6.0.23, Reanimated ~4.1, Firebase JS SDK 11.10). The parity reference is the Lovable "WE Community Home" prototype.
Status: frozen for the native sprint. The journey manifest's rule applies here too: an issued reference never moves silently. Any change ships as a new revision (NATIVE-PARITY-TARGET-2), never as an edit to this file.

---

## 1. Header

### 1.1 Reference SHAs

| Role | SHA | Notes |
|---|---|---|
| Lovable head (newest feed entry) | `301699d673d44c7de43ae400d800c34bb046502c` | #578 comment 6181037749, 2026-10-14T23:49:52Z, mirror:true, native_relevant:false. Docs-only (STAGING-RECONCILE-1 rev 4, northstar_from fef431e51d9160a4062a80752cb30749df0620dd). **This is not a native visual target.** Its tree contains every held combined-candidate change: 517b961a...301699d6 is 1089 commits ahead, and held a7adf252 is an ancestor (81 commits ahead). |
| Newest revision with mirror:true and native_relevant:true | `517b961a230d2d70f254454941a870edce0c6bbf` | #578 6043346938. Take only its Together-receipt and receipt-footer scope, per the 6043366036 metadata guard. Its tree has held ancestors (6465d3d8...517b961a is 12 ahead). |
| Canonical base | `a6eaf0be95cb0a81de4f24bc6d7f30ac82ce922f` | goarrive `apps/westayfit`. BACKEND-AUTHORING-1 (#578 6129763231) read goarrive at this SHA. |
| Native snapshot reviewed | `c704b25acda0169ca5b916e80e5c368575a64c93` | NATIVE-BOOT-1 head, read-only worktree. **Every `file:line` in this document refers to this tree**, relative to `apps/westayfit` unless the path starts with `../../`. |
| Lovable PARITY-REGISTRY canonical pin | `0745c7323eed24fbb5e1e9b8fc2bac4a6d1fea7e` | **Stale.** It is an ancestor of a6eaf0be, 43 commits behind, and predates the marker entry (1545f36d, merged 09cc4cb1), the camera merge 856e20e0 (#577) and the photo backend 5faac5de (merged b8381195, #593). `NATIVE_MIRROR.nativeHead = 0745c73` is observational only. `nativeMirroredThroughLovableSha = null`; no mirroredThrough record exists at a6eaf0be, so the value is UNVERIFIED / none. |
| Journey manifest | blob `481bcf845db27eb11a0b97f377c45a469ebe6e3a` | `docs/westayfit/ops/NORTH_STAR_JOURNEY_MANIFEST.json`, asOf 2026-09-26. Byte-identical at a6eaf0be and c704b25a. The snapshot has no `docs/westayfit/ops/journeys/` directory. |
| State-lane candidate (seen by verifiers, not reviewed here) | `claude/wsf-native-candidate-1` @ `80cd713f` | Verifiers inspected it read-only with `git show`. It contains NATIVE-STATE-1 `810ef50e` and NATIVE-STATE-2 `b463cdee`. It is not part of the snapshot. Gaps below are stated against c704b25a, and candidate coverage is noted as reported, not re-verified. |

### 1.2 Precedence: how to read the frozen target

The target is set per journey, not by one SHA.

1. A journey-specific frozen reference in `NORTH_STAR_JOURNEY_MANIFEST.json` wins.
2. Director-issued route packets that post-date the manifest come next. For Home and MOVE this is the W9 target a15a610e (product) / 973e1141 (evidence); HOME-NORTHSTAR-PARITY-1 was accepted against 973e1141.
3. #578 deltas with mirror:true and native_relevant:true are layered on top, in feed order:
   - b84a4689 (6026116822)
   - 82255fe7 / 2fe3ba66 (6026965114 / 6027105034)
   - c3a071b5 (6027240281)
   - 3c84c93c (6029083187)
   - 8457358e..37b9d93b (6035672487..6041456822)
   - 517b961a (6043346938)
4. Combined-candidate changes after 517b961a are held (latest restatement #578 6128628549, never lifted). Feed #578 has 244 comments. The last 26 (6129763231..6181037749) are docs-only, mirror:true / native_relevant:false, and do not lift the hold.
5. NORTHSTAR-CONSUMER rule 6: native may differ only for real platform primitives. These are safe areas, native permissions, native navigation and keyboard (platform Back instead of `history.pushState`), and the native camera implementation. They are required on native whether or not a Lovable delta is held.

### 1.3 Evidence-state legend

| Label | Meaning |
|---|---|
| **SI-C** | SOURCE INSPECTED, adversarially confirmed. A second reviewer tried to refute it from source and `node_modules` and could not. Corrected severity and lane are applied. |
| **SI-1** | SOURCE INSPECTED (single reviewer), not adversarially verified. Every P2/P3 finding without a verdict carries this label. "×N" means N independent reviewers reported the same thing. |
| **SI-R** | SOURCE INSPECTED by the target reconciler against Lovable and canonical refs. These are target deltas missing on both web and native. |
| **NDC** | NEEDS DEVICE CHECK. Source cannot settle it; the exact check is given (also collected in Appendix C). |
| **TV** | TEST VERIFIED by a local harness run (no device, no binary). Used only for the hosting `.well-known` glob test. |

Nothing in this document is device-verified. No binary was built and no camera accuracy was assessed. "UNVERIFIED" marks every claim that source alone could not confirm.

### 1.4 Severity and lanes

- **P0**: crash, blank screen, data-truth or privacy risk on native.
- **P1**: a member-loop step unusable or materially wrong on native.
- **P2**: a visible parity divergence from the web twin or the Lovable reference (visual, motion, navigation, focus).
- **P3**: polish.

Lanes:
- **integrator**: app shell, config, deps, shared navigation, fonts and assets, unowned files.
- **state**: in flight.
- **motion**: in flight.
- **camera**: in flight.
- **member-feature**: Community, You, Settings, start, join and photos UI.
- **held-backend**.
- **out-of-scope**.

The `known:` prefix marks gaps already assigned to an in-flight lane before this review.

### 1.5 Discrepancies surfaced by reconciliation

1. `/review/north-star/home-ready` appears in every feed entry since 6128628549, but it is not a state in `src/wsf/north-star/registry.ts` at 301699d6, so it renders "Unknown North Star state". Use `home-active`.
2. The Lovable PARITY-REGISTRY pin (0745c73) is stale (see 1.1).
3. Desired native-relevant deltas absent from canonical a6eaf0be, which affect web and native alike:
   - first-run tour v2 and its replay (MF-14)
   - b84a4689 camera readiness chrome and ±5 / Reset / Count again (CAM-03)
   - pending/unknown badges (ST-08)
   - the reached-unsignaled copy (MO-01)
   - the per-account pinned community + goal destination (owner decision, Appendix E)
   - the 517b961a Together repair: `src/contributionFlow.ts:436-442` still requires `before != null` to animate (MO-01)
4. `app/verify-email.tsx` re-checks only on DOM `visibilitychange`, and only in the `unconfigured` outcome. The frozen auth reference asks for an auto-check on return (INT-13).
5. Not resolved:
   - the "frozen J02 refs" cited in 6042903372 / 6043077948 were not found in canonical docs (UNVERIFIED)
   - "export bdd69358", cited by canonical d9d209f4, is not a commit in `idevinsimpson/we-stay-fit-foundation-trial` (UNVERIFIED)
   - the goal-composer pixel verdict is still pending on the Lovable side

---

## 2. Frozen target per journey

Short SHAs are expanded in 2.2. "Gaps" in the native-relevance column are IDs from section 4.

| # | Journey | Reference SHA and evidence | Canonical state | Native relevance and gaps | Approved differences | Hold |
|---|---|---|---|---|---|---|
| J1 | Home (selected community, goal hero / Living WE, actions, your part, momentum) | W9 a15a610e / 973e1141, plus b84a4689 (post-confirm totals), 3c84c93c (tour v2) and 37b9d93b (tour card stays on screen). Manifest home row is null (fallback d4f60624); Director #497 5846941982 issued 973e1141. Evidence: Lovable @973e1141 `motion-handoff-evidence/mhc-home-default-390x640.png` / `-390x844.png` (sha256 fcb0d786… / 8f79bb31…) and `northstar-evidence/joined-home-390x640/844.png`. Lab `home-active`. Canonical `docs/design-target/review/home-northstar-parity-1/`, `home-polish-1/` | **partial**. Accepted 9d27fdb5 (#514 5848551777), merged a3127651. Post-confirm adoption present (`src/memberReads.ts:398`). First-run tour MISSING (no tour code in app/ or src/) | Yes. ST-01, ST-03, INT-04, INT-12, INT-21, INT-22, MF-11, MF-14, HB-02 | No sample strip or "Sample data". +N presence only for visible members on a complete list (no anonCount / extraMembers). Join policy sits in the descriptor slot; no place or descriptor. No moved-today line when contributorsToday is null. Native font and glyph rendering may differ | Combined hold #578 6128628549 (first 6043366036, owner hold 6043077948): activity collapse 76beebce, phone fit 2a34b686, lazy momentum deb53987, zero-community welcome 7d96de6b, presence 0942c4ed, faces. Live presence and momentum blocked on staging (wsfcommunitymembers, wsfcommunityactivity) |
| J2 | Community list (identity, goals, roster, switcher) | d4f60624 (manifest `journeys.communitySettings`). Evidence decoded in `docs/design-target/review/community-parity-1/lovable-d4f60624/`. Lab `community-member`, `community-champion`, `community-multi-switcher`. Canonical `community-settings-parity-1/` | **mirrored**. ffb517e5 (#506 5845751705), integrated 938e00d8 | Yes. ST-03, MF-01, MF-05, MF-06, INT-20, HB-03 | Manifest acceptedDifferences (no prototype strip or kicker; authoritative group type, join policy and windows; native glyphs may differ; fixture roles truthful). Unnamed remainder = memberCount − named, only when memberCount is known, the first page is complete (nextCursor null) and the result is > 0 | Live roster blocked (wsfcommunitymembers). INVITE-1 8c667af2 held (6128628549) |
| J3 | Community detail (members page, challenge, member grid) | Inherits J1 plus HOME-POLISH-1 544a385e (evidence 872c32fc). The bounded grid is defined only by photo handoff 0a468eaa (#578 6043515827); the Lovable Members sheet is still sample (useDemo). Lab `home-community-faces` (photo scope; connected mode shows initials). Canonical `community-presence/` | **partial**. `members.tsx` renders the named list only | Yes. ST-01, MF-10, MF-09, MF-11, HB-02, INT-21 | Names only from wsfCommunityMembers {displayName, role}; no uid and no hidden counts. Initials until the photo adapter is live | Faces: wsfcommunityfaces and wsfcommunityfacephotos blocked. List: wsfcommunitymembers blocked |
| J4 | Progress | 09b8a73c (manifest `progressFirstContribution`) plus b84a4689. Evidence decoded in `docs/design-target/review/progress-parity-1/lovable-09b8a73c/` and `progress-first-contribution-evidence/*.png`. Lab `progress-with-contribution` | **mirrored**. bdc82c0e (#504 5844877908), staged in 74d19281 | Yes. INT-02, INT-05, INT-12, INT-20, MF-19 | Dated own receipts omitted (`receipts: null`, `app/(tabs)/activity.tsx:408`). No per-unit totals across goals. Private own history stays distinct from shared history; units are never blended. No scores, streaks or rankings | PROGRESS-SELF-HISTORY-1 held (MY_CONTRIBUTIONS_PORT null, #578 6181037749). "Unavailable" slot at `src/ui/ProgressParityView.tsx:288-291` |
| J5 | You | 642f830b (manifest `youMemberReturn`). Product 16363f95 and truth fix 24089f9c are **not** the issued ref. Evidence `you-member-return-evidence/`. Lab `you-champion`. Canonical `you-parity-1/` | **mirrored**. 18ba6de2 (#503 5845316258). "You > Help" tour replay MISSING | Yes. MF-03, ST-03, MF-14 | The AI "What do you hope to get?" card is web-first (#578 6027240281); whether native adopts it is an owner decision (UNVERIFIED). Synthetic local profile in Lovable vs server identity in canonical | Memberships list PROGRESS-YOU-WEB-1 5b61c6e0 held. Verify reminder under KIOSK-SCAN-START-1 hold 6042513468 (b032078e scope UNVERIFIED). Own photo is in photo scope (backend blocked) |
| J6 | Settings / privacy | d4f60624. Settings originals at 390x640 and 390x844 in `community-parity-1/lovable-d4f60624/`. Lab `settings-privacy` | **mirrored**. ffb517e5, merged 938e00d8 | Yes. MO-03, CAM-02, MF-04 (NDC), INT-09, INT-14, MF-20 | Server-settled privacy (adopt the settled value, revert on failure). Literals "private" or "visible"; absent means visible. MOVE prefs (camera counter, stick figure) stay device-local, both default ON | Privacy write blocked (wsfsetcommunityvisibility). Per-community "Show my photo" is in photo scope. DISPLAY-PRESENCE-1 held |
| J7 | MOVE manual (sheet, count entry) | W9 a15a610e / 973e1141 (manifest move row null, fallback d4f60624) plus b84a4689. Evidence `mhc-count-390x420-*.png`, `mhc-count-review-return-390x420.webm`. REFERENCE-HANDOFF motion: sheet open 240 ms cubic-bezier(.22,1,.36,1), exit 180 ms, step change 200 ms with ±18 px. Lab `move-manual-review`. Canonical `app-feel-parity-1/`, `-2/` | **partial**. APP-FEEL-PARITY-1 cp1/cp2 merged 91392f9d / 0b460ce3. b84a4689 pending/unknown badges missing | Yes. ST-03, INT-07, MO-02, INT-17, INT-19, ST-08 | Do not port: the simulated outcome radio, Prototype tools, `wsf-proto-state-v5`, CSS keyframes (port values only) or `history.pushState` back. Count 1..100000; "How many {unit} did you complete?". Keyboard avoidance and safe areas required (rule 6) | Quick-add 3b342cb4 (#578 6106612237) and keyboard resize 7ae447b5 (#578 6126106083) held under 6128628549 |
| J8 | Review / confirm | W9 a15a610e / 973e1141 (Review → Edit keeps the value → Close) plus b84a4689 (review note "From a camera estimate of N · you set the final number"). Lab `move-manual-review`. Canonical `recovery-port-1/` | **partial**. Heading "Review your contribution" (`app/contribute/[goalId].tsx:2546`). Camera-estimate wording differs (`:2683`) | Yes. INT-07, INT-19, INT-16, CAM-03 | Idempotent wsfContribute {goalId, attemptId, count} keyed on goal + uid + attempt; a replay returns alreadyRecorded. The shared total is shown only after confirmation | none |
| J9 | Pending / reconcile | RECOVERY-TRUTH-1 02cb35c4 / evidence 97faee8b (managed record 5420802a), plus W9 a15a610e (attempt id removed from member copy) and the b84a4689 badges. Evidence `northstar-evidence/interrupted-reopened-390x640/844.png`. Lab `contribution-pending` | **partial**. RECOVERY-PORT-1 merged 6b96ba1b at 86c160ae. Badge copy only in `src/ui/designTarget/MoveFlowTargets.tsx:682` | Yes. **ST-02 (P0, known)**, ST-06, ST-08, INT-19 | Do not port notFound "Check again" / "Discard attempt"; canonical retries the SAME attempt. Legacy unscoped records are orphaned, never adopted. Key `wsf.pendingContribution.{goalId}.{uid}`; state is "sending" or "unknown" only | none |
| J10 | Together receipt + crossing | Base 66e53073 ("export bdd69358" UNVERIFIED). TOGETHER-COMPLETION-NORTHSTAR-1 348805fe. Deltas b84a4689 and 517b961a. Evidence `together-completion-evidence/`, plus `docs/evidence/together-receipt/` @517b961a (results.json, gather-wave-settled strips m640/m844, reduced-m844, reopen-same-receipt-static-m844). Lab `together-completion`, `together-fresh-crossing` | **partial**. d9d209f4 (merged 22766935, #567). Animate gate requires `before` (`src/contributionFlow.ts:436-442`). Reached copy at `:336` | Yes. MO-01; known: TogetherCompletion starts motion only on web; INT-16, INT-18 | Crossing only on explicit `crossedTarget === true`; reachedAt never substitutes. No inferred "before"; with before null the fill holds at after/target. Port motion values, not CSS | Crossing held at the backend (crossedTarget is always false; MEMBER-TRUTH-BACKEND-1 Part A blocked, #497 6031313067) |
| J11 | Receipt detail (in-flow, Progress sheet) | In-flow: 517b961a (footer no longer overlaps Done) over the W9 confirmed receipt. Progress ReceiptSheet: Lovable `src/demo/overlays.tsx`. Evidence `northstar-evidence/confirmed-390x640/844.png`. Lab `contribution-confirmed-receipt` | In-flow **mirrored**; Progress detail **held** (`activity.tsx:69, 424-425`, onOpenReceipt is a no-op) | Yes. INT-09 (page-mode navy receipt), INT-16, INT-19 | Recorded contributions are never summed into credit; credit comes from wsfMyContribution. An own-only receipt shows no community panel when the shared fields are absent | wsfMyContributions held |
| J12 | Start community | Goal composer packet 128644b3 / 917fc319 (first-goal two-action footer). No manifest row. Evidence `goal-composer-evidence/start-community-first-goal-390x640/844.png`. Lab `start-community`. Canonical `start-community-next/` | **partial**. Lands on `/community/{groupId}` (`app/start-community.tsx:474, 492`). No chained first-goal footer; GOAL-COMPOSER-NORTHSTAR-1 not ported | Yes. INT-06, INT-09, MF-15, INT-20 | groupType familyFriends or custom; joinPolicy private, inviteOnly or public. An unconfirmed create is never retried; one call in flight at a time; a verified email is required | none |
| J13 | Goal composer | 128644b3 / 917fc319 (manifest `goalComposer`). Movement capability 0b881829 (prior 6ab12079). Evidence `goal-composer-evidence/` (composer-after 390x640/844, composer-review-390x844, composer-multi-390x844) and `goal-parity-evidence/`. Lab `goal-setup` | **partial**. Lovable pixel verdict pending (UNVERIFIED) | Yes, on staging and emulator builds. MF-07, MF-12, INT-06, INT-09, MF-22 | Single movement only (MOVEMENT-PILLS-1, Director eeb5eed0, #483 5836712806). Jumping jacks are a prototype extra. Production renders a refusal (`app/goals/new.tsx:59-62, 685-704`) | none |
| J14 | Invite / join | W9 a15a610e / 973e1141 (valid / invalid / expired / unavailable / already-member, "Join & open Home"). Destination deltas c3a071b5 (#578 6027240281) through 37b9d93b (#578 6041456822). Evidence `northstar-evidence/invite-ready-*`, `variant-*-390x640/844.png`. No lab state. Canonical `batch-b-join-and-setup/`, `join-outcome-correction/` | **partial**. The destination card names the kind only (`src/authDestination.ts`; approval UNVERIFIED). No per-account community + goal pin (goalId carried via eventReturn, max 2 h) | Yes. INT-03, MF-02, MF-01, ST-04; known: pendingJoinCode; INT-08, MF-05 | One generic not-found for unknown, invalid or expired codes (`app/join/[joinCode].tsx:203-207`). Join is idempotent. Do not port local join, Prototype fixtures or fictional communities | INVITE-1 `/?join=&goal=` link (8c667af2) held |
| J15 | Marker entry (`/go/<slug>`) | No issued frozen target (`docs/westayfit/qa/evergreen-marker-entry-1.md:136`). Behaviour of record: b84a4689 QR entry; Lovable prototype `src/routes/go.$markerKey.tsx`. No lab state | **partial**. Phase A merged 09cc4cb1 (1545f36d) | Yes. HB-01, ST-04, INT-03, MF-21 | An explicit Join tap is the only write; the member then chooses "Move on my phone" (MOVE does not auto-open). Never Firebase Dynamic Links | wsfresolvemarker and wsfjoinviamarker blocked. Operator utility held (#497 6028638316). Kiosk-intent held (6043077948 / 6128628549) |
| J16 | MOVE camera squat | 14543570 (MOVE-CAMERA-NATIVE-PORT-1) plus b84a4689: readiness strip (In view / Whole body / Steady), dashed-to-green guide, Counting badge, Adjust −1/+1/−5/+5, Reset to estimate, Count again. Lab `move-camera-acquiring`, `-countdown`, `-counting`. Canonical `docs/westayfit/qa/move-camera-native-port-1.md` | **partial**. Web merged 856e20e0 (#577) / 896b94c9. Native is web-only (known). Readiness strip and ±5 / Reset / Count again absent (`app/contribute/[goalId].tsx:2655-2674` has ±1 only) | Yes. Camera lane known; CAM-01, CAM-02, CAM-03 | The native camera implementation is a permitted platform difference; frozen r14.2.1 counter files are never edited. The estimate never auto-credits | CAMERA-MOVE-WEB-1 gap-fill 85365233 (#578 6077811201) and kiosk camera deltas held |
| J17 | Profile photos (own photo, community faces) | Owner scoped handoff #578 6043515827: 8c8e8a84 plus 0a468eaa, photo hunks only. Decision `docs/decisions/WSF-PROFILE-PHOTOS-COMMUNITY-PRESENCE-1007-v1.md`; donor `src/wsf/avatar/**`. Lab `you-profile-photo`, `home-community-faces`. Backend contract `docs/westayfit/qa/profile-photos-firebase-1.md` | **missing**. No `apps/westayfit` file calls any photo callable; backend only (`functions-westayfit/src/profilePhotos.ts`) | Yes. No native gap filed (see section 3) | Native permission differences preserved. Fail closed to initials. Small, metadata-free square JPEG only | Backend merged b8381195 (#593, 5faac5de). The 7 photo callables are blocked on staging |
| J18 | Movement demo media | No Lovable reference. Canonical-owned EXPO-MOVEMENT-VIDEO-1 (3d1d30a6, merged 0745c732 #575). Evidence `docs/westayfit/qa/expo-movement-video-1.md` (frozen BEFORE 9, accepted TARGET/AFTER 20) | **unknown** (nothing to mirror) | Yes. Motion lane known (NEXT); MO-06, MO-07, MO-08, MF-05 | Native shows the poster or the drawn guide until a native player lands | `APPROVED_DEMO_MEDIA` is empty (`src/movementDemoMedia.ts:53`); checklist item 4 PARTIAL |
| J19 | Auth entry (sign in, sign up, verify, profile, reset) | 82255fe7 / 2fe3ba66 (#578 6026965114 / 6027105034): Step N of 3, verify auto-check on return, spam tip, 30 s resend wait, name-step visibility copy. Lab `/review/north-star` (no dedicated state); Lovable `docs/evidence/signup-verify-1009/` (held era) | **partial**. "Step 1 of 3" / "Step 2 of 3" present (`app/signup.tsx:139`, `app/verify-email.tsx:349`). Auto-check only in the `unconfigured` outcome via `visibilitychange` (`app/verify-email.tsx:165-214`). 30 s resend UNVERIFIED | Yes. INT-06, INT-13, MF-13, INT-24, INT-20, MF-18 | The destination card names the kind only (see J14) | SIGNUP-VERIFY-WEB-1 e76702c6, DEFERRED-VERIFY-RESTORE ed3966f0 and Forgot password 392f146f held. Canonical already has wsfSendVerificationEmail and wsfSendPasswordResetEmail; unverified join allowed (a17ee3e2) |

### 2.1 Native acceptance anchors per journey (from the reconciler; detailed cases in section 4)

- **J1**
  - On an iOS release build, a member with one community opens the app on Home. It shows the community name, the goal title, the Living WE and "N of target" equal to the server total, with no sample band.
  - On Android, after confirming +20 and tapping Done, Home shows the new shared and own totals without a pull-to-refresh.
  - The first-run tour auto-starts once per account + community + version, and only when there is no overlay and no unresolved attempt. Android Back closes it, and it can be replayed from You > Help.
- **J2**: On an iOS release build with two communities and none remembered, Community asks which one rather than marking the first as CURRENT. A failed roster read shows no hidden-member count.
- **J3**: On an Android release build, opening Members from Home and pressing system Back returns to Home with the scroll position kept. No name appears for a member whose "Show my name" is off.
- **J4**: On an iOS release build, a member with no confirmed contribution sees the first-contribution action on Progress, and it opens MOVE. A failed own read shows "Unavailable", never 0.
- **J5**: On an Android release build, You shows the identity, the current-community band, and the member's exact own part separately from the shared position. Sign out clears the per-uid community memory, and a second account never sees the first account's community.
- **J6**: On an iOS release build, turning "Show my name" off and then forcing a server failure reverts the toggle and states that nothing changed. Android Back closes the Settings side panel and returns focus to the control that opened it.
- **J7**: On an iOS release build at 390x640 with the software keyboard open on the count field, Back and Review stay reachable. Android Back on the count step returns to the opener tab with focus on MOVE. With Reduce Motion on, the sheet appears and dismisses with no translate.
- **J8**: On an Android release build, double-tapping Record sends one wsfContribute with one attemptId. Edit returns to Adjust for a camera estimate, or to Enter for manual entry, with the value kept.
- **J9**: On an iOS release build, kill the app while a +12 attempt is in flight, then reopen. The same attempt shows "Not confirmed yet" with no attempt id visible and no credit given. Check status replays the same attemptId and credits it once.
- **J10**:
  - On iOS, a fresh +20 receipt with `before:null` below target plays gather → pulse → waves once, with the fill fixed at after/target. Closing and reopening shows it static.
  - With Reduce Motion on at mount, it starts settled.
  - A replay (`alreadyRecorded:true`) is static.
  - "WE did it. Together." appears only on a fixture with `crossedTarget:true`.
- **J11**: On an Android release build at 390x640, Done and Record more never overlap, and Done returns to the tab MOVE was opened from. Progress shows "Dated receipts aren't available here yet" and no tappable receipt rows.
- **J12**: On an iOS release build, creating a community with the keyboard open keeps both footer actions above the keyboard and the safe area. A lost reply shows the unconfirmed note, and retrying does not create a second community.
- **J13**: On an Android staging build, the date and time fields use native pickers, the device IANA zone is shown in review, and a target above 100,000,000 is refused before any call is made.
- **J14**: On an iOS release build, open a join link while signed out, create an account, verify, and set a name. The app lands in that community once. A second account on the same device never inherits the pending join.
- **J15**: On an iOS release build, opening `https://<host>/go/<slug>` from the camera app opens the app on the marker screen, or falls back to the web. Signed out, it returns to the same marker after sign-in. A non-member sees Join, and nothing is written before the tap.
- **J16**: On an iPhone release build, the first "Start moving" shows the iOS camera permission dialog. Denying it falls back to manual count. Finish freezes the estimate into Adjust.
- **J17**: On an iOS emulator-backed build:
  - Choose a photo from the library (OS permission prompt), crop it, upload it, and see it on Home and You. A same-community peer sees it.
  - After Hide in community B, a peer in B sees initials.
  - After Remove, the old token resolves to nothing.
- **J18**: On an Android release build with the emulator test catalog, the clip plays muted and looping behind the poster, appearing only after playback starts. With Reduce Motion on, the poster stays still.
- **J19**: On an iOS release build, verify the email in Mail and switch back to the app. It advances without a tap on "I've verified".

### 2.2 SHA index (short → full)

- W9: a15a610e = `a15a610e51c05b8d974c50ce0de85592ae49403d` (product); 973e1141 = `973e114191d6fb43665ead26513f9247c8eb244c` (evidence)
- d4f60624 = `d4f606244ba3995080fb0bcd471cbebf4cbbc56a`
- b84a4689 = `b84a4689c671681946a75b34334e44fa8a88af31`
- 3c84c93c = `3c84c93c321136a0abca5811e9cf4371b63efdc7`
- 37b9d93b = `37b9d93b228b652cc6f0223fd8763d2167be1d8b`
- c3a071b5 = `c3a071b577d845072e1fa276c2d13c5e2f0af8db`
- 517b961a = `517b961a230d2d70f254454941a870edce0c6bbf`
- 544a385e = `544a385e78e48cdf812ff766db68a58962329c87`; 872c32fc = `872c32fcf7b0bd0c5dcbc8c006190b6c7fde83ac`
- 09b8a73c = `09b8a73cc4e661115e52cb1ec4aebcb625c5fc9a`
- 642f830b = `642f830baa1153b0d9465dc75690028768083fb7`
- 02cb35c4 = `02cb35c4e31d6d4ec67156a43ca7729cf9e2450f`; 97faee8b = `97faee8bdfada9198f21109fcdb5ae41c27d1473`; 5420802a = `5420802a965a9e9497507a8b5c0c1292524fb424`
- 66e53073 = `66e53073df1f09ca727454e4186dd301865a8ad1`; 348805fe = `348805fe2fc680b056e02e06047ae775b2abec66`
- 128644b3 = `128644b3f27cbe00cf4a5dec467a49389efb5134`; 917fc319 = `917fc319b04f4ce05a5be71d92d83aa419794a4e`
- 0b881829 = `0b88182968cfe074ef8231807dd396eea17586f8`; 6ab12079 = `6ab120799a08a313b78da0d064beb89addc234a5`
- 14543570 = `1454357098b9d066f310aee977455f5024c69d28`
- 8c8e8a84 = `8c8e8a847927386c132778731cbd5eb8fea254e9`; 0a468eaa = `0a468eaa231c108d4983f676db02989efebd66c4`
- 82255fe7 = `82255fe75cfcfadabc2eb1e14e57daf0087d1ec6`; 2fe3ba66 = `2fe3ba66feb8f6c1e8818bf47dca2fa9ebe0ae93`
- Held refs:
  - INVITE-1 8c667af2 = `8c667af2328b6d853a9ee9d0559f0ceb2aba76a2`
  - PROGRESS-YOU-WEB-1 5b61c6e0 = `5b61c6e03b4e59aa8e1a87fd4669c3514f934b38`
  - quick-add 3b342cb4 = `3b342cb46bfa9e29ef8fc6eae891e94d7f2fecc8`
  - keyboard resize 7ae447b5 = `7ae447b5dabd67f466c8106933c32a374f81ec13`
  - CAMERA-MOVE-WEB-1 85365233 = `853652338f513bf4d5cdd8c20edd395a8cbdfcc3`
  - hold a7adf252 = `a7adf252fb5441741aad84e9930b6ddf77999152`
  - 6465d3d8 = `6465d3d856be11d6e05ed0420585f3a96186e909`
  - Prefix only: 76beebce, 2a34b686, deb53987, 7d96de6b, 0942c4ed, e76702c6, ed3966f0, 392f146f, 8457358e

### 2.3 Global approved differences (apply to every journey)

- NORTHSTAR-CONSUMER rule 6 platform primitives (see 1.2).
- REFERENCE-HANDOFF `doNotPort`:
  - the serverLedger and the simulated outcome radio
  - the read-only notFound "Check again" / "Discard attempt"
  - the legacyAmbiguous Keep/Remove quarantine
  - Prototype tools, sample scenarios, the role switch and the Coverage sheet
  - sample identities, counts and "Sample data · Design prototype" labels
  - `wsf-proto-state-v5` and demo confirmation timing
  - CSS keyframe / `@media` motion (port values and behaviour only)
  - `history.pushState` overlay back
- REFERENCE-HANDOFF `intentionalDifferences`:
  - the SAME attempt is retried
  - pre-uid legacy attempts are kept without being adopted
  - the Firebase server record replaces the simulated ledger
  - the shared total is shown only after confirmation
- Manifest communitySettings acceptedDifferences (see J2).
- WEB-TWIN-AUTHORITY P2b/P3b1:
  - no hidden-member counts beyond the unnamed-remainder rule
  - server-settled privacy
  - crossing only on `crossedTarget === true`
  - "reached" derived from totals
  - omitted where no canonical source exists: community place and descriptor, dated own receipts, per-unit totals across goals, "(you)" marking, the receipt "before" figure
- Device-local MOVE preferences (camera counter, stick figure) by design.
- Web-only Lovable surfaces are not native targets: link-preview meta and OG images, preview/staging bands, `/review` lab routes, marketing pages.

---

## 3. Held features and permitted native preparation

| Held feature | Hold reference | Permitted native preparation | Native note |
|---|---|---|---|
| KIOSK-SCAN-START-1 kiosk scan/start, private Event controls, phone kiosk line, receipt fixes (b032078e kiosk content; verify-reminder ambiguity) | Owner hold #578 6042513468 (22bc9b51: "Do not mirror to native") and 6043077948 (6465d3d8), restated through 6128628549 (a7adf252). No comment among all 244 #578 entries lifts it | None for kiosk. Keep canonical `/event`, `/queue` and `/kiosk` behaviour unchanged, and add no kiosk-intent phone-MOVE behaviour | The canonical kiosk route still exists in the native binary. ST-05 and MF-08 make sure it does not leak a session (privacy), which is fix work, not kiosk mirroring |
| Combined-candidate member-visible Lovable changes after 517b961a: Home activity collapse, lazy loading and consolidation; phone Home fit; zero-community welcome; Home presence; MOVE quick-add +1/+5/+10; MOVE keyboard resize; You memberships list; Champion Invite card; Forgot password; deferred verify; signup verify; CAMERA-MOVE-WEB-1 gap-fill; policy pages; public display; DISPLAY-PRESENCE Settings choice; notification bell | #578 6128628549 (latest, a7adf252) and 6043366036..6126158153, all mirror:false. Later docs-only mirror:true entries 6129763231..6181037749 (468751c8..301699d6) carry changed_journeys "none" and do not lift the hold | Do not mirror these Lovable deltas | Native platform primitives remain required regardless: keyboard avoidance (INT-06, INT-07), safe areas (INT-09), Android Back (INT-19), text scaling (INT-15), reduced motion |
| Profile photos and community faces (own photo, crop, portrait offer, faces row, bounded grid, per-community "Show my photo") | Lovable combined hold 6043077948, superseded for photos by owner handoff #578 6043515827. Backend merged b8381195 (#593, 5faac5de). The 7 photo callables are blocked on staging | Build the native adapter per `docs/westayfit/qa/profile-photos-firebase-1.md` using the frozen photo hunks at 0a468eaa only: emulator and synthetic images only, initials fallback, OS camera and library permission prompts. Capture the native ACTUAL BEFORE first | No Storage bucket, rules or IAM change. No real-person upload. No claim that staging is live. Not yet packeted to member-feature (the owner schedules it) |
| Together crossing celebration ("WE did it. Together.") | Server crossedTarget is always false: MEMBER-TRUTH-BACKEND-1 Part A blocked (#497 6031313067) | Implement and fixture-test the crossing path gated strictly on `crossedTarget === true`. Never infer it from totals or reachedAt | Motion lane, alongside MO-01 |
| Progress dated receipts and receipt detail (wsfMyContributions) | PROGRESS-SELF-HISTORY-1 held: MY_CONTRIBUTIONS_PORT null (#578 6181037749; only a draft exists in Lovable `backend-canonical/`) | Keep the `receipts: null` slot and its "unavailable" copy. A receipt-row component may sit behind the null port | No local ledger, and no summing of recorded contributions into credit |
| Marker entry live (`/go/<slug>` resolve and join) | wsfresolvemarker and wsfjoinviamarker blocked on staging. Operator utility held (#497 6028638316) | Source and emulator parity of `/go/<slug>`, plus native deep-link routing through expo-router linking (INT-03: scheme and universal/App Links) | Never Firebase Dynamic Links. See HB-01 |
| Community roster, momentum activity and privacy writes on staging | wsfcommunitymembers, wsfcommunityactivity and wsfsetcommunityvisibility blocked on staging | Source parity plus emulator proof. Fail closed to unknown states. Privacy adopts the settled value and reverts on failure | HB-02, HB-03 and MF-04 cover the misleading-copy side |
| Public preview label and share previews | wsfpublicpreviewlabel blocked on staging. Previews are web meta only | None needed on native | none |
| Movement demo clip | APPROVED_DEMO_MEDIA empty: no approved clip (EXPO-MOVEMENT-VIDEO-1 checklist item 4 PARTIAL) | Motion lane adds an expo-video player behind the empty catalog. Test catalog in the emulator only. Poster or drawn-guide fallback; with reduced motion, a still poster | MO-06 and MO-07 add the lifecycle and URI-model contract |
| Kiosk and display backend needs: KIOSK-ROSTER-1, RAFFLE-JOIN-1, KIOSK-LIVE-POSE-1, DISPLAY-PRESENCE-1, CHAMPION-CAMERA-1, KIOSK-ACTIVE-REMAINING-1, KIOSK-STATION-QUEUE-1, KIOSK-GUEST-MOVE-1, MEMBER-ACTIVITY-1 | Open backend_needs in #578 6181037749 (`docs/CLAUDE-NEEDS-2026-10-11.md` in Lovable) | None for the member loop | none |

Backend facts that apply throughout:
- 13 callables are platform-auth-blocked on staging: wsfcommunityactivity, wsfcommunityfacephotos, wsfcommunityfaces, wsfcommunitymembers, wsfjoinviamarker, wsfmyprofilephoto, wsfpublicpreviewlabel, wsfremoveprofilephoto, wsfresolvemarker, wsfsetcommunityphotovisibility, wsfsetcommunityvisibility, wsfsetportraitdecision, wsfsetprofilephoto.
- wsfMyContributions is held.
- Firebase Dynamic Links are shut down. Never propose them.

---

## 4. Verified gap list by owner lane

Already fixed on the snapshot and not re-reported:
- the `src/firebase.ts` window.location read at module load
- `src/InAppBrowserBanner.tsx`
- native Auth persistence
- the native env gate

### 4.1 Integrator

| ID | Sev | Title | file:line | Status | Merged from |
|---|---|---|---|---|---|
| INT-01 | P0 | No crash containment (no ErrorBoundary, no global handler) | app/_layout.tsx:15 | SI-C | CONN-CRASH-1 |
| INT-02 | P0 | Progress crashes on Android when its list is partial (`accessibilityRole 'status'`) | src/ui/ProgressParityView.tsx:269 | SI-C | CLPY-01 |
| INT-03 | P1 | https links never open the app (no Universal Links / App Links) | app.json:13 | SI-C, TV | SRN-01, EAJ-02, XMOD-3, LINK-1, HOME-N1 (integrator half) |
| INT-04 | P1 | Home and entry errors have no Retry; nothing re-reads on reconnect | app/(tabs)/(home)/index.tsx:603 | SI-C | CONN-OFFLINE-2 |
| INT-05 | P1 | Menu Sign out on Progress or Community leaves iOS with no controls | app/(tabs)/_layout.tsx:146 | SI-C | CLPY-03 |
| INT-06 | P1 | No keyboard avoidance on entry forms | src/AuthFormPrimitives.tsx:211 | SI-C | EAJ-09, HOME-N5, SRN-02 (forms) |
| INT-07 | P2 | MOVE count entry: number pad covers Review | app/contribute/[goalId].tsx:2819 | SI-C | MR-01, SRN-02 |
| INT-08 | P2 | No canonical public web origin on native | src/ui/kioskLink.ts:29 | SI-C | CD-01, EAJ-06, LINK-2, MR-11 (origin) |
| INT-09 | P2 | Root-stack screens ignore the top safe area; one global dark StatusBar | app/_layout.tsx:25 | SI-C | VIS-01, SRN-04, HOME-N2, EAJ-10, MR-06, CLPY-11 |
| INT-10 | P2 | Staging strip under the status bar, doubled gap, hidden by modals, "build dev" | src/StagingBanner.tsx:26 | SI-C (inset) / SI-1 | VIS-02, SRN-05, CLPY-08 |
| INT-11 | P2 | A native build can ship with sign-in off | app.config.js:10 | SI-C | EAJ-11, HOME-N9 |
| INT-12 | P2 | No foreground/resume refresh of member data | app/(tabs)/(home)/community/[groupId]/index.tsx:1418 | SI-C | LIFE-1, HOME-N8, MR-09 |
| INT-13 | P2 | Email action links finish in the browser; verify-email has no foreground re-check | app/verify-email.tsx:165 | SI-C | EAJ-03, LIFE-5, LINK-5 |
| INT-14 | P2 | Top-bar menu covers its own button on notched phones; no outside-tap or Back dismissal | src/ui/MemberTopBar.tsx:209 | SI-1 ×3 | SRN-03, VIS-06, HOME-N3 |
| INT-15 | P2 | Shell large-text reflow keyed to window width | src/ui/MemberTabBar.tsx:173 | SI-1 ×3 | SRN-06, VIS-07, HOME-N6 (tab bar) |
| INT-16 | P2 | MOVE and receipt numerals have unbounded font scale | src/ui/TogetherCompletion.tsx:230 | SI-1 | MR-08 |
| INT-17 | P2 | Screen-reader focus placement, return and modal containment are web-only | src/ui/focusReturn.ts:271 | SI-1 | SRN-11, MR-03, MR-02 (focus) |
| INT-18 | P2 | Announcements rely on aria-live (Android-only) | app/contribute/[goalId].tsx:1974 | SI-1 | MR-02 (announce), HOME-N12 |
| INT-19 | P2 | Android Back discards the MOVE flow; leaves silently while sending | app/contribute/[goalId].tsx:1028 | SI-1 (+SI-C residual) | MR-04, CONN-RECORD-3 (Back residual) |
| INT-20 | P2 | Root `router.replace` tears down tabs or duplicates stacks | app/(tabs)/activity.tsx:422 | SI-1 | CLPY-09, EAJ-18 |
| INT-21 | P2 | iOS clips the hero shadow where `overflow:'hidden'` shares the view | src/ui/kit.ts:89 | SI-1 ×4 | VIS-03, HOME-N10, CD-10, MR-10 |
| INT-22 | P2 | Non-asChild expo-router Link renders as Text (Home cards, challenge card) | app/(tabs)/(home)/index.tsx:686 | SI-1 | HOME-N4, CD-11 |
| INT-23 | P2 | No native icon or splash | app.json:13 | SI-1 ×2 | VIS-05, SRN-16 |
| INT-24 | P2 | Password AutoFill not associated with the web domain | app/signin.tsx:184 | SI-1 | EAJ-15 |
| INT-25 | P2 | A failed fresh read replaces the usable warm contribution screen | app/contribute/[goalId].tsx:749 | SI-1 | CONN-RECORD-5 |
| INT-26 | P2 | Retry joins a hung in-flight read | src/memberReads.ts:184 | SI-1 | CONN-READS-6 |
| INT-27 | P2 | Stalled-network cold start holds "Loading…" for up to 60 s with no shell | src/auth.tsx:22 | SI-1 | CONN-BOOT-7 |
| INT-28 | P3 | Cold deep links have no Home beneath; default "Unmatched Route" exposes the sitemap | app/_layout.tsx:76 | SI-1 | SRN-14 |
| INT-29 | P3 | A push from inside a sheet becomes an iOS page-sheet card | app/contribute/[goalId].tsx:2240 | SI-1 | SRN-13 |
| INT-30 | P3 | Tab content double-counts the bottom inset | app/(tabs)/community/index.tsx:214 | SI-1 | SRN-15 |
| INT-31 | P3 | No Android elevation where only iOS shadow props are set | src/ui/MemberTabBar.tsx:315 | SI-1 ×2 | VIS-08, SRN-12 (shadow) |
| INT-32 | P3 | Tab bar semantics: "link" role, doubled "current"/"selected" | src/ui/MemberTabBar.tsx:213 | SI-1 | SRN-12 |
| INT-33 | P3 | No press feedback on any Pressable | src/ui/OptionRow.tsx:42 | SI-1 ×2 | XMOD-6, SRN-12 (pressed) |
| INT-34 | P3 | `userInterfaceStyle` light not enforced on Android | app.json:8 | SI-1 | VIS-09 |
| INT-35 | P3 | `fontFamily 'monospace'` falls back to proportional on iOS | app/health.tsx:51 | SI-1 | VIS-11 |
| INT-36 | P3 | Counts follow the device locale while % and Progress cells use fixed en-US | src/ui/progressFormat.ts:122 | SI-1 | MR-14 |

#### INT-01 · P0 · No crash containment: any render-time throw kills the native process
- **Where:**
  - `app/_layout.tsx:15-30` and `app/(tabs)/_layout.tsx:48-64` export only default components.
  - A grep for ErrorBoundary, ErrorUtils, setGlobalHandler, componentDidCatch and getDerivedStateFromError across app/ and src/ finds nothing.
  - `node_modules/expo-router/build/useScreens.js:128-147` wraps a route only when the route exports `ErrorBoundary`.
- **Status:** SI-C. P0, integrator.
- **Native:** an uncaught render error is fatal.
  - `ErrorHandlers.js:59-64`: handleException(error, true).
  - Android: `ExceptionsManagerModule.kt:46-55` throws a JavascriptException, and `expo/.../ExpoReactHostFactory.kt:64-72` rethrows because no handlers are registered.
  - iOS: `RCTExceptionsManager.mm:57-84` calls RCTFatal, and `RCTAssert.m:122-147` @throws.
  - Timer and event throws take the same path (`ReactInstance.cpp:84-91, 112, 146`).
  - Unhandled rejections are dropped in release (`polyfillPromise.js:28-35`).
  - The live trigger today is ST-01. The relaunch crash loop comes from Home auto-replacing to the only community (`app/(tabs)/(home)/index.tsx:494-505`, `src/currentCommunity.ts:63`), not from persisted navigation state (verifier correction).
- **Web:** react-native-web unmounts the root to a blank page; the tab survives and a reload recovers.
- **Acceptance:**
  - On an Android release build with a deliberate render throw injected into the Community tab, a contained error screen with "Try again" and a way to Home appears inside that tab. The top bar and tab bar still switch tabs, and `adb shell pidof com.westayfit.app` is unchanged.
  - On an iOS release build, the same throw injected into Progress leaves Home, Community and You usable. "Try again" re-renders Progress once the throw is removed.
  - On a release build, a throw in the root shell (e.g. StagingBanner) renders a fallback that needs no SafeAreaProvider or WsfAuthProvider, with a working retry.
  - On an Android release build, an injected `window.location.origin` read during community detail render shows the contained screen. This regression test does not depend on when ST-01 lands.
  - On a release build, a throw in a `setTimeout` and an unhandled rejection are both recorded: persisted and surfaced on the next launch, or sent to a reporter. The record carries no email, display name, goal title or join code.
- **Fix sketch:**
  - Add `src/ui/RouteErrorFallback.tsx`: plain RN with "Try again" (calling retry()) and a "Go to Home" link, using no providers.
  - Export `ErrorBoundary` from `app/(tabs)/(home)/_layout.tsx`, `app/(tabs)/community/_layout.tsx`, `app/(tabs)/activity.tsx` and `app/(tabs)/you.tsx` (one-line export, coordinated with member-feature), and from `app/move/index.tsx`, `app/contribute/[goalId].tsx` and `app/settings.tsx`. The contribute fallback must say "not confirmed, check Progress", never "recorded". Add a provider-free last resort in `app/_layout.tsx`.
  - Add `src/crashContainment.ts`, imported first. It wraps `ErrorUtils.getGlobalHandler()` to persist a scrubbed record, then calls the previous handler (never swallowing a fatal error). In release it enables Hermes rejection tracking.
  - A crash reporter is an owner decision.
  - Out of scope: the intentional env-gate throws at module load (`src/firebase.ts:113, 161-165`, `src/firebaseAuthInit.native.ts:23-27`).

#### INT-02 · P0 · Progress crashes on Android whenever its list is partial
- **Where:** `src/ui/ProgressParityView.tsx:269` (`accessibilityRole={'status' as never}`, rendered at `:188`). Latent twin at `src/ui/MovementPicker.tsx:67` ("group" in multi mode; the only caller, `app/goals/new.tsx:993`, uses single).
- **Status:** SI-C. P0, integrator. No other lane owns ProgressParityView.
- **Native:** `app/(tabs)/activity.tsx:354-360` and `:118-127` set `partial` whenever any wsfListGoals or wsfMyContribution read fails. On Android:
  - `BaseViewManager.java:343-349` calls `AccessibilityRole.fromValue('status')`, which throws (`ReactAccessibilityDelegate.java:941-951`; the enum has no STATUS).
  - `ViewManagersPropertyCache.java:95-102` rethrows, and `FabricUIManager` disables mounting.
  - The Expo host then rethrows, so a release build crashes.
  - iOS falls back to no trait and does not crash.
- **Web:** `role=status` renders with Retry.
- **Acceptance:**
  - On an Android release build, make one goal read fail while Progress loads (airplane mode mid-load or a test fault flag). "This list is partial." renders with Retry, the app does not crash, and Retry reloads.
  - On Android with TalkBack, the partial note is announced when it appears.
  - On an iOS release build, the same partial state renders unchanged.
  - A vitest scan fails on any `accessibilityRole` literal outside the Android enum unless it is guarded by `Platform.OS === 'web'`. Today it flags `:269` and `MovementPicker.tsx:67`.
- **Fix sketch:** use `role="status"` (the separate, fault-tolerant Role enum) or a Platform-guarded value, plus `accessibilityLiveRegion="polite"` on native. Same treatment for MovementPicker "group".

#### INT-03 · P1 · https invite, marker, event, community and contribute links never open the installed app
- **Where:**
  - `app.json:5` declares only `scheme: "westayfit"`.
  - `app.json:13-16` (ios) has no `associatedDomains`; `:17-23` (android) has no `intentFilters` / `autoVerify`.
  - `app.config.js:10-22` passes the config through.
  - `public/` has no `.well-known/`.
  - `../../firebase.westayfit.json:28-51` has no Content-Type rule for the extensionless AASA file.
  - The expo-router plugin adds only `NSUserActivityTypes` and `extra.router`.
- **Status:** SI-C. P1, integrator.
  - The sub-claim that hosting ignore `"**/.*"` drops `.well-known` is REFUTED (TV): firebase-tools 13.35.1 and 15.34.0 `listFiles` (glob 10.5.0 and 7.2.3, `dot:true`) kept both `.well-known` files, and `expo export` copies `public/` recursively (`@expo/cli/build/src/utils/dir.js:98-109`).
  - XMOD-3's contrary statement is superseded.
- **Native:** every link the product hands out is https (`src/ui/joinLink.ts:42`, `src/ui/eventLinks.ts:73, 89, 124, 140-160`, `src/ui/kioskLink.ts:21`, `src/markerEntry.ts:36-38`). These open Safari or Chrome on the web twin, which has a separate session, so the member signs in and joins on the web. Nothing generates `westayfit://` links. expo-router would route an https URL correctly if the OS delivered one (`expo-router/build/fork/extractPathFromURL.js:22-34`).
- **Web:** hosting rewrites route `/join/**` and the rest directly.
- **Acceptance:**
  - On an iOS release build with the app installed, tapping `https://<env host>/join/<validCode>` in Messages opens the app on that join screen (`wsf-join-signed-out` / `wsf-join-signed-in`). This must work from cold start and from background, keeping `?event=` and `?activity=`.
  - On an iOS release build, scanning a community join QR with the Camera app and tapping the banner opens the app on that join screen.
  - On an Android release build, `adb shell pm get-app-links com.westayfit.app` reports the env host as verified, and the Gmail link opens the app with no chooser.
  - On both platforms, `/go/<slug>`, `/community/<id>`, `/contribute/<goalId>` and `/event/<goalId>?activity=<label>` open the matching route. `/go` can only be tested end to end after HB-01.
  - `/display/<goalId>`, `/kiosk/<goalId>`, `/station/<goalId>` and `/queue/<goalId>` still open in the browser.
  - `curl -sI https://<env host>/.well-known/apple-app-site-association` returns 200, no redirect, `content-type: application/json`, listing `<TEAMID>.com.westayfit.app`. `assetlinks.json` names `com.westayfit.app` with the release (Play App Signing) SHA-256.
  - A staging build does not claim the production host, and the reverse holds too.
  - With the app not installed, every link still opens the web twin.
- **Fix sketch:**
  - In `app.config.js`, choose one stable host per `EXPO_PUBLIC_WSF_ENV`. The staging preview channel expires after 7 days (`package.json deploy:staging --expires 7d`); production is planned as `app.westay.fit`.
  - Inject `ios.associatedDomains ["applinks:<host>"]` (plus `webcredentials:` for INT-24) and `android.intentFilters` (VIEW, autoVerify, https, pathPrefix `/join`, `/go`, `/community`, `/contribute`, `/event`).
  - Add `public/.well-known/apple-app-site-association` and `assetlinks.json`, plus a hosting header rule. Keep the ignore list as it is.
  - Owner inputs needed: Apple Team ID, Play App Signing SHA-256, a stable host.
  - This is a native config change, so it needs a new binary; OTA updates cannot deliver it.
  - Never use Firebase Dynamic Links or `westayfit://` for shared URLs.

#### INT-04 · P1 · Home's error has no Retry and nothing re-reads on reconnect; Community Home's entry error has no Retry
- **Where:**
  - `app/(tabs)/(home)/index.tsx:82-108` (mount read on `[ready, user]`) and `:603-611` (error text, no control).
  - `app/(tabs)/(home)/community/[groupId]/index.tsx:1028-1044` (deps never change on reconnect) and `:2013-2031` ("Something went wrong" + `ButtonLink href="/"`).
  - `app/contribute/[goalId].tsx:746-758, 1746-1777`.
  - `app/move/index.tsx:224-235, 471-484`.
  - A grep for NetInfo, AppState and RefreshControl finds nothing.
- **Status:** SI-C. P1 for Home cold start; the Community Home, MOVE and contribute parts are P2.
  - Corrections: Home does recover on a tab switch (`:141-165`). MOVE and contribute exits do re-read fresh. Community Home's "Back to home" pushes a fresh index, leaving the errored instance underneath.
- **Native:** a cold start in airplane mode shows "We couldn't reach the server. Check your connection and try again." (from `functions/internal`, status 0: `@firebase/functions index.esm2017.js:215-217, 550-558`; `src/callableErrors.ts:22, 80-95`). There is no control to retry, and foregrounding does nothing.
- **Web:** a browser reload re-runs every read.
- **Acceptance:**
  - On an iOS release build, cold start in airplane mode as a signed-in member of one community. Home shows an offline state that names the connection and offers Retry. It is never blank and never "You're not in a community yet".
  - Same device: turn airplane mode off and tap Retry. The member arrives in their community without switching tabs. Foregrounding after reconnecting also refreshes without a tap (with INT-12).
  - On an Android release build, block `firestore.googleapis.com` and `cloudfunctions.net` so Community Home's entry reads fail, unblock, and tap Retry. The page loads in place with a single Home stack entry.
  - On an Android release build, the contribution screen's load error and MOVE's resolver error each offer Retry, which re-reads in place.
  - Regression: Progress, Community and You keep their existing Retry; Home's return-to-tab re-read still works.
- **Fix sketch:**
  - Add reload tokens to the three effects and a Retry control in each error branch.
  - Change "Back to home" to the shell's POP_TO `(tabs)/(home)` dispatch.
  - Add a shared `src/useResumeRefresh.ts` that fires on AppState `background → active`, and optionally on a NetInfo reconnect (shared with INT-12).
  - Nothing is persisted (`src/memberReads.ts:43`). An offline last-known snapshot would be an owner decision.
  - Coordinate the `[groupId]/index.tsx` hunks (1028-1044, 2013-2031) with member-feature.

#### INT-05 · P1 · Menu Sign out on Progress or Community leaves iOS on a screen with no controls
- **Where:**
  - `app/(tabs)/_layout.tsx:144-153`: signOut with no navigation.
  - `:180-187`: top bar only when signed in.
  - `:222-224`: tabBar returns null.
  - `src/ui/ProgressParityView.tsx:167-173`: signed-out card with no action.
  - `app/(tabs)/community/index.tsx:413-416`.
- **Status:** SI-C. P1 on iOS, integrator.
  - Corrections: You (`src/ui/YouParityView.tsx:116-128`) and Home both offer Sign in. On Android, Back leads back to Home (P3 tidiness).
- **Native:** iOS tabs have no back gesture, so the member must force-quit.
- **Web:** the URL bar and browser Back give a way out.
- **Acceptance:**
  - On an iOS release build with a persisted session, cold launch, open Progress, then menu → Sign out. The app lands on signed-out Home (`wsf-home-signed-out`) showing Sign in and Create an account.
  - The same from the Community and You tabs.
  - On an Android release build, after menu Sign out from Progress, one Back press leaves the app or does nothing. It never shows `wsf-activity-signed-out`, `wsf-community-index-signed-out` or `wsf-you-signed-out`.
  - If signOut fails (airplane mode), the member stays signed in on the same tab with the top bar and tab bar intact.
- **Fix sketch:** after a successful signOut, `CommonActions.reset` to `(tabs)/(home)/index`. A plain `router.replace('/')` would leave the tab history. Route You's own sign-out (`app/(tabs)/you.tsx:516-521`) through the same helper. Optional member-feature follow-up: add Sign in actions to the Progress and Community signed-out states.

#### INT-06 · P1 · No keyboard avoidance on entry forms: Sign up's Password field and Create account sit under the iOS keyboard
- **Where:**
  - `src/AuthFormPrimitives.tsx:198-199` (navy field minHeight = 38% of the screen), `:211-215` and `:432-436` (ScrollViews with only `keyboardShouldPersistTaps`).
  - `app/signup.tsx:148-206`, `app/signin.tsx:176-224`.
  - `app/goals/new.tsx:1397-1409`.
  - Home join field `app/(tabs)/(home)/index.tsx:249-254, 761-791`.
  - No `KeyboardAvoidingView`, `automaticallyAdjustKeyboardInsets`, `keyboardDismissMode` or `Keyboard.` anywhere.
- **Status:** SI-C. P1, integrator.
  - Scope corrections: Sign in's password is only partly covered. The profile-setup and start-community name fields are visible at default size. Goal setup fields are likely visible at default size (UNVERIFIED). HOME-N5 is SI-1.
- **Native:** on Fabric iOS, `automaticallyAdjustKeyboardInsets` defaults to NO and the keyboard handler returns early (`RCTScrollViewComponentView.mm:136, 173-177`). The content fits the frame, so it cannot scroll. On a 390x844 iPhone, Password, its Show toggle, the 8-character hint and Create account sit under the keyboard. The member types a new password blind. The "go" return key still submits and blurs.
  - Android: SDK 54 edge-to-edge (`withEdgeToEdge.js:50-56`, `WindowUtil.kt:103-104`) is expected to stop `adjustResize` (NDC).
- **Web:** mobile browsers scroll the focused input into view.
- **Acceptance:**
  - On an iPhone 14 or 15 release build, focusing Sign up → Password keeps the field, its Show toggle and the "At least 8 characters" hint above the keyboard. Create account is reachable by scrolling without dismissing the keyboard.
  - The same for Sign in password plus its button, Reset password email, the Profile setup and Start community submit buttons, and a Goal setup field focused after scrolling.
  - On an iPhone SE (3rd gen) release build, signed out, Home's join input and Go button stay visible above the keyboard.
  - On an Android 15 release build at 1080x2400, the focused field on the same screens stays above the IME.
  - At the largest iOS accessibility text size, the focused field still scrolls into view above the keyboard.
- **Fix sketch:**
  - Add `automaticallyAdjustKeyboardInsets` (iOS) to the FormShell, QuietShell, Goal setup Page and Home ScrollViews.
  - Android: use `KeyboardAvoidingView behavior="padding"`, or adopt `react-native-keyboard-controller` (`KeyboardProvider` plus `KeyboardAwareScrollView`). That is a new native dependency, so it needs a dev/EAS build.
  - Optionally shrink the 38% navy field while the keyboard is up.
  - Set `returnKeyType="go"` on Home's join field.

#### INT-07 · P2 · MOVE count entry: the number pad hides "Review my contribution"; a scrim tap discards the typed count
- **Where:**
  - `app/contribute/[goalId].tsx:2819-2833` (number-pad TextInput with `enterKeyHint="done"`), `:2900-2909` (Review), `:1665-1676` and `:1689-1700` (ScrollViews).
  - `:1616-1622` (scrim → `closeSheet`, `:1334`), `:2942` (bottom-anchored), `:2950` (maxHeight 92%), `:510` (entry not persisted).
  - `app/_layout.tsx:116-127` (transparentModal).
- **Status:** SI-C, corrected to P2, integrator.
  - Refuted sub-claims: iOS DOES show a Done toolbar for number-pad plus `returnKeyType done` (`RCTTextInputComponentView.mm:635-695`). A tap on the panel body DOES dismiss the keyboard (`keyboardShouldPersistTaps="handled"`, `ScrollView.js:1363-1376, 1434-1451`). The −/+ steppers and the +5/+10/+25 chips (`:2797-2817`, `:2864-2876`) allow entry with no keyboard. Scrim-equals-Close is the same design on web (`:1608-1614`), so that part is a P3 owner decision.
- **Native:** on an iPhone 14, Review sits at about 646-773 pt; the number pad plus toolbar tops out around 550 pt, and the sheet can scroll only about 73 pt (an estimate from styles). Required by rule 6 whether or not the held Lovable 7ae447b5 is mirrored.
- **Web:** the visual viewport pans to Review.
- **Acceptance:**
  - On an iOS release build (iPhone 14 and iPhone SE 3): MOVE → "I'm done" → focus the count → type 35. Review is fully visible above the number pad and its Done toolbar, or one scroll brings it into view. Tapping it opens Review showing 35.
  - On an iOS release build, the number pad shows Done, and tapping it keeps 35. This passes today; it is a regression guard.
  - On an Android 15 release build with gesture navigation, the count input and Review sit above the IME or can be scrolled there. The IME Done key keeps the count.
  - On iOS at Accessibility text size AX3, the focused count input is visible above the keyboard (NDC: whether UIKit auto-scrolls the first responder).
- **Fix sketch:**
  - In the shared `screen()` wrapper: `automaticallyAdjustKeyboardInsets` and `keyboardDismissMode` (interactive on iOS, on-drag on Android). Pad the bottom-anchored panel by the keyboard height via Keyboard events or `KeyboardAvoidingView`, or use the INT-06 dependency.
  - Optionally `onSubmitEditing={onReview}`.
  - Keep `enterKeyHint="done"`.
  - Optional P3 (applies to web too): a scrim tap with the keyboard open dismisses the keyboard instead of closing the sheet.

#### INT-08 · P2 · No canonical public web origin on native: invite, QR, kiosk, station, display and combined links are null in release and point at Metro in dev
- **Where:**
  - `src/ui/kioskLink.ts:29-32` (`currentOrigin()` returns `window.location?.origin ?? null`).
  - `src/ui/joinLink.ts:38-42`, `src/ui/eventLinks.ts:66-90, 107-160`, `src/ui/combinedLink.ts:41-50`, `src/shareGoalDisplay.ts:46-56`.
  - `app/move/[goalId].tsx:171-176`, `app/station/[goalId].tsx:863`.
  - Consumers in `app/(tabs)/(home)/community/[groupId]/index.tsx`: `:653-655`, `:1454-1461`, `:1468-1471`, `:1497-1500`, `:2184`, `:2232-2236`.
- **Status:** SI-C, corrected to P2 (Champion tools are not a member-loop step; raise to P1 if the owner counts a Champion inviting from the phone as part of the join path), integrator. LINK-2 and MR-11 are SI-1.
- **Native:**
  - `@expo/metro-runtime/src/location/install.native.ts` installs `window.location` only in dev (Metro) or when `extra.router.origin` / `generatedOrigin` exists. `app.json` lists the plugin bare with `web.output: "static"`.
  - Release builds therefore produce null links. Members get no Invite card (`:2184`). Champions see "Reload the page" copy that can never come true (`:2442`, `:2546`, `:3188`, `:4566`, `:3651-3654`).
  - Dev builds encode `http://<lan-ip>:8081/...`.
- **Web:** `window.location.origin` is the served host.
- **Acceptance:**
  - On an iOS release staging build, a Champion of a public community sees an invite URL of `https://<staging host>/join/<code>`. On a production build, the production host. Never null, never a LAN or `:8081` address.
  - On an Android release build, a non-Champion member of a public or inviteOnly community sees the Invite card.
  - On a dev-client build connected to LAN Metro, the invite, QR, kiosk, station, combined and move-handoff URLs use the configured host, never Metro.
  - The configured host matches the INT-03 link domain for each environment.
  - On web, nothing changes.
- **Fix sketch:**
  - Set the origin per environment in `app.config.js` (`extra.wsfPublicOrigin`, or a validated `EXPO_PUBLIC_WSF_PUBLIC_ORIGIN`), and refuse native builds without it.
  - Make `currentOrigin()` `Platform.OS === 'web' ? window.location?.origin : configured`; on native it never reads `window.location`.
  - Route the move and station reads through it.
  - Do not use the expo-router `origin` option: it installs a release-only `window.location`, and dev still points at Metro.
  - **Gate:** do not merge before ST-05 (kiosk return) lands, or ship it together with MF-08's interim native hide of "Open kiosk". A non-null kiosk URL makes the kiosk reachable.
  - Member-feature follow-ups: MF-01, MF-05, MF-06.

#### INT-09 · P2 · Root-stack screens ignore the top safe area, and the one StatusBar is fixed to dark
- **Where:**
  - `app/_layout.tsx:25` (`<StatusBar style="dark" />`, the only one) and `:72-81` (headerShown false, no inset).
  - `src/AuthFormPrimitives.tsx:210-228, 285-297` (FormShell navy, paddingTop 28/16) and `:431-456` (QuietShell 22).
  - `app/(tabs)/(home)/index.tsx:249-276` (signed-out and Loading branches; `src/ui/kit.ts:108-113`).
  - `app/health.tsx:10`, `app/goals/new.tsx:1398-1407`.
  - `app/contribute/[goalId].tsx:1688-1703, 3024-3032` (page mode; navy receipt `:2999-3005`).
  - `app/move/[goalId].tsx:306`.
  - `app/settings.tsx:158-175, 249` (page chrome; the "‹" glyph at `:161-168` has no hit slop), `app/settings/privacy.tsx:44-63, 77-78`.
  - `app/join/[joinCode].tsx:745`, `src/ui/MarkerEntryScreen.tsx:154-163`.
- **Status:** SI-C (VIS-01), corrected to P2, integrator. SRN-04, HOME-N2, EAJ-10, MR-06 and CLPY-11 are SI-1.
- **Native:**
  - native-stack uses insets only for header height (`NativeStackView.native.tsx:191-197`).
  - Fabric ScrollView `contentInsetAdjustmentBehavior` defaults to Never (`BaseScrollViewProps.h:72-73`).
  - Android edge-to-edge is on by default.
  - Wordmarks and step chips sit under the clock and Dynamic Island, with dark icons on navy.
  - NDC: whether the iOS status-bar band swallows taps on page-mode contribute "Back" (y ≈ 16-60, top right).
- **Web:** browser chrome owns the status area.
- **Acceptance:**
  - On an iPhone 15 Pro release build, signed out, cold launch: the Home hero and every control sit below the Dynamic Island, the clock is legible, and "Loading…" is not under the status bar.
  - On iOS and Android release builds, the wordmark and step chip on `/signin`, `/signup`, `/reset-password`, `/verify-email`, `/profile-setup`, `/start-community`, `/join/<code>`, `/go/<slug>` and Goal setup sit fully below the status bar, with light status-bar content over navy.
  - On an iOS release build, `/health`, Settings and Privacy opened by link, "Already moved?" (page mode) and `/move/<goalId>` start below the status bar. Settings Back is a target of at least 44 pt and works on the first tap.
  - On an iOS release build, the navy page-mode confirmed receipt has light status icons. Returning to a cream screen switches them back to dark.
  - On an Android 15 release build, nothing draws under the status or navigation bars, and the four signed-in tabs are unchanged (no doubled gap).
- **Fix sketch:**
  - Add a shared `src/ui/useScreenTopInset.ts` (or a `<ScreenTop>` spacer) applied to the listed containers. Navy keeps bleeding behind the status bar.
  - Make StatusBar style follow focus: light on navy screens, dark on cream (`useIsFocused` + `<StatusBar>`, or the native-stack `statusBarStyle` option).
  - Add a Platform-guarded unit test that FormShell, QuietShell and the contribute page container add `insets.top` on native.
  - Do INT-10 in the same change.

#### INT-10 · P2 · Staging strip sits under the status bar, doubles the top gap, disappears under iOS modals and reads "build dev"
- **Where:** `src/StagingBanner.tsx:23-51` (no inset); `app/_layout.tsx:72-75`; `src/ui/MemberTopBar.tsx:86` and `app/settings.tsx:81` (add `insets.top` again); `src/buildStamp.ts:2` (`EXPO_PUBLIC_BUILD_COMMIT ?? 'dev'`, set only by `build:web`, `package.json:9`); `src/firebase.ts:136-141` (wsfIsStaging true on staging phone builds).
- **Status:** the inset and doubled-gap part is SI-C (inside the VIS-01 verdict). The modal-cover and build-stamp parts are SI-1 (SRN-05).
- **Native:**
  - The red strip's text sits under the clock, and a blank band of about 47-59 pt opens between the strip and the top bar.
  - iOS `transparentModal` means OverFullScreen, so MOVE, contribute and Settings cover the strip on exactly the screenshots it exists to mark (`StagingBanner.tsx:10-15`).
- **Web:** the strip is the first row and stays visible.
- **Acceptance:**
  - On an iOS staging release build (iPhone 15 Pro), the "STAGING · TEST DATA" line sits fully below the status bar, with the top bar directly under it and no blank band.
  - On an iOS staging release build, the staging marker stays visible while MOVE, the contribution sheet (including the confirmed receipt) and Settings are open.
  - On an Android staging release build (edge-to-edge), the strip sits below the status bar and the icons are legible.
  - On native staging builds, the strip and `/health` show the binary's actual commit and build time.
  - On a production build, there is no strip and the top bar position is unchanged.
- **Fix sketch:**
  - The banner takes `insets.top` (painting red behind the status bar). Wrap the Stack in a nested `SafeAreaProvider` so children see top = 0 below the strip.
  - Repeat a compact marker inside presented sheets.
  - Set `EXPO_PUBLIC_BUILD_COMMIT` and the build time in the EAS profiles.

#### INT-11 · P2 · A native build can ship with sign-in switched off
- **Where:** `app.config.js:10-22` (checks only `EXPO_PUBLIC_WSF_ENV` and the emulator flag); `src/featureFlags.ts:7`; `src/auth.tsx:17-21`; `app/(tabs)/(home)/index.tsx:263-272`; `src/stagingEnv.ts:371-385`; `AuthFlagOffPanel` returned at `app/signin.tsx:81`, `app/signup.tsx:64`, `app/join/[joinCode].tsx:289`, `src/ui/MarkerEntryScreen.tsx:150`, `app/verify-email.tsx:263`, `app/profile-setup.tsx:89` and others. There is no `apps/westayfit/eas.json`.
- **Status:** SI-C, corrected to P2. It needs a misconfigured build and fails visibly and safely. The flag being off by default is the deliberate launch switch (`docs/westayfit/DECISIONS.md:202-206`).
- **Native:** the whole member loop is unreachable on that binary. The web staging script refuses this case (`../../scripts/westayfit/build-staging.sh:143-145`). The check runs only under EAS; local `expo run:ios --configuration Release` skips it.
- **Acceptance:**
  - An EAS iOS or Android build with `EXPO_PUBLIC_WSF_AUTH_ENABLED` unset fails at config time with a named error. A staging build with it set to 0 fails the same way.
  - On a fresh install of an iOS staging release build with the flag at 1, Sign in shows the form (not `wsf-signin-disabled`), and Home shows no `wsf-home-flag-off`.
  - The committed `eas.json` staging and production profiles both name `EXPO_PUBLIC_WSF_ENV` and `EXPO_PUBLIC_WSF_AUTH_ENABLED`.
- **Fix sketch:** require the flag to be explicit (1 or 0) on native, and require 1 for staging. Production may say 0 explicitly. Commit `eas.json`. Add a vitest that loads `app.config.js` with `EAS_BUILD_PLATFORM=ios`.

#### INT-12 · P2 · Member surfaces never refresh on app resume; totals, membership and "Start moving" go stale
- **Where:**
  - `app/(tabs)/(home)/community/[groupId]/index.tsx:1418-1446` (re-read only on focus) and `:1108-1197`.
  - `app/(tabs)/(home)/index.tsx:125-165`.
  - `app/(tabs)/activity.tsx:278-303` (recompose from the record with no read; `hasWindowEnded` via `src/ui/dates.ts:101-105`).
  - `app/(tabs)/you.tsx:379-398`.
  - `app/(tabs)/community/index.tsx:350-378` (no figure re-read even on focus, on web too).
  - `src/memberReads.ts:155-158` (`peek()` has no age limit).
  - `src/ui/CommunityPresence.tsx:139-149`; `src/ui/dates.ts:268-271` (`formatClock` shows the time only).
  - `app/contribute/[goalId].tsx:800-885` (2 s pulse poll, no AppState gate).
  - A grep for AppState finds nothing.
- **Status:** SI-C (LIFE-1), corrected to P2 (no data-truth failure; a stale "Start moving" is corrected by the flow's fresh pulse, `app/contribute/[goalId].tsx:719, 845-848`). HOME-N8 and MR-09 are SI-1.
- **Native:** the JS context survives hours of suspension, and navigation focus never fires on resume. NDC: how long the process survives on device.
- **Web:** a reload gives fresh state.
- **Acceptance:**
  - On an iOS release build, open Community Home for X, background the app for at least 60 s, record +20 from another device, then foreground. The shared total shows N+20 within about 3 s, without a skeleton and with the scroll position kept.
  - On an Android release build, sitting on Progress, press Home, record elsewhere, and return. Progress makes a fresh network read.
  - On an iOS release build, remove the member from X while the app is in the background, then foreground. Community Home moves to its not-member state.
  - On an Android release build, suspend across a goal's `endsAt`. Progress and You stop offering "Start moving" for it, and its line reads "Ended …". The freshness line never shows yesterday's "Confirmed h:mm" as today.
  - On an Android release build, with the count entry left open in the background for 5 minutes, no wsfGoalPulse calls go out while backgrounded. One refresh runs on return.
  - On iOS, Control Center (AppState `inactive` only) triggers no burst of reads. A failed resume read keeps the figures on screen, marked last-confirmed.
- **Fix sketch:**
  - Add a shared `src/ui/useForegroundReturn.ts`: AppState `background → active` after at least 30-60 s, focused screens only. It bumps the existing return/settle tokens.
  - Progress and You revalidate fresh instead of recomposing.
  - The Community tab gets a quiet revalidate.
  - A coarse "now" tick recomposes relative labels.
  - Gate the pulse interval on AppState.
  - react-native-web maps AppState onto `visibilitychange`, so throttle with the same minimum time away.

#### INT-13 · P2 · Verify and reset email links finish in the browser; verify-email has no foreground re-check
- **Where:**
  - `../../functions-westayfit/src/index.ts:371` (`WSF_APP_URL`), `:390-393` and `:418-437` (handler and retarget), `:582-585` (`handleCodeInApp:false`), `:2471-2473`, `:2496`.
  - `app/verify-email.tsx:165-214` (the passive poll exists only for the `unconfigured` outcome; `document`-based `hidden()` and listener), `:296`.
  - `app/reset-password.tsx` has no oobCode handling.
  - `src/ui/MarkerEntryScreen.tsx:258-261` ("come back to this page").
- **Status:** SI-C (EAJ-03), corrected to P2. LIFE-5 and LINK-5 are SI-1. Refuted sub-claim: Android does NOT keep polling in the background; RN pauses timers (`JavaTimerManager.kt:71-88`, `RCTTiming.mm:180-195`).
  - Target note: the frozen auth reference (82255fe7 / 2fe3ba66) asks for a "verify auto-check on return". Canonical web lacks it in the `sent` outcome too, so this is a target delta on both platforms.
  - Backend dependency: the deployed `WSF_APP_URL` is UNVERIFIED (a 2026-09-06 note says it was never set; commit 2c6156ad suggests a later staging attempt).
- **Native:** Continue opens the web app, signed out. The member must switch back and tap "I have verified", which works.
- **Acceptance:**
  - On an iOS release build with the app installed, sign up, tap the link in Mail, then Continue. The native app opens and advances to profile-setup (or the pending destination) with no web sign-in.
  - The same on an Android release build. With the app not installed, Continue still opens the web app.
  - On iOS and Android release builds in the `sent` outcome, verify in any browser and switch back. Within about 2 s of the app becoming active it advances with no tap. If the address is still unverified, nothing new shows and "I have verified" still works.
  - On an iOS release build, after setting a new password from the reset email, Continue opens native Sign in.
  - Regression: in the `unconfigured` outcome on Android, no check runs in the background and one runs on the first frame after return.
- **Fix sketch:**
  - AppState `active` → `passThroughIfVerified(user)` (uid-guarded).
  - Add an app-link landing route (e.g. `app/auth/continue.tsx`) on the INT-03 domain, and point the continue URL there via the functions env (coordinate with the backend owner).
  - Never use Firebase Dynamic Links.

#### INT-14 · P2 · On notched phones the top-bar menu sheet covers its own button, and nothing outside it closes it
- **Where:** `src/ui/MemberTopBar.tsx:83-87` (wrapper `paddingTop: insets.top`), `:117-166`, `:207-223` (sheet `top: MEMBER_TOP_BAR_BODY` (62), shadow* only); `src/ui/memberShellMetrics.ts:34`; Yoga `AbsoluteLayout.cpp:185-199` (absolute insets ignore parent padding). No BackHandler anywhere.
- **Status:** SI-1, three independent reports (SRN-03, VIS-06, HOME-N3).
- **Native:** with `insets.top` = 59, the sheet starts about 3 pt below the bar's top edge and covers the hamburger. A second tap fires the first row (Settings, or a Champion's Manage). There is no scrim. Android Back navigates while the menu stays open.
- **Web:** insets are 0, so the sheet starts on the hairline.
- **Acceptance:**
  - On an iPhone 15 Pro release build, the open sheet's top edge sits at `insets.top + 62`. Tapping the hamburger again closes it without navigating.
  - On a Pixel (Android 15) release build, the same holds. Tapping outside closes the menu without activating what was tapped, and Back closes it before any navigation.
  - Switching tabs leaves the menu closed.
  - On web, nothing changes.
- **Fix sketch:** `top: insets.top + MEMBER_TOP_BAR_BODY`, a full-screen transparent dismiss layer, a BackHandler while open, and Android elevation (INT-31).

#### INT-15 · P2 · Large-text reflow in the shell is keyed to window width, which OS text scaling never changes
- **Where:** `src/ui/MemberTabBar.tsx:164-173` (`narrow = width < 260`), `:233`, `:240-252`, `:334-353`; `src/ui/MemberTopBar.tsx:189-196`; `src/ui/WsfWordmark.tsx:27-29`. No `maxFontSizeMultiplier`, `allowFontScaling` or `fontScale` anywhere.
- **Status:** SI-1, three reports (SRN-06, VIS-07, HOME-N6 tab part).
- **Native:** at iOS AX1 or above, or Android "Largest" on a 360 dp phone, "Community" breaks mid-word, and "MOVE" overflows its 52 pt inner circle.
- **Web:** 200% zoom shrinks the CSS width, so the 2x2 layout engages.
- **Acceptance:**
  - On an iOS release build at AX1, AX3 and AX5, no tab label breaks mid-word or clips. All four destinations plus MOVE stay tappable, and the top bar keeps the wordmark and a 44 pt menu button.
  - The same on an Android 360 dp release build at "Largest" and 200%.
  - MOVE stays on one line inside its control, or the control grows.
  - At default text size, the bar geometry is unchanged (body 75 pt with rule, MOVE raised 24 pt).
- **Fix sketch:** key the narrow layout on `width / fontScale`, and cap decorative labels with `maxFontSizeMultiplier`. Publish one shared font-scale policy in `src/ui/kit.ts` for INT-16, MF-11 and MF-19 to adopt.

#### INT-16 · P2 · MOVE and receipt numerals have no font-scale cap and clip or wrap mid-number
- **Where:** `src/ui/TogetherCompletion.tsx:230-238` (82 pt amount, letterSpacing −6; motion-reserved file); `app/contribute/[goalId].tsx:2818-2855`, `:3252`, `:3318`, `:3378-3397`, `:3418`.
- **Status:** SI-1 (MR-08). Exact wrapping is NDC.
- **Native:** at AX sizes, "+5,015" at 82 pt cannot fit, and the typed count clips inside its input.
- **Web:** px fonts rarely scale; zoom reflows instead.
- **Acceptance:**
  - On an iOS release build at AX3, entering 100000 keeps all six digits visible (shrunk or wrapped onto their own row, never clipped), and Review stays reachable.
  - On iOS at AX3, the +5,015 receipt never breaks inside the number, and "Back to community" is reachable.
  - The same on Android at the largest font and display size. At default size, rendering is unchanged.
- **Fix sketch:** numeral styles from the INT-15 policy (`maxFontSizeMultiplier` plus `adjustsFontSizeToFit` / `minimumFontScale` on single-line numerals). The motion lane applies it in `TogetherCompletion.tsx`.

#### INT-17 · P2 · Screen-reader focus placement and return, and modal containment, are web-only
- **Where:**
  - `src/ui/focusReturn.ts:40, 52, 163, 234, 246, 268-307, 347-361` (every entry point returns early off web).
  - `src/ui/sheetMotion.ts:199-200, 245-281, 291-298` (`setInert` is DOM-only).
  - `src/ui/MemberTopBar.tsx:77-80` (`.focus()` on a Pressable does nothing).
  - `app/move/index.tsx:339-371`; `app/contribute/[goalId].tsx:1373-1385, 1615-1633`.
  - No `AccessibilityInfo.setAccessibilityFocus` anywhere.
- **Status:** SI-1 (SRN-11, MR-03, MR-02 focus part). NDC: whether VoiceOver can reach the tab behind an OverFullScreen modal, and whether `aria-modal` maps on View. Android does hide screens under translucent screens from TalkBack (`ScreenStack.kt turnOffA11yUnderTransparentScreen`).
- **Acceptance:**
  - On an iOS release build with VoiceOver, pressing MOVE puts focus on the sheet's Close or its heading. Swiping visits only sheet elements. Closing returns focus to the MOVE button.
  - On an Android release build with TalkBack, closing MOVE with Back returns focus to MOVE. No element of the covered tab takes focus while either sheet is open.
  - With a screen reader on native, Settings opened from the menu returns focus to the menu button on close, and Settings opened from You's row returns to that row.
  - After count → review → receipt, focus is on the new step's heading.
- **Fix sketch:**
  - Native twins: `focusReturn.native.ts` using `findNodeHandle` + `AccessibilityInfo.setAccessibilityFocus` on refs.
  - `accessibilityViewIsModal` on sheet roots (iOS) and `importantForAccessibility="no-hide-descendants"` on the covered tab (Android).
  - Phase-change focus to the step's h1.

#### INT-18 · P2 · Outcome and status announcements rely on aria-live, which iOS ignores
- **Where:** `app/contribute/[goalId].tsx:1974, 2055, 2213, 2271, 2311, 2877-2886`; `app/(tabs)/(home)/community/[groupId]/index.tsx:1957-1963, 2850-2866, 5310-5316` (visually hidden copy at opacity 0); `node_modules/react-native/Libraries/Components/View/View.js:44-68, 189` (aria-live becomes `accessibilityLiveRegion`, Android only).
- **Status:** SI-1 (MR-02 announce part, HOME-N12). Whether TalkBack announces a newly mounted live region is NDC. Consumer fixes in the Community chip and privacy panel are in MF-20.
- **Native:** a VoiceOver member does not learn whether a contribution was confirmed, pending (unknown) or refused.
- **Acceptance:**
  - On an iOS release build with VoiceOver, Record announces "Recording your contribution…" and then the receipt headline (e.g. "You added 35 squats.").
  - With the network off, it announces "We couldn't confirm your contribution yet.". A closed goal announces "This goal is no longer accepting contributions.".
  - Review with an empty entry announces "Enter how many you completed.".
  - On iOS, a failed community refresh announces "Couldn't refresh. This is the last confirmed figure.".
  - On an Android release build with TalkBack, each of these is announced exactly once.
- **Fix sketch:** add a shared `src/ui/announce.ts` that calls `AccessibilityInfo.announceForAccessibility` on iOS and keeps a live region on Android without double-announcing. Call it on phase changes.

#### INT-19 · P2 · Android Back discards the MOVE flow from Review or Adjust, and leaves silently while sending
- **Where:** `app/contribute/[goalId].tsx:497` (step is state), `:1028-1030` (onEdit), `:2267-2283` (sending, `renderChrome(false)`), `:2531-2583`, `:2642-2706`. A grep for BackHandler, usePreventRemove and beforeRemove finds nothing.
- **Status:** SI-1 (MR-04). The Back-during-sending part is the SI-C residual of CONN-RECORD-3 (P3 once ST-02 lands).
- **Native:** on Review, Back pops the route and the reviewed count is lost. Edit would have kept it.
- **Web:** browser Back also leaves, but there is no reflexive hardware Back.
- **Acceptance:**
  - On an Android release build: MOVE → "I'm done" → 35 → Review → hardware Back returns to the count entry with 35, and the sheet stays open.
  - On the count entry in move mode, Back returns to "Ready when you are", or closes the sheet per the agreed design, and never goes to an unrelated screen.
  - While "Recording your contribution…" shows, Back either waits for an outcome or the attempt is already persisted and comes back as unknown (with ST-02). A second Record is never offered while the outcome is unknown.
  - On the receipt, Back behaves like Close and returns to the opener tab.
- **Fix sketch:** `usePreventRemove` / BackHandler maps Back to the in-flow previous step. The guard during `sending` uses the state lane's `pendingDurable` / `sending` predicate (ST-02). The integrator owns the hook.

#### INT-20 · P2 · Root-level `router.replace` tears down the tab navigator or leaves duplicate stacks
- **Where:**
  - `app/(tabs)/activity.tsx:422` (`replace('/move')`; the You tab and tab bar use push, `you.tsx:537`, `_layout.tsx:223`).
  - `app/(tabs)/community/index.tsx:560, 586` (`replace('/start-community')`).
  - Auth: `app/signin.tsx:74, 131`, `app/verify-email.tsx:102`, `app/profile-setup.tsx:157`, `app/start-community.tsx:474`.
  - `expo-router/build/global-state/routing.js:119-121, 211-280`; `app/move/index.tsx:286-293`.
- **Status:** SI-1 (CLPY-09 P2, EAJ-18 P3).
- **Native:** Progress "Start moving" unmounts every tab; closing MOVE then lands on a fresh Home. From Start a community, Back exits the app. After auth, `[(tabs), (tabs)]` remain, so Back from Home shows Home again.
- **Acceptance:**
  - On iOS and Android release builds, Progress → Start moving opens the MOVE sheet over the dimmed Progress tab. Closing it returns to Progress with scroll position and rows intact.
  - On an Android release build, Community (no community) → Start a community → Back returns to Community.
  - On an Android release build, Home → Sign in → sign in → Home: one Back press backgrounds the app. The same after Sign up → "Already have an account? Sign in".
- **Fix sketch:** `push` for sheet entries. After auth, reset the root to a single `(tabs)` route. The Community tab hunks (`:560`, `:586`) are applied by member-feature.

#### INT-21 · P2 · iOS drops the brand "hero" shadow wherever `overflow:'hidden'` sits on the same view
- **Where:**
  - `src/ui/kit.ts:79-103` (elevation tokens).
  - `app/(tabs)/(home)/community/[groupId]/index.tsx:5136-5161` (the Living WE hero, overflow at `:5159`).
  - `src/AuthFormPrimitives.tsx:285-296`, `app/move/index.tsx:577-585`.
  - `app/contribute/[goalId].tsx:2947-2958, 3043-3053`, `app/settings.tsx:193-204`.
  - `RCTViewComponentView.mm:322-323, 785-794`.
- **Status:** SI-1 (VIS-03 P2; HOME-N10, CD-10, MR-10 P3).
- **Native:** `clipsToBounds` clips the view's own layer shadow; only `boxShadow` or an outline uses the unclipped container. Android draws elevation.
- **Acceptance:**
  - On an iOS release build, the Community Home goal hero shows its navy drop shadow while the rings stay clipped to the 24/24/10/10 corners.
  - On iOS, the `/signin` navy field, the MOVE resolver field, the contribute sheet panel and anchor, and the Settings panel show their shadows.
  - Android and web are unchanged.
- **Fix sketch:** express the tokens as the `boxShadow` prop (RN 0.81 new architecture; RNW 0.21), or wrap with an outer shadow view.

#### INT-22 · P2 · Home community cards and the challenge card are non-asChild Links, which render as Text on native
- **Where:** `app/(tabs)/(home)/index.tsx:686-705, 839-854`; `app/(tabs)/(home)/community/[groupId]/index.tsx:4475-4494`; `expo-router/build/link/BaseExpoRouterLink.js:79-83`.
- **Status:** SI-1 (HOME-N4 P2, CD-11 P3). The exact rendered result and the VoiceOver label are NDC.
- **Native:** the card body becomes an inline attachment (shrink-wrapped, no flex, no press feedback). The VoiceOver label is likely blank, and the "Sample" badge loses its pill. Because of ST-03, these cards are the main way into a community for multi-community members today.
- **Acceptance:**
  - On an iOS release build with two communities, each card's title, meta, status and action stack at the 8 pt gap inside a full-width card. VoiceOver announces the name, status and action as one link, and a double-tap opens `/community/<id>`.
  - On an Android release build with TalkBack, the same, with visible press feedback.
  - With an active challenge, the "Community challenge" card matches the other white cards, and one tap pushes the challenge once.
- **Fix sketch:** `Link asChild` around a flattened Pressable (`src/ui/ButtonLink.tsx:43-57`). Member-feature applies the `[groupId]` challenge hunk.

#### INT-23 · P2 · No native app icon, adaptive icon foreground or splash
- **Where:** `app.json:13-23` (no `icon`, `splash` or expo-splash-screen; adaptiveIcon has backgroundColor only); prebuild `withIosIcons.js:100-103`, `withAndroidIcons.js:92-95`, `getIosSplashConfig.js`. Art exists in `assets/brand/originals/monogram-*-green.original.png` and `public/icons/icon-512.png`.
- **Status:** SI-1 (VIS-05 P2, SRN-16 P3).
- **Native:** iOS gets a white-square icon, Android keeps the template icon, and the splash is white.
- **Acceptance:**
  - On a TestFlight iOS release build, the home-screen and App Store Connect icon is the WE monogram on navy.
  - On an Android release build, the adaptive icon (WE on #0B1F3A) survives circle, squircle and teardrop masks.
  - A cold launch on either platform shows a branded splash with no white flash.
  - The home-screen label matches the agreed casing (owner decision: `app.json` "We Stay Fit" vs the manifest's "WE STAY FIT").

#### INT-24 · P2 · Password AutoFill and strong passwords are not associated with the web domain
- **Where:** `app.json:13-23` (no `webcredentials:`); `app/signin.tsx:184`, `app/signup.tsx:168` (`textContentType="emailAddress"`; `username` is preferred).
- **Status:** SI-1 (EAJ-15). Its hosting-ignore premise is superseded by the INT-03 test.
- **Acceptance:**
  - On an iOS release build, a member with the password saved in iCloud Keychain from Safari sees it in the QuickType bar on Sign in, and one tap fills both fields.
  - iOS Sign up offers an Automatic Strong Password, saved for the web domain.
  - On an Android release build, Google Password Manager offers the saved web credential.
- **Fix sketch:** ride on INT-03: add `webcredentials:<host>` and the `get_login_creds` relation in `assetlinks.json`.

#### INT-25 · P2 · A failed fresh read on the contribution screen replaces the usable warm state mid-movement
- **Where:** `app/contribute/[goalId].tsx:212-229`, `:490-491` (initial state is "ready" from the record), `:682-758` (catch at `:749-752` sets "error" whatever is already on screen), `:1746-1777`. The callable timeout is 70 s (`@firebase/functions index.esm2017.js:612-614`), and Android OkHttp has no socket timeouts (`OkHttpClientProvider.kt:52-54`).
- **Status:** SI-1 (CONN-RECORD-5). This breaks the documented rule at `src/ui/RefreshNote.tsx:9-13`. Raise to P1 if the owner requires offline recording into pending.
- **Acceptance:**
  - On an iOS release build with Home loaded, airplane mode, then MOVE. The movement step stays usable on the last confirmed figures with an offline note.
  - On an Android release build with 100% packet loss after the goal opens, the timer, typed entry and current step survive the delayed failure, and Review stays reachable.
  - Recording while offline ends on the unknown screen, never a confirmed receipt. After reconnecting, Confirm resolves exactly once.
  - A cold link with no record still shows Loading and then an error with Retry (INT-04).
- **Fix sketch:** in the catch, keep the ready state and set a `refreshFailed` note when warm.

#### INT-26 · P2 · Retry cannot start a fresh read while an identical read is hung
- **Where:** `src/memberReads.ts:182-187` (in-flight join happens before the `reuseMs` check), `:54-57` (the doc promises a Retry reads fresh), `:192-221`. Callers: `app/(tabs)/activity.tsx:309, 329, 382`; `app/(tabs)/community/index.tsx:245, 421-424`.
- **Status:** SI-1 (CONN-READS-6).
- **Acceptance:**
  - On an Android release build, with Progress opened under 100% loss so wsfMyCommunities hangs, restore the network and tap Retry. A new request goes out immediately.
  - The same for the Community tab's "Try again".
  - On iOS, cold Home plus its redirect still makes one wsfMyCommunities and one wsfListGoals per community.
  - A stale late answer never overwrites the fresh one (the generation rule at `:79-106`).
- **Fix sketch:** when `reuseMs === 0`, advance the key's generation and issue a new fetch.

#### INT-27 · P2 · Cold start on a stalled network holds the app on "Loading…" for up to 60 s with no shell
- **Where:**
  - `src/auth.tsx:17-26` (ready only after the first `onAuthStateChanged`).
  - `@firebase/auth dist/rn/index-b5f6ef87.js`:
    - `:2565-2593`, `:2669-2684`, `:2730-2743`: a persisted user is always reloaded.
    - `:554-564`, `:783`, `:919-933`: the RN long delay is 60 s.
    - `:494-509`: no `navigator.onLine` on RN, so it assumes online.
  - `app/(tabs)/(home)/index.tsx:273-278`; `app/(tabs)/_layout.tsx:79-80, 180-187, 222-224`.
- **Status:** SI-1 (CONN-BOOT-7). Real airplane-mode latency is NDC.
- **Acceptance:**
  - On an iOS release build with a persisted session under Network Link Conditioner at 100% loss, the shell or a "Connecting…" note shows within about 5 s.
  - On an Android release build in airplane mode, cold start reaches the signed-in shell (offline state per INT-04) within 2 s.
  - A network failure during auth init never signs the member out. A revoked or disabled account is still signed out once the server is reachable.
- **Fix sketch:** race initialization against a short timer in `WsfAuthProvider` and render a connecting state. It must never treat the user as signed out.

#### INT-28 · P3 · Cold deep links have no Home beneath; unknown links show "Unmatched Route" with a Sitemap link
- **Where:** `app/_layout.tsx:76` (no `unstable_settings` / `initialRouteName` in any layout); no `app/+not-found.tsx`; `expo-router/build/views/Unmatched.js:55, 112-130`; `app/join/[joinCode].tsx:315, 329, 350, 586`. This also covers CLPY-11's "Back exits from a cold Settings page".
- **Status:** SI-1 (SRN-14).
- **Acceptance:**
  - On an Android release build, cold `westayfit://join/<code>` → Back before joining lands on Home, not outside the app.
  - On native, `westayfit://this/does/not/exist` shows a branded not-found screen with "Go Home" and no Sitemap link.
  - On native, cold `westayfit://settings` → Back lands on You or Home.
- **Note:** making `(tabs)` the initial route changes `isMoveSheetRoute` / `isOverMemberTabs` (`src/ui/moveSheetRoute.ts:31-50`). That is a product decision.

#### INT-29 · P3 · A push from inside a native sheet becomes an iOS page-sheet card
- **Where:** `app/contribute/[goalId].tsx:2240-2246, 1730-1741` (`ButtonLink href="/signin"` inside the sheet); `@react-navigation/native-stack src/utils/getModalRoutesKeys.ts`; `NativeStackView.native.tsx:100`; `app/_layout.tsx:125, 148`.
- **Status:** SI-1 (SRN-13).
- **Acceptance:**
  - On an iOS release build, "Sign in" from a signed-out refusal in the MOVE sheet shows the full sign-in page: no card, no sheet behind it.
  - After sign-in, no orphaned sheet remains mounted.
  - On Android, it is a normal page.
- **Fix sketch:** give sign-in an explicit `presentation: 'card'`, or dismiss the sheet before pushing.

#### INT-30 · P3 · Tab content reserves the bar height plus the inset although the bar sits below the scene
- **Where:** `app/(tabs)/community/index.tsx:214`; `src/ui/ProgressParityView.tsx:108` (bottomInset from `app/(tabs)/activity.tsx:418`); `src/ui/MemberTabBar.tsx:176, 281-297`; `@react-navigation/bottom-tabs BottomTabView.tsx`.
- **Status:** SI-1 (SRN-15).
- **Acceptance:**
  - On an iPhone 15 release build, the end of Community and Progress sits about 24 pt plus page rhythm above the bar, not about 122 pt.
  - The last control stays tappable.
  - Web is unchanged.

#### INT-31 · P3 · No Android lift where only iOS shadow props are set
- **Where:** `src/ui/MemberTabBar.tsx:313-318`, `src/ui/MemberTopBar.tsx:217-222`, `app/settings.tsx:200-203`, `src/ui/CommunityPrivacyPanelView.tsx:317-327`, `src/movement-camera/MoveCameraSettingsSection.tsx:109` (camera file: the camera lane applies the token).
- **Status:** SI-1 (VIS-08, SRN-12 shadow part).
- **Acceptance:**
  - On an Android release build, the tab bar shows a soft lift above its rule, and the open menu, the Settings panel and the toggle knobs visibly float.
  - iOS and web are unchanged.
- **Fix sketch:** kit tokens carry `elevation` or `boxShadow` (shared with INT-21).

#### INT-32 · P3 · Tab bar semantics on native
- **Where:** `src/ui/MemberTabBar.tsx:178` (navigation role on web only), `:213` (role "link"), `:216-217` (selected state plus a ", current" label).
- **Status:** SI-1 (SRN-12).
- **Acceptance:**
  - On an iOS release build with VoiceOver, focusing Home announces "Home, selected, tab, 1 of 4" once, with no "current" doubling.
  - On an Android release build with TalkBack, the four destinations are announced as tabs, with the selected one stated once.

#### INT-33 · P3 · No press feedback on any Pressable
- **Where:** `src/ui/OptionRow.tsx:42-57`, `src/ui/DeviceChoice.tsx:88-107, 161-167`, `src/ui/MemberTabBar.tsx:208-211, 242-248`, `src/ui/MemberTopBar.tsx:99-160`. A grep for android_ripple or `({ pressed })` matches only design-target fixtures.
- **Status:** SI-1 (XMOD-6, SRN-12 pressed part).
- **Acceptance:**
  - On an Android release build, pressing and holding an OptionRow in start-community shows a ripple or tint before release.
  - On an iOS release build, a DeviceChoice answer, a tab, MOVE and the hamburger show a pressed highlight that does not persist after release.
- **Fix sketch:** add one shared Pressable wrapper in kit.

#### INT-34 · P3 · `userInterfaceStyle: light` is not enforced on Android
- **Where:** `app.json:8`; no `expo-system-ui` (`prebuild-config .../withAndroidUserInterfaceStyle.js:12-19` only warns).
- **Status:** SI-1 (VIS-09).
- **Acceptance:**
  - On an Android release build in system Dark theme, cold launch and transitions show a cream ground, and the keyboard and Alerts are light.
  - The prebuild log has no "Install expo-system-ui" warning.

#### INT-35 · P3 · Build details stamps use "monospace", which Fabric iOS does not recognise
- **Where:** `app/health.tsx:51`; `RCTFontUtils.mm:288-298, 326-336`. No custom typeface ships, so there is no other font fallback.
- **Status:** SI-1 (VIS-11).
- **Acceptance:**
  - On an iOS release build, Commit and Built at render monospaced (ui-monospace).
  - A visual pass of the four spaces shows no glyph boxes, and weights 800/900 render heavy.

#### INT-36 · P3 · Counts follow the device locale while percentages and Progress cells use fixed en-US
- **Where:** `src/ui/progressFormat.ts:120-123` (`Intl.NumberFormat(undefined)`), `:68-75`; `src/goalTruth.ts:71-78`; call sites `app/contribute/[goalId].tsx:1854-1867, 2103-2123`.
- **Status:** SI-1 (MR-14). Whether Hermes uses the region format is NDC.
- **Acceptance:**
  - On an iOS release build with English language and region Germany, the MOVE anchor shows "4,999 of 5,000 squats" and "99.9% complete", matching Progress.
  - On Android de-DE, a 4,980+35 receipt uses the same separators as Progress.
  - Web is unchanged.

### 4.2 State (in flight)

| ID | Sev | Title | file:line | Status | Merged from |
|---|---|---|---|---|---|
| ST-01 | P0 | known: community detail throws during render in release (window.location.origin) | app/(tabs)/(home)/community/[groupId]/index.tsx:1457 | SI-C | CD-00 |
| ST-02 | P0 | known: pending attempt not persisted; unconditional "same attempt will be here" promise; a re-record can double count | app/contribute/[goalId].tsx:2340 | SI-C | MR-13, CONN-RECORD-3 |
| ST-03 | P1 | known: current-community memory is a no-op (Community, You, privacy order, and also MOVE and Home auto-open) | src/currentCommunity.ts:19 | SI-C | CLPY-05 |
| ST-04 | P1 | Post-auth return family (event, marker, station pending event/activity, device mode) is a no-op; join ignores its own `?event=` | src/markerEntry.ts:148 | SI-C | EAJ-04, LINK-4, XMOD-1, XMOD-2 |
| ST-05 | P1 | Kiosk return lost: the visitor lands signed in on member Home on a shared device | src/kioskSession.ts:100 | SI-C | EAJ-01 |
| ST-06 | P1 | A replay refused as "unauthenticated" is shown as "not recorded" and clears the attempt | src/contributionFlow.ts:154 | SI-C | CONN-RECORD-4 |
| ST-07 | P2 | The DeviceKv contract is durable-only; native `keysWithPrefix` sees Auth keys | src/storage/kv.ts:14 | SI-1 | XMOD-4 |
| ST-08 | P2 | b84a4689 pending/unknown badges absent from product source | app/contribute/[goalId].tsx:2286 | SI-R | reconciler (J7, J9) |

#### ST-01 · P0 · known: community detail throws during render in native release builds
- **Where:** `app/(tabs)/(home)/community/[groupId]/index.tsx:1454-1461` (`origin: typeof window === 'undefined' ? null : window.location.origin`, evaluated whenever `state.kind === 'ready'`, inside `CommunityPage`, which starts at `:346`).
  - `:2232-2236` is latent only: `shareRoute(navigator)` is "unavailable" on RN (`src/shareGoalDisplay.ts:88-97`; RN `setUpNavigator.js` sets `navigator = {product:'ReactNative'}`), so the read short-circuits. It becomes a live throw site the moment native gets a share route (MF-01).
  - The same file already imports a safe `currentOrigin()` (`:66`) and uses it at `:654`, `:1469`, `:1475`, `:1498`, `:1504`.
- **Status:** SI-C. P0, state (known, assigned).
- **Native:** state "ready" needs only Firestore getDoc reads (`:926`, `:953`); the blocked callables are non-blocking. So every member's first successful Community Home load crashes the app. Home sends members there (`app/(tabs)/(home)/_layout.tsx:9-12`; `app/(tabs)/(home)/index.tsx:494-505`). With INT-01 missing, this becomes a launch crash loop.
- **Acceptance:**
  - On iOS and Android release builds, a signed-in active member opens the app. Home routes to their community, and the detail renders name, hero and actions with no crash and no TypeError in device logs.
  - On a release build, a Champion opens Manage community and the Invite link and QR sections render, with an https origin after INT-08.
  - After MF-01 adds a native share route, a release build with an authorized, non-sample featured goal still renders, and its share URL uses the same origin source.
  - On web, the invite link still uses `window.location.origin`.
- **Delta to the lane:**
  - Use `currentOrigin()` at both sites, not an inline `window.location?.origin`, so INT-08 can make that one helper platform-aware without touching this file again.
  - Add a grep or ESLint rule banning `window.location` outside the helper.
  - Guarding to null alone leaves the false "not ready yet" copy; that remainder is INT-08 plus MF-06.

#### ST-02 · P0 · known: the pending attempt is not persisted on native; the unknown screen promises it is; a re-record can double count
- **Where:**
  - `src/pendingContribution.ts:61, 79, 110, 127-133, 159, 176, 188` (localStorage guard, so every write is a no-op on native).
  - In `app/contribute/[goalId].tsx`:
    - `:1082`: `savePendingNew` result ignored.
    - `:1115-1124`: escalation writes nothing.
    - `:2340-2344`: "You can leave this page. The same attempt will be here when you come back.", gated only on kiosk.
    - `:662-669`: synchronous restore, which is null.
    - `:671-676` and `:940-951`: a late receipt is dropped after unmount.
    - `:1069`: a fresh attemptId is minted; MOVE links carry no `attempt` (`app/move/index.tsx:144, 219, 407`; `[groupId]/index.tsx:2251`).
  - Server: key `goal_uid_attemptId` (`../../functions-westayfit/src/index.ts:3923-3925`). Goals with no repeatPolicy are treated as "multiple" and count each new attemptId (`:2784-2789`); "once" refuses it (`:4098-4099`). `src/storage/kv.native.ts` exists, but on the snapshot only tests import it.
- **Status:** SI-C. P0, state (known: NATIVE-STATE-1).
- **Native:** after "We couldn't confirm your contribution yet", Close, Back or an OS kill loses the attempt. The next Record mints a new id, which double counts on "multiple" goals if the first send landed. On "once" goals the server refuses with a confusing message.
- **Candidate status (reported by verifier, not re-verified):** `810ef50e`, contained in `80cd713f`, awaits `openAttempt` (`savePendingNew`) before sending. It gates the copy on `pendingDurable`, with fallback copy "This device couldn't save this attempt…" (`wsf-contribute-not-saved`), and gates Record on `restoreSettled` / `mayBeginNewAttempt`.
- **Acceptance:**
  - On an iOS release build on a "multiple" goal: airplane mode on Review, tap Record. The screen ends on "We couldn't confirm your contribution yet." and never a confirmed receipt. Close and reopen MOVE for the same goal: the same count shows with "Confirm this contribution", not an entry step.
  - On an Android release build, force-stop on the unknown screen (and separately press hardware Back), relaunch and open the goal. The attempt is restored. After reconnecting, one Confirm yields confirmed or already-recorded, and Firestore holds exactly one `wsfContributions/{goal}_{uid}_{attemptId}`.
  - With a test hook making `AsyncStorage.setItem` reject, the unknown screen shows `wsf-contribute-not-saved` and never the "You can leave this page…" sentence.
  - Instrumentation on a release build shows the "sending" row write resolving before the wsfContribute request goes out.
  - On a "once" goal where the write landed but the response was lost, the restored attempt's Confirm gives already-recorded, never an alreadyContributed refusal.
- **Delta to the lane:**
  - Land 810ef50e as integrated.
  - Expose a `pendingDurable && pending.state` predicate for INT-19's Back guard.
  - Keep writes to the same uid + goal key ordered, so a late clear cannot overtake a newer save.

#### ST-03 · P1 · known: current-community memory is a no-op on native, which also breaks MOVE resolve and Home auto-open
- **Where:**
  - `src/currentCommunity.ts:19-26` (store: `window.localStorage ?? null`), `:28-44`, `:51-65` (resolve falls back to "exactly one community").
  - Community tab: `app/(tabs)/community/index.tsx:179, 187-189, 273-276, 365, 374, 380-388, 455, 704-727`.
  - You: `app/(tabs)/you.tsx:315-320, 336-338, 469-479`; `src/ui/YouParityView.tsx:152-156`.
  - Privacy order: `src/ui/CommunityPrivacyControls.tsx:231-235`.
  - Beyond the report: `app/(tabs)/_layout.tsx:223` (bare `/move`), `app/move/index.tsx:131-135, 153-155, 186-193` (`router.replace('/')` when no group), `app/(tabs)/(home)/index.tsx:494-505` (no auto-open), `app/(tabs)/(home)/community/[groupId]/index.tsx:506-508, 533-534`.
- **Status:** SI-C. P1, state (known).
- **Native:** for members of two or more communities:
  - Community chips announce "Now showing X." but redraw the chooser.
  - You stays on "Which community?", with copy that is false on native.
  - The raised MOVE button bounces to the Home list.
  - Home never reopens the last community.
  - Single-community members are unaffected (the one-community rule).
- **Acceptance:**
  - On an iOS release build, a member of two communities taps the second chip. The tab redraws on that community's parity view, and the choice survives force-quit and relaunch.
  - On an Android release build, after opening one community's Home once, You shows that community's band.
  - On a cold launch of either platform with a remembered choice, Community and You never flash the chooser or "Which community?".
  - On iOS and Android release builds, open community B's Home, then press MOVE. MOVE resolves within B and does not bounce to the Home list.
  - On a cold relaunch, the Home tab opens community B directly.
- **Delta to the lane:** an in-memory mirror over `deviceKv`, hydrated inside the auth-ready gate before `(tabs)` and `/move` first render. The synchronous reads in initialisers, focus callbacks, render and the `decided` ref (`(home)/index.tsx:494`) must see the hydrated value on frame 1. Keys stay per uid, and sign-out clears that uid's entry.

#### ST-04 · P1 · The post-auth return family is a no-op on native, and join ignores its own `?event=` params
- **Where:**
  - `src/markerEntry.ts:148-185` and `src/eventReturn.ts:62-93` (sessionStorage).
  - `src/stationSession.ts:213-290` (pending event goal and activity).
  - `src/deviceMode.ts:54-95` (localStorage; the note copy at `:177-178`, rendered in `src/ui/DeviceChoice.tsx:111-113, 142-144`).
  - Consumers: `src/pendingJoinCode.ts:102-111` (`nextRouteAfterAuth`) and `src/authDestination.ts:26-32`.
  - Writers: `src/ui/MarkerEntryScreen.tsx:118-125` (promise copy at `:237-239`); `app/event/[goalId].tsx:276-304, 335, 599, 607` (copy at `:612-613`); `app/join/[joinCode].tsx:91, 99` (params) and `:115-124`, `:273-281` (destination built from storage only).
  - Terminal hops: `app/signin.tsx:74, 131`, `app/signup.tsx:57`, `app/verify-email.tsx:102`, `app/profile-setup.tsx:71, 157`.
- **Status:** SI-C (EAJ-04, LINK-4). XMOD-1 and XMOD-2 are SI-1. P1, state.
- **Native:**
  - "You'll come straight back here" is false: the member lands on Home.
  - A signed-in member opening `westayfit://join/<code>?event=<goal>&activity=squats` lands on `/community/<id>`.
  - The device question repeats on every visit, under "Your answer is remembered on this device only".
  - The marker half cannot be tested end to end on staging until HB-01 clears.
- **Candidate status (reported):** NATIVE-STATE-2 `b463cdee` (integrated `1ed5f27c`) moves the event, marker and kiosk returns onto `src/storage/sessionKv` and `src/postAuthDestination.ts`, with a 2 h native TTL and an awaited launch read. On `80cd713f`, `src/stationSession.ts:213-220`, `src/deviceMode.ts:55-58` and the join `onJoin` read are unchanged.
- **Acceptance:**
  - On an iOS release build, signed out: `westayfit:///go/<slug>` → Sign in → finish. The app lands on the marker screen (`wsf-marker-join` / `wsf-marker-choose`), not Home.
  - On an Android release build, signed out: `/event/<goalId>` → Create an account → verify → profile. The app lands on `/event/<goalId>`.
  - On an iOS release build, already signed in: `westayfit:///join/<code>?event=<goalId>&activity=<label>` → Join. The app lands on `/event/<goalId>?activity=<label>`, with the activity listed first and nothing pre-selected.
  - On an Android release build, from the event screen reached in-app: "Use a different account" → sign in as B → B lands on `/event/<goalId>`.
  - On iOS and Android, after answering "My own phone" once, a relaunch and the same event do not ask again. If the save fails, the "remembered on this device" sentence is hidden.
  - A return older than 2 hours is ignored. "Not now — back to home" on the marker screen clears the return.
  - An abandoned event join followed later by a plain join of another community lands on that community.
- **Delta to the lane:**
  - Move the `stationSession` pending event and activity, and `deviceMode` (durable tier), onto the mirror.
  - In `onJoin`: `routeAfterJoin(groupId, readPendingEventGoal() ?? eventGoalId, readPendingEventActivity() ?? eventActivity)`.
  - Owner question: should native default the device mode to "personal"?

#### ST-05 · P1 · The kiosk return is lost on native, so the visitor lands signed in on member Home on a shared device
- **Where:** `src/kioskSession.ts:100-132` (sessionStorage only); `app/kiosk/[goalId].tsx:97-107, 187-191`; `app/contribute/[goalId].tsx:1206-1320, 1721-1741`; `src/pendingJoinCode.ts:107-108`; `src/authDestination.ts:29`.
- **Status:** SI-C, corrected to P1. It is not reachable from release UI today: "Open kiosk" renders only when `kioskUrlFor` is truthy (`[groupId]/index.tsx:1468-1470, 2404`), and that is null in release. It is reachable through dev builds, `westayfit://kiosk/<goalId>`, and `westayfit://event/<goalId>` → shared device (`app/event/[goalId].tsx:296-304`). **Re-raise to P0 the moment anything makes the kiosk reachable from shipped UI** (INT-08, INT-03 links, or changes to the Open kiosk gate).
- **Native:** after Contribute → Sign in, `nextRouteAfterAuth` resolves to "/". The visitor gets member tabs with no Finish and no 90 s idle sign-out, and native Auth persistence keeps them signed in across relaunch.
- **Candidate status (reported by the LINK-4 verifier):** NATIVE-STATE-2 moves the kiosk return. Fail-closed behaviour after process death during verify-email is UNVERIFIED.
- **Acceptance:**
  - On an iPad or Android tablet release build: `westayfit://kiosk/<goalId>` → Contribute here → sign in as a verified visitor with a profile. The app lands on `/contribute/<goalId>?kiosk=1` with no tab bar and Finish visible.
  - The same with an unverified account and a no-profile account. The sign-in screen shows the "Finishing signs you out of this device" card, and after verify and profile the app lands on the kiosk contribute screen.
  - `westayfit://event/<goalId>` → shared device → sign in gives the same result.
  - After Finish or the countdown, force-quit and relaunch: no account is signed in.
  - Kill the app during verify-email, relaunch and finish. The device goes to `/kiosk/<goalId>` (signed out), never Home.
  - After a kiosk session ends, an ordinary sign-in is not routed to the kiosk.
- **Delta to the lane:** a process-lifetime in-memory return plus a durable "kiosk session active" marker that fails closed to `kioskStartRoute(goalId)`. **Hard ordering gate:** this lands before INT-08 merges, or MF-08's interim hide ships in the same release.

#### ST-06 · P1 · A replay refused as "unauthenticated" is shown as "not recorded" and clears the attempt
- **Where:** `src/contributionFlow.ts:154-155` (unauthenticated → refused/signedOut) and `:197-201` (copy "Your … were not recorded. Sign in and record them again."); `app/contribute/[goalId].tsx:1134-1180` (onReconcile: `clearPendingIfAttempt` before `stillCurrent`), `:1069`, `:742-744` (load path → notSignedIn, rendered before pending); `@firebase/functions index.esm2017.js:338-350, 578-590, 604-615` (a token failure is swallowed and the POST goes out without Authorization); `@firebase/auth rn :1534-1559, 1230-1248`; server `../../functions-westayfit/src/index.ts:3828-3830` (unauthenticated is thrown before the replay check at `:3984`).
- **Status:** SI-C. P1, state (the pending row is what gets wrongly cleared).
- **Native:** after a long background period on a flaky network, the refresh fails silently and the replay is refused before the server reads the attempt. The screen says it was not recorded and tells the member to record again, which double counts if the first send landed. A user-disabled sign-out can also delete the row for good.
- **Acceptance:**
  - On an Android release build with an unknown attempt whose first send landed, block `securetoken.googleapis.com` only and tap Confirm. The attempt is kept as unknown (or the member is asked to sign in with it kept). The screen never says "were not recorded" and never clears it.
  - On the same device, unblock and tap Confirm. The result is "This contribution was already recorded. It counted once.", with exactly one contribution document.
  - On an iOS release build, a first-send Record refused as unauthenticated may still say "not recorded" (true for a fresh attempt).
  - On an iOS release build with `currentUser` set and refresh blocked, opening a goal shows the connection state with Retry, not "Sign in to contribute".
- **Fix sketch:**
  - For a replay, treat unauthenticated as unknown or needsSignIn (row kept).
  - Call `getIdToken(true)` before replaying, and do not send if it fails.
  - Call `clearPendingIfAttempt` only after `stillCurrent()`.
  - Load path: a forced refresh first, then Retry or notSignedIn.
  - Update the pin in `tests/contribution-flow.test.ts:55`.

#### ST-07 · P2 · The DeviceKv contract has only durable storage, and native `keysWithPrefix` lists Firebase Auth's keys
- **Where:** `src/storage/kv.ts:14-20`; `src/storage/kv.native.ts:14-46` (`:40` `AsyncStorage.getAllKeys()`); `src/firebaseAuthInit.native.ts:31` (Auth persists in the same AsyncStorage); session-lifetime records `src/stationSession.ts:33-51, 224-232` (no timestamp), `src/eventReturn.ts:35-41`, `src/kioskSession.ts:20-23`, `src/markerEntry.ts:143-151`.
- **Status:** SI-1 (XMOD-4). The candidate `sessionKv` (`{v, exp}` envelope, 2 h TTL) reportedly covers lifetime. The `keysWithPrefix` hazard is UNVERIFIED on the candidate.
- **Acceptance:**
  - On an Android release build, abandon an event join at signup, force-stop, relaunch the next day, then join community B. The app lands on B.
  - On an iOS release build, a return written more than 2 h ago is ignored after relaunch.
  - On an iOS release build, sign-out clearing uses `keysWithPrefix('wsf.')`, never removes `firebase:*` and never calls `AsyncStorage.clear()`. A later sign-in restores normally.

#### ST-08 · P2 · The b84a4689 pending/unknown badges are absent from product source
- **Where:** `app/contribute/[goalId].tsx:2267-2364` (sending and unknown screens). The copy exists only in `src/ui/designTarget/MoveFlowTargets.tsx:682`.
- **Status:** SI-R (target delta, web and native).
- **Target:** the "Sending · not counted yet" badge; for unknown, "Not confirmed yet" with Check status; no attempt id in member copy.
- **Acceptance:**
  - On an iOS release build, while the send is in flight, the badge reads "Sending · not counted yet".
  - After an unknown outcome, the screen shows "Not confirmed yet" with Check status, no attempt id and no credit.
  - On web, the same copy renders.
- **Note:** schedule after ST-02 lands, since it touches the same screen region.

### 4.3 Motion (in flight)

Known items, not repeated here:
- (a) native Together completion: `src/ui/TogetherCompletion.tsx` starts motion only on web
- (b) `useReducedMotion` initial state
- (c) NEXT: native movement demo video (`src/ui/MovementDemoMedia.tsx` shows a poster; expo-video being added)

| ID | Sev | Title | file:line | Status | Merged from |
|---|---|---|---|---|---|
| MO-01 | P2 | Together: the ordinary acknowledgment never plays when `before` is null; reached copy differs | src/contributionFlow.ts:441 | SI-R | reconciler (J10) |
| MO-02 | P2 | Native sheets slide the whole screen and scrim; no 180 ms exit; hand-off re-presents; grabber not draggable | app/_layout.tsx:92 | SI-1 ×4 | SRN-09, MR-05, SRN-07, VIS-10 (sheet) |
| MO-03 | P2 | Settings rises from the bottom on iOS (slide_from_right ignored for transparentModal) | app/_layout.tsx:146 | SI-1 ×2 | SRN-08, CLPY-07 |
| MO-04 | P2 | Tab-change fade is CSS-only | src/ui/TabSceneFade.tsx:64 | SI-1 ×4 | SRN-10, HOME-N11, CLPY-14, VIS-10 (tab) |
| MO-05 | P2 | Follow-along round is not paused on background; the round "finishes" while away | src/followAlongSession.ts:246 | SI-1 ×2 | LIFE-2, MR-07 |
| MO-06 | P2 | known+: the expo-video twin must re-sync on foreground (expo-video pauses and never resumes) | src/ui/MovementDemoMedia.tsx:32 | SI-1 | LIFE-3 |
| MO-07 | P3 | known+: demo catalog URIs are web-relative | src/movementDemoMedia.ts:59 | SI-1 | MR-12 |
| MO-08 | P3 | Follow-along reads Reduce Motion once and never subscribes | src/followAlongSession.ts:128 | SI-1 | LIFE-6 |

#### MO-01 · P2 · Together receipt: no ordinary acknowledgment when `before` is null; reached copy differs from b84a4689
- **Where:** `src/contributionFlow.ts:436-442` (animate requires `fresh && hasShared && !alreadyRecorded && before != null`; the `before` check is at `:441`); `:336` (subline "Our goal is reached.").
- **Status:** SI-R. This is beyond the known web-only motion start.
- **Target:** 517b961a native_scope_hint: gate on a fresh direct confirmation plus `alreadyRecorded !== true`, not on the presence of a before total. b84a4689 reached-unsignaled copy: "Goal reached. Your effort is in."
- **Acceptance:**
  - On an iOS release build, a fresh +20 receipt with `before:null` below target plays gather → pulse → waves once, with the fill fixed at after/target. Closing and reopening shows it static.
  - With Reduce Motion on at mount, it starts settled.
  - A replay (`alreadyRecorded:true`) is static.
  - "WE did it. Together." appears only on a `crossedTarget:true` fixture.
  - A reached receipt with crossing unsignaled reads "Goal reached. Your effort is in." on iOS, Android and web.
- **Fix sketch:** drop the `before != null` term (keep `fromRatio = toRatio` when before is null, `:436`) and update the reached copy. Fixture tests cover all four cases.

#### MO-02 · P2 · Native MOVE and contribution sheets slide the whole screen with the scrim; no in-place fade, no 180 ms exit; the hand-off re-presents
- **Where:** `app/_layout.tsx:83-127` (transparentModal + `slide_from_bottom`); `src/ui/sheetMotion.ts:22-66, 76-84, 132-145` (CSS motion web-only; `useSheetExit` navigates at once off web); scrims inside the screen at `app/move/index.tsx:341-357` and `app/contribute/[goalId].tsx:1616-1636`; hand-off at `app/move/index.tsx:170-174, 212-221` (`router.replace`); react-native-screens `RNSScreenStack.mm setModalViewControllers` (dismiss, then re-present).
- **Status:** SI-1 (SRN-09, MR-05, SRN-07, VIS-10). The Android hand-off visual is NDC.
- **Native:** a dark rectangle travels up the full height. With one open goal, iOS dismisses and re-presents, so the undimmed tab flashes. The grabber is drawn but cannot be dragged.
- **Web:** the scrim fades in place, the panel rises 28 px over 240 ms with cubic-bezier(.22,1,.36,1), the exit takes 180 ms, and the hand-off keeps one continuous dim.
- **Acceptance:**
  - On iOS and Android release builds, pressing MOVE fades the dim in over the tab while the panel rises about 28 pt in about 240 ms. The dim never moves as a solid block.
  - With exactly one open goal, MOVE → contribution flow shows one continuous dim, with no second slide and no undimmed frame.
  - Close or a scrim tap plays a short exit (about 180 ms) before the tab is usable, and a second Close during the exit is ignored.
  - With Reduce Motion on (set before launch), there is no travel on the first or any later open.
  - Dragging the grabber down closes the sheet, or the grabber is removed on native. Closing after a hand-off returns to the opener tab with scroll kept.
- **Fix sketch:** present with `animation: 'fade'` / `'none'` and run the panel motion with Reanimated inside the screen. Make the hand-off non-animated when `markSheetHandoff()` is set. The `app/_layout.tsx` edits are limited to `animation` values on lines 83-150, coordinated with the integrator.

#### MO-03 · P2 · On iOS, Settings rises from the bottom instead of entering from the side
- **Where:** `app/_layout.tsx:139-150` (`slide_from_right`); `react-native-screens/ios/RNSScreen.mm:321-342, 2151` (maps to Default, i.e. CoverVertical, for modals); `app/settings.tsx:89-102, 193-204`.
- **Status:** SI-1 (SRN-08, CLPY-07). The owner asked for "Settings should enter from the side".
- **Acceptance:**
  - On an iOS release build, opening Settings from the menu or You's row brings the panel in from the right in about 240 ms, while the scrim fades without moving. Close, a scrim tap or a swipe reverses it in about 180 ms.
  - On an Android release build, the scrim fades rather than sliding, and the panel shows a shadow edge.
  - With Reduce Motion on, there is no travel.

#### MO-04 · P2 · Tab changes have no fade on native
- **Where:** `src/ui/TabSceneFade.tsx:46-66` (dataSet only); `src/ui/sheetMotion.ts:50-53, 60-61`; `app/(tabs)/_layout.tsx:200` (`animation: 'none'`).
- **Status:** SI-1 (×4).
- **Acceptance:**
  - On iOS and Android release builds, switching Home → Community fades the entering tab from about 0.35 to 1 over about 140 ms ease-out, with none of Home visible during the fade.
  - Reselecting a tab, the first tab after launch, and returning from MOVE or Settings do not fade.
  - Reduce Motion means an instant switch.
  - Fast switching (Home → Community → Progress within 140 ms) leaves Progress fully opaque.
- **Fix sketch:** a Reanimated opacity on the phase change, gated on `useReducedMotion`.

#### MO-05 · P2 · The follow-along round is not paused when the app goes to the background
- **Where:** `src/followAlongSession.ts:245-263` (returns early at `:246` when there is no document); `:149-150` and `src/followAlong.ts:299-316` (wall-clock); `:253-270`, `:327-346` (the blur rule); `src/ui/FollowAlongCard.tsx:287-300`. Hosts: `app/queue/[goalId].tsx:357-367, 644-671`, `app/move/[goalId].tsx:183`, `app/station/[goalId].tsx:282`.
- **Status:** SI-1 (LIFE-2, MR-07). No credit comes from elapsed time (the count is always typed), so this is not data-truth. Raise to P1 if event turns are in this sprint's native scope.
- **Native:** on return the round reads "That's the round · enter your own count", and the interrupted notice never shows.
- **Acceptance:**
  - On an Android release build, start a round on `/queue/[goalId]` or `/move/[goalId]`, press Home for 60 s and return. The card shows "Paused · Ns left in this round" with the interrupted notice (Ns ±1 s), and Resume continues the round.
  - On an iOS release build, a phone call during the countdown or the round pauses it with nothing accrued for the call.
  - On iOS, Control Center (AppState `inactive` only) does not pause, per the blur rule.
  - On web, existing specs pass.
- **Fix sketch:** AppState `background` → the existing `interrupt('hidden')` path.

#### MO-06 · P2 · known+: the expo-video twin must re-sync to the round on foreground
- **Where:** `src/ui/MovementDemoMedia.tsx:32-51` (poster only today); `src/ui/MovementDemoMedia.web.tsx:55-59, 86-116`; `src/movementDemoMedia.ts:158-161`. expo-video 3.0.16: `ios/VideoManager.swift:47` (`onAppForegrounded` is empty) and `:49-60`; `android/.../VideoManager.kt:114-134, 150-158`; `build/VideoPlayer.types.d.ts:125-134` (`staysActiveInBackground` defaults to false).
- **Status:** SI-1 (LIFE-3). known: motion NEXT. This adds the lifecycle contract and depends on MO-05 for the "held" path.
- **Acceptance:**
  - On an iOS release build with an approved test clip playing, background the app. On return the round is paused, the clip holds its frame (`demo-state 'paused'`), and Resume plays it within 1 s.
  - On an Android release build, returning while the round is still running has the clip actually playing within 1 s (`play()` re-asserted on AppState `active`).
  - With Reduce Motion on, the poster stays across every background/foreground cycle.
  - The clip never takes the audio session and never shows Now Playing (muted, `showNowPlayingNotification: false`). Leaving the screen releases the player.
  - The drawn fallback figure (an SVG data URI in `src/ui/FollowAlongCard.tsx:148-167`) renders through MF-05's native SVG path.

#### MO-07 · P3 · known+: demo-media catalog paths are web-relative
- **Where:** `src/movementDemoMedia.ts:46-60, 73-89, 113-133` (`/media/movements/` prefix); `src/ui/MovementDemoMedia.tsx:263-281`.
- **Status:** SI-1 (MR-12). The catalog is empty today.
- **Acceptance:**
  - On iOS and Android release builds with one approved entry, the poster shows on first paint.
  - The clip loops only while the round runs and is released on leave; Reduce Motion shows only the poster.
  - Media resolves from bundled assets or an approved absolute https origin, and arbitrary URIs are still refused (the `isAllowedDemoUri` intent).

#### MO-08 · P3 · Follow-along reads Reduce Motion once and never subscribes
- **Where:** `src/followAlongSession.ts:123-136, 267`; `src/ui/FollowAlongCard.tsx:211-212`; `src/ui/useReducedMotion.ts:24-34` (already subscribes).
- **Status:** SI-1 (LIFE-6). On native, changing the setting always means leaving the app.
- **Acceptance:**
  - On an iOS release build, background mid-round, turn on Reduce Motion, foreground. Within 1 s the figure stops alternating and the poster is still.
  - The same with Android "Remove animations", with no remount.
- **Fix sketch:** use `useReducedMotion()`. Do it together with the known initial-state fix.

### 4.4 Camera (in flight)

Known item, not repeated here: native camera/pose. `src/movement-camera/support.ts:47-50` returns true only on web.

| ID | Sev | Title | file:line | Status | Merged from |
|---|---|---|---|---|---|
| CAM-01 | P2 | The camera releases only on document visibilitychange; the native port needs AppState release | src/movement-camera/controller.ts:82 | SI-1 | LIFE-4 |
| CAM-02 | P2 | Settings shows "Camera rep counter" ON on native, where the camera never opens | src/movement-camera/MoveCameraSettingsSection.tsx:20 | SI-1 | CLPY-10 |
| CAM-03 | P2 | b84a4689 readiness strip, ±5 / Reset / Count again and the review-note wording are absent | app/contribute/[goalId].tsx:2655 | SI-R | reconciler (J8, J16) |

#### CAM-01 · P2 · The native camera port must release the camera on AppState background
- **Where:** `src/movement-camera/controller.ts:82-93` (listeners only when document exists), `:113` (hidden-start guard); `src/ui/CameraRepCounter.tsx:16, 196-208`.
- **Status:** SI-1 (LIFE-4). Dormant today, because the camera fails closed on native.
- **Acceptance:**
  - On an iOS release build with the native counter, pressing Home while counting turns the camera indicator off within 1 s. On return, "Camera paused · N squats kept so far" shows, and nothing restarts until Resume camera.
  - On an Android release build, the same via Home and Recents, with no frames processed while in the background.
  - The camera never starts while AppState is not `active`.

#### CAM-02 · P2 · Settings advertises a camera counter the device does not have
- **Where:** `src/movement-camera/MoveCameraSettingsSection.tsx:13-39` (no support gate); `app/settings.tsx:149`; `src/movement-camera/support.ts:47-50`; `src/movement-camera/settingsStore.ts:7-9, 17-24` (in memory on native; persistence is known state-lane work).
- **Status:** SI-1 (CLPY-10).
- **Acceptance:**
  - On iOS and Android release builds where `cameraCounterSupported()` is false, Settings hides Camera rep counter, or disables it with "Not available on this device yet".
  - Once native support ships, turning it off survives force-quit and relaunch.

#### CAM-03 · P2 · b84a4689 camera readiness chrome and adjust controls are missing from canonical
- **Where:** `app/contribute/[goalId].tsx:2655-2674` (adjust is ±1 only), `:2683` (review note "Camera estimate on this device — you review it before anything is added.").
- **Status:** SI-R. Affects web and native. CAMERA-MOVE-WEB-1 (85365233) is held, but b84a4689 is not.
- **Target:**
  - readiness strip "In view / Whole body / Steady"
  - dashed-to-green guide
  - "Counting" badge
  - Adjust −1/+1/−5/+5
  - "Reset to estimate"
  - "Count again"
  - review note "From a camera estimate of N · you set the final number"
- **Acceptance:**
  - On an iPhone release build with the native counter, readiness shows the three checks and the guide turns green before counting.
  - Adjust offers ±1 and ±5, Reset returns to the frozen estimate, and Count again restarts. The estimate never auto-credits.
  - The first Start moving shows the iOS camera permission dialog. Denying it falls back to manual count, and Finish freezes the estimate into Adjust.
  - On Android, the permission prompt and the same flow work.
- **Constraint:** never edit the frozen r14.2.1 counter files (`src/movement-camera/frozen/`).

### 4.5 Member-feature

| ID | Sev | Title | file:line | Status | Merged from |
|---|---|---|---|---|---|
| MF-01 | P1 | Copy and Share use web APIs only; a Champion cannot pass an invite on from the phone | src/shareGoalDisplay.ts:88 | SI-C | CD-02, EAJ-07, HOME-N7, LINK-3 (clipboard) |
| MF-02 | P1 | Home's join field rejects the invite URL members actually receive | app/(tabs)/(home)/index.tsx:72 | SI-C | HOME-N1 |
| MF-03 | P1 | After sign-out, an in-flight read can draw the previous account on You | app/(tabs)/you.tsx:401 | SI-C | CLPY-02 |
| MF-04 | P2 | NDC: a body-less 403/404 on the privacy toggle says "no longer a member" | src/ui/CommunityPrivacyControls.tsx:206 | NDC | CLPY-04 |
| MF-05 | P2 | SVG data URIs in RN Image render blank (invite QR, handoff/station QR, drawn figure) | src/ui/JoinQrCode.tsx:164 | SI-1 ×5 | VIS-04, CD-03, EAJ-08, LINK-3 (QR), MR-11 (SVG) |
| MF-06 | P2 | "Reload the page" copy and hidden relative "Open …" buttons when no URL exists | app/(tabs)/(home)/community/[groupId]/index.tsx:4566 | SI-C (via verifiers) | CD-01/EAJ-06 follow-on |
| MF-07 | P2 | Native date and time fields are free-text ISO | src/ui/DateTimeField.tsx:69 | SI-1 ×3 | VIS-12, CD-06, EAJ-13 |
| MF-08 | P2 | "Open kiosk" opens the kiosk inside the Champion's app, and the kiosk signs them out | app/(tabs)/(home)/community/[groupId]/index.tsx:2419 | SI-1 | CD-04 |
| MF-09 | P2 | Manage sheet: keyboard covers inputs, no bottom inset, web-only scrim onClick | app/(tabs)/(home)/community/[groupId]/index.tsx:3015 | SI-1 | CD-05 |
| MF-10 | P2 | In-page back controls create duplicate community instances | app/(tabs)/(home)/community/[groupId]/index.tsx:4666 | SI-1 | CD-08 |
| MF-11 | P2 | Community hero large-text rules keyed to width | app/(tabs)/(home)/community/[groupId]/index.tsx:2161 | SI-1 ×2 | CD-09, HOME-N6 (hero) |
| MF-12 | P2 | Goal setup scroll-to-first-error does nothing (measureLayout with a numeric node) | app/goals/new.tsx:538 | SI-1 | EAJ-12 |
| MF-13 | P2 | The keyboard Go key bypasses the sign-up, sign-in and reset gates | app/signup.tsx:183 | SI-1 | EAJ-14 |
| MF-14 | P2 | First-run tour v2 and "You > Help" replay missing | (no file; Home and You) | SI-R | reconciler (J1, J5) |
| MF-15 | P2 | Start community has no chained first-goal two-action footer | app/start-community.tsx:474 | SI-R | reconciler (J12) |
| MF-16 | P3 | Signed-in redirect on Sign in / Sign up stuck on "Loading…" offline | app/signin.tsx:67 | SI-1 | EAJ-17 |
| MF-17 | P3 | Progress and You numerals: no font-scale cap; line heights below font size | src/ui/ProgressParityView.tsx:525 | SI-1 | CLPY-15 |
| MF-18 | P3 | Accessibility polish: Members back target, aria-pressed, aria-hidden Text, describedby hints, DeviceChoice names | app/(tabs)/(home)/community/[groupId]/members.tsx:165 | SI-1 ×3 | CD-12, CLPY-13, XMOD-5 |
| MF-19 | P3 | Marker "code isn't active" copy tells an in-app member to "open the app" | src/ui/MarkerEntryScreen.tsx:182 | SI-1 | LINK-6 |
| MF-20 | P3 | NDC: iOS `zoneInWords` keeps only the first word of a multi-word zone | app/goals/new.tsx:248 | NDC | CLPY-06 verifier note |

(Earlier cross-references to "MF-19" for Progress numerals and "MF-20" for a11y map to MF-17 and MF-18 in this table. MF-22 maps to MF-20.)

#### MF-01 · P1 · Copy and Share are web-only, so a Champion on the phone cannot pass an invite on
- **Where:**
  - `src/shareGoalDisplay.ts:88-97` (only `navigator.share` / `clipboard`).
  - In `app/(tabs)/(home)/community/[groupId]/index.tsx`:
    - `:1661-1677` (onCopyInvite)
    - `:1858-1871` (onShareInvite)
    - `:1887-1914` (display share)
    - `:2035` (`hasShareApi`)
    - `:2232-2236`
    - `:4308-4329`
    - `:4522-4549`
    - kiosk, station and combined copy at `:657-672`, `:1473-1492`, `:1502-1519`
  - RN `setUpNavigator.js:15-19`. No expo-clipboard; RN Share unused.
- **Status:** SI-C. P1 for invite; kiosk, station, combined and display share are P2 parts. Corrections:
  - In release builds the controls are not reachable today (ST-01 crash, then null URLs, INT-08).
  - "Copy failed — use the QR code" shows only in dev builds, and that QR is blank (MF-05).
- **Native:** on Android 10+ and iOS, the share sheet would cover Copy, but no path calls it.
- **Acceptance:**
  - On an iOS release build, "Share invite" is present and opens the iOS share sheet with `https://<env host>/join/<code>`. Dismissing it changes nothing on screen.
  - On an Android release build, "Copy invite" puts exactly that URL on the clipboard (paste into Messages) and shows "Copied" for 2 s.
  - On both platforms, kiosk, station and combined "Copy link" copy their URL and show "Copied". "Copy didn't work" appears only if the clipboard call actually rejects.
  - For an authorized, non-sample featured goal, the display Share control renders with SHARE_DISCLOSURE and shares `/display/<goalId>`.
  - On native, after "Yes, create a new link", Copy, Share and QR all carry the new code. No copied URL ever contains the Metro host or `:8081`.
- **Fix sketch:**
  - Add `src/ui/shareLink.ts` plus a `.native.ts` twin. Native uses `Clipboard.setStringAsync` (expo-clipboard; the integrator adds the dependency) and `Share.share` (iOS `{url, message}`, Android `{message}`). Treat dismissedAction as a no-op.
  - `shareRoute` gains a "nativeShare" route, and `hasShareApi` derives from the route.
  - Route all six call sites through it. Depends on INT-08 for URLs and on ST-01 using `currentOrigin()`.

#### MF-02 · P1 · Home's "Join with a code" rejects the invite URL members are given
- **Where:** `app/(tabs)/(home)/index.tsx:72` (`JOIN_CODE_SHAPE = /^[A-Za-z0-9_-]{16,128}$/`), `:225-233`, `:413`, `:531`, `:764-774`. The code is never shown as text (`[groupId]/index.tsx:4549-4560`, `showUrl={false}`; `src/ui/JoinQrCode.tsx:69`); codes are 22-character base64url (`../../functions-westayfit/src/index.ts:62-63`).
- **Status:** SI-C. P1, member-feature. The validator is shared with web, but it only becomes the member's bottleneck on native, because links do not open the app (INT-03).
- **Acceptance:**
  - On an iOS release build, signed in, pasting `https://<prod-host>/join/<code>` and tapping Go opens the in-app join preview for that code.
  - On an Android release build, the same works with a trailing slash or surrounding whitespace, and with `westayfit://join/<code>`.
  - `https://<host>/join/<code>?event=<goalId>` keeps the event param.
  - `https://<host>/community/x`, a 10-character code, or a wrong path shows "That does not look like a valid code." and does not navigate.
- **Fix sketch:** a pure helper `src/joinInput.ts parseJoinInput(raw)`:
  - accepts a bare code, http(s) or `westayfit:` URLs whose path is exactly `/join/<seg>`
  - forwards only `event` and `activity`, URI-encoded
  - falls back to a regex on native
  - has unit tests
  - Optional placeholder "Paste an invite link or code".

#### MF-03 · P1 · After sign-out, a read still in flight can draw the previous account's name, community and amounts on You
- **Where:** `app/(tabs)/you.tsx:400-405` (the `!user` branch never bumps `live`), `:406`, `:429-447`, `:498-509`, `:511-513` (the cleanup only clears a timer), `:514`; `src/memberReads.ts:136-147, 199-210`; `app/(tabs)/_layout.tsx:142-152` (menu Sign out stays on the tab), `:197` (`freezeOnBlur: false`); `src/ui/YouParityView.tsx:92-189`. Progress and Community bump their token in cleanup (`activity.tsx:377`, `community/index.tsx:329`).
- **Status:** SI-C, corrected to P1. It needs sign-out during a short read window; it is the member's own data on the same device and is not persisted. Keep P0 only if the owner treats "no account data on a signed-out screen" as absolute. The Android Back variant is weak (TabRouter replace drops the history, UNVERIFIED).
- **Acceptance:**
  - On an iOS release build at 3G via Network Link Conditioner: first visit to You, then within 1 s menu → Sign out. Only `wsf-you-signed-out` shows (no band, name, role or amounts), and it still does 10 s later.
  - On an Android release build, the same, plus `westayfit://you` by deep link while signed out shows only the signed-out card.
  - After the steps above, sign in as account B on the same device. You never shows A's data, not even for a frame.
- **Fix sketch:** `return () => { live.current += 1; … }`, plus `state={ready && !user ? {kind:'signedOut'} : screen}`. Optionally `read()` rejects when `uid` is not the current user.

#### MF-04 · P2 · NDC: if blocked wsfSetCommunityVisibility returns a body-less 403 or 404, the panel says "You're no longer a member" and the community disappears
- **Where:** `src/ui/CommunityPrivacyControls.tsx:67` (`REFUSED = {not-found, permission-denied}`), `:203-221`; `src/ui/communityParityTypes.ts:399-407`; `src/memberReads.ts:433-444` (forget, then `refused.add`), `:280-283`, `:107-113`; `app/(tabs)/community/index.tsx:350-373`; `@firebase/functions index.esm2017.js:209-242, 246-286`.
- **Status:** uncertain, corrected to P2. The client path is real, but the trigger depends on the HTTP status that Cloud Run IAM returns to a Firebase-ID-token bearer. The verifier expects 401 (`functions/unauthenticated`, which leads to the truthful "not saved" path). On web, the CORS preflight leads to `internal` (truthful). `refused` lives in memory only.
- **Exact device check:** on an iOS or Android staging build, sign in as an active member, toggle "Show my name and initials" under Settings > Privacy, and capture the POST to `https://us-central1-westayfit-staging.cloudfunctions.net/wsfSetCommunityVisibility` (Proxyman or Charles, or log `e.code` / `e.message`).
  - 401 / unauthenticated: refuted.
  - 403 or 404 with the message equal to the bare code: confirmed.
  - Equivalent: `curl -X POST` with `Authorization: Bearer <member ID token>` and `Content-Type: application/json`.
- **Acceptance (if confirmed):**
  - On an iOS staging build with the callable blocked, a toggle shows not-saved or unconfirmed copy, the switch stays at the stored value, and the copy never says "no longer a member".
  - The Community tab still draws the same current community.
  - A genuine server refusal ("Members only." HttpsError) still shows the membership-refused copy.
- **Fix sketch (cheap hardening, fine either way):** treat REFUSED codes as membership refusal only when the error carries a server-written message, and confirm with a quiet wsfMyCommunities re-read before calling forget. Check the same pattern in `src/ui/MarkerEntryScreen.tsx:87, 138`.

#### MF-05 · P2 · SVG data URIs passed to RN Image render blank on native
- **Where:** `src/ui/JoinQrCode.tsx:111-129, 153-179`; `src/ui/qr.ts:607, 618-623`; call sites `[groupId]/index.tsx:3649, 4557-4562`; `src/ui/FollowAlongCard.tsx:148-167` (`src/ui/moveFigure.ts:81, 109-115`); `app/move/[goalId].tsx:186-197, 245-253`; `app/station/[goalId].tsx:183-187, 1284-1316`. react-native-svg 15.12.1 is present only transitively, so it is not autolinked.
- **Status:** SI-1, five reports. Blank rendering on device is NDC, but RN core Image has no SVG decoder, and the raw `#` makes the URI a fragment.
- **Native:** "Show QR code" opens a white 220 pt square. Because encoding succeeds, the honest "could not be turned into a QR code" fallback never shows. The drawn movement figure (and both poses under Reduce Motion) is blank too.
- **Acceptance:**
  - On iOS and Android release builds, Community Home → Invite → "Show QR code", and the Champion Manage QR, draw a symbol that a second phone's camera decodes to exactly the copied invite URL.
  - The symbol stays square within a 320 pt column and at the largest text size, and it re-renders after a link reset.
  - On native, a goal with no approved media on `/queue/<goalId>` shows the drawn ready-pose figure with its accessibility label, and both poses side by side under Reduce Motion.
  - A unit or native render check asserts that no `data:image/svg+xml` URI reaches RN Image when `Platform.OS !== 'web'`.
- **Fix sketch:** declare react-native-svg (integrator dependency). Add `JoinQrCode.native.tsx` drawing modules with `<Svg>` / `<Rect>`, plus a shared native `SvgUri` / XML helper. The motion lane applies it to the FollowAlongCard figure.

#### MF-06 · P2 · Copy that can never become true on native, and relative "Open …" buttons hidden when no absolute URL exists
- **Where:** `[groupId]/index.tsx:2404-2443`, `:2512-2547`, `:3155-3189`, `:3651-3654`, `:4564-4567` ("Reload the page to try again", "Close this and open it again"). The "Open kiosk / station screen / combined screen" ButtonLinks use relative routes but sit inside the URL-present branches.
- **Status:** SI-C (from the CD-01 and EAJ-06 verifier follow-ons).
- **Acceptance:**
  - On iOS and Android release builds, no community-detail or Manage-sheet text says "Reload the page" or "Close this and open it again".
  - "Open station screen" and "Open combined screen" are visible and navigate in-app even with no origin configured.
  - "Open kiosk" follows MF-08.
- **Fix sketch:** move the relative buttons out of the URL branches, and add platform-true copy for a missing origin.

#### MF-07 · P2 · Champion date and time fields fall back to free-text ISO on native
- **Where:** `src/ui/DateTimeField.tsx:19-23` (stated intent), `:56-67` (web picker), `:69-84` (native TextInput with placeholder "2026-09-25T14:00"); `app/goals/new.tsx:119-160, 1049-1082`; `[groupId]/index.tsx:3241-3254, 3277-3281`; `src/combinedSetup.ts:151-177`. The composer is gated to staging and emulator (`app/goals/new.tsx:701-713`).
- **Status:** SI-1, three reports.
- **Acceptance:**
  - On an iOS release staging build, Goal setup → Custom → Starts and Ends open the native date and time picker, the summary shows the choice in words, and review shows the device IANA zone.
  - On an Android release staging build, the Material date-then-time dialogs work, and Back cancels without changing the value.
  - For the same local choice, `startsAt` and `endsAt` equal what web sends. A malformed date string cannot be submitted, and an end before the start shows "The end must be after the start.".
  - VoiceOver and TalkBack announce "Starts" and "Ends" with their values. The Community Home combined-goal form uses the same picker.
- **Fix sketch:** add `DateTimeField.native.tsx` using `@react-native-community/datetimepicker` (integrator dependency).

#### MF-08 · P2 · "Open kiosk" opens the venue kiosk inside the Champion's own app, and the kiosk signs that account out
- **Where:** `[groupId]/index.tsx:2404-2440` (Open kiosk), `:2523-2529`, `:3167-3173`; `app/kiosk/[goalId].tsx:77-107` (sign out on focus).
- **Status:** SI-1. Hidden in release today, because `kioskUrlFor` is null. It goes live in dev clients, and in release once INT-08 lands. Pairs with ST-05.
- **Acceptance:**
  - On iOS and Android builds, a Champion who uses the kiosk action is still signed in afterwards, or first sees an explicit confirmation that opening the kiosk on this phone will sign them out.
  - After visiting any kiosk, station or combined control, the shell, Home community and Manage entry belong to the same account.
  - The station and combined "Open …" actions are labelled as venue-screen actions, or hand the web address to the system browser or share sheet.
- **Interim (ships with INT-08 if ST-05 has not landed):** hide "Open kiosk" when `Platform.OS !== 'web'`.

#### MF-09 · P2 · Champion Manage sheet on native: keyboard covers inputs, no bottom inset, scrim close uses a web-only onClick
- **Where:** `[groupId]/index.tsx:2996-3006` (transparent Modal), `:3015-3022` (scrim `onClick`), `:3057` (plain ScrollView), `:2562-2574` and `:3207-3254` (inputs), `:5544-5558` (fixed paddingBottom 24); `ReactModalHostView.kt:88-98, 327`.
- **Status:** SI-1. The Android edge-to-edge overlap is NDC.
- **Acceptance:**
  - On an iOS release build, focusing the station pairing code keeps the field and Approve visible, and one tap on Approve submits.
  - On iOS, each of the five combined-goal fields stays visible, and "Start this combined goal" is reachable without dismissing the keyboard.
  - On a home-indicator iPhone and on Android (gesture and 3-button navigation), "Leave this community" is fully above the indicator or navigation bar.
  - Tapping the dim area closes the sheet, and Android Back closes it.
- **Fix sketch:** use the INT-06 keyboard wrapper, `paddingBottom: 24 + insets.bottom`, and a Pressable scrim.

#### MF-10 · P2 · In-page back and home controls create a duplicate community instance
- **Where:** `[groupId]/index.tsx:4665-4673` ("Back to home" → `/`); `app/(tabs)/(home)/index.tsx:503-505`; `[groupId]/members.tsx:165-172` (`router.replace`); `[groupId]/challenge.tsx:281, 290, 305-313`; `expo-router/build/layouts/StackClient.js:69-205`.
- **Status:** SI-1. A shared defect that native OS Back exposes.
- **Acceptance:**
  - On an Android release build, "Back to home" on community detail never shows "Loading your community…" and adds no stack entry.
  - ‹ on Members returns to the existing instance with scroll and figures intact, the same as the iOS edge swipe or Android Back.
  - "Back to community" from the challenge pops to the existing instance.
  - Only return-refresh reads are issued, never a cold-load set.
- **Fix sketch:** `router.back()` / POP_TO in place of navigate or replace.

#### MF-11 · P2 · Community hero large-text adaptations key off window width
- **Where:** `[groupId]/index.tsx:2078-2079, 2092, 2161-2167, 2798-2806, 3900-3901, 4049-4066, 5194-5196, 5719-5721, 5733-5741`.
- **Status:** SI-1 (CD-09, HOME-N6 hero part).
- **Acceptance:**
  - On an iOS release build at AX XXXL and on Android at the largest scale, the state pill never overlaps "Community goal" (it wraps below).
  - The total reads "<count>" then "of <target> <unit>" with no break inside the unit, and initials stay inside their discs.
  - At default size on 390x844, the layout matches web at 390 CSS px.
- **Fix sketch:** key the rules on `width / fontScale`, and apply the INT-15 font-scale policy.

#### MF-12 · P2 · Goal setup scroll-to-first-error does nothing on the new architecture
- **Where:** `app/goals/new.tsx:524-547` (`measureLayout(scroll.getInnerViewNode())`); `ScrollView.js:857-859`; `ReactFabricHostComponent.js:86-101`; `ReactNativeElement.js:164-177`; `app.json:9` (`newArchEnabled`).
- **Status:** SI-1.
- **Acceptance:**
  - On an iOS release staging build, clearing the name and submitting from the bottom scrolls the Goal name block to the top and focuses it.
  - On an Android release staging build, an end before the start scrolls to Ends.
  - In a dev client, no measureLayout LogBox appears.
- **Fix sketch:** pass the inner content View ref, not a node handle.

#### MF-13 · P2 · The keyboard Go key bypasses the sign-up, sign-in and reset gates and their in-flight guard
- **Where:** `app/signup.tsx:78, 80-127, 182-183, 190`; `src/authErrors.ts:24`; `app/signin.tsx:96-138, 198-199`; `app/reset-password.tsx:30-54, 75-76, 105`. The Firebase password policy is UNVERIFIED.
- **Status:** SI-1.
- **Acceptance:**
  - On an iOS release build, Sign up with a 7-character password plus Go creates no account, makes no network call, and keeps the hint visible.
  - On an Android release build, double-tapping Go with valid fields sends exactly one create request, with no "already have an account" error.
  - Reset with an empty email plus Go makes no call. After "unconfigured", Go does nothing.
  - Sign in with an empty password plus Go stays idle.
- **Fix sketch:** add `if (!canSubmit || submitting) return;` at the top of each `onSubmit`.

#### MF-14 · P2 · First-run tour v2 and "You > Help" replay are missing
- **Where:** no tour code exists in `app/` or `src/`. Target 3c84c93c (#578 6029083187) and 37b9d93b (#578 6041456822), originating from c3a071b5.
- **Status:** SI-R. Affects web and native. Touches Home (`app/(tabs)/(home)/index.tsx`, unowned), so the integrator must approve the file reservation.
- **Acceptance:**
  - On an iOS release build, the tour auto-starts once per account + community + version, only with no overlay and no unresolved attempt, and its card stays on screen at 390x640.
  - On an Android release build, Back closes the tour.
  - Replay is available from You > Help on both platforms. With Reduce Motion on, tour transitions have no travel.

#### MF-15 · P2 · Start community has no chained first-goal two-action footer
- **Where:** `app/start-community.tsx:474, 492` (lands on `/community/{groupId}`). Target 128644b3 / 917fc319 (`goal-composer-evidence/start-community-first-goal-*`). No canonical commit ports GOAL-COMPOSER-NORTHSTAR-1.
- **Status:** SI-R. Affects web and native. Pixel acceptance on the Lovable side is pending (UNVERIFIED).
- **Acceptance:**
  - On an iOS release build, after a confirmed create, the first-goal step shows both footer actions above the keyboard and the safe area.
  - A lost reply shows the unconfirmed note and a retry never creates a second community.

#### MF-16 · P3 · Signed-in redirect on Sign in / Sign up gets stuck on "Loading…" when offline
- **Where:** `app/signin.tsx:62-75, 88-94`; `app/signup.tsx:45-58, 70-76` (getDoc with no try/catch).
- **Status:** SI-1 (EAJ-17).
- **Acceptance:**
  - On an iOS release build in airplane mode, a signed-in member opening Sign in sees a plain error with Retry and a way to Home.
  - After reconnecting, Retry routes to the correct gate.

#### MF-17 · P3 · Progress and You display numerals have no font-scale cap, and their line heights are tighter than the font size
- **Where:** `src/ui/ProgressParityView.tsx:525` (58 pt / 55.1); `src/ui/YouParityView.tsx:769, 801`.
- **Status:** SI-1. Clipping is NDC.
- **Acceptance:**
  - On iOS at the largest accessibility size and on Android at scale 2.0, the totals and confirmed part neither break mid-number nor clip, and every control stays reachable.

#### MF-18 · P3 · Accessibility polish on community, privacy, Settings and device-choice surfaces
- **Where:**
  - `[groupId]/members.tsx:165-172, 260` (back target under 44 pt).
  - `[groupId]/index.tsx:2579-2597` (aria-pressed is not mapped by Pressable, `Pressable.js:177-185`), `:3862-3864` (aria-hidden on Text is ignored, `Text.js:47-52`), `:2850-2867`.
  - `app/(tabs)/community/index.tsx:384, 437-445` (chip announcement).
  - `src/ui/CommunityPrivacyPanelView.tsx:242-263` and `src/movement-camera/MoveCameraSettingsSection.tsx:64-79` (aria-describedby; the camera lane applies its own file).
  - `src/ui/DeviceChoice.tsx:86-108` (spoken name does not contain the visible text; read twice).
- **Status:** SI-1 (CD-12, CLPY-13, XMOD-5).
- **Acceptance:**
  - On iOS and Android, the Members back control is at least 44x44 pt and announced "Back to the community, link". The chosen Station is announced as selected.
  - With VoiceOver, the identity block never lands on an empty element, and tapping a chip announces "Now showing <name>." (via INT-18).
  - VoiceOver or TalkBack on a privacy or MOVE switch reads the label, state and current hint, including "Saving…".
  - With iOS Voice Control, "Tap This is my phone" activates the personal answer, and each answer's description is read once.

#### MF-19 · P3 · The invalid-marker copy tells an in-app member to "open the app"
- **Where:** `src/ui/MarkerEntryScreen.tsx:181-184`.
- **Status:** SI-1 (LINK-6). Resolve is held (HB-01).
- **Acceptance:**
  - On an iOS release build, `westayfit:///go/unknown-slug` shows copy pointing to Home or Community in the app.
  - Web copy is unchanged.

#### MF-20 · P3 · NDC: iOS `zoneInWords` keeps only the first word of a multi-word zone name
- **Where:** `app/goals/new.tsx:248-266`; `src/combinedSetup.ts:224-240`. Hermes Apple `formatToParts` splits "Eastern Time" into separate timeZoneName parts (`PlatformIntlApple.mm` at e0fc6714; copy at `/tmp/claude-0/-home-user-westayfit/716b9775-bc85-5ae2-a422-ad1d1f40066d/scratchpad/parity/hermes/PlatformIntlApple.mm`).
- **Status:** a CLPY-06 verifier note, source-derived. NDC. Android is not affected.
- **Device check:** on an iOS release staging build with zone America/New_York, the goal-setup zone line reads "Eastern Time", not "Eastern".
- **Fix sketch:** join every timeZoneName part and the literals between them, or fall back to `format()` when there is more than one.

### 4.6 Held-backend

| ID | Sev | Title | file:line | Status | Merged from |
|---|---|---|---|---|---|
| HB-01 | P1 | `/go/<slug>` cannot resolve or join on staging (wsfresolvemarker and wsfjoinviamarker blocked) | src/markerEntry.ts:70 | SI-C | EAJ-16 |
| HB-02 | P2 | Blocked roster and activity: faces, moved-today and momentum silently dropped; Members says "This account can't do that here." | app/(tabs)/(home)/community/[groupId]/members.tsx:114 | SI-1 | CD-07 |
| HB-03 | P3 | Community tab roster shows a "just now" failure whose Try again cannot succeed | app/(tabs)/community/index.tsx:145 | SI-1 | CLPY-12 |

#### HB-01 · P1 · Marker entry cannot resolve or join on staging
- **Where:** `src/markerEntry.ts:67-77`; `src/ui/MarkerEntryScreen.tsx:84-91` (anything other than not-found or invalid-argument goes to the error card, `:190-205`); `app/go/[markerSlug].tsx:7`; `../../functions-westayfit/src/index.ts:1101-1105, 1139-1140`; `/home/user/westayfit/docs/westayfit/ops/handoffs/MANUS_PROMPTS_2026-10-09.md:13-30, 80-98, 137` (invoker IAM check still on; production deploy sets invokers).
- **Status:** SI-C. P1, held-backend. Not native-specific.
- **Native divergence:** native gets "This account can't do that here." (permission-denied) or the sign-in-again text on a 401, while web gets the network sentence. P3 copy, gone once unblocked.
- **Acceptance (after the operator runs Prompt 3, `--no-invoker-iam-check`, and `invokerIamDisabled=true` is read back):**
  - On an iOS staging release build, signed out, `westayfit://go/<active-slug>` shows `wsf-marker-signed-out` "Before you move".
  - On an Android staging release build, a signed-in non-member sees "Join {community}". Joining re-resolves to `wsf-marker-ways` "How will you take part?".
  - A well-formed unknown slug shows "This code isn't active" on both platforms. A malformed slug already does today (`:73-75`).
- **Note:** returning after sign-in also needs ST-04. Optional P3 client polish (member-feature): map permission-denied and unauthenticated from resolve to a neutral "We couldn't open this code. Try again."

#### HB-02 · P2 · Blocked roster and activity: community detail drops faces, moved-today and momentum, and Members makes a false account-level claim
- **Where:** `[groupId]/index.tsx:448-491` (failures swallowed), `:3898-3945`, `:4131-4147`, `:4395-4407`, `:4418-4427`; `[groupId]/members.tsx:104-117, 196-203`; `src/callableErrors.ts:34-36, 101-105`. Whether the block returns 403 or 401 is UNVERIFIED.
- **Status:** SI-1. The client copy change can be done by member-feature without waiting.
- **Acceptance:**
  - On a staging iOS or Android build under the hold, community detail shows no faces, moved-today or momentum and no error. Members says the member list is temporarily unavailable, and never claims the account lacks permission or must sign in again.
  - After the hold lifts, the presence stack, "<n> people moved today", the hero moved-today row and up to 3 momentum rows render with web-identical values.
  - With the network off, Members shows the network sentence and Try again recovers.

#### HB-03 · P3 · Community tab roster under the staging block
- **Where:** `app/(tabs)/community/index.tsx:134-148, 469-470`; `src/ui/CommunityParityView.tsx:448-455, 484-492`; `src/ui/CommunityPresence.tsx:42-47` (initials only).
- **Status:** SI-1.
- **Acceptance:**
  - On an iOS staging build with wsfCommunityMembers blocked, the Members heading shows the memberCount with an "unavailable" state and no fabricated names, and Try again returns to the same state without hanging.
  - Once unblocked, the named roster renders with initials on iOS and Android.

### 4.7 Out-of-scope

#### OOS-01 · P3 · Legal copy shipped to profile-setup is a "pending approval" placeholder
- **Where:** `src/legalContent.ts:13-25`; rendered at `app/profile-setup.tsx:242-249`.
- **Status:** SI-1 (XMOD-7). A release-gating item, not a parity defect. Internal TestFlight and Play internal-track builds are unaffected.
- **Acceptance:** before any public store submission, "Privacy" on profile-setup in a release build shows the approved policy with its version line, and the same URL is in both store listings.

---

## 5. Lane packets

Rules for every packet:
- Base is goarrive `c704b25a` or the current integration head named by the integrator.
- Read-only on frozen camera files.
- No Firebase Dynamic Links.
- No mirroring of held Lovable deltas.
- Evidence must be stated as TEST VERIFIED (unit, e2e, emulator) or SOURCE INSPECTED. Device and binary results are claimed only when actually run, with the build id.
- Each task lists the acceptance cases from section 4 by ID; the case text there is normative.

### 5.0 Shared-file hunk ownership (to avoid conflicts)

| File | Owner per hunk |
|---|---|
| `app/_layout.tsx` | integrator: AppShell (`:15-81`: StatusBar, staging strip, SafeAreaProvider, root ErrorBoundary). Motion: `animation` and `presentation` values only on `:83-150`. The integrator merges both. |
| `app/contribute/[goalId].tsx` | state: `:612-676` (restore), `:1060-1190` (record and reconcile), `:2267-2364` (sending and unknown screens, ST-08 badges). Integrator: `:682-758` (load catch), `:1600-1703` (`screen()` wrapper, scrim/panel a11y and keyboard), `:1746-1777`, `:2819-2909` (input props only), `:3024-3032`, `:2999-3005`; BackHandler hook. Camera: `:2642-2706` (adjust) and `:2683` (review note). Motion: `sheetData` / `useSheetExit` call sites only. Land order: state → integrator → camera. |
| `app/(tabs)/(home)/community/[groupId]/index.tsx` | member-feature owns the UI. State: `:1454-1461`, `:2232-2236` (origin reads). Integrator: `:1028-1044`, `:2013-2031` (Retry), `:1418-1446` (resume hook). Integrator sets kit tokens only for `:5136-5161`. |
| `app/(tabs)/(home)/index.tsx` | integrator owns it. Member-feature: `:225-233` (MF-02). Member-feature MF-14 needs integrator sign-off. |
| `src/contributionFlow.ts` | state: `:150-205` (classification and copy for refusals). Motion: `:250-345` (reached copy), `:425-445` (animate gate). |
| `package.json`, `app.json`, `app.config.js`, `eas.json`, `public/.well-known/*`, `../../firebase.westayfit.json` | integrator only. Other lanes request dependencies through task I-0. |

### 5.1 Packet NATIVE-INTEGRATOR-1 (integrator)

**Goal:** make the native shell safe to boot and survive, make the entry and link paths reach the app, and adopt platform primitives (safe area, keyboard, Back, text scale, resume) across shared surfaces.

**Reserved files:**
- `app/_layout.tsx` (AppShell), `app/(tabs)/_layout.tsx`, `app/(tabs)/(home)/_layout.tsx`, `app/(tabs)/community/_layout.tsx` (ErrorBoundary export only)
- `app/(tabs)/(home)/index.tsx`, `app/(tabs)/activity.tsx`, `app/health.tsx`, `app/move/index.tsx` (error branch), `app/move/[goalId].tsx:171-176`, `app/station/[goalId].tsx:863`, `app/verify-email.tsx` (AppState hunk)
- `src/ui/ProgressParityView.tsx`, `src/ui/MovementPicker.tsx:67`, `src/ui/MemberTopBar.tsx`, `src/ui/MemberTabBar.tsx`, `src/ui/memberShellMetrics.ts`, `src/ui/WsfWordmark.tsx`, `src/StagingBanner.tsx`, `src/buildStamp.ts`, `src/AuthFormPrimitives.tsx`, `src/ui/kit.ts`, `src/ui/focusReturn.ts` (+ `.native.ts`), `src/ui/kioskLink.ts` (`currentOrigin`), `src/memberReads.ts` (`read()` in-flight rule), `src/auth.tsx`, `src/ui/progressFormat.ts`, `src/goalTruth.ts:71-78`
- New: `src/ui/RouteErrorFallback.tsx`, `src/crashContainment.ts`, `src/useResumeRefresh.ts`, `src/ui/announce.ts`, `src/ui/useScreenTopInset.ts`, `app/+not-found.tsx`, `app/auth/continue.tsx`
- Config: `package.json`, `app.json`, `app.config.js`, `eas.json`, `public/.well-known/*`, `../../firebase.westayfit.json` (headers only)
- Hunks in `app/contribute/[goalId].tsx` per 5.0.

**Ordered tasks:**

| # | Task | Gaps | Gate / acceptance focus |
|---|---|---|---|
| I-0 | Dependencies and config batch (one change, new dev client / EAS build; no OTA): declare `react-native-svg`; add `expo-clipboard`, `@react-native-community/datetimepicker`, `expo-system-ui`; decide on `react-native-keyboard-controller` and `@react-native-community/netinfo`; commit `apps/westayfit/eas.json` with staging and production profiles (`EXPO_PUBLIC_WSF_ENV`, `EXPO_PUBLIC_WSF_AUTH_ENABLED`, `EXPO_PUBLIC_BUILD_COMMIT`, build time, public origin) | INT-11, enables MF-01, MF-05, MF-07, INT-06, INT-34 | INT-11 cases; `expo-doctor` clean |
| I-1 | Crash containment and the Android role crash | INT-01, INT-02 | All INT-01 and INT-02 cases. Unit scan for roles; injected-throw harness behind a test flag |
| I-2 | Menu Sign out reset | INT-05 | INT-05 (a)-(d) |
| I-3 | Connectivity and resume bundle: Retry in Home, Community Home entry, MOVE and contribute; `useResumeRefresh`; memberReads fresh-on-Retry; boot connecting state; keep the warm contribute state | INT-04, INT-12, INT-26, INT-27, INT-25 | INT-04 cases 1-5; INT-12 cases 1-6; INT-26 1-4; INT-27 1-3; INT-25 1-4 |
| I-4 | Canonical public origin per environment | INT-08 | **Do not merge before ST-05, or ship together with MF-08's interim hide.** INT-08 cases 1-5 |
| I-5 | Universal Links and App Links, plus webcredentials | INT-03, INT-24 | Needs owner inputs (Appendix E). INT-03 cases 1-8; INT-24 1-3 |
| I-6 | Keyboard strategy: forms, then the MOVE sheet | INT-06, INT-07 | INT-06 1-5; INT-07 1-4 |
| I-7 | Top safe area, status-bar policy, staging strip | INT-09, INT-10 | INT-09 1-5; INT-10 1-5 |
| I-8 | Email links back to the app; verify-email foreground re-check | INT-13 | Needs the backend continue-URL env. INT-13 1-5 |
| I-9 | Shell geometry and accessibility: menu sheet, text-scale policy (publish kit numerals), focus and containment, announcements, Android Back in MOVE (uses the ST-02 predicate), root replace hygiene | INT-14, INT-15, INT-16 (policy), INT-17, INT-18, INT-19, INT-20 | The case lists for each ID |
| I-10 | Visual tokens and assets: boxShadow plus elevation tokens, Link asChild on Home cards, icon and splash | INT-21, INT-31, INT-22, INT-23 | Case lists; member-feature applies the `[groupId]` challenge-card hunk |
| I-11 | P3 batch | INT-28, INT-29, INT-30, INT-32, INT-33, INT-34, INT-35, INT-36 | Case lists |

**Proof expected:**
- vitest for the role scan, origin helper, kv-independent routing and `app.config.js` refusals
- Playwright web regression (no change on web)
- emulator runs where possible
- device checks from Appendix C, run by the owner and recorded with the build id

### 5.2 Packet NATIVE-STATE delta (state, in flight)

**Current tasks (unchanged):** NATIVE-STATE-1 / -2. Move `src/pendingContribution.ts`, `src/pendingJoinCode.ts`, `src/currentCommunity.ts` and `src/movement-camera/settingsStore.ts` (and their callers' storage calls) onto the native store. Fix the `window.location` reads in `[groupId]/index.tsx` (~1457, ~2235). Candidate `claude/wsf-native-candidate-1 @80cd713f` reportedly contains `810ef50e` and `b463cdee`. Re-verify on that head before claiming any case below.

**Additional reserved files:**
- `src/eventReturn.ts`, `src/markerEntry.ts` (storage functions only), `src/kioskSession.ts`, `src/stationSession.ts` (session store functions), `src/deviceMode.ts` (store), `src/authDestination.ts`, `src/postAuthDestination.ts`, `src/storage/*`
- `src/contributionFlow.ts:150-205`
- `app/join/[joinCode].tsx:273-281` (onJoin)
- The contribute hunks per 5.0.

**Deltas, in order:**

| # | Delta | Gaps | Acceptance focus |
|---|---|---|---|
| S-1 | Make both origin reads use `currentOrigin()`; add a lint ban on `window.location` outside the helper | ST-01 | ST-01 cases 1-4 |
| S-2 | Pending attempt: confirm persist-before-send, durable-gated copy, generation-guarded async restore, ordered writes. Export the `pendingDurable` / sending predicate for INT-19 | ST-02 | ST-02 cases 1-5 ("multiple" and "once" both) |
| S-3 | Replay rule: unauthenticated is not definitive on a replay; forced token refresh before replay; clear only after `stillCurrent()` | ST-06 | ST-06 cases 1-4 |
| S-4 | Current community: mirror hydrated before first render; MOVE resolve and Home auto-open acceptance added | ST-03 | ST-03 cases 1-5 |
| S-5 | Kiosk return plus fail-closed marker. **Must land before INT-08** | ST-05 | ST-05 cases 1-6 |
| S-6 | Post-auth family residuals: stationSession pending event and activity, deviceMode (durable), join param fallback | ST-04 | ST-04 cases 1-7 |
| S-7 | kv contract: session tier with TTL; `keysWithPrefix('wsf.')` must never touch `firebase:*` | ST-07 | ST-07 cases 1-3 |
| S-8 | known: settingsStore persistence; coordinate with CAM-02 (do not persist a "camera ON" that native cannot honour as an active control) | — | CAM-02 case 2 |
| S-9 | b84a4689 pending/unknown badges (after S-2) | ST-08 | ST-08 cases 1-3 |
| S-10 | Optional P3: "Not now — back to home" on join clears the pending code and event (EAJ-05 residual) | Appendix A | Appendix A case |

### 5.3 Packet NATIVE-MOTION delta (motion, in flight)

**Current tasks (unchanged):** (a) native Together completion motion start; (b) `useReducedMotion` initial state; (c) NEXT: native demo video via expo-video.

**Additional reserved files:**
- `src/ui/togetherMotion.ts`, `src/ui/TogetherCompletion.tsx`, `src/ui/useReducedMotion.ts`
- `src/ui/MovementDemoMedia.tsx` (+ `.web.tsx`), `src/movementDemoMedia.ts`, `src/followAlongSession.ts`, `src/followAlong.ts`, `src/ui/FollowAlongCard.tsx` (figure render)
- `src/ui/sheetMotion.ts`, `src/ui/TabSceneFade.tsx`
- `src/contributionFlow.ts:250-345, 425-445`
- `app/_layout.tsx:83-150` (animation values only)
- `app/move/index.tsx` (scrim and panel), `app/settings.tsx` (panel motion)

**Deltas, in order:**

| # | Delta | Gaps | Acceptance focus |
|---|---|---|---|
| M-1 | With (a): drop the `before != null` animate term; reached-unsignaled copy; crossing gated only on `crossedTarget === true` (held feature prep) | MO-01 | MO-01 cases 1-5 |
| M-2 | With (b): follow-along subscribes to Reduce Motion | MO-08 | MO-08 cases 1-2 |
| M-3 | Follow-along AppState background goes to `interrupt('hidden')` | MO-05 | MO-05 cases 1-4 |
| M-4 | With (c): expo-video lifecycle contract; native media URI model; drawn-figure rendering through MF-05's native SVG helper | MO-06, MO-07, MF-05 (figure) | MO-06 1-5; MO-07 1-3; MF-05 case 3 |
| M-5 | Native sheet motion (in-place scrim fade, 28 pt / 240 ms rise, 180 ms exit, continuous hand-off, grabber drag or removal) | MO-02 | MO-02 cases 1-5 |
| M-6 | Settings side-panel entry on iOS | MO-03 | MO-03 cases 1-3 |
| M-7 | Tab fade | MO-04 | MO-04 cases 1-4 |
| M-8 | Apply the INT-16 numeral policy in `TogetherCompletion.tsx:230-238` | INT-16 | INT-16 case 2 |

### 5.4 Packet NATIVE-CAMERA delta (camera, in flight)

**Current task (unchanged):** native camera and pose (`src/movement-camera/support.ts` is web-only). The frozen r14.2.1 counter files are never edited. The estimate never auto-credits.

**Additional reserved files:** `src/movement-camera/**` except `frozen/`; `src/ui/CameraRepCounter.tsx`; `src/ui/CameraSkeletonOverlay.tsx`; `src/movement-camera/MoveCameraSettingsSection.tsx`; contribute `:2642-2706`, `:2683`.

**Deltas, in order:**

| # | Delta | Gaps | Acceptance focus |
|---|---|---|---|
| C-1 | AppState release and a no-start-unless-active guard in the native controller | CAM-01 | CAM-01 cases 1-3 |
| C-2 | Settings truth: hide or disable Camera rep counter while unsupported; apply INT-31 elevation and MF-18 describedby to the knob in `MoveCameraSettingsSection.tsx` | CAM-02 | CAM-02 cases 1-2 |
| C-3 | b84a4689 readiness strip, ±1/±5, Reset to estimate, Count again, review-note wording, OS permission dialog flow | CAM-03 | CAM-03 cases 1-4 |

### 5.5 Packet NATIVE-MEMBER-1 (member-feature)

**Goal:** make Community, You, Settings, start, join and auth UI truthful and usable on native.

**Reserved files:**
- `app/(tabs)/community/**`; `app/(tabs)/(home)/community/[groupId]/**` (except the hunks in 5.0)
- `app/(tabs)/you.tsx`, `src/ui/YouParityView.tsx`
- `app/settings/privacy.tsx` (UI), `src/ui/CommunityPrivacyControls.tsx`, `src/ui/CommunityPrivacyPanelView.tsx`
- `app/start-community.tsx`, `app/join/[joinCode].tsx` (except onJoin), `app/goals/new.tsx` (except the integrator's ScrollView keyboard prop)
- `app/signin.tsx`, `app/signup.tsx`, `app/reset-password.tsx` (submit guards and offline redirect)
- `src/ui/JoinQrCode.tsx` (+ `.native.tsx`), `src/ui/qr.ts`, `src/shareGoalDisplay.ts` (+ `.native.ts`), new `src/ui/shareLink.ts` (+ `.native.ts`), new `src/joinInput.ts`
- `src/ui/DateTimeField.tsx` (+ `.native.tsx`), `src/ui/DeviceChoice.tsx`, `src/ui/MarkerEntryScreen.tsx` (copy)
- `app/(tabs)/(home)/index.tsx:225-233`

**Ordered tasks:**

| # | Task | Gaps | Dependencies | Acceptance focus |
|---|---|---|---|---|
| F-1 | You sign-out race (cleanup bump plus render guard) | MF-03 | none | MF-03 cases 1-3 |
| F-2 | Paste an invite URL into Home's join field | MF-02 | none | MF-02 cases 1-4 |
| F-3 | Native copy and share helper; route all six call sites | MF-01 | I-0 (expo-clipboard), I-4 (origin), S-1 | MF-01 cases 1-5 |
| F-4 | Interim native hide of "Open kiosk" (if S-5 has not landed); kiosk sign-out guard; relative "Open …" buttons out of URL branches; native-true copy | MF-08, MF-06 | ships with I-4 | MF-08 1-3; MF-06 1-3 |
| F-5 | Native SVG renderer (QR plus a shared helper for motion's figure) | MF-05 | I-0 (react-native-svg) | MF-05 cases 1-4 |
| F-6 | Privacy refusal hardening (now); severity decision after the device check | MF-04 | Appendix C check | MF-04 cases 1-3 |
| F-7 | Native date and time picker | MF-07 | I-0 (datetimepicker) | MF-07 cases 1-5 |
| F-8 | Manage sheet keyboard, inset and scrim; duplicate-instance back; hero text scaling; measureLayout; Go-key guards; Community tab push (INT-20 hunks `community/index.tsx:560, 586`); challenge card asChild (INT-22 hunk) | MF-09, MF-10, MF-11, MF-12, MF-13, INT-20, INT-22 | I-6 wrapper; I-9 text-scale policy | Each ID's cases |
| F-9 | HB-02 client copy: no false "This account can't do that here." under a transport block | HB-02 | none | HB-02 case 1 |
| F-10 | Canonical target deltas, **only if the integrator confirms they are in this sprint** (they change web too): first-run tour and replay; start-community first-goal footer | MF-14, MF-15 | Integrator sign-off on Home | MF-14 1-3; MF-15 1-2 |
| F-11 | P3 batch | MF-16, MF-17, MF-18, MF-19, MF-20 (after its device check) | none | Case lists |

Profile photos native adapter (J17): not in this packet until the owner schedules it. Permitted preparation is in section 3.

---

## 6. Member-loop readiness (native, snapshot c704b25a)

Status values:
- **BLOCKED**: at least one open P0 or P1.
- **DEGRADED**: P2s only.
- **SOURCE-CLEAR**: no open finding; a device pass is still required.

No step is device-ready.

| # | Loop step | Native status | Blocking (P0/P1) | Degrading (P2) | Notes |
|---|---|---|---|---|---|
| 1 | Open the app (cold launch to shell) | **BLOCKED** | INT-01; ST-01 (with INT-01 this becomes a launch crash loop for single-community members) | INT-27, INT-11, INT-09, INT-10, INT-23 | INT-34 (P3) |
| 2 | Sign in, sign up, verify, profile | **BLOCKED** | INT-06 | INT-09, INT-13, INT-20, INT-24, MF-13 | MF-16 (P3) |
| 3 | Join via the approved path (invite link or QR, code, marker) | **BLOCKED** | INT-03, MF-02, ST-04 (event join), HB-01 (marker, held), MF-01 (Champion cannot pass an invite on); known: pendingJoinCode (state) | INT-08, MF-05, MF-06 | Joining on the web, then signing in on native, works; that is the only route |
| 4 | Arrive in the intended community | **BLOCKED** | ST-01 (P0), ST-03, ST-04; known: pendingJoinCode | INT-22, INT-20 | Single-community members land correctly in source once ST-01 is fixed |
| 5 | Understand the goal and current Living WE | **BLOCKED** | INT-04 (offline cold start) | INT-12, INT-21, INT-15, MF-11, INT-18, HB-02, MF-14 | Live presence and momentum held on staging |
| 6 | MOVE (resolver, follow-along, camera) | **BLOCKED** for multi-community members | ST-03 (MOVE bounces to Home) | MO-02, MO-05, MO-06, INT-17, INT-19, CAM-01, CAM-02 | known: no native camera counter yet, so manual count only. Single-community path is SOURCE-CLEAR apart from the P2s |
| 7 | Review and adjust | **DEGRADED** | none | INT-07, INT-19, INT-16, CAM-03 | Steppers and chips allow entry with no keyboard |
| 8 | Intentionally record | **BLOCKED** | ST-02 (P0, data truth), ST-06 | INT-25, INT-26 | Idempotency holds only while the attempt survives in memory |
| 9 | Correct confirmed, pending or refused outcome | **BLOCKED** | ST-02, ST-06 | INT-18 (iOS hears nothing), MO-01, ST-08; known: Together motion web-only | Crossing celebration held |
| 10 | Return to Home and Progress | **BLOCKED** | INT-02 (Android Progress crash on a partial list), INT-05 (iOS menu sign-out dead end) | INT-20, INT-12 | none |
| 11 | Close and reopen with state preserved | **BLOCKED** | ST-02, ST-03, ST-04, INT-01 | INT-12, INT-27, ST-07 | known: settingsStore persistence |

| Member space / requirement | Native status | Blocking | Degrading |
|---|---|---|---|
| Home | BLOCKED | ST-01, INT-04, ST-03 | INT-12, INT-21, INT-22, MF-14 |
| Community | BLOCKED | ST-01, ST-03, MF-01 | INT-08, MF-05, MF-06, MF-09, MF-10, MF-11, HB-02 (HB-03 P3) |
| Progress | BLOCKED | INT-02, INT-05 | INT-12, INT-20 (MF-17 P3) |
| You | BLOCKED | MF-03, ST-03 | MF-14 |
| Settings (utility) | DEGRADED | none | MO-03, CAM-02, MF-04 (NDC), INT-09, INT-14 |
| Safe areas | DEGRADED | none | INT-09, INT-10, INT-14, MF-09 |
| Keyboard | BLOCKED | INT-06 | INT-07, MF-09 |
| Android Back | DEGRADED | none | INT-19, INT-14, INT-20, MF-10 (INT-28 P3) |
| Text scaling | DEGRADED | none | INT-15, INT-16, MF-11 (MF-17 P3) |
| OS permission dialogs | Not testable yet | camera lane known (no native camera); photos held (no photo UI) | CAM-01, CAM-03 |
| Reduced motion | DEGRADED | none | known: useReducedMotion initial state; MO-02, MO-04 (MO-08 P3) |

---

## 7. Appendix

### A. Refuted findings (dropped; do not re-raise)

| ID | Claim | Refutation | Residual |
|---|---|---|---|
| CLPY-06 | If Hermes on iOS returns `formatToParts` as one literal part, every goal date label is wrong | The shipped engine (`node_modules/react-native/sdks/.hermesversion` = hermes-2025-07-07-RNv0.81.0-e0fc67142ec0763c6b6153ca2bf96df815539782; Intl on, `build-apple-framework.sh:98`) has a real Apple `DateTimeFormatApple::formatToParts` (`PlatformIntlApple.mm:1972-2010`, typed via `returnTypeOfDate` at `:1944-1968`). `ymd()` pins `en-US` (`src/ui/dates.ts:44`), and every caller passes only `timeZone`. Android uses ICU attributed parts (`DateTimeFormat.java:570-596`). | Device smoke check (Appendix C). Spin-off MF-20 (`zoneInWords`) |
| EAJ-05 | The pending join is not tied to an account or cleared, so a port carries A's invite to B | On the snapshot, native stores nothing (`src/pendingJoinCode.ts:34-36, 48-50, 62`; no sessionStorage polyfill), so nothing can carry over. The port on the candidate (`810ef50e`, `b463cdee`) adds an owner uid for signed-in stashes, dropping on another account's terminal hop, an auth-change watch and a 2 h native TTL. A signed-out stash surviving sign-out is deliberate ("wrong account, sign in as the right one"). Join stays an explicit tap. | Optional state task S-10: on an iOS or Android release build, open `westayfit://join/<code>` signed out, tap "Not now — back to home", then sign in within 2 h; the app lands on Home. Whether signed-out stashes clear on verify-email or profile-setup sign-out is an owner decision |

### B. Refuted or corrected sub-claims (do not re-raise)

- **Hosting ignore `"**/.*"` drops `.well-known/`** (SRN-01, EAJ-02, EAJ-15, XMOD-3 verifier, critic note): REFUTED (TV). The firebase-tools 13.35.1 and 15.34.0 `listFiles` (glob 10.5.0 and 7.2.3, `dot:true`) kept both files and dropped only basename dotfiles. `expo export` copies dot directories (`@expo/cli/build/src/utils/dir.js:98-109`). Test scratch is at `/tmp/claude-0/-home-user-westayfit/716b9775-bc85-5ae2-a422-ad1d1f40066d/scratchpad/parity/link1-verify`. The content-type of the extensionless AASA file is still NDC.
- **The iOS number pad has no Done key** (MR-01, SRN-02): REFUTED. Fabric adds a Done toolbar for number-pad plus `returnKeyType done` (`RCTTextInputComponentView.mm:635-695`).
- **The keyboard can't be dismissed without leaving MOVE** (SRN-02): REFUTED. `keyboardShouldPersistTaps="handled"` blurs on a body tap (`ScrollView.js:1363-1376, 1434-1451`).
- **Scrim tap discarding the count is a native gap** (MR-01): REFUTED as native-only. It is the same design on web (`[goalId].tsx:1608-1614`); an owner decision (P3).
- **The verify-email poll keeps running in the background on Android** (EAJ-03): REFUTED. RN pauses timers (`JavaTimerManager.kt:67-87, 275-281`; `RCTTiming.mm:180-194`).
- **The `[groupId]/index.tsx:2235` read crashes native today** (CD-00 and others): CORRECTED. It is latent (the shareRoute short-circuit) and becomes live once a native share route exists.
- **Kiosk, station and combined "Copy didn't work" appears in release** (CD-02): CORRECTED. Dev builds only; release shows "isn't ready yet. Reload the page" because the URLs are null.
- **"Copy failed — use the QR code" in release** (EAJ-07): CORRECTED. It is unreachable in release (ST-01 crash, then null URLs).
- **INT-08 acceptance case 5 (display link) passes on an origin fix alone** (CD-01): CORRECTED. It also needs MF-01, because shareRoute is "unavailable".
- **EAJ-01 kiosk path reachable from shipped release UI**: CORRECTED. Not today; dev builds and the custom scheme only (see ST-05 re-raise rule).
- **CONN-CRASH-1 crash loop via persisted navigation state**: CORRECTED. It loops via Home auto-replacing to the only community.
- **CLPY-03 You and Home are dead ends; Android is trapped**: CORRECTED. You and Home offer Sign in; Android Back escapes.
- **CONN-OFFLINE-2 Home never recovers**: CORRECTED. A tab switch recovers; MOVE and contribute exits re-read.
- **CLPY-02 Android Back returns to You after sign-out**: weak/UNVERIFIED (expo-router TabRouter replace drops the history, `TabRouter.js:12-34`).
- **CONN-RECORD-3 "counted twice" for every goal**: CORRECTED. Only for "multiple" (or unset) repeatPolicy; "once" refuses.
- **EAJ-09 scope (sign-in, profile, start-community, goal setup equally covered)**: CORRECTED. Sign up's password is fully covered; the others partly or at large text only.
- **MO-05 / LIFE-2 framed as data truth**: CORRECTED. No credit derives from elapsed time; the count is always typed.
- **CLPY-05 limited to chips, You and privacy**: EXTENDED. It also breaks MOVE resolve and Home auto-open (now in ST-03).

### C. Needs-device-check queue (owner-run; record the build id)

1. **MF-04:** HTTP status of wsfSetCommunityVisibility on staging with a member ID token (Proxyman or curl). 401 refutes; a body-less 403 or 404 confirms.
2. **HB-01 / HB-02:** status code (403 vs 401) of the blocked marker and roster callables. This decides which misleading sentence natives see.
3. **INT-09:** on an iPhone 15 Pro release build, whether a tap on the page-mode contribute "Back" (top right, y < 54) registers.
4. **INT-06 / INT-07:** on an Android 15 release build at 1080x2400 (edge-to-edge), whether the IME covers Sign up's Password and the MOVE Review. On iOS at AX3, whether the focused count input auto-scrolls into view.
5. **INT-17:** on iOS with VoiceOver, whether the tab behind the OverFullScreen MOVE sheet is reachable, and whether `aria-modal` on View maps to anything.
6. **INT-18:** whether TalkBack announces newly mounted live regions exactly once.
7. **INT-22:** VoiceOver label and layout of the non-asChild Home community card.
8. **MF-05:** confirm the blank SVG QR and figure on iOS and Android.
9. **INT-12:** how long iOS and Android keep the process suspended (staleness only shows while it survives).
10. **INT-27:** airplane-mode vs stalled-network auth init latency on iOS and Android.
11. **INT-03:** after deploy, `curl -sI https://<host>/.well-known/apple-app-site-association` (200, no redirect, application/json); `adb shell pm get-app-links com.westayfit.app`; long-press a `/join` link in iOS Notes to see "Open in We Stay Fit".
12. **INT-13:** the deployed `WSF_APP_URL` value and where Continue lands on iOS Mail.
13. **ST-05:** `xcrun simctl openurl booted westayfit://kiosk/<goalId>`, then sign in, to confirm the landing route on the snapshot (expected: Home).
14. **MO-02:** Android visual of the one-goal MOVE hand-off.
15. **CLPY-06 residual:** on an iOS release build, `new Intl.DateTimeFormat('en-US',{year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(2025,6,14))` returns month, literal, day, literal, year (07, /, 14, /, 2025). A Progress row for a goal ending in five days reads "Ends <Wkd>, <Mon> <d>".
16. **MF-20:** iOS goal-setup zone line for America/New_York reads "Eastern Time".
17. **INT-36:** Hermes number formatting for English language with region Germany.
18. **`src/activityGuides.ts:85-86`:** hermesc compiles the `\p{L}`/u regex (scratch `re.js`), but its runtime output on Hermes is UNVERIFIED. Check a guide lookup for an accented movement name on device.
19. **`src/ui/OptionRow.tsx:47-56, 90`:** whether VoiceOver and TalkBack announce the radio checked state.
20. **J11:** on an Android release build at 390x640, the confirmed receipt's Done and Record more never overlap (no gap filed; source suggests mirrored).

### D. Coverage notes and what was not reviewed

- **Routes:** every member-loop route under `app/**` was opened by at least one reviewer: the tabs; community `[groupId]` index, challenge and members; settings and settings/privacy; move index and `[goalId]`; contribute `[goalId]`; signin, signup, verify-email, reset-password and profile-setup; join `[joinCode]`; go `[markerSlug]`; start-community; goals/new; health. `combined`, `display` and `queue` were not opened (outside the loop); `kiosk`, `station` and `event` only in part.
- **Not reachable in the native member loop:** `src/ui/shellNext/*` (except `shellNextGate`), `src/wsfTestBootstrap.ts`, `src/profileConstants.ts`. `src/relativeTime.ts` is used only by display.
- **Not present in deps or code:** notifications, any photo picker or profile-photo UI (J17 is backend only), haptics, native share or clipboard modules.
- **Opened only by the late sweep (XMOD) or not in depth:** `src/labels.ts`, `src/communityMomentum.ts`, `src/movementSelection.ts`, `src/eventActivity.ts` (parts), `src/activityGuides.ts` (Hermes runtime UNVERIFIED), and `src/ui/OptionRow.tsx` accessibility. `src/concurrency.ts` was read: pure and platform-neutral.
- **Left to lanes:**
  - camera internals (`src/movement-camera/{controller,engine,orchestrator,tasksVision,visual,figure,synthetic}.ts`, `src/ui/CameraSkeletonOverlay.tsx`) to the camera lane
  - `src/ui/togetherMotion.ts` from line 200 onward to the motion lane
- **Backend:** read only via the cited `functions-westayfit/src/index.ts` lines and the ops handoff doc. No backend behaviour was exercised.
- **Not done:** no device runs, no binary builds, no camera accuracy assessment, and no fresh Lovable pixel comparison for this document. Lovable facts come from the reconciler's read of 301699d6 and the #578 feed (pages 1-3). Scratch for this work is in `/tmp/claude-0/-home-user-westayfit/716b9775-bc85-5ae2-a422-ad1d1f40066d/scratchpad/parity/`.
- **Reconciler items still unresolved:** "frozen J02 refs" (6042903372 / 6043077948); "export bdd69358" (d9d209f4); the goal-composer pixel verdict.
- **Reviewer conflicts resolved:**
  - Hosting ignore: the tested result wins over XMOD-3.
  - verify-email auto-check: the frozen auth reference asks for it, so it is in scope (INT-13); LIFE-5's "new feature" framing is superseded.
  - Follow-along pause: motion lane (critic guidance), not integrator (MR-07).
  - Sheet hand-off: motion lane (MR-05), with `app/_layout.tsx` animation edits coordinated with the integrator (SRN-07).

### E. Owner decisions needed

1. A canonical, stable web host per environment (staging must not be the 7-day preview channel), the Apple Team ID and the Play App Signing SHA-256 (INT-03, INT-08, INT-13, INT-24).
2. Crash reporter adoption and its PII scrubber (INT-01).
3. Whether a Champion inviting from the phone counts as part of the join path (would raise INT-08 to P1).
4. Whether offline recording into pending is required (would raise INT-25 to P1).
5. Whether event turns (`/queue`) are in native scope this sprint (would raise MO-05 to P1).
6. Whether native defaults the device mode to "personal" instead of asking (ST-04).
7. Whether a scrim tap with the keyboard open should only dismiss the keyboard (INT-07 P3; also changes web).
8. The production value of `EXPO_PUBLIC_WSF_AUTH_ENABLED` at launch (INT-11 keeps the launch switch).
9. UNVERIFIED approvals:
   - the destination card naming only the kind vs Lovable's "Joining {Community} · {Goal}"
   - the per-account pinned community + goal (J14)
   - native adoption of the AI "What do you hope to get?" card (J5)
10. App display-name casing (INT-23).
11. Whether the canonical target deltas (MF-14 tour, MF-15 first-goal footer, CAM-03, ST-08, MO-01 copy) ship in this sprint; they change web too.
12. Whether to keep MF-03 at P1 or treat "no account data on a signed-out screen" as an absolute P0 rule.

### F. Source finding → gap traceability (all 126)

- **SRN:**
  - 01→INT-03 · 02→INT-06, INT-07 · 03→INT-14 · 04→INT-09 · 05→INT-10 · 06→INT-15 · 07→MO-02 · 08→MO-03
  - 09→MO-02 · 10→MO-04 · 11→INT-17 · 12→INT-32, INT-31, INT-33 · 13→INT-29 · 14→INT-28 · 15→INT-30 · 16→INT-23
- **VIS:**
  - 01→INT-09 · 02→INT-10 · 03→INT-21 · 04→MF-05 · 05→INT-23 · 06→INT-14
  - 07→INT-15 · 08→INT-31 · 09→INT-34 · 10→MO-02, MO-04 · 11→INT-35 · 12→MF-07
- **HOME:**
  - N1→MF-02, INT-03 · N2→INT-09, INT-10 · N3→INT-14 · N4→INT-22 · N5→INT-06 · N6→INT-15, MF-11
  - N7→MF-01 · N8→INT-12 · N9→INT-11 · N10→INT-21 · N11→MO-04 · N12→INT-18
- **CD:**
  - 00→ST-01 · 01→INT-08, MF-06 · 02→MF-01 · 03→MF-05 · 04→MF-08 · 05→MF-09 · 06→MF-07
  - 07→HB-02 · 08→MF-10 · 09→MF-11 · 10→INT-21 · 11→INT-22 · 12→MF-18
- **CLPY:**
  - 01→INT-02 · 02→MF-03 · 03→INT-05 · 04→MF-04 · 05→ST-03 · 06→refuted (Appendix A), MF-20 · 07→MO-03 · 08→INT-10
  - 09→INT-20 · 10→CAM-02 · 11→INT-09, INT-28 · 12→HB-03 · 13→MF-18, INT-18 · 14→MO-04 · 15→MF-17
- **MR:**
  - 01→INT-07 · 02→INT-17, INT-18 · 03→INT-17 · 04→INT-19 · 05→MO-02 · 06→INT-09 · 07→MO-05
  - 08→INT-16 · 09→INT-12 · 10→INT-21 · 11→INT-08, MF-05 · 12→MO-07 · 13→ST-02 · 14→INT-36
- **EAJ:**
  - 01→ST-05 · 02→INT-03 · 03→INT-13 · 04→ST-04 · 05→refuted (Appendix A) · 06→INT-08 · 07→MF-01 · 08→MF-05 · 09→INT-06
  - 10→INT-09 · 11→INT-11 · 12→MF-12 · 13→MF-07 · 14→MF-13 · 15→INT-24 · 16→HB-01 · 17→MF-16 · 18→INT-20
- **LIFE:** 1→INT-12 · 2→MO-05 · 3→MO-06 · 4→CAM-01 · 5→INT-13 · 6→MO-08
- **CONN:** CRASH-1→INT-01 · OFFLINE-2→INT-04 · RECORD-3→ST-02, INT-19 · RECORD-4→ST-06 · RECORD-5→INT-25 · READS-6→INT-26 · BOOT-7→INT-27
- **XMOD:** 1→ST-04 · 2→ST-04 · 3→INT-03 · 4→ST-07 · 5→MF-18 · 6→INT-33 · 7→OOS-01
- **LINK:** 1→INT-03 · 2→INT-08 · 3→MF-01, MF-05 · 4→ST-04 · 5→INT-13 · 6→MF-19
- **Reconciler target deltas (SI-R):** MO-01, CAM-03, ST-08, MF-14, MF-15