# We Stay Fit brand assets

`originals/` holds the four owner-uploaded PNGs byte-for-byte (see
`originals/SHA256SUMS.json`, copied from the owner's supplement of
2026-09-17). They are the source of truth and are never edited.

`derived/` holds what the app actually loads, produced only by
`scripts/westayfit/brand/derive-brand-assets.py` from those originals:
trimmed, downscaled wordmarks (letterforms and proportions untouched), the
monogram silhouette, pre-tinted layers for the progress WE (green fill, navy
unfilled for light surfaces, white unfilled for the navy surface), and
the area-calibration table that maps a fill ratio to a clip height for the
irregular letterform. `derived/MANIFEST.json` records the checksums of every
input and output. Re-run the script rather than editing a derived file.

The full wordmark identifies the product. The WE monogram is the progress
instrument only when rendered by `src/ui/LivingWeProgress.tsx` with a real
goal's confirmed total; the static originals carry fixed green patches that
make no progress claim and are not used as a progress mark.
