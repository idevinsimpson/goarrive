import { randomBytes } from 'node:crypto';

import { expect, test, type Page, type Route } from '@playwright/test';

import {
  firestoreWrite,
  IPHONE_UA,
  seedActiveGoal,
  seedCommunity,
  seedProfile,
  seedShards,
  seedVerifiedUser,
  signInVia,
  stampId,
  tsField,
} from './helpers/mobile';

/**
 * W7 — INDEPENDENT CHECK of W8's Progress-copy packet, #451 `90f8e74`
 * (L0 `5800714161`). Read-only; W8's spec and product are not touched.
 *
 * W8's own spec covers populated / empty / error. This file adds what the
 * packet names and that spec does not measure:
 *
 *   C1  populated — subtitle; the clarification exactly once; the retired
 *       assurances absent from the WHOLE page (W8 sweeps `wsf-activity` only);
 *       finished history (REACHED + Living WE), units per row, goals counted.
 *   C2  empty at 390x640 — the headline; Start moving fully on screen at rest,
 *       above the tab bar, and hit-testable at its own centre (W8: visible).
 *   C3  error — subtitle; ONE reassurance sentence; no clarification (the
 *       accepted design: README "Empty + populated foot"; the Director-passed
 *       error frame shows none); Try again is the green primary and RETRIES.
 *   C4  partial failure — PartialNote kept beside the rows that did load.
 *   C5  loading — the loading state still renders, under the subtitle, and
 *       carries no retired assurance.
 *
 * MEASURED. On 90f8e74: 5/5, twice (with W8's 3 and the shell Activity test:
 * 18/18). On its parent f2f901a (the old copy): 5/5 FAIL, each at a copy
 * assertion (the subtitle testID does not exist there; the empty headline
 * differs). C4 and C5 got past their partial-note and loading assertions
 * first, so those states are present on both builds. Retired-phrase guard
 * mutant (local build output only, restored byte-identical): "WHAT YOU'RE
 * PART OF NOW" → "Nothing was lost" makes C1 fail at the retired-phrase
 * assertion, and W8's own guard fail at its line 167. QA report, Check 15.
 */

test.use({
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: IPHONE_UA,
  locale: 'en-US',
  timezoneId: 'America/New_York',
});

const SUBTITLE = 'Your recorded contributions, by goal.';
const CLARIFICATION = 'This personal summary is only for you. Community activity follows your visibility settings.';
const REASSURANCE = 'What you recorded is still recorded. This screen could not read it just now.';
/** Every assurance the packet removes, as the old build worded it (f2f901a:activity.tsx). */
const RETIRED = [
  'Only you can see this',
  'never compared with anyone else',
  'nobody else can see',
  'This page is only ever yours',
  'kept to yourself',
  'Nothing was lost',
  'Nothing has changed',
  'Nothing recorded yet',
];
const ACTION_GREEN = 'rgb(34, 197, 94)';

