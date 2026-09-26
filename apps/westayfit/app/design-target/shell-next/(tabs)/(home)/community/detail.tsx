import { useLocalSearchParams } from 'expo-router';

import { ShellNextPage } from '../../../../../../src/ui/shellNext/ShellNextPage';

/**
 * Stands for production `/community/[groupId]`. PROTOTYPE ONLY.
 *
 * WHY THIS IS A STATIC ROUTE WITH A QUERY PARAMETER RATHER THAN `[groupId]`.
 *
 * The repository's web build refuses to emit a dynamic route that has no
 * `__dynamic` rewrite in the hosting config, because without one a direct load
 * or a refresh of that URL returns 404. Production's own families are all
 * covered — `/community/**`, `/move/**`, `/kiosk/**` and the rest — but there
 * is no rewrite for `/design-target/**`, and the hosting config is not in this
 * packet's reservation. The prototype is parked in a namespace the rewrites do
 * not reach, so it uses a static path and carries the id in the query.
 *
 * IT COSTS THE EVIDENCE NOTHING. A route group and a dynamic segment are
 * orthogonal in Expo Router: `(tabs)` is erased from the URL whatever the
 * segment after it looks like, and a screen's position in a tab's stack is
 * decided by which directory the file is in, not by whether its name has
 * brackets. What this frame has to demonstrate — that a detail screen nested
 * in the Community tab pushes WITHIN that tab, leaves the other tabs mounted,
 * and comes back on Back — is demonstrated identically either way. The gain is
 * that every prototype URL is now statically exported, so the deep-link checks
 * can all be cold loads instead of one of them being reached in-app.
 *
 * In production nothing about this arises: `/community/[groupId]` keeps its
 * brackets, keeps its existing rewrite, and keeps its URL.
 */
export default function ShellNextCommunityDetail() {
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();
  return (
    <ShellNextPage
      id="community-detail"
      title="A community"
      lede={`Stands in for /community/${groupId ?? '<groupId>'} — pushed inside the Community tab.`}
    />
  );
}
