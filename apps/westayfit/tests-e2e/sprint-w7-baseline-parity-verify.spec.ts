import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { seedActiveGoal, seedCommunity, seedMembership, seedProfile, seedVerifiedUser, signInVia, stampId } from './helpers/mobile';

/**
 * W7 — CHECK 35: BASELINE PARITY, exact served/integrated `502b1e8d`
 * (Director #434 `5834104466`; owner packet #365 `5834082617`, W7 section).
 *
 * OBSERVATION, NOT ACCEPTANCE. Each case records what the baseline actually
 * does and measures it; assertions are limited to the harness having reached
 * the state it claims to measure (so a measurement is never taken on the wrong
 * screen). Behaviour is reported from the MEASURE lines, not from pass/fail.
 *
 *   P1  one-goal MOVE from each of the four tabs: resolver sheet -> full-page
 *       contribution; tap->first feedback, tap->content, callables, mounts,
 *       tab bar on top or covered, motion frames; then Back, and where it lands.
 *   P2  zero-goal and two-goal MOVE (Home): what the sheet holds, timings.
 *   P3  Community loading: cold load of /community/<id> and the soft entry from
 *       the Community tab — the FormShell "Your community" frame, its duration.
 *   P4  warm tab returns (Home <-> You, Progress twice), masthead Home from You
 *       and from Home, active reselect: remounts, loading flashes, callables,
 *       scroll kept or lost.
 *   P5  Settings from You and from the menu: presentation (tab bar / top bar
 *       on top?), motion, Back, and what You is on return.
 *   P1/P3/P5 are repeated at 390x640 and with reduced motion.
 *
 * Timestamps are wall-clock ms (page Date.now and runner Date.now, same host).
 * Local emulators, one Chromium, synthetic fixtures: NOT a speed claim.
 */

const PASSWORD = 'Sup3rSecret!23';
const BASE = process.env.WSF_PLAYWRIGHT_BASE_URL;
const VIDEO_DIR = process.env.W7_VIDEO_DIR;
test.skip(!BASE, 'Set WSF_PLAYWRIGHT_BASE_URL to the emulator-flagged build under test.');

const WATCH = [
  'wsf-member-tabs',
  'wsf-member-topbar',
  'wsf-home-loading',
  'wsf-home-opening-community',
  'wsf-home-my-list',
  'wsf-community-loading',
  'wsf-community',
  'wsf-community-index',
  'wsf-community-index-loading',
  'wsf-activity',
  'wsf-activity-loading',
  'wsf-you',
  'wsf-you-loading',
  'wsf-you-member',
  'wsf-move-screen',
  'wsf-move-sheet',
  'wsf-move-working',
  'wsf-move-choose',
  'wsf-move-no-goal',
  'wsf-move-error',
  'wsf-contribute-move-screen',
  'wsf-contribute-context',
  'wsf-contribute-back',
  'wsf-settings-screen',
];
/** Surfaces whose position/opacity is sampled for 30 frames after they appear. */
const MOTION = ['wsf-move-sheet', 'wsf-contribute-move-screen', 'wsf-settings-screen', 'wsf-community', 'wsf-you', 'wsf-activity'];

