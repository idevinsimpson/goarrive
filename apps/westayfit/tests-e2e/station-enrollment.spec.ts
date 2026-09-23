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
 *
 * CAPTURES — the same shape as tests-e2e/move-follow-along.spec.ts, written to
 * tests-e2e/artifacts/station-enrollment/. A station is a venue display, so
 * every station state is shot at 1280x720, the composition the screen is
 * actually designed for, AND at the three phone widths plus a short phone, so
 * the narrow fallback is visible too. Nothing below asserts on an image: a
 * capture is evidence, never a reason to pass.
 *
 * WHAT IS DELIBERATELY NOT IN FRAME. The station's secret lives in
 * localStorage and is never rendered, so it cannot be photographed. The
 * Champion's Manage sheet DOES render this community's live invite link and
 * its QR (`wsf-community-invite-link`), so the "Screens at this event" capture
 * is scoped to that card's own element rather than to the page — a full-page
 * shot of Manage would put a join code in the picture. The pairing code is on
 * screen by design and expires in ten minutes, which is why capturing the
 * pairing state is fine.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

import { clearVerifyGate } from './helpers/mobile';
import { manageOffered, openMemberManage } from './helpers/memberShell';


// This journey was already long — two browser contexts, an enrolment, a
// revocation — and it now also writes eighteen captures across four
// viewports, each of which is a real re-layout. The default 30s budget is
// shorter than the work the test legitimately does, and when it expires it
// reports whichever line it happened to be on rather than a real failure.
// Raising the budget changes no assertion; both tests passed at 16-30s
// before the captures were added.
test.describe.configure({ timeout: 180_000 });
const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const PROJECT_ID = 'demo-wsf-local';
const PASSWORD = 'station-secret-1';
const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts', 'station-enrollment');

/**
 * The phone sizes the Director asked to see, plus a deliberately SHORT phone:
 * a state that only fits on a tall screen looks fine at 390x844 and is cut off
 * here, which is the whole point of shooting it.
 */
const PHONE_WIDTHS = [
  { label: 'phone-360', width: 360, height: 844 },
  { label: 'phone-390', width: 390, height: 844 },
  { label: 'phone-430', width: 430, height: 932 },
];
const SHORT_PHONE = { label: 'phone-390x640', width: 390, height: 640 };
const PHONE_VIEWPORTS = [...PHONE_WIDTHS, SHORT_PHONE];

const unique = (label: string) => `${label}-${randomBytes(6).toString('hex')}@example.com`;

/** The same one-liner move-follow-along.spec.ts uses, pointed at this spec's
 * own folder. Viewport only: a full-page shot of a flex-filling screen is a
 * misleading picture of what a screen in a room shows. */
async function snap(page: Page, name: string): Promise<void> {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, `${name}.png`), fullPage: false });
}

/**
 * One state at every phone width, then the viewport put back EXACTLY as it was.
 * Restoring matters more than the pictures do: the station page re-lays itself
 * out at 900px, and a test that carried on at 390 would be asserting against a
 * layout it never asked for.
 */
async function snapPhoneWidths(page: Page, name: string): Promise<void> {
  const before = page.viewportSize();
  for (const v of PHONE_VIEWPORTS) {
    await page.setViewportSize({ width: v.width, height: v.height });
    await snap(page, `${v.label}-${name}`);
  }
  if (before) await page.setViewportSize(before);
}

/** One card, not the page around it — see the header note about the invite
 * link that shares the Manage sheet with it. */
