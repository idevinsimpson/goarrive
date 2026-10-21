import type { ScreenTone } from './statusBarPolicy';

/**
 * NATIVE-INTEGRATOR-1 (INT-09). THE TOP OF A ROOT-STACK SCREEN, ON WEB.
 *
 * The browser's own chrome owns the status area, so a web page starts at 0
 * and draws nothing for it: every export here is inert, and the web DOM is
 * exactly what it was. iOS and Android get src/ui/useScreenTopInset.native.tsx.
 */
export type { ScreenTone };

/** The top safe-area inset a root-stack screen must clear: always 0 on web. */
export function useScreenTopInset(): number {
  return 0;
}

/** A spacer the height of the top inset, for a screen's first child: nothing on web. */
export function ScreenTopSpacer(): null {
  return null;
}

/** The status-bar icons for the focused screen: nothing on web. */
export function ScreenStatusBar(_props: { tone: ScreenTone }): null {
  return null;
}
