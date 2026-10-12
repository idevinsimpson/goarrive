/**
 * THE CHAMPION'S MANAGE SHEET, EVENT FIRST.
 *
 * The sheet used to open on the words "Champion tools" and a mode chooser,
 * with the kiosk address for a goal buried INSIDE that goal's public-display
 * permission card, and the community's administrative facts, its join QR, its
 * invite link and leaving all sitting at the same weight as the event work.
 *
 * What this spec holds to account:
 *
 *  1. IDENTITY AND STORY FIRST. The sheet is titled with the community, and
 *     the line under it says what is actually running — including when that
 *     is "nothing yet", and including when the goals could not be loaded.
 *     It never names a goal, a total or a member count it does not have.
 *  2. ONE PRIMARY ACTION. "Your event" is the first section, and the kiosk
 *     address for each running goal is inside it — not inside a permission.
 *  3. SECONDARY WORK IS LABELLED, NOT HIDDEN. Goals, then Members and
 *     invites, then Advanced, in that order, each with its own heading, and
 *     every capability that was in the sheet before is still in it.
 *  4. HONEST STATES. Empty, ineligible and error are all real states of this
 *     surface, reached the way a Champion reaches them.
 *
 * Every capture below is taken AFTER the assertion that establishes the state
 * it is named for, and every file is hashed: two captures that are byte-
 * identical fail the test, because one of them is not the state it claims.
 * That guard exists because four published captures were not their own states
 * once before, and nothing failed to say so.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { clearVerifyGate } from './helpers/mobile';
import { openMemberManage } from './helpers/memberShell';

// A full sign-up, a community, two goals and then the sheet re-laid out at
// seven presentations. The default budget does not cover it.
test.describe.configure({ timeout: 300_000 });

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const PROJECT_ID = 'demo-wsf-local';
const PASSWORD = 'manage-secret-1';
const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts', 'ui-manage-event-first');

/** Evidence, never a reason a test passes — but never a lie either. */
const shotHashes = new Map<string, string>();
async function snap(page: Page, name: string): Promise<void> {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const file = path.join(ARTIFACTS_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
  const clash = shotHashes.get(hash);
  expect(
    clash ?? null,
    `capture "${name}" is byte-identical to "${clash}" — one of them is not the state it is named for`
  ).toBeNull();
  shotHashes.set(hash, name);
}

/**
 * The presentation matrix the Director asked for, and what each one is:
 *
 *  - 360 / 390 / 430   the three phone widths an expo actually brings.
 *  - short-390x640     a phone with the keyboard up: the sheet has far less
 *                      room than its content wants, which is where a fixed
 *                      height or a clipped control shows itself.
 *  - large-text-195    the reflow at 200% text zoom. This file's own styles
 *                      are written to ~195 px for exactly this case, so that
 *                      is the width used rather than a zoom that would scale
 *                      the screenshot as well as the layout.
 *  - wide-1280         a Champion on a laptop.
 *
 * Reduced motion is not a width, so it is applied to the whole page below
 * rather than being a row here.
 */
const PRESENTATIONS: { label: string; width: number; height: number }[] = [
  { label: '360', width: 360, height: 844 },
  { label: '390', width: 390, height: 844 },
  { label: '430', width: 430, height: 932 },
  { label: 'short-390x640', width: 390, height: 640 },
  { label: 'large-text-195', width: 195, height: 844 },
  { label: 'wide-1280', width: 1280, height: 800 },
];

/**
 * NO HORIZONTAL CLIPPING, ASSERTED RATHER THAN EYEBALLED.
 *
 * Two claims, because they fail differently: the document must not scroll
 * sideways at all, and nothing inside the sheet may be wider than the sheet
 * that holds it. A picture can be read either way by a tired reviewer at 1 am;
 * a number cannot.
 *
 * `Math.ceil` on the right-hand side, not an exact compare: sub-pixel layout
 * routinely leaves a fractional overhang that no eye and no finger can find,
 * and a test that fails on 0.4 px trains people to ignore it.
 */
async function expectNoHorizontalOverflow(page: Page, where: string): Promise<void> {
  const report = await page.evaluate(() => {
    const doc = document.documentElement;
    const panel = document.querySelector('[data-testid="wsf-community-manage-panel"]');
    const panelWidth = panel ? panel.getBoundingClientRect().width : 0;
    const offenders: string[] = [];
    if (panel) {
      for (const el of Array.from(panel.querySelectorAll('*'))) {
        const w = el.getBoundingClientRect().width;
        if (w > Math.ceil(panelWidth) + 1) {
          offenders.push(`${el.getAttribute('data-testid') ?? el.tagName}:${Math.round(w)}`);
        }
      }
    }
    return {
      pageScroll: doc.scrollWidth,
      pageWidth: window.innerWidth,
      panelWidth: Math.round(panelWidth),
      offenders: offenders.slice(0, 8),
    };
  });
  expect(report.offenders, `${where}: wider than the sheet that holds them`).toEqual([]);
  expect(
    report.pageScroll,
    `${where}: the page scrolls sideways (${report.pageScroll} > ${report.pageWidth})`
  ).toBeLessThanOrEqual(report.pageWidth + 1);
}

async function snapMatrix(page: Page, name: string, anchor: string): Promise<void> {
  const restore = page.viewportSize() ?? { width: 390, height: 844 };
  for (const p of PRESENTATIONS) {
    await page.setViewportSize({ width: p.width, height: p.height });
    // Re-anchor after every reflow, and BRING THE ANCHOR INTO FRAME.
    //
    // Waiting for visibility alone is not enough and this spec proved it: the
    // sheet keeps its scroll offset across a viewport change, so a capture
    // named for the success state was a picture of the station panel — the
    // element was present, on the page, and off the screen. "Present" is not
    // "shown", and a capture is a claim about what is shown.
    const el = page.getByTestId(anchor);
    await el.waitFor({ state: 'visible' });
    await el.scrollIntoViewIfNeeded();
    await expectNoHorizontalOverflow(page, `${name} at ${p.label}`);
    await snap(page, `${name}-${p.label}`);
  }
  await page.setViewportSize(restore);
}

const unique = (label: string) => `${label}-${randomBytes(6).toString('hex')}@example.com`;

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

/** A verified Champion with a community and no goals at all. */
async function championWithCommunity(page: Page, communityName: string): Promise<string> {
  const email = unique('manage-champ');
  await page.goto('/signup');
  await page.getByTestId('wsf-signup-displayName').fill('Manage Champion');
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
  await page.getByTestId('wsf-start-name').fill(communityName);
  await page.getByTestId('wsf-start-submit').click();
  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 25_000 });
  return new URL(page.url()).pathname.split('/').filter(Boolean).pop()!;
}

