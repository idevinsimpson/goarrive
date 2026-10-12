#!/usr/bin/env node
/**
 * Renders the Community banner's ring as an in-bounds transparent asset
 * (COMMUNITY-SETTINGS-PARITY-1; Director #506 `5845316335`, W4 option (a)).
 *
 * THE FROZEN GEOMETRY (Lovable `e15b9fa0…` @ `d4f60624`, src/styles.css
 * `.community-banner::after`): a 260×260 circle with a 40 px border in
 * color-mix(confirmed 14%, transparent), placed right −90 / top −90 and clipped
 * by the navy banner. Only its top-right 170×170 can ever be seen: the banner's
 * right edge cuts it at x = 170 (from the circle box's left, 260 − 90) and its
 * top edge at y = 90. So this renders that crop: the circle's centre at (130, 40)
 * in the crop, the ring between radius 90 and 130, and nothing else.
 *
 * Drawn at right 0 / top 0 of the banner, the asset's layout box stays inside
 * the banner, so ui-app-shell R1 (nothing laid out past the right edge) holds
 * without being relaxed. Pixels outside the ring are fully transparent.
 *
 * DETERMINISTIC: 1×/2×/3× are rendered by 16×16 supersampling per pixel, and
 * PNG-encoded with Node's zlib only (no package). The same run always writes
 * the same bytes; `--check` re-renders in memory and fails if a committed file
 * differs.
 *
 *   node scripts/westayfit/render-banner-ring.mjs          write + receipt
 *   node scripts/westayfit/render-banner-ring.mjs --check  verify committed bytes
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'apps/westayfit/assets/brand/derived');

export const GEOMETRY = {
  circle: 260,
  border: 40,
  right: -90,
  top: -90,
  // Derived: the visible crop and the circle's centre / radii inside it.
  crop: 170,
  centre: [130, 40],
  inner: 90,
  outer: 130,
};
/** The accepted BANNER_RING token: confirmed green #91CB7D at 14 %. */
export const TOKEN = { rgb: [145, 203, 125], alpha: 0.14 };
const SUPERSAMPLE = 16;
const SCALES = [1, 2, 3];

function coverage(scale, px, py) {
  const [cx, cy] = GEOMETRY.centre;
  const n = SUPERSAMPLE;
  let hit = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = (px + (i + 0.5) / n) / scale - cx;
      const y = (py + (j + 0.5) / n) / scale - cy;
      const d2 = x * x + y * y;
      if (d2 >= GEOMETRY.inner * GEOMETRY.inner && d2 <= GEOMETRY.outer * GEOMETRY.outer) hit++;
    }
  }
  return hit / (n * n);
}

function crc32(buf) {
  let c = ~0;
  for (let k = 0; k < buf.length; k++) {
    c ^= buf[k];
    for (let b = 0; b < 8; b++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function render(scale) {
  const size = GEOMETRY.crop * scale;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const [r, g, b] = TOKEN.rgb;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const a = Math.round(TOKEN.alpha * coverage(scale, x, y) * 255);
      const o = row + 1 + x * 4;
      if (a > 0) {
        raw[o] = r;
        raw[o + 1] = g;
        raw[o + 2] = b;
      }
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const fileFor = (scale) => path.join(OUT, scale === 1 ? 'banner-ring.png' : `banner-ring@${scale}x.png`);
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const files = [];
  let bad = 0;
  for (const scale of SCALES) {
    const png = render(scale);
    const file = fileFor(scale);
    const rel = path.relative(ROOT, file);
    if (check) {
      const same = fs.existsSync(file) && sha(fs.readFileSync(file)) === sha(png);
      if (!same) bad++;
      console.log(`${same ? 'same' : 'DIFFERS'}  ${rel}`);
    } else {
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(file, png);
      files.push({ file: rel, scale, pixels: GEOMETRY.crop * scale, sha256: sha(png) });
      console.log(`${sha(png)}  ${rel}`);
    }
  }
  if (check) process.exit(bad ? 1 : 0);
  const receipt = {
    source: 'Lovable e15b9fa0-b2a0-4314-bc21-9c573b8eceb1 @ d4f606244ba3995080fb0bcd471cbebf4cbbc56a, src/styles.css .community-banner::after',
    decision: 'Director #506 5845316335 (W4 option (a))',
    geometry: GEOMETRY,
    token: TOKEN,
    supersample: `${SUPERSAMPLE}x${SUPERSAMPLE}`,
    placement: 'right 0 / top 0 of the banner, 170×170, pointerEvents none, not accessible',
    files,
  };
  fs.writeFileSync(path.join(OUT, 'banner-ring.receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
}
