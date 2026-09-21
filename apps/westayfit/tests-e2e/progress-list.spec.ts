import { randomBytes } from 'node:crypto';
import { expect, test, type Browser, type Route } from '@playwright/test';

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
 * PROGRESS (`/activity`) — BEHAVIOUR.
 *
 * What the screen DOES, asserted on the running product: that a finished goal
 * the member contributed to is kept rather than filtered away, that a goal
 * with no recorded own part is not listed, that one failed read leaves the
 * rest standing AND says so, and that retry recovers without a reload.
 *
 * Separate from the frame capture on purpose: capture writes PNGs into docs/
 * and is evidence generation, not verification. These assertions are cheap
 * and belong in every run.
 */



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


test('a finished goal the member was part of is kept, not filtered away', async ({ browser }) => {
  test.setTimeout(240_000);
  const fx = await seedMember('pbeh1');
  const { context, page } = await phone(browser, { width: 390, height: 844 });
  await signInVia(page, fx.email, fx.password);
  await page.goto('/activity');
  await expect(page.getByTestId('wsf-activity-rows')).toBeVisible({ timeout: 40_000 });

  // The two running goals...
  await expect(page.getByTestId('wsf-activity-rows')).toContainText('October Squat Challenge');
  await expect(page.getByTestId('wsf-activity-rows')).toContainText('Step-ups round');
  // ...and the finished one, which the previous screen dropped entirely.
  await expect(page.getByTestId('wsf-activity-rows')).toContainText('September Push-up Push');
  await expect(page.getByTestId('wsf-activity-rows')).toContainText('REACHED');
  // Counted as goals, never summed across units.
  await expect(page.getByTestId('wsf-activity-rows')).toContainText('3 goals you have added to');
  await expect(page.getByTestId('wsf-activity-rows')).toContainText('2 running · 1 finished');

  await context.close();
});

test('a goal with no recorded own part is not listed', async ({ browser }) => {
  test.setTimeout(240_000);
  const fx = await seedMember('pbeh2');
  // A goal in the same community that this member never contributed to.
  const extra = `${fx.groupId}-untouched`;
  await seedActiveGoal({
    goalId: extra,
    groupId: fx.groupId,
    ownerUid: fx.uid,
    title: 'Untouched Lap Round',
    target: 800,
    unit: 'laps',
    total: 300,
  });

  const { context, page } = await phone(browser, { width: 390, height: 844 });
  await signInVia(page, fx.email, fx.password);
  await page.goto('/activity');
  await expect(page.getByTestId('wsf-activity-rows')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('wsf-activity-rows')).not.toContainText('Untouched Lap Round');
  await context.close();
});

test('one failed read leaves the rest standing, and the screen says so', async ({ browser }) => {
  test.setTimeout(240_000);
  const fx = await seedMember('pbeh3');
  const { context, page } = await phone(browser, { width: 390, height: 844 });
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
  // Something still loaded...
  await expect(page.getByTestId('wsf-activity-rows')).toContainText('RECORDED');
  // ...and the screen does not present a short list as the whole truth.
  await expect(page.getByTestId('wsf-activity-partial')).toBeVisible();
  await context.close();
});

test('retry recovers the screen without a reload', async ({ browser }) => {
  test.setTimeout(240_000);
  const fx = await seedMember('pbeh4');
  const { context, page } = await phone(browser, { width: 390, height: 844 });
  await signInVia(page, fx.email, fx.password);

  let failed = false;
  await page.route('**/wsfMyCommunities', async (route: Route) => {
    if (!failed) {
      failed = true;
      return route.abort('failed');
    }
    return route.fallback();
  });

  await page.goto('/activity');
  await expect(page.getByTestId('wsf-activity-error')).toBeVisible({ timeout: 40_000 });
  await page.getByTestId('wsf-activity-retry').click();
  await expect(page.getByTestId('wsf-activity-rows')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('wsf-activity-error')).toHaveCount(0);
  await context.close();
});
