import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { seedActiveGoal, seedCommunity, seedMembership, seedProfile, seedVerifiedUser, signInVia, stampId } from './helpers/mobile';

/**
 * W7 — CHECK 41: PERF-MOBILE-BASELINE-1 (Director #434 `5839412481`).
 * MEASUREMENT ONLY, on the accepted/integrated development head
 * `91392f9dbeda7f13208b79ff365a4cff8952c72c`. No assertion here is a verdict:
 * the only expectations are that the harness reached the state it claims to
 * measure, so a number is never taken on the wrong screen.
 *
 *   W  one warm authenticated fixture (one community, one running goal) at
 *      390x844 and 390x640:
 *        pass 1 (first visit of each tab after sign-in) and pass 2 (warm):
 *          Home -> Community -> Progress -> You -> Home;
 *        MOVE open -> Close (from Home);
 *        MOVE open -> one confirmed contribution (submit -> receipt) -> the
 *          receipt's own exit (return).
 *      Per transition: action -> first useful pixels (the destination's content
 *      element visible AND on top at its own visible centre), action -> settled
 *      (max of first useful, the last loading-state hide and the last response
 *      of a callable started after the action), every callable started (name,
 *      count, start/end), screen-root mounts added, whether a loading/skeleton
 *      state was painted (and whether that replaced content already shown
 *      before), and whether first useful pixels waited on a read.
 *   C  cold first entry (a full reload with the session persisted) of Home
 *      and of the Community tab, for a member of 1 and of 3 communities, with
 *      each callable's request parameters, so per-community fan-out is read
 *      from the difference.
 *
 * Wall-clock ms on one host (page Date.now for DOM events, runner Date.now for
 * requests). Local emulators, headless Chromium, synthetic data: NOT a device
 * speed claim.
 */

const PASSWORD = 'Sup3rSecret!23';
const BASE = process.env.WSF_PLAYWRIGHT_BASE_URL;
const LABEL = process.env.W7_LABEL ?? 'head';
test.skip(!BASE, 'Set WSF_PLAYWRIGHT_BASE_URL to the emulator-flagged build under test.');

/** Screen roots whose DOM instances are counted (a new instance = a mount). */
const ROOTS = ['wsf-home', 'wsf-community', 'wsf-community-index', 'wsf-activity', 'wsf-you', 'wsf-move-screen', 'wsf-contribute-sheet-panel'];
/** Every loading / skeleton state a member can see on these routes. */
const LOADING = [
  'wsf-home-loading',
  'wsf-home-opening-community',
  'wsf-home-my-loading',
  'wsf-community-loading',
  'wsf-community-goals-loading',
  'wsf-community-index-loading',
  'wsf-activity-loading',
  'wsf-you-loading',
  'wsf-move-working',
];
/** The first useful content of each destination. */
const USEFUL = {
  home: ['wsf-community-goal-hero'],
  community: ['wsf-community-index-rows', 'wsf-community-index-current'],
  activity: ['wsf-activity-rows', 'wsf-activity-empty'],
  you: ['wsf-you-member', 'wsf-you-identity'],
  move: ['wsf-contribute-timer', 'wsf-contribute-entry'],
  receipt: ['wsf-contribute-receipt'],
} as const;
type Dest = keyof typeof USEFUL;
const ALL_USEFUL: string[] = [...Array.from(new Set<string>(Object.values(USEFUL).flat())), 'wsf-home-my-list'];

