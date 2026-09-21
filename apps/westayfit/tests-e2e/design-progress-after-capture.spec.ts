import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { expect, test, type Browser, type Page, type Route } from '@playwright/test';

import {
  firestoreWrite,
  seedActiveGoal,
  seedCommunity,
  seedProfile,
  seedShards,
  seedVerifiedUser,
  signInVia,
  stampId,
  tsField,
} from './helpers/mobile';
import { CAPTURE_FRAMES } from './helpers/capture';

/**
 * ACTUAL IMPLEMENTATION AFTER for PROGRESS — `/activity`.
 *
 * Real screenshots of the running product with the slice applied. These are
 * NOT targets: nothing here is drawn, and no frame carries a concept banner.
 */
const OUT = path.resolve(__dirname, '../../../docs/design-target/review/page-04-progress/after');

/*
  OPT-IN. This spec's product is accepted PNGs in docs/, not an assertion
  about behaviour: the behaviour lives in progress-list.spec.ts and runs every
  time. Set WSF_CAPTURE_FRAMES=1 to regenerate the frames deliberately.
*/
test.skip(
  !CAPTURE_FRAMES,
  'Frame capture is evidence generation; set WSF_CAPTURE_FRAMES=1 to regenerate it.',
);

const CLASSES = [
  { key: '390x844', viewport: { width: 390, height: 844 } },
  { key: '390x640', viewport: { width: 390, height: 640 } },
  { key: '430x932', viewport: { width: 430, height: 932 } },
] as const;

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

/** A member's own credit on a goal. Written the way wsfContribute writes it. */
async function seedOwnCredit(goalId: string, uid: string, total: number): Promise<void> {
  await firestoreWrite(`wsfGoalMemberTotals/${goalId}_${uid}`, {
    goalId: { stringValue: goalId },
    userId: { stringValue: uid },
    total: { integerValue: String(total) },
    contributionCount: { integerValue: '1' },
    updatedAt: tsField(new Date()),
  });
}

/** A goal that is over — so the BEFORE shows what it does with a finished one. */
async function seedClosedGoal(opts: {
  goalId: string;
  groupId: string;
  ownerUid: string;
  title: string;
  target: number;
  unit: string;
  total: number;
  endedDaysAgo: number;
  reached: boolean;
}): Promise<void> {
  const ended = new Date(Date.now() - opts.endedDaysAgo * 24 * 60 * 60_000);
  await firestoreWrite(`wsfGoals/${opts.goalId}`, {
    ownerUid: { stringValue: opts.ownerUid },
    communityGroupId: { stringValue: opts.groupId },
    title: { stringValue: opts.title },
    target: { integerValue: String(opts.target) },
    unit: { stringValue: opts.unit },
    status: { stringValue: 'closed' },
    startsAt: tsField(new Date(ended.getTime() - 30 * 24 * 60 * 60_000)),
    endsAt: tsField(ended),
    closedAt: tsField(ended),
    ...(opts.reached ? { reachedAt: tsField(new Date(ended.getTime() - 2 * 60 * 60_000)) } : {}),
    timezone: { stringValue: 'America/New_York' },
    createdAt: tsField(new Date(ended.getTime() - 30 * 24 * 60 * 60_000)),
    updatedAt: tsField(ended),
  });
  await seedShards(opts.goalId, opts.total);
}

async function seedMember(label: string) {
  const id = stampId();
  const email = `wsf-${label}-${id}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Devin');

  const groupId = `${label}g-${id}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'inviteOnly',
    members: [{ uid, role: 'foundingChampion' }],
  });

  const active1 = `${label}a1-${id}`;
  await seedActiveGoal({
    goalId: active1,
    groupId,
    ownerUid: uid,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total: 1847,
  });
  await seedOwnCredit(active1, uid, 120);

  const active2 = `${label}a2-${id}`;
  await seedActiveGoal({
    goalId: active2,
    groupId,
    ownerUid: uid,
    title: 'Step-ups round',
    target: 2000,
    unit: 'step-ups',
    total: 612,
  });
  await seedOwnCredit(active2, uid, 45);

  // Finished, and the member was part of it. Today's screen drops this.
  const done = `${label}c1-${id}`;
  await seedClosedGoal({
    goalId: done,
    groupId,
    ownerUid: uid,
    title: 'September Push-up Push',
    target: 3000,
    unit: 'push-ups',
    total: 3142,
    endedDaysAgo: 21,
    reached: true,
  });
  await seedOwnCredit(done, uid, 260);

  return { email, password, uid, groupId };
}

