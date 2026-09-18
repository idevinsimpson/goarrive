import { describe, expect, it } from 'vitest';

import {
  buildDataCodewords,
  charCountBits,
  chooseVersion,
  dataModulePositions,
  encodeQr,
  formatInfoBits,
  gfMul,
  interleaveCodewords,
  maskCondition,
  qrSvgDataUri,
  qrSvgDataUriRaw,
  renderQrSvg,
  rsEncode,
  toUtf8Bytes,
  versionInfoBits,
  versionSpec,
  type QrCode,
} from '../src/ui/qr';

/**
 * The encoder in `src/ui/qr.ts` is written here rather than installed, so
 * "it renders something square and black" is not evidence of anything. These
 * tests check it three ways that do not depend on the encoder being right:
 *
 *   1. PUBLISHED VECTORS. The Reed–Solomon block from the ISO/IEC 18004
 *      worked example, and the format-information bit strings from the same
 *      standard's table, byte for byte.
 *   2. ALGEBRA. The field tables and the RS codewords are checked against the
 *      DEFINITION — every codeword polynomial must vanish at alpha^0..alpha^(n-1)
 *      — not against the generator-polynomial code path that produced them.
 *   3. AN INDEPENDENT READER. `readQr` below walks a finished matrix back to
 *      the string it encodes: it locates the format bits, undoes the mask,
 *      un-interleaves the blocks, re-checks every block's syndromes and parses
 *      the byte-mode header. It shares no code with the writer beyond the walk
 *      order and the version tables.
 */

// ─── Published vectors ───────────────────────────────────────────────────────

describe('GF(256) arithmetic', () => {
  it('multiplies as carry-less multiplication modulo 0x11D', () => {
    // An independent implementation of the same field operation.
    const slowMul = (a: number, b: number): number => {
      let result = 0;
      let x = a;
      let y = b;
      while (y > 0) {
        if (y & 1) result ^= x;
        y >>= 1;
        x <<= 1;
        if (x & 0x100) x ^= 0x11d;
      }
      return result;
    };
    for (let a = 0; a < 256; a += 1) {
      for (let b = 0; b < 256; b += 1) {
        expect(gfMul(a, b)).toBe(slowMul(a, b));
      }
    }
  });

  it('has 1 as a multiplicative identity and no zero divisors', () => {
    for (let a = 1; a < 256; a += 1) {
      expect(gfMul(a, 1)).toBe(a);
      expect(gfMul(a, 0)).toBe(0);
    }
  });
});

describe('Reed-Solomon', () => {
  it('reproduces the ISO/IEC 18004 worked example (version 1-M, "01234567")', () => {
    // Data codewords for the standard's own numeric-mode example. The encoder
    // itself is byte-mode only; this exercises the RS stage against a
    // published answer rather than against itself.
    const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec,
      0x11, 0xec, 0x11];
    expect(rsEncode(data, 10)).toEqual([
      0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55,
    ]);
  });

  it('produces codewords whose syndromes all vanish', () => {
    // The defining property of an RS codeword: evaluated as a polynomial it is
    // zero at alpha^0 .. alpha^(ecLen-1). Checked without reusing the encoder's
    // generator polynomial.
    const GF_EXP: number[] = [];
    {
      let x = 1;
      for (let i = 0; i < 255; i += 1) {
        GF_EXP.push(x);
        x <<= 1;
        if (x & 0x100) x ^= 0x11d;
      }
    }
    for (const ecLen of [10, 16, 18, 22, 24, 26]) {
      const data = Array.from({ length: 30 }, (_, i) => (i * 37 + ecLen) & 0xff);
      const full = [...data, ...rsEncode(data, ecLen)];
      for (let s = 0; s < ecLen; s += 1) {
        const alpha = GF_EXP[s % 255];
        let acc = 0;
        for (const cw of full) acc = gfMul(acc, alpha) ^ cw;
        expect(acc, `syndrome ${s} for ecLen ${ecLen}`).toBe(0);
      }
    }
  });
});

