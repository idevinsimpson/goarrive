import { expect, test, type Page, type Route } from '@playwright/test';

import {
  FIRESTORE_EMULATOR,
  PROJECT_ID,
  seedActiveGoal,
  seedCommunity,
  seedMembership,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * W7 — CHECK 40: APP-FEEL-PARITY-1 checkpoint 2 (#487), exact product
 * `be21eab44ee969cfc55543d759aece8ba51780c8` (evidence head `09dd16b2`),
 * against development `91392f9d` (Director #434 `5839322767`). Changed
 * dependencies only:
 *
 *   E1  MOVE no-goal -> "Go to your community": lands on the member's mounted
 *       community (Home tab): one tab bar, one community screen, no loading
 *       replay, the /move sheet not left in history, scroll kept.
 *   E2  MOVE read error (INJECTED wsfListGoals 500) -> "Go Home": the Home tab
 *       as it stands, same contract, nontrivial scroll kept.
 *   E3  wordmark from the Community tab (pointer, then Enter): Home selected as
 *       it stands; no second community, no loading replay, scroll kept.
 *   E4  the shared read layer: a second account signed in on the same page
 *       never sees the first account's community, and a community whose
 *       membership is refused is forgotten (its first-visit frame is not
 *       served from memory).
 *   E5  the Champion's deliberate goals reload (Retry) keeps its contract:
 *       back to loading, a failure reported as a failure (INJECTED).
 * Emulators only (demo-wsf-local); synthetic accounts; Chromium web.
 */

const BASE = process.env.WSF_PLAYWRIGHT_BASE_URL;
const LABEL = process.env.W7_LABEL ?? 'head';
test.skip(!BASE, 'Set WSF_PLAYWRIGHT_BASE_URL to the emulator-flagged build under test.');
const PASSWORD = 'Sup3rSecret!23';

function measure(label: string, value: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`MEASURE ${label}: ${JSON.stringify(value)}`);
  test.info().annotations.push({ type: 'measure', description: `${label}: ${JSON.stringify(value)}` });
}

/** Every mount of a watched screen, whether a loading frame was ever painted, and a text watch. */
function instrument(page: Page) {
  return page.addInitScript(() => {
    const W = { seen: {} as Record<string, number>, inst: {} as Record<string, number>, text: [] as string[], watch: [] as string[] };
    (window as unknown as { __w7: typeof W }).__w7 = W;
    const ids = ['wsf-community', 'wsf-community-loading', 'wsf-member-tabs', 'wsf-home-opening-community', 'wsf-community-index-loading', 'wsf-community-index'];
    const els = new Map<string, WeakSet<Element>>();
    const tick = () => {
      for (const id of ids) {
        let ws = els.get(id);
        if (!ws) { ws = new WeakSet(); els.set(id, ws); W.inst[id] = 0; }
        for (const el of Array.from(document.querySelectorAll(`[data-testid="${id}"]`))) {
          if (!ws.has(el)) { ws.add(el); W.inst[id] += 1; }
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) W.seen[id] = (W.seen[id] ?? 0) + 1;
        }
      }
      if (W.watch.length && document.body) {
        const t = document.body.innerText;
        for (const w of W.watch) if (t.includes(w) && !W.text.includes(w)) W.text.push(w);
      }
      requestAnimationFrame(tick);
    };
    const start = () => { new MutationObserver(tick).observe(document.documentElement, { subtree: true, childList: true, characterData: true }); requestAnimationFrame(tick); };
    if (document.documentElement) start(); else addEventListener('DOMContentLoaded', start);
  });
}
type W7 = { seen: Record<string, number>; inst: Record<string, number>; text: string[]; watch: string[] };
const w7 = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __w7: W7 }).__w7)) as W7);
const reset = (page: Page) => page.evaluate(() => { const W = (window as unknown as { __w7: W7 }).__w7; W.seen = {}; });
const visibleCount = (page: Page, id: string) =>
  page.evaluate((tid) => Array.from(document.querySelectorAll(`[data-testid="${tid}"]`)).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length, id);
