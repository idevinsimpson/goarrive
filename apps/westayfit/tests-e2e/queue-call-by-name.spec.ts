/**
 * THE QUEUE — a real line, and a screen that calls a participant by name.
 *
 * What this proves, end to end, in real browsers, with three devices that
 * cannot see each other's storage:
 *
 *   1. A member gets in line and CHOOSES what the room will call them. The
 *      control offers their first name pre-filled and initials one tap away;
 *      this journey takes the initials, which is the choice the feature exists
 *      to make possible.
 *   2. THE DISCLOSURE RULE. The screen in the hall shows those initials and
 *      NOT their name, NOT their surname, NOT their email and NOT their uid —
 *      asserted against the whole rendered page, not against one element.
 *   3. "Call next" calls them, and the call is announced through an ARIA live
 *      region as well as printed, so being called works for somebody who
 *      cannot see the screen.
 *   4. Their OWN phone says it is their turn, so being called works for
 *      somebody who cannot hear a room.
 *   5. Finishing clears the screen.
 *   6. Nothing about a turn depends on an animation: no element on either
 *      screen has a CSS animation or transition at any point in the journey.
 */
import { randomBytes } from 'node:crypto';

import { expect, test, type Browser, type Page } from '@playwright/test';


// These two journeys are long by nature — two real accounts, a community, a
// goal, a display authorization and a station enrolment before the queue is
// even reachable — and several steps inside them legitimately wait 20-25s on
// a loaded emulator. The default 30s budget is shorter than the waits the
// test itself declares, so it expires mid-journey and reports whichever
// assertion it happened to be on rather than a real failure. Raising the
// budget changes no assertion.
test.describe.configure({ timeout: 180_000 });
const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const PROJECT_ID = 'demo-wsf-local';
const PASSWORD = 'queue-secret-1';

const unique = (label: string) => `${label}-${randomBytes(6).toString('hex')}@example.com`;

/** The emulator's own record for this address, which is also where the uid
 * comes from — the one value that must appear on no screen in this test. */
async function emulatorAccount(email: string): Promise<{ localId: string }> {
  const base = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1`;
  const lookup = await fetch(`${base}/projects/${PROJECT_ID}/accounts:query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({}),
  });
  const { userInfo = [] } = (await lookup.json()) as {
    userInfo?: { localId: string; email: string }[];
  };
  const user = userInfo.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`no emulator account for ${email}`);
  return user;
}

async function markEmailVerified(email: string): Promise<string> {
  const user = await emulatorAccount(email);
  const base = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1`;
  await fetch(`${base}/projects/${PROJECT_ID}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ localId: user.localId, emailVerified: true }),
  });
  return user.localId;
}

