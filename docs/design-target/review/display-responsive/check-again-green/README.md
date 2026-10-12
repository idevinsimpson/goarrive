# Public display · `Check again` as an action (ACTION_GREEN)

**Status: IMPLEMENTED and TESTED. Not accepted, not integrated, not staged.**
L0 exports this pair for the Director's pixel review. It is not a staging gate.

Released by the Director at #365 `5800718059`, under the action-colour ruling
`5796783829` ("a wall-display action is still an action"). Packet: L0 on #435
`5800732038`.

## The change

One style line on the route's own control: `recheckButton` in
`apps/westayfit/app/display/[goalId].tsx` goes from `PROGRESS_GREEN` `#91CB7D`
to `ACTION_GREEN` `#22C55E` (from `src/ui/kit.ts`).
- The label ink stays the display's navy. On `#22C55E` that measures well above
  4.5:1.
- Elsewhere the product pairs ACTION_GREEN with `ON_ACTION` `#04260F` ink
  (`/goals/new`, `/contribute`). Whether to adopt that pairing here is left to
  the pixel review, not decided alone.
- No shared token, layout, payload, privacy or polling change.

## Frames

| file | size | source |
| --- | --- | --- |
| `CHECK-AGAIN-GREEN-refused-800x1280.png` | 800×1280 | see the delivering commit on `claude/wsf-display-check-again-green` (base `f2f901a`) |
| `CHECK-AGAIN-GREEN-refused-1920x1080.png` | 1920×1080 | same run |

- **Producer:** `tests-e2e/sprint-w2-display-responsive-capture.spec.ts`,
  `matched AFTER` test, gated by `WSF_CAPTURE_FRAMES=1`. These are whole-viewport
  screenshots at deviceScaleFactor 1, taken against the emulator with a synthetic
  refused goal. `SAMPLE DATA` shows because it is an emulator build; it never ships.
- **Against the accepted `AFTER-refused-*` frames**
  (`review/display-responsive-after/after/`, frozen and historical): the only
  pixels that differ sit inside the control's own box. That is 8,445 px in
  x319–480 / y687–740 at 800×1280, and 8,447 px in x879–1040 / y627–680 at
  1920×1080. Nothing else in either frame moved. The refused state has no
  wall clock, so this comparison is exact.

## Verification

- **Fails first.** On the unchanged product (`f2f901a`) the new assertion reads
  `rgb(145, 203, 125)` where `rgb(34, 197, 94)` is expected, at both classes.
  With the change, the spec passes **12/12**.
- The assertion checks the computed background of `wsf-display-recheck` and its
  effective opacity (product of ancestors) = 1.
- The eight accepted AFTER frames stay byte-identical to `8165b52`.
- Under the producer's frozen clock (the later, test-only change; see
  `display-responsive-after/README.md`, "Frozen clock") this pair carries no
  clock and came back byte-identical run to run in three gated runs, and
  identical to the committed pair.

## Limits

Chromium and emulator only. The refused state is the only state that renders
`Check again`, so only that pair is recaptured. There was no broad recapture.
