import { Stack } from 'expo-router';

import { wsfTheme } from '../../../src/theme';

/**
 * THE HOME TAB IS A STACK, AND IT OWNS THE COMMUNITY DETAIL.
 *
 * THIS IS NOT A PREFERENCE. `index.tsx` does not render a page of its own for
 * a member who has a community: it resolves one and calls
 * `router.replace('/community/<id>')`. The community detail IS what Home is,
 * which is why `MEMBER_TABS[0].match` is
 * `p === '/' || p.startsWith('/community/')` — Home stays lit on the detail
 * because the member never left Home.
 *
 * So under a tab navigator the detail has to live in THIS tab. Putting it in
 * the Community tab — the obvious first arrangement, and the one the prototype
 * started with — means Home's own redirect throws the member into a different
 * tab on arrival: they press Home and end up with Community lit. That is not a
 * styling detail; it is the Home tab failing to be a destination.
 *
 * `challenge.tsx` and `members.tsx` sit here for the same reason: they are
 * children of the detail, reached from the community the member is in.
 */
export default function HomeTabLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: wsfTheme.colors.background } }}
    />
  );
}
