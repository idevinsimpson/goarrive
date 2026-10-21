/**
 * MO-02 — the web build's stand-in for sheetMotionNative.tsx.
 *
 * Metro resolves this file for the web platform, so the web bundle never
 * carries the native sheet motion or the side panel's swipe (no handlers).
 * The web plays its sheets with the CSS in src/ui/sheetMotion.ts, keyed on the
 * `dataSet` the screen already passes, so here the hook returns no style and
 * the wrappers are exactly the screen's own Pressable and View, given the
 * screen's own props: the same element and the same DOM as before the swap.
 */
import { createElement, forwardRef } from 'react';
import { Pressable, View, type GestureResponderHandlers } from 'react-native';

import type { SheetPhase } from './sheetMotion';
import type { SheetMotionOptions, SheetPanelProps, SheetPart, SheetScrimProps } from './sheetMotionNative';

export type { SheetMotionOptions, SheetPanelProps, SheetPart, SheetScrimProps } from './sheetMotionNative';

export function useNativeSheetMotion(_part: SheetPart, _phase: SheetPhase, _options: SheetMotionOptions): null {
  return null;
}

// The web has no swipe on a side panel: no handlers.
const NO_HANDLERS: GestureResponderHandlers = Object.freeze({});
export function useSideSwipeToClose(_close: () => void): GestureResponderHandlers {
  return NO_HANDLERS;
}

export const SheetScrim = forwardRef<View, SheetScrimProps>(function SheetScrim(
  { phase: _phase, preference: _preference, handoff: _handoff, ...rest },
  ref,
) {
  return createElement(Pressable, { ...rest, ref });
});

export const SheetPanel = forwardRef<View, SheetPanelProps>(function SheetPanel(
  { phase: _phase, preference: _preference, handoff: _handoff, part: _part, ...rest },
  ref,
) {
  return createElement(View, { ...rest, ref });
});
