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
 * W9 — A CONTRIBUTION'S EXITS LAND WHERE THEY SAY, ON THE SCREEN THAT IS
 * ALREADY THERE.
 *
 * W1B measured the defect at `f2f901a` (`5800387678`): from the receipt,
 * "Back to community" pushed a second Community screen over the one the
 * member had left. The one they had left stayed mounted and hidden, with its
 * state and scroll. `sprint-w1b-contribute-exits.spec.ts` (carried, W1B's)
 * proves the instance for the receipt, the unresolved reminder and a cold
 * closed goal. This file adds what that one does not ask:
 *
 *   1. SCROLL AND THE ONE TAB NAVIGATOR. The member comes back to the same
 *      offset, and no second tab navigator is mounted underneath.
 *   2. THE REFUSAL EXIT, driven. A refused contribution's "Back to community"
 *      returns like the receipt's. A signed-out refusal keeps its explicit
 *      destination, Sign in.
 *   3. THE JOURNEY WHERE `back()` IS WRONG. MOVE, opened from another tab,
 *      replaces itself with the contribution screen, so the screen beneath is
 *      that tab. "Back to community" still has to land on the community, and
 *      on the instance the Home tab already holds.
 *   4. "BACK TO HOME". On a cold arrival it opens Home, which resolves the
 *      member's community, and replaces rather than pushes. W1B's cold case
 *      could press this label too, in the moment before the screen's
 *      community context verifies. On a WARM arrival (a Champion's first
 *      contribution from Goal Setup's receipt, whose link names no
 *      community) it returns to the Home tab as it stands. It does not open
 *      Home's index over the mounted community, where Home's own redirect
 *      would build a second copy of it.
 *   5. A COLD "BACK TO COMMUNITY" replaces as well, once the context has
 *      verified and the label says so.
 *
 * WHAT DEPENDS ON W8. The committed total, and the new goal after Goal
 * Setup, are only current on the mounted screen once W8's Community freshness
 * is present (`claude/wsf-community-freshness`). `wsfGoalPulse` answers from
 * a two-second cache, so the one re-read on focus returns the old total
 * unless the screen reads again once that cache has expired; the goal list
 * does not re-read on focus at all. Those assertions are therefore the LAST
 * thing each test checks, so that on this branch alone every other claim
 * still runs, and they fail on the stale value rather than passing on it.
 *
 * Kiosk sessions never reach these exits (every kiosk rest state renders
 * Finish). They stay pinned by W1B's and W5's kiosk suites.
 *
 * Everything seeded here is SYNTHETIC.
 */

const PHONE = { width: 390, height: 844 };
const SEEDED_TOTAL = 1847;
const ADDED = 20;

type Fx = { email: string; password: string; groupId: string; goalId: string };

async function seed(
  tag: string,
  opts: { role?: 'member' | 'foundingChampion'; goal?: boolean } = {},
): Promise<Fx> {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-w9-exit-${stamp}@example.com`;
  const password = 'Sup3rSecret!23';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `w9exit-${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'private',
    members: [{ uid, role: opts.role ?? 'member' }],
  });
  const goalId = `w9exitgoal-${stamp}`;
  if (opts.goal === false) return { email, password, groupId, goalId };
  await seedActiveGoal({
    goalId,
    groupId,
    ownerUid: uid,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total: SEEDED_TOTAL,
  });
  return { email, password, groupId, goalId };
}

// ---- marks, scroll and counts ------------------------------------------------

/** Plant a mark on the community's own scroller: it can't survive a rebuild. */
async function markCommunity(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="wsf-community"]');
    if (!(el instanceof HTMLElement)) return false;
    el.dataset.wsfW9Exit = 'planted';
    return el.dataset.wsfW9Exit === 'planted';
  });
}

/** How many Community screens exist, and whether the VISIBLE one is marked. */
async function communityReading(page: Page) {
  return page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('[data-testid="wsf-community"]')) as HTMLElement[];
    const shown = all.find((el) => el.offsetParent !== null || el.getClientRects().length > 0) ?? null;
    return {
      instances: all.length,
      visibleIsMarked: Boolean(shown && shown.dataset.wsfW9Exit === 'planted'),
      tabNavigators: document.querySelectorAll('[data-testid="wsf-member-topbar"]').length,
    };
  });
}

async function scrollOf(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    let el = document.querySelector('[data-testid="wsf-community"]') as HTMLElement | null;
    while (el) {
      if (el.scrollHeight > el.clientHeight + 1) return Math.round(el.scrollTop);
      el = el.parentElement;
    }
    return null;
  });
}

