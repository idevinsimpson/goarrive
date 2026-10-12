import { expect, test, type Page } from '@playwright/test';

import {
  firestoreWrite,
  seedActiveGoal,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
  tsField,
} from './helpers/mobile';

/**
 * W9 — APP-FEEL-PARITY-1, CHECKPOINT 2: WARM NAVIGATION (L0 #477 `5834095137`
 * item 2; ACK #477 `5837801189`).
 *
 * Measured on development `91392f9d` before this checkpoint:
 *   · the top bar's wordmark ("go Home") pushed Home's index, whose redirect
 *     built a SECOND community screen through the loading branch: 16
 *     callables, the loading screen, two instances;
 *   · the first visit to the Community tab after Home showed the whole-page
 *     skeleton for ~2.5 s while re-reading what Home had just read;
 *   · re-entering a community already opened showed the loading screen again.
 *
 * The contract:
 *   · the wordmark selects Home as it stands -- one instance, no loading, the
 *     member's scroll kept -- and on Home it is a no-op, by pointer or Enter;
 *   · the Community tab's first visit opens on the rows already known;
 *   · a community re-entered opens on how it last settled, then refreshes;
 *   · nothing of one account is ever shown to the next, and a lost membership
 *     is cleared as soon as it is learned.
 *
 * Everything seeded here is SYNTHETIC. Chromium, local emulators.
 */

const PASSWORD = 'Sup3rSecret!23';
const PHONE = { width: 390, height: 844 };
const SHORT = { width: 390, height: 640 };

type Fx = { email: string; uid: string; a: string; b: string; goalA: string; stamp: string };

async function seed(tag: string): Promise<Fx> {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-w9-afp2-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Alex Rivera');
  const a = `w9afp2a-${stamp}`;
  const b = `w9afp2b-${stamp}`;
  await seedCommunity({ groupId: a, displayName: 'Alpharetta Morning Movers', joinPolicy: 'private', members: [{ uid, role: 'member' }] });
  await seedCommunity({ groupId: b, displayName: 'Roswell Lunch Walkers', joinPolicy: 'private', members: [{ uid, role: 'member' }] });
  const goalA = `w9afp2g-${stamp}`;
  await seedActiveGoal({
    goalId: goalA,
    groupId: a,
    ownerUid: uid,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total: 1847,
    endsAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
  });
  return { email, uid, a, b, goalA, stamp };
}

function measure(label: string, value: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`MEASURE ${label}: ${JSON.stringify(value)}`);
  test.info().annotations.push({ type: 'measure', description: `${label}: ${JSON.stringify(value)}` });
}

/** Records every loading surface that is ever painted, and callables by name. */
async function watch(page: Page): Promise<() => Promise<{ loading: string[]; calls: Record<string, number> }>> {
  const calls: Record<string, number> = {};
  const onReq = (r: { url(): string; method(): string }) => {
    const m = r.url().match(/\/(wsf[A-Za-z]+)$/);
    if (m && r.method() === 'POST') calls[m[1]!] = (calls[m[1]!] ?? 0) + 1;
  };
  page.on('request', onReq);
  await page.evaluate(() => {
    const w = window as unknown as { __afp2: string[] };
    w.__afp2 = [];
    const seen = () => {
      for (const id of ['wsf-community-loading', 'wsf-community-index-loading']) {
        const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
        if (el && el.getClientRects().length > 0 && !w.__afp2.includes(id)) w.__afp2.push(id);
      }
    };
    new MutationObserver(seen).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  return async () => {
    page.off('request', onReq);
    const loading = await page.evaluate(() => (window as unknown as { __afp2: string[] }).__afp2);
    return { loading, calls: { ...calls } };
  };
}

async function openA(page: Page, fx: Fx): Promise<void> {
  await page.goto(`/community/${fx.a}`);
  await expect(page.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 60_000 });
}

async function communityInstances(page: Page): Promise<number> {
  return page.locator('[data-testid="wsf-community"]').count();
}

async function currentTab(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('[data-testid^="wsf-member-tab-"][data-current="true"]')).find(
      (n) => (n as HTMLElement).getClientRects().length > 0,
    );
    return el?.getAttribute('data-testid') ?? null;
  });
}