describe('format and version information', () => {
  it('matches the published level-M format bit strings', () => {
    // ISO/IEC 18004 Table C.1, the eight level-M entries.
    const published = [
      0b101010000010010, 0b101000100100101, 0b101111001111100, 0b101101101001011,
      0b100010111111001, 0b100000011001110, 0b100111110010111, 0b100101010100000,
    ];
    for (let mask = 0; mask < 8; mask += 1) {
      expect(formatInfoBits(mask), `mask ${mask}`).toBe(published[mask]);
    }
  });

  it('produces format bits that survive their own BCH check', () => {
    for (let mask = 0; mask < 8; mask += 1) {
      let rem = formatInfoBits(mask) ^ 0x5412;
      for (let i = 14; i >= 10; i -= 1) {
        if (rem & (1 << i)) rem ^= 0x537 << (i - 10);
      }
      expect(rem, `BCH remainder for mask ${mask}`).toBe(0);
      expect((formatInfoBits(mask) ^ 0x5412) >> 10).toBe(mask); // level M = 00
    }
  });

  it('matches the published version information for versions 7-10', () => {
    // ISO/IEC 18004 Table D.1.
    expect(versionInfoBits(7)).toBe(0b000111110010010100);
    expect(versionInfoBits(8)).toBe(0b001000010110111100);
    expect(versionInfoBits(9)).toBe(0b001001101010011001);
    expect(versionInfoBits(10)).toBe(0b001010010011010011);
  });
});

// ─── Version selection and data encoding ─────────────────────────────────────

describe('version selection', () => {
  it('picks the smallest version that holds the payload', () => {
    expect(chooseVersion(1)).toBe(1);
    // Version 1-M holds 16 data codewords = 128 bits; header is 4 + 8 = 12,
    // leaving 14 whole bytes.
    expect(chooseVersion(14)).toBe(1);
    expect(chooseVersion(15)).toBe(2);
    // A realistic join URL: origin + '/join/' + a 22-char base64url code.
    expect(chooseVersion('https://westayfit.example.com/join/'.length + 22)).toBeLessThanOrEqual(4);
  });

  it('refuses a payload that does not fit rather than truncating it', () => {
    expect(chooseVersion(213)).toBe(10);
    expect(() => chooseVersion(214)).toThrow(/does not fit/);
    expect(() => chooseVersion(400)).toThrow(/does not fit/);
    expect(() => encodeQr('x'.repeat(400))).toThrow(/does not fit/);
  });

  it('never silently drops bytes: every version reports a consistent block table', () => {
    for (let v = 1; v <= 10; v += 1) {
      const spec = versionSpec(v);
      const summed = spec.blocks.reduce((n, b) => n + b.count * b.dataCodewords, 0);
      expect(summed, `version ${v} data codewords`).toBe(spec.dataCodewords);
    }
  });
});

describe('data codewords', () => {
  it('writes mode, length, payload, terminator and the alternating pad bytes', () => {
    const bytes = toUtf8Bytes('A');
    const cw = buildDataCodewords(bytes, 1);
    expect(cw).toHaveLength(16);
    // 0100 mode, then 00000001 length, then 01000001 payload, then 0000 term.
    expect(cw[0]).toBe(0b01000000);
    expect(cw[1]).toBe(0b00010100);
    expect(cw[2]).toBe(0b00010000);
    expect(cw.slice(3)).toEqual([0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec,
      0x11, 0xec]);
  });

  it('uses a 16-bit character count only above version 9', () => {
    for (let v = 1; v <= 9; v += 1) expect(charCountBits(v)).toBe(8);
    expect(charCountBits(10)).toBe(16);
  });
});

// ─── An independent reader ───────────────────────────────────────────────────

