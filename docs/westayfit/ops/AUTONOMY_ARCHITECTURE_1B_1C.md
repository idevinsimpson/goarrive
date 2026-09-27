# WSF autonomy architecture — 1B/1C consultation memo

Status: **PROPOSAL for Director disposition.** It authorizes nothing. It creates no branch, credential, App, ruleset, workflow or trigger, and changes no check-in.
Date: 2026-09-27.
Packet: AUTONOMY-WRITER-1B/1C-CONSULT (serial plan #365 `5849937256`, step 4). Brief #396 `5849064684` and its twelve addenda.
Governing requirements: `AUTONOMY_ACCEPTANCE_CONTRACT.md` rev 1.1 (this directory) and the 1A ledger contract `CONTROL_STATE.md`.

This memo recommends **one** architecture. It then gives, for every area the brief names:
- the mechanism;
- the rejected alternatives;
- the setup;
- what is machine-testable;
- what stays human;
- how it fails.

---

## 0. The recommendation in one page

**One trusted writer, one event-driven reconcile, wakes delivered through each worker's own canonical inbox.**

1. **Writer.** A dedicated GitHub App (`wsf-control-writer`) is the only identity that can update `wsf-control-state`, enforced by a repository ruleset whose sole bypass actor is that App.
   - Its key lives only in a GitHub environment secret, reachable only by jobs running from `main`.
   - The shared `idevinsimpson` credential cannot write authoritative state.
2. **Reconcile, not command.** One workflow on `main`, `wsf-control-reconcile`, is triggered by GitHub events: inbox comments, PR pushes and merges, and staging `workflow_run` completions, plus a sparse cron fallback.
   - It builds the snapshot itself, runs the 1A `reconcile`, and appends only transitions that a **named derivation rule** allows.
   - A caller can only *ask* for a reconcile; it never supplies the event.
3. **Wakes are App-authored inbox comments.** To hand a worker the ball, the writer records a `wake` event, then posts one structured comment, authored by the App, in that worker's canonical inbox.
   - Each worker session is already subscribed to its own inbox, so the platform delivers the comment into the exact session within seconds (measured, §6.1).
   - The worker's ACK closes the wake. A missed ACK retries once, then becomes a typed control exception.
   - No worker session id or trigger id ever enters the ledger.
4. **Human decisions stay protected.** Owner-only decisions enter only through a `wsf-control-decide` workflow gated by a required-reviewer environment approval.
   - Director and L0 technical decisions keep today's attested path from the control inbox, now labelled as attested.
   - Nothing human-only is ever derived.
5. **Schema v2.** v2 adds exactly three things:
   - an authority/provenance block (class, rule id, evidence refs) on every event;
   - the packet's review policy at genesis;
   - a contract-version pin event.

   Everything else, including freshness, health, WATCH and the metrics, stays a **derived view**, never stored state.
6. **Staging freshness.** It is a derived view.
   - The fast path removes the measured ~56-minute pre-dispatch gap (not the ~7.5-minute deploy) by letting the writer advance a pin held in the ledger and dispatch the **existing** full workflow.
   - GitHub's own concurrency group coalesces the queue.
   - No Hosting-only path.

**Honest residuals, stated up front:**
- (a) GitHub cannot tell Devin, the Director, L0 and any W# apart, because all are `idevinsimpson`. Worker-origin *prose* therefore stays **attested, not authenticated** until each role has a distinct identity. §5 bounds what that residual can affect.
- (b) The writer boundary is exactly as strong as `main`. The shared credential can still merge to `main`, so a malicious change to the writer workflow is **detected** (§4.4) but not **prevented**. Prevention would need a second human-held identity.
- (c) A worker whose session is dead cannot be respawned from GitHub. That case becomes a typed exception, not lost work (§6.4).

---

## 1. What was measured (inputs this design rests on)

| # | Fact | Evidence |
| --- | --- | --- |
| M1 | Every role's GitHub activity is the single user `idevinsimpson`: W#, L0, Fable, the Director and Devin. | brief constraint 1; every comment on #365/#396 |
| M2 | The repository has no rulesets. The worker GitHub tool surface can read repository state but exposes no ruleset, branch-protection or environment-approval write. | brief constraint 2; this session's GitHub tool list has no such action |
| M3 | A comment posted to a subscribed PR/issue is delivered into the subscribed Claude session as an event: comment `5851887587`, posted at 02:14:11Z, was delivered at 02:14:12Z. | this W3 session's notification log |
| M4 | That delivery is best-effort. The next promotion, `5852015191` (02:37:30Z), was **not** observed as a subscription event. The session was woken 3m43s later (02:41:13Z) by an L0-created one-shot trigger bound to this session (`W3 wake: step 4 1B/1C consult`). The platform's own subscription notice says webhook delivery may be late or missing. | this session; `get_trigger` read-back |
| M5 | A session on the owner's account can create, fire, enable and disable a trigger bound to **another** session on the same account (L0 → W3 above). Trigger and session ids are account-scoped locators. Without the account's authority they do nothing; with it, every fleet session can use them. | `get_trigger`, `get_session` read-back; tool contracts |
| M6 | A session's liveness is readable from inside the account (`session_status`, `connection_status`, `status_bucket`). Sessions carry account-private tags, and this worker's session is tagged `worker:W3`. | `get_session` read-back |
| M7 | GitHub Actions has **no measured** interface to wake, create or inspect a Claude session. None is assumed here. | no such capability found on any surface |
| M8 | Accepted integration → served marker took ~63 min. Of that, ~55.5 min was pre-dispatch coordination and ~7.5 min was the workflow reaching the marker. | #365 `5849188505` |
| M9 | `wsf-staging-deploy` is `workflow_dispatch` only, in concurrency group `wsf-staging-deploy` with `cancel-in-progress: false`. The approval is `approved-candidate.json` on `main`, which is a reviewed PR today. | `.github/workflows/wsf-staging-deploy.yml`, `.github/wsf-staging/approved-candidate.json` |
| M10 | Worker sessions downloaded Actions artifacts (HTTP 200). L0 got 403. | #396 run-56/57 triage; #365 |
| M11 | Delivery→review routing was missed once tonight and recovered only by the watchdog. | #365 `5851805362` |
| M12 | Four operating contracts exist only on the development branch, not on operational `main`. | addendum `5849199418` |
| M13 | A worker could prepare a correct change but not open it on another base within its reserved write surface. It was carried by hand (#525). | addendum `5849314657` |

M3/M4 are the crucial pair: a real push-style wake into the exact session exists, and it is lossy. The design uses it as the fast path and never as the only path.

---

## 2. Writer boundary (Phase B)

### 2.1 Recommended: A+ — App-only state branch, environment-held key, `main`-only writer code

| Element | Setting |
| --- | --- |
| Identity | GitHub App `wsf-control-writer`, installed on this repository only. |
| App permissions | contents: read & write; issues and pull requests: read & write (conversation comments in the control and worker inboxes, which are PRs); actions: read (step 5), read & write (step 7 dispatch only, when authorized); metadata: read. Nothing else. |
| Key custody | App private key stored **only** as a secret in environment `wsf-control-writer`, whose deployment-branch policy is `main` only. No workflow on any other ref can read it. |
| State branch | Ruleset on `refs/heads/wsf-control-state`: restrict creation, update and deletion; block force pushes; **bypass list = the App only**. Repository admins are **not** in the bypass list. |
| Writer code | `.github/workflows/wsf-control-reconcile.yml` plus `tools/wsf-control/**` at the triggering `main` SHA. The job mints a short-lived installation token from the environment secret. |
| Concurrency | Workflow `concurrency: {group: wsf-control-writer, cancel-in-progress: false}`, and git push as compare-and-swap (§2.3). |

**One-time owner/admin setup.** It is required, and it is Devin's alone:
1. Create the App with exactly the permissions above.
2. Install it on this repository.
3. Create environment `wsf-control-writer`, restricted to `main`, and store the App key there.
4. Create the ruleset above.

No agent can do or verify steps 1–4 with write access (M2).

**Proof the capability is distinct**, as 1B acceptance evidence:
- **E1.** A read-back of the ruleset shows the target ref, the rules and a bypass list containing only the App.
- **E2.** A push to `wsf-control-state` from a worker session using the shared credential is refused by the ruleset. The refusal message is quoted, and no ref moves.
- **E3.** A job on a non-`main` ref that references the environment cannot obtain the secret. Its run log shows the environment gate refusing.
- **E4.** The first real append's commit is authored by the App's bot identity. That identity is also visible on its CURRENT edit.
- **E5.** The worker tool surface has no action that edits rulesets or approves environments (M2), shown by its capability listing.

**Limit.** The shared credential belongs to the repository owner. The ruleset holds against it only because the worker surface cannot edit rulesets (E5). Any future change that gives worker sessions an admin-capable GitHub surface voids this boundary, so the capability registry (§11.1) records it as a guarded fact, and E5 is re-checked whenever that surface changes.

### 2.2 Rejected alternatives

| Alternative | Why rejected |
| --- | --- |
| **A as briefed, with the App key held anywhere a session can reach it** | Any session holding the key *is* the writer. The key must never leave the environment. |
| **B. Protected-environment secret alone, without a ruleset on the state branch** | The job is protected, but the branch is not. The shared credential could still push `wsf-control-state` directly, so there is no write boundary. B's environment gate is kept *inside* A+ as key custody. |
| **B with a required human reviewer on every write** | Enforceable, but every routine transition would need a click, which contradicts "routine continuation from state". It is kept only for protected human decisions (§5.3). |
| **Status quo: Fable/L0 run `append.mjs` with the shared credential** | Explicitly refused by the brief. `actor: "Fable"` is self-declared (constraint 3). |
| **A persistent Claude "writer" session** | It writes as `idevinsimpson` (M1), so it is not distinct. Its runtime is not durable, and it re-creates session memory. |
| **Signed events (each writer signs lines with its own key)** | There is no key custody a worker could not also reach, and it adds a verifier without adding a boundary. |

### 2.3 Compare-and-swap, concurrency and uncertain writes

The 1A mechanics are kept unchanged:
- event identity `id = sha256(canonical{schema, type, subject, source})`;
- `--expect-head`;
- the sha256 line chain.

A+ adds two layers:
1. **Ref CAS.** The writer pushes `wsf-control-state` as a fast-forward of the head it read. A concurrent writer's non-fast-forward is refused by git. The writer re-fetches, re-reduces and re-derives, and never merges ledgers. At most three attempts are made; a fourth refusal is a `CONTROL_EXCEPTION writer-contention`.
2. **Run serialization.** One concurrency group means at most one writer runs, with one pending. GitHub replaces an older pending run with a newer one. That is safe, because each run re-derives everything from fresh facts, so no request carries state.

The uncertain-write rows of the contract's Phase D are covered as follows:
- **Row 3 (push succeeds, response lost).** The retry computes the same identity. `APPEND=noop` then returns the head.
- **Row 4 (ledger pushed, CURRENT edit failed).** It becomes `current-surface-stale`, and the next run repairs it deterministically.
- **Rows 1, 2 and 11 (races).** Two concurrent derivations produce either identical events (the second is a no-op) or a CAS refusal (the loser re-derives against the winner). Duplicate wakes are impossible because a wake is a ledger event with a derived identity (§6.2).

---

## 3. Authority classes and the deterministic transition table

### 3.1 Classes (schema v2 `authority.class`)

| Class | Meaning | Who can cause it |
| --- | --- | --- |
| `derived` | Computed by the writer from ledger plus verifiable GitHub/runtime facts under a named rule. | The writer only. No caller chooses it. |
| `attested` | A factual claim from a worker's or Director/L0's comment in the right canonical inbox. It is accepted for routing, and its source is recorded; the author is not proven (residual (a)). | Recorded by the writer after structural checks (§5.2). |
| `protected-human` | An owner decision ingested through the approval-gated workflow. | Devin, by environment approval (§5.3). |
| `manual-v1` | Not automated in v1. L0/Fable ask the writer through `wsf-control-decide`, and the event is recorded `attested` with rule `MANUAL`. | Unchanged from today. |

Every v2 event carries `authority: {class, rule, evidence: [typed refs]}`. The `rule` is a derivation-rule id such as `R-DELIVER-1`, listed in `tools/wsf-control/rules.mjs` next to the reducer. The `evidence` refs are the existing typed `{kind, id, repo}` refs; no GitHub text is copied.

This answers addendum `5849104783`:
- **Does v1 suffice?** No. v1 can only say "rests on a comment", which would force machine transitions to wear a human costume.
- **What does v2 add?** The smallest honest shape: class + rule id + refs.
- **Replay and idempotency.** The identity of a derived event is `sha256(schema, type, subject, rule, evidence refs)`. The same facts re-derived give the same identity, so the append is a no-op.
- **Can a worker choose the event?** No. The writer's entry point takes no event input (§4.1).

### 3.2 Transition table (first autonomous release)

| Transition | v1 class | Authoritative evidence | Failure behavior |
| --- | --- | --- | --- |
| `release` of the owner's one queued NEXT when the owner holds no ball and the step is active | derived `R-RELEASE-NEXT` | ledger queue (a recorded decision) and owner capacity | Refused while blocked, over capacity, or not the active step. The packet stays QUEUED. |
| `retract-release` | derived `R-RETRACT` | a recorded hold decision and ledger phase RELEASED | Refused after ACK (1A O3). |
| `ack` | attested `A-ACK` | a worker comment in its canonical inbox naming the packet, after the release event | Wrong inbox, packet or owner means it is ignored and reported. |
| `deliver` | attested `A-DELIVER` + derived check `R-DELIVER-1` | the worker's comment names `subjectSha`; the writer independently reads the PR head and ancestry and verifies the SHA exists, equals the PR head, and descends from the recorded base | A mismatch refuses delivery (`DELIVERY_UNVERIFIED`), and the ball stays with the worker. |
| `review` (routing) | derived `R-ROUTE-REVIEW` | packet review policy (§7), reviewer capacity, one-ball rule | No free eligible reviewer: the packet stays DELIVERED, and program-view reports it `AWAITING_REVIEWER` with the eligible set. |
| `review-pass` | attested `A-PASS` | the assigned reviewer's inbox comment naming the packet, `subjectSha` and the wake id of its assignment | Stale or foreign wake id, wrong subject or wrong inbox means it is ignored and reported (§5.2). |
| `finding` from a W# reviewer | attested `A-FINDING` → derived handback `R-FINDING-HANDBACK` | the assigned reviewer's inbox comment with packet, subject and wake id | The owner holds another ball: `R-PREEMPT` (§8). |
| `finding` from the Director | manual-v1 | control-inbox comment | as today |
| `accept`, technical packet whose contract sets `autoAdvance: technical` | derived `R-AUTO-ADVANCE` | all five conditions of #365 `5851193831`; every required W# pass present; subject unchanged | Any missing condition stops with `OWNER/DIRECTOR ACTION REQUIRED`. It is never accepted by default. |
| `accept`, product/pixel packet | protected-human | environment-approved decision | Fail closed: stays UNDER_REVIEW or DELIVERED. |
| `integrate` | derived `R-INTEGRATE` (recording only) | GitHub merge SHA and the acceptance ref; the merge itself stays an L0 action | `pr-merged-without-acceptance` is a ledger-wins exception. |
| `begin-proof` for a full-path proof | manual-v1 | L0 dispatch run id | as today |
| `begin-proof` / `stage` on the fast path (step 7, after authorization) | derived `R-FASTPATH` | §9 invariants; the dispatch the writer itself made | An invariant failure falls back to the full path and reports `BEHIND reason=full-path-required`. |
| `proof-pass` | derived `R-PROOF-PASS` | run conclusion `success` and the run's own marker outputs | `proof-result-drift` is reported, never silently corrected. |
| `proof-fail` | derived `R-PROOF-FAIL` under the packet's pre-approved failure contract | run conclusion failure; the typed failing check from the run's outputs | The packet goes to CHANGES_REQUESTED and the owner is woken; the finding source is the `workflow_run`. |
| packet-dependency `unblock` | derived `R-UNBLOCK-MILESTONE` | the dependency reached its `until` milestone (1A O7) | Would create a second ball: refused and queued as pending (1A). |
| external `unblock`, machine-resolvable with a named resolver | derived `R-UNBLOCK-RESOLVER` | the resolver's typed fact | An unknown resolver never auto-clears. |
| external `unblock`, human or unknown | protected-human / manual-v1 | decision | never auto-cleared (Phase D row 9) |
| `reconcile-head`, `record-evidence` | derived | PR head and paths | as 1A |
| CURRENT repair | derived `R-CURRENT-REPAIR` | `current-surface-stale` | `control-surface-exception` means no edit (1A). |
| `wake`, `wake-retry`, `wake-timeout` (new) | derived | §6 | Two timeouts become `CONTROL_EXCEPTION wake-undelivered`. |
| `queue`, `reorder-queue`, `set-critical-path`, `withdraw`, `set-review-policy`, `set-contracts` | manual-v1 (Director/L0) | control-inbox decision | never derived |
| `transfer-owner`, `reassign-review` | manual-v1 | decision after a `wake-undelivered` exception | never derived in v1 (§6.4) |

**Intentionally manual in v1:**
- queue order and scope;
- worker replacement after death;
- full-path staging dispatch;
- review-policy changes;
- contract-version changes;
- every human-only item in §11.

---

## 4. Reconcile workflow and trigger shape

### 4.1 Entry points (no caller-chosen events)

`wsf-control-reconcile` runs on:
- `issue_comment` (created or edited) in the registered inboxes;
- `pull_request` (synchronize, closed) on PRs that live packets name;
- `workflow_run` (completed) of `wsf-staging-deploy`;
- `workflow_dispatch` with **no inputs**, as the "please reconcile" request;
- `schedule` every 30 minutes, as a fallback against missed webhooks.

Every run does the same thing:
1. Fetch the state and `check`.
2. Build the snapshot itself from GitHub.
3. Reconcile.
4. Derive rule-permitted transitions.
5. Append them in order (CAS).
6. Post the derived wakes.
7. Render and edit CURRENT.

A run that finds nothing writes nothing.

The event payload that triggered a run is **only a hint that something changed**. A comment's text never becomes an event unless a rule classifies the comment at a canonical location and structurally verifies it.

### 4.2 Why this and not the alternatives

| Alternative | Rejected because |
| --- | --- |
| A thin persistent Claude "global monitor" session as the reconciler | Its GitHub writes are `idevinsimpson` (M1); it dies with its session; it re-creates session memory. |
| Per-worker hourly check-ins as the progression engine | They poll while WATCH is off, which violates "zero polls while WATCH off", and they are what failed tonight (M11). |
| `repository_dispatch` with an event payload | It lets the caller choose the transition. |
| Two monitors (Actions and a Claude monitor) | The brief forbids competing monitors. |

MONITOR (1A) becomes this workflow: the event triggers plus the 30-minute fallback. It is one monitor, it is GitHub-hosted, and it costs nothing while idle.

### 4.3 Degraded mode and self-health (addendum `5849291094` §1)

Health is a **derived view**, not stored state. `health-view` reads:
- the most recent `wsf-control-reconcile` runs (a GitHub fact) and the age of the last successful one;
- whether that run obtained its token (writer capability);
- open `CONTROL_EXCEPTION`s: writer contention, wake undelivered, surface exception, schema unknown;
- whether CURRENT's marker head equals the ledger head.

It renders `CONTROL_HEALTH = OK | DEGRADED(<typed reasons>) | DOWN(last-ok <run id>)` on CURRENT's first lines.

"Nothing actionable" is `ACTIONABLE=off` with `CONTROL_HEALTH=OK`. An unhealthy writer is never `ACTIONABLE=off`; it is `DEGRADED` or `DOWN`, and routine progression stops.

**Who notices DOWN** (when the writer itself cannot run and so cannot render):
1. Every woken worker's first act is the cheap state read (§6.3), which includes `health-view`. A worker that sees `DOWN` or `DEGRADED` posts one typed report in the control inbox, and nothing else.
2. During the transition, the ChatGPT watchdog, which is now watchdog-only (#365 `5851193831`), reads the same view.

After retirement, the 30-minute fallback plus worker wake reads are the detectors. A writer that is down for longer than the fallback interval is exactly the "prove when it cannot safely continue" case.

### 4.4 Detecting writer-code tampering (residual (b))

Every run compares the `main` SHA it runs from against the last `set-contracts` pin for `wsf-control-reconcile.yml` and `tools/wsf-control/**` (§10). A difference without a recorded, accepted `set-contracts` event is `CONTROL_EXCEPTION writer-code-unpinned`: the run refuses to append and renders `DEGRADED`.

A new writer version therefore needs a recorded decision before it acts. That makes tampering visible and inert; it does not make it impossible.

---

## 5. Worker-origin facts and human decisions (trust boundary)

### 5.1 The trust table

| Fact | Source today | v1 treatment | Proves | Does not prove |
| --- | --- | --- | --- | --- |
| delivered SHA | worker comment | **re-derived**: the writer reads the PR head and ancestry itself | that bytes exist at the named head | who wrote them |
| test, run or proof result | worker prose | **re-derived** from the `workflow_run` conclusion and outputs | the run's verdict | product judgment |
| hosted artifact content | worker download (M10) | the writer's App has actions: read, so a rule that needs an artifact reads it itself | the artifact bytes | — |
| ACK | worker comment | attested + structural | ACK at the right inbox for the current release | that W3's runtime wrote it |
| review PASS/finding | reviewer comment | attested + structural + assignment-bound | a verdict at the right inbox for this assignment and subject | independence of author (residual (a)) |
| owner product/pixel acceptance | comment | **protected-human only** (§5.3) | Devin approved in the GitHub UI | — |
| Director/L0 technical decisions | control-inbox comment | attested, manual-v1 | recorded provenance | author identity |

### 5.2 Structural binding of attested worker facts

These rules are enforceable today and close the *accidental* spoof cases:

- **Location.** Only a comment in the worker's **registered canonical inbox** counts. A PASS for W7 posted in #396 is ignored.
- **Assignment binding.** A review wake carries a derived `wakeId`: `sha256(ledger head at assignment, packet, reviewer, subjectSha)`. A PASS or finding must quote that `wakeId` and the `subjectSha`.
  - A stale session answering an old assignment quotes an old `wakeId`, so it is refused.
  - A retry quotes the same one, so it is a no-op.
- **Owner exclusion.** A PASS for a packet is refused when posted in the **implementation owner's** inbox, or when it names a reviewer equal to the owner (1A rule, kept).
- **Ordering.** It must come after the assignment's wake comment.

**What remains unprovable.** Another fleet session holding the shared credential could post a well-formed PASS in W7's inbox. v1 therefore:
- (i) labels every such fact `attested`;
- (ii) keeps acceptance of product work protected-human, so a spoofed PASS can at most route or auto-advance a *technical* gate;
- (iii) records the residual in CURRENT's authority line.

**Closing it requires distinct identities.** Two options:
- per-worker-class GitHub Apps posting the verdict comment;
- one App per reviewer class.

That is a later owner decision and is priced in §12. It is not assumed.

### 5.3 Protected human-decision ingestion

`wsf-control-decide.yml` works as follows:
- It is a `workflow_dispatch` whose inputs are a closed decision form: packet, decision type (`accept-product`, `unblock-human`, `production-authorized-note`) and subject SHA.
- Its only job runs in environment `wsf-control-decision`, with **required reviewer = Devin**.
- A dispatch by any session waits for approval. Only an approval clicked in the GitHub UI lets the job run and hand the decision to the writer, which records it `protected-human` with the run id as evidence.

**Why this is a real boundary, given M1.** Environment approval is not reachable from the worker tool surface (M2, checked by E5). The run record shows the approving reviewer and the time.

**Its limit.** Devin's own browser session is the same GitHub user, so the boundary is "a human in the UI", not "a different account". That is exactly the property the contract asks for.

Until this workflow exists, protected-human transitions stay manual and fail closed: they are never ingested from the comment stream.

---

## 6. Wakes: request, delivery, ACK, timeout (Phase C)

### 6.1 The primitive, as measured

| Option | Authority/state | Survives restart | Latency | Idle cost | Duplicate prevention | Dead-worker detection | Human needed? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **1. App wake comment in the worker's subscribed inbox (recommended primary)** | ledger `wake` event; comment by the App | yes (ledger and comment are durable) | ~1 s when delivered (M3) | zero | wake identity (§6.2) | ACK timeout | only after two timeouts |
| 2. Session-bound check-in, enabled iff WATCH (recommended backstop) | the worker's own trigger; its state is derived | yes (the platform keeps the trigger) | ≤ its period | one cheap state read per period **only while WATCH is on** | the check-in only reads; the ledger dedupes | none alone | no |
| 3. A thin persistent Claude dispatcher that fires workers' triggers (M5) | the dispatcher's session | no, it dies with its session | seconds | a session kept alive | ledger | yes (M6) | its own death needs a human |
| 4. GitHub Actions calls a Claude wake API | — | — | — | — | — | — | **no such interface measured (M7): rejected** |

The recommendation is **1 + 2 together**.
- The inbox comment is the event-driven wake, and it is authenticated as the App (a bot author, not `idevinsimpson`), so a worker can tell a real wake from prose.
- Because delivery is best-effort (M4), the worker's own check-in is the backstop, and it is **on only while the worker holds the ball**:
  - the worker enables it on ACK or REVIEWING;
  - the worker disables it when its derived WATCH turns off (1A already allows this).
- A worker that is off needs no check-in, because the next wake comment arrives by subscription. If that delivery is lost, the writer's timeout re-posts it.

Option 3 is **not** needed in v1. It becomes the recommended upgrade only if measured wake loss (§6.5) makes timeouts too frequent.

**Runtime mapping (addendum `5849105088`).** The ledger stores only logical ids and public inbox numbers, as 1A already does.
- Session and trigger ids are account-scoped locators that every fleet session can use (M5). They are therefore treated as capability-bearing and **never** written to the ledger or to CURRENT.
- The only mapping the design needs is session ↔ inbox subscription, which lives in the platform's own subscription state.
- The optional mapping for option 3 (logical id → session) already exists as the account-private session tag `worker:W3` (M6).

### 6.2 The receipt model

```
derived WATCH on (ledger)  →  wake {worker, packet, reason, wakeId}          [ledger event, CAS]
                           →  App comment in inbox, carrying wakeId           [GitHub fact; posted only if absent]
                           →  worker ACK / PASS / finding / delivery quoting wakeId   [attested]
             no ACK in 15 min  →  wake-retry {wakeId}: one re-post
             no ACK in 15 more →  wake-timeout {wakeId} + CONTROL_EXCEPTION wake-undelivered <W#> <packet>
```

- `wakeId = sha256(ledger head that set the ball, worker, packet, phase)`.
  - The same ball on a re-derivation gives the same id, so no duplicate is possible.
  - A new ball gives a new id.
- Posting is idempotent: before posting, the writer looks for an App comment carrying that `wakeId`. A crash between the event and the comment is repaired by the next run.
- Retries are bounded at one.
- Timeouts come from GitHub comment timestamps against the run clock. The ledger stores no clock.

### 6.3 What a worker does on every wake

A cheap, fixed first act:
1. Read the state branch, and run `check` and `worker-view <self>`.
2. If WATCH is off: disable its own check-in and stop, posting nothing.
3. If WATCH is on: ACK the wake id (the ACK is also the packet ACK where applicable) and work.

The worker never needs the director's memory.

### 6.4 Session recovery matrix

| Situation | Outcome |
| --- | --- |
| session alive, WATCH off | Wake comments stop, because WATCH off derives no wake. The worker's check-in disables itself on its next read. |
| session alive, WATCH on | Subscription delivery in seconds; the check-in is the backstop. |
| session dead or disconnected | No ACK leads to a retry, then `wake-undelivered`. The packet is **not** lost: its phase and ball are unchanged. CURRENT shows the exception. A human or Director chooses `transfer-owner` or `reassign-review` (manual-v1). |
| trigger missing | Harmless: the inbox wake still arrives. The worker re-creates its check-in on ACK. |
| duplicate trigger exists | Harmless: each trigger only reads, and the ledger dedupes. On its read the worker keeps one trigger and deletes the others; they are its own. |
| worker retired or replaced | Recorded decision `register-worker` / `transfer-owner` (manual-v1). The new session subscribes to the inbox and ACKs. |

### 6.5 Measuring the primitive before trusting it

Step 6's first workflow records, for every wake:
- wake event → comment posted;
- comment posted → worker ACK.

The retirement proof needs both distributions. If lost deliveries force frequent retries, the option-3 dispatcher is the documented next step. It still takes no authority: it only fires the exact trigger for a `wake-retry`.

---

## 7. Review policy (addendum `5849150869`)

Review policy is **packet-genesis metadata in the ledger**. It is set on `queue`, and changed only by a manual-v1 `set-review-policy` decision. There is no second store.

```
review: {
  workerReviews: [{class: "journey-qa"|"ops-source"|"security"|"docs-authority", count: 1}],  // [] allowed only for kind:"reference"
  appliesTo: "subject"|"evidence"|"pin"|"docs",
  after: "director"|"owner"|"auto-advance-technical"
}
```

- **Reviewer eligibility.** Workers declare their classes at `register-worker` (a decision, not self-declared at delivery). The route rule picks the free eligible reviewers in registration order, which is deterministic.
- **Invariants kept from 1A:**
  - the owner is never its own reviewer;
  - one ball, one review;
  - O4 completion semantics.
- **No skipping.** A required worker review cannot be skipped by a direct `accept` unless `after` permits it for that packet class. `accept` checks the policy.
- **Default when policy is absent (bootstrap imports).** One `ops-source` review, then the Director. Fail-closed defaults, recorded as the bootstrap's own decision.

---

## 8. Post-ACK review-finding recovery (addendum `5849193448`)

**Rule `R-PREEMPT`, pre-approved by this disposition.** An in-flight correction on already-delivered work (ALPHA) preempts the same owner's newer work (BETA), and only when the one-ball rule would otherwise refuse the handback. ALPHA's finding is kept as a durable `finding` event with `pending: true` until it can apply.

| BETA's state when ALPHA's valid finding lands | Deterministic sequence |
| --- | --- |
| RELEASED, not ACKed | `retract-release BETA` (1A O3), then ALPHA → CHANGES_REQUESTED and wake owner. BETA returns to NEXT. |
| ACKED (including partially implemented, not delivered) | `block BETA {packet: ALPHA, until: DELIVERED-SUCCESSOR}` with `phaseBeforeBlock=ACKED`, rule `R-PREEMPT`, then ALPHA → CHANGES_REQUESTED and wake owner. BETA's branch and commits are untouched; nothing is discarded. |
| CHANGES_REQUESTED itself | Same as ACKED, with `phaseBeforeBlock=CHANGES_REQUESTED`. |
| BLOCKED on something else | The owner holds no ball, so ALPHA → CHANGES_REQUESTED at once. BETA keeps its own blocker. If BETA's unblock later coincides with ALPHA's ball, it is refused and stays pending (1A). |
| DELIVERED or UNDER_REVIEW | The owner holds no ball, so ALPHA → CHANGES_REQUESTED at once. BETA's review proceeds. A BETA finding while the owner holds ALPHA becomes a pending finding, applied in delivery order. |

**Resume.** When ALPHA returns to DELIVERED (the owner's ball released), `R-UNBLOCK-MILESTONE` unblocks BETA to its `phaseBeforeBlock` and wakes the owner.
- This needs one new `until` value, `DELIVERED-SUCCESSOR`: ALPHA's next `deliver` after the finding.
- A second ALPHA finding repeats the sequence.
- Both packets are never held at once, and the policy is never chosen by ChatGPT.

Each row is a Phase D fixture.

---

## 9. Staging freshness and the pre-dispatch fast path

### 9.1 Freshness is a derived view

`freshness-view` computes the following from the ledger and GitHub facts:
- `candidate`: the newest `integrate` whose packet is `previewEligible`;
- `served`: the marker output of the latest successful staging run;
- `active`: an in-progress or pending `wsf-staging-deploy` run and its target.

It renders `STAGING_FRESHNESS = FRESH | DEPLOYING | BEHIND | BLOCKED` with the lag age and a typed reason. `JOURNEY_VERIFICATION = VERIFIED | PENDING | BLOCKED` is a **separate** line: the Home lesson.

Nothing is stored except what already is: `integrate`, `stage` and `set-staging`.

`previewEligible` is decided at `integrate` by rule `R-PREVIEW-ELIGIBLE`: the merge changes `apps/westayfit/**` member-visible source. Docs, evidence, R&D and unaccepted work are never eligible, so they never create lag (Phase D row 16).

### 9.2 The fast path: remove the 56 minutes, keep the 7.5

M8 says the lag is coordination, so the fast path automates exactly that coordination:

1. **Pin in the ledger, not in a PR.** A `set-target {appSha}` event, derived by `R-FASTPATH` and written by the App, replaces the reviewed `approved-candidate.json` edit *for fast-path candidates only*.
   - The staging workflow's resolver gains one mode: read the target from the checked `wsf-control-state` head, verify the ledger chain and the App-authored commit, and require the §9.3 invariants to hold against the served SHA.
   - Full-path candidates keep today's reviewed pin file exactly.
2. **Dispatch by the App.** It uses the same workflow and jobs, and the same marker, inventory and hosted verification.
3. **Coalescing for free.** M9's concurrency group keeps one running and one pending run, and GitHub replaces a pending run with a newer one. The writer dispatches whenever `candidate ≠ served` and no newer pending exists. A running deploy finishes; the newest successor runs next (Phase D row 13).
4. **Proof after the marker.** Changed-journey activation and the owner card run as today's no-redeploy activation, triggered by the writer on the `stage` receipt. They update `JOURNEY_VERIFICATION` only.

**Expected latency.** The integration event plus writer run takes about 1–2 min. The existing workflow to the served marker takes about 7.5 min (M8). The total is **about 9–10 min**, inside the ≤10-minute operating goal. It will be measured on the first real packet.

**No Hosting-only path.** It is not needed on this arithmetic. It would add a second release mechanism and its own invariants for about 5 minutes. If post-automation measurement misses the goal, the data will say whether the gap is in the build or the deploy.

### 9.3 Fast-path invariants (all machine-checked; any failure falls back to the full path)

- The diff `served..candidate`:
  - touches only `apps/westayfit/**`;
  - excludes `package.json`, lockfiles, `app.json`/`app.config.*`, `firebase*.json`, `.firebaserc`, `functions*/**`, `firestore.rules`, `firestore.indexes.json`, `storage.rules` and `.github/**`.
- `functions-westayfit` is tree-identical, so the expected inventory is unchanged, as `approved-candidate.json` records it.
- The candidate is an `integrate` of an **accepted** packet, first-parent on the canonical development branch.
- The last full-path deploy is `VERIFY=pass`, and its rollback SHA is recorded.
- No open `BLOCKED` freshness exception.

### 9.4 Failure and rollback

A failed run sets `STAGING_FRESHNESS=BLOCKED` with a typed reason, the failing run id, and the explicit known-good served SHA from the last `set-staging`. It is ACTIONABLE, and the owner of the integrated packet is woken with `R-PROOF-FAIL`.

The fast path never auto-dispatches again on the same candidate after a failure. A new candidate or a recorded decision is required (Phase D row 14).

### 9.5 Authorization needed

App dispatch of a cloud-mutating workflow is a **new standing authorization**. It must be an owner decision, recorded before step 7, and it is revocable by disabling the App's actions: write permission. Until then, the writer only *computes* BEHIND and wakes L0, which already removes the reminder latency.

---

## 10. Schema and contract versioning, canonical placement

### 10.1 Schema

- Events carry `schemaVersion`. The reducer accepts a known set, `{1, 2}`.
- An unknown or newer version is `CONTROL_STATE=invalid`: fail closed, with no progression (Phase D row 10).
- v2 starts at a `schema-upgrade {to: 2}` event. Earlier lines stay v1 byte-for-byte, so no history is rewritten.
- An older writer that meets v2 refuses and renders `DEGRADED schema-unknown`.
- Rollback: stop the writer. The ledger still reduces under the new reader, and the old writer's refusal is the safe behavior.
- A bootstrap that proves wrong is never fixed by rewriting.
  - Before any post-bootstrap event, the documented recovery is a **new** state ref, `wsf-control-state-2` with its own bootstrap. A `set-surfaces`-style pointer names it, and the ruleset covers `wsf-control-state*`.
  - After events exist, errors are corrected by later events.

### 10.2 Canonical placement (addendum `5849199418`)

| Contract | Canonical home | How consumers resolve the exact version |
| --- | --- | --- |
| operating protocol, control-state contract, autonomy contract, reconcile rules, skills | **operational `main`**, under `docs/westayfit/ops/`, `tools/wsf-control/` and `.claude/skills/` | `set-contracts {entries: [{id, path, commit}]}` ledger event. Every later event is governed by the latest pin before it, so rollback names the governing version. |
| worker/inbox registry | the **ledger** (`register-worker`), already so in 1A | ledger |
| North Star journey references | **operational `main`**, as immutable, content-addressed files `docs/westayfit/ops/journeys/<JOURNEY-ID>/<version>.json`; a new version is a new file, never an edit | the packet pins `{path, blob sha}` at `queue`. An ops-contract change cannot move it. |
| release/staging control-plane docs | operational `main` (already) | `set-contracts` |
| product source | development branch | ledger `set-canonical` (1A) |

Why `main`:
- The writer and the staging workflow already execute from `main`.
- Operating contracts must not wait for a product release.
- Development and the state branch can reference a `main` commit exactly.

The development copies become one-line pointers, so there are never two editable "current" copies.

Rejected alternatives:
- **Development + a ledger commit pin.** The executing code on `main` would read contracts from another branch at runtime.
- **Blobs only in the state branch.** The state branch would become a document store, and contract review would leave PRs.

**Migration** (one bounded docs packet in step 5):
1. Copy the four files of M12 verbatim onto `main` at their canonical paths.
2. Replace the development copies with pointer stubs in the same accepted step.
3. Record `set-contracts` at bootstrap.

### 10.3 Machine-readable contract: decision

- **Rejected: a separate autonomy JSON for authority classes, invariants or state.** The reducer, `rules.mjs` and `check.mjs` are the single validator and the single table. A JSON copy would be a second, drifting source.
- **Accepted, and small: `docs/westayfit/ops/control/capabilities.v1.json`** (§11.1). It is *input* about the runtime, not state, and the writer needs it to refuse routes to unsupported actions.
- **Phase D matrix.** It lives as fixtures in `tools/wsf-control/tests/`, where 1A already puts recovery tests: one fixture per contract row.
- **Phase E counters and retirement readiness.** A derived `autonomy-view.mjs` computes them from ledger events and the GitHub timestamps of their source refs: wake→ACK, delivery→reviewer wake, finding→owner wake, accepted→target, accepted→served, BEHIND-without-deploy, duplicate suppression, exceptions. No dashboard and no store.

---

## 11. Runtime capability map and cross-base carry

### 11.1 Capability registry (`capabilities.v1.json`, versioned by `set-contracts`)

| Action | Writer App | Worker session (shared credential) | L0/Fable session | Owner (GitHub UI) | Status and evidence |
| --- | --- | --- | --- | --- | --- |
| append authoritative state | **yes** (after setup) | **no** (ruleset) | no | no | to be proven by E1–E4 |
| comment / edit CURRENT | yes (as bot) | yes (as `idevinsimpson`) | yes | yes | measured (shared) |
| wake an exact worker session | indirectly, by inbox comment → subscription | fire or enable triggers of any fleet session (M5) | same | — | M3/M4/M5 |
| read session liveness | **no** (M7) | yes (M6) | yes | — | measured |
| create or respawn a session | **no** | yes | yes | yes | tool contract |
| dispatch staging | step 7 only, if authorized | technically yes; forbidden by policy | yes (today's path) | yes | M9 |
| read Actions artifacts | yes (actions: read) | yes (M10) | **403 measured** | yes | M10 |
| ruleset / environment approval | no | **no** (M2) | no | **yes** | M2 |
| open a PR on another base | yes (as bot) | yes (technically), reserved by policy | yes | yes | M13 |

**Unsupported actions are first-class.** The writer refuses a route whose required capability is `unsupported` for the target actor, and says so. It never waits on an action nobody can perform: for example, it routes artifact triage to a worker class, not to L0. Static facts sit in the JSON; health probes (the §4.3 token check) add dynamic status. Nothing is guessed at runtime.

### 11.2 Cross-base carry (#525 case)

The limit was policy (the reserved write surface), not git.

**Recommended primitive, later than step 6:** `wsf-control-carry`, an App job.
- Input: a packet and a source commit that the ledger already names as delivered.
- It applies the exact patch onto a fresh branch from `main`, and verifies `git patch-id` and per-path post-image hashes are equal.
- It refuses any path outside the packet's `subjectPaths`.
- It opens the PR as the App, recording source commit → carried commit as `record-evidence`.

The bytes and the provenance are preserved, and no human reconstructs them. Until then, carry stays manual-v1 and is modelled so in the registry.

---

## 12. Migration, first workflows, rollback

### Step 5 — AUTONOMY-STATE-1B (state and bootstrap)

**Preconditions:** the owner's one-time setup (§2.1, items 1–4) and evidence E1–E5.

**First bounded workflow: shadow reconcile.**
- `wsf-control-reconcile` runs in **shadow**: it writes a bootstrap of current state, fact-only reconciles (`reconcile-head`, `record-evidence`, `stage`) and CURRENT repair to `wsf-control-state`.
- It renders CURRENT into a **new shadow comment**; the human CURRENT stays authoritative.
- Exit: for N ≥ 10 real events, shadow CURRENT equals the manually maintained state, with zero exceptions and every uncertain write resolved. Independent QA reproduces the Phase D rows 1–4, 10 and 11 fixtures on the live branch.

The packet also includes:
- schema v2 (provenance, review policy, `set-contracts`, `DELIVERED-SUCCESSOR`);
- `health-view`, `freshness-view` and `autonomy-view` as read-only views;
- the §10.2 contract migration.

**Reserved write surface:**
- `tools/wsf-control/**`;
- `.github/workflows/wsf-control-reconcile.yml`;
- `docs/westayfit/ops/CONTROL_STATE.md`;
- `docs/westayfit/ops/control/**`;
- `docs/westayfit/ops/journeys/**` (copy-in only);
- `.claude/skills/wsf-program-director/SKILL.md`.

There are no product paths.

### Step 6 — AUTONOMY-ROUTER-1C (routing and wakes)

**First bounded workflow: delivery → review routing → reviewer wake.** This is the exact defect of M11.
- The writer derives `deliver` (`R-DELIVER-1`), `review` (`R-ROUTE-REVIEW`) and `wake`, and posts the App wake comment in the reviewer's inbox.
- The reviewer's PASS or finding comes back through §5.2.
- Everything else stays on the current bridge.

Exit:
- three real packets route delivery→reviewer with zero manual handoff;
- wake→ACK latency is recorded;
- zero duplicate wakes;
- one finding path (`R-FINDING-HANDBACK`) observed;
- one forced lost-wake drill shows retry → exception with no lost packet.

**Reserved write surface:**
- `tools/wsf-control/**`;
- the reconcile workflow;
- the worker-inbox wake-comment template in the skill.

### Rollback (any stage)

1. Disable `wsf-control-reconcile`: one workflow toggle.
2. The state branch freezes as an audit record; nothing is deleted or rewritten.
3. CURRENT reverts to the manual bridge. The last shadow or App CURRENT stays as a dated record.
4. Workers' first-act read sees `CONTROL_HEALTH=DOWN` and falls back to inbox instructions, which is today's behavior.

Rolling back never needs the ruleset or the App removed.

---

## 13. What stays human-only

- Product and pixel acceptance, and any `accept` of a member-visible packet: protected-human.
- Production release, spending, legal/privacy/eligibility, new data collection.
- Provider, credential or App creation, ruleset and environment setup, and the step-7 dispatch authorization.
- Queue order, scope and plan changes, review-policy changes, contract-version pins, and new derivation rules.
- Worker replacement (`transfer-owner`, `reassign-review`) after a `wake-undelivered` exception.
- Clearing any unknown or human external condition.
- Director disposition of this memo, and of each step's exit.

---

## 14. Acceptance evidence for 1B and 1C

**1B:**
- E1–E5 (§2.1);
- a bootstrap dry run, `check` valid, and a documented `wsf-control-state-2` recovery;
- reconstruction of `state.json` from `events.jsonl`;
- Phase D rows 1–4, 10 and 11 against the live branch;
- the shadow CURRENT equality run;
- the v2 schema refusing unknown versions;
- `health-view` rendering DEGRADED on a forced token failure.

**1C:**
- the step-6 exit list (§12);
- Phase D rows 5–9 and 12 as fixtures, plus one live drill each for rows 5 (worker death → exception, packet kept) and 7 (hosted fail → CHANGES_REQUESTED, owner woken);
- `R-PREEMPT` fixtures for all five rows of §8;
- zero polls while WATCH is off, shown by the workers' check-in states against derived WATCH over the proof window.

**Step 7** proves rows 13–16 and the ≤10-minute fast-path measurement.

---

## 15. Decisions requested from the Director

1. Select architecture **A+** (§0), or name a different one.
2. Accept the three stated residuals, (a) attested worker-origin facts, (b) writer strength equal to `main`, and (c) a dead-session exception, as v1 limits with the upgrades named.
3. Approve schema v2's scope (§3.1, §7, §10.1) and the `R-PREEMPT` policy (§8) as pre-approved derivation rules.
4. Confirm the owner one-time setup request (§2.1) goes to Devin as a precise **OWNER ACTION REQUIRED** before step 5 starts.
5. Note that step-7 App dispatch needs its own later owner authorization (§9.5). It is not requested here.
