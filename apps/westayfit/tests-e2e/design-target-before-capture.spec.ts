import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { expect, test, type Browser, type Page } from '@playwright/test';

import {
  seedActiveGoal,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * ACTUAL CURRENT BEFORE for the MOVE / contribution family.
 *
 * Real screenshots of the product as it renders today, captured the same way
 * Home's BEFORE was, so the next target package can be compared against the
 * thing it is actually replacing rather than against a memory of it.
 *
 * These are NOT targets. Nothing here is drawn.
 */
const OUT = path.resolve(__dirname, '../../../docs/design-target/review/page-02-move/before');

const PHONE = { width: 390, height: 844 };
/** Short height, where the primary action is most at risk. */
const SHORT = { width: 390, height: 640 };

async function seed(label: string) {
  const id = stampId();
  const email = `wsf-${label}-${id}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Devin');
  const groupId = `${label}-${id}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'inviteOnly',
    members: [{ uid, role: 'foundingChampion' }],
  });
  const goalId = `${label}goal-${id}`;
  await seedActiveGoal({
    goalId,
    groupId,
    ownerUid: uid,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total: 1847,
  });
  const secondGoalId = `${label}goal2-${id}`;
  await seedActiveGoal({
    goalId: secondGoalId,
    groupId,
    ownerUid: uid,
    title: 'Step-ups round',
    target: 2000,
    unit: 'step-ups',
    total: 612,
  });
  return { email, password, groupId, goalId, secondGoalId };
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

test('capture the current MOVE and contribution surfaces', async ({
  browser,
}: {
  browser: Browser;
}) => {
  test.setTimeout(240_000);
  const fx = await seed('tgt2');

  for (const [key, viewport] of [
    ['390x844', PHONE],
    ['390x640', SHORT],
  ] as const) {
    const ctx = await browser.newContext({
      viewport,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      reducedMotion: 'reduce',
    });
    try {
      const page = await ctx.newPage();
      await signInVia(page, fx.email, fx.password);

      // MOVE with more than one actionable goal: the resolver has to ask.
      await page.goto('/move');
      await expect(page.getByTestId('wsf-move-choose')).toBeVisible({ timeout: 40_000 });
      await shot(page, `BEFORE-move-choose-${key}`);

      // The contribution flow, screen by screen.
      await page.goto(`/contribute/${fx.goalId}?groupId=${fx.groupId}&mode=move`);
      await expect(page.getByTestId('wsf-contribute-move-screen').last()).toBeVisible({
        timeout: 40_000,
      });
      await shot(page, `BEFORE-contribute-move-${key}`);

      await page.getByTestId('wsf-contribute-done').last().click();
      await expect(page.getByTestId('wsf-contribute-entry-screen').last()).toBeVisible({
        timeout: 20_000,
      });
      await page.getByTestId('wsf-contribute-entry').last().fill('20');
      await shot(page, `BEFORE-contribute-entry-${key}`);

      await page.getByTestId('wsf-contribute-review').last().click();
      await expect(page.getByTestId('wsf-contribute-review-screen').last()).toBeVisible({
        timeout: 20_000,
      });
      await shot(page, `BEFORE-contribute-review-${key}`);

      await page.getByTestId('wsf-contribute-submit').last().click();
      await expect(page.getByTestId('wsf-contribute-receipt').last()).toBeVisible({
        timeout: 40_000,
      });
      await shot(page, `BEFORE-contribute-confirmed-${key}`);

      // Creating a goal is where a movement is chosen today.
      await page.goto(`/goals/new?groupId=${fx.groupId}`);
      await expect(page.getByTestId('wsf-new-goal-form')).toBeVisible({ timeout: 40_000 });
      await shot(page, `BEFORE-goal-new-${key}`);
    } finally {
      await ctx.close();
    }
  }
});
