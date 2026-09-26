# WSF control state: the decision ledger

The WSF program keeps its orchestration decisions in an append-only ledger. The ledger records:
- which packet is released to whom;
- what was delivered, reviewed, accepted and integrated;
- how each packet's post-integration proof or staging went;
- the GitHub object that authorized or proves each step.

Tools derive everything else from it. The tooling is `tools/wsf-control/`. The data will live on the `wsf-control-state` branch, which does not exist yet: 1B creates it and bootstraps the current state.

## What the ledger is, and what it is not

| The ledger holds | GitHub holds (never copied into the ledger) |
| --- | --- |
| Decisions and recorded facts: queue, release, deliver, review, finding, accept, integrate, proof, stage, block, withdraw | PR state, titles and bodies |
| Typed references: comment ids, PR numbers, commit SHAs, workflow run ids | CI and check results, run logs |
| The repository, the control surfaces (control inbox, CURRENT comment), the canonical and staging pointers | Comment text and review prose |
| Per-worker ordered queues and canonical inboxes | Whether a PR is merged or closed, its current head, a run's conclusion |

When the two disagree:
- **On a fact, GitHub wins.** Examples: a head, a merge, a close, a run conclusion, the served SHA, a check-in's state. Reconcile reports the fact, and a writer records it.
- **On a decision, the ledger wins.** A release, a review or an acceptance happened only if the ledger records it. Nothing is inferred from GitHub.

Free text is limited to three fields: `label`, and a blocker's `condition` and `unblockWhen`. Each is a single line of 200 characters or fewer. Every string in an event, a state or a snapshot is screened for secret- and PII-shaped content, and a match refuses the whole event without echoing the value. The screen catches:
- API keys and private keys;
- OAuth, GitHub and bearer tokens;
- JWTs;
- secret query parameters;
- email addresses;
- URLs.

## Writers and sources

**Writers are closed.** Only `Fable` and `L0` write the ledger, and `append.mjs` refuses any other actor. Workers (W3, W7, …) own packets, and their GitHub comments can be the *source* of an event. A worker never writes its own state, so it can never mark its delivery accepted or reorder its queue.

**Every event carries a typed source.** The source is `{ "kind": "comment" | "pull_request" | "commit" | "workflow_run", "id": <number, or a 40-hex SHA for a commit>, "repo": "<owner/repo>" }`. It holds no URLs, and its repo must be the controlled repository.