function initScript({ WATCH: ids, MOTION: motion }: { WATCH: string[]; MOTION: string[] }) {
  type Ev = Record<string, unknown> & { k: string; t: number };
  const W: { ev: Ev[]; inst: Record<string, number>; shown: Record<string, boolean>; path: string } = {
    ev: [],
    inst: {},
    shown: {},
    path: location.pathname + location.search,
  };
  (window as unknown as { __w7: typeof W }).__w7 = W;
  const now = () => Date.now();
  const tid = (el: Element | null) => (el?.closest?.('[data-testid]') as HTMLElement | null)?.getAttribute('data-testid') ?? null;
  addEventListener('pointerdown', (e) => W.ev.push({ k: 'down', id: tid(e.target as Element), t: now() }), true);
  addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') W.ev.push({ k: 'key', key: e.key, id: tid(document.activeElement), t: now() });
  }, true);
  const seen = new Map<string, WeakSet<Element>>();
  const vis = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cv = (el as HTMLElement & { checkVisibility?: (o: object) => boolean }).checkVisibility;
    return cv ? cv.call(el, { visibilityProperty: true }) : true;
  };
  const opacity = (el: Element | null) => {
    let o = 1;
    for (let n = el; n && n instanceof Element; n = n.parentElement) o *= Number(getComputedStyle(n).opacity || '1');
    return Math.round(o * 1000) / 1000;
  };
  const sample = (id: string, el: Element) => {
    let n = 0;
    const tick = () => {
      const r = el.getBoundingClientRect();
      W.ev.push({ k: 'frame', id, n, top: Math.round(r.top * 10) / 10, left: Math.round(r.left * 10) / 10, op: opacity(el), t: now() });
      n += 1;
      if (n < 30) requestAnimationFrame(tick);
    };
    tick();
  };
  let top: string | null = null;
  const check = () => {
    const t = now();
    const p = location.pathname + location.search;
    if (p !== W.path) {
      W.path = p;
      W.ev.push({ k: 'path', p, t });
    }
    // Which watched screen is actually ON TOP at the viewport's centre (tab
    // scenes stay laid out underneath the active one, so "shown" alone is not
    // "what the member sees").
    let hit: Element | null = document.elementFromPoint(innerWidth / 2, innerHeight * 0.45);
    let found: string | null = null;
    for (; hit && !found; hit = hit.parentElement) {
      const id = hit.getAttribute('data-testid');
      if (id && ids.includes(id) && id !== 'wsf-member-tabs' && id !== 'wsf-member-topbar') found = id;
    }
    if (found !== top) {
      top = found;
      W.ev.push({ k: 'top', id: found, t });
    }
    for (const id of ids) {
      let ws = seen.get(id);
      if (!ws) {
        ws = new WeakSet();
        seen.set(id, ws);
        W.inst[id] = 0;
      }
      let shownEl: Element | null = null;
      for (const el of Array.from(document.querySelectorAll(`[data-testid="${id}"]`))) {
        if (!ws.has(el)) {
          ws.add(el);
          W.inst[id] += 1;
          W.ev.push({ k: 'mount', id, n: W.inst[id], t });
        }
        if (!shownEl && vis(el)) shownEl = el;
      }
      const s = shownEl !== null;
      if (s !== !!W.shown[id]) {
        W.shown[id] = s;
        W.ev.push({ k: s ? 'show' : 'hide', id, t });
        if (s && motion.includes(id)) sample(id, shownEl as Element);
      }
    }
  };
  const start = () => {
    new MutationObserver(check).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'aria-hidden'],
    });
    const loop = () => {
      check();
      requestAnimationFrame(loop);
    };
    loop();
  };
  if (document.documentElement) start();
  else addEventListener('DOMContentLoaded', start);
}

type Ev = { k: string; t: number; id?: string | null; p?: string; n?: number; top?: number; left?: number; op?: number; key?: string };
type Req = { kind: 'callable' | 'firestore'; name: string; t: number };

class Run {
  reqs: Req[] = [];
  constructor(public page: Page, public ctx: BrowserContext) {
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.port === '5001') this.reqs.push({ kind: 'callable', name: u.pathname.split('/').pop() ?? '', t: Date.now() });
      else if (u.port === '8080') this.reqs.push({ kind: 'firestore', name: u.pathname.replace(/.*\/documents/, '').slice(0, 80) || u.pathname.slice(-40), t: Date.now() });
    });
  }
  async events(since: number): Promise<Ev[]> {
    const all = (await this.page.evaluate(() => (window as unknown as { __w7: { ev: Ev[] } }).__w7.ev)) as Ev[];
    return all.filter((e) => e.t >= since);
  }
  async inst(): Promise<Record<string, number>> {
    return (await this.page.evaluate(() => ({ ...(window as unknown as { __w7: { inst: Record<string, number> } }).__w7.inst }))) as Record<string, number>;
  }
}

async function open(browser: Browser, name: string, opts: { height?: number; reduced?: boolean } = {}): Promise<Run> {
  const ctx = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 390, height: opts.height ?? 844 },
    reducedMotion: opts.reduced ? 'reduce' : 'no-preference',
    ...(VIDEO_DIR ? { recordVideo: { dir: `${VIDEO_DIR}/${name}`, size: { width: 390, height: opts.height ?? 844 } } } : {}),
  });
  await ctx.addInitScript(initScript, { WATCH, MOTION });
  const page = await ctx.newPage();
  return new Run(page, ctx);
}

type Fx = { email: string; uid: string; groupId: string; goalIds: string[] };

