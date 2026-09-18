import { describe, expect, it } from 'vitest';

import { encodeQr } from '../src/ui/qr';

/**
 * EXTERNAL REFERENCE VECTORS.
 *
 * Every other test of the encoder is written by the same hand as the encoder,
 * including the reader in qr-encoder.test.ts — and that reader shared one of
 * the writer's mistakes (it read the format field back in the same reversed
 * order the writer wrote it, so a symbol no scanner could decode round-tripped
 * cleanly). These matrices come from somewhere else entirely.
 *
 * PROVENANCE. Generated with the Python package `qrcode` 8.2 (MIT), in byte
 * mode at error correction M, with the mask forced to the one this encoder
 * chooses, and then each one was rendered and decoded with `zxing-cpp` 3.1.1
 * (the ZXing C++ port) to confirm it is a real, readable symbol:
 *
 *     q = qrcode.QRCode(version=V, error_correction=ERROR_CORRECT_M,
 *                       box_size=1, border=0, mask_pattern=M)
 *     q.add_data(qrcode.util.QRData(payload.encode(), mode=MODE_8BIT_BYTE))
 *     q.make(fit=False)
 *
 * Neither package is a dependency of this app; they were used once, offline,
 * to mint the literals below. Nothing here imports them.
 *
 * REGENERATING. `mask` is pinned because the comparison is module for module.
 * If a change to the penalty scoring makes this encoder choose a different
 * mask, these vectors must be regenerated with the new mask rather than the
 * assertion relaxed — and the new matrices must be decoded again before being
 * trusted. When the vectors were minted, this encoder's mask choice agreed
 * with the argmin of the reference encoder's own penalty function on all 57
 * payloads that were checked.
 *
 * The three vectors are chosen to cover the parts of the layout that differ:
 * version 1 has no alignment pattern and no version block; version 4 has one
 * alignment pattern; version 7 is the first version carrying the 18-bit
 * version information blocks beside two of the finders.
 */

