#!/usr/bin/env node
/**
 * Cuts lightweight REVIEW COPIES of the owner boards, and separately viewable
 * panels of the six numbered concepts on the AFTER board.
 *
 * THE ORIGINALS ARE NEVER TOUCHED. They are the owner's artefacts and the
 * north star; everything written here goes to `review-copies/` and every file
 * records the original it came from, so no copy can be mistaken for the
 * source or quietly drift from it.
 *
 * Panel geometry is declared rather than detected. The AFTER board is a fixed
 * 1448x1086 composition with six evenly spaced phone panels; hard-coding the
 * grid and asserting the board's dimensions is honest about the fact that
 * this only works for THIS board. If the board is ever replaced, the
 * assertion fails loudly instead of silently cutting the wrong rectangles.
 *
 * Usage:  node scripts/westayfit/owner-board-review-copies.mjs
 * Needs:  python3 with Pillow (already used by the evidence checks).
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const DIR = 'docs/design-target/owner-north-star';
const OUT = path.join(DIR, 'review-copies');

const BEFORE = 'OWNER-BOARD-1-before-current-wsf-experience.png';
const AFTER = 'OWNER-BOARD-2-after-target-wsf-vision.png';

/** The six concepts, in the board's own numbering and its own words. */
const PANELS = [
  ['1', 'community-home', 'COMMUNITY HOME'],
  ['2', 'add-contribution', 'ADD CONTRIBUTION'],
  ['3', 'contribution-confirmation', 'CONTRIBUTION CONFIRMATION'],
  ['4', 'community-join', 'COMMUNITY / JOIN'],
  ['5', 'profile-personal-impact', 'PROFILE / PERSONAL IMPACT'],
  ['6', 'quick-check-in', 'QUICK CHECK-IN / CHALLENGE'],
];

const py = `
import os
from PIL import Image

DIR = ${JSON.stringify(DIR)}
OUT = ${JSON.stringify(OUT)}
BEFORE = ${JSON.stringify(BEFORE)}
AFTER = ${JSON.stringify(AFTER)}
PANELS = ${JSON.stringify(PANELS)}

os.makedirs(OUT, exist_ok=True)

EXPECT = (1448, 1086)

def review_copy(name, width=1200):
    src = os.path.join(DIR, name)
    im = Image.open(src).convert('RGB')
    assert im.size == EXPECT, f"{name}: expected {EXPECT}, got {im.size} — panel geometry is declared for the original board only"
    h = round(im.height * width / im.width)
    small = im.resize((width, h), Image.LANCZOS)
    dst = os.path.join(OUT, name.replace('.png', f'-review-{width}w.jpg'))
    small.save(dst, 'JPEG', quality=86, optimize=True, progressive=True)
    return dst, os.path.getsize(dst), im

d1, s1, _ = review_copy(BEFORE)
d2, s2, after = review_copy(AFTER)
print(f"{d1}  {s1//1024} KB")
print(f"{d2}  {s2//1024} KB")

# The six panels: the phone plus its numbered caption, cut from the ORIGINAL.
LEFT, RIGHT = 14, 1434
TOP, BOTTOM = 196, 886
span = (RIGHT - LEFT) / len(PANELS)
for i, (num, slug, label) in enumerate(PANELS):
    x0 = int(round(LEFT + i * span))
    x1 = int(round(LEFT + (i + 1) * span))
    panel = after.crop((x0, TOP, x1, BOTTOM))
    dst = os.path.join(OUT, f"CONCEPT-{num}-{slug}.png")
    panel.save(dst, optimize=True)
    print(f"{dst}  {panel.size[0]}x{panel.size[1]}  {os.path.getsize(dst)//1024} KB  # {label}")
`;

execFileSync('python3', ['-c', py], { stdio: 'inherit' });
