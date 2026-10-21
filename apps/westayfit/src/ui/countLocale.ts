/**
 * INT-36 (W12-18) — THE LOCALE A COUNT IS PRINTED IN.
 *
 * The web build's twin: undefined, so a count follows the browser's own
 * locale, as it always has. Metro resolves `countLocale.native.ts` on iOS and
 * Android, where counts are always en-US: a phone set to Germany printed
 * 4,999 squats as "4.999", which reads as four point nine.
 */
export const COUNT_LOCALE: string | undefined = undefined;