async function scrollOf(page: Page, testId: string): Promise<number | null> {
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
  await page.waitForTimeout(400);
  return scrollOf(page, testId);
}

test.describe('APP-FEEL-PARITY-1 cp2 · the wordmark selects Home as it stands', () => {
  test.use({ viewport: SHORT, deviceScaleFactor: 1 });

  test('from the Community tab: Home comes back as it was -- one instance, no loading, scroll kept', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('m');
    await signInVia(page, fx.email, PASSWORD);
    await openA(page, fx);
    const planted = await plantScroll(page, 'wsf-community', 120);
    expect(planted ?? 0, 'the planted scroll is real').toBeGreaterThan(40);
    await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="wsf-community"]'))
        .find((n) => (n as HTMLElement).getClientRects().length > 0)
        ?.setAttribute('data-afp2-marker', 'kept'),
    );
    await page.getByTestId('wsf-member-tab-community').last().click();
    await expect(page.locator('[data-testid="wsf-community-index-rows"]:visible')).toBeVisible({ timeout: 40_000 });

    const done = await watch(page);
    await page.getByTestId('wsf-member-topbar-wordmark-home').last().click();
    await expect(page.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(1_200);
    const seen = await done();
    const after = {
      ...seen,
      instances: await communityInstances(page),
      tab: await currentTab(page),
      scroll: await scrollOf(page, 'wsf-community'),
      sameInstance: await page.locator('[data-afp2-marker="kept"]').count(),
    };
    measure('wordmark from Community', after);
    expect(after.tab).toBe('wsf-member-tab-home');
    expect(after.loading, 'no loading screen').toEqual([]);
    expect(after.instances, 'one community instance').toBe(1);
    expect(after.sameInstance, 'the same mounted Home').toBe(1);
    expect(after.scroll, 'Home kept its scroll').toBe(planted);
    expect(after.calls.wsfMyCommunities ?? 0, 'no re-resolution of the member’s communities').toBe(0);
  });

  test('on Home, by pointer and by Enter: a no-op', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('n');
    await signInVia(page, fx.email, PASSWORD);
    await openA(page, fx);
    const done = await watch(page);
    await page.getByTestId('wsf-member-topbar-wordmark-home').last().click();
    await page.waitForTimeout(800);
    const home = page.getByTestId('wsf-member-topbar-wordmark-home').last();
    await home.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1_200);
    const seen = await done();
    const after = { ...seen, instances: await communityInstances(page), path: new URL(page.url()).pathname };
    measure('wordmark on Home', after);
    expect(after.loading).toEqual([]);
    expect(after.instances).toBe(1);
    expect(after.path).toBe(`/community/${fx.a}`);
    expect(after.calls.wsfMyCommunities ?? 0).toBe(0);
  });

  test('from Progress by Enter: Home as it stands', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('e');
    await signInVia(page, fx.email, PASSWORD);
    await openA(page, fx);
    await page.getByTestId('wsf-member-tab-activity').last().click();
    await expect.poll(() => currentTab(page), { timeout: 20_000 }).toBe('wsf-member-tab-activity');
    const done = await watch(page);
    const home = page.getByTestId('wsf-member-topbar-wordmark-home').last();
    await home.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => currentTab(page), { timeout: 20_000 }).toBe('wsf-member-tab-home');
    await page.waitForTimeout(1_000);
    const seen = await done();
    measure('wordmark Enter from Progress', { ...seen, instances: await communityInstances(page) });
    expect(seen.loading).toEqual([]);
    expect(await communityInstances(page)).toBe(1);
  });
});

