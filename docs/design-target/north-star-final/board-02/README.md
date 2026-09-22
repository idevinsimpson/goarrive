# Board 02 — MOVE

**Status: FINAL.** Locked by PR #365 comment [`5771235529`](https://github.com/idevinsimpson/goarrive/pull/365#issuecomment-5771235529): *"Board 02 now clears the MOVE + contribution + confirmation North Star gate."* Status layer from the lock: `/move` and `/contribute/[goalId]` are **accepted build**; the board is a refinement of accepted behaviour, not proof of new capability.

`WE_STAY_FIT_NORTH_STAR_BOARD_02_MOVE_FINAL.png` · 2560×4940 (1280×2470 @2x)

## How it was made

```
node scripts/westayfit/north-star/render-board.mjs scripts/westayfit/north-star/board-02.mjs \
  docs/design-target/north-star-final/board-02/WE_STAY_FIT_NORTH_STAR_BOARD_02_MOVE_FINAL.png
```

Eleven frames. Nine are the **accepted Page 2 AFTER evidence** — `docs/design-target/review/page-02-move/after/`, the byte-frozen captures the route was accepted on (dd608a8), read in place and never copied or altered. Two are captured by `apps/westayfit/tests-e2e/north-star-board-02-capture.spec.ts` (gated, `WSF_CAPTURE_FRAMES=1`) because the lock names them and the AFTER set never photographed them: the confirmation that takes the community to its goal, and a contribution after the goal was already met. Both run the real flow against the real callable on the emulators, and every number on them is asserted before the shot (`captures/`).

## Checked against the lock

| Locked | On the board |
| --- | --- |
| MOVE opens as a focused chooser over the real Home context; only open goals selectable | `AFTER-move-choose` |
| Contribution and review anchor to the confirmed community goal with one calibrated Living WE | `AFTER-contribute-move`, `-entry`, `-review` |
| Pre-write shared total is never predicted; review previews the member's own credit only | The review frame shows `0 → 20 squats`, own part only |
| The server-confirmed receipt owns the new shared total and updates the Living WE from it | `AFTER-contribute-confirmed`: 1,847 → 1,867, mark filled from the receipt |
| Confirmation is the one member screen allowed a full navy field; exact result copy authoritative | All four confirmations |
| `Record more <unit>` only where policy/server permit | Present on the `multiple`-policy fixtures shown |
| Pending/unknown has no shared-goal anchor, makes no progress claim, preserves the attempt | `AFTER-contribute-pending` |
| Definitive refusal distinct from unknown | `AFTER-contribute-refused` |
| Reached/open keeps a full Living WE and truthful open-state copy | `confirmed-reached-open`: 515 of 500, "Our goal is reached.", "15 beyond our goal · still open" |
| Post-target keeps the mark full, percent capped at 100%, overshoot in the exact total | `confirmed-post-target`: 532 of 500, 100%, "32 beyond our goal · still open" |
| No-goal has no Living WE; past contributions stay in Progress; new ones need an open goal | `AFTER-move-nogoal` |
| Timer guides movement, never counts the person; kiosk/event infrastructure separate | The timer frame's own copy; no kiosk chrome anywhere |
| Exact WSF assets, Board 00 colours, five-slot shell | Owner wordmark; every frame is the product |

## Where the accepted build reads differently from the lock's wording

- The lock's **illustrative fixture** was 241 → 261 of 500 with own credit 120 → 140. The accepted evidence carries the accepted fixture (1,847 → 1,867 of 5,000, own credit 0 → 20). The two new confirmations use 500-target fixtures so the reached and post-target states are exact.
- The receipt contract carries `crossedTarget`, but `functions-westayfit/src/index.ts` never raises it yet (*"never raised here"*), so the member whose attempt crossed reads the state truth **"Our goal is reached."** and no "this one took us past our goal" line. The board shows what the product says, not what the contract could say.
- `SAMPLE DATA` appears at the foot of the accepted confirmation frames and the two new ones alike; it is the route's own label on the emulator build.
