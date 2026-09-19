// The public display cannot scroll, so a long confirmed string has to be
// sized to fit rather than allowed to grow the column off the screen. These
// are the two properties that matter:
//
//   1. every string short enough to appear on an approved fixture gets the
//      APPROVED size, unchanged — the scale never redesigns what was reviewed
//   2. the size never grows with the string: longer input is the same size or
//      smaller, at both layouts
//
// See src/ui/displayTypeScale.ts.

import { describe, expect, it } from 'vitest';

import {
  communityNameType,
  goalTitleType,
  totalLineType,
  type DisplayLayout,
} from '../src/ui/displayTypeScale';

const LAYOUTS: DisplayLayout[] = ['wide', 'phone'];
const chars = (n: number) => 'a'.repeat(n);

describe('goalTitleType', () => {
  it('leaves the approved sizes alone for the reviewed fixtures', () => {
    // Every goal title on an approved display fixture.
    for (const title of ['Squats together this week', 'Minutes walked in September', 'August push-ups']) {
      expect(goalTitleType(title, 'wide')).toEqual({ fontSize: 68, lineHeight: 76 });
      expect(goalTitleType(title, 'phone')).toEqual({ fontSize: 30, lineHeight: 36 });
    }
  });

  it('steps down by length and never up', () => {
    for (const layout of LAYOUTS) {
      const sizes = [0, 40, 41, 70, 71, 95, 96, 240].map((n) => goalTitleType(chars(n), layout).fontSize);
      for (let i = 1; i < sizes.length; i += 1) expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1]);
      expect(sizes[0]).toBeGreaterThan(sizes[sizes.length - 1]);
    }
  });

  it('is a pure function of the string, at the tier boundary', () => {
    expect(goalTitleType(chars(40), 'wide')).toEqual(goalTitleType(chars(40), 'wide'));
    expect(goalTitleType(chars(41), 'wide').fontSize).toBeLessThan(goalTitleType(chars(40), 'wide').fontSize);
  });

  it('counts code points, not UTF-16 units', () => {
    // 40 emoji are 80 UTF-16 units; the tier is about how much has to be set,
    // and one emoji sets as one glyph.
    expect(goalTitleType('🏃'.repeat(40), 'wide').fontSize).toBe(68);
    expect(goalTitleType('🏃'.repeat(41), 'wide').fontSize).toBeLessThan(68);
  });

  it('keeps line height proportional to size', () => {
    for (const layout of LAYOUTS) {
      for (const n of [10, 50, 80, 200]) {
        const t = goalTitleType(chars(n), layout);
        expect(t.lineHeight).toBeGreaterThanOrEqual(t.fontSize);
        expect(t.lineHeight).toBeLessThanOrEqual(t.fontSize * 1.25);
      }
    }
  });
});

describe('communityNameType', () => {
  it('leaves the approved sizes alone for the reviewed fixture', () => {
    expect(communityNameType('Maple Street Movers', 'wide')).toEqual({ fontSize: 30, letterSpacing: 2 });
    expect(communityNameType('Maple Street Movers', 'phone')).toEqual({ fontSize: 15, letterSpacing: 1.2 });
  });

  it('steps down, with its tracking, past 45 characters', () => {
    for (const layout of LAYOUTS) {
      const short = communityNameType(chars(45), layout);
      const long = communityNameType(chars(46), layout);
      const longest = communityNameType(chars(200), layout);
      expect(long.fontSize).toBeLessThan(short.fontSize);
      expect(long.letterSpacing).toBeLessThan(short.letterSpacing);
      expect(longest.fontSize).toBeLessThanOrEqual(long.fontSize);
    }
  });
});

describe('totalLineType', () => {
  it('leaves the approved sizes alone for the reviewed result lines', () => {
    for (const line of ['241 of 500 squats', '515 squats completed together.', '4,999 of 5,000 minutes']) {
      expect(totalLineType(line, 'wide')).toEqual({ fontSize: 64, lineHeight: 72 });
      expect(totalLineType(line, 'phone')).toEqual({ fontSize: 30, lineHeight: 36 });
    }
  });

  it('steps down when a long unit makes the line long', () => {
    const line = `241 of 500 ${chars(40)}`;
    for (const layout of LAYOUTS) {
      expect(totalLineType(line, layout).fontSize).toBeLessThan(totalLineType('241 of 500 squats', layout).fontSize);
    }
  });

  it('tolerates an empty string', () => {
    expect(totalLineType('', 'wide').fontSize).toBe(64);
  });
});