async function seed(tag: string, goals: number): Promise<Fx> {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-w7-c35-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `w7c35-${stamp}`;
  const dana = `w7c35-dana-${stamp}`;
  await seedCommunity({ groupId, displayName: 'Alpharetta Morning Movers', joinPolicy: 'private', members: [{ uid, role: 'member' }] });
  await seedMembership(groupId, dana, 'foundingChampion');
  await seedProfile(dana, 'Dana Whitfield');
  const goalIds: string[] = [];
  const titles = ['October Squat Challenge', 'Walk to the Coast'];
  for (let i = 0; i < goals; i += 1) {
    const goalId = `w7c35g${i}-${stamp}`;
    await seedActiveGoal({ goalId, groupId, ownerUid: dana, title: titles[i], target: 5000, unit: i === 0 ? 'squats' : 'minutes', total: 1847 + i });
    goalIds.push(goalId);
  }
  return { email, uid, groupId, goalIds };
}

const shown = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).first();

function measure(label: string, value: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`MEASURE ${label}: ${JSON.stringify(value)}`);
  test.info().annotations.push({ type: 'measure', description: `${label}: ${JSON.stringify(value)}` });
}

/** Summarise one tap: first feedback = the first show/path event after the pointerdown (tab bar / top bar excluded). */
async function summarise(run: Run, since: number, contentId: string | null) {
  const ev = await run.events(since);
  const down = ev.find((e) => e.k === 'down' || e.k === 'key');
  const t0 = down?.t ?? since;
  const after = ev.filter((e) => e.t >= t0 && e.k !== 'down' && e.k !== 'key' && e.k !== 'frame');
  const first = after.find((e) => (e.k === 'show' || e.k === 'path' || e.k === 'top') && e.id !== 'wsf-member-tabs' && e.id !== 'wsf-member-topbar');
  const content = contentId ? after.find((e) => (e.k === 'show' || e.k === 'top') && e.id === contentId) : undefined;
  const onTop = after.filter((e) => e.k === 'top').map((e) => `+${e.t - t0}ms ${e.id}`);
  const reqs = run.reqs.filter((r) => r.t >= t0);
  const callables: Record<string, number> = {};
  for (const r of reqs.filter((q) => q.kind === 'callable')) callables[r.name] = (callables[r.name] ?? 0) + 1;
  const timeline = after.map((e) => `+${e.t - t0}ms ${e.k} ${e.id ?? e.p ?? ''}${e.k === 'mount' ? `#${e.n}` : ''}`);
  const frames: Record<string, string> = {};
  for (const id of MOTION) {
    const f = ev.filter((e) => e.k === 'frame' && e.id === id);
    if (f.length) {
      // Collapse runs of identical frames: "top/left/op xN".
      const parts: string[] = [];
      let prev = '';
      let count = 0;
      for (const x of f) {
        const key = `${x.top}/${x.left}/${x.op}`;
        if (key === prev) count += 1;
        else {
          if (prev) parts.push(`${prev}x${count}`);
          prev = key;
          count = 1;
        }
      }
      parts.push(`${prev}x${count}`);
      frames[id] = `${f[f.length - 1].t - f[0].t}ms: ${parts.join(' ')}`;
    }
  }
  return {
    tapTo: down ? `${down.k}:${down.id}` : 'none',
    firstFeedbackMs: first ? `${first.t - t0} (${first.k} ${first.id ?? first.p})` : null,
    contentOnTopMs: contentId ? ((x) => (x ? x.t - t0 : null))(after.find((e) => e.k === 'top' && e.id === contentId)) : null,
    contentMs: content ? content.t - t0 : null,
    callables,
    firestoreRequests: reqs.filter((r) => r.kind === 'firestore').length,
    onTop,
    timeline,
    frames,
  };
}

/** Is the element at the tab bar's centre inside the tab bar (i.e. the bar is on top, not covered)? */
async function tabBarOnTop(page: Page): Promise<string> {
  return page.evaluate(() => {
    const bar = Array.from(document.querySelectorAll('[data-testid="wsf-member-tabs"]')).find((e) => e.getBoundingClientRect().height > 0);
    if (!bar) return 'absent';
    const r = bar.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width * 0.15, r.top + r.height / 2);
    return bar.contains(hit) ? 'on top' : `covered by ${(hit?.closest('[data-testid]') as HTMLElement | null)?.getAttribute('data-testid') ?? hit?.tagName}`;
  });
}
async function topBarOnTop(page: Page): Promise<string> {
  return page.evaluate(() => {
    const bar = Array.from(document.querySelectorAll('[data-testid="wsf-member-topbar"]')).find((e) => e.getBoundingClientRect().height > 0);
    if (!bar) return 'absent';
    const r = bar.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return bar.contains(hit) ? 'on top' : `covered by ${(hit?.closest('[data-testid]') as HTMLElement | null)?.getAttribute('data-testid') ?? hit?.tagName}`;
  });
}
const currentTab = (page: Page) =>
  page.evaluate(() => (document.querySelector('[data-testid="wsf-member-tabs"] [data-current="true"]') as HTMLElement | null)?.getAttribute('data-testid') ?? null);
