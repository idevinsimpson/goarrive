import { expect, test, type Page } from '@playwright/test';

import { expectCommunityUrl } from './helpers/communityUrl';
import { seedCommunity, seedProfile, seedVerifiedUser, signInVia, stampId } from './helpers/mobile';

/**
 * W9 — THE COMMUNITY LIST KEEPS ITS ADDRESS (Q2).
 *
 * WHAT THIS GUARDS. `/?view=communities` asks Home for the member's list
 * instead of opening their community. It exists for one navigation: after a
 * create whose answer never came back, the member is sent to CHECK whether
 * their community exists. W7 measured (`5800444443`) that on the shell, the
 * in-app navigation to it lands at `/` with the query gone. The list is still
 * drawn, so it looks fine, but a reload re-derives the screen from the address
 * and puts the member inside the community they already had. That's exactly
 * the screen that can't answer their question.
 *
 * THE MECHANISM, measured in the router rather than guessed. A `Link` from a
 * focused flow outside the tabs pushes a new tab navigator whose target exists
 * only as a navigate payload. Expo Router writes the address from that payload
 * and drops the leaf's query, and navigators mounted inside a newly mounted
 * scene don't commit their state until they act, so nothing corrects it.
 *
 * THE ENTRY POINT. The real caller is W4's unconfirmed-create screen, which is
 * not on the app-shell head. `design-target/shell-next/leave-for-list` is a
 * screen outside the tabs that leaves the same way: the same `ButtonLink`, the
 * same href. It renders only in the emulator build these specs run against.
 *
 * WHAT IS NOT CLAIMED. Nothing here is about what the list contains, or about
 * the second tab navigator the same link mounts when the member arrived in
 * app. That is the contribution-exit family, handled separately.
 */

const PHONE = { width: 390, height: 844 };
const FIXTURE = '/design-target/shell-next/leave-for-list';

/** The address is exactly the list request: `/`, one `view`, its one value. */
function expectListAddress(url: string, at: string): void {
  const parsed = new URL(url);
  expect(parsed.pathname, `${at}: the path is Home`).toBe('/');
  expect(
    [...parsed.searchParams.entries()],
    `${at}: the address carries the list request and nothing else (got ${JSON.stringify(parsed.search)})`,
  ).toEqual([['view', 'communities']]);
  expect(parsed.hash, `${at}: no fragment`).toBe('');
}

/** The list is what's on show, and Home is not on its way into a community. */
async function expectListShown(page: Page, groupId: string, at: string): Promise<void> {
  await expect(page.getByTestId('wsf-home-my-list').last(), `${at}: the list is shown`).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByTestId(`wsf-home-community-${groupId}`).last(),
    `${at}: the member's community is in the list`,
  ).toBeVisible();
  await expect(
    page.locator('[data-testid="wsf-home-opening-community"]:visible'),
    `${at}: Home is not opening a community`,
  ).toHaveCount(0);
}

test('the list request survives the navigation into it, and a reload', async ({ browser }) => {
  test.setTimeout(240_000);

  const stamp = stampId();
  const email = `wsf-w9-list-${stamp}@example.com`;
  const password = 'Sup3rSecret!23';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Alex Rivera');
  // ONE community, on purpose: bare `/` opens a member's only community, so
  // a reload that lost the request lands somewhere visibly different.
  const groupId = `w9list-${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'private',
    members: [{ uid, role: 'member' }],
  });

  const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 });
  const page = await context.newPage();
  try {
    await signInVia(page, email, password);

    /*
      THE DEFAULT, FIRST, so the rest can't pass for the wrong reason: without
      the request, Home opens this member's community. If it didn't, a reload
      landing on the list would prove nothing.
    */
    await page.goto('/');
    await page.waitForURL(/\/community\/[^/?#]+/, { timeout: 40_000 });
    expectCommunityUrl(page.url(), groupId);

    // ---- the navigation: from a focused flow outside the tabs, into the list
    await page.goto(FIXTURE);
    const leave = page.getByTestId('wsf-w9-fixture-leave-for-list').last();
    await expect(leave).toBeVisible({ timeout: 30_000 });
    const historyBefore = await page.evaluate(() => window.history.length);
    await leave.click();
    await expectListShown(page, groupId, 'after the navigation');
    // Settled, not first-paint: the address is read after the page has stopped
    // moving, which is when a member would copy it or reload.
    await page.waitForTimeout(1_000);
    expectListAddress(page.url(), 'after the navigation');
    expect(
      (await page.evaluate(() => window.history.length)) - historyBefore,
      'the navigation is ONE history entry: keeping the address adds none',
    ).toBe(1);

    // ---- the reload: the address alone has to bring the member back here ----
    const reloaded = await page.reload();
    expect(reloaded?.status(), 'the reload is served').toBe(200);
    await expectListShown(page, groupId, 'after a reload');
    await page.waitForTimeout(1_500);
    expectListAddress(page.url(), 'after a reload, settled');

    /*
      AND THE REQUEST DOES NOT SPREAD. It's an opt-in for one navigation, not a
      preference: opening the community from the list is an ordinary community
      address, and bare `/` still opens the community afterwards.
    */
    await page.getByTestId(`wsf-home-community-${groupId}`).last().click();
    await page.waitForURL(/\/community\/[^/?#]+/, { timeout: 30_000 });
    expectCommunityUrl(page.url(), groupId);

    await page.goto('/');
    await page.waitForURL(/\/community\/[^/?#]+/, { timeout: 40_000 });
    expectCommunityUrl(page.url(), groupId);
  } finally {
    await context.close();
  }
});
