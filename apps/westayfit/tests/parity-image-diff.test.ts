// tests-e2e/helpers/parityImageDiff.mjs is evidence tooling, not product:
// it turns a reference PNG and a candidate PNG into a side-by-side, a 50%
// overlay, an absolute difference and a manifest of DESCRIPTIVE metrics. It is
// tested the way it runs — the real script in a child process — against
// fixtures this file writes itself, so the expected pixels are known exactly.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(__dirname, '../tests-e2e/helpers/parityImageDiff.mjs');

type Rgba = { width: number; height: number; data: Uint8Array };

// ---- a minimal independent PNG writer / reader for the fixtures ----------
const CRC = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Rows of raw samples → a PNG, filtering row y with filters[y % filters.length]. */
function writePng(
  width: number,
  height: number,
  color: number,
  depth: number,
  rows: Buffer[],
  opts: { filters?: number[]; plte?: Buffer; interlace?: number } = {}
): Buffer {
  const bpp = Math.max(1, ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color]! * depth >> 3);
  const filters = opts.filters ?? [0];
  const out: Buffer[] = [];
  rows.forEach((row, y) => {
    const f = filters[y % filters.length]!;
    const prev = y > 0 ? rows[y - 1]! : Buffer.alloc(row.length);
    const enc = Buffer.alloc(row.length);
    for (let x = 0; x < row.length; x += 1) {
      const a = x >= bpp ? row[x - bpp]! : 0;
      const b = prev[x]!;
      const c = x >= bpp ? prev[x - bpp]! : 0;
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
      enc[x] = (row[x]! - pred) & 0xff;
    }
    out.push(Buffer.from([f]), enc);
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = color;
  ihdr[12] = opts.interlace ?? 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...(opts.plte ? [chunk('PLTE', opts.plte)] : []),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(out))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function rgbaPng(img: Rgba, filters?: number[]): Buffer {
  const rows = Array.from({ length: img.height }, (_, y) =>
    Buffer.from(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4))
  );
  return writePng(img.width, img.height, 6, 8, rows, { filters });
}
/** Reads the tool's own output shape: 8-bit RGBA, filter 0 on every row. */
function readOutput(file: string): Rgba {
  const buf = readFileSync(file);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  expect([buf[24], buf[25], buf[28]]).toEqual([8, 6, 0]);
  let off = 8;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    if (buf.toString('latin1', off + 4, off + 8) === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    expect(raw[y * (width * 4 + 1)]).toBe(0);
    data.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  }
  return { width, height, data };
}
function image(width: number, height: number, f: (x: number, y: number) => number[]): Rgba {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set(f(x, y), (y * width + x) * 4);
  }
  return { width, height, data };
}
const base = (x: number, y: number) => [(x * 4) & 255, (y * 5) & 255, ((x + y) * 3) & 255, 255];
const inRegion = (x: number, y: number) => x >= 20 && x < 30 && y >= 10 && y < 16;
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function tmp(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'wsf-parity-diff-'));
}
function run(args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}
function fixture(dir: string, name: string, png: Buffer): string {
  const f = path.join(dir, name);
  writeFileSync(f, png);
  return f;
}
const OUTPUTS = ['side-by-side.png', 'overlay-50.png', 'diff.png', 'manifest.json'];

