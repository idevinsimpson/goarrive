/**
 * THE FOLLOW-ALONG SCREEN at /move/<goalId>.
 *
 * What these tests are really guarding, after the Director's correction of
 * 19 Sep:
 *
 *  1. THE DEFAULT STATE IS HONEST. There is no movement video catalog in this
 *     repository. With no poster supplied, the screen draws its own figure and
 *     labels it "Illustrated fallback" on screen; nothing anywhere on it
 *     implies a video was delivered, is loading, or failed.
 *  2. READY → 3-SECOND COUNTDOWN → 60-SECOND ROUND, explicitly, in that order.
 *  3. STOPPING EARLY AND RUNNING TO THE END BOTH LEAD TO "Enter my reps",
 *     which hands off to the EXISTING contribute entry/review/record/receipt
 *     flow — and one round is ONE recorded contribution, however many times it
 *     is submitted, because the round's id rides the handoff.
 *  4. A HIDDEN TAB PAUSES THE ROUND. It is never silently consumed.
 *  5. THE EVENT, THE ACTIVITY AND THE WAY BACK SURVIVE the round; a station
 *     keeps a readable QR/status panel beside the player, a phone stacks it.
 *
 * Captures: 390 px wide (phone) and landscape (station and phone), written to
 * tests-e2e/artifacts/move-follow-along/.
 *
 * Everything here is emulator fixture data: no real member, no real activity.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const PROJECT_ID = 'demo-wsf-local';
const PASSWORD = 'move-secret-1';
const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts', 'move-follow-along');
const PHONE = { width: 390, height: 844 };
/** Landscape on a screen at an event: wide enough for the station layout. */
const LANDSCAPE_STATION = { width: 1280, height: 720 };
/** Landscape on a phone: too narrow for a second column, so the panel stacks. */
const LANDSCAPE_PHONE = { width: 844, height: 390 };

const unique = (label: string) => `${label}-${randomBytes(6).toString('hex')}@example.com`;

async function snap(page: Page, name: string): Promise<void> {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, `${name}.png`), fullPage: false });
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

/** The big number on the player, as a number. */
async function readSeconds(page: Page): Promise<number> {
  return Number((await page.getByTestId('wsf-move-timer').innerText()).replace(/\D+/g, '') || '0');
}

async function phase(page: Page): Promise<string | null> {
  return page.getByTestId('wsf-move-screen').getAttribute('data-phase');
}

/**
 * Hide and reveal the tab the way a browser does. Playwright cannot background
 * a tab directly, so the two properties the page actually reads are redefined
 * and the same event the browser fires is dispatched.
 */
async function setTabHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((isHidden) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (isHidden ? 'hidden' : 'visible'),
    });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => isHidden });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test('ready, then a 3-second count in, then a 60-second round', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const goalId = await championWithGoal(page);
  await page.goto(`/move/${goalId}`);

  await expect(page.getByTestId('wsf-move-screen')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('wsf-move-heading')).toHaveText('Follow along');

  // READY IS EXPLICIT. Nothing is running, nothing has elapsed, and the round
  // length is stated before anyone commits to it.
  await expect(page.getByTestId('wsf-move-screen')).toHaveAttribute('data-phase', 'ready');
  await expect(page.getByTestId('wsf-move-start')).toHaveText('Start');
  await expect(page.getByTestId('wsf-move-round')).toHaveText('3s count in · 60s round');
  expect(await readSeconds(page)).toBe(60);

  // THE HONEST DEFAULT STATE. A drawing this app makes, named as exactly that.
  await expect(page.getByTestId('wsf-move-media-label')).toHaveText('Illustrated fallback');
  await expect(page.getByTestId('wsf-move-media-note')).toContainText('No movement video exists');
  const figure = page.locator('[data-testid="wsf-move-figure-image"] img').first();
  await expect(figure).toHaveCount(1, { timeout: 15_000 });
  expect((await figure.getAttribute('src')) ?? '').toContain('data:image/svg+xml');
  // No wording anywhere on this screen may suggest a video was delivered.
  const screenText = (await page.getByTestId('wsf-move-screen').innerText()).toLowerCase();
  for (const forbidden of ['watch the video', 'video is loading', 'play the video']) {
    expect(screenText.includes(forbidden), `screen says "${forbidden}"`).toBe(false);
  }
  await snap(page, 'phone-390-ready');

  // THE COUNTDOWN: three seconds, and it is its own phase.
  await page.getByTestId('wsf-move-start').click();
  await expect(page.getByTestId('wsf-move-screen')).toHaveAttribute('data-phase', 'countdown');
  expect(await readSeconds(page)).toBeLessThanOrEqual(3);
  await snap(page, 'phone-390-countdown');
  // Still counting in after a second and a half: it is not an instant start.
  await page.waitForTimeout(1_500);
  expect(await phase(page)).toBe('countdown');

  // THE ROUND: sixty seconds, arriving within the countdown's own length.
  await expect(page.getByTestId('wsf-move-screen')).toHaveAttribute('data-phase', 'round', {
    timeout: 4_000,
  });
  const atRoundStart = await readSeconds(page);
  expect(atRoundStart).toBeGreaterThanOrEqual(58);
  expect(atRoundStart).toBeLessThanOrEqual(60);
  await snap(page, 'phone-390-round');

  // PAUSE HOLDS THE CLOCK, and resume picks up from there rather than restarting.
  await page.getByTestId('wsf-move-pause').click();
  await expect(page.getByTestId('wsf-move-start')).toHaveText('Resume');
  const held = await readSeconds(page);
  await page.waitForTimeout(1_500);
  expect(await readSeconds(page)).toBe(held);
  await page.getByTestId('wsf-move-start').click();
  await expect(page.getByTestId('wsf-move-pause')).toBeVisible();
  await page.waitForTimeout(1_200);
  expect(await readSeconds(page)).toBeLessThan(held);

  // The screen says who is counting, and has no control that could record.
  await expect(page.getByTestId('wsf-move-self-count')).toContainText('You count your own');
  await expect(page.getByTestId('wsf-move-screen')).not.toContainText('Record ');
});

