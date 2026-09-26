# PERF-MOBILE-1 checkpoint 1: one per-account read layer

- **Packet:** Director #365 `5840360454`; L0 #489 `5840568948`; W9 ACK #489 `5840966421`.
- **Worker:** W9. PR #494.
- **Base:** development `0b460ce3f2f0766406100fef14d9a444c8cad43a`.
- **Product SHA:** `5633057a`.
  - The product code is identical to `398c70d1`.
  - `5633057a` adds only two spec-setup changes (see *Changed-dependency set*).
- **Instrument:** W7's `sprint-w7-perf-mobile-baseline.spec.ts`, blob `245a3357` from `dd7828b9`.
  - It was run unchanged, on the same host and emulators, with the same fixture and viewports, once per build.
  - The raw output is in `RAW-w7-instrument-*.log`.

**Nothing here is accepted.** Everything is Chromium on the local emulators (`demo-wsf-local`) with synthetic data. These are local milliseconds, not a device-speed claim; the counts, stages, loading states and mounts are what transfer.

## Pass criteria (Director `5840360454`), as measured

| Criterion | Status | Evidence |
|---|---|---|
| Same Check 41B journey and instrument on base and candidate | done | Table below; raw logs. |
| Community keeps 0 blocking stages and no skeleton | **met** | Pass-1 Home → Community: 0 stages, no loading, on both. |
| Progress and You: no full-page replacement when known truth exists; useful before background reads; warm switches stay at 0 calls | **met** | See below. |
| MOVE: useful known content before reads settle; no duplicate identical `wsfListGoals`; one mounted tab context; Close and return preserve state, focus and history | **met** | See below. |
| Cold one-community Home: no duplicate identical member or goals calls | **met** | 9 → 7 calls, no identical pair (focused spec and instrument). |
| Cold Home: loading-frame sequence materially reduced, without fake data | **NOT MET** | See *Limits*, item 1. |
| Two-account same-document isolation, plus refused-membership eviction | **met** | See below. |
| Focused fail-before / pass-after only | done | See *Focused spec*. |
| 390×640 / 390×844 transition timelines for Progress, You and MOVE | done | See *Timelines*. |

Detail for the met rows:
- **Progress and You:**
  - First visit: Progress 74–80 → **17 ms**, You 91–103 → **12 ms**.
  - Callables 3 → **0**, stages 3 → **0**, loading painted → **none**.
  - With every read held 1.5 s, content appears in under 100 ms (focused spec).
  - Warm pass-2 switches stay at 0 calls.
- **MOVE:**
  - Open: 111–121 → **44–61 ms**, "working" → **none**, `wsfListGoals` 2 → **0**.
  - The resolver is no longer re-mounted; only the flow's panel mounts.
  - With reads held 1.5 s, the step shows in about 95 ms.
  - Close returns to the same Home instance (focused spec).
  - The existing focus and exit specs pass (see *Changed-dependency set*).
- **Isolation and eviction:** the focused spec records no name of account A painted for B in the same document. A refused community is forgotten and MOVE does not open on it.

## Raw before / after (W7 instrument; base `0b460ce3` → candidate `5633057a`)