const VECTORS: ReadonlyArray<{
  payload: string;
  version: number;
  mask: number;
  rows: readonly string[];
}> = [
  {
    payload: "HELLO WORLD",
    version: 1,
    mask: 4,
    rows: [
    "#######.##..#.#######",
    "#.....#....#..#.....#",
    "#.###.#..#.#..#.###.#",
    "#.###.#.#..#..#.###.#",
    "#.###.#.###.#.#.###.#",
    "#.....#.#..#..#.....#",
    "#######.#.#.#.#######",
    "........#..##........",
    "#...#.######.#####..#",
    "...#....#.###....####",
    "..######..##.##.#..#.",
    "#####...##...#.......",
    "#####.#.#.#.#.##..##.",
    "........#.#.####.#.##",
    "#######.###.#.#.##.#.",
    "#.....#..#.###.##..##",
    "#.###.#.##.#.##...##.",
    "#.###.#..#..#...##.##",
    "#.###.#..###...###...",
    "#.....#....#.#.......",
    "#######.#########.#.#",
    ],
  },
  {
    payload: "https://we-stay-fit.web.app/join/9wq2Zc4TpK1nRu7bVdA0Xg",
    version: 4,
    mask: 4,
    rows: [
    "#######.#..######.#..#.#..#######",
    "#.....#..#.#.##...##.##.#.#.....#",
    "#.###.#..#.#..#.##.######.#.###.#",
    "#.###.#.#.#.....###.##.#..#.###.#",
    "#.###.#.#.###...#...#.##..#.###.#",
    "#.....#.#..#...#...#......#.....#",
    "#######.#.#.#.#.#.#.#.#.#.#######",
    "........##..#.#..##..#.#.........",
    "#...#.#####....#.#.#.##..#####..#",
    "#....#..#..#..#####...##.#...##..",
    "..#####.##.#.###.#....###....#...",
    "#...#..#####.#...#.####..##....##",
    "...#.##.##.###.###..###..##.##...",
    ".#####.######.#...##.####..#.....",
    "#.#...##.#...###.....#######...#.",
    "....#...#.#.#..###..##...###.....",
    ".#.#######...#...#####.#..#.##.#.",
    ".#.###.#.#######..#.#..#.....###.",
    ".##...##.#..#..##.#..#.###.#.#...",
    "#.#..#.#..#...#####.##.##..#....#",
    ".##.#.###..##.....####.##.##.#...",
    "#.##.#...#####..###..##...##.###.",
    "...#.####.##....#.#..#.#.#.#..##.",
    "...##......##.#..#.###.#.####..##",
    "####..#...#...####.#.##.######..#",
    "........#####..####.....#...#.##.",
    "#######.##.##.###.#.#...#.#.##.#.",
    "#.....#...#.#####....#.##...#..#.",
    "#.###.#.#.#.#...#....##.######.#.",
    "#.###.#..##..#....##...##.###.#..",
    "#.###.#..##..#.#.#........###....",
    "#.....#...#...######.##.##...#...",
    "#######.#.####..##.########..#..#",
    ],
  },
  {
    payload: "https://we-stay-fit.web.app/join/aA1-_Zz9aA1-_Zz9aA1-_Zz9aA1-_Zz9aA1-_Zz9aA1-_Zz9aA1-_Zz9aA1-_Zz9aA1-_Zz9aA",
    version: 7,
    mask: 3,
    rows: [
    "#######.#.#.#.##.#...##..#...###.#..#.#######",
    "#.....#.####....##.##.#.....#.#.##.#..#.....#",
    "#.###.#..#.#.#..##.#.##.#.#.####...#..#.###.#",
    "#.###.#.######..###.#.##..#..###...##.#.###.#",
    "#.###.#...####.#.#.#######.#...##.###.#.###.#",
    "#.....#....##...#..##...##..##.#.#....#.....#",
    "#######.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#######",
    "........#.#....##..##...##..##.#.#..#........",
    "#.##.###.....####...#######.##.#.#.#..#..#.##",
    "###....#.#..###..####.#.##.#..##...##...##.##",
    ".##.####...####.###.###.##.#.##.#.#.##...####",
    "######..#..##.##..#.###.##.##..##..###.....#.",
    "#..#.####.####.####.#..#.#.#.##..###.#......#",
    ".......##...#.######......##.#.##.....##.####",
    "#..#..###...###....#####..#.#..#.#..###...#..",
    "##.#...##.#..#.#####.#.##...#...###....#.###.",
    ".#.##.#.##.#.###.#.###..###....##.#.####..##.",
    "#..###.....#.#.##.###.##.......#.###.#.####..",
    "....#.##.#####..#.#....##..##..#..##.###.#.#.",
    "#..##..##.#.##.....###..#.#.#.#..##.#.###..#.",
    ".##.#####...##......#####..####..#..######..#",
    "#...#...##....##.#..#...#....###...##...###.#",
    ".##.#.#.#..####.#.#.#.#.###.#....#.##.#.##.##",
    "#...#...#.#.....#.###...#..#.###.##.#...##...",
    ".#..#####.......##..#######..###...#######..#",
    "#...#...##..###.##.####.####...##..#.##...#..",
    "##....###...#.###..#....###..#.#....#..####..",
    "#..#.#....#.#.#.##...##.#..#.#.####....#.####",
    "..##.###.#..####.##....########.##.##..####..",
    ".####..#..###.####.#.#...#...##..##.#####.###",
    "..#..###...#.##.#...#####.#.#.#..###...#.....",
    "..#..#.########...#.#.##..###.##..###....#.##",
    "#..#.####.#...#.#..#####...###......#.##.###.",
    "#..##..#####.#..#..#..#.#..#######.#.#.#...#.",
    "....#.#.###.#.##.#..######..###.###..##.#####",
    ".####..#...#.##.#.........##..#.#..#.....#...",
    "#..##.#..#..#.....#######.##.....##.######.##",
    "........#..##.#.#.#.#...##..#....#..#...#....",
    "#######.####.###.#..#.#.##...#####.##.#.#....",
    "#.....#.##..##.#...##...##.###..#.###...#####",
    "#.###.#..##.##....#.########..####..#####.##.",
    "#.###.#.#.##....#.#..#.#.....#...#####.....##",
    "#.###.#.#.#.#.#.....##..#.#..##.#.#.##...###.",
    "#.....#..#.#...##..#.....#.#.#..#.....##....#",
    "#######.#.##..##......##....##...##..##......",
    ],
  },
];

describe('matches an independently generated reference encoder', () => {
  for (const vector of VECTORS) {
    it(`version ${vector.version}, mask ${vector.mask}: ${vector.payload.slice(0, 40)}`, () => {
      const code = encodeQr(vector.payload);
      expect(code.version, 'version').toBe(vector.version);
      expect(code.mask, 'mask — see REGENERATING above before touching this').toBe(vector.mask);
      expect(code.size).toBe(vector.rows.length);
      const got = code.modules.map((row) => row.map((v) => (v ? '#' : '.')).join(''));
      // Row by row, so a failure names the row rather than dumping the symbol.
      for (let r = 0; r < vector.rows.length; r += 1) {
        expect(got[r], `row ${r}`).toBe(vector.rows[r]);
      }
    });
  }

  it('covers version 1, a version with an alignment pattern, and a version with a version block', () => {
    expect(VECTORS.map((v) => v.version)).toEqual([1, 4, 7]);
  });
});
