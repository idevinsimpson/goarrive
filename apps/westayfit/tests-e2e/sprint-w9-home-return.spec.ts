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
 * W9 — "BACK TO HOME" RETURNS TO HOME AS IT STANDS, AND WHAT IT SHOWS IS
 * WHAT THE SERVER HAS CONFIRMED.
 *
 * Two journeys were measured against the accepted exits (`cd02949`), and
 * against the preserved `37082fd` (#458 `5803479617`):
 *
 *   1. A LIST THE MEMBER ASKED FOR. `/?view=communities` on screen, then MOVE,
 *      a contribution, and "Back to home". `cd02949` drops the request and
 *      opens the community fresh. `37082fd` keeps the list, but its card
 *      still shows the total from before the contribution, because Home
 *      reads its list once, on mount.
 *   2. A CHAMPION'S FIRST CONTRIBUTION. Goal Setup's receipt links to the
 *      contribution with no community named, so every exit reads "Back to
 *      home". `cd02949` opens Home's index over the mounted community, and
 *      Home's own redirect builds a second copy of it.
 *
 * The contract (Director #365 `5803510323`, L0 #458 `5803533321`): return to
 * the existing Home state, and refresh the visible list from confirmed server
 * reads on a genuine return. Both journeys fail first. The controls say what
 * must not change: a reload keeps the list the address asks for, and
 * reselecting the tab the member is on reads nothing.
 *
 * Totals are compared with the emulator's committed counter shards, read
 * directly, never with a number the screen was told.
 *
 * Everything seeded here is SYNTHETIC.
 */

const PHONE = { width: 390, height: 844 };
const SEEDED_TOTAL = 1847;
const ADDED = 20;

type Fx = { email: string; password: string; uid: string; groupId: string; goalId: string };

async function seed(
  tag: string,
  opts: { role?: 'member' | 'foundingChampion'; goal?: boolean } = {},
): Promise<Fx> {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-w9-home-${stamp}@example.com`;
  const password = 'Sup3rSecret!23';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `w9home-${stamp}`;
  const goalId = `w9homegoal-${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'private',
    members: [{ uid, role: opts.role ?? 'member' }],
  });
  if (opts.goal === false) return { email, password, uid, groupId, goalId };
  await seedActiveGoal({
    goalId,
    groupId,
    ownerUid: uid,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total: SEEDED_TOTAL,
  });
  return { email, password, uid, groupId, goalId };
}

/** The committed total, summed from the emulator's counter shards. */
async function committedTotal(goalId: string): Promise<number> {
  let total = 0;
  for (let i = 0; i < 10; i += 1) {
    const res = await fetch(
      `http://127.0.0.1:8080/v1/projects/demo-wsf-local/databases/(default)/documents/wsfGoalCounters/${goalId}/shards/${i}`,
      { headers: { authorization: 'Bearer owner' } },
    );
    if (!res.ok) continue;
    const body = (await res.json()) as { fields?: { count?: { integerValue?: string } } };
    total += Number(body.fields?.count?.integerValue ?? 0);
  }
  return total;
}

/** Plant a mark on a node that cannot survive being rebuilt. */
async function mark(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const all = Array.from(document.querySelectorAll(`[data-testid="${id}"]`)) as HTMLElement[];
    const shown = all.find((el) => el.offsetParent !== null || el.getClientRects().length > 0);
    if (!shown) return false;
    shown.dataset.wsfW9Home = 'planted';
    return true;
  }, testId);
}

/** How many of these exist, whether the one on show is marked, and what is on top. */
async function reading(page: Page, testId: string) {
  return page.evaluate((id) => {
    const all = Array.from(document.querySelectorAll(`[data-testid="${id}"]`)) as HTMLElement[];
    const shown = all.find((el) => el.offsetParent !== null || el.getClientRects().length > 0) ?? null;
    const marked = all.find((el) => el.dataset.wsfW9Home === 'planted') ?? null;
    // Tabs stay mounted on purpose, hidden from assistive tech, and
    // Playwright still calls their nodes visible. Ask the point a thumb
    // would land on instead: the middle of the marked element's part of the
    // viewport (a short list does not reach the middle of the screen).
    let onTop = false;
    if (marked) {
      const r = marked.getBoundingClientRect();
      const top = Math.max(r.top, 0);
      const bottom = Math.min(r.bottom, window.innerHeight);
      if (bottom > top && r.width > 0) {
        const hit = document.elementFromPoint(r.left + r.width / 2, (top + bottom) / 2);
        onTop = Boolean(hit && marked.contains(hit));
      }
    }
    return {
      instances: all.length,
      visibleIsMarked: Boolean(shown && shown === marked),
      onTop,
      tabNavigators: document.querySelectorAll('[data-testid="wsf-member-topbar"]').length,
      historyLength: window.history.length,
    };
  }, testId);
}