describe('parity-image-diff', () => {
  it('a known one-region difference: exact metrics, a diff that is zero everywhere else, the documented overlay and layout', () => {
    const dir = tmp();
    const refImg = image(64, 48, base);
    const candImg = image(64, 48, (x, y) => (inRegion(x, y) ? [255, 0, 0, 255] : base(x, y)));
    const ref = fixture(dir, 'ref.png', rgbaPng(refImg));
    const cand = fixture(dir, 'cand.png', rgbaPng(candImg));
    const out = path.join(dir, 'out');
    execFileSync(process.execPath, [SCRIPT, '--reference', ref, '--candidate', cand, '--out-dir', out, '--label', 'control']);

    const m = JSON.parse(readFileSync(path.join(out, 'control.manifest.json'), 'utf8'));
    expect(m.metrics.pixels).toBe(64 * 48);
    expect(m.metrics.changedPixels).toBe(60);
    expect(m.metrics.changedRatio).toBe(Math.round((60 / 3072) * 1e6) / 1e6);
    expect(m.metrics.changedBoundingBox).toEqual({ x: 20, y: 10, width: 10, height: 6 });
    expect(m.metrics.alphaChangedPixels).toBe(0);
    expect(m.inputs.reference.sha256).toBe(sha256(readFileSync(ref)));
    expect(m.inputs.candidate.sha256).toBe(sha256(readFileSync(cand)));
    expect(m.inputs.reference.file).toBe('ref.png'); // a basename, never a local absolute path

    const diff = readOutput(path.join(out, 'control.diff.png'));
    let expectedSum = 0;
    let expectedMax = 0;
    for (let y = 0; y < 48; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const o = (y * 64 + x) * 4;
        for (let k = 0; k < 3; k += 1) {
          const d = Math.abs(refImg.data[o + k]! - candImg.data[o + k]!);
          expect(diff.data[o + k]).toBe(d);
          if (!inRegion(x, y)) expect(d).toBe(0);
          expectedSum += d;
          expectedMax = Math.max(expectedMax, d);
        }
        expect(diff.data[o + 3]).toBe(255);
      }
    }
    expect(m.metrics.meanAbsRgbDelta).toBe(Math.round((expectedSum / (3072 * 3)) * 1e6) / 1e6);
    expect(m.metrics.maxChannelDelta).toBe(expectedMax);

    const overlay = readOutput(path.join(out, 'control.overlay-50.png'));
    for (const [x, y] of [[0, 0], [25, 12], [63, 47]] as const) {
      const o = (y * 64 + x) * 4;
      for (let k = 0; k < 4; k += 1) {
        expect(overlay.data[o + k]).toBe((refImg.data[o + k]! + candImg.data[o + k]! + 1) >> 1);
      }
    }

    const side = readOutput(path.join(out, 'control.side-by-side.png'));
    expect([side.width, side.height]).toEqual([64 * 2 + 8, 48]);
    const at = (x: number, y: number) => Array.from(side.data.subarray((y * side.width + x) * 4, (y * side.width + x) * 4 + 4));
    expect(at(25, 12)).toEqual(Array.from(refImg.data.subarray((12 * 64 + 25) * 4, (12 * 64 + 25) * 4 + 4)));
    expect(at(64 + 8 + 25, 12)).toEqual([255, 0, 0, 255]);
    expect(at(64 + 3, 20)).toEqual([128, 128, 128, 255]);
    for (const [file, meta] of Object.entries(m.outputs) as [string, { sha256: string }][]) {
      expect(meta.sha256).toBe(sha256(readFileSync(path.join(out, file))));
    }
  });

  it('identical inputs describe no change', () => {
    const dir = tmp();
    const png = rgbaPng(image(16, 9, base));
    const r = run(['--reference', fixture(dir, 'a.png', png), '--candidate', fixture(dir, 'b.png', png), '--out-dir', path.join(dir, 'o'), '--label', 'same']);
    expect(r.status).toBe(0);
    const m = JSON.parse(readFileSync(path.join(dir, 'o', 'same.manifest.json'), 'utf8'));
    expect(m.metrics).toMatchObject({ changedPixels: 0, changedRatio: 0, meanAbsRgbDelta: 0, maxChannelDelta: 0, changedBoundingBox: null });
  });

  it('is byte-deterministic: the same inputs give the same four files', () => {
    const dir = tmp();
    const ref = fixture(dir, 'ref.png', rgbaPng(image(40, 30, base)));
    const cand = fixture(dir, 'cand.png', rgbaPng(image(40, 30, (x, y) => (x === y ? [0, 0, 0, 255] : base(x, y)))));
    for (const o of ['o1', 'o2']) {
      expect(run(['--reference', ref, '--candidate', cand, '--out-dir', path.join(dir, o), '--label', 'det']).status).toBe(0);
    }
    for (const suffix of OUTPUTS) {
      expect(readFileSync(path.join(dir, 'o2', `det.${suffix}`)).equals(readFileSync(path.join(dir, 'o1', `det.${suffix}`)))).toBe(true);
    }
  });

  it('fails closed on different dimensions and writes nothing', () => {
    const dir = tmp();
    const r = run([
      '--reference', fixture(dir, 'a.png', rgbaPng(image(64, 48, base))),
      '--candidate', fixture(dir, 'b.png', rgbaPng(image(64, 49, base))),
      '--out-dir', path.join(dir, 'never'), '--label', 'mismatch',
    ]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/DIMENSION_MISMATCH reference 64x48 candidate 64x49/);
    expect(existsSync(path.join(dir, 'never'))).toBe(false);
  });

  it('reads RGB, greyscale, palette (1- and 8-bit) and every row filter as the same pixels', () => {
    const dir = tmp();
    const w = 12;
    const h = 10;
    const grey = (x: number, y: number) => ((x * 17 + y * 29) & 255);
    const rgbRows = Array.from({ length: h }, (_, y) => Buffer.from(Array.from({ length: w }, (_, x) => base(x, y).slice(0, 3)).flat()));
    const rgbaRef = image(w, h, base);
    const ref = fixture(dir, 'ref.png', rgbaPng(rgbaRef));
    const rgb = fixture(dir, 'rgb.png', writePng(w, h, 2, 8, rgbRows, { filters: [0, 1, 2, 3, 4] }));
    expect(run(['--reference', ref, '--candidate', rgb, '--out-dir', path.join(dir, 'o'), '--label', 'rgb']).status).toBe(0);
    expect(JSON.parse(readFileSync(path.join(dir, 'o', 'rgb.manifest.json'), 'utf8')).metrics.changedPixels).toBe(0);

    const greyRef = fixture(dir, 'g-ref.png', rgbaPng(image(w, h, (x, y) => [grey(x, y), grey(x, y), grey(x, y), 255]), [4, 3, 2, 1, 0]));
    const greyRows = Array.from({ length: h }, (_, y) => Buffer.from(Array.from({ length: w }, (_, x) => grey(x, y))));
    const g = fixture(dir, 'grey.png', writePng(w, h, 0, 8, greyRows, { filters: [1, 4] }));
    expect(run(['--reference', greyRef, '--candidate', g, '--out-dir', path.join(dir, 'o'), '--label', 'grey']).status).toBe(0);
    expect(JSON.parse(readFileSync(path.join(dir, 'o', 'grey.manifest.json'), 'utf8')).metrics.changedPixels).toBe(0);

    // palette: 8-bit indices, and 1-bit indices packed eight to a byte
    const plte = Buffer.from([10, 20, 30, 200, 100, 50]);
    const idx = (x: number, y: number) => (x + y) & 1;
    const palRef = fixture(dir, 'p-ref.png', rgbaPng(image(w, h, (x, y) => (idx(x, y) ? [200, 100, 50, 255] : [10, 20, 30, 255]))));
    const pal8 = fixture(dir, 'pal8.png', writePng(w, h, 3, 8, Array.from({ length: h }, (_, y) => Buffer.from(Array.from({ length: w }, (_, x) => idx(x, y)))), { plte, filters: [2, 3] }));
    const pal1Rows = Array.from({ length: h }, (_, y) => {
      const row = Buffer.alloc(Math.ceil(w / 8));
      for (let x = 0; x < w; x += 1) if (idx(x, y)) row[x >> 3]! |= 0x80 >> (x & 7);
      return row;
    });
    const pal1 = fixture(dir, 'pal1.png', writePng(w, h, 3, 1, pal1Rows, { plte }));
    for (const [f, label] of [[pal8, 'pal8'], [pal1, 'pal1']] as const) {
      expect(run(['--reference', palRef, '--candidate', f, '--out-dir', path.join(dir, 'o'), '--label', label]).status).toBe(0);
      expect(JSON.parse(readFileSync(path.join(dir, 'o', `${label}.manifest.json`), 'utf8')).metrics.changedPixels).toBe(0);
    }
  });

  it('refuses, naming why, what it cannot read exactly: interlaced, 16-bit, a corrupted chunk, a bad label', () => {
    const dir = tmp();
    const ok = fixture(dir, 'ok.png', rgbaPng(image(4, 4, base)));
    const rows4 = Array.from({ length: 4 }, () => Buffer.alloc(4 * 4));
    const cases: [string, Buffer, RegExp][] = [
      ['interlaced.png', writePng(4, 4, 6, 8, rows4, { interlace: 1 }), /interlaced PNG is not supported/],
      ['deep.png', writePng(4, 4, 6, 16, Array.from({ length: 4 }, () => Buffer.alloc(4 * 8))), /16-bit PNG is not supported/],
    ];
    const corrupt = Buffer.from(readFileSync(ok));
    corrupt[20]! ^= 0xff; // inside IHDR, so its CRC no longer matches
    cases.push(['corrupt.png', corrupt, /bad CRC in IHDR chunk/]);
    for (const [name, bytes, why] of cases) {
      const r = run(['--reference', ok, '--candidate', fixture(dir, name, bytes), '--out-dir', path.join(dir, 'o'), '--label', 'x']);
      expect(r.status).toBe(3);
      expect(r.stderr).toMatch(why);
    }
    const bad = run(['--reference', ok, '--candidate', ok, '--out-dir', path.join(dir, 'o'), '--label', '../escape']);
    expect(bad.status).toBe(3);
    expect(bad.stderr).toMatch(/--label must be/);
  });

  it('the manifest describes; it never judges', () => {
    const dir = tmp();
    const png = rgbaPng(image(8, 8, base));
    run(['--reference', fixture(dir, 'a.png', png), '--candidate', fixture(dir, 'b.png', png), '--out-dir', path.join(dir, 'o'), '--label', 'judge']);
    const m = JSON.parse(readFileSync(path.join(dir, 'o', 'judge.manifest.json'), 'utf8'));
    const keys: string[] = [];
    const walk = (v: unknown) => {
      if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x); }
      else expect(typeof v).not.toBe('boolean');
    };
    walk(m);
    expect(keys.filter((k) => /pass|fail|score|threshold|accept|verdict|ok/i.test(k))).toEqual([]);
    expect(JSON.stringify(m)).not.toMatch(/timestamp|generatedAt|hostname|\/tmp\//i);
  });
});
