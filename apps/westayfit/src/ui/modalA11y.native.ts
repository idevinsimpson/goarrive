import { Platform } from 'react-native';

/**
 * INT-17 (W12-9) — A MODAL PANEL KEEPS THE SCREEN READER INSIDE IT, on iOS
 * and Android.
 *
 * `aria-modal` on a View does nothing on a phone (settled from source), so
 * VoiceOver could swipe from a sheet into the tab behind it. On iOS the panel
 * says so itself with `accessibilityViewIsModal`, and VoiceOver ignores its
 * siblings. Android has no such prop, so this is empty there: what keeps
 * TalkBack off the tab behind is the member tabs shell itself, which hides
 * its tree (`accessibilityElementsHidden` and `importantForAccessibility=
 * "no-hide-descendants"`, native only) while a MOVE sheet or a route over the
 * tabs covers it (app/(tabs)/_layout.tsx, W12-9). The web twin is empty too:
 * there each panel keeps its own `aria-modal` and the shell is `inert`.
 *
 * Its own type: a `.native` file must not import its base specifier.
 */

/** Spread on a modal panel: `accessibilityViewIsModal` on iOS, nothing elsewhere. */
export type ModalPanelA11y = Readonly<{ accessibilityViewIsModal?: boolean }>;

export const modalPanelA11y: ModalPanelA11y = Object.freeze(
  Platform.OS === 'ios' ? { accessibilityViewIsModal: true } : {},
);
