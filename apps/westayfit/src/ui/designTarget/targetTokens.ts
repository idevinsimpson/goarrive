import { PROGRESS_GREEN } from '../brandAssets';
import { wsfTheme } from '../../theme';

/**
 * Tokens the owner's north-star boards need and the shipped kit does not have.
 *
 * WHY THESE LIVE HERE AND NOT IN ui/kit.ts YET. A target is not an approved
 * page. Putting a brighter action green and a display type tier straight into
 * the shared kit would change every screen that already imports it, before
 * anybody has looked at the target they exist for. They move into kit.ts as
 * part of implementing the page, once that page passes its visual gate.
 *
 * Read from docs/design-target/owner-north-star/OWNER-BOARD-2-after-target-
 * wsf-vision.png, not invented: the board's primary actions are a vivid green
 * that the current palette has no equivalent for (theme.ts carries no green at
 * all -- its accent is gold), and its headline numbers are far above the
 * shipped scale, which stops at 28.
 */

/** The board's primary action green. Brighter than confirmed-progress green. */
export const ACTION_GREEN = '#22C55E';
/** Its darker edge, for the pressed state and for text on pale green. */
export const ACTION_GREEN_DEEP = '#15803D';
/** A pale green wash behind a supporting panel, as on the board. */
export const ACTION_GREEN_WASH = '#E8F8EE';

/**
 * CONFIRMED PROGRESS KEEPS ITS OWN GREEN. PROGRESS_GREEN is owner-selected and
 * is what the Living WE fills with; the action green is for controls. They are
 * deliberately two tokens, so a brighter button can never quietly restate what
 * the mark is saying about the total.
 */
export { PROGRESS_GREEN };

export const NAVY = wsfTheme.colors.primary;
/** A deeper navy for the top of the hero, so the card has depth of its own. */
export const NAVY_DEEP = '#081729';
export const CREAM = wsfTheme.colors.background;
export const SURFACE = wsfTheme.colors.surface;
export const INK = wsfTheme.colors.text;
export const INK_MUTED = wsfTheme.colors.textMuted;
/** A quieter ink for the third line of a block. Contrast-checked on cream. */
export const INK_QUIET = '#6B7C93';
export const HAIRLINE = '#E6E2DA';
export const ON_NAVY = '#F7F5F0';
export const ON_NAVY_MUTED = 'rgba(247,245,240,0.76)';
export const ON_NAVY_RULE = 'rgba(247,245,240,0.16)';

/**
 * The display tier the boards need and the theme does not have. The shipped
 * scale is 28 / 18 / 16 / 13, which cannot make a shared total the largest
 * thing on a screen -- the defect the BEFORE board names as "limited visual
 * energy".
 */
export const targetType = {
  display: { fontSize: 40, lineHeight: 44, fontWeight: '900' as const, letterSpacing: -1.4 },
  h1: { fontSize: 30, lineHeight: 35, fontWeight: '800' as const, letterSpacing: -0.7 },
  h2: { fontSize: 22, lineHeight: 27, fontWeight: '800' as const, letterSpacing: -0.4 },
  h3: { fontSize: 16, lineHeight: 21, fontWeight: '800' as const },
  body: { fontSize: 14, lineHeight: 20, fontWeight: '400' as const },
  meta: { fontSize: 12.5, lineHeight: 17, fontWeight: '500' as const },
  eyebrow: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800' as const,
    letterSpacing: 1.6,
    textTransform: 'uppercase' as const,
  },
};

/**
 * Depth. theme.ts and kit.ts carry no shadow, elevation or gradient token at
 * all, which is why every surface on the current product is a bordered
 * rectangle. react-native-web maps these to box-shadow.
 */
export const targetShadow = {
  card: {
    shadowColor: '#0B1F3A',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  hero: {
    shadowColor: '#0B1F3A',
    shadowOpacity: 0.22,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 8,
  },
  action: {
    shadowColor: ACTION_GREEN_DEEP,
    shadowOpacity: 0.32,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
};

export const targetRadius = { card: 20, hero: 24, control: 16, pill: 999 };
