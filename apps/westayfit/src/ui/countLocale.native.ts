/**
 * INT-36 (W12-18) — THE LOCALE A COUNT IS PRINTED IN, on iOS and Android:
 * always en-US ("4,999"), whatever region the device is set to. Every count in
 * this product is a number of repetitions toward a shared goal, and the same
 * goal must read the same on every member's phone. The web twin
 * (`countLocale.ts`) keeps the browser's own locale.
 */
export const COUNT_LOCALE: string | undefined = 'en-US';
