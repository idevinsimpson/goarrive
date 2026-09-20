import { StyleSheet } from 'react-native';

import { wsfTheme } from '../theme';
import { PROGRESS_GREEN } from './brandAssets';

/**
 * The shared visual language: the tokens and styles that Community Home,
 * Contribute, Display and Kiosk already use, lifted into one place so every
 * other screen renders the same way. Screens import `kit` and compose from
 * these names; a per-screen StyleSheet is for layout only that screen needs.
 *
 * Nothing here suppresses a focus outline, animates, or sets a fixed width.
 */

export const NAVY = wsfTheme.colors.primary;
export const CREAM = wsfTheme.colors.background;
export const SURFACE = wsfTheme.colors.surface;
export const CARD_BORDER = '#E3E7E1';
// Cream at reduced strength on the navy hero: still well above 4.5:1.
export const HERO_MUTED = 'rgba(247,245,240,0.78)';
export const HERO_RULE = 'rgba(247,245,240,0.35)';
export { PROGRESS_GREEN };
// Contrast-checked at rgb(90,107,133); placeholders use it too. Do not change.
export const TEXT_MUTED = wsfTheme.colors.textMuted;
export const ERROR_RED = '#B4232C';
export const SAMPLE_TINT = '#FBF1D3';
// Faint navy wash behind a selected option row; navy text stays readable on it.
export const OPTION_SELECTED_TINT = '#EEF2F6';

/* ==========================================================================
   THE NORTH-STAR GRAMMAR
   --------------------------------------------------------------------------
   Promoted here from the Home design target once that target was approved, so
   every screen that follows speaks the same visual language instead of each
   one re-inventing it. Read off the owner's boards in
   docs/design-target/owner-north-star/, not invented.

   The three things this product's token set did not have and the boards
   require: a brighter green for ACTION, a type tier above 32 for the numbers
   that carry a screen, and any depth at all.
   ========================================================================== */

/**
 * The action green. Brighter than confirmed-progress green, and deliberately
 * a SEPARATE token from it: a button must never be able to restate what the
 * Living WE is saying about the shared total.
 */
export const ACTION_GREEN = '#22C55E';
/** Its darker edge — for text on pale green, and for a pressed state. */
export const ACTION_GREEN_DEEP = '#15803D';
/** Ink on a filled action. Near-black green, not pure black. */
export const ON_ACTION = '#04260F';

/** A deeper navy than the hero's, for a ground the hero can sit on. */
export const NAVY_DEEP = '#081729';
/** A third ink, quieter than TEXT_MUTED. Contrast-checked on cream. */
export const INK_QUIET = '#6B7C93';
/** The hairline this product uses between rows and around raised surfaces. */
export const HAIRLINE = '#E6E2DA';
/** Cream on navy, and the rule that separates blocks inside a navy surface. */
export const ON_NAVY = CREAM;
export const ON_NAVY_MUTED = 'rgba(247,245,240,0.76)';
export const ON_NAVY_RULE = 'rgba(247,245,240,0.16)';

/**
 * THE DISPLAY TIER. theme.ts stops at 28 and this kit at 32, which cannot make
 * a community's shared total the largest thing on its own screen — the defect
 * the owner's BEFORE board names as "limited visual energy".
 */
export const display = {
  xl: { fontSize: 40, lineHeight: 44, fontWeight: '900' as const, letterSpacing: -1.4 },
  lg: { fontSize: 34, lineHeight: 38, fontWeight: '900' as const, letterSpacing: -1.2 },
  md: { fontSize: 29, lineHeight: 33, fontWeight: '900' as const, letterSpacing: -1 },
};

/**
 * DEPTH. There was none: no shadow, elevation or gradient token anywhere, which
 * is why every surface in this product is a bordered rectangle.
 * react-native-web maps these to box-shadow.
 */
