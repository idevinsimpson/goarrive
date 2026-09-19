import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  figureKindFor,
  moveFigureLabel,
  moveFigureSvg,
  moveFigureSvgDataUri,
  moveFigureSvgDataUriRaw,
  type MoveFigureKind,
  type MovePose,
} from '../src/ui/moveFigure';

const KINDS: MoveFigureKind[] = ['squat', 'pushup', 'reach', 'step', 'generic'];
const POSES: MovePose[] = ['start', 'end'];

describe('figureKindFor', () => {
  it('recognises the activities the app already has guides for', () => {
    expect(figureKindFor('squats')).toBe('squat');
    expect(figureKindFor('push-ups')).toBe('pushup');
    expect(figureKindFor('miles')).toBe('step');
    expect(figureKindFor('jumping jacks')).toBe('reach');
  });

  // An unknown activity still gets a moving figure. Falling back beats
  // showing nothing at an event.
  it('falls back rather than failing on anything else', () => {
    for (const unit of ['', '   ', 'burpees', 'kettlebell swings', null, undefined]) {
      expect(KINDS).toContain(figureKindFor(unit));
    }
    expect(figureKindFor('something nobody has heard of')).toBe('generic');
  });
});

describe('moveFigureSvgDataUri', () => {
  it('draws inline, so nothing is fetched on an event floor', () => {
    const uri = moveFigureSvgDataUri({ kind: 'squat', pose: 'start' });
    expect(uri.startsWith('data:image/svg+xml;utf8,')).toBe(true);
    const svg = decodeURIComponent(uri.replace('data:image/svg+xml;utf8,', ''));
    // "no network" means no external RESOURCE. The SVG namespace is a URI by
    // spec and is never fetched, so the honest assertion is that nothing here
    // references something to load.
    expect(svg).not.toMatch(/(?:href|src)\s*=/);
    expect(svg).not.toContain('url(');
    expect(svg.replace('http://www.w3.org/2000/svg', '')).not.toContain('http');
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('draws every kind in both poses, and the two poses differ', () => {
    for (const kind of KINDS) {
      const start = moveFigureSvgDataUri({ kind, pose: 'start' });
      const end = moveFigureSvgDataUri({ kind, pose: 'end' });
      for (const uri of [start, end]) {
        const svg = decodeURIComponent(uri.replace('data:image/svg+xml;utf8,', ''));
        // A figure at minimum: a head and limbs.
        expect(svg).toContain('<circle');
        expect((svg.match(/<line /g) ?? []).length).toBeGreaterThanOrEqual(4);
      }
      // If the poses were identical the figure would not read as movement.
      expect(start).not.toBe(end);
    }
  });

  it('uses the brand colours and no others', () => {
    const navy = decodeURIComponent(moveFigureSvgDataUri({ kind: 'squat', pose: 'start' }));
    expect(navy).toContain('#0B1F3A');
    const green = decodeURIComponent(
      moveFigureSvgDataUri({ kind: 'squat', pose: 'start', accent: true })
    );
    expect(green).toContain('#91CB7D');
  });

  it('escapes its markup, so the URI cannot carry raw angle brackets', () => {
    const uri = moveFigureSvgDataUri({ kind: 'generic', pose: 'end' });
    expect(uri).not.toContain('<');
    expect(uri).not.toContain('>');
  });
});

/**
 * The two-variant contract, and why it is not a style choice.
 *
 * react-native-web percent-encodes an inline-SVG `<Image>` source itself. Hand
 * it an already-encoded URI and it encodes it a second time, the load fails,
 * and RNW renders NO `<img>` at all — the screen shows a blank box and nothing
 * throws. That is a silent failure, so it gets a loud test.
 */
describe('moveFigureSvgDataUriRaw', () => {
  it('carries the markup unencoded, which is what an RNW Image needs', () => {
    const raw = moveFigureSvgDataUriRaw({ kind: 'squat', pose: 'start' });
    expect(raw.startsWith('data:image/svg+xml;utf8,')).toBe(true);
    expect(raw).toContain('<svg ');
    expect(raw).toContain('</svg>');
    // The colour's `#` is the exact character that forces the two variants
    // apart: raw keeps it, a plain <img src> needs it escaped.
    expect(raw).toContain('#0B1F3A');
    expect(raw).not.toContain('%3Csvg');
  });

  it('is the same drawing as the encoded variant, only differently written', () => {
    for (const kind of KINDS) {
      for (const pose of POSES) {
        const raw = moveFigureSvgDataUriRaw({ kind, pose });
        const encoded = moveFigureSvgDataUri({ kind, pose });
        expect(raw).not.toBe(encoded);
        expect(encoded).toContain('%23');
        const prefix = 'data:image/svg+xml;utf8,';
        expect(raw.slice(prefix.length)).toBe(moveFigureSvg({ kind, pose }));
        expect(decodeURIComponent(encoded.slice(prefix.length))).toBe(
          moveFigureSvg({ kind, pose })
        );
      }
    }
  });
});

/**
 * A screen that reaches for the wrong variant shows a blank box and passes
 * every type check, so the wiring itself is worth pinning. This walks the real
 * source rather than trusting a comment.
 */
describe('the screens that draw a figure', () => {
  const root = join(__dirname, '..');
  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.tsx') || full.endsWith('.ts')) sources.push(full);
    }
  };
  walk(join(root, 'app'));
  walk(join(root, 'src'));

  it('never hand a react-native-web Image the pre-encoded URI', () => {
    const offenders = sources.filter((file) =>
      /source=\{\{\s*uri:\s*moveFigureSvgDataUri\s*\(/.test(readFileSync(file, 'utf8'))
    );
    expect(offenders, `these pass a double-encoded URI to <Image>: ${offenders.join(', ')}`)
      .toEqual([]);
  });

  // Proves the check above can actually fail, rather than passing because the
  // pattern never matches anything.
  it('would catch it if one did', () => {
    const bad = '<Image source={{ uri: moveFigureSvgDataUri({ kind, pose }) }} />';
    const good = '<Image source={{ uri: moveFigureSvgDataUriRaw({ kind, pose }) }} />';
    const re = /source=\{\{\s*uri:\s*moveFigureSvgDataUri\s*\(/;
    expect(re.test(bad)).toBe(true);
    expect(re.test(good)).toBe(false);
  });

  it('and the move screen is in fact wired to the raw variant', () => {
    const screen = readFileSync(join(root, 'app', 'move', '[goalId].tsx'), 'utf8');
    expect(screen).toContain('moveFigureSvgDataUriRaw({ kind, pose })');
  });
});

describe('moveFigureLabel', () => {
  // The figure is a diagram of a shape, not a picture of a person anyone is
  // being asked to resemble, and the label must not turn it into one.
  it('names the shape without describing a body', () => {
    for (const kind of KINDS) {
      for (const pose of POSES) {
        const label = moveFigureLabel(kind, pose);
        expect(label.startsWith('Diagram:')).toBe(true);
        for (const word of ['your', 'you should', 'correct', 'proper', 'safe', 'injury']) {
          expect(label.toLowerCase()).not.toContain(word);
        }
      }
    }
  });

  it('distinguishes the two moments', () => {
    expect(moveFigureLabel('squat', 'start')).toContain('first position');
    expect(moveFigureLabel('squat', 'end')).toContain('second position');
  });
});
