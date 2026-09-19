/**
 * COMBINED MOVEMENT GOAL — the Champion's control, and the screen it produces.
 *
 * Four things are proved here, in the order a Champion meets them:
 *
 *  1. NO REGRESSION. Opening Manage shows the new "Set up kiosk" question with
 *     "One goal" already selected, and with it selected every existing
 *     per-goal kiosk control is exactly where it was. This is the guard for
 *     `kiosk-setup-link.spec.ts`, which is not edited.
 *  2. THE SETUP. Choosing "Combined movement goal" lists the activities that
 *     fit inside the chosen period, names the ones that do not and why, reads
 *     the choice back before the one action, and produces a real address built
 *     from the origin this build is actually served from.
 *  3. THE STABLE URL, AND THE ACTIVATION BOUNDARY. That exact address opens in
 *     a BRAND-NEW browser context with no session, no storage and no history.
 *     It opens at ZERO, because nothing has been recorded since the combined
 *     goal began; 20 and 15 are then recorded and it reaches 35 on its own
 *     poll; and it survives a reload — which is what proves the static export
 *     alias and the Hosting rewrite together.
 *
 *     THE ORDER HERE IS THE POINT. This spec used to record 20 and 15 BEFORE
 *     activating and then expect 35 immediately. That was the silent backfill
 *     the Director refused, written into a browser test as though it were the
 *     requirement. A combined goal counts what is recorded after it begins.
 *  4. NO AUTHORITY ON THE URL. In that same fresh context there is no Manage
 *     entry, no display-authorization toggle, no setup form, no contribute
 *     action, and no uid anywhere in the page.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

// Re-laying the Manage sheet out at four viewports is real work on top of a
// full sign-up, two goals and a community, and the default 30 s budget is not
// enough for it.
test.describe.configure({ timeout: 180_000 });

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const PROJECT_ID = 'demo-wsf-local';
const PASSWORD = 'combined-secret-1';
const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts', 'ui-combined-goal');

/** Evidence, never a reason a test passes: nothing asserts on these images.
 * The same helper `move-follow-along.spec.ts` uses. */
async function snap(page: Page, name: string): Promise<void> {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, `${name}.png`), fullPage: false });
}

/** The phone sizes an expo actually brings, plus the short one that finds what
 * a tall viewport hides. No assertion is made about any of these images. */
const PHONE_SIZES: { label: string; width: number; height: number }[] = [
  { label: '360', width: 360, height: 844 },
  { label: '430', width: 430, height: 932 },
  { label: 'short-390x640', width: 390, height: 640 },
];

async function snapWidths(page: Page, name: string): Promise<void> {
  const restore = page.viewportSize() ?? { width: 390, height: 844 };
  for (const size of PHONE_SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await snap(page, `${name}-${size.label}`);
  }
  await page.setViewportSize(restore);
}

const unique = (label: string) => `${label}-${randomBytes(6).toString('hex')}@example.com`;

/** `YYYY-MM-DDTHH:mm` in the browser's own local time — the only shape the
 * datetime-local control takes, and the shape the panel parses. */
function localValue(offsetDays: number, hour = 12): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

async function markEmailVerified(email: string): Promise<void> {
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
  await fetch(`${base}/projects/${PROJECT_ID}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ localId: user.localId, emailVerified: true }),
  });
}

async function startGoal(page: Page, groupId: string, title: string, unit: string): Promise<string> {
  await page.goto(`/community/${groupId}`);
  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 20_000 });
  const startControl = page.getByTestId('wsf-community-start-goal');
  if (await startControl.count()) {
    await startControl.click();
  } else {
    await page.goto(`/goals/new?groupId=${groupId}`);
  }
  await expect(page.getByTestId('wsf-new-goal-form')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-new-goal-title').fill(title);
  await page.getByTestId('wsf-new-goal-target').fill('1000');
  await page.getByTestId('wsf-new-goal-unit').fill(unit);
  await page.getByTestId('wsf-new-goal-submit').click();
  const created = page.getByTestId('wsf-new-goal-created');
  await expect(created).toBeVisible({ timeout: 25_000 });
  const goalId = (await created.getAttribute('data-goal-id')) ?? '';
  expect(goalId).toMatch(/^\S+$/);
  return goalId;
}

/** A Champion with a community and TWO open activities, ready to combine. */
async function championWithTwoGoals(
  page: Page
): Promise<{ groupId: string; goalA: string; goalB: string }> {
  const email = unique('combined-champ');
  await page.goto('/signup');
  await page.getByTestId('wsf-signup-displayName').fill('Combined Champion');
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
  await page.getByTestId('wsf-start-submit').click();
  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 25_000 });
  const groupId = new URL(page.url()).pathname.split('/').filter(Boolean).pop()!;

  const goalA = await startGoal(page, groupId, 'Expo Squats', 'squats');
  const goalB = await startGoal(page, groupId, 'Expo Push-ups', 'push-ups');

  await page.goto(`/community/${groupId}`);
  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 20_000 });
  return { groupId, goalA, goalB };
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

/** Record `count` on one goal through the ordinary contribution flow. */
async function recordOn(page: Page, groupId: string, goalId: string, count: string): Promise<void> {
  await page.goto(`/contribute/${goalId}?groupId=${groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 25_000 });
  await page.getByTestId('wsf-contribute-entry').fill(count);
  await page.getByTestId('wsf-contribute-review').click();
  await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 25_000 });
}