test.describe('APP-FEEL-PARITY-1 cp2 · warm first render', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 1 });

  test('the Community tab, first visit after Home: the known rows at once, no skeleton, then the fresh answer', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('c');
    await signInVia(page, fx.email, PASSWORD);
    await openA(page, fx);
    const done = await watch(page);
    const t0 = Date.now();
    await page.getByTestId('wsf-member-tab-community').last().click();
    await expect(page.locator('[data-testid="wsf-community-index-rows"]:visible')).toBeVisible({ timeout: 40_000 });
    const msToRows = Date.now() - t0;
    await expect(page.locator(`[data-testid="wsf-community-index-row-${fx.b}"]:visible`)).toContainText('No goal running', { timeout: 40_000 });
    const seen = await done();
    measure('Community tab first visit', { ...seen, msToRows });
    expect(seen.loading, 'no whole-page skeleton').toEqual([]);
    expect(seen.calls.wsfMyCommunities ?? 0, 'the fresh read still runs').toBeGreaterThanOrEqual(1);
  });

  test('MOVE with no open goal: “Go to your community” lands on the mounted community -- one instance, no loading, the sheet gone', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('r');
    await signInVia(page, fx.email, PASSWORD);
    // B has no open goal, so MOVE answers "Nothing is running right now" and
    // offers the community.
    await page.goto(`/community/${fx.b}`);
    await expect(page.locator('[data-testid="wsf-community-name"]:visible')).toHaveText('Roswell Lunch Walkers', { timeout: 60_000 });
    await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="wsf-community"]'))
        .find((n) => (n as HTMLElement).getClientRects().length > 0)
        ?.setAttribute('data-afp2-marker', 'kept'),
    );
    await page.getByTestId('wsf-member-tab-move').last().click();
    await expect(page.locator('[data-testid="wsf-move-no-goal"]:visible')).toBeVisible({ timeout: 40_000 });
    const done = await watch(page);
    const go = page.locator('[data-testid="wsf-move-no-goal-community"]:visible');
    await go.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('wsf-move-sheet')).toHaveCount(0, { timeout: 20_000 });
    await page.waitForTimeout(1_500);
    const seen = await done();
    const after = {
      ...seen,
      instances: await communityInstances(page),
      sameInstance: await page.locator('[data-afp2-marker="kept"]').count(),
      tab: await currentTab(page),
      path: new URL(page.url()).pathname,
    };
    measure('MOVE no goal → Go to your community', after);
    expect(after.loading, 'no loading screen').toEqual([]);
    expect(after.instances, 'one community instance').toBe(1);
    expect(after.sameInstance, 'the mounted community').toBe(1);
    expect(after.tab).toBe('wsf-member-tab-home');
    expect(after.path).toBe(`/community/${fx.b}`);
  });

  test('MOVE could not read: “Go Home” selects Home as it stands (labelled injection: the goal read fails)', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('g');
    await signInVia(page, fx.email, PASSWORD);
    // PERF-MOBILE-1 (#494): MOVE now decides at once from goals this account
    // already knows, and reads them only when it does not. So the goal read
    // is made to fail from before the community loads: nothing knows the
    // goals, and MOVE must read them. The assertions below are unchanged.
    await page.route('**/wsfListGoals', (route) => route.abort('failed'));
    await openA(page, fx);
    await page.getByTestId('wsf-member-tab-move').last().click();
    await expect(page.locator('[data-testid="wsf-move-error-home"]:visible')).toBeVisible({ timeout: 40_000 });
    await page.unroute('**/wsfListGoals');
    const done = await watch(page);
    await page.locator('[data-testid="wsf-move-error-home"]:visible').click();
    await expect(page.getByTestId('wsf-move-sheet')).toHaveCount(0, { timeout: 20_000 });
    await page.waitForTimeout(1_500);
    const seen = await done();
    const after = { ...seen, instances: await communityInstances(page), tab: await currentTab(page) };
    measure('MOVE error → Go Home', after);
    expect(after.loading).toEqual([]);
    expect(after.instances).toBe(1);
    expect(after.tab).toBe('wsf-member-tab-home');
  });
});

