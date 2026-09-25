# PARITY-DIFF-TOOL-1: control receipt

`apps/westayfit/tests-e2e/helpers/parityImageDiff.mjs` turns a reference PNG and a candidate PNG into:
- a side-by-side image;
- a 50% overlay;
- an absolute-difference image;
- a manifest of **descriptive** metrics.

It has no threshold, no score and no pass/fail. It also has no dependency: PNG is decoded and encoded with Node's built-in `zlib`.

```bash
node apps/westayfit/tests-e2e/helpers/parityImageDiff.mjs \
  --reference <ref.png> --candidate <cand.png> --out-dir <dir> --label <name>
```

**Exit codes:**
- `0`: written.
- `2`: `DIMENSION_MISMATCH`, and nothing written.
- `3`: an input it cannot read exactly (16-bit, interlaced, a bad CRC) or a bad argument, named.
- `1`: anything else.

## The control in this folder

`control-reference.png` and `control-candidate.png` are 64×48 images. They are identical except for one 10×6 region at (20, 10), which the candidate paints `rgb(255, 0, 0)`.

The committed outputs came from:

```bash
node apps/westayfit/tests-e2e/helpers/parityImageDiff.mjs \
  --reference docs/evidence-tools/parity-diff-tool-1/control-reference.png \
  --candidate docs/evidence-tools/parity-diff-tool-1/control-candidate.png \
  --out-dir docs/evidence-tools/parity-diff-tool-1 --label control
```

The manifest reports exactly that region:
- `changedPixels` 60;
- `changedBoundingBox` `{ x: 20, y: 10, width: 10, height: 6 }`;
- `alphaChangedPixels` 0.

`control.diff.png` is black everywhere outside the region. A second run writes byte-identical files; the SHA-256 of each output is in `control.manifest.json`.

## Reading real screenshots exactly

The decoder was checked pixel for pixel against Chromium (Playwright, `createImageBitmap` with no colour conversion) on committed PNGs:
- three `app-feel-parity-2` frames (RGB);
- three brand assets (RGBA).

Every opaque pixel matched, about 4.5 million in all. Every translucent mismatch was exactly Chromium's premultiplied-alpha round trip of the stored value (0 unexplained).

That is why the canvas is not used for the computation: it cannot hand back the stored values, and this tool compares exactly what the files hold.
