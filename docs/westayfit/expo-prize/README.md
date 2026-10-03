# Expo prize-drawing core — lane EXP1

Isolated, **disabled** engineering for the FitLife Expo 2026 prize drawing.
Packet: PR #365 comment `5806424724` ("[DIRECTOR → FABLE/L0] EXPO-PRIZE /
Packet A+B RELEASED"), handed off at #462 comment `5806444161`. Owner
instruction behind it: "Have fable begin this now."

| item | value |
| --- | --- |
| branch | `claude/wsf-expo-prize` |
| base | `16cf96dcbecc4b64cfd9a11a5ae7acd770cc1453` (development head at release; W2's `bcadc245` merge landed afterwards and touches none of this lane's paths) |
| target | draft PRs into `claude/wsf-app-shell` (#467 merged at `63a2c4d`; EXP2A on a successor PR); L0 is the only integrator |
| reservation | `functions-westayfit/src/expo-prize/**`, `functions-westayfit/tests/expo-prize/**`, `docs/westayfit/expo-prize/**` (all absent at the base), plus the new `functions-westayfit/jest.expo-prize.config.cjs` (reservation request: a new file, because the callable config matches `tests/callable/**` only) |
| not reserved | `functions-westayfit/src/index.ts`, `firestore.rules`, `firestore.indexes.json`, `firebase*.json`, `.firebaserc`, any `package.json` / lockfile, shared UI, `app/event/[goalId].tsx`, `app/contribute/[goalId].tsx`, anything under `.github/` |

## Documents in this directory

| file | what it is |
| --- | --- |
| `README.md` | this index and the lane's status |
| `CONTRACT.md` | Packet A: the durable contract, resolutions (a)–(f) from source, schema, state machine, transaction boundaries, open owner decisions; §d′ enable (EXP2A); §d″ close → freeze (EXP2B); §d‴ the private "My entries" read (EXP3A) |
| `TEST-MATRIX.md` | Packet A: the focused failure-catching test matrix Packet B implements; EXP2B rows C1–C6, F1–F14, P1–P8; EXP3A rows R1–R8, P9–P11 |
| `EVIDENCE.md` | Packet B, EXP2A, EXP2B and EXP3A: measured results at exact SHAs, control evidence, limitations, next seam |

## Status

Reported distinctly, as the sprint rules require: **delivered** (pushed on
this branch), **accepted** (the Director's product acceptance), **integrated**
(merged by L0). Nothing here is deployed, enabled, or promised to a member.

| checkpoint | delivered | accepted | integrated |
| --- | --- | --- | --- |
| setup (branch, PR #467, this index) | `087b667` | — | — |
| Packet A (contract / schema / state machine / test matrix) | `966a63e` (`CONTRACT.md`, `TEST-MATRIX.md`) | Director `5810220569` (with B) | development `61dd7b6a` |
| Packet B (disabled isolated core + emulator tests) | `3fbfb0a` code + tests (67/67 on the emulators; 7/7 mutations caught; existing suites 81/81) + `8a434dd` (`EVIDENCE.md`); W7 Check 22 on `8a434dd`: no defect in a delivered row | Director `5810220569` (at `63a2c4d`) | development `61dd7b6a` |
| W7 Check 22 corrections (docs + four code notes, 68/68) | `3b9963c`, pushed under the owner-environment rule (no unpushed commits) disclosed in #467 `5808389267`, not on a release | — | — |
| evidence-truth correction (two doc lines) | `63a2c4d` | Director `5810220569` | development `61dd7b6a` (L0 `5810260515`) |
| **EXP2A** enable transition (D + F5 closed; `enable.ts`, `enable.test.ts`, policy derivation + drift fence) | `41cb6dff` (see EVIDENCE.md §EXP2A) | Director #469 `5811301305` (W7 Check 24 clean) | development `5c897ab5` |
| **EXP2B** close → reconcile → freeze core (G closed; `close.ts`, `pool.ts`, `freeze.ts`, three suites; packet #365 `5811972490`, transfer `5812848258`) | `e0171fd1` + truth/readability successor `24d95cfe` (PR #470; EVIDENCE.md §EXP2B) | Director #470 `5815201024` (W7 Check 25 + 25D clean) | development `68d159c1` |
| **EXP3A** private "My entries" read core (`receipt.ts`, `receipt.test.ts`; packet #365 `5815271789`) | `80615cae` (PR #471) + the stored-pool integrity successor (`pool.ts`; W7 Check 26 item 5b, Director `5816858655`); exact SHA in EVIDENCE.md §EXP3A | — | — |

## Test command

No npm script is added. From the repo root, with firebase-tools 15 available:

```
METADATA_SERVER_DETECTION=none firebase emulators:exec \
  --only firestore,auth --config firebase.westayfit.emulators.json --project demo-wsf-local \
  "cd functions-westayfit && GCLOUD_PROJECT=demo-wsf-local METADATA_SERVER_DETECTION=none \
   npx jest --config jest.expo-prize.config.cjs"
```

## Hard boundaries

No live promotion, no real entrant or contact collection, no prize purchase,
no vendor, no messaging, no IAM change, no deploy of any kind, no `gcloud`, no
secrets. No shared export or route is added; central wiring (an `index.ts`
export, a Firestore trigger registration, a rules block) is specified here and
waits for an L0 reservation and review. A disabled promotion produces no award
and no product promise.
