/**
 * A minimal, self-contained QR encoder — byte mode, error correction level M,
 * versions 1 through 10.
 *
 * WHY THIS EXISTS RATHER THAN A DEPENDENCY: nothing in the tree encodes a QR
 * (`qrcode`, `qrcode-generator` and friends are all absent from node_modules),
 * and the one thing we need to encode is a join URL — a short ASCII string,
 * always under 200 characters. That is entirely inside versions 1–10 at level
 * M, which is a small enough slice of ISO/IEC 18004 to write out in full and
 * pin with tests: the Reed–Solomon block against the published Annex example,
 * the format bits against their published BCH check, and the whole module
 * matrix against an independent reader that walks it back to the input string.
 *
 * DELIBERATE LIMITS. This is not a general QR library and must not be sold as
 * one:
 *   - byte mode only. Numeric and alphanumeric modes pack denser; for a URL
 *     with a base64url code in it they would not apply anyway.
 *   - level M only (~15% recovery). The level the spec's own QR guidance names
 *     for a printed code.
 *   - versions 1–10 only. `encodeQr` THROWS on anything that does not fit
 *     rather than silently truncating — a truncated QR scans cleanly and takes
 *     the scanner somewhere wrong, which is the worst possible failure here.
 *   - ECI is not emitted, so input is restricted to characters that survive
 *     UTF-8 without a charset declaration. Scanners read undeclared byte-mode
 *     payloads as UTF-8 or Latin-1; a URL is ASCII either way.
 */

// ─── GF(256), the field QR's Reed–Solomon lives in ───────────────────────────
// Primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 = 0x11D, generator element 2.
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
}

export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** Generator polynomial for `degree` error-correction codewords, high term first. */
function rsGeneratorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    // multiply by (x - alpha^i)
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** The `ecLen` error-correction codewords for one data block. */
export function rsEncode(data: readonly number[], ecLen: number): number[] {
  const gen = rsGeneratorPoly(ecLen);
  const remainder = new Array<number>(ecLen).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    if (factor !== 0) {
      for (let i = 0; i < ecLen; i += 1) {
        remainder[i] ^= gfMul(gen[i + 1], factor);
      }
    }
  }
  return remainder;
}

// ─── Version tables, level M only ────────────────────────────────────────────
// [total data codewords, EC codewords per block, [blockCount, dataPerBlock]...]
type VersionSpec = {
  dataCodewords: number;
  ecPerBlock: number;
  blocks: ReadonlyArray<{ count: number; dataCodewords: number }>;
};

const VERSIONS_M: Readonly<Record<number, VersionSpec>> = {
  1: { dataCodewords: 16, ecPerBlock: 10, blocks: [{ count: 1, dataCodewords: 16 }] },
  2: { dataCodewords: 28, ecPerBlock: 16, blocks: [{ count: 1, dataCodewords: 28 }] },
  3: { dataCodewords: 44, ecPerBlock: 26, blocks: [{ count: 1, dataCodewords: 44 }] },
  4: { dataCodewords: 64, ecPerBlock: 18, blocks: [{ count: 2, dataCodewords: 32 }] },
  5: { dataCodewords: 86, ecPerBlock: 24, blocks: [{ count: 2, dataCodewords: 43 }] },
  6: { dataCodewords: 108, ecPerBlock: 16, blocks: [{ count: 4, dataCodewords: 27 }] },
  7: { dataCodewords: 124, ecPerBlock: 18, blocks: [{ count: 4, dataCodewords: 31 }] },
  8: {
    dataCodewords: 154,
    ecPerBlock: 22,
    blocks: [
      { count: 2, dataCodewords: 38 },
      { count: 2, dataCodewords: 39 },
    ],
  },
  9: {
    dataCodewords: 182,
    ecPerBlock: 22,
    blocks: [
      { count: 3, dataCodewords: 36 },
      { count: 2, dataCodewords: 37 },
    ],
  },
  10: {
    dataCodewords: 216,
    ecPerBlock: 26,
    blocks: [
      { count: 4, dataCodewords: 43 },
      { count: 1, dataCodewords: 44 },
    ],
  },
};

