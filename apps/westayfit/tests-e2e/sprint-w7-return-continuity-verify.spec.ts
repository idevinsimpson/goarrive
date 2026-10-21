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
 * W7 — CHECK 32: INDEPENDENT REVIEW OF W9's RETURN-CONTINUITY-1 (#478), exact
 * head `9f73aaa6` (product `ff043515`) on development `6b96ba1b`.
 *
 *   C1  confirmed return: Home's shared total equals the SERVER's shards and
 *       the receipt; the own row and the viewer's momentum row carry the 20.
 *   C2  unknown returns: request dropped -> Home excludes the 20 (server 1,847);
 *       reply lost after the write -> Home shows the server's 1,867, once.
 *   C3  a failed Refresh over a confirmed figure: the figure and its
 *       "Confirmed h:mm" stay; "Last known" pill, the sentence, the live
 *       region, "Your last-known contribution"; Retry (accessible name) issues
 *       the SAME pulse read; nothing is reset to loading or zero.
 *   C4  recovery: the next successful read clears every indicator and invents
 *       no credit (the figure is the server's).
 *   C5  the return's own SETTLE read failing (no Refresh pressed) is said too.
 *   C6  tab bar present and Home current in the stale state at 390×640 and
 *       390×844; Retry above the bar.
 * Proof able to fail: the same file on the base (`6b96ba1b`, served at 5013).
 * Everything seeded is SYNTHETIC; transport faults are labelled injections.
 */

const PASSWORD = 'Sup3rSecret!23';
const FS = 'http://127.0.0.1:8080/v1/projects/demo-wsf-local/databases/(default)/documents';
const TOTAL = 1847;

type Fx = { email: string; uid: string; groupId: string; goalId: string };

async function seed(tag: string): Promise<Fx> {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-w7-c32-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `w7c32-${stamp}`;
  const goalId = `w7c32goal-${stamp}`;
  const dana = `w7c32-dana-${stamp}`;
  await seedCommunity({ groupId, displayName: 'Alpharetta Morning Movers', joinPolicy: 'private', members: [{ uid, role: 'member' }] });
  await seedMembership(groupId, dana, 'foundingChampion');
  await seedProfile(dana, 'Dana Whitfield');
  await seedActiveGoal({ goalId, groupId, ownerUid: dana, title: 'October Squat Challenge', target: 5000, unit: 'squats', total: TOTAL });
  return { email, uid, groupId, goalId };
}

async function shardSum(goalId: string): Promise<number> {
  const res = await fetch(`${FS}/wsfGoalCounters/${goalId}/shards?pageSize=50`, { headers: { authorization: 'Bearer owner' } });
  const body = (await res.json()) as { documents?: Array<{ fields?: { count?: { integerValue?: string } } }> };
  return (body.documents ?? []).reduce((s, d) => s + Number(d.fields?.count?.integerValue ?? 0), 0);
}

const shown = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).first();

function contributeControl(page: Page) {
  const c = { mode: 'pass' as 'pass' | 'drop' | 'landButDrop' };
  const ready = page.route('**/wsfContribute', async (route: Route) => {
    if (c.mode === 'drop') return route.abort('failed'); // INJECTED
    if (c.mode === 'landButDrop') {
      await route.fetch(); // INJECTED: recorded, reply lost
      return route.abort('failed');
    }
    return route.continue();
  });
  return { c, ready };
}

/** Fail every pulse read while on; count every pulse request. */
function pulseControl(page: Page) {
  const pc = { fail: false, requests: 0 };
  const ready = page.route('**/wsfGoalPulse', async (route: Route) => {
    pc.requests += 1;
    if (pc.fail) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"status":"INTERNAL","message":"injected"}}' }); // INJECTED
    return route.continue();
  });
  return { pc, ready };
}

