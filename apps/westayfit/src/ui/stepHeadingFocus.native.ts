import { useEffect, useRef, type RefObject } from 'react';

import { focusAccessibilitySoon } from './accessibilityFocus';

/**
 * INT-17 (W12-9) — A STEP THAT REPLACES THE ONE THE MEMBER WAS ON MOVES THE
 * SCREEN READER TO ITS HEADING, on iOS and Android.
 *
 * A flow that swaps its steps in place (count → review → receipt) takes the
 * control the member pressed with the step it was on, and VoiceOver or
 * TalkBack is left on whatever comes first, or nowhere. So when `stepKey`
 * changes, the new step's heading (`heading`, the ref on its level-1 Text)
 * takes the screen reader's focus, once the change has settled
 * (src/ui/accessibilityFocus.ts). Never on the first mount: the screen's own
 * arrival is the platform's to announce. A null key is no step. A change
 * before the focus lands, or unmounting, cancels it. The web twin is a no-op.
 */
export function useStepHeadingFocus(stepKey: string | number | null | undefined, heading: RefObject<unknown>): void {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return undefined;
    }
    if (stepKey === null || stepKey === undefined) return undefined;
    return focusAccessibilitySoon(heading);
  }, [stepKey, heading]);
}
