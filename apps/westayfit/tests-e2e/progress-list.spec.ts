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

test('A GOAL CORRECTED BELOW ITS TARGET DOES NOT STILL SAY REACHED', async ({ browser }) => {
  /*
    THE BUG THIS EXISTS FOR. `reachedAt` records that a goal crossed its target
    ONCE. It is an event, and events do not un-happen, so the stamp survives a
    correction that takes the shared total back below the target. Progress read
    that stamp as the present state — so a goal corrected down to 2,400 of
    3,000 still wore REACHED and still drew the celebratory Living WE, on the
    strength of something that had been true a week earlier.

    The fixture is the real shape and not a contrived one: a `reachedAt` stamp
    AND a current total below target is exactly what a community's own
    correction leaves behind. Home already got this right — it prints the
    reached date only when the stamp exists and the CURRENT phase is
    reachedOpen or closedReached — and Progress was the one surface trusting
    the stamp alone.
  */
  test.setTimeout(240_000);
  const id = stampId();
  const email = `wsf-pcorr-${id}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Devin');

  const groupId = `pcorrg-${id}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'inviteOnly',
    members: [{ uid, role: 'foundingChampion' }],
  });

  // Corrected DOWN after reaching: the stamp stands, the total does not.
  const corrected = `pcorrc-${id}`;
  await seedClosedGoal({
    goalId: corrected,
    groupId,
    ownerUid: uid,
    title: 'Corrected Push-up Push',
    target: 3000,
    unit: 'push-ups',
    total: 2400,
    endedDaysAgo: 21,
    reached: true, // the historical reachedAt stamp IS present
  });
  await seedOwnCredit(corrected, uid, 260);

  const { context, page } = await phone(browser, { width: 390, height: 844 });
  await signInVia(page, email, password);
  await page.goto('/activity');
  const rows = page.getByTestId('wsf-activity-rows');
  await expect(rows).toBeVisible({ timeout: 40_000 });

  // The goal is listed — a correction does not hide it...
  await expect(rows).toContainText('Corrected Push-up Push');
  /*
    ...and the real, corrected progress is what is printed. The unreached
    branch shows a PERCENTAGE, so 2,400 of 3,000 reads as 80% — asserted
    explicitly, because a total the read never delivered would show 0% and a
    test that only checked for the absence of REACHED would pass on it. That
    is the same class of mistake as the bug itself: a label that looks right
    for a reason nobody checked.
  */
  await expect(rows).toContainText('80%');
  // ...but it does not claim the target was met.
  await expect(rows).not.toContainText('REACHED');

  await context.close();
});

test('a goal whose corrected total is still AT the target keeps REACHED', async ({ browser }) => {
  /*
    THE OTHER HALF, so the fix cannot be "never say reached". A correction that
    lands exactly ON the target is still a target met — `isReached` is `>=`,
    and a goal at 3,000 of 3,000 has reached it.
  */
  test.setTimeout(240_000);
  const id = stampId();
  const email = `wsf-pexact-${id}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Devin');

  const groupId = `pexactg-${id}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'inviteOnly',
    members: [{ uid, role: 'foundingChampion' }],
  });

  const exact = `pexactc-${id}`;
  await seedClosedGoal({
    goalId: exact,
    groupId,
    ownerUid: uid,
    title: 'Exact Push-up Push',
    target: 3000,
    unit: 'push-ups',
    total: 3000,
    endedDaysAgo: 21,
    reached: true,
  });
  await seedOwnCredit(exact, uid, 260);

  const { context, page } = await phone(browser, { width: 390, height: 844 });
  await signInVia(page, email, password);
  await page.goto('/activity');
  const rows = page.getByTestId('wsf-activity-rows');
  await expect(rows).toBeVisible({ timeout: 40_000 });
  await expect(rows).toContainText('Exact Push-up Push');
  await expect(rows).toContainText('REACHED');

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
