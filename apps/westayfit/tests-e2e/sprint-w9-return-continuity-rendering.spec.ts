import { expect, test, type Page } from '@playwright/test';

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
 * W9 — RETURN-CONTINUITY-1: A REFRESH THAT FAILS AFTER A RETURN IS SAID
 * (L0 #477 `5826542101`; W7 Check 27 item 9).
 *
 * On the base a failed progress read left the figure and its "Confirmed h:mm"
 * standing with no word, so a member back from contributing could not tell a
 * fresh reading from a stale one. The contract, asserted here:
 *   · the retained figure stays, and so does its "Confirmed h:mm";
 *   · the hero's pill says "Last known", a polite line beside the figure says
 *     the refresh failed and offers Retry, and the own row says it is the
 *     last-known contribution;
 *   · Retry is the existing refresh, and the next read that lands clears all
 *     of it;
 *   · a healthy return says none of it, and a first read that fails keeps the
 *     existing error (there is no figure to call "last known").
 *
 * The failures are LABELLED INJECTIONS: `wsfGoalPulse` is aborted in the
 * browser. Everything seeded here is SYNTHETIC. Chromium, local emulators.
 */

const PASSWORD = 'Sup3rSecret!23';
const PHONE = { width: 390, height: 844 };
const TOTAL = 1847;

type Fx = { email: string; groupId: string; goalIds: string[] };

async function seed(tag: string, goals = 1): Promise<Fx> {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-w9-rcr-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `w9rcr-${stamp}`;
  const dana = `w9rcr-dana-${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'private',
    members: [{ uid, role: 'member' }],
  });
  await seedMembership(groupId, dana, 'foundingChampion');
  const goalIds: string[] = [];
  for (let i = 0; i < goals; i += 1) {
    const goalId = `w9rcrgoal${i}-${stamp}`;
    await seedActiveGoal({
      goalId,
      groupId,
      ownerUid: dana,
      title: i === 0 ? 'October Squat Challenge' : 'Lunchtime Laps',
      target: 5000,
      unit: i === 0 ? 'squats' : 'laps',
      total: TOTAL,
      endsAt: new Date(Date.now() + (7 + i) * 24 * 60 * 60_000),
    });
    goalIds.push(goalId);
  }
  return { email, groupId, goalIds };
}

const shown = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).first();

async function returnFromContributing(page: Page, fx: Fx): Promise<void> {
  await page.goto(`/community/${fx.groupId}`);
  const launcher = shown(page, `wsf-community-goal-record-${fx.goalIds[0]}`);
  await expect(launcher).toBeVisible({ timeout: 60_000 });
  await launcher.click();
  await shown(page, 'wsf-contribute-entry').fill('20');
  await shown(page, 'wsf-contribute-review').click();
  await shown(page, 'wsf-contribute-submit').click();
  await expect(shown(page, 'wsf-contribute-receipt')).toBeVisible({ timeout: 40_000 });
}

async function pressBackToCommunity(page: Page, fx: Fx): Promise<void> {
  const exit = shown(page, 'wsf-contribute-back');
  await expect(exit).toHaveText('Back to community', { timeout: 30_000 });
  await exit.click();
  await expect(shown(page, `wsf-community-goal-total-${fx.goalIds[0]}`)).toBeVisible({ timeout: 40_000 });
}

async function refusePulse(page: Page): Promise<void> {
  await page.route('**/wsfGoalPulse', (route) => route.abort('failed'));
}

/**
 * Progress reads in flight. `page.route` only refuses reads made after it is
 * installed, so a settle read already on its way would land AFTER a refused
 * Refresh and (correctly) clear the marker: the test waits for quiet first.
 */
function trackPulse(page: Page): { inFlight: () => number } {
  let n = 0;
  const isPulse = (url: string, method: string) => url.includes('/wsfGoalPulse') && method === 'POST';
  page.on('request', (r) => {
    if (isPulse(r.url(), r.method())) n += 1;
  });
  const done = (r: { url(): string; method(): string }) => {
    if (isPulse(r.url(), r.method())) n -= 1;
  };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return { inFlight: () => n };
}

async function quietPulse(page: Page, pulse: { inFlight: () => number }): Promise<void> {
  await expect.poll(() => pulse.inFlight(), { timeout: 20_000, message: 'progress reads still in flight' }).toBe(0);
  await page.waitForTimeout(300);
  await expect.poll(() => pulse.inFlight(), { timeout: 20_000 }).toBe(0);
}

test.describe('RETURN-CONTINUITY-1 · a failed refresh after a return is said', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 2 });

  test('Refresh fails: the figure and its stamp stay, the hero says “Last known”, and Retry clears it once a read lands', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('r', 2);
    const pulse = trackPulse(page);
    await signInVia(page, fx.email, PASSWORD);
    await returnFromContributing(page, fx);
    await pressBackToCommunity(page, fx);
    const [featured, other] = fx.goalIds as [string, string];
    await expect(shown(page, `wsf-community-goal-total-${featured}`)).toContainText('1,867', { timeout: 20_000 });
    await page.waitForTimeout(3_500); // past the settle's issue
    await quietPulse(page, pulse);
    const total = await shown(page, `wsf-community-goal-total-${featured}`).innerText();
    const stamp = await shown(page, 'wsf-community-progress-updated').innerText();
    await expect(page.locator(`[data-testid="wsf-community-goal-stale-${featured}"]`)).toHaveCount(0);
    // The announcement region is already there, and empty, before anything fails.
    const status = page.locator(`[data-testid="wsf-community-goal-stale-status-${featured}"]`).last();
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await expect(status).toHaveText('');

    await refusePulse(page);
    await shown(page, 'wsf-community-progress-refresh').click();

    const notice = shown(page, `wsf-community-goal-stale-${featured}`);
    await expect(notice, 'the failed refresh is said').toBeVisible({ timeout: 15_000 });
    await expect(notice).toContainText('Couldn’t refresh. This is the last confirmed figure.');
    // Announced through the region that was waiting for it, without Retry.
    await expect(status).toHaveText('Couldn’t refresh. This is the last confirmed figure.');
    await expect(shown(page, `wsf-community-goal-last-known-${featured}`)).toHaveText('Last known');
    await expect(page.locator(`[data-testid="wsf-community-goal-period-${featured}"]:visible`)).toHaveCount(0);
    await expect(shown(page, `wsf-community-your-part-${featured}`)).toContainText('Your last-known contribution');
    await expect(shown(page, `wsf-community-goal-total-${featured}`), 'the retained figure stays').toHaveText(total);
    await expect(shown(page, 'wsf-community-progress-updated'), 'its stamp does not advance').toHaveText(stamp);
    // The other open goal's card says it too.
    await expect(shown(page, `wsf-community-goal-stale-${other}`)).toBeVisible();
    // Retry, while the reads still fail: nothing changes, nothing breaks.
    const retry = shown(page, `wsf-community-goal-stale-retry-${featured}`);
    await expect(retry).toHaveText('Retry');
    await retry.focus();
    const asked = page.waitForRequest((r) => r.url().includes('/wsfGoalPulse') && r.method() === 'POST');
    await page.keyboard.press('Enter');
    await asked; // Retry really is a read
    await page.waitForTimeout(1_500);
    await expect(notice).toBeVisible();
    await expect(shown(page, `wsf-community-goal-total-${featured}`)).toHaveText(total);

    // The reads come back: Retry clears everything.
    await page.unroute('**/wsfGoalPulse');
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(`[data-testid="wsf-community-goal-stale-${featured}"]`), 'a landed read clears it').toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(page.locator(`[data-testid="wsf-community-goal-stale-${other}"]`)).toHaveCount(0);
    await expect(status).toHaveText('');
    await expect(shown(page, `wsf-community-goal-period-${featured}`)).toBeVisible();
    await expect(shown(page, `wsf-community-your-part-${featured}`)).toContainText('Your contribution');
    await expect(shown(page, `wsf-community-your-part-${featured}`)).not.toContainText('last-known');
    await expect(shown(page, 'wsf-community-progress-updated')).toHaveText(/^Confirmed \d{1,2}:\d{2}/);
  });

  test('the reads fail as the member comes back: Home says it without a press', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('b');
    await signInVia(page, fx.email, PASSWORD);
    await returnFromContributing(page, fx);
    // Refused from the receipt on, so the return's own read and the settle
    // both fail over the figure Home already had.
    await refusePulse(page);
    await pressBackToCommunity(page, fx);
    const notice = shown(page, `wsf-community-goal-stale-${fx.goalIds[0]}`);
    await expect(notice, 'the failed return read is said').toBeVisible({ timeout: 15_000 });
    await expect(shown(page, `wsf-community-goal-last-known-${fx.goalIds[0]}`)).toHaveText('Last known');
    // The retained figure is the one confirmed before the member left.
    await expect(shown(page, `wsf-community-goal-total-${fx.goalIds[0]}`)).toContainText('1,847');
    await expect(shown(page, 'wsf-community-progress-updated')).toHaveText(/^Confirmed \d{1,2}:\d{2}/);
  });
});

test.describe('RETURN-CONTINUITY-1 · nothing is said when nothing failed', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 2 });

  test('a healthy return says nothing about staleness', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('h');
    await signInVia(page, fx.email, PASSWORD);
    await returnFromContributing(page, fx);
    await pressBackToCommunity(page, fx);
    await page.waitForTimeout(4_000); // past the settle
    await expect(page.locator(`[data-testid="wsf-community-goal-stale-${fx.goalIds[0]}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-testid="wsf-community-goal-last-known-${fx.goalIds[0]}"]`)).toHaveCount(0);
    await expect(shown(page, `wsf-community-goal-period-${fx.goalIds[0]}`)).toBeVisible();
    await expect(shown(page, `wsf-community-your-part-${fx.goalIds[0]}`)).toContainText('Your contribution');
    const text = await shown(page, 'wsf-community').innerText();
    expect(text).not.toMatch(/last known|last-known|couldn’t refresh/i);
  });

  test('a first read that fails keeps the existing error: there is no figure to call last known', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('f');
    await signInVia(page, fx.email, PASSWORD);
    await refusePulse(page);
    await page.goto(`/community/${fx.groupId}`);
    await expect(shown(page, `wsf-community-goal-progress-error-${fx.goalIds[0]}`)).toBeVisible({ timeout: 40_000 });
    // Past the settle, which also fails, over a slot that holds no figure.
    await page.waitForTimeout(3_500);
    await expect(shown(page, `wsf-community-goal-progress-error-${fx.goalIds[0]}`)).toBeVisible();
    await expect(page.locator(`[data-testid="wsf-community-goal-stale-${fx.goalIds[0]}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-testid="wsf-community-goal-last-known-${fx.goalIds[0]}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-testid="wsf-community-goal-total-${fx.goalIds[0]}"]`)).toHaveCount(0);
  });
});
