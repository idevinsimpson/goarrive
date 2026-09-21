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
 * ACTUAL IMPLEMENTATION AFTER for /move and /contribute/[goalId].
 *
 * Real screenshots of the running product with the slice applied, at the three
 * device classes the gate asks for. These are NOT targets: nothing here is
 * drawn, and no frame carries a concept banner.
 */
const OUT = path.resolve(__dirname, '../../../docs/design-target/review/page-02-move/after');

const CLASSES = [
  { key: '390x844', width: 390, height: 844 },
  { key: '390x640', width: 390, height: 640 },
  { key: '430x932', width: 430, height: 932 },
] as const;

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
  // A second open goal, so MOVE has to ask rather than guess. Counted in
  // `steps`, which the product actually has counting guidance for.
  const secondGoalId = `${label}goal2-${id}`;
  await seedActiveGoal({
    goalId: secondGoalId,
    groupId,
    ownerUid: uid,
    title: 'Step count week',
    target: 2000,
    unit: 'steps',
    total: 612,
  });
  return { email, password, groupId, goalId, secondGoalId };
}

async function shot(page: Page, name: string) {
  /*
    FIRST VIEWPORT, ALWAYS. Filling the amount field scrolls it into view, so
    an unscrolled shutter caught the short phone mid-page with the anchor
    above the top edge -- a frame that looks like a fold violation and is
    really just a scroll position. The gate compares what a member sees on
    arrival, so every frame is taken from the top.
  */
  await page.evaluate(() => window.scrollTo(0, 0));
  // The Living WE is an image; let it decode before the shutter.
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

test('AFTER: the MOVE and contribution surfaces as implemented', async ({
  browser,
}: {
  browser: Browser;
}) => {
  test.setTimeout(300_000);
  const fx = await seed('aft2');

  for (const c of CLASSES) {
    const ctx = await browser.newContext({
      viewport: { width: c.width, height: c.height },
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

      // MOVE with more than one actionable goal: it asks rather than guesses.
      await page.goto('/move');
      await expect(page.getByTestId('wsf-move-choose')).toBeVisible({ timeout: 40_000 });
      await shot(page, `AFTER-move-choose-${c.key}`);

      await page.goto(`/contribute/${fx.goalId}?groupId=${fx.groupId}&mode=move`);
      await expect(page.getByTestId('wsf-contribute-move-screen').last()).toBeVisible({
        timeout: 40_000,
      });
      await shot(page, `AFTER-contribute-move-${c.key}`);

      await page.getByTestId('wsf-contribute-done').last().click();
      await expect(page.getByTestId('wsf-contribute-entry-screen').last()).toBeVisible({
        timeout: 20_000,
      });
      await page.getByTestId('wsf-contribute-entry').last().fill('20');
      await shot(page, `AFTER-contribute-entry-${c.key}`);

      await page.getByTestId('wsf-contribute-review').last().click();
      await expect(page.getByTestId('wsf-contribute-review-screen').last()).toBeVisible({
        timeout: 20_000,
      });
      await shot(page, `AFTER-contribute-review-${c.key}`);

      await page.getByTestId('wsf-contribute-submit').last().click();
      await expect(page.getByTestId('wsf-contribute-receipt').last()).toBeVisible({
        timeout: 40_000,
      });
      await shot(page, `AFTER-contribute-confirmed-${c.key}`);
    } finally {
      await ctx.close();
    }
  }
});

/**
 * MOVE with nothing open. Its own community, because the state is a property
 * of the community rather than of the member.
 */
test('AFTER: MOVE when nothing is running', async ({ browser }: { browser: Browser }) => {
  test.setTimeout(180_000);
  const id = stampId();
  const email = `wsf-aftq-${id}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Devin');
  const groupId = `aftq-${id}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'inviteOnly',
    members: [{ uid, role: 'foundingChampion' }],
  });

  for (const c of CLASSES) {
    const ctx = await browser.newContext({
      viewport: { width: c.width, height: c.height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      reducedMotion: 'reduce',
    });
    try {
      const page = await ctx.newPage();
      await signInVia(page, email, password);
      await page.goto('/move');
      await expect(page.getByTestId('wsf-move-no-goal')).toBeVisible({ timeout: 40_000 });
      await shot(page, `AFTER-move-nogoal-${c.key}`);
    } finally {
      await ctx.close();
    }
  }
});
