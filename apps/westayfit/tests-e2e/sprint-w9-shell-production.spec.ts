import { expect, test, type Page } from '@playwright/test';

import {
  seedActiveGoal,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * W9 — THE SHELL'S OWN PROMISES, ON THE SHIPPING ROUTES.
 *
 * WHY THIS FILE EXISTS. `sprint-w9-shell-nav.spec.ts` proved these properties
 * on the gated prototype, which is what it was for: the prototype was the
 * argument for the migration. The migration has since landed on the real
 * member routes, and a property proved only on a prototype is a property
 * nobody is guarding. The Director's gate asks for them on the build that
 * ships (`5795072805`), so this file asks the same questions of `/`,
 * `/community`, `/activity`, `/you` and `/move`.
 *
 * WHAT IS BEING MEASURED, AND HOW.
 *
 *   A REMOUNT is detected with a mark planted on the DOM node itself. React
 *   re-creates the node when a screen remounts, and the mark goes with it, so
 *   a surviving mark is proof the very same screen is on show — stronger than
 *   "an element with that testID is present", which a rebuilt copy satisfies.
 *
 *   A RELOAD is detected with a mark on `window`. A reload throws the whole
 *   JS context away, so the global cannot survive one.
 *
 *   A NAVIGATION is counted in `history.length`, read before and after.
 *
 * The owner's complaint was that tapping the icon you are already on reloads
 * the page, and that leaving a tab and coming back rebuilds it. Those are the
 * two claims here, plus MOVE opening over the tab the member was in and
 * closing back onto it.
 *
 * Everything seeded here is SYNTHETIC: no community, member or goal is real.
 */

const PHONE = { width: 390, height: 844 };

/** Plant a mark on the node itself: it cannot survive that node being rebuilt. */
async function markNode(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!(el instanceof HTMLElement)) return false;
    el.dataset.wsfW9Mark = 'planted';
    return true;
  }, testId);
}

async function markSurvives(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    return el instanceof HTMLElement && el.dataset.wsfW9Mark === 'planted';
  }, testId);
}

/** The scroll offset of whichever ancestor of this element actually scrolls. */
async function scrollOf(page: Page, testId: string): Promise<number | null> {
  return page.evaluate((id) => {
    let el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    while (el) {
      if (el.scrollHeight > el.clientHeight + 1) return Math.round(el.scrollTop);
      el = el.parentElement;
    }
    return null;
  }, testId);
}

async function setScroll(page: Page, testId: string, top: number): Promise<number | null> {
  return page.evaluate(
    ({ id, value }) => {
      let el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
      while (el) {
        if (el.scrollHeight > el.clientHeight + 1) {
          el.scrollTop = value;
          return Math.round(el.scrollTop);
        }
        el = el.parentElement;
      }
      return null;
    },
    { id: testId, value: top },
  );
}

