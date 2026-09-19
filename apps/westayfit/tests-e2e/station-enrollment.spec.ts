/**
 * STATION ENROLMENT — a Champion-authorized second screen at an event.
 *
 * What this proves, end to end and in a real browser:
 *
 *   1. A screen opened on the station address is NOT enrolled by opening it.
 *      It shows a code and waits. The address it was opened on carries a goal
 *      id and nothing else.
 *   2. Only the Champion's own control, with that code, enrols it — and the
 *      slot (Station 1 / Station 2) is the Champion's choice.
 *   3. THE QUALITY BAR: neither attendee QR carries the station's secret, and
 *      SCANNING EITHER ONE ENROLS NOTHING AND GRANTS NOTHING. Both are opened
 *      in fresh browsers here, and both land on an ordinary page with no
 *      credential, no station screen and no Champion control.
 *   4. Revoking from across the hall empties the screen: its next poll is
 *      refused, it clears its own storage, and it falls back to asking again.
 *   5. A goal that is not authorized for public display refuses a station with
 *      the same words, byte for byte, that the kiosk refuses with.
 */
import { randomBytes } from 'node:crypto';

import { expect, test, type Browser, type Page } from '@playwright/test';

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const PROJECT_ID = 'demo-wsf-local';
const PASSWORD = 'station-secret-1';

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

/** A Champion with a community and one open goal. Same journey a person takes. */
async function championWithGoal(page: Page): Promise<{ groupId: string; goalId: string }> {
  const email = unique('station-champ');
  await page.goto('/signup');
  await page.getByTestId('wsf-signup-displayName').fill('Station Champion');
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
  await page.getByTestId('wsf-start-name').fill('Expo Hall Movers');
  // Anyone-with-the-link, deliberately: the newcomer QR on the station screen
  // only exists for a community that admits by link at all, because the server
  // hands the screen a code only in that case. A private community's station
  // shows no newcomer symbol, which is the other half of the same rule.
  await page.getByTestId('wsf-start-joinPolicy-public').click();
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
  await page.getByTestId('wsf-community-manage').click();
  await expect(page.getByTestId('wsf-community-manage-panel')).toBeVisible({ timeout: 15_000 });
}

async function authorizeDisplay(page: Page, goalId: string): Promise<void> {
  await page.getByTestId(`wsf-goal-display-auth-toggle-${goalId}`).click();
  await expect(page.getByTestId(`wsf-goal-display-auth-state-${goalId}`)).toContainText(
    'Public display is authorized',
    { timeout: 20_000 }
  );
}

/** A screen at the event: a brand-new browser with no session and no history,
 * which is also what proves the Hosting rewrite resolves /station/<goalId>. */
/**
 * The station page runs in its own context, so a crash on it is invisible to
 * the Champion's page and shows up here only as a testID that never appears.
 * A screen standing blank in an expo hall is the worst failure this route can
 * have, so anything it throws is surfaced as the failure instead of hidden
 * behind a locator timeout.
 */
async function openStationScreen(browser: Browser, url: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') crashes.push(`console.error: ${m.text()}`);
  });
  await page.goto(url);
  const assertNoCrash = () => {
    if (crashes.length) throw new Error(`the station screen crashed:\n${crashes.join('\n')}`);
  };
  return { context, page, crashes, assertNoCrash };
}

