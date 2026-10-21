import type { ComponentType } from 'react';
import { View, type ViewProps } from 'react-native';

/**
 * NATIVE-INTEGRATOR-1 (INT-06, INT-07). THE WEB BUILD DOES NOTHING ABOUT THE
 * KEYBOARD: mobile browsers already pan the focused input into view, and
 * react-native-web has no keyboard events. iOS and Android get
 * src/ui/keyboardAvoidance.native.tsx. Every export here is inert, so the web
 * DOM is exactly what it was and none of the native handling ships in the web
 * bundle.
 */

export const KEYBOARD_SCROLL_PROPS: { automaticallyAdjustKeyboardInsets?: boolean } = {};

export const SHEET_DISMISS_PROPS: { keyboardDismissMode?: 'interactive' | 'on-drag' } = {};

export const AndroidKeyboardInsetView: ComponentType<ViewProps> = View;

export const KeyboardInsetView: ComponentType<ViewProps> = View;

export function useKeyboardHeight(): number {
  return 0;
}

export function sheetBottomPadding(safeBottom: number, _keyboard: number, _platform?: string, gap = 8): number {
  return safeBottom + gap;
}
