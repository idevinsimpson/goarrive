# Safe-Area Guideline — iOS PWA Top Inset

## Rule

Every screen with interactive elements near the top edge MUST satisfy one of:
- (a) Render inside `<AppHeader />` (which handles the inset via `Math.max(12, insets.top)`), OR
- (b) Call `useSafeAreaInsets()` from `react-native-safe-area-context` and apply `paddingTop: Math.max(<webMinPad>, insets.top)` to the top header.

NEVER use `paddingTop: Platform.select({ web: 16 })` or similar fixed-value web fallbacks. On iPhone PWA installs the status bar is 47–59px tall and 16px puts buttons under it.

NEVER use `position: 'fixed'; top: 0` on web without `paddingTop: 'max(12px, env(safe-area-inset-top, 12px))'`. Position-fixed elements anchor to the viewport top and ignore parent layout flow, so the safe-area inset must be applied explicitly.

If a page is a full-screen overlay/modal that hides the AppHeader (e.g. WorkoutPlayer, MovementDetail), it must implement (b) directly on its top container.

## How to verify

1. Build and deploy to staging.
2. On an iPhone, open the staging URL in Safari, tap Share → Add to Home Screen.
3. Open the installed PWA. Walk every screen with a back button or top control. Verify nothing is hidden under the status bar (battery/cellular/time area).

## Background

Audit on 2026-06-05 found 16 pages + 3 overlay components broken. PR fix/pwa-safe-area-audit shipped the per-page patches and this rule.