const focused = (page: Page) => page.evaluate(() => (document.activeElement?.closest('[data-testid]') as HTMLElement | null)?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? null);
const path = (page: Page) => new URL(page.url()).pathname + new URL(page.url()).search;

/** The scroll offset of the visible scroller that holds `id` (0 when none scrolls). */
async function scrollOf(page: Page, id: string): Promise<number | null> {
  return page.evaluate((tid) => {
    const el = Array.from(document.querySelectorAll(`[data-testid="${tid}"]`)).find((e) => e.getBoundingClientRect().height > 0);
    if (!el) return null;
    for (let n: Element | null = el; n; n = n.parentElement) {
      if (n.scrollHeight > n.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(n).overflowY)) return Math.round(n.scrollTop);
    }
    for (const n of Array.from(el.querySelectorAll('*'))) {
      if (n.scrollHeight > n.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(n).overflowY)) return Math.round(n.scrollTop);
    }
    return 0;
  }, id);
}
async function scrollBy(page: Page, id: string, dy: number): Promise<void> {
  await page.evaluate(
    ([tid, d]) => {
      const el = Array.from(document.querySelectorAll(`[data-testid="${tid}"]`)).find((e) => e.getBoundingClientRect().height > 0);
      const cands = el ? [el, ...Array.from(el.querySelectorAll('*'))] : [];
      for (let n: Element | null = el ?? null; n; n = n.parentElement) cands.push(n);
      const s = cands.find((n) => n.scrollHeight > n.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(n).overflowY));
      if (s) s.scrollTop += d as number;
    },
    [id, dy] as const,
  );
}

async function signedInAtCommunity(run: Run, fx: Fx): Promise<void> {
  await signInVia(run.page, fx.email, PASSWORD);
  await expect.poll(() => path(run.page), { timeout: 40_000 }).toBe(`/community/${fx.groupId}`);
  await expect(shown(run.page, 'wsf-community')).toBeVisible({ timeout: 40_000 });
  await run.page.waitForTimeout(1_500);
}

async function goTab(run: Run, key: 'home' | 'community' | 'activity' | 'you', ready: string): Promise<void> {
  await shown(run.page, `wsf-member-tab-${key}`).click();
  await expect(shown(run.page, ready)).toBeVisible({ timeout: 40_000 });
  await run.page.waitForTimeout(1_200);
}

const TAB_READY = { home: 'wsf-community', community: 'wsf-community-index', activity: 'wsf-activity', you: 'wsf-you' } as const;

async function moveOneGoal(run: Run, fx: Fx, label: string, from: keyof typeof TAB_READY): Promise<void> {
  const page = run.page;
  const beforeInst = await run.inst();
  const t = Date.now();
  await shown(page, 'wsf-member-tab-move').click();
  await expect(shown(page, 'wsf-contribute-move-screen')).toBeVisible({ timeout: 40_000 });
  await page.waitForTimeout(900);
  const s = await summarise(run, t, 'wsf-contribute-move-screen');
  const onArrival = {
    path: path(page),
    tabBar: await tabBarOnTop(page),
    topBar: await topBarOnTop(page),
    focus: await focused(page),
    moveSheetShownEver: s.timeline.some((l) => l.includes('show wsf-move-sheet')),
    backLabel: await shown(page, 'wsf-contribute-back').innerText().catch(() => null),
    goalTitle: await shown(page, 'wsf-contribute-goal-title').innerText().catch(() => null),
  };
  measure(`${label} MOVE from ${from}`, { ...s, onArrival });
  expect(onArrival.path).toContain(`/contribute/${fx.goalIds[0]}`);

  const t2 = Date.now();
  await shown(page, 'wsf-contribute-back').click();
  await expect(shown(page, TAB_READY[from])).toBeVisible({ timeout: 40_000 });
  await page.waitForTimeout(900);
  const back = await summarise(run, t2, TAB_READY[from]);
  const afterInst = await run.inst();
  measure(`${label} Back after MOVE from ${from}`, {
    path: path(page),
    currentTab: await currentTab(page),
    tabBar: await tabBarOnTop(page),
    remountedOrigin: afterInst[TAB_READY[from]] - (beforeInst[TAB_READY[from]] ?? 0),
    ...back,
  });
}