test('a Champion enrols a screen, the attendee codes grant nothing, and revoking empties the screen', async ({
  page,
  browser,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { goalId } = await championWithGoal(page);
  await openManage(page);
  await authorizeDisplay(page, goalId);

  const card = page.getByTestId(`wsf-kiosk-stations-${goalId}`);
  await expect(card).toBeVisible();
  await expect(card).toContainText('Screens at this event');
  await expect(page.getByTestId(`wsf-kiosk-stations-empty-${goalId}`)).toBeVisible({
    timeout: 20_000,
  });

  // THE STATION ADDRESS. Copied the way a person copies it, then read back off
  // the clipboard rather than assumed.
  await page.getByTestId(`wsf-kiosk-stations-copy-${goalId}`).click();
  await expect(page.getByTestId(`wsf-kiosk-stations-copy-${goalId}`)).toHaveText('Copied');
  const stationUrl = (await page.evaluate(() => navigator.clipboard.readText())).trim();
  const origin = new URL(page.url()).origin;
  expect(stationUrl).toBe(`${origin}/station/${goalId}`);
  // It carries a goal id and nothing else: no token, no code, no authority.
  expect(new URL(stationUrl).search).toBe('');
  expect(new URL(stationUrl).hash).toBe('');

  // 1. OPENING THE ADDRESS ENROLS NOTHING. The screen asks.
  const station = await openStationScreen(browser, stationUrl);
  await expect(station.page.getByTestId('wsf-station-pairing')).toBeVisible({ timeout: 25_000 });
  const codeText = await station.page.getByTestId('wsf-station-pairing-code').innerText();
  const code = codeText.replace(/\s+/g, '');
  expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  // Nothing has been granted yet.
  const beforeApproval = await station.page.evaluate(() =>
    window.localStorage.getItem('wsf.stationCredential')
  );
  expect(beforeApproval).toBeNull();

  // 2. THE CHAMPION APPROVES IT, AS STATION 2.
  await page.getByTestId(`wsf-kiosk-stations-code-${goalId}`).fill(code);
  await page.getByTestId(`wsf-kiosk-stations-slot-2-${goalId}`).click();
  await page.getByTestId(`wsf-kiosk-stations-approve-${goalId}`).click();
  await expect(page.getByTestId(`wsf-kiosk-stations-notice-${goalId}`)).toContainText(
    'Station 2 is approved',
    { timeout: 25_000 }
  );

  // The screen claims once and becomes the event screen.
  await expect(station.page.getByTestId('wsf-station-screen'))
    .toBeVisible({ timeout: 30_000 })
    .catch(async (e) => {
      station.assertNoCrash();
      // What the screen IS showing, since a testID that never appears says
      // nothing about which of the other states it settled into.
      const shown = await station.page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid]'))
          .map((el) => (el as HTMLElement).dataset.testid)
          .filter((id): id is string => Boolean(id))
          .join(', ')
      );
      const text = (await station.page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 400);
      throw new Error(`${(e as Error).message}\n\nstation testIDs: ${shown}\nstation text: ${text}`);
    });
  await expect(station.page.getByTestId('wsf-station-label')).toHaveText('Station 2');
  await expect(station.page.getByTestId('wsf-station-community')).toContainText('Expo Hall Movers');
  await expect(station.page.getByTestId('wsf-station-goal-title')).toContainText(
    'Expo Squat Challenge'
  );

  // 3. THE QUALITY BAR. The credential this screen now holds appears in
  // neither QR, and neither QR is a way to become a station or a Champion.
  const stored = await station.page.evaluate(() =>
    window.localStorage.getItem('wsf.stationCredential')
  );
  expect(stored).toBeTruthy();
  const secret = (JSON.parse(stored!) as { secret: string }).secret;
  expect(secret.length).toBeGreaterThanOrEqual(32);

  const joinQrUrl = (await station.page
    .getByTestId('wsf-station-qr-join')
    .getAttribute('data-qr-url'))!;
  const memberQrUrl = (await station.page
    .getByTestId('wsf-station-qr-member')
    .getAttribute('data-qr-url'))!;
  expect(memberQrUrl).toBe(`${origin}/event/${goalId}`);
  expect(joinQrUrl).toContain(`${origin}/join/`);
  expect(new URL(joinQrUrl).searchParams.get('event')).toBe(goalId);
  for (const url of [joinQrUrl, memberQrUrl, station.page.url()]) {
    expect(url).not.toContain(secret);
  }

  // SCANNING THE MEMBER CODE: an ordinary page on an attendee's own phone. No
  // station, no credential, no Champion control.
  const scanner = await browser.newContext();
  const scannerPage = await scanner.newPage();
  await scannerPage.goto(memberQrUrl);
  await expect(scannerPage.getByTestId('wsf-event-signed-out')).toBeVisible({ timeout: 25_000 });
  expect(
    await scannerPage.evaluate(() => window.localStorage.getItem('wsf.stationCredential'))
  ).toBeNull();
  await expect(scannerPage.getByTestId('wsf-station-screen')).toHaveCount(0);
  await expect(scannerPage.getByTestId('wsf-community-manage')).toHaveCount(0);

  // SCANNING THE NEWCOMER CODE: the ordinary join page, which still asks for
  // an account. It enrols no screen either.
  await scannerPage.goto(joinQrUrl);
  await expect(scannerPage.getByTestId('wsf-join-signed-out')).toBeVisible({ timeout: 25_000 });
  expect(
    await scannerPage.evaluate(() => window.localStorage.getItem('wsf.stationCredential'))
  ).toBeNull();
  await expect(scannerPage.getByTestId('wsf-station-screen')).toHaveCount(0);
  await scanner.close();

  // 4. REVOKE FROM ACROSS THE HALL.
  await expect(page.getByTestId(`wsf-kiosk-stations-list-${goalId}`)).toContainText('Station 2', {
    timeout: 25_000,
  });
  const revoke = page.locator('[data-testid^="wsf-kiosk-stations-revoke-"]').first();
  await revoke.click();
  await expect(page.getByTestId(`wsf-kiosk-stations-notice-${goalId}`)).toContainText('revoked', {
    timeout: 25_000,
  });

  // The screen's next poll is refused; it empties itself and asks again.
  await expect(station.page.getByTestId('wsf-station-pairing')).toBeVisible({ timeout: 30_000 });
  expect(
    await station.page.evaluate(() => window.localStorage.getItem('wsf.stationCredential'))
  ).toBeNull();
  await station.context.close();
});

