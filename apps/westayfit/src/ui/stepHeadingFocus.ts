import type { RefObject } from 'react';

/**
 * INT-17 (W12-9) — A STEP THAT REPLACES THE ONE THE MEMBER WAS ON MOVES THE
 * SCREEN READER TO ITS HEADING.
 *
 * The web build's twin: a no-op. On the web the sheet's focus containment
 * already does this (src/ui/sheetMotion.ts, `useSheetFocusContainment`'s
 * `stage`: focus goes to the new step's level-1 heading when the old step
 * took it away). Metro resolves `stepHeadingFocus.native.ts` on iOS and
 * Android.
 */
export function useStepHeadingFocus(_stepKey: string | number | null | undefined, _heading: RefObject<unknown>): void {}
