import { expect, test, type Route } from '@playwright/test';

import {
  seedActiveGoal,
  seedCommunity,
  seedMembership,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * W9 — HOME-POLISH-1: WHAT THE RECOMPOSED HERO SAYS, AND ONLY THAT.
 *
 * The recomposition gave the goal hero's top slot a standing name for the card
 * ("Community goal") where there used to be nothing. That slot has a rule the
 * older specs guard by counting the "Goal reached" eyebrow alone, so this file
 * pins the new half of it:
 *   · an open goal shows the name, and no "Goal reached";
 *   · a goal at or past its target shows "Goal reached", and no name — news
 *     still takes the slot, and the two never stand together;
 *   · the lines the hero centres stay centred. The row under the bar sets what
 *     is left to the right; that style must not leak onto "Checking progress…"
 *     (measured while the progress read is held open).
 *
 * Everything seeded here is SYNTHETIC.
 */

const PHONE = { width: 390, height: 844 };

async function seed(tag: string, total: number): Promise<{ email: string; password: string; groupId: string; goalId: string }> {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-w9-hph-${stamp}@example.com`;
  const password = 'Sup3rSecret!23';
  const me = await seedVerifiedUser(email, password);
  await seedProfile(me, 'Alex Rivera');
  const groupId = `w9hph-${stamp}`;
  const goalId = `w9hphgoal-${stamp}`;
  const dana = `w9hph-dana-${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'private',
    members: [{ uid: me, role: 'member' }],
  });
  await seedMembership(groupId, dana, 'foundingChampion');
  await seedActiveGoal({
    goalId,
    groupId,
    ownerUid: dana,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total,
  });
  return { email, password, groupId, goalId };
}

test.describe('HOME-POLISH-1 · the hero names its card, and news replaces the name', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 2 });

  test('an open goal: "Community goal", and no "Goal reached"', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await seed('o', 1847);
    await signInVia(page, fx.email, fx.password);
    await page.goto(`/community/${fx.groupId}`);
    await expect(page.getByTestId(`wsf-community-goal-total-${fx.goalId}`)).toContainText('1,847', {
      timeout: 40_000,
    });
    await expect(page.getByTestId('wsf-community-goal-label')).toHaveText('Community goal');
    await expect(page.getByTestId('wsf-community-goal-eyebrow')).toHaveCount(0);
  });

  test('a goal at its target: "Goal reached" takes the slot, and the name is gone', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await seed('r', 5000);
    await signInVia(page, fx.email, fx.password);
    await page.goto(`/community/${fx.groupId}`);
    await expect(page.getByTestId('wsf-community-goal-eyebrow')).toHaveText('Goal reached', {
      timeout: 40_000,
    });
    await expect(page.getByTestId('wsf-community-goal-label')).toHaveCount(0);
  });

  test('at 200% zoom (195 px): no sideways scroll, the label on one line, the total breaking after the count', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const fx = await seed('z', 1847);
    // Six visible members, so the faces row is at its widest (five and "+N").
    for (const [i, name] of ['Marcus Reed', 'Leah Brooks', 'Priya Nair', 'Tom Okafor', 'Sam Ortiz'].entries()) {
      const uid = `w9hph-extra${i}-${stampId()}`;
      await seedMembership(fx.groupId, uid, 'member');
      await seedProfile(uid, name);
    }
    const ctx = await browser.newContext({ viewport: { width: 195, height: 844 }, deviceScaleFactor: 2 });
    try {
      const page = await ctx.newPage();
      await signInVia(page, fx.email, fx.password);
      await page.goto(`/community/${fx.groupId}`);
      await expect(page.getByTestId(`wsf-community-goal-total-${fx.goalId}`)).toContainText('1,847', {
        timeout: 40_000,
      });
      await expect(page.getByTestId('wsf-presence-row')).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(1_000);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect.soft(overflow, 'the page scrolls sideways at 195 px').toBeLessThanOrEqual(0);

      const label = (await page.getByTestId('wsf-community-goal-label').boundingBox())!;
      expect.soft(label.height, 'the card label wraps to two lines at 195 px').toBeLessThanOrEqual(16);

      const lines = await page.getByTestId(`wsf-community-goal-total-${fx.goalId}`).evaluate((el) => {
        const spans = Array.from(el.children) as HTMLElement[];
        const count = spans[0]!.getBoundingClientRect();
        const rest = spans[1]!.getClientRects()[0]!;
        // On one line the smaller span's box already sits lower than the
        // count's, so "lower" proves nothing: a new line starts at or below
        // the count's own bottom edge.
        return { countBottom: Math.round(count.bottom), restTop: Math.round(rest.top) };
      });
      expect.soft(
        lines.restTop,
        'the total broke inside "of … squats" instead of after the count',
      ).toBeGreaterThanOrEqual(lines.countBottom - 2);
    } finally {
      await ctx.close();
    }
  });

  test('"Checking progress…" stays centred on the hero while the read is out', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await seed('c', 1847);
    // The progress read is held open for this test only (labelled injection),
    // so the hero's loading line is the thing on screen to measure.
    const gate: { release: () => void } = { release: () => {} };
    const held = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    await page.route('**/wsfGoalPulse', async (route: Route) => {
      await held;
      await route.continue().catch(() => undefined);
    });
    await signInVia(page, fx.email, fx.password);
    await page.goto(`/community/${fx.groupId}`);
    const loading = page.getByTestId(`wsf-community-goal-progress-loading-${fx.goalId}`);
    await expect(loading).toHaveText('Checking progress…', { timeout: 40_000 });
    const align = await loading.evaluate((el) => getComputedStyle(el).textAlign);
    gate.release();
    await page.unroute('**/wsfGoalPulse');
    expect(align, 'the hero loading line is no longer centred').toBe('center');
  });
});