export const elevation = {
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

export const kit = StyleSheet.create({
  // ---- page ----
  scroll: { flex: 1, backgroundColor: CREAM },
  page: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 48,
  },
  column: { maxWidth: 640, width: '100%', gap: 18 },
  columnNarrow: { maxWidth: 560, width: '100%', gap: 18 },

  // ---- chrome: wordmark on the left, at most one quiet control on the right ----
  chrome: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  chromeLink: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  chromeLinkText: { color: NAVY, fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },

  // ---- type ----
  eyebrow: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  eyebrowOnNavy: {
    color: PROGRESS_GREEN,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  heading: {
    color: NAVY,
    fontSize: 32,
    fontWeight: '800',
    lineHeight: 38,
    letterSpacing: -0.5,
  },
  headingCompact: {
    color: NAVY,
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 32,
    letterSpacing: -0.3,
  },
  intro: { color: TEXT_MUTED, fontSize: 17, lineHeight: 24 },
  body: { color: NAVY, fontSize: 16, lineHeight: 22 },
  caption: { color: TEXT_MUTED, fontSize: 13, lineHeight: 18 },
  errorText: { color: ERROR_RED, fontSize: 15, lineHeight: 21 },
  statusText: { color: TEXT_MUTED, fontSize: 15, lineHeight: 21 },

  // ---- hero: navy surface, cream type, green for the one accent ----
  hero: {
    backgroundColor: NAVY,
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 22,
    gap: 10,
  },
  heroTitle: {
    color: CREAM,
    fontSize: 27,
    fontWeight: '800',
    lineHeight: 33,
    letterSpacing: -0.3,
  },
  heroBody: { color: CREAM, fontSize: 16, lineHeight: 22 },
  heroMeta: { color: HERO_MUTED, fontSize: 15, lineHeight: 20 },

  // ---- cards: light, quieter than the hero ----
  card: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  cardQuiet: {
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderRadius: 16,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  cardTitle: { color: NAVY, fontSize: 18, fontWeight: '700', lineHeight: 24 },
  cardMeta: { color: TEXT_MUTED, fontSize: 14, lineHeight: 20 },

  // ---- buttons ----
  primaryButton: {
    backgroundColor: PROGRESS_GREEN,
    borderRadius: 14,
    minHeight: 54,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: NAVY, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  primaryButtonDisabled: { opacity: 0.6 },
  secondaryButton: {
    backgroundColor: SURFACE,
    borderWidth: 1.5,
    borderColor: NAVY,
    borderRadius: 14,
    minHeight: 48,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { color: NAVY, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  secondaryButtonOnNavy: {
    borderWidth: 1.5,
    borderColor: HERO_RULE,
    borderRadius: 14,
    minHeight: 48,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonOnNavyText: { color: CREAM, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  tertiaryButton: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 4,
  },
  tertiaryButtonText: { color: NAVY, fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },

  // ---- choice pills ----
  pill: {
    borderWidth: 1.5,
    borderColor: CARD_BORDER,
    backgroundColor: SURFACE,
    borderRadius: 999,
    minHeight: 44,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  pillSelected: { borderColor: NAVY, backgroundColor: NAVY },
  pillText: { color: NAVY, fontSize: 15, fontWeight: '700' },
  pillTextSelected: { color: CREAM },

  // ---- option rows: one decision per row (see src/ui/OptionRow.tsx) ----
  // The selected look is a navy border on a faint navy tint, never a navy
  // fill: the label stays navy-on-light in both states and the leading radio
  // indicator carries the selection for anyone who cannot rely on colour.
  optionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    width: '100%',
    backgroundColor: SURFACE,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: CARD_BORDER,
    minHeight: 56,
    padding: 14,
  },
  optionRowSelected: { borderColor: NAVY, backgroundColor: OPTION_SELECTED_TINT },
  optionIndicator: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionIndicatorDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: NAVY },
  optionLabel: { color: NAVY, fontSize: 16, fontWeight: '700', lineHeight: 22 },
  optionDescription: { color: TEXT_MUTED, fontSize: 14, lineHeight: 20 },

  // ---- fields ----
  fieldLabel: { color: NAVY, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 },
  input: {
    borderWidth: 1.5,
    borderColor: CARD_BORDER,
    backgroundColor: SURFACE,
    borderRadius: 14,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 17,
    color: NAVY,
  },

  // ---- label/value rows: the value wraps under the label when narrow ----
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6,
  },
  rowLabel: { color: TEXT_MUTED, fontSize: 15, flexShrink: 1, minWidth: 0 },
  rowValue: {
    color: NAVY,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'right',
    flexShrink: 1,
    minWidth: 0,
    marginLeft: 'auto',
  },

  // ---- footer and badge ----
  footer: { alignItems: 'center', paddingTop: 8 },
  badge: {
    color: NAVY,
    backgroundColor: SAMPLE_TINT,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
  },
});
