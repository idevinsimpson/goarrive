# WE STAY FIT — Thread Continuation Brief
Date: 2026-09-21
Purpose: durable handoff for starting a fresh ChatGPT thread without relying on chat history.

## Source of truth
Use these in this order:
1. WE STAY FIT Strategic Master v3.
2. Devin's newest explicit decisions.
3. PR #365 latest comments and files on branch `claude/wsf-app-shell`.
4. This handoff only as a navigation aid; newer GitHub evidence wins.

Repository: `idevinsimpson/goarrive`
Primary product/visual PR: #365
Branch: `claude/wsf-app-shell`

## Canonical review gate — as of 2026-09-22

The one gate on visual work now is **the Program Director's independent visual
review of North Star Boards 00–05 + INDEX**, tracked in the canonical package
manifest, not in this brief:

- `docs/design-target/north-star-final/README.md` — status 3, *Independent
  board review*, per board (statuses 1–4 are kept separate there on purpose).
- PR #392 (`claude/wsf-north-star-canonical`) carries the boards; W2's
  independent audit is `north-star-final/review-audit-w2/` (PR #397).
- Until that gate clears: no bulk Boards 06–11, no 12–17 (Round 1,
  `5781435779`). Boards 06–11 then split across design slots, one writer per
  board, and that release is recorded explicitly.

The two 2026-09-21 sections below — *Page 5 target-only* and *atlas first* —
are kept as the record of what governed on that date and are marked
HISTORICAL where they no longer do. This is not a second tracker: statuses
live in the manifest and the roster at the end of this file.

## Current governing creative system
The owner-approved visual reset is active.

Core emotional loop:
**I did something → WE changed → I belong here → I want to come back.**

Preferred member IA:
**Home | Community | MOVE | Progress | You**

Visual bar:
- vibrant native-app feel, not a responsive SaaS site
- compact WE STAY FIT chrome
- expressive Living WE as the signature progress instrument
- navy + progress green with depth/gradient/imagery where authorized
- strong iconography and fewer cream/white bordered-card stacks
- truthful community presence and momentum
- celebratory confirmed-contribution payoff
- event/kiosk/tablet/display surfaces belong to the same WSF visual family

Hard truth boundaries remain:
- no fake people/activity
- no rankings or friend graph
- no unsupported health/happiness claims
- no named public contributors without permission
- no public streak pressure
- no concurrency-unsafe predicted shared totals
- no WSF ownership of GoArrive individualized coaching/workout-player functionality

## Owner visual north star in GitHub
These exact files are now committed and must be opened before every target-design pass and every implementation pass:

- `docs/design-target/owner-north-star/OWNER-BOARD-1-before-current-wsf-experience.png`
- `docs/design-target/owner-north-star/OWNER-BOARD-2-after-target-wsf-vision.png`
- `docs/design-target/owner-north-star/README.md`

The AFTER/TARGET owner board establishes the emotional/compositional spirit. Use current truth/privacy rules when any concept detail is outdated.

## Current implementation status
Do not roll back accepted product work.

Pages already advanced under the page-by-page gate:
- Page 1 Home — accepted before later atlas-first clarification.
- Page 2 MOVE / contribution — accepted before later atlas-first clarification.
- Page 3 Community — accepted.
- Page 4 Progress — accepted after evidence correction.

Current latest accepted Progress behavior:
- private own-part only
- finished goals remain visible
- no mixed-unit total, ranking, comparison, or fake streak
- one Living WE only when tied to a real finished shared goal result
- bounded parallel reads and disclosed partial failure
- private-history callable remains a documented seam only; not authorized for implementation

Page 5 You/Profile — **HISTORICAL (2026-09-21); superseded 2026-09-22.**
`/you` is implemented to its reviewed second-revision target and stopped for
visual acceptance (`docs/design-target/review/page-05-you/README.md`:
"Implemented … stops for the fourth"); PR #365's own checklist records it
"ACCEPTED at `7e788a9`". The rules below still hold; the two status lines do not.
- ~~TARGET ONLY~~ (historical)
- ~~not implemented yet~~ (historical)
- current route is `/you`, not `/profile`
- truthful reachable profile data today includes displayName and createdAt from the member's own profile
- do not invent photo, quote, streak, dated recent activity, contribution count-by-week, or causal “you moved us from X to Y” claims

## GATE AS OF 2026-09-21 — atlas first before more implementation (HISTORICAL; superseded 2026-09-22)
**Superseded** by the canonical review gate above: the atlas batches A–G were
accepted as target reference (PR #365 body), the canonical North Star package
(Boards 00–05 + INDEX) is rendered and self-checked on #392, and the live gate
is the Director's independent review of those boards. The batches listed here
stay as the record of atlas coverage; do not start work from this section.

On 2026-09-21 Devin's explicit instruction controlled what happened next:

**Do not implement Page 5 or any later page until the missing Visual North Star Atlas is complete and visually reviewed.**

Required remaining atlas batches:

### Batch B — Join / create / Champion setup
- `/join/[joinCode]`
- `/start-community`
- `/goals/new`
- `/combined/[setupId]`

### Batch C — Challenge / remaining member states
- `/community/[groupId]/challenge`
- any missing lifecycle/device states for accepted member pages

### Batch D — Event + Queue on personal phone
- event landing/auth/member/not-member/activity/device-choice/completion
- queue join/waiting/assigned/ready/leave/rejoin/unavailable

### Batch E — Shared devices
Kiosk portrait/tablet:
- idle
- choose movement
- QR/sign-in
- contribution
- confirmation
- Finish/reset
- clean next visitor
- timeout
- offline/unavailable

Station landscape/tablet:
- enrol/pair
- available
- participant assigned
- ready
- active 60-second movement
- review/result
- receipt
- cleared next participant
- offline/unavailable
- prior participant identity removed

### Batch F — Public/display
Device boards:
- phone preview
- 800×1280 picture-frame tablet
- 1280×800 booth/landscape
- 1920×1080 collective display

State matrix:
- zero
- ordinary progress
- near goal
- reached/open
- closed/reached
- closed unfinished
- stale
- unavailable
- unauthorized/refused

No individual identity unless separately authorized.

## Atlas acceptance (HISTORICAL — see the canonical review gate above)
Before more implementation, PR #365 had to show:
- atlas overview/contact sheet
- exact target paths by batch
- updated route → target mapping
- uncovered routes/states/devices = 0, or explicit blockers
- corrected `ROUTE-TARGET-INDEX.md` with no contradictory covered/uncovered rows

Then STOP for visual review.

## Page-by-page implementation gate after atlas acceptance
For every page:
1. ACTUAL CURRENT BEFORE
2. WSF TARGET
3. implement only that page + narrowly necessary shared design work
4. ACTUAL AFTER at matched viewport(s)
5. BEFORE → TARGET → AFTER comparison
6. emotional self-critique
7. STOP for ChatGPT visual acceptance before next page

Green tests are necessary but not visual acceptance.

## Evidence rules
Do not silently regenerate accepted screenshots.
Accepted evidence must remain byte-stable during ordinary verification unless capture is explicitly opted in.

## Separate known seams / blockers
- Private dated personal history / streak-style consistency is not currently reachable to the client; no backend callable is authorized yet.
- Staging email remains a separate bounded reliability track unless fresh evidence changes it.
- Expo/player harness debt exists but should not displace the atlas/member visual work unless it reveals a real product blocker.
- Production release is not authorized.

## Sprint roster — Round 1 (2026-09-22, deadline Wed 2026-09-23 23:00 America/New_York)

The one status record for the parallel sprint set by PR #365 comment
`5781435779`. The lead updates it at each checkpoint; workers report through
their own draft PRs. Status words: SENT · ACKNOWLEDGED · EXECUTING ·
CHECKPOINT-READY · REVIEWED · INTEGRATED · STAGED. This is the roster, not a
second roadmap: artifacts stay in the canonical board manifest.

**Mechanism.** Workers are independent Claude Code Remote sessions in the same
cloud environment (`Default`), each in its own container with its own
checkout, emulators, ports, build output and screenshots — isolation is by
container, not by convention. Spawned from the lead with `create_session`;
model requested `claude-opus-5`; effort/Ultracode flags are not settable from
that call and are reported by each worker in its own PR body. Billing is the
account subscription (five-hour window, not in overage at spawn time); no
Anthropic API key, Bedrock or Vertex setting is present in the lead's
environment. Session/weekly usage percentage: UNKNOWN from inside a session.

**Lead → worker messaging — corrected 2026-09-22 18:55Z.** A Routine bound to
a worker's session id and fired with the assignment as payload does **not**
fire into that session: every such fire (nine, W1–W5, running or idle target
alike) created a fresh, empty trigger-run session on the platform's default
model, which reported "no assignment attached" and push-notified the owner.
Roster rows that earlier read "delivered into its session" were wrong; those
assignments reached nobody until they were posted on the workers' own PRs.
**The only channel that demonstrably works is a comment on the worker's own
PR, read at the worker's self-scheduled check-in** (created from inside its
session; W3/W4 19:30Z, W5 19:49Z). A worker that stops with no check-in armed
(W1) is unreachable; its follow-up transfers back to the lead explicitly.
The poke Routines are deleted.

| ID | Session · reachability | Branch · head | Allowed files | Current packet | Next executable packet | Blocked on | Latest worker-authored acknowledgment | Actual checkpoint / commit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L0 | lead — `session_017cby7B21o4bFbnpsa1ciRV` | `claude/wsf-north-star-canonical` (integrates to #365 / #392); fix child `claude/wsf-fix-contribute-skip-timer` | manifest, INDEX, review-copies, Board 00/01 modules + renderer lib, this brief, integration; the W5-M1 fix route + its spec | **W5-M1 short-phone fix — DELIVERED**: PR #400 `ff8c880` (W5 to verify). **#399 reviewed + integrated** at `7187286`; **Board 00 P-5 / D-00.2, Board 01 P-1, INDEX P-3 landed** at `2f088d7`; all six review copies re-cut; manifest `d74cacd` | review W5's verification of #400 when it lands, then hand W4 the integration delta; review W3's corrected #393 head when it exists; keep the roster current; no 06–11 until the gate clears | Director's visual verdict on 00–05 (M4) | this brief (lead-authored) | #400 `ff8c880`; canonical `d74cacd` + this commit |
| W1 | CCR `session_01YA6WdVgb2NJosUL3Mu9D6n` — idle since 18:44Z, no check-in armed, **unreachable**; role retired in place | `claude/wsf-sprint-north-star-home` — PR #398 (`8b3707b`) | — (its follow-up files are now L0's) | none — its two corrections INTEGRATED at `4f43973`; the narrow follow-up was transferred to L0 and landed at `e9ad923` | none. The slot may be reused only after an explicit ownership transfer (queue `5782379245` §2); no overlapping writer on `board-01.mjs` | — | #398 body at `8b3707b` (18:44Z) | `4f43973` (integrated) |
| W2 | CCR `session_01KqnSmxM55Y5FXUe53kmD6V` — running; reads #397; **picked up the Director's queue directly** (`5782382385` → ack `5782436746`, 19:12Z) | `claude/wsf-sprint-north-star-core` — PR #397 `1bf2b23` (audit, frozen); repair child `claude/wsf-sprint-north-star-boards-repair` — **PR #399** from canonical `e9ad923` | audit: `review-audit-w2/**`; repair packet: `board-02/**`, `board-04/**`, `board-05/**` + their modules only (Board 00/01, `lib.mjs`, renderer, manifest, INDEX, review-copies, product files excluded) | bounded repairs P-2 / P-4 / P-6 — **DELIVERED** as #399 (`5782555549`, 19:21Z): captions/provenance only, no pixel edits to captures, three boards re-rendered from a byte-identical control render; Board 02 now 2560px tall | none until L0 / Director review of #399; **WAITING** with its self-check armed. After the 00–05 gate clears: 06–11 split, one writer per board, recorded explicitly | L0's review of #399; then L0 re-cuts `review-copies/` 02/04/05 + INDEX (flagged by W2, not touched) | #397 `5782555549` (19:21Z) | #399 head (see its PR); audit `1bf2b23` |
| W3 | CCR `session_01J1CepL52CKS8SqaGSZFfLc` — **WORKING** (platform session record 19:37Z: branch `claude/wsf-staging-mail-binding`, writing `mail-binding.test.mjs`); reads #396 | `claude/wsf-sprint-email-staging` — PR #396 `514d450`; **owns `claude/wsf-staging-mail-binding` (#393 `cb91d78` until it pushes)** | `report-mail-binding.mjs`, its tests, `workflow-contract.test.mjs`, `docs/wsf-staging/EMAIL-ACCEPTANCE-OPERATOR-HANDOFF.md` | #393 corrections — **EXECUTING on platform evidence; worker-authored acknowledgment still pending** (posted on #396 `5782125908`; queue relay `5782618328`): reporter + all-job gating fixes, ONE tested head, notify W5 on #395 | handoff edits (owner-designated operator wording; retain messages) while review is pending | — (its own comment with the head is the next evidence) | none yet — #396 body at `514d450` (18:26Z) is the latest worker-authored text | `514d450`; #393 still `cb91d78` |
| W4 | CCR `session_014VhZAgvNzjfA9ahZas8eX5` — **picked up at its 19:30Z check-in**; reads #394 | `claude/wsf-sprint-member-journey` — PR #394 `1a192d8` | `review/sprint-w4-member-journey/**`, `tests-e2e/sprint-w4-*.spec.ts` | isolated combined-runtime test of `e609c57` + `e982ddc` — **ACKNOWLEDGED → EXECUTING** (`5782702769`, 19:32Z): scratch merge local-only, functions `lib` + web rebuilt from the combined tree, callable / rules / deploy-config suites + six browser specs; reports as "Deliverable 4" in its PR body, CHECKPOINT-READY | integration delta / test receipt for the next *accepted* app patch (#400 noted as under review, not an input); Join imagery to accompany the functional evidence | — | `5782702769` (19:32Z) | `1a192d8`; combined receipt pending |
| W5 | CCR `session_01G4FfDv5vKhCNNkSg3JgXGL` — idle since 18:48Z; self check-in 19:49Z; reads #395 | `claude/wsf-sprint-independent-qa` — PR #395 `fe1b27d` | `tests-e2e/sprint-w5-*.spec.ts`, `tests/callable/sprint-w5-*.test.ts`, `docs/westayfit/qa/**` | #393 review **DELIVERED** (`5781811012`); member QA delivered (W5-M1 found). **SENT / WAITING**: verify W3's corrected head when it exists, else verify #400 `ff8c880` (posted on #395, 19:2xZ) | remove its `test.fail()` only when a real non-forced tap passes on the verified head | its own 19:49Z check-in; W3's head for packet (1) | #395 body at `fe1b27d` (18:48Z) | `fe1b27d` |

Cap: six sessions including the lead; all six are open (L0, W1, W2, W3, W4, W5).

**Milestones (alignment `5782184088`, 2026-09-22).** The original delivery
milestones stay the record; review-pass numbers are tracked apart and clear
none of them. **M4** — 00–05 delivered AND visually reviewed: OPEN (delivered
on #392; W2's independent audit in; Director's visual verdict not yet).
**M5** — real verification/reset acceptance, or the exact blocker with an
acknowledged accountable operator: OPEN (blocker: staging hosts denied by
policy in every Claude container, measured twice; operator slot reserved,
below, not yet acknowledged). **M6** — combined member runtime reviewed /
eligible staging candidate: OPEN (W4's combined-runtime test SENT, not yet
picked up). Director passes so far: Rounds 1–5, alignment, execution queue
`5782379245` — seven, and none of them is a milestone.

**Real-mail operator slot:** reserved for an owner-designated browser operator (Manus), **PENDING its acknowledgment** — recorded from Round 3 `5781782947` §1; not a claim it has received the prompt or begun. Until acknowledged, no Claude session performs the acceptance test. Every Claude container measured so far is denied on the staging hosts by policy. Heavy
emulator/browser suites run in separate containers (W4, W5), so the two-per-
machine rule is met by construction.

## How a fresh ChatGPT thread should begin
1. Read this file.
2. Fetch PR #365 latest comments.
3. Open the owner north-star boards.
4. Inspect current branch head and latest target/evidence files.
5. State the active gate before directing Claude.
6. Continue using one coordinated Creative Director direction; do not create a competing implementation workflow.