// ── 1. NO REGRESSION ────────────────────────────────────────────────────────
test('Set up kiosk asks one question, defaults to One goal, and leaves the per-goal controls exactly as they were', async ({
  page,
}) => {
  const { goalA, goalB } = await championWithTwoGoals(page);
  await openManage(page);

  const mode = page.getByTestId('wsf-kiosk-mode');
  await expect(mode).toBeVisible();
  await expect(page.getByTestId('wsf-kiosk-mode-one')).toBeVisible();
  await expect(page.getByTestId('wsf-kiosk-mode-combined')).toBeVisible();
  // The default is load-bearing: with it selected nothing that already exists
  // moves, so `kiosk-setup-link.spec.ts` passes unedited.
  await expect(page.getByTestId('wsf-kiosk-mode-one')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('wsf-kiosk-mode-combined')).toHaveAttribute('aria-checked', 'false');

  for (const goalId of [goalA, goalB]) {
    await expect(page.getByTestId(`wsf-kiosk-setup-${goalId}`)).toBeVisible();
    await expect(page.getByTestId(`wsf-kiosk-setup-open-${goalId}`)).toHaveAttribute(
      'href',
      `/kiosk/${goalId}`
    );
    await expect(page.getByTestId(`wsf-kiosk-setup-copy-${goalId}`)).toBeVisible();
  }
  // The combined panel is not on screen until it is chosen.
  await expect(page.getByTestId('wsf-combined-setup')).toHaveCount(0);

  // ── CAPTURES ──────────────────────────────────────────────────────────────
  // Every assertion above has already run. These only photograph the sheet the
  // Champion actually gets: the "Set up kiosk" card at the three phone widths
  // the product is used at, and at a short viewport where the sheet has far
  // less room than its content wants.
  for (const [name, size] of [
    ['phone-360-set-up-kiosk', { width: 360, height: 844 }],
    ['phone-390-set-up-kiosk', { width: 390, height: 844 }],
    ['phone-430-set-up-kiosk', { width: 430, height: 932 }],
    ['phone-390-short-set-up-kiosk', { width: 390, height: 640 }],
  ] as const) {
    await page.setViewportSize(size);
    await page.getByTestId('wsf-kiosk-mode').waitFor({ state: 'visible' });
    await snap(page, name);
  }

  // The other half of the same card, so the choice is on record both ways.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('wsf-kiosk-mode-combined').click();
  await page.getByTestId('wsf-combined-setup').waitFor({ state: 'visible' });
  await snap(page, 'phone-390-set-up-kiosk-combined');
});