| Transition | Useful ms (base → cand) | Settled ms | Callables base | Callables cand | Stages | Loading painted base → cand | Mounts cand | Blocking |
|---|---|---|---|---|---|---|---|---|
| W 390x844 pass1 Home->Community | 21 → **22** | 131 → 130 | wsfGoalRecentAdditions 1, wsfListGoals 1, wsfMyCommunities 1 | wsfGoalRecentAdditions 1, wsfListGoals 1, wsfMyCommunities 1 | 0 → 0 | none → **none** | wsf-community-index +1 | False → **False** |
| W 390x844 pass1 Community->Progress | 80 → **17** | 80 → 17 | wsfListGoals 1, wsfMyCommunities 1, wsfMyContribution 1 | 0 | 3 → 0 | wsf-activity-loading → **none** | wsf-activity +1 | True → **False** |
| W 390x844 pass1 Progress->You | 103 → **12** | 103 → 12 | wsfListGoals 1, wsfMyCommunities 1, wsfMyContribution 1 | 0 | 3 → 0 | wsf-you-loading → **none** | wsf-you +1 | True → **False** |
| W 390x844 pass1 You->Home | 13 → **14** | 106 → 99 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListGoals 1, wsfMyContribution 1 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListGoals 1, wsfMyContribution 1 | 0 → 0 | none → **none** | none | False → **False** |
| W 390x844 pass2 Home->Community | 6 → **7** | 6 → 7 | 0 | 0 | 0 → 0 | none → **none** | none | False → **False** |
| W 390x844 pass2 Community->Progress | 5 → **5** | 5 → 5 | 0 | 0 | 0 → 0 | none → **none** | none | False → **False** |
| W 390x844 pass2 Progress->You | 6 → **5** | 6 → 5 | 0 | 0 | 0 → 0 | none → **none** | none | False → **False** |
| W 390x844 pass2 You->Home | 6 → **7** | 96 → 99 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListGoals 1, wsfMyContribution 1 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListGoals 1, wsfMyContribution 1 | 0 → 0 | none → **none** | none | False → **False** |
| W 390x844 MOVE open (from Home) | 121 → **61** | 121 → 90 | wsfGoalPulse 1, wsfListGoals 2, wsfMyCommunities 1, wsfMyContribution 1 | wsfGoalPulse 1, wsfMyCommunities 1, wsfMyContribution 1 | 3 → 1 | wsf-move-working → **none** | wsf-contribute-sheet-panel +1 | True → **False** |
| W 390x844 MOVE Close | 185 → **186** | 258 → 279 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 2, wsfListGoals 1, wsfMyContribution 1 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 2, wsfListGoals 1, wsfMyContribution 1 | 1 → 1 | none → **none** | none | False → **False** |
| W 390x844 MOVE open again (from Home) | 138 → **44** | 138 → 50 | wsfGoalPulse 1, wsfListGoals 2, wsfMyCommunities 1, wsfMyContribution 1 | wsfGoalPulse 1, wsfMyContribution 1 | 3 → 1 | wsf-move-working → **none** | wsf-contribute-sheet-panel +1 | True → **False** |
| W 390x844 submit -> confirmed receipt | 46 → **49** | 46 → 49 | wsfContribute 1 | wsfContribute 1 | 1 → 1 | none → **none** | none | False → **False** |
| W 390x844 receipt exit ("Back to community") -> return | 26 → **29** | 94 → 123 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListGoals 1, wsfMyContribution 1 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListGoals 1, wsfMyContribution 1 | 0 → 0 | none → **none** | none | False → **False** |
| W 390x640 pass1 Home->Community | 21 → **24** | 111 → 114 | wsfGoalRecentAdditions 1, wsfListGoals 1, wsfMyCommunities 1 | wsfGoalRecentAdditions 1, wsfListGoals 1, wsfMyCommunities 1 | 0 → 0 | none → **none** | wsf-community-index +1 | False → **False** |
| W 390x640 pass1 Community->Progress | 74 → **17** | 74 → 17 | wsfListGoals 1, wsfMyCommunities 1, wsfMyContribution 1 | 0 | 3 → 0 | wsf-activity-loading → **none** | wsf-activity +1 | True → **False** |
| W 390x640 pass1 Progress->You | 91 → **12** | 91 → 12 | wsfListGoals 1, wsfMyCommunities 1, wsfMyContribution 1 | 0 | 3 → 0 | wsf-you-loading → **none** | wsf-you +1 | True → **False** |
| W 390x640 pass1 You->Home | 13 → **13** | 94 → 115 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListGoals 1, wsfMyContribution 1 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListGoals 1, wsfMyContribution 1 | 0 → 0 | none → **none** | none | False → **False** |
| W 390x640 pass2 Home->Community | 5 → **6** | 5 → 6 | 0 | 0 | 0 → 0 | none → **none** | none | False → **False** |
| W 390x640 pass2 Community->Progress | 5 → **5** | 5 → 5 | 0 | 0 | 0 → 0 | none → **none** | none | False → **False** |
| W 390x640 pass2 Progress->You | 6 → **6** | 6 → 6 | 0 | 0 | 0 → 0 | none → **none** | none | False → **False** |
| W 390x640 pass2 You->Home | 7 → **6** | 104 → 88 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListGoals 1, wsfMyContribution 1 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListGoals 1, wsfMyContribution 1 | 0 → 0 | none → **none** | none | False → **False** |
| W 390x640 MOVE open (from Home) | 111 → **44** | 111 → 70 | wsfGoalPulse 1, wsfListGoals 2, wsfMyCommunities 1, wsfMyContribution 1 | wsfGoalPulse 1, wsfMyCommunities 1, wsfMyContribution 1 | 3 → 1 | wsf-move-working → **none** | wsf-contribute-sheet-panel +1 | True → **False** |
| W 390x640 MOVE Close | 186 → **186** | 254 → 262 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 2, wsfListGoals 1, wsfMyContribution 1 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 2, wsfListGoals 1, wsfMyContribution 1 | 1 → 1 | none → **none** | none | False → **False** |
| W 390x640 MOVE open again (from Home) | 103 → **44** | 103 → 51 | wsfGoalPulse 1, wsfListGoals 2, wsfMyCommunities 1, wsfMyContribution 1 | wsfGoalPulse 1, wsfMyContribution 1 | 3 → 1 | wsf-move-working → **none** | wsf-contribute-sheet-panel +1 | True → **False** |
| W 390x640 submit -> confirmed receipt | 56 → **48** | 56 → 48 | wsfContribute 1 | wsfContribute 1 | 1 → 1 | none → **none** | none | False → **False** |
| W 390x640 receipt exit ("Back to community") -> return | 29 → **29** | 102 → 111 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListGoals 1, wsfMyContribution 1 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListGoals 1, wsfMyContribution 1 | 0 → 0 | none → **none** | none | False → **False** |
| C n=1 cold Home #1 | 482 → **383** | – | 9: wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListChallenge 1, wsfListGoals 2, wsfMyCommunities 2, wsfMyContribution 1 | 7: wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListChallenge 1, wsfListGoals 1, wsfMyCommunities 1, wsfMyContribution 1 | 5 → 4 | wsf-community-loading, wsf-home-loading, wsf-home-my-loading, wsf-home-opening-community → wsf-community-loading, wsf-home-loading, wsf-home-my-loading, wsf-home-opening-community | – | – |
| C n=1 cold Home #2 | 419 → **419** | – | 9: wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListChallenge 1, wsfListGoals 2, wsfMyCommunities 2, wsfMyContribution 1 | 7: wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListChallenge 1, wsfListGoals 1, wsfMyCommunities 1, wsfMyContribution 1 | 5 → 3 | wsf-community-loading, wsf-home-loading, wsf-home-my-loading, wsf-home-opening-community → wsf-community-loading, wsf-home-loading, wsf-home-my-loading, wsf-home-opening-community | – | – |
| C n=1 cold Community tab #1 | 331 → **333** | – | 3: wsfGoalRecentAdditions 1, wsfListGoals 1, wsfMyCommunities 1 | 3: wsfGoalRecentAdditions 1, wsfListGoals 1, wsfMyCommunities 1 | 3 → 3 | wsf-community-index-loading → wsf-community-index-loading | – | – |
| C n=1 cold Community tab #2 | 329 → **322** | – | 3: wsfGoalRecentAdditions 1, wsfListGoals 1, wsfMyCommunities 1 | 3: wsfGoalRecentAdditions 1, wsfListGoals 1, wsfMyCommunities 1 | 3 → 3 | wsf-community-index-loading → wsf-community-index-loading | – | – |
| C n=3 cold Home #1 | 302 → **281** | – | 4: wsfListGoals 3, wsfMyCommunities 1 | 4: wsfListGoals 3, wsfMyCommunities 1 | 1 → 1 | wsf-home-loading, wsf-home-my-loading → wsf-home-loading, wsf-home-my-loading | – | – |
| C n=3 cold Home #2 | 262 → **302** | – | 4: wsfListGoals 3, wsfMyCommunities 1 | 4: wsfListGoals 3, wsfMyCommunities 1 | 1 → 1 | wsf-home-loading, wsf-home-my-loading → wsf-home-loading, wsf-home-my-loading | – | – |
| C n=3 cold Community tab #1 | 290 → **292** | – | 4: wsfListGoals 3, wsfMyCommunities 1 | 4: wsfListGoals 3, wsfMyCommunities 1 | 2 → 2 | wsf-community-index-loading → wsf-community-index-loading | – | – |
| C n=3 cold Community tab #2 | 335 → **356** | – | 4: wsfListGoals 3, wsfMyCommunities 1 | 4: wsfListGoals 3, wsfMyCommunities 1 | 2 → 2 | wsf-community-index-loading → wsf-community-index-loading | – | – |

