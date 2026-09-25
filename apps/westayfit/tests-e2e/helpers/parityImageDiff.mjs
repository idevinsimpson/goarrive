#!/usr/bin/env node
/**
 * PARITY IMAGE DIFF — reference PNG + candidate PNG → evidence, never a verdict.
 *
 *   node apps/westayfit/tests-e2e/helpers/parityImageDiff.mjs \
 *     --reference <ref.png> --candidate <cand.png> --out-dir <dir> --label <name>
 *
 * Writes four files into --out-dir, all named from --label:
 *   <label>.side-by-side.png   reference | 8 px neutral gutter | candidate
 *   <label>.overlay-50.png     each channel, (reference + candidate + 1) >> 1
 *   <label>.diff.png           |reference − candidate| per RGB channel, opaque
 *   <label>.manifest.json      input SHA-256s and dimensions, output SHA-256s,
 *                              and DESCRIPTIVE metrics
 *
 * WHAT IT DOES NOT DO. There is no threshold, no score and no PASS / FAIL:
 * the metrics describe how the pixels differ, and whether that difference is
 * acceptable is a reviewer's judgement against the frames, not this file's.
 *
 * FAILS CLOSED. Different dimensions exit 2 and write nothing; an image that
 * is not a PNG this decoder reads exactly (16-bit, interlaced, a bad CRC)
 * exits 3 naming why. It never resizes, crops, pads or guesses.
 *
 * NO DEPENDENCY. PNG is decoded and encoded here with Node's built-in zlib.
 * A browser canvas was the other option in this toolchain and was not used
 * for the computation: canvas storage is premultiplied and colour-managed, so
 * the values it hands back are not guaranteed to be the stored pixels, and its
 * encoder is not guaranteed byte-stable. Pixel values are compared exactly as
 * stored; gAMA / iCCP / sRGB chunks are read past, not applied.
 *
 * DETERMINISTIC. Identical inputs give byte-identical outputs on the same
 * Node: every row is written with filter 0, deflate is level 9, and the
 * manifest has no timestamp, host or absolute path.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

export const TOOL = 'parity-image-diff';
export const TOOL_VERSION = 1;
const GUTTER = 8;
const GUTTER_RGBA = [128, 128, 128, 255];
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class PngError extends Error {}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Decode a PNG to { width, height, data: Uint8Array RGBA }. */
export function decodePng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new PngError('not a PNG (bad signature)');
  let off = 8;
  let ihdr = null;
  let palette = null;
  let trns = null;
  const idat = [];
  let ended = false;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (off + 12 + len > buf.length) throw new PngError(`truncated ${type} chunk`);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (crc32(buf.subarray(off + 4, off + 8 + len)) !== buf.readUInt32BE(off + 8 + len)) {
      throw new PngError(`bad CRC in ${type} chunk`);
    }
    if (type === 'IHDR') {
      ihdr = {
        width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9],
        compression: body[10], filter: body[11], interlace: body[12],
      };
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') { ended = true; break; }
    off += 12 + len;
  }
  if (!ihdr) throw new PngError('no IHDR chunk');
  if (!ended) throw new PngError('no IEND chunk');
  const { width, height, depth, color, compression, filter, interlace } = ihdr;
  if (!(color in CHANNELS)) throw new PngError(`unknown colour type ${color}`);
  if (compression !== 0 || filter !== 0) throw new PngError('unknown compression or filter method');
  if (interlace !== 0) throw new PngError('interlaced PNG is not supported; re-save it non-interlaced');
  if (depth === 16) throw new PngError('16-bit PNG is not supported; re-save it as 8-bit');
  if (color === 3 ? ![1, 2, 4, 8].includes(depth) : color === 0 ? ![1, 2, 4, 8].includes(depth) : depth !== 8) {
    throw new PngError(`bit depth ${depth} is not valid for colour type ${color}`);
  }
  if (color === 3 && !palette) throw new PngError('palette image without PLTE');
  if (width === 0 || height === 0) throw new PngError('empty image');

  const bitsPerPixel = CHANNELS[color] * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (raw.length !== height * (stride + 1)) throw new PngError('image data length does not match IHDR');

  const rows = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const ft = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? rows[dst + x - bpp] : 0;
      const b = y > 0 ? rows[dst - stride + x] : 0;
      const c = x >= bpp && y > 0 ? rows[dst - stride + x - bpp] : 0;
      let pred;
      if (ft === 0) pred = 0;
      else if (ft === 1) pred = a;
      else if (ft === 2) pred = b;
      else if (ft === 3) pred = (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else throw new PngError(`unknown row filter ${ft}`);
      rows[dst + x] = (raw[src + x] + pred) & 0xff;
    }
  }

  const data = new Uint8Array(width * height * 4);
  const sample = (y, i) => {
    // the i-th sample of row y, for depth < 8
    const bit = i * depth;
    const byte = rows[y * stride + (bit >> 3)];
    return (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  const trnsGrey = color === 0 && trns && trns.length >= 2 ? trns.readUInt16BE(0) : null;
  const trnsRgb = color === 2 && trns && trns.length >= 6 ? [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)] : null;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      const r = y * stride + x * bpp;
      if (color === 6) { data[o] = rows[r]; data[o + 1] = rows[r + 1]; data[o + 2] = rows[r + 2]; data[o + 3] = rows[r + 3]; }
      else if (color === 2) {
        data[o] = rows[r]; data[o + 1] = rows[r + 1]; data[o + 2] = rows[r + 2];
        data[o + 3] = trnsRgb && rows[r] === trnsRgb[0] && rows[r + 1] === trnsRgb[1] && rows[r + 2] === trnsRgb[2] ? 0 : 255;
      } else if (color === 4) { data[o] = data[o + 1] = data[o + 2] = rows[r]; data[o + 3] = rows[r + 1]; }
      else if (color === 0) {
        const v = depth === 8 ? rows[r] : sample(y, x);
        const g = depth === 8 ? v : Math.round((v * 255) / ((1 << depth) - 1));
        data[o] = data[o + 1] = data[o + 2] = g;
        data[o + 3] = trnsGrey !== null && v === trnsGrey ? 0 : 255;
      } else {
        const idx = depth === 8 ? rows[r] : sample(y, x);
        if (idx * 3 + 2 >= palette.length) throw new PngError('palette index out of range');
        data[o] = palette[idx * 3]; data[o + 1] = palette[idx * 3 + 1]; data[o + 2] = palette[idx * 3 + 2];
        data[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      }
    }
  }
  return { width, height, data };
}

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** Encode RGBA to an 8-bit RGBA PNG. Every row uses `filterType` (0 in all outputs). */
export function encodePng({ width, height, data }, filterType = 0) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = filterType;
    for (let x = 0; x < stride; x += 1) {
      const v = data[y * stride + x];
      const a = x >= 4 ? data[y * stride + x - 4] : 0;
      const b = y > 0 ? data[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? data[(y - 1) * stride + x - 4] : 0;
      let pred = 0;
      if (filterType === 1) pred = a;
      else if (filterType === 2) pred = b;
      else if (filterType === 3) pred = (a + b) >> 1;
      else if (filterType === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      raw[y * (stride + 1) + 1 + x] = (v - pred) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The three derived images and the descriptive metrics, from two same-sized RGBA images. */
export function compare(ref, cand) {
  if (ref.width !== cand.width || ref.height !== cand.height) {
    throw new PngError(`DIMENSION_MISMATCH reference ${ref.width}x${ref.height} candidate ${cand.width}x${cand.height}`);
  }
  const { width: w, height: h } = ref;
  const n = w * h;
  const side = new Uint8Array((w * 2 + GUTTER) * h * 4);
  const overlay = new Uint8Array(n * 4);
  const diff = new Uint8Array(n * 4);
  let changed = 0;
  let alphaChanged = 0;
  let rgbSum = 0;
  let maxDelta = 0;
  let minX = w; let minY = h; let maxX = -1; let maxY = -1;
  const sw = w * 2 + GUTTER;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      const l = (y * sw + x) * 4;
      const r = (y * sw + w + GUTTER + x) * 4;
      let differs = false;
      for (let k = 0; k < 4; k += 1) {
        const a = ref.data[o + k]; const b = cand.data[o + k];
        side[l + k] = a;
        side[r + k] = b;
        overlay[o + k] = (a + b + 1) >> 1;
        if (a !== b) differs = true;
        if (k < 3) {
          const d = Math.abs(a - b);
          diff[o + k] = d;
          rgbSum += d;
          if (d > maxDelta) maxDelta = d;
        }
      }
      diff[o + 3] = 255;
      if (ref.data[o + 3] !== cand.data[o + 3]) alphaChanged += 1;
      if (differs) {
        changed += 1;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    for (let g = 0; g < GUTTER; g += 1) side.set(GUTTER_RGBA, (y * sw + w + g) * 4);
  }
  const round6 = (v) => Math.round(v * 1e6) / 1e6;
  return {
    sideBySide: { width: sw, height: h, data: side },
    overlay: { width: w, height: h, data: overlay },
    diff: { width: w, height: h, data: diff },
    metrics: {
      pixels: n,
      changedPixels: changed,
      changedRatio: round6(changed / n),
      alphaChangedPixels: alphaChanged,
      meanAbsRgbDelta: round6(rgbSum / (n * 3)),
      maxChannelDelta: maxDelta,
      changedBoundingBox: changed ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
    },
  };
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (!['--reference', '--candidate', '--out-dir', '--label'].includes(k)) throw new PngError(`unknown argument ${k}`);
    if (i + 1 >= argv.length) throw new PngError(`${k} needs a value`);
    a[k.slice(2)] = argv[++i];
  }
  for (const k of ['reference', 'candidate', 'out-dir', 'label']) if (!a[k]) throw new PngError(`--${k} is required`);
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(a.label) || a.label.startsWith('.')) {
    throw new PngError('--label must be 1–80 characters of A–Z a–z 0–9 . _ - and not start with a dot');
  }
  return a;
}

export function run(argv) {
  const args = parseArgs(argv);
  const refBytes = fs.readFileSync(args.reference);
  const candBytes = fs.readFileSync(args.candidate);
  const ref = decodePng(refBytes);
  const cand = decodePng(candBytes);
  // compare() throws on a size mismatch BEFORE anything is written
  const result = compare(ref, cand);
  fs.mkdirSync(args['out-dir'], { recursive: true });
  const outputs = {};
  for (const [suffix, image] of [['side-by-side.png', result.sideBySide], ['overlay-50.png', result.overlay], ['diff.png', result.diff]]) {
    const file = `${args.label}.${suffix}`;
    const bytes = encodePng(image);
    fs.writeFileSync(path.join(args['out-dir'], file), bytes);
    outputs[file] = { sha256: sha256(bytes), width: image.width, height: image.height };
  }
  const manifest = {
    tool: TOOL,
    toolVersion: TOOL_VERSION,
    label: args.label,
    inputs: {
      reference: { file: path.basename(args.reference), sha256: sha256(refBytes), bytes: refBytes.length, width: ref.width, height: ref.height },
      candidate: { file: path.basename(args.candidate), sha256: sha256(candBytes), bytes: candBytes.length, width: cand.width, height: cand.height },
    },
    outputs,
    layout: { sideBySide: `reference left, candidate right, ${GUTTER} px gutter rgb(128,128,128)`, overlay: 'per channel (reference + candidate + 1) >> 1', diff: 'per RGB channel |reference - candidate|, alpha 255' },
    metrics: result.metrics,
    note: 'Descriptive only. There is no threshold and no verdict: whether a difference is acceptable is a reviewer decision against the frames.',
  };
  const manifestFile = path.join(args['out-dir'], `${args.label}.manifest.json`);
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  return { manifest, manifestFile };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { manifest, manifestFile } = run(process.argv.slice(2));
    const m = manifest.metrics;
    console.log(`PARITY_DIFF label=${manifest.label} size=${manifest.inputs.reference.width}x${manifest.inputs.reference.height} changedPixels=${m.changedPixels} changedRatio=${m.changedRatio} meanAbsRgbDelta=${m.meanAbsRgbDelta}`);
    console.log(`PARITY_DIFF_MANIFEST=${manifestFile}`);
  } catch (e) {
    const msg = String(e?.message || e);
    console.error(`parity-image-diff: ${msg}`);
    process.exitCode = msg.startsWith('DIMENSION_MISMATCH') ? 2 : e instanceof PngError ? 3 : 1;
  }
}
