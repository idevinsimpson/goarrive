/**
 * INT-17 (W12-9) — A MODAL PANEL KEEPS THE SCREEN READER INSIDE IT.
 *
 * The web build's twin: `modalPanelA11y` is empty here. On the web a sheet's
 * panel already carries `aria-modal` (each site keeps its own web spread), and
 * the tab behind it is `inert`. Metro resolves `modalA11y.native.ts` on iOS
 * and Android.
 */

/** Spread on a modal panel: `accessibilityViewIsModal` on iOS, nothing elsewhere. */
export type ModalPanelA11y = Readonly<{ accessibilityViewIsModal?: boolean }>;

export const modalPanelA11y: ModalPanelA11y = Object.freeze({});
