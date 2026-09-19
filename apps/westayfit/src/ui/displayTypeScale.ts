/**
 * LENGTH-TIERED TYPE SCALE FOR THE PUBLIC DISPLAY.
 *
 * The display has no scroll: the wide layout is a fixed two-column canvas and
 * the phone layout is a single unscrollable page. A long community name, goal
 * title or unit therefore does not push the page down, it grows the column
 * past the viewport and the overflow is clipped — symmetrically on the wide
 * layout, because the body centres its rows, so the first line of a heading
 * can be cut off the top of the screen.
 *
 * These are pure functions of the strings the SERVER confirmed. Nothing here
 * measures the DOM, so the size is the same on every render and on the
 * statically exported page, and nothing depends on the viewport beyond the
 * layout the display already chose.
 *
 * THE FIRST TIER OF EVERY SCALE IS THE APPROVED SIZE, byte for byte. A string
 * short enough to have been reviewed gets exactly what the owner reviewed;
 * only strings longer than anything on the approved surfaces step down.
 */

export type DisplayLayout = 'wide' | 'phone';

/** A text style fragment, applied AFTER the stylesheet entry it refines. */
export type DisplayTitleType = { fontSize: number; lineHeight: number };
export type DisplayCommunityType = { fontSize: number; letterSpacing: number };

type Tier<T> = { maxChars: number; wide: T; phone: T };

function pick<T>(tiers: Tier<T>[], text: string, layout: DisplayLayout): T {
  const len = [...(text ?? '')].length;
  const tier = tiers.find((t) => len <= t.maxChars) ?? tiers[tiers.length - 1];
  return layout === 'wide' ? tier.wide : tier.phone;
}

// Line heights below the first tier are ≈1.12× the size: tight enough that a
// heading that has to wrap does not spend the column on leading.
const TITLE_TIERS: Tier<DisplayTitleType>[] = [
  // Approved: styles.goalTitle / styles.goalTitleWide.
  { maxChars: 40, wide: { fontSize: 68, lineHeight: 76 }, phone: { fontSize: 30, lineHeight: 36 } },
  { maxChars: 70, wide: { fontSize: 56, lineHeight: 63 }, phone: { fontSize: 26, lineHeight: 29 } },
  { maxChars: 95, wide: { fontSize: 46, lineHeight: 52 }, phone: { fontSize: 22, lineHeight: 25 } },
  { maxChars: Infinity, wide: { fontSize: 38, lineHeight: 43 }, phone: { fontSize: 20, lineHeight: 22 } },
];

// The community name is uppercase and letterspaced, so its tracking costs as
// much width as a whole extra character every few letters; a step down takes
// the tracking with it.
const COMMUNITY_TIERS: Tier<DisplayCommunityType>[] = [
  // Approved: styles.community / styles.communityWide.
  { maxChars: 45, wide: { fontSize: 30, letterSpacing: 2 }, phone: { fontSize: 15, letterSpacing: 1.2 } },
  { maxChars: 80, wide: { fontSize: 24, letterSpacing: 1.4 }, phone: { fontSize: 13, letterSpacing: 1 } },
  { maxChars: Infinity, wide: { fontSize: 20, letterSpacing: 1 }, phone: { fontSize: 12, letterSpacing: 0.8 } },
];

// The result line carries the unit, which the goal's author writes. It is
// measured on the WHOLE composed line, because that is what has to fit.
const TOTAL_TIERS: Tier<DisplayTitleType>[] = [
  // Approved: styles.total / styles.totalWide (the phone size has no line
  // height of its own; 36 is what 30 px System resolves to).
  { maxChars: 36, wide: { fontSize: 64, lineHeight: 72 }, phone: { fontSize: 30, lineHeight: 36 } },
  { maxChars: 60, wide: { fontSize: 48, lineHeight: 54 }, phone: { fontSize: 26, lineHeight: 30 } },
  { maxChars: Infinity, wide: { fontSize: 38, lineHeight: 43 }, phone: { fontSize: 22, lineHeight: 26 } },
];

/** Size for `wsf-display-goal-title`, from the confirmed goal title. */
export function goalTitleType(title: string, layout: DisplayLayout): DisplayTitleType {
  return pick(TITLE_TIERS, title, layout);
}

/** Size for `wsf-display-community`, from the confirmed community name. */
export function communityNameType(name: string, layout: DisplayLayout): DisplayCommunityType {
  return pick(COMMUNITY_TIERS, name, layout);
}

/** Size for `wsf-display-total-line`, from the whole composed result line. */
export function totalLineType(line: string, layout: DisplayLayout): DisplayTitleType {
  return pick(TOTAL_TIERS, line, layout);
}