// ── 2, 3 and 4 in one journey, because they are one journey ────────────────
test('a Champion combines two activities, and the address opens cold, reloads, and carries no authority', async ({
  page,
  browser,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { groupId, goalA, goalB } = await championWithTwoGoals(page);

  // Both activities must be published for the combined screen to open to a
  // browser that is not signed in: it is EVERY child, not any child.
  await openManage(page);
  await authorizeDisplay(page, goalA);
  await authorizeDisplay(page, goalB);
  await page.getByTestId('wsf-community-manage-close').click();

  // DELIBERATELY NOTHING IS RECORDED YET. The combined goal is activated over
  // two activities that are at zero, then the repetitions are recorded, then
  // the screen is checked. The old version of this spec recorded 20 and 15
  // BEFORE activating and expected 35 to appear on the spot — which was the
  // silent backfill, written into a test as though it were the requirement.
  // See the "OPENS AT ZERO" block below for the assertion that replaced it.

  await page.goto(`/community/${groupId}`);
  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 20_000 });
  await openManage(page);
  await page.getByTestId('wsf-kiosk-mode-combined').click();
  await expect(page.getByTestId('wsf-combined-setup')).toBeVisible();
  // Choosing the other mode replaces the single-goal controls rather than
  // sitting beside them.
  await expect(page.getByTestId(`wsf-kiosk-setup-${goalA}`)).toHaveCount(0);

  await page.getByTestId('wsf-combined-title').fill('Move together');
  await page.getByTestId('wsf-combined-unit').fill('movements');
  await page.getByTestId('wsf-combined-target').fill('2000');

  // A period that does NOT contain the activities: each is named, with the
  // reason, rather than silently disappearing from the list.
  await page.getByTestId('wsf-combined-start').fill(localValue(-1));
  await page.getByTestId('wsf-combined-end').fill(localValue(1));
  await expect(page.getByTestId(`wsf-combined-pick-ineligible-${goalA}`)).toContainText(
    'ends after the combined period'
  );

  // Widen it, and both become choosable.
  await page.getByTestId('wsf-combined-end').fill(localValue(30));
  await expect(page.getByTestId(`wsf-combined-pick-${goalA}`)).toBeVisible();
  await expect(page.getByTestId(`wsf-combined-pick-${goalB}`)).toBeVisible();
  await page.getByTestId(`wsf-combined-pick-${goalA}`).click();
  await page.getByTestId(`wsf-combined-pick-${goalB}`).click();
  await expect(page.getByTestId(`wsf-combined-pick-${goalA}`)).toHaveAttribute(
    'aria-checked',
    'true'
  );

  // The zone is a stated fact, and there is no control of any kind to change it.
  await expect(page.getByTestId('wsf-combined-timezone-line')).toContainText('Times are in');
  await expect(page.getByTestId('wsf-combined-timezone-error')).toHaveCount(0);

  // REVIEW BEFORE COMMIT: the choice read back, above the one action.
  const summary = page.getByTestId('wsf-combined-summary');
  await expect(summary).toContainText('Move together');
  await expect(summary).toContainText('2,000 movements');
  await expect(summary).toContainText('Expo Squats');
  await expect(summary).toContainText('Expo Push-ups');

  await page.getByTestId('wsf-combined-submit').click();
  const created = page.getByTestId('wsf-combined-created');
  await expect(created).toBeVisible({ timeout: 25_000 });

  // The address the controls act on, machine-readable without being printed
  // at a person, and built from the origin this build is actually served from.
  const advertised = await created.locator('[data-combined-url]').getAttribute('data-combined-url');
  const origin = new URL(page.url()).origin;
  expect(advertised?.startsWith(`${origin}/combined/`)).toBe(true);
  const setupId = advertised!.slice(`${origin}/combined/`.length);
  expect(setupId).toMatch(/^[A-Za-z0-9_-]+$/);
  await expect(page.getByTestId('wsf-combined-open')).toHaveAttribute(
    'href',
    `/combined/${setupId}`
  );

  // COPY: read what actually reached the clipboard, not what we hoped would.
  await page.getByTestId('wsf-combined-copy').click();
  await expect(page.getByTestId('wsf-combined-copy')).toHaveText('Copied');
  const copied = (await page.evaluate(() => navigator.clipboard.readText())).trim();
  expect(copied).toBe(advertised);

  // ── 3. OPEN IT COLD, then reload it ──────────────────────────────────────
  const fresh = await browser.newContext();
  const screen = await fresh.newPage();
  await screen.goto(copied);
  await expect(screen.getByTestId('wsf-combined-screen')).toBeVisible({ timeout: 25_000 });
  await expect(screen.getByTestId('wsf-combined-community')).toContainText('Expo Hall Movers');
  await expect(screen.getByTestId('wsf-combined-title-text')).toHaveText('Move together');

  // ── IT OPENS AT ZERO ─────────────────────────────────────────────────────
  // Nothing has been recorded since this combined goal began, so it says zero
  // and says what it is counting since.
  await expect(screen.getByTestId('wsf-combined-shared-total')).toHaveText(
    '0 of 2,000 movements'
  );
  await expect(screen.getByTestId('wsf-combined-counting-since')).toContainText(
    'Counting since'
  );
  await expect(screen.getByTestId(`wsf-combined-activity-counted-${goalA}`)).toHaveText(
    '0 counted toward Move together'
  );

  // ── NOW RECORD 20 AND 15, AFTER ACTIVATION ───────────────────────────────
  await recordOn(page, groupId, goalA, '20');
  await recordOn(page, groupId, goalB, '15');

  // The screen polls, so it arrives on its own. 35 together.
  await expect(screen.getByTestId('wsf-combined-shared-total')).toHaveText(
    '35 of 2,000 movements',
    { timeout: 25_000 }
  );
  // Each activity keeps its OWN goal, and says so on the same screen.
  await expect(screen.getByTestId(`wsf-combined-activity-total-${goalA}`)).toHaveText(
    '20 of 1,000 squats'
  );
  await expect(screen.getByTestId(`wsf-combined-activity-total-${goalB}`)).toHaveText(
    '15 of 1,000 push-ups'
  );
  // And says separately what it counted toward the combined goal. Here the two
  // numbers agree because both activities started at zero; they are different
  // facts, and the callable suite pins the case where they differ.
  await expect(screen.getByTestId(`wsf-combined-activity-counted-${goalA}`)).toHaveText(
    '20 counted toward Move together'
  );
  await expect(screen.getByTestId(`wsf-combined-activity-counted-${goalB}`)).toHaveText(
    '15 counted toward Move together'
  );

  await screen.reload();
  await expect(screen.getByTestId('wsf-combined-screen')).toBeVisible({ timeout: 25_000 });
  await expect(screen.getByTestId('wsf-combined-shared-total')).toHaveText(
    '35 of 2,000 movements',
    { timeout: 25_000 }
  );

  // ── 4. NO AUTHORITY ON THE URL ───────────────────────────────────────────
  await expect(screen.getByTestId('wsf-community-manage')).toHaveCount(0);
  await expect(screen.getByTestId(`wsf-goal-display-auth-toggle-${goalA}`)).toHaveCount(0);
  await expect(screen.getByTestId('wsf-combined-submit')).toHaveCount(0);
  await expect(screen.getByTestId('wsf-contribute-submit')).toHaveCount(0);
  await expect(screen.getByTestId('wsf-kiosk-mode')).toHaveCount(0);
  const body = (await screen.locator('body').innerText()).toLowerCase();
  expect(body).not.toContain('uid');
  expect(body).not.toContain(setupId.toLowerCase());

  // ── OVERFLOW, invariant 4 of the brief ───────────────────────────────────
  for (const width of [195, 360, 390]) {
    await screen.setViewportSize({ width, height: 800 });
    await expect(screen.getByTestId('wsf-combined-screen')).toBeVisible();
    const overflowing = await screen.evaluate(() => {
      const bad: string[] = [];
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const style = getComputedStyle(el);
        if (style.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1) {
          bad.push(el.tagName + '.' + (el.className || '').toString().slice(0, 40));
        }
        if (el.getBoundingClientRect().right > window.innerWidth + 1) {
          bad.push('past-right:' + el.tagName);
        }
      }
      return bad;
    });
    expect(overflowing, `overflow at ${width}px`).toEqual([]);
  }

  await fresh.close();
});

