import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Text, TextInput } from 'react-native';
import { describe, expect, it } from 'vitest';

/**
 * INT-15 / INT-16 / MF-17 (W12-8) — the one text-scale policy. Both twins are
 * imported directly (vitest does not apply platform extensions): the native
 * values, the web's empty props, and effectiveWidth on each.
 */

import * as web from '../src/ui/textScale';
import * as native from '../src/ui/textScale.native';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('the caps', () => {
  it('chrome and numerals are capped at 1.3x, the same on both twins', () => {
    expect(native.TEXT_SCALE_CAPS).toEqual({ chrome: 1.3, numeral: 1.3 });
    expect(web.TEXT_SCALE_CAPS).toEqual(native.TEXT_SCALE_CAPS);
  });
});

describe('native', () => {
  it('chrome labels: capped, one line', () => {
    expect(native.chromeTextProps).toEqual({ maxFontSizeMultiplier: 1.3, numberOfLines: 1 });
  });

  it('numerals: capped, one line, shrinking to fit down to half size', () => {
    expect(native.numeralTextProps).toEqual({
      maxFontSizeMultiplier: 1.3,
      numberOfLines: 1,
      adjustsFontSizeToFit: true,
      minimumFontScale: 0.5,
    });
  });

  it('a numeral entry field: capped', () => {
    expect(native.numeralInputProps).toEqual({ maxFontSizeMultiplier: 1.3 });
  });

  it('effectiveWidth: the width the text has — divided by the text size, never widened, sane on a bad scale', () => {
    expect(native.effectiveWidth(390, 1)).toBe(390);
    expect(native.effectiveWidth(390, 1.65)).toBeCloseTo(236.36, 2);
    expect(native.effectiveWidth(390, 1.65)).toBeLessThan(260); // the tab bar's narrow switch
    expect(native.effectiveWidth(390, 1.3)).toBe(300);
    expect(native.effectiveWidth(390, 0.85)).toBe(390); // a small text size does not widen the screen
    expect(native.effectiveWidth(390, Number.NaN)).toBe(390);
    expect(native.effectiveWidth(390, Number.POSITIVE_INFINITY)).toBe(390);
  });
});

describe('web', () => {
  it('every prop set is empty, and a width is the width', () => {
    expect(web.chromeTextProps).toEqual({});
    expect(web.numeralTextProps).toEqual({});
    expect(web.numeralInputProps).toEqual({});
    expect(web.effectiveWidth(390, 1.65)).toBe(390);
    expect(web.effectiveWidth(200, 3)).toBe(200);
  });

  it('spreading them changes nothing in the DOM (no line clamp, no ellipsis)', () => {
    const html = (node: ReturnType<typeof createElement>) => {
      const host = document.createElement('div');
      const root = createRoot(host);
      act(() => root.render(node));
      const out = host.innerHTML;
      act(() => root.unmount());
      return out;
    };
    const plain = html(createElement(Text, { testID: 'n', style: { fontSize: 82 } }, '+5,015'));
    expect(html(createElement(Text, { testID: 'n', style: { fontSize: 82 }, ...web.numeralTextProps }, '+5,015'))).toBe(plain);
    expect(html(createElement(Text, { testID: 'n', style: { fontSize: 82 }, ...web.chromeTextProps }, '+5,015'))).toBe(plain);
    expect(html(createElement(TextInput, { testID: 'i', value: '25', ...web.numeralInputProps }))).toBe(
      html(createElement(TextInput, { testID: 'i', value: '25' })),
    );
    // The native props, given to react-native-web, would clamp the line: what the web twin avoids.
    expect(html(createElement(Text, { testID: 'n', style: { fontSize: 82 }, ...native.numeralTextProps }, '+5,015'))).not.toBe(plain);
  });
});

describe('both twins', () => {
  it('export the same names, frozen', () => {
    expect(Object.keys(web).sort()).toEqual(Object.keys(native).sort());
    for (const name of ['TEXT_SCALE_CAPS', 'chromeTextProps', 'numeralTextProps', 'numeralInputProps'] as const) {
      expect(Object.isFrozen(web[name]), `web ${name}`).toBe(true);
      expect(Object.isFrozen(native[name]), `native ${name}`).toBe(true);
    }
  });
});
