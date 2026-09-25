# RETURN-CONTINUITY-1 — the Home a member lands on after contributing

Packet: L0 #477 `5826542101` (Director #365 `5825324407`). Worker: W9. ACK: #477 `5826898176`.
Base: development `6b96ba1b`. Route: `apps/westayfit/app/(tabs)/(home)/community/[groupId]/index.tsx`.

**Nothing here is accepted.**
- MIGRATED frames show the development base `6b96ba1b` as it ships.
- CANDIDATE frames show this packet's build.
- Neither is an AFTER. Every frame carries its stage, the served build's commit and "NOT ACCEPTED" in a strip inside
  the image, and the producer asserts all three before it writes.

| | |
|---|---|
| Producer | `apps/westayfit/tests-e2e/sprint-w9-return-continuity-capture.spec.ts` |
| Stage | `WSF_RETURN_CONTINUITY_STAGE=MIGRATED` or `CANDIDATE` |
| Build check | The producer reads the served commit on `/health`. MIGRATED must be `6b96ba1b`; CANDIDATE must not be. |
| Write gate | `WSF_CAPTURE_FRAMES=1` (via `helpers/capture`). Set it for this file only: other producers in the suite rewrite accepted evidence. |
| Frames | 3 states × 390×844 and 390×640. |

## States

All data is synthetic and seeded on the local emulator (`demo-wsf-local`). Each state runs on its own fresh goal:
- "October Squat Challenge", at 1,847 of 5,000 squats, in "Alpharetta Morning Movers".
- One viewer, "Alex Rivera", whose own total starts at 0.

Every state is reached through a real return: the community's "Already moved? Record squats" → 20 squats → Record →
"Back to community".

| State (file name) | How it is reached | What the producer asserts before the shutter |
|---|---|---|
| `confirmed-return` | The write confirmed | Home agrees with the receipt: "1,867 of 5,000 squats", "You’ve added 20 squats to this goal.", and "Confirmed h:mm". Nothing reads as stale. |
| `unknown-return-INJECTED-REQUEST-DROPPED` | The request is aborted before it reaches the server (injected) | Home excludes the amount: 1,847, no "20 squats" in the own row, and no momentum row for it. |
| `refresh-failed-INJECTED` | A confirmed return, then every `wsfGoalPulse` read is aborted (injected) and Refresh is pressed | The retained figure and its "Confirmed h:mm" do not change. On MIGRATED nothing says the refresh failed (W7 Check 27 item 9); on CANDIDATE the member is told. |

Also measured, with no frame: an unknown return where the server **did** record the write and only the reply was lost
(injected). Home shows the server's own 1,867 of 5,000 and "You’ve added 20 squats". That is authoritative, not a
prediction, and nothing is added twice.

## Measured on the base (MIGRATED, `6b96ba1b`)

| State | Home after the return |
|---|---|
| Confirmed | "1,867 of 5,000 squats" (the receipt said "1,867 of 5,000 squats"); "You’ve added 20 squats to this goal."; momentum "Alex Rivera added 20 squats · just now"; "1 person moved today". **Agrees; no change needed.** |
| Unknown, request dropped | "1,847 of 5,000 squats"; "Your first contribution counts here."; no momentum row; "0 people moved today". **Excludes the amount; no change needed.** |
| Unknown, write landed and reply lost | "1,867 of 5,000 squats"; "You’ve added 20 squats to this goal." The server's figures, shown once. |
| Refresh failed | The figure, "Confirmed h:mm", own row and momentum are unchanged, and **nothing tells the member the refresh did not happen**. |

## Reproducing

```sh
# emulators from the repo root
METADATA_SERVER_DETECTION=none npx -y firebase-tools emulators:start \
  --config firebase.westayfit.emulators.json --project demo-wsf-local
# the build you mean to photograph, emulator-flagged (its commit is what the strip will say)
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 npm --prefix apps/westayfit run build:web
# frames (this file only)
WSF_RETURN_CONTINUITY_STAGE=MIGRATED WSF_CAPTURE_FRAMES=1 \
  WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  npx --prefix apps/westayfit playwright test tests-e2e/sprint-w9-return-continuity-capture.spec.ts --workers=1
```

For MIGRATED, serve the build of `6b96ba1b`.