const path = (page: Page) => new URL(page.url()).pathname;
const shown = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).first();
const currentTab = (page: Page) => page.evaluate(() => (document.querySelector('[data-testid="wsf-member-tabs"] [data-current="true"]') as HTMLElement | null)?.getAttribute('data-testid') ?? null);
async function scrollOf(page: Page, id: string): Promise<number | null> {
  return page.evaluate((tid) => {
    const el = Array.from(document.querySelectorAll(`[data-testid="${tid}"]`)).find((e) => e.getBoundingClientRect().height > 0);
    if (!el) return null;
    for (const n of [el, ...Array.from(el.querySelectorAll('*'))]) if (n.scrollHeight > n.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(n).overflowY)) return Math.round(n.scrollTop);
    for (let n: Element | null = el.parentElement; n; n = n.parentElement) if (n.scrollHeight > n.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(n).overflowY)) return Math.round(n.scrollTop);
    return 0;
  }, id);
}
async function scrollBy(page: Page, id: string, dy: number): Promise<void> {
  await page.evaluate(([tid, d]) => {
    const el = Array.from(document.querySelectorAll(`[data-testid="${tid}"]`)).find((e) => e.getBoundingClientRect().height > 0);
    const cands = el ? [el, ...Array.from(el.querySelectorAll('*'))] : [];
    for (let n: Element | null = el ?? null; n; n = n.parentElement) cands.push(n);
    const s = cands.find((n) => n.scrollHeight > n.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(n).overflowY));
    if (s) s.scrollTop += d as number;
  }, [id, dy] as const);
}
function countCallables(page: Page) {
  const c: Record<string, number> = {};
  page.on('request', (r) => { const u = new URL(r.url()); if (u.port === '5001') { const n = u.pathname.split('/').pop()!; c[n] = (c[n] ?? 0) + 1; } });
  return c;
}

async function seedMember(tag: string, withGoal: boolean) {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-w7-c40-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `w7c40-${stamp}`;
  const dana = `w7c40-dana-${stamp}`;
  await seedCommunity({ groupId, displayName: `Harbor Movers ${stamp.slice(-4)}`, joinPolicy: 'private', members: [{ uid, role: 'member' }] });
  await seedMembership(groupId, dana, 'foundingChampion');
  await seedProfile(dana, 'Dana Whitfield');
  const goalId = `w7c40goal-${stamp}`;
  if (withGoal) await seedActiveGoal({ goalId, groupId, ownerUid: dana, title: 'October Squat Challenge', target: 5000, unit: 'squats', total: 1847 });
  return { email, uid, groupId, goalId, stamp };
}

async function atCommunity(page: Page, groupId: string) {
  await expect.poll(() => path(page), { timeout: 40_000 }).toBe(`/community/${groupId}`);
  await expect(shown(page, 'wsf-community')).toBeVisible({ timeout: 40_000 });
  await page.waitForTimeout(1_500);
}
async function tab(page: Page, key: string, ready: string) {
  await shown(page, `wsf-member-tab-${key}`).click();
  await expect(shown(page, ready)).toBeVisible({ timeout: 40_000 });
  await page.waitForTimeout(1_200);
}

