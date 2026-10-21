import { Platform, type ViewStyle } from 'react-native';

/**
 * INT-21 / INT-31 (W12-15) — LIFT THAT SURVIVES ON A PHONE.
 *
 * iOS clips `shadow*` props on a view with `overflow: hidden` (the Settings
 * panel, the MOVE and contribution panels), and Android draws no shadow from
 * them at all. These tokens give the lift each platform can actually draw:
 *   · panel — a side or bottom panel over the dimmed screen: on iOS a
 *     `boxShadow` (drawn outside the clip; the Settings panel's own shadow,
 *     #081D36 at 30%, 20 pt down, 30 pt blur), on Android elevation 12;
 *   · tabBar — the bottom bar: on Android an upward `boxShadow`, because
 *     elevation can only cast downward; iOS keeps the bar's own shadow;
 *   · knob — a switch knob: on Android elevation 2.
 * The web gets `{}` for each: its surfaces keep their own styles, unchanged.
 * kit.ts's `elevation.*` is not touched here (the integrator re-exports these
 * from kit and moves `elevation.*` later).
 */
export type LiftTokens = Readonly<{
  panel: Readonly<ViewStyle>;
  tabBar: Readonly<ViewStyle>;
  knob: Readonly<ViewStyle>;
}>;

export const PANEL_BOX_SHADOW_IOS = '0px 20px 30px rgba(8,29,54,0.3)';
export const TAB_BAR_BOX_SHADOW_ANDROID = '0px -4px 14px rgba(11,31,53,0.06)';

export const lift: LiftTokens = Object.freeze({
  panel: Object.freeze(
    Platform.select<ViewStyle>({
      ios: { boxShadow: PANEL_BOX_SHADOW_IOS },
      android: { elevation: 12 },
      default: {},
    }),
  ),
  tabBar: Object.freeze(Platform.select<ViewStyle>({ android: { boxShadow: TAB_BAR_BOX_SHADOW_ANDROID }, default: {} })),
  knob: Object.freeze(Platform.select<ViewStyle>({ android: { elevation: 2 }, default: {} })),
});