function recorder({ roots, loading, useful }: { roots: string[]; loading: string[]; useful: string[] }) {
  type Ev = { k: string; id: string; t: number; n?: number };
  const W = { ev: [] as Ev[], inst: {} as Record<string, number>, shown: {} as Record<string, boolean>, top: {} as Record<string, boolean> };
  (window as unknown as { __w7: typeof W }).__w7 = W;
  const now = () => Date.now();
  const tid = (el: Element | null) => (el?.closest?.('[data-testid]') as HTMLElement | null)?.getAttribute('data-testid') ?? '';
  addEventListener('pointerdown', (e) => W.ev.push({ k: 'down', id: tid(e.target as Element), t: now() }), true);
  addEventListener('keydown', (e) => { if (e.key === 'Enter') W.ev.push({ k: 'down', id: tid(document.activeElement), t: now() }); }, true);
  const seen = new Map<string, WeakSet<Element>>();
  const visibleRect = (el: Element) => {
    const r = el.getBoundingClientRect();
    const x0 = Math.max(0, r.left), x1 = Math.min(innerWidth, r.right), y0 = Math.max(0, r.top), y1 = Math.min(innerHeight, r.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
    const cv = (el as HTMLElement & { checkVisibility?: (o: object) => boolean }).checkVisibility;
    if (cv && !cv.call(el, { visibilityProperty: true, opacityProperty: true })) return null;
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  };
  const check = () => {
    const t = now();
    for (const id of [...roots, ...loading, ...useful]) {
      let ws = seen.get(id);
      if (!ws) { ws = new WeakSet(); seen.set(id, ws); W.inst[id] = 0; }
      let vis = false;
      let onTop = false;
      for (const el of Array.from(document.querySelectorAll(`[data-testid="${id}"]`))) {
        if (!ws.has(el)) { ws.add(el); W.inst[id] += 1; W.ev.push({ k: 'mount', id, n: W.inst[id], t }); }
        const c = visibleRect(el);
        if (c) {
          vis = true;
          const hit = document.elementFromPoint(c.x, c.y);
          if (hit && el.contains(hit)) onTop = true;
        }
      }
      if (vis !== !!W.shown[id]) { W.shown[id] = vis; W.ev.push({ k: vis ? 'show' : 'hide', id, t }); }
      if (onTop !== !!W.top[id]) { W.top[id] = onTop; W.ev.push({ k: onTop ? 'top' : 'untop', id, t }); }
    }
  };
  const start = () => {
    new MutationObserver(check).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'aria-hidden'] });
    const loop = () => { check(); requestAnimationFrame(loop); };
    loop();
  };
  if (document.documentElement) start();
  else addEventListener('DOMContentLoaded', start);
}

type Ev = { k: string; id: string; t: number; n?: number };
type Req = { kind: 'callable' | 'firestore'; name: string; start: number; end: number | null; params: string; listen: boolean };

class Run {
  reqs: Req[] = [];
  private byReq = new Map<unknown, Req>();
  constructor(public page: Page, public ctx: BrowserContext) {
    page.on('request', (r) => {
      const u = new URL(r.url());
      let q: Req | null = null;
      if (u.port === '5001') {
        let params = '';
        try { params = JSON.stringify((JSON.parse(r.postData() ?? '{}') as { data?: unknown }).data ?? null).slice(0, 160); } catch { params = '?'; }
        q = { kind: 'callable', name: u.pathname.split('/').pop() ?? '', start: Date.now(), end: null, params, listen: false };
      } else if (u.port === '8080') {
        q = { kind: 'firestore', name: u.pathname.replace(/.*\/documents/, '').slice(0, 60), start: Date.now(), end: null, params: '', listen: /Listen|Write\/channel/.test(u.pathname) };
      }
      if (q) { this.reqs.push(q); this.byReq.set(r, q); }
    });
    const done = (r: unknown) => { const q = this.byReq.get(r); if (q && q.end === null) q.end = Date.now(); };
    page.on('requestfinished', done);
    page.on('requestfailed', done);
  }
  async ev(): Promise<Ev[]> { return (await this.page.evaluate(() => (window as unknown as { __w7: { ev: Ev[] } }).__w7.ev)) as Ev[]; }
  async inst(): Promise<Record<string, number>> { return (await this.page.evaluate(() => ({ ...(window as unknown as { __w7: { inst: Record<string, number> } }).__w7.inst }))) as Record<string, number>; }
  /** Wait until no non-listen request started after `since` is pending for `quiet` ms (cap `cap`). */
  async idle(since: number, quiet = 1_500, cap = 20_000): Promise<void> {
    const t0 = Date.now();
    let last = Date.now();
    while (Date.now() - t0 < cap) {
      const pending = this.reqs.filter((r) => r.start >= since && !r.listen && r.end === null).length;
      const lastEnd = Math.max(0, ...this.reqs.filter((r) => r.start >= since && !r.listen && r.end !== null).map((r) => r.end as number));
      last = Math.max(last, lastEnd);
      if (!pending && Date.now() - last >= quiet) return;
      await this.page.waitForTimeout(100);
    }
  }
}

