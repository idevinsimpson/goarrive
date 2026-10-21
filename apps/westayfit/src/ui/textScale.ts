/**
 * INT-15 / INT-16 / MF-17 (W12-8) — ONE TEXT-SCALE POLICY.
 *
 * The web build's twin. Metro resolves `textScale.native.ts` on iOS and
 * Android.
 *
 * On a phone the system text size multiplies every font, and nothing capped
 * it: the tab bar overflowed at accessibility sizes and the 44-82 pt numerals
 * broke across lines. The native twin caps chrome labels and large numerals
 * at 1.3x and lets a numeral shrink to fit its line. The web keeps the
 * browser's own text zoom and today's layout, so every prop set here is empty
 * (no `numberOfLines`, so no line-clamp or ellipsis CSS) and a width is a
 * width: spreading these on the web changes nothing in the DOM.
 */

/** The largest system text multiplier each kind of text honours (native). */
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
 * The width a layout should decide by. On the web the browser's zoom already
 * changes the CSS width, so this is the width itself.
 */
export function effectiveWidth(width: number, _fontScale: number): number {
  return width;
}

export const chromeTextProps: ChromeTextProps = Object.freeze({});
export const numeralTextProps: NumeralTextProps = Object.freeze({});
export const numeralInputProps: NumeralInputProps = Object.freeze({});
