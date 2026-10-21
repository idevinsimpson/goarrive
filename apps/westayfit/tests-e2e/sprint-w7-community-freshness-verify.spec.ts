import { randomBytes } from 'node:crypto';

import { expect, test, type Page, type Route } from '@playwright/test';

import {
  FIRESTORE_EMULATOR,
  IPHONE_UA,
  PROJECT_ID,
  seedActiveGoal,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * W7 — INDEPENDENT CHECK of W8's Community freshness delta (`eff65b0`, #455),
 * pre-staged for the combined candidate (L0 `5800787974` §2, `5801193038`).
 *
 * W8's own spec proves its four cases. This file measures the same promises
 * with different instruments, and the places W8's instruments cannot see:
 *
 *   F1  RESELECT READS NOTHING — every `wsf*` callable is counted, for longer
 *       than the 2.6 s settle window. W8's reselect test counts three
 *       callables only (wsfListGoals, wsfCommunityActivity,
 *       wsfCommunityMembers), so a pulse or own-contribution read on reselect
 *       would pass it.
 *   F2  A GENUINE RETURN NEVER FLASHES A LOADING STATE — a MutationObserver
 *       records every loading testID that appears inside Community from the
 *       moment the member leaves until well after the return. W8 checks the
 *       goal-list skeleton once, after the return has settled, so a transient
 *       skeleton would pass it. The return must also re-read (wsfListGoals is
 *       called), so "nothing flashed" cannot be "nothing happened".
 *   F3  THE MEMBER'S OWN WAY BACK after a lost goal create: the in-app
 *       "Check community goals" link, not history Back (W8's path). The page
 *       the member lands on shows the goal the server made, and the server
 *       holds exactly one.
 *   F4  A FAILED RETURN READ LEAVES THE PAGE STANDING — W8's comment promises
 *       it ("a failed one leaves what is on screen standing and re-reads
 *       progress alone"); its spec does not test it. wsfListGoals is faulted
 *       for the return only.
 *
 * MEASURED MATRIX. "Preview" is W7's local composition f2f901a ⊕ W9 a87cd3b ⊕
 * W8 eff65b0 ⊕ W4 5c28e45 (6c98f485, never pushed), run 2×.
 *
 *   test                                     f2f901a (no W8)                  preview (with W8)
 *   F1 reselect reads no callable              PASS (PRESERVED guard)           PASS ×2
 *   F2 return: no loading flash, re-read       FAIL: no list re-read; progress  PASS ×2
 *                                              skeletons flashed (first run)
 *   F3 in-app exit after a lost create         PASS (PRESERVED: the link pushes  PASS ×2
 *                                              a fresh 2nd Community instance)
 *   F4 failed return read leaves the page      FAIL at non-vacuity (no re-read)  PASS ×2
 *
 * Every counter and fault starts at the moment of the return: Progress calls
 * wsfListGoals with Community's own arguments, and an earlier revision of this
 * file counted Progress's read as Community's (caught on f2f901a, fixed).
 *
 * Verification only: no product file and no W8 test is edited.
 */

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: IPHONE_UA,
  locale: 'en-US',
  timezoneId: 'America/New_York',
});

const OWNER = { authorization: 'Bearer owner', 'content-type': 'application/json' };
/** W8's PULSE_SETTLE_MS is 2 600; every window below is longer than that. */
const PAST_SETTLE_MS = 4_000;

type Fixture = { email: string; password: string; uid: string; groupId: string; goalId: string };

async function champion(label: string, withGoal: boolean): Promise<Fixture> {
  const id = stampId();
  const email = `w7fr-${label}-${id}@example.com`;
  const password = `Aa1!${randomBytes(6).toString('hex')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Robin Vale');
  const groupId = `w7fr-${label}-${id}`;
  await seedCommunity({
    groupId,
    displayName: 'W7 Freshness Movers',
    joinPolicy: 'private',
    members: [{ uid, role: 'foundingChampion' }],
  });
  const goalId = `w7frg-${label}-${id}`;
  if (withGoal) {
    await seedActiveGoal({ goalId, groupId, ownerUid: uid, title: 'W7 Seeded Goal', target: 5000, unit: 'squats', total: 0 });
  }
  return { email, password, uid, groupId, goalId };
}

/** The goals the SERVER holds for a community, filtered on the server. */
async function goalsOf(groupId: string): Promise<string[]> {
  const res = await fetch(`${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`, {
    method: 'POST',
    headers: OWNER,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'wsfGoals' }],
        where: { fieldFilter: { field: { fieldPath: 'communityGroupId' }, op: 'EQUAL', value: { stringValue: groupId } } },
      },
    }),
  });
  if (!res.ok) throw new Error(`runQuery refused: ${res.status}`);
  const rows = (await res.json()) as Array<{ document?: { fields?: { title?: { stringValue?: string } } } }>;
  return rows.filter((r) => r.document).map((r) => r.document!.fields?.title?.stringValue ?? '');
}

/** Every callable the page asks for, by name, from the moment this is called. */
function countCallables(page: Page): string[] {
  const calls: string[] = [];
  page.on('request', (r) => {
    const m = /\/us-central1\/(wsf[A-Za-z]+)/.exec(r.url());
    if (m && r.method() === 'POST') calls.push(m[1]!);
  });
  return calls;
}

function visibleCommunity(page: Page) {
  return page.locator('[data-testid="wsf-community"]:visible');
}

async function arrive(page: Page, fx: Fixture): Promise<void> {
  await signInVia(page, fx.email, fx.password);
  await page.goto('/');
  await page.waitForURL(new RegExp(`/community/${fx.groupId}`), { timeout: 30_000 });
  await expect(visibleCommunity(page)).toHaveCount(1, { timeout: 40_000 });
}

/** Mark the visible Community root. A remount, or a pushed copy, is unmarked. */
async function mark(page: Page): Promise<void> {
  await page.evaluate(() => {
    const shown = Array.from(document.querySelectorAll('[data-testid="wsf-community"]')).find(
      (el) => (el as HTMLElement).offsetParent !== null,
    ) as HTMLElement | undefined;
    if (!shown) throw new Error('no visible Community root');
    shown.setAttribute('data-w7-mark', 'kept');
  });
}

async function instance(page: Page): Promise<{ roots: number; visible: number; marked: boolean }> {
  return page.evaluate(() => {
    const roots = Array.from(document.querySelectorAll('[data-testid="wsf-community"]'));
    const shown = roots.filter((el) => (el as HTMLElement).offsetParent !== null);
    return { roots: roots.length, visible: shown.length, marked: shown.length === 1 && shown[0]!.getAttribute('data-w7-mark') === 'kept' };
  });
}

/**
 * Record every loading testID that appears inside any Community root, from now
 * on. Attribute and child-list changes both count, so a skeleton that is shown
 * for one frame is caught.
 */
async function watchLoading(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __w7loading: string[]; __w7obs?: MutationObserver };
    w.__w7loading = [];
    const scan = (n: Node) => {
      if (!(n instanceof HTMLElement)) return;
      const hits = [n, ...Array.from(n.querySelectorAll('[data-testid]'))] as HTMLElement[];
      for (const h of hits) {
        const id = h.dataset?.testid ?? '';
        if (/loading/.test(id) && h.closest('[data-testid="wsf-community"]')) w.__w7loading.push(id);
      }
    };
    w.__w7obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'childList') m.addedNodes.forEach(scan);
        else scan(m.target);
      }
    });
    w.__w7obs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-testid'] });
  });
}

async function loadingSeen(page: Page): Promise<string[]> {
  return page.evaluate(() => [...new Set((window as unknown as { __w7loading: string[] }).__w7loading)]);
}

/** The Community screen's own scroller, found from the visible root outwards and inwards. */
async function plantScroll(page: Page, y: number): Promise<number> {
  return page.evaluate((target) => {
    const root = Array.from(document.querySelectorAll('[data-testid="wsf-community"]')).find(
      (el) => (el as HTMLElement).offsetParent !== null,
    ) as HTMLElement | undefined;
    if (!root) return -1;
    const chain: HTMLElement[] = [];
    for (let el: HTMLElement | null = root; el; el = el.parentElement) chain.push(el);
    root.querySelectorAll('*').forEach((c) => chain.push(c as HTMLElement));
    const sc = chain.find((c) => c.scrollHeight > c.clientHeight + target);
    if (!sc) return -1;
    sc.setAttribute('data-w7-scroller', '1');
    sc.scrollTop = target;
    return sc.scrollTop;
  }, y);
}

async function scrollNow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const sc = document.querySelector('[data-w7-scroller="1"]') as HTMLElement | null;
    return sc ? sc.scrollTop : -1;
  });
}

/**
 * Leave Community for Progress and let Progress finish its own reads. Progress
 * calls wsfListGoals with the same arguments Community does, so every counter
 * and fault below starts only AFTER this, at the moment of the return.
 */
async function leaveForProgress(page: Page): Promise<void> {
  await page.getByTestId('wsf-member-tab-activity').last().click();
  await expect(page.getByTestId('wsf-activity-title')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(PAST_SETTLE_MS);
}

/** Come back to Community by the tab bar: a genuine return. */
async function returnByTab(page: Page): Promise<void> {
  await page.getByTestId('wsf-member-tab-home').last().click();
  await expect(visibleCommunity(page)).toHaveCount(1, { timeout: 30_000 });
}

test.describe('W8 freshness, independent instruments', () => {
  test('F1 reselecting the tab in view asks the server for nothing — any callable, past the settle window', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await champion('f1', true);
    await arrive(page, fx);
    await expect(page.getByTestId('wsf-community-momentum-card')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(PAST_SETTLE_MS); // the arrival's own reads are done
    await mark(page);
    const calls = countCallables(page);
    await page.getByTestId('wsf-member-tab-home').last().click();
    await page.waitForTimeout(PAST_SETTLE_MS);
    expect(calls, 'reselecting the tab in view asked the server for data').toEqual([]);
    const i = await instance(page);
    expect(i.visible, 'exactly one Community is visible').toBe(1);
    expect(i.marked, 'reselect replaced the Community instance').toBe(true);
    expect(new URL(page.url()).pathname).toBe(`/community/${fx.groupId}`);
  });

  test('F2 a genuine return re-reads without ever showing a loading state, on the same instance, at the same scroll', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await champion('f2', true);
    await arrive(page, fx);
    await expect(page.getByTestId('wsf-community-momentum-card')).toBeVisible({ timeout: 40_000 });
    await expect(visibleCommunity(page).getByTestId(`wsf-community-goal-total-${fx.goalId}`).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(PAST_SETTLE_MS);
    await mark(page);
    const planted = await plantScroll(page, 220);
    expect(planted, 'the Community screen has somewhere to scroll to').toBeGreaterThan(40);
    await page.waitForTimeout(300);
    const plantedSettled = await scrollNow(page);
    await watchLoading(page);
    await leaveForProgress(page);
    const calls = countCallables(page);
    await returnByTab(page);
    await page.waitForTimeout(PAST_SETTLE_MS);

    expect(calls, 'the return did not re-read the goal list').toContain('wsfListGoals');
    expect(await loadingSeen(page), 'a loading state was shown over data the page already had').toEqual([]);
    const i = await instance(page);
    expect(i.visible, 'exactly one Community is visible').toBe(1);
    expect(i.marked, 'the return remounted Community').toBe(true);
    expect(Math.abs((await scrollNow(page)) - plantedSettled), 'the return lost the Community scroll').toBeLessThanOrEqual(2);
    test.info().annotations.push({ type: 'calls', description: calls.join(',') });
  });

  test('F3 after a lost goal create, "Check community goals" lands on a page that shows the goal the server made', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await champion('f3', false);
    await arrive(page, fx);
    await expect(page.getByTestId('wsf-community-no-goal')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(1_500);
    await mark(page);

    await page.route('**/wsfCreateGoal', async (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fetch().catch(() => undefined);
      await route.abort('connectionreset').catch(() => undefined);
    });
    await page.getByTestId('wsf-community-start-goal').click();
    await page.waitForURL(/\/goals\/new/, { timeout: 30_000 });
    await expect(page.getByTestId('wsf-new-goal-form')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('wsf-new-goal-title').fill('W7 Lost Answer Goal');
    await page.getByTestId('wsf-new-goal-target').fill('750');
    await page.getByTestId('wsf-new-goal-unit').fill('squats');
    await page.getByTestId('wsf-new-goal-submit').click();
    await expect(page.getByTestId('wsf-new-goal-check-goals')).toBeVisible({ timeout: 40_000 });
    await page.unroute('**/wsfCreateGoal');
    expect(await goalsOf(fx.groupId), 'the server did not make exactly one goal').toEqual(['W7 Lost Answer Goal']);

    await page.getByTestId('wsf-new-goal-check-goals').click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe(`/community/${fx.groupId}`);
    test.info().annotations.push({ type: 'url', description: page.url() });
    await expect(visibleCommunity(page)).toHaveCount(1, { timeout: 30_000 });
    await expect(visibleCommunity(page).getByTestId('wsf-community-goal-hero')).toContainText('W7 Lost Answer Goal', { timeout: 30_000 });
    await expect(visibleCommunity(page).getByTestId('wsf-community-no-goal')).toHaveCount(0);
    const i = await instance(page);
    // Reported, not asserted: whether the link returned to the kept instance or pushed a new one.
    test.info().annotations.push({ type: 'instance', description: JSON.stringify(i) });
    expect(await goalsOf(fx.groupId), 'a second goal appeared').toHaveLength(1);
  });

  test('F4 when the return read fails, what was on screen stays on screen', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await champion('f4', true);
    await arrive(page, fx);
    const hero = visibleCommunity(page).getByTestId('wsf-community-goal-hero');
    await expect(hero).toContainText('W7 Seeded Goal', { timeout: 40_000 });
    await page.waitForTimeout(PAST_SETTLE_MS);
    await mark(page);

    await leaveForProgress(page);
    let faulted = 0;
    await page.route('**/wsfListGoals', async (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue();
      faulted += 1;
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { status: 'INTERNAL', message: 'INTERNAL' } }) });
    });
    const calls = countCallables(page);
    await returnByTab(page);
    await page.waitForTimeout(PAST_SETTLE_MS);

    test.info().annotations.push({ type: 'calls', description: calls.join(',') });
    await expect(hero).toContainText('W7 Seeded Goal');
    await expect(visibleCommunity(page).getByTestId('wsf-community-no-goal')).toHaveCount(0);
    await expect(visibleCommunity(page).getByTestId('wsf-community-goals-error')).toHaveCount(0);
    await expect(visibleCommunity(page).getByTestId('wsf-community-error')).toHaveCount(0);
    await expect(visibleCommunity(page).getByTestId('wsf-community-goals-loading')).toHaveCount(0);
    const i = await instance(page);
    expect(i.marked, 'the return remounted Community').toBe(true);
    // NON-VACUOUS: the failure path was exercised. On a build that does not
    // re-read the list on a return (no W8), this is where it stops.
    expect(faulted, 'the return never read the goal list, so the fault was never exercised').toBeGreaterThan(0);
  });
});