test.describe('W7 Check 35 · baseline parity at 502b1e8d', () => {
  test('P1 one-goal MOVE from each tab, then Back (390x844)', async ({ browser }) => {
    test.setTimeout(400_000);
    const fx = await seed('p1', 1);
    const run = await open(browser, 'p1');
    await signedInAtCommunity(run, fx);
    await moveOneGoal(run, fx, 'P1', 'home');
    await goTab(run, 'community', TAB_READY.community);
    await moveOneGoal(run, fx, 'P1', 'community');
    await goTab(run, 'activity', TAB_READY.activity);
    await moveOneGoal(run, fx, 'P1', 'activity');
    await goTab(run, 'you', TAB_READY.you);
    await moveOneGoal(run, fx, 'P1', 'you');
    await run.ctx.close();
  });

  for (const variant of [
    { name: 'P1s', height: 640, reduced: false },
    { name: 'P1r', height: 844, reduced: true },
  ]) {
    test(`${variant.name} one-goal MOVE from Home at 390x${variant.height}${variant.reduced ? ', reduced motion' : ''}`, async ({ browser }) => {
      test.setTimeout(200_000);
      const fx = await seed(variant.name.toLowerCase(), 1);
      const run = await open(browser, variant.name.toLowerCase(), variant);
      await signedInAtCommunity(run, fx);
      await moveOneGoal(run, fx, variant.name, 'home');
      await run.ctx.close();
    });
  }

  test('P2 zero-goal and two-goal MOVE from Home', async ({ browser }) => {
    test.setTimeout(300_000);
    for (const [n, label] of [
      [0, 'P2 zero goals'],
      [2, 'P2 two goals'],
    ] as const) {
      const fx = await seed(`p2g${n}`, n);
      const run = await open(browser, `p2g${n}`);
      await signedInAtCommunity(run, fx);
      const t = Date.now();
      await shown(run.page, 'wsf-member-tab-move').click();
      const target = n === 0 ? 'wsf-move-no-goal' : 'wsf-move-choose';
      await expect(shown(run.page, target)).toBeVisible({ timeout: 40_000 });
      await run.page.waitForTimeout(900);
      const s = await summarise(run, t, target);
      measure(label, {
        ...s,
        path: path(run.page),
        tabBar: await tabBarOnTop(run.page),
        topBar: await topBarOnTop(run.page),
        focus: await focused(run.page),
        sheetText: (await shown(run.page, 'wsf-move-sheet').innerText()).replace(/\s+/g, ' ').slice(0, 400),
      });
      if (n === 2) {
        const t2 = Date.now();
        await shown(run.page, `wsf-move-choose-${fx.goalIds[1]}`).click();
        await expect(shown(run.page, 'wsf-contribute-move-screen')).toBeVisible({ timeout: 40_000 });
        await run.page.waitForTimeout(900);
        measure(`${label} choose second`, { ...(await summarise(run, t2, 'wsf-contribute-move-screen')), path: path(run.page), tabBar: await tabBarOnTop(run.page) });
      } else {
        const t2 = Date.now();
        await shown(run.page, 'wsf-move-close').click();
        await expect(shown(run.page, 'wsf-move-screen')).toBeHidden({ timeout: 20_000 });
        await run.page.waitForTimeout(600);
        measure(`${label} close`, { ...(await summarise(run, t2, null)), path: path(run.page), focus: await focused(run.page) });
      }
      await run.ctx.close();
    }
  });

  for (const variant of [
    { name: 'P3', height: 844, reduced: false },
    { name: 'P3s', height: 640, reduced: false },
    { name: 'P3r', height: 844, reduced: true },
  ]) {
    test(`${variant.name} Community loading: cold load and soft entry from the Community tab`, async ({ browser }) => {
      test.setTimeout(240_000);
      const fx = await seed(variant.name.toLowerCase(), 1);
      const run = await open(browser, variant.name.toLowerCase(), variant);
      await signedInAtCommunity(run, fx);
      // Cold: a full document load of the community address.
      const t = Date.now();
      await run.page.goto(`/community/${fx.groupId}`);
      await expect(shown(run.page, 'wsf-community')).toBeVisible({ timeout: 40_000 });
      await run.page.waitForTimeout(900);
      const ev = await run.events(t);
      const cold = await summarise(run, t, 'wsf-community');
      const loadShow = ev.find((e) => e.k === 'show' && e.id === 'wsf-community-loading');
      const loadHide = ev.find((e) => e.k === 'hide' && e.id === 'wsf-community-loading');
      const heroShow = ev.find((e) => e.k === 'show' && e.id === 'wsf-community');
      measure(`${variant.name} cold /community/<id>`, {
        navToLoadingMs: loadShow ? loadShow.t - t : null,
        loadingVisibleMs: loadShow && loadHide ? loadHide.t - loadShow.t : null,
        navToContentMs: heroShow ? heroShow.t - t : null,
        callables: cold.callables,
        firestoreRequests: cold.firestoreRequests,
        timeline: cold.timeline.filter((l) => !l.includes('frame')).slice(0, 40),
      });
      if (loadShow) {
        // The frame itself, if it is still up when read (it usually is not).
        measure(`${variant.name} loading frame text`, 'recorded on video only (the frame is gone before a read)');
      }

      // Soft: Community tab -> its current-community panel -> the community.
      await goTab(run, 'community', TAB_READY.community);
      const cur = run.page.locator('[data-testid="wsf-community-index-current"]:visible').first();
      const panelText = (await cur.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
      const opener = cur.getByRole('link').or(cur.getByRole('button')).first();
      const canOpen = await opener.count();
      measure(`${variant.name} Community tab current panel`, { panelText, openers: canOpen, text: canOpen ? await opener.innerText() : null });
      if (canOpen) {
        const beforeInst = await run.inst();
        const t2 = Date.now();
        await opener.click();
        await expect(shown(run.page, 'wsf-community')).toBeVisible({ timeout: 40_000 });
        await run.page.waitForTimeout(900);
        const soft = await summarise(run, t2, 'wsf-community');
        const afterInst = await run.inst();
        measure(`${variant.name} soft entry from Community tab`, {
          ...soft,
          path: path(run.page),
          currentTab: await currentTab(run.page),
          communityInstancesAdded: afterInst['wsf-community'] - beforeInst['wsf-community'],
          loadingShown: soft.timeline.some((l) => l.includes('show wsf-community-loading')),
        });
      }
      await run.ctx.close();
    });
  }

  test('P3b soft community entries: after sign-in, from the Home list, Community-tab switch', async ({ browser }) => {
    test.setTimeout(240_000);
    const fx = await seed('p3b', 1);
    // A second community, so Home lists both and the Community tab can switch.
    const other = `${fx.groupId}-b`;
    await seedCommunity({ groupId: other, displayName: 'Roswell Riverside Walkers', joinPolicy: 'private', members: [{ uid: fx.uid, role: 'member' }] });
    const run = await open(browser, 'p3b');
    const page = run.page;
    let t = Date.now();
    await signInVia(page, fx.email, PASSWORD);
    await expect(shown(page, 'wsf-home-my-list')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(900);
    measure('P3b sign-in -> Home list (two communities)', { ...(await summarise(run, t, 'wsf-home-my-list')), path: path(page) });
    t = Date.now();
    await shown(page, `wsf-home-community-${fx.groupId}`).click();
    await expect(shown(page, 'wsf-community')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(900);
    const fromList = await summarise(run, t, 'wsf-community');
    const ev = await run.events(t);
    const ls = ev.find((e) => e.k === 'show' && e.id === 'wsf-community-loading');
    const lh = ev.find((e) => e.k === 'hide' && e.id === 'wsf-community-loading');
    measure('P3b Home list -> community', { ...fromList, path: path(page), loadingVisibleMs: ls && lh ? lh.t - ls.t : null });
    await goTab(run, 'community', TAB_READY.community);
    const inst = await run.inst();
    t = Date.now();
    await shown(page, `wsf-community-index-row-${other}`).click();
    await expect.poll(() => path(page), { timeout: 40_000 }).toBe(`/community/${other}`);
    await expect(shown(page, 'wsf-community')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(1_200);
    const sw = await summarise(run, t, 'wsf-community');
    const ev2 = await run.events(t);
    const ls2 = ev2.find((e) => e.k === 'show' && e.id === 'wsf-community-loading');
    const lh2 = ev2.find((e) => e.k === 'hide' && e.id === 'wsf-community-loading');
    measure('P3b Community tab Switch -> other community', {
      ...sw,
      path: path(page),
      currentTab: await currentTab(page),
      communityInstancesAdded: (await run.inst())['wsf-community'] - inst['wsf-community'],
      loadingVisibleMs: ls2 && lh2 ? lh2.t - ls2.t : null,
    });
    await run.ctx.close();
  });

  test('P4 warm tab returns, masthead Home, active reselect', async ({ browser }) => {
    test.setTimeout(300_000);
    const fx = await seed('p4', 1);
    const run = await open(browser, 'p4');
    const page = run.page;
    await signedInAtCommunity(run, fx);
    await scrollBy(page, 'wsf-community', 420);
    await page.waitForTimeout(400);
    const scrolled = await scrollOf(page, 'wsf-community');

    // Home -> You (cold first visit) -> Home (warm).
    let t = Date.now();
    await goTab(run, 'you', TAB_READY.you);
    measure('P4 first visit You (cold)', await summarise(run, t, 'wsf-you-member'));
    const inst0 = await run.inst();
    t = Date.now();
    await goTab(run, 'home', TAB_READY.home);
    const warmHome = await summarise(run, t, 'wsf-community');
    measure('P4 warm return You -> Home', {
      ...warmHome,
      scrollBefore: scrolled,
      scrollAfter: await scrollOf(page, 'wsf-community'),
      communityRemounts: (await run.inst())['wsf-community'] - inst0['wsf-community'],
      loadingShown: warmHome.timeline.some((l) => /show wsf-(community|home)-loading/.test(l)),
    });

    // Progress twice: cold, then warm.
    t = Date.now();
    await goTab(run, 'activity', TAB_READY.activity);
    measure('P4 first visit Progress (cold)', await summarise(run, t, 'wsf-activity'));
    await goTab(run, 'home', TAB_READY.home);
    const inst1 = await run.inst();
    t = Date.now();
    await goTab(run, 'activity', TAB_READY.activity);
    const warmProg = await summarise(run, t, 'wsf-activity');
    measure('P4 warm return Home -> Progress', {
      ...warmProg,
      activityRemounts: (await run.inst())['wsf-activity'] - inst1['wsf-activity'],
      loadingShown: warmProg.timeline.some((l) => l.includes('show wsf-activity-loading')),
    });

    // Active reselect on Progress and (after going Home) on Home.
    t = Date.now();
    await shown(page, 'wsf-member-tab-activity').click();
    await page.waitForTimeout(1_500);
    measure('P4 reselect Progress', { ...(await summarise(run, t, null)), path: path(page) });
    await goTab(run, 'home', TAB_READY.home);
    await page.waitForTimeout(3_000);
    // CONTROL: the same 1.5 s window on Home with no tap at all.
    t = Date.now();
    await page.waitForTimeout(1_500);
    measure('P4 idle control on Home (no tap, 1.5 s)', { callables: (await summarise(run, t, null)).callables });
    const sHome = await scrollOf(page, 'wsf-community');
    const inst2 = await run.inst();
    t = Date.now();
    await shown(page, 'wsf-member-tab-home').click();
    await page.waitForTimeout(1_500);
    measure('P4 reselect Home', {
      ...(await summarise(run, t, null)),
      path: path(page),
      scrollBefore: sHome,
      scrollAfter: await scrollOf(page, 'wsf-community'),
      communityRemounts: (await run.inst())['wsf-community'] - inst2['wsf-community'],
    });

    // Masthead Home from You, then from Home itself.
    await goTab(run, 'you', TAB_READY.you);
    const inst3 = await run.inst();
    t = Date.now();
    await shown(page, 'wsf-member-topbar-wordmark-home').click();
    await expect(shown(page, 'wsf-community')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(1_500);
    const mh = await summarise(run, t, 'wsf-community');
    measure('P4 masthead Home from You', {
      ...mh,
      path: path(page),
      currentTab: await currentTab(page),
      scrollAfter: await scrollOf(page, 'wsf-community'),
      communityRemounts: (await run.inst())['wsf-community'] - inst3['wsf-community'],
      homeListShown: mh.timeline.some((l) => /show wsf-home-(my-list|loading|opening-community)/.test(l)),
      loadingShown: mh.timeline.some((l) => l.includes('show wsf-community-loading')),
    });
    const inst4 = await run.inst();
    t = Date.now();
    await shown(page, 'wsf-member-topbar-wordmark-home').click();
    await page.waitForTimeout(2_000);
    const mh2 = await summarise(run, t, null);
    measure('P4 masthead Home from Home', {
      ...mh2,
      path: path(page),
      communityRemounts: (await run.inst())['wsf-community'] - inst4['wsf-community'],
    });
    await run.ctx.close();
  });

  for (const variant of [
    { name: 'P5', height: 844, reduced: false },
    { name: 'P5s', height: 640, reduced: false },
    { name: 'P5r', height: 844, reduced: true },
  ]) {
    test(`${variant.name} Settings from You and from the menu`, async ({ browser }) => {
      test.setTimeout(240_000);
      const fx = await seed(variant.name.toLowerCase(), 1);
      const run = await open(browser, variant.name.toLowerCase(), variant);
      const page = run.page;
      await signedInAtCommunity(run, fx);
      await goTab(run, 'you', TAB_READY.you);
      const inst0 = await run.inst();
      let t = Date.now();
      await shown(page, 'wsf-you-settings').click();
      await expect(shown(page, 'wsf-settings-screen')).toBeVisible({ timeout: 40_000 });
      await page.waitForTimeout(900);
      measure(`${variant.name} Settings from You`, {
        ...(await summarise(run, t, 'wsf-settings-screen')),
        path: path(page),
        tabBar: await tabBarOnTop(page),
        topBar: await topBarOnTop(page),
        focus: await focused(page),
      });
      t = Date.now();
      await shown(page, 'wsf-settings-back').click();
      await expect(shown(page, 'wsf-you')).toBeVisible({ timeout: 40_000 });
      await page.waitForTimeout(1_200);
      const back = await summarise(run, t, 'wsf-you');
      measure(`${variant.name} Settings Back`, {
        ...back,
        path: path(page),
        currentTab: await currentTab(page),
        youRemounts: (await run.inst())['wsf-you'] - inst0['wsf-you'],
        communityInstances: (await run.inst())['wsf-community'] - inst0['wsf-community'],
        youLoadingShown: back.timeline.some((l) => l.includes('show wsf-you-loading')),
      });
      // What Home is after that Back: kept, or rebuilt?
      const instH = await run.inst();
      t = Date.now();
      await goTab(run, 'home', TAB_READY.home);
      const home = await summarise(run, t, 'wsf-community');
      measure(`${variant.name} Home after Settings Back`, {
        ...home,
        path: path(page),
        communityInstancesAdded: (await run.inst())['wsf-community'] - instH['wsf-community'],
        loadingShown: home.timeline.some((l) => /show wsf-(community|home)-loading|opening-community/.test(l)),
      });

      // From the menu, while on Home.
      await goTab(run, 'home', TAB_READY.home);
      await shown(page, 'wsf-member-topbar-menu-button').click();
      await expect(shown(page, 'wsf-member-topbar-menu-settings')).toBeVisible({ timeout: 10_000 });
      t = Date.now();
      await shown(page, 'wsf-member-topbar-menu-settings').click();
      await expect(shown(page, 'wsf-settings-screen')).toBeVisible({ timeout: 40_000 });
      await page.waitForTimeout(900);
      measure(`${variant.name} Settings from the menu (on Home)`, {
        ...(await summarise(run, t, 'wsf-settings-screen')),
        path: path(page),
        tabBar: await tabBarOnTop(page),
        topBar: await topBarOnTop(page),
      });
      const inst1 = await run.inst();
      t = Date.now();
      await shown(page, 'wsf-settings-back').click();
      await expect(shown(page, 'wsf-you')).toBeVisible({ timeout: 40_000 });
      await page.waitForTimeout(1_200);
      measure(`${variant.name} Settings Back (opened from the menu on Home)`, {
        ...(await summarise(run, t, 'wsf-you')),
        path: path(page),
        currentTab: await currentTab(page),
        youRemounts: (await run.inst())['wsf-you'] - inst1['wsf-you'],
      });
      await run.ctx.close();
    });
  }

  test('P6 stills of the transient frames (INJECTED 1.5 s delays, visual only; no timing taken)', async ({ browser }) => {
    test.skip(!VIDEO_DIR, 'stills are written beside the clips');
    test.setTimeout(200_000);
    const fx = await seed('p6', 1);
    const run = await open(browser, 'p6');
    const page = run.page;
    await signedInAtCommunity(run, fx);
    const hold = { on: false };
    await page.route(/wsfMyCommunities|wsfListGoals/, async (route) => {
      if (hold.on) await new Promise((r) => setTimeout(r, 1_500)); // INJECTED delay
      return route.continue();
    });
    hold.on = true;
    await shown(page, 'wsf-member-tab-move').click();
    await expect(shown(page, 'wsf-move-working')).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${VIDEO_DIR}/still-move-working.png` });
    await expect(shown(page, 'wsf-contribute-move-screen')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${VIDEO_DIR}/still-contribute-move.png` });
    hold.on = false;
    await shown(page, 'wsf-contribute-back').click();
    await goTab(run, 'you', TAB_READY.you);
    hold.on = true;
    await shown(page, 'wsf-member-topbar-wordmark-home').click();
    await expect(shown(page, 'wsf-community-loading')).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${VIDEO_DIR}/still-community-loading-masthead-home.png` });
    await expect(shown(page, 'wsf-community')).toBeVisible({ timeout: 40_000 });
    hold.on = false;
    await goTab(run, 'you', TAB_READY.you);
    await shown(page, 'wsf-you-settings').click();
    await expect(shown(page, 'wsf-settings-screen')).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${VIDEO_DIR}/still-settings.png` });
    await run.ctx.close();
  });
});