export const MAX_VERSION = 10;

/** Alignment pattern centre coordinates per version (empty for version 1). */
const ALIGNMENT_CENTERS: Readonly<Record<number, readonly number[]>> = {
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

/** Byte-mode character count indicator width. 8 bits up to version 9, 16 after. */
export function charCountBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

export function versionSpec(version: number): VersionSpec {
  const spec = VERSIONS_M[version];
  if (!spec) throw new Error(`qr: unsupported version ${version}`);
  return spec;
}

/** UTF-8 bytes, without a BOM and without an ECI header. */
export function toUtf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
  }
  return out;
}

/** Smallest version 1–10 that holds `byteLength` bytes in byte mode at level M. */
export function chooseVersion(byteLength: number): number {
  for (let v = 1; v <= MAX_VERSION; v += 1) {
    const capacityBits = versionSpec(v).dataCodewords * 8;
    const needed = 4 + charCountBits(v) + byteLength * 8;
    if (needed <= capacityBits) return v;
  }
  throw new Error(
    `qr: ${byteLength} bytes does not fit in versions 1-${MAX_VERSION} at error correction M`
  );
}

// ─── Bit buffer ──────────────────────────────────────────────────────────────
class BitBuffer {
  readonly bits: number[] = [];

  put(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) this.bits.push((value >>> i) & 1);
  }
}

/** Mode indicator + length + payload + terminator + padding, to full codewords. */
export function buildDataCodewords(bytes: readonly number[], version: number): number[] {
  const spec = versionSpec(version);
  const capacityBits = spec.dataCodewords * 8;
  const buf = new BitBuffer();
  buf.put(0b0100, 4); // byte mode
  buf.put(bytes.length, charCountBits(version));
  for (const b of bytes) buf.put(b, 8);
  if (buf.bits.length > capacityBits) {
    throw new Error('qr: payload exceeds the chosen version capacity');
  }
  // Terminator: up to four zero bits, truncated by the remaining capacity.
  const terminator = Math.min(4, capacityBits - buf.bits.length);
  buf.put(0, terminator);
  // Pad to a codeword boundary, then alternate the two specified pad bytes.
  while (buf.bits.length % 8 !== 0) buf.bits.push(0);
  const codewords: number[] = [];
  for (let i = 0; i < buf.bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | buf.bits[i + j];
    codewords.push(byte);
  }
  const PAD = [0xec, 0x11];
  let padIndex = 0;
  while (codewords.length < spec.dataCodewords) {
    codewords.push(PAD[padIndex % 2]);
    padIndex += 1;
  }
  return codewords;
}

/** Split into blocks, RS-encode each, then interleave data then EC. */
export function interleaveCodewords(dataCodewords: readonly number[], version: number): number[] {
  const spec = versionSpec(version);
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (const group of spec.blocks) {
    for (let i = 0; i < group.count; i += 1) {
      const block = dataCodewords.slice(offset, offset + group.dataCodewords);
      offset += group.dataCodewords;
      dataBlocks.push(block);
      ecBlocks.push(rsEncode(block, spec.ecPerBlock));
    }
  }
  if (offset !== dataCodewords.length) {
    throw new Error('qr: block table does not account for every data codeword');
  }
  const out: number[] = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < spec.ecPerBlock; i += 1) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return out;
}

// ─── Format and version information ──────────────────────────────────────────
/**
 * 15 format bits: two EC-level bits (M = 00), three mask bits, a BCH(15,5)
 * remainder under generator 0x537, the whole thing XORed with 0x5412 so an
 * all-zero format never reads as a valid one.
 */
export function formatInfoBits(mask: number): number {
  const data = (0b00 << 3) | mask; // level M
  let rem = data << 10;
  for (let i = 4; i >= 0; i -= 1) {
    if (rem & (1 << (i + 10))) rem ^= 0x537 << i;
  }
  return ((data << 10) | rem) ^ 0x5412;
}