async function snapElement(locator: Locator, name: string): Promise<void> {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  await locator.screenshot({ path: path.join(ARTIFACTS_DIR, `${name}.png`) });
}

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
  await clearVerifyGate(page, 'wsf-profile', 20_000);
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
  await openMemberManage(page);
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

  // WHAT THE SCREEN LOOKS LIKE WHILE IT WAITS. The pairing code is the only
  // thing on it that is not fixed copy, it is on screen by design, it expires
  // in ten minutes, and it is spent by the approval just below — so it is safe
  // to photograph.
  // Nothing else is in frame: no credential exists yet (asserted above), and
  // this state renders no QR, no community name and no join code.
  await snap(station.page, 'landscape-1280-pairing');
  await snapPhoneWidths(station.page, 'pairing');

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

  // THE ENROLLED SCREEN WITH ITS QR PANEL. Shot here rather than earlier
  // because the assertions directly above have just proved both symbols are
  // present and that NEITHER encodes the station secret — so the capture needs
  // no wait of its own and adds no reason for this test to pass.
  //
  // In frame: the community name, the goal title, the shared total, the queue
  // block (empty — nobody is in line in this test) and the two attendee QRs.
  // The "New here?" symbol encodes this run's join URL, which is a
  // 127.0.0.1 address for a community that exists only inside the emulator for
  // the length of the run; no real community's code is photographed. The
  // station secret is in localStorage and is never drawn.
  await snap(station.page, 'landscape-1280-enrolled');
  await snapPhoneWidths(station.page, 'enrolled');

  // SCANNING THE MEMBER CODE: an ordinary page on an attendee's own phone. No
  // station, no credential, no Champion control.
  //
  // A scan now meets the device question first — "whose screen is this?" —
  // before anything offers an account. That is the point of the question and
  // this test asserts through it rather than around it: the answer that says
  // "my own phone" must land exactly where a scan landed before the question
  // existed, and NEITHER state may carry a station credential.
  const noStationCredential = async () =>
    expect(
      await scannerPage.evaluate(() => window.localStorage.getItem('wsf.stationCredential'))
    ).toBeNull();

  const scanner = await browser.newContext();
  const scannerPage = await scanner.newPage();
  await scannerPage.goto(memberQrUrl);
  await expect(scannerPage.getByTestId('wsf-event-device-choice')).toBeVisible({ timeout: 25_000 });
  await noStationCredential();
  await scannerPage.getByTestId('wsf-device-choice-personal').click();
  await expect(scannerPage.getByTestId('wsf-event-signed-out')).toBeVisible({ timeout: 25_000 });
  await noStationCredential();
  await expect(scannerPage.getByTestId('wsf-station-screen')).toHaveCount(0);
  expect(
    await manageOffered(scannerPage),
    'Champion tools are offered to somebody who is not a Champion',
  ).toBe(false);

  // SCANNING THE NEWCOMER CODE: the ordinary join page, which still asks for
  // an account. It enrols no screen either. This context has already answered
  // "my own phone", and the answer is per-device rather than per-scan, so the
  // join page does not ask again — it goes straight to the invitation.
  await scannerPage.goto(joinQrUrl);
  await expect(scannerPage.getByTestId('wsf-join-signed-out')).toBeVisible({ timeout: 25_000 });
  await noStationCredential();
  await expect(scannerPage.getByTestId('wsf-station-screen')).toHaveCount(0);
  await scanner.close();

  // 4. REVOKE FROM ACROSS THE HALL.
  await expect(page.getByTestId(`wsf-kiosk-stations-list-${goalId}`)).toContainText('Station 2', {
    timeout: 25_000,
  });

  // THE CHAMPION'S "Screens at this event" CARD, with a screen actually in it,
  // photographed before the revoke below empties it again.
  //
  // ELEMENT-SCOPED, NOT PAGE-SCOPED, and that is the whole reason this is three
  // lines rather than one: the Manage sheet this card sits in also renders this
  // community's invite link and its QR, so a page shot would publish a live
  // join code. Inside the card there is no join code, no email, no uid and no
  // station secret — only the slot label the server derived, its status, and
  // the controls. The code box still holds the pairing code typed further up;
  // that code was spent by the approval and is already dead.
  //
  // No short-height viewport here: an element capture is not clipped to the
  // viewport, so only the width changes anything.
  const championViewport = page.viewportSize();
  for (const v of PHONE_WIDTHS) {
    await page.setViewportSize({ width: v.width, height: v.height });
    await snapElement(card, `${v.label}-manage-screens-card`);
  }
  if (championViewport) await page.setViewportSize(championViewport);

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

  // WHAT A REFUSED SCREEN LOOKS LIKE IN A ROOM. The assertions above have
  // already established which state this is, so the capture proves nothing and
  // only shows it. This state draws the generic frame — wordmark, headline,
  // body and "Check again" — and nothing else, so no community name, no goal
  // title, no QR and no code is in the picture.
  await snap(station.page, 'landscape-1280-not-available');
  await snapPhoneWidths(station.page, 'not-available');

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
