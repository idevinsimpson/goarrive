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

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import * as nodePath from 'node:path';

/**
 * THE STATES A ROOM ACTUALLY SEES — the screen in the hall and the phone in a
 * hand, captured at the same moment so the pair can be read against each
 * other rather than one at a time. No assertion is made about any of these
 * images; they exist to be looked at.
 */
const TURN_ARTIFACTS = nodePath.join(__dirname, 'artifacts', 'queue-call-by-name');

/**
 * THE PHONE SIZES THIS WILL ACTUALLY BE MET ON, plus the short one.
 *
 * 390 is the default this spec runs at. 360 is the narrow end of the phones
 * people bring to an expo, 430 the wide end, and 390x640 is the one that finds
 * what a tall viewport hides — a control below the fold is a control nobody
 * uses, and the tall phone never shows you that.
 *
 * No assertion is made about any of these images. They exist so the states can
 * be looked at at the widths they will be read at, which is the only way some
 * of these defects are visible at all.
 */
const PHONE_WIDTHS: { label: string; width: number; height: number }[] = [
  { label: '360', width: 360, height: 844 },
  { label: '430', width: 430, height: 932 },
  { label: 'short-390x640', width: 390, height: 640 },
];

async function shotWidths(page: Page, name: string): Promise<void> {
  const restore = page.viewportSize() ?? { width: 390, height: 844 };
  for (const size of PHONE_WIDTHS) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await shot(page, `${name}-${size.label}`);
  }
  await page.setViewportSize(restore);
}
/**
 * EVERY CAPTURE MUST BE A DIFFERENT PICTURE, and this is enforced rather than
 * hoped for.
 *
 * Three of the first thirteen captures published from this spec were
 * byte-identical to another one: the lease shot was the assigned shot, the
 * receipt shot was the active-player shot, and the "cleared" shot was the
 * result shot. Each had been taken BEFORE the state it was named for had
 * arrived on the page, so the file recorded the previous state under the new
 * state's name — evidence that quietly claimed something untrue, which is
 * worse than no evidence at all.
 *
 * A hash comparison catches that in a millisecond, so it runs on every shot.
 * If this fails, the fix is to wait for the state, never to rename the file.
 */
const shotHashes = new Map<string, string>();

async function shot(
  target: { screenshot: (o: { path: string; fullPage: boolean }) => Promise<unknown> },
  name: string
): Promise<void> {
  mkdirSync(TURN_ARTIFACTS, { recursive: true });
  const file = nodePath.join(TURN_ARTIFACTS, `${name}.png`);
  await target.screenshot({ path: file, fullPage: false });
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
  const clash = shotHashes.get(hash);
  expect(
    clash ?? null,
    `capture "${name}" is byte-identical to "${clash}" — one of them is not the state it is named for`
  ).toBeNull();
  shotHashes.set(hash, name);
}



