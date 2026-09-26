import {
  ACTION_GREEN,
  ACTION_GREEN_DEEP,
  CARD_BORDER,
  CREAM,
  HAIRLINE,
  INK_QUIET,
  NAVY,
  NAVY_DEEP,
  ON_ACTION,
  ON_NAVY,
  ON_NAVY_MUTED,
  ON_NAVY_RULE,
  PROGRESS_GREEN,
  SURFACE,
  TEXT_MUTED,
  display,
  elevation,
} from '../kit';
import { wsfTheme } from '../../theme';

/**
 * The target's tokens ARE the kit's tokens.
 *
 * They used to live here, deliberately outside the shared kit, so that an
 * unapproved target could not move an approved screen. The Home target was
 * approved and its grammar promoted into ui/kit.ts, so this file is now a
 * re-export and nothing more. Keeping it means the target components need no
 * edit, and — the part that matters — the target and the product can never
 * drift apart while both exist, because there is only one set of values.
 */

export {
  ACTION_GREEN,
  ACTION_GREEN_DEEP,
  CREAM,
  HAIRLINE,
  INK_QUIET,
  NAVY,
  NAVY_DEEP,
  ON_ACTION,
  ON_NAVY,
  ON_NAVY_MUTED,
  ON_NAVY_RULE,
  PROGRESS_GREEN,
  SURFACE,
};

export const ACTION_GREEN_WASH = '#E8F8EE';
export const INK = wsfTheme.colors.text;
export const INK_MUTED = TEXT_MUTED;

export const targetType = {
  display: display.xl,
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

export const targetShadow = elevation;
export const targetRadius = { card: 20, hero: 24, control: 16, pill: 999 };

// Referenced by the kit's own card styles; re-exported so a target component
// that composes with them does not have to import from two places.
export { CARD_BORDER };