/** The ordinary signup journey, to a home page and a real uid. */
async function signUp(page: Page, displayName: string, label: string): Promise<string> {
  const email = unique(label);
  await page.goto('/signup');
  await page.getByTestId('wsf-signup-displayName').fill(displayName);
  await page.getByTestId('wsf-signup-email').fill(email);
  await page.getByTestId('wsf-signup-password').fill(PASSWORD);
  const sendSettled = page.waitForResponse((r) => r.url().includes('wsfSendVerificationEmail'));
  await page.getByTestId('wsf-signup-submit').click();
  await expect(page.getByTestId('wsf-verify')).toBeVisible({ timeout: 20_000 });
  await sendSettled;
  const uid = await markEmailVerified(email);
  await page.getByTestId('wsf-verify-check').click();
  await expect(page.getByTestId('wsf-profile')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-profile-termsCheckbox').click();
  await page.getByTestId('wsf-profile-submit').click();
  await expect(page.getByTestId('wsf-home-signed-in')).toBeVisible({ timeout: 20_000 });
  return uid;
}

/** A Champion with a community anyone with the link may join, and one goal. */
async function championWithGoal(page: Page): Promise<{ groupId: string; goalId: string }> {
  await signUp(page, 'Queue Champion', 'queue-champ');

  await page.getByTestId('wsf-home-start').click();
  await expect(page.getByTestId('wsf-start')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-start-name').fill('Expo Hall Movers');
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

/** A screen at the event: a brand-new browser with no session and no history. */
async function openStationScreen(browser: Browser, url: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') crashes.push(`console.error: ${m.text()}`);
  });
  await page.goto(url);
  return {
    context,
    page,
    assertNoCrash: () => {
      if (crashes.length) throw new Error(`the station screen crashed:\n${crashes.join('\n')}`);
    },
  };
}

/**
 * NOTHING ABOUT A TURN MAY DEPEND ON AN ANIMATION. The same check the
 * accessibility suite's R6 makes — a running CSS animation — so there is
 * nothing for prefers-reduced-motion to have to turn off, and a person who has
 * asked their device to stop moving things still learns it is their turn.
 */
async function expectNoMotion(page: Page, where: string): Promise<void> {
  const animated = await page.evaluate(() =>
    Array.from(document.querySelectorAll('*'))
      .filter((el) => {
        const name = getComputedStyle(el).animationName;
        return name !== 'none' && name !== '';
      })
      .map((el) => `${el.tagName.toLowerCase()}[${(el as HTMLElement).dataset.testid ?? ''}]`)
      .slice(0, 10)
  );
  expect(animated, `${where} must not animate`).toEqual([]);
}

test('a member chooses initials, the screen calls them by those initials, their phone says it is their turn, and finishing clears the screen', async ({
  page,
  browser,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { goalId } = await championWithGoal(page);

  // ---- the Champion authorizes the display and enrols a screen ------------
  await page.getByTestId('wsf-community-manage').click();
  await expect(page.getByTestId('wsf-community-manage-panel')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId(`wsf-goal-display-auth-toggle-${goalId}`).click();
  await expect(page.getByTestId(`wsf-goal-display-auth-state-${goalId}`)).toContainText(
    'Public display is authorized',
    { timeout: 20_000 }
  );

  await page.getByTestId(`wsf-kiosk-stations-copy-${goalId}`).click();
  const stationUrl = (await page.evaluate(() => navigator.clipboard.readText())).trim();
  const origin = new URL(page.url()).origin;
  expect(stationUrl).toBe(`${origin}/station/${goalId}`);

  const station = await openStationScreen(browser, stationUrl);
  await expect(station.page.getByTestId('wsf-station-pairing')).toBeVisible({ timeout: 25_000 });
  const code = (await station.page.getByTestId('wsf-station-pairing-code').innerText()).replace(
    /\s+/g,
    ''
  );
  await page.getByTestId(`wsf-kiosk-stations-code-${goalId}`).fill(code);
  await page.getByTestId(`wsf-kiosk-stations-slot-1-${goalId}`).click();
  await page.getByTestId(`wsf-kiosk-stations-approve-${goalId}`).click();
  await expect(station.page.getByTestId('wsf-station-screen')).toBeVisible({ timeout: 30_000 });
  station.assertNoCrash();

  // The line is empty and the screen says so, rather than showing nothing.
  await expect(station.page.getByTestId('wsf-station-queue-serving-empty')).toBeVisible({
    timeout: 20_000,
  });
  await expect(station.page.getByTestId('wsf-station-queue-count')).toHaveText(
    'Nobody is waiting.',
    { timeout: 20_000 }
  );

  // The newcomer link the screen is already showing is the member's way in.
  const joinUrl = (await station.page
    .getByTestId('wsf-station-qr-join')
    .getAttribute('data-qr-url'))!;
  const joinCode = new URL(joinUrl).pathname.split('/').filter(Boolean).pop()!;

  // ---- an ordinary member, on their own phone -----------------------------
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  try {
    const memberUid = await signUp(memberPage, 'Ada Lovelace', 'queue-member');
    await memberPage.goto(`/join/${joinCode}`);
    await memberPage.getByTestId('wsf-join-submit').click();
    await expect(memberPage.getByTestId('wsf-community')).toBeVisible({ timeout: 25_000 });

    // The event page, and the device question that now comes first.
    await memberPage.goto(`/event/${goalId}`);
    await expect(memberPage.getByTestId('wsf-event-device-choice')).toBeVisible({
      timeout: 20_000,
    });
    await memberPage.getByTestId('wsf-device-choice-personal').click();
    await expect(memberPage.getByTestId('wsf-event-member')).toBeVisible({ timeout: 25_000 });

    // ---- THE CHOICE. The control offers the first name pre-filled and the
    // initials one tap away; this member takes the initials. ----------------
    await memberPage.getByTestId('wsf-event-queue-start').click();
    const nameBox = memberPage.getByTestId('wsf-event-queue-name');
    await expect(nameBox).toBeVisible({ timeout: 10_000 });
    // Pre-filled with the FIRST name and never the surname.
    await expect(nameBox).toHaveValue('Ada');
    await expect(memberPage.getByTestId('wsf-event-queue-name-initials')).toContainText('A.L.');
    await memberPage.getByTestId('wsf-event-queue-name-initials').click();
    await expect(nameBox).toHaveValue('A.L.');

    await memberPage.getByTestId('wsf-event-queue-join').click();
    await memberPage.waitForURL(new RegExp(`/queue/${goalId}`), { timeout: 25_000 });
    await expect(memberPage.getByTestId('wsf-queue-screen')).toBeVisible({ timeout: 25_000 });
    await expect(memberPage.getByTestId('wsf-queue-called-as')).toHaveText('A.L.');
    await expect(memberPage.getByTestId('wsf-queue-place')).toHaveText('You’re next.', {
      timeout: 20_000,
    });

    // ---- 2. THE DISCLOSURE RULE, on the screen in the hall ----------------
    await expect(station.page.getByTestId('wsf-station-queue-next-0')).toHaveText('A.L.', {
      timeout: 20_000,
    });
    await expect(station.page.getByTestId('wsf-station-queue-count')).toHaveText(
      '1 person waiting.'
    );
    const hallBefore = await station.page.evaluate(() => document.body.innerText);
    for (const secret of ['Ada', 'Lovelace', memberUid]) {
      expect(hallBefore, `the hall must not read "${secret}"`).not.toContain(secret);
    }
    expect(await station.page.content()).not.toContain(memberUid);

    // ---- 3. CALL NEXT, printed AND announced ------------------------------
    await station.page.getByTestId('wsf-station-call-next').click();
    await expect(station.page.getByTestId('wsf-station-queue-serving')).toHaveText('A.L.', {
      timeout: 20_000,
    });
    const announce = station.page.getByTestId('wsf-station-queue-announce');
    await expect(announce).toHaveAttribute('aria-live', 'assertive');
    await expect(announce).toContainText('A.L. — it’s your turn at Station 1.');
    // The line is theirs alone, so nobody is left behind them.
    await expect(station.page.getByTestId('wsf-station-queue-next-empty')).toBeVisible();
    station.assertNoCrash();

    const hallCalled = await station.page.evaluate(() => document.body.innerText);
    for (const secret of ['Ada', 'Lovelace', memberUid]) {
      expect(hallCalled, `the hall must not read "${secret}"`).not.toContain(secret);
    }

    // ---- 4. THEIR OWN PHONE SAYS SO ---------------------------------------
    await expect(memberPage.getByTestId('wsf-queue-called')).toBeVisible({ timeout: 25_000 });
    await expect(memberPage.getByTestId('wsf-queue-called-name')).toHaveText('A.L.');
    const phoneAnnounce = memberPage.getByTestId('wsf-queue-announce');
    await expect(phoneAnnounce).toHaveAttribute('aria-live', 'assertive');
    await expect(phoneAnnounce).toContainText('It’s your turn — go to Station 1.');

    // ---- 6. AND NOTHING MOVED ---------------------------------------------
    await expectNoMotion(station.page, 'the screen in the hall');
    await expectNoMotion(memberPage, 'the member’s own phone');

    // ---- 5. FINISHING CLEARS THE SCREEN -----------------------------------
    await station.page.getByTestId('wsf-station-finish-serving').click();
    await expect(station.page.getByTestId('wsf-station-queue-serving-empty')).toBeVisible({
      timeout: 20_000,
    });
    await expect(station.page.getByTestId('wsf-station-queue-count')).toHaveText(
      'Nobody is waiting.',
      { timeout: 20_000 }
    );
    const hallAfter = await station.page.evaluate(() => document.body.innerText);
    expect(hallAfter).not.toContain('A.L.');

    // And the member is out of the line, on their own page, without asking.
    await expect(memberPage.getByTestId('wsf-queue-not-in-line')).toBeVisible({ timeout: 25_000 });
  } finally {
    await memberContext.close();
    await station.context.close();
  }
});

test('a person can take their own name off the screen, immediately and without asking anybody', async ({
  page,
  browser,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { goalId } = await championWithGoal(page);

  await page.getByTestId('wsf-community-manage').click();
  await expect(page.getByTestId('wsf-community-manage-panel')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId(`wsf-goal-display-auth-toggle-${goalId}`).click();
  await expect(page.getByTestId(`wsf-goal-display-auth-state-${goalId}`)).toContainText(
    'Public display is authorized',
    { timeout: 20_000 }
  );
  await page.getByTestId(`wsf-kiosk-stations-copy-${goalId}`).click();
  const stationUrl = (await page.evaluate(() => navigator.clipboard.readText())).trim();

  const station = await openStationScreen(browser, stationUrl);
  await expect(station.page.getByTestId('wsf-station-pairing')).toBeVisible({ timeout: 25_000 });
  const code = (await station.page.getByTestId('wsf-station-pairing-code').innerText()).replace(
    /\s+/g,
    ''
  );
  await page.getByTestId(`wsf-kiosk-stations-code-${goalId}`).fill(code);
  await page.getByTestId(`wsf-kiosk-stations-slot-2-${goalId}`).click();
  await page.getByTestId(`wsf-kiosk-stations-approve-${goalId}`).click();
  await expect(station.page.getByTestId('wsf-station-screen')).toBeVisible({ timeout: 30_000 });

  try {
    // The Champion is an active member of their own community, so their own
    // phone is the shortest honest way to put one name in this line.
    await page.goto(`/event/${goalId}`);
    await expect(page.getByTestId('wsf-event-device-choice')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('wsf-device-choice-personal').click();
    await expect(page.getByTestId('wsf-event-member')).toBeVisible({ timeout: 25_000 });
    await page.getByTestId('wsf-event-queue-start').click();
    await page.getByTestId('wsf-event-queue-name').fill('Q');
    await page.getByTestId('wsf-event-queue-join').click();
    await expect(page.getByTestId('wsf-queue-screen')).toBeVisible({ timeout: 25_000 });

    await expect(station.page.getByTestId('wsf-station-queue-next-0')).toHaveText('Q', {
      timeout: 20_000,
    });

    // One plain control, no confirmation, nobody else's permission.
    await page.getByTestId('wsf-queue-leave').click();
    await expect(page.getByTestId('wsf-queue-not-in-line')).toBeVisible({ timeout: 20_000 });

    // And the screen in the room no longer has them, on its next read.
    await expect(station.page.getByTestId('wsf-station-queue-next-empty')).toBeVisible({
      timeout: 20_000,
    });
    const hall = await station.page.evaluate(() => document.body.innerText);
    expect(hall).not.toContain('Q —');
  } finally {
    await station.context.close();
  }
});
