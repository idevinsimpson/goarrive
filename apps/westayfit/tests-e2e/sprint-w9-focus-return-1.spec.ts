import { expect, test, type Page, type Route } from '@playwright/test';

import {
  seedActiveGoal,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * W9 — FOCUS-RETURN-1: WHERE KEYBOARD FOCUS GOES WHEN A MEMBER LEAVES MOVE OR
 * THE CONTRIBUTION FLOW (L0 #474 `5825281943`; Director #365 `5825247950`).
 *
 * Measured before this packet (#474 `5824650143`): after every exit, focus
 * landed on `body`. A keyboard or screen-reader member lost their place and
 * had to start again from the top of the page.
 *
 * The contract, asserted by the focused element's testID:
 *   · MOVE's Close and Escape return focus to the control that opened MOVE;
 *   · the contribution route's Back, and each Finish exit ("Back to
 *     community" / "Back to home"), return focus to the actual opener on the
 *     screen the member lands on: the launcher on Home, or MOVE;
 *   · the tab the member was on stays current and keeps its scroll;
 *   · with no opener (a cold arrival, or an opener that is gone) focus goes to
 *     the landed screen's level-1 heading, or else the current tab's link;
 *   · never `body`, and a plain page load moves nothing.
 *
 * Everything seeded here is SYNTHETIC. Chromium, local emulators.
 */

const PASSWORD = 'Sup3rSecret!23';
const PHONE = { width: 390, height: 844 };
const SEEDED_TOTAL = 1847;

type Fx = { email: string; uid: string; groupId: string; goalIds: string[] };

async function seed(tag: string, goals: number, opts: { secondCommunity?: boolean } = {}): Promise<Fx> {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-w9-fr-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `w9fr-${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'private',
    members: [{ uid, role: 'member' }],
  });
  if (opts.secondCommunity) {
    await seedCommunity({
      groupId: `w9fr2-${stamp}`,
      displayName: 'Roswell Lunch Walkers',
      joinPolicy: 'private',
      members: [{ uid, role: 'member' }],
    });
  }
  const goalIds: string[] = [];
  for (let i = 0; i < goals; i += 1) {
    const goalId = `w9frgoal${i}-${stamp}`;
    await seedActiveGoal({
      goalId,
      groupId,
      ownerUid: uid,
      title: i === 0 ? 'October Squat Challenge' : 'Lunchtime Laps',
      target: 5000,
      unit: i === 0 ? 'squats' : 'laps',
      total: SEEDED_TOTAL,
      endsAt: new Date(Date.now() + (7 + i) * 24 * 60 * 60_000),
    });
    goalIds.push(goalId);
  }
  return { email, uid, groupId, goalIds };
}

// ---- readings -----------------------------------------------------------------

/** The focused element, by its own testID where it has one. */
async function focusedId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || el === document.documentElement) return 'body';
    const own = el.getAttribute('data-testid');
    if (own) return el.getClientRects().length > 0 ? own : `${own} (not visible)`;
    const near = el.closest('[data-testid]')?.getAttribute('data-testid');
    return `${el.tagName.toLowerCase()}${near ? ` in ${near}` : ''}`;
  });
}

async function expectFocus(page: Page, id: string, why: string): Promise<void> {
  await expect.poll(() => focusedId(page), { timeout: 8_000, message: why }).toBe(id);
}

/** The scroll offset of the nearest scrolling ancestor of a visible element. */
async function scrollAbove(page: Page, testId: string): Promise<number | null> {
  return page.evaluate((id) => {
    const all = Array.from(document.querySelectorAll(`[data-testid="${id}"]`)) as HTMLElement[];
    let el: HTMLElement | null = all.find((e) => e.getClientRects().length > 0) ?? null;
    while (el) {
      if (el.scrollHeight > el.clientHeight + 1) return Math.round(el.scrollTop);
      el = el.parentElement;
    }
    return null;
  }, testId);
}

/** Scroll the tab to `top` (as far as it goes) and wait for it to settle. */
async function plantScroll(page: Page, testId: string, top: number): Promise<number | null> {
  await page.evaluate(
    ({ id, value }) => {
      const all = Array.from(document.querySelectorAll(`[data-testid="${id}"]`)) as HTMLElement[];
      let el: HTMLElement | null = all.find((e) => e.getClientRects().length > 0) ?? null;
      while (el) {
        if (el.scrollHeight > el.clientHeight + 1) {
          el.scrollTop = value;
          return;
        }
        el = el.parentElement;
      }
    },
    { id: testId, value: top },
  );
  let last = await scrollAbove(page, testId);
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(100);
    const next = await scrollAbove(page, testId);
    if (next === last) return next;
    last = next;
  }
  return last;
}

async function currentTab(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid^="wsf-member-tab-"][data-current="true"]');
    return el?.getAttribute('data-testid') ?? null;
  });
}

function measure(label: string, value: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`MEASURE ${label}: ${JSON.stringify(value)}`);
  test.info().annotations.push({ type: 'measure', description: `${label}: ${JSON.stringify(value)}` });
}

// ---- journeys -----------------------------------------------------------------

async function pressByKeyboard(page: Page, testId: string): Promise<void> {
  const control = page.locator(`[data-testid="${testId}"]:visible`).first();
  await expect(control).toBeVisible({ timeout: 40_000 });
  await control.focus();
  await page.keyboard.press('Enter');
}

async function openMoveSheet(page: Page): Promise<void> {
  await pressByKeyboard(page, 'wsf-member-tab-move');
  await expect(page.locator('[data-testid="wsf-move-choose"]:visible')).toBeVisible({ timeout: 40_000 });
}

async function expectSheetClosed(page: Page, how: string): Promise<void> {
  await expect(page.getByTestId('wsf-move-sheet'), `${how} closes MOVE`).toHaveCount(0, { timeout: 8_000 });
}

async function recordTwenty(page: Page): Promise<void> {
  const entry = page.locator('[data-testid="wsf-contribute-entry"]:visible').first();
  await expect(entry).toBeVisible({ timeout: 40_000 });
  await entry.fill('20');
  await page.locator('[data-testid="wsf-contribute-review"]:visible').first().click();
  await expect(page.locator('[data-testid="wsf-contribute-review-screen"]:visible')).toBeVisible();
  await page.locator('[data-testid="wsf-contribute-submit"]:visible').first().click();
  await expect(page.locator('[data-testid="wsf-contribute-receipt"]:visible')).toBeVisible({ timeout: 40_000 });
}

/**
 * The server records the contribution and the answer about the community is
 * withheld, as it is for a member the server will not show the shared total
 * to: the own-only receipt, whose exit reads "Back to home". Labelled
 * injection; the write itself is real.
 */
async function answerOwnOnly(page: Page): Promise<void> {
  await page.route('**/wsfContribute', async (route: Route) => {
    const res = await route.fetch();
    const json = (await res.json()) as { result?: Record<string, unknown> };
    if (json.result) {
      json.result.sharedTotal = null;
      json.result.target = null;
      json.result.unit = null;
      json.result.status = null;
    }
    await route.fulfill({ response: res, json });
  });
}

type TabCase = {
  name: string;
  tab: string;
  root: string;
  open: (page: Page, fx: Fx) => Promise<void>;
};

const TAB_CASES: TabCase[] = [
  {
    name: 'Home',
    tab: 'wsf-member-tab-home',
    root: 'wsf-community',
    open: async (page, fx) => {
      await page.goto(`/community/${fx.groupId}`);
      await expect(page.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 40_000 });
    },
  },
  {
    name: 'Community',
    tab: 'wsf-member-tab-community',
    root: 'wsf-community-index',
    open: async (page, fx) => {
      await TAB_CASES[0]!.open(page, fx);
      await page.getByTestId('wsf-member-tab-community').last().click();
      await expect(page.locator('[data-testid="wsf-community-index-rows"]:visible')).toBeVisible({ timeout: 40_000 });
    },
  },
  {
    name: 'You',
    tab: 'wsf-member-tab-you',
    root: 'wsf-you',
    open: async (page, fx) => {
      await TAB_CASES[0]!.open(page, fx);
      await page.getByTestId('wsf-member-tab-you').last().click();
      await expect(page.locator('[data-testid="wsf-you-identity"]:visible')).toBeVisible({ timeout: 40_000 });
    },
  },
];

test.describe('FOCUS-RETURN-1 · focus goes back to the opener', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 2 });

  for (const c of TAB_CASES) {
    test(`MOVE from ${c.name}: Close and Escape return focus to MOVE; the tab and its scroll are kept`, async ({ page }) => {
      test.setTimeout(240_000);
      // Two open goals, so MOVE asks rather than handing straight to one.
      const fx = await seed(c.name.slice(0, 1).toLowerCase(), 2);
      await signInVia(page, fx.email, PASSWORD);
      await c.open(page, fx);
      const planted = await plantScroll(page, c.root, 160);

      // Close, by keyboard.
      await openMoveSheet(page);
      await pressByKeyboard(page, 'wsf-move-close');
      await expectSheetClosed(page, 'Close');
      await page.waitForTimeout(300);
      measure(`${c.name} · MOVE Close`, { focus: await focusedId(page), tab: await currentTab(page) });
      await expectFocus(page, 'wsf-member-tab-move', `${c.name}: Close returns focus to MOVE`);
      expect(await currentTab(page), `${c.name} is still the current tab`).toBe(c.tab);
      expect(await scrollAbove(page, c.root), `${c.name} kept its scroll`).toBe(planted);

      // Escape.
      await openMoveSheet(page);
      await page.keyboard.press('Escape');
      await expectSheetClosed(page, 'Escape');
      await page.waitForTimeout(300);
      measure(`${c.name} · MOVE Escape`, { focus: await focusedId(page), tab: await currentTab(page) });
      await expectFocus(page, 'wsf-member-tab-move', `${c.name}: Escape returns focus to MOVE`);
      expect(await currentTab(page), `${c.name} is still the current tab`).toBe(c.tab);
      expect(await scrollAbove(page, c.root), `${c.name} kept its scroll`).toBe(planted);
    });
  }

  test('Back: the route’s own Back returns focus to the Home hero’s “Already moved?”; Home keeps its scroll', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('b', 1);
    await signInVia(page, fx.email, PASSWORD);
    await TAB_CASES[0]!.open(page, fx);
    const launcherId = `wsf-community-goal-record-${fx.goalIds[0]}`;
    const launcher = page.locator(`[data-testid="${launcherId}"]:visible`).first();
    await expect(launcher).toBeVisible({ timeout: 40_000 });
    await launcher.focus();
    const before = await scrollAbove(page, 'wsf-community');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="wsf-contribute-entry-screen"]:visible')).toBeVisible({ timeout: 40_000 });

    await pressByKeyboard(page, 'wsf-contribute-back');
    await expect(page).toHaveURL(new RegExp(`/community/${fx.groupId}`), { timeout: 20_000 });
    await page.waitForTimeout(300);
    measure('hero launcher · Back', { focus: await focusedId(page), tab: await currentTab(page) });
    await expectFocus(page, launcherId, 'Back returns focus to the launcher');
    expect(await currentTab(page)).toBe('wsf-member-tab-home');
    expect(await scrollAbove(page, 'wsf-community'), 'Home kept its scroll').toBe(before);
  });

  test('Back: after MOVE from You hands straight to the one open goal, Back returns focus to MOVE on You', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('y', 1);
    await signInVia(page, fx.email, PASSWORD);
    await TAB_CASES[2]!.open(page, fx);
    await pressByKeyboard(page, 'wsf-member-tab-move');
    await expect(page.locator('[data-testid="wsf-contribute-move-screen"]:visible')).toBeVisible({ timeout: 40_000 });

    await pressByKeyboard(page, 'wsf-contribute-back');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 20_000 }).toBe('/you');
    await page.waitForTimeout(300);
    measure('MOVE from You · Back', { focus: await focusedId(page), tab: await currentTab(page) });
    await expectFocus(page, 'wsf-member-tab-move', 'Back returns focus to MOVE');
    expect(await currentTab(page)).toBe('wsf-member-tab-you');
  });

  test('Back: a goal chosen in the MOVE sheet gets focus back, and closing the sheet then returns it to MOVE', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('s', 2);
    await signInVia(page, fx.email, PASSWORD);
    await TAB_CASES[0]!.open(page, fx);
    await openMoveSheet(page);
    const choiceId = `wsf-move-choose-${fx.goalIds[0]}`;
    await pressByKeyboard(page, choiceId);
    await expect(page.locator('[data-testid="wsf-contribute-move-screen"]:visible')).toBeVisible({ timeout: 40_000 });

    await pressByKeyboard(page, 'wsf-contribute-back');
    await expect(page.locator('[data-testid="wsf-move-choose"]:visible')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(300);
    measure('sheet choice · Back', { focus: await focusedId(page) });
    await expectFocus(page, choiceId, 'Back returns focus to the goal chosen in the sheet');

    await page.keyboard.press('Escape');
    await expectSheetClosed(page, 'Escape');
    await expectFocus(page, 'wsf-member-tab-move', 'closing the sheet returns focus to MOVE');
    expect(await currentTab(page)).toBe('wsf-member-tab-home');
  });

  test('Finish: “Back to community” returns focus to the hero launcher that opened the flow', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('f', 1);
    await signInVia(page, fx.email, PASSWORD);
    await TAB_CASES[0]!.open(page, fx);
    const launcherId = `wsf-community-goal-record-${fx.goalIds[0]}`;
    await pressByKeyboard(page, launcherId);
    await recordTwenty(page);

    const exit = page.locator('[data-testid="wsf-contribute-back"]:visible').first();
    await expect(exit).toHaveText('Back to community', { timeout: 30_000 });
    await pressByKeyboard(page, 'wsf-contribute-back');
    await expect(page).toHaveURL(new RegExp(`/community/${fx.groupId}`), { timeout: 20_000 });
    await page.waitForTimeout(300);
    measure('hero launcher · receipt · Back to community', { focus: await focusedId(page), tab: await currentTab(page) });
    await expectFocus(page, launcherId, 'Finish returns focus to the launcher');
    expect(await currentTab(page)).toBe('wsf-member-tab-home');
  });

  test('Finish: “Back to community” after MOVE from You returns focus to MOVE, on the community', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('m', 1);
    await signInVia(page, fx.email, PASSWORD);
    await TAB_CASES[2]!.open(page, fx);
    await pressByKeyboard(page, 'wsf-member-tab-move');
    await pressByKeyboard(page, 'wsf-contribute-done');
    await recordTwenty(page);

    const exit = page.locator('[data-testid="wsf-contribute-back"]:visible').first();
    await expect(exit).toHaveText('Back to community', { timeout: 30_000 });
    await pressByKeyboard(page, 'wsf-contribute-back');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 20_000 }).toBe(`/community/${fx.groupId}`);
    await page.waitForTimeout(300);
    measure('MOVE from You · receipt · Back to community', { focus: await focusedId(page), tab: await currentTab(page) });
    await expectFocus(page, 'wsf-member-tab-move', 'Finish returns focus to MOVE');
    expect(await currentTab(page)).toBe('wsf-member-tab-home');
  });

  test('Finish: “Back to home” from the own-only receipt returns focus to MOVE, on the list the member left', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('h', 1);
    await signInVia(page, fx.email, PASSWORD);
    await page.goto('/?view=communities');
    await expect(page.locator('[data-testid="wsf-home-my-list"]:visible')).toBeVisible({ timeout: 40_000 });
    await pressByKeyboard(page, 'wsf-member-tab-move');
    await pressByKeyboard(page, 'wsf-contribute-done');
    await answerOwnOnly(page);
    await recordTwenty(page);
    await page.unroute('**/wsfContribute');

    const exit = page.locator('[data-testid="wsf-contribute-back"]:visible').first();
    await expect(exit).toHaveText('Back to home', { timeout: 30_000 });
    await pressByKeyboard(page, 'wsf-contribute-back');
    await expect.poll(() => new URL(page.url()).searchParams.get('view'), { timeout: 30_000 }).toBe('communities');
    await page.waitForTimeout(300);
    measure('MOVE from the list · own-only receipt · Back to home', { focus: await focusedId(page), tab: await currentTab(page) });
    await expectFocus(page, 'wsf-member-tab-move', 'Finish returns focus to MOVE');
    expect(await currentTab(page)).toBe('wsf-member-tab-home');
  });
});

test.describe('FOCUS-RETURN-1 · with no opener: the heading, else the current tab; never body', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 2 });

  test('cold arrivals: Back from a contribution opened directly, and Close on MOVE opened directly, focus the community’s heading', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('c', 2);
    await signInVia(page, fx.email, PASSWORD);

    await page.goto(`/contribute/${fx.goalIds[0]}?groupId=${fx.groupId}`);
    await expect(page.locator('[data-testid="wsf-contribute-community"]:visible')).toBeVisible({ timeout: 40_000 });
    await pressByKeyboard(page, 'wsf-contribute-back');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 40_000 }).toBe(`/community/${fx.groupId}`);
    await expect(page.locator('[data-testid="wsf-community-name"]:visible')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(300);
    measure('cold contribute · Back', { focus: await focusedId(page) });
    await expectFocus(page, 'wsf-community-name', 'a cold Back focuses the landed heading');

    await page.goto('/move');
    await expect(page.locator('[data-testid="wsf-move-choose"]:visible')).toBeVisible({ timeout: 40_000 });
    await pressByKeyboard(page, 'wsf-move-close');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 40_000 }).toBe(`/community/${fx.groupId}`);
    await expect(page.locator('[data-testid="wsf-community-name"]:visible')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(300);
    measure('cold MOVE · Close', { focus: await focusedId(page) });
    await expectFocus(page, 'wsf-community-name', 'a cold Close focuses the landed heading');
  });

  test('cold arrival on a Home with no heading: focus goes to the current tab', async ({ page }) => {
    test.setTimeout(240_000);
    // Two communities and none chosen: Home is the list, which has no h1.
    const fx = await seed('n', 1, { secondCommunity: true });
    await signInVia(page, fx.email, PASSWORD);
    await page.goto(`/contribute/${fx.goalIds[0]}`);
    await expect(page.locator('[data-testid="wsf-contribute-entry-screen"]:visible')).toBeVisible({ timeout: 40_000 });
    await pressByKeyboard(page, 'wsf-contribute-back');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 40_000 }).toBe('/');
    await expect(page.locator('[data-testid="wsf-member-tabs"]:visible')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(1_000);
    measure('cold contribute (no community) · Back', {
      path: new URL(page.url()).pathname,
      focus: await focusedId(page),
      headings: await page.locator('h1:visible, [role="heading"][aria-level="1"]:visible').count(),
    });
    await expectFocus(page, 'wsf-member-tab-home', 'with no heading, the current tab takes focus');
  });

  test('a plain page load and a tab switch move nothing', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await seed('p', 1);
    await signInVia(page, fx.email, PASSWORD);
    await TAB_CASES[0]!.open(page, fx);
    await page.waitForTimeout(1_500);
    expect(await focusedId(page), 'a plain load leaves focus alone').toBe('body');
    await page.getByTestId('wsf-member-tab-you').last().click();
    await expect(page.locator('[data-testid="wsf-you-identity"]:visible')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(800);
    expect(await focusedId(page), 'a tab switch leaves focus where the member put it').toBe('wsf-member-tab-you');
  });

  test('Progress’s own “Start moving”: measured, and never body', async ({ page }) => {
    test.setTimeout(240_000);
    // Nothing recorded yet, so Progress shows its own "Start moving". It is a
    // pointer press: on the base this control does not answer Enter, and it
    // REPLACES the tabs with MOVE rather than covering them (both reported,
    // neither changed by this packet), so there is no opener to return to.
    const fx = await seed('g', 2);
    await signInVia(page, fx.email, PASSWORD);
    await TAB_CASES[0]!.open(page, fx);
    await page.getByTestId('wsf-member-tab-activity').last().click();
    const start = page.locator('[data-testid="wsf-activity-start"]:visible').first();
    await expect(start).toBeVisible({ timeout: 40_000 });
    await start.click();
    await expect(page.locator('[data-testid="wsf-move-choose"]:visible')).toBeVisible({ timeout: 40_000 });
    await pressByKeyboard(page, 'wsf-move-close');
    await expectSheetClosed(page, 'Close');
    await page.waitForTimeout(1_000);
    const focus = await focusedId(page);
    measure('Progress Start moving · Close', {
      path: new URL(page.url()).pathname,
      tab: await currentTab(page),
      focus,
    });
    expect(focus, 'focus is never left on body').not.toBe('body');
  });
});
