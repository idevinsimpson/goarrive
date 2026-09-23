import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import {
  FIRESTORE_EMULATOR,
  PROJECT_ID,
  seedActiveGoal,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
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
 * Kiosk paths are not driven here: every kiosk rest state renders Finish, and
 * the diff's ReturnButton swaps are all in the non-kiosk branch (checked from
 * git in the QA report). W5's K1–K18 run on the same SHA.
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

async function expectBackDoesNotReviveContribution(page: Page, at: string): Promise<void> {
  await page.goBack().catch(() => undefined);
  await page.waitForTimeout(1_500);
  const path = new URL(page.url()).pathname;
  test.info().annotations.push({ type: `${at}: after Back`, description: path });
  // The risk is a finished contribution coming back with a live Submit (the
  // review screen) or its receipt; a fresh start screen would not double-count.
  // The path is recorded either way.
  expect(await page.getByTestId('wsf-contribute-receipt').filter({ visible: true }).count(), `${at}: the receipt is on screen again (${path})`).toBe(0);
  expect(await page.getByTestId('wsf-contribute-review-screen').filter({ visible: true }).count(), `${at}: a review screen with Submit is back (${path})`).toBe(0);
}

test.describe('W9 contribution exits, independent instruments', () => {
  test('X1 the ordinary arrival: the receipt returns to the same Community, with the server total, and Back does not revive it', async ({ page }) => {
    test.setTimeout(300_000);
    await traceHistory(page);
    const fx = await seed('x1');
    await arrive(page, fx);
    await markVisibleCommunity(page);
    const planted = await plantScroll(page, 160);
    expect(planted, 'the planted scroll is not vacuous').toBeGreaterThan(40);
    const bars0 = (await reading(page)).tabBars;

    await page.getByTestId(`wsf-community-goal-link-${fx.goalId}`).last().click();
    await expect(page.getByTestId('wsf-contribute-move-screen').last()).toBeVisible({ timeout: 40_000 });
    await page.getByTestId('wsf-contribute-done').last().click();
    await recordTwenty(page);
    await page.evaluate(() => {
      (window as unknown as { __w7h: string[] }).__w7h.length = 0;
    });
    await pressLabelledExit(page, 'Back to community');

    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe(`/community/${fx.groupId}`);
    await page.waitForTimeout(1_000);
    const r = await reading(page);
    test.info().annotations.push({ type: 'reading', description: JSON.stringify(r) });
    test.info().annotations.push({ type: 'history on exit', description: JSON.stringify(await page.evaluate(() => (window as unknown as { __w7h: string[] }).__w7h)) });
    expect(r.visible, 'exactly one Community on show').toBe(1);
    expect(r.marked, 'the Community on show is not the one the member left').toBe(true);
    expect(r.roots, 'a second Community screen exists in the DOM').toBe(1);
    expect(r.tabBars, 'a second tab bar was mounted').toBe(bars0);
    expect(Math.abs(r.scroll - planted), 'the member came back to a different place').toBeLessThanOrEqual(2);

    const truth = await serverTotal(fx.goalId);
    expect(truth, 'the server did not commit the 20').toBe(SEEDED + 20);
    await expect(page.locator(`[data-testid="wsf-community-goal-total-${fx.goalId}"]:visible`).first()).toContainText(
      truth.toLocaleString('en-US'),
      { timeout: 15_000 },
    );

    await expectBackDoesNotReviveContribution(page, 'X1');
  });

  test('X2 MOVE from You: the exit is pressable where it is drawn, lands on the Home tab\'s Community, and Back does not revive it', async ({ page }) => {
    test.setTimeout(300_000);
    const fx = await seed('x2');
    await arrive(page, fx);
    await markVisibleCommunity(page);
    const bars0 = (await reading(page)).tabBars;
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
    expect(r.tabBars, 'a second tab bar was mounted').toBe(bars0);
    const onTop = await page.evaluate(() => {
      const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 3);
      return { community: !!hit?.closest('[data-testid="wsf-community"]'), you: !!hit?.closest('[data-testid="wsf-you-identity"]') };
    });
    expect(onTop, 'the screen under the thumb is not the Community').toEqual({ community: true, you: false });
    await expectBackDoesNotReviveContribution(page, 'X2');
  });

  test('X3 the chrome arrow keeps "the step before this": the move screen returns to the same Community', async ({ page }) => {
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

  test('X4 "Back to home" on a cold arrival resolves Home afresh and leaves nothing behind for Back', async ({ page }) => {
    test.setTimeout(300_000);
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
    await home.click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 40_000 }).toBe(`/community/${fx.groupId}`);
    test.info().annotations.push({ type: 'reads after the press', description: reads.join(',') });
    expect(reads, 'Home did not resolve the member\'s communities after the press').toContain('wsfMyCommunities');
    await expectBackDoesNotReviveContribution(page, 'X4');
  });
});
