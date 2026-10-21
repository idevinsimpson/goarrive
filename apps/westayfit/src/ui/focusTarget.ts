/**
 * INT-17 (W12-9, W14-K3) — A CONTROL THAT CAN TAKE FOCUS BACK, AND "FOCUS
 * THIS SOON", for the shared files that need them (MemberTabBar,
 * MemberTopBar).
 *
 * The web build's twin: both are strict no-ops. On the web, focus return is
 * src/ui/focusReturn.ts's own work (it finds the opener in the document), and
 * that file stays byte-identical; a shared file cannot import the native
 * registry from it, because `./focusReturn` is the web module there. Metro
 * resolves `focusTarget.native.ts` on iOS and Android, which is the native
 * registry and focus helper themselves.
 */

/** Anything with a `current` (a React ref). */
export type FocusTargetRef = { readonly current: unknown };

const NOTHING = () => {};

/** Native: register `ref` as the control `testId` names. Web: nothing. Returns the unregister function. */
export function registerFocusTarget(_testId: string, _ref: FocusTargetRef): () => void {
  return NOTHING;
}

/** Native: move the screen reader's focus to `ref` soon. Web: nothing. Returns the cancel function. */
export function focusSoon(_ref: FocusTargetRef): () => void {
  return NOTHING;
}
