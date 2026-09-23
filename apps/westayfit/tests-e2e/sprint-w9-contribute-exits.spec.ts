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
 *   4. "BACK TO HOME" follows the same rule. On a cold arrival it opens Home,
 *      which resolves the member's community, and replaces rather than
 *      pushes. W1B's cold case could press this label too, in the moment
 *      before the screen's community context verifies.
 *
 * The committed total the member returns to is read too. That checks what
 * the screen already re-reads on focus; it is not W8's goal-list freshness.
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

async function seed(tag: string): Promise<Fx> {
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
    members: [{ uid, role: 'member' }],
  });
  const goalId = `w9exitgoal-${stamp}`;
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
  opts: { scroll?: number; total?: number },
): Promise<void> {
  const back = page.locator('[data-testid="wsf-contribute-back"]:visible').first();
  await expect(back, `${at}: the exit is on screen`).toBeVisible();
  await expect(back, `${at}: the exit says where it goes`).toHaveText('Back to community');
  await back.click();
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 40_000, message: `${at}: the community's address` })
    .toBe(`/community/${fx.groupId}`);
  await expect(page.getByTestId('wsf-community-goal-hero').last()).toBeVisible({ timeout: 40_000 });
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
  if (opts.total !== undefined) {
    await expect(
      page.locator(`[data-testid="wsf-community-goal-total-${fx.goalId}"]:visible`).first(),
      `${at}: the community shows the committed total`,
    ).toContainText(opts.total.toLocaleString('en-US'), { timeout: 30_000 });
  }
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

    await expectBackOnTheCommunityWeLeft(page, fx, 'receipt', {
      scroll: planted,
      total: SEEDED_TOTAL + ADDED,
    });
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

    await expectBackOnTheCommunityWeLeft(page, fx, 'refusal', { scroll: planted, total: SEEDED_TOTAL });
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
    await page.getByTestId('wsf-contribute-done').last().click();
    await recordTwenty(page);
    await expect(page.getByTestId('wsf-contribute-receipt').last()).toBeVisible({ timeout: 40_000 });

    await expectBackOnTheCommunityWeLeft(page, fx, 'MOVE from You', {
      scroll: planted,
      total: SEEDED_TOTAL + ADDED,
    });
    /*
      AND WHAT THE MEMBER SEES IS THE COMMUNITY, read by hit-testing, not by
      counting nodes. The You tab stays mounted underneath, hidden from
      assistive tech, because the shell keeps tabs mounted on purpose.
      Playwright still reports its nodes as visible, so the question is asked
      of the point a thumb would land on.
    */
    const onTop = await page.evaluate(() => {
      const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      return {
        community: Boolean(hit?.closest('[data-testid="wsf-community"]')),
        you: Boolean(hit?.closest('[data-testid="wsf-you-identity"]')),
      };
    });
    expect(onTop.community, 'MOVE from You: the screen on top is not the community').toBe(true);
    expect(onTop.you, 'MOVE from You: the member was left on You').toBe(false);
  });
});
