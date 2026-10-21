import { Platform } from 'react-native';

/**
 * INT-17 (W12-9) — A MODAL PANEL KEEPS THE SCREEN READER INSIDE IT, on iOS
 * and Android.
 *
 * `aria-modal` on a View does nothing on a phone (settled from source), so
 * VoiceOver could swipe from a sheet into the tab behind it. On iOS the panel
 * says so itself with `accessibilityViewIsModal`, and VoiceOver ignores its
 * siblings. Android has no such prop: there the screen behind is hidden from
 * TalkBack by the shell (`importantForAccessibility="no-hide-descendants"`,
 * the integrator's tabs layout), so this is empty. The web twin is empty too.
 *
 * Its own type: a `.native` file must not import its base specifier.
 */

/** Spread on a modal panel: `accessibilityViewIsModal` on iOS, nothing elsewhere. */
export type ModalPanelA11y = Readonly<{ accessibilityViewIsModal?: boolean }>;

export const modalPanelA11y: ModalPanelA11y = Object.freeze(
  Platform.OS === 'ios' ? { accessibilityViewIsModal: true } : {},
);
