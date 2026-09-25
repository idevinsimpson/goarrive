import { expect, test, type Page, type Route } from '@playwright/test';

import {
  seedActiveGoal,
  seedCommunity,
  seedMembership,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * W7 — CHECK 30: INDEPENDENT REVIEW OF W9's FOCUS-RETURN-1 (#477), exact head
 * `8f2cc15e` (product `0d5df335`) on development `6b96ba1b`.
 *
 * W9's spec drives every exit by keyboard. This instrument asks what it does
 * not:
 *   R1  POINTER path: the launcher clicked with a mouse, the route's Back
 *       clicked -> focus on that launcher (the helper's pointer trail).
 *   R2  SCROLL: Home scrolled at 390×640, the launcher opened by keyboard, the
 *       route's Back -> focus on the launcher AND the same scroll offset.
 *   R3  NO STEAL: after Back, the member moves focus to another tab control
 *       inside the grace window -> it stays there.
 *   R4  REAL own-only (membership removed on the server, not an injected
 *       reply) -> "Back to home" -> focus is a named control, never body.
 *   R5  unknown outcome -> "Back to community" -> focus on the launcher, and
 *       the kept attempt is restored through it with nothing sent.
 *   R6  a plain load of Community never moves focus (stays body).
 *   R7  MEASURED, not asserted: a pointer click on blank page space within the
 *       helper's 3 s watch after landing -- where does focus end up?
 * Run on the head and on the base (`6b96ba1b`, tree = `86c160ae`) as fail-first.
 * Everything seeded is SYNTHETIC.
 */

const PASSWORD = 'Sup3rSecret!23';
const FS = 'http://127.0.0.1:8080/v1/projects/demo-wsf-local/databases/(default)/documents';

type Fx = { email: string; uid: string; groupId: string; goalId: string };

async function seed(tag: string): Promise<Fx> {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-w7-c30-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `w7c30-${stamp}`;
  const goalId = `w7c30goal-${stamp}`;
  const dana = `w7c30-dana-${stamp}`;
  await seedCommunity({ groupId, displayName: 'Alpharetta Morning Movers', joinPolicy: 'private', members: [{ uid, role: 'member' }] });
  await seedMembership(groupId, dana, 'foundingChampion');
  await seedProfile(dana, 'Dana Whitfield');
  await seedActiveGoal({ goalId, groupId, ownerUid: dana, title: 'October Squat Challenge', target: 5000, unit: 'squats', total: 1847 });
  return { email, uid, groupId, goalId };
}

async function patch(docPath: string, fields: Record<string, unknown>): Promise<void> {
  const mask = Object.keys(fields).map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const res = await fetch(`${FS}/${docPath}?${mask}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`patch ${docPath}: ${res.status}`);
}

function routeContribute(page: Page) {
  const control = { mode: 'pass' as 'pass' | 'landButDrop', seen: [] as string[] };
  const ready = page.route('**/wsfContribute', async (route: Route) => {
    const body = route.request().postDataJSON() as { data?: { attemptId?: string } } | null;
    control.seen.push(body?.data?.attemptId ?? '?');
    if (control.mode === 'landButDrop') {
      await route.fetch(); // INJECTED: recorded, reply lost
      return route.abort('failed');
    }
    return route.continue();
  });
  return { control, ready };
}

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
async function scrollOf(page: Page, testId: string): Promise<number | null> {
  return page.evaluate((id) => {
    let el = (Array.from(document.querySelectorAll(`[data-testid="${id}"]`)) as HTMLElement[]).find((e) => e.getClientRects().length > 0) ?? null;
    while (el) {
      if (el.scrollHeight > el.clientHeight + 1) return Math.round(el.scrollTop);
      el = el.parentElement;
    }
    return null;
  }, testId);
}

function measure(label: string, value: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`MEASURE ${label}: ${JSON.stringify(value)}`);
  test.info().annotations.push({ type: 'measure', description: `${label}: ${JSON.stringify(value)}` });
}

const launcherOf = (fx: Fx) => `wsf-community-goal-record-${fx.goalId}`;

async function toCommunity(page: Page, fx: Fx): Promise<void> {
  await page.goto(`/community/${fx.groupId}`);
  await expect(page.locator(`[data-testid="${launcherOf(fx)}"]:visible`)).toBeVisible({ timeout: 40_000 });
  await page.waitForTimeout(1_000);
}

test.describe('W7 Check 30 · FOCUS-RETURN-1', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('R1 pointer path: clicked launcher, clicked Back -> focus on the launcher', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await seed('r1');
    await signInVia(page, fx.email, PASSWORD);
    await toCommunity(page, fx);
    await page.locator(`[data-testid="${launcherOf(fx)}"]:visible`).first().click();
    await expect(page.locator('[data-testid="wsf-contribute-entry-screen"]:visible')).toBeVisible({ timeout: 40_000 });
    await page.locator('[data-testid="wsf-contribute-back"]:visible').first().click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 20_000 }).toBe(`/community/${fx.groupId}`);
    await expectFocus(page, launcherOf(fx), 'a pointer-opened flow returns focus to the clicked launcher');
  });

  test('R2 scroll kept: Home scrolled at 390×640 -> Back -> launcher focused, same offset', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 640 });
    const fx = await seed('r2');
    await signInVia(page, fx.email, PASSWORD);
    await toCommunity(page, fx);
    const launcher = page.locator(`[data-testid="${launcherOf(fx)}"]:visible`).first();
    await launcher.scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(600);
    const before = await scrollOf(page, launcherOf(fx));
    expect(before, 'Home did not scroll at 390×640; the scroll case would be vacuous').not.toBeNull();
    expect(before!, 'Home did not scroll at 390×640; the scroll case would be vacuous').toBeGreaterThan(0);
    await launcher.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="wsf-contribute-entry-screen"]:visible')).toBeVisible({ timeout: 40_000 });
    await page.locator('[data-testid="wsf-contribute-back"]:visible').first().focus();
    await page.keyboard.press('Enter');
    await expectFocus(page, launcherOf(fx), 'focus back on the launcher');
    await page.waitForTimeout(500);
    const after = await scrollOf(page, launcherOf(fx));
    measure('R2 scroll', { before, after });
    expect(after, 'the return moved the Home scroll').toBe(before);
  });

  test('R3 no steal: focus the member moves inside the grace window stays where they put it', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await seed('r3');
    await signInVia(page, fx.email, PASSWORD);
    await toCommunity(page, fx);
    await page.locator(`[data-testid="${launcherOf(fx)}"]:visible`).first().focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="wsf-contribute-entry-screen"]:visible')).toBeVisible({ timeout: 40_000 });
    await page.locator('[data-testid="wsf-contribute-back"]:visible').first().focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 20_000 }).toBe(`/community/${fx.groupId}`);
    // The member takes focus themselves, at once, to a control inside the tabs.
    await page.locator('[data-testid="wsf-member-tab-you"]:visible').last().focus();
    const placed = await focusedId(page);
    await page.waitForTimeout(3_500);
    const later = await focusedId(page);
    measure('R3 member-placed focus', { placed, later });
    expect(later, 'the helper took focus away from where the member put it').toBe(placed);
  });

  test('R4 real own-only (membership removed on the server) -> "Back to home" -> a named control, never body', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await seed('r4');
    const { control, ready } = routeContribute(page);
    await ready;
    await signInVia(page, fx.email, PASSWORD);
    await toCommunity(page, fx);
    await page.locator(`[data-testid="${launcherOf(fx)}"]:visible`).first().focus();
    await page.keyboard.press('Enter');
    const entry = page.locator('[data-testid="wsf-contribute-entry"]:visible').first();
    await expect(entry).toBeVisible({ timeout: 40_000 });
    await entry.fill('20');
    await page.locator('[data-testid="wsf-contribute-review"]:visible').first().click();
    control.mode = 'landButDrop';
    await page.locator('[data-testid="wsf-contribute-submit"]:visible').first().click();
    await expect(page.locator('[data-testid="wsf-contribute-pending"]:visible')).toBeVisible({ timeout: 30_000 });
    await patch(`wsfMemberships/${fx.groupId}_${fx.uid}`, { membershipStatus: { stringValue: 'removed' } });
    control.mode = 'pass';
    await page.locator('[data-testid="wsf-contribute-reconcile"]:visible').first().click();
    await expect(page.locator('[data-testid="wsf-contribute-receipt"]:visible')).toHaveAttribute('data-variant', 'ownOnly', { timeout: 30_000 });
    const exit = page.locator('[data-testid="wsf-contribute-back"]:visible').first();
    await expect(exit).toHaveText('Back to home');
    await exit.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).not.toMatch(/^\/contribute\//);
    await page.waitForTimeout(3_500);
    const f = await focusedId(page);
    measure('R4 own-only exit', { path: new URL(page.url()).pathname, focus: f });
    expect(f, 'focus fell to body').not.toBe('body');
    expect(f, 'focus on a hidden node').not.toMatch(/not visible/);
  });

  test('R5 unknown -> "Back to community" -> launcher focused; the kept attempt comes back through it, nothing sent', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await seed('r5');
    const { control, ready } = routeContribute(page);
    await ready;
    await signInVia(page, fx.email, PASSWORD);
    await toCommunity(page, fx);
    const launcher = page.locator(`[data-testid="${launcherOf(fx)}"]:visible`).first();
    await launcher.focus();
    await page.keyboard.press('Enter');
    const entry = page.locator('[data-testid="wsf-contribute-entry"]:visible').first();
    await expect(entry).toBeVisible({ timeout: 40_000 });
    await entry.fill('20');
    await page.locator('[data-testid="wsf-contribute-review"]:visible').first().click();
    control.mode = 'landButDrop';
    await page.locator('[data-testid="wsf-contribute-submit"]:visible').first().click();
    await expect(page.locator('[data-testid="wsf-contribute-pending"]:visible')).toBeVisible({ timeout: 30_000 });
    const kept = control.seen[0];
    const exit = page.locator('[data-testid="wsf-contribute-back"]:visible').first();
    await expect(exit).toHaveText('Back to community');
    await exit.focus();
    await page.keyboard.press('Enter');
    await expectFocus(page, launcherOf(fx), 'the unknown outcome returns focus to its launcher');
    expect(await page.locator('[data-testid="wsf-community"]').count(), 'a duplicate Community screen').toBe(1);
    control.mode = 'pass';
    const sent = control.seen.length;
    await page.keyboard.press('Enter'); // on the restored launcher itself
    await expect(page.locator('[data-testid="wsf-contribute-pending"]:visible')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(2_000);
    expect(control.seen.length, 'coming back sent something').toBe(sent);
    const stored = await page.evaluate((k) => window.localStorage.getItem(k), `wsf.pendingContribution.${fx.goalId}.${fx.uid}`);
    expect(stored ? JSON.parse(stored).attemptId : null, 'a different attempt').toBe(kept);
  });

  test('R6 a plain load of Community never moves focus', async ({ page }) => {
    test.setTimeout(150_000);
    const fx = await seed('r6');
    await signInVia(page, fx.email, PASSWORD);
    await toCommunity(page, fx);
    await page.waitForTimeout(3_000);
    expect(await focusedId(page), 'a plain load moved focus').toBe('body');
  });

  test('R7 measured: a blank-space click within the watch window after landing', async ({ page }) => {
    test.setTimeout(150_000);
    const fx = await seed('r7');
    await signInVia(page, fx.email, PASSWORD);
    await toCommunity(page, fx);
    await page.locator(`[data-testid="${launcherOf(fx)}"]:visible`).first().focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="wsf-contribute-entry-screen"]:visible')).toBeVisible({ timeout: 40_000 });
    await page.locator('[data-testid="wsf-contribute-back"]:visible').first().focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => focusedId(page), { timeout: 8_000 }).not.toBe('body').catch(() => {});
    const landed = await focusedId(page);
    // A point on the page with nothing interactive under it.
    const spot = await page.evaluate(() => {
      for (let y = 120; y < window.innerHeight - 120; y += 8) {
        for (const x of [6, 12, window.innerWidth - 8]) {
          const el = document.elementFromPoint(x, y) as HTMLElement | null;
          if (el && !el.closest('a,button,input,[role="button"],[role="link"],[tabindex]')) return { x, y };
        }
      }
      return null;
    });
    expect(spot, 'no blank spot found').not.toBeNull();
    await page.mouse.click(spot!.x, spot!.y);
    const justAfter = await focusedId(page);
    await page.waitForTimeout(1_000);
    const oneSecond = await focusedId(page);
    measure('R7 blank click after landing', { landed, justAfter, oneSecond, spot });
  });
  test('R8 latest intent wins: a keyboard-focused launcher, then MOVE pressed with the pointer -> Back lands on MOVE', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await seed('r8');
    await signInVia(page, fx.email, PASSWORD);
    await toCommunity(page, fx);
    await page.locator(`[data-testid="${launcherOf(fx)}"]:visible`).first().focus();
    await page.waitForTimeout(300);
    await page.getByTestId('wsf-member-tab-move').last().click();
    await page.waitForURL(/\/contribute\//, { timeout: 40_000 });
    await expect(page.locator('[data-testid="wsf-contribute-back"]:visible').first()).toBeVisible({ timeout: 40_000 });
    await page.locator('[data-testid="wsf-contribute-back"]:visible').first().click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 20_000 }).toBe(`/community/${fx.groupId}`);
    await expectFocus(page, 'wsf-member-tab-move', 'the latest press (MOVE), not the earlier keyboard focus, gets focus back');
  });

  test('R9 a new cover cancels a pending restore: re-opened at once, focus is never pulled into the hidden tabs', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await seed('r9');
    await signInVia(page, fx.email, PASSWORD);
    await toCommunity(page, fx);
    await page.locator(`[data-testid="${launcherOf(fx)}"]:visible`).first().focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="wsf-contribute-entry-screen"]:visible')).toBeVisible({ timeout: 40_000 });
    await page.locator('[data-testid="wsf-contribute-back"]:visible').first().focus();
    await page.keyboard.press('Enter');
    // At once, before any restore can settle, a second flow covers the tabs.
    await page.getByTestId('wsf-member-tab-move').last().click();
    await page.waitForURL(/\/contribute\//, { timeout: 40_000 });
    await expect(page.locator('[data-testid="wsf-contribute-entry-screen"]:visible, [data-testid="wsf-contribute-move-screen"]:visible').first()).toBeVisible({ timeout: 40_000 });
    const samples: string[] = [];
    for (let i = 0; i < 12; i += 1) { samples.push(await focusedId(page)); await page.waitForTimeout(250); }
    measure('R9 focus while the second flow covers', samples);
    expect(samples.filter((f) => f.includes('wsf-community-goal-record') || f.startsWith('wsf-member-tab')), 'a restore pulled focus into the covered tabs').toEqual([]);
    await page.locator('[data-testid="wsf-contribute-back"]:visible').first().click();
    await expectFocus(page, 'wsf-member-tab-move', 'the second flow’s opener gets focus back');
  });

  test('R10 active-tab reselect stays a no-op, by pointer and by Enter', async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 390, height: 640 });
    const fx = await seed('r10');
    await signInVia(page, fx.email, PASSWORD);
    await toCommunity(page, fx);
    await page.locator(`[data-testid="${launcherOf(fx)}"]:visible`).first().scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(600);
    const before = { path: new URL(page.url()).pathname, scroll: await scrollOf(page, launcherOf(fx)), hist: await page.evaluate(() => history.length) };
    const home = page.getByTestId('wsf-member-tab-home').last();
    await home.click();
    await page.waitForTimeout(800);
    await home.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    const after = { path: new URL(page.url()).pathname, scroll: await scrollOf(page, launcherOf(fx)), hist: await page.evaluate(() => history.length), focus: await focusedId(page) };
    measure('R10 reselect', { before, after });
    expect(after.path).toBe(before.path);
    expect(after.scroll).toBe(before.scroll);
    expect(after.hist).toBe(before.hist);
    expect(after.focus).toBe('wsf-member-tab-home');
  });
});