test('a station on a goal that is not authorized for display refuses in the kiosk’s own words', async ({
  page,
  browser,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { goalId } = await championWithGoal(page);
  await openManage(page);
  await authorizeDisplay(page, goalId);

  const origin = new URL(page.url()).origin;
  const stationUrl = `${origin}/station/${goalId}`;
  const station = await openStationScreen(browser, stationUrl);
  await expect(station.page.getByTestId('wsf-station-pairing')).toBeVisible({ timeout: 25_000 });
  const code = (await station.page.getByTestId('wsf-station-pairing-code').innerText()).replace(
    /\s+/g,
    ''
  );
  await page.getByTestId(`wsf-kiosk-stations-code-${goalId}`).fill(code);
  await page.getByTestId(`wsf-kiosk-stations-approve-${goalId}`).click();
  await expect(station.page.getByTestId('wsf-station-screen'))
    .toBeVisible({ timeout: 30_000 })
    .catch(async (e) => {
      station.assertNoCrash();
      // What the screen IS showing, since a testID that never appears says
      // nothing about which of the other states it settled into.
      const shown = await station.page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid]'))
          .map((el) => (el as HTMLElement).dataset.testid)
          .filter((id): id is string => Boolean(id))
          .join(', ')
      );
      const text = (await station.page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 400);
      throw new Error(`${(e as Error).message}\n\nstation testIDs: ${shown}\nstation text: ${text}`);
    });

  // The Champion takes the display permission away. An enrolled screen is not
  // a second permission: it shows what a public display may show, and nothing
  // more, so it goes dark in exactly the same words.
  await page.getByTestId(`wsf-goal-display-auth-toggle-${goalId}`).click();
  await expect(page.getByTestId(`wsf-goal-display-auth-state-${goalId}`)).toContainText(
    'Public display is not authorized',
    { timeout: 20_000 }
  );

  const refusal = station.page.getByTestId('wsf-station-not-available');
  await expect(refusal).toBeVisible({ timeout: 30_000 });
  await expect(refusal).toContainText('Nothing to show here');
  await expect(refusal).toContainText('This display isn’t currently available.');

  // Byte-identical to the kiosk's refusal for the same goal, on the same build.
  const kiosk = await browser.newContext();
  const kioskPage = await kiosk.newPage();
  await kioskPage.goto(`${origin}/kiosk/${goalId}`);
  const kioskRefusal = kioskPage.getByTestId('wsf-kiosk-not-available');
  await expect(kioskRefusal).toBeVisible({ timeout: 25_000 });
  expect((await refusal.innerText()).includes('Nothing to show here')).toBe(true);
  expect((await kioskRefusal.innerText()).includes('Nothing to show here')).toBe(true);
  await kiosk.close();
  await station.context.close();
});