/** Undo the format-information encoding to recover the mask the writer chose. */
function readMask(code: QrCode): number {
  let bits = 0;
  for (let i = 0; i < 15; i += 1) {
    let dark: boolean;
    if (i < 6) dark = code.modules[8][i];
    else if (i === 6) dark = code.modules[8][7];
    else if (i === 7) dark = code.modules[8][8];
    else if (i === 8) dark = code.modules[7][8];
    else dark = code.modules[14 - i][8];
    if (dark) bits |= 1 << i;
  }
  const unmasked = bits ^ 0x5412;
  // BCH check on the way back in, so a corrupt format field fails loudly.
  let rem = unmasked;
  for (let i = 14; i >= 10; i -= 1) if (rem & (1 << i)) rem ^= 0x537 << (i - 10);
  expect(rem, 'format information BCH check').toBe(0);
  expect(unmasked >> 13, 'error correction level bits (M = 00)').toBe(0);
  return (unmasked >> 10) & 0b111;
}

/** The function-pattern map, rebuilt from the spec rather than from the writer. */
function functionMap(size: number, version: number): boolean[][] {
  const res = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (r: number, c: number) => {
    if (r >= 0 && c >= 0 && r < size && c < size) res[r][c] = true;
  };
  for (const [r0, c0] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ]) {
    for (let r = -1; r <= 7; r += 1) for (let c = -1; c <= 7; c += 1) mark(r0 + r, c0 + c);
  }
  for (let i = 0; i < size; i += 1) {
    mark(6, i);
    mark(i, 6);
  }
  const centers: Record<number, number[]> = {
    1: [],
    2: [6, 18],
    3: [6, 22],
    4: [6, 26],
    5: [6, 30],
    6: [6, 34],
    7: [6, 22, 38],
    8: [6, 24, 42],
    9: [6, 26, 46],
    10: [6, 28, 50],
  };
  for (const r of centers[version]) {
    for (const c of centers[version]) {
      const onFinder =
        (r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6);
      if (onFinder) continue;
      for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) mark(r + dr, c + dc);
    }
  }
  for (let i = 0; i < 9; i += 1) {
    mark(8, i);
    mark(i, 8);
  }
  for (let i = 0; i < 8; i += 1) {
    mark(8, size - 1 - i);
    mark(size - 1 - i, 8);
  }
  mark(size - 8, 8);
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 11;
      mark(a, b);
      mark(b, a);
    }
  }
  return res;
}

/**
 * Read a finished matrix back to the string it carries — the decode check.
 * Every block's syndromes are verified on the way through, so a placement,
 * mask or interleave error surfaces as a failed check rather than as garbage.
 */
