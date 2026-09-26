# WE STAY FIT — Autonomy Acceptance Contract

Status: owner-authorized autonomy requirements contract.
Date: 2026-09-26.

This document defines what must be true before routine WE STAY FIT program coordination no longer depends on the ChatGPT hourly director. It is an acceptance contract, not an implementation mechanism. AUTONOMY-STATE-1A and the W3 1B/1C architecture consultation may choose different internal designs as long as they satisfy this contract.

## Goal

Routine engineering progression must continue from durable, machine-checked state without ChatGPT acting as queue memory, scheduler, wake engine, or manual handoff router.

ChatGPT remains available for:
- product and visual judgment;
- major strategy changes;
- periodic audits;
- genuinely irreducible owner decisions.

Automation must never manufacture those decisions.

## Authority boundary

Human-only or separately authorized decisions remain human:
- product/pixel acceptance;
- production release;
- spending;
- legal/privacy/eligibility decisions;
- new product policy;
- any owner priority change that is not mechanically derivable from an already recorded queue/dependency contract.

Routine transitions should be derived from checked state and verifiable facts wherever possible.

A worker-supplied role string is not an authorization boundary.

## Phase A — deterministic state semantics

Required:
- append-only, integrity-checked state history;
- explicit packet phases and allowed transitions;
- one implementation owner per work packet;
- one ACTIVE NOW per W# worker across implementation and review roles;
- at most one driving NEXT work packet per worker;
- queued work may be blocked without being presented as NEXT;
- stale CURRENT is a recoverable actionable condition;
- reviewer ownership is first-class:
  - implementer WATCH off after delivery;
  - assigned W# reviewer REVIEWING + WATCH on;
  - finding hands the ball back to the implementer;
  - acceptance turns worker watches off;
- worker-supplied facts are inputs, never self-acceptance authority;
- invalid/unknown state fails closed;
- views are derived and read-only;
- secrets, PII and capability URLs are refused from control state.

Exit: exact 1A product passes independent QA and Director acceptance.

## Phase B — durable authoritative state and writer boundary

Required:
- authoritative state exists outside chat/session memory;
- bootstrap imports current state only, never fabricated historical events;
- deterministic dry-run and validation before first authoritative write;
- exact rollback/recovery procedure for an incorrect bootstrap;
- the state can be reconstructed from the accepted ledger/history;
- the writer boundary is enforceable outside the event payload.

The current shared GitHub user is not sufficient to distinguish Fable/L0 from W3/W7. A valid design therefore requires either:
- a genuinely distinct GitHub App/capability with narrow branch/state rights;
- a protected workflow-mediated writer with a distinct runtime capability;
- or another mechanism that provides equivalent enforceable separation.

If one-time owner/admin GitHub setup is required, name it explicitly and prove it was installed. Do not silently weaken the claim.

Routine reconcile should prefer:
- caller requests reconcile;
- trusted code computes the allowed transition;
- caller does not choose an arbitrary authoritative transition.

Human-authority decisions may enter through a separately protected decision-ingestion path.

Exit: durable writer path, bootstrap, reconstruction and uncertain-write recovery pass independent QA.

## Phase C — state-derived triggers and monitor

Required:
- worker WATCH is derived solely from authoritative state;
- worker pollers/check-ins are ON iff that worker currently holds the ball;
- no worker stays awake while waiting on another worker, reviewer, owner, Director or external blocker;
- blocked/queued/reference packets do not keep worker sessions alive;
- a reviewer wakes from REVIEWING state, not from Fable memory;
- findings hand WATCH back to the implementer automatically;
- one lightweight global monitor remains while MONITOR is on;
- global monitor uses ACTIONABLE/reconcile findings to perform only permitted deterministic transitions or wake the exact affected worker;
- duplicate handoffs and duplicate wakes are prevented;
- dependency clear reactivates only the affected worker;
- worker death does not lose the packet.

Exit: trigger state matches derived state across independent QA scenarios and real use.

## Phase D — recovery and unattended proof

The recovery matrix must pass:
1. stale writer race;
2. stale expected state head;
3. append/push succeeds but response is lost;
4. ledger push succeeds but CURRENT edit fails;
5. worker dies mid-packet;
6. reviewer dies or is reassigned;
7. hosted proof fails and packet returns to CHANGES_REQUESTED;
8. external machine-resolvable blocker clears while all workers sleep;
9. unknown/unresolvable external condition never auto-unblocks;
10. authoritative state is malformed/corrupt and progression stops rather than guessing;
11. two monitor/reconcile runs race and only one valid transition wins;
12. a duplicate delivery/finding/reconcile is idempotent.

External conditions must be typed. At minimum distinguish:
- GitHub fact;
- workflow/operator receipt;
- protected human decision;
- machine-resolvable external system condition with a named resolver;
- unknown/unresolvable.

Human-only conditions cannot be auto-cleared by a technical probe.

## Phase E — retire the ChatGPT coordination loop

Before retirement:
- Phases A–D are accepted;
- at least three distinct real work packets progress through routine state transitions without ChatGPT manual queue/handoff/wake intervention;
- include at least one normal success path and one correction/failure path;
- human/Director judgment may still occur where explicitly required, but routine continuation after that judgment happens from state;
- for at least one complete real packet, the ChatGPT hourly task is audit-only and makes no routine coordination write;
- its observed ACTIVE/NEXT/REVIEWING/WATCH/served state matches the repo-native state.

Then the Director records:
AUTONOMY PHASE E / RETIRE HOURLY LOOP — ACCEPTED

At that point the WSF Hourly Progress automation is disabled. It is not retained “just in case.”

## Measures of success

The autonomy system should reduce, not relocate, coordination overhead.

Track during the proof period:
- number of routine handoffs requiring manual ChatGPT intervention;
- duplicate wake/handoff count;
- worker idle-poll time while not holding the ball;
- stale CURRENT repair count;
- control-state exceptions;
- time from worker delivery to reviewer wake;
- time from finding to implementer wake;
- time from accepted product/pin to permitted release action;
- recovery from uncertain writes without owner intervention.

Targets for retirement proof:
- zero duplicate wakes/handoffs;
- zero worker polls while authoritative WATCH is off;
- zero manual ChatGPT routine queue/handoff/wake writes across the required proof packets;
- every uncertain write resolves by deterministic reconcile or fails closed.

## Non-goals

Autonomy does not mean:
- auto-accepting product or pixels;
- automatic production release;
- replacing Devin’s product authority;
- allowing workers to self-approve;
- broadening permissions to make orchestration easier;
- hiding blockers;
- treating a green test as a human judgment;
- adding more scheduled loops when a state-derived monitor can replace them.
