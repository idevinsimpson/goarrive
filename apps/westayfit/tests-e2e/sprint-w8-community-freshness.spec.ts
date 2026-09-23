import { randomBytes } from 'node:crypto';

import { expect, test, type Browser, type Page, type Route } from '@playwright/test';

import {
  seedActiveGoal,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * COMMUNITY-DATA FRESHNESS ON A GENUINE RETURN (Director `5800485762`).
 *
 * The Community screen stays mounted under whatever the member opens from it.
 * A history Back therefore returns to the SAME instance, and that instance must
 * not show what was true before the member left.
 *
 * W6 measured the defect (`5800472286`): a Champion creates a goal, goes Back,
 * and the mounted page still says "No goal running yet" — and on the unknown
 * outcome that is the exact prompt to create a duplicate goal. Each case below
 * proves BOTH halves: the instance and its scroll survive (no remount), and
 * the data is the current data.
 */

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

async function phone(browser: Browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    userAgent: IPHONE_UA,
    timezoneId: 'America/New_York',
  });
  return { context, page: await context.newPage() };
}

async function champion(label: string, withGoal: boolean) {
  const id = stampId();
  const email = `w8f-${label}-${id}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Devin Simpson');
  const groupId = `w8f-${label}-${id}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'private',
    members: [{ uid, role: 'foundingChampion' }],
  });
  const goalId = `w8fg-${label}-${id}`;
  if (withGoal) {
    await seedActiveGoal({
      goalId,
      groupId,
      ownerUid: uid,
      title: 'October Squat Challenge',
      target: 5000,
      unit: 'squats',
      total: 0,
    });
  }
  return { email, password, uid, groupId, goalId };
}

/** The ONE visible Community root. The stack may keep a hidden one mounted. */
function visibleCommunity(page: Page) {
  return page.locator('[data-testid="wsf-community"]:visible');
}

/** Sign in and land on the member's community through Home, as a member does. */
async function arrive(page: Page, email: string, password: string, groupId: string) {
  await signInVia(page, email, password);
  await page.goto('/');
  await page.waitForURL(new RegExp(`/community/${groupId}`), { timeout: 30_000 });
  await expect(visibleCommunity(page)).toHaveCount(1, { timeout: 40_000 });
}

/**
 * Plant a mark on the mounted instance. A remount throws it away; so does a
 * pushed second copy (the visible one would be unmarked).
 */
async function mark(page: Page): Promise<void> {
  await page.evaluate(() => {
    const roots = Array.from(document.querySelectorAll('[data-testid="wsf-community"]'));
    const shown = roots.find((el) => (el as HTMLElement).offsetParent !== null) as
      | HTMLElement
      | undefined;
    if (!shown) throw new Error('no visible community root to mark');
    shown.setAttribute('data-w8-mark', 'mounted');
  });
}

async function expectSameInstance(page: Page, label: string): Promise<void> {
  const state = await page.evaluate(() => {
    const roots = Array.from(document.querySelectorAll('[data-testid="wsf-community"]'));
    const shown = roots.filter((el) => (el as HTMLElement).offsetParent !== null);
    return {
      total: roots.length,
      visible: shown.length,
      marked: shown.length === 1 && shown[0]!.getAttribute('data-w8-mark') === 'mounted',
    };
  });
  expect(state.visible, `${label}: exactly one Community is visible`).toBe(1);
  expect(state.marked, `${label}: the visible Community is not the mounted one`).toBe(true);
  expect(state.total, `${label}: a second Community instance was mounted`).toBe(1);
}

/** The screen's own scroller offset: RN Web scrolls inside an element. */
async function scrollOf(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = Array.from(document.querySelectorAll('[data-testid="wsf-community"]')).find(
      (el) => (el as HTMLElement).offsetParent !== null,
    ) as HTMLElement | undefined;
    let el: HTMLElement | null = root ?? null;
    let best = 0;
    while (el) {
      best = Math.max(best, el.scrollTop);
      el = el.parentElement;
    }
    root?.querySelectorAll('*').forEach((c) => {
      best = Math.max(best, (c as HTMLElement).scrollTop);
    });
    return best;
  });
}

