# WE STAY FIT worker inbox map

Status: operations-control mapping for Fable/L0 coordination.
Date: 2026-09-26.

The canonical inbox is where actionable assignments must be posted. Task PRs can hold implementation detail and evidence, but the worker should not be expected to discover work by polling unrelated threads.

| Worker | Canonical inbox | Current role |
| --- | --- | --- |
| Fable / L0 | #365 | integration, coordination, state transitions, release orchestration |
| W3 | #396 | staging operations, pin work, authorized index/operator packets |
| W4 | #394 | member journey/integration worker inbox; task PRs linked from here |
| W5 | #395 | independent QA/security |
| W7 | #434 | independent journey QA and pin checks |
| W9 | #497 | member-shell / Community / Settings implementation inbox |

Rules:

1. Every actionable assignment is posted to the canonical inbox and may link to a task PR.
2. A worker ACKs from the canonical inbox or the linked task PR, but Fable records the ACK back in CURRENT.
3. Scheduled check-ins read the canonical inbox first.
4. No duplicate wake exists for an assignment already acknowledged or executing.
5. If a worker changes standing inbox, Fable updates this file and posts the new mapping to #365 before relying on it.
6. Inactive workers need no standing inbox entry. Before dispatching new work to an inactive worker, Fable names one canonical inbox.
7. Evidence-only/export PRs are never worker inboxes.
8. Closing an implementation PR does not close the canonical inbox unless the inbox itself is explicitly retired.
