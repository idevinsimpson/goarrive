/**
 * SET UP KIOSK — the Champion's control for the screen at an event.
 *
 * The owner asked for a control, not a hand-assembled URL, and asked that a
 * copied link be opened in a fresh browser. So this test copies the link the
 * way a person would, reads what actually landed on the clipboard, and then
 * opens that exact string in a brand-new browser context with no session and
 * no history — which is also what proves the static export's Hosting rewrite
 * resolves `/kiosk/<goalId>` on a cold load.
 */
import { randomBytes } from 'node:crypto';

import { expect, test, type Browser, type Page } from '@playwright/test';

import { clearVerifyGate } from './helpers/mobile';
import { openMemberManage } from './helpers/memberShell';

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const PROJECT_ID = 'demo-wsf-local';
const PASSWORD = 'kiosk-secret-1';

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

/** A Champion with a community and one open goal, ready to set up a kiosk. */
async function championWithGoal(page: Page): Promise<{ groupId: string; goalId: string }> {
  const email = unique('kiosk-champ');
  await page.goto('/signup');
  await page.getByTestId('wsf-signup-displayName').fill('Kiosk Champion');
  await page.getByTestId('wsf-signup-email').fill(email);
  await page.getByTestId('wsf-signup-password').fill(PASSWORD);
  const sendSettled = page.waitForResponse((r) => r.url().includes('wsfSendVerificationEmail'));
  await page.getByTestId('wsf-signup-submit').click();
  await expect(page.getByTestId('wsf-verify')).toBeVisible({ timeout: 20_000 });
  await sendSettled;
  await markEmailVerified(email);
  await clearVerifyGate(page, 'wsf-profile', 20_000);
  await page.getByTestId('wsf-profile-termsCheckbox').click();
  await page.getByTestId('wsf-profile-submit').click();
  await expect(page.getByTestId('wsf-home-signed-in')).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('wsf-home-start').click();
  await expect(page.getByTestId('wsf-start')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-start-name').fill('Expo Hall Movers');
  await page.getByTestId('wsf-start-submit').click();
  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 25_000 });
  const groupId = new URL(page.url()).pathname.split('/').filter(Boolean).pop()!;

  await page.getByTestId('wsf-community-start-goal').click();
  await expect(page.getByTestId('wsf-new-goal-form')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-new-goal-title').fill('Expo Squat Challenge');
  await page.getByTestId('wsf-new-goal-target').fill('5000');
  await page.getByTestId('wsf-new-goal-unit').fill('squats');
  await page.getByTestId('wsf-new-goal-submit').click();
  const created = page.getByTestId('wsf-new-goal-created');
  await expect(created).toBeVisible({ timeout: 25_000 });
  const goalId = (await created.getAttribute('data-goal-id')) ?? '';
  expect(goalId).toMatch(/^\S+$/);

  await page.goto(`/community/${groupId}`);
  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 20_000 });
  return { groupId, goalId };
}

async function openManage(page: Page): Promise<void> {
  await openMemberManage(page);
  await expect(page.getByTestId('wsf-community-manage-panel')).toBeVisible({ timeout: 15_000 });
}

test('a Champion can open and copy a kiosk link, and the copied link opens in a fresh browser', async ({
  page,
  browser,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { goalId } = await championWithGoal(page);
  await openManage(page);

  const setup = page.getByTestId(`wsf-kiosk-setup-${goalId}`);
  await expect(setup).toBeVisible();
  // The block's heading is now the goal's own name, one level up: "Set up
  // kiosk" is the card that holds every goal's address, and repeating it on
  // each goal said nothing. What must be IN this block is the action.
  await expect(setup).toContainText('Open kiosk');

  // Before the display permission is granted the control still works, and
  // says what the screen will actually show.
  await expect(page.getByTestId(`wsf-kiosk-setup-intro-${goalId}`)).toContainText(
    'will say the goal is not available'
  );

  await page.getByTestId(`wsf-goal-display-auth-toggle-${goalId}`).click();
  await expect(page.getByTestId(`wsf-goal-display-auth-state-${goalId}`)).toContainText(
    'Public display is authorized',
    { timeout: 20_000 }
  );
  await expect(page.getByTestId(`wsf-kiosk-setup-intro-${goalId}`)).toContainText(
    'Open this on the screen at your event'
  );

  // COPY: read what actually reached the clipboard, not what we hoped would.
  await page.getByTestId(`wsf-kiosk-setup-copy-${goalId}`).click();
  await expect(page.getByTestId(`wsf-kiosk-setup-copy-${goalId}`)).toHaveText('Copied');
  const copied = (await page.evaluate(() => navigator.clipboard.readText())).trim();

  const origin = new URL(page.url()).origin;
  expect(copied).toBe(`${origin}/kiosk/${goalId}`);
  // The control and the link agree; neither is assembled by hand.
  const advertised = await setup.locator('[data-kiosk-url]').getAttribute('data-kiosk-url');
  expect(advertised).toBe(copied);

  // OPEN IT COLD. A new context has no session, no storage and no history, so
  // this is the event-day case: a screen that has never seen the app opening a
  // pasted address. It also proves the Hosting rewrite resolves the deep link.
  const fresh = await browser.newContext();
  const kioskPage = await fresh.newPage();
  await kioskPage.goto(copied);
  await expect(kioskPage.getByTestId('wsf-kiosk-screen')).toBeVisible({ timeout: 25_000 });
  await expect(kioskPage.getByTestId('wsf-kiosk-community')).toContainText('Expo Hall Movers');
  await expect(kioskPage.getByTestId('wsf-kiosk-start')).toBeVisible();
  await fresh.close();
});

test('the Open kiosk control goes to the kiosk itself', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { goalId } = await championWithGoal(page);
  await openManage(page);
  await expect(page.getByTestId(`wsf-kiosk-setup-open-${goalId}`)).toHaveAttribute(
    'href',
    `/kiosk/${goalId}`
  );
});
