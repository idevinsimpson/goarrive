import { useNavigation } from 'expo-router';
import { useEffect, type RefObject } from 'react';

import { focusAccessibilitySoon, type FocusableRef } from './accessibilityFocus';

/**
 * INT-17 (W12-9) — FOCUS GOES BACK TO WHERE THE MEMBER WAS, on iOS and Android.
 *
 * The web twin (`focusReturn.ts`) puts keyboard focus back on the control
 * that opened MOVE, the contribution flow or Settings when that flow closes;
 * off the web it did nothing at all. This is the same set of exports for a
 * phone, where the screen reader's focus is what goes back:
 *
 *   · A control that can take focus back REGISTERS itself by its testID
 *     (`registerFocusTarget(testId, ref)`, typically in an effect that returns
 *     the unregister function). Nothing else is ever focused.
 *   · Opening a flow ARMS the return. `armTabsFocusReturnTo(testId)` names the
 *     opener (the top bar's menu item names the menu button, which is still
 *     there when Settings closes). With nothing named, MOVE's resolver covering
 *     the tabs means its opener is the tab bar's MOVE button. A phone has no
 *     record of where a pointer or keyboard was, so there is no other guess.
 *   · Closing the flow RETURNS focus to that opener when it is registered and
 *     still mounted: after the navigation finishes, and on iOS about 400 ms
 *     later (src/ui/accessibilityFocus.ts). Covered again first, unmounted
 *     first, or a newer return asked for: the pending one is cancelled.
 *
 * NOTHING REGISTERED, NOTHING HAPPENS. Merging this changes which module a
 * phone loads before any site registers a target, so with no registered
 * target every export is a strict no-op: no focus call, no interaction task,
 * no timer.
 *
 * Its own types: a `.native` file must not import its base specifier, which
 * on a phone is itself. `returnFocusSoon` keeps the web signature; it reads
 * the opener's testID and ignores the web-only root and fallbacks.
 */

/** Who opened a flow: on a phone, only its testID is known. */
export type Opener = { node: unknown; testId: string | null };

type Fallback = { selector: string; afterMs?: number };

/** The root-stack routes whose closing returns focus to the tabs. */
const FLOW_ROUTES = new Set(['move/index', 'contribute/[goalId]', 'settings']);
/** With nothing named, the opener a covering route implies. */
const DEFAULT_OPENER: Record<string, string> = { 'move/index': 'wsf-member-tab-move' };
/** The sheet's fallback, as on the web: its own Close. */
const SHEET_FALLBACK = 'wsf-move-close';

const targets = new Map<string, FocusableRef>();

/**
 * A control that can take focus back, by its testID. Returns the unregister
 * function (it only removes this registration, not a newer one).
 */
export function registerFocusTarget(testId: string, ref: FocusableRef): () => void {
  targets.set(testId, ref);
  return () => {
    if (targets.get(testId) === ref) targets.delete(testId);
  };
}

const NOTHING = () => {};

/** Focus the registered target for `testId` soon; a no-op when none is registered. */
function focusTarget(testId: string | null | undefined): () => void {
  const ref = testId ? targets.get(testId) : undefined;
  if (!ref) return NOTHING;
  return focusAccessibilitySoon(ref);
}

/**
 * Put the screen reader's focus back on `opener` (by its testID) once the
 * closing flow has gone. The web's root and fallbacks have no meaning here.
 */
export function returnFocusSoon(
  _root: () => unknown,
  opener: Opener | null,
  _fallbacks: Fallback[],
): () => void {
  return focusTarget(opener?.testId);
}

/** Armed across mounts, as on the web; on a phone it holds a testID or nothing. */
let armed: Opener | null = null;
let named: Opener | null = null;

/** A flow that leaves by replacing itself: there is no opener to return to. */
export function armTabsFocusReturn(): void {
  armed = armed ?? { node: null, testId: null };
}

/** Names the control focus comes back to when the next flow over the tabs closes. */
export function armTabsFocusReturnTo(testId: string): void {
  named = { node: null, testId };
}

type Navigation = {
  addListener: (event: 'blur' | 'focus', cb: () => void) => () => void;
  getState: () => { index?: number; routes?: Array<{ name?: string }> } | undefined;
};

/** The member tabs' half: the shell sees a flow cover it and uncover it. */
export function useTabsFocusReturn(_container: RefObject<unknown>): void {
  const navigation = useNavigation() as unknown as Navigation;
  useEffect(() => {
    let cancel: () => void = NOTHING;
    const covering = (): string | null => {
      const s = navigation.getState();
      const top = s?.routes?.[s.index ?? 0]?.name ?? null;
      return top && FLOW_ROUTES.has(top) ? top : null;
    };
    const offBlur = navigation.addListener('blur', () => {
      cancel();
      cancel = NOTHING;
      const flow = covering();
      const implied = flow && DEFAULT_OPENER[flow] ? { node: null, testId: DEFAULT_OPENER[flow]! } : null;
      armed = flow ? (named ?? implied) : null;
      named = null;
    });
    const offFocus = navigation.addListener('focus', () => {
      const opener = armed;
      armed = null;
      cancel();
      cancel = focusTarget(opener?.testId);
    });
    // Mounting after a flow that replaced the tabs: its opener went with them.
    if (armed) {
      const opener = armed;
      armed = null;
      cancel = focusTarget(opener.testId);
    }
    return () => {
      cancel();
      offBlur();
      offFocus();
    };
  }, [navigation]);
}

/**
 * The MOVE sheet's half: a goal chosen in the sheet opens the contribution
 * flow over it, and Back returns to the sheet. Focus goes back to the named
 * opener, or to the sheet's Close.
 */
export function useSheetFocusReturn(_container: RefObject<unknown>): void {
  const navigation = useNavigation() as unknown as Navigation;
  useEffect(() => {
    let opener: Opener | null = null;
    let cancel: () => void = NOTHING;
    const offBlur = navigation.addListener('blur', () => {
      cancel();
      cancel = NOTHING;
      opener = named ?? { node: null, testId: SHEET_FALLBACK };
      named = null;
    });
    const offFocus = navigation.addListener('focus', () => {
      if (!opener) return;
      const o = opener;
      opener = null;
      cancel();
      cancel = targets.has(o.testId ?? '') ? focusTarget(o.testId) : focusTarget(SHEET_FALLBACK);
    });
    return () => {
      cancel();
      offBlur();
      offFocus();
    };
  }, [navigation]);
}
