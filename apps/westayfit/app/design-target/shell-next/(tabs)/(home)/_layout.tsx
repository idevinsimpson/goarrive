import { Stack } from 'expo-router';

import { CREAM } from '../../../../../src/ui/kit';

/**
 * THE HOME TAB IS A STACK, AND IT OWNS THE COMMUNITY DETAIL. PROTOTYPE ONLY.
 *
 * THIS IS NOT A PREFERENCE. In the shipping build `/` does not render a page
 * of its own for a member who has a community: `app/index.tsx` resolves the
 * member's current community and calls `router.replace('/community/<id>')`.
 * The community detail IS what Home is, which is why `MEMBER_TABS[0].match` is
 * `p === '/' || p.startsWith('/community/')` — Home stays lit on the detail
 * because the member never left Home.
 *
 * So under a tab navigator the detail has to live in THIS tab. Putting it in
 * the Community tab, which was the obvious first arrangement and the one this
 * prototype started with, means Home's own redirect throws the member into a
 * different tab on arrival — a member who taps Home ends up with Community
 * lit. That is not a styling detail; it is the Home tab failing to be a
 * destination.
 *
 * WHICH SETS UP THE ONE QUESTION THIS PROTOTYPE EXISTS TO ANSWER: `/community`
 * belongs to the Community tab and `/community/<id>` belongs to this one, so
 * two sibling URLs are served by two different tabs. Whether Expo Router
 * resolves that unambiguously is a fact about the router, not an opinion, and
 * `sprint-w9-shell-nav.spec.ts` asks it directly.
 */
export default function ShellNextHomeTabLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: CREAM } }} />;
}
