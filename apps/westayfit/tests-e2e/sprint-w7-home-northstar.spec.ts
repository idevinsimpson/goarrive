import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { FIRESTORE_EMULATOR, PROJECT_ID, seedProfile, seedShards, seedVerifiedUser, signInVia, stampId } from './helpers/mobile';

/**
 * W7 — CHECK 60: HOME-NORTHSTAR-PARITY-1 (#514), exact product `6ba49f10` on
 * base `6deefe7d` (handoff #434 `5847519588`). W7's own instrument for the
 * truth, navigation and layout rows, independent of W9's focused spec:
 *
 *   T1  default: the hero states the confirmed shared figure ("N of 500"), and
 *       the member's own part ("You've added M") apart from it.
 *   T2  unknown: every pulse read refused from the start (INJECTED, delivery
 *       counted) → no figure, no shared figure, no moved-today line.
 *   T3  last known: a warm return whose pulse refresh fails (INJECTED) → the
 *       figure is kept and explicitly labelled "Last known".
 *   T4  reached and open: a confirmed 512 of 500 on an active goal → "Goal
 *       reached".
 *   T5  no open goal: only a closed goal → no hero, no actions.
 *   T6  warm Home → Community → Home, watched every frame: the hero is never
 *       unmounted or replaced by a loading state.
 *   T7  Home reselect: same URL, same history length, same hero node.
 *   L1–L4 layout: no horizontal overflow (390 and 360); both contribution
 *       actions ≥ 44 px; one h1; 390×640 measured against 390×844.
 *
 * Each row prints PASS / FAIL / CANNOT-MEASURE; nothing here is a pixel
 * verdict. Emulators only (demo-wsf-local); synthetic accounts; Chromium.
 */

const BASE = process.env.WSF_PLAYWRIGHT_BASE_URL;
const LABEL = process.env.W7_LABEL ?? 'head';
test.skip(!BASE, 'Set WSF_PLAYWRIGHT_BASE_URL to the emulator-flagged build under test.');
test.use({ viewport: { width: 390, height: 844 } });

const OWNER = { authorization: 'Bearer owner', 'content-type': 'application/json' };
const docUrl = (p: string) => `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${p}`;
const ts = (d: Date) => ({ timestampValue: d.toISOString() });
const DAY = 864e5;

function measure(label: string, v: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`MEASURE ${label} (${LABEL}): ${JSON.stringify(v)}`);
}
async function write(path: string, fields: Record<string, unknown>): Promise<void> {
  const res = await fetch(docUrl(path), { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields }) });
  if (!res.ok) throw new Error(`write ${path}: ${res.status} ${await res.text()}`);
}

