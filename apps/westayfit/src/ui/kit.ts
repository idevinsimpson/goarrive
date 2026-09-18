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
