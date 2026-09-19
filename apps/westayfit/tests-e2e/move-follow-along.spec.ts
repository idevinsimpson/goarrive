/**
 * THE FOLLOW-ALONG SCREEN at /move/<goalId>.
 *
 * What these tests are really guarding: the screen helps someone move and then
 * gets out of the way. It must never count for them, never record anything,
 * and never claim a video exists — there is no movement video catalog in this
 * repository, so the screen draws its own figure.
 */
import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const PROJECT_ID = 'demo-wsf-local';
const PASSWORD = 'move-secret-1';

const unique = (label: string) => `${label}-${randomBytes(6).toString('hex')}@example.com`;

async function markEmailVerified(email: string): Promise<void> {
  const base = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1`;
  const lookup = await fetch(`${base}/projects/${PROJECT_ID}/accounts:query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({}),
  });
  const { userInfo = [] } = (await lookup.json()) as { userInfo?: { localId: string; email: string }[] };
  const user = userInfo.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`no emulator account for ${email}`);
  await fetch(`${base}/projects/${PROJECT_ID}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ localId: user.localId, emailVerified: true }),
  });
}

async function championWithGoal(page: Page): Promise<string> {
  const email = unique('move-champ');
  await page.goto('/signup');
  await page.getByTestId('wsf-signup-displayName').fill('Move Champion');
  await page.getByTestId('wsf-signup-email').fill(email);
  await page.getByTestId('wsf-signup-password').fill(PASSWORD);
  const sendSettled = page.waitForResponse((r) => r.url().includes('wsfSendVerificationEmail'));
  await page.getByTestId('wsf-signup-submit').click();
  await expect(page.getByTestId('wsf-verify')).toBeVisible({ timeout: 20_000 });
  await sendSettled;
  await markEmailVerified(email);
  await page.getByTestId('wsf-verify-check').click();
  await expect(page.getByTestId('wsf-profile')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-profile-termsCheckbox').click();
  await page.getByTestId('wsf-profile-submit').click();
  await expect(page.getByTestId('wsf-home-signed-in')).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('wsf-home-start').click();
  await expect(page.getByTestId('wsf-start')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-start-name').fill('Follow Along Crew');
  await page.getByTestId('wsf-start-submit').click();
  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 25_000 });

  await page.getByTestId('wsf-community-start-goal').click();
  await expect(page.getByTestId('wsf-new-goal-form')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-new-goal-title').fill('Expo Squats');
  await page.getByTestId('wsf-new-goal-target').fill('5000');
  await page.getByTestId('wsf-new-goal-unit').fill('squats');
  await page.getByTestId('wsf-new-goal-submit').click();
  const created = page.getByTestId('wsf-new-goal-created');
  await expect(created).toBeVisible({ timeout: 25_000 });
  return (await created.getAttribute('data-goal-id')) ?? '';
}

test('the follow-along runs, pauses, stops, and never counts for anyone', async ({ page }) => {
  const goalId = await championWithGoal(page);
  await page.goto(`/move/${goalId}`);

  await expect(page.getByTestId('wsf-move-screen')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('wsf-move-heading')).toHaveText('Follow along');

  // It opens on "get ready", not mid-movement, and it is not running yet.
  await expect(page.getByTestId('wsf-move-step-title')).toHaveText('Get ready');
  await expect(page.getByTestId('wsf-move-start')).toBeVisible();

  // A figure is drawn by this app, not fetched from anywhere.
  // react-native-web renders an Image as a View carrying the testID with a
  // hidden <img> inside holding the URI, which is where a src actually exists.
  const figure = page.locator('[data-testid="wsf-move-figure-image"] img').first();
  await expect(figure).toHaveCount(1, { timeout: 15_000 });
  const figureSrc = await figure.getAttribute('src');
  expect(figureSrc ?? '').toContain('data:image/svg+xml');

  // START: the clock actually moves.
  const readSeconds = async () =>
    Number((await page.getByTestId('wsf-move-timer').innerText()).replace(/\D+/g, '') || '0');
  const before = await readSeconds();
  await page.getByTestId('wsf-move-start').click();
  await expect(page.getByTestId('wsf-move-pause')).toBeVisible();
  await page.waitForTimeout(2_200);
  const during = await readSeconds();
  expect(during).toBeLessThan(before);

  // PAUSE: the clock holds where it was.
  await page.getByTestId('wsf-move-pause').click();
  await expect(page.getByTestId('wsf-move-start')).toHaveText('Resume');
  const paused = await readSeconds();
  await page.waitForTimeout(1_500);
  expect(await readSeconds()).toBe(paused);

  // STOP: back to the beginning, nothing kept.
  await page.getByTestId('wsf-move-stop').click();
  await expect(page.getByTestId('wsf-move-step-title')).toHaveText('Get ready');
  await expect(page.getByTestId('wsf-move-start')).toHaveText('Start');

  // The screen says who is counting, and offers the place to add it. It does
  // not record, and there is no control here that could.
  await expect(page.getByTestId('wsf-move-self-count')).toContainText('You count your own');
  await expect(page.getByTestId('wsf-move-contribute')).toHaveAttribute(
    'href',
    `/contribute/${goalId}`
  );
  await expect(page.getByTestId('wsf-move-screen')).not.toContainText('Record');
});

test('the two lengths differ, and choosing one starts it over', async ({ page }) => {
  const goalId = await championWithGoal(page);
  await page.goto(`/move/${goalId}`);
  await expect(page.getByTestId('wsf-move-screen')).toBeVisible({ timeout: 25_000 });

  const total = async () => (await page.getByTestId('wsf-move-round').innerText()).trim();
  const short = await total();
  await page.getByTestId('wsf-move-length-full').click();
  await expect(page.getByTestId('wsf-move-length-full')).toHaveAttribute('aria-checked', 'true');
  const full = await total();
  expect(full).not.toBe(short);

  // Switching length is a fresh start, never a half-finished plan carried over.
  await page.getByTestId('wsf-move-start').click();
  await page.waitForTimeout(1_200);
  await page.getByTestId('wsf-move-length-short').click();
  await expect(page.getByTestId('wsf-move-step-title')).toHaveText('Get ready');
  await expect(page.getByTestId('wsf-move-start')).toHaveText('Start');
});

test('a goal this screen cannot read says so, and offers nothing it cannot back up', async ({
  page,
}) => {
  await page.goto('/move/not-a-real-goal-id');
  await expect(page.getByTestId('wsf-move-not-available')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('wsf-move-start')).toHaveCount(0);
  await expect(page.getByTestId('wsf-move-timer')).toHaveCount(0);
});
