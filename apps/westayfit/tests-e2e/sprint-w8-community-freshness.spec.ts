import { randomBytes } from 'node:crypto';

import { expect, test, type Browser, type Page, type Route } from '@playwright/test';

import { openShellMenu } from './helpers/memberShell';
import {
  firestoreWrite,
  seedActiveGoal,
  seedCommunity,
  seedMembership,
  seedProfile,
  seedShards,
  seedVerifiedUser,
  signInVia,
  stampId,
  tsField,
} from './helpers/mobile';

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

/** A second, ordinary member of an existing community. */
async function newMemberOf(groupId: string, label: string) {
  const id = stampId();
  const email = `w8f-${label}-${id}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Priya Nair');
  await seedMembership(groupId, uid, 'member');
  return { email, password, uid };
}

/**
 * COMMUNITY-DATA FRESHNESS ON A GENUINE RETURN (Director `5800485762`).
 *
 * The Community screen stays mounted under whatever the member opens from it.
 * A history Back therefore returns to the SAME instance, and that instance must
 * not show what was true before the member left.
 *
 * W6 measured the defect (`5800472286`): a Champion creates a goal, goes Back,
 * and the mounted page still says "No goal running yet" — and on the unknown
 * outcome that is the exact prompt to create a duplicate goal. Each case below
 * proves BOTH halves: the instance and its scroll survive (no remount), and
 * the data is the current data.
 */

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

async function phone(browser: Browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    userAgent: IPHONE_UA,
    timezoneId: 'America/New_York',
  });
  return { context, page: await context.newPage() };
}

async function champion(label: string, withGoal: boolean) {
  const id = stampId();
  const email = `w8f-${label}-${id}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Devin Simpson');
  const groupId = `w8f-${label}-${id}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'private',
    members: [{ uid, role: 'foundingChampion' }],
  });
  const goalId = `w8fg-${label}-${id}`;
  if (withGoal) {
    await seedActiveGoal({
      goalId,
      groupId,
      ownerUid: uid,
      title: 'October Squat Challenge',
      target: 5000,
      unit: 'squats',
      total: 0,
    });
  }
  return { email, password, uid, groupId, goalId };
}

/** The ONE visible Community root. The stack may keep a hidden one mounted. */
function visibleCommunity(page: Page) {
  return page.locator('[data-testid="wsf-community"]:visible');
}

/** Sign in and land on the member's community through Home, as a member does. */
async function arrive(page: Page, email: string, password: string, groupId: string) {
  await signInVia(page, email, password);
  await page.goto('/');
  await page.waitForURL(new RegExp(`/community/${groupId}`), { timeout: 30_000 });
  await expect(visibleCommunity(page)).toHaveCount(1, { timeout: 40_000 });
}

/**
 * Plant a mark on the mounted instance. A remount throws it away; so does a
 * pushed second copy (the visible one would be unmarked).
 */
async function mark(page: Page): Promise<void> {
  await page.evaluate(() => {
    const roots = Array.from(document.querySelectorAll('[data-testid="wsf-community"]'));
    const shown = roots.find((el) => (el as HTMLElement).offsetParent !== null) as
      | HTMLElement
      | undefined;
    if (!shown) throw new Error('no visible community root to mark');
    shown.setAttribute('data-w8-mark', 'mounted');
  });
}

async function expectSameInstance(page: Page, label: string): Promise<void> {
  const state = await page.evaluate(() => {
    const roots = Array.from(document.querySelectorAll('[data-testid="wsf-community"]'));
    const shown = roots.filter((el) => (el as HTMLElement).offsetParent !== null);
    return {
      total: roots.length,
      visible: shown.length,
      marked: shown.length === 1 && shown[0]!.getAttribute('data-w8-mark') === 'mounted',
    };
  });
  expect(state.visible, `${label}: exactly one Community is visible`).toBe(1);
  expect(state.marked, `${label}: the visible Community is not the mounted one`).toBe(true);
  expect(state.total, `${label}: a second Community instance was mounted`).toBe(1);
}

/** The screen's own scroller offset: RN Web scrolls inside an element. */
async function scrollOf(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = Array.from(document.querySelectorAll('[data-testid="wsf-community"]')).find(
      (el) => (el as HTMLElement).offsetParent !== null,
    ) as HTMLElement | undefined;
    let el: HTMLElement | null = root ?? null;
    let best = 0;
    while (el) {
      best = Math.max(best, el.scrollTop);
      el = el.parentElement;
    }
    root?.querySelectorAll('*').forEach((c) => {
      best = Math.max(best, (c as HTMLElement).scrollTop);
    });
    return best;
  });
}

async function plantScroll(page: Page, y: number): Promise<number> {
  await page.evaluate((target) => {
    const root = Array.from(document.querySelectorAll('[data-testid="wsf-community"]')).find(
      (el) => (el as HTMLElement).offsetParent !== null,
    ) as HTMLElement | undefined;
    const candidates: HTMLElement[] = [];
    let el: HTMLElement | null = root ?? null;
    while (el) {
      candidates.push(el);
      el = el.parentElement;
    }
    root?.querySelectorAll('*').forEach((c) => candidates.push(c as HTMLElement));
    const scroller = candidates.find((c) => c.scrollHeight > c.clientHeight + target);
    if (scroller) scroller.scrollTop = target;
  }, y);
  await page.waitForTimeout(300);
  return scrollOf(page);
}

async function backToCommunity(page: Page, groupId: string): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await page.goBack();
    await page.waitForTimeout(400);
    if (new URL(page.url()).pathname === `/community/${groupId}`) return;
  }
  throw new Error(`history Back never returned to /community/${groupId} (at ${page.url()})`);
}

async function fillGoal(page: Page, title: string): Promise<void> {
  await expect(page.getByTestId('wsf-new-goal-form')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('wsf-new-goal-title').fill(title);
  await page.getByTestId('wsf-new-goal-target').fill('750');
  await page.getByTestId('wsf-new-goal-unit').fill('squats');
  await page.getByTestId('wsf-new-goal-submit').click();
}

test.describe('Community data is current on a genuine return', () => {
  test('a confirmed create, then Back: the mounted page shows the new goal', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const fx = await champion('create', false);
    const { context, page } = await phone(browser);
    try {
      await arrive(page, fx.email, fx.password, fx.groupId);
      await expect(page.getByTestId('wsf-community-no-goal')).toBeVisible({ timeout: 40_000 });
      await mark(page);

      await page.getByTestId('wsf-community-start-goal').click();
      await page.waitForURL(/\/goals\/new/, { timeout: 30_000 });
      await fillGoal(page, 'W8 freshness goal');
      await expect(page.getByTestId('wsf-new-goal-created')).toBeVisible({ timeout: 40_000 });

      await backToCommunity(page, fx.groupId);
      await expectSameInstance(page, 'after a confirmed create');
      await expect(visibleCommunity(page).getByTestId('wsf-community-goal-hero')).toContainText(
        'W8 freshness goal',
        { timeout: 30_000 },
      );
      await expect(visibleCommunity(page).getByTestId('wsf-community-no-goal')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('a lost create response, then Back: the goal the server made is shown, not "no goal yet"', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const fx = await champion('lost', false);
    const { context, page } = await phone(browser);
    try {
      await arrive(page, fx.email, fx.password, fx.groupId);
      await expect(page.getByTestId('wsf-community-no-goal')).toBeVisible({ timeout: 40_000 });
      await mark(page);

      // The server commits; the answer never reaches the page.
      await page.route('**/wsfCreateGoal', async (route: Route) => {
        await route.fetch();
        await route.abort('connectionreset');
      });
      await page.getByTestId('wsf-community-start-goal').click();
      await page.waitForURL(/\/goals\/new/, { timeout: 30_000 });
      await fillGoal(page, 'W8 lost-answer goal');
      await expect(page.getByTestId('wsf-new-goal-check-goals')).toBeVisible({ timeout: 40_000 });
      await page.unroute('**/wsfCreateGoal');

      await backToCommunity(page, fx.groupId);
      await expectSameInstance(page, 'after a lost create response');
      await expect(visibleCommunity(page).getByTestId('wsf-community-goal-hero')).toContainText(
        'W8 lost-answer goal',
        { timeout: 30_000 },
      );
      await expect(visibleCommunity(page).getByTestId('wsf-community-no-goal')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('a recorded contribution, then Back: presence and momentum include it, on the same instance', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const fx = await champion('move', true);
    const { context, page } = await phone(browser);
    try {
      await arrive(page, fx.email, fx.password, fx.groupId);
      const card = visibleCommunity(page).getByTestId('wsf-community-momentum-card');
      await expect(card).toBeVisible({ timeout: 40_000 });
      // A proven zero before anything happens today.
      await expect(page.getByTestId('wsf-community-contributors-today')).toHaveText(
        '0 people moved today',
        { timeout: 30_000 },
      );
      await expect(card.getByTestId('wsf-momentum-row')).toHaveCount(0);
      await expect(
        visibleCommunity(page).getByTestId(`wsf-community-goal-total-${fx.goalId}`).first(),
      ).toHaveText(/^0\s+of 5,000 squats$/);
      await mark(page);

      await page.getByTestId(`wsf-community-goal-link-${fx.goalId}`).click();
      await expect(page.getByTestId('wsf-contribute-move-screen')).toBeVisible({ timeout: 40_000 });
      await page.getByTestId('wsf-contribute-done').click();
      await page.getByTestId('wsf-contribute-entry').fill('20');
      await page.getByTestId('wsf-contribute-review').click();
      await page.getByTestId('wsf-contribute-submit').click();
      await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 40_000 });

      await backToCommunity(page, fx.groupId);
      await expectSameInstance(page, 'after a recorded contribution');
      await expect(page.getByTestId('wsf-community-contributors-today')).toHaveText(
        '1 person moved today',
        { timeout: 30_000 },
      );
      await expect(card.getByTestId('wsf-momentum-row').first()).toContainText('Devin Simpson');
      await expect(card.getByTestId('wsf-momentum-row').first()).toContainText('added 20 squats');
      // The SHARED total, not only the member's own part. The pulse is cached
      // server-side for 2 s, so a single read made the moment the member lands
      // back can return the pre-contribution total and never correct it (W1B
      // measured exactly that on #453: "You've added 20" beside an unchanged
      // total, still wrong at 15 s).
      await expect(
        visibleCommunity(page).getByTestId(`wsf-community-goal-total-${fx.goalId}`).first(),
      ).toHaveText(/^20\s+of 5,000 squats$/, { timeout: 15_000 });
    } finally {
      await context.close();
    }
  });

  /**
   * A FRESH MOUNT INSIDE THE CACHE WINDOW.
   *
   * The return cases above land on an instance that was already mounted. A
   * Community can also be mounted NEW right after a contribution — W7's X5 /
   * X5s journey (#434 5803764263): warm Goal Setup → contribution → "Back to
   * home" builds a fresh Community, whose first pulse read lands inside
   * `wsfGoalPulse`'s 2 s cache and shows the pre-contribution total; with no
   * return to trigger a second look, it stays wrong (0 against 20 at 15 s).
   *
   * The journey depends on other lanes' exits, so this case reproduces the
   * MECHANISM directly and deterministically: the fresh mount's own first
   * pulse request is held while the cache is warmed at the old total and the
   * confirmed total moves on the server; then the request goes through and is
   * served from the cache. The stale 0 is asserted FIRST, so a slow load that
   * missed the window fails here rather than passing vacuously.
   */
  test('a fresh mount inside the pulse cache window settles on the confirmed total', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const fx = await champion('fresh', true);
    const { context, page } = await phone(browser);
    try {
      await arrive(page, fx.email, fx.password, fx.groupId);
      const total = () =>
        visibleCommunity(page).getByTestId(`wsf-community-goal-total-${fx.goalId}`).first();
      await expect(total()).toHaveText(/^0\s+of 5,000 squats$/, { timeout: 40_000 });

      // The fresh mount's first pulse request: warm the server cache with the
      // old total (the read the contribution screen would have made), move
      // the confirmed total to 20, and only then let the request through.
      // Every later pulse request (the settle) passes untouched.
      let held = false;
      await page.route('**/wsfGoalPulse', async (route: Route) => {
        if (held) return route.fallback();
        held = true;
        const req = route.request();
        const warm = await fetch(req.url(), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: req.headers()['authorization'] ?? '',
          },
          body: req.postData() ?? '',
        });
        expect(warm.status, 'warming the pulse cache with the old total').toBe(200);
        await seedShards(fx.goalId, 20);
        await route.continue();
      });

      // A full navigation is a NEW mount: nothing of the previous instance
      // survives, and there is no "return" for the return path to notice.
      await page.goto(`/community/${fx.groupId}`);
      await expect(visibleCommunity(page)).toHaveCount(1, { timeout: 40_000 });
      // The window was hit: the fresh mount shows the cached, pre-move total.
      await expect(total()).toHaveText(/^0\s+of 5,000 squats$/, { timeout: 40_000 });
      expect(held, 'the fresh mount issued its first pulse read').toBe(true);
      // And is corrected by the first-focus settle, just past the cache window.
      await expect(total()).toHaveText(/^20\s+of 5,000 squats$/, { timeout: 10_000 });
    } finally {
      await context.close();
    }
  });

  /**
   * A SLOW FIRST READ MUST NOT LEAVE THE STALE TOTAL IN CHARGE (Director
   * #462 5804115569, boundary 1).
   *
   * The fresh mount's first pulse read is answered from the warm cache (0)
   * and its answer is HELD past the 2.6 s settle. The settle must fill the
   * still-empty slot with the confirmed 20, and the late-landing 0 — issued
   * earlier — must not put the older answer back.
   */
  test('a first read that lands after the settle cannot re-stale the confirmed total', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const fx = await champion('slow', true);
    const { context, page } = await phone(browser);
    try {
      // Learn the page's own callable URL and bearer from a real request.
      let pulseUrl = '';
      let pulseAuth = '';
      let pulseBody = '';
      await page.route('**/wsfGoalPulse', async (route: Route) => {
        const req = route.request();
        pulseUrl = req.url();
        pulseAuth = req.headers()['authorization'] ?? '';
        pulseBody = req.postData() ?? '';
        await route.continue();
      });
      await arrive(page, fx.email, fx.password, fx.groupId);
      const total = () =>
        visibleCommunity(page).getByTestId(`wsf-community-goal-total-${fx.goalId}`).first();
      await expect(total()).toHaveText(/^0\s+of 5,000 squats$/, { timeout: 40_000 });
      expect(pulseUrl, 'the page issued a pulse read').not.toBe('');
      await page.unroute('**/wsfGoalPulse');

      // Warm the cache at 0 NOW, move the confirmed total, then mount fresh:
      // the mount's first read (well inside 2 s) is served the 0; the settle
      // (2.6 s after focus) is issued after the window has closed.
      const warm = await fetch(pulseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: pulseAuth },
        body: pulseBody,
      });
      expect(warm.status, 'warming the pulse cache').toBe(200);
      await seedShards(fx.goalId, 20);

      let heldStale: number | null = null;
      let released = false;
      await page.route('**/wsfGoalPulse', async (route: Route) => {
        if (heldStale !== null) return route.fallback();
        // Let the server answer (from the cache) at once, but deliver that
        // answer to the page only after the settle has had its turn.
        const response = await route.fetch();
        const json = (await response.json()) as { result?: { sharedTotal?: number } };
        heldStale = json.result?.sharedTotal ?? -1;
        await new Promise((r) => setTimeout(r, 4_500));
        released = true;
        await route.fulfill({ response });
      });
      await page.goto(`/community/${fx.groupId}`);
      await expect(visibleCommunity(page)).toHaveCount(1, { timeout: 40_000 });
      await expect.poll(() => heldStale, { timeout: 30_000 }).not.toBeNull();
      expect(heldStale, 'the held first read was served the pre-move total').toBe(0);
      // The settle fills the slot with the confirmed total before the first
      // read is delivered...
      await expect(total()).toHaveText(/^20\s+of 5,000 squats$/, { timeout: 10_000 });
      // ...and the late 0, issued earlier, does not overwrite it.
      await expect.poll(() => released, { timeout: 15_000 }).toBe(true);
      await page.waitForTimeout(1_500);
      await expect(total()).toHaveText(/^20\s+of 5,000 squats$/);
    } finally {
      await context.close();
    }
  });

  /**
   * A SETTLE TIMER THAT FIRES BEFORE THE GOAL LIST IS READY MUST NOT CONSUME
   * THE ONLY SETTLE (Director #462 5805389890, the readiness boundary).
   *
   * The fresh mount's goal-list read is HELD past the 2.6 s timer, so the
   * timer fires with no goals to read. Just before the list is released the
   * cache is warmed at 0 and the confirmed total moves to 20: the ordinary
   * read the landing triggers is served the stale 0. The settle owed to that
   * timer must still be issued, one window after the landing, and confirm 20.
   * The stale 0 is asserted FIRST, so a list that landed early fails here
   * rather than passing vacuously.
   */
  test('a settle timer that fires before the goal list is ready still settles once it lands', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const fx = await champion('ready', true);
    const { context, page } = await phone(browser);
    try {
      // Learn the page's own pulse URL and bearer from a real request.
      let pulseUrl = '';
      let pulseAuth = '';
      let pulseBody = '';
      await page.route('**/wsfGoalPulse', async (route: Route) => {
        const req = route.request();
        pulseUrl = req.url();
        pulseAuth = req.headers()['authorization'] ?? '';
        pulseBody = req.postData() ?? '';
        await route.continue();
      });
      await arrive(page, fx.email, fx.password, fx.groupId);
      const total = () =>
        visibleCommunity(page).getByTestId(`wsf-community-goal-total-${fx.goalId}`).first();
      await expect(total()).toHaveText(/^0\s+of 5,000 squats$/, { timeout: 40_000 });
      expect(pulseUrl, 'the page issued a pulse read').not.toBe('');
      await page.unroute('**/wsfGoalPulse');

      // Hold the fresh mount's FIRST goal-list answer well past the 2.6 s
      // timer. Just before releasing it, warm the pulse cache at 0 and move
      // the confirmed total: the ordinary read the landing triggers is served
      // the 0. Every later list read passes untouched.
      let listHeld = false;
      let listReleasedAt = 0;
      await page.route('**/wsfListGoals', async (route: Route) => {
        if (listHeld) return route.fallback();
        listHeld = true;
        const response = await route.fetch();
        await new Promise((r) => setTimeout(r, 3_400));
        const warm = await fetch(pulseUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: pulseAuth },
          body: pulseBody,
        });
        expect(warm.status, 'warming the pulse cache with the old total').toBe(200);
        await seedShards(fx.goalId, 20);
        listReleasedAt = Date.now();
        await route.fulfill({ response });
      });
      await page.goto(`/community/${fx.groupId}`);
      await expect(visibleCommunity(page)).toHaveCount(1, { timeout: 40_000 });
      await expect.poll(() => listReleasedAt, { timeout: 30_000 }).not.toBe(0);
      // The window was hit: the landing's read shows the cached, pre-move 0.
      await expect(total()).toHaveText(/^0\s+of 5,000 squats$/, { timeout: 10_000 });
      // The settle owed to the early timer is still issued once the list has
      // landed — one window later — and confirms the moved total.
      await expect(total()).toHaveText(/^20\s+of 5,000 squats$/, { timeout: 10_000 });
      expect(
        Date.now() - listReleasedAt,
        'the settle came after the landing, not with it',
      ).toBeGreaterThan(2_000);
    } finally {
      await context.close();
    }
  });

  /**
   * THE SETTLE BELONGS TO THE ACCOUNT IT WAS SCHEDULED FOR (Director #462
   * 5804115569, boundary 2).
   *
   * Account A's settle is in flight (its own-part answer is held). A signs out
   * in-app and B signs in — the Community screen stays mounted through both,
   * so nothing unmounts the pending settle — and B's figures load. Then A's
   * answer is released. B's own part must stay B's, on every Community node
   * in the document (a second instance the switch may have stacked included).
   */
  test('a settle from the previous account cannot overwrite the next account’s own part', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const fx = await champion('acct', true);
    const b = await newMemberOf(fx.groupId, 'other');
    await seedOwnCredit(fx.goalId, fx.uid, 120);
    await seedOwnCredit(fx.goalId, b.uid, 45);
    const { context, page } = await phone(browser);
    try {
      await arrive(page, fx.email, fx.password, fx.groupId);
      const yourPart = () => page.getByTestId(`wsf-community-your-part-${fx.goalId}`);
      await expect(yourPart().first()).toContainText('120', { timeout: 40_000 });

      // Hold A's NEXT own-part read: the first is the ordinary mount read
      // (already landed), so the next one is the settle's.
      let held: Route | null = null;
      let heldResponse: Awaited<ReturnType<Route['fetch']>> | null = null;
      await page.route('**/wsfMyContribution', async (route: Route) => {
        if (held) return route.fallback();
        held = route;
        heldResponse = await route.fetch();
      });
      await expect.poll(() => held !== null, { timeout: 15_000 }).toBe(true);
      // The handler stays registered: every later own-part read (B's mount
      // read, B's settle) falls through; only A's held one waits.

      // A signs out in-app; the screen stays mounted and offers Sign in.
      await openShellMenu(page);
      await page.getByTestId('wsf-member-topbar-menu-signout').last().click();
      await expect(page.getByTestId('wsf-community-signed-out').last()).toBeVisible({
        timeout: 30_000,
      });
      await page.getByTestId('wsf-community-signin').last().click();
      await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('wsf-signin-email').fill(b.email);
      await page.getByTestId('wsf-signin-password').fill(b.password);
      await page.getByTestId('wsf-signin-submit').click();
      await page.waitForURL(new RegExp(`/community/${fx.groupId}`), { timeout: 40_000 });
      await expect(visibleCommunity(page).getByTestId(`wsf-community-your-part-${fx.goalId}`)).toContainText(
        '45',
        { timeout: 40_000 },
      );

      // Release A's answer now that B's figure is on screen.
      await held!.fulfill({ response: heldResponse! });
      await page.waitForTimeout(2_000);
      await expect(
        visibleCommunity(page).getByTestId(`wsf-community-your-part-${fx.goalId}`),
      ).toContainText('45');
      expect(
        await yourPart().filter({ hasText: '120' }).count(),
        "the previous account's own part appears on a Community node",
      ).toBe(0);
    } finally {
      await context.close();
    }
  });

  test('the return keeps the scroll; reselecting the active tab reads nothing', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const fx = await champion('still', true);
    const { context, page } = await phone(browser);
    try {
      await arrive(page, fx.email, fx.password, fx.groupId);
      await expect(page.getByTestId('wsf-community-momentum-card')).toBeVisible({
        timeout: 40_000,
      });
      // Past the first-focus settle (2.6 s after the mount) before listening,
      // so what is recorded below can only come from the reselect itself.
      await page.waitForTimeout(3500);
      await mark(page);

      const calls: string[] = [];
      page.on('request', (r) => {
        const m =
          /\/(wsfListGoals|wsfCommunityActivity|wsfCommunityMembers|wsfGoalPulse|wsfMyContribution)\b/.exec(
            r.url(),
          );
        if (m) calls.push(m[1]!);
      });

      // RESELECT: the tab you are on is a no-op, and that includes the data.
      await page.getByTestId('wsf-member-tab-home').last().click();
      await page.waitForTimeout(1500);
      expect(calls, 'reselecting the active tab re-read community data').toEqual([]);
      await expectSameInstance(page, 'after reselect');

      // A GENUINE RETURN: leave for Progress, come back. The scroll is kept and
      // the data is re-read without blanking the page.
      const planted = await plantScroll(page, 220);
      expect(planted, 'the Community screen has somewhere to scroll to').toBeGreaterThan(40);
      await page.getByTestId('wsf-member-tab-activity').last().click();
      await expect(page.getByTestId('wsf-activity-title')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('wsf-member-tab-home').last().click();
      await expect(visibleCommunity(page)).toHaveCount(1, { timeout: 30_000 });
      await expect.poll(() => calls.includes('wsfListGoals'), { timeout: 20_000 }).toBe(true);
      await expect.poll(() => calls.includes('wsfCommunityActivity'), { timeout: 20_000 }).toBe(true);
      await expectSameInstance(page, 'after a tab round trip');
      // Never back to a loading skeleton over data it already had.
      await expect(page.getByTestId('wsf-community-goals-loading')).toHaveCount(0);
      await expect(page.getByTestId('wsf-community-goal-hero')).toBeVisible();
      const after = await scrollOf(page);
      expect(Math.abs(after - planted), 'the return lost the Community scroll').toBeLessThanOrEqual(2);
    } finally {
      await context.close();
    }
  });
});
