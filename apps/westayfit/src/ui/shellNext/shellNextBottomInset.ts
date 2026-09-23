import { MEMBER_TAB_BAR_BODY, MEMBER_TAB_MOVE_OVERHANG } from '../MemberTabBar';

/**
 * THE BOTTOM FOOTPRINT, TAKEN FROM THE SHIPPING BAR RATHER THAN RETYPED.
 * PROTOTYPE ONLY.
 *
 * "One bottom-bar footprint across member tabs" is provable this way rather
 * than asserted: if the production numbers move, the prototype moves with them
 * and any capture taken from it is still honest about how much room the bar
 * takes. Two copies of a number are two numbers, and one of them goes stale.
 *
 * Separate from `shellNextMetrics.ts` because importing `MemberTabBar` pulls
 * in expo-router, which the repository's vitest setup cannot transform — see
 * the note in that file.
 */
export const SHELL_BOTTOM_BAR_BODY = MEMBER_TAB_BAR_BODY;
export const SHELL_MOVE_OVERHANG = MEMBER_TAB_MOVE_OVERHANG;

/**
 * What the bottom bar occludes, for a page that wants its last control to stay
 * reachable. The caller adds the live safe-area bottom inset.
 */
export const SHELL_BOTTOM_INSET = SHELL_BOTTOM_BAR_BODY + SHELL_MOVE_OVERHANG;
