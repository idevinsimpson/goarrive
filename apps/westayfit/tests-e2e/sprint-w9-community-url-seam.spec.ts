import { expect, test } from '@playwright/test';

import { expectCommunityUrl } from './helpers/communityUrl';
import {
  seedActiveGoal,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * W9 — THE COMMUNITY ADDRESS ACROSS THE MIGRATION SEAM.
 *
 * WHAT THIS GUARDS. Adopting a real tab navigator put the community detail in
 * the Home tab's stack. Opening it from Home is a navigation inside that tab
 * and the address is `/community/<id>`. Opening it from the Community tab
 * crosses a navigator, and Expo Router leaves the navigate payload on the tab
 * route, which `getPathFromState` then writes out as `?groupId=<id>` — the
 * same id the path already carries.
 *
 * Four call-site shapes were built and measured and all four produce it. The
 * tidy-up — clearing the payload off the tab route as the state commits — was
 * built, shipped into a real build and reverted: it took the navigator's
 * record of the destination with it and landed the member on the Home tab's
 * index instead of the community they had chosen.
 *
 * THE DIRECTOR'S RULING (`5795072805`) is to accept this as a known
 * serialisation seam and keep a NARROW regression on it rather than a relaxed
 * assertion. That is what this file is, and it is deliberately four claims:
 *
 *   1. the pathname is EXACTLY `/community/<id>` from both entry points;
 *   2. the only query parameter that may appear is `groupId`, carrying the
 *      same id — a redundant copy, never a second community, never new state;
 *   3. the page renders ONE community, and it is the one the path names;
 *   4. the address survives a cold load: pasted or reloaded, it resolves to
 *      the same single community.
 *
 * It is a bounded trade, not permission for query drift: a new parameter, a
 * different id, a fragment, or a second mounted community all fail here. If a
 * later router version stops emitting the copy, every assertion still holds.
 */

test('the community address is the same address from either entry point, and survives a cold load', async ({
  browser,
}) => {
  test.setTimeout(240_000);

  const stamp = stampId();
  const email = `wsf-w9-seam-${stamp}@example.com`;
  const password = 'Sup3rSecret!23';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Alex Rivera');

  // Three, because the Community tab only offers rows to choose from when
  // there is a choice to make — and choosing is the entry point under test.
  const home = `w9seamhome-${stamp}`;
  const other = `w9seamother-${stamp}`;
  const third = `w9seamthird-${stamp}`;
  await seedCommunity({
    groupId: home,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'private',
    members: [{ uid, role: 'member' }],
  });
  await seedCommunity({
    groupId: other,
    displayName: 'Westside Walkers',
    joinPolicy: 'private',
    members: [{ uid, role: 'member' }],
  });
  await seedCommunity({
    groupId: third,
    displayName: 'Sunrise Squad',
    joinPolicy: 'private',
    members: [{ uid, role: 'member' }],
  });
  await seedActiveGoal({
    goalId: `w9seamgoal-${stamp}`,
    groupId: home,
    ownerUid: uid,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total: 1847,
  });

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await signInVia(page, email, password);

    /** One community on show, and it is the one the path names. */
    const oneCommunityNamed = async (displayName: string, at: string) => {
      await expect(page.getByTestId('wsf-community-name').last()).toHaveText(displayName, {
        timeout: 30_000,
      });
      expect(
        await page.locator('[data-testid="wsf-community"]:visible').count(),
        `${at}: exactly one community screen is on show`,
      ).toBe(1);
    };

    /*
      ENTRY POINT 1: THE COMMUNITY TAB, AND IT GOES FIRST ON PURPOSE.

      The seam only appears when the Home tab's stack does not already hold a
      community detail — arriving at one first and then crossing produces no
      query at all, because the router is moving between screens it already
      has. An earlier draft of this file did exactly that and recorded "(no
      query)", which would have made the regression a guard over nothing.
    */
    await page.goto('/community');
    await expect(page.getByTestId('wsf-community-index-rows')).toBeVisible({ timeout: 40_000 });
    await page.getByTestId(`wsf-community-index-row-${other}`).click();
    await oneCommunityNamed('Westside Walkers', 'from the Community tab');
    const crossed = page.url();
    expectCommunityUrl(crossed, other);

    /*
      AND THE SEAM IS THE SEAM, not a story about it. The assertion above
      already refuses any OTHER query, so recording which one this run produced
      keeps the measurement in the run's own output rather than in a comment.
    */
    // eslint-disable-next-line no-console
    console.log(
      `[W9] community address from the Community tab: ${new URL(crossed).search || '(no query)'}`,
    );

    // ---- entry point 2: the Home tab's own community, addressed directly ---
    await page.goto(`/community/${home}`);
    await oneCommunityNamed('Alpharetta Morning Movers', 'from Home');
    expectCommunityUrl(page.url(), home);

    // ---- the address survives being used as an address ---------------------
    const cold = await page.goto(crossed);
    expect(cold?.status(), `cold load of ${crossed}`).toBe(200);
    await oneCommunityNamed('Westside Walkers', 'cold load');
    expectCommunityUrl(page.url(), other);

    // And the bare form of the same address resolves identically, which is
    // what makes the copy redundant rather than load-bearing.
    const bare = `${new URL(crossed).origin}/community/${other}`;
    const bareLoad = await page.goto(bare);
    expect(bareLoad?.status(), `cold load of ${bare}`).toBe(200);
    await oneCommunityNamed('Westside Walkers', 'cold load without the query');
    expectCommunityUrl(page.url(), other);
  } finally {
    await context.close();
  }
});
