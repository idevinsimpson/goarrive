import { expect, test, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test';

import { seedActiveGoal, seedCommunity, seedMembership, seedProfile, seedVerifiedUser, signInVia, stampId } from './helpers/mobile';

/**
 * W7 — CHECK 36: APP-FEEL-PARITY-1 checkpoint 1 (#482), exact
 * `766ee0858a6189f5b26f17ac4ea6efa9d674c15e` on `502b1e8d` (Director #434
 * `5834554003`). Only the dependencies cp1 changed, against Check 35's
 * baseline (same harness, same fixtures, the base served beside it):
 *
 *   S1  one-goal MOVE from each tab: the flow is a sheet over the SAME mounted
 *       tab (instance kept, painted, inert); one visible scrim; focus enters
 *       the panel and Tab cannot leave it; Close returns to the same instance,
 *       exact scroll, focus back on the opener; exactly one exit.
 *   S2  two goals: chooser -> goal sheet over the chooser; one dim; Close.
 *   S3  every step renders inside the sheet: timer, count, review, confirmed;
 *       pending (INJECTED drop) and unknown (INJECTED reply lost + reconcile).
 *   S4  preserved as pages: cold direct link, "Already moved?", kiosk flag.
 *   S5  390x640 and reduced motion.
 *   R1  Close then browser Back inside the 180 ms exit.
 *   R2  Close on the resolver while its one-goal resolution lands.
 *   R3  Close then an immediate MOVE.
 *   L1  community cold-load composition (the FormShell frame's successor).
 * Each race is reported as measured (every path change and screen for 1.5 s
 * after); nothing is claimed from the source.
 * Timings: Chromium web, loopback emulators, synthetic data; not a speed claim
 * and not evidence about iOS / Android native motion or Safari's keyboard.
 */

const PASSWORD = 'Sup3rSecret!23';
const BASE = process.env.WSF_PLAYWRIGHT_BASE_URL;
const VIDEO_DIR = process.env.W7_VIDEO_DIR;
test.skip(!BASE, 'Set WSF_PLAYWRIGHT_BASE_URL to the emulator-flagged build under test.');
const LABEL = process.env.W7_LABEL ?? 'head';

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
  'wsf-contribute-sheet',
  'wsf-contribute-sheet-panel',
  'wsf-contribute-scrim',
  'wsf-move-scrim',
  'wsf-contribute-entry-screen',
  'wsf-contribute-review-screen',
  'wsf-contribute-receipt',
  'wsf-contribute-pending',
  'wsf-community-loading-status',
];
/** Surfaces whose position/opacity is sampled for 30 frames after they appear. */
const MOTION = ['wsf-move-sheet', 'wsf-contribute-sheet-panel', 'wsf-contribute-scrim', 'wsf-move-scrim'];

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
  const email = `wsf-w7-c36-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `w7c36-${stamp}`;
  const dana = `w7c36-dana-${stamp}`;
  await seedCommunity({ groupId, displayName: 'Alpharetta Morning Movers', joinPolicy: 'private', members: [{ uid, role: 'member' }] });
  await seedMembership(groupId, dana, 'foundingChampion');
  await seedProfile(dana, 'Dana Whitfield');
  const goalIds: string[] = [];
  const titles = ['October Squat Challenge', 'Walk to the Coast'];
  for (let i = 0; i < goals; i += 1) {
    const goalId = `w7c36g${i}-${stamp}`;
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

const ORIGIN = { home: 'wsf-community', community: 'wsf-community-index', activity: 'wsf-activity', you: 'wsf-you' } as const;
type Tab = keyof typeof ORIGIN;

/** What is on screen while a sheet is up: the tab behind, the scrims, the panel, focus. */
async function sheetProbe(page: Page, originId: string) {
  return page.evaluate((oid) => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cv = (el as HTMLElement & { checkVisibility?: (o: object) => boolean }).checkVisibility;
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && (cv ? cv.call(el, { visibilityProperty: true }) : true);
    };
    const opacity = (el: Element | null) => {
      let o = 1;
      for (let n = el; n && n instanceof Element; n = n.parentElement) o *= Number(getComputedStyle(n).opacity || '1');
      return o;
    };
    const alpha = (c: string) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return 0;
      const p = m[1].split(',').map((x) => Number(x.trim()));
      return p.length === 4 ? p[3] : 1;
    };
    const origin = Array.from(document.querySelectorAll(`[data-testid="${oid}"]`)).find(visible) ?? null;
    const tabs = Array.from(document.querySelectorAll('[data-testid="wsf-member-tabs"]')).find(visible) ?? null;
    const scrims = Array.from(document.querySelectorAll('[data-testid="wsf-contribute-scrim"],[data-testid="wsf-move-scrim"]'))
      .filter(visible)
      .map((el) => ({ id: el.getAttribute('data-testid'), bgAlpha: alpha(getComputedStyle(el).backgroundColor), opacity: Math.round(opacity(el) * 100) / 100 }));
    const panel = Array.from(document.querySelectorAll('[data-testid="wsf-contribute-sheet-panel"]')).find(visible) ?? null;
    const pr = panel?.getBoundingClientRect();
    const a = document.activeElement;
    const hitTop = document.elementFromPoint(innerWidth / 2, 120);
    return {
      originShown: Boolean(origin),
      originInert: Boolean(origin?.closest('[inert]')),
      tabBarShown: Boolean(tabs),
      tabBarInert: Boolean(tabs?.closest('[inert]')),
      paintedScrims: scrims.filter((s) => s.bgAlpha > 0 && s.opacity > 0.01),
      allScrims: scrims.length,
      panel: pr ? { top: Math.round(pr.top), bottom: Math.round(pr.bottom), height: Math.round(pr.height) } : null,
      panelRole: panel?.getAttribute('role') ?? null,
      panelLabel: panel?.getAttribute('aria-label') ?? null,
      title: (document.querySelector('[data-testid="wsf-contribute-sheet-title"]') as HTMLElement | null)?.innerText ?? null,
      focusInPanel: Boolean(panel && a && panel.contains(a)),
      focus: (a?.closest('[data-testid]') as HTMLElement | null)?.getAttribute('data-testid') ?? a?.tagName ?? null,
      focusDetail: a ? `${a.tagName} tabindex=${a.getAttribute('tabindex')} role=${a.getAttribute('role')} testid=${a.getAttribute('data-testid')} isScrimItself=${a.getAttribute('data-testid')?.endsWith('scrim') ?? false}` : null,
      hitAt120: (hitTop?.closest('[data-testid]') as HTMLElement | null)?.getAttribute('data-testid') ?? hitTop?.tagName ?? null,
    };
  }, originId);
}

/** Press Tab n times (then Shift+Tab m times); where does focus go? */
async function tabSweep(page: Page, n = 16, m = 4) {
  const stops: string[] = [];
  let outside = 0;
  for (let i = 0; i < n + m; i += 1) {
    await page.keyboard.press(i < n ? 'Tab' : 'Shift+Tab');
    const s = await page.evaluate(() => {
      const a = document.activeElement;
      const vis = (sel: string) => Array.from(document.querySelectorAll(sel)).find((e) => e.getBoundingClientRect().height > 0);
      // The sheet in FRONT: a goal sheet over the chooser wins.
      const panel = vis('[data-testid="wsf-contribute-sheet-panel"]') ?? vis('[data-testid="wsf-move-sheet"]');
      const id = (a?.closest('[data-testid]') as HTMLElement | null)?.getAttribute('data-testid') ?? a?.tagName ?? 'none';
      return { id, inside: Boolean(panel && a && panel.contains(a)) };
    });
    if (!s.inside) outside += 1;
    stops.push(`${s.inside ? '' : '!'}${s.id}`);
  }
  return { outsideStops: outside, stops: Array.from(new Set(stops)) };
}

/** Every path change and every on-top change in a window. */
async function trace(run: Run, since: number, ms: number) {
  await run.page.waitForTimeout(ms);
  const ev = await run.events(since);
  return {
    paths: ev.filter((e) => e.k === 'path').map((e) => `+${e.t - since}ms ${e.p}`),
    onTop: ev.filter((e) => e.k === 'top').map((e) => `+${e.t - since}ms ${e.id}`),
    finalPath: path(run.page),
    currentTab: await currentTab(run.page),
    sheetShown: await run.page.locator('[data-testid="wsf-contribute-sheet-panel"]:visible, [data-testid="wsf-move-sheet"]:visible').count(),
    callables: run.reqs.filter((r) => r.t >= since && r.kind === 'callable').map((r) => r.name),
  };
}


/**
 * The sheet's Close. From `b497ce4c` it has its own testID
 * (`wsf-contribute-close`); on `766ee085` it carried the page Back's
 * (`wsf-contribute-back`). The page flow and the outcome exits keep
 * `wsf-contribute-back` on both.
 */
async function sheetClose(page: Page) {
  const own = page.locator('[data-testid="wsf-contribute-close"]:visible');
  return (await own.count()) ? own.first() : shown(page, 'wsf-contribute-back');
}
async function sheetCloseId(page: Page): Promise<string> {
  return (await page.locator('[data-testid="wsf-contribute-close"]:visible').count()) ? 'wsf-contribute-close' : 'wsf-contribute-back';
}

async function openOneGoalSheet(run: Run) {
  const t = Date.now();
  await shown(run.page, 'wsf-member-tab-move').click();
  await expect(shown(run.page, 'wsf-contribute-sheet-panel')).toBeVisible({ timeout: 40_000 });
  await run.page.waitForTimeout(700);
  return t;
}

async function tabTo(run: Run, key: Tab) {
  if ((await currentTab(run.page)) === `wsf-member-tab-${key}`) return;
  await shown(run.page, `wsf-member-tab-${key}`).click();
  await expect(shown(run.page, ORIGIN[key])).toBeVisible({ timeout: 40_000 });
  await run.page.waitForTimeout(1_500);
}

test.describe(`W7 Check 36 · APP-FEEL-PARITY-1 cp1 (${LABEL})`, () => {
  test('S1 one-goal MOVE is a sheet over the same mounted tab, from all four tabs', async ({ browser }) => {
    test.setTimeout(400_000);
    const fx = await seed('s1', 1);
    const run = await open(browser, `s1-${LABEL}`);
    const page = run.page;
    await signedInAtCommunity(run, fx);
    for (const tab of ['home', 'community', 'activity', 'you'] as const) {
      await tabTo(run, tab);
      await scrollBy(page, ORIGIN[tab], 300);
      await page.waitForTimeout(300);
      const scrollBefore = await scrollOf(page, ORIGIN[tab]);
      const inst0 = await run.inst();
      const t = await openOneGoalSheet(run);
      const entry = await summarise(run, t, 'wsf-contribute-sheet-panel');
      const probe = await sheetProbe(page, ORIGIN[tab]);
      const sweep = await tabSweep(page);
      measure(`S1 ${tab} open`, {
        firstFeedbackMs: entry.firstFeedbackMs,
        panelOnTopMs: entry.contentOnTopMs,
        path: path(page),
        originRemounted: (await run.inst())[ORIGIN[tab]] - inst0[ORIGIN[tab]],
        probe,
        sweep,
        frames: entry.frames,
        callables: entry.callables,
      });
      expect(probe.panel, 'no sheet panel').not.toBeNull();
      // F2 (Check 36C): focus enters inside the panel, and no Tab stop is outside it.
      expect.soft(probe.focusInPanel, `F2 ${tab}: focus entered on ${probe.focusDetail}`).toBe(true);
      expect.soft(sweep.outsideStops, `F2 ${tab}: Tab stops outside the panel ${JSON.stringify(sweep.stops)}`).toBe(0);
      const t2 = Date.now();
      await (await sheetClose(page)).click();
      const tr = await trace(run, t2, 1_500);
      measure(`S1 ${tab} Close`, {
        ...tr,
        originRemounted: (await run.inst())[ORIGIN[tab]] - inst0[ORIGIN[tab]],
        scrollBefore,
        scrollAfter: await scrollOf(page, ORIGIN[tab]),
        focusAfter: await focused(page),
        originInertAfter: (await sheetProbe(page, ORIGIN[tab])).originInert,
      });
    }
    await run.ctx.close();
  });

  test('S1k keyboard: MOVE by Enter, Escape closes, focus returns', async ({ browser }) => {
    test.setTimeout(200_000);
    const fx = await seed('s1k', 1);
    const run = await open(browser, `s1k-${LABEL}`);
    const page = run.page;
    await signedInAtCommunity(run, fx);
    await shown(page, 'wsf-member-tab-move').focus();
    const t = Date.now();
    await page.keyboard.press('Enter');
    await expect(shown(page, 'wsf-contribute-sheet-panel')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(700);
    const probe = await sheetProbe(page, ORIGIN.home);
    const t2 = Date.now();
    await page.keyboard.press('Escape');
    const tr = await trace(run, t2, 1_500);
    measure('S1k keyboard', { openMs: (await summarise(run, t, 'wsf-contribute-sheet-panel')).contentOnTopMs, probe, escape: tr, focusAfter: await focused(page) });
    expect.soft(probe.focusInPanel, `F2 keyboard: focus entered on ${probe.focusDetail}`).toBe(true);
    expect.soft(tr.paths, 'Escape is one exit').toHaveLength(1);
    await run.ctx.close();
  });

  test('S2 two goals: chooser, then the goal sheet over it; one dim; Close', async ({ browser }) => {
    test.setTimeout(200_000);
    const fx = await seed('s2', 2);
    const run = await open(browser, `s2-${LABEL}`);
    const page = run.page;
    await signedInAtCommunity(run, fx);
    let t = Date.now();
    await shown(page, 'wsf-member-tab-move').click();
    await expect(shown(page, 'wsf-move-choose')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(700);
    const chooser = await summarise(run, t, 'wsf-move-sheet');
    const chooserSweep = await tabSweep(page, 10, 2);
    const chooserFocus = await focused(page);
    measure('S2 chooser', { frames: chooser.frames, probe: await sheetProbe(page, ORIGIN.home), focusBeforeSweep: chooserFocus, sweep: chooserSweep });
    expect.soft(chooserSweep.outsideStops, `F2 chooser: stops outside ${JSON.stringify(chooserSweep.stops)}`).toBe(0);
    t = Date.now();
    await shown(page, `wsf-move-choose-${fx.goalIds[1]}`).click();
    await expect(shown(page, 'wsf-contribute-sheet-panel')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(700);
    const s = await summarise(run, t, 'wsf-contribute-sheet-panel');
    const overProbe = await sheetProbe(page, ORIGIN.home);
    const overSweep = await tabSweep(page, 12, 2);
    measure('S2 goal sheet over chooser', { panelOnTopMs: s.contentOnTopMs, frames: s.frames, path: path(page), probe: overProbe, sweep: overSweep });
    expect.soft(overProbe.focusInPanel, `F2 over chooser: focus entered on ${overProbe.focusDetail}`).toBe(true);
    expect.soft(overSweep.outsideStops, `F2 over chooser: stops outside ${JSON.stringify(overSweep.stops)}`).toBe(0);
    t = Date.now();
    await (await sheetClose(page)).click();
    const tr = await trace(run, t, 1_500);
    measure('S2 Close goal sheet', { ...tr, focusAfter: await focused(page), chooserShown: await page.locator('[data-testid="wsf-move-choose"]:visible').count() });
    if (tr.sheetShown) {
      t = Date.now();
      await shown(page, 'wsf-move-close').click();
      measure('S2 Close chooser', { ...(await trace(run, t, 1_500)), focusAfter: await focused(page) });
    }
    await run.ctx.close();
  });

  test('S3 every step renders inside the sheet', async ({ browser }) => {
    test.setTimeout(300_000);
    const fx = await seed('s3', 1);
    const run = await open(browser, `s3-${LABEL}`);
    const page = run.page;
    const c = { mode: 'pass' as 'pass' | 'drop' | 'landButDrop' };
    await page.route('**/wsfContribute', async (route: Route) => {
      if (c.mode === 'drop') return route.abort('failed'); // INJECTED
      if (c.mode === 'landButDrop') {
        await route.fetch(); // INJECTED: recorded, reply lost
        return route.abort('failed');
      }
      return route.continue();
    });
    await signedInAtCommunity(run, fx);
    const inPanel = (id: string) =>
      page.evaluate((tid) => {
        const el = Array.from(document.querySelectorAll(`[data-testid="${tid}"]`)).find((e) => e.getBoundingClientRect().height > 0);
        if (!el) return 'absent';
        const panel = el.closest('[data-testid="wsf-contribute-sheet-panel"]');
        return panel ? `in sheet (panel bg ${getComputedStyle(panel).backgroundColor})` : 'NOT in sheet';
      }, id);
    const title = () => page.locator('[data-testid="wsf-contribute-sheet-title"]:visible').first().innerText({ timeout: 2_000 }).catch(() => null);
    const rows: Record<string, unknown> = {};
    const focusWhere = () =>
      page.evaluate(() => {
        const a = document.activeElement;
        const panel = Array.from(document.querySelectorAll('[data-testid="wsf-contribute-sheet-panel"]')).find((e) => e.getBoundingClientRect().height > 0);
        const id = (a?.closest('[data-testid]') as HTMLElement | null)?.getAttribute('data-testid') ?? a?.tagName ?? 'none';
        return `${a?.tagName.toLowerCase()}${a?.getAttribute('role') ? '[' + a.getAttribute('role') + ']' : ''} ${id} ${panel && a && panel.contains(a) ? 'IN panel' : 'OUTSIDE panel'}`;
      });
    const stepFocus: Record<string, string> = {};
    await openOneGoalSheet(run);
    stepFocus.open = await focusWhere();
    rows.move = { timer: await inPanel('wsf-contribute-timer'), title: await title() };
    await shown(page, 'wsf-contribute-timer-start').click();
    await page.waitForTimeout(1_300);
    rows.timerRunning = { clock: await shown(page, 'wsf-contribute-timer-clock').innerText(), where: await inPanel('wsf-contribute-timer-clock') };
    await shown(page, 'wsf-contribute-done').click();
    await expect(shown(page, 'wsf-contribute-entry')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(400);
    stepFocus.afterDone = await focusWhere();
    rows.count = { where: await inPanel('wsf-contribute-entry'), title: await title() };
    await shown(page, 'wsf-contribute-entry').fill('20');
    await page.waitForTimeout(800);
    stepFocus.whileTyping = await focusWhere();
    await shown(page, 'wsf-contribute-review').click();
    await expect(shown(page, 'wsf-contribute-submit')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(400);
    stepFocus.afterReview = await focusWhere();
    rows.review = { where: await inPanel('wsf-contribute-submit'), title: await title() };
    await shown(page, 'wsf-contribute-submit').click();
    await expect(shown(page, 'wsf-contribute-receipt')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(600);
    stepFocus.afterSubmit = await focusWhere();
    rows.confirmed = { where: await inPanel('wsf-contribute-receipt'), title: await title(), variant: await shown(page, 'wsf-contribute-receipt').getAttribute('data-variant'), probe: await sheetProbe(page, ORIGIN.home) };

    // Pending: the request is dropped (INJECTED).
    await shown(page, 'wsf-contribute-record-more').click().catch(() => undefined);
    await page.waitForTimeout(800);
    const again = await page.locator('[data-testid="wsf-contribute-entry"]:visible').count();
    if (!again) {
      await (await sheetClose(page)).click();
      await page.waitForTimeout(1_200);
      await openOneGoalSheet(run);
      await shown(page, 'wsf-contribute-skip-timer').click();
    }
    await expect(shown(page, 'wsf-contribute-entry')).toBeVisible({ timeout: 20_000 });
    c.mode = 'drop';
    await shown(page, 'wsf-contribute-entry').fill('7');
    await shown(page, 'wsf-contribute-review').click();
    await shown(page, 'wsf-contribute-submit').click();
    await expect(shown(page, 'wsf-contribute-pending')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(600);
    stepFocus.afterPending = await focusWhere();
    rows.pendingDropped = { where: await inPanel('wsf-contribute-pending'), title: await title(), text: (await shown(page, 'wsf-contribute-pending').innerText()).replace(/\s+/g, ' ').slice(0, 160) };

    // Unknown: the kept attempt is re-checked with its reply lost after the write (INJECTED).
    c.mode = 'landButDrop';
    await shown(page, 'wsf-contribute-reconcile').click();
    await page.waitForTimeout(2_500);
    stepFocus.afterReconcileLost = await focusWhere();
    rows.afterReconcileLost = {
      pending: await inPanel('wsf-contribute-pending'),
      receipt: await inPanel('wsf-contribute-receipt'),
      status: await page.locator('[data-testid="wsf-contribute-status"]:visible').first().innerText({ timeout: 2_000 }).catch(() => null),
      title: await title(),
      text: (await page.locator('[data-testid="wsf-contribute-sheet-panel"]:visible').first().innerText({ timeout: 2_000 }).catch(() => '')).replace(/\s+/g, ' ').slice(0, 300),
    };
    measure('S3 steps', rows);
    measure('S3 focus after each step replacement', stepFocus);
    for (const [k, v] of Object.entries(stepFocus)) expect.soft(v, `F2 step focus ${k}`).toContain('IN panel');
    expect.soft(stepFocus.whileTyping, 'member-placed focus kept').toContain('wsf-contribute-entry');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await run.ctx.close();
  });

  test('S4 preserved as pages: cold direct link, "Already moved?", kiosk flag', async ({ browser }) => {
    test.setTimeout(240_000);
    const fx = await seed('s4', 1);
    const run = await open(browser, `s4-${LABEL}`);
    const page = run.page;
    await signedInAtCommunity(run, fx);
    const kind = async () => ({
      path: path(page),
      sheet: await page.locator('[data-testid="wsf-contribute-sheet-panel"]:visible').count(),
      wordmark: await page.locator('[data-testid="wsf-contribute-wordmark"]:visible').count(),
      back: await page.locator('[data-testid="wsf-contribute-back"]:visible').first().innerText({ timeout: 2_000 }).catch(() => null),
      kioskFinish: await page.getByText('Finish', { exact: true }).count(),
      tabBar: await tabBarOnTop(page),
    });
    // "Already moved?" from Home: not move mode.
    await shown(page, `wsf-community-goal-record-${fx.goalIds[0]}`).click();
    await expect(page.locator('[data-testid="wsf-contribute-context"]:visible').first()).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(600);
    measure('S4 Already moved? from Home', await kind());
    await shown(page, 'wsf-contribute-back').click();
    await page.waitForTimeout(1_200);
    for (const [label, q] of [
      ['cold direct mode=move', `?groupId=${fx.groupId}&mode=move`],
      ['cold direct mode=move&kiosk=1', `?groupId=${fx.groupId}&mode=move&kiosk=1`],
    ] as const) {
      await page.goto(`/contribute/${fx.goalIds[0]}${q}`);
      await expect(page.locator('[data-testid="wsf-contribute-context"]:visible, [data-testid="wsf-contribute-move-screen"]:visible, [data-testid^="wsf-kiosk"]:visible').first()).toBeVisible({ timeout: 40_000 });
      await page.waitForTimeout(800);
      measure(`S4 ${label}`, await kind());
    }
    await run.ctx.close();
  });

  for (const v of [
    { name: 'S5s', height: 640, reduced: false },
    { name: 'S5r', height: 844, reduced: true },
  ]) {
    test(`${v.name} one-goal sheet at 390x${v.height}${v.reduced ? ', reduced motion' : ''}`, async ({ browser }) => {
      test.setTimeout(200_000);
      const fx = await seed(v.name.toLowerCase(), 1);
      const run = await open(browser, `${v.name.toLowerCase()}-${LABEL}`, v);
      const page = run.page;
      await signedInAtCommunity(run, fx);
      await scrollBy(page, ORIGIN.home, 300);
      await page.waitForTimeout(300);
      const scrollBefore = await scrollOf(page, ORIGIN.home);
      const t = await openOneGoalSheet(run);
      const s = await summarise(run, t, 'wsf-contribute-sheet-panel');
      const closeId = await sheetCloseId(page);
      const reach = await page.evaluate((closeId) => {
        const r = (id: string) => {
          const el = Array.from(document.querySelectorAll(`[data-testid="${id}"]`)).find((e) => e.getBoundingClientRect().height > 0);
          if (!el) return 'absent';
          el.scrollIntoView({ block: 'nearest' });
          const b = el.getBoundingClientRect();
          const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
          return `${Math.round(b.top)}-${Math.round(b.bottom)} ${el.contains(hit) ? 'reachable' : 'COVERED'}`;
        };
        return { close: r(closeId), done: r('wsf-contribute-done'), timer: r('wsf-contribute-timer-start') };
      }, closeId);
      const probe = await sheetProbe(page, ORIGIN.home);
      const t2 = Date.now();
      await (await sheetClose(page)).click();
      const tr = await trace(run, t2, 1_500);
      measure(`${v.name}`, { panelOnTopMs: s.contentOnTopMs, frames: s.frames, probe, reach, close: tr, scrollBefore, scrollAfter: await scrollOf(page, ORIGIN.home), focusAfter: await focused(page) });
      await run.ctx.close();
    });
  }

  for (const from of ['you', 'home'] as const) {
    test(`R1 Close then browser Back inside the exit (MOVE from ${from})`, async ({ browser }) => {
      test.setTimeout(200_000);
      const fx = await seed(`r1${from}`, 1);
      const run = await open(browser, `r1-${from}-${LABEL}`);
      const page = run.page;
      await signedInAtCommunity(run, fx);
      await tabTo(run, 'activity');
      await tabTo(run, from);
      const inst0 = await run.inst();
      await openOneGoalSheet(run);
      const t = Date.now();
      await (await sheetClose(page)).click();
      await page.waitForTimeout(40);
      await page.goBack({ waitUntil: 'commit' }).catch(() => null);
      const tr = await trace(run, t, 1_800);
      measure(`R1 from ${from}: Close, Back at +40ms`, { ...tr, originRemounted: (await run.inst())[ORIGIN[from]] - inst0[ORIGIN[from]] });
      // One exit: exactly one path change, and the member is still on the tab they were on.
      expect(tr.paths, 'more than one exit').toHaveLength(1);
      expect(tr.currentTab).toBe(`wsf-member-tab-${from}`);
      await run.ctx.close();
    });
  }

  test('R1z resolver sheet (no goal): Close then browser Back inside the exit', async ({ browser }) => {
    test.setTimeout(200_000);
    const fx = await seed('r1z', 0);
    const run = await open(browser, `r1z-${LABEL}`);
    const page = run.page;
    await signedInAtCommunity(run, fx);
    await tabTo(run, 'activity');
    await tabTo(run, 'you');
    await shown(page, 'wsf-member-tab-move').click();
    await expect(shown(page, 'wsf-move-no-goal')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(600);
    const t = Date.now();
    await shown(page, 'wsf-move-close').click();
    await page.waitForTimeout(40);
    await page.goBack({ waitUntil: 'commit' }).catch(() => null);
    const tr = await trace(run, t, 1_800);
    measure('R1z resolver: Close, Back at +40ms (from You)', tr);
    expect(tr.paths, 'more than one exit').toHaveLength(1);
    expect(tr.currentTab).toBe('wsf-member-tab-you');
    await run.ctx.close();
  });

  for (const releaseAt of [0, 90]) {
    test(`R2 Close on the resolver while its one-goal resolution lands (+${releaseAt}ms)`, async ({ browser }) => {
      test.setTimeout(200_000);
      const fx = await seed(`r2x${releaseAt}`, 1);
      const run = await open(browser, `r2-${releaseAt}-${LABEL}`);
      const page = run.page;
      await signedInAtCommunity(run, fx);
      await tabTo(run, 'you');
      let release: () => void = () => undefined;
      const gate = { on: true };
      await page.route('**/wsfListGoals', async (route) => {
        if (gate.on) {
          gate.on = false;
          await new Promise<void>((r) => (release = r)); // INJECTED hold of the resolver's goal read
        }
        return route.continue();
      });
      await shown(page, 'wsf-member-tab-move').click();
      await expect(shown(page, 'wsf-move-working')).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(300);
      const t = Date.now();
      await shown(page, 'wsf-move-close').click();
      if (releaseAt) await page.waitForTimeout(releaseAt);
      release();
      const tr = await trace(run, t, 2_500);
      measure(`R2 Close, resolution released at +${releaseAt}ms`, { ...tr, focusAfter: await focused(page) });
      // Close means leave: the late answer must not open the goal first.
      expect(tr.paths.filter((x) => x.includes('/contribute/')), 'the goal sheet opened after Close').toHaveLength(0);
      expect(tr.finalPath).toBe('/you');
      await run.ctx.close();
    });
  }

  test('R3 Close then an immediate MOVE', async ({ browser }) => {
    test.setTimeout(200_000);
    const fx = await seed('r3', 1);
    const run = await open(browser, `r3-${LABEL}`);
    const page = run.page;
    await signedInAtCommunity(run, fx);
    await tabTo(run, 'you');
    const move = await shown(page, 'wsf-member-tab-move').boundingBox();
    await openOneGoalSheet(run);
    const t = Date.now();
    await (await sheetClose(page)).click();
    await page.waitForTimeout(60);
    await page.mouse.click(move!.x + move!.width / 2, move!.y + move!.height / 2);
    const tr = await trace(run, t, 2_500);
    measure('R3 Close, MOVE pressed at +60ms', tr);
    // And pressed just after the exit.
    if (!tr.sheetShown) {
      await openOneGoalSheet(run);
      const t2 = Date.now();
      await (await sheetClose(page)).click();
      await page.waitForTimeout(220);
      await page.mouse.click(move!.x + move!.width / 2, move!.y + move!.height / 2);
      measure('R3 Close, MOVE pressed at +220ms', await trace(run, t2, 2_500));
    }
    await run.ctx.close();
  });

  test('L1 community cold load: the loading composition', async ({ browser }) => {
    test.setTimeout(200_000);
    const fx = await seed('l1', 1);
    const run = await open(browser, `l1-${LABEL}`);
    const page = run.page;
    await signedInAtCommunity(run, fx);
    await page.route(/wsfMyCommunities/, async (route) => {
      await new Promise((r) => setTimeout(r, 1_200)); // INJECTED: hold the frame long enough to read it
      return route.continue();
    });
    await page.goto(`/community/${fx.groupId}`);
    await expect(shown(page, 'wsf-community-loading')).toBeVisible({ timeout: 20_000 });
    const frame = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('[data-testid="wsf-community-loading"]')).find((e) => e.getBoundingClientRect().height > 0) as HTMLElement | undefined;
      return {
        text: el?.innerText.replace(/\s+/g, ' ').slice(0, 200) ?? null,
        headings: Array.from(el?.querySelectorAll('[role="heading"],h1,h2') ?? []).map((h) => (h as HTMLElement).innerText),
        wordmarks: document.querySelectorAll('[data-testid="wsf-member-topbar-wordmark"]').length,
        formShellWordmark: el ? el.querySelectorAll('img, svg').length : null,
      };
    });
    if (VIDEO_DIR) await page.screenshot({ path: `${VIDEO_DIR}/still-l1-loading-${LABEL}.png` });
    await expect(shown(page, 'wsf-community')).toBeVisible({ timeout: 40_000 });
    measure('L1 loading frame (held by an INJECTED 1.2 s delay)', frame);
    await page.unroute(/wsfMyCommunities/);
    const t = Date.now();
    await page.goto(`/community/${fx.groupId}`);
    await expect(shown(page, 'wsf-community')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(800);
    const ev = await run.events(t);
    const at = (k: string, id: string) => ((e) => (e ? e.t - t : null))(ev.find((e) => e.k === k && e.id === id));
    measure('L1 cold timeline (no injection)', {
      loadingShown: at('show', 'wsf-community-loading'),
      tabsShown: at('show', 'wsf-member-tabs'),
      topbarShown: at('show', 'wsf-member-topbar'),
      loadingHidden: at('hide', 'wsf-community-loading'),
      contentShown: at('show', 'wsf-community'),
    });
    await run.ctx.close();
  });
});
