import { randomBytes } from 'node:crypto';

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
  visibleCount,
} from './helpers/mobile';

/**
 * W7 — INDEPENDENT EXIT PROOFS for W9's contribution exits (`cd02949`, #458),
 * which the Director put into the combined candidate (#365 `5802056978` §1;
 * L0 `5802080266`). W9's and W1B's specs prove their cases; this file uses
 * different instruments on the journeys a member actually takes:
 *
 *   X1  THE ORDINARY ARRIVAL — "/" → Home opens the community (not a cold
 *       /community/<id> load) → a goal → record → the receipt's labelled exit.
 *       Lands on the SAME mounted Community (a mark on the visible root), at
 *       the same scroll, with no second tab bar anywhere in the DOM, and the
 *       total shown equals the SERVER's shard sum. Then the risk W9 does not
 *       ask about: browser Back after the exit must not bring back the finished
 *       contribution's receipt or its review screen with a live Submit (a
 *       second submit would count twice). Where Back lands is recorded.
 *   X2  MOVE FROM YOU — the labelled exit is hit-tested at its own centre
 *       before the press; the member lands on the community the Home tab
 *       holds, not on You; Back afterwards does not revive the contribution.
 *   X3  THE CHROME ARROW keeps "the step before this": from the move screen
 *       reached in-app, it returns to the same mounted Community.
 *   X4  "BACK TO HOME" ON A COLD ARRIVAL resolves Home AFRESH — Home asks the
 *       server for the member's communities after the press — and leaves no
 *       contribution entry behind for Back to find.
 *
 *   X1s THE TOTAL IS CURRENT EVEN WHEN THE FIRST RETURN READ IS STALE. The
 *       first wsfGoalPulse after the exit is answered with a sentinel stale
 *       total (1,848); the page must correct itself to the server's 1,867 by
 *       W8's settle re-read (a pulse request 2.3–4.5 s after landing). Leg (i)
 *       is the labelled exit (W8 + W9 together); leg (ii) is browser Back
 *       from the receipt (W8's settle alone).
 *   X3b / X3c THE CHROME ARROW WHERE back() AND dismissTo DIFFER: from MOVE on
 *       You the arrow is "the step before this" and returns to You; on a cold
 *       arrival it replaces with the community (no entry left behind).
 *
 * Kiosk paths are not driven here: every kiosk rest state renders Finish, the
 * diff's ReturnButton swaps are all in the non-kiosk branch (checked from git
 * in the QA report), and W1B's kiosk suites are run beside this file.
 *
 * MEASURED (QA report, Check 16). Candidate 9f27c6ea: 8/8. Baseline 6c98f485
 * (f2f901a ⊕ W9-Q2 a87cd3b ⊕ W8 eff65b0 ⊕ W4 5c28e45: the old ButtonLink
 * exits): X1 FAIL (push, second Community, two tab bars), X1s via the exit
 * FAIL (stale total never corrected), X1s via browser Back pass (W8's
 * settle is in both), X4 FAIL (pushState '/'). X3/X3b/X3c guard the
 * arrow's unchanged back() semantics; X3b records that the arrow reads
 * "Back to community" while returning to You.
 *
 * X5 / X5s, THE STALE-TOTAL CONSEQUENCE of the known warm "Back to home"
 * duplicate (W9 #458 `5802502922`; deferred, Director `5802767529` §3),
 * measured on 9f27c6ea:
 *   X5  FAIL, with no stub. The fresh Community's first pulse left 374 ms
 *       after the review screen's last pre-write poll (inside the 2 s cache),
 *       showed 0 against the server's 20, and nothing re-read it in 10 s.
 *       Timing: Submit straight after a poll, "Back to home" at once.
 *   X5s FAIL. The stale sentinel showed at +257 ms and was still on screen
 *       at 15 s, with no pulse after landing. A tab round trip (Progress →
 *       Home) corrected it 329 ms after the return.
 *   Both: 2 Community roots, 1 tab bar (W9's duplicate).
 * So on this path the stale total is not a bounded cache interval: it lasts
 * until the member leaves and returns, or reloads.
 * Baseline 6c98f485 (old exits): the same. X5 showed 0 against 20 (first read
 * 379 ms after the last pre-write poll), and X5s held the sentinel 15 s until
 * the round trip, with 2 roots and 2 tab bars. PRE-EXISTING, like the
 * duplicate it follows from.
 *
 * ON W8's FIRST-FOCUS SETTLE (9d30c38b on a1dcced = 09cf5fd0; Check 19): X5,
 * X5s and X7 corrected at ~2.8–3.0 s; X7b/X7c cancel; X7d and X7e FAIL (the
 * held-answer races, inherited); X7f CANNOT-MEASURE the same instance (the
 * in-app sign-out unmounts it; no leak); X7g FAILS 2/2: A's held settle answer
 * lands on B's screen as B's own part after an account change from another
 * tab. ON W8's SUCCESSOR (95b08857 on b1e64b3f = f02a96fa; Check 21): X7d,
 * X7e and X7g PASS (the settle fills a loading slot, a later-issued figure is
 * never overwritten, the settle is cancelled on an account change); X7f stays
 * CANNOT-MEASURE; the ordinary path carries. The same on development
 * 0827e4d2 ⊕ 95b08857 (d03e957b, W9 present), where X7h also passes: a goal
 * list landing after the timer still gets its settle one window later. ON W9's OPTION 1 (945d6736 on
 * a1dcced = f8d818c5; Check 20): X6 PASS
 * (address, marked list, 1,867 at +508 ms), X6b PASS (held return read
 * delivered after B's list loaded; nothing of A on it), X5/X5s PASS with one
 * Community root.
 */

test.use({ viewport: { width: 390, height: 844 } });

const OWNER = { authorization: 'Bearer owner', 'content-type': 'application/json' };
const SEEDED = 1847;

type Fx = { email: string; password: string; uid: string; groupId: string; goalId: string };

async function seed(tag: string): Promise<Fx> {
  const id = stampId();
  const email = `w7ex-${tag}-${id}@example.com`;
  const password = `Aa1!${randomBytes(6).toString('hex')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Robin Vale');
  const groupId = `w7ex-${tag}-${id}`;
  await seedCommunity({ groupId, displayName: 'W7 Exit Movers', joinPolicy: 'private', members: [{ uid, role: 'member' }] });
  const goalId = `w7exg-${tag}-${id}`;
  await seedActiveGoal({ goalId, groupId, ownerUid: uid, title: 'W7 Exit Squats', target: 5000, unit: 'squats', total: SEEDED });
  return { email, password, uid, groupId, goalId };
}

/** The committed total, from the server: the sum of the goal's counter shards. */
async function serverTotal(goalId: string): Promise<number> {
  const res = await fetch(
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/wsfGoalCounters/${goalId}/shards?pageSize=100`,
    { headers: OWNER },
  );
  if (!res.ok) throw new Error(`shard read refused: ${res.status}`);
  const body = (await res.json()) as { documents?: Array<{ fields?: { count?: { integerValue?: string } } }>; nextPageToken?: string };
  if (body.nextPageToken) throw new Error('more than one page of shards — the sum would be partial');
  return (body.documents ?? []).reduce((n, d) => n + Number(d.fields?.count?.integerValue ?? 0), 0);
}

async function traceHistory(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __w7h: string[] };
    w.__w7h = [];
    for (const m of ['pushState', 'replaceState'] as const) {
      const orig = History.prototype[m];
      History.prototype[m] = function (this: History, ...a: [unknown, string, (string | URL | null)?]) {
        w.__w7h.push(`${m} ${new URL(String(a[2] ?? ''), location.href).pathname}`);
        return orig.apply(this, a as never);
      };
    }
  });
}

async function markVisibleCommunity(page: Page): Promise<void> {
  await page.evaluate(() => {
    const shown = Array.from(document.querySelectorAll('[data-testid="wsf-community"]')).find(
      (el) => (el as HTMLElement).getClientRects().length > 0 && (el as HTMLElement).offsetParent !== null,
    ) as HTMLElement | undefined;
    if (!shown) throw new Error('no visible Community to mark');
    shown.setAttribute('data-w7-exit', 'kept');
  });
}

async function reading(page: Page) {
  return page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('[data-testid="wsf-community"]')) as HTMLElement[];
    const shown = all.filter((el) => el.offsetParent !== null);
    let sc: HTMLElement | null = shown[0] ?? null;
    while (sc && !(sc.scrollHeight > sc.clientHeight + 1)) sc = sc.parentElement;
    return {
      roots: all.length,
      visible: shown.length,
      marked: shown.length === 1 && shown[0]!.getAttribute('data-w7-exit') === 'kept',
      tabBars: document.querySelectorAll('[data-testid="wsf-member-tabs"]').length,
      scroll: sc ? Math.round(sc.scrollTop) : -1,
    };
  });
}

/** Plant a scroll on the visible Community and wait until two reads agree. */
async function plantScroll(page: Page, y: number): Promise<number> {
  await page.evaluate((top) => {
    const shown = Array.from(document.querySelectorAll('[data-testid="wsf-community"]')).find(
      (el) => (el as HTMLElement).offsetParent !== null,
    ) as HTMLElement | undefined;
    let sc: HTMLElement | null = shown ?? null;
    while (sc && !(sc.scrollHeight > sc.clientHeight + 1)) sc = sc.parentElement;
    if (sc) sc.scrollTop = top;
  }, y);
  let last = (await reading(page)).scroll;
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(120);
    const next = (await reading(page)).scroll;
    if (next === last) break;
    last = next;
  }
  return last;
}