/** 18 version bits for versions 7+: 6 data bits and a BCH(18,6) remainder. */
export function versionInfoBits(version: number): number {
  let rem = version << 12;
  for (let i = 5; i >= 0; i -= 1) {
    if (rem & (1 << (i + 12))) rem ^= 0x1f25 << i;
  }
  return (version << 12) | rem;
}

// ─── Matrix construction ─────────────────────────────────────────────────────
export type QrCode = {
  /** Modules per side, excluding the quiet zone. */
  size: number;
  version: number;
  /** The mask pattern chosen by the penalty rules. */
  mask: number;
  /** `modules[row][col]`, true for a dark module. */
  modules: boolean[][];
};

type Grid = { modules: boolean[][]; reserved: boolean[][]; size: number };

function blankGrid(size: number): Grid {
  return {
    size,
    modules: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
    reserved: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
  };
}

function setFunction(grid: Grid, row: number, col: number, dark: boolean): void {
  if (row < 0 || col < 0 || row >= grid.size || col >= grid.size) return;
  grid.modules[row][col] = dark;
  grid.reserved[row][col] = true;
}

function drawFinder(grid: Grid, row: number, col: number): void {
  // The 7x7 finder plus its one-module separator on every side that exists.
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const inner = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const dark =
        inner &&
        ((r === 0 || r === 6 || c === 0 || c === 6) || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      setFunction(grid, row + r, col + c, dark);
    }
  }
}

function drawAlignment(grid: Grid, row: number, col: number): void {
  for (let r = -2; r <= 2; r += 1) {
    for (let c = -2; c <= 2; c += 1) {
      const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
      setFunction(grid, row + r, col + c, dark);
    }
  }
}

function drawFunctionPatterns(grid: Grid, version: number): void {
  const size = grid.size;
  drawFinder(grid, 0, 0);
  drawFinder(grid, 0, size - 7);
  drawFinder(grid, size - 7, 0);

  // Timing patterns, alternating from the first module after the finders.
  for (let i = 8; i < size - 8; i += 1) {
    const dark = i % 2 === 0;
    setFunction(grid, 6, i, dark);
    setFunction(grid, i, 6, dark);
  }

  // Alignment patterns, minus the three that would sit on a finder.
  const centers = ALIGNMENT_CENTERS[version] ?? [];
  for (const r of centers) {
    for (const c of centers) {
      const onFinder =
        (r === 6 && c === 6) ||
        (r === 6 && c === size - 7) ||
        (r === size - 7 && c === 6);
      if (!onFinder) drawAlignment(grid, r, c);
    }
  }

  // Format information areas — reserved now, written after the mask is chosen.
  // Index 6 is skipped in both directions: (8,6) and (6,8) are timing modules
  // that the format field steps over, and blanking them here would break the
  // timing pattern the reader uses to find the grid.
  for (let i = 0; i < 9; i += 1) {
    if (i === 6) continue;
    setFunction(grid, 8, i, false);
    setFunction(grid, i, 8, false);
  }
  for (let i = 0; i < 8; i += 1) {
    setFunction(grid, 8, size - 1 - i, false);
    setFunction(grid, size - 1 - i, 8, false);
  }
  // The always-dark module below the bottom-left finder.
  setFunction(grid, size - 8, 8, true);

  if (version >= 7) {
    const bits = versionInfoBits(version);
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 11;
      setFunction(grid, a, b, dark);
      setFunction(grid, b, a, dark);
    }
  }
}

function writeFormatInfo(grid: Grid, mask: number): void {
  const size = grid.size;
  const bits = formatInfoBits(mask);
  for (let i = 0; i < 15; i += 1) {
    // MOST SIGNIFICANT BIT FIRST. Position 0 — module (8,0), and (size-1, 8)
    // in the second copy — carries bit 14, not bit 0. Writing this field
    // little-endian produces a symbol that is correct in every other respect
    // and that no reader will decode: the 15 bits still pass their own BCH
    // check reversed, so nothing downstream notices.
    const dark = ((bits >> (14 - i)) & 1) === 1;
    // Copy 1, wrapped around the top-left finder.
    if (i < 6) setFunction(grid, 8, i, dark);
    else if (i === 6) setFunction(grid, 8, 7, dark);
    else if (i === 7) setFunction(grid, 8, 8, dark);
    else if (i === 8) setFunction(grid, 7, 8, dark);
    else setFunction(grid, 14 - i, 8, dark);
    // Copy 2, split between the other two finders: bits 0-6 run up column 8
    // from the bottom edge, bits 7-14 run along row 8 to the right edge. The
    // split is 7/8, not 8/7 — one further step up the column would overwrite
    // the always-dark module at (size-8, 8).
    if (i < 7) setFunction(grid, size - 1 - i, 8, dark);
    else setFunction(grid, 8, size - 15 + i, dark);
  }
}