Unchanged by design:
- **Home return: 5 background calls.** A member's return re-reads Home's figures fresh (RETURN-CONTINUITY). The pulse, members and activity are not facts this layer records, and goals and own parts on a return are read fresh on purpose.
- **Receipt: `wsfContribute`.** The write is the server's.
- **Label check:** MOVE's open still reads `wsfMyCommunities` once when the account's answer is older than the 10 s same-load window.

## Focused spec: `apps/westayfit/tests-e2e/sprint-w9-perf-mobile-1.spec.ts`

Every callable answer is held 1.5 s at the network boundary, so "useful before the reads return" is unmistakable.

- **Fail-before on `0b460ce3`: 3 / 5 red.**
  - Progress and You: skeleton, with content at about 4.9 s.
  - MOVE: "working", with its step at about 4.9 s.
  - Cold Home: identical `wsfListGoals` twice.
  - Isolation and refusal pass on the base and are kept as preservation.
- **Pass-after on `218eb1df` / `5633057a`: 5 / 5 on the third run.**
  - Run 1: 1 red. A spec defect: the address was read during Close's 180 ms exit.
  - Run 2: 1 red. A spec defect: the previous document's social reads were counted.
  - A product defect found by the same spec was fixed in `398c70d1`: opening on the record started the live pulse poll beside the flow's own fresh pulse, which made two identical `wsfGoalPulse` calls.