async function plantScroll(page: Page, y: number): Promise<number> {
  await page.evaluate((target) => {
    const root = Array.from(document.querySelectorAll('[data-testid="wsf-community"]')).find(
      (el) => (el as HTMLElement).offsetParent !== null,
    ) as HTMLElement | undefined;
    const candidates: HTMLElement[] = [];
    let el: HTMLElement | null = root ?? null;
    while (el) {
      candidates.push(el);
      el = el.parentElement;
    }
    root?.querySelectorAll('*').forEach((c) => candidates.push(c as HTMLElement));
    const scroller = candidates.find((c) => c.scrollHeight > c.clientHeight + target);
    if (scroller) scroller.scrollTop = target;
  }, y);
  await page.waitForTimeout(300);
  return scrollOf(page);
}

async function backToCommunity(page: Page, groupId: string): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await page.goBack();
    await page.waitForTimeout(400);
    if (new URL(page.url()).pathname === `/community/${groupId}`) return;
  }
  throw new Error(`history Back never returned to /community/${groupId} (at ${page.url()})`);
}

async function fillGoal(page: Page, title: string): Promise<void> {
  await expect(page.getByTestId('wsf-new-goal-form')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('wsf-new-goal-title').fill(title);
  await page.getByTestId('wsf-new-goal-target').fill('750');
  await page.getByTestId('wsf-new-goal-unit').fill('squats');
  await page.getByTestId('wsf-new-goal-submit').click();
}

test.describe('Community data is current on a genuine return', () => {
  test('a confirmed create, then Back: the mounted page shows the new goal', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const fx = await champion('create', false);
    const { context, page } = await phone(browser);
    try {
      await arrive(page, fx.email, fx.password, fx.groupId);
      await expect(page.getByTestId('wsf-community-no-goal')).toBeVisible({ timeout: 40_000 });
      await mark(page);

      await page.getByTestId('wsf-community-start-goal').click();
      await page.waitForURL(/\/goals\/new/, { timeout: 30_000 });
      await fillGoal(page, 'W8 freshness goal');
      await expect(page.getByTestId('wsf-new-goal-created')).toBeVisible({ timeout: 40_000 });

      await backToCommunity(page, fx.groupId);
      await expectSameInstance(page, 'after a confirmed create');
      await expect(visibleCommunity(page).getByTestId('wsf-community-goal-hero')).toContainText(
        'W8 freshness goal',
        { timeout: 30_000 },
      );
      await expect(visibleCommunity(page).getByTestId('wsf-community-no-goal')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('a lost create response, then Back: the goal the server made is shown, not "no goal yet"', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const fx = await champion('lost', false);
    const { context, page } = await phone(browser);
    try {
      await arrive(page, fx.email, fx.password, fx.groupId);
      await expect(page.getByTestId('wsf-community-no-goal')).toBeVisible({ timeout: 40_000 });
      await mark(page);

      // The server commits; the answer never reaches the page.
      await page.route('**/wsfCreateGoal', async (route: Route) => {
        await route.fetch();
        await route.abort('connectionreset');
      });
      await page.getByTestId('wsf-community-start-goal').click();
      await page.waitForURL(/\/goals\/new/, { timeout: 30_000 });
      await fillGoal(page, 'W8 lost-answer goal');
      await expect(page.getByTestId('wsf-new-goal-check-goals')).toBeVisible({ timeout: 40_000 });
      await page.unroute('**/wsfCreateGoal');

      await backToCommunity(page, fx.groupId);
      await expectSameInstance(page, 'after a lost create response');
      await expect(visibleCommunity(page).getByTestId('wsf-community-goal-hero')).toContainText(
        'W8 lost-answer goal',
        { timeout: 30_000 },
      );
      await expect(visibleCommunity(page).getByTestId('wsf-community-no-goal')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('a recorded contribution, then Back: presence and momentum include it, on the same instance', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const fx = await champion('move', true);
    const { context, page } = await phone(browser);
    try {
      await arrive(page, fx.email, fx.password, fx.groupId);
      const card = visibleCommunity(page).getByTestId('wsf-community-momentum-card');
      await expect(card).toBeVisible({ timeout: 40_000 });
      // A proven zero before anything happens today.
      await expect(page.getByTestId('wsf-community-contributors-today')).toHaveText(
        '0 people moved today',
        { timeout: 30_000 },
      );
      await expect(card.getByTestId('wsf-momentum-row')).toHaveCount(0);
      await expect(
        visibleCommunity(page).getByTestId(`wsf-community-goal-total-${fx.goalId}`).first(),
      ).toHaveText(/^0\s+of 5,000 squats$/);
      await mark(page);

      await page.getByTestId(`wsf-community-goal-link-${fx.goalId}`).click();
      await expect(page.getByTestId('wsf-contribute-move-screen')).toBeVisible({ timeout: 40_000 });
      await page.getByTestId('wsf-contribute-done').click();
      await page.getByTestId('wsf-contribute-entry').fill('20');
      await page.getByTestId('wsf-contribute-review').click();
      await page.getByTestId('wsf-contribute-submit').click();
      await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 40_000 });

      await backToCommunity(page, fx.groupId);
      await expectSameInstance(page, 'after a recorded contribution');
      await expect(page.getByTestId('wsf-community-contributors-today')).toHaveText(
        '1 person moved today',
        { timeout: 30_000 },
      );
      await expect(card.getByTestId('wsf-momentum-row').first()).toContainText('Devin Simpson');
      await expect(card.getByTestId('wsf-momentum-row').first()).toContainText('added 20 squats');
      // The SHARED total, not only the member's own part. The pulse is cached
      // server-side for 2 s, so a single read made the moment the member lands
      // back can return the pre-contribution total and never correct it (W1B
      // measured exactly that on #453: "You've added 20" beside an unchanged
      // total, still wrong at 15 s).
      await expect(
        visibleCommunity(page).getByTestId(`wsf-community-goal-total-${fx.goalId}`).first(),
      ).toHaveText(/^20\s+of 5,000 squats$/, { timeout: 15_000 });
    } finally {
      await context.close();
    }
  });

  test('the return keeps the scroll; reselecting the active tab reads nothing', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const fx = await champion('still', true);
    const { context, page } = await phone(browser);
    try {
      await arrive(page, fx.email, fx.password, fx.groupId);
      await expect(page.getByTestId('wsf-community-momentum-card')).toBeVisible({
        timeout: 40_000,
      });
      await page.waitForTimeout(1500);
      await mark(page);

      const calls: string[] = [];
      page.on('request', (r) => {
        const m = /\/(wsfListGoals|wsfCommunityActivity|wsfCommunityMembers)\b/.exec(r.url());
        if (m) calls.push(m[1]!);
      });

      // RESELECT: the tab you are on is a no-op, and that includes the data.
      await page.getByTestId('wsf-member-tab-home').last().click();
      await page.waitForTimeout(1500);
      expect(calls, 'reselecting the active tab re-read community data').toEqual([]);
      await expectSameInstance(page, 'after reselect');

      // A GENUINE RETURN: leave for Progress, come back. The scroll is kept and
      // the data is re-read without blanking the page.
      const planted = await plantScroll(page, 220);
      expect(planted, 'the Community screen has somewhere to scroll to').toBeGreaterThan(40);
      await page.getByTestId('wsf-member-tab-activity').last().click();
      await expect(page.getByTestId('wsf-activity-title')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('wsf-member-tab-home').last().click();
      await expect(visibleCommunity(page)).toHaveCount(1, { timeout: 30_000 });
      await expect.poll(() => calls.includes('wsfListGoals'), { timeout: 20_000 }).toBe(true);
      await expect.poll(() => calls.includes('wsfCommunityActivity'), { timeout: 20_000 }).toBe(true);
      await expectSameInstance(page, 'after a tab round trip');
      // Never back to a loading skeleton over data it already had.
      await expect(page.getByTestId('wsf-community-goals-loading')).toHaveCount(0);
      await expect(page.getByTestId('wsf-community-goal-hero')).toBeVisible();
      const after = await scrollOf(page);
      expect(Math.abs(after - planted), 'the return lost the Community scroll').toBeLessThanOrEqual(2);
    } finally {
      await context.close();
    }
  });
});
