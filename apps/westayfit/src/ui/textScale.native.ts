/**
 * INT-15 / INT-16 / MF-17 (W12-8) — ONE TEXT-SCALE POLICY, on iOS and Android.
 *
 * The system text size multiplies every font on a phone, and nothing capped
 * it: at accessibility sizes the tab bar overflowed and the 44-82 pt numerals
 * broke across lines. This is the one module every lane spreads from (member,
 * motion and camera adopt it; no second policy):
 *   · chrome labels honour the text size up to 1.3x, on one line;
 *   · large numerals honour it up to 1.3x, on one line, and shrink to fit
 *     that line down to half size rather than wrap or clip a digit;
 *   · a numeral entry field honours it up to 1.3x;
 *   · a layout that switches on width decides by the width the text actually
 *     has: the screen width divided by the text size (never widened below 1x).
 * The web twin (`textScale.ts`) returns empty props and the width itself.
 * Its own copy of the caps: a `.native` file must not import its base
 * specifier, which on a phone is itself.
 */

/** The largest system text multiplier each kind of text honours. */
export const TEXT_SCALE_CAPS = Object.freeze({ chrome: 1.3, numeral: 1.3 } as const);

/** Chrome labels (tab bar, top bar): capped, one line. */
export type ChromeTextProps = Readonly<{ maxFontSizeMultiplier?: number; numberOfLines?: number }>;
/** Large numerals: capped, one line, shrinking to fit down to half size. */
export type NumeralTextProps = Readonly<{
  maxFontSizeMultiplier?: number;
  numberOfLines?: number;
  adjustsFontSizeToFit?: boolean;
  minimumFontScale?: number;
}>;
/** A numeral entry field: capped. */
export type NumeralInputProps = Readonly<{ maxFontSizeMultiplier?: number }>;

/**
 * The width a layout should decide by: `width / fontScale`, never more than
 * the width itself (a small text size does not widen the screen), and the
 * width itself when the scale is unusable.
 */
export function effectiveWidth(width: number, fontScale: number): number {
  const scale = Number.isFinite(fontScale) ? Math.max(1, fontScale) : 1;
  return width / scale;
}

export const chromeTextProps: ChromeTextProps = Object.freeze({
  maxFontSizeMultiplier: TEXT_SCALE_CAPS.chrome,
  numberOfLines: 1,
});

export const numeralTextProps: NumeralTextProps = Object.freeze({
  maxFontSizeMultiplier: TEXT_SCALE_CAPS.numeral,
  numberOfLines: 1,
  adjustsFontSizeToFit: true,
  minimumFontScale: 0.5,
});

export const numeralInputProps: NumeralInputProps = Object.freeze({
  maxFontSizeMultiplier: TEXT_SCALE_CAPS.numeral,
});
