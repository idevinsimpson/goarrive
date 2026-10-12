# Home correction · one Living WE per screen

**What changed.** The mini Living WE is gone from Community Home's **"Also
under way"** rows and its **History** rows. The featured goal's hero mark is
untouched. Nothing else about Home moved.

**Why.** The mark is the product's signature instrument, and the North Star
draws it once per screen, big, as the thing the screen is about. Repeating it
at 104px on every secondary and closed row turned a signature into a bullet
point: several small WEs down one page compete with the hero's and with each
other, and none of them reads as important. The newer locked North Star
supersedes the older accepted screenshot on this specific point.

Nothing was lost with the mark, because nothing was being said twice: those
rows already print the real shared total and the real percentage, which is the
same confirmed ratio the mark was filling from.

## Why this folder exists at all

`../AFTER-home-*.png` is the accepted evidence for this route, and it is
**byte-unchanged** by this correction — but not because nothing moved. That
fixture seeds **one** active goal, so the accepted frames contain no "Also
under way" section and no History section. They could neither regress nor
demonstrate the change, and reporting them intact would have been a true
statement about the wrong thing.

These frames seed the case the accepted ones do not cover: a featured goal, a
second open goal, and two closed goals — one reached, one short — so both
closed results are in frame.

| File | What it shows |
| --- | --- |
| `ACTUAL-home-alsounderway-*.png` | The secondary open-goal row: title, total, percentage, remaining, and its own action. No mark. |
| `ACTUAL-home-history-*.png` | Two History rows: total, result (`Reached` / `Closed at N%`), period. No mark. |

At 390×640, 390×844 and 430×932. Regenerate deliberately:

```
WSF_CAPTURE_FRAMES=1 WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  npm --prefix apps/westayfit run test:e2e -- \
  tests-e2e/design-home-we-correction-capture.spec.ts
```

**The frames are scrolled into place, not `fullPage`.** React Native Web
scrolls inside an element rather than the document, so `fullPage: true`
photographs the hero and stops at the fold — the first run of that spec
produced three frames showing none of the rows it exists to show.

## The rule is asserted, not only photographed

The same spec, ungated, asserts that exactly **one** `wsf-community-goal-we-*`
element is on the screen and that it is the featured goal's. A count catches a
mini mark creeping back onto a row; a screenshot review would have to notice an
absence, which is the harder thing to see.

`ui-matrix.spec.ts` was re-pointed rather than relaxed: for an **open** goal it
still asserts the mark's exact `data-fill-ratio`, and for a **closed** one it
now asserts the mark is absent. The row's numbers are asserted in both cases,
so the removal removed a duplicate rather than a fact.

`ui-community-home`, `ui-matrix`, `ui-a11y`, `ui-app-shell`, `e35-home`,
`community-list` and `e4-a1-shared-goal` pass at this head.