async function recordFromHero(page: Page, fx: Fx): Promise<void> {
  await page.goto(`/community/${fx.groupId}`);
  await expect(shown(page, `wsf-community-goal-record-${fx.goalId}`)).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(800);
  await shown(page, `wsf-community-goal-record-${fx.goalId}`).click();
  await expect(shown(page, 'wsf-contribute-entry')).toBeVisible({ timeout: 40_000 });
  await shown(page, 'wsf-contribute-entry').fill('20');
  await shown(page, 'wsf-contribute-review').click();
  await shown(page, 'wsf-contribute-submit').click();
}

async function backToCommunity(page: Page, fx: Fx): Promise<void> {
  const exit = shown(page, 'wsf-contribute-back');
  await expect(exit).toHaveText('Back to community', { timeout: 30_000 });
  await exit.click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe(`/community/${fx.groupId}`);
}

const totalText = (n: number) => `${n.toLocaleString('en-US')} of 5,000 squats`;

async function staleSnapshot(page: Page, fx: Fx) {
  return {
    total: await shown(page, `wsf-community-goal-total-${fx.goalId}`).innerText({ timeout: 2_000 }).catch(() => null),
    stale: await page.locator(`[data-testid="wsf-community-goal-stale-${fx.goalId}"]:visible`).count(),
    lastKnownPill: await page.locator(`[data-testid="wsf-community-goal-last-known-${fx.goalId}"]:visible`).count(),
    periodPill: await page.locator(`[data-testid="wsf-community-goal-period-${fx.goalId}"]:visible`).count(),
    live: await page.locator(`[data-testid="wsf-community-goal-stale-status-${fx.goalId}"]`).first().textContent({ timeout: 2_000 }).catch(() => null),
    ownEyebrow: (await page.locator(`[data-testid="wsf-community-your-part-${fx.goalId}"]`).first().innerText({ timeout: 2_000 }).catch(() => '')).split('\n')[0] ?? '',
    updated: await shown(page, 'wsf-community-progress-updated').innerText({ timeout: 2_000 }).catch(() => null),
  };
}

function measure(label: string, value: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`MEASURE ${label}: ${JSON.stringify(value)}`);
  test.info().annotations.push({ type: 'measure', description: `${label}: ${JSON.stringify(value)}` });
}