async function startGoal(page: Page, groupId: string, title: string, unit: string): Promise<string> {
  await page.goto(`/goals/new?groupId=${groupId}`);
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

async function openManage(page: Page): Promise<void> {
  await openMemberManage(page);
  await expect(page.getByTestId('wsf-community-manage-panel')).toBeVisible({ timeout: 15_000 });
}

/** The sheet's sections, in the order they are rendered. */
async function sectionOrder(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        '[data-testid="wsf-manage-event"],[data-testid="wsf-manage-goals"],' +
          '[data-testid="wsf-manage-members"],[data-testid="wsf-manage-advanced"]'
      )
    ).map((el) => el.getAttribute('data-testid') ?? '')
  );
}

// ── 1. A COMMUNITY WITH NOTHING RUNNING ─────────────────────────────────────
test('the sheet names the community, says nothing is running, and still offers every section', async ({
  page,
}) => {
  // Reduced motion is the presentation this whole test runs in: a Champion
  // who has asked their device for less movement gets the same sheet.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await championWithCommunity(page, 'Quiet Hall Movers');
  await openManage(page);

  // IDENTITY. The community is the title; "Champion tools" is the eyebrow,
  // which is also the dialog's accessible name.
  await expect(page.getByTestId('wsf-manage-title')).toHaveText('Quiet Hall Movers');
  await expect(page.getByRole('dialog', { name: 'Champion tools' })).toBeVisible();

  // THE STORY, when there is nothing to tell. No goal is invented, and the
  // member count is the real one.
  await expect(page.getByTestId('wsf-manage-story')).toContainText('No goal running yet');
  await expect(page.getByTestId('wsf-manage-story')).toContainText('1 member');

  // THE EMPTY EVENT. It says why there is nothing, and where to go — it does
  // not render an empty frame or a dead Open kiosk button.
  await expect(page.getByTestId('wsf-kiosk-setup-empty')).toContainText(
    'No goal is running, so there is nothing to put on a screen yet'
  );
  await expect(page.locator('[data-testid^="wsf-kiosk-setup-open-"]')).toHaveCount(0);
  // A community with no goals has no screens to enrol either, and says so by
  // showing nothing rather than an empty list.
  await expect(page.getByTestId('wsf-manage-screens')).toHaveCount(0);

  // ORDER. Event first, destructive last.
  expect(await sectionOrder(page)).toEqual([
    'wsf-manage-event',
    'wsf-manage-goals',
    'wsf-manage-members',
    'wsf-manage-advanced',
  ]);

  // EVERY CAPABILITY IS STILL HERE, just filed.
  await expect(page.getByTestId('wsf-community-details-toggle')).toBeVisible();
  await expect(page.getByTestId('wsf-community-qr-section')).toBeVisible();
  await expect(page.getByTestId('wsf-community-membership')).toBeVisible();
  // A community started here is PRIVATE, so there is no link to encode and no
  // link to retire. The sheet says that in the QR's own words and renders no
  // invite-link block at all — which is the honest state, not a missing one.
  await expect(page.getByTestId('wsf-community-qr-unavailable')).toBeVisible();
  await expect(page.getByTestId('wsf-community-invite-link')).toHaveCount(0);

  await snapMatrix(page, 'empty-manage', 'wsf-kiosk-setup-empty');
});

