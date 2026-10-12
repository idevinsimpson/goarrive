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
 * YOU (`/you`) — BEHAVIOUR.
 *
 * What the screen DOES, asserted on the running product: that identity
 * survives a failed community or goal read, that a goal with no recorded own
 * part is never listed, that the lead is the goal ending soonest rather than
 * whichever came back first, that a member of several communities is told the
 * truth rather than "you're not in a community yet", that a failed own-part
 * read is admitted instead of hidden, and that retry recovers in place.
 *
 * Separate from the frame capture on purpose: capture writes PNGs into docs/
 * and is evidence generation, not verification. These assertions are cheap
 * and belong in every run.
 */

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


/**
 * A MEMBER OF TWO COMMUNITIES, WITH NOTHING REMEMBERED.
 *
 * `resolveCurrentCommunity` returns null here — not because the member is in
 * nothing, but because there is no single community for this page to speak
 * for. A fresh browser context has an empty store, so nothing is remembered.
 */
async function seedSeveral(label: string) {
  const id = stampId();
  const email = `wsf-${label}-${id}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Devin');
  for (const [n, displayName] of [
    ['1', 'Alpharetta Morning Movers'],
    ['2', 'Roswell Lunch Crew'],
  ] as const) {
    await seedCommunity({
      groupId: `${label}g${n}-${id}`,
      displayName,
      joinPolicy: 'inviteOnly',
      members: [{ uid, role: 'member' }],
    });
  }
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

const PHONE = { width: 390, height: 844 };

test('identity survives a failed goal read', async ({ browser }) => {
  test.setTimeout(240_000);
  const fx = await seedMember('ybeh1');
  const { context, page } = await phone(browser, PHONE);
  await signInVia(page, fx.email, fx.password);
  await page.route('**/wsfListGoals**', (route: Route) => route.abort('failed'));
  await page.goto('/you');

  await expect(page.getByTestId('wsf-you-failed')).toBeVisible({ timeout: 40_000 });
  // The profile read is made first and alone precisely so this holds: who you
  // are does not depend on a callable that just failed.
  await expect(page.getByTestId('wsf-you-name')).toContainText('Devin');
  await expect(page.getByTestId('wsf-you-since')).toBeVisible();
  await expect(page.getByTestId('wsf-you-email')).toBeVisible();
  await expect(page.getByTestId('wsf-you-signout')).toBeVisible();
  // And it does not pretend the goals are simply absent.
  await expect(page.getByTestId('wsf-you-member')).toHaveCount(0);
  await context.close();
});

test('retry recovers in place, without a reload', async ({ browser }) => {
  test.setTimeout(240_000);
  const fx = await seedMember('ybeh2');
  const { context, page } = await phone(browser, PHONE);
  await signInVia(page, fx.email, fx.password);

  let failed = false;
  await page.route('**/wsfListGoals**', async (route: Route) => {
    if (!failed) {
      failed = true;
      return route.abort('failed');
    }
    return route.fallback();
  });

  await page.goto('/you');
  await expect(page.getByTestId('wsf-you-failed')).toBeVisible({ timeout: 40_000 });
  await page.getByTestId('wsf-you-retry').click();
  await expect(page.getByTestId('wsf-you-member')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('wsf-you-failed')).toHaveCount(0);
  await context.close();
});

test('a goal with no recorded own part is not listed', async ({ browser }) => {
  test.setTimeout(240_000);
  const fx = await seedMember('ybeh3');
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

  const { context, page } = await phone(browser, PHONE);
  await signInVia(page, fx.email, fx.password);
  await page.goto('/you');
  await expect(page.getByTestId('wsf-you-member')).toBeVisible({ timeout: 40_000 });
  // This page is your part. A goal you have not added to is not your part.
  await expect(page.getByTestId('wsf-you-member')).not.toContainText('Untouched Lap Round');
  await expect(page.getByTestId('wsf-you-member')).toContainText('October Squat Challenge');
  await context.close();
});

test('the lead is the open goal ending soonest, not the first one back', async ({ browser }) => {
  test.setTimeout(240_000);
  const fx = await seedMember('ybeh4');
  // Ends before either goal the fixture seeds, and is seeded last — so a page
  // that simply took the head of the list would put the wrong goal in front.
  const soon = `${fx.groupId}-soon`;
  await seedActiveGoal({
    goalId: soon,
    groupId: fx.groupId,
    ownerUid: fx.uid,
    title: 'Closing Tomorrow Round',
    target: 400,
    unit: 'lunges',
    total: 88,
    endsAt: new Date(Date.now() + 24 * 60 * 60_000),
  });
  await seedOwnCredit(soon, fx.uid, 30);

  const { context, page } = await phone(browser, PHONE);
  await signInVia(page, fx.email, fx.password);
  await page.goto('/you');
  await expect(page.getByTestId('wsf-you-lead')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('wsf-you-lead')).toContainText('Closing Tomorrow Round');
  // Your part in ITS unit. Never a number summed across goals.
  await expect(page.getByTestId('wsf-you-lead-own')).toContainText('30 lunges');
  await context.close();
});

test('a member of several communities is told that, not that they are in none', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const several = await seedSeveral('ybeh5');
  const { context, page } = await phone(browser, PHONE);
  await signInVia(page, several.email, several.password);
  await page.goto('/you');

  await expect(page.getByTestId('wsf-you-pick-community')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('wsf-you-pick-community')).toContainText('You are in 2 communities');
  // The false sentence is not on the screen, and no community was picked for
  // them behind their back.
  await expect(page.getByTestId('wsf-you-no-community')).toHaveCount(0);
  await expect(page.getByTestId('wsf-you-member')).toHaveCount(0);
  await context.close();
});

test('a member of nothing is told that, and offered a way in', async ({ browser }) => {
  test.setTimeout(240_000);
  const nobody = await seedNobody('ybeh6');
  const { context, page } = await phone(browser, PHONE);
  await signInVia(page, nobody.email, nobody.password);
  await page.goto('/you');

  await expect(page.getByTestId('wsf-you-no-community')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('wsf-you-find-community')).toBeVisible();
  await expect(page.getByTestId('wsf-you-pick-community')).toHaveCount(0);
  // Signing out needs no read, so it is offered here too.
  await expect(page.getByTestId('wsf-you-signout')).toBeVisible();
  await context.close();
});

test('a failed own-part read is admitted, not hidden', async ({ browser }) => {
  test.setTimeout(240_000);
  const fx = await seedMember('ybeh7');
  const { context, page } = await phone(browser, PHONE);
  await signInVia(page, fx.email, fx.password);

  let first = true;
  await page.route('**/wsfMyContribution**', async (route: Route) => {
    if (first) {
      first = false;
      return route.abort('failed');
    }
    return route.fallback();
  });

  await page.goto('/you');
  await expect(page.getByTestId('wsf-you-member')).toBeVisible({ timeout: 40_000 });
  // Something still loaded, and the page does not present a short list as the
  // whole truth of what you have been part of.
  await expect(page.getByTestId('wsf-you-partial')).toBeVisible();
  await context.close();
});

test('a signed-out visitor gets no member navigation', async ({ browser }) => {
  test.setTimeout(240_000);
  const { context, page } = await phone(browser, PHONE);
  await page.goto('/you');

  await expect(page.getByTestId('wsf-you-signed-out')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('wsf-you-signin')).toBeVisible();
  // The shell is a member surface. Nothing of somebody else's is on this page.
  await expect(page.getByTestId('wsf-member-tabs')).toHaveCount(0);
  await expect(page.getByTestId('wsf-you-name')).toHaveCount(0);
  await expect(page.getByTestId('wsf-you-email')).toHaveCount(0);
  await context.close();
});
