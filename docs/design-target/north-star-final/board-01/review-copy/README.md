# Board 01 — review copies

**These are lossy copies for reading. They are not the artifact and they are not evidence.**

The artifact of record is one directory up:

```
docs/design-target/north-star-final/board-01/WE_STAY_FIT_NORTH_STAR_BOARD_01_HOME_CANDIDATE.png
2560 × 4380 (1280 × 2190 @2x) · 1.7 MB
```

They exist because PR #365 comment [`5781542755`](https://github.com/idevinsimpson/goarrive/pull/365#issuecomment-5781542755) recorded that the director's `fetch_file` returned empty image content for the candidate and `fetch_blob` failed decoding it, and asked for *"a faithful readable review copy/inline image delivery with provenance alongside the original."* Every file here is under 1 MB for that reason.

| File | Size | What it is |
| --- | --- | --- |
| `BOARD-01-review-whole.jpg` | 1600 × 2738 | The whole board. Composition and hierarchy; the 7–9px print is not meant to be read here. |
| `BOARD-01-review-lifecycle-strip.jpg` | 2352 × 888 | The lifecycle panel at the source's full 2× — the eight captured states and the drawn ninth. |
| `BOARD-01-review-seam-panel.jpg` | 1236 × 1306 | The seam panel at the source's full 2× — what #390 approves, and what it does not. |

## Provenance

Each file is **cut from that exact PNG** — not re-rendered, and not re-captured — at coordinates measured from the board's own live DOM, so a panel copy cannot drift out of step with the board it claims to show. They are JPEG, so they are lossy: colour values sampled from them are not the board's colours, and an artifact seen only here should be checked against the PNG before it is reported.

What the underlying board is made of is unchanged and stated on its face: the four phones and the eight captured lifecycle states are real captures of the running product at 2×, from the emulator build of app `e609c57`. The **seam panel** and the strip's **ninth cell** are labelled compositions, not captures. Nothing in this folder is an after.

## Regenerating

```sh
WSF_PLAYWRIGHT_CHROMIUM=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1) \
  node docs/design-target/north-star-final/board-01/review-copy/make-review-copies.mjs
```

The script re-reads the committed PNG and re-measures the board, so running it after the board changes produces copies of the new board — and running it without changing the board reproduces these files.