type Fx = { email: string; password: string; uid: string; groupId: string; title: string; shared: number; own: number };
async function fixture(tag: string, opts: { shared: number; own: number; open?: boolean }): Promise<Fx> {
  const s = stampId();
  const k = s.slice(-4);
  const email = `wsf-w7c60-${tag}-${s}@example.com`;
  const password = `Aa1!${randomBytes(6).toString('hex')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, `Nora Home ${k}`);
  const champ = await seedVerifiedUser(`wsf-w7c60-${tag}c-${s}@example.com`, password);
  await seedProfile(champ, `Champion ${k}`);
  const groupId = `w7c60-${tag}-${s}`;
  const now = new Date();
  await write(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: `North Movers ${k}` }, groupType: { stringValue: 'custom' }, joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: `JOIN${randomBytes(4).toString('hex')}` }, createdByUserId: { stringValue: champ },
    lifecycleStatus: { stringValue: 'active' }, isSample: { booleanValue: false }, createdAt: ts(now), updatedAt: ts(now),
  });
  for (const [u, role] of [[champ, 'foundingChampion'], [uid, 'member']] as const) {
    await write(`wsfMemberships/${groupId}_${u}`, {
      groupId: { stringValue: groupId }, userId: { stringValue: u }, role: { stringValue: role },
      membershipStatus: { stringValue: 'active' }, createdAt: ts(now), updatedAt: ts(now),
    });
  }
  const goalId = `w7c60g-${tag}-${s}`;
  const title = `North Squats ${k}`;
  const open = opts.open ?? true;
  const fields: Record<string, unknown> = {
    ownerUid: { stringValue: champ }, communityGroupId: { stringValue: groupId }, title: { stringValue: title },
    target: { integerValue: '500' }, unit: { stringValue: 'squats' }, status: { stringValue: open ? 'active' : 'closed' },
    startsAt: ts(new Date(Date.now() - 7 * DAY)), endsAt: ts(new Date(Date.now() + (open ? 7 : -1) * DAY)),
    timezone: { stringValue: 'America/New_York' }, createdAt: ts(now), updatedAt: ts(now),
  };
  if (!open) fields.closedAt = ts(new Date(Date.now() - DAY));
  await write(`wsfGoals/${goalId}`, fields);
  if (opts.shared > 0) await seedShards(goalId, opts.shared);
  if (opts.own > 0) await write(`wsfGoalMemberTotals/${goalId}_${uid}`, { goalId: { stringValue: goalId }, userId: { stringValue: uid }, total: { integerValue: String(opts.own) } });
  return { email, password, uid, groupId, title, shared: opts.shared, own: opts.own };
}
const shown = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).first();
const heroText = async (page: Page) => (await shown(page, 'wsf-community-goal-hero').innerText({ timeout: 3_000 }).catch(() => '')).replace(/\s+/g, ' ');
const pageText = async (page: Page) => (await shown(page, 'wsf-community').innerText({ timeout: 3_000 }).catch(() => '')).replace(/\s+/g, ' ');
async function signInHome(page: Page, fx: Fx) {
  await signInVia(page, fx.email, fx.password);
  await expect(shown(page, 'wsf-community')).toBeVisible({ timeout: 40_000 });
  await page.waitForTimeout(2_500);
}
const verdict = (ok: boolean | null) => (ok === null ? 'CANNOT-MEASURE' : ok ? 'PASS' : 'FAIL');

test.describe(`W7 Check 60 · Home North Star (${LABEL})`, () => {
  test('T1 default figure and own part; L1–L3 layout; T6 warm return; T7 reselect', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await fixture('t1', { shared: 241, own: 25 });
    await page.addInitScript(() => {
      const W = { frames: 0, heroMissing: 0, loading: 0, heroNodes: new Set<Element>(), watching: false };
      (window as unknown as { __w7w: typeof W }).__w7w = W;
      const LOAD = ['wsf-community-loading', 'wsf-community-goals-loading', 'wsf-home-loading', 'wsf-home-opening-community'];
      const tick = () => {
        if (W.watching && location.pathname.startsWith('/community/')) {
          W.frames += 1;
          const hero = Array.from(document.querySelectorAll('[data-testid="wsf-community-goal-hero"]')).find((e) => e.getClientRects().length > 0);
          if (!hero) W.heroMissing += 1; else W.heroNodes.add(hero);
          for (const id of LOAD) for (const el of Array.from(document.querySelectorAll(`[data-testid="${id}"]`))) if (el.getClientRects().length > 0) W.loading += 1;
        }
        requestAnimationFrame(tick);
      };
      if (document.documentElement) requestAnimationFrame(tick); else addEventListener('DOMContentLoaded', () => requestAnimationFrame(tick));
    });
    await signInHome(page, fx);
    const hero = await heroText(page);
    const all = await pageText(page);
    const figure = new RegExp(`\\b${fx.shared}\\b\\s*of\\s*500`).test(hero);
    const own = new RegExp(`You.ve added ${fx.own}\\b`).test(all);
    measure('T1 default', { verdict: verdict(figure && own && fx.shared !== fx.own), figure, own, hero: hero.slice(0, 220), ownLine: (all.match(/You.ve added[^.]{0,30}/) || [''])[0] });
    // L1 overflow at 390 and 360; L2 action tiles; L3 one h1.
    const layout = async () => page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const over = Array.from(document.querySelectorAll('body *')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > w + 1; }).length;
      const h1 = document.querySelectorAll('h1, [role="heading"][aria-level="1"]').length;
      return { w, scrollW: document.documentElement.scrollWidth, over, h1 };
    });
    const l390 = await layout();
    await page.setViewportSize({ width: 360, height: 800 });
    await page.waitForTimeout(800);
    const l360 = await layout();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);
    const tiles = [];
    // Correction (disclosed): the first run located tiles by label and waited out the test timeout; now by testID prefix.
    for (const pre of ['wsf-community-goal-link-', 'wsf-community-goal-record-']) {
      const b = await page.locator(`[data-testid^="${pre}"]:visible`).first().boundingBox({ timeout: 3_000 }).catch(() => null);
      tiles.push(b ? { w: Math.round(b.width), h: Math.round(b.height) } : null);
    }
    measure('L1-L3 layout', {
      L1: verdict(l390.over === 0 && l390.scrollW <= l390.w && l360.over === 0 && l360.scrollW <= l360.w), l390, l360,
      L2: verdict(tiles.every((t) => t !== null) ? tiles.every((t) => t!.h >= 44 && t!.w >= 44) : null), tiles,
      L3: verdict(l390.h1 === 1), h1: l390.h1,
    });
    // T6 warm Home → Community → Home, every frame watched on Home.
    await page.evaluate(() => { (window as unknown as { __w7w: { watching: boolean } }).__w7w.watching = true; });
    await shown(page, 'wsf-member-tab-community').click();
    await page.waitForTimeout(1_500);
    await shown(page, 'wsf-member-tab-home').click();
    await page.waitForTimeout(2_500);
    const w = await page.evaluate(() => { const W = (window as unknown as { __w7w: { frames: number; heroMissing: number; loading: number; heroNodes: Set<Element> } }).__w7w; return { frames: W.frames, heroMissing: W.heroMissing, loading: W.loading, heroNodes: W.heroNodes.size }; });
    measure('T6 warm return', { verdict: verdict(w.frames > 0 ? w.heroMissing === 0 && w.loading === 0 && w.heroNodes === 1 : null), ...w });
    // T7 reselect Home.
    const before = await page.evaluate(() => { const h = document.querySelector('[data-testid="wsf-community-goal-hero"]') as HTMLElement & { __w7?: number }; if (h) h.__w7 = 7; return { url: location.href, history: history.length }; });
    const calls: string[] = [];
    page.on('request', (r) => { if (new URL(r.url()).port === '5001') calls.push(r.url().split('/').pop() ?? ''); });
    await shown(page, 'wsf-member-tab-home').click();
    await page.waitForTimeout(1_500);
    const after = await page.evaluate(() => ({ url: location.href, history: history.length, same: (document.querySelector('[data-testid="wsf-community-goal-hero"]') as (HTMLElement & { __w7?: number }) | null)?.__w7 === 7 }));
    measure('T7 reselect', { verdict: verdict(after.url === before.url && after.history === before.history && after.same), before, after, callables: calls });
  });

  test('T8 navigation carry: each action keeps its destination, Back returns to Home', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await fixture('t8', { shared: 241, own: 25 });
    await signInHome(page, fx);
    const home = page.url();
    const out: Record<string, unknown> = {};
    for (const [key, pre] of [['start', 'wsf-community-goal-link-'], ['record', 'wsf-community-goal-record-']] as const) {
      const btn = page.locator(`[data-testid^="${pre}"]:visible`).first();
      const href = await btn.getAttribute('href', { timeout: 5_000 }).catch(() => null);
      await btn.click();
      await page.waitForURL((u) => u.toString() !== home, { timeout: 10_000 }).catch(() => undefined);
      const u = new URL(page.url());
      const dest = u.pathname + u.search;
      await page.goBack();
      await page.waitForURL(home, { timeout: 10_000 }).catch(() => undefined);
      const heroBack = (await page.locator('[data-testid="wsf-community-goal-hero"]:visible').count()) === 1;
      out[key] = { href, dest, back: page.url() === home, heroBack };
    }
    const st = out.start as { dest: string; back: boolean; heroBack: boolean };
    const rc = out.record as { dest: string; back: boolean; heroBack: boolean };
    measure('T8 navigation carry', { verdict: verdict(/contribute/.test(st.dest) && /contribute/.test(rc.dest) && st.dest !== rc.dest && st.back && rc.back && st.heroBack && rc.heroBack), ...out });
  });

  test('T2 unknown: every pulse read refused from the start', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await fixture('t2', { shared: 241, own: 25 });
    let delivered = 0;
    await page.context().route('**/wsfGoalPulse', (r) => { delivered += 1; return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"status":"INTERNAL","message":"INJECTED"}}' }); });
    await signInHome(page, fx);
    await page.waitForTimeout(2_000);
    const all = await pageText(page);
    const noFigure = !/\b241\b\s*of\s*500/.test(all) && !/\b\d+\s*of\s*500/.test(all);
    // Correction (disclosed): the header's "N people moved today" comes from the momentum read, not the pulse; only the hero's moved row is pulse-gated.
    const noMoved = (await page.locator('[data-testid="wsf-community-hero-moved-today"]:visible').count()) === 0;
    const says = /couldn.t be loaded|could not be loaded|unavailable/i.test(all);
    measure('T2 unknown', { verdict: verdict(delivered > 0 ? noFigure && noMoved && says : null), delivered, noFigure, noMoved, says, text: all.slice(0, 260) });
  });

  test('T3 last known: a warm refresh whose pulse fails keeps the figure, labelled', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await fixture('t3', { shared: 241, own: 25 });
    const inj = { fail: false, delivered: 0 };
    await page.context().route('**/wsfGoalPulse', (r) => {
      if (!inj.fail) return r.continue();
      inj.delivered += 1;
      return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"status":"INTERNAL","message":"INJECTED"}}' });
    });
    await signInHome(page, fx);
    const first = /\b241\b\s*of\s*500/.test(await heroText(page));
    inj.fail = true;
    await shown(page, 'wsf-member-tab-community').click();
    await page.waitForTimeout(1_200);
    await shown(page, 'wsf-member-tab-home').click();
    await page.waitForTimeout(4_000);
    const hero = await heroText(page);
    const labelled = /last known/i.test(hero);
    const kept = /\b241\b/.test(hero);
    measure('T3 last known', { verdict: verdict(first && inj.delivered > 0 ? labelled && kept : null), first, delivered: inj.delivered, labelled, kept, noMoved: !/moved today/i.test(await pageText(page)), hero: hero.slice(0, 260) });
  });

  test('T4 reached and open; T5 no open goal', async ({ page, browser }) => {
    test.setTimeout(240_000);
    const fx = await fixture('t4', { shared: 512, own: 30 });
    await signInHome(page, fx);
    const hero = await heroText(page);
    measure('T4 reached open', { verdict: verdict(/goal reached/i.test(hero)), hero: hero.slice(0, 200) });
    const fx5 = await fixture('t5', { shared: 120, own: 10, open: false });
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 } });
    const p5 = await ctx.newPage();
    await signInHome(p5, fx5);
    const heroCount = await p5.locator('[data-testid="wsf-community-goal-hero"]:visible').count();
    const actions = await p5.locator('[data-testid^="wsf-community-goal-link-"]:visible, [data-testid^="wsf-community-goal-record-"]:visible').count();
    const all = await pageText(p5);
    // Correction (disclosed): the closed goal legitimately appears under HISTORY; only the text above it is checked.
    const above = all.split(/\bHISTORY\b/)[0];
    measure('T5 no open goal', { verdict: verdict(heroCount === 0 && actions === 0 && !/\b120\b\s*of\s*500/.test(above)), heroCount, actions, text: above.slice(0, 260) });
    await ctx.close();
  });

  test('L4 390x640 is laid out, not cropped', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await fixture('l4', { shared: 241, own: 25 });
    await signInHome(page, fx);
    const geo = async () => page.evaluate(() => {
      const r = (id: string) => { const e = Array.from(document.querySelectorAll(`[data-testid="${id}"]`)).find((x) => x.getClientRects().length > 0); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), h: Math.round(b.height) }; };
      const start = Array.from(document.querySelectorAll('*')).find((e) => e.childElementCount === 0 && /^Start moving$/i.test((e as HTMLElement).innerText?.trim() ?? '') && e.getClientRects().length > 0);
      const sb = start ? start.getBoundingClientRect() : null;
      const tabs = document.querySelector('[data-testid="wsf-member-tabs"]')?.getBoundingClientRect();
      return { vh: innerHeight, hero: r('wsf-community-goal-hero'), startBottom: sb ? Math.round(sb.bottom) : null, tabsTop: tabs ? Math.round(tabs.top) : null };
    });
    const g844 = await geo();
    await page.setViewportSize({ width: 390, height: 640 });
    await page.waitForTimeout(1_200);
    const g640 = await geo();
    const laidOut = g640.hero !== null && g844.hero !== null && (g640.hero.h !== g844.hero.h || g640.hero.top !== g844.hero.top);
    const actionsInFirstScreen = g640.startBottom !== null && g640.tabsTop !== null && g640.startBottom <= g640.tabsTop;
    measure('L4 short height', { verdict: verdict(laidOut && actionsInFirstScreen), g844, g640, laidOut, actionsInFirstScreen });
  });
});
