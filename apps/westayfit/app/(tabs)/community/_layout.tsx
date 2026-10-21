import { Stack } from 'expo-router';

import { injectedRenderFault } from '../../../src/crashHarness';
import { wsfTheme } from '../../../src/theme';
import { nativeErrorBoundary } from '../../../src/ui/RouteErrorFallback';

/**
 * THE COMMUNITY TAB, AS A STACK WITH ONE SCREEN FOR NOW.
 *
 * It holds the list. The community DETAIL lives in the Home tab, because `/`
 * resolves to it and the detail is what Home is — see `(home)/_layout.tsx`.
 *
 * THE LAYOUT IS NOT DECORATIVE. Without it the router names this child
 * `community/index` rather than `community`, and `<Tabs.Screen name="community">`
 * silently misses. The build says so out loud:
 *
 *   WARN [Layout children]: No route named "community" exists in nested
 *   children: [ 'activity', 'you', '(home)', 'community/index' ]
 *
 * which is the kind of warning that scrolls past and ends up as a tab that
 * never lights. Keeping the layout keeps the tab's route name stable whatever
 * the Community tab grows later.
 */
/** INT-01. A throw in the Community tab is contained inside the Community tab. */
export const ErrorBoundary = nativeErrorBoundary('tab');

export default function CommunityTabLayout() {
  // A test build's Community-tab fault (src/crashHarness.ts); inert otherwise.
  injectedRenderFault('community-tab');
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: wsfTheme.colors.background } }}
    />
  );
}