test('stopping early leads to Enter my reps, and the round records exactly once', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize(PHONE);
  const goalId = await championWithGoal(page);

  // Count every write this test causes, so "exactly once" is a count and not
  // an impression.
  const contributeCalls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('wsfContribute')) contributeCalls.push(r.url());
  });

  await page.goto(`/move/${goalId}`);
  await expect(page.getByTestId('wsf-move-screen')).toBeVisible({ timeout: 25_000 });
  await page.getByTestId('wsf-move-start').click();
  await expect(page.getByTestId('wsf-move-screen')).toHaveAttribute('data-phase', 'round', {
    timeout: 8_000,
  });
  await page.waitForTimeout(1_000);

  // STOPPING EARLY IS NOT A DISCARD. It arrives at the same place a finished
  // round does.
  await page.getByTestId('wsf-move-stop').click();
  await expect(page.getByTestId('wsf-move-screen')).toHaveAttribute('data-phase', 'finished');
  await expect(page.getByTestId('wsf-move-finished')).toBeVisible();
  await expect(page.getByTestId('wsf-move-contribute')).toHaveText('Enter my reps');
  await snap(page, 'phone-390-finished');

  // THE HANDOFF carries the round's id and nothing that could become credit.
  const handoffHref = (await page.getByTestId('wsf-move-contribute').getAttribute('href')) ?? '';
  expect(handoffHref).toContain(`/contribute/${goalId}`);
  expect(handoffHref).toMatch(/[?&]attempt=[A-Za-z0-9_-]{6,64}/);
  for (const forbidden of ['count=', 'elapsed=', 'seconds=', 'credit=']) {
    expect(handoffHref.includes(forbidden), `handoff carries "${forbidden}"`).toBe(false);
  }

  // IT HANDS OFF TO THE EXISTING FLOW: entry, review, record, receipt.
  await page.getByTestId('wsf-move-contribute').click();
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 25_000 });
  const handoffUrl = page.url();
  expect(handoffUrl).toMatch(/[?&]attempt=/);

  await page.getByTestId('wsf-contribute-entry').fill('12');
  await page.getByTestId('wsf-contribute-review').click();
  await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible();
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('wsf-contribute-own-credit')).toContainText('12 squats');
  await snap(page, 'phone-390-receipt');
  expect(contributeCalls.length).toBe(1);

  // ONE ROUND, ONE CONTRIBUTION. Opening the SAME handoff link again — which
  // is exactly what a person does who followed the round at a station and then
  // typed their number on their phone — replays the same attempt. The server
  // says "already recorded" and the member's total does not move.
  await page.goto(handoffUrl);
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 25_000 });
  await page.getByTestId('wsf-contribute-entry').fill('12');
  await page.getByTestId('wsf-contribute-review').click();
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('wsf-contribute-result-headline')).toHaveText(
    'This contribution was already recorded.'
  );
  await expect(page.getByTestId('wsf-contribute-own-credit')).toContainText('12 squats');
  await expect(page.getByTestId('wsf-contribute-own-credit')).not.toContainText('24');
  // Two calls were made; the second was a replay of the first attempt, which
  // is what makes the total above still 12.
  expect(contributeCalls.length).toBe(2);
});

