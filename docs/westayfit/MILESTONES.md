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
| **E3.5** | Phone-test fixes: signed-in home, routing, 18+ gate removed (Devin 2026-09-06), terms readable, human labels, public join policy exposed, in-app-browser hint | M-U2/M-U5 correction | Maia — **GATE GREEN at `642f335` (2026-09-06 02:20Z), EMULATOR VERIFIED:** 18 browser specs (mu2 + e2 + e3 + new `e35-home`, incl. §6.1 re-sign-in, §6.2 `createdAt` preserved, §6.9 Instagram/Safari UA, F9 Private) + callable suite (new `wsfMyCommunities`, `wsfSaveProfile`). First gate 01:56Z red: `firestore.rules` still required `adultConfirmation` on `wsfMemberProfiles` → fixed without a rules change by moving the profile write into `wsfSaveProfile` (Admin SDK); routing precedence fixed so a pending join code is terminal-only. Rules diff vs `b815415`: empty. Static review 02:05Z (NEEDS-FIXES → all six required items landed). Staging redeploy dispatched 02:23Z. Spec `dispatch/E3.5-PHONE-TEST-FIXES.md`. **Staging redeployed 02:30Z at `642f335`** (see `RELEASES.md`); Devin's Safari retest + the E3 check-in flow pending. |
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
