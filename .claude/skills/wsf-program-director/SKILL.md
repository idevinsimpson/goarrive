---
name: wsf-program-director
description: Run one step of the WSF program loop from the control-state ledger. Use when acting as Fable, L0, the Director or a W# worker on the WSF program, when deciding what a worker should do next, whether a check-in should stay on, or when recording a release, delivery, review, acceptance, integration, proof or staging event.
---

# WSF program director

The program's decisions live in an append-only ledger on the `wsf-control-state` branch. GitHub stays the authority for facts. This skill is the order of operations. The contract is `docs/westayfit/ops/CONTROL_STATE.md`.

Only **Fable** and **L0** write the ledger. A worker (W3, W7, …) owns packets, and its GitHub comments can be the *source* of an event. A worker never runs `append.mjs`, and never records its own delivery as accepted or integrated.

## Every time, in this order

1. **Fetch the state.** Fetch `wsf-control-state` and work from a fresh checkout of it. Never act from a remembered or copied state.
2. **Validate.** Run `node tools/wsf-control/check.mjs <dir>`. Anything but `CONTROL_STATE=valid` stops the loop: report it and change nothing.
3. **Build a minimal GitHub snapshot.** Include only:
   - the PRs that live packets name;
   - the proof runs;
   - the handoff comments in the canonical inboxes;
   - the CURRENT comment (it exists, and its marker head);
   - the approved pin and the served marker;
   - each check-in's enabled state;
   - the external conditions.

   Record pointers and closed values only, never titles, bodies, CI text, URLs or prose.
4. **Reconcile before acting.** Run `node tools/wsf-control/reconcile.mjs <dir> <snapshot.json>`.
   - A `wins=github` finding is a fact to record, resting on the object that proves it (a PR, a commit or a run).
   - A `wins=ledger` finding is a decision for Fable or L0. It needs an authority comment and is never inferred from GitHub.
   - A `wins=exception` finding (`CURRENT_SURFACE=exception`) stops every edit to the control surface. Report it, and never create a replacement comment silently.
5. **Make one decision at a time.** Take one transition from `program-view` (Fable/L0), with its typed `source`:
   - Decisions (queue, release, finding, accept, block, unblock, withdraw, critical path) rest on a comment.
   - `integrate` rests on the merge and carries the acceptance comment.
   - Proof and stage events may rest on the workflow run. A failed proof becomes `proof-fail` only through a focused finding comment.
   - A run result never grants acceptance or release.
6. **Append.** Run `node tools/wsf-control/append.mjs <dir> <event.json> --expect-head <the ledgerHead you read>`.
   - `APPEND=noop` means the event already landed, for example after an uncertain push. Carry on from the head it prints.
   - `APPEND=refused` means nothing was written. Re-fetch, re-validate and reconcile again.
   - Never edit `events.jsonl`, `state.json` or `CURRENT.md` by hand.
7. **Render CURRENT.** Run `node tools/wsf-control/render-current.mjs <dir> --out <dir>/CURRENT.md` and commit the three files together. Then edit, in place, exactly the comment at `surfaces.current.commentId`, and only after reconcile reported `CURRENT_SURFACE=ok`.
8. **Hand off once.** Post one handoff to the owner's canonical inbox (the `inbox` in `worker-view`), naming the packet and the ledger head. A release outside that inbox is refused.
9. **Dedupe wakes, and derive WATCH.**
   - A wake whose event is already recorded is a no-op.
   - A worker's check-in follows `WATCH=` from `worker-view`, and may disable itself when it is off. Blocked and reference packets never keep it on.
   - Fable's global heartbeat follows `MONITOR=on`. It stays enabled even when `ACTIONABLE=off`, so a dependency that clears while every worker is off is still noticed. When `ACTIONABLE=off`, it is silent.
   - Post no status for an unchanged blocked lane.

## Completion is by contract

Every packet declares `completion: {terminal, proofType}`. A packet is done only at its own terminal phase:
- `INTEGRATED`, for `source-only`;
- `VERIFIED`, after a `journey-activation` or `hosted` proof;
- `STAGED`.

An integrated packet whose contract needs a proof is **not** done. `program-view` lists its `begin-proof`, and a failed proof sends it back to its worker as CHANGES_REQUESTED.

## The WSF interaction override

While this skill governs the session, the WSF control protocol supersedes the generic "ask the user what next?" loop for WSF program work. That loop is the three "Noticed & Suggested" items and "Want me to fix any of these next?" in `.claude/interaction-rules.md`. The override applies **only** while this skill governs the session and does not change general GoArrive behavior, and that file is not edited.

Classify every routine observation as exactly one of:

1. **An in-scope defect on ACTIVE NOW.** Record it as a focused finding or correction on that packet.
2. **Independently actionable and relevant to the critical path.** It becomes a candidate for NEXT, subject to the one-NEXT rule. Fable decides; it is queued by a comment-sourced decision.
3. **A non-critical improvement.** Record or park it in the appropriate task or evidence location. It is not a question to the user.
4. **An owner-only decision.** Surface it to Devin only when the decision is genuinely irreducible under the authority model.

Do not manufacture three suggestions merely to satisfy the generic template. Do not ask Devin to choose the next engineering task when `program-view` and the ledger already define ACTIVE NOW and NEXT.

## Never

- Never product- or pixel-accept from state. `accept` records a reviewer's verdict on the named `subjectSha`, and an evidence head never substitutes for it.
- Never merge or deploy because of a phase. ACCEPTED, INTEGRATED and VERIFYING list work for L0, and L0 decides. The staging release follows `skills/wsf-staging-deploy/SKILL.md` and `.github/wsf-staging/CONTROL-PLANE.md`.
- Never fabricate history. The ledger starts with one `bootstrap` that imports current state as found, marked `origin: bootstrap`. Every later line is an event that actually happened.
- Never copy PR state, CI, titles, comment bodies, URLs or prose into an event.
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
  - the `AUTHORITY` refs.
- `program-view` prints:
  - `CRITICAL_PATH`;
  - `NEEDS_TRANSITION` (with `reactivates=W#`);
  - `ACCEPTED_NOT_INTEGRATED`;
  - `INTEGRATED_NOT_VERIFIED`;
  - `INTEGRATED_NOT_STAGED`;
  - `BLOCKERS_CLEARED`;
  - `WATCH_INCONSISTENT`;
  - `CURRENT_SURFACE`;
  - `ACTIONABLE`;
  - `MONITOR`.

Neither view decides anything.