test.describe('APP-FEEL-PARITY-1 cp2 · nothing outlives the account or the membership', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 1 });

  test('sign out, then another account signs in on the same page: nothing of the first is ever shown', async ({ page }) => {
    test.setTimeout(300_000);
    const fx = await seed('s');
    const other = `wsf-w9-afp2-other-${fx.stamp}@example.com`;
    const otherUid = await seedVerifiedUser(other, PASSWORD);
    await seedProfile(otherUid, 'Sam Other');
    await seedCommunity({ groupId: `w9afp2o-${fx.stamp}`, displayName: 'Marietta Evening Walkers', joinPolicy: 'private', members: [{ uid: otherUid, role: 'member' }] });

    await signInVia(page, fx.email, PASSWORD);
    await openA(page, fx);
    await page.getByTestId('wsf-member-tab-community').last().click();
    await expect(page.locator('[data-testid="wsf-community-index-rows"]:visible')).toBeVisible({ timeout: 40_000 });
    await page.getByTestId('wsf-member-tab-home').last().click();

    await page.getByTestId('wsf-member-topbar-menu-button').last().click();
    await page.getByTestId('wsf-member-topbar-menu-signout').last().click();
    await expect(page.getByTestId('wsf-community-signed-out').last()).toBeVisible({ timeout: 30_000 });
    // From here on, the first account's communities must never be painted.
    await page.evaluate(() => {
      const w = window as unknown as { __leak: string[] };
      w.__leak = [];
      const names = ['Alpharetta Morning Movers', 'Roswell Lunch Walkers'];
      new MutationObserver(() => {
        const text = document.body.innerText;
        for (const n of names) if (text.includes(n) && !w.__leak.includes(n)) w.__leak.push(n);
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await page.getByTestId('wsf-community-signin').last().click();
    await page.getByTestId('wsf-signin-email').fill(other);
    await page.getByTestId('wsf-signin-password').fill(PASSWORD);
    await page.getByTestId('wsf-signin-submit').click();
    await page.waitForTimeout(3_000);
    await page.getByTestId('wsf-member-tab-community').last().click();
    await expect(page.locator('[data-testid="wsf-community-index-rows"]:visible')).toContainText('Marietta Evening Walkers', { timeout: 40_000 });
    await page.waitForTimeout(1_000);
    const leak = await page.evaluate(() => (window as unknown as { __leak: string[] }).__leak);
    measure('names of the first account painted for the second', leak);
    expect(leak).toEqual([]);
  });

  test('a membership lost while away: the list stops showing it as soon as the fresh read says so; a direct entry lands on the refusal', async ({ page }) => {
    test.setTimeout(300_000);
    const fx = await seed('l');
    await signInVia(page, fx.email, PASSWORD);
    await openA(page, fx);
    await page.getByTestId('wsf-member-tab-community').last().click();
    await expect(page.locator(`[data-testid="wsf-community-index-row-${fx.b}"]:visible`)).toBeVisible({ timeout: 40_000 });
    await page.locator(`[data-testid="wsf-community-index-row-${fx.b}"]:visible`).click();
    await expect(page.locator('[data-testid="wsf-community-name"]:visible')).toHaveText('Roswell Lunch Walkers', { timeout: 40_000 });

    // A is left behind the member's back (the membership document, as the
    // server leaves it on removal).
    const now = new Date();
    await firestoreWrite(`wsfMemberships/${fx.a}_${fx.uid}`, {
      groupId: { stringValue: fx.a },
      userId: { stringValue: fx.uid },
      role: { stringValue: 'member' },
      membershipStatus: { stringValue: 'removed' },
      createdAt: tsField(now),
      updatedAt: tsField(now),
    });

    // The Community tab is mounted from before; its return refresh is the
    // fresh read. Once that answers, A is gone from the list.
    await page.getByTestId('wsf-member-tab-home').last().click();
    await page.getByTestId('wsf-member-tab-community').last().click();
    await page.getByTestId('wsf-member-tab-home').last().click();
    await page.goto(`/community/${fx.b}`);
    await expect(page.locator('[data-testid="wsf-community-name"]:visible')).toHaveText('Roswell Lunch Walkers', { timeout: 60_000 });
    await page.getByTestId('wsf-member-tab-community').last().click();
    await expect(page.locator('[data-testid="wsf-community-index-rows"]:visible')).toBeVisible({ timeout: 40_000 });
    await expect(page.locator(`[data-testid="wsf-community-index-row-${fx.a}"]`)).toHaveCount(0, { timeout: 20_000 });

    await page.goto(`/community/${fx.a}`);
    await expect(page.getByTestId('wsf-community-not-member').last()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-testid="wsf-community-name"]:visible')).toHaveCount(0);
  });
});
