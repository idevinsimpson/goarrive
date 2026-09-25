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

## The change (CANDIDATE, product `da7e30bb`)

Only the failed refresh changes. When a re-read fails while a confirmed figure is shown, and no read issued after it has
already landed:
- The figure, its percentage and what is left stay. The existing **"Confirmed h:mm"** stays exactly as it was.
- The hero's pill says **"Last known"** in place of the window line.
- A polite live line beside the figure says **"Couldn’t refresh. This is the last confirmed figure."**, with
  **Retry**. Retry is the existing `refreshProgress`.
- The own row's label reads **"Your last-known contribution"**, because it comes from the same read.
- Another open goal's card says the same.

The next read that lands (Retry, Refresh, a return, or the settle) clears all of it. A first read that fails keeps the
existing "Progress couldn’t be loaded just now." with Try again, because there is no figure to call last known.

**Pixel check, MIGRATED against CANDIDATE:**
- **`confirmed-return` and `unknown-return-…`:**
  - identical at 390×640;
  - at 390×844 only the "Confirmed h:mm" line and the momentum row's age ("just now" or "1m ago") differ. Those are
    the capture times, not a composition change.
- **`refresh-failed-INJECTED`:** the hero carries the pill, the line and Retry, and the page below it moves down by
  their height. At 390×640, "Already moved?" is still on screen above the tab bar.

## Intentional differences from the reference

| # | Reference | Canonical | Why |
|---|---|---|---|
| 1 | HOME-POLISH-1 `final-stale` **replaces the number** with "Progress unavailable" and "Last confirmed: 241 of 500". | The retained figure **stays**, labelled "Last known", with its "Confirmed h:mm". | The packet: "label the retained figure as the last known one, keeping the existing Confirmed h:mm". The figure is still the server's last confirmation. |
| 2 | A large filled green **Retry** as the hero's centre. | A 44 px outline **Retry** on the navy, beside the sentence. The "Refresh" under the actions stays. | Retry is the existing refresh. The healthy composition (HOME-POLISH-1, accepted) is not reopened, and the failure state stays secondary to the goal. |
| 3 | "23 members · last known", "Today’s movement unavailable", momentum "Unavailable right now". | Presence and momentum are unchanged. | They come from separate reads, `wsfCommunityMembers` and `wsfCommunityActivity`, which keep their last answer silently when a return re-read fails. That is **reported, not changed**: the packet names the retained progress figure, and those reads are not the figure. |
| 4 | Stale is a review-control fixture ("Stale / unavailable"). | Stale is reached only by a real failed read (injected here). | Demo only: the review controls are not ported. |
| 5 | RECOVERY-TRUTH-1 unknown Home: "unknown attempt not credited" (the demo never sent it). | Request dropped: the same. Write landed and reply lost: the **server's** total, which includes it, shown once. | Truth: canonical shows server-authoritative totals and adds nothing itself; the pending reminder on the contribution route is what says "unknown". |
| 6 | Home after Finish: "Sample data · just now" row, `+20`. | "Alex Rivera added 20 squats · just now" (the social row as accepted). | Accepted social contract and privacy toggles; no sample data. |
| 7 | Prototype band, "PROPOSED DESIGN PROTOTYPE", review controls. | None. | Demo only. |

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