/** The mask condition for pattern `mask` at (row, col). */
export function maskCondition(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    case 7:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      throw new Error(`qr: unknown mask ${mask}`);
  }
}

/**
 * The zig-zag data walk: two-module columns from the right edge leftward,
 * alternating upward and downward, skipping the vertical timing column.
 * Exported because the test walks it back the other way.
 */
export function dataModulePositions(size: number, reserved: boolean[][]): Array<[number, number]> {
  const positions: Array<[number, number]> = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    // The vertical timing pattern occupies column 6, and the walk steps OVER
    // it: the pair that would have been 6/5 becomes 5/4, and every pair after
    // it shifts with it. Reassigning the loop variable (rather than a local
    // copy of it) is what makes the next decrement land on 3 and not on 4 —
    // with a local copy, column 4 is walked twice and column 0 never, which
    // still yields the right NUMBER of modules and a symbol that no reader
    // can decode.
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      const row = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j += 1) {
        const col = right - j;
        if (reserved[row][col]) continue;
        positions.push([row, col]);
      }
    }
    upward = !upward;
  }
  return positions;
}

function penalty(modules: readonly boolean[][], size: number): number {
  let score = 0;

  // Rule 1: runs of five or more same-coloured modules in a row or column.
  for (let i = 0; i < size; i += 1) {
    for (const horizontal of [true, false]) {
      let runColor = horizontal ? modules[i][0] : modules[0][i];
      let runLength = 1;
      for (let j = 1; j < size; j += 1) {
        const value = horizontal ? modules[i][j] : modules[j][i];
        if (value === runColor) {
          runLength += 1;
        } else {
          if (runLength >= 5) score += runLength - 2;
          runColor = value;
          runLength = 1;
        }
      }
      if (runLength >= 5) score += runLength - 2;
    }
  }

  // Rule 2: 2x2 blocks of one colour.
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = modules[r][c];
      if (modules[r][c + 1] === v && modules[r + 1][c] === v && modules[r + 1][c + 1] === v) {
        score += 3;
      }
    }
  }

  // Rule 3: the 1:1:3:1:1 finder-lookalike with four light modules on a side.
  const A = [true, false, true, true, true, false, true, false, false, false, false];
  const B = [false, false, false, false, true, false, true, true, true, false, true];
  const matches = (get: (k: number) => boolean, start: number, pattern: boolean[]): boolean => {
    for (let k = 0; k < pattern.length; k += 1) if (get(start + k) !== pattern[k]) return false;
    return true;
  };
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j + 11 <= size; j += 1) {
      const row = (k: number) => modules[i][k];
      const col = (k: number) => modules[k][i];
      if (matches(row, j, A) || matches(row, j, B)) score += 40;
      if (matches(col, j, A) || matches(col, j, B)) score += 40;
    }
  }

  // Rule 4: deviation of the dark-module proportion from 50%.
  let dark = 0;
  for (let r = 0; r < size; r += 1) for (let c = 0; c < size; c += 1) if (modules[r][c]) dark += 1;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/**
 * Encode `text` as a QR code at error correction level M.
 *
 * @throws if the payload does not fit in versions 1–10.
 */