test.describe('W7 Check 32 · RETURN-CONTINUITY-1', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('C1 confirmed return agrees with the receipt and the server', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await seed('c1');
    await signInVia(page, fx.email, 'Sup3rSecret!23');
    await recordFromHero(page, fx);
    await expect(shown(page, 'wsf-contribute-receipt')).toHaveAttribute('data-variant', 'ordinary', { timeout: 30_000 });
    const receiptTotal = await shown(page, 'wsf-contribute-shared-total').innerText();
    await backToCommunity(page, fx);
    const server = await shardSum(fx.goalId);
    expect(server).toBe(TOTAL + 20);
    await expect(shown(page, `wsf-community-goal-total-${fx.goalId}`)).toHaveText(totalText(server), { timeout: 20_000 });
    expect(receiptTotal.replace(/\s+/g, ' ')).toBe(totalText(server));
    await expect(page.locator(`[data-testid="wsf-community-your-part-${fx.goalId}"]`).first()).toContainText('20');
    await expect(page.locator('[data-testid="wsf-momentum-row"]:visible').first()).toContainText('added 20 squats', { timeout: 20_000 });
    measure('C1', { receiptTotal, server, stale: (await staleSnapshot(page, fx)).stale });
    expect((await staleSnapshot(page, fx)).stale, 'a healthy return shows the stale line').toBe(0);
  });

  test('C2 unknown returns: dropped request excludes the 20; lost reply shows the server total once', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('c2');
    const { c, ready } = contributeControl(page);
    await ready;
    await signInVia(page, fx.email, 'Sup3rSecret!23');
    c.mode = 'drop';
    await recordFromHero(page, fx);
    await expect(shown(page, 'wsf-contribute-pending')).toBeVisible({ timeout: 30_000 });
    await backToCommunity(page, fx);
    await page.waitForTimeout(3_500);
    expect(await shardSum(fx.goalId)).toBe(TOTAL);
    await expect(shown(page, `wsf-community-goal-total-${fx.goalId}`)).toHaveText(totalText(TOTAL));
    await expect(page.locator(`[data-testid="wsf-community-your-part-${fx.goalId}"]`).first()).not.toContainText('20 squats');

    // Same member, same goal: the kept attempt is confirmed with the reply lost after the write.
    c.mode = 'landButDrop';
    await shown(page, `wsf-community-goal-record-${fx.goalId}`).click();
    await expect(shown(page, 'wsf-contribute-pending')).toBeVisible({ timeout: 40_000 });
    await shown(page, 'wsf-contribute-reconcile').click();
    await expect(shown(page, 'wsf-contribute-pending')).toBeVisible({ timeout: 30_000 });
    await backToCommunity(page, fx);
    await page.waitForTimeout(3_500);
    const server = await shardSum(fx.goalId);
    measure('C2 lost reply', { server, shown: await shown(page, `wsf-community-goal-total-${fx.goalId}`).innerText() });
    expect(server).toBe(TOTAL + 20);
    await expect(shown(page, `wsf-community-goal-total-${fx.goalId}`)).toHaveText(totalText(server));
  });

  test('C3 + C4 a failed Refresh is said and Retry is the same read; the next read clears it', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('c3');
    const { pc, ready } = pulseControl(page);
    await ready;
    await signInVia(page, fx.email, 'Sup3rSecret!23');
    await recordFromHero(page, fx);
    await expect(shown(page, 'wsf-contribute-receipt')).toBeVisible({ timeout: 30_000 });
    await backToCommunity(page, fx);
    await expect(shown(page, `wsf-community-goal-total-${fx.goalId}`)).toHaveText(totalText(TOTAL + 20), { timeout: 20_000 });
    await page.waitForTimeout(4_000); // let the return's settle read land
    const before = await staleSnapshot(page, fx);
    expect(before.stale).toBe(0);

    pc.fail = true;
    const r0 = pc.requests;
    await shown(page, 'wsf-community-progress-refresh').click();
    await expect.poll(() => pc.requests, { timeout: 10_000 }).toBeGreaterThan(r0);
    await page.waitForTimeout(1_500);
    const stale = await staleSnapshot(page, fx);
    measure('C3 after a failed Refresh', { before, stale });
    expect(stale.total, 'the kept figure moved').toBe(before.total);
    expect(stale.updated, 'the "Confirmed h:mm" moved').toBe(before.updated);
    expect(stale.stale, 'the failed refresh was silent').toBe(1);
    expect(stale.lastKnownPill).toBe(1);
    expect(stale.periodPill).toBe(0);
    expect(stale.live).toBe('Couldn’t refresh. This is the last confirmed figure.');
    expect(stale.ownEyebrow.toLowerCase(), 'the own row is not labelled last-known').toBe('your last-known contribution');
    const retry = shown(page, `wsf-community-goal-stale-retry-${fx.goalId}`);
    await expect(retry).toHaveAccessibleName('Retry: October Squat Challenge progress');

    // Retry while still failing: the same read is issued, and the state holds.
    const r1 = pc.requests;
    await retry.click();
    await expect.poll(() => pc.requests, { timeout: 10_000 }).toBeGreaterThan(r1);
    await page.waitForTimeout(1_000);
    expect((await staleSnapshot(page, fx)).stale).toBe(1);

    // C4: the read comes back; Retry clears every indicator, figure = server.
    pc.fail = false;
    await shown(page, `wsf-community-goal-stale-retry-${fx.goalId}`).click();
    await expect(page.locator(`[data-testid="wsf-community-goal-stale-${fx.goalId}"]:visible`)).toHaveCount(0, { timeout: 15_000 });
    const after = await staleSnapshot(page, fx);
    measure('C4 after a successful read', after);
    expect(after.lastKnownPill).toBe(0);
    expect(after.periodPill).toBe(1);
    expect(after.live ?? '').toBe('');
    expect(after.ownEyebrow.toLowerCase()).toBe('your contribution');
    expect(after.total).toBe(totalText(await shardSum(fx.goalId)));
    expect(after.total).toBe(totalText(TOTAL + 20));
  });

  test('C5 the return’s own settle read failing is said, with no Refresh pressed', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await seed('c5');
    const { pc, ready } = pulseControl(page);
    await ready;
    await signInVia(page, fx.email, 'Sup3rSecret!23');
    await page.goto(`/community/${fx.groupId}`);
    await expect(shown(page, `wsf-community-goal-total-${fx.goalId}`)).toHaveText(totalText(TOTAL), { timeout: 60_000 });
    await page.waitForTimeout(1_000);
    await shown(page, `wsf-community-goal-record-${fx.goalId}`).click();
    await shown(page, 'wsf-contribute-entry').fill('20');
    await shown(page, 'wsf-contribute-review').click();
    await shown(page, 'wsf-contribute-submit').click();
    await expect(shown(page, 'wsf-contribute-receipt')).toBeVisible({ timeout: 30_000 });
    pc.fail = true; // every read after the receipt fails
    await backToCommunity(page, fx);
    await page.waitForTimeout(5_000);
    const s = await staleSnapshot(page, fx);
    measure('C5 return with every read failing', { s, pulseRequests: pc.requests });
    expect(s.total, 'the retained figure disappeared').not.toBeNull();
    expect(s.stale, 'the failed return read was silent').toBe(1);
  });

  for (const vp of [{ w: 390, h: 640 }, { w: 390, h: 844 }]) {
    test(`C6 ${vp.w}×${vp.h}: in the stale state the tab bar is present, Home current, Retry above it`, async ({ page }) => {
      test.setTimeout(200_000);
      await page.setViewportSize({ width: vp.w, height: vp.h });
      const fx = await seed(`c6${vp.h}`);
      const { pc, ready } = pulseControl(page);
      await ready;
      await signInVia(page, fx.email, 'Sup3rSecret!23');
      await page.goto(`/community/${fx.groupId}`);
      await expect(shown(page, `wsf-community-goal-total-${fx.goalId}`)).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(1_500);
      pc.fail = true;
      await shown(page, 'wsf-community-progress-refresh').click();
      const retry = shown(page, `wsf-community-goal-stale-retry-${fx.goalId}`);
      await expect(retry).toBeVisible({ timeout: 15_000 });
      await retry.scrollIntoViewIfNeeded();
      const geo = await page.evaluate((id) => {
        const r = (document.querySelector(`[data-testid="${id}"]`) as HTMLElement).getBoundingClientRect();
        const home = Array.from(document.querySelectorAll('[data-testid="wsf-member-tab-home"]')).find((e) => (e as HTMLElement).getClientRects().length > 0) as HTMLElement | undefined;
        const bar = home?.closest('[role="tablist"], nav') as HTMLElement | null;
        const barTop = (bar ?? home)?.getBoundingClientRect().top ?? null;
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { retryBottom: Math.round(r.bottom), retryH: Math.round(r.height), barTop: barTop === null ? null : Math.round(barTop), homeCurrent: home?.getAttribute('data-current') ?? null, reachable: !!hit && (hit === document.querySelector(`[data-testid="${id}"]`) || (document.querySelector(`[data-testid="${id}"]`) as HTMLElement).contains(hit)), overflowX: document.documentElement.scrollWidth - innerWidth };
      }, `wsf-community-goal-stale-retry-${fx.goalId}`);
      measure(`C6 ${vp.w}x${vp.h}`, geo);
      expect(geo.barTop, 'no member tab bar').not.toBeNull();
      expect(geo.homeCurrent).toBe('true');
      expect(geo.retryBottom).toBeLessThanOrEqual(geo.barTop!);
      expect(geo.reachable).toBe(true);
      expect(geo.retryH).toBeGreaterThanOrEqual(44);
      expect(geo.overflowX).toBeLessThanOrEqual(0);
    });
  }
});
