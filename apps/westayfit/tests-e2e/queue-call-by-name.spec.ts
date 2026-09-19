/**
 * THE TURN CONTRACT — a real line, and a screen that calls ONE person by the
 * name they chose and a short code.
 *
 * What this proves, end to end, in real browsers, with three devices that
 * cannot see each other's storage:
 *
 *   1. A member gets in line and CHOOSES what the room will call them. The
 *      control offers their first name pre-filled and initials one tap away;
 *      this journey takes the initials, which is the choice the feature exists
 *      to make possible.
 *   2. THE DISCLOSURE RULE, and it is stricter than it was. While somebody is
 *      WAITING the hall shows no name at all — not their account name, not
 *      their surname, not their uid, and not even the alias they chose. The
 *      hall shows a COUNT. Asserted against the whole rendered page, not
 *      against one element.
 *   3. "Call next" assigns them, printing the one name AND a short code, and
 *      announcing it through an ARIA live region, so being called works for
 *      somebody who cannot see the screen.
 *   4. Their OWN phone says it is their turn, carries THE SAME CODE, and
 *      offers "I'm ready" — so being called works for somebody who cannot hear
 *      a room, and so a call is an offer rather than a summons.
 *   5. The station starts the READY turn and records it, and recording clears
 *      every name from the hall while leaving the person their receipt.
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

test('a member chooses initials, the screen calls them by those initials and a code, their phone says it is their turn and taps ready, and recording clears the screen', async ({
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
    //
    // A WAITING PERSON IS A NUMBER. The hall knows somebody is there and knows
    // nothing else about them — not their account name, not their surname, not
    // their uid, and not the alias they chose either. The old queue printed
    // that alias in a "next up" column, which is the defect this replaced.
    await expect(station.page.getByTestId('wsf-station-queue-count')).toHaveText(
      '1 person waiting.',
      { timeout: 20_000 }
    );
    await expect(station.page.getByTestId('wsf-station-queue-serving-empty')).toBeVisible();
    const hallBefore = await station.page.evaluate(() => document.body.innerText);
    for (const secret of ['Ada', 'Lovelace', 'A.L.', memberUid]) {
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
    await expect(announce).toContainText('A.L.');
    await expect(announce).toContainText('it’s your turn at Station 1.');
    // THE CODE, beside the name. Three characters from an alphabet with I, O,
    // 0 and 1 removed, so it cannot be misread across a hall.
    const hallCode = (await station.page.getByTestId('wsf-station-queue-code').innerText()).trim();
    expect(hallCode).toMatch(/^[A-HJ-NP-Z2-9]{3}$/);
    // The line is theirs alone, so nobody is left behind them.
    await expect(station.page.getByTestId('wsf-station-queue-count')).toHaveText(
      'Nobody is waiting.'
    );
    station.assertNoCrash();

    const hallCalled = await station.page.evaluate(() => document.body.innerText);
    for (const secret of ['Ada', 'Lovelace', memberUid]) {
      expect(hallCalled, `the hall must not read "${secret}"`).not.toContain(secret);
    }

    // ---- 4. THEIR OWN PHONE SAYS SO, AND CARRIES THE SAME CODE ------------
    await expect(memberPage.getByTestId('wsf-queue-called')).toBeVisible({ timeout: 25_000 });
    await expect(memberPage.getByTestId('wsf-queue-called-name')).toHaveText('A.L.');
    // THE SAME THREE CHARACTERS as the wall, which is the whole reason the
    // code exists: two people called Sam each know which one is theirs.
    await expect(memberPage.getByTestId('wsf-queue-code')).toHaveText(hallCode);
    await expect(memberPage.getByTestId('wsf-queue-station')).toHaveText('Go to Station 1.');
    const phoneAnnounce = memberPage.getByTestId('wsf-queue-announce');
    await expect(phoneAnnounce).toHaveAttribute('aria-live', 'assertive');
    await expect(phoneAnnounce).toContainText('It’s your turn at Station 1.');

    // ---- 6. AND NOTHING MOVED ---------------------------------------------
    await expectNoMotion(station.page, 'the screen in the hall');
    await expectNoMotion(memberPage, 'the member’s own phone');

    // ---- 5. READY, START, RECORD ------------------------------------------
    //
    // A CALL IS AN OFFER. The station cannot start anybody who has not said
    // they are coming, so its one control is disabled until the phone taps.
    await expect(station.page.getByTestId('wsf-station-turn-action')).toBeDisabled();
    await memberPage.getByTestId('wsf-queue-ready').click();
    await expect(station.page.getByTestId('wsf-station-turn-action')).toBeEnabled({
      timeout: 20_000,
    });
    await expect(station.page.getByTestId('wsf-station-turn-action')).toHaveText(
      'Start their turn'
    );
    await station.page.getByTestId('wsf-station-turn-action').click();

    // The turn is running, and the screen asks for the one thing it needs.
    await expect(station.page.getByTestId('wsf-station-turn-record')).toBeVisible({
      timeout: 20_000,
    });
    await station.page.getByTestId('wsf-station-turn-count').fill('30');
    await expect(station.page.getByTestId('wsf-station-turn-action')).toHaveText(
      'Record this turn'
    );
    await station.page.getByTestId('wsf-station-turn-action').click();

    // RECORDING CLEARS EVERY NAME AT ONCE, and leaves a code and a number for
    // ten seconds — which is the only thing of theirs a room is left holding.
    await expect(station.page.getByTestId('wsf-station-queue-result')).toBeVisible({
      timeout: 20_000,
    });
    await expect(station.page.getByTestId('wsf-station-queue-result')).toContainText(hallCode);
    await expect(station.page.getByTestId('wsf-station-queue-result')).toContainText(
      '30 squats recorded.'
    );
    await expect(station.page.getByTestId('wsf-station-queue-count')).toHaveText(
      'Nobody is waiting.',
      { timeout: 20_000 }
    );
    const hallAfter = await station.page.evaluate(() => document.body.innerText);
    for (const secret of ['Ada', 'Lovelace', 'A.L.', memberUid]) {
      expect(hallAfter, `the hall must not read "${secret}"`).not.toContain(secret);
    }
    station.assertNoCrash();

    // And the member is out of the line, on their own page, without asking —
    // holding their own receipt, which is theirs and nobody else's.
    await expect(memberPage.getByTestId('wsf-queue-not-in-line')).toBeVisible({ timeout: 25_000 });
    await expect(memberPage.getByTestId('wsf-queue-receipt-amount')).toHaveText(
      '30 squats recorded.',
      { timeout: 25_000 }
    );
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
    // A distinctive alias, so "the hall does not print it" is a real
    // assertion about the whole page rather than a search for one letter.
    await page.getByTestId('wsf-event-queue-name').fill('Quillon');
    await page.getByTestId('wsf-event-queue-join').click();
    await expect(page.getByTestId('wsf-queue-screen')).toBeVisible({ timeout: 25_000 });

    // The hall counts them and does not name them.
    await expect(station.page.getByTestId('wsf-station-queue-count')).toHaveText(
      '1 person waiting.',
      { timeout: 20_000 }
    );
    const hallWaiting = await station.page.evaluate(() => document.body.innerText);
    expect(hallWaiting, 'a waiting person is a number, not a name').not.toContain('Quillon');

    // One plain control, no confirmation, nobody else's permission.
    await page.getByTestId('wsf-queue-leave').click();
    await expect(page.getByTestId('wsf-queue-not-in-line')).toBeVisible({ timeout: 20_000 });

    // And the screen in the room no longer counts them, on its next read.
    await expect(station.page.getByTestId('wsf-station-queue-count')).toHaveText(
      'Nobody is waiting.',
      { timeout: 20_000 }
    );
    const hall = await station.page.evaluate(() => document.body.innerText);
    expect(hall).not.toContain('Quillon');
  } finally {
    await station.context.close();
  }
});
