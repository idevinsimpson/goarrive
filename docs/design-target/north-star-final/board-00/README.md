# Board 00 — Brand foundation

**Status: FINAL.** Locked by PR #365 comment [`5770785512`](https://github.com/idevinsimpson/goarrive/pull/365#issuecomment-5770785512), which made this board *"the governing visual constitution for Boards 01–17."*

`WE_STAY_FIT_NORTH_STAR_BOARD_00_BRAND_FOUNDATION_FINAL.png` · 2560×2800 (1280×1400 @2x)

## How it was made

Rendered deterministically from this repository:

```
node scripts/westayfit/north-star/render-board.mjs \
  scripts/westayfit/north-star/board-00.mjs \
  docs/design-target/north-star-final/board-00/WE_STAY_FIT_NORTH_STAR_BOARD_00_BRAND_FOUNDATION_FINAL.png
```

Same input, same picture, every run. Nothing on it is generated imagery.

- **The wordmark and both monogram colourways are the owner-derived PNGs in
  `apps/westayfit/assets/brand/derived/`, composited byte-faithfully.** Not
  redrawn, not recoloured, not approximated — the blocker that held revisions 2
  and 3.
- **Every Living WE fill height is read from `living-we-calibration.json`**, the
  same area table `heightFractionForFill()` reads at runtime, interpolation
  included. The green *area* on this board is the green area the product paints.

## Checked against the lock, line by line

| Locked requirement | On the board |
| --- | --- |
| Exact owner wordmark / monogram usage | Composited from the derived PNGs; no redraw anywhere |
| One silhouette, calibrated bottom-up confirmed-progress fill | Six states across one identical silhouette |
| 0% unfilled | Navy on light, white on navy — the owner's own colourways, shown side by side |
| Intermediate area-calibrated | 241/500 renders at **52.67% of height for 48.2% of area** — the 4.5-point correction this calibration exists to make |
| 100% full | 500/500 fully `#91CB7D` |
| Overshoot numerically retained, mark stays full | 515/500 — the number keeps the overshoot, the mark does not exceed full |
| **No denominator = no instrument** | "no goal" shows an empty slot labelled NO INSTRUMENT. No grey WE — revision 3 drew one beside the words "Living WE not shown" and was held for exactly that |
| `#91CB7D` progress green vs `#22C55E` action green | Separate palette rows, each with its own job, and a line saying they are never swapped |
| Cream/light ground, selective navy weight, navy room/display canvases allowed | Cream ground; one navy panel carries the dark-surface colourway |
| Static WE is branding only, never a progress substitute | Hard two-column divide; the static rule is stated as a non-state rule |
| Governing public copy only | The two locked lines, under a note that any other phrase is exploratory |
| Confirmed changes render immediately; no timing approved | MOTION panel, phrased as present behaviour |
| Typography = shipped product scale | Display XL 40/44, LG 34/38, MD 29/33; Heading 28/34; Subheading 18/24; Body 16/22; Caption 13/18 |

Deliberately absent, because the holds that preceded the lock removed them: any
app-icon policy, the `COMMUNITY | MOVEMENT | BELONGING | IMPACT` and
`LIVING WE. STRONGER TOGETHER.` footers, the "What we stand for" micro-copy, and
any presentation of the script tagline treatment as a locked typography rule.

## Nothing was filled from memory

The lock settles every panel above. Where it did not settle a detail, the detail
is not on the board.