/**
 * Plant an offset after the page's late reads have landed and read it until
 * two reads agree, for the reason `sprint-w9-shell-production` records: Chrome's
 * scroll anchoring moves a value planted before the enrichment arrives.
 */
async function settleScroll(page: Page, top: number): Promise<number | null> {
  await page.evaluate((value) => {
    let el = document.querySelector('[data-testid="wsf-community"]') as HTMLElement | null;
    while (el) {
      if (el.scrollHeight > el.clientHeight + 1) {
        el.scrollTop = value;
        return;
      }
      el = el.parentElement;
    }
  }, top);
  let last = await scrollOf(page);
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(100);
    const next = await scrollOf(page);
    if (next === last) return next;
    last = next;
  }
  return last;
}

/** Open the community the ordinary way and mark it, at a planted offset. */
async function openAndMarkCommunity(page: Page, fx: Fx): Promise<number> {
  await page.goto(`/community/${fx.groupId}`);
  await expect(page.getByTestId('wsf-community-hero-presence')).toBeVisible({ timeout: 40_000 });
  expect(await markCommunity(page), 'the Community screen was marked').toBe(true);
  const planted = await settleScroll(page, 160);
  expect(planted, 'the Community screen has somewhere to scroll to').not.toBeNull();
  expect(planted!, 'the planted scroll is not vacuous').toBeGreaterThan(40);
  return planted!;
}

async function recordTwenty(page: Page): Promise<void> {
  await page.getByTestId('wsf-contribute-entry').last().fill(String(ADDED));
  await page.getByTestId('wsf-contribute-review').last().click();
  await expect(page.getByTestId('wsf-contribute-review-screen').last()).toBeVisible();
  await page.getByTestId('wsf-contribute-submit').last().click();
}

/** Press the visible exit and prove where it landed. */
async function expectBackOnTheCommunityWeLeft(
  page: Page,
  fx: Fx,
  at: string,
  opts: { scroll?: number; label?: string } = {},
): Promise<void> {
  const back = page.locator('[data-testid="wsf-contribute-back"]:visible').first();
  await expect(back, `${at}: the exit is on screen`).toBeVisible();
  await expect(back, `${at}: the exit says where it goes`).toHaveText(opts.label ?? 'Back to community');
  await back.click();
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 40_000, message: `${at}: the community's address` })
    .toBe(`/community/${fx.groupId}`);
  await expect(page.locator('[data-testid="wsf-community"]:visible').first()).toBeVisible({ timeout: 40_000 });
  // Long enough for a pushed copy to finish mounting, so a slow second
  // instance cannot be missed by reading too early.
  await page.waitForTimeout(800);
  const r = await communityReading(page);
  expect(r.instances, `${at}: a second Community screen was built`).toBe(1);
  expect(r.visibleIsMarked, `${at}: the Community on show is not the one the member left`).toBe(true);
  expect(r.tabNavigators, `${at}: a second tab navigator is mounted`).toBe(1);
  if (opts.scroll !== undefined) {
    expect(await scrollOf(page), `${at}: the member came back to a different place on the page`).toBe(
      opts.scroll,
    );
  }
  /*
    AND WHAT THE MEMBER SEES IS THE COMMUNITY, read by hit-testing rather
    than by counting nodes. Tabs stay mounted on purpose, so a tab the member
    left is still in the document, hidden from assistive tech, and Playwright
    still reports its nodes as visible. The question is asked of the point a
    thumb would land on.
  */
  const onTop = await page.evaluate(() => {
    const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    return {
      community: Boolean(hit?.closest('[data-testid="wsf-community"]')),
      you: Boolean(hit?.closest('[data-testid="wsf-you"]')),
    };
  });
  expect(onTop.community, `${at}: the screen on top is not the community`).toBe(true);
  expect(onTop.you, `${at}: the member was left on You`).toBe(false);
}

/** W8-dependent, so always the last thing a test asks (see the header). */
async function expectCommittedTotal(page: Page, fx: Fx, at: string, total: number): Promise<void> {
  await expect(
    page.locator(`[data-testid="wsf-community-goal-total-${fx.goalId}"]:visible`).first(),
    `${at}: the community shows the committed total`,
  ).toContainText(total.toLocaleString('en-US'), { timeout: 30_000 });
}

/** Answer the contribution callable with a refusal of this code. */
async function refuseWith(page: Page, status: string, message: string): Promise<void> {
  await page.route('**/wsfContribute', (route: Route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ error: { status, message } }),
    }),
  );
}