export function encodeQr(text: string): QrCode {
  if (text.length === 0) throw new Error('qr: nothing to encode');
  const bytes = toUtf8Bytes(text);
  const version = chooseVersion(bytes.length);
  const size = 17 + version * 4;
  const codewords = interleaveCodewords(buildDataCodewords(bytes, version), version);

  const base = blankGrid(size);
  drawFunctionPatterns(base, version);

  const positions = dataModulePositions(size, base.reserved);
  const bits: boolean[] = [];
  for (const cw of codewords) {
    for (let i = 7; i >= 0; i -= 1) bits.push(((cw >> i) & 1) === 1);
  }
  // Remainder bits (versions 2–6 have 7, 7–13 have 0) stay light; they are
  // simply the positions the codeword bits do not reach.
  for (let i = 0; i < positions.length; i += 1) {
    const [row, col] = positions[i];
    base.modules[row][col] = i < bits.length ? bits[i] : false;
  }

  let best: QrCode | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate: Grid = {
      size,
      reserved: base.reserved,
      modules: base.modules.map((row) => row.slice()),
    };
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        if (candidate.reserved[r][c]) continue;
        if (maskCondition(mask, r, c)) candidate.modules[r][c] = !candidate.modules[r][c];
      }
    }
    writeFormatInfo(candidate, mask);
    const score = penalty(candidate.modules, size);
    if (score < bestScore) {
      bestScore = score;
      best = { size, version, mask, modules: candidate.modules };
    }
  }
  if (!best) throw new Error('qr: no mask chosen');
  return best;
}

// ─── SVG rendering ───────────────────────────────────────────────────────────

/**
 * An SVG for `code`, as a string.
 *
 * The quiet zone is part of the symbol, not decoration: the spec requires four
 * light modules on every side and scanners really do fail without them, so it
 * is built into the viewBox rather than left to whatever lays the image out.
 *
 * The dark modules go out as ONE `<path>` rather than a rect each. A version-4
 * symbol is 33x33; one element per module is a thousand nodes for something
 * that never changes after it is drawn.
 */
export function renderQrSvg(
  code: QrCode,
  opts: { quietZone?: number; dark?: string; light?: string } = {}
): string {
  const quiet = opts.quietZone ?? 4;
  const dark = opts.dark ?? '#000000';
  const light = opts.light ?? '#FFFFFF';
  const extent = code.size + quiet * 2;
  const parts: string[] = [];
  for (let r = 0; r < code.size; r += 1) {
    let c = 0;
    while (c < code.size) {
      if (!code.modules[r][c]) {
        c += 1;
        continue;
      }
      let run = 1;
      while (c + run < code.size && code.modules[r][c + run]) run += 1;
      parts.push(`M${c + quiet} ${r + quiet}h${run}v1h-${run}z`);
      c += run;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}" ` +
    `shape-rendering="crispEdges">` +
    `<rect width="${extent}" height="${extent}" fill="${light}"/>` +
    `<path fill="${dark}" d="${parts.join('')}"/>` +
    `</svg>`
  );
}

/** The prefix react-native-web recognises as inline SVG markup. */
export const SVG_DATA_URI_PREFIX = 'data:image/svg+xml;utf8,';

/**
 * The SVG as a `data:` URI with the markup left RAW.
 *
 * This is the form react-native-web's `Image` wants: it matches exactly this
 * prefix and percent-encodes the markup itself on the way to the DOM. Handing
 * it an already-encoded string gets it encoded a second time, and the browser's
 * single decode then yields `%3Csvg…` instead of `<svg…` — an image element
 * pointing at nothing renderable.
 */
export function qrSvgDataUriRaw(
  code: QrCode,
  opts?: { quietZone?: number; dark?: string; light?: string }
): string {
  return `${SVG_DATA_URI_PREFIX}${renderQrSvg(code, opts)}`;
}

/**
 * The same URI with the markup percent-encoded — the form a plain `<img src>`
 * needs, since `#` in a colour would otherwise start a fragment.
 *
 * Percent-encoded rather than base64: the payload is ASCII either way, and the
 * encoded form stays greppable in a DOM snapshot when a test goes wrong.
 */
export function qrSvgDataUri(
  code: QrCode,
  opts?: { quietZone?: number; dark?: string; light?: string }
): string {
  return `${SVG_DATA_URI_PREFIX}${encodeURIComponent(renderQrSvg(code, opts))}`;
}
