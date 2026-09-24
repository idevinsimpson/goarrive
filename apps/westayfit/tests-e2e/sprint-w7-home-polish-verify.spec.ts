import { expect, test, type Browser, type Page, type Route } from '@playwright/test';

import {
  firestoreWrite,
  seedCommunity,
  seedMembership,
  seedProfile,
  seedShards,
  seedVerifiedUser,
  signInVia,
  stampId,
  tsField,
} from './helpers/mobile';
import {
  GOAL_TZ,
  seedContribution,
  seedContributionAt,
  seedMembershipWithVisibility,
  zonedDayStartMs,
} from './sprint-w8-social-fixture';

/**
 * W7 · Check 27 — W9's HOME-POLISH-1 candidate, measured on the rendered route.
 *
 * Independent of W9's producer and hero spec: own seeding, own locators, own
 * numbers. Everything here is SYNTHETIC on the local emulators. This file is
 * run from the candidate's own checkout (its helpers and W8's fixture are the
 * ones the candidate's specs use); it is committed on the W7 branch as inert
 * evidence and never on the candidate.
 *
 * What it measures, by routed item:
 *   3  meaning — open / reached / ended / no-goal / failed-read / proven zero /
 *      unprovable (null) / once-policy; "Goal reached" and "Community goal"
 *      never together; both contribution choices; the once statement.
 *   6  privacy — name-off and activity-off members in the presence band and
 *      the feed; the shared total unmoved; no uid / email in the page.
 *   7  layout — one top bar; the action (or the retry) above the tab bar at
 *      390×844 and 390×640; no sideways scroll at 195 px; the W8 fold guard.
 *   9  the stale seam — what the head shows after a FAILED refresh and after a
 *      failed return re-read of a figure already on screen.
 *   D2 the goal-state pill: same testID, same text, on the label's row.
 *   D4 the own-contribution row: its figure is the member's exact own total
 *      (wsfMyContribution), not the feed; the sentences; the render condition.
 */

const PASSWORD = 'Sup3rSecret!23';
const TARGET = 5000;
const TOTAL = 1847;
const PHONE = { width: 390, height: 844 };
const SHORT = { width: 390, height: 640 };

type Fixture = { email: string; me: string; groupId: string; goalId: string; names: Record<string, string> };

async function seedGoal(opts: {
  goalId: string;
  groupId: string;
  ownerUid: string;
  target: number;
  total: number;
  timezone?: string;
  endsAt?: Date;
  repeatPolicy?: 'once' | 'multiple';
}): Promise<void> {
  const now = new Date();
  const fields: Record<string, unknown> = {
    ownerUid: { stringValue: opts.ownerUid },
    communityGroupId: { stringValue: opts.groupId },
    title: { stringValue: 'W7 squat check' },
    target: { integerValue: String(opts.target) },
    unit: { stringValue: 'squats' },
    status: { stringValue: 'active' },
    startsAt: tsField(new Date(now.getTime() - 7 * 24 * 60 * 60_000)),
    endsAt: tsField(opts.endsAt ?? new Date(now.getTime() + 7 * 24 * 60 * 60_000)),
    timezone: { stringValue: opts.timezone ?? GOAL_TZ },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  };
  if (opts.repeatPolicy) fields.repeatPolicy = { stringValue: opts.repeatPolicy };
  await firestoreWrite(`wsfGoals/${opts.goalId}`, fields as never);
  await seedShards(opts.goalId, opts.total);
}

async function seedOwnTotal(goalId: string, uid: string, total: number): Promise<void> {
  await firestoreWrite(`wsfGoalMemberTotals/${goalId}_${uid}`, {
    goalId: { stringValue: goalId },
    userId: { stringValue: uid },
    total: { integerValue: String(total) },
    contributionCount: { integerValue: '1' },
    updatedAt: tsField(new Date()),
  } as never);
}

/**
 * One community, one viewer, five other members. `variant` shapes the goal:
 *   populated   the producer's populated state, own total 20, five moved today
 *   ownDiffers  the feed says 20 for the viewer, the exact own total says 33
 *   privacy     the viewer and Priya name-off, Tom activity-off
 *   quiet       real movement, all before the goal's own day began
 *   nullZone    a timezone the server cannot read
 *   reached     total at the target
 *   ended       the window's end instant in the past
 *   once        a one-contribution goal the viewer already contributed to
 *   twoCommunities  the viewer is also in a second community (Switch chip)
 */
