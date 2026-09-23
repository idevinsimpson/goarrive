import { Stack } from 'expo-router';

import { CREAM } from '../../../../../src/ui/kit';

/**
 * THE COMMUNITY TAB IS A STACK, NOT A SCREEN. PROTOTYPE ONLY.
 *
 * `/community` and `/community/<id>` are one destination with a detail view,
 * so the tab holds a stack: opening a community pushes within the tab, and
 * back returns to the list without leaving the tab or disturbing the other
 * three. Without this layout the router would treat `community/index` and
 * `community/[groupId]` as two separate tab entries, which is the first thing
 * a real migration has to get right.
 *
 * ONE BEHAVIOUR CHANGE IS BURIED HERE AND IT IS NOT MINE TO DECIDE. In the
 * shipping build `/community/<id>` lights up HOME, not Community
 * (`MEMBER_TABS[0].match` is `p === '/' || p.startsWith('/community/')`),
 * because Home is defined as "the community the member is in right now".
 * Under this arrangement the detail lives in the Community tab and lights up
 * Community. That is a product call, not a technical one; ARCHITECTURE.md
 * records it as an open decision for the Director together with the cost of
 * the alternative.
 */
export default function ShellNextCommunityTabLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: CREAM } }} />;
}
