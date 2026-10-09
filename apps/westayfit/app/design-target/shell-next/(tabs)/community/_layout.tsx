import { Stack } from 'expo-router';

import { CREAM } from '../../../../../src/ui/kit';

/**
 * THE COMMUNITY TAB, AS A STACK WITH ONE SCREEN FOR NOW. PROTOTYPE ONLY.
 *
 * It holds only the list: the community DETAIL lives in the Home tab, because
 * in the shipping build `/` resolves to `/community/<id>` and the detail is
 * what Home *is*. See `(home)/_layout.tsx`.
 *
 * THE LAYOUT IS NOT DECORATIVE. Without it the router names this child
 * `community/index` rather than `community`, and `<Tabs.Screen name="community">`
 * silently misses — the build says so out loud:
 *
 *   WARN [Layout children]: No route named "community" exists in nested
 *   children: [ 'activity', 'you', '(home)', 'community/index' ]
 *
 * which is the kind of warning that is easy to scroll past and ends up as a
 * tab that never lights. Keeping the layout keeps the tab's route name stable
 * whatever the Community tab grows later.
 */
export default function ShellNextCommunityTabLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: CREAM } }} />;
}