async function member(label: string) {
  const id = stampId();
  const email = `w7pc-${label}-${id}@example.com`;
  const password = `Aa1!${randomBytes(6).toString('hex')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Robin Vale');
  return { id, email, password, uid };
}

async function ownCredit(goalId: string, uid: string, total: number): Promise<void> {
  await firestoreWrite(`wsfGoalMemberTotals/${goalId}_${uid}`, {
    goalId: { stringValue: goalId },
    userId: { stringValue: uid },
    total: { integerValue: String(total) },
    contributionCount: { integerValue: '1' },
    updatedAt: tsField(new Date()),
  });
}

async function closedReachedGoal(goalId: string, groupId: string, uid: string): Promise<void> {
  const ended = new Date(Date.now() - 20 * 24 * 60 * 60_000);
  const began = new Date(ended.getTime() - 30 * 24 * 60 * 60_000);
  await firestoreWrite(`wsfGoals/${goalId}`, {
    ownerUid: { stringValue: uid },
    communityGroupId: { stringValue: groupId },
    title: { stringValue: 'W7 Finished Push' },
    target: { integerValue: '1000' },
    unit: { stringValue: 'push-ups' },
    status: { stringValue: 'closed' },
    startsAt: tsField(began),
    endsAt: tsField(ended),
    closedAt: tsField(ended),
    reachedAt: tsField(new Date(ended.getTime() - 3_600_000)),
    timezone: { stringValue: 'America/New_York' },
    createdAt: tsField(began),
    updatedAt: tsField(ended),
  });
  await seedShards(goalId, 1100);
  await ownCredit(goalId, uid, 90);
}

/** A community with two running goals in different units and one finished, reached goal. */
async function populatedCommunity(uid: string, tag: string) {
  const groupId = `w7pcg-${tag}`;
  await seedCommunity({ groupId, displayName: 'W7 Copy Movers', joinPolicy: 'private', members: [{ uid, role: 'member' }] });
  const squats = `w7pcs-${tag}`;
  const laps = `w7pcl-${tag}`;
  const done = `w7pcd-${tag}`;
  await seedActiveGoal({ goalId: squats, groupId, ownerUid: uid, title: 'W7 Squats', target: 5000, unit: 'squats', total: 2222 });
  await ownCredit(squats, uid, 33);
  await seedActiveGoal({ goalId: laps, groupId, ownerUid: uid, title: 'W7 Laps', target: 400, unit: 'laps', total: 101 });
  await ownCredit(laps, uid, 7);
  await closedReachedGoal(done, groupId, uid);
  return { groupId, squats, laps, done };
}

async function pageText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}

async function expectNoRetired(page: Page): Promise<void> {
  const text = await pageText(page);
  const found = RETIRED.filter((p) => text.includes(p));
  expect(found, 'a retired assurance is on the page').toEqual([]);
}

test.describe('#451 Progress copy, independent instruments', () => {
  test('C1 populated: subtitle, the clarification once, no retired assurance anywhere, history and units intact', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const me = await member('c1');
    const g = await populatedCommunity(me.uid, me.id);
    await signInVia(page, me.email, me.password);
    await page.goto('/activity');
    const rows = page.getByTestId('wsf-activity-rows');
    await expect(rows).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-activity-subtitle')).toHaveText(SUBTITLE);
    await expect(page.getByTestId('wsf-activity-privacy')).toHaveCount(1);
    await expect(page.getByTestId('wsf-activity-privacy')).toHaveText(CLARIFICATION);
    expect((await pageText(page)).split(CLARIFICATION).length - 1, 'the clarification is said more than once').toBe(1);
    await expectNoRetired(page);
    await expect(page.getByTestId(`wsf-activity-done-${g.done}`)).toContainText('REACHED');
    await expect(page.getByTestId('wsf-activity-we')).toBeVisible();
    await expect(page.getByTestId(`wsf-activity-row-${g.squats}`)).toContainText('33 squats');
    await expect(page.getByTestId(`wsf-activity-row-${g.laps}`)).toContainText('7 laps');
    await expect(page.getByTestId(`wsf-activity-row-${g.squats}`)).not.toContainText('laps');
    await expect(rows).toContainText('3 goals you have added to');
    // Each running row LEADS with the member's own number; the goal's shared
    // total follows as context ("2,222 of 5,000 squats"), as in the
    // Director-passed frame ("1,847 of 5,000 squats"). An earlier revision of
    // this file asserted the shared total never appears — wrong about the design.
    expect((await page.getByTestId(`wsf-activity-row-${g.squats}`).innerText()).trim().startsWith('33'), 'the row does not lead with the member\'s own number').toBe(true);
    await expect(page.getByTestId(`wsf-activity-row-${g.squats}`)).toContainText('2,222 of 5,000 squats');
  });

  test('C2 empty at 390x640: the headline, and Start moving fully on screen above the tab bar at rest', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 390, height: 640 });
    const me = await member('c2');
    await signInVia(page, me.email, me.password);
    await page.goto('/activity');
    const empty = page.getByTestId('wsf-activity-empty');
    await expect(empty).toBeVisible({ timeout: 40_000 });
    await expect(empty).toContainText('Your first contribution will appear here');
    await expect(empty).toContainText('Add what you did to a goal, and it is recorded here under that goal.');
    await expect(page.getByTestId('wsf-activity-privacy')).toHaveCount(1);
    await expectNoRetired(page);
    await page.waitForTimeout(800);
    const geo = await page.evaluate(() => {
      const start = document.querySelector('[data-testid="wsf-activity-start"]') as HTMLElement;
      const r = start.getBoundingClientRect();
      const bars = Array.from(document.querySelectorAll('[data-testid="wsf-member-tabs"]'))
        .map((b) => (b as HTMLElement).getBoundingClientRect())
        .filter((b) => b.height > 0);
      const barTop = bars.length ? Math.min(...bars.map((b) => b.top)) : window.innerHeight;
      let hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) as HTMLElement | null;
      while (hit && !hit.dataset?.testid) hit = hit.parentElement;
      const title = Array.from(document.querySelectorAll('[data-testid="wsf-activity-empty"] *')).find(
        (n) => (n as HTMLElement).innerText === 'Your first contribution will appear here',
      ) as HTMLElement | undefined;
      const lh = title ? parseFloat(getComputedStyle(title).lineHeight) : NaN;
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        height: Math.round(r.height),
        barTop: Math.round(barTop),
        hit: hit?.dataset.testid ?? '-',
        headlineLines: title && lh ? Math.round(title.getBoundingClientRect().height / lh) : -1,
      };
    });
    test.info().annotations.push({ type: 'geometry', description: JSON.stringify(geo) });
    expect(geo.top, 'Start moving starts above the screen').toBeGreaterThanOrEqual(0);
    expect(geo.bottom, 'Start moving runs under the tab bar').toBeLessThanOrEqual(geo.barTop);
    expect(geo.height, 'Start moving is smaller than a touch target').toBeGreaterThanOrEqual(44);
    expect(geo.hit, 'something covers Start moving').toBe('wsf-activity-start');
  });

  test('C3 error: one reassurance, no clarification, Try again is the green primary and retries', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const me = await member('c3');
    await populatedCommunity(me.uid, me.id);
    await signInVia(page, me.email, me.password);
    let fail = true;
    await page.route('**/wsfMyCommunities', (route: Route) => (fail ? route.abort('failed') : route.continue()));
    await page.goto('/activity');
    const error = page.getByTestId('wsf-activity-error');
    await expect(error).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-activity-subtitle')).toHaveText(SUBTITLE);
    expect((await pageText(page)).split(REASSURANCE).length - 1, 'the reassurance is not said exactly once').toBe(1);
    await expect(page.getByTestId('wsf-activity-privacy')).toHaveCount(0);
    await expectNoRetired(page);
    await expect(page.getByTestId('wsf-activity-home')).toBeVisible();
    await expect(page.getByTestId('wsf-activity-move')).toBeVisible();
    const retry = page.getByTestId('wsf-activity-retry');
    await expect(retry).toBeVisible();
    const bg = await retry.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg, 'Try again is not the green primary').toBe(ACTION_GREEN);
    fail = false;
    await retry.click();
    await expect(page.getByTestId('wsf-activity-rows')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-activity-privacy')).toHaveCount(1);
  });

  test('C4 partial failure: the partial note stays beside the goals that did load', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const me = await member('c4');
    const good = await populatedCommunity(me.uid, `${me.id}a`);
    const bad = await populatedCommunity(me.uid, `${me.id}b`);
    await signInVia(page, me.email, me.password);
    await page.route('**/wsfListGoals', async (route: Route) => {
      const body = route.request().postData() ?? '';
      if (body.includes(bad.groupId)) return route.abort('failed');
      return route.continue();
    });
    await page.goto('/activity');
    await expect(page.getByTestId('wsf-activity-rows')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-activity-partial')).toBeVisible();
    await expect(page.getByTestId(`wsf-activity-row-${good.squats}`)).toBeVisible();
    await expect(page.getByTestId(`wsf-activity-row-${bad.squats}`)).toHaveCount(0);
    await expect(page.getByTestId('wsf-activity-subtitle')).toHaveText(SUBTITLE);
    await expect(page.getByTestId('wsf-activity-privacy')).toHaveCount(1);
    await expectNoRetired(page);
  });

  test('C5 loading: the loading state still renders under the subtitle, with no retired assurance', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const me = await member('c5');
    await populatedCommunity(me.uid, me.id);
    await signInVia(page, me.email, me.password);
    const gate: { open: () => void } = { open: () => {} };
    const held = new Promise<void>((r) => {
      gate.open = r;
    });
    await page.route('**/wsfMyCommunities', async (route: Route) => {
      await held;
      await route.continue().catch(() => undefined);
    });
    await page.goto('/activity');
    await expect(page.getByTestId('wsf-activity-loading')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-activity-subtitle')).toHaveText(SUBTITLE);
    await expectNoRetired(page);
    gate.open();
    await expect(page.getByTestId('wsf-activity-rows')).toBeVisible({ timeout: 40_000 });
  });
});
