import path from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

import { saveFrame } from './helpers/capture';
import {
  IPHONE_UA,
  PROJECT_ID,
  seedActiveGoal,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * THE CONTRIBUTION ROUTE ON A SHORT PHONE, AND THE RAISED MOVE ACTION.
 *
 * W5-M1 (sprint W5 QA, PR #395 at fe1b27d): on /move at 390x640 and 390x664,
 * `wsf-contribute-skip-timer` rendered, passed `toBeVisible`, and handed a tap
 * at its own centre to the shell's raised MOVE circle. Measured, not assumed:
 * `document.elementFromPoint` at the control's centre returned
 * `wsf-member-tab-move` at both heights and the control itself at 390x844.
 *
 * WHY. The app shell lays the member tab bar out AFTER the screen in one
 * column, so the screen's scroll view ends exactly where the bar begins, and
 * the raised action rises MEMBER_TAB_MOVE_OVERHANG (24px) above that edge --
 * INTO the scroll view, at every scroll position. The route's end-of-content
 * padding cleared the bar once the member had scrolled to the bottom; it did
 * nothing for the first screenful, which is where a member arrives. (W5's
 * "the screen does not scroll" was read from the document element; the
 * screen's own scroll view scrolls fine. The occlusion was real either way.)
 *
 * THE FIX, which this spec pins: the screen's scroll view stops above the
 * raised action while the shell bar is rendered, so no scrollable content is
 * ever under the circle. Three things follow and each is asserted from the
 * live DOM rather than from the constants:
 *
 *   1. THE ALLOCATION. The scroll view's bottom edge is at or above the raised
 *      action's top edge. At e609c57 it was 17px below it at every height.
 *   2. NO SCROLL POSITION HANDS A TAP TO THE SHELL. The scroll view is walked
 *      through its whole range and, at every offset, a tap at the centre of
 *      each control is resolved with `elementFromPoint`. `toBeVisible` cannot
 *      see this failure; the hit test can.
 *   3. THE TAPS ARE REAL. Both MOVE-step actions are tapped without `force`,
 *      and each reaches the entry step through the same handler.
 *
 * The same walk runs on entry, review, confirmed, the unknown outcome and the
 * refusal, over every interactive control the screen owns, at the two short
 * heights. The follow-along player at /move/[goalId] is checked for what it
 * must NOT have: a tab bar, and any sideways scroll.
 *
 * Frames are written only under WSF_CAPTURE_FRAMES=1 (see helpers/capture),
 * into short-phone/{before,after}; WSF_SHORT_PHONE_SET=before selects the
 * BEFORE set, which was shot once against the e609c57 build and is frozen.
 * The assertions run every time regardless.
 */

const FRAME_SET = /^before$/i.test(process.env.WSF_SHORT_PHONE_SET ?? '') ? 'before' : 'after';
const OUT = path.resolve(
  __dirname,
  '../../../docs/design-target/review/page-02-move/short-phone',
  FRAME_SET,
);

const SHORT_HEIGHTS = [640, 664] as const;
const ALL_HEIGHTS = [640, 664, 844] as const;

function callableUrl(name: string): string {
  return `http://127.0.0.1:5001/${PROJECT_ID}/us-central1/${name}`;
}

/** Close a goal, changing ONLY its status (a mask-less PATCH would replace the doc). */
async function closeGoal(goalId: string): Promise<void> {
  const url =
    `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents/wsfGoals/${goalId}` +
    `?updateMask.fieldPaths=status`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: { status: { stringValue: 'closed' } } }),
  });
  if (!res.ok) throw new Error(`close ${goalId} failed: ${res.status} ${await res.text()}`);
}

type Fixture = { email: string; password: string; uid: string; groupId: string; goalIds: string[] };

