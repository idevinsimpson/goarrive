# WSF control state: the decision ledger

The WSF program keeps its orchestration decisions in an append-only ledger. The ledger records which packet is released to whom, what was delivered, reviewed, accepted, integrated and staged, and which GitHub comment authorized each step. Tools derive everything else from it.

The tooling lives in `tools/wsf-control/`. The data lives on the `wsf-control-state` branch, which does not exist yet: 1B creates and seeds it.

## What the ledger is, and what it is not

| The ledger holds | GitHub holds (never copied into the ledger) |
| --- | --- |
| Decisions: queue, release, deliver, review, finding, accept, integrate, stage, block, withdraw | PR state, titles and bodies |
| Pointers: PR numbers, 40-hex SHAs, the GitHub comment id that authorized each decision | CI and check results |
| The canonical development and operational pointers, and the staging pointer | Comment text and review prose |
| Per-worker ordered queues and canonical inboxes | Whether a PR is merged or closed, and its current head |

When the two disagree:
- **On a fact, GitHub wins.** Examples: a PR head, a merge, a close, the served SHA, a check-in's enabled state. Reconcile reports the fact, and a decision-maker records it.
- **On a decision, the ledger wins.** A release, a review or an acceptance happened only if the ledger records it. A GitHub comment that looks like a handoff is reported, never inferred into state.

Free text is limited to three fields: `label`, and a blocker's `condition` and `unblockWhen`. Each is a single line of 200 characters or fewer. Every string in an event, a state or a snapshot is screened for secret- and PII-shaped content, and a match refuses the whole event without echoing the value. The screen catches:
- API keys;
- private keys;
- OAuth, GitHub and bearer tokens;
- JWTs;
- secret query parameters such as `oobCode`;
- email addresses.

## Files

On the state branch:

| File | What it is |
| --- | --- |
| `events.jsonl` | **Input.** One event per line. `seq` counts from 1, and `prev` is the sha256 of the previous line's exact text (64 zeros for the first). Editing, removing, reordering or concurrently appending a line breaks the chain, and the whole ledger is refused. |
| `state.json` | **Derived.** Exactly `serialize(reduce(events.jsonl))`. It is never hand-edited, and `check.mjs` refuses it when it differs by a single byte. |
| `CURRENT.md` | **Derived.** The human view, rendered by `render-current.mjs`. Its first line embeds the ledger head, and `--verify` reports it `current`, `stale` or `hand-edited`. |

## The packet

```
owner, kind (work|reference), track (product|ops), label, phase, phaseBeforeBlock,
inbox, pr, reviewers, subjectPaths, blockedBy, authority {queued, released, lastTransition},
artifact {subjectSha, prHeadSha, evidenceSha}
```

`artifact` separates three things that used to be one "head":

| Field | What it is | What moves it |
| --- | --- | --- |
| `subjectSha` | The thing a review or acceptance applies to. | Only `deliver`. A successor delivery moves it. |
| `prHeadSha` | The PR's current head: a reconciled GitHub fact. | `deliver`, or `reconcile-head`. |
| `evidenceSha` | An optional evidence or doc head. It never substitutes for acceptance. | `deliver`, or `record-evidence`. |

`accept` must name the current `subjectSha`, so accepting an evidence head is refused.

`subjectPaths` defaults to `*`, the whole tree. Reconcile uses it to decide whether a PR-head move changed the reviewed subject.

## Phases

```
QUEUED ─release→ RELEASED ─ack→ ACKED ─deliver→ DELIVERED ─review→ UNDER_REVIEW
DELIVERED|UNDER_REVIEW ─finding→ CHANGES_REQUESTED ─deliver→ DELIVERED
DELIVERED|UNDER_REVIEW ─accept→ ACCEPTED ─integrate→ INTEGRATED ─stage→ STAGED (product track)
any non-terminal ─block→ BLOCKED ─unblock→ the phase before the block
any non-terminal ─withdraw→ WITHDRAWN
```

- **Worker-owned** (the worker holds the ball): RELEASED, ACKED, CHANGES_REQUESTED. A worker holds at most one worker-owned work packet.
- **Reviewer-owned** (the worker waits on a near-term review): DELIVERED, UNDER_REVIEW.
- **Terminal:** STAGED, WITHDRAWN, and INTEGRATED for an ops-track packet. The critical path can never point at a terminal or reference packet. It clears when its packet completes.

## Invariants (`check.mjs`)

- The ledger reduces cleanly: every line is schema-valid, chained and legal.
- `state.json` is exactly its reduction.
- A worker holds at most one worker-owned work packet.
- Every queued id exists, is QUEUED, belongs to that worker and appears once. A released packet cannot be queued again.
- A release is handed off only in the owner's canonical inbox.
- Every artifact SHA is 40-hex.
- The critical path exists, is not terminal and is not a reference.
- Nothing secret- or PII-shaped appears anywhere in the state.

## WATCH

`WATCH` is derived, never stored or set. It is on only while the worker holds a worker-owned work packet, or has delivered work awaiting review. A blocked packet, a reference packet or a queued packet never turns it on.

NEXT is the first work packet in the worker's queue order.

## The GitHub snapshot (the input to reconcile)

The session builds a minimal snapshot from GitHub before acting. It holds pointers and booleans only; unknown keys such as titles, bodies or CI text are refused.

```json
{
  "schemaVersion": 1,
  "prs": { "520": { "state": "open", "merged": false, "headSha": "<40>", "changedSinceSubject": ["path/a", "path/b"] } },
  "inboxHandoffs": [ { "inbox": 396, "commentId": 123, "packet": "PACKET-ID" } ],
  "pin": { "approvedAppSha": "<40>" },
  "staging": { "servedSha": "<40>" },
  "triggers": { "W3": { "enabled": true } },
  "externalConditions": { "OWNER-DEVICE": false }
}
```

