# We Stay Fit — Milestones

**Roadmap of record. Approved by Devin 2026-09-05.** Governed by
`WE_STAY_FIT_MASTER.md`; delivery sequence from `EXPO_CRITICAL_PATH.md`.

> **Supersession.** This file previously carried M-U3 "Interest → App Bridge" and M-U4
> "Champion Campaigns Landing Surface". Those names came from the Lovable lineage and
> conflicted with the PM handoff, which defines M-U3 as Invitation and Join and M-U4 as
> Starter Challenges and Check-ins. The handoff numbering governs `apps/westayfit`.
> Resolved on Devin's authority, 2026-09-05. The Lovable-side interest and campaign work
> is not cancelled — it moves to Post-Expo (§4) and keeps its own identifiers there.

---

## 1. Closed

| ID | Name | State |
|---|---|---|
| M-U0 | Architecture & Transition Audit | **CLOSED** 2026-08-26, plan only |
| M-U1 | App Shell & Infrastructure | **MERGED** — PR #299, `main` @ `79df0d4` |

## 2. In flight

### M-U2 — Adult Member Identity & Community Foundation

*An authenticated adult creates a gated private community and becomes its Founding Champion.*

**Built:** signup → verify → profile setup → sign-in; create community (name, `groupType`,
`joinPolicy`); community detail page; `wsfMemberProfiles` / `wsfCommunityGroups` /
`wsfMemberships` / `wsfVerificationSends`; `wsfHealth` / `wsfCreateCommunity` /
`wsfSendVerificationEmail`.

**Not landed:**
- PR #300 is stale — head `7721db7`, missing every 2026-09-01/02 commit
- Hosting redeploy at `452834c` has no receipt
- No member can complete signup: verification email unconfigured

---

## 3. Expo delivery sequence — APPROVED 2026-09-05

Six slices. **Feature freeze Sep 28 · code freeze Oct 4 · event Oct 11.**

The reframe that makes this fit: **FitLife is one community**, created by hand before the
doors open. Attendees join it; they do not search, choose a type, or resolve duplicates.

