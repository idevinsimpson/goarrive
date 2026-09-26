import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { FIRESTORE_EMULATOR, PROJECT_ID, seedProfile, seedShards, seedVerifiedUser, signInVia, stampId } from './helpers/mobile';

/**
 * W7 — HARDENED-MEMBER-JOURNEY-1 (Director #434 `5841402228`): the standing
 * hardening rows NOT already covered by Checks 41B / 43 / 44 / 45 and the PERF
 * truth spec. Each row reports PASS / FAIL / CANNOT-MEASURE; a SHA re-runs only
 * the rows whose dependencies changed (the row → last-passing-SHA matrix lives
 * in the QA report).
 *
 *   H1  mounted navigation: 10 warm cycles Home → Community → Progress → You →
 *       Home. Warm switches paint no loading frame; one mounted instance per
 *       route; no growth (cycle 2 → cycle 10) in mounted screens, live
 *       intervals, net window/document listeners, callables or Firestore
 *       listen channels per cycle. `history.length` is recorded, not asserted.
 *   H2  MOVE lifecycle (390x640): 10 open / Close cycles from Home, Progress and You —
 *       Close returns to the opener tab, focus to the MOVE control, scroll
 *       kept; one tab bar and no sheet left; requests per visit do not grow.
 *       One confirmed contribution, then 5 more open / Close cycles: the
 *       server ledger holds exactly one row for it and one `wsfContribute`.
 *
 * Emulators only (demo-wsf-local); synthetic accounts; Chromium at 390x844.
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
  test.info().annotations.push({ type: 'measure', description: `${label}: ${JSON.stringify(v)}` });
}
async function write(path: string, fields: Record<string, unknown>): Promise<void> {
  const res = await fetch(docUrl(path), { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields }) });
  if (!res.ok) throw new Error(`write ${path}: ${res.status} ${await res.text()}`);
}

type Fx = { email: string; password: string; uid: string; name: string; groupId: string; community: string; goalId: string; title: string };
async function fixture(tag: string, closedWithOwn = 0): Promise<Fx> {
  const s = stampId();
  const k = s.slice(-4);
  const email = `wsf-w7h-${tag}-${s}@example.com`;
  const password = `Aa1!${randomBytes(6).toString('hex')}`;
  const name = `Hana Harden ${k}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, name);
  const champ = await seedVerifiedUser(`wsf-w7h-${tag}c-${s}@example.com`, password);
  await seedProfile(champ, `Champion ${k}`);
  const groupId = `w7h-${tag}-${s}`;
  const community = `Harden Movers ${k}`;
  const now = new Date();
  await write(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: community }, groupType: { stringValue: 'custom' }, joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: `JOIN${randomBytes(4).toString('hex')}` }, createdByUserId: { stringValue: champ },
    lifecycleStatus: { stringValue: 'active' }, isSample: { booleanValue: false }, createdAt: ts(now), updatedAt: ts(now),
  });
  for (const [u, role] of [[champ, 'foundingChampion'], [uid, 'member']] as const) {
    await write(`wsfMemberships/${groupId}_${u}`, {
      groupId: { stringValue: groupId }, userId: { stringValue: u }, role: { stringValue: role },
      membershipStatus: { stringValue: 'active' }, createdAt: ts(now), updatedAt: ts(now),
    });
  }
  const goalId = `w7hg-${tag}-${s}`;
  const title = `Harden Squats ${k}`;
  await write(`wsfGoals/${goalId}`, {
    ownerUid: { stringValue: champ }, communityGroupId: { stringValue: groupId }, title: { stringValue: title },
    target: { integerValue: '500' }, unit: { stringValue: 'squats' }, status: { stringValue: 'active' },
    startsAt: ts(new Date(Date.now() - 7 * DAY)), endsAt: ts(new Date(Date.now() + 7 * DAY)), timezone: { stringValue: 'America/New_York' },
    createdAt: ts(now), updatedAt: ts(now),
  });
  await seedShards(goalId, 180);
  await write(`wsfGoalMemberTotals/${goalId}_${uid}`, { goalId: { stringValue: goalId }, userId: { stringValue: uid }, total: { integerValue: '35' } });
  for (let i = 0; i < closedWithOwn; i += 1) {
    const gid = `w7hc${i}-${tag}-${s}`;
    await write(`wsfGoals/${gid}`, {
      ownerUid: { stringValue: champ }, communityGroupId: { stringValue: groupId }, title: { stringValue: `Closed Round ${i + 1} ${k}` },
      target: { integerValue: '200' }, unit: { stringValue: 'squats' }, status: { stringValue: 'closed' },
      startsAt: ts(new Date(Date.now() - (30 + i * 10) * DAY)), endsAt: ts(new Date(Date.now() - (20 + i * 10) * DAY)),
      closedAt: ts(new Date(Date.now() - (20 + i * 10) * DAY)), timezone: { stringValue: 'America/New_York' }, createdAt: ts(now), updatedAt: ts(now),
    });
    await seedShards(gid, 150 + i * 40);
    await write(`wsfGoalMemberTotals/${gid}_${uid}`, { goalId: { stringValue: gid }, userId: { stringValue: uid }, total: { integerValue: String(10 + i) } });
  }
  return { email, password, uid, name, groupId, community, goalId, title };
}

// ── instrument ─────────────────────────────────────────────────────────────

const ROOTS = ['wsf-community', 'wsf-community-index', 'wsf-activity', 'wsf-you', 'wsf-move-screen', 'wsf-contribute-sheet-panel'];
const LOADING = ['wsf-home-loading', 'wsf-home-opening-community', 'wsf-home-my-loading', 'wsf-community-loading', 'wsf-community-goals-loading', 'wsf-community-index-loading', 'wsf-activity-loading', 'wsf-you-loading', 'wsf-move-working'];

function hardenInstrument({ roots, loading }: { roots: string[]; loading: string[] }) {
  const H = { inst: {} as Record<string, number>, loadSeen: {} as Record<string, number>, intervals: new Set<unknown>(), listeners: [] as Array<[EventTarget, string, unknown]> };
  (window as unknown as { __w7h: typeof H }).__w7h = H;
  const si = window.setInterval.bind(window);
  const ci = window.clearInterval.bind(window);
  (window as unknown as { setInterval: unknown }).setInterval = (fn: TimerHandler, ms?: number, ...a: unknown[]) => { const id = si(fn, ms, ...a); H.intervals.add(id); return id; };
  (window as unknown as { clearInterval: unknown }).clearInterval = (id?: number) => { H.intervals.delete(id); ci(id); };
  const add = EventTarget.prototype.addEventListener;
  const rem = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, fn: EventListenerOrEventListenerObject | null, o?: boolean | AddEventListenerOptions) {
    if ((this === window || this === document) && fn) H.listeners.push([this, type, fn]);
    return add.call(this, type, fn, o);
  };
  EventTarget.prototype.removeEventListener = function (this: EventTarget, type: string, fn: EventListenerOrEventListenerObject | null, o?: boolean | EventListenerOptions) {
    if (this === window || this === document) {
      const i = H.listeners.findIndex(([t, ty, f]) => t === this && ty === type && f === fn);
      if (i >= 0) H.listeners.splice(i, 1);
    }
    return rem.call(this, type, fn, o);
  };
  const seen = new Map<string, WeakSet<Element>>();
  const tick = () => {
    for (const id of roots) {
      let ws = seen.get(id);
      if (!ws) { ws = new WeakSet(); seen.set(id, ws); H.inst[id] = 0; }
      for (const el of Array.from(document.querySelectorAll(`[data-testid="${id}"]`))) if (!ws.has(el)) { ws.add(el); H.inst[id] += 1; }
    }
    for (const id of loading) {
      for (const el of Array.from(document.querySelectorAll(`[data-testid="${id}"]`))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) H.loadSeen[id] = (H.loadSeen[id] ?? 0) + 1;
      }
    }
    requestAnimationFrame(tick);
  };
  if (document.documentElement) requestAnimationFrame(tick);
  else addEventListener('DOMContentLoaded', () => requestAnimationFrame(tick));
}
type Snap = { inst: Record<string, number>; loadSeen: Record<string, number>; intervals: number; listeners: number; history: number; mountedRoots: number };
const snap = (page: Page): Promise<Snap> =>
  page.evaluate((roots) => {
    const H = (window as unknown as { __w7h: { inst: Record<string, number>; loadSeen: Record<string, number>; intervals: Set<unknown>; listeners: unknown[] } }).__w7h;
    return {
      inst: { ...H.inst }, loadSeen: { ...H.loadSeen }, intervals: H.intervals.size, listeners: H.listeners.length, history: history.length,
      mountedRoots: roots.reduce((n, id) => n + document.querySelectorAll(`[data-testid="${id}"]`).length, 0),
    };
  }, ROOTS);

function counter(page: Page) {
  const c = { callables: [] as string[], listens: 0 };
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.port === '5001') c.callables.push(u.pathname.split('/').pop() ?? '');
    else if (u.port === '8080' && /Listen\/channel/.test(u.pathname)) c.listens += 1;
  });
  return c;
}
const shown = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).first();
const currentTab = (page: Page) => page.evaluate(() => (document.querySelector('[data-testid="wsf-member-tabs"] [data-current="true"]') as HTMLElement | null)?.getAttribute('data-testid') ?? null);
const focused = (page: Page) => page.evaluate(() => (document.activeElement?.closest('[data-testid]') as HTMLElement | null)?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? null);
const TAB_ROOT: Record<string, string> = { home: 'wsf-community', community: 'wsf-community-index', activity: 'wsf-activity', you: 'wsf-you' };
async function tab(page: Page, key: string, settleMs = 900) {
  await shown(page, `wsf-member-tab-${key}`).click({ timeout: 10_000 });
  await expect(shown(page, TAB_ROOT[key])).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(settleMs);
}
async function scrollOf(page: Page, id: string): Promise<number | null> {
  return page.evaluate((tid) => {
    const el = Array.from(document.querySelectorAll(`[data-testid="${tid}"]`)).find((e) => e.getBoundingClientRect().height > 0);
    if (!el) return null;
    for (const n of [el, ...Array.from(el.querySelectorAll('*'))]) if (n.scrollHeight > n.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(n).overflowY)) return Math.round(n.scrollTop);
    for (let n: Element | null = el.parentElement; n; n = n.parentElement) if (n.scrollHeight > n.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(n).overflowY)) return Math.round(n.scrollTop);
    return 0;
  }, id);
}
async function scrollBy(page: Page, id: string, dy: number) {
  await page.evaluate(([tid, d]) => {
    const el = Array.from(document.querySelectorAll(`[data-testid="${tid}"]`)).find((e) => e.getBoundingClientRect().height > 0);
    const c = el ? [el, ...Array.from(el.querySelectorAll('*'))] : [];
    for (let n: Element | null = el ?? null; n; n = n.parentElement) c.push(n);
    const s = c.find((n) => n.scrollHeight > n.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(n).overflowY));
    if (s) s.scrollTop += d as number;
  }, [id, dy] as const);
}
const tally = (xs: string[]) => xs.reduce<Record<string, number>>((a, x) => ((a[x] = (a[x] ?? 0) + 1), a), {});

type Verdict = { row: string; result: 'PASS' | 'FAIL' | 'CANNOT-MEASURE'; detail?: unknown };
function verdicts() {
  const out: Verdict[] = [];
  return {
    out,
    row(row: string, ok: boolean | null, detail?: unknown) {
      const result = ok === null ? 'CANNOT-MEASURE' : ok ? 'PASS' : 'FAIL';
      out.push({ row, result, detail });
      if (ok !== null) expect.soft(ok, `${row} — ${JSON.stringify(detail)}`).toBe(true);
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════

test.describe(`W7 HARDENED-MEMBER-JOURNEY-1 (${LABEL})`, () => {
  test('H1 mounted navigation: 10 warm cycles, no loading, one instance per route, no growth', async ({ page }) => {
    test.setTimeout(300_000);
    await page.addInitScript(hardenInstrument, { roots: ROOTS, loading: LOADING });
    const fx = await fixture('h1');
    const c = counter(page);
    await signInVia(page, fx.email, fx.password);
    await expect(shown(page, 'wsf-community')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(1_500);
    for (const k of ['community', 'activity', 'you', 'home']) await tab(page, k); // warm pass: every route mounted once
    const warm = await snap(page);
    const cycles: Array<{ cycle: number; callables: Record<string, number>; listens: number; snap: Snap; loadDelta: number }> = [];
    let prevLoad = Object.values(warm.loadSeen).reduce((a, b) => a + b, 0);
    for (let i = 1; i <= 10; i += 1) {
      const c0 = c.callables.length, l0 = c.listens;
      for (const k of ['community', 'activity', 'you', 'home']) await tab(page, k, 700);
      const s = await snap(page);
      const load = Object.values(s.loadSeen).reduce((a, b) => a + b, 0);
      cycles.push({ cycle: i, callables: tally(c.callables.slice(c0)), listens: c.listens - l0, snap: s, loadDelta: load - prevLoad });
      prevLoad = load;
    }
    const v = verdicts();
    const c2 = cycles[1]!, c10 = cycles[9]!;
    const count = (x: Record<string, number>) => Object.values(x).reduce((a, b) => a + b, 0);
    v.row('H1a warm switches paint no loading frame (10 cycles)', cycles.every((x) => x.loadDelta === 0), cycles.map((x) => x.loadDelta));
    v.row('H1b one mounted instance per route (no remount after the warm pass)',
      ['wsf-community', 'wsf-community-index', 'wsf-activity', 'wsf-you'].every((id) => (c10.snap.inst[id] ?? 0) === (warm.inst[id] ?? 0)),
      { warm: warm.inst, after10: c10.snap.inst });
    v.row('H1c mounted screen roots do not grow (cycle 2 → 10)', c10.snap.mountedRoots <= c2.snap.mountedRoots, { c2: c2.snap.mountedRoots, c10: c10.snap.mountedRoots });
    v.row('H1d live intervals do not grow', c10.snap.intervals <= c2.snap.intervals, { c2: c2.snap.intervals, c10: c10.snap.intervals });
    v.row('H1e net window/document listeners do not grow', c10.snap.listeners <= c2.snap.listeners, { c2: c2.snap.listeners, c10: c10.snap.listeners });
    v.row('H1f callables per cycle do not grow', count(c10.callables) <= count(c2.callables), { c2: c2.callables, c10: c10.callables });
    v.row('H1g Firestore listen channels per cycle do not grow', c10.listens <= c2.listens, { c2: c2.listens, c10: c10.listens });
    measure('H1 cycles', cycles.map((x) => ({ cycle: x.cycle, callables: count(x.callables), listens: x.listens, intervals: x.snap.intervals, listeners: x.snap.listeners, history: x.snap.history, roots: x.snap.mountedRoots, loadDelta: x.loadDelta })));
    measure('H1 verdicts', v.out);
  });

  test('H2 MOVE lifecycle: 10 open / Close cycles from Home, Progress and You; one confirmed contribution never resubmits', async ({ page }) => {
    test.setTimeout(420_000);
    await page.setViewportSize({ width: 390, height: 640 }); // short phone, and 3 closed goals, so every opener scrolls
    await page.addInitScript(hardenInstrument, { roots: ROOTS, loading: LOADING });
    const fx = await fixture('h2', 3);
    const c = counter(page);
    await signInVia(page, fx.email, fx.password);
    await expect(shown(page, 'wsf-community')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(1_500);
    const v = verdicts();
    const closeSheet = async () => {
      const close = page.locator('[data-testid="wsf-contribute-close"]:visible');
      await ((await close.count()) ? close.first() : shown(page, 'wsf-contribute-back')).click({ timeout: 10_000 });
      await page.waitForTimeout(800);
    };
    for (const opener of ['home', 'activity', 'you']) {
      await tab(page, opener);
      await scrollBy(page, TAB_ROOT[opener], 150);
      const scroll0 = await scrollOf(page, TAB_ROOT[opener]);
      const visits: Array<{ i: number; tab: string | null; focus: string | null; scroll: number | null; sheets: number; bars: number; calls: number }> = [];
      for (let i = 1; i <= 10; i += 1) {
        const c0 = c.callables.length;
        await shown(page, 'wsf-member-tab-move').click({ timeout: 10_000 });
        await expect(page.locator('[data-testid="wsf-contribute-sheet-panel"]:visible, [data-testid="wsf-move-sheet"]:visible').first()).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(500);
        await closeSheet();
        visits.push({
          i, tab: await currentTab(page), focus: await focused(page), scroll: await scrollOf(page, TAB_ROOT[opener]),
          sheets: await page.locator('[data-testid="wsf-contribute-sheet-panel"]:visible, [data-testid="wsf-move-sheet"]:visible').count(),
          bars: await page.locator('[data-testid="wsf-member-tabs"]:visible').count(), calls: c.callables.length - c0,
        });
      }
      const openerTab = `wsf-member-tab-${opener}`;
      v.row(`H2a [${opener}] Close returns to the opener tab (10/10)`, visits.every((x) => x.tab === openerTab), visits.map((x) => x.tab));
      v.row(`H2b [${opener}] focus returns to the MOVE control (10/10)`, visits.every((x) => x.focus === 'wsf-member-tab-move'), visits.map((x) => x.focus));
      v.row(`H2c [${opener}] opener scroll kept (10/10)`, scroll0 !== null && scroll0 > 0 ? visits.every((x) => x.scroll === scroll0) : null, { scroll0, after: visits.map((x) => x.scroll) });
      v.row(`H2d [${opener}] one tab bar, no sheet left (10/10)`, visits.every((x) => x.bars === 1 && x.sheets === 0), visits.map((x) => `${x.bars}/${x.sheets}`));
      v.row(`H2e [${opener}] requests per visit do not grow (visit 2 → 10)`, visits[9]!.calls <= visits[1]!.calls, visits.map((x) => x.calls));
    }
    // One confirmed contribution, then 5 more open / Close cycles.
    await tab(page, 'home');
    const contributes0 = c.callables.filter((x) => x === 'wsfContribute').length;
    await shown(page, 'wsf-member-tab-move').click({ timeout: 10_000 });
    await shown(page, 'wsf-contribute-skip-timer').click({ timeout: 30_000 });
    await shown(page, 'wsf-contribute-entry').fill('20');
    await shown(page, 'wsf-contribute-review').click({ timeout: 10_000 });
    await shown(page, 'wsf-contribute-submit').click({ timeout: 20_000 });
    await expect(shown(page, 'wsf-contribute-receipt')).toBeVisible({ timeout: 30_000 });
    await closeSheet();
    for (let i = 0; i < 5; i += 1) {
      await shown(page, 'wsf-member-tab-move').click({ timeout: 10_000 });
      await page.waitForTimeout(1_200);
      await closeSheet();
    }
    const q = { structuredQuery: { from: [{ collectionId: 'wsfContributions' }], where: { compositeFilter: { op: 'AND', filters: [
      { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: fx.uid } } },
      { fieldFilter: { field: { fieldPath: 'goalId' }, op: 'EQUAL', value: { stringValue: fx.goalId } } },
    ] } } } };
    const res = await fetch(`${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`, { method: 'POST', headers: OWNER, body: JSON.stringify(q) });
    const rowsFound = ((await res.json()) as Array<{ document?: unknown }>).filter((x) => x.document).length;
    const contributes = c.callables.filter((x) => x === 'wsfContribute').length - contributes0;
    v.row('H2f one confirmed contribution: one wsfContribute and one ledger row after 5 more open / Close cycles', contributes === 1 && rowsFound === 1, { contributes, rowsFound });
    measure('H2 verdicts', v.out);
  });
  test('H3 slow refresh: known content stays through a 1.5 s hold; one failed refresh never becomes zero or empty; Retry reads once', async ({ page }) => {
    test.setTimeout(300_000);
    await page.addInitScript(hardenInstrument, { roots: ROOTS, loading: LOADING });
    const fx = await fixture('h3');
    const c = counter(page);
    await signInVia(page, fx.email, fx.password);
    await expect(shown(page, 'wsf-community')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(1_500);
    for (const k of ['community', 'activity', 'you', 'home']) await tab(page, k);
    const v = verdicts();
    const load = async () => Object.values((await snap(page)).loadSeen).reduce((a, b) => a + b, 0);
    const known: Record<string, RegExp> = { home: new RegExp(fx.title), community: new RegExp(fx.community), activity: /35\s*squats/i, you: /35\s*squats/i };
    const rootText = (k: string) => page.locator(`[data-testid="${TAB_ROOT[k]}"]:visible`).first().innerText({ timeout: 3_000 }).catch(() => '');
    // (a) every read held 1.5 s (INJECTED delay of real answers).
    await page.route('**/us-central1/**', async (r) => { await new Promise((res) => setTimeout(res, 1_500)); await r.continue(); });
    const held: Record<string, { knownAt300: boolean; loadDelta: number; calls: number }> = {};
    for (const k of ['community', 'activity', 'you', 'home']) {
      const l0 = await load(); const c0 = c.callables.length;
      await shown(page, `wsf-member-tab-${k}`).click({ timeout: 10_000 });
      await page.waitForTimeout(300);
      const t = await rootText(k);
      await page.waitForTimeout(1_900);
      held[k] = { knownAt300: known[k]!.test(t), loadDelta: (await load()) - l0, calls: c.callables.length - c0 };
    }
    await page.unrouteAll({ behavior: 'wait' });
    v.row('H3a known content visible 300 ms into a held refresh, no loading frame (all four routes)', Object.values(held).every((x) => x.knownAt300 && x.loadDelta === 0), held);
    // (b) the next refresh fails: every read 500 while it runs (INJECTED). A failure that a later read in the
    // same window recovers from is not a failed refresh (first run's lesson: Home's pulse poll re-read and recovered).
    await page.route('**/us-central1/**', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"status":"INTERNAL","message":"injected"}}' }));
    const STALE = /last known|could(n.t| not)|checking|retry|try again|unavailable|not live/i;
    const failed: Record<string, { text: string; fakeZero: boolean; emptyClaim: boolean; staleWord: boolean; staleAtMs: number | null; issued: number }> = {};
    for (const k of ['community', 'activity', 'you', 'home']) {
      const c0 = c.callables.length;
      const t0 = Date.now();
      await shown(page, `wsf-member-tab-${k}`).click({ timeout: 10_000 });
      // Sampled every 250 ms for 8 s: a fake zero / empty claim at ANY sample fails H3b; the first stale wording is timed.
      let fakeZero = false, emptyClaim = false, staleAtMs: number | null = null, t = '';
      while (Date.now() - t0 < 8_000) {
        t = (await rootText(k)).replace(/\s+/g, ' ');
        fakeZero ||= /\b0\s*squats\b|\b0\s*(of|\/)\s*500\b|\b0(\.0)?%/i.test(t);
        emptyClaim ||= /your first contribution will appear here|haven.t recorded anything|no goal running|no active goal|not in a community/i.test(t);
        if (staleAtMs === null && STALE.test(t)) staleAtMs = Date.now() - t0;
        await page.waitForTimeout(250);
      }
      failed[k] = { text: t.slice(0, 220), issued: c.callables.length - c0, fakeZero, emptyClaim, staleWord: staleAtMs !== null, staleAtMs };
    }
    await page.unrouteAll({ behavior: 'wait' });
    v.row('H3b a failed refresh (every read 500) never becomes a fake zero or an empty claim (all four routes)', Object.values(failed).every((x) => !x.fakeZero && !x.emptyClaim), failed);
    v.row('H3c where a refresh was issued and failed, the screen says so within 8 s (last-known / retry semantics)',
      Object.values(failed).some((x) => x.issued > 0) ? Object.values(failed).every((x) => x.issued === 0 || x.staleWord) : null,
      Object.fromEntries(Object.entries(failed).map(([k, x]) => [k, { issued: x.issued, staleAtMs: x.staleAtMs, text: x.text }])));
    // (c) Retry performs one fresh read.
    let retry: { found: string | null; calls: Record<string, number> } = { found: null, calls: {} };
    for (const k of ['home', 'activity', 'you', 'community']) {
      await shown(page, `wsf-member-tab-${k}`).click({ timeout: 10_000 });
      await page.waitForTimeout(800);
      const btn = page.locator(`[data-testid="${TAB_ROOT[k]}"]:visible`).first().getByText(/^(retry|try again|refresh)$/i).first();
      if (await btn.count()) {
        const c0 = c.callables.length;
        await btn.click({ timeout: 5_000 });
        await page.waitForTimeout(3_000);
        retry = { found: k, calls: tally(c.callables.slice(c0)) };
        break;
      }
    }
    v.row('H3d Retry performs one fresh read (no callable repeated)', retry.found ? Object.keys(retry.calls).length > 0 && Object.values(retry.calls).every((n) => n === 1) : null, retry);
    measure('H3 verdicts', v.out);
  });

  test('H4a account switch: a pending A refresh released into B’s session never shows A', async ({ page }) => {
    test.setTimeout(360_000);
    await page.addInitScript(hardenInstrument, { roots: ROOTS, loading: LOADING });
    await page.addInitScript(() => {
      const W = { watch: [] as string[], hits: [] as string[] };
      (window as unknown as { __w7t: typeof W }).__w7t = W;
      const tick = () => { const t = document.body?.innerText ?? ''; for (const w of W.watch) if (t.includes(w) && !W.hits.includes(w)) W.hits.push(w); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const setWatch = (w: string[]) => page.evaluate((x) => { const W = (window as unknown as { __w7t: { watch: string[]; hits: string[] } }).__w7t; W.watch = x; W.hits = []; }, w);
    const hits = () => page.evaluate(() => (window as unknown as { __w7t: { hits: string[] } }).__w7t.hits.slice());
    const v = verdicts();
    // (a) A warm; A's refresh held; A signs out in the page; B signs in; A's answers released.
    const a = await fixture('h4a');
    const b = await fixture('h4b');
    await signInVia(page, a.email, a.password);
    await expect(shown(page, 'wsf-community')).toBeVisible({ timeout: 40_000 });
    for (const k of ['community', 'activity', 'you', 'home']) await tab(page, k);
    const gate: { open: boolean; waiting: Array<() => void> } = { open: false, waiting: [] };
    await page.route('**/us-central1/**', async (r) => {
      if (!gate.open) await new Promise<void>((res) => gate.waiting.push(res));
      await r.continue();
    });
    await shown(page, 'wsf-member-tab-activity').click({ timeout: 10_000 });
    await shown(page, 'wsf-member-tab-home').click({ timeout: 10_000 }); // Home's revalidation for A is now held
    await page.waitForTimeout(800);
    const heldForA = gate.waiting.length;
    gate.open = true; // later requests (B's) pass; A's stay held until released below
    await shown(page, 'wsf-member-topbar-menu-button').click({ timeout: 10_000 });
    await shown(page, 'wsf-member-topbar-menu-signout').click({ timeout: 10_000 });
    await page.waitForTimeout(1_500);
    await page.evaluate(() => { (window as unknown as { __w7doc: string }).__w7doc = 'A-document'; });
    await setWatch([a.title, a.community, a.name]);
    await page.evaluate(() => { history.pushState({}, '', '/signin'); dispatchEvent(new PopStateEvent('popstate', { state: {} })); });
    await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('wsf-signin-email').fill(b.email);
    await page.getByTestId('wsf-signin-password').fill(b.password);
    await page.getByTestId('wsf-signin-submit').click();
    await expect(shown(page, 'wsf-community')).toBeVisible({ timeout: 40_000 });
    for (const release of gate.waiting.splice(0)) release(); // A's held answers now arrive in B's session
    await page.waitForTimeout(2_500);
    for (const k of ['community', 'activity', 'you', 'home']) await tab(page, k);
    const same = (await page.evaluate(() => (window as unknown as { __w7doc?: string }).__w7doc ?? 'reloaded')) === 'A-document';
    const aSeen = await hits();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    v.row('H4a a pending A refresh released into B’s session never shows A (same document)', heldForA > 0 && same ? aSeen.length === 0 : null, { heldForA, sameDocument: same, aSeen });
    measure('H4a', { heldForA, sameDocument: same, aSeen });
    measure('H4 verdicts', v.out);
  });

  test('H4b removal: an older pre-removal answer, released after a fresh refusal, cannot resurrect the community', async ({ page }) => {
    test.setTimeout(300_000);
    await page.addInitScript(hardenInstrument, { roots: ROOTS, loading: LOADING });
    const v = verdicts();
    const m = await fixture('h4m');
    await signInVia(page, m.email, m.password);
    await expect(shown(page, 'wsf-community')).toBeVisible({ timeout: 40_000 });
    for (const k of ['community', 'activity', 'you', 'home']) await tab(page, k);
    const old: { armed: boolean; captured: number; release: (() => void) | null } = { armed: true, captured: 0, release: null };
    await page.route('**/wsfListGoals', async (r) => {
      if (!old.armed) return r.continue();
      old.armed = false;
      const res = await r.fetch(); // the REAL pre-removal answer ...
      old.captured += 1;
      await new Promise<void>((resolve) => { old.release = resolve; });
      return r.fulfill({ response: res }); // ... delivered after the refusal (INJECTED delay)
    });
    await shown(page, 'wsf-member-tab-community').click({ timeout: 10_000 });
    await shown(page, 'wsf-member-tab-home').click({ timeout: 10_000 });
    await expect.poll(() => old.captured, { timeout: 15_000 }).toBe(1);
    await fetch(docUrl(`wsfMemberships/${m.groupId}_${m.uid}`), { method: 'DELETE', headers: OWNER });
    const refusals: string[] = [];
    page.on('response', (res) => { const u = new URL(res.url()); if (u.port === '5001' && res.status() >= 400) refusals.push(`${u.pathname.split('/').pop()} ${res.status()}`); });
    await tab(page, 'community', 1_500);
    await tab(page, 'home', 2_500); // a fresh read meets the refusal
    old.release?.();
    await page.waitForTimeout(3_000);
    const after: Record<string, boolean> = {};
    for (const k of ['home', 'community', 'activity', 'you']) {
      await tab(page, k, 1_500);
      const t = await page.locator(`[data-testid="${TAB_ROOT[k]}"]:visible`).first().innerText({ timeout: 3_000 }).catch(() => '');
      after[k] = t.includes(m.title);
    }
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    v.row('H4b after a fresh refusal and a released older answer, no member surface offers the removed community’s goal',
      old.captured === 1 && refusals.length > 0 ? Object.values(after).every((x) => !x) : null, { refusals, goalShownOn: after });
    measure('H4b verdicts', v.out);
  });
});
