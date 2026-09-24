# RECOVERY-PORT-1 — the contribution's recovery states, before and after the port

Packet: Director #365 `5821372374` §1, assigned by L0 on #458 `5821470793`. Addenda: `5821671216`,
`5822156773`. Ruling: `5821650392`. Worker: W9. Route: `apps/westayfit/app/contribute/[goalId].tsx`.

**Nothing here is accepted.**
- MIGRATED frames show the route as it ships on the development base `6f994f5a`.
- CANDIDATE frames show the route with this packet's port.
- Neither is an AFTER. Every frame carries its stage, the served build's commit and "NOT ACCEPTED" in a
  strip inside the image, and the producer asserts all three before it writes.

| | |
|---|---|
| Producer | `apps/westayfit/tests-e2e/sprint-w9-recovery-port-capture.spec.ts` |
| Stage | `WSF_RECOVERY_PORT_STAGE=MIGRATED` or `CANDIDATE` |
| Build check | The producer reads the served commit on `/health`. MIGRATED must be `6f994f5a` (the base); CANDIDATE must not be. |
| Write gate | `WSF_CAPTURE_FRAMES=1` (via `helpers/capture`). Set it for this file only: other producers in the suite rewrite accepted evidence. |
| Ordinary run | Runs every check and writes nothing. |
| Frames | 12 per stage: 6 states at 390×844 and 390×640. |
| Reference | Lovable project `e15b9fa0…`, product source `02cb35c4`, evidence `97faee8b`, managed record `5420802a`. The six recovery PNGs are sha256-matched to their manifests. Used for composition only. |

## States

All data is synthetic and seeded on the local emulator (`demo-wsf-local`).
- Each state runs on its own fresh goal: "October Squat Challenge", 1,847 of 5,000 squats, in the
  community "Alpharetta Morning Movers".
- There is one viewer, "Alex Rivera", whose own total starts at 0. The only exception is the refusal,
  where the viewer already has 20.
- The route is opened cold, the way the community's "Already moved?" link opens it
  (`/contribute/<goal>?groupId=<community>&mode=record`). It draws its own chrome, so there is no member
  tab bar or top bar.

| State (file name) | How it is reached | What the producer asserts before the shutter |
|---|---|---|
| `review` | 20 entered, then Review | "Review your contribution"; "20 squats"; "Record 20 squats"; the repeat notice; "Edit"; **no write yet** |
| `unknown-INJECTED-REPLY-LOST` | Record, with the write allowed to land and its reply dropped in the browser (injected) | See the list below this table. |
| `confirmed-replay-INJECTED-REPLY-LOST` | The same session reloaded (the attempt restored, nothing sent), then "Confirm this contribution" | The **same attemptId** was sent again; "This contribution was already recorded."; "It counted once."; 1,867 of 5,000; own total 20, **counted once**; the reminder cleared |
| `confirmed` | An ordinary first write | "Recorded"; "You added 20 squats."; "You moved us closer."; 1,867 of 5,000 · 37.3% complete · 3,133 to go; "Alpharetta Morning Movers is now at 1,867 of 5,000 squats."; own total 20; "Back to community" |
| `refused` | A once-per-member goal the viewer has already contributed to. This is a **genuine** server refusal with no interception. | `data-reason="alreadyContributed"`; "This goal takes one contribution from each member."; "Your 20 squats were not recorded. Your earlier contribution to this goal still counts."; no reminder kept; no "!" |
| `own-only-INJECTED-REPLY-LOST` | The lost reply again, then the viewer removed from the community, then Confirm | `data-variant="ownOnly"`; "This contribution was already recorded."; own total 20; no shared total, Living WE, record-more, community name or "%"; "Back to home" |

For `unknown-INJECTED-REPLY-LOST`, the producer asserts:
- The pinned sentences: "We couldn’t confirm your contribution yet." / "We don’t know whether this effort
  was recorded. Don’t record it again." / "You entered 20 squats." / "Confirm this contribution" / "This
  sends the same attempt again. If it already reached us, it will not count twice."
- What must be absent: no discard control, no shared figure, no Living WE, no anchor.
- **No claim that the shared total is unaffected** (Director `5821650392` §1).
- The kept attempt is the one that was sent.

On every frame, on both stages:
- The page is at its top.
- Nothing scrolls sideways.
- The primary control is inside the screen, at least 44 px tall and on top at its centre. That is Confirm on
  the unknown screen, Record on review, and the labelled exit on refused and on the receipts.

**The pre-uid legacy row** (written before the key carried a uid) is checked but not photographed:
- the route retires it to `wsf.pendingContribution.orphan.<goal>.<attempt>`;
- it neither adopts nor sends it;
- nothing renders it.

That is Director ruling `5821650392` §2: a disclosed capability difference.

## Reproducing

```sh
# emulators from the repo root
METADATA_SERVER_DETECTION=none npx -y firebase-tools emulators:start \
  --config firebase.westayfit.emulators.json --project demo-wsf-local
# the build you mean to photograph, emulator-flagged (its commit is what the strip will say)
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 npm --prefix apps/westayfit run build:web
# frames (this file only)
WSF_RECOVERY_PORT_STAGE=CANDIDATE WSF_CAPTURE_FRAMES=1 \
  WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  npx --prefix apps/westayfit playwright test tests-e2e/sprint-w9-recovery-port-capture.spec.ts --workers=1
```

For MIGRATED, serve the build of `6f994f5a`.
