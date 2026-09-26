---
name: wsf-program-director
description: Run one step of the WSF program loop from the control-state ledger. Use when acting as Fable, L0, the Director or a W# worker on the WSF program, when deciding what a worker should do next, whether a check-in should stay on, or when recording a release, delivery, review, acceptance, integration or staging decision.
---

# WSF program director

The program's decisions live in an append-only ledger on the `wsf-control-state` branch. GitHub stays the authority for facts. This skill is the order of operations; the contract is `docs/westayfit/ops/CONTROL_STATE.md`.

## Every time, in this order

1. **Fetch the state.** Fetch `wsf-control-state` and work from a fresh checkout of it. Never act from a remembered or copied state.
2. **Validate.** Run `node tools/wsf-control/check.mjs <dir>`. Anything but `CONTROL_STATE=valid` stops the loop: report it, and change nothing.
3. **Build a minimal GitHub snapshot.** Include only the PRs the live packets name, the handoff comments in the canonical inboxes, the approved pin, the served marker, and each check-in's enabled state. Record pointers and booleans only, never titles, bodies, CI text or prose. The shape is in the contract.
4. **Reconcile before acting.** Run `node tools/wsf-control/reconcile.mjs <dir> <snapshot.json>`.
   - A `wins=github` finding is a fact to record.
   - A `wins=ledger` finding is a decision for Fable or L0. Never infer it from GitHub.
5. **Make one decision at a time.** Take a single transition from `program-view` (Fable/L0) or `worker-view` (a worker), with its authorizing comment id.
6. **Append.** Run `node tools/wsf-control/append.mjs <dir> <event.json> --expect-head <ledgerHead you read>`. On `APPEND=refused`, nothing was written: re-fetch, re-validate and reconcile again. Never edit `events.jsonl`, `state.json` or `CURRENT.md` by hand.
7. **Render CURRENT.** Run `node tools/wsf-control/render-current.mjs <dir> --out <dir>/CURRENT.md`, then commit the three files together.
8. **Hand off once.** Post one handoff to the owner's canonical inbox (the `inbox` in `worker-view`), naming the packet and the ledger head. A release outside that inbox is refused.
9. **Dedupe wakes and derive WATCH.**
   - A wake whose event is already recorded is a no-op.
   - A worker's check-in follows `WATCH=` from `worker-view`. Blocked and reference packets never keep it on.
   - Fable's loop follows `PROGRAM_WATCH=` from `program-view`.
   - Post no status for an unchanged blocked lane.

## Never

- Never product- or pixel-accept from state. `accept` records a reviewer's verdict on the named `subjectSha`, and an evidence head is never a substitute.
- Never merge or deploy because of a phase. ACCEPTED and INTEGRATED list work for L0, and L0 decides. The staging release follows `skills/wsf-staging-deploy/SKILL.md` and `.github/wsf-staging/CONTROL-PLANE.md`.
- Never copy PR state, CI, titles, comment bodies or prose into an event.
- Never put a secret, token, key, email address or URL token anywhere. The ledger refuses them, and must never be tested with real ones.

## Views

```sh
node tools/wsf-control/worker-view.mjs <dir> W3
node tools/wsf-control/program-view.mjs <dir> --snapshot <snapshot.json>
```

- `worker-view` prints:
  - `ACTIVE_NOW` (at most one packet);
  - `AWAITING_REVIEW`;
  - `NEXT`;
  - `WATCH`;
  - the `AUTHORITY` comment ids.
- `program-view` prints:
  - `CRITICAL_PATH`;
  - `NEEDS_TRANSITION`;
  - `ACCEPTED_NOT_INTEGRATED`;
  - `INTEGRATED_NOT_STAGED`;
  - `BLOCKERS_CLEARED`;
  - `WATCH_INCONSISTENT`;
  - `PROGRAM_WATCH`.

Neither view decides anything.