async function seed(variant: string): Promise<Fixture> {
  const stamp = `${stampId()}${variant.slice(0, 3)}`;
  const email = `wsf-w7-hp-${stamp}@example.com`;
  const me = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(me, 'Alex Rivera');
  const groupId = `w7hp-${stamp}`;
  const goalId = `w7hpgoal-${stamp}`;
  const others = { dana: `w7hp-dana-${stamp}`, marcus: `w7hp-marcus-${stamp}`, leah: `w7hp-leah-${stamp}`, priya: `w7hp-priya-${stamp}`, tom: `w7hp-tom-${stamp}` };
  const names: Record<string, string> = { [me]: 'Alex Rivera', [others.dana]: 'Dana Whitfield', [others.marcus]: 'Marcus Reed', [others.leah]: 'Leah Brooks', [others.priya]: 'Priya Nair', [others.tom]: 'Tom Okafor' };
  await seedCommunity({ groupId, displayName: 'W7 Morning Movers', joinPolicy: 'private', members: [{ uid: me, role: 'member' }] });
  if (variant === 'privacy') await seedMembershipWithVisibility(groupId, me, 'member', { name: 'private', activity: 'visible' });
  await seedMembership(groupId, others.dana, 'foundingChampion');
  await seedMembership(groupId, others.marcus, 'member');
  await seedMembership(groupId, others.leah, 'member');
  if (variant === 'privacy') {
    await seedMembershipWithVisibility(groupId, others.priya, 'member', { name: 'private' });
    await seedMembershipWithVisibility(groupId, others.tom, 'member', { activity: 'private' });
  } else {
    await seedMembership(groupId, others.priya, 'member');
    await seedMembership(groupId, others.tom, 'member');
  }
  for (const [uid, name] of Object.entries(names)) if (uid !== me) await seedProfile(uid, name);
  if (variant === 'twoCommunities') {
    await seedCommunity({ groupId: `${groupId}-b`, displayName: 'W7 Second Community', joinPolicy: 'private', members: [{ uid: others.dana, role: 'foundingChampion' }, { uid: me, role: 'member' }] });
  }
  const goal = {
    goalId,
    groupId,
    ownerUid: others.dana,
    target: TARGET,
    total: variant === 'reached' ? TARGET + 40 : TOTAL,
    timezone: variant === 'nullZone' ? 'Not/AZone' : GOAL_TZ,
    endsAt: variant === 'ended' ? new Date(Date.now() - 2 * 24 * 60 * 60_000) : undefined,
    repeatPolicy: variant === 'once' ? ('once' as const) : undefined,
  };
  await seedGoal(goal);
  if (variant === 'quiet') {
    const dayStart = zonedDayStartMs(GOAL_TZ);
    await seedContributionAt(groupId, goalId, others.marcus, 40, dayStart - 3 * 60 * 60_000);
    await seedContributionAt(groupId, goalId, others.dana, 60, dayStart - 5 * 60 * 60_000);
    return { email, me, groupId, goalId, names };
  }
  await seedContribution(groupId, goalId, me, 20, 20);
  await seedOwnTotal(goalId, me, variant === 'ownDiffers' ? 33 : 20);
  await seedContribution(groupId, goalId, others.marcus, 40, 55);
  await seedContribution(groupId, goalId, others.tom, 15, 90);
  await seedContribution(groupId, goalId, others.priya, 25, 180);
  await seedContribution(groupId, goalId, others.dana, 60, 300);
  return { email, me, groupId, goalId, names };
}

async function open(browser: Browser, fx: Fixture, viewport: { width: number; height: number }, beforeNav?: (page: Page) => Promise<void>) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await signInVia(page, fx.email, PASSWORD);
  if (beforeNav) await beforeNav(page);
  await page.goto(`/community/${fx.groupId}`);
  await expect(page.getByTestId('wsf-community-name')).toBeVisible({ timeout: 60_000 });
  return { ctx, page };
}

async function settledTotal(page: Page, fx: Fixture, text: string): Promise<void> {
  await expect(page.getByTestId(`wsf-community-goal-total-${fx.goalId}`)).toContainText(text, { timeout: 40_000 });
  await page.waitForTimeout(3_500); // past the settle window, so nothing moves under the measurement
}