async function open(browser: Browser, height: number): Promise<Run> {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height } });
  await ctx.addInitScript(recorder, { roots: ROOTS, loading: LOADING, useful: ALL_USEFUL });
  const page = await ctx.newPage();
  return new Run(page, ctx);
}

type Fx = { email: string; uid: string; groupIds: string[]; goalIds: string[] };
async function seed(tag: string, communities: number): Promise<Fx> {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-w7-c41-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Alex Rivera');
  const dana = `w7c41-dana-${stamp}`;
  await seedProfile(dana, 'Dana Whitfield');
  const names = ['Alpharetta Morning Movers', 'Harbor Walkers', 'Northside Lifters'];
  const groupIds: string[] = [];
  const goalIds: string[] = [];
  for (let i = 0; i < communities; i += 1) {
    const groupId = `w7c41c${i}-${stamp}`;
    await seedCommunity({ groupId, displayName: names[i], joinPolicy: 'private', members: [{ uid, role: 'member' }] });
    await seedMembership(groupId, dana, 'foundingChampion');
    const goalId = `w7c41g${i}-${stamp}`;
    await seedActiveGoal({ goalId, groupId, ownerUid: dana, title: 'October Squat Challenge', target: 5000, unit: 'squats', total: 1847 + i });
    groupIds.push(groupId);
    goalIds.push(goalId);
  }
  return { email, uid, groupIds, goalIds };
}

const shown = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).first();
const path = (page: Page) => new URL(page.url()).pathname + new URL(page.url()).search;

function measure(label: string, value: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`MEASURE ${label}: ${JSON.stringify(value)}`);
  test.info().annotations.push({ type: 'measure', description: `${label}: ${JSON.stringify(value)}` });
}

/** Stages of reads that each started only after an earlier read had returned, before `until` ms. */
function serialDepth(calls: Req[], t0: number, until: number | null): number {
  const cs = calls.filter((c) => c.end !== null && (until === null || (c.end as number) - t0 <= until + 16)).sort((a, b) => a.start - b.start);
  const depth = new Map<Req, number>();
  let max = 0;
  for (const c of cs) {
    let d = 1;
    for (const p of cs) if (p !== c && (p.end as number) <= c.start && depth.has(p)) d = Math.max(d, (depth.get(p) as number) + 1);
    depth.set(c, d);
    max = Math.max(max, d);
  }
  return max;
}

/** Everything that happened between the action at `since` and now, for destination `dest`. */
async function summarise(run: Run, since: number, dest: Dest, instBefore: Record<string, number>, usefulShownBefore: boolean) {
  const ev = (await run.ev()).filter((e) => e.t >= since);
  const down = ev.find((e) => e.k === 'down');
  const t0 = down?.t ?? since;
  const firstUseful = ev.find((e) => e.k === 'top' && (USEFUL[dest] as readonly string[]).includes(e.id));
  const loadingShows = ev.filter((e) => e.k === 'show' && LOADING.includes(e.id));
  const loadingHides = ev.filter((e) => e.k === 'hide' && LOADING.includes(e.id));
  const callables = run.reqs.filter((r) => r.kind === 'callable' && r.start >= t0);
  const fsReqs = run.reqs.filter((r) => r.kind === 'firestore' && r.start >= t0 && !r.listen);
  const usefulMs = firstUseful ? firstUseful.t - t0 : null;
  const lastCallableEnd = Math.max(0, ...callables.filter((c) => c.end !== null).map((c) => (c.end as number) - t0));
  const lastLoadingHide = Math.max(0, ...loadingHides.map((e) => e.t - t0));
  const settledMs = usefulMs === null ? null : Math.max(usefulMs, lastCallableEnd, lastLoadingHide);
  const readsBeforeUseful = usefulMs === null ? [] : callables.filter((c) => c.end !== null && (c.end as number) - t0 <= usefulMs + 16).map((c) => c.name);
  const instAfter = await run.inst();
  const mounts: Record<string, number> = {};
  for (const id of ROOTS) { const d = (instAfter[id] ?? 0) - (instBefore[id] ?? 0); if (d) mounts[id] = d; }
  const counts: Record<string, number> = {};
  for (const c of callables) counts[c.name] = (counts[c.name] ?? 0) + 1;
  return {
    action: down ? down.id : 'none',
    usefulMs,
    settledMs,
    callables: counts,
    callableTimes: callables.map((c) => `${c.name} +${c.start - t0}..${c.end === null ? 'pending' : `+${c.end - t0}`}`),
    firestoreNonListen: fsReqs.length,
    mountsAdded: mounts,
    loadingPainted: Array.from(new Set(loadingShows.map((e) => `${e.id}@+${e.t - t0}`))),
    replacedKnownContent: usefulShownBefore && loadingShows.length > 0,
    readsReturnedBeforeUseful: readsBeforeUseful,
    serialReadStagesBeforeUseful: serialDepth(callables, t0, usefulMs),
    // BLOCKING: the switch painted a loading state and its first useful pixels
    // came only after a read it started had returned. (A read that merely
    // returned during an exit animation, with no loading state, is not.)
    blockingRead: loadingShows.length > 0 && readsBeforeUseful.length > 0,
  };
}