test('running the round to the end leads to the same Enter my reps', async ({ page }) => {
  // A real sixty-second round plus its count in, in real time. There is no
  // shorter honest way to prove a round that completes.
  test.setTimeout(180_000);
  await page.setViewportSize(PHONE);
  const goalId = await championWithGoal(page);
  await page.goto(`/move/${goalId}`);
  await expect(page.getByTestId('wsf-move-screen')).toBeVisible({ timeout: 25_000 });

  await page.getByTestId('wsf-move-start').click();
  await expect(page.getByTestId('wsf-move-screen')).toHaveAttribute('data-phase', 'round', {
    timeout: 8_000,
  });
  await expect(page.getByTestId('wsf-move-screen')).toHaveAttribute('data-phase', 'finished', {
    timeout: 90_000,
  });

  await expect(page.getByTestId('wsf-move-contribute')).toHaveText('Enter my reps');
  await expect(page.getByTestId('wsf-move-timer')).toHaveText('Done');
  await page.getByTestId('wsf-move-contribute').click();
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 25_000 });
  // The person types their own number. Nothing was prefilled from the clock.
  await expect(page.getByTestId('wsf-contribute-entry')).toHaveValue('');
});

test('a hidden tab pauses the round instead of consuming it', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const goalId = await championWithGoal(page);
  await page.goto(`/move/${goalId}`);
  await expect(page.getByTestId('wsf-move-screen')).toBeVisible({ timeout: 25_000 });

  await page.getByTestId('wsf-move-start').click();
  await expect(page.getByTestId('wsf-move-screen')).toHaveAttribute('data-phase', 'round', {
    timeout: 8_000,
  });
  await page.waitForTimeout(1_000);

  await setTabHidden(page, true);
  // PAUSED, not consumed: the control says Resume and the notice says why.
  await expect(page.getByTestId('wsf-move-start')).toHaveText('Resume', { timeout: 5_000 });
  await expect(page.getByTestId('wsf-move-interrupted')).toBeVisible();
  const held = await readSeconds(page);

  // Time passes while it is away and NOTHING is spent.
  await page.waitForTimeout(2_500);
  await setTabHidden(page, false);
  await page.waitForTimeout(500);
  expect(await readSeconds(page)).toBe(held);
  expect(await phase(page)).toBe('round');
  await expect(page.getByTestId('wsf-move-start')).toHaveText('Resume');

  // And it picks up from exactly there.
  await page.getByTestId('wsf-move-start').click();
  await page.waitForTimeout(1_200);
  const after = await readSeconds(page);
  expect(after).toBeLessThan(held);
  expect(after).toBeGreaterThan(held - 4);
});

test('the event, the activity and the way back survive the round', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const goalId = await championWithGoal(page);
  const from = `/event/${goalId}`;
  await page.goto(
    `/move/${goalId}?groupId=grp-fixture&event=${goalId}&activity=squats&from=${encodeURIComponent(from)}`
  );
  await expect(page.getByTestId('wsf-move-screen')).toBeVisible({ timeout: 25_000 });

  // WHAT WAS SELECTED IS STILL ON SCREEN.
  await expect(page.getByTestId('wsf-move-activity')).toContainText('squats');
  // AND THE WAY BACK IS THE ONE THE CALLER PRESERVED.
  await expect(page.getByTestId('wsf-move-back')).toHaveAttribute('href', from);

  // The selection survives the round, not just the first paint.
  await page.getByTestId('wsf-move-start').click();
  await expect(page.getByTestId('wsf-move-screen')).toHaveAttribute('data-phase', 'round', {
    timeout: 8_000,
  });
  await page.getByTestId('wsf-move-stop').click();
  await expect(page.getByTestId('wsf-move-activity')).toContainText('squats');
  await expect(page.getByTestId('wsf-move-back')).toHaveAttribute('href', from);
  // The community the caller named rides the handoff into the existing flow.
  const handoff = (await page.getByTestId('wsf-move-contribute').getAttribute('href')) ?? '';
  expect(handoff).toContain('groupId=grp-fixture');
  expect(handoff).toMatch(/[?&]attempt=/);

  // A "from" that points off this app is refused outright rather than followed.
  await page.goto(`/move/${goalId}?from=${encodeURIComponent('https://evil.example/x')}`);
  await expect(page.getByTestId('wsf-move-screen')).toBeVisible({ timeout: 25_000 });
  const back = (await page.getByTestId('wsf-move-back').getAttribute('href')) ?? '';
  expect(back.startsWith('/')).toBe(true);
  expect(back).not.toContain('evil.example');
});

