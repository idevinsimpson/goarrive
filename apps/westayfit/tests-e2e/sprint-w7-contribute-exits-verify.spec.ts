import { randomBytes } from 'node:crypto';

import { expect, test, type Page, type Route } from '@playwright/test';

import {
  FIRESTORE_EMULATOR,
  PROJECT_ID,
  seedActiveGoal,
  seedCommunity,
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
});