async function usefulKnown(run: Run, dest: Dest): Promise<boolean> {
  const inst = await run.inst();
  return (USEFUL[dest] as readonly string[]).some((id) => (inst[id] ?? 0) > 0);
}

/** One measured action: `act` performs it; `dest` is where it lands. */
async function step(run: Run, label: string, dest: Dest, act: () => Promise<void>) {
  const known = await usefulKnown(run, dest);
  const before = await run.inst();
  const since = Date.now();
  await act();
  await expect(run.page.locator(USEFUL[dest].map((id) => `[data-testid="${id}"]:visible`).join(', ')).first()).toBeVisible({ timeout: 40_000 });
  await run.idle(since);
  await run.page.waitForTimeout(300);
  const s = await summarise(run, since, dest, before, known);
  measure(`${label} (${LABEL})`, { path: path(run.page), destinationSeenBefore: known, ...s });
  return s;
}

/** Skip the timer, enter `amount`, review; then (unless `stop`) confirm and wait for the receipt. */
async function contribute(page: Page, amount: string, submit = true): Promise<void> {
  await shown(page, 'wsf-contribute-skip-timer').click({ timeout: 20_000 });
  await expect(shown(page, 'wsf-contribute-entry')).toBeVisible({ timeout: 20_000 });
  await shown(page, 'wsf-contribute-entry').fill(amount);
  await shown(page, 'wsf-contribute-review').click({ timeout: 10_000 });
  await expect(shown(page, 'wsf-contribute-submit')).toBeVisible({ timeout: 20_000 });
  if (!submit) return;
  await shown(page, 'wsf-contribute-submit').click({ timeout: 10_000 });
  await expect(shown(page, 'wsf-contribute-receipt')).toBeVisible({ timeout: 30_000 });
}

const tabClick = (run: Run, key: string) => () => shown(run.page, `wsf-member-tab-${key}`).click({ timeout: 10_000 });