function readQr(code: QrCode): string {
  const { size, version } = code;
  const spec = versionSpec(version);
  const reserved = functionMap(size, version);
  const mask = readMask(code);
  expect(mask, 'the mask recorded in the format bits').toBe(code.mask);

  const positions = dataModulePositions(size, reserved);
  const bits: number[] = [];
  for (const [row, col] of positions) {
    const dark = code.modules[row][col];
    const unmasked = maskCondition(mask, row, col) ? !dark : dark;
    bits.push(unmasked ? 1 : 0);
  }
  const total = spec.dataCodewords + spec.blocks.reduce((n, b) => n + b.count, 0) * spec.ecPerBlock;
  const stream: number[] = [];
  for (let i = 0; i + 8 <= bits.length && stream.length < total; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    stream.push(byte);
  }
  expect(stream, 'codewords recovered from the matrix').toHaveLength(total);

  // Un-interleave.
  const shape: number[] = [];
  for (const g of spec.blocks) for (let i = 0; i < g.count; i += 1) shape.push(g.dataCodewords);
  const dataBlocks: number[][] = shape.map(() => []);
  const ecBlocks: number[][] = shape.map(() => []);
  let cursor = 0;
  for (let i = 0; i < Math.max(...shape); i += 1) {
    for (let b = 0; b < shape.length; b += 1) {
      if (i < shape[b]) dataBlocks[b].push(stream[cursor++]);
    }
  }
  for (let i = 0; i < spec.ecPerBlock; i += 1) {
    for (let b = 0; b < shape.length; b += 1) ecBlocks[b].push(stream[cursor++]);
  }
  expect(cursor).toBe(total);

  // Every block must be a valid codeword — this is what proves the round trip
  // is not merely self-consistent.
  const GF_EXP: number[] = [];
  {
    let x = 1;
    for (let i = 0; i < 255; i += 1) {
      GF_EXP.push(x);
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
  }
  for (let b = 0; b < shape.length; b += 1) {
    const full = [...dataBlocks[b], ...ecBlocks[b]];
    for (let s = 0; s < spec.ecPerBlock; s += 1) {
      let acc = 0;
      for (const cw of full) acc = gfMul(acc, GF_EXP[s % 255]) ^ cw;
      expect(acc, `block ${b} syndrome ${s}`).toBe(0);
    }
  }

  const data = dataBlocks.flat();
  const dataBits: number[] = [];
  for (const cw of data) for (let i = 7; i >= 0; i -= 1) dataBits.push((cw >> i) & 1);
  const take = (n: number, from: number): number => {
    let v = 0;
    for (let i = 0; i < n; i += 1) v = (v << 1) | dataBits[from + i];
    return v;
  };
  expect(take(4, 0), 'mode indicator (byte mode)').toBe(0b0100);
  const cc = charCountBits(version);
  const length = take(cc, 4);
  const bytes: number[] = [];
  for (let i = 0; i < length; i += 1) bytes.push(take(8, 4 + cc + i * 8));
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

describe('the whole symbol, read back', () => {
  const samples = [
    'A',
    'HELLO WORLD',
    'https://westayfit.example.com/join/9wq2Zc4TpK1nRu7bVdA0Xg',
    'https://we-stay-fit-staging.web.app/join/' + 'a'.repeat(22),
    // Deliberately long enough to cross into a multi-block version.
    'https://westayfit.example.com/join/' + 'Zz9-_'.repeat(20),
    'café ☕', // multi-byte, to pin the UTF-8 path
  ];

  for (const sample of samples) {
    it(`round-trips ${JSON.stringify(sample.slice(0, 44))}`, () => {
      const code = encodeQr(sample);
      expect(code.size).toBe(17 + code.version * 4);
      expect(readQr(code)).toBe(sample);
    });
  }

  it('covers every version 1-10 the encoder claims to support', () => {
    const seen = new Set<number>();
    // 213 bytes is the ceiling: version 10-M holds 216 data codewords, and the
    // byte-mode header there is 4 + 16 bits.
    for (let len = 1; len <= 213; len += 1) {
      const version = chooseVersion(len);
      if (seen.has(version)) continue;
      seen.add(version);
      const payload = 'u'.repeat(len);
      const code = encodeQr(payload);
      expect(code.version).toBe(version);
      expect(readQr(code)).toBe(payload);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('structural checks', () => {
  const code = encodeQr('https://westayfit.example.com/join/9wq2Zc4TpK1nRu7bVdA0Xg');

  it('places three finder patterns and no fourth', () => {
    const finder = (r0: number, c0: number) => {
      for (let r = 0; r < 7; r += 1) {
        for (let c = 0; c < 7; c += 1) {
          const expected =
            r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          expect(code.modules[r0 + r][c0 + c], `finder at ${r0},${c0} module ${r},${c}`).toBe(
            expected
          );
        }
      }
    };
    finder(0, 0);
    finder(0, code.size - 7);
    finder(code.size - 7, 0);
    // The bottom-right corner is data, never a finder.
    const corner = code.modules.slice(code.size - 7).map((row) => row.slice(code.size - 7));
    const allRing = corner.every((row, r) =>
      row.every((v, c) => v === (r === 0 || r === 6 || c === 0 || c === 6))
    );
    expect(allRing, 'there must be no fourth finder pattern').toBe(false);
  });

  it('separates each finder with a light band', () => {
    for (let i = 0; i < 8; i += 1) {
      expect(code.modules[7][i], `top-left separator row ${i}`).toBe(false);
      expect(code.modules[i][7], `top-left separator col ${i}`).toBe(false);
      expect(code.modules[7][code.size - 1 - i]).toBe(false);
      expect(code.modules[code.size - 1 - i][7]).toBe(false);
    }
  });

  it('alternates both timing patterns, starting and ending dark', () => {
    for (let i = 8; i < code.size - 8; i += 1) {
      expect(code.modules[6][i], `horizontal timing ${i}`).toBe(i % 2 === 0);
      expect(code.modules[i][6], `vertical timing ${i}`).toBe(i % 2 === 0);
    }
  });

  it('keeps the always-dark module dark', () => {
    expect(code.modules[code.size - 8][8]).toBe(true);
  });

  it('writes both copies of the format information identically', () => {
    const bits = formatInfoBits(code.mask);
    for (let i = 0; i < 15; i += 1) {
      const dark = ((bits >> i) & 1) === 1;
      const copy1 =
        i < 6
          ? code.modules[8][i]
          : i === 6
            ? code.modules[8][7]
            : i === 7
              ? code.modules[8][8]
              : i === 8
                ? code.modules[7][8]
                : code.modules[14 - i][8];
      const copy2 = i < 7 ? code.modules[code.size - 1 - i][8] : code.modules[8][code.size - 15 + i];
      expect(copy1, `format copy 1 bit ${i}`).toBe(dark);
      expect(copy2, `format copy 2 bit ${i}`).toBe(dark);
    }
  });

  it('chooses the mask by the penalty rules, not a fixed one', () => {
    const masks = new Set<number>();
    for (let i = 0; i < 40; i += 1) {
      masks.add(encodeQr(`https://westayfit.example.com/join/code${i}xyz`).mask);
    }
    expect(masks.size, 'the mask must vary with the payload').toBeGreaterThan(1);
  });
});

describe('SVG output', () => {
  const code = encodeQr('https://westayfit.example.com/join/9wq2Zc4TpK1nRu7bVdA0Xg');

  it('includes the four-module quiet zone in the viewBox', () => {
    const svg = renderQrSvg(code);
    expect(svg).toContain(`viewBox="0 0 ${code.size + 8} ${code.size + 8}"`);
  });

  it('draws one path covering exactly the dark modules', () => {
    const svg = renderQrSvg(code, { quietZone: 0 });
    const runs = [...svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)];
    const drawn = runs.reduce((n, m) => n + Number(m[3]), 0);
    const dark = code.modules.flat().filter(Boolean).length;
    expect(drawn).toBe(dark);
    expect(svg.match(/<path/g)).toHaveLength(1);
  });

  it('leaves the markup raw in the react-native-web form', () => {
    // react-native-web matches this exact prefix and does the escaping itself;
    // pre-encoding here would be double-encoded and render nothing.
    const raw = qrSvgDataUriRaw(code);
    expect(raw.startsWith('data:image/svg+xml;utf8,<svg ')).toBe(true);
    expect(raw.slice('data:image/svg+xml;utf8,'.length)).toBe(renderQrSvg(code));
  });

  it('produces a data URI an <img> can take', () => {
    const uri = qrSvgDataUri(code);
    expect(uri.startsWith('data:image/svg+xml;utf8,')).toBe(true);
    expect(decodeURIComponent(uri.slice('data:image/svg+xml;utf8,'.length))).toBe(
      renderQrSvg(code)
    );
    // No raw '#' — it would end the URI at the fragment.
    expect(uri.includes('#')).toBe(false);
  });

  it('changes when the encoded URL changes', () => {
    const a = qrSvgDataUri(encodeQr('https://x.example/join/aaaaaaaaaaaaaaaaaaaaaa'));
    const b = qrSvgDataUri(encodeQr('https://x.example/join/bbbbbbbbbbbbbbbbbbbbbb'));
    expect(a).not.toBe(b);
  });
});

describe('interleaving', () => {
  it('returns every codeword exactly once, data before error correction', () => {
    for (let v = 1; v <= 10; v += 1) {
      const spec = versionSpec(v);
      const data = Array.from({ length: spec.dataCodewords }, (_, i) => i & 0xff);
      const out = interleaveCodewords(data, v);
      const blocks = spec.blocks.reduce((n, b) => n + b.count, 0);
      expect(out, `version ${v}`).toHaveLength(spec.dataCodewords + blocks * spec.ecPerBlock);
      // The data half is a permutation of the input.
      expect([...out.slice(0, spec.dataCodewords)].sort((x, y) => x - y)).toEqual(
        [...data].sort((x, y) => x - y)
      );
    }
  });
});