// ── 2. THE EVENT A CHAMPION CAME FOR ────────────────────────────────────────
test('with goals running, the kiosk address is the event section’s own content and never inside a permission', async ({
  page,
}) => {
  const groupId = await championWithCommunity(page, 'Expo Hall Movers');
  const goalA = await startGoal(page, groupId, 'Expo Squats', 'squats');
  const goalB = await startGoal(page, groupId, 'Expo Push-ups', 'push-ups');
  await page.goto(`/community/${groupId}`);
  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 20_000 });
  await openManage(page);

  // THE STORY counts what is running, and does not name one of two.
  await expect(page.getByTestId('wsf-manage-story')).toContainText('2 goals running');

  // THE MOVE ITSELF. Each running goal's kiosk block is a descendant of the
  // event section and NOT a descendant of that goal's permission card. This
  // is the whole finding, asserted structurally rather than by eye.
  for (const goalId of [goalA, goalB]) {
    const inEvent = page.locator(
      `[data-testid="wsf-manage-event"] [data-testid="wsf-kiosk-setup-${goalId}"]`
    );
    await expect(inEvent).toBeVisible();
    await expect(
      page.locator(
        `[data-testid="wsf-goal-display-auth-${goalId}"] [data-testid="wsf-kiosk-setup-${goalId}"]`
      )
    ).toHaveCount(0);
    // PLAIN SELECTION TRUTH, in the goal's own unit.
    await expect(page.getByTestId(`wsf-kiosk-goal-unit-${goalId}`)).toContainText('Counted in');
    // THE ADDRESS IS THE SERVED ORIGIN'S, not one assembled by hand.
    const advertised = await page
      .locator(`[data-testid="wsf-kiosk-setup-${goalId}"] [data-kiosk-url]`)
      .getAttribute('data-kiosk-url');
    expect(advertised).toBe(`${new URL(page.url()).origin}/kiosk/${goalId}`);
  }

  // The permission is still there, still per goal, under Goals — not gone,
  // not hidden, just no longer the doorway to the kiosk.
  await expect(
    page.locator(`[data-testid="wsf-manage-goals"] [data-testid="wsf-goal-display-auth-${goalA}"]`)
  ).toBeVisible();
  // And starting another goal is routine work, filed with the goals rather
  // than among the invites or behind the danger label.
  await expect(
    page.locator('[data-testid="wsf-manage-goals"] [data-testid="wsf-community-start-goal"]')
  ).toBeVisible();

  await snapMatrix(page, 'event-first-manage', `wsf-kiosk-setup-${goalA}`);

  // THE CHOOSER, which is the one question this card asks.
  await expect(page.getByTestId('wsf-kiosk-mode-one')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('wsf-kiosk-mode-combined')).toHaveAttribute('aria-checked', 'false');
  await snap(page, 'chooser-one-goal');

  // REVERSIBLE. Choosing the other mode replaces the panel, and choosing back
  // restores the addresses exactly — nothing is consumed by looking.
  await page.getByTestId('wsf-kiosk-mode-combined').click();
  await expect(page.getByTestId('wsf-combined-setup')).toBeVisible();
  await expect(page.getByTestId('wsf-kiosk-mode-one-panel')).toHaveCount(0);
  // Screens are a SIBLING of the mode: a combined event enrols them too, so
  // this list does not move when the question above it is answered.
  await expect(page.getByTestId(`wsf-kiosk-stations-${goalA}`)).toBeVisible();
  await snap(page, 'chooser-combined');

  await page.getByTestId('wsf-kiosk-mode-one').click();
  await expect(page.getByTestId(`wsf-kiosk-setup-open-${goalA}`)).toHaveAttribute(
    'href',
    `/kiosk/${goalA}`
  );
  await snap(page, 'chooser-back-to-one-goal');
});

