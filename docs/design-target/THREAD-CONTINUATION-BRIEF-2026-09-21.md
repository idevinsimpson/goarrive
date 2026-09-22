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
| L0 | lead — `session_017cby7B21o4bFbnpsa1ciRV` | `claude/wsf-north-star-canonical` @ `4fe51f0`; integrates to `#365` / `#392` | manifest, INDEX, this brief, integration | Board 01 candidate + Boards 02–05 + INDEX (**landed** at `4fe51f0`) | EXECUTING | — | visual review of 00–05 |
| W1 | CCR `session_01YA6WdVgb2NJosUL3Mu9D6n` | `claude/wsf-sprint-north-star-home` from `d072aa6` | `board-01/**`, `north-star/board-01.mjs` | the two Round-2 corrections on the existing candidate: stale as TARGET / NOT IMPLEMENTED inset; seam split into #390 name+role vs NOT AUTHORIZED named movement; Round-3 clarification delivered 18:33Z (targets may be composed from the exact assets; "photograph-only" wording softened) | EXECUTING (running since 18:21Z) | — | Board 01 precision review |
| W2 | CCR `session_01KqnSmxM55Y5FXUe53kmD6V` — re-scoped by Round 3 (`5781782947` §3) to **visual evidence auditor** | `claude/wsf-sprint-north-star-core` from `e29b9ec` | `north-star-final/review-audit-w2/**` only; boards, renderer, manifest, frozen evidence read-only | independent property-by-property visual audit of Boards 00–05 + INDEX against their locks and both owner boards; verdict per board with crops; recommends, does not clear the gate | SENT 18:28Z | — | Program Director's visual review of 00–05 |
| W3 | CCR `session_01J1CepL52CKS8SqaGSZFfLc` | `claude/wsf-sprint-email-staging` from `cb91d78`; **owns the #393 reporter fix** (branch `claude/wsf-staging-mail-binding` handed off by L0 at Round 2) | `.github/wsf-staging/report-mail-binding.mjs`, its tests, `docs/wsf-staging/EMAIL-ACCEPTANCE-OPERATOR-HANDOFF.md` | (a) the four #393 corrections in `5781526728` with focused regressions — EXECUTING on the #393 branch; (b) reachability probe — **NOT REACHABLE**, same three 403s as the lead (PR #396 `514d450`); (c) operator handoff — delivered | CHECKPOINT-READY on the #396 packet; EXECUTING on #393 | staging hosts denied by policy in every Claude container measured | #393 independent re-review by W5 → recorded merge |
| W4 | CCR `session_014VhZAgvNzjfA9ahZas8eX5` | `claude/wsf-sprint-member-journey` from `e609c57` (#365) | `tests-e2e/sprint-w4-*.spec.ts`, `review/sprint-w4-member-journey/**` | Join acceptance package + journey regression on `e609c57`; verify retry fix; #390 scratch-integration PLAN (local trial only) | ACKNOWLEDGED → EXECUTING — PR #394 (`ea84cc9`); functions built, web bundle building | — | lead assigns any proved defect as a bounded patch |
| W5 | CCR `session_01G4FfDv5vKhCNNkSg3JgXGL` | `claude/wsf-sprint-independent-qa` from `e609c57` | `tests-e2e/sprint-w5-*.spec.ts`, `tests/callable/sprint-w5-*.test.ts` | independent #393 review with mutations (now: verify W3's corrections, not a second implementation) → then identity/pending/visibility/short-phone QA | ACKNOWLEDGED → EXECUTING — PR #395 (`1395401`) | — | Program Director closes #393 review |

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
