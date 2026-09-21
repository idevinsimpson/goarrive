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
 * ACTUAL IMPLEMENTATION AFTER for YOU — `/you`.
 *
 * Real screenshots of the running product with the slice applied. These are
 * NOT targets: nothing here is drawn, and NO FRAME CARRIES A CONCEPT BANNER —
 * that strip belongs to targets and must never appear on an AFTER.
 *
 * The harness is the one Page 4 was accepted on: the same phone contexts, the
 * same shutter, the same containment and occlusion assertions, retargeted to
 * this page's chrome.
 */
const OUT = path.resolve(__dirname, '../../../docs/design-target/review/page-05-you/after');

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

  /*
    THE CHROME IS IN THE SHOT, not merely somewhere in the document.

    The previous assertion was `title.y >= 0`. That proves the title has a box
    at or below the viewport top and nothing else: a frame that had lost the
    persistent member bar entirely, or pushed the heading off the bottom, would
    have sailed through it. When the committed frames were questioned I could
    only answer by looking at the PNGs, which is exactly the position an
    assertion exists to avoid.

    So every element that makes this a signed-in member surface — the
    wordmark, the heading, the tab bar and the raised MOVE control — must be
    visible AND wholly inside the viewport at the moment the shutter fires.
  */
  const viewport = page.viewportSize()!;
  for (const [label, locator] of [
    ['the wordmark', page.getByTestId('wsf-you-wordmark')],
    ['the heading', page.getByTestId('wsf-you-title')],
    ['the member tab bar', page.getByTestId('wsf-member-tabs')],
    ['the raised MOVE control', page.getByTestId('wsf-member-tab-move')],
  ] as const) {
    await expect(locator, `${name}: ${label} is not visible`).toBeVisible();
    const box = await locator.boundingBox();
    expect(box, `${name}: ${label} has no box`).not.toBeNull();
    expect(box!.y, `${name}: ${label} is above the viewport`).toBeGreaterThanOrEqual(0);
    expect(
      box!.y + box!.height,
      `${name}: ${label} runs past the bottom of the viewport`,
    ).toBeLessThanOrEqual(viewport.height + 1);
    expect(box!.x, `${name}: ${label} is off the left edge`).toBeGreaterThanOrEqual(0);
    expect(
      box!.x + box!.width,
      `${name}: ${label} runs past the right edge`,
    ).toBeLessThanOrEqual(viewport.width + 1);
  }

  // Arrival order: wordmark above the heading, heading above the bar.
  const wordmarkBox = (await page.getByTestId('wsf-you-wordmark').boundingBox())!;
  const titleBox = (await page.getByTestId('wsf-you-title').boundingBox())!;
  const barBox = (await page.getByTestId('wsf-member-tabs').boundingBox())!;
  expect(titleBox.y, `${name}: the heading is not below the wordmark`).toBeGreaterThan(
    wordmarkBox.y,
  );
  expect(barBox.y, `${name}: the shell is not below the heading`).toBeGreaterThan(titleBox.y);

  {
    const bar = barBox;
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
  test(`you AFTER — ${cls.key}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const tag = `ya${cls.key.replace('x', '')}`;
    const fx = await seedMember(tag);

    // 1 · the member state: identity, the community, the lead goal and rows.
    {
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, fx.email, fx.password);
      await page.goto('/you');
      await expect(page.getByTestId('wsf-you-member')).toBeVisible({ timeout: 40_000 });
      await expect(page.getByTestId('wsf-you-name')).toBeVisible();
      await expect(page.getByTestId('wsf-you-community')).toBeVisible();
      await expect(page.getByTestId('wsf-you-lead')).toBeVisible();
      await shotChecked(page, `AFTER-member-${cls.key}`);
      await context.close();
    }

    // 2 · signed in, but in no community yet.
    {
      const nobody = await seedNobody(`${tag}n`);
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, nobody.email, nobody.password);
      await page.goto('/you');
      await expect(page.getByTestId('wsf-you-no-community')).toBeVisible({ timeout: 40_000 });
      // Sign out needs no read, so it is here too.
      await expect(page.getByTestId('wsf-you-signout')).toBeVisible();
      await shotChecked(page, `AFTER-nocommunity-${cls.key}`);
      await context.close();
    }

    // 3 · the goal read fails. Identity and Sign out must survive it.
    {
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, fx.email, fx.password);
      await page.route('**/wsfListGoals**', (route: Route) => route.abort('failed'));
      await page.goto('/you');
      await expect(page.getByTestId('wsf-you-failed')).toBeVisible({ timeout: 40_000 });
      await expect(page.getByTestId('wsf-you-signout')).toBeVisible();
      await expect(page.getByTestId('wsf-you-email')).toBeVisible();
      await shotChecked(page, `AFTER-failed-${cls.key}`);
      await context.close();
    }

    // 4 · signed out.
    //
    // THE ONE STATE WITHOUT THE MEMBER SHELL, AND THAT IS THE SHELL'S RULE,
    // NOT THIS PAGE'S: `MemberTabBar` returns null when `signedIn` is false,
    // so a visitor gets no Home/Community/Progress/You bar and no raised
    // MOVE. `shotChecked` would therefore fail on a correct frame. Rather
    // than drop the assertion, invert it — the absence is asserted, so a
    // shell that started rendering for signed-out visitors breaks a test
    // instead of quietly changing the evidence.
    {
      const { context, page } = await phone(browser, cls.viewport);
      await page.goto('/you');
      await expect(page.getByTestId('wsf-you-signed-out')).toBeVisible({ timeout: 40_000 });
      await expect(page.getByTestId('wsf-you-wordmark')).toBeVisible();
      await expect(page.getByTestId('wsf-you-title')).toBeVisible();
      await expect(page.getByTestId('wsf-member-tabs')).toHaveCount(0);
      await expect(page.getByTestId('wsf-member-tab-move')).toHaveCount(0);
      await shot(page, `AFTER-signedout-${cls.key}`);
      await context.close();
    }

    // 5 · loading. Held open by stalling the first callable, so the frame is
    // the real loading state rather than a race the shutter happened to win.
    {
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, fx.email, fx.password);
      await page.route('**/wsfMyCommunities**', async (route: Route) => {
        await new Promise((r) => setTimeout(r, 15_000));
        await route.abort('failed');
      });
      await page.goto('/you');
      await expect(page.getByTestId('wsf-you-loading')).toBeVisible({ timeout: 40_000 });
      // Signed in, so the shell is up even while the reads are in flight —
      // the same chrome assertion applies to the skeleton as to the content.
      await shotChecked(page, `AFTER-loading-${cls.key}`);
      await context.close();
    }

    // 6 · in several communities, with none picked.
    //
    // A SIXTH STATE, FOUND WHILE BUILDING THIS PAGE. The accepted target
    // named five. `resolveCurrentCommunity` returns null both for a member of
    // nothing and for a member of several with no remembered choice, and the
    // first draft of this page showed both people "You're not in a community
    // yet" — false about the second. The state is real, so it is drawn and
    // captured rather than left to the empty-state copy.
    {
      const several = await seedSeveral(`${tag}s`);
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, several.email, several.password);
      await page.goto('/you');
      await expect(page.getByTestId('wsf-you-pick-community')).toBeVisible({ timeout: 40_000 });
      // The true thing, and never the false one.
      await expect(page.getByTestId('wsf-you-pick-community')).toContainText(
        'You are in 2 communities',
      );
      await expect(page.getByTestId('wsf-you-no-community')).toHaveCount(0);
      await shotChecked(page, `AFTER-pickcommunity-${cls.key}`);
      await context.close();
    }
  });
}
