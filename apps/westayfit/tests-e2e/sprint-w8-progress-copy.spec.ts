import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { expect, test, type Browser, type Page, type Route } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';
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
 * PROGRESS COPY — contribution first, one quiet clarification (Director
 * `5798552781` §4).
 *
 * The earlier copy said "nobody else can see it" three times. That is true of
 * this summary and false about the member's contributions, which appear in
 * community activity by default. The behaviour below runs every time; the
 * frames for pixel review are written only with WSF_CAPTURE_FRAMES=1.
 */

const OUT = path.resolve(
  __dirname,
  '../../../docs/design-target/review/community-presence/progress',
);

const SUBTITLE = 'Your recorded contributions, by goal.';
const CLARIFICATION =
  'This personal summary is only for you. Community activity follows your visibility settings.';
const EMPTY_TITLE = 'Your first contribution will appear here';
/** The overbroad assurances this pass removes. None may come back. */
const RETIRED = [
  'Only you can see this',
  'nobody else can see',
  'kept to yourself',
  'never compared with anyone else',
  'This page is only ever yours',
  'Nothing was lost',
];

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const SHORT = { width: 390, height: 640 };
const TALL = { width: 390, height: 844 };

/** A member's own credit on a goal, written the way wsfContribute writes it. */
async function seedOwnCredit(goalId: string, uid: string, total: number): Promise<void> {
  await firestoreWrite(`wsfGoalMemberTotals/${goalId}_${uid}`, {
    goalId: { stringValue: goalId },
    userId: { stringValue: uid },
    total: { integerValue: String(total) },
    contributionCount: { integerValue: '1' },
    updatedAt: tsField(new Date()),
  });
}

async function seedClosedGoal(o: {
  goalId: string;
  groupId: string;
  ownerUid: string;
  title: string;
  target: number;
  unit: string;
  total: number;
}): Promise<void> {
  const ended = new Date(Date.now() - 21 * 24 * 60 * 60_000);
  const began = new Date(ended.getTime() - 30 * 24 * 60 * 60_000);
  await firestoreWrite(`wsfGoals/${o.goalId}`, {
    ownerUid: { stringValue: o.ownerUid },
    communityGroupId: { stringValue: o.groupId },
    title: { stringValue: o.title },
    target: { integerValue: String(o.target) },
    unit: { stringValue: o.unit },
    status: { stringValue: 'closed' },
    startsAt: tsField(began),
    endsAt: tsField(ended),
    closedAt: tsField(ended),
    reachedAt: tsField(new Date(ended.getTime() - 2 * 60 * 60_000)),
    timezone: { stringValue: 'America/New_York' },
    createdAt: tsField(began),
    updatedAt: tsField(ended),
  });
  await seedShards(o.goalId, o.total);
}

async function newMember(label: string) {
  const id = stampId();
  const email = `w8p-${label}-${id}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Devin Simpson');
  return { id, email, password, uid };
}

/** Two running goals in DIFFERENT units and one finished goal. */
async function populatedMember(label: string) {
  const me = await newMember(label);
  const groupId = `w8pg-${me.id}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'private',
    members: [{ uid: me.uid, role: 'member' }],
  });
  const squats = `w8ps-${me.id}`;
  await seedActiveGoal({
    goalId: squats,
    groupId,
    ownerUid: me.uid,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total: 1847,
  });
  await seedOwnCredit(squats, me.uid, 120);
  const steps = `w8pt-${me.id}`;
  await seedActiveGoal({
    goalId: steps,
    groupId,
    ownerUid: me.uid,
    title: 'Step-ups round',
    target: 2000,
    unit: 'step-ups',
    total: 612,
  });
  await seedOwnCredit(steps, me.uid, 45);
  const done = `w8pd-${me.id}`;
  await seedClosedGoal({
    goalId: done,
    groupId,
    ownerUid: me.uid,
    title: 'September Push-up Push',
    target: 3000,
    unit: 'push-ups',
    total: 3142,
  });
  await seedOwnCredit(done, me.uid, 260);
  return { ...me, squats, steps, done };
}

async function phone(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    userAgent: IPHONE_UA,
    timezoneId: 'America/New_York',
  });
  return { context, page: await context.newPage() };
}

/** Everything on the screen, as text, for the retired-phrase sweep. */
async function expectNoRetiredCopy(page: Page): Promise<void> {
  const text = (await page.getByTestId('wsf-activity').innerText()) ?? '';
  for (const phrase of RETIRED) {
    expect(text, `retired assurance "${phrase}" is still on screen`).not.toContain(phrase);
  }
}

/**
 * A frame for pixel review, labelled INSIDE the image.
 *
 * The product screenshot is taken untouched, then placed under an amber strip
 * on a separate page — so the label never covers a pixel of the product, and
 * the file can never be mistaken for an accepted AFTER.
 */
async function saveProposed(browser: Browser, page: Page, name: string): Promise<void> {
  if (!CAPTURE_FRAMES) return;
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.waitForTimeout(800);
  const png = await page.screenshot();
  const vp = page.viewportSize()!;
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height + 28 },
    deviceScaleFactor: 2,
  });
  try {
    const sheet = await ctx.newPage();
    await sheet.setContent(
      `<html><body style="margin:0;background:#F5C04A">` +
        `<div style="height:28px;display:flex;align-items:center;justify-content:center;` +
        `font:800 11px -apple-system,Helvetica,Arial,sans-serif;letter-spacing:.6px;color:#1B2A4A">` +
        `PROPOSED — NOT ACCEPTED · real build · synthetic fixture</div>` +
        `<img style="display:block;width:${vp.width}px;height:${vp.height}px" ` +
        `src="data:image/png;base64,${png.toString('base64')}"/></body></html>`,
    );
    await sheet.screenshot({ path: path.join(OUT, `PROPOSED-${name}.png`) });
  } finally {
    await ctx.close();
  }
}