// ── 3. THE COMBINED FLOW'S OWN STATES ───────────────────────────────────────
test('combined setup shows what is ineligible and why, refuses an incomplete answer, and reads the choice back', async ({
  page,
}) => {
  const groupId = await championWithCommunity(page, 'Combined Hall Movers');
  const goalA = await startGoal(page, groupId, 'Expo Squats', 'squats');
  const goalB = await startGoal(page, groupId, 'Expo Push-ups', 'push-ups');
  await page.goto(`/community/${groupId}`);
  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 20_000 });
  await openManage(page);
  await page.getByTestId('wsf-kiosk-mode-combined').click();
  await expect(page.getByTestId('wsf-combined-setup')).toBeVisible();

  // BEFORE A PERIOD IS CHOSEN there is nothing honest to list, and it says so
  // rather than listing everything and sorting it out later.
  await expect(page.getByTestId('wsf-combined-activities-pending')).toBeVisible();
  await snap(page, 'combined-activities-pending');

  // INELIGIBLE, WITH THE REASON. A window shorter than the goal cannot hold it.
  await page.getByTestId('wsf-combined-start').fill(localValue(-1));
  await page.getByTestId('wsf-combined-end').fill(localValue(1));
  await expect(page.getByTestId(`wsf-combined-pick-ineligible-${goalA}`)).toBeVisible();
  await snapMatrix(page, 'combined-ineligible', `wsf-combined-pick-ineligible-${goalA}`);

  // ERROR. A real refusal, reached the way a Champion reaches it: a period
  // that fits, no name, and the one action pressed.
  //
  // This capture must stay VISIBLY INVALID — the name field is empty in it, so
  // the red message and the form agree with each other. It is deliberately
  // taken before anything is corrected.
  await page.getByTestId('wsf-combined-end').fill(localValue(30));
  await expect(page.getByTestId(`wsf-combined-pick-${goalA}`)).toBeVisible();
  await page.getByTestId('wsf-combined-submit').click();
  await expect(page.getByTestId('wsf-combined-error')).toContainText(
    'Give this combined goal a name'
  );
  await expect(page.getByTestId('wsf-combined-title')).toHaveValue('');
  await snapMatrix(page, 'combined-error', 'wsf-combined-error');

  // ── A FAILED SUBMIT DOES NOT OUTLIVE THE DATA THAT CAUSED IT ──────────────
  //
  // The regression for the defect this spec's own capture exposed: a review
  // panel reading back "Expo Moves" with "Give this combined goal a name of at
  // least two characters." in red above it. The message described data that no
  // longer existed, and nothing failed to say so.
  //
  // Typing a valid name is enough. No second submit, because the point is that
  // the message goes BEFORE the next submit, not because of it.
  await page.getByTestId('wsf-combined-title').fill('Expo Moves');

  // The name's message is gone the moment the name is valid — no second submit.
  //
  // NOT `toHaveCount(0)` here, and the first draft of this assertion got that
  // wrong and failed, which is the point of writing it: the unit is still empty
  // at this moment, so an error area SHOULD be on screen. What must be true is
  // that it no longer describes the name. Asserting "no error at all" would
  // have demanded the screen lie about the unit to satisfy the test.
  await expect(page.getByTestId('wsf-combined-error')).not.toContainText(
    'Give this combined goal a name'
  );
  // And what IS shown is the true next problem, recomputed from current values.
  await expect(page.getByTestId('wsf-combined-error')).toContainText(
    'Say what the combined count is in'
  );

  // THE REVIEW. The same facts read back, in local words, above the action —
  // including what actually contributes to the combined total.
  await page.getByTestId('wsf-combined-unit').fill('movements');
  await page.getByTestId('wsf-combined-target').fill('2000');
  // At least two, because a combined goal that combines one thing is not one.
  await page.getByTestId(`wsf-combined-pick-${goalA}`).click();
  await page.getByTestId(`wsf-combined-pick-${goalB}`).click();
  const summary = page.getByTestId('wsf-combined-summary');
  await expect(summary).toContainText('Expo Moves');
  await expect(summary).toContainText('2,000 movements');
  await expect(summary).toContainText('Expo Squats');
  await expect(summary).toContainText('Expo Push-ups');
  // THE STATE-TRUTH ASSERTION. The review panel and the error area must not
  // contradict each other. Asserting the summary's content while leaving a red
  // refusal above it unasserted is exactly how the defect shipped.
  await expect(page.getByTestId('wsf-combined-error')).toHaveCount(0);
  await snapMatrix(page, 'combined-review', 'wsf-combined-summary');

  // SUCCESS, and the address it produces — from the served origin.
  await page.getByTestId('wsf-combined-submit').click();
  await expect(page.getByTestId('wsf-combined-created')).toContainText('is ready', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('wsf-combined-error')).toHaveCount(0);
  const combinedUrl = await page
    .locator('[data-combined-url]')
    .getAttribute('data-combined-url');
  expect(combinedUrl).toMatch(new RegExp(`^${new URL(page.url()).origin}/combined/\\S+$`));
  await snapMatrix(page, 'combined-success', 'wsf-combined-created');
});
