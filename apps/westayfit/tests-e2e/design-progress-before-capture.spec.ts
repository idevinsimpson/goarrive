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

/**
 * ACTUAL CURRENT BEFORE for PROGRESS — `/activity`.
 *
 * Real screenshots of the product as it renders today, so the Progress target
 * can be compared against the thing it is actually replacing. These are NOT
 * targets. Nothing here is drawn.
 */
const OUT = path.resolve(__dirname, '../../../docs/design-target/review/page-04-progress/before');

/*
  OPT-IN, AND OFF BY DEFAULT — the rule the Page 1, 2 and 3 BEFOREs learned.
  A BEFORE is a photograph of the product as it was; a verification run of
  later code must never be able to rewrite it.
*/
const CAPTURE_BEFORE = /^(1|true)$/i.test(process.env.WSF_CAPTURE_BEFORE ?? '');

test.skip(
  !CAPTURE_BEFORE,
  'BEFORE frames are frozen evidence; set WSF_CAPTURE_BEFORE=1 to re-baseline them deliberately.',
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

for (const cls of CLASSES) {
  test(`progress BEFORE — ${cls.key}`, async ({ browser }) => {
    test.setTimeout(240_000);
    const tag = `pb${cls.key.replace('x', '')}`;
    const fx = await seedMember(tag);

    {
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, fx.email, fx.password);
      await page.goto('/activity');
      await expect(page.getByTestId('wsf-activity-rows')).toBeVisible({ timeout: 40_000 });
      await shot(page, `BEFORE-rows-${cls.key}`);
      await context.close();
    }

    {
      const nobody = await seedNobody(`${tag}n`);
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, nobody.email, nobody.password);
      await page.goto('/activity');
      await expect(page.getByTestId('wsf-activity-empty')).toBeVisible({ timeout: 40_000 });
      await shot(page, `BEFORE-empty-${cls.key}`);
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
      await shot(page, `BEFORE-loading-${cls.key}`);
      await context.close();
    }

    {
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, fx.email, fx.password);
      await page.route('**/wsfMyCommunities', (route: Route) => route.abort('failed'));
      await page.goto('/activity');
      await expect(page.getByTestId('wsf-activity-error')).toBeVisible({ timeout: 40_000 });
      await shot(page, `BEFORE-error-${cls.key}`);
      await context.close();
    }
  });
}