test.describe(`W7 Check 40 · APP-FEEL-PARITY-1 cp2 (${LABEL})`, () => {
  for (const vp of [{ w: 390, h: 640 }, { w: 390, h: 844 }]) {
    test(`E1 no-goal "Go to your community" lands on the mounted community (${vp.w}x${vp.h})`, async ({ page }) => {
      test.setTimeout(200_000);
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await instrument(page);
      const fx = await seedMember(`e1${vp.h}`, false);
      await signInVia(page, fx.email, PASSWORD);
      await atCommunity(page, fx.groupId);
      await scrollBy(page, 'wsf-community', 120);
      const scrollBefore = await scrollOf(page, 'wsf-community');
      await tab(page, 'you', 'wsf-you');
      const inst0 = (await w7(page)).inst;
      await shown(page, 'wsf-member-tab-move').click();
      await expect(shown(page, 'wsf-move-no-goal')).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(500);
      await reset(page);
      await shown(page, 'wsf-move-no-goal-community').click();
      await expect.poll(() => path(page), { timeout: 20_000 }).toBe(`/community/${fx.groupId}`);
      await page.waitForTimeout(1_500);
      const after = await w7(page);
      const r = {
        path: path(page), currentTab: await currentTab(page),
        tabBars: await visibleCount(page, 'wsf-member-tabs'),
        communityVisible: await visibleCount(page, 'wsf-community'),
        communityInstancesAdded: after.inst['wsf-community'] - inst0['wsf-community'],
        loadingPainted: after.seen['wsf-community-loading'] ?? 0,
        moveSheets: await visibleCount(page, 'wsf-move-screen'),
        scrollBefore, scrollAfter: await scrollOf(page, 'wsf-community'),
      };
      await page.goBack();
      await page.waitForTimeout(1_200);
      const back = { path: path(page), moveSheet: await visibleCount(page, 'wsf-move-screen') };
      measure(`E1 ${vp.w}x${vp.h} (${LABEL})`, { ...r, afterBrowserBack: back });
      expect.soft(r.tabBars, 'one tab navigator').toBe(1);
      expect.soft(r.communityInstancesAdded, 'no second community instance').toBe(0);
      expect.soft(r.loadingPainted, 'no loading replay').toBe(0);
      expect.soft(r.scrollAfter, 'scroll kept').toBe(scrollBefore);
      expect.soft(back.path, 'the sheet is not left in history').not.toBe('/move');
    });
  }

  test('E2 read error (INJECTED) "Go Home" lands on the Home tab as it stands, nontrivial scroll kept', async ({ page }) => {
    test.setTimeout(200_000);
    await instrument(page);
    const fx = await seedMember('e2', true);
    const fail = { on: false };
    await page.route('**/wsfListGoals', (route: Route) => (fail.on ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"status":"INTERNAL","message":"injected"}}' }) : route.continue())); // INJECTED when on
    await signInVia(page, fx.email, PASSWORD);
    await atCommunity(page, fx.groupId);
    await scrollBy(page, 'wsf-community', 300);
    const scrollBefore = await scrollOf(page, 'wsf-community');
    await tab(page, 'you', 'wsf-you');
    const inst0 = (await w7(page)).inst;
    fail.on = true;
    await shown(page, 'wsf-member-tab-move').click();
    await expect(page.locator('[data-testid="wsf-move-error-home"]:visible').first()).toBeVisible({ timeout: 30_000 });
    fail.on = false;
    await page.waitForTimeout(400);
    await reset(page);
    await shown(page, 'wsf-move-error-home').click();
    await page.waitForTimeout(2_000);
    const after = await w7(page);
    const r = {
      path: path(page), currentTab: await currentTab(page),
      tabBars: await visibleCount(page, 'wsf-member-tabs'),
      communityInstancesAdded: after.inst['wsf-community'] - inst0['wsf-community'],
      loadingPainted: after.seen['wsf-community-loading'] ?? 0,
      homeOpening: after.seen['wsf-home-opening-community'] ?? 0,
      moveSheets: await visibleCount(page, 'wsf-move-screen'),
      scrollBefore, scrollAfter: await scrollOf(page, 'wsf-community'),
    };
    await page.goBack();
    await page.waitForTimeout(1_200);
    measure(`E2 (${LABEL})`, { ...r, afterBrowserBack: { path: path(page), moveSheet: await visibleCount(page, 'wsf-move-screen') } });
    expect.soft(r.currentTab).toBe('wsf-member-tab-home');
    expect.soft(r.tabBars).toBe(1);
    expect.soft(r.communityInstancesAdded).toBe(0);
    expect.soft(r.loadingPainted + r.homeOpening, 'no loading replay').toBe(0);
    expect.soft(scrollBefore ?? 0, 'the scroll planted is nontrivial').toBeGreaterThan(0);
    expect.soft(r.scrollAfter).toBe(scrollBefore);
    expect.soft(path(page)).not.toBe('/move');
  });

  test('E3 wordmark from the Community tab, pointer then Enter', async ({ page }) => {
    test.setTimeout(200_000);
    await instrument(page);
    const calls = countCallables(page);
    const fx = await seedMember('e3', true);
    await signInVia(page, fx.email, PASSWORD);
    await atCommunity(page, fx.groupId);
    await scrollBy(page, 'wsf-community', 300);
    const scrollBefore = await scrollOf(page, 'wsf-community');
    const rows: Record<string, unknown> = {};
    for (const how of ['pointer', 'Enter'] as const) {
      await tab(page, 'community', 'wsf-community-index');
      const inst0 = (await w7(page)).inst;
      await reset(page);
      const c0 = { ...calls };
      if (how === 'pointer') await shown(page, 'wsf-member-topbar-wordmark-home').click();
      else { await shown(page, 'wsf-member-topbar-wordmark-home').focus(); await page.keyboard.press('Enter'); }
      await page.waitForTimeout(2_000);
      const after = await w7(page);
      const delta = Object.fromEntries(Object.entries(calls).map(([k, v]) => [k, v - (c0[k] ?? 0)]).filter(([, v]) => (v as number) > 0));
      rows[how] = {
        path: path(page), currentTab: await currentTab(page),
        communityInstancesAdded: after.inst['wsf-community'] - inst0['wsf-community'],
        loadingPainted: (after.seen['wsf-community-loading'] ?? 0) + (after.seen['wsf-home-opening-community'] ?? 0),
        scrollBefore, scrollAfter: await scrollOf(page, 'wsf-community'), callables: delta,
      };
    }
    measure(`E3 (${LABEL})`, rows);
    for (const how of ['pointer', 'Enter']) {
      const r = rows[how] as Record<string, unknown>;
      expect.soft(r.currentTab, `${how}: Home selected`).toBe('wsf-member-tab-home');
      expect.soft(r.communityInstancesAdded, `${how}: no second community`).toBe(0);
      expect.soft(r.loadingPainted, `${how}: no loading replay`).toBe(0);
      expect.soft(r.scrollAfter, `${how}: scroll kept`).toBe(scrollBefore);
    }
  });

  test('E4 shared reads are per account; a refused membership is forgotten', async ({ page }) => {
    test.setTimeout(260_000);
    await instrument(page);
    const a = await seedMember('e4a', true);
    const b = await seedMember('e4b', true);
    // B also belongs to a second community, which will refuse him later.
    const refused = `w7c40-refuse-${b.stamp}`;
    const refusedName = `Refusing Walkers ${b.stamp.slice(-4)}`;
    await seedCommunity({ groupId: refused, displayName: refusedName, joinPolicy: 'private', members: [{ uid: b.uid, role: 'member' }] });
    const aName = `Harbor Movers ${a.stamp.slice(-4)}`;

    // A reads its communities (Home, Community tab), then signs out IN THE PAGE (no reload).
    await signInVia(page, a.email, PASSWORD);
    await atCommunity(page, a.groupId);
    await tab(page, 'community', 'wsf-community-index');
    await shown(page, 'wsf-member-topbar-menu-button').click();
    await shown(page, 'wsf-member-topbar-menu-signout').click();
    await page.waitForTimeout(2_000);
    await page.evaluate((n) => { const W = (window as unknown as { __w7: W7 }).__w7; W.watch = [n]; W.text = []; }, aName);
    // B signs in through the in-app route (still no document reload).
    // Mark this document so a reload anywhere below is detected, not assumed away.
    await page.evaluate(() => { (window as unknown as { __w7doc: string }).__w7doc = 'A-session-document'; });
    await shown(page, 'wsf-member-tab-home').click({ timeout: 3_000 }).catch(() => undefined);
    await page.waitForTimeout(1_000);
    const signinLink = page.locator('[data-testid="wsf-home-signin"]:visible, [data-testid="wsf-you-signin"]:visible').first();
    let route = 'in-app sign-in link';
    if (await signinLink.count()) await signinLink.click();
    else {
      route = 'history.pushState + popstate (router-handled, no reload)';
      await page.evaluate(() => { history.pushState({}, '', '/signin'); dispatchEvent(new PopStateEvent('popstate', { state: {} })); });
    }
    await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 20_000 });
    const docId = await page.evaluate(() => (window as unknown as { __w7doc?: string }).__w7doc ?? 'reloaded');
    await page.getByTestId('wsf-signin-email').fill(b.email);
    await page.getByTestId('wsf-signin-password').fill(PASSWORD);
    await page.getByTestId('wsf-signin-submit').click();
    await page.waitForTimeout(3_000);
    // Refuse B's second membership on the server, then B opens that community from Home's list.
    await fetch(`${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/wsfMemberships/${refused}_${b.uid}`, { method: 'DELETE', headers: { authorization: 'Bearer owner' } });
    const listRow = page.locator(`[data-testid="wsf-home-community-${refused}"]:visible`).first();
    let opened = 'not offered';
    if (await listRow.count()) { await listRow.click(); opened = 'opened from Home list'; }
    else { await page.goto(`/community/${refused}`); opened = 'opened by address (reload)'; }
    await page.waitForTimeout(3_000);
    const refusalShown = await page.locator('[data-testid="wsf-community-not-member"]:visible, [data-testid="wsf-community-error"]:visible').count();
    // First visit to the Community tab for B in this document.
    await reset(page);
    await page.evaluate((n) => { const W = (window as unknown as { __w7: W7 }).__w7; W.watch = [...W.watch, n]; }, refusedName);
    await shown(page, 'wsf-member-tab-community').click();
    await page.waitForTimeout(3_000);
    const w = await w7(page);
    const sameDocument = docId === 'A-session-document' && (await page.evaluate(() => (window as unknown as { __w7doc?: string }).__w7doc ?? 'reloaded')) === 'A-session-document';
    const finalText = await page.locator('[data-testid="wsf-community-index"]:visible').first().innerText({ timeout: 5_000 }).catch(() => '');
    measure(`E4 (${LABEL})`, {
      sameDocumentAcrossAccounts: sameDocument, signinRoute: route, opened, refusalShown,
      textSeenAfterBSignedIn: w.text, communityIndexLoadingPainted: w.seen['wsf-community-index-loading'] ?? 0,
      finalListNamesRefused: finalText.includes(refusedName), finalListNamesA: finalText.includes(aName),
    });
    expect(sameDocument, 'the isolation proof needs one document across both accounts').toBe(true);
    expect.soft(w.text.includes(aName), "B's session never shows A's community").toBe(false);
    expect.soft(finalText.includes(refusedName), 'the refused community is not listed').toBe(false);
  });

  test('E4c positive control: a first Community-tab visit after Home opens on the shared read', async ({ page }) => {
    test.setTimeout(200_000);
    await instrument(page);
    const calls = countCallables(page);
    const fx = await seedMember('e4c', true);
    await signInVia(page, fx.email, PASSWORD);
    await atCommunity(page, fx.groupId);
    await reset(page);
    const c0 = { ...calls };
    const t0 = Date.now();
    await shown(page, 'wsf-member-tab-community').click();
    await expect(shown(page, 'wsf-community-index')).toBeVisible({ timeout: 30_000 });
    const rowsAt = Date.now() - t0;
    await page.waitForTimeout(2_000);
    const w = await w7(page);
    const delta = Object.fromEntries(Object.entries(calls).map(([k, v]) => [k, v - (c0[k] ?? 0)]).filter(([, v]) => (v as number) > 0));
    measure(`E4c (${LABEL})`, { loadingPainted: w.seen['wsf-community-index-loading'] ?? 0, currentPanelMs: rowsAt, freshCallables: delta });
    expect.soft(w.seen['wsf-community-index-loading'] ?? 0, 'no whole-page skeleton on a warm first visit').toBe(0);
    expect.soft(delta.wsfMyCommunities ?? 0, 'the fresh read still runs').toBeGreaterThan(0);
  });

  test('E5 the goals Retry keeps its contract (INJECTED failures)', async ({ page }) => {
    test.setTimeout(200_000);
    await instrument(page);
    const fx = await seedMember('e5', true);
    const fail = { on: false, n: 0 };
    await page.route('**/wsfListGoals', (route: Route) => { if (fail.on) { fail.n += 1; return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"status":"INTERNAL","message":"injected"}}' }); } return route.continue(); });
    await signInVia(page, fx.email, PASSWORD);
    await atCommunity(page, fx.groupId);
    fail.on = true;
    await page.reload();
    await expect(shown(page, 'wsf-community-goals-error')).toBeVisible({ timeout: 40_000 });
    const trace: string[] = [];
    await reset(page);
    await shown(page, 'wsf-community-goals-retry').click();
    for (let i = 0; i < 20; i += 1) {
      const s = (await visibleCount(page, 'wsf-community-goals-loading')) ? 'loading' : (await visibleCount(page, 'wsf-community-goals-error')) ? 'error' : 'other';
      if (trace[trace.length - 1] !== s) trace.push(s);
      await page.waitForTimeout(100);
    }
    fail.on = false;
    await shown(page, 'wsf-community-goals-retry').click();
    await expect(shown(page, `wsf-community-goal-total-${fx.goalId}`)).toBeVisible({ timeout: 30_000 });
    measure(`E5 (${LABEL})`, { failedRetryTrace: trace, failuresServed: fail.n, recovered: true });
    expect.soft(trace[trace.length - 1], 'a failed Retry is reported as a failure').toBe('error');
  });
});