- `prs`: one entry for each PR a live packet names.
  - A merged PR carries `mergeSha`.
  - `changedSinceSubject` lists the paths changed between the packet's `subjectSha` and the current head.
- `inboxHandoffs`: the comments in a canonical inbox that hand a packet to its worker.
- `pin`: read from `.github/wsf-staging/approved-candidate.json` on operational main.
- `staging`: read from the served marker.
- `triggers`: each worker's check-in state.
- `externalConditions`: each external blocker's condition, true once it has cleared.

## Reconcile findings

| Finding | Wins | Meaning |
| --- | --- | --- |
| `pr-head-moved` | github | The head differs from `prHeadSha`. Suggests `reconcile-head`. |
| `subject-stale` | ledger | A changed path is inside `subjectPaths`. The current phase applies to the old subject until a successor `deliver`. |
| `evidence-moved` | github | Only paths outside `subjectPaths` changed, so the reviewed subject stands. Suggests `record-evidence`. |
| `subject-change-unknown` | github | The snapshot has no `changedSinceSubject`. The finding is reported as unknown, never guessed. |
| `pr-merged-not-integrated` | github | The PR merged while the packet is ACCEPTED. Suggests `integrate` (L0). |
| `pr-merged-without-acceptance` | ledger | The PR merged with no acceptance recorded. No acceptance is inferred. |
| `pr-closed-not-withdrawn` | ledger | The PR closed unmerged. Withdrawing or redelivering is a decision. |
| `pr-not-in-snapshot` | github | The snapshot has no facts for this PR, so nothing about it was reconciled. |
| `handoff-without-packet` | ledger | A handoff names a packet the ledger does not have. |
| `handoff-outside-canonical-inbox` | ledger | A handoff was posted outside the owner's canonical inbox. |
| `handoff-not-recorded` | ledger | A handoff comment that is none of the packet's recorded authorities. |
| `pin-mismatch` / `staging-mismatch` / `staging-pointer-missing` | github | The staging pointer disagrees with the pin or with what is served. |
| `watch-on-without-work` / `work-without-watch` / `trigger-for-unknown-worker` | github | A check-in's state disagrees with the derived WATCH. |
| `queue-phase-inconsistent` | ledger | A supplied state breaks an invariant. It is reported, never repaired. |

Reconcile is a pure function. It never mutates its inputs, writes, posts or appends.

## Commands

All of them run from the repository root and need only Node, with no dependencies.

```sh
node tools/wsf-control/check.mjs <dir>                                # CONTROL_STATE=valid|invalid
node tools/wsf-control/append.mjs <dir> <event.json> --expect-head <ledgerHead>
                                                                      # APPENDED … | APPEND=refused (nothing written)
node tools/wsf-control/reconcile.mjs <dir> <snapshot.json>            # FINDING … / RECONCILE findings=N
node tools/wsf-control/worker-view.mjs <dir> W3                       # ACTIVE_NOW / AWAITING_REVIEW / NEXT / WATCH / AUTHORITY
node tools/wsf-control/program-view.mjs <dir> [--snapshot <file>]     # CRITICAL_PATH / NEEDS_TRANSITION / … / PROGRAM_WATCH
node tools/wsf-control/render-current.mjs <dir> [--out <file> | --verify <file>]
node tools/wsf-control/run-all.mjs                                    # the regression suite
```

`append.mjs` is the only writer. Each event carries:
- `type`;
- `actor` (Director, L0, Fable or Owner);
- `authority`, the GitHub comment id that authorized the decision;
- the type's own fields.

`append.mjs` assigns `seq` and `prev` itself. It refuses:
- anything that would not reduce;
- anything that breaks an invariant;
- an `--expect-head` that is not the current head. That means another decision was recorded: re-read and reconcile.

Every view refuses to run on a state that does not check. None of them makes a judgment, posts, merges, deploys or changes state.

## Event types

| Type | Fields (optional in brackets) |
| --- | --- |
| `init` | — |
| `set-canonical` | `developmentBranch`, `developmentSha`, `operationalMain` |
| `set-staging` | `servedSha`, `runId`, `runNumber`, `rollbackSha`, [`pinPr`] |
| `register-worker` | `worker`, `inbox` |
| `queue` | `packet`, `owner`, [`track`, `kind`, `subjectPaths`, `label`] |
| `reorder-queue` | `owner`, `order` |
| `release` | `packet`, `inbox` |
| `ack` / `finding` / `unblock` / `withdraw` / `set-critical-path` | `packet` |
| `deliver` | `packet`, `pr`, `subjectSha`, [`prHeadSha`, `evidenceSha`] |
| `review` | `packet`, `reviewers` |
| `accept` | `packet`, `subjectSha` |
| `integrate` | `packet`, `mergeSha` |
| `stage` | `packet`, `runId`, `servedSha` |
| `block` | `packet`, `blockedBy`: `[{packet, until: ACCEPTED/INTEGRATED/STAGED}]` or `[{external, condition, owner, unblockWhen}]` |
| `reconcile-head` | `packet`, `prHeadSha` |
| `record-evidence` | `packet`, `evidenceSha` |

## Not in 1A

- Creating or seeding `wsf-control-state` (1B).
- Moving any check-in or trigger onto `worker-view` (1C).
- Any cloud action. The ledger never authorizes a merge or deploy, and never product- or pixel-accepts: those stay human and L0 decisions, recorded after the fact.

The staging release procedure itself is in `skills/wsf-staging-deploy/SKILL.md` and `.github/wsf-staging/CONTROL-PLANE.md`.