test.describe('contribution exits land on the mounted community', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 2 });

  test('from the receipt: the same screen, the same place on it, one tab navigator, the new total', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const fx = await seed('r');
    await signInVia(page, fx.email, fx.password);
    const planted = await openAndMarkCommunity(page, fx);

    await page.getByTestId(`wsf-community-goal-record-${fx.goalId}`).last().click();
    await expect(page.getByTestId('wsf-contribute-entry-screen').last()).toBeVisible({ timeout: 40_000 });
    await recordTwenty(page);
    await expect(page.getByTestId('wsf-contribute-receipt').last()).toBeVisible({ timeout: 40_000 });

    await expectBackOnTheCommunityWeLeft(page, fx, 'receipt', { scroll: planted });
    await expectCommittedTotal(page, fx, 'receipt', SEEDED_TOTAL + ADDED);
  });

  test('from a refusal: "Back to community" returns the same way', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('x');
    await signInVia(page, fx.email, fx.password);
    const planted = await openAndMarkCommunity(page, fx);

    await page.getByTestId(`wsf-community-goal-record-${fx.goalId}`).last().click();
    await expect(page.getByTestId('wsf-contribute-entry-screen').last()).toBeVisible({ timeout: 40_000 });
    // A definitive server refusal, answered locally: the goal closed before
    // the contribution reached it. Nothing is recorded.
    await refuseWith(page, 'FAILED_PRECONDITION', 'This goal is closed.');
    await recordTwenty(page);
    await expect(page.getByTestId('wsf-contribute-refused').last()).toBeVisible({ timeout: 40_000 });
    await page.unroute('**/wsfContribute');

    await expectBackOnTheCommunityWeLeft(page, fx, 'refusal', { scroll: planted });
  });

  test('a signed-out refusal keeps its own destination: Sign in', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('s');
    await signInVia(page, fx.email, fx.password);
    await openAndMarkCommunity(page, fx);

    await page.getByTestId(`wsf-community-goal-record-${fx.goalId}`).last().click();
    await expect(page.getByTestId('wsf-contribute-entry-screen').last()).toBeVisible({ timeout: 40_000 });
    await refuseWith(page, 'UNAUTHENTICATED', 'Sign in to contribute.');
    await recordTwenty(page);
    await expect(page.getByTestId('wsf-contribute-refused').last()).toBeVisible({ timeout: 40_000 });
    await page.unroute('**/wsfContribute');

    const signIn = page.locator('[data-testid="wsf-contribute-back"]:visible').first();
    await expect(signIn).toHaveText('Sign in');
    await expect(signIn, 'Sign in is still a link to /signin').toHaveAttribute('href', '/signin');
    /*
      WHERE THE PRESS GOES, read from the history write it makes. The refusal
      here is answered locally, so this member really is signed in, and
      `/signin` sends a signed-in member on to their community a moment later.
      Polling the address would sometimes catch `/signin` and sometimes the
      community, which measures the sign-in screen, not this exit.
    */
    await page.evaluate(() => {
      const w = window as unknown as { __wsfW9Writes: string[] };
      w.__wsfW9Writes = [];
      for (const name of ['pushState', 'replaceState'] as const) {
        const original = history[name].bind(history);
        history[name] = (data: unknown, unused: string, url?: string | URL | null) => {
          w.__wsfW9Writes.push(new URL(String(url ?? ''), location.href).pathname);
          return original(data, unused, url);
        };
      }
    });
    await signIn.click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __wsfW9Writes: string[] }).__wsfW9Writes[0]), {
        timeout: 30_000,
        message: 'the first address the Sign in press writes',
      })
      .toBe('/signin');
  });

  test('"Back to home" on a cold arrival opens Home and leaves no contribution entry behind', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const fx = await seed('h');
    await signInVia(page, fx.email, fx.password);
    // A goal that does not exist, opened directly: the screen can only offer
    // Home, and Home resolves this member's only community.
    await page.goto(`/contribute/w9-no-such-goal-${stampId()}?groupId=${fx.groupId}`);
    const home = page.locator('[data-testid="wsf-contribute-home"]:visible').first();
    await expect(home).toBeVisible({ timeout: 40_000 });
    await expect(home).toHaveText('Back to home');
    const before = await page.evaluate(() => window.history.length);
    await home.click();
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 40_000, message: 'Home resolved the community' })
      .toBe(`/community/${fx.groupId}`);
    await expect(page.getByTestId('wsf-community-goal-hero').last()).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(800);
    expect(
      await page.evaluate(() => window.history.length),
      'the dead-end contribution screen was left in the history',
    ).toBe(before);
    expect((await communityReading(page)).tabNavigators, 'one tab navigator').toBe(1);
  });

  test('from MOVE opened on another tab: the community, not the tab beneath', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('m');
    await signInVia(page, fx.email, fx.password);
    // The Home tab holds this community, mounted and marked.
    const planted = await openAndMarkCommunity(page, fx);

    // The member moves on to You, then opens MOVE from there. With one open
    // goal MOVE hands straight to the contribution screen, replacing itself,
    // so the screen directly beneath the contribution is You.
    await page.getByTestId('wsf-member-tab-you').last().click();
    await expect(page.getByTestId('wsf-you-identity').last()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('wsf-member-tab-move').last().click();
    await expect(page.getByTestId('wsf-contribute-move-screen').last()).toBeVisible({ timeout: 40_000 });
    // THE PREMISE, asserted rather than assumed: this is MOVE's one-goal
    // handoff, and the sheet replaced itself, so what is beneath is You.
    expect(new URL(page.url()).searchParams.get('mode'), 'MOVE handed off in move mode').toBe('move');
    await expect(page.getByTestId('wsf-move-sheet'), 'the MOVE sheet replaced itself').toHaveCount(0);
    await page.getByTestId('wsf-contribute-done').last().click();
    await recordTwenty(page);
    await expect(page.getByTestId('wsf-contribute-receipt').last()).toBeVisible({ timeout: 40_000 });

    await expectBackOnTheCommunityWeLeft(page, fx, 'MOVE from You', { scroll: planted });
    await expectCommittedTotal(page, fx, 'MOVE from You', SEEDED_TOTAL + ADDED);
  });

  test('a cold "Back to community", once the context verifies, replaces rather than pushes', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const fx = await seed('v');
    await signInVia(page, fx.email, fx.password);
    await page.goto(`/contribute/${fx.goalId}?groupId=${fx.groupId}`);
    await expect(page.getByTestId('wsf-contribute-entry-screen').last()).toBeVisible({ timeout: 40_000 });
    await recordTwenty(page);
    await expect(page.getByTestId('wsf-contribute-receipt').last()).toBeVisible({ timeout: 40_000 });
    const back = page.locator('[data-testid="wsf-contribute-back"]:visible').first();
    // The label is the proof the context verified: before that it says Home.
    await expect(back).toHaveText('Back to community', { timeout: 30_000 });
    const before = await page.evaluate(() => window.history.length);
    await back.click();
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 40_000, message: 'the community' })
      .toBe(`/community/${fx.groupId}`);
    await expect(page.locator('[data-testid="wsf-community"]:visible').first()).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(800);
    expect(
      await page.evaluate(() => window.history.length),
      'the dead-end contribution screen was left in the history',
    ).toBe(before);
    const r = await communityReading(page);
    expect(r.instances, 'one Community screen').toBe(1);
    expect(r.tabNavigators, 'one tab navigator').toBe(1);
  });

  test('a warm "Back to home" from Goal Setup returns to the mounted Home tab, not a copy of it', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    // A Champion with a community and no goal yet: the first goal's journey.
    const fx = await seed('g', { role: 'foundingChampion', goal: false });
    await signInVia(page, fx.email, fx.password);
    await page.goto(`/community/${fx.groupId}`);
    const start = page.getByTestId('wsf-community-start-goal').last();
    await expect(start).toBeVisible({ timeout: 40_000 });
    expect(await markCommunity(page), 'the Community screen was marked').toBe(true);

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

    // Goal Setup's link names no community, so this contribution's exits
    // say Home: the path the review traced to a second Community.
    await page.getByTestId('wsf-new-goal-goto-contribute').last().click();
    await expect(page.getByTestId('wsf-contribute-entry-screen').last()).toBeVisible({ timeout: 40_000 });
    await recordTwenty(page);
    await expect(page.getByTestId('wsf-contribute-receipt').last()).toBeVisible({ timeout: 40_000 });

    await expectBackOnTheCommunityWeLeft(page, fx, 'Goal Setup, Back to home', { label: 'Back to home' });
    /*
      W8-dependent, last: the mounted page shows the goal that now exists.
      Read by its title in the visible screen's hero, as W8's own spec does.
      Not by its record control: Goal Setup's default repeat policy is
      "once", so after this contribution the member has no record control
      for it, and waiting for one would measure the policy, not freshness.
    */
    const visible = page.locator('[data-testid="wsf-community"]:visible').first();
    await expect(
      visible.getByTestId('wsf-community-goal-hero'),
      'Goal Setup, Back to home: the new goal is on the community the member returned to',
    ).toContainText('Squats together this week', { timeout: 30_000 });
    await expect(visible.getByTestId('wsf-community-no-goal')).toHaveCount(0);
  });
});