- **Unit tests:** `apps/westayfit/tests/memberReads.test.ts`, 11 tests. They cover:
  - in-flight and same-load sharing, and the fresh read otherwise;
  - account change and sign-out clearing;
  - a late answer for one account never kept for the next;
  - refusal eviction;
  - a receipt updating only what it confirms.
- **Other checks:** vitest 902 / 902; tsc clean.

## Changed-dependency set (no broad regression restart)

- **Scope:** every existing spec that drives Progress, You, MOVE, the contribution flow or Home's list: 28 files, 188 tests, on `218eb1df`.
- **First run: 186 / 188.** The two red were preconditions this checkpoint removes, not regressions. Each reached its state by making MOVE re-read goals the tab beneath had just read, and MOVE now decides from those at once:
  - `sprint-w9-app-feel-parity-1.spec.ts` "Close while MOVE is still working out the goal";
  - `sprint-w9-app-feel-parity-2.spec.ts` "MOVE could not read: Go Home".
- **The fix, in `5633057a`:** only their setup changed, to reach "goals not yet known" honestly (a read held or failing from before the screen loads). **Every assertion is unchanged.** Both pass on `5633057a` and on base `0b460ce3` with the new setup.

## Timelines: `<STAGE>-timeline-<device>.webm` and `.json`, plus frames