/** Arrive as a member does: "/" and let Home open the community. */
async function arrive(page: Page, fx: Fx): Promise<void> {
  await signInVia(page, fx.email, fx.password);
  await page.goto('/');
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe(`/community/${fx.groupId}`);
  await expect(page.locator(`[data-testid="wsf-community-goal-total-${fx.goalId}"]:visible`).first()).toBeVisible({ timeout: 40_000 });
  await page.waitForTimeout(3_000); // the page's late reads (W8's settle is 2.6 s)
}

async function recordTwenty(page: Page): Promise<void> {
  await page.getByTestId('wsf-contribute-entry').last().fill('20');
  await page.getByTestId('wsf-contribute-review').last().click();
  await page.getByTestId('wsf-contribute-submit').last().click();
  await expect(page.getByTestId('wsf-contribute-receipt').last()).toBeVisible({ timeout: 40_000 });
}

/** The labelled exit on screen, hit-tested at its own centre, then pressed. */
async function pressLabelledExit(page: Page, label: string): Promise<void> {
  const exit = page.locator('[data-testid="wsf-contribute-back"]:visible').last();
  await expect(exit).toHaveText(label);
  await exit.scrollIntoViewIfNeeded();
  const box = (await exit.boundingBox())!;
  const hit = await page.evaluate(([x, y]) => {
    let n = document.elementFromPoint(x, y) as HTMLElement | null;
    while (n && !n.dataset?.testid) n = n.parentElement;
    return n?.dataset.testid ?? '-';
  }, [box.x + box.width / 2, box.y + box.height / 2] as const);
  expect(hit, `something covers "${label}"`).toBe('wsf-contribute-back');
  expect(box.height, `"${label}" is smaller than a touch target`).toBeGreaterThanOrEqual(44);
  await exit.click();
}

/** Every wsfGoalPulse / wsfContribute POST, with its time. */
function watchCalls(page: Page, names: string[]): Array<{ name: string; at: number }> {
  const seen: Array<{ name: string; at: number }> = [];
  page.on('request', (r) => {
    const m = /\/us-central1\/(wsf[A-Za-z]+)/.exec(r.url());
    if (m && r.method() === 'POST' && names.includes(m[1]!)) seen.push({ name: m[1]!, at: Date.now() });
  });
  return seen;
}

async function historyOps(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __w7h: string[] }).__w7h.slice());
}
async function clearHistoryOps(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __w7h: string[] }).__w7h.length = 0;
  });
}

/** Into the goal from the Community, and record 20. */
async function contributeFromCommunity(page: Page, fx: Fx): Promise<void> {
  await page.getByTestId(`wsf-community-goal-link-${fx.goalId}`).last().click();
  await expect(page.getByTestId('wsf-contribute-move-screen').last()).toBeVisible({ timeout: 40_000 });
  await page.getByTestId('wsf-contribute-done').last().click();
  await recordTwenty(page);
}