async function seedNobody(label: string) {
  const id = stampId();
  const email = `wsf-${label}-${id}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Devin');
  return { email, password, uid };
}

async function phone(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    userAgent: IPHONE_UA,
    timezoneId: 'America/New_York',
  });
  return { context, page: await context.newPage() };
}

async function shot(page: Page, name: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}


/**
 * The shutter: every frame is the arrival state, at the top, with nothing
 * interactive permanently trapped under the shell.
 */
async function shotChecked(page: Page, name: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.waitForTimeout(500);
  const offsets = await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelectorAll('*').forEach((el) => {
      if (el instanceof HTMLElement && el.scrollTop > 0) el.scrollTop = 0;
    });
    const stuck: number[] = [];
    document.querySelectorAll('*').forEach((el) => {
      if (el instanceof HTMLElement && el.scrollTop > 0) stuck.push(el.scrollTop);
    });
    return { window: window.scrollY, stuck };
  });
  expect(offsets.window, `${name}: the window is still scrolled`).toBe(0);
  expect(offsets.stuck, `${name}: a scroll container did not reset`).toEqual([]);

  const title = await page.getByTestId('wsf-activity-title').boundingBox();
  expect(title, `${name}: the page title is not rendered`).not.toBeNull();
  expect(title!.y, `${name}: the frame is not the arrival state`).toBeGreaterThanOrEqual(0);

  const bar = await page.getByTestId('wsf-member-tabs').boundingBox();
  if (bar) {
    const move = await page.getByTestId('wsf-member-tab-move').boundingBox();
    const ceiling = Math.min(bar.y, move ? move.y : bar.y);
    const trapped = await page.evaluate((limit: number) => {
      const shell = document.querySelector('[data-testid="wsf-member-tabs"]');
      let slack = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
      document.querySelectorAll('*').forEach((el) => {
        if (el instanceof HTMLElement && el.scrollHeight > el.clientHeight + 1) {
          slack = Math.max(slack, el.scrollHeight - el.clientHeight - el.scrollTop);
        }
      });
      const hits: string[] = [];
      document.querySelectorAll('button, a, input, [role="button"], [role="link"]').forEach((el) => {
        if (shell && shell.contains(el)) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const overlap = r.bottom - limit;
        if (overlap > 0 && overlap > slack) hits.push((el.textContent ?? '').trim().slice(0, 40));
      });
      return hits;
    }, ceiling);
    expect(trapped, `${name}: controls can never be scrolled clear of the shell`).toEqual([]);
  }

  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

for (const cls of CLASSES) {
  test(`progress AFTER — ${cls.key}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const tag = `pa${cls.key.replace('x', '')}`;
    const fx = await seedMember(tag);

    {
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, fx.email, fx.password);
      await page.goto('/activity');
      await expect(page.getByTestId('wsf-activity-rows')).toBeVisible({ timeout: 40_000 });
      // The finished goal the old screen dropped is here, and the WE with it.
      await expect(page.getByTestId('wsf-activity-we')).toBeVisible();
      await shotChecked(page, `AFTER-rows-${cls.key}`);
      await context.close();
    }

    {
      const nobody = await seedNobody(`${tag}n`);
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, nobody.email, nobody.password);
      await page.goto('/activity');
      await expect(page.getByTestId('wsf-activity-empty')).toBeVisible({ timeout: 40_000 });
      await shotChecked(page, `AFTER-empty-${cls.key}`);
      await context.close();
    }

    if (cls.key !== '390x844') return;

    {
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, fx.email, fx.password);
      await page.route('**/wsfMyCommunities', async (route: Route) => {
        await new Promise((r) => setTimeout(r, 30_000));
        await route.abort();
      });
      await page.goto('/activity');
      await expect(page.getByTestId('wsf-activity-loading')).toBeVisible({ timeout: 40_000 });
      await shotChecked(page, `AFTER-loading-${cls.key}`);
      await context.close();
    }

    {
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, fx.email, fx.password);
      await page.route('**/wsfMyCommunities', (route: Route) => route.abort('failed'));
      await page.goto('/activity');
      await expect(page.getByTestId('wsf-activity-error')).toBeVisible({ timeout: 40_000 });
      await shotChecked(page, `AFTER-failure-${cls.key}`);
      await context.close();
    }

    // ── one own-part read fails; everything truthful that loaded stays ──
    {
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, fx.email, fx.password);
      let first = true;
      await page.route('**/wsfMyContribution', async (route: Route) => {
        if (first) {
          first = false;
          return route.abort('failed');
        }
        return route.fallback();
      });
      await page.goto('/activity');
      await expect(page.getByTestId('wsf-activity-rows')).toBeVisible({ timeout: 40_000 });
      // The screen still has rows, AND it says it may not be everything.
      await expect(page.getByTestId('wsf-activity-partial')).toBeVisible();
      await shotChecked(page, `AFTER-partial-failure-${cls.key}`);
      await context.close();
    }
  });
}