- **Journeys:** Home → Progress, Progress → You, and Home → MOVE.
- **Frames:** at nominally 0, 150 and 600 ms after the press, plus one settled frame, for BASE and CANDIDATE at 390×640 and 390×844. Each carries its stage, the served commit and "NOT ACCEPTED" in a strip.
- **Labelled instrumentation:** every callable answer is held 1.5 s after Home settles. The member profile is a Firestore document, not a callable, so it is not held.
- **What the receipts show:**
  - Base: `wsf-activity-loading` and `wsf-you-loading` painted from about 75–85 ms to about 4.7 s, and `wsf-move-working` from about 62–80 ms to about 3.1 s.
  - Candidate: **no loading state at any shutter, at either size.**
  - The actual shutter times are in each JSON.
- **What the frames show:**
  - Progress: the base skeleton against the member's true state. This fixture member has not contributed, so that state is the first-contribution empty state, from the record.
  - You: name, community and "nothing recorded yet".
  - MOVE: the goal at 1,847 of 5,000 and the movement step, while its pulse and own reads are still held.
- **Digests:** `MANIFEST.sha256` holds the SHA-256 of every PNG and WebM. Each JSON repeats its own.

## Item 7: the per-community cold fan-out (a written seam; nothing built)

**What remains.** On a cold entry, a member of N communities still costs one `wsfMyCommunities` and then N concurrent `wsfListGoals` (Home's list and the Community tab). Each additional community adds one `wsfListGoals`. On the emulators this is one extra parallel stage, not a serial one (see the cold rows in the table).

**Why the client cannot remove it.**
- `wsfMyCommunities` returns memberships, not goals.
- `wsfListGoals` is per community by design: it authorizes membership of that one community.
- No existing callable answers "all goals of all my communities" in one authorized read.
- Reading ahead of the member, or keeping answers across reloads, is excluded: the Director's "do not globally preload all private communities", and the read layer's own "never persists".

**The minimal seam, if the Director wants the fan-out gone.** One new read-only callable, for example `wsfMyCommunitiesWithGoals`:
- **Auth:** `request.auth.uid` only. It returns, for each **active** membership of the caller, exactly what `wsfMyCommunities` and `wsfListGoals({ includeHistory: true })` return today for that community, with the same per-community authorization and the same fields.
- **Caps:** `ownCredit` is not included. It stays `wsfMyContribution`, per goal.
- **Client side:** the one read layer (`src/memberReads.ts`) would record it under the same keys, so no screen changes shape.
- **Cost:** 1 call instead of 1 + N on a cold entry.
- **Needs:** a functions change, a test and a deploy. Not authorized in this checkpoint; not started.

## Limits (none waived)

1. **Cold Home still paints four loading states:** `wsf-home-loading` → `wsf-home-my-loading` → `wsf-home-opening-community` → `wsf-community-loading`.
   - Calls fell 9 → 7 with no identical pair, and stages fell 5 → 3–4. The useful time is unchanged within noise (353–482 → 383–419 ms here).
   - A cold reload has nothing in memory, and the layer never persists, by its own rule. So the only way to fewer states without fake data is presentation: one continuous loading composition across auth restore, list read and redirect. Three existing specs assert those states by name.
   - This is **proposed, not done**. It is the Director's call whether it belongs in this packet or in COMMUNITY-SETTINGS-PARITY-1.
2. **Item 6 is evidenced at unit level only,** by `noteConfirmedContribution`. The Check 41B receipt journey returns Home to the server's figure (1,882) on both builds. No e2e isolates the recorded own part after a receipt on Progress: Progress stays mounted and, as on the base, does not re-read on return.
3. **A decision from the record can be up to one session old.**
   - MOVE's one-goal hand-off uses the recorded goal set. A goal that closed since is answered by the flow's own fresh pulse (the closed state); a goal added since appears on the next fresh read (any Home return).
   - A goal refused as not-found forgets its community.
4. **Not measured:** device, network or throttled-CPU speed; Safari; native; assistive technology; per-goal fan-out (one goal per fixture community).
5. **Not touched:** functions, rules, indexes, packages, auth, config, `.github`, and every W4, W6 and W8 file.