/** A Champion with a community and no goal yet: the first goal's journey. */
async function seedChampion(tag: string): Promise<Omit<Fx, 'goalId'>> {
  const id = stampId();
  const email = `w7ex-${tag}-${id}@example.com`;
  const password = `Aa1!${randomBytes(6).toString('hex')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Robin Vale');
  const groupId = `w7ex-${tag}-${id}`;
  await seedCommunity({ groupId, displayName: 'W7 Exit Movers', joinPolicy: 'private', members: [{ uid, role: 'foundingChampion' }] });
  return { email, password, uid, groupId };
}

/**
 * "/" → the community → Goal Setup → the receipt's "Open the contribute page"
 * (a link that names no community, so the contribution's exits read "Back to
 * home") → the entry screen. Returns the goal the server made.
 */
async function firstGoalToContribute(page: Page, fx: Omit<Fx, 'goalId'>): Promise<string> {
  await signInVia(page, fx.email, fx.password);
  await page.goto('/');
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe(`/community/${fx.groupId}`);
  const start = page.getByTestId('wsf-community-start-goal').last();
  await expect(start).toBeVisible({ timeout: 40_000 });
  await markVisibleCommunity(page);
  await start.click();
  await expect(page.getByTestId('wsf-new-goal-form').last()).toBeVisible({ timeout: 40_000 });
  await page.getByTestId('wsf-new-goal-title').last().fill('W7 Stale Squats');
  await page.getByTestId('wsf-new-goal-target').last().fill('500');
  await page.getByTestId('wsf-new-goal-unit').last().fill('squats');
  await page.getByTestId('wsf-new-goal-submit').last().click();
  const created = page.getByTestId('wsf-new-goal-created').last();
  await expect(created).toBeVisible({ timeout: 40_000 });
  const goalId = (await created.getAttribute('data-goal-id')) ?? '';
  expect(goalId, 'the receipt names the goal the server made').not.toBe('');
  await page.getByTestId('wsf-new-goal-goto-contribute').last().click();
  await expect(page.getByTestId('wsf-contribute-entry-screen').last()).toBeVisible({ timeout: 40_000 });
  return goalId;
}

/** The first integer in the goal's total, read inside the one Community screen on show. */
async function shownTotal(page: Page, goalId: string): Promise<number | null> {
  return page.evaluate((id) => {
    const shown = Array.from(document.querySelectorAll('[data-testid="wsf-community"]')).filter(
      (el) => (el as HTMLElement).offsetParent !== null,
    );
    if (shown.length !== 1) return null;
    const t = shown[0]!.querySelector(`[data-testid="wsf-community-goal-total-${id}"]`) as HTMLElement | null;
    const m = t ? /\d[\d,]*/.exec(t.innerText) : null;
    return m ? Number(m[0].replace(/,/g, '')) : null;
  }, goalId);
}

/** Sample the shown total every 250 ms until `until`; returns [ms since `from`, value] pairs. */
async function sampleTotal(page: Page, goalId: string, from: number, until: number): Promise<Array<[number, number | null]>> {
  const out: Array<[number, number | null]> = [];
  while (Date.now() < until) {
    out.push([Date.now() - from, await shownTotal(page, goalId)]);
    await page.waitForTimeout(250);
  }
  return out;
}

/** Compress a timeline to its changes. */
const changes = (tl: Array<[number, number | null]>) =>
  tl.filter(([, v], i) => i === 0 || v !== tl[i - 1]![1]).map(([t, v]) => `${t}ms:${v}`);

test.describe('W9 contribution exits, independent instruments', () => {
  test('X1 the ordinary arrival: the receipt returns to the same Community at the same place, with the server total; Forward re-opens only a fresh start', async ({ page }) => {
    test.setTimeout(300_000);
    await traceHistory(page);
    const fx = await seed('x1');
    await arrive(page, fx);
    await markVisibleCommunity(page);
    const planted = await plantScroll(page, 160);
    expect(planted, 'the planted scroll is not vacuous').toBeGreaterThan(40);
    const bars0 = (await reading(page)).tabBars;
    expect(bars0, 'the shell tab bar is present at baseline').toBe(1);

    await contributeFromCommunity(page, fx);
    const len0 = await page.evaluate(() => history.length);
    await clearHistoryOps(page);
    await pressLabelledExit(page, 'Back to community');

    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe(`/community/${fx.groupId}`);
    await page.waitForTimeout(1_000);
    const r = await reading(page);
    const ops = await historyOps(page);
    test.info().annotations.push({ type: 'reading', description: JSON.stringify(r) });
    test.info().annotations.push({ type: 'history on exit', description: JSON.stringify(ops) });
    expect(r.visible, 'exactly one Community on show').toBe(1);
    expect(r.marked, 'the Community on show is not the one the member left').toBe(true);
    expect(r.roots, 'a second Community screen exists in the DOM').toBe(1);
    expect(r.tabBars, 'a second tab bar was mounted').toBe(1);
    expect(Math.abs(r.scroll - planted), 'the member came back to a different place').toBeLessThanOrEqual(2);
    expect(ops.filter((o) => o.startsWith('pushState')), 'the exit pushed a history entry').toEqual([]);
    expect(await page.evaluate(() => history.length), 'the exit changed the history length').toBe(len0);

    const truth = await serverTotal(fx.goalId);
    expect(truth, 'the server did not commit the 20').toBe(SEEDED + 20);
    await expect(page.locator(`[data-testid="wsf-community-goal-total-${fx.goalId}"]:visible`).first()).toContainText(
      truth.toLocaleString('en-US'),
      { timeout: 15_000 },
    );

    // FORWARD is where the finished contribution sits after the exit (the exit
    // is a history pop). It must come back only as a FRESH start: no receipt,
    // no review with a live Submit, and nothing sent by itself.
    const contributes = watchCalls(page, ['wsfContribute']);
    await page.goForward();
    await page.waitForTimeout(1_500);
    const fwdPath = new URL(page.url()).pathname;
    test.info().annotations.push({ type: 'after Forward', description: fwdPath });
    expect(fwdPath, 'Forward did not return to the contribution entry').toMatch(/^\/contribute\//);
    expect(await visibleCount(page, 'wsf-contribute-move-screen'), 'Forward is not a fresh start').toBe(1);
    expect(await visibleCount(page, 'wsf-contribute-receipt'), 'Forward revived the receipt').toBe(0);
    expect(await visibleCount(page, 'wsf-contribute-review-screen'), 'Forward revived the review with Submit').toBe(0);
    await page.waitForTimeout(3_000);
    expect(contributes, 'a contribution was sent without a press').toEqual([]);
  });

  for (const leg of ['labelled exit', 'browser Back'] as const) {
    test(`X1s the total is current after a return even when the first read is stale — ${leg}`, async ({ page }) => {
      test.setTimeout(300_000);
      const fx = await seed(leg === 'labelled exit' ? 'x1si' : 'x1sb');
      await arrive(page, fx);
      await markVisibleCommunity(page);
      await contributeFromCommunity(page, fx);
      expect(await serverTotal(fx.goalId), 'the server did not commit the 20').toBe(SEEDED + 20);

      const STALE = SEEDED + 1; // 1,848 never appears legitimately
      let pressedAt = Number.POSITIVE_INFINITY;
      let staleServed = 0;
      const pulses: number[] = [];
      await page.route('**/us-central1/wsfGoalPulse', async (route: Route) => {
        if (route.request().method() !== 'POST') return route.continue();
        const now = Date.now();
        if (now < pressedAt) return route.continue();
        pulses.push(now);
        if (staleServed > 0) return route.continue();
        const res = await route.fetch();
        const body = (await res.json()) as { result?: { sharedTotal?: number } };
        if (!body.result || typeof body.result.sharedTotal !== 'number') throw new Error('unexpected pulse shape');
        body.result.sharedTotal = STALE;
        staleServed += 1;
        await route.fulfill({ response: res, json: body });
      });

      pressedAt = Date.now();
      if (leg === 'labelled exit') await pressLabelledExit(page, 'Back to community');
      else await page.goBack();
      await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe(`/community/${fx.groupId}`);
      const landedAt = Date.now();
      const total = page.locator(`[data-testid="wsf-community-goal-total-${fx.goalId}"]:visible`).first();
      // The stub must reach the screen, or the rest proves nothing.
      await expect(total, 'the stale first read never reached the screen').toContainText(STALE.toLocaleString('en-US'), { timeout: 10_000 });
      await expect(total, 'the stale total was never corrected').toContainText((SEEDED + 20).toLocaleString('en-US'), { timeout: 4_500 });
      await page.waitForTimeout(Math.max(0, landedAt + 10_000 - Date.now()));
      await expect(total, 'the corrected total did not hold').toContainText((SEEDED + 20).toLocaleString('en-US'));
      const settle = pulses.filter((t) => t - landedAt >= 2_300 && t - landedAt <= 4_500);
      test.info().annotations.push({ type: 'pulse requests after landing (ms)', description: JSON.stringify(pulses.map((t) => t - landedAt)) });
      expect(staleServed, 'the stale answer was not served exactly once').toBe(1);
      expect(settle.length, 'no settle re-read 2.3–4.5 s after the return').toBeGreaterThan(0);
      const r = await reading(page);
      expect(r.marked, 'the return did not land on the Community the member left').toBe(true);
      expect(r.roots, 'a second Community screen exists in the DOM').toBe(1);
    });
  }

  test('X2 MOVE from You: the exit is pressable where it is drawn and lands on the Home tab\'s Community', async ({ page }) => {
    test.setTimeout(300_000);
    const fx = await seed('x2');
    await arrive(page, fx);
    await markVisibleCommunity(page);
    const bars0 = (await reading(page)).tabBars;
    expect(bars0, 'the shell tab bar is present at baseline').toBe(1);
    await page.getByTestId('wsf-member-tab-you').last().click();
    await expect(page.getByTestId('wsf-you-identity').last()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('wsf-member-tab-move').last().click();
    await expect(page.getByTestId('wsf-contribute-move-screen').last()).toBeVisible({ timeout: 40_000 });
    await page.getByTestId('wsf-contribute-done').last().click();
    await recordTwenty(page);
    await pressLabelledExit(page, 'Back to community');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe(`/community/${fx.groupId}`);
    await page.waitForTimeout(1_000);
    const r = await reading(page);
    test.info().annotations.push({ type: 'reading', description: JSON.stringify(r) });
    expect(r.marked, 'the member did not land on the Community the Home tab holds').toBe(true);
    expect(r.roots, 'a second Community screen exists in the DOM').toBe(1);
    expect(r.tabBars, 'a second tab bar was mounted').toBe(1);
    const onTop = await page.evaluate(() => {
      const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 3);
      return { community: !!hit?.closest('[data-testid="wsf-community"]'), you: !!hit?.closest('[data-testid="wsf-you-identity"]') };
    });
    expect(onTop, 'the screen under the thumb is not the Community').toEqual({ community: true, you: false });
    // Recorded: the exit overwrote the You entry, so the first browser Back is
    // expected to change nothing on screen (a follow-up note, not an assertion).
    await page.goBack().catch(() => undefined);
    await page.waitForTimeout(1_500);
    const after = new URL(page.url()).pathname;
    test.info().annotations.push({ type: 'after one Back', description: after });
    expect(after, 'Back returned to a finished contribution').not.toMatch(/^\/contribute\//);
  });

  test('X3 the in-app chrome arrow returns to the same mounted Community (it does not push a copy)', async ({ page }) => {
    test.setTimeout(300_000);
    const fx = await seed('x3');
    await arrive(page, fx);
    await markVisibleCommunity(page);
    await page.getByTestId(`wsf-community-goal-link-${fx.goalId}`).last().click();
    await expect(page.getByTestId('wsf-contribute-move-screen').last()).toBeVisible({ timeout: 40_000 });
    const arrow = page.locator('[data-testid="wsf-contribute-back"]:visible').first();
    await expect(arrow).toHaveText('Back to community');
    await arrow.click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe(`/community/${fx.groupId}`);
    await page.waitForTimeout(1_000);
    const r = await reading(page);
    expect(r.marked, 'the arrow did not return to the Community the member left').toBe(true);
    expect(r.roots, 'a second Community screen exists in the DOM').toBe(1);
  });

  test('X3b the chrome arrow from MOVE on You is "the step before this": it returns to You', async ({ page }) => {
    test.setTimeout(300_000);
    const fx = await seed('x3b');
    await arrive(page, fx);
    await markVisibleCommunity(page);
    await page.getByTestId('wsf-member-tab-you').last().click();
    await expect(page.getByTestId('wsf-you-identity').last()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('wsf-member-tab-move').last().click();
    await expect(page.getByTestId('wsf-contribute-move-screen').last()).toBeVisible({ timeout: 40_000 });
    const arrow = page.locator('[data-testid="wsf-contribute-back"]:visible').first();
    test.info().annotations.push({ type: 'arrow label', description: await arrow.innerText() });
    await arrow.click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe('/you');
    await page.waitForTimeout(1_000);
    const you = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('[data-testid="wsf-you-identity"]')).find((e) => (e as HTMLElement).offsetParent !== null) as HTMLElement | undefined;
      if (!el) return false;
      const b = el.getBoundingClientRect();
      return !!document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest('[data-testid="wsf-you-identity"]');
    });
    expect(you, 'You is not the screen on top').toBe(true);
    expect(await visibleCount(page, 'wsf-contribute-move-screen'), 'the move screen is still showing').toBe(0);
    const r = await reading(page);
    expect(r.roots, 'the Home tab\'s Community was duplicated').toBe(1);
  });

  test('X3c the chrome arrow on a cold arrival replaces with the community and leaves no entry behind', async ({ page }) => {
    test.setTimeout(300_000);
    await traceHistory(page);
    const fx = await seed('x3c');
    await signInVia(page, fx.email, fx.password);
    await page.goto(`/contribute/${fx.goalId}?groupId=${fx.groupId}&mode=move`);
    const arrow = page.locator('[data-testid="wsf-contribute-back"]:visible').first();
    await expect(arrow).toHaveText('Back to community', { timeout: 40_000 });
    const len0 = await page.evaluate(() => history.length);
    await clearHistoryOps(page);
    await arrow.click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe(`/community/${fx.groupId}`);
    await page.waitForTimeout(1_000);
    const ops = await historyOps(page);
    test.info().annotations.push({ type: 'history on the arrow', description: JSON.stringify(ops) });
    expect(ops.filter((o) => o.startsWith('pushState')), 'the arrow pushed a history entry').toEqual([]);
    expect(await page.evaluate(() => history.length), 'the arrow changed the history length').toBe(len0);
    const r = await reading(page);
    expect(r.roots).toBe(1);
    expect(r.tabBars).toBe(1);
    await page.goBack().catch(() => undefined);
    await page.waitForTimeout(1_500);
    expect(new URL(page.url()).pathname, 'Back returned to the contribution entry').not.toMatch(/^\/contribute\//);
  });

  test('X4 "Back to home" on a cold arrival goes to Home first, replaces, and leaves nothing behind for Back', async ({ page }) => {
    test.setTimeout(300_000);
    await traceHistory(page);
    const fx = await seed('x4');
    await signInVia(page, fx.email, fx.password);
    await page.goto(`/contribute/w7-no-such-goal-${stampId()}`);
    const home = page.locator('[data-testid="wsf-contribute-home"]:visible').first();
    await expect(home).toBeVisible({ timeout: 40_000 });
    await expect(home).toHaveText('Back to home');
    const reads: string[] = [];
    page.on('request', (req) => {
      const m = /\/us-central1\/(wsf[A-Za-z]+)/.exec(req.url());
      if (m && req.method() === 'POST') reads.push(m[1]!);
    });
    const len0 = await page.evaluate(() => history.length);
    await clearHistoryOps(page);
    await home.click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 40_000 }).toBe(`/community/${fx.groupId}`);
    await page.waitForTimeout(1_000);
    const ops = await historyOps(page);
    test.info().annotations.push({ type: 'history on the press', description: JSON.stringify(ops) });
    test.info().annotations.push({ type: 'reads after the press (recorded)', description: reads.join(',') });
    expect(ops.filter((o) => o.startsWith('pushState')), 'the exit pushed a history entry').toEqual([]);
    const toHome = ops.indexOf('replaceState /');
    expect(toHome, 'the address never went to Home').toBeGreaterThanOrEqual(0);
    expect(ops.indexOf(`replaceState /community/${fx.groupId}`), 'Home did not resolve the community after the press').toBeGreaterThan(toHome);
    expect(await page.evaluate(() => history.length), 'the exit changed the history length').toBe(len0);
    await page.goBack().catch(() => undefined);
    await page.waitForTimeout(1_500);
    const after = new URL(page.url()).pathname;
    test.info().annotations.push({ type: 'after Back', description: after });
    expect(after, 'Back returned to the dead-end contribution screen').not.toMatch(/^\/contribute\//);
    expect(await visibleCount(page, 'wsf-contribute-not-found'), 'the dead-end screen is on show again').toBe(0);
  });

  /*
    X5 / X5s — THE STALE-TOTAL CONSEQUENCE OF THE KNOWN WARM DUPLICATE (L0
    #434 `5803105016` bound 3; the duplicate itself is W9's measurement,
    #458 `5802502922`, recorded and deferred by the Director, `5802767529`
    §3). A Champion's first contribution from Goal Setup's receipt exits by
    "Back to home"; on a warm arrival that builds a SECOND, freshly mounted
    Community. W8's settle re-read runs on a RETURN, not on a mount, and
    `wsfGoalPulse` answers from a 2 s server cache that a contribution does
    not invalidate. So a first read inside that window shows the total from
    before the contribution. The question is whether that is a bounded cache
    interval or stays stale after a success receipt.

    X5  natural timing, no stub: Submit is pressed straight after one of the
        review screen's own 2 s pulse polls, and "Back to home" as soon as the
        receipt shows. Records whether the fresh screen's first read landed
        inside the cache window, and what it showed.
    X5s the consequence, made certain: every pulse issued from the press to
        1.5 s after landing is answered with a sentinel total (7, never a real
        value here), which is what the cache serves in that window. Then:
        corrected within W8's settle bound (4.5 s), or still stale at 15 s?
        What corrects it afterwards (a tab round trip)?
    Each asserts what the member should get: the server's total within the
    settle bound, holding.
  */
  test('X5 natural timing: after a first contribution from Goal Setup, "Back to home" shows the committed total', async ({ page }) => {
    test.setTimeout(300_000);
    const fx = await seedChampion('x5');
    const goalId = await firstGoalToContribute(page, fx);
    const pulses: Array<{ at: number; kind: 'req' | 'res' }> = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/us-central1\/wsfGoalPulse/.test(r.url())) pulses.push({ at: Date.now(), kind: 'req' });
    });
    page.on('response', (r) => {
      if (r.request().method() === 'POST' && /\/us-central1\/wsfGoalPulse/.test(r.url())) pulses.push({ at: Date.now(), kind: 'res' });
    });
    await page.getByTestId('wsf-contribute-entry').last().fill('20');
    await page.getByTestId('wsf-contribute-review').last().click();
    // Straight after one of the screen's own polls: the cache now holds 0.
    await page.waitForResponse((r) => /\/us-central1\/wsfGoalPulse/.test(r.url()), { timeout: 10_000 });
    const submittedAt = Date.now();
    await page.getByTestId('wsf-contribute-submit').last().click();
    await expect(page.getByTestId('wsf-contribute-receipt').last()).toBeVisible({ timeout: 40_000 });
    const receiptAt = Date.now();
    const lastPrewrite = Math.max(...pulses.filter((p) => p.kind === 'req' && p.at <= submittedAt).map((p) => p.at));
    const pressedAt = Date.now();
    await pressLabelledExit(page, 'Back to home');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe(`/community/${fx.groupId}`);
    const landedAt = Date.now();
    const timeline = await sampleTotal(page, goalId, landedAt, landedAt + 10_000);
    const server = await serverTotal(goalId);
    const firstFresh = pulses.find((p) => p.kind === 'req' && p.at >= pressedAt)?.at ?? NaN;
    const r = await reading(page);
    const m = {
      server,
      submitToReceiptMs: receiptAt - submittedAt,
      receiptToPressMs: pressedAt - receiptAt,
      lastPrewritePollToFirstFreshReadMs: firstFresh - lastPrewrite,
      insideCacheWindow: firstFresh - lastPrewrite < 2_000,
      pulsesAfterLandingMs: pulses.filter((p) => p.kind === 'req' && p.at >= landedAt).map((p) => p.at - landedAt),
      timeline: changes(timeline),
      roots: r.roots,
      tabBars: r.tabBars,
    };
    test.info().annotations.push({ type: 'X5 measured', description: JSON.stringify(m) });
    expect(server, 'the server did not commit the 20').toBe(20);
    const at = (ms: number) => timeline.filter(([t]) => t >= ms).map(([, v]) => v)[0];
    expect(at(4_500), 'the total shown 4.5 s after landing is not the committed one').toBe(20);
    expect(timeline[timeline.length - 1]![1], 'the committed total did not hold').toBe(20);
  });

  test('X5s a stale first read on the fresh Community after "Back to home" is corrected within the settle bound', async ({ page }) => {
    test.setTimeout(300_000);
    const fx = await seedChampion('x5s');
    const goalId = await firstGoalToContribute(page, fx);
    await recordTwenty(page);
    expect(await serverTotal(goalId), 'the server did not commit the 20').toBe(20);

    const STALE = 7;
    let pressedAt = Number.POSITIVE_INFINITY;
    let staleUntil = Number.POSITIVE_INFINITY;
    const served: Array<{ at: number; stale: boolean }> = [];
    await page.route('**/us-central1/wsfGoalPulse', async (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const now = Date.now();
      if (now < pressedAt) return route.continue();
      if (now >= staleUntil) {
        served.push({ at: now, stale: false });
        return route.continue();
      }
      const res = await route.fetch();
      const body = (await res.json()) as { result?: { sharedTotal?: number } };
      if (!body.result || typeof body.result.sharedTotal !== 'number') throw new Error('unexpected pulse shape');
      body.result.sharedTotal = STALE;
      served.push({ at: now, stale: true });
      await route.fulfill({ response: res, json: body });
    });

    pressedAt = Date.now();
    await pressLabelledExit(page, 'Back to home');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe(`/community/${fx.groupId}`);
    const landedAt = Date.now();
    staleUntil = landedAt + 1_500;
    const timeline = await sampleTotal(page, goalId, landedAt, landedAt + 15_000);
    const r = await reading(page);

    // What corrects it: a tab round trip (Progress, then Home).
    await page.getByTestId('wsf-member-tab-activity').last().click();
    await page.waitForURL((u) => u.pathname.startsWith('/activity'), { timeout: 20_000 });
    await page.waitForTimeout(1_000);
    const backAt = Date.now();
    await page.getByTestId('wsf-member-tab-home').last().click();
    const afterRoundTrip = await sampleTotal(page, goalId, backAt, backAt + 6_000);

    const sawStale = timeline.some(([, v]) => v === STALE);
    const firstStale = timeline.find(([, v]) => v === STALE)?.[0] ?? null;
    const correctedAt = firstStale === null ? null : (timeline.find(([t, v]) => t > firstStale && v === 20)?.[0] ?? null);
    const m = {
      servedMsAfterLanding: served.map((x) => `${x.at - landedAt}${x.stale ? ' stale' : ''}`),
      timeline: changes(timeline),
      correctedAtMs: correctedAt,
      at15s: timeline[timeline.length - 1]![1],
      afterRoundTrip: changes(afterRoundTrip),
      roots: r.roots,
      tabBars: r.tabBars,
    };
    test.info().annotations.push({ type: 'X5s measured', description: JSON.stringify(m) });
    // The stub must reach the screen, or the rest proves nothing.
    expect(sawStale, 'the stale first read never reached the screen on show').toBe(true);
    expect(correctedAt, `the stale total was not corrected within the settle bound: ${JSON.stringify(m)}`).not.toBeNull();
    expect(correctedAt! - firstStale!, 'corrected, but later than the settle bound').toBeLessThanOrEqual(4_500);
    expect(m.at15s, 'the corrected total did not hold').toBe(20);
  });

  /*
    X6 — THE EXPLICIT LIST, THEN A CONTRIBUTION, THEN "BACK TO HOME" (the
    second of the two journeys the Director named for W9's option 1, #365
    `5803510323`; W9's comparison #458 `5803479617`). The member asked for the
    list (`/?view=communities`) and saw the card "… 1,847 of 5,000 squats";
    MOVE's one-goal handoff, +20 committed, an own-only receipt (the server's
    shared fields withheld in the response, W9's labelled injection; the
    write commits) so the exit reads "Back to home"; then the press.

    What the member should get, per the contract: the list they asked for
    (address kept), the SAME list instance in the foreground, one tab
    navigator, and the card refreshed to the server's total within a bounded
    time. On 7ee70e4f (cd02949's exits) the list request is dropped and Home
    opens the community; on 37082fd ⊕ eff65b0 the list is kept but stays at
    1,847 (W9's measurement). Both are failures of this one test.
  */
  test('X6 the explicit list survives a contribution\'s "Back to home": same list, in front, refreshed to the server\'s total', async ({ page }) => {
    test.setTimeout(300_000);
    const fx = await seed('x6');
    await traceHistory(page);
    await signInVia(page, fx.email, fx.password);
    await page.goto('/?view=communities');
    const card = page.locator(`[data-testid="wsf-home-community-${fx.groupId}"]:visible`).first();
    await expect(card).toContainText(SEEDED.toLocaleString('en-US'), { timeout: 40_000 });
    await page.evaluate(() => {
      const list = Array.from(document.querySelectorAll('[data-testid="wsf-home-my-list"]')).find((el) => (el as HTMLElement).offsetParent !== null);
      if (!list) throw new Error('no visible list to mark');
      list.setAttribute('data-w7-list', 'kept');
    });
    await page.getByTestId('wsf-member-tab-move').last().click();
    await expect(page.getByTestId('wsf-contribute-move-screen').last()).toBeVisible({ timeout: 40_000 });
    await page.getByTestId('wsf-contribute-done').last().click();
    // Own-only receipt: the shared fields are withheld from the response; the write commits.
    await page.route('**/us-central1/wsfContribute', async (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const res = await route.fetch();
      const body = (await res.json()) as { result?: Record<string, unknown> };
      if (!body.result) return route.fulfill({ response: res });
      for (const k of ['sharedTotal', 'target', 'unit', 'status']) delete body.result[k];
      await route.fulfill({ response: res, json: body });
    });
    await recordTwenty(page);
    expect(await serverTotal(fx.goalId), 'the server did not commit the 20').toBe(SEEDED + 20);
    // Read just before the press: MOVE's own push is part of the journey, not of the exit.
    const historyBefore = await page.evaluate(() => history.length);
    await pressLabelledExit(page, 'Back to home');
    const pressedAt = Date.now();

    const sample = () =>
      page.evaluate((groupId) => {
        const lists = Array.from(document.querySelectorAll('[data-testid="wsf-home-my-list"]')) as HTMLElement[];
        const shownList = lists.find((el) => el.offsetParent !== null) ?? null;
        const cardEl = shownList?.querySelector(`[data-testid="wsf-home-community-${groupId}"]`) as HTMLElement | null;
        // The card's total is the "<total> of <target>" pair, not the first digit
        // on the card (the community's name carries a 7).
        const m = cardEl ? /(\d[\d,]*) of (\d[\d,]*)/.exec(cardEl.innerText) : null;
        // Hit-tested at the CARD's own centre: what is in front where the card is drawn.
        const rect = cardEl?.getBoundingClientRect();
        const hit = rect ? (document.elementFromPoint(rect.left + rect.width / 2, Math.min(rect.top + rect.height / 2, window.innerHeight - 1)) as HTMLElement | null) : (document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2) as HTMLElement | null);
        return {
          path: location.pathname + location.search,
          foreground: hit?.closest(`[data-testid="wsf-home-community-${groupId}"]`) ? 'list' : hit?.closest('[data-testid="wsf-community"]') ? 'community' : (hit?.closest('[data-testid]') as HTMLElement | null)?.dataset.testid ?? '-',
          listMarked: shownList?.getAttribute('data-w7-list') === 'kept',
          lists: lists.length,
          cardTotal: m ? Number(m[1]!.replace(/,/g, '')) : null,
          communityRoots: document.querySelectorAll('[data-testid="wsf-community"]').length,
          tabBars: document.querySelectorAll('[data-testid="wsf-member-tabs"]').length,
          historyLength: history.length,
        };
      }, fx.groupId);
    const timeline: Array<{ t: number; s: Awaited<ReturnType<typeof sample>> }> = [];
    while (Date.now() < pressedAt + 10_000) {
      timeline.push({ t: Date.now() - pressedAt, s: await sample() });
      await page.waitForTimeout(500);
    }
    const at = (ms: number) => timeline.find((x) => x.t >= ms)?.s ?? timeline[timeline.length - 1]!.s;
    const last = timeline[timeline.length - 1]!.s;
    const refreshedAt = timeline.find((x) => x.s.cardTotal === SEEDED + 20)?.t ?? null;
    test.info().annotations.push({
      type: 'X6 measured',
      description: JSON.stringify({ historyBefore, at4s: at(4_000), last, refreshedAtMs: refreshedAt, ops: await historyOps(page) }),
    });
    expect(at(4_000).path, 'the list the member asked for was dropped').toBe('/?view=communities');
    expect(at(4_000).foreground, 'the list is not what is in front').toBe('list');
    expect(at(4_000).listMarked, 'the list in front is not the one the member was looking at').toBe(true);
    expect(last.tabBars, 'one tab bar').toBe(1);
    expect(last.historyLength, 'the exit added a history entry').toBe(historyBefore);
    expect(refreshedAt, `the card still shows the pre-contribution total 10 s after the return: ${JSON.stringify(last)}`).not.toBeNull();
    expect(last.cardTotal, 'the refreshed total did not hold').toBe(SEEDED + 20);
    expect(last.listMarked, 'the refresh replaced the list instance').toBe(true);

    // Control: a query reload of the same address resolves the list afresh with the server's total.
    await page.reload();
    const reloaded = page.locator(`[data-testid="wsf-home-community-${fx.groupId}"]:visible`).first();
    await expect(reloaded, 'after a reload the list did not show the server total').toContainText((SEEDED + 20).toLocaleString('en-US'), { timeout: 40_000 });
    expect(new URL(page.url()).search, 'the reload dropped the list request').toBe('?view=communities');
  });

  /*
    X7 — W8'S FIRST-FOCUS SETTLE (`9d30c38b`, #462; Director #434
    `5804104996`). A fresh mount can read the pulse inside the 2 s cache window
    and be handed the pre-contribution total; the settle is now scheduled on
    the first focus too. These are independent of any exit: a DIRECT entry
    (`page.goto('/community/<id>')`, a full load, so a fresh mount whatever
    W9's exits become), with the first pulse answered stale (sentinel 1,848).

      X7   corrected by the first-focus settle within 4.5 s and holding;
           the member's own part stays its own figure (20) while the shared
           total corrects (1,867); then the active tab's reselect, after the
           settle, issues no read at all.
      X7b  a blur before 2.6 s (You tab) cancels the settle: no pulse follows.
      X7c  an account change before 2.6 s (sign out) cancels it too.
      X7d  THE DISCLOSED LIMIT: the initial pulse is still in flight when the
           settle fires (held 4 s, then stale). The settle only replaces
           figures already on screen, and the late initial read has no
           sequence guard. What is on screen at 12 s?
      X7e  the same race on the accepted RETURN path (eff65b0): after a
           genuine return, the return's first pulse is held 4 s and answers
           stale while the settle (2.6 s) answers fresh; which one is on
           screen at 12 s?
    Each asserts what the member should get: the server's total, holding.
  */
  const STALE = SEEDED + 1; // 1,848 never appears legitimately

  /** Answer the first `n` pulse POSTs after `from()` with the sentinel, each after `holdMs`. */
  async function staleFirstPulses(page: Page, n: number, holdMs = 0): Promise<{ arm: () => void; served: number[] }> {
    let armedAt = Number.POSITIVE_INFINITY;
    let count = 0;
    const served: number[] = [];
    await page.route('**/us-central1/wsfGoalPulse', async (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const now = Date.now();
      if (now < armedAt || count >= n) return route.continue();
      count += 1;
      if (holdMs > 0) await new Promise((r) => setTimeout(r, holdMs));
      const res = await route.fetch();
      const body = (await res.json()) as { result?: { sharedTotal?: number } };
      if (!body.result || typeof body.result.sharedTotal !== 'number') throw new Error('unexpected pulse shape');
      body.result.sharedTotal = STALE;
      served.push(now - armedAt);
      await route.fulfill({ response: res, json: body });
    });
    return { arm: () => { armedAt = Date.now(); }, served };
  }

  async function ownPart(page: Page, goalId: string): Promise<string> {
    return (await page.locator(`[data-testid="wsf-community-your-part-${goalId}"]:visible`).first().innerText({ timeout: 2_000 }).catch(() => '')).replace(/\s+/g, ' ').trim();
  }

  test('X7 a direct entry with a stale first read settles on the server total; own part distinct; reselect after the settle reads nothing', async ({ page }) => {
    test.setTimeout(300_000);
    const fx = await seed('x7');
    await arrive(page, fx);
    await contributeFromCommunity(page, fx);
    expect(await serverTotal(fx.goalId)).toBe(SEEDED + 20);
    const stub = await staleFirstPulses(page, 1);
    const pulses = watchCalls(page, ['wsfGoalPulse']);
    stub.arm();
    const enteredAt = Date.now();
    await page.goto(`/community/${fx.groupId}`);
    const timeline = await sampleTotal(page, fx.goalId, enteredAt, enteredAt + 12_000);
    const firstStale = timeline.find(([, v]) => v === STALE)?.[0] ?? null;
    const correctedAt = firstStale === null ? null : (timeline.find(([t, v]) => t > firstStale && v === SEEDED + 20)?.[0] ?? null);
    const own = await ownPart(page, fx.goalId);
    // Reselect, after the settle: nothing may be read.
    const all = watchCalls(page, ['wsfGoalPulse', 'wsfMyContribution', 'wsfListGoals', 'wsfCommunityActivity', 'wsfCommunityMembers']);
    const before = all.length;
    await page.getByTestId('wsf-member-tab-home').last().click();
    await page.waitForTimeout(4_000);
    const m = { timeline: changes(timeline), pulsesMs: pulses.map((p) => p.at - enteredAt), staleServedMs: stub.served, correctedAtMs: correctedAt, at12s: timeline[timeline.length - 1]![1], own, readsOnReselect: all.length - before, roots: (await reading(page)).roots };
    test.info().annotations.push({ type: 'X7 measured', description: JSON.stringify(m) });
    expect(firstStale, 'the stale first read never reached the screen').not.toBeNull();
    expect(correctedAt, `never corrected: ${JSON.stringify(m)}`).not.toBeNull();
    expect(correctedAt! - firstStale!, 'corrected later than the settle bound').toBeLessThanOrEqual(4_500);
    expect(m.at12s, 'the corrected total did not hold').toBe(SEEDED + 20);
    expect(own, "the member's own part does not show their own 20").toMatch(/\b20\b/);
    expect(own, "the member's own part shows the shared total").not.toMatch(/1,8\d\d/);
    expect(m.readsOnReselect, 'reselecting the active tab after the settle issued a read').toBe(0);
  });

  for (const leg of ['a blur (You tab)', 'an account change (sign out)'] as const) {
    test(`X7${leg.startsWith('a blur') ? 'b' : 'c'} ${leg} before 2.6 s cancels the first-focus settle`, async ({ page }) => {
      test.setTimeout(300_000);
      const fx = await seed(leg.startsWith('a blur') ? 'x7b' : 'x7c');
      await signInVia(page, fx.email, fx.password);
      const pulses = watchCalls(page, ['wsfGoalPulse']);
      const enteredAt = Date.now();
      await page.goto(`/community/${fx.groupId}`);
      await expect(page.locator(`[data-testid="wsf-community-goal-total-${fx.goalId}"]:visible`).first()).toBeVisible({ timeout: 40_000 });
      const leftAt = Date.now();
      expect(leftAt - enteredAt, 'precondition: the leave must precede the 2.6 s settle').toBeLessThan(2_300);
      await page.getByTestId('wsf-member-tab-you').last().click();
      await expect(page.getByTestId('wsf-you-identity').last()).toBeVisible({ timeout: 30_000 });
      if (!leg.startsWith('a blur')) {
        await page.getByTestId('wsf-you-signout').last().click();
        await expect(page.getByTestId('wsf-home-signin').last()).toBeVisible({ timeout: 20_000 });
      }
      await page.waitForTimeout(Math.max(0, leftAt + 6_000 - Date.now()));
      const before = pulses.filter((p) => p.at < leftAt).length;
      const after = pulses.filter((p) => p.at >= leftAt).map((p) => p.at - enteredAt);
      test.info().annotations.push({ type: 'pulses', description: JSON.stringify({ beforeLeaving: before, afterLeavingMs: after }) });
      expect(before, 'precondition: the mount read the pulse').toBeGreaterThan(0);
      expect(after, 'a settle read followed after the screen was left').toEqual([]);
    });
  }

  test('X7d the disclosed limit: an initial read still in flight when the settle fires — what stays on screen', async ({ page }) => {
    test.setTimeout(300_000);
    const fx = await seed('x7d');
    await arrive(page, fx);
    await contributeFromCommunity(page, fx);
    expect(await serverTotal(fx.goalId)).toBe(SEEDED + 20);
    const stub = await staleFirstPulses(page, 1, 4_000);
    const pulses = watchCalls(page, ['wsfGoalPulse']);
    stub.arm();
    const enteredAt = Date.now();
    await page.goto(`/community/${fx.groupId}`);
    const timeline = await sampleTotal(page, fx.goalId, enteredAt, enteredAt + 12_000);
    const m = { timeline: changes(timeline), pulsesMs: pulses.map((p) => p.at - enteredAt), staleServedMs: stub.served, staleEverShown: timeline.some(([, v]) => v === STALE), at12s: timeline[timeline.length - 1]![1] };
    test.info().annotations.push({ type: 'X7d measured', description: JSON.stringify(m) });
    // Precondition: the held stale answer was DELIVERED (the stub served it). Whether it
    // ever reached the screen is recorded: a build with a sequence guard rejects it.
    expect(stub.served.length, 'the held stale read was never delivered').toBe(1);
    expect(m.at12s, `stale progress stays in view: ${JSON.stringify(m)}`).toBe(SEEDED + 20);
  });

  test('X7e the same race on a return: the return\'s first read held past the settle', async ({ page }) => {
    test.setTimeout(300_000);
    const fx = await seed('x7e');
    await arrive(page, fx);
    await markVisibleCommunity(page);
    await contributeFromCommunity(page, fx);
    await pressLabelledExit(page, 'Back to community');
    const total = page.locator(`[data-testid="wsf-community-goal-total-${fx.goalId}"]:visible`).first();
    await expect(total).toContainText((SEEDED + 20).toLocaleString('en-US'), { timeout: 15_000 });
    await page.waitForTimeout(4_000); // past the return's own settle
    const stub = await staleFirstPulses(page, 1, 4_000);
    const pulses = watchCalls(page, ['wsfGoalPulse']);
    await page.getByTestId('wsf-member-tab-you').last().click();
    await expect(page.getByTestId('wsf-you-identity').last()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_000);
    stub.arm();
    const returnedAt = Date.now();
    await page.getByTestId('wsf-member-tab-home').last().click();
    const timeline = await sampleTotal(page, fx.goalId, returnedAt, returnedAt + 12_000);
    const r = await reading(page);
    const m = { timeline: changes(timeline), pulsesMs: pulses.map((p) => p.at - returnedAt), staleServedMs: stub.served, at12s: timeline[timeline.length - 1]![1], marked: r.marked, roots: r.roots };
    test.info().annotations.push({ type: 'X7e measured', description: JSON.stringify(m) });
    expect(r.marked, 'the return did not land on the same Community').toBe(true);
    expect(m.at12s, `stale progress stays in view after a return: ${JSON.stringify(m)}`).toBe(SEEDED + 20);
  });

  /*
    X7f — ACCOUNT ISOLATION OF THE SETTLE (Director #462 `5804115569`; W8's
    source reading `5804147831`: the settle effect's cleanup is keyed to its
    token only, and the Community stays mounted through an in-app sign-out).
    A and B are members of the same community. B has recorded 5, A 20. A's
    RETURN settle (the pulse + own-credit pair issued 2.6 s after a return) is
    HELD; meanwhile A signs out and B signs in, inside the app; B's figures
    load on the community; then A's held answers are released. B's own part
    must read B's 5 before and after the release, never A's 20. The shared
    total is the same for both, so it cannot prove isolation; own credit can.
  */
  test('X7f an old account\'s settle answer released after the next account loaded the same goal does not become that account\'s own figure', async ({ page }) => {
    test.setTimeout(300_000);
    const fx = await seed('x7f');
    const b = { email: `w7ex-x7fb-${fx.groupId}@example.com`, password: `Aa1!${randomBytes(6).toString('hex')}`, uid: '' };
    b.uid = await seedVerifiedUser(b.email, b.password);
    await seedProfile(b.uid, 'Sam Field');
    await seedMembership(fx.groupId, b.uid, 'member');
    // B records 5, then A records 20 (each sign-in is a full load).
    await arrive(page, { ...fx, email: b.email, password: b.password, uid: b.uid });
    await page.getByTestId(`wsf-community-goal-link-${fx.goalId}`).last().click();
    await expect(page.getByTestId('wsf-contribute-move-screen').last()).toBeVisible({ timeout: 40_000 });
    await page.getByTestId('wsf-contribute-done').last().click();
    await page.getByTestId('wsf-contribute-entry').last().fill('5');
    await page.getByTestId('wsf-contribute-review').last().click();
    await page.getByTestId('wsf-contribute-submit').last().click();
    await expect(page.getByTestId('wsf-contribute-receipt').last()).toBeVisible({ timeout: 40_000 });
    // B signs out first: /signin sends a signed-in member away, so A could
    // never reach the form otherwise (the cause of this probe's first runs
    // stopping at the sign-in form).
    await page.goto('/you');
    await expect(page.getByTestId('wsf-you-signout').last()).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('wsf-you-signout').last().click();
    await expect(page.locator('[data-testid="wsf-home-signin"]:visible').first()).toBeVisible({ timeout: 20_000 });
    await arrive(page, fx);
    await markVisibleCommunity(page);
    await contributeFromCommunity(page, fx);
    expect(await serverTotal(fx.goalId)).toBe(SEEDED + 25);
    await pressLabelledExit(page, 'Back to community');
    await expect(page.locator(`[data-testid="wsf-community-goal-total-${fx.goalId}"]:visible`).first()).toContainText((SEEDED + 25).toLocaleString('en-US'), { timeout: 15_000 });
    await page.waitForTimeout(4_000);
    expect(await ownPart(page, fx.goalId), "precondition: A's own part").toMatch(/\b20\b/);

    // Hold A's return settle (the pulse / own-credit pair issued 2.0–3.6 s after
    // the return) until B's own figure is on screen: a latch, not a timer. Each
    // held answer records whether it was delivered to the page or aborted.
    let armedAt = Number.POSITIVE_INFINITY;
    let releaseLatch: () => void = () => {};
    const released = new Promise<void>((r) => { releaseLatch = r; });
    const held: Array<{ name: string; issuedMs: number; releasedMs: number; delivered: boolean | null }> = [];
    await page.route(/\/us-central1\/(wsfGoalPulse|wsfMyContribution)$/, async (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const now = Date.now();
      if (now - armedAt < 2_000 || now - armedAt > 3_600) return route.continue();
      const name = /\/(wsf[A-Za-z]+)$/.exec(route.request().url())![1]!;
      const entry = { name, issuedMs: now - armedAt, releasedMs: -1, delivered: null as boolean | null };
      held.push(entry);
      await released;
      entry.releasedMs = Date.now() - armedAt;
      try {
        await route.continue();
        entry.delivered = true;
      } catch {
        entry.delivered = false;
      }
    });
    await page.getByTestId('wsf-member-tab-you').last().click();
    await expect(page.getByTestId('wsf-you-identity').last()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_000);
    armedAt = Date.now();
    await page.getByTestId('wsf-member-tab-home').last().click();
    await page.waitForTimeout(3_700); // the settle's requests are now issued and held
    const heldNames = held.map((h) => h.name).sort();

    // Switch to B inside the app. The state after each step is recorded, so a
    // step that does not reach the sign-in form is a fact, not a guess.
    const state = async (step: string) => {
      const x = await page.evaluate(() => ({
        url: location.pathname + location.search,
        marked: !!document.querySelector('[data-testid="wsf-community"][data-w7-exit="kept"]'),
        markedRendered: ((el) => !!el && el.offsetParent !== null)(document.querySelector('[data-testid="wsf-community"][data-w7-exit="kept"]') as HTMLElement | null),
        visible: Array.from(document.querySelectorAll('[data-testid]')).filter((el) => (el as HTMLElement).offsetParent !== null).map((el) => (el as HTMLElement).dataset.testid!).filter((t) => /^wsf-(home|signin|community|you|member-tabs)/.test(t)).slice(0, 25),
      }));
      test.info().annotations.push({ type: `after ${step}`, description: JSON.stringify(x) });
      return x;
    };
    await page.getByTestId('wsf-member-tab-you').last().click();
    await expect(page.getByTestId('wsf-you-signout').last()).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('wsf-you-signout').last().click();
    const signin = page.locator('[data-testid="wsf-home-signin"]:visible').first();
    await expect(signin).toBeVisible({ timeout: 20_000 });
    const afterSignOut = await state('sign-out');
    await signin.click();
    await page.waitForTimeout(2_000);
    const afterPress = await state('the sign-in press');
    const form = page.getByTestId('wsf-signin-email');
    if ((await form.count()) === 0 || !(await form.isVisible())) {
      // Second route to the same form, in-app: the address bar is not used.
      await page.locator('[data-testid="wsf-home-signin"]:visible').first().click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(2_000);
    }
    await expect(form, `the sign-in form did not open in-app: ${JSON.stringify({ afterSignOut, afterPress })}`).toBeVisible({ timeout: 10_000 });
    await form.fill(b.email);
    await page.getByTestId('wsf-signin-password').fill(b.password);
    await page.getByTestId('wsf-signin-submit').click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe(`/community/${fx.groupId}`);
    await expect.poll(() => ownPart(page, fx.goalId), { timeout: 30_000 }).toMatch(/\b5\b/);
    const bLoadedAt = Date.now() - armedAt;
    const afterB = await state("B's arrival");
    const sameInstance = (await reading(page)).marked;
    const beforeRelease = await ownPart(page, fx.goalId);
    releaseLatch();
    // Sample B's own part through and past the release.
    const samples: string[] = [];
    const until = Date.now() + 8_000;
    while (Date.now() < until) {
      samples.push(`${Date.now() - armedAt}ms:${await ownPart(page, fx.goalId)}`);
      await page.waitForTimeout(300);
    }
    const m = { heldNames, held, bLoadedAtMs: bLoadedAt, sameInstance, afterB, beforeRelease, samples: samples.filter((x, i, a) => i === 0 || x.split(':')[1] !== a[i - 1]!.split(':')[1]) };
    test.info().annotations.push({ type: 'X7f measured', description: JSON.stringify(m) });
    expect(heldNames, "precondition: A's settle pair (pulse + own credit) was held").toEqual(['wsfGoalPulse', 'wsfMyContribution']);
    expect(sameInstance, 'CANNOT-MEASURE the same-instance race: the marked Community did not survive the account switch').toBe(true);
    expect(held.every((h) => h.releasedMs > bLoadedAt), "precondition: released only after B's figure had loaded").toBe(true);
    expect(held.every((h) => h.delivered === true), `a held answer was not delivered to the page: ${JSON.stringify(held)}`).toBe(true);
    expect(beforeRelease, "B's own part before the release").toMatch(/\b5\b/);
    for (const x of samples) expect(x, `A's 20 was on B's screen: ${JSON.stringify(m)}`).not.toMatch(/:.*\b20\b/);
    expect(samples[samples.length - 1], "B's own part after the release").toMatch(/\b5\b/);
  });

  /*
    X6b — HOME'S RETURN RE-READ ACROSS AN ACCOUNT CHANGE (W9 option 1,
    `945d6736`; Director #434 `5804129224`: "one held Home-return read crossing
    an in-app account switch should verify no prior-account list/card result
    appears"). A asked for the list; a genuine return issues Home's re-read
    (wsfMyCommunities, then wsfListGoals per card). Those answers are HELD
    while A signs out and B signs in inside the app; B belongs to two other
    communities, so B's Home shows B's list; then A's held answers are
    released. B's list must still be B's: A's community never appears.
    On 7ee70e4f Home has no return re-read, so nothing is held there and the
    precondition fails: the path is W9's, not inherited.
  */
  test('X6b an old account\'s held Home re-read, released after the next account\'s list loaded, puts nothing of it on that list', async ({ page }) => {
    test.setTimeout(300_000);
    const fx = await seed('x6b');
    const id = stampId();
    const b = { email: `w7ex-x6bb-${id}@example.com`, password: `Aa1!${randomBytes(6).toString('hex')}`, uid: '' };
    b.uid = await seedVerifiedUser(b.email, b.password);
    await seedProfile(b.uid, 'Sam Field');
    const bGroups = [`w7ex-x6b-b1-${id}`, `w7ex-x6b-b2-${id}`];
    await seedCommunity({ groupId: bGroups[0]!, displayName: 'W7 Other Movers One', joinPolicy: 'private', members: [{ uid: b.uid, role: 'member' }] });
    await seedCommunity({ groupId: bGroups[1]!, displayName: 'W7 Other Movers Two', joinPolicy: 'private', members: [{ uid: b.uid, role: 'member' }] });

    await signInVia(page, fx.email, fx.password);
    await page.goto('/?view=communities');
    await expect(page.locator(`[data-testid="wsf-home-community-${fx.groupId}"]:visible`).first()).toContainText(SEEDED.toLocaleString('en-US'), { timeout: 40_000 });
    await page.getByTestId('wsf-member-tab-you').last().click();
    await expect(page.getByTestId('wsf-you-identity').last()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_000);

    let armedAt = Number.POSITIVE_INFINITY;
    let releaseLatch: () => void = () => {};
    const released = new Promise<void>((r) => { releaseLatch = r; });
    const held: Array<{ name: string; issuedMs: number; releasedMs: number; delivered: boolean | null }> = [];
    await page.route(/\/us-central1\/(wsfMyCommunities|wsfListGoals)$/, async (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const now = Date.now();
      // Only the return's own reads (the first 3 s after the return) are held,
      // until B's list is on screen (a latch, not a timer); each records
      // whether it was delivered or aborted.
      if (now < armedAt || now - armedAt > 3_000) return route.continue();
      const name = /\/(wsf[A-Za-z]+)$/.exec(route.request().url())![1]!;
      const entry = { name, issuedMs: now - armedAt, releasedMs: -1, delivered: null as boolean | null };
      held.push(entry);
      await released;
      entry.releasedMs = Date.now() - armedAt;
      try {
        await route.continue();
        entry.delivered = true;
      } catch {
        entry.delivered = false;
      }
    });
    armedAt = Date.now();
    await page.getByTestId('wsf-member-tab-home').last().click();
    await page.waitForTimeout(3_200);

    // Switch to B inside the app; B's Home shows B's list (two communities).
    await page.getByTestId('wsf-member-tab-you').last().click();
    await expect(page.getByTestId('wsf-you-signout').last()).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('wsf-you-signout').last().click();
    const signin = page.locator('[data-testid="wsf-home-signin"]:visible').first();
    await expect(signin).toBeVisible({ timeout: 20_000 });
    await signin.click();
    // Diagnostic (recorded on failure): where the press landed and what is in front.
    const diag = async () =>
      page.evaluate(() => {
        const vis = Array.from(document.querySelectorAll('[data-testid]')).filter((el) => (el as HTMLElement).offsetParent !== null).map((el) => (el as HTMLElement).dataset.testid).filter((t) => /^wsf-(home|signin|community|you)/.test(t ?? '')).slice(0, 30);
        return { url: location.pathname + location.search, visible: vis };
      });
    await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 20_000 }).catch(async (e) => {
      test.info().annotations.push({ type: 'sign-in step diagnostic', description: JSON.stringify(await diag()) });
      throw e;
    });
    await page.getByTestId('wsf-signin-email').fill(b.email);
    await page.getByTestId('wsf-signin-password').fill(b.password);
    await page.getByTestId('wsf-signin-submit').click();
    await page.waitForURL((u) => u.pathname === '/', { timeout: 20_000 });
    for (const g of bGroups) await expect(page.locator(`[data-testid="wsf-home-community-${g}"]:visible`).first()).toBeVisible({ timeout: 40_000 });
    const bLoadedAt = Date.now() - armedAt;
    const listOf = () =>
      page.evaluate(() => {
        const list = Array.from(document.querySelectorAll('[data-testid="wsf-home-my-list"]')).find((el) => (el as HTMLElement).offsetParent !== null) as HTMLElement | undefined;
        return {
          cards: Array.from(list?.querySelectorAll('[data-testid^="wsf-home-community-"]') ?? []).map((c) => (c as HTMLElement).dataset.testid!.replace('wsf-home-community-', '')),
          text: (list?.innerText ?? '').replace(/\s+/g, ' ').trim(),
          aAnywhere: document.body.textContent?.includes('W7 Exit Movers') ?? false,
        };
      });
    const before = await listOf();
    releaseLatch();
    const samples: Array<{ t: number; cards: string[]; aAnywhere: boolean }> = [];
    const until = Date.now() + 8_000;
    while (Date.now() < until) {
      const l = await listOf();
      samples.push({ t: Date.now() - armedAt, cards: l.cards.sort(), aAnywhere: l.aAnywhere });
      await page.waitForTimeout(300);
    }
    const after = await listOf();
    const m = { held, bLoadedAtMs: bLoadedAt, before, after, samples: samples.filter((x, i, a) => i === 0 || x.cards.join() !== a[i - 1]!.cards.join() || x.aAnywhere !== a[i - 1]!.aAnywhere) };
    test.info().annotations.push({ type: 'X6b measured', description: JSON.stringify(m) });
    expect(held.map((h) => h.name).includes('wsfMyCommunities'), "precondition: A's return list read was issued and held (none on a build with no return re-read)").toBe(true);
    expect(held.every((h) => h.releasedMs > bLoadedAt), "precondition: released only after B's list had loaded").toBe(true);
    expect(held.every((h) => h.delivered === true), `a held answer was not delivered to the page: ${JSON.stringify(held)}`).toBe(true);
    expect(before.cards.sort(), "B's list before the release").toEqual([...bGroups].sort());
    for (const x of samples) {
      expect(x.cards, `A's held answer changed B's list at ${x.t} ms: ${JSON.stringify(m)}`).toEqual([...bGroups].sort());
      expect(x.aAnywhere, `A's community name was on B's screen at ${x.t} ms`).toBe(false);
    }
    expect(after.cards.sort()).toEqual([...bGroups].sort());
  });

  /*
    X7g — THE SAME RACE WHERE THE INSTANCE SURVIVES: an account change WITHOUT
    navigation. X7f showed the in-app sign-out (You → Sign out → "/") unmounts
    the Community, so that path cannot race. Firebase auth is shared across
    tabs of one browser: here B signs out A and signs in from a SECOND tab,
    while the first tab keeps A's Community mounted (its own signed-out state,
    then B's figures on the same instance). A's return settle pair, held in
    the first tab, is released only after B's own figure is on that same
    instance. B's own part must stay B's 5, in every sample.
  */
  test('X7g the same instance across an account change made from another tab: the old settle answer never becomes the new account\'s figure', async ({ page, context }) => {
    test.setTimeout(300_000);
    const fx = await seed('x7g');
    const b = { email: `w7ex-x7gb-${fx.groupId}@example.com`, password: `Aa1!${randomBytes(6).toString('hex')}`, uid: '' };
    b.uid = await seedVerifiedUser(b.email, b.password);
    await seedProfile(b.uid, 'Sam Field');
    await seedMembership(fx.groupId, b.uid, 'member');
    await arrive(page, { ...fx, email: b.email, password: b.password, uid: b.uid });
    await page.getByTestId(`wsf-community-goal-link-${fx.goalId}`).last().click();
    await expect(page.getByTestId('wsf-contribute-move-screen').last()).toBeVisible({ timeout: 40_000 });
    await page.getByTestId('wsf-contribute-done').last().click();
    await page.getByTestId('wsf-contribute-entry').last().fill('5');
    await page.getByTestId('wsf-contribute-review').last().click();
    await page.getByTestId('wsf-contribute-submit').last().click();
    await expect(page.getByTestId('wsf-contribute-receipt').last()).toBeVisible({ timeout: 40_000 });
    await page.goto('/you');
    await page.getByTestId('wsf-you-signout').last().click();
    await expect(page.locator('[data-testid="wsf-home-signin"]:visible').first()).toBeVisible({ timeout: 20_000 });
    await arrive(page, fx);
    await markVisibleCommunity(page);
    await contributeFromCommunity(page, fx);
    expect(await serverTotal(fx.goalId)).toBe(SEEDED + 25);
    await pressLabelledExit(page, 'Back to community');
    await expect(page.locator(`[data-testid="wsf-community-goal-total-${fx.goalId}"]:visible`).first()).toContainText((SEEDED + 25).toLocaleString('en-US'), { timeout: 15_000 });
    await page.waitForTimeout(4_000);
    expect(await ownPart(page, fx.goalId), "precondition: A's own part").toMatch(/\b20\b/);

    let armedAt = Number.POSITIVE_INFINITY;
    let releaseLatch: () => void = () => {};
    const released = new Promise<void>((r) => { releaseLatch = r; });
    const held: Array<{ name: string; issuedMs: number; releasedMs: number; delivered: boolean | null }> = [];
    await page.route(/\/us-central1\/(wsfGoalPulse|wsfMyContribution)$/, async (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const now = Date.now();
      if (now - armedAt < 2_000 || now - armedAt > 3_600) return route.continue();
      const name = /\/(wsf[A-Za-z]+)$/.exec(route.request().url())![1]!;
      const entry = { name, issuedMs: now - armedAt, releasedMs: -1, delivered: null as boolean | null };
      held.push(entry);
      await released;
      entry.releasedMs = Date.now() - armedAt;
      try {
        await route.continue();
        entry.delivered = true;
      } catch {
        entry.delivered = false;
      }
    });
    await page.getByTestId('wsf-member-tab-you').last().click();
    await expect(page.getByTestId('wsf-you-identity').last()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_000);
    armedAt = Date.now();
    await page.getByTestId('wsf-member-tab-home').last().click();
    await page.waitForTimeout(3_700);
    const heldNames = held.map((h) => h.name).sort();

    // The account changes in ANOTHER tab; the first tab is not navigated.
    const tab2 = await context.newPage();
    await tab2.goto('/you');
    await expect(tab2.getByTestId('wsf-you-signout').last()).toBeVisible({ timeout: 20_000 });
    await tab2.getByTestId('wsf-you-signout').last().click();
    await expect(tab2.locator('[data-testid="wsf-home-signin"]:visible').first()).toBeVisible({ timeout: 20_000 });
    await tab2.goto('/signin');
    await expect(tab2.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 20_000 });
    await tab2.getByTestId('wsf-signin-email').fill(b.email);
    await tab2.getByTestId('wsf-signin-password').fill(b.password);
    await tab2.getByTestId('wsf-signin-submit').click();
    await tab2.waitForURL(/\/(profile-setup)?$/, { timeout: 20_000 });
    // Back in the first tab: the same instance shows B's figure?
    const state = async () =>
      page.evaluate(() => ({
        url: location.pathname,
        marked: !!document.querySelector('[data-testid="wsf-community"][data-w7-exit="kept"]'),
        markedRendered: ((el) => !!el && el.offsetParent !== null)(document.querySelector('[data-testid="wsf-community"][data-w7-exit="kept"]') as HTMLElement | null),
        signedOutState: document.querySelectorAll('[data-testid="wsf-community-signed-out"]').length,
      }));
    const bReady = await expect.poll(() => ownPart(page, fx.goalId), { timeout: 40_000 }).toMatch(/\b5\b/).then(() => true).catch(() => false);
    const bLoadedAt = Date.now() - armedAt;
    const afterB = await state();
    const beforeRelease = await ownPart(page, fx.goalId);
    releaseLatch();
    const samples: string[] = [];
    const until = Date.now() + 8_000;
    while (Date.now() < until) {
      samples.push(`${Date.now() - armedAt}ms:${await ownPart(page, fx.goalId)}`);
      await page.waitForTimeout(300);
    }
    const m = { heldNames, held, bReady, bLoadedAtMs: bLoadedAt, afterB, beforeRelease, samples: samples.filter((x, i, a) => i === 0 || x.split(':')[1] !== a[i - 1]!.split(':')[1]) };
    test.info().annotations.push({ type: 'X7g measured', description: JSON.stringify(m) });
    await tab2.close();
    expect(heldNames, "precondition: A's settle pair was held").toEqual(['wsfGoalPulse', 'wsfMyContribution']);
    // The DOM mark is recorded, not asserted: the auth change re-renders the
    // screen's root node (the mark goes with it) while the component instance
    // and its effects live on — which a held answer of A's changing B's screen
    // proves better than any attribute could.
    expect(bReady, "precondition: B's own figure loaded on the screen the first tab kept").toBe(true);
    expect(held.every((h) => h.releasedMs > bLoadedAt && h.delivered === true), `held answers not delivered after B loaded: ${JSON.stringify(held)}`).toBe(true);
    for (const x of samples) expect(x, `A's 20 was on B's screen: ${JSON.stringify(m)}`).not.toMatch(/:.*\b20\b/);
    expect(samples[samples.length - 1], "B's own part after the release").toMatch(/\b5\b/);
  });

  /*
    X7h — THE SETTLE TIMER FIRES BEFORE THE GOAL LIST IS READY (W8's third
    boundary, #462 `5805516792`). A direct entry whose first wsfListGoals
    answer is held 4 s, past the 2.6 s timer, and whose first pulse (which can
    only follow the list) is answered stale. On 9d30c38b the timer found no
    list, consumed its token and issued nothing: the stale figure stays. The
    contract: the settle owed is issued once the list lands, and the total is
    the server's within the settle bound of the list's arrival.
  */
  test('X7h a goal list that lands after the settle timer still gets its settle: the stale first read is corrected', async ({ page }) => {
    test.setTimeout(300_000);
    const fx = await seed('x7h');
    await arrive(page, fx);
    await contributeFromCommunity(page, fx);
    expect(await serverTotal(fx.goalId)).toBe(SEEDED + 20);
    let armedAt = Number.POSITIVE_INFINITY;
    let listHeld = 0;
    await page.route('**/us-central1/wsfListGoals', async (route: Route) => {
      if (route.request().method() !== 'POST' || Date.now() < armedAt || listHeld > 0) return route.continue();
      listHeld += 1;
      await new Promise((r) => setTimeout(r, 4_000));
      await route.continue().catch(() => undefined);
    });
    const stub = await staleFirstPulses(page, 1);
    const pulses = watchCalls(page, ['wsfGoalPulse']);
    stub.arm();
    armedAt = Date.now();
    const enteredAt = Date.now();
    await page.goto(`/community/${fx.groupId}`);
    const timeline = await sampleTotal(page, fx.goalId, enteredAt, enteredAt + 14_000);
    const listLandedAt = 4_000 + (pulses[0] ? 0 : 0);
    const firstShown = timeline.find(([, v]) => v !== null) ?? null;
    const correctedAt = timeline.find(([t, v]) => v === SEEDED + 20 && t > (firstShown?.[0] ?? 0))?.[0] ?? null;
    const m = { listHeld, timeline: changes(timeline), pulsesMs: pulses.map((p) => p.at - enteredAt), staleServedMs: stub.served, firstShownMs: firstShown?.[0] ?? null, correctedAtMs: correctedAt, at14s: timeline[timeline.length - 1]![1] };
    test.info().annotations.push({ type: 'X7h measured', description: JSON.stringify(m) });
    expect(listHeld, 'precondition: the goal list answer was held past the timer').toBe(1);
    expect(stub.served.length, 'precondition: the first pulse (after the list) was answered stale').toBe(1);
    expect(m.at14s, `the stale figure stays after a late goal list: ${JSON.stringify(m)}`).toBe(SEEDED + 20);
    expect(pulses.length, 'no settle read followed the late goal list').toBeGreaterThanOrEqual(2);
    void listLandedAt;
  });
});
