# TOGETHER-COMPLETION-1: canonical evidence

This is W9's evidence for the Together completion port. It is **delivered only**: not reviewed, accepted, integrated or staged. Independent journey QA and the Director's acceptance of the exact subject are still to come.

| | |
|---|---|
| Base (BEFORE) | `5be74f3f2763e5aee21d6c20f67ea13fd7dd69cb`, live development head when the packet was ACKed. Served marker `5be74f3f`. |
| Product subject (AFTER) | `d9d209f4ca96b7faca58334ca36457a58e19740e`. Served marker `d9d209f4`. |
| TARGET (frozen, not copied here) | Reference export `bdd6935877c9160dab2081e734dec690c9553b87` → `docs/design-target/references/together-completion-1/`, Lovable head `66e53073df1f09ca727454e4186dd301865a8ad1`. Read it in place. |
| Environment | Firebase emulators (`demo-wsf-local`), web export served by emulator Hosting, Playwright 1.62.1 with headless Chromium 141. |
| Fixtures | Synthetic only (`tests-e2e/helpers/expo-attendee-fixtures.ts`). Every name starts with "Fixture", every address is under `example.com`, and every starting total is seeded. |

## Frames: matched BEFORE and AFTER, same fixtures, same sizes

The "settled" frames are taken after the 3,400 ms settle.

| State | BEFORE (`before/`, base) | AFTER (`after/`, subject) |
|---|---|---|
| Ordinary: seeded 3,700 + 20 squats → 3,720 / 5,000 | `ordinary-settled-390x640.png`, `-390x844.png`, `-1280x900.png` | same three names |
| Crossing (controlled fixture, see below): seeded 4,980 + 35 → 5,015 / 5,000 | `crossing-settled-390x844.png` | `crossing-settled-390x844.png` |
| Motion | none | `together-motion-ordinary-390x844.webm`: 4.6 s from the receipt appearing. It shows the gathering pieces, the 94% → 110% rebound, the confirmed-ratio fill and the settle. |

The frozen Lovable TARGET frames (`lovable/evidence/*.png`, `together-motion.webm`) use their own documented local fixtures (241 → 261 / 500, 490 → 510 / 500). They are a target, not a pixel-identical pair for these frames.

## Results on the product subject `d9d209f4` (logs in `runs/`)

- **Unit tests:** 71/71 (`tests/together-completion.test.ts` + `tests/contribution-flow.test.ts`) → `unit-d9d209f4.txt`.
- **Together journeys:** 13/13 in `tests-e2e/ui-contribute-together.spec.ts`, captures and clip included → `together-spec-d9d209f4.txt`:
  - ordinary motion;
  - a snapshot that a later live change does not rewrite;
  - an authoritative crossing;
  - a reconciled crossing that stays static and counts once;
  - reached without the server signal, which stays static;
  - reduced motion: on from the start, switched on mid-motion, then off with no replay;
  - a double tap that records once;
  - leaving mid-motion;
  - a second movement;
  - an own-only receipt.
- **Affected regressions:** 113/113.
  - `regression-1-d9d209f4.txt`: 47 tests in ui-contribute, ui-contribute-crossing, ui-contribute-repeat-policy, sprint-w9-focus-return-1, sprint-w9-contribute-exits, e4-a1-shared-goal, ui-contribute-short-phone and ui-kiosk.
  - `regression-2-d9d209f4.txt`: 66 tests in ui-a11y, sprint-w9-app-feel-parity-1, ui-contribute-torture, ui-contribute-torture-2, move-follow-along, sprint-w9-home-return and sprint-w1b-contribute-exits.
- **One red, outside the reservation:** `sprint-w9-recovery-port-rendering.spec.ts`, the test "receipt: the member's own numbers before the community's, and the way back is the green action" → `recovery-port-rendering-d9d209f4.txt`.
  - It asserts the RECOVERY-PORT-1 receipt order and its `rgb(34,197,94)` / white button fills.
  - The owner-selected Together hierarchy and palette replace both on purpose.
  - The other 5 tests in that spec pass.
  - Updating it needs a reservation delta, or Director confirmation that it is superseded. It is **not** edited here.

### First run, reported as it happened (`first-run-wip.txt`, `regression-*-wip.txt`)

These ran against intermediate working trees before the subject was committed:

- **Two Together tests** failed on a reporting attribute that read the consumed `fresh` flag. The motion itself had played. Fixed by capturing eligibility at mount.
- **`ui-contribute.spec.ts`, two tests** failed on a printed `before → after` pair. That pair breaks the existing concurrency invariant (no before/after pair, no crediting of a peer's work), so it was removed. The reliable before now drives only the visual fill tween.
- **`ui-contribute-short-phone`, 390×640:** "Record more" sat 17 px below the safe inset. Fixed by tightening the short-screen layout.
- **`ui-a11y` R1, 8 tests:** long or unbroken community and goal names ran past the edge. Fixed by wrapping those lines.

## Truth notes the Director should see

1. **Today's server never returns `crossedTarget: true`.** `wsfContribute` records `reachedAt` on the goal and names no attempt, as its comments and `ui-contribute-crossing.spec.ts` both state. The authoritative-crossing presentation is therefore reached in tests only through a **controlled fixture**: the real response for the real attempt, with that single field set. Every other number on that receipt is the server's. On the current server, a real crossing shows the truthful static "Our goal is reached." receipt and no crossing motion.
2. **No printed before → after.** The donor shows `241 → 261 / 500`. The canonical receipt prints only the exact confirmed total, because of the invariant above.
3. **Kiosk receipts are unchanged.** The new completion is member-scoped. On native, which this packet does not prove, the receipt renders settled and static, because the motion runs only on web.
4. **The canonical artwork keeps its own calibration.** It uses the locked 1200×583 owner-derived pair with its own `heightFractionForFill`. The unfilled layer is tinted `#314C65` on the receipt only, and the wordmark is tinted `#F6F9FD` on the receipt only. No asset or calibration byte changed, and the donor's 1282×609 CDF is not used.

## Not claimed

Hosted, native, Safari or iOS, device, and owner feel are not claimed. These are local headless-Chromium frames.