test.describe(`W7 Check 41 · PERF-MOBILE-BASELINE-1 (${LABEL})`, () => {
  for (const height of [844, 640]) {
    test(`W warm fixture at 390x${height}: tab loop x2, MOVE open/Close, one confirmed receipt and return`, async ({ browser }) => {
      test.setTimeout(400_000);
      const fx = await seed(`w${height}`, 1);
      const run = await open(browser, height);
      const page = run.page;
      await signInVia(page, fx.email, PASSWORD);
      await expect.poll(() => path(page), { timeout: 40_000 }).toBe(`/community/${fx.groupIds[0]}`);
      await expect(shown(page, 'wsf-community-goal-hero')).toBeVisible({ timeout: 40_000 });
      await run.idle(0);
      // FIXTURE, NOT MEASURED: one earlier contribution through the real flow,
      // so Progress has a row to show (a member with none sees its empty state).
      await shown(page, 'wsf-member-tab-move').click({ timeout: 10_000 });
      await contribute(page, '15');
      await shown(page, 'wsf-contribute-back').click({ timeout: 10_000 });
      await expect(shown(page, 'wsf-community-goal-hero')).toBeVisible({ timeout: 40_000 });
      await run.idle(0);
      await page.waitForTimeout(1_000);
      const vp = `390x${height}`;
      for (const pass of [1, 2]) {
        await step(run, `W ${vp} pass${pass} Home->Community`, 'community', tabClick(run, 'community'));
        await step(run, `W ${vp} pass${pass} Community->Progress`, 'activity', tabClick(run, 'activity'));
        await step(run, `W ${vp} pass${pass} Progress->You`, 'you', tabClick(run, 'you'));
        await step(run, `W ${vp} pass${pass} You->Home`, 'home', tabClick(run, 'home'));
      }
      await step(run, `W ${vp} MOVE open (from Home)`, 'move', tabClick(run, 'move'));
      await step(run, `W ${vp} MOVE Close`, 'home', async () => {
        const close = page.locator('[data-testid="wsf-contribute-close"]:visible');
        await (await close.count() ? close.first() : shown(page, 'wsf-contribute-back')).click({ timeout: 10_000 });
      });
      await step(run, `W ${vp} MOVE open again (from Home)`, 'move', tabClick(run, 'move'));
      await contribute(page, '20', false);
      const r = await step(run, `W ${vp} submit -> confirmed receipt`, 'receipt', () => shown(page, 'wsf-contribute-submit').click({ timeout: 10_000 }));
      const variant = await shown(page, 'wsf-contribute-receipt').getAttribute('data-variant', { timeout: 5_000 });
      const exitLabel = (await shown(page, 'wsf-contribute-back').innerText({ timeout: 5_000 }).catch(() => '')).trim();
      measure(`W ${vp} receipt (${LABEL})`, { variant, exitLabel, callables: r.callables });
      expect(variant, 'the receipt is a confirmed one').toBe('ordinary');
      await step(run, `W ${vp} receipt exit ("${exitLabel}") -> return`, 'home', () => shown(page, 'wsf-contribute-back').click({ timeout: 10_000 }));
      const total = (await shown(page, `wsf-community-goal-hero`).innerText({ timeout: 5_000 }).catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
      measure(`W ${vp} Home after return (${LABEL})`, { path: path(page), heroText: total });
      await run.ctx.close();
    });
  }

  for (const n of [1, 3]) {
    test(`C cold first entry of Home and Community, member of ${n} communit${n === 1 ? 'y' : 'ies'} (390x844)`, async ({ browser }) => {
      test.setTimeout(300_000);
      const fx = await seed(`c${n}`, n);
      const run = await open(browser, 844);
      const page = run.page;
      await signInVia(page, fx.email, PASSWORD);
      await page.waitForTimeout(500);
      await run.idle(0);
      for (const [label, url, ready] of [
        ['Home', '/', '[data-testid="wsf-community-goal-hero"]:visible, [data-testid="wsf-home-my-list"]:visible'],
        ['Community tab', '/community', '[data-testid="wsf-community-index-rows"]:visible, [data-testid="wsf-community-index-current"]:visible'],
      ] as const) {
        for (const rep of [1, 2]) {
          const since = Date.now();
          await page.goto(url);
          await expect(page.locator(ready).first()).toBeVisible({ timeout: 40_000 });
          await run.idle(since);
          const ev = (await run.ev()).filter((e) => e.t >= since);
          const callables = run.reqs.filter((r) => r.kind === 'callable' && r.start >= since);
          const counts: Record<string, number> = {};
          for (const c of callables) counts[c.name] = (counts[c.name] ?? 0) + 1;
          const firstTop = ev.find((e) => e.k === 'top' && ALL_USEFUL.includes(e.id));
          measure(`C n=${n} cold ${label} #${rep} (${LABEL})`, {
            finalPath: path(page),
            navToUsefulMs: firstTop ? firstTop.t - since : null,
            callableTotal: callables.length,
            serialReadStagesBeforeUseful: serialDepth(callables, since, firstTop ? firstTop.t - since : null),
            callables: counts,
            calls: callables.map((c) => `${c.name} +${c.start - since}..${c.end === null ? 'pending' : `+${c.end - since}`} ${c.params}`),
            firestoreNonListen: run.reqs.filter((r) => r.kind === 'firestore' && r.start >= since && !r.listen).length,
            loadingPainted: Array.from(new Set(ev.filter((e) => e.k === 'show' && LOADING.includes(e.id)).map((e) => `${e.id}@+${e.t - since}`))),
          });
        }
      }
      await run.ctx.close();
    });
  }
});