// These two journeys are long by nature — two real accounts, a community, a
// goal, a display authorization and a station enrolment before the queue is
// even reachable — and several steps inside them legitimately wait 20-25s on
// a loaded emulator. The default 30s budget is shorter than the waits the
// test itself declares, so it expires mid-journey and reports whichever
// assertion it happened to be on rather than a real failure. Raising the
// budget changes no assertion.
// 300s, not 180s. These journeys drive TWO browser contexts through a whole
// turn and then photograph four phone states at three widths each. Nothing
// here waits on a guess — the 10-second hall clear is waited out in full,
// because "cleared" is a claim about what is gone — and the budget is raised
// to fit the work rather than the work trimmed to fit the budget.
test.describe.configure({ timeout: 300_000 });
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
  // A PHONE IS A PHONE. This context was the default 1280-wide desktop, so
  // every "phone" capture was a lie about the viewport it was taken at. The
  // station keeps 1280x720, because that IS how a venue screen is met.
  const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
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

    await shot(memberPage, '00-phone-waiting');
    await shotWidths(memberPage, '00-phone-waiting');
    await shot(station.page, '00-station-waiting');

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
    await shot(station.page, '01-station-assigned');
    // BEING CALLED AND THE LEASE RUNNING ARE ONE STATE, not two.
    // They were captured as two files and the byte guard caught them as the
    // same picture, which they are: the 45 seconds are part of being called,
    // not a moment that follows it. So this is the assigned state WITH its
    // lease, asserted before it is photographed and named for what it is.
    await expect(memberPage.getByTestId('wsf-queue-lease')).toBeVisible({ timeout: 20_000 });
    await expect(memberPage.getByTestId('wsf-queue-lease')).toContainText('to say you’re coming');
    await shot(memberPage, '02-phone-assigned-with-lease');
    await shotWidths(memberPage, '02-phone-assigned-with-lease');

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
    await shot(station.page, '03b-station-ready');
    await shot(memberPage, '03c-phone-ready');
    await station.page.getByTestId('wsf-station-turn-action').click();

    // The turn is running, and the screen asks for the one thing it needs.
    await expect(station.page.getByTestId('wsf-station-turn-record')).toBeVisible({
      timeout: 20_000,
    });

    // ---- THE SAME PLAYER, ON BOTH SURFACES, AT THE SAME MOMENT -----------
    // The follow-along runs where the turn runs. Same component, same session,
    // and the movement THIS person chose — which on a combined event is not
    // the station's own goal.
    await expect(station.page.getByTestId('wsf-station-player')).toBeVisible({ timeout: 20_000 });
    await expect(memberPage.getByTestId('wsf-queue-player')).toBeVisible({ timeout: 20_000 });
    // The phone prints the status sentence. The HALL screen does not: there
    // the title, the clock and the round note already say it, and a fourth
    // copy pushed the count box off a canvas that cannot scroll. So the hall
    // is asked what it actually shows — the step it is on.
    await expect(memberPage.getByTestId('wsf-queue-move-status')).toContainText('Not started');
    await expect(station.page.getByTestId('wsf-station-move-step-title')).toContainText('Ready');
    await expect(station.page.getByTestId('wsf-station-move-timer')).toHaveText('60s');

    // ONE 60-SECOND ROUND PER TURN. The two-minute chip is not on a turn host
    // at all — not present, not disabled.
    await expect(station.page.getByTestId('wsf-station-move-length-full')).toHaveCount(0);
    await expect(memberPage.getByTestId('wsf-queue-move-length-full')).toHaveCount(0);
    await expect(station.page.getByTestId('wsf-station-move-length-fixed')).toContainText(
      'One 60-second round.'
    );
    await shot(station.page, '04-station-active-player');
    await shot(memberPage, '05-phone-active-player');
    await shotWidths(memberPage, '05-phone-active-player');

    // AND IT STILL CANNOT RECORD ANYTHING. Running a round changes no number
    // anywhere; the count box below is the only thing that can.
    await station.page.getByTestId('wsf-station-move-start').click();
    await expect(station.page.getByTestId('wsf-station-move-step-title')).not.toContainText(
      'Ready',
      { timeout: 20_000 }
    );
    await expect(station.page.getByTestId('wsf-station-turn-count')).toHaveValue('');
    await shot(station.page, '06-station-round-running');
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
    // THE TOTAL AND THE RESULT MUST AGREE. A screen that says "30 squats
    // recorded" beside "0 of 5,000" is telling a room two different things.
    // The pulse cache is invalidated when a contribution commits, so this is
    // now provable rather than hoped for.
    await expect(station.page.getByTestId('wsf-station-total-line')).toContainText(
      '30 of 5,000',
      { timeout: 20_000 }
    );
    await shot(station.page, '07-station-result');

    // THE PLAYER GOES WHEN THE TURN DOES. A finished turn leaves a code and a
    // number for ten seconds and nothing else — not a movement still running
    // at a screen nobody is standing at.
    await expect(station.page.getByTestId('wsf-station-player')).toHaveCount(0);
    await expect(station.page.getByTestId('wsf-station-queue-count')).toHaveText(
      'Nobody is waiting.',
      { timeout: 20_000 }
    );
    // THE TEN SECONDS, WAITED OUT. "Cleared" means the result is gone from the
    // screen, so the capture waits for it to go rather than being taken while
    // it is still up — which is what made this file a copy of the result one.
    await expect(station.page.getByTestId('wsf-station-queue-result')).toHaveCount(0, {
      timeout: 30_000,
    });
    await shot(station.page, '09-station-cleared');
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
    // NOW there is a receipt to photograph. The file that used to carry this
    // name was taken here-minus-thirty-seconds and was simply the player again.
    await shot(memberPage, '08-phone-receipt');
    await shotWidths(memberPage, '08-phone-receipt');
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

/**
 * SWITCHING TO YOUR OWN PHONE, which is a different thing from giving up.
 *
 * Somebody in a line who decides they would rather just do it where they are
 * standing should not have to work out that "take my name off" is the way to
 * do that, and then find their own way back to the activity. It is one action:
 * the event place is freed and the contribution journey for the activity THEY
 * chose opens.
 *
 * The place is freed FIRST, so nobody is ever standing in a line they have
 * already left — and the hall stops counting them without being told twice.
 */
test('a person waiting can switch to their own phone, which frees the place and opens their activity', async ({
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
    await page.goto(`/event/${goalId}`);
    await expect(page.getByTestId('wsf-event-device-choice')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('wsf-device-choice-personal').click();
    await expect(page.getByTestId('wsf-event-member')).toBeVisible({ timeout: 25_000 });
    await page.getByTestId('wsf-event-queue-start').click();
    await page.getByTestId('wsf-event-queue-name').fill('Thessaly');
    await page.getByTestId('wsf-event-queue-join').click();
    await expect(page.getByTestId('wsf-queue-screen')).toBeVisible({ timeout: 25_000 });
    await expect(station.page.getByTestId('wsf-station-queue-count')).toHaveText(
      '1 person waiting.',
      { timeout: 20_000 }
    );

    // ONE ACTION. It lands on the contribution screen for the activity this
    // person chose — not the event page, not the community, not a dead end.
    await page.getByTestId('wsf-queue-switch-to-phone').click();
    await page.waitForURL(new RegExp(`/contribute/${goalId}`), { timeout: 25_000 });
    await expect(page.getByTestId('wsf-contribute-screen')).toBeVisible({ timeout: 25_000 });

    // AND THE PLACE IS GONE. The hall stops counting them on its next read,
    // and never printed the name in the first place.
    await expect(station.page.getByTestId('wsf-station-queue-count')).toHaveText(
      'Nobody is waiting.',
      { timeout: 20_000 }
    );
    const hall = await station.page.evaluate(() => document.body.innerText);
    expect(hall, 'the hall must never have printed a waiting name').not.toContain('Thessaly');
    station.assertNoCrash();
  } finally {
    await station.context.close();
  }
});
