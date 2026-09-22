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

Page 5 You/Profile:
- TARGET ONLY
- not implemented yet
- current route is `/you`, not `/profile`
- truthful reachable profile data today includes displayName and createdAt from the member's own profile
- do not invent photo, quote, streak, dated recent activity, contribution count-by-week, or causal “you moved us from X to Y” claims

## CURRENT GATE — atlas first before more implementation
Devin's newer explicit instruction controls what happens next:

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

## Atlas acceptance
Before more implementation, PR #365 must show:
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

| ID | Mechanism / session | Branch · starting SHA | Allowed files | First deliverable | Status / evidence | Blocker | Next gate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| L0 | lead — `session_017cby7B21o4bFbnpsa1ciRV` | `claude/wsf-north-star-canonical` @ `4f43973`; integrates to `#365` / `#392` | manifest, INDEX, review-copies, this brief, integration | 00–05 + INDEX landed (`4fe51f0`); statuses separated (`e29b9ec`); #398 integrated (`4f43973`) | EXECUTING | — | director's visual review of 00–05 |
| W1 | CCR `session_01YA6WdVgb2NJosUL3Mu9D6n` | `claude/wsf-sprint-north-star-home` from `d072aa6` — PR #398 | `board-01/**`, `north-star/board-01.mjs` | the two Round-2 corrections — **delivered** at `8b3707b` (stale as TARGET / NOT IMPLEMENTED inset; seam split into #390 name+role vs NOT AUTHORIZED named movement; source verdict from the director: addressed). **INTEGRATED** into the canonical branch at `4f43973`. One narrow Round-4 follow-up assigned 18:50Z: the inset must not imply a confirmed Living WE is dropped when stale; README wording corrected narrowly | CHECKPOINT-READY (packet 1) · INTEGRATED · EXECUTING (follow-up) | — | independent visual review (W2 + director) |
| W2 | CCR `session_01KqnSmxM55Y5FXUe53kmD6V` — visual evidence auditor | `claude/wsf-sprint-north-star-core` from `e29b9ec` — PR #397 | `north-star-final/review-audit-w2/**` only | property-by-property visual audit of 00–05 + INDEX; then #398's corrected Board 01 at `4f43973`; verdict per board with crops; recommends, does not clear | ACKNOWLEDGED → EXECUTING (#397 `0cb18fa`) | — | director's visual review of 00–05 |
| W3 | CCR `session_01J1CepL52CKS8SqaGSZFfLc` | `claude/wsf-sprint-email-staging` (PR #396 `514d450`) + **owns `claude/wsf-staging-mail-binding` (#393)** | `.github/wsf-staging/report-mail-binding.mjs`, its tests, `workflow-contract.test.mjs`, `docs/wsf-staging/EMAIL-ACCEPTANCE-OPERATOR-HANDOFF.md` | #396 packet **delivered** (second-machine receipt; reachability NOT REACHABLE, same policy; handoff doc). Now: one corrected #393 commit — director's four corrections + W5's F1 (contract inspects all parsed jobs; ungated job fails) + Round-4 caveats (absent identity = unknown; project id/number equivalence established or unresolved; configured-binding-only wording) + handoff edits (owner-designated operator wording; retain messages, no deletion) | CHECKPOINT-READY (#396) · EXECUTING (#393) | staging hosts denied by policy in every Claude container measured | W5 verification of the corrected head → director re-review → recorded merge |
| W4 | CCR `session_014VhZAgvNzjfA9ahZas8eX5` | `claude/wsf-sprint-member-journey` from `e609c57` — PR #394 `1a192d8` | `review/sprint-w4-member-journey/**`, `tests-e2e/sprint-w4-*.spec.ts` | packet 1 **delivered and accepted by the director**: 61/61 across 8 specs on `e609c57`, retry-colour fix verified, Progress/Home corrections verified, #390 trial merge conflict-free + combined typecheck, no product defect. Now: isolated combined-runtime test of `e609c57` + `e982ddc` in its own container (no port allocation needed; guards intact) | CHECKPOINT-READY (packet 1) · EXECUTING (combined runtime) | — | any proved defect → lead assigns a bounded patch |
| W5 | CCR `session_01G4FfDv5vKhCNNkSg3JgXGL` | `claude/wsf-sprint-independent-qa` from `e609c57` — PR #395 | `tests-e2e/sprint-w5-*.spec.ts`, `tests/callable/sprint-w5-*.test.ts` | #393 review at `cb91d78` **delivered** (`5781811012`: F1/F2/F4 moderate, F3/F6 low, F5 trivial; 9 mutations; no privacy defect). Now: member-work QA; then verify W3's corrected head incl. its M6/M7 probes | CHECKPOINT-READY (part 1) · EXECUTING (part 2) | — | director closes #393 review |

Cap: six sessions including the lead; all six are open (L0, W1, W2, W3, W4, W5).

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