| Event | May rest on |
| --- | --- |
| `bootstrap`, `set-canonical`, `set-surfaces`, `register-worker`, `queue`, `reorder-queue`, `release`, `review`, `finding`, `accept`, `block`, `unblock`, `withdraw`, `set-critical-path` | a comment (a decision) |
| `ack`, `deliver` | a comment (normally the worker's own) |
| `integrate` | a pull_request or commit (the merge); it also carries `acceptance`, the comment id that accepted the packet |
| `begin-proof`, `proof-pass`, `stage`, `set-staging` | a workflow_run or a comment |
| `proof-fail` | a comment only: the focused finding that turns a failed run into work |
| `reconcile-head` | a pull_request or commit |
| `record-evidence` | a commit, pull_request or comment |

A run result never grants acceptance or release.

## Identity and retries

Each event has an identity, `id = sha256(canonical {schema version, type, subject packet/worker, source})`, which `append.mjs` computes.

| Situation | What `append.mjs` does |
| --- | --- |
| The same identity, with the same payload, is already recorded | **No-op** (`APPEND=noop`). It returns the current head and writes nothing. This is how a retry after an uncertain push discovers that its event already landed, whatever head the writer holds. |
| The same identity with a different payload | A hard **conflict**, refused. |
| One comment carries two different decisions | Allowed when their identities differ, for example a release of one packet and the queueing of another. |
| `--expect-head` is not the current head | **Refused.** The writer re-fetches and reconciles. The flag is required, with 64 zeros for an empty ledger. |

The ledger itself refuses a line whose `id` is not its identity, or an identity recorded twice.

## Files

| File | What it is |
| --- | --- |
| `events.jsonl` | **Input.** One event per line. `seq` counts from 1, and `prev` is the sha256 of the previous line's exact text (64 zeros for line 1). Editing, removing, reordering or concurrently appending a line breaks the chain, and the whole ledger is refused. |
| `state.json` | **Derived.** Exactly `serialize(reduce(events.jsonl))`. It is never hand-edited, and `check.mjs` refuses it when it differs by a byte. |
| `CURRENT.md` | **Derived.** The human view. Its first line embeds the ledger head, and `--verify` reports it `current`, `stale` or `hand-edited`. |

## Genesis: bootstrap, not backfill

Line 1 is always a `bootstrap` and nothing else can be. It records:
- the repository and an `asOf` instant;
- the surfaces, workers and queues;
- optionally the canonical and staging pointers and the critical path;
- the **current** packets.

Each imported packet carries its current phase and the GitHub refs that support it (`refs`, plus `releasedBy` and `acceptedBy` where they apply), and is marked `origin: "bootstrap"`. The schema has no field for a past transition or a timestamp, so a bootstrap cannot claim a history it never saw.

The import must pass every normal invariant. After line 1, every line is an event that actually happened. CURRENT says the state was imported as of `asOf`.

1B therefore *bootstraps the current state*; it does not backfill historical events.

## The packet

```
owner, kind (work|reference), completion {terminal, proofType}, origin (ledger|bootstrap), label,
phase, phaseBeforeBlock, inbox, pr, reviewers, subjectPaths, blockedBy, importRefs,
artifact {subjectSha, prHeadSha, evidenceSha, mergeSha}, proof {type, runId, result, evidenceRef?}, staged {runId, servedSha},
authority {queued, released, accepted, lastTransition}  (each a {kind, id} ref)
```

`artifact` separates what used to be a single "head":

| Field | What it is | What moves it |
| --- | --- | --- |
| `subjectSha` | The thing a review or acceptance applies to. | Only `deliver`. A successor delivery moves it. |
| `prHeadSha` | The PR's current head: a reconciled GitHub fact. | `deliver`, or `reconcile-head`. |
| `evidenceSha` | An optional evidence or doc head. It never substitutes for acceptance. | `deliver`, or `record-evidence`. |

`accept` must name the current `subjectSha`, so accepting an evidence head is refused.

`subjectPaths` defaults to `*`, the whole tree.

## Completion contract and phases

Every packet declares how it completes. A packet is **never** inferred complete from what it is not, such as "non-staged".

| `completion.terminal` | `proofType` | The packet is done at |
| --- | --- | --- |
| `INTEGRATED` | `source-only` | its merge |
| `VERIFIED` | `journey-activation` or `hosted` | a passed post-integration proof |
| `STAGED` | `hosted` | verified staging |

```
QUEUED ─release→ RELEASED ─ack→ ACKED ─deliver→ DELIVERED ─review→ UNDER_REVIEW
DELIVERED|UNDER_REVIEW ─finding→ CHANGES_REQUESTED ─deliver→ DELIVERED
DELIVERED|UNDER_REVIEW ─accept→ ACCEPTED ─integrate→ INTEGRATED
INTEGRATED ─begin-proof(runId, proofType)→ VERIFYING ─proof-pass(runId)→ VERIFIED
                                            VERIFYING ─proof-fail(runId; finding comment)→ CHANGES_REQUESTED
INTEGRATED|VERIFYING ─stage(runId, servedSha)→ STAGED
any non-terminal ─block→ BLOCKED ─unblock→ the phase before the block
any non-terminal ─withdraw→ WITHDRAWN
```

These rules hold:
- `begin-proof` must name the contract's `proofType`.
- `proof-pass` is legal only for a `VERIFIED` contract, and `stage` only for a `STAGED` one.
- A packet that completes at STAGED cannot be marked VERIFIED instead.
- After `proof-fail` the worker owns the packet again. The corrective delivery may come on a new PR, because the old one is merged.
- **Terminal:** the packet's own `completion.terminal`, or WITHDRAWN.
- **Worker-owned:** RELEASED, ACKED, CHANGES_REQUESTED. A worker holds at most one worker-owned work packet.
- **Reviewer-owned:** DELIVERED, UNDER_REVIEW.
- ACCEPTED, INTEGRATED and VERIFYING are L0's. They do not keep a worker's WATCH on.

## Invariants (`check.mjs`)

- The ledger reduces cleanly: every line is schema-valid, a writer's, chained, identified and legal.
- `state.json` is exactly its reduction.
- A worker holds at most one worker-owned work packet.
- Each queue holds exactly its owner's QUEUED packets, each once. A released packet cannot be queued again.
- A release is handed off only in the owner's canonical inbox.
- A VERIFYING packet has a running proof.
- Every artifact SHA is 40-hex.
- The critical path exists, is not terminal and is not a reference.
- Nothing secret-, PII- or URL-shaped appears anywhere.

## WATCH, ACTIONABLE and MONITOR

- **`WATCH`** (from `worker-view`) is derived per worker and never stored.
  - It is on only while the worker holds a worker-owned work packet, or has delivered work awaiting review.
  - Blocked, reference and queued packets never turn it on.
  - A worker's own check-in may disable itself while it is off.
  - NEXT is the first work packet in queue order.
- **`ACTIONABLE`** (from `program-view`) is on when some transition, handoff or update is needed now: a `NEEDS_TRANSITION` or a reconcile finding.
- **`MONITOR`** is always `on` in v1.
  - One lightweight, repo-native global Fable heartbeat stays enabled even when `ACTIONABLE=off`. When all work is blocked and every worker is off, a dependency that clears is still noticed: `program-view` then lists the `unblock`, with `reactivates=W#`.
  - The ChatGPT hourly task is not this heartbeat.
  - Only a separately accepted event mechanism, recorded as a new versioned decision, may change MONITOR.

## The GitHub snapshot (the input to reconcile)

The session builds a minimal snapshot before acting. It holds pointers and closed values only, and unknown keys are refused.

```json
{
  "schemaVersion": 1,
  "prs": { "520": { "state": "open", "merged": false, "headSha": "<40>", "changedSinceSubject": ["path/a"] } },
  "runs": { "54": { "status": "completed", "conclusion": "failure" } },
  "inboxHandoffs": [ { "inbox": 396, "commentId": 123, "packet": "PACKET-ID" } ],
  "currentSurface": { "commentId": 456, "exists": true, "markerHead": "<64-hex from the comment's first line, or null>" },
  "pin": { "approvedAppSha": "<40>" },
  "staging": { "servedSha": "<40>" },
  "triggers": { "W3": { "enabled": true } },
  "externalConditions": { "OWNER-DEVICE": false }
}
```

- `prs`: a merged PR carries `mergeSha`. `changedSinceSubject` lists the paths changed between the packet's `subjectSha` and the current head.
- `runs`: `conclusion` is null until the run completes.

## Reconcile findings

| Finding | Wins | Meaning |
| --- | --- | --- |
| `pr-head-moved` | github | The head differs from `prHeadSha`. Suggests `reconcile-head`. |
| `subject-stale` | ledger | A changed path is inside `subjectPaths`. The phase applies to the old subject until a successor `deliver`. |
| `evidence-moved` | github | Only paths outside `subjectPaths` changed, so the subject stands. Suggests `record-evidence`. |
| `subject-change-unknown` | github | The snapshot has no `changedSinceSubject`. The finding is reported as unknown, never guessed. |
| `pr-merged-not-integrated` | github | The PR merged while the packet is ACCEPTED. Suggests `integrate` with the acceptance id. |
| `pr-merged-without-acceptance` | ledger | The PR merged with no acceptance recorded. No acceptance is inferred. |
| `merge-drift` | github | GitHub's merge SHA differs from the recorded one. |
| `pr-closed-not-withdrawn` | ledger | The PR closed unmerged. Withdrawing or redelivering is a decision. |
| `pr-not-in-snapshot` / `run-not-in-snapshot` | github | There are no facts for this PR or proof run, so nothing about it was reconciled. |
| `proof-run-concluded` | github | The ledger says RUNNING but the run concluded. Suggests `proof-pass`/`stage` on success, or `proof-fail` through a finding comment. |
| `proof-result-drift` | github | The ledger's PASS or FAIL contradicts the run's conclusion. Reported, never silently corrected. |
| `handoff-without-packet` / `handoff-outside-canonical-inbox` / `handoff-not-recorded` | ledger | A handoff comment the ledger does not account for. |
| `control-surface-exception` | exception | The CURRENT comment is not in the snapshot, is not the recorded comment, is missing, has no marker, or carries a head this ledger never had. The check fails closed: no edit, and no silent replacement. |
| `pin-mismatch` / `staging-mismatch` / `staging-pointer-missing` | github | The staging pointer disagrees with the pin or with what is served. |
| `watch-on-without-work` / `work-without-watch` / `trigger-for-unknown-worker` | github | A check-in disagrees with the derived WATCH. |
| `queue-phase-inconsistent` | ledger | A supplied state breaks an invariant. Reported, never repaired. |

Reconcile is a pure function. It never mutates its inputs, writes, posts or appends.

## Commands

All of them run from the repository root and need only Node, with no dependencies.

```sh
node tools/wsf-control/check.mjs <dir>                                          # CONTROL_STATE=valid|invalid
node tools/wsf-control/append.mjs <dir> <event.json> --expect-head <ledgerHead>
                                                                                # APPENDED … | APPEND=noop … | APPEND=refused (nothing written)
node tools/wsf-control/reconcile.mjs <dir> <snapshot.json>                      # FINDING … / CURRENT_SURFACE=… / RECONCILE findings=N
node tools/wsf-control/worker-view.mjs <dir> W3                                 # ACTIVE_NOW / AWAITING_REVIEW / NEXT / WATCH / AUTHORITY
node tools/wsf-control/program-view.mjs <dir> [--snapshot <file>]               # CRITICAL_PATH / NEEDS_TRANSITION / … / ACTIONABLE / MONITOR
node tools/wsf-control/render-current.mjs <dir> [--out <file> | --verify <file>]
node tools/wsf-control/run-all.mjs                                              # the regression suite
```

Every view refuses to run on a state that does not check. None of them makes a judgment, posts, merges, deploys or changes state.

## Event fields

| Type | Fields (optional in brackets) |
| --- | --- |
| `bootstrap` | `repository`, `asOf`, `surfaces`, `workers`, `queue`, `packets`, [`canonical`, `staging`, `criticalPath`] |
| `set-canonical` | `developmentBranch`, `developmentSha`, `operationalMain` |
| `set-staging` | `servedSha`, `runId`, `runNumber`, `rollbackSha`, [`pinPr`] |
| `set-surfaces` | `surfaces`: `{controlInbox: {pr}, current: {pr, commentId}}` |
| `register-worker` | `worker`, `inbox` |
| `queue` | `packet`, `owner`, `completion`, [`kind`, `subjectPaths`, `label`] |
| `reorder-queue` | `owner`, `order` |
| `release` | `packet`, `inbox` |
| `ack` / `finding` / `unblock` / `withdraw` / `set-critical-path` | `packet` |
| `deliver` | `packet`, `pr`, `subjectSha`, [`prHeadSha`, `evidenceSha`] |
| `review` | `packet`, `reviewers` |
| `accept` | `packet`, `subjectSha` |
| `integrate` | `packet`, `mergeSha`, `acceptance` |
| `begin-proof` | `packet`, `runId`, `proofType` |
| `proof-pass` / `proof-fail` | `packet`, `runId`, [`evidenceRef`: `{kind: workflow_run/artifact, id}`] |
| `stage` | `packet`, `runId`, `servedSha` |
| `block` | `packet`, `blockedBy`: `[{packet, until: ACCEPTED/INTEGRATED/VERIFIED/STAGED}]` or `[{external, condition, owner, unblockWhen}]` |
| `reconcile-head` | `packet`, `prHeadSha` |
| `record-evidence` | `packet`, `evidenceSha` |

Every event also carries `actor` (`Fable` or `L0`) and `source`.

## Not in 1A

- Creating `wsf-control-state`, or bootstrapping it (1B).
- Moving any check-in or trigger onto the views (1C).
- Any cloud action.

The ledger never authorizes a merge or deploy, and never product- or pixel-accepts. Those stay human and L0 decisions, recorded after the fact.

The procedure for a session is `.claude/skills/wsf-program-director/SKILL.md`. The staging release itself is in `skills/wsf-staging-deploy/SKILL.md` and `.github/wsf-staging/CONTROL-PLANE.md`.
