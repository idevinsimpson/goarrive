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
 * W9 — APP-FEEL-PARITY-1, CHECKPOINT 3 (ACK #477 `5840258940`).
 *
 * Community selection, against the reference's switcher (Lovable `a15a610e`,
 * screens/community.tsx): one chip per community, the current one pressed and
 * checked, and pressing another selects it in place, announced. Measured on
 * development `0b460ce3` before this checkpoint:
 *   · there are no chips; the only way to switch leaves the tab;
 *   · after a switch the mounted Community tab still names the OLD community
 *     as CURRENT;
 *   · Home keeps showing the community the member switched away from.
 *
 * Everything seeded here is SYNTHETIC. Chromium, local emulators.
 */

const PASSWORD = 'Sup3rSecret!23';
const PHONE = { width: 390, height: 844 };
const SHORT = { width: 390, height: 640 };

type Fx = { email: string; uid: string; a: string; b: string };

async function seed(tag: string): Promise<Fx> {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-w9-afp3-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Alex Rivera');
  const a = `w9afp3a-${stamp}`;
  const b = `w9afp3b-${stamp}`;
  await seedCommunity({ groupId: a, displayName: 'Alpharetta Morning Movers', joinPolicy: 'private', members: [{ uid, role: 'member' }] });
  await seedCommunity({ groupId: b, displayName: 'Roswell Lunch Walkers', joinPolicy: 'private', members: [{ uid, role: 'member' }] });
  await seedActiveGoal({
    goalId: `w9afp3g-${stamp}`,
    groupId: a,
    ownerUid: uid,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total: 1847,
    endsAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
  });
  return { email, uid, a, b };
}

function measure(label: string, value: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`MEASURE ${label}: ${JSON.stringify(value)}`);
  test.info().annotations.push({ type: 'measure', description: `${label}: ${JSON.stringify(value)}` });
}

async function currentTab(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('[data-testid^="wsf-member-tab-"][data-current="true"]')).find(
      (n) => (n as HTMLElement).getClientRects().length > 0,
    );
    return el?.getAttribute('data-testid') ?? null;
  });
}

async function currentPanelName(page: Page): Promise<string> {
  return page
    .locator('[data-testid="wsf-community-index-current"]:visible')
    .first()
    .innerText()
    .catch(() => '');
}

async function openCommunityTab(page: Page): Promise<void> {
  await page.getByTestId('wsf-member-tab-community').last().click();
  await expect(page.locator('[data-testid="wsf-community-index-rows"]:visible')).toBeVisible({ timeout: 40_000 });
}

for (const vp of [PHONE, SHORT]) {
  test.describe(`APP-FEEL-PARITY-1 cp3 · community chips · ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp, deviceScaleFactor: 1 });

    test('one chip per community, the current one pressed; another selects it in place, announced, keyboard too', async ({ page }) => {
      test.setTimeout(240_000);
      const fx = await seed(`c${vp.height}`);
      await signInVia(page, fx.email, PASSWORD);
      await page.goto(`/community/${fx.a}`);
      await expect(page.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 60_000 });
      await openCommunityTab(page);

      const chipA = page.locator(`[data-testid="wsf-community-index-chip-${fx.a}"]:visible`);
      const chipB = page.locator(`[data-testid="wsf-community-index-chip-${fx.b}"]:visible`);
      await expect(chipA).toBeVisible({ timeout: 20_000 });
      await expect(chipA).toHaveAttribute('aria-pressed', 'true');
      await expect(chipB).toHaveAttribute('aria-pressed', 'false');
      const box = await chipB.boundingBox();
      measure('chip B box', box);
      expect(box!.height, 'a 44 px target').toBeGreaterThanOrEqual(44);

      await chipB.focus();
      await page.keyboard.press('Enter');
      await expect(chipB).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
      await expect(chipA).toHaveAttribute('aria-pressed', 'false');
      expect(await currentTab(page), 'still on the Community tab').toBe('wsf-member-tab-community');
      await expect.poll(() => currentPanelName(page), { timeout: 20_000 }).toContain('Roswell Lunch Walkers');
      await expect(page.getByTestId('wsf-community-index-announce')).toHaveText('Now showing Roswell Lunch Walkers.');

      // And back, by pointer.
      await chipA.click();
      await expect(chipA).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
      await expect.poll(() => currentPanelName(page), { timeout: 20_000 }).toContain('Alpharetta Morning Movers');
    });

    test('Home follows the chosen community; the Community tab is never stale after a switch', async ({ page }) => {
      test.setTimeout(240_000);
      const fx = await seed(`h${vp.height}`);
      await signInVia(page, fx.email, PASSWORD);
      await page.goto(`/community/${fx.a}`);
      await expect(page.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 60_000 });
      await openCommunityTab(page);
      await page.locator(`[data-testid="wsf-community-index-chip-${fx.b}"]:visible`).click();
      await expect.poll(() => currentPanelName(page), { timeout: 20_000 }).toContain('Roswell Lunch Walkers');

      await page.getByTestId('wsf-member-tab-home').last().click();
      await expect(page.locator('[data-testid="wsf-community-name"]:visible')).toHaveText('Roswell Lunch Walkers', { timeout: 40_000 });
      const homeInstances = await page.locator('[data-testid="wsf-community"]').count();
      const tabBars = await page.locator('[data-testid="wsf-member-tab-home"]').count();
      measure('Home after choosing B', { path: new URL(page.url()).pathname, homeInstances, tabBars });
      expect(tabBars, 'one tab navigator').toBe(1);
      expect(new URL(page.url()).pathname).toBe(`/community/${fx.b}`);

      // Switch back through Home's own Switch → the list's row A → Community tab
      // must say CURRENT: A.
      await openCommunityTab(page);
      await page.locator(`[data-testid="wsf-community-index-chip-${fx.a}"]:visible`).click();
      await page.getByTestId('wsf-member-tab-home').last().click();
      await expect(page.locator('[data-testid="wsf-community-name"]:visible')).toHaveText('Alpharetta Morning Movers', { timeout: 40_000 });
      await openCommunityTab(page);
      await expect.poll(() => currentPanelName(page), { timeout: 20_000 }).toContain('Alpharetta Morning Movers');
      await expect(page.locator(`[data-testid="wsf-community-index-chip-${fx.a}"]:visible`)).toHaveAttribute('aria-pressed', 'true');
    });
  });
}

test.describe('APP-FEEL-PARITY-1 cp3 · CURRENT after a switch made elsewhere', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 1 });

  test('switching through a row (which opens that community’s Home) and coming back: CURRENT is the new one', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('r');
    await signInVia(page, fx.email, PASSWORD);
    await page.goto(`/community/${fx.a}`);
    await expect(page.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 60_000 });
    await openCommunityTab(page);
    await page.locator(`[data-testid="wsf-community-index-row-${fx.b}"]:visible`).click();
    await expect(page.locator('[data-testid="wsf-community-name"]:visible')).toHaveText('Roswell Lunch Walkers', { timeout: 40_000 });
    await openCommunityTab(page);
    await expect.poll(() => currentPanelName(page), { timeout: 20_000 }).toContain('Roswell Lunch Walkers');
    await expect(page.locator(`[data-testid="wsf-community-index-row-${fx.a}"]:visible`)).toBeVisible();
  });
});