test('the shipping shell: the active tab is a no-op, tabs stay mounted, and MOVE opens over the tab you were on', async ({
  browser,
}) => {
  test.setTimeout(300_000);

  const stamp = stampId();
  const email = `wsf-w9-prod-${stamp}@example.com`;
  const password = 'Sup3rSecret!23';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `w9prod-${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'private',
    members: [{ uid, role: 'member' }],
  });
  await seedActiveGoal({
    goalId: `w9prodgoal-${stamp}`,
    groupId,
    ownerUid: uid,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total: 1847,
  });
  // A second open goal, so MOVE has a question to ask instead of resolving
  // itself straight into a contribution.
  await seedActiveGoal({
    goalId: `w9prodgoal2-${stamp}`,
    groupId,
    ownerUid: uid,
    title: 'Morning Mile Streak',
    target: 300,
    unit: 'miles',
    total: 96,
  });

  const context = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await signInVia(page, email, password);
    await page.goto('/');
    await expect(page.getByTestId('wsf-community-goal-hero')).toBeVisible({ timeout: 40_000 });

    // The reload detector, planted once for the whole test.
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__wsfW9Session = 'alive';
    });
    const sessionAlive = () =>
      page.evaluate(
        () => (window as unknown as Record<string, unknown>).__wsfW9Session === 'alive',
      );

    /*
      1 · THE ACTIVE TAB IS A NO-OP. The owner's words: tapping the icon you
      are already on reloads the page. Four claims, all measured: no history
      entry, no reload, no remount, and the scroll left where it was.
    */
    expect(await markNode(page, 'wsf-community'), 'the Home screen was marked').toBe(true);
    const planted = await setScroll(page, 'wsf-community', 160);
    expect(planted, 'Home has somewhere to scroll to').not.toBeNull();
    const historyBefore = await page.evaluate(() => window.history.length);

    await page.getByTestId('wsf-member-tab-home').last().click();
    await page.waitForTimeout(700);

    expect(
      await page.evaluate(() => window.history.length),
      'tapping the tab you are on added a history entry',
    ).toBe(historyBefore);
    expect(await sessionAlive(), 'tapping the tab you are on reloaded the page').toBe(true);
    expect(
      await markSurvives(page, 'wsf-community'),
      'tapping the tab you are on rebuilt the screen',
    ).toBe(true);
    expect(
      await scrollOf(page, 'wsf-community'),
      'tapping the tab you are on threw the scroll away',
    ).toBe(planted);

    /*
      2 · LEAVING A TAB AND COMING BACK DOES NOT REBUILD IT. Each of the other
      three is visited and marked, then Home is returned to and must still be
      the same screen, at the same scroll.
    */
    for (const [key, ready] of [
      ['community', 'wsf-community-index-title'],
      ['activity', 'wsf-activity-title'],
      ['you', 'wsf-you-name'],
    ] as const) {
      await page.getByTestId(`wsf-member-tab-${key}`).last().click();
      await expect(page.getByTestId(ready)).toBeVisible({ timeout: 30_000 });
      expect(await markNode(page, ready), `${key} was marked`).toBe(true);
    }

    await page.getByTestId('wsf-member-tab-home').last().click();
    await expect(page.getByTestId('wsf-community-goal-hero')).toBeVisible({ timeout: 30_000 });
    expect(
      await markSurvives(page, 'wsf-community'),
      'coming back to Home rebuilt it from scratch',
    ).toBe(true);
    expect(await scrollOf(page, 'wsf-community'), 'coming back to Home lost its scroll').toBe(
      planted,
    );
    expect(await sessionAlive(), 'moving between tabs reloaded the page').toBe(true);

    // And each of the other three is still the screen it was, not a copy.
    for (const [key, ready] of [
      ['you', 'wsf-you-name'],
      ['activity', 'wsf-activity-title'],
      ['community', 'wsf-community-index-title'],
    ] as const) {
      await page.getByTestId(`wsf-member-tab-${key}`).last().click();
      await expect(page.getByTestId(ready)).toBeVisible({ timeout: 30_000 });
      expect(await markSurvives(page, ready), `${key} was rebuilt when it was returned to`).toBe(
        true,
      );
    }

    /*
      3 · MOVE OPENS OVER THE TAB YOU WERE ON, AND CLOSES BACK ONTO IT.

      Opened from You on purpose — from Home the claim would be untestable,
      because Home is where a replaced screen would land anyway. The tab
      underneath must still be MOUNTED (the mark), the bar must not be
      reachable while the sheet is up, and Close must return to that same
      screen rather than to a rebuilt one or to Home.
    */
    await page.getByTestId('wsf-member-tab-you').last().click();
    await expect(page.getByTestId('wsf-you-name')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('wsf-member-tab-move').last().click();
    await expect(page.getByTestId('wsf-move-choose')).toBeVisible({ timeout: 30_000 });
    expect(
      await markSurvives(page, 'wsf-you-name'),
      'MOVE replaced the tab underneath instead of opening over it',
    ).toBe(true);

    const barReachable = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="wsf-member-tabs"]');
      if (!(bar instanceof HTMLElement)) return false;
      const r = bar.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const top = document.elementFromPoint(
        Math.round(r.x + r.width / 2),
        Math.round(r.y + r.height / 2),
      );
      return top instanceof Node && bar.contains(top);
    });
    expect(
      barReachable,
      'the member tab bar is reachable under the MOVE sheet — MOVE is offering to take a member where they already are',
    ).toBe(false);

    await page.goBack();
    await expect(page.getByTestId('wsf-you-name')).toBeVisible({ timeout: 30_000 });
    expect(
      await markSurvives(page, 'wsf-you-name'),
      'closing MOVE came back to a rebuilt You rather than the one it opened over',
    ).toBe(true);
    expect(await sessionAlive(), 'MOVE reloaded the page').toBe(true);
  } finally {
    await context.close();
  }
});
