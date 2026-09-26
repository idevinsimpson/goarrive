# PERF-MOBILE-1 checkpoint 1: one per-account read layer

- **Packet:** Director #365 `5840360454`; L0 #489 `5840568948`; W9 ACK #489 `5840966421`.
- **Worker:** W9. PR #494.
- **Base:** development `0b460ce3f2f0766406100fef14d9a444c8cad43a`.
- **Product SHA: `889e9775`**, the successor to `5633057a`.
  - `5633057a` was held by the Director (#365 `5841354004`) for three cache corrections (#494 `5841250834`, `5841264164`, `5841341300`); see *Successor* below.
  - The speed work is unchanged from `5633057a`.
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
| Cold Home: loading-frame sequence materially reduced, without fake data | **moved out of cp1** | The Director moved it to PERF-COLD-SNAPSHOT-2 (#489 `5841202778`). See *Limits*, item 1. |
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

## Raw before / after (W7 instrument; base `0b460ce3` → candidate `889e9775`)

The same instrument on the held `5633057a` is in `RAW-w7-instrument-CANDIDATE-5633057a.log`. Its numbers agree within noise.

| Transition | Useful ms (base → cand) | Settled ms | Callables base | Callables cand | Stages | Loading painted base → cand | Mounts cand | Blocking |
|---|---|---|---|---|---|---|---|---|
| W 390x844 pass1 Home->Community | 21 → **23** | 131 → 122 | wsfGoalRecentAdditions 1, wsfListGoals 1, wsfMyCommunities 1 | wsfGoalRecentAdditions 1, wsfListGoals 1, wsfMyCommunities 1 | 0 → 0 | none → **none** | wsf-community-index +1 | False → **False** |
| W 390x844 pass1 Community->Progress | 80 → **19** | 80 → 19 | wsfListGoals 1, wsfMyCommunities 1, wsfMyContribution 1 | 0 | 3 → 0 | wsf-activity-loading → **none** | wsf-activity +1 | True → **False** |
| W 390x844 pass1 Progress->You | 103 → **11** | 103 → 11 | wsfListGoals 1, wsfMyCommunities 1, wsfMyContribution 1 | 0 | 3 → 0 | wsf-you-loading → **none** | wsf-you +1 | True → **False** |
| W 390x844 pass1 You->Home | 13 → **14** | 106 → 101 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListGoals 1, wsfMyContribution 1 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListGoals 1, wsfMyContribution 1 | 0 → 0 | none → **none** | none | False → **False** |
| W 390x844 pass2 Home->Community | 6 → **6** | 6 → 6 | 0 | 0 | 0 → 0 | none → **none** | none | False → **False** |
| W 390x844 pass2 Community->Progress | 5 → **5** | 5 → 5 | 0 | 0 | 0 → 0 | none → **none** | none | False → **False** |
| W 390x844 pass2 Progress->You | 6 → **6** | 6 → 6 | 0 | 0 | 0 → 0 | none → **none** | none | False → **False** |
| W 390x844 pass2 You->Home | 6 → **10** | 96 → 87 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListGoals 1, wsfMyContribution 1 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListGoals 1, wsfMyContribution 1 | 0 → 0 | none → **none** | none | False → **False** |
| W 390x844 MOVE open (from Home) | 121 → **65** | 121 → 86 | wsfGoalPulse 1, wsfListGoals 2, wsfMyCommunities 1, wsfMyContribution 1 | wsfGoalPulse 1, wsfMyCommunities 1, wsfMyContribution 1 | 3 → 1 | wsf-move-working → **none** | wsf-contribute-sheet-panel +1 | True → **False** |
| W 390x844 MOVE Close | 185 → **186** | 258 → 254 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 2, wsfListGoals 1, wsfMyContribution 1 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 2, wsfListGoals 1, wsfMyContribution 1 | 1 → 1 | none → **none** | none | False → **False** |
| W 390x844 MOVE open again (from Home) | 138 → **45** | 138 → 49 | wsfGoalPulse 1, wsfListGoals 2, wsfMyCommunities 1, wsfMyContribution 1 | wsfGoalPulse 1, wsfMyContribution 1 | 3 → 1 | wsf-move-working → **none** | wsf-contribute-sheet-panel +1 | True → **False** |
| W 390x844 submit -> confirmed receipt | 46 → **53** | 46 → 53 | wsfContribute 1 | wsfContribute 1 | 1 → 1 | none → **none** | none | False → **False** |
| W 390x844 receipt exit ("Back to community") -> return | 26 → **26** | 94 → 119 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListGoals 1, wsfMyContribution 1 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListGoals 1, wsfMyContribution 1 | 0 → 0 | none → **none** | none | False → **False** |
| W 390x640 pass1 Home->Community | 21 → **19** | 111 → 124 | wsfGoalRecentAdditions 1, wsfListGoals 1, wsfMyCommunities 1 | wsfGoalRecentAdditions 1, wsfListGoals 1, wsfMyCommunities 1 | 0 → 0 | none → **none** | wsf-community-index +1 | False → **False** |
| W 390x640 pass1 Community->Progress | 74 → **23** | 74 → 23 | wsfListGoals 1, wsfMyCommunities 1, wsfMyContribution 1 | 0 | 3 → 0 | wsf-activity-loading → **none** | wsf-activity +1 | True → **False** |
| W 390x640 pass1 Progress->You | 91 → **11** | 91 → 11 | wsfListGoals 1, wsfMyCommunities 1, wsfMyContribution 1 | 0 | 3 → 0 | wsf-you-loading → **none** | wsf-you +1 | True → **False** |
| W 390x640 pass1 You->Home | 13 → **23** | 94 → 112 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListGoals 1, wsfMyContribution 1 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListGoals 1, wsfMyContribution 1 | 0 → 0 | none → **none** | none | False → **False** |
| W 390x640 pass2 Home->Community | 5 → **6** | 5 → 6 | 0 | 0 | 0 → 0 | none → **none** | none | False → **False** |
| W 390x640 pass2 Community->Progress | 5 → **9** | 5 → 9 | 0 | 0 | 0 → 0 | none → **none** | none | False → **False** |
| W 390x640 pass2 Progress->You | 6 → **6** | 6 → 6 | 0 | 0 | 0 → 0 | none → **none** | none | False → **False** |
| W 390x640 pass2 You->Home | 7 → **6** | 104 → 92 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListGoals 1, wsfMyContribution 1 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListGoals 1, wsfMyContribution 1 | 0 → 0 | none → **none** | none | False → **False** |
| W 390x640 MOVE open (from Home) | 111 → **46** | 111 → 71 | wsfGoalPulse 1, wsfListGoals 2, wsfMyCommunities 1, wsfMyContribution 1 | wsfGoalPulse 1, wsfMyCommunities 1, wsfMyContribution 1 | 3 → 1 | wsf-move-working → **none** | wsf-contribute-sheet-panel +1 | True → **False** |
| W 390x640 MOVE Close | 186 → **185** | 254 → 265 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 2, wsfListGoals 1, wsfMyContribution 1 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 2, wsfListGoals 1, wsfMyContribution 1 | 1 → 1 | none → **none** | none | False → **False** |
| W 390x640 MOVE open again (from Home) | 103 → **43** | 103 → 47 | wsfGoalPulse 1, wsfListGoals 2, wsfMyCommunities 1, wsfMyContribution 1 | wsfGoalPulse 1, wsfMyContribution 1 | 3 → 1 | wsf-move-working → **none** | wsf-contribute-sheet-panel +1 | True → **False** |
| W 390x640 submit -> confirmed receipt | 56 → **53** | 56 → 53 | wsfContribute 1 | wsfContribute 1 | 1 → 1 | none → **none** | none | False → **False** |
| W 390x640 receipt exit ("Back to community") -> return | 29 → **24** | 102 → 97 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListGoals 1, wsfMyContribution 1 | wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListGoals 1, wsfMyContribution 1 | 0 → 0 | none → **none** | none | False → **False** |
| C n=1 cold Home #1 | 482 → **392** | – | 9: wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListChallenge 1, wsfListGoals 2, wsfMyCommunities 2, wsfMyContribution 1 | 7: wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListChallenge 1, wsfListGoals 1, wsfMyCommunities 1, wsfMyContribution 1 | 5 → 3 | wsf-community-loading, wsf-home-loading, wsf-home-my-loading, wsf-home-opening-community → wsf-community-loading, wsf-home-loading, wsf-home-my-loading, wsf-home-opening-community | – | – |
| C n=1 cold Home #2 | 419 → **425** | – | 9: wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListChallenge 1, wsfListGoals 2, wsfMyCommunities 2, wsfMyContribution 1 | 7: wsfCommunityActivity 1, wsfCommunityMembers 1, wsfGoalPulse 1, wsfListChallenge 1, wsfListGoals 1, wsfMyCommunities 1, wsfMyContribution 1 | 5 → 4 | wsf-community-loading, wsf-home-loading, wsf-home-my-loading, wsf-home-opening-community → wsf-community-loading, wsf-home-loading, wsf-home-my-loading, wsf-home-opening-community | – | – |
| C n=1 cold Community tab #1 | 331 → **288** | – | 3: wsfGoalRecentAdditions 1, wsfListGoals 1, wsfMyCommunities 1 | 3: wsfGoalRecentAdditions 1, wsfListGoals 1, wsfMyCommunities 1 | 3 → 3 | wsf-community-index-loading → wsf-community-index-loading | – | – |
| C n=1 cold Community tab #2 | 329 → **285** | – | 3: wsfGoalRecentAdditions 1, wsfListGoals 1, wsfMyCommunities 1 | 3: wsfGoalRecentAdditions 1, wsfListGoals 1, wsfMyCommunities 1 | 3 → 3 | wsf-community-index-loading → wsf-community-index-loading | – | – |
| C n=3 cold Home #1 | 302 → **273** | – | 4: wsfListGoals 3, wsfMyCommunities 1 | 4: wsfListGoals 3, wsfMyCommunities 1 | 1 → 1 | wsf-home-loading, wsf-home-my-loading → wsf-home-loading, wsf-home-my-loading | – | – |
| C n=3 cold Home #2 | 262 → **278** | – | 4: wsfListGoals 3, wsfMyCommunities 1 | 4: wsfListGoals 3, wsfMyCommunities 1 | 1 → 1 | wsf-home-loading, wsf-home-my-loading → wsf-home-loading, wsf-home-my-loading | – | – |
| C n=3 cold Community tab #1 | 290 → **323** | – | 4: wsfListGoals 3, wsfMyCommunities 1 | 4: wsfListGoals 3, wsfMyCommunities 1 | 2 → 2 | wsf-community-index-loading → wsf-community-index-loading | – | – |
| C n=3 cold Community tab #2 | 335 → **355** | – | 4: wsfListGoals 3, wsfMyCommunities 1 | 4: wsfListGoals 3, wsfMyCommunities 1 | 2 → 2 | wsf-community-index-loading → wsf-community-index-loading | – | – |

Unchanged by design:
- **Home return: 5 background calls.** A member's return re-reads Home's figures fresh (RETURN-CONTINUITY). The pulse, members and activity are not facts this layer records, and goals and own parts on a return are read fresh on purpose.
- **Receipt: `wsfContribute`.** The write is the server's.
- **Label check:** MOVE's open still reads `wsfMyCommunities` once when the account's answer is older than the 10 s same-load window.

## Successor `889e9775`: the Director's three corrections

**Changes (cache, refusal and refresh logic only):**
- **Per-key generations plus an account epoch in `memberReads`.** A read records its answer only if nothing advanced the key since it was issued. Superseded by a receipt, it answers with the receipt's value; superseded by a removal, it asks again, fresh.
- **Receipts:** a receipt always advances the community's goal list. The list is patched when settled and patchable; otherwise it is removed.
- **Community eviction:** a group → goal-id registry (metadata only) lets `forgetCommunity` reach every recorded own part.
- **Refusal proof and eviction happen together:** on the contribution poll's not-found, and on Community Home's `wsfListGoals` not-found (load or return), which now shows the refusal, not "last known".
- **Mounted refresh:** Progress and You recompose from the record on every return, so a receipt shows as MOVE closes.

**W7 truth rows** (`sprint-w7-perf-mobile-verify.spec.ts` at `a5bad071`, run locally; `RAW-w7-truth-rows-*.log`):

| Build | T1 isolation | T2 refusal | T3 receipt on mounted routes | T3b stale read after receipt |
|---|---|---|---|---|
| **`889e9775`** | **PASS** | **PASS**: Home "Not a member"; Progress no longer lists it | **PASS**: 55 / 55 | **PASS\***: 55 / 55 |
| `5633057a` | PASS | measure: Home "Last known" | FAIL: 35 / 35 | FAIL\*: 35 / 35 |
| `0b460ce3` | PASS | measure: Home "Last known" | FAIL: 35 / 35 | FAIL\*: You 35 |

\*With the exact `a5bad071` file, T3b cannot measure on `889e9775`, because You opens from the record inside the 10 s same-load window (`RAW-w7-truth-rows-889e9775-exact-a5bad071.log`: T1–T3 pass). The T3b rows use a local, labelled one-line variant that waits 11 s before arming the hold. That is W7's stated adjustment (#494 `5841384342`); the variant is not committed.

**Other checks:**
- **Unit tests:** 18 cases in `tests/memberReads.test.ts`, 7 new: a stale own read after a receipt; a goals read in flight at a receipt; goals and own reads in flight at a refusal; registry eviction after the list is gone; account clearing; a refusal lifted by an authorized answer.
- vitest **909 / 909**; tsc clean.
- **Changed-dependency e2e for these corrections:** 22 files, 131 tests, on `889e9775`. **131 / 131 on the first run.** The files are every spec touching refusal, not-member, not-found, Progress or You.
- **Timelines:** the CANDIDATE frames and WebMs were **recaptured on `889e9775`**; each strip shows that commit. Loading painted is none at every shutter and at both sizes. The BASE frames are unchanged.

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
2. **Item 6 is now evidenced at route level** by W7's T3 and T3b on `889e9775`, as well as at unit level.
3. **A decision from the record can be up to one session old.**
   - MOVE's one-goal hand-off uses the recorded goal set. A goal that closed since is answered by the flow's own fresh pulse (the closed state); a goal added since appears on the next fresh read (any Home return).
   - A goal refused as not-found forgets its community.
4. **Not measured:** device, network or throttled-CPU speed; Safari; native; assistive technology; per-goal fan-out (one goal per fixture community).
5. **Not touched:** functions, rules, indexes, packages, auth, config, `.github`, and every W4, W6 and W8 file.