function countReads(page: Page) {
  const calls: string[] = [];
  page.on('request', (r) => {
    const m = /\/(wsfMyCommunities|wsfListGoals)$/.exec(new URL(r.url()).pathname);
    if (m) calls.push(m[1]!);
  });
  return calls;
}

async function recordTwenty(page: Page): Promise<void> {
  await page.getByTestId('wsf-contribute-entry').last().fill(String(ADDED));
  await page.getByTestId('wsf-contribute-review').last().click();
  await expect(page.getByTestId('wsf-contribute-review-screen').last()).toBeVisible();
  await page.getByTestId('wsf-contribute-submit').last().click();
  await expect(page.getByTestId('wsf-contribute-receipt').last()).toBeVisible({ timeout: 40_000 });
}

/**
 * The server commits the contribution, and the answer about the community is
 * withheld, as it is for a member the server will not show the shared total
 * to. The receipt is then the own-only one, whose exit reads "Back to home".
 * Labelled injection: the write itself is real.
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

async function openListAndMark(page: Page, fx: Fx): Promise<void> {
  await page.goto('/?view=communities');
  await expect(page.getByTestId('wsf-home-my-list').last()).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId(`wsf-home-community-${fx.groupId}`).last()).toContainText(
    SEEDED_TOTAL.toLocaleString('en-US'),
    { timeout: 30_000 },
  );
  expect(await mark(page, 'wsf-home-my-list'), 'the list on show was marked').toBe(true);
}

async function pressBackToHome(page: Page): Promise<void> {
  const home = page.locator('[data-testid="wsf-contribute-back"]:visible').first();
  await expect(home, 'the exit says where it goes').toHaveText('Back to home', { timeout: 30_000 });
  await home.click();
}

test.describe('"Back to home" returns to Home as it stands, with confirmed figures', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 2 });

  test('a list the member asked for: the same list, its address, and the committed total', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const fx = await seed('l');
    await signInVia(page, fx.email, fx.password);
    await openListAndMark(page, fx);

    await page.getByTestId('wsf-member-tab-move').last().click();
    await expect(page.getByTestId('wsf-contribute-move-screen').last()).toBeVisible({ timeout: 40_000 });
    await page.getByTestId('wsf-contribute-done').last().click();
    await answerOwnOnly(page);
    await recordTwenty(page);
    await page.unroute('**/wsfContribute');
    const server = await committedTotal(fx.goalId);
    expect(server, 'the contribution committed').toBe(SEEDED_TOTAL + ADDED);

    // Measured at the press: browser history never shrinks, and opening MOVE
    // is an entry of its own.
    const atPress = await page.evaluate(() => window.history.length);
    await pressBackToHome(page);
    await expect
      .poll(() => new URL(page.url()).searchParams.get('view'), {
        timeout: 30_000,
        message: 'the list request survived the return',
      })
      .toBe('communities');
    expect(new URL(page.url()).pathname).toBe('/');
    await page.waitForTimeout(800);
    const after = await reading(page, 'wsf-home-my-list');
    expect(after.instances, 'one list').toBe(1);
    expect(after.visibleIsMarked, 'the list on show is not the one the member left').toBe(true);
    expect(after.onTop, 'the list the member left is covered').toBe(true);
    expect(after.tabNavigators, 'one tab navigator').toBe(1);
    expect(after.historyLength, 'the return added a history entry').toBe(atPress);
    // Refreshed in place, never back to a loading list over figures it had.
    await expect(page.getByTestId('wsf-home-my-loading')).toHaveCount(0);
    await expect(
      page.getByTestId(`wsf-home-community-${fx.groupId}`).last(),
      'the card shows the committed total',
    ).toContainText(server.toLocaleString('en-US'), { timeout: 20_000 });
  });

  test("a Champion's first contribution: the same Community screen, not a copy of it", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const fx = await seed('g', { role: 'foundingChampion', goal: false });
    await signInVia(page, fx.email, fx.password);
    await page.goto(`/community/${fx.groupId}`);
    const start = page.getByTestId('wsf-community-start-goal').last();
    await expect(start).toBeVisible({ timeout: 40_000 });
    expect(await mark(page, 'wsf-community'), 'the Community screen was marked').toBe(true);

    await start.click();
    await expect(page.getByTestId('wsf-new-goal-form').last()).toBeVisible({ timeout: 40_000 });
    await page.getByTestId('wsf-new-goal-title').last().fill('Squats together this week');
    await page.getByTestId('wsf-new-goal-target').last().fill('500');
    await page.getByTestId('wsf-new-goal-unit').last().fill('squats');
    await page.getByTestId('wsf-new-goal-submit').last().click();
    const created = page.getByTestId('wsf-new-goal-created').last();
    await expect(created).toBeVisible({ timeout: 40_000 });
    const newGoalId = (await created.getAttribute('data-goal-id')) ?? '';
    expect(newGoalId, 'the receipt names the goal the server made').not.toBe('');
    await page.getByTestId('wsf-new-goal-goto-contribute').last().click();
    await expect(page.getByTestId('wsf-contribute-entry-screen').last()).toBeVisible({ timeout: 40_000 });
    await recordTwenty(page);

    await pressBackToHome(page);
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 40_000, message: "the community's address" })
      .toBe(`/community/${fx.groupId}`);
    await page.waitForTimeout(800);
    const r = await reading(page, 'wsf-community');
    expect(r.instances, 'a second Community screen was built').toBe(1);
    expect(r.visibleIsMarked, 'the Community on show is not the one the member left').toBe(true);
    expect(r.onTop, 'the community the member left is covered').toBe(true);
    expect(r.tabNavigators, 'one tab navigator').toBe(1);
    const visible = page.locator('[data-testid="wsf-community"]:visible').first();
    await expect(
      visible.getByTestId('wsf-community-goal-hero'),
      'the new goal is on the community the member returned to',
    ).toContainText('Squats together this week', { timeout: 30_000 });
    // What the member reads is what the server committed. W7 measured a
    // FRESHLY MOUNTED Community here showing 0 against 20 (#365 `5803765299`):
    // its first read lands inside the pulse's two-second cache.
    const server = await committedTotal(newGoalId);
    expect(server, 'the contribution committed').toBe(ADDED);
    await expect(
      visible.getByTestId(`wsf-community-goal-total-${newGoalId}`),
      'the community shows the committed total',
    ).toHaveText(new RegExp(`^${server}\\s+of\\s+500`), { timeout: 20_000 });
  });

  test('a failed list re-read leaves the list standing, and the figures still update', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const fx = await seed('f');
    await signInVia(page, fx.email, fx.password);
    await openListAndMark(page, fx);

    await page.getByTestId('wsf-member-tab-move').last().click();
    await expect(page.getByTestId('wsf-contribute-move-screen').last()).toBeVisible({ timeout: 40_000 });
    await page.getByTestId('wsf-contribute-done').last().click();
    await answerOwnOnly(page);
    await recordTwenty(page);
    await page.unroute('**/wsfContribute');
    const server = await committedTotal(fx.goalId);
    expect(server, 'the contribution committed').toBe(SEEDED_TOTAL + ADDED);

    // The list read the return makes is refused. Labelled injection.
    await page.route('**/wsfMyCommunities', (route: Route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ error: { status: 'INTERNAL', message: 'refused for this test' } }),
      }),
    );
    await pressBackToHome(page);
    await expect
      .poll(() => new URL(page.url()).searchParams.get('view'), { timeout: 30_000 })
      .toBe('communities');
    await page.waitForTimeout(800);
    const after = await reading(page, 'wsf-home-my-list');
    expect(after.instances, 'one list').toBe(1);
    expect(after.visibleIsMarked, 'the list on show is not the one the member left').toBe(true);
    // Neither a loading list nor an error is painted over what the member had.
    await expect(page.getByTestId('wsf-home-my-loading')).toHaveCount(0);
    await expect(page.getByTestId('wsf-home-my-error')).toHaveCount(0);
    await expect(
      page.getByTestId(`wsf-home-community-${fx.groupId}`).last(),
      'the card shows the committed total',
    ).toContainText(server.toLocaleString('en-US'), { timeout: 20_000 });
    await page.unroute('**/wsfMyCommunities');
  });

  test('Back from a community to the list stays on the list, and the list is re-read', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    /*
      The re-read never moves the member. Two communities and none
      remembered, so bare `/` shows the list. Opening one remembers it. Back
      pops to the same list, which now re-reads — and a Home that decided
      again on that read would open the remembered community over the list
      the member pressed Back to see. Opening is decided once, on first read.
    */
    const fx = await seed('b');
    const other = `${fx.groupId}-b`;
    await seedCommunity({
      groupId: other,
      displayName: 'Roswell Evening Walkers',
      joinPolicy: 'private',
      members: [{ uid: fx.uid, role: 'member' }],
    });
    await signInVia(page, fx.email, fx.password);
    await page.goto('/');
    await expect(page.getByTestId('wsf-home-my-list').last()).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId(`wsf-home-community-${fx.groupId}`).last()).toContainText(
      SEEDED_TOTAL.toLocaleString('en-US'),
      { timeout: 30_000 },
    );
    expect(await mark(page, 'wsf-home-my-list'), 'the list on show was marked').toBe(true);

    await page.getByTestId(`wsf-home-community-${fx.groupId}`).last().click();
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 40_000 })
      .toBe(`/community/${fx.groupId}`);
    await expect(page.getByTestId('wsf-community-hero-presence').last()).toBeVisible({ timeout: 40_000 });

    const calls = countReads(page);
    await page.goBack();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe('/');
    await expect.poll(() => calls.includes('wsfMyCommunities'), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => calls.includes('wsfListGoals'), { timeout: 20_000 }).toBe(true);
    await page.waitForTimeout(2_500);
    expect(new URL(page.url()).pathname, 'the re-read moved the member').toBe('/');
    await expect(page.getByTestId('wsf-home-opening-community')).toHaveCount(0);
    const r = await reading(page, 'wsf-home-my-list');
    expect(r.instances, 'one list').toBe(1);
    expect(r.visibleIsMarked, 'the list on show is not the one the member left').toBe(true);
    expect(r.onTop, 'the list the member came back to is covered').toBe(true);

    // COLD RESOLUTION IS KEPT: a reload of bare `/` opens the remembered one.
    await page.reload();
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 40_000, message: 'cold, Home opens the remembered community' })
      .toBe(`/community/${fx.groupId}`);
  });

  test('control: a reload keeps the list the address asks for, with the committed total', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const fx = await seed('q');
    await signInVia(page, fx.email, fx.password);
    await openListAndMark(page, fx);
    await page.reload();
    await expect(page.getByTestId('wsf-home-my-list').last()).toBeVisible({ timeout: 40_000 });
    expect(new URL(page.url()).searchParams.get('view')).toBe('communities');
    await expect(page.getByTestId(`wsf-home-community-${fx.groupId}`).last()).toContainText(
      (await committedTotal(fx.goalId)).toLocaleString('en-US'),
      { timeout: 30_000 },
    );
  });

  test('control: reselecting Home on the list reads nothing and keeps the list', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('s');
    await signInVia(page, fx.email, fx.password);
    await openListAndMark(page, fx);
    await page.waitForTimeout(1_500);
    const calls = countReads(page);
    await page.getByTestId('wsf-member-tab-home').last().click();
    await page.waitForTimeout(1_500);
    expect(calls, 'reselecting the active tab re-read the list').toEqual([]);
    const r = await reading(page, 'wsf-home-my-list');
    expect(r.visibleIsMarked, 'reselect replaced the list').toBe(true);
    expect(new URL(page.url()).searchParams.get('view')).toBe('communities');
  });
});
