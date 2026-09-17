#!/usr/bin/env python3
"""Derive the We Stay Fit brand assets the app ships from the owner-supplied
originals, non-destructively and reproducibly.

Inputs (byte-for-byte copies of the owner uploads, see
apps/westayfit/assets/brand/originals/SHA256SUMS.json):
  wordmark-navy-green.original.png   full WE STAY FIT wordmark, navy/green
  wordmark-white-green.original.png  full wordmark, white/green
  monogram-navy-green.original.png   WE monogram, navy/green
  monogram-white-green.original.png  WE monogram, white/green

Outputs (apps/westayfit/assets/brand/derived/):
  wordmark-navy-green.png / wordmark-white-green.png
      The original artwork with its transparent margin trimmed to the alpha
      bounding box and downscaled with high-quality resampling to a delivery
      width. Every visible pixel, the letterforms and the proportions are
      preserved; nothing is redrawn, recoloured or stretched.
  monogram-silhouette.png
      The monogram's SILHOUETTE only: RGB is solid white, alpha is the
      navy/green original's alpha channel, trimmed to its bounding box. This
      is the rendering mask for the data-driven progress WE. The static green
      patches of the original are deliberately NOT carried into the progress
      instrument: static branding is not measured progress.
  monogram-fill-green.png, monogram-unfilled-navy.png,
  monogram-unfilled-white.png
      The same silhouette pre-tinted: confirmed-progress green #91CB7D for
      the filled layer; brand navy #0B1F3A for the unfilled layer on light
      surfaces; white #FFFFFF for the unfilled layer on the navy surface.
      These are the owner's own two colourways of the mark (navy/green and
      white/green) with the green reserved for measured progress, so an
      unfilled WE still reads as the brand mark, never as a disabled shape.
      Pre-tinting keeps the rendered colour identical on web and native
      instead of depending on a runtime tint filter.
  living-we-calibration.json
      For the silhouette, the cumulative opaque AREA from the bottom edge
      upward, sampled per 0.1% of fill, expressed as the fraction of the
      silhouette's height at which a bottom-anchored clip must stop so that
      the clipped (green) region covers exactly that fraction of the shape's
      area. A rectangle clip at 48.2% of height would not cover 48.2% of an
      irregular letterform; this table is what makes "48.2% filled" true.
  MANIFEST.json
      sha256 of every input and output, and the parameters used.

Run from the repository root:
  python3 scripts/westayfit/brand/derive-brand-assets.py
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
BRAND = ROOT / "apps" / "westayfit" / "assets" / "brand"
ORIGINALS = BRAND / "originals"
DERIVED = BRAND / "derived"

WORDMARK_DELIVERY_WIDTH = 1200  # px; rendered at ~160-220 CSS px, 3x safe
MONOGRAM_DELIVERY_WIDTH = 1200
CALIBRATION_STEPS = 1000  # one entry per 0.1% of fill, plus the 0 entry


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def trimmed(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    bbox = im.getchannel("A").getbbox()
    if bbox is None:
        raise SystemExit("image has no opaque pixels")
    return im.crop(bbox)


def downscale(im: Image.Image, width: int) -> Image.Image:
    if im.width <= width:
        return im
    height = round(im.height * width / im.width)
    return im.resize((width, height), Image.LANCZOS)


def derive_wordmark(name: str) -> Path:
    src = ORIGINALS / f"{name}.original.png"
    out = DERIVED / f"{name}.png"
    im = downscale(trimmed(Image.open(src)), WORDMARK_DELIVERY_WIDTH)
    im.save(out, optimize=True)
    return out


def derive_silhouette() -> tuple[Path, Image.Image]:
    src = ORIGINALS / "monogram-navy-green.original.png"
    out = DERIVED / "monogram-silhouette.png"
    im = downscale(trimmed(Image.open(src)), MONOGRAM_DELIVERY_WIDTH)
    alpha = im.getchannel("A")
    white = Image.new("RGBA", im.size, (255, 255, 255, 0))
    white.putalpha(alpha)
    white.save(out, optimize=True)
    return out, white


PROGRESS_GREEN = (0x91, 0xCB, 0x7D)
BRAND_NAVY = (0x0B, 0x1F, 0x3A)
WHITE = (0xFF, 0xFF, 0xFF)


def tinted(silhouette: Image.Image, rgb: tuple[int, int, int], out: Path) -> Path:
    layer = Image.new("RGBA", silhouette.size, rgb + (0,))
    layer.putalpha(silhouette.getchannel("A"))
    layer.save(out, optimize=True)
    return out


def calibrate(silhouette: Image.Image) -> dict:
    """Bottom-anchored fill: for fill fraction f in [0,1] (by AREA), the
    height fraction h in [0,1] from the bottom edge such that the alpha mass
    in the bottom h of the image is f of the total alpha mass."""
    alpha = silhouette.getchannel("A")
    w, h = alpha.size
    px = alpha.load()
    row_mass = [sum(px[x, y] for x in range(w)) for y in range(h)]
    total = float(sum(row_mass))
    # cumulative mass from the bottom, per whole row: cum[k] = mass of the
    # bottom k rows (k = 0..h)
    cum = [0.0]
    for y in range(h - 1, -1, -1):
        cum.append(cum[-1] + row_mass[y])
    heights = []
    for i in range(CALIBRATION_STEPS + 1):
        f = i / CALIBRATION_STEPS
        want = f * total
        # smallest k with cum[k] >= want, then interpolate within row k-1
        k = 0
        while k < h and cum[k] < want:
            k += 1
        if k == 0:
            hf = 0.0
        else:
            prev, cur = cum[k - 1], cum[k]
            frac = 0.0 if cur == prev else (want - prev) / (cur - prev)
            hf = ((k - 1) + frac) / h
        heights.append(round(min(1.0, max(0.0, hf)), 6))
    heights[0] = 0.0
    heights[-1] = 1.0
    return {
        "source": "monogram-silhouette.png",
        "width": w,
        "height": h,
        "steps": CALIBRATION_STEPS,
        "direction": "bottom-up",
        "heightFractionByFill": heights,
    }


def main() -> None:
    DERIVED.mkdir(parents=True, exist_ok=True)
    outputs = [derive_wordmark("wordmark-navy-green"), derive_wordmark("wordmark-white-green")]
    sil_path, sil = derive_silhouette()
    outputs.append(sil_path)
    outputs.append(tinted(sil, PROGRESS_GREEN, DERIVED / "monogram-fill-green.png"))
    outputs.append(tinted(sil, BRAND_NAVY, DERIVED / "monogram-unfilled-navy.png"))
    outputs.append(tinted(sil, WHITE, DERIVED / "monogram-unfilled-white.png"))
    cal = calibrate(sil)
    cal_path = DERIVED / "living-we-calibration.json"
    cal_path.write_text(json.dumps(cal, separators=(",", ":")) + "\n")
    outputs.append(cal_path)
    manifest = {
        "generator": "scripts/westayfit/brand/derive-brand-assets.py",
        "parameters": {
            "progressGreen": "#91CB7D",
            "unfilledNavy": "#0B1F3A",
            "unfilledWhite": "#FFFFFF",
            "wordmarkDeliveryWidth": WORDMARK_DELIVERY_WIDTH,
            "monogramDeliveryWidth": MONOGRAM_DELIVERY_WIDTH,
            "calibrationSteps": CALIBRATION_STEPS,
            "resample": "LANCZOS",
        },
        "inputs": {p.name: sha256(p) for p in sorted(ORIGINALS.glob("*.original.png"))},
        "outputs": {p.name: sha256(p) for p in outputs},
    }
    (DERIVED / "MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
    for p in outputs:
        im = Image.open(p) if p.suffix == ".png" else None
        print(p.relative_to(ROOT), im.size if im else "", sha256(p)[:12])


if __name__ == "__main__":
    main()