test.describe('Progress copy — contribution first', () => {
  test('populated: contribution-first subtitle, one clarification, history and units intact', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const fx = await populatedMember('pop');
    for (const [key, viewport] of [
      ['populated-390x844', TALL],
      ['populated-390x640', SHORT],
    ] as const) {
      const { context, page } = await phone(browser, viewport);
      try {
        await signInVia(page, fx.email, fx.password);
        await page.goto('/activity');
        const rows = page.getByTestId('wsf-activity-rows');
        await expect(rows).toBeVisible({ timeout: 40_000 });
        await expect(page.getByTestId('wsf-activity-subtitle')).toHaveText(SUBTITLE);
        // Said exactly once on the screen.
        await expect(page.getByTestId('wsf-activity-privacy')).toHaveCount(1);
        await expect(page.getByTestId('wsf-activity-privacy')).toHaveText(CLARIFICATION);
        await expectNoRetiredCopy(page);
        // Finished-goal history stays, with its REACHED mark. (PROGRESS-PARITY-1
        // Phase B: the reference's goal rows replace the done-rows, and the
        // Progress reference draws no Living WE; its SHARED cell states the
        // finished goal's real total instead.)
        await expect(page.getByTestId(`wsf-activity-goal-${fx.done}`)).toContainText(
          'September Push-up Push',
        );
        await expect(page.getByTestId(`wsf-activity-goal-${fx.done}`)).toContainText('CLOSED · REACHED');
        await expect(page.getByTestId(`wsf-activity-goal-${fx.done}-shared`)).toContainText('/ 3,000 push-ups');
        // Units stay separate: each row carries its own unit; totals are per unit.
        await expect(page.getByTestId(`wsf-activity-goal-${fx.squats}-yours`)).toContainText('120 squats');
        await expect(page.getByTestId(`wsf-activity-goal-${fx.steps}-yours`)).toContainText('45 step-ups');
        await expect(page.getByTestId('wsf-activity-summary')).toHaveText(
          'Across 3 goals in 1 community. Each unit stays separate.',
        );
        await saveProposed(browser, page, `progress-${key}`);
      } finally {
        await context.close();
      }
    }
  });

  /*
    PROGRESS-PARITY-1 Phase B. This fixture member belongs to NO community, so
    no goal can take a contribution. The old screen still promised "Your first
    contribution will appear here" with a Start moving that had nowhere to go
    (W7 Check 44 baseline gap). The reference's no-open-goal card replaces it:
    no Start moving, a way to a community, and no claim about "your community".
  */
  test('empty, in no community: no Start moving, and a way to a community', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const me = await newMember('empty');
    for (const [key, viewport] of [
      ['empty-390x844', TALL],
      ['empty-390x640', SHORT],
    ] as const) {
      const { context, page } = await phone(browser, viewport);
      try {
        await signInVia(page, me.email, me.password);
        await page.goto('/activity');
        const empty = page.getByTestId('wsf-activity-empty');
        await expect(empty).toBeVisible({ timeout: 40_000 });
        await expect(empty).toHaveAttribute('data-state', 'no-open-goal');
        await expect(empty).not.toContainText(EMPTY_TITLE);
        await expect(empty).toContainText('join one, or start your own');
        await expect(empty).not.toContainText('your community');
        await expect(page.getByTestId('wsf-activity-start')).toHaveCount(0);
        await expect(page.getByTestId('wsf-activity-open-community')).toBeVisible();
        await expect(page.getByTestId('wsf-activity-subtitle')).toHaveText(SUBTITLE);
        await expect(page.getByTestId('wsf-activity-privacy')).toHaveCount(1);
        await expect(page.getByTestId('wsf-activity-privacy')).toHaveText(CLARIFICATION);
        await expectNoRetiredCopy(page);
        await saveProposed(browser, page, `progress-${key}`);
      } finally {
        await context.close();
      }
    }
  });

  /*
    PROGRESS-PARITY-1 Phase B: the reference's failure card replaces W8's
    sentence — it keeps the identity and refuses to guess — and its one action
    is Retry. The two ways on (Home, MOVE) are the persistent tab bar's.
  */
  test('error: one reassurance, the retry and both ways on', async ({ browser }) => {
    test.setTimeout(180_000);
    const fx = await populatedMember('err');
    const { context, page } = await phone(browser, TALL);
    try {
      await signInVia(page, fx.email, fx.password);
      await page.route('**/wsfMyCommunities', (route: Route) => route.abort('failed'));
      await page.goto('/activity');
      const error = page.getByTestId('wsf-activity-error');
      await expect(error).toBeVisible({ timeout: 40_000 });
      await expect(error).toContainText('We won’t guess amounts or show them as zero.');
      await expect(page.getByTestId('wsf-activity-retry')).toBeVisible();
      await expect(page.getByTestId('wsf-member-tab-home')).toBeVisible();
      await expect(page.getByTestId('wsf-member-tab-move')).toBeVisible();
      await expect(page.getByTestId('wsf-activity-totals')).toHaveCount(0);
      await expectNoRetiredCopy(page);
      await saveProposed(browser, page, 'progress-error-390x844');
    } finally {
      await context.close();
    }
  });
});