async function failPulse(page: Page): Promise<void> {
  await page.route('**/wsfGoalPulse', (route: Route) =>
    route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: { status: 'INTERNAL', message: 'progress unavailable (W7 injection)' } }) }),
  );
}

async function overflowReport(page: Page): Promise<{ document: number; scrollers: string[] }> {
  return page.evaluate(() => {
    const doc = document.documentElement.scrollWidth - window.innerWidth;
    const scrollers: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      if (el.scrollWidth > el.clientWidth + 1 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowX)) {
        scrollers.push(`${el.tagName.toLowerCase()}[data-testid=${el.getAttribute('data-testid') ?? ''}] +${el.scrollWidth - el.clientWidth}`);
      }
    }
    return { document: doc, scrollers };
  });
}

async function actionAboveTabs(page: Page, actionTestId: string, label: string): Promise<void> {
  await expect(page.getByTestId('wsf-member-topbar'), `${label}: one top bar`).toHaveCount(1);
  const a = (await page.getByTestId(actionTestId).boundingBox())!;
  const t = (await page.getByTestId('wsf-member-tabs').boundingBox())!;
  expect(a, `${label}: the action is not rendered`).not.toBeNull();
  expect(Math.round(a.y + a.height), `${label}: the action ends below the top of the tab bar (${Math.round(a.y + a.height)} vs ${Math.round(t.y)})`).toBeLessThanOrEqual(Math.round(t.y));
}

