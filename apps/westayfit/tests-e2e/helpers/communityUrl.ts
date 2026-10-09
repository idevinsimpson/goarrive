import { expect } from '@playwright/test';

/**
 * THE COMMUNITY ADDRESS, ASSERTED PRECISELY RATHER THAN WIDENED.
 *
 * Opening a community from the Community tab lands on
 * `/community/<id>?groupId=<id>`; opening the same community from Home lands on
 * `/community/<id>`. The difference is an Expo Router serialisation seam, not a
 * product decision: entering a tab-nested route from OUTSIDE its tab leaves the
 * navigate payload on the tab route, and `getPathFromState` writes the leftover
 * out as a query. Four call-site shapes were built and measured and all four
 * produce it; the tidy-up that clears the payload was built, shipped into a
 * real build, and reverted because it sent the member to the Home tab's index
 * instead of the community they had just chosen.
 *
 * The Director's ruling (`5795072805`) is to accept it as a known migration
 * seam and to keep a NARROW regression rather than a relaxed one. So this is
 * not "the URL contains the id somewhere". It is:
 *
 *   - the pathname is EXACTLY `/community/<id>`;
 *   - the only query parameter that may appear at all is `groupId`;
 *   - and its value is the SAME id as the path segment — a redundant copy,
 *     never a second community and never a different kind of state.
 *
 * Anything else — a new parameter, a different id, a fragment — fails here.
 * This is a bounded trade, not permission for query drift, and if a later
 * router version stops emitting the copy this still passes unchanged.
 */
export function expectCommunityUrl(url: string, expectedGroupId?: string): string {
  const parsed = new URL(url);

  const match = /^\/community\/([^/]+)$/.exec(parsed.pathname);
  expect(
    match,
    `the pathname is exactly /community/<id> (got ${JSON.stringify(parsed.pathname)})`,
  ).not.toBeNull();
  const groupId = decodeURIComponent(match![1]);
  if (expectedGroupId !== undefined) {
    expect(groupId, 'the path names the community that was opened').toBe(expectedGroupId);
  }

  const keys = [...parsed.searchParams.keys()];
  expect(
    keys.filter((key) => key !== 'groupId'),
    `the only query parameter the migration seam may add is groupId (got ${parsed.search})`,
  ).toEqual([]);
  for (const value of parsed.searchParams.getAll('groupId')) {
    expect(
      value,
      'the redundant groupId is a copy of the path segment, not another community',
    ).toBe(groupId);
  }

  expect(parsed.hash, 'no fragment is added to a community address').toBe('');
  return groupId;
}
