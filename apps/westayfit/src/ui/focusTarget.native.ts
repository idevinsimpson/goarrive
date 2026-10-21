/**
 * INT-17 (W12-9, W14-K3) — on iOS and Android, the focus-target registry and
 * "focus this soon" are exactly the native modules':
 *   · `registerFocusTarget` is focusReturn.native.ts's, so a control
 *     registered here is the one a closing flow returns focus to (one module,
 *     one registry, however it is reached);
 *   · `focusSoon` is accessibilityFocus.ts's `focusAccessibilitySoon` (after
 *     the navigation settles, and about 400 ms on iOS; cancellable).
 * The specifier is the explicit `./focusReturn.native`, so the web type check
 * (which resolves a bare `./focusReturn` to the web module) sees the native
 * registry too; it is not this file's own base specifier (NATIVE-TSC-1). The
 * web twin (`focusTarget.ts`) is strict no-ops.
 */
export { registerFocusTarget } from './focusReturn.native';
export { focusAccessibilitySoon as focusSoon } from './accessibilityFocus';

/** Anything with a `current` (a React ref). */
export type FocusTargetRef = { readonly current: unknown };