test('a station keeps a readable panel beside the player; a phone stacks it', async ({ page }) => {
  const goalId = await championWithGoal(page);

  // PHONE, 390: one column, the panel underneath the player.
  await page.setViewportSize(PHONE);
  await page.goto(`/move/${goalId}`);
  await expect(page.getByTestId('wsf-move-screen')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('wsf-move-screen')).toHaveAttribute('data-layout', 'phone');
  const panelPhone = await page.getByTestId('wsf-move-panel').boundingBox();
  const playerPhone = await page.getByTestId('wsf-move-timer').boundingBox();
  expect(panelPhone).not.toBeNull();
  expect(playerPhone).not.toBeNull();
  // Stacked: the panel starts below the player's big number.
  expect(panelPhone!.y).toBeGreaterThan(playerPhone!.y);
  // Nothing runs off the right edge at phone width.
  expect(panelPhone!.x + panelPhone!.width).toBeLessThanOrEqual(PHONE.width + 1);
  await snap(page, 'phone-390-panel');

  // STATION, landscape: two columns, and the panel stays clear of the player
  // and its controls for the whole session.
  await page.setViewportSize(LANDSCAPE_STATION);
  await page.goto(`/move/${goalId}`);
  await expect(page.getByTestId('wsf-move-screen')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('wsf-move-screen')).toHaveAttribute('data-layout', 'station');
  await expect(page.getByTestId('wsf-move-panel-qr')).toBeVisible();
  await expect(page.getByTestId('wsf-move-panel-status')).toBeVisible();

  const noOverlap = async (label: string) => {
    const panel = await page.getByTestId('wsf-move-panel').boundingBox();
    const control = await page.getByTestId(label).boundingBox();
    expect(panel, `no panel at ${label}`).not.toBeNull();
    expect(control, `no ${label}`).not.toBeNull();
    // The panel is entirely to the right of the control it must stay clear of.
    expect(panel!.x).toBeGreaterThanOrEqual(control!.x + control!.width - 1);
  };
  await noOverlap('wsf-move-start');
  await noOverlap('wsf-move-timer');
  await snap(page, 'landscape-1280-ready');

  await page.getByTestId('wsf-move-start').click();
  await expect(page.getByTestId('wsf-move-screen')).toHaveAttribute('data-phase', 'round', {
    timeout: 8_000,
  });
  // PERSISTENT: still there mid-round, still readable, still clear of the
  // controls, and its status tracks the round.
  await expect(page.getByTestId('wsf-move-panel-qr')).toBeVisible();
  await expect(page.getByTestId('wsf-move-panel-status')).toContainText('left in this round');
  await noOverlap('wsf-move-pause');
  await snap(page, 'landscape-1280-round');

  // The panel's QR is this round's own entry address, drawn by this app.
  const qr = page.locator('[data-testid="wsf-move-panel-qr"] img').first();
  await expect(qr).toHaveCount(1);
  expect((await qr.getAttribute('src')) ?? '').toContain('data:image/svg+xml');

  // LANDSCAPE ON A PHONE is not a station: one column, panel stacked.
  await page.setViewportSize(LANDSCAPE_PHONE);
  await page.goto(`/move/${goalId}`);
  await expect(page.getByTestId('wsf-move-screen')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('wsf-move-screen')).toHaveAttribute('data-layout', 'phone');
  await snap(page, 'landscape-844-phone');
});

test('a goal this screen cannot read says so, and offers nothing it cannot back up', async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await page.goto('/move/not-a-real-goal-id');
  await expect(page.getByTestId('wsf-move-not-available')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('wsf-move-start')).toHaveCount(0);
  await expect(page.getByTestId('wsf-move-timer')).toHaveCount(0);
  await expect(page.getByTestId('wsf-move-panel')).toHaveCount(0);
  await expect(page.getByTestId('wsf-move-contribute')).toHaveCount(0);
  await snap(page, 'phone-390-not-available');
});
