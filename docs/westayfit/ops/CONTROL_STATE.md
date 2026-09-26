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
| Decisions and recorded facts: queue, release, retract-release, transfer-owner, deliver, review, review-pass, reassign-review, finding, accept, integrate, proof, stage, block, withdraw | PR state, titles and bodies |
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
| `bootstrap`, `set-canonical`, `set-surfaces`, `register-worker`, `queue`, `reorder-queue`, `release`, `retract-release`, `transfer-owner`, `review`, `reassign-review`, `finding`, `accept`, `block`, `unblock`, `withdraw`, `set-critical-path` | a comment (a decision) |
| `ack`, `deliver` | a comment (normally the worker's own) |
| `review-pass` | a comment (the reviewer's own PASS) |
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
artifact {subjectSha, prHeadSha, evidenceSha, mergeSha}, proof {type, runId, result, evidenceRef?}, served {runId, servedSha},
releasedQueueIndex, reviewedBy,
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
QUEUED ─release→ RELEASED ─ack(worker)→ ACKED ─deliver→ DELIVERED ─review→ UNDER_REVIEW
RELEASED ─retract-release→ QUEUED   (before ACK only; back to its queue position)
ACKED|CHANGES_REQUESTED ─transfer-owner(owner, inbox)→ RELEASED   (to the new owner, who must ACK)
UNDER_REVIEW ─review-pass(reviewer)→ UNDER_REVIEW;  UNDER_REVIEW ─reassign-review(reviewers)→ UNDER_REVIEW
DELIVERED|UNDER_REVIEW ─finding→ CHANGES_REQUESTED ─deliver→ DELIVERED
DELIVERED|UNDER_REVIEW ─accept→ ACCEPTED ─integrate→ INTEGRATED   (from UNDER_REVIEW, only once every W# reviewer passed)
INTEGRATED ─begin-proof(runId, proofType)→ VERIFYING ─proof-pass(runId)→ VERIFIED | STAGED
                                            VERIFYING ─proof-fail(runId; finding comment)→ CHANGES_REQUESTED
VERIFYING ─stage(runId, servedSha)→ VERIFYING   (STAGED contracts: the deployment receipt; never completes)
any non-terminal ─block→ BLOCKED ─unblock→ the phase before the block
any non-terminal ─withdraw→ WITHDRAWN
```

These rules hold:
- A QUEUED packet may be blocked, for example a NEXT that waits on an owner decision or on the ACTIVE packet's integration. While blocked it leaves its owner's driving queue, so it is never presented as NEXT and nothing asks for its release. Its position is remembered (`queueIndexBeforeBlock`), and `unblock` restores it to QUEUED at the same relative position; a packet imported as blocked from QUEUED returns at the end of the queue. If the restore would give the worker a second queued work packet, the `unblock` is refused.
- **A packet blocker must be able to clear (O7).** Its `until` must be a milestone the dependency's completion contract reaches: `ACCEPTED` or `INTEGRATED` for any contract, `VERIFIED` only for a VERIFIED contract, `STAGED` only for a STAGED one. An impossible `until`, a self-block, a missing dependency or a withdrawn one is refused by `block` and by a bootstrap import, and `check.mjs` refuses any state that carries one. A blocker clears only when the dependency has **reached that milestone**: being terminal alone never clears it (a STAGED packet does not satisfy `VERIFIED`). VERIFYING counts as INTEGRATED; a failed proof sends the dependency back, and it no longer counts.
- **An unblock reactivates whoever holds the restored ball (O6).** Restored to RELEASED, ACKED or CHANGES_REQUESTED, that is the owner. Restored to UNDER_REVIEW, it is the W# reviewers that have not yet passed, never the implementation owner. Restored to QUEUED or DELIVERED, it is no one: DELIVERED waits for Fable to route the review. The restore is refused if it would give a reviewer or owner a second ball.
- `begin-proof` must name the contract's `proofType`.
- `stage` is the **deployment receipt** only. It is legal only for a `STAGED` contract, inside a running hosted proof (VERIFYING), for the same run (`runId === proof.runId`), and only when the served SHA is the packet's integrated subject (`servedSha === mergeSha`). It records `served {runId, servedSha}` and never changes the phase or the proof.
- `proof-pass` completes the packet at its contract's terminal (VERIFIED or STAGED). For a `STAGED` contract it needs the served receipt of the same run first, so a STAGED packet completes only on **hosted verified**, after the deployment was recorded.
- A packet that completes at STAGED cannot be marked VERIFIED instead.
- **Retraction (`retract-release`):** a newer authorized hold before the worker ACKs returns a RELEASED packet to QUEUED at its original relative queue position (`releasedQueueIndex`, recorded by `release`). The release stays in the ledger as history. It is refused after ACK, for a packet that reached RELEASED by transfer, and when a different work packet has taken NEXT meanwhile (one NEXT).
- **ACK names its worker:** `ack` carries `worker`, and it must be the packet's current owner.
- **Owner transfer (`transfer-owner`):** a worker's death after ACK or after CHANGES_REQUESTED moves the packet to a registered, different worker, handed off in that worker's canonical inbox. PR, subject, evidence and history stay; the packet returns to RELEASED, so the new owner must ACK afresh and the old owner's WATCH turns off. The one-ball rule applies to the new owner. A death before ACK uses `retract-release` instead.
- **Reviewer completion (`review-pass`):** an assigned W# reviewer's independent PASS releases that reviewer's ball (`reviewedBy`). It is not acceptance and never changes the phase or subject. A reviewer passes once per review cycle. `accept` from UNDER_REVIEW is refused until every assigned W# reviewer has passed; Director, Owner, Fable and L0 reviewers need no pass. A `finding` or a hosted `proof-fail` ends the cycle and clears the passes, so a successor delivery needs fresh passes.
- **Reviewer replacement (`reassign-review`):** replaces the reviewer set of an UNDER_REVIEW packet (a reviewer died, retired or must be replaced). The new set is checked like a `review` (registered, free, never the owner); passes of retained reviewers are kept, passes of removed ones are dropped. The original review stays in the ledger as history.
- After `proof-fail` the worker owns the packet again. The corrective delivery may come on a new PR, because the old one is merged.
- **Terminal:** the packet's own `completion.terminal`, or WITHDRAWN.
- **Worker-owned:** RELEASED, ACKED, CHANGES_REQUESTED. A worker holds at most one worker-owned work packet.
- **Reviewer-owned:** DELIVERED, UNDER_REVIEW. The implementer is waiting, not holding the ball. A DELIVERED packet wakes no worker: `program-view` asks Fable to route the `review`. During UNDER_REVIEW the ball is with each assigned **W#** reviewer; a Director, Owner, Fable or L0 reviewer is not a worker and wakes no one. A `finding` hands the ball back to the owner (CHANGES_REQUESTED), and `accept` leaves both off (integration is L0's).
- ACCEPTED, INTEGRATED and VERIFYING are L0's. They do not keep a worker's WATCH on.

## Invariants (`check.mjs`)

- The ledger reduces cleanly: every line is schema-valid, a writer's, chained, identified and legal.
- `state.json` is exactly its reduction.
- A worker holds at most one worker-owned work packet.
- Each queue holds exactly its owner's QUEUED packets, each once. A released packet cannot be queued again.
- **Independent review:** a W# implementation owner never reviews its own work packet. A `review` naming the owner is refused, and so is a bootstrap import of an UNDER_REVIEW packet its owner reviews. Director, Owner, Fable and L0 reviews are unaffected.
- **One ball per worker:** a worker holds at most one ball in total across implementation and review. It cannot hold an active implementation packet (RELEASED, ACKED, CHANGES_REQUESTED) and an UNDER_REVIEW assignment at once. A `review` naming a worker with active work is refused, and so is a `release` to a worker that is reviewing. A reviewing worker may keep one queued NEXT, but `program-view` does not suggest releasing it until the review leaves the worker. A `finding` that would hand work back to an owner who is reviewing is likewise refused until one of the two moves.
- **One review per W# reviewer:** a W# reviewer holds at most one UNDER_REVIEW work packet, as an implementer holds one ACTIVE. A `review` that would give a busy reviewer a second is refused, and the packet stays DELIVERED (and ACTIONABLE) until that reviewer is free or another is chosen. Several reviewers on one packet are fine when each is free. A W# reviewer must be a registered worker.
- **One NEXT:** a worker has at most one queued work packet (ops v1.2). Reference packets are exempt and never become NEXT. `append` refuses a second queued work packet, and so does a bootstrap import, so no valid state can hide one.
- A release is handed off only in the owner's canonical inbox.
- A VERIFYING packet has a running proof.
- **Review passes belong to the current cycle:** `reviewedBy` names only assigned reviewers, and is empty whenever the ball is with the owner or the packet awaits a review (RELEASED, ACKED, DELIVERED, CHANGES_REQUESTED, including while blocked from one of them).
- Every artifact SHA is 40-hex.
- The critical path exists, is not terminal and is not a reference.
- Nothing secret-, PII- or URL-shaped appears anywhere.

## WATCH, ACTIONABLE and MONITOR

- **`WATCH`** (from `worker-view`) is derived per worker and never stored.
  - It is on only while the worker holds the ball: a work packet it owns in a worker-owned phase, or an UNDER_REVIEW work packet it is assigned to review and has not yet passed (`review-pass`).
  - Its own delivered packet waiting on someone else's review does not keep it on (`worker-view` lists it as `WAITING`).
  - Blocked, reference and queued packets never turn it on.
  - A worker's own check-in may disable itself while it is off.
  - NEXT is the worker's one queued work packet, if any.
- **`ACTIONABLE`** (from `program-view`) is on when some transition, handoff or update is needed now: a `NEEDS_TRANSITION` or a reconcile finding.
- `program-view` also lists every UNDER_REVIEW packet: `AWAITING_REVIEW <id> pending=<W#…> [passed=<W#…>]` while assigned W# reviews are outstanding, then `AWAITING_ACCEPTANCE <id> subject=<sha> [passed=…]` once all have passed. These are informational and do not make it ACTIONABLE.
- **`MONITOR`** is always `on` in v1.
  - One lightweight, repo-native global Fable heartbeat stays enabled even when `ACTIONABLE=off`. When all work is blocked and every worker is off, a dependency that clears is still noticed: `program-view` then lists the `unblock`, with `reactivates=` naming whoever holds the restored ball (the owner, or the outstanding W# reviewers of an UNDER_REVIEW packet).
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
  "currentSurface": { "commentId": 456, "exists": true, "markerHead": "<64-hex from the comment's first line, or null>", "bodySha256": "<sha256 of the exact body, or null when unavailable>" },
  "pin": { "approvedAppSha": "<40>" },
  "staging": { "servedSha": "<40>" },
  "triggers": { "W3": { "enabled": true } },
  "externalConditions": { "OWNER-DEVICE": false }
}
```

- `prs`: a merged PR carries `mergeSha`. `changedSinceSubject` lists the paths changed between the packet's `subjectSha` and the current head.
- `runs`: `conclusion` is null until the run completes.

The `currentSurface` entry is built by `current-surface.mjs` from the comment body as fetched (CRLF normalised to LF), never by hand. `bodySha256` is required whenever the ledger configures a CURRENT surface: a missing, null or malformed hash is `CURRENT_SURFACE=exception`, never `ok` or `stale`. A stale repair therefore overwrites only a body whose hash verifies as a rendering this ledger produced.

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
| `proof-run-concluded` | github | The ledger says RUNNING but the run concluded. Suggests, on success, `stage` for a STAGED packet whose served receipt for that run is missing, otherwise `proof-pass`; or `proof-fail` through a finding comment. |
| `proof-result-drift` | github | The ledger's PASS or FAIL contradicts the run's conclusion. Reported, never silently corrected. |
| `handoff-without-packet` / `handoff-outside-canonical-inbox` / `handoff-not-recorded` | ledger | A handoff comment the ledger does not account for. |
| `current-surface-stale` | ledger | The CURRENT comment carries an earlier head of this ledger: the crash window where the ledger was pushed but CURRENT was not yet edited. `CURRENT_SURFACE=stale` and `ACTIONABLE=on`. The repair is deterministic: render CURRENT from the present checked ledger and edit the configured comment in place. No new comment is created. |
| `control-surface-exception` | exception | The CURRENT comment is not in the snapshot, is not the recorded comment, is missing, has no marker, carries a head this ledger never had, or (when `bodySha256` is given) is not the rendering of the head its marker names: hand-edited, or unverifiable. The check fails closed: no edit, and no silent replacement. |
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
node tools/wsf-control/current-surface.mjs <commentId> <body file>|--missing   # the snapshot's currentSurface entry, from the fetched body
node tools/wsf-control/worker-view.mjs <dir> W3                                 # ACTIVE_NOW / REVIEWING / WAITING / NEXT / WATCH / AUTHORITY
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
| `retract-release` | `packet` |
| `transfer-owner` | `packet`, `owner`, `inbox` |
| `ack` | `packet`, `worker` |
| `finding` / `unblock` / `withdraw` / `set-critical-path` | `packet` |
| `deliver` | `packet`, `pr`, `subjectSha`, [`prHeadSha`, `evidenceSha`] |
| `review` / `reassign-review` | `packet`, `reviewers` |
| `review-pass` | `packet`, `reviewer` |
| `accept` | `packet`, `subjectSha` |
| `integrate` | `packet`, `mergeSha`, `acceptance` |
| `begin-proof` | `packet`, `runId`, `proofType` |
| `proof-pass` / `proof-fail` | `packet`, `runId`, [`evidenceRef`: `{kind: workflow_run/artifact, id}`] |
| `stage` | `packet`, `runId`, `servedSha` |
| `block` | `packet`, `blockedBy`: `[{packet, until: ACCEPTED/INTEGRATED/VERIFIED/STAGED}]` (an `until` the dependency's contract reaches) or `[{external, condition, owner, unblockWhen}]` |
| `reconcile-head` | `packet`, `prHeadSha` |
| `record-evidence` | `packet`, `evidenceSha` |

Every event also carries `actor` (`Fable` or `L0`) and `source`.

## Not in 1A

- Creating `wsf-control-state`, or bootstrapping it (1B).
- Moving any check-in or trigger onto the views (1C).
- Any cloud action.

The ledger never authorizes a merge or deploy, and never product- or pixel-accepts. Those stay human and L0 decisions, recorded after the fact.

The procedure for a session is `.claude/skills/wsf-program-director/SKILL.md`. The staging release itself is in `skills/wsf-staging-deploy/SKILL.md` and `.github/wsf-staging/CONTROL-PLANE.md`.