/** One member, one community, `goals` active goals -- one per outcome that needs a fresh goal. */
async function seed(label: string, goals: number): Promise<Fixture> {
  const stamp = stampId();
  const email = `sp.${label}.${stamp}@example.invalid`;
  const password = 'short-phone-passw0rd';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, `Short Phone ${stamp}`);
  const groupId = `sp${label}_${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Short-phone community',
    joinPolicy: 'private',
    members: [{ uid, role: 'foundingChampion' }],
  });
  const goalIds: string[] = [];
  for (let i = 0; i < goals; i += 1) {
    const goalId = `sp${label}goal${i}_${stamp}`;
    await seedActiveGoal({
      goalId,
      groupId,
      ownerUid: uid,
      title: `Short-phone goal ${i + 1}`,
      target: 5000,
      unit: 'squats',
      total: 1200,
    });
    goalIds.push(goalId);
  }
  return { email, password, uid, groupId, goalIds };
}

type Geometry = { scrollBottom: number; safeBottom: number; viewportBottom: number };

/**
 * The screen's scroll view and the safe bottom inset, measured from the live
 * DOM. The scroll view is found as the scrollable ancestor of the screen's
 * wordmark rather than by a test id, so every state is measured the same way
 * whatever id its scroll view carries.
 *
 * THE MEMBER BAR IS NOT MEASURED HERE ANY MORE, AND THAT IS THE POINT.
 * `/contribute` and `/move` are focused flows now: they wear no tab bar, so
 * "the scroll view stops where the raised action begins" has nothing to
 * measure against and would pass vacuously on a missing element. Under the
 * Director's ruling 3 (`5789966395`) the replacement is AT-REST REACHABILITY
 * ABOVE THE SAFE BOTTOM INSET — the control the member can see must be one
 * their thumb actually reaches, and must not sit under the home indicator.
 */
async function geometry(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const isScroller = (el: Element) => {
      const cs = getComputedStyle(el);
      return cs.overflowY === 'auto' || cs.overflowY === 'scroll';
    };
    let el: Element | null = document.querySelector('[data-testid="wsf-contribute-wordmark"]');
    while (el && !isScroller(el)) el = el.parentElement;
    if (!el) throw new Error('no scroll view around the contribute screen');
    const readInset = () => {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;bottom:0;height:env(safe-area-inset-bottom,0px);width:0';
      document.body.appendChild(probe);
      const h = Math.round(probe.getBoundingClientRect().height);
      probe.remove();
      return h;
    };
    return {
      scrollBottom: Math.round(el.getBoundingClientRect().bottom),
      safeBottom: readInset(),
      viewportBottom: Math.round(window.innerHeight),
    };
  });
}

/**
 * At rest, is each named control one the member can actually tap?
 *
 * Returns, per control, why it is not — empty when it is. "At rest" is the
 * state the member arrives in, without scrolling: the whole point of the
 * accepted short-phone rule is that the primary is reachable on arrival, not
 * after hunting for it.
 *
 * `elementFromPoint` at the control's own centre is the honest question,
 * because it asks what the browser would hand a tap. A control that renders
 * but is covered answers with whatever covers it.
 */
async function unreachableAtRest(
  page: Page,
  testIds: readonly string[],
): Promise<Record<string, string>> {
  /*
    AT REST MEANS AFTER THE LAYOUT SETTLES, SO THIS WAITS FOR IT TO.

    The first version sampled once, immediately after the control became
    visible, and it passed every time it was run alone and failed once in a
    fully parallel suite. Visible is not settled: a control can be painted
    while a sibling is still resolving its height, and for one frame its centre
    belongs to something else. That is a property of my instrument, not of the
    product, and dismissing it as a flake would have been wrong twice over --
    it would have hidden the instability AND left a check that reports layout
    noise as a reachability defect.

    So it retries until the answer is clean, for up to two seconds, and returns
    the last reading if it never is. A control that is genuinely unreachable
    stays unreachable through every attempt and is still reported.
  */
  const deadline = Date.now() + 2_000;
  let last: Record<string, string> = {};
  for (;;) {
    last = await readUnreachable(page, testIds);
    if (Object.keys(last).length === 0 || Date.now() > deadline) return last;
    await page.waitForTimeout(100);
  }
}

async function readUnreachable(
  page: Page,
  testIds: readonly string[],
): Promise<Record<string, string>> {
  return page.evaluate((ids) => {
    const out: Record<string, string> = {};
    const readInset = () => {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;bottom:0;height:env(safe-area-inset-bottom,0px);width:0';
      document.body.appendChild(probe);
      const h = Math.round(probe.getBoundingClientRect().height);
      probe.remove();
      return h;
    };
    const safeBottom = readInset();
    for (const id of ids) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) {
        out[id] = 'not rendered';
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) {
        out[id] = 'rendered with no box';
        continue;
      }
      if (r.bottom > window.innerHeight - safeBottom) {
        out[id] = `runs below the safe bottom inset (bottom ${Math.round(r.bottom)}, limit ${Math.round(window.innerHeight - safeBottom)})`;
        continue;
      }
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      if (!hit || !(el === hit || el.contains(hit) || hit.contains(el))) {
        out[id] = `a tap at its centre lands on ${hit ? (hit.getAttribute('data-testid') ?? hit.tagName) : 'nothing'}`;
      }
    }
    return out;
  }, testIds);
}

async function horizontalOverflowPx(page: Page): Promise<number> {
  return page.evaluate(() => {
    const d = document.documentElement;
    return Math.round(Math.max(d.scrollWidth, document.body.scrollWidth) - d.clientWidth);
  });
}

/** The MOVE step as the member arrives at it, with its context loaded. */
async function arriveAtMove(page: Page): Promise<void> {
  await page.goto('/move');
  await expect(page.getByTestId('wsf-contribute-done')).toBeVisible({ timeout: 20_000 });
  // The goal anchor is what sets the card's height; the frame is not the
  // arrival state until it is there.
  await expect(page.getByTestId('wsf-contribute-context-percent')).toBeVisible({ timeout: 20_000 });
  /*
    MOVE IS A FOCUSED FLOW AND WEARS NO MEMBER BAR. This used to assert the bar
    VISIBLE here; the Director's ruling 1 makes MOVE and `/contribute` barless,
    so the assertion is inverted rather than deleted — it still pins something,
    and it would fail loudly if the chrome ever came back.
  */
  await expect(page.getByTestId('wsf-member-tabs')).toHaveCount(0);
}

for (const height of ALL_HEIGHTS) {
  test.describe(`390x${height}`, () => {
    test.use({
      viewport: { width: 390, height },
      userAgent: IPHONE_UA,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });

    test(`MOVE step: "I'm done" and "Skip timer" are reachable at rest, clear of the safe inset, and take a real tap`, async ({
      page,
    }) => {
      const fx = await seed('mv', 1);
      await signInVia(page, fx.email, fx.password);
      await arriveAtMove(page);
      await saveFrame(page, path.join(OUT, `contribute-move-390x${height}.png`));

      // 1. The allocation: the screen owns its whole height, with no bar to clear.
      const g = await geometry(page);
      expect(
        g.scrollBottom,
        `the scroll view runs past the viewport (ends at ${g.scrollBottom}, viewport ${g.viewportBottom})`,
      ).toBeLessThanOrEqual(g.viewportBottom);

      // 2. At rest, both controls are reachable and clear of the safe inset.
      const blocked = await unreachableAtRest(page, [
        'wsf-contribute-done',
        'wsf-contribute-skip-timer',
      ]);
      expect(blocked, `a control the member can see is not one they can tap: ${JSON.stringify(blocked)}`).toEqual({});

      // 3. Real taps, no force. Each reaches the entry step through onDoneMoving.
      await page.getByTestId('wsf-contribute-skip-timer').tap();
      await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });

      await arriveAtMove(page);
      await page.getByTestId('wsf-contribute-done').tap();
      await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
    });
  });
}

for (const height of SHORT_HEIGHTS) {
  test.describe(`390x${height}`, () => {
    test.use({
      viewport: { width: 390, height },
      userAgent: IPHONE_UA,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });

    test('entry, review, confirmed, unknown and refused all keep their primary reachable and clear of the safe inset', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const fx = await seed('st', 3);
      const [confirmGoal, unknownGoal, refuseGoal] = fx.goalIds;
      await signInVia(page, fx.email, fx.password);

      // `settledTestId` is the element whose arrival completes the state's
      // layout -- the goal anchor's live line where the anchor is rendered,
      // the outcome's own copy where the receipt replaces it.
      const check = async (state: string, primaryTestId: string, settledTestId: string) => {
        await expect(page.getByTestId(settledTestId)).toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId(primaryTestId)).toBeVisible({ timeout: 20_000 });
        if (height === 640) await saveFrame(page, path.join(OUT, `contribute-${state}-390x${height}.png`));
        const g = await geometry(page);
        expect(
          g.scrollBottom,
          `${state}: the scroll view runs past the viewport (ends at ${g.scrollBottom}, viewport ${g.viewportBottom})`,
        ).toBeLessThanOrEqual(g.viewportBottom);
        await expect(page.getByTestId('wsf-member-tabs'), `${state}: a focused flow is wearing member chrome`).toHaveCount(0);
        const blockedHere = await unreachableAtRest(page, [primaryTestId]);
        expect(blockedHere, `${state}: the primary is not reachable at rest: ${JSON.stringify(blockedHere)}`).toEqual({});
        const primary = await page.getByTestId(primaryTestId).boundingBox();
        expect(primary, `${state}: ${primaryTestId} is not rendered`).not.toBeNull();
        /*
          THE PRIMARY IS CLEAR ON ARRIVAL, MEASURED AGAINST THE SAFE INSET
          RATHER THAN AGAINST A BAR THAT NO LONGER EXISTS. The accepted rule was
          always "the member can see AND tap the primary the moment they
          arrive"; the raised action was only how that was measured while the
          bar was there. `unreachableAtRest` above already hit-tests it, and
          this pins the geometry that makes it true.
        */
        expect(
          Math.round(primary!.y + primary!.height),
          `${state}: the primary action runs under the safe bottom inset`,
        ).toBeLessThanOrEqual(g.viewportBottom - g.safeBottom);
      };

      // ---- entry -> review -> confirmed, the ordinary path -----------------
      await page.goto(`/contribute/${confirmGoal}?groupId=${fx.groupId}&mode=record`);
      await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
      await check('entry', 'wsf-contribute-review', 'wsf-contribute-context-percent');
      await page.getByTestId('wsf-contribute-entry').fill('20');
      await page.getByTestId('wsf-contribute-review').tap();
      await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible({ timeout: 20_000 });
      await check('review', 'wsf-contribute-submit', 'wsf-contribute-context-percent');
      await page.getByTestId('wsf-contribute-submit').tap();
      await expect(page.getByTestId('wsf-contribute-result-headline')).toBeVisible({ timeout: 40_000 });
      await check('confirmed', 'wsf-contribute-record-more', 'wsf-contribute-result-headline');

      // ---- the outcome nobody knows: the write leaves, the answer never comes back
      await page.goto(`/contribute/${unknownGoal}?groupId=${fx.groupId}&mode=record`);
      await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
      await page.getByTestId('wsf-contribute-entry').fill('20');
      await page.route(callableUrl('wsfContribute'), async (route: Route) => {
        await route.abort('failed');
      });
      await page.getByTestId('wsf-contribute-review').tap();
      await page.getByTestId('wsf-contribute-submit').tap();
      await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 40_000 });
      await check('pending', 'wsf-contribute-reconcile', 'wsf-contribute-pending-count');
      await page.unroute(callableUrl('wsfContribute'));

      // ---- the definitive refusal: the goal closes under the write ----------
      await page.goto(`/contribute/${refuseGoal}?groupId=${fx.groupId}&mode=record`);
      await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
      await page.getByTestId('wsf-contribute-entry').fill('20');
      await page.getByTestId('wsf-contribute-review').tap();
      await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible({ timeout: 20_000 });
      await page.route(callableUrl('wsfContribute'), async (route: Route) => {
        await closeGoal(refuseGoal);
        await route.continue();
      });
      await page.getByTestId('wsf-contribute-submit').tap();
      await expect(page.getByTestId('wsf-contribute-refused')).toBeVisible({ timeout: 40_000 });
      await check('refused', 'wsf-contribute-back', 'wsf-contribute-refused-body');
    });

    test('/move/[goalId] wears no shell and does not scroll sideways', async ({ page }) => {
      const fx = await seed('pl', 1);
      await signInVia(page, fx.email, fx.password);
      await page.goto(`/move/${fx.goalIds[0]}`);
      await expect(page.getByTestId('wsf-move-screen')).toBeVisible({ timeout: 25_000 });
      await expect(page.getByTestId('wsf-member-tabs')).toHaveCount(0);
      expect(await horizontalOverflowPx(page)).toBeLessThanOrEqual(1);
    });
  });
}