// ── the setup URL is not a key ──────────────────────────────────────────────
test('an unknown combined address says the same nothing an unauthorized one says', async ({
  browser,
}) => {
  const fresh = await browser.newContext();
  const screen = await fresh.newPage();
  await screen.goto('/combined/no-such-setup-at-all');
  await expect(screen.getByTestId('wsf-combined-not-available')).toBeVisible({ timeout: 25_000 });
  await expect(screen.getByTestId('wsf-combined-not-available')).toContainText(
    'Nothing to show here'
  );
  await expect(screen.getByTestId('wsf-combined-recheck')).toBeVisible();
  await fresh.close();
});

/**
 * THE MULTI-ACTIVITY CHOICE, which only exists on a combined event.
 *
 * A lone goal offers one activity, and a single radio beside a heading reads
 * as a form to fill in. A COMBINED event is the case the control exists for:
 * several activities behind one address, where the person genuinely has to
 * pick, and where the thing they are picking between must read as a thing —
 * the goal's own title, with what it counts underneath — rather than as a
 * repeated unit word.
 *
 * The two ways on still do not exist until an activity is selected, and
 * selecting one still puts nobody in a line. That rule is asserted here on the
 * combined path as well as the single-goal one, because it is the rule a
 * combined QR is most likely to break.
 */
