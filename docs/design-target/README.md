# Design target — the member product

Two kinds of image live here, and they must never be confused with one another.

| Folder | What it is | How it was made |
| --- | --- | --- |
| `before/` | **Real screenshots of the product as served today.** | Captured from the running app at `0dd6cdd`, the merge of `claude/wsf-ui-member-experience` @ `6b257c3` onto the app shell. |
| `targets/` | **Concept mockups. Not implemented, not shipped, not scheduled.** | Rendered from `src/targets.html`, a standalone HTML file. No product code was involved. |
| `after/` | **Real screenshots of the product once a page has shipped.** | Captured the same way `before/` was, from the running app. One file per page implemented so far. |
| `CONTACT-SHEET-before-to-targets.png` | The two sets side by side. | Rendered from `src/contact.html`. |

## The rule these files exist to keep

**A target is never called an "after".**

An *after* is a screenshot of the product once a change has shipped. Nothing in
`targets/` is that, so every one of those images carries the words
`TARGET / CONCEPT — NOT IMPLEMENTED` across the top and again across the bottom,
burnt into the image rather than written in a caption that can be cropped away.
Real after-screenshots go in `after/`, captured the same way `before/` was —
from the running app. `after/` currently holds Page 1 (Home) only; the other
pages have targets and no after, because they have not been built.

## The Living WE in these targets is the real one

The mark filling with green on the Home, short-viewport and confirmed targets is
the product's own monogram, loaded straight from
`apps/westayfit/assets/brand/derived/`. Its fill is not drawn by eye: the clip
height comes from the shipped area-calibration table that
`apps/westayfit/src/ui/livingWeCalibration.ts` reads, so the green *area* is the
true ratio rather than merely the green height.

| Fill | Clip height from the bottom |
| --- | --- |
| 36.9% | 43.55% |
| 39.3% | 45.49% |

An earlier draft of these targets replaced the WE with a generic progress ring.
That was wrong twice over: the Living WE is the product's signature instrument,
and it is already truthful — it is what the served Home renders today. The ring
is gone and the mark is back, giant.

## Why the targets are standalone HTML and not the real screens

Rendering the targets from production React Native screens would have tied them
to the token grammar the reset is supposed to question — the cream ground, the
floating card, a type scale that stops at 32px. Building them as a separate file
lets the target argue for a different grammar. The cost is that these are
drawings: nothing here is proof that the product can be built this way, only a
statement of what it should feel like.

## What the sample data is, and what it is not

Every figure, name and timestamp is invented sample data. The targets hold to the
same truth constraints the product does:

- No names against contributions, and no way to tell who added what.
- No rankings, no comparison between people, no health claims.
- No invented faces and no unique-person counts.
- A member's own numbers are private to them; only the community total is shared.

Truth and privacy decide *what* a screen may show. They do not decide how it
feels, which is what these targets are about.

## Regenerating

```sh
node docs/design-target/src/render.mjs
```

Edit `src/targets.html` or `src/contact.html` and re-run; both HTML files are
self-contained apart from a Google Fonts stylesheet. Set `CHROMIUM_PATH` if
Playwright's own Chromium is not on the default path.
