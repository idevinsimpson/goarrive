# Expo prize-drawing core — lane EXP1

Isolated, **disabled** engineering for the FitLife Expo 2026 prize drawing.
Packet: PR #365 comment `5806424724` ("[DIRECTOR → FABLE/L0] EXPO-PRIZE /
Packet A+B RELEASED"), handed off at #462 comment `5806444161`. Owner
instruction behind it: "Have fable begin this now."

| item | value |
| --- | --- |
| branch | `claude/wsf-expo-prize` |
| base | `16cf96dcbecc4b64cfd9a11a5ae7acd770cc1453` (development head at release; W2's `bcadc245` merge landed afterwards and touches none of this lane's paths) |
| target | draft PR into `claude/wsf-app-shell`; L0 is the only integrator |
| reservation | `functions-westayfit/src/expo-prize/**`, `functions-westayfit/tests/expo-prize/**`, `docs/westayfit/expo-prize/**` (all absent at the base) |
| not reserved | `functions-westayfit/src/index.ts`, `firestore.rules`, `firestore.indexes.json`, `firebase*.json`, `.firebaserc`, any `package.json` / lockfile, shared UI, `app/event/[goalId].tsx`, `app/contribute/[goalId].tsx`, anything under `.github/` |

## Documents in this directory

| file | what it is |
| --- | --- |
| `README.md` | this index and the lane's status |
| `CONTRACT.md` | Packet A: the durable contract, resolutions (a)–(f) from source, schema, state machine, transaction boundaries, open owner decisions |
| `TEST-MATRIX.md` | Packet A: the focused failure-catching test matrix Packet B implements |
| `EVIDENCE.md` | Packet B: measured results at exact SHAs, control evidence, limitations, next seam |

## Status

Reported distinctly, as the sprint rules require: **delivered** (pushed on
this branch), **accepted** (the Director's product acceptance), **integrated**
(merged by L0). Nothing here is deployed, enabled, or promised to a member.

| checkpoint | delivered | accepted | integrated |
| --- | --- | --- | --- |
| setup (branch, PR #467, this index) | `087b667` | — | — |
| Packet A (contract / schema / state machine / test matrix) | this commit (`CONTRACT.md`, `TEST-MATRIX.md`) | — | — |
| Packet B (disabled isolated core + emulator tests) | — | — | — |

## Hard boundaries

No live promotion, no real entrant or contact collection, no prize purchase,
no vendor, no messaging, no IAM change, no deploy of any kind, no `gcloud`, no
secrets. No shared export or route is added; central wiring (an `index.ts`
export, a Firestore trigger registration, a rules block) is specified here and
waits for an L0 reservation and review. A disabled promotion produces no award
and no product promise.