| Slice | Substance | M-U parent | Owner |
|---|---|---|---|
| **E1** | Verification email actually delivers | M-U2 completion | Manus (config) + Maia (deploy) |
| **E2** | Join an existing community by link / QR — **ACCEPTED 2026-09-05, 7/7 EMULATOR VERIFIED** @ `feat/wsf-e2-join-by-qr` `5cbdb8e` (gate log `wsf-e2-gate.20260905T144155Z`, exit 0; `firestore.rules` delta vs base `7fc4b28`: empty) | M-U3, reduced | Maia |
| **E3** | Challenge templates, community challenges, check-ins | M-U4 — **the product at FitLife** | Maia — **GATE GREEN at `324cad6` (2026-09-05 20:05Z), EMULATOR VERIFIED:** callable suite (54+) incl. the 50-concurrent burst, and 7 browser specs incl. `e3-check-in-flow` (tap → counted → reload keeps it → re-tap idempotent → no console errors). Commits since `858feb2`: `4f6cc54` five review gaps · `abcc66b` metadata-probe skip · `12f4869` id floor / cache-first pulse / atomic limiter / code gate after idempotent return / first-touch warm-up · `90103c5` member challenge screen + `seed-fitlife.mjs` + E3 e2e in `gate1.sh` · `720971d` e2e account via admin endpoint · `359626b` list returns the caller's own check-ins · `ee5e83d` fresh/pending/counted states · `080920e`+`324cad6` hosting alias + rewrite for `/community/*/challenge`. Independent review (19:58Z) verified the flow against real emulators. **Staging preview deployed 20:40Z** (`westayfit-app--staging-x4m0iwln.web.app`, expires 2026-09-12; WSF functions deployed; test community `wsf-staging-test` seeded; see `RELEASES.md`). **ACCEPTED 10/10 (2026-09-06 01:02Z, thread 1788656340.358089), all EMULATOR VERIFIED, none LIVE VERIFIED:** tip `b815415` (one non-code seed commit after the gated `324cad6`); callable suite 7/7 suites, 56/56 tests; e2e 7 passed; criterion 9 with a note — E3's own commits leave `firestore.rules` untouched, the +58-line delta vs `origin/main` is the inherited M-U2 WIP commit `620c168`, and no rules deploy is on the E3 path. Open items (listed, not claimed): join-code re-mint under `--force`, no production guard on `--apply`, weak seed id validation, signed-out deep link loses the return path, join URL base / hosting port 5010, "1 members moving", generic wrong-code copy — turn F. **Phone test 2026-09-06 01:06Z (LIVE, iPhone, Instagram in-app browser): profile → create → community page walked; the check-in flow itself not yet exercised. Findings F1–F10 → `dispatch/E3.5-PHONE-TEST-FIXES.md`.** |
| **E3.5** | Phone-test fixes: signed-in home, routing, 18+ gate removed (Devin 2026-09-06), terms readable, human labels, public join policy exposed, in-app-browser hint | M-U2/M-U5 correction | Maia — **GATE GREEN at `642f335` (2026-09-06 02:20Z), EMULATOR VERIFIED:** 18 browser specs (mu2 + e2 + e3 + new `e35-home`, incl. §6.1 re-sign-in, §6.2 `createdAt` preserved, §6.9 Instagram/Safari UA, F9 Private) + callable suite (new `wsfMyCommunities`, `wsfSaveProfile`). First gate 01:56Z red: `firestore.rules` still required `adultConfirmation` on `wsfMemberProfiles` → fixed without a rules change by moving the profile write into `wsfSaveProfile` (Admin SDK); routing precedence fixed so a pending join code is terminal-only. Rules diff vs `b815415`: empty. Static review 02:05Z (NEEDS-FIXES → all six required items landed). Staging redeploy dispatched 02:23Z. Spec `dispatch/E3.5-PHONE-TEST-FIXES.md`. **Staging redeployed 02:30Z at `642f335`** (see `RELEASES.md`); Devin's Safari retest + the E3 check-in flow pending. **Acceptance E3.5-A: 10/10 at 2026-09-06 02:58Z (thread 1788661937.422899), all EMULATOR VERIFIED — 65 callable tests, 18 browser specs, rules untouched; deferred items listed as open.** **Turn C (sign-in and password polish) GATE GREEN at `2f0a9dc` (2026-09-06 17:47Z), EMULATOR VERIFIED:** 25 browser specs incl. `e35-auth-polish` + callable suite incl. `wsf-send-password-reset-email`; show/hide password, `/reset-password` via `wsfSendPasswordResetEmail` (enumeration-safe, same email config as verification), error copy with the two ways out, autofill/keyboard attributes, signed-in redirect, signup rule hint, honest "email not set up" copy; gate1.sh callable phase now boots the Auth emulator (`--config`). Staging redeploy dispatched 18:00Z. **Turn C staging redeployed 18:04Z at `2f0a9dc`** (`RELEASES.md`); Devin's retest of sign-in pending; email delivery waits on decision A (task #30). |
| **Demo** (ChatGPT-directed, not a roadmap milestone) | Isolated sample-data interactive demo inside the WSF app: picker → squat flow → WE total 980 → 1,000 → milestone → big-screen view; every screen labelled "Interactive demo · Sample data"; no live writes, seed, accounts or rep-detection claims | Vision meeting with coach JV, 2026-09-08 2pm EDT | Maia — **HANDOFF 14:00 EDT 2026-09-08 at `491f7f7`** on `feat/wsf-demo` (cut from `2f0a9dc`, merge-base confirmed; worktree `~/dev-goarrive-wsf-demo`; thread `1788887316.935919`, reply `1788890431.341729`). Devin chose option B in-thread (full polished demo, later handoff); Maia built 13:42–14:00 EDT. Her evidence: `tsc` 0, vitest 30/30 (8 new), Playwright `demo.spec.ts` 5/5, `expo export` clean, 10 screenshots committed — EMULATOR-CLASS evidence on her box, none LIVE VERIFIED, no PR, no deploy. **PM boundary review (2026-09-08 18:50Z): PASS** — 19 files, +1,731 lines, all under `apps/westayfit` (`app/demo/*`, `src/demoState.ts`, `src/DemoBanner.tsx`, `scripts/serve-demo-local.mjs`, tests, screenshots); no `package.json`/lock change, no rules/indexes/functions/hosting-config/auth/legal edits; no firebase, firestore or auth import in any demo file; banner on every demo screen, honest "we do not detect reps" copy, chair/mat requirements, Reset, milestone latch fires once per reset, clamp at goal; root `_layout` has no route gating so `/demo` is reachable; hosting `cleanUrls` serves `/demo`, `/demo/squats`, `/demo/display` without a rewrite. Gap for ChatGPT's acceptance: reduced-motion support (a spec design item) not found in the demo files, the count-up is a JS timer animation. Note for the real kiosk (not this demo): state persists in `localStorage` between visitors, which master §8 forbids for Expo mode. ChatGPT owns acceptance; a preview-channel deploy needs Devin's word.. **Correction push 16:28 EDT at `b612bf1`** after ChatGPT's PM/UX review (16:09 EDT, ts `1788898142.389629`, with JV-meeting advisory context): overshoot preserved (980+35 = 1,015, one crossing), invalid counts rejected without mutation, ready → timer → enter reps → confirm once → YOU/WE result, picker shows the working squats challenge only with a "Not in this demo" concepts block, display shows the raw percent with the bar clamped; her evidence: `tsc` 0, vitest 33/33, Playwright 7/7, 14 screenshots (not LIVE VERIFIED). **PM boundary review of `b612bf1` (2026-09-08 21:00Z): PASS** — 7 non-image files changed, all under `apps/westayfit` plus the new advisory note `docs/westayfit/meetings/2026-09-08-jv-vision.md`; no dependency, rules, indexes, functions, hosting-config, auth or legal changes since `2f0a9dc`; no backend import in any demo file; reduced-motion handled via a prefers-reduced-motion hook in squats.tsx; a submit guard is present in squats.tsx. The meeting note is copied verbatim onto the PM record branch so it survives if the demo branch is never merged. Still no PR and no deploy; ChatGPT's visual sign-off pending.. **Devin asked for the screenshots in-thread 22:31 EDT 09-08 (his own message, ts `1788921111.972679`); Maia posted all 14 at 22:33 EDT with buttons A (open PR) / B (adjust); no answer yet.** **PM visual review of the committed screenshots (2026-09-09 05:20Z, 9 of 14 viewed): boundaries and honesty PASS** — the "Interactive demo · Sample data" banner is on every screen, WE STAY FIT wordmark as text with navy/cream/gold and no invented logo, units on every number, honest copy ("this demo does not detect reps for you", "Simulate is a demo shortcut", "nothing here is written to a real community"), overshoot shown as 1,015 / 102% / "15 past the goal". **Two defects for ChatGPT's acceptance before a PR:** (1) evidence gap — the phone 'recorded' screenshot is byte-identical to the phone 'ready' screenshot, and the desktop 'recorded' screenshot shows a milestone crossing (20 added, 995 → 1,015) rather than a below-goal result, so the below-goal result state (YOU 15 → WE 995) that Maia described is not evidenced by any screenshot; (2) phone layout at goal — in `demo-display-goal-phone.png` the 1,015 figure is clipped on both sides of the card and the banner collides with the heading, while the desktop version is fine. Nit: the display eyebrow reads "COMMUNITY DISPLAY · LIVE" on sample data; the footnote explains it, but "LIVE" on a demo is easy to misread. Reported to Devin in chat; nothing posted in the thread. |
| **E4** | Aggregate counters, honest and live | M-U5, reduced | Maia |
| **E5** | Community Pulse display view (kiosk two) | M-U5, reduced | Maia |
| **E6** | Expo hardening — attract, auto-reset, large targets | M-U7, reduced | Maia |

### E2 acceptance record

Criterion → proof, all on `5cbdb8e`: (1) second adult with only a join URL reaches
`/community/<id>` — `e2-join-flow.spec.ts:142`; (2) joining twice writes exactly one
membership — `wsf-join-community.test.ts` §3.2 asserts `memberships.size === 1`;
(3) unknown code and private group return byte-identical not-found — `wsf-preview-community.test.ts`
§3.3 compares code, message and details; (4) cold load of `/join/<code>` is 200, unknown
code renders the not-valid state — `e2-join-flow.spec.ts:148, :210`; (5) signed-out →
signup → back to the join URL → community — `e2-join-flow.spec.ts:151–198`; (6) no
`firestore.rules` or `firestore.indexes.json` change — verified against the merge-base;
(7) M-U2 flows unchanged — `mu2-flow.spec.ts` ×4. Callables run inside `gate1.sh` under
`set -euo pipefail` before the e2e block, so exit 0 proves them — and the log carries
`Test Suites: 4 passed, 4 total · Tests: 25 passed, 25 total`. Follow-up landed as `4bc594a`:
the oracle now also compares a non-`active` lifecycle against an unknown-code control. Two harness defects the
gate caught on the way: a seed against the emulator's DELETE-only `/emulator/v1` path, and
a double-mounted join screen from a `push` where a `replace` belonged — the second was a
real product defect. Non-blocking follow-up: add a non-`active` lifecycle case to the
oracle test (the callable already handles it). `apps/westayfit/dist` is an emulator build
after any gate run — rebuild before deploying.

### Dependency correction

E1 blocks **live member validation**, not E2–E6 development. Those slices are built and
verified against the emulator, where verification state is set directly by the harness.
E1 is still urgent — the loop cannot be exercised by real people until it lands, and real
people are the entire point of the Expo — but **it is not a serial gate on engineering,
and E2 starts now.**

### Cut for the Expo — deliberately, not forgotten

| Cut | Why it is safe to cut |
|---|---|
| **M-U6 Universal Start/Join Funnel** — cut entirely | One community. No funnel to route. |
| Community search | Nothing to search for. |
| 5 of 7 community types | FitLife Moves is one group of one type. |
| General invitation system | Joining is by public QR, not per-person invite. |
| Champion dashboard | One community, administered by us, not by an attendee. |
| Demo communities in Expo mode | The real community is the demo. |
| M-U8 Org Verification · M-U9 Move Markers · M-U10 Monetization | Post-Expo. |

### NOT cut, and not negotiable

Privacy controls · adult-only enforcement · honest aggregate counters · sample-data
labelling. These are the conditions of shipping, not scope — and the FitLife brief's own
success criteria depend on the numbers being real.

---

## 4. Post-Expo

- **M-U6** Universal Start and Join Funnel — community search, all seven types, phone handoff
- **M-U8** Organization Verification and Conversion
- **M-U9** Move Markers and physical touchpoints
- **M-U10** Public Launch and Monetization Readiness
- **L-1** Lovable interest bridge (`interest_responses` → explicit, user-triggered conversion; no dual-write, no auto-conversion — see `LOVABLE_HANDOFF.md`)
- **L-2** Lovable Champion campaigns landing surface, read-only for authenticated owners
- Universal Communities Charter surface implementation
- Native app: Expo Go → EAS → TestFlight, once web behaviour is proven
- WSF analytics event schema, namespaced separately from GoArrive

---

## 5. Rules for this file

Every slice gets its own dispatch spec before implementation, naming the single primary
workflow, what is in and out of scope, and objective acceptance criteria. One milestone
has one production code owner. Identifiers are never reused or renumbered; a superseded
name is recorded as superseded, never overwritten silently.
