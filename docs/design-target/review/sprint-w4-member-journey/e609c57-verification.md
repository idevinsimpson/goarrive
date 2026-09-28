# Verification — the `e609c57` retry-colour fix and the existing Progress/Home corrections

Source SHA under test: **`e609c57319b2cb9f2a6dac044f310c535ec61185`**. Same emulator build and
run method as `journey-regression.md`.

Verdict: **all three corrections verified present and asserted. No regression found, no defect
to report.**

---

## 1 · The hero's "Try again" colour fix — VERIFIED

### What the fix is

`apps/westayfit/app/community/[groupId]/index.tsx`. `heroOutlineButtonText` had been recoloured
`NAVY` when the share control moved out onto the cream page, and the two retry controls that
stayed *inside* the navy hero took the colour with it — present in the DOM, clickable by a test,
and an empty outlined pill to a person reading the screen.

```
4200  heroOutlineButtonText: { color: CREAM, fontSize: 14, fontWeight: '700', textAlign: 'center' },
4201  shareButtonText:       { color: NAVY,  fontSize: 14, fontWeight: '700', textAlign: 'center' },
```

The hero label is the hero's light ink again; the share control, which sits on the cream page,
keeps navy through a style of its own. Confirmed on this head at `index.tsx:4200-4201`, with the
share control at `index.tsx:3458` reading `styles.shareButtonText`. The retry labels that take
the hero's ink are `index.tsx:3266` (the goals-list retry inside the hero) and `index.tsx:2153`,
which picks `heroOutlineButtonText` or `secondaryButtonText` on its `onDark` flag — so the same
control is correct on the navy hero and on the cream page.

### The two colour-asserting tests both ran and both passed

| Spec | Test | Result |
|---|---|---|
| `ui-community-home.spec.ts:544` | a failed pulse read says so on the hero, and its retry can be read | **✓ 3.6s** |
| `e5-community-goal-seam.spec.ts:354` | goal loading: loading, failure and Retry, with the Champion control tracked throughout | **✓ 13.7s** |

Both assert the **rendered** colour — `toHaveCSS('color', 'rgb(247, 245, 240)')` — not the
presence of the text. That distinction is the whole point: presence is what the pre-existing
coverage already had, and it was green throughout the period the label was invisible.

`ui-community-home:544` additionally proves the state is real rather than staged: a failed
pulse read shows the error with no mark and no percent, the retry label renders
`rgb(247, 245, 240)`, and once the read can succeed again the retry brings `48.2%` back in
place. `e5:354` asserts the goals-list retry label renders the same colour *before* it is
clicked, so the control is readable at the moment a person would have to find it.

The commit records that the new Home test was reproduced red first on the unfixed build with
`Received: rgb(11, 31, 58)`. W4 did not re-run that negative case — doing so would mean editing
the app, which is outside this worker's file ownership.

---

## 2 · The Progress reached-state fix (`activity.tsx`) — VERIFIED

### What the fix is

`reachedAt` records that a goal crossed its target **once**. It is an event, and events do not
un-happen, so the stamp survives a correction that takes the shared total back below target.
`activity.tsx` read it as the *present* state, so a goal corrected down to 2,400 of 3,000 still
wore REACHED and still drew the celebratory Living WE, on the strength of something true a week
earlier. It now derives from the confirmed current total via the existing `isReached` helper —
the rule Home was already applying. Progress was the one surface trusting the stamp alone.

### Asserted by `progress-list.spec.ts` — 6 passed (11.5s)

```
✓ 2 :163:5 › a finished goal the member was part of is kept, not filtered away (2.8s)
✓ 1 :184:5 › A GOAL CORRECTED BELOW ITS TARGET DOES NOT STILL SAY REACHED (3.3s)
✓ 3 :253:5 › a goal whose corrected total is still AT the target keeps REACHED (3.0s)
✓ 4 :299:5 › a goal with no recorded own part is not listed (4.2s)
✓ 5 :322:5 › one failed read leaves the rest standing, and the screen says so (2.7s)
✓ 6 :346:5 › retry recovers the screen without a reload (2.8s)
```

Tests 1 and 3 are the pair that matters, and they are a pair on purpose: one proves the
correction removes REACHED when the corrected total falls below target, the other proves it does
**not** over-fire when the corrected total is still at target. A fix that simply stopped reading
`reachedAt` would pass the first and fail the second.

---

## 3 · No mini Living WE on Home rows — VERIFIED

### Asserted by `design-home-we-correction-capture.spec.ts` — 3 passed (5.2s)

```
✓ 390x640 › one mark on the featured goal, none on the rows below it (2.4s)
✓ 390x844 › one mark on the featured goal, none on the rows below it (2.5s)
✓ 430x932 › one mark on the featured goal, none on the rows below it (1.5s)
```

Run with `WSF_CAPTURE_FRAMES` unset, so the spec asserted the rule and wrote nothing — which is
its documented ungated behaviour.

This spec exists because the accepted `page-01-home/AFTER-home-*.png` frames seed **one** active
goal, so they contain no "Also under way" section and no History section at all. They could
neither regress nor demonstrate this change, and an intact-evidence check over them would have
been a true statement about the wrong thing. The spec seeds the case the accepted frames do not
cover — a featured goal, a second open goal and two closed ones — and asserts one mark on
screen.

The assertion is also not merely a count. Commit `3c7c7d3` had found that the capture passed
`endsInMs`, which is not a field `seedActiveGoal` has (its parameter is `endsAt?: Date`);
Playwright transpiles without typechecking, so the property was silently dropped, both goals took
the helper's default end, and which one came back featured was decided by nothing at all. The
spec now asserts the one mark on screen belongs to the goal the fixture *meant* to feature — a
bare count passes with the two goals swapped, which is exactly the state the missing dates left.

### Cross-checked by `ui-matrix.spec.ts` — 2 passed (29.4s)

```
✓ 1 :383:7 › phone 390×844 › the six states agree across Community Home, the contribution
             screen and the display (28.2s)
✓ 2 :573:7 › wide 1440×900 › the distant display carries the same four states, full page (5.8s)
```

---

## Totals

**61 tests across 8 specs on `e609c57`. 61 passed, 0 failed, 0 skipped.**
Frozen BEFORE (8 paths) and accepted TARGET/AFTER (16 paths) byte-unchanged.