test('a combined event offers every frozen activity by name, and the ways on appear only after one is chosen', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  // A phone, because this is a phone screen. The Champion tools above are
  // driven at whatever width this spec's other tests use; the captures below
  // are taken at the width the choice will be met at.
  const { groupId, goalA, goalB } = await championWithTwoGoals(page);

  await openManage(page);
  await authorizeDisplay(page, goalA);
  await authorizeDisplay(page, goalB);
  await page.getByTestId('wsf-community-manage-close').click();

  await page.goto(`/community/${groupId}`);
  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 20_000 });
  await openManage(page);
  await page.getByTestId('wsf-kiosk-mode-combined').click();
  await expect(page.getByTestId('wsf-combined-setup')).toBeVisible();
  await page.getByTestId('wsf-combined-title').fill('Move together');
  await page.getByTestId('wsf-combined-unit').fill('movements');
  await page.getByTestId('wsf-combined-target').fill('2000');
  await page.getByTestId('wsf-combined-start').fill(localValue(-1));
  await page.getByTestId('wsf-combined-end').fill(localValue(30));
  await page.getByTestId(`wsf-combined-pick-${goalA}`).click();
  await page.getByTestId(`wsf-combined-pick-${goalB}`).click();
  await page.getByTestId('wsf-combined-submit').click();
  await expect(page.getByTestId('wsf-combined-created')).toBeVisible({ timeout: 25_000 });

  await page.setViewportSize({ width: 390, height: 844 });

  // ---- THE EVENT, ENTERED THROUGH ONE OF ITS CHILDREN ---------------------
  // The address names a child; the event behind it is the combined setup, and
  // what it offers is EVERY frozen child rather than the one in the URL.
  await page.goto(`/event/${goalA}`);
  await expect(page.getByTestId('wsf-event-device-choice')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-device-choice-personal').click();
  await expect(page.getByTestId('wsf-event-member')).toBeVisible({ timeout: 25_000 });

  // THE EVENT INTRODUCES ITSELF AS THE EVENT. The address names a child, so
  // the goal pulse's title is that child's — which had a combined event called
  // "Move together" heading itself "Expo Squats", one of the two things it was
  // about to offer.
  // Asserted on the TITLE, not the page: "Expo Squats" belongs on this screen
  // — as one of the two activities on offer — just not as the event's name.
  await expect(page.getByTestId('wsf-event-title')).toHaveText('Move together');

  // BOTH ACTIVITIES, EACH BY ITS OWN NAME, each saying what it counts.
  const squats = page.getByTestId('wsf-event-activity-squats');
  const pushups = page.getByTestId('wsf-event-activity-push-ups');
  await expect(squats).toBeVisible({ timeout: 20_000 });
  await expect(pushups).toBeVisible();
  await expect(page.getByTestId('wsf-event-activity-squats-label')).toHaveText('Expo Squats');
  await expect(page.getByTestId('wsf-event-activity-push-ups-label')).toHaveText('Expo Push-ups');
  await expect(page.getByTestId('wsf-event-activity-squats-description')).toContainText(
    'Counted in squats.'
  );
  await expect(page.getByTestId('wsf-event-activity-push-ups-description')).toContainText(
    'Counted in push-ups.'
  );

  // NOTHING IS CHOSEN FOR THEM, and the ways on do not exist yet.
  await expect(page.getByTestId('wsf-event-activity-squats-indicator-dot')).toHaveCount(0);
  await expect(page.getByTestId('wsf-event-activity-push-ups-indicator-dot')).toHaveCount(0);
  await expect(page.getByTestId('wsf-event-choice')).toHaveCount(0);
  await snap(page, 'combined-390-activity-choice');
  await snapWidths(page, 'combined-activity-choice');

  // ---- ONE IS CHOSEN, AND ONLY THEN THE TWO WAYS ON ----------------------
  await pushups.click();
  await expect(page.getByTestId('wsf-event-activity-push-ups-indicator-dot')).toBeVisible();
  await expect(page.getByTestId('wsf-event-activity-squats-indicator-dot')).toHaveCount(0);
  const choice = page.getByTestId('wsf-event-choice');
  await expect(choice).toBeVisible({ timeout: 10_000 });
  // The choice says back WHICH activity, so the queue somebody joins is the
  // one they picked and not the one the address happened to name.
  await expect(page.getByTestId('wsf-event-choice-activity')).toHaveText('push-ups');
  await snap(page, 'combined-390-two-choices');
  await snapWidths(page, 'combined-two-choices');
});