test.describe('W7 · Check 27 — HOME-POLISH-1 measured on the rendered route', () => {
  test.setTimeout(240_000);

  test('3+D2 · open goal: "Community goal" label, no "Goal reached"; the state pill is the window text under the same testID, on the label row; both contribution choices; the once statement absent', async ({ browser }) => {
    const fx = await seed('populated');
    const { ctx, page } = await open(browser, fx, PHONE);
    try {
      await settledTotal(page, fx, '1,847');
      await expect(page.getByTestId('wsf-community-goal-label')).toHaveText('Community goal');
      await expect(page.getByTestId('wsf-community-goal-eyebrow')).toHaveCount(0);
      const pill = page.getByTestId(`wsf-community-goal-period-${fx.goalId}`);
      await expect(pill).toHaveText(/^Open · Ends /);
      const label = (await page.getByTestId('wsf-community-goal-label').boundingBox())!;
      const pb = (await pill.boundingBox())!;
      expect(Math.abs(label.y + label.height / 2 - (pb.y + pb.height / 2)), 'the pill is on the label row').toBeLessThanOrEqual(8);
      expect(pb.x, 'the pill sits to the right of the label').toBeGreaterThan(label.x + label.width);
      await expect(page.getByTestId(`wsf-community-goal-total-${fx.goalId}`)).toHaveText('1,847 of 5,000 squats');
      await expect(page.getByTestId(`wsf-community-goal-percent-${fx.goalId}`)).toHaveText('36.9% complete');
      await expect(page.getByTestId(`wsf-community-goal-link-${fx.goalId}`)).toHaveText('Start moving');
      await expect(page.getByTestId(`wsf-community-goal-record-${fx.goalId}`)).toHaveText('Already moved? Record squats');
      await expect(page.getByTestId(`wsf-community-your-part-${fx.goalId}`)).toContainText('You’ve added 20 squats to this goal.');
      await expect(page.getByTestId(`wsf-community-your-part-${fx.goalId}`)).toContainText('Your contribution');
      expect(await page.getByText('You’ve recorded', { exact: false }).count(), 'no once statement on a multiple goal').toBe(0);
      await expect(page.getByTestId('wsf-community-contributors-today')).toHaveText('5 people moved today');
      const updated = await page.getByTestId('wsf-community-progress-updated').innerText();
      expect(updated, 'the freshness line').toMatch(/^Confirmed \d{1,2}:\d{2}/);
      console.info(`W7 27.3 open: label=Community goal pill="${await pill.innerText()}" total="1,847 of 5,000 squats" actions=[Start moving | Already moved? Record squats] own="You’ve added 20 squats to this goal." freshness="${updated}"`);
    } finally {
      await ctx.close();
    }
  });

  test('3 · reached: "Goal reached" takes the slot and the label is gone; the two never stand together', async ({ browser }) => {
    const fx = await seed('reached');
    const { ctx, page } = await open(browser, fx, PHONE);
    try {
      await settledTotal(page, fx, '5,040');
      await expect(page.getByTestId('wsf-community-goal-eyebrow')).toHaveText('Goal reached');
      await expect(page.getByTestId('wsf-community-goal-label')).toHaveCount(0);
      await expect(page.getByTestId(`wsf-community-goal-period-${fx.goalId}`)).toHaveText(/^Open · Ends /);
      console.info('W7 27.3 reached: eyebrow=Goal reached, label absent, pill still the window');
    } finally {
      await ctx.close();
    }
  });

  test('3+D2 · ended: the pill says "Ended …", the label stays, the action is still offered as before', async ({ browser }) => {
    const fx = await seed('ended');
    const { ctx, page } = await open(browser, fx, PHONE);
    try {
      await settledTotal(page, fx, '1,847');
      await expect(page.getByTestId(`wsf-community-goal-period-${fx.goalId}`)).toHaveText(/^Ended /);
      await expect(page.getByTestId('wsf-community-goal-label')).toHaveText('Community goal');
      await expect(page.getByTestId('wsf-community-goal-eyebrow')).toHaveCount(0);
      console.info(`W7 27.3 ended: pill="${await page.getByTestId(`wsf-community-goal-period-${fx.goalId}`).innerText()}"`);
    } finally {
      await ctx.close();
    }
  });

  test('3 · a proven zero renders "0 people moved today"; an unreadable zone (null) renders nothing at all', async ({ browser }) => {
    const quiet = await seed('quiet');
    const q = await open(browser, quiet, PHONE);
    try {
      await settledTotal(q.page, quiet, '1,847');
      await expect(q.page.getByTestId('wsf-community-contributors-today')).toHaveText('0 people moved today');
    } finally {
      await q.ctx.close();
    }
    const nz = await seed('nullZone');
    const n = await open(browser, nz, PHONE);
    try {
      await settledTotal(n.page, nz, '1,847');
      await n.page.waitForTimeout(2_000);
      await expect(n.page.getByTestId('wsf-community-contributors-today')).toHaveCount(0);
      await expect(n.page.getByTestId('wsf-community-hero-presence')).toHaveText('6 members');
      console.info('W7 27.3 zero/null: quiet → "0 people moved today"; unreadable zone → no moved-today element, member count intact');
    } finally {
      await n.ctx.close();
    }
  });

  test('3 · a failed first read: no number, the retry centred under its sentence and above the tab bar; the label stays, the pill says only "Open"', async ({ browser }) => {
    const fx = await seed('populated');
    for (const vp of [PHONE, SHORT]) {
      const { ctx, page } = await open(browser, fx, vp, failPulse);
      try {
        await expect(page.getByTestId(`wsf-community-goal-progress-error-${fx.goalId}`)).toBeVisible({ timeout: 40_000 });
        await expect(page.getByTestId(`wsf-community-goal-total-${fx.goalId}`)).toHaveCount(0);
        await expect(page.getByTestId(`wsf-community-goal-period-${fx.goalId}`)).toHaveText('Open');
        await expect(page.getByTestId('wsf-community-goal-label')).toHaveText('Community goal');
        await expect(page.getByTestId('wsf-community-goal-eyebrow')).toHaveCount(0);
        await actionAboveTabs(page, `wsf-community-goal-progress-retry-${fx.goalId}`, `failed read ${vp.width}x${vp.height}`);
        const hero = (await page.getByTestId('wsf-community-goal-hero').boundingBox())!;
        const retry = (await page.getByTestId(`wsf-community-goal-progress-retry-${fx.goalId}`).boundingBox())!;
        const off = Math.abs(retry.x + retry.width / 2 - (hero.x + hero.width / 2));
        expect(off, `the retry is centred in the hero (${off}px off)`).toBeLessThanOrEqual(4);
        console.info(`W7 27.3 failed read ${vp.width}x${vp.height}: no total, pill=Open, retry centred (${off.toFixed(1)}px off) and above the tab bar`);
      } finally {
        await ctx.close();
      }
    }
  });

  test('3+D4 · once policy: the hero says "You’ve recorded 20 squats."; the own row says "Counted in the shared total above."; the record route is what the head offers', async ({ browser }) => {
    const fx = await seed('once');
    const { ctx, page } = await open(browser, fx, PHONE);
    try {
      await settledTotal(page, fx, '1,847');
      await expect(page.getByText('You’ve recorded 20 squats.')).toBeVisible();
      await expect(page.getByTestId(`wsf-community-your-part-${fx.goalId}`)).toContainText('Counted in the shared total above.');
      const record = await page.getByTestId(`wsf-community-goal-record-${fx.goalId}`).count();
      const link = await page.getByTestId(`wsf-community-goal-link-${fx.goalId}`).count();
      console.info(`W7 27.3 once: hero statement present; own row "Counted in the shared total above."; primary action count ${link}; "Already moved?" route count ${record} (measured, compared with the base in the report)`);
    } finally {
      await ctx.close();
    }
  });

  test('D4 · the own row prints the exact own total from the progress read, not the feed', async ({ browser }) => {
    const fx = await seed('ownDiffers');
    const { ctx, page } = await open(browser, fx, PHONE);
    try {
      await settledTotal(page, fx, '1,847');
      const own = page.getByTestId(`wsf-community-your-part-${fx.goalId}`);
      await expect(own).toContainText('You’ve added 33 squats to this goal.');
      await expect(own).not.toContainText('20 squats');
      const feedRow = page.getByTestId('wsf-community-momentum-card');
      await expect(feedRow).toContainText('20 squats');
      console.info('W7 27.D4: own row = 33 (wsfGoalMemberTotals via the progress read); the feed row for the same member says 20');
    } finally {
      await ctx.close();
    }
  });

  test('6 · privacy: name-off members are unnamed in the presence band and the feed, an activity-off member has no row, the shared total is unmoved, no uid or email in the page', async ({ browser }) => {
    const fx = await seed('privacy');
    const { ctx, page } = await open(browser, fx, PHONE);
    try {
      await settledTotal(page, fx, '1,847');
      await expect(page.getByTestId('wsf-community-contributors-today')).toHaveText('5 people moved today');
      const text = await page.locator('body').innerText();
      const forbidden = ['Priya Nair', 'Tom Okafor', 'Alex Rivera', fx.email, '@example.com', ...Object.keys(fx.names)];
      const found = forbidden.filter((s) => text.includes(s));
      expect(found, `identity strings on the page: ${JSON.stringify(found)}`).toEqual([]);
      const momentum = page.getByTestId('wsf-community-momentum-card');
      await expect(momentum).toContainText('Anonymous member');
      await expect(momentum).toContainText('Marcus Reed');
      await expect(momentum).toContainText('Dana Whitfield');
      const rows = await page.getByTestId('wsf-momentum-row').count();
      const faces = (await page.getByTestId('wsf-presence-row').innerText().catch(() => '')).split(/\s+/).filter(Boolean);
      const initialsLeak = ['PN', 'AR'].filter((i) => faces.includes(i)); // name-off members: the anonymous mark is a shape, never initials
      console.info(`W7 27.6 privacy: rows=${rows}; feed names present: Marcus, Dana, Anonymous; absent: Priya, Tom, Alex; faces text=${JSON.stringify(faces)}; initials of private members on faces: ${JSON.stringify(initialsLeak)}`);
    } finally {
      await ctx.close();
    }
  });

  test('7 · layout: one top bar and the action above the tab bar at 390×844 and 390×640 (populated); no sideways scroll at 195 px; the W8 fold guard with the Switch chip', async ({ browser }) => {
    const fx = await seed('populated');
    for (const vp of [PHONE, SHORT]) {
      const { ctx, page } = await open(browser, fx, vp);
      try {
        await settledTotal(page, fx, '1,847');
        await actionAboveTabs(page, `wsf-community-goal-link-${fx.goalId}`, `populated ${vp.width}x${vp.height}`);
        const o = await overflowReport(page);
        expect(o.document, `sideways document scroll at ${vp.width}`).toBeLessThanOrEqual(0);
        console.info(`W7 27.7 ${vp.width}x${vp.height}: one top bar; action above tabs; document overflow ${o.document}; scrollers ${JSON.stringify(o.scrollers)}`);
      } finally {
        await ctx.close();
      }
    }
    const narrow = await browser.newContext({ viewport: { width: 195, height: 844 }, deviceScaleFactor: 2 });
    try {
      const page = await narrow.newPage();
      await signInVia(page, fx.email, PASSWORD);
      await page.goto(`/community/${fx.groupId}`);
      await settledTotal(page, fx, '1,847');
      const o = await overflowReport(page);
      const label = (await page.getByTestId('wsf-community-goal-label').boundingBox())!;
      const total = page.getByTestId(`wsf-community-goal-total-${fx.goalId}`);
      const tb = (await total.boundingBox())!;
      const faces = await page.locator('[data-testid="wsf-community-presence"]').count();
      console.info(`W7 27.7 195px: document overflow ${o.document}; scrollers ${JSON.stringify(o.scrollers)}; label ${Math.round(label.width)}x${Math.round(label.height)}; total box ${Math.round(tb.width)}x${Math.round(tb.height)}; text="${(await total.innerText()).replace(/\n/g, '⏎')}"`);
      expect(o.document, 'sideways document scroll at 195 px').toBeLessThanOrEqual(0);
      expect(o.scrollers, 'horizontal scrollers at 195 px').toEqual([]);
      expect(label.height, 'the card label wraps at 195 px').toBeLessThanOrEqual(16);
    } finally {
      await narrow.close();
    }
    const two = await seed('twoCommunities');
    const { ctx, page } = await open(browser, two, PHONE);
    try {
      await settledTotal(page, two, '1,847');
      await expect(page.getByTestId('wsf-community-hero-switch')).toBeVisible();
      const row = (await page.getByTestId('wsf-momentum-row').first().boundingBox())!;
      const tabs = (await page.getByTestId('wsf-member-tabs').boundingBox())!;
      expect(Math.round(row.y + row.height), `the first momentum row ends below the tab bar (${Math.round(row.y + row.height)} vs ${Math.round(tabs.y)})`).toBeLessThanOrEqual(Math.round(tabs.y));
      console.info(`W7 27.7 fold guard: Switch chip visible; first momentum row bottom ${Math.round(row.y + row.height)} above tabs top ${Math.round(tabs.y)}`);
    } finally {
      await ctx.close();
    }
  });

  test('9 · the stale seam, measured: after a FAILED refresh and a failed return re-read, what stays on screen and how it is labelled', async ({ browser }) => {
    const fx = await seed('populated');
    const { ctx, page } = await open(browser, fx, PHONE);
    try {
      await settledTotal(page, fx, '1,847');
      const total = page.getByTestId(`wsf-community-goal-total-${fx.goalId}`);
      const updated = page.getByTestId('wsf-community-progress-updated');
      const before = { total: await total.innerText(), updated: await updated.innerText() };
      // From here every progress read fails; the server still holds the total.
      await failPulse(page);
      await page.getByTestId('wsf-community-progress-refresh').click();
      await page.waitForTimeout(6_000);
      const bodyText = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      const afterRefresh = {
        total: await total.count() ? await total.innerText() : '(absent)',
        updated: await updated.count() ? await updated.innerText() : '(absent)',
        errorShown: await page.getByTestId(`wsf-community-goal-progress-error-${fx.goalId}`).count(),
        retryShown: await page.getByTestId(`wsf-community-goal-progress-retry-${fx.goalId}`).count(),
        staleWords: (await bodyText()).match(/stale|unavailable|couldn.t|last known|not confirmed|refresh failed/gi) ?? [],
      };
      // A return re-read: away to You, then back to Home, with the read still failing.
      await page.getByTestId('wsf-member-tab-you').click().catch(async () => page.getByRole('link', { name: /^You/ }).first().click());
      await page.waitForTimeout(1_500);
      await page.getByTestId('wsf-member-tab-home').click().catch(async () => page.getByRole('link', { name: /^Home/ }).first().click());
      await page.waitForTimeout(6_000);
      const afterReturn = {
        total: await total.count() ? await total.innerText() : '(absent)',
        updated: await updated.count() ? await updated.innerText() : '(absent)',
        errorShown: await page.getByTestId(`wsf-community-goal-progress-error-${fx.goalId}`).count(),
        staleWords: (await bodyText()).match(/stale|unavailable|couldn.t|last known|not confirmed|refresh failed/gi) ?? [],
      };
      console.info(`W7 27.9 stale seam: before ${JSON.stringify(before)} | after failed Refresh ${JSON.stringify(afterRefresh)} | after failed return re-read ${JSON.stringify(afterReturn)}`);
      // The README's statement, checked rather than assumed: the figure stays and is labelled only "Confirmed h:mm".
      expect(afterRefresh.total, 'the figure on screen after a failed refresh').toBe(before.total);
      expect(afterRefresh.updated, 'the freshness label after a failed refresh').toBe(before.updated);
    } finally {
      await ctx.close();
    }
  });
});
