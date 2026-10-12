# FOCUS-RETURN-1 — where keyboard focus lands after leaving MOVE or the contribution flow

Packet: L0 #474 `5825281943` (Director #365 `5825247950`). Worker: W9. ACK: #474 `5825558375`.
Base: development `6b96ba1b`.

**Nothing here is accepted.**
- MIGRATED frames show the development base `6b96ba1b` as it ships.
- CANDIDATE frames show this packet's build.
- Neither is an AFTER. Every frame carries its stage, the served build's commit and "NOT ACCEPTED" in a strip inside
  the image, and the producer asserts all three before it writes.

| | |
|---|---|
| Producer | `apps/westayfit/tests-e2e/sprint-w9-focus-return-capture.spec.ts` |
| Stage | `WSF_FOCUS_RETURN_STAGE=MIGRATED` or `CANDIDATE` |
| Build check | The producer reads the served commit on `/health`. MIGRATED must be `6b96ba1b`; CANDIDATE must not be. |
| Write gate | `WSF_CAPTURE_FRAMES=1` (via `helpers/capture`). Set it for this file only: other producers in the suite rewrite accepted evidence. |
| Frames | 4 per stage, at 390×844. |

## Why only these four

The packet changes where focus lands, not what any screen draws. On web, a control holding keyboard focus draws the
browser's focus ring, so the pixels change only where focus now lands on something visible after an exit:
- **the base:** focus is on `body` after every exit, so nothing is ringed;
- **the candidate:** the restored control is ringed.

No other state is photographed, and no layout, colour or copy changed.

## States

All data is synthetic, seeded on the local emulator (`demo-wsf-local`): "Alpharetta Morning Movers", with "October
Squat Challenge" at 1,847 of 5,000 squats; one viewer, "Alex Rivera". Each state is driven by the keyboard (focus, then
Enter).

| State (file name) | Journey | Focus the producer asserts before the shutter |
|---|---|---|
| `move-close-keyboard` | Home (two open goals) → MOVE → the sheet's Close | MIGRATED: `body`. CANDIDATE: `wsf-member-tab-move` (the ring is on MOVE). |
| `back-to-launcher` | Home → "Already moved? Record squats" → the route's own Back | MIGRATED: `body`. CANDIDATE: `wsf-community-goal-record-<goal>` (the ring is on the launcher). |
| `cold-back-heading` | `/contribute/<goal>?groupId=…` opened directly → Back | MIGRATED: `body`. CANDIDATE: `wsf-community-name`, the community's `h1`, the fallback when there is no opener. |
| `tab-enter-community` | Home → Enter on the Community tab | MIGRATED: Home is still current (Enter does nothing on the base) and focus is on the Community tab. CANDIDATE: Community is current and focus stays on its tab. |

## Reproducing

```sh
# emulators from the repo root
METADATA_SERVER_DETECTION=none npx -y firebase-tools emulators:start \
  --config firebase.westayfit.emulators.json --project demo-wsf-local
# the build you mean to photograph, emulator-flagged (its commit is what the strip will say)
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 npm --prefix apps/westayfit run build:web
# frames (this file only)
WSF_FOCUS_RETURN_STAGE=CANDIDATE WSF_CAPTURE_FRAMES=1 \
  WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  npx --prefix apps/westayfit playwright test tests-e2e/sprint-w9-focus-return-capture.spec.ts --workers=1
```

For MIGRATED, serve the build of `6b96ba1b`.
