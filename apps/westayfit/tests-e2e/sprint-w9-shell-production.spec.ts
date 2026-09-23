import { expect, test, type Page } from '@playwright/test';

import {
  seedActiveGoal,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * W9 — THE SHELL'S OWN PROMISES, ON THE SHIPPING ROUTES.
 *
 * WHY THIS FILE EXISTS. `sprint-w9-shell-nav.spec.ts` proved these properties
 * on the gated prototype, which is what it was for: the prototype was the
 * argument for the migration. The migration has since landed on the real
 * member routes, and a property proved only on a prototype is a property
 * nobody is guarding. The Director's gate asks for them on the build that
 * ships (`5795072805`), so this file asks the same questions of `/`,
 * `/community`, `/activity`, `/you` and `/move`.
 *
 * WHAT IS BEING MEASURED, AND HOW.
 *
 *   A REMOUNT is detected with a mark planted on the DOM node itself. React
 *   re-creates the node when a screen remounts, and the mark goes with it, so
 *   a surviving mark is proof the very same screen is on show — stronger than
 *   "an element with that testID is present", which a rebuilt copy satisfies.
 *
 *   A RELOAD is detected with a mark on `window`. A reload throws the whole
 *   JS context away, so the global cannot survive one.
 *
 *   A NAVIGATION is counted in `history.length`, read before and after.
 *
 * The owner's complaint was that tapping the icon you are already on reloads
 * the page, and that leaving a tab and coming back rebuilds it. Those are the
 * two claims here, plus MOVE opening over the tab the member was in and
 * closing back onto it.
 *
 * Everything seeded here is SYNTHETIC: no community, member or goal is real.
 */

const PHONE = { width: 390, height: 844 };

/** Plant a mark on the node itself: it cannot survive that node being rebuilt. */
async function markNode(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!(el instanceof HTMLElement)) return false;
    el.dataset.wsfW9Mark = 'planted';
    return true;
  }, testId);
}

async function markSurvives(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    return el instanceof HTMLElement && el.dataset.wsfW9Mark === 'planted';
  }, testId);
}

/** The scroll offset of whichever ancestor of this element actually scrolls. */
async function scrollOf(page: Page, testId: string): Promise<number | null> {
  return page.evaluate((id) => {
    let el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    while (el) {
      if (el.scrollHeight > el.clientHeight + 1) return Math.round(el.scrollTop);
      el = el.parentElement;
    }
    return null;
  }, testId);
}

async function setScroll(page: Page, testId: string, top: number): Promise<number | null> {
  return page.evaluate(
    ({ id, value }) => {
      let el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
      while (el) {
        if (el.scrollHeight > el.clientHeight + 1) {
          el.scrollTop = value;
          return Math.round(el.scrollTop);
        }
        el = el.parentElement;
      }
      return null;
    },
    { id: testId, value: top },
  );
}

test('the shipping shell: the active tab is a no-op, tabs stay mounted, and MOVE opens over the tab you were on', async ({
  browser,
}) => {
  test.setTimeout(300_000);

  const stamp = stampId();
  const email = `wsf-w9-prod-${stamp}@example.com`;
  const password = 'Sup3rSecret!23';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `w9prod-${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'private',
    members: [{ uid, role: 'member' }],
  });
  await seedActiveGoal({
    goalId: `w9prodgoal-${stamp}`,
    groupId,
    ownerUid: uid,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total: 1847,
  });
  // A second open goal, so MOVE has a question to ask instead of resolving
  // itself straight into a contribution.
  await seedActiveGoal({
    goalId: `w9prodgoal2-${stamp}`,
    groupId,
    ownerUid: uid,
    title: 'Morning Mile Streak',
    target: 300,
    unit: 'miles',
    total: 96,
  });

  const context = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await signInVia(page, email, password);
    await page.goto('/');
    await expect(page.getByTestId('wsf-community-goal-hero')).toBeVisible({ timeout: 40_000 });

    // The reload detector, planted once for the whole test.
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__wsfW9Session = 'alive';
    });
    const sessionAlive = () =>
      page.evaluate(
        () => (window as unknown as Record<string, unknown>).__wsfW9Session === 'alive',
      );

    /*
      1 · THE ACTIVE TAB IS A NO-OP. The owner's words: tapping the icon you
      are already on reloads the page. Four claims, all measured: no history
      entry, no reload, no remount, and the scroll left where it was.
    */
    expect(await markNode(page, 'wsf-community'), 'the Home screen was marked').toBe(true);
    const planted = await setScroll(page, 'wsf-community', 160);
    expect(planted, 'Home has somewhere to scroll to').not.toBeNull();
    const historyBefore = await page.evaluate(() => window.history.length);

    await page.getByTestId('wsf-member-tab-home').last().click();
    await page.waitForTimeout(700);

    expect(
      await page.evaluate(() => window.history.length),
      'tapping the tab you are on added a history entry',
    ).toBe(historyBefore);
    expect(await sessionAlive(), 'tapping the tab you are on reloaded the page').toBe(true);
    expect(
      await markSurvives(page, 'wsf-community'),
      'tapping the tab you are on rebuilt the screen',
    ).toBe(true);
    expect(
      await scrollOf(page, 'wsf-community'),
      'tapping the tab you are on threw the scroll away',
    ).toBe(planted);

    /*
      2 · LEAVING A TAB AND COMING BACK DOES NOT REBUILD IT. Each of the other
      three is visited and marked, then Home is returned to and must still be
      the same screen, at the same scroll.
    */
    for (const [key, ready] of [
      ['community', 'wsf-community-index-title'],
      ['activity', 'wsf-activity-title'],
      ['you', 'wsf-you-name'],
    ] as const) {
      await page.getByTestId(`wsf-member-tab-${key}`).last().click();
      await expect(page.getByTestId(ready)).toBeVisible({ timeout: 30_000 });
      expect(await markNode(page, ready), `${key} was marked`).toBe(true);
    }

    await page.getByTestId('wsf-member-tab-home').last().click();
    await expect(page.getByTestId('wsf-community-goal-hero')).toBeVisible({ timeout: 30_000 });
    expect(
      await markSurvives(page, 'wsf-community'),
      'coming back to Home rebuilt it from scratch',
    ).toBe(true);
    expect(await scrollOf(page, 'wsf-community'), 'coming back to Home lost its scroll').toBe(
      planted,
    );
    expect(await sessionAlive(), 'moving between tabs reloaded the page').toBe(true);

    // And each of the other three is still the screen it was, not a copy.
    for (const [key, ready] of [
      ['you', 'wsf-you-name'],
      ['activity', 'wsf-activity-title'],
      ['community', 'wsf-community-index-title'],
    ] as const) {
      await page.getByTestId(`wsf-member-tab-${key}`).last().click();
      await expect(page.getByTestId(ready)).toBeVisible({ timeout: 30_000 });
      expect(await markSurvives(page, ready), `${key} was rebuilt when it was returned to`).toBe(
        true,
      );
    }

    /*
      3 · MOVE OPENS OVER THE TAB YOU WERE ON, AND CLOSES BACK ONTO IT.

      Opened from You on purpose — from Home the claim would be untestable,
      because Home is where a replaced screen would land anyway. The tab
      underneath must still be MOUNTED (the mark), the bar must not be
      reachable while the sheet is up, and Close must return to that same
      screen rather than to a rebuilt one or to Home.
    */
    await page.getByTestId('wsf-member-tab-you').last().click();
    await expect(page.getByTestId('wsf-you-name')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('wsf-member-tab-move').last().click();
    await expect(page.getByTestId('wsf-move-choose')).toBeVisible({ timeout: 30_000 });
    expect(
      await markSurvives(page, 'wsf-you-name'),
      'MOVE replaced the tab underneath instead of opening over it',
    ).toBe(true);

    const barReachable = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="wsf-member-tabs"]');
      if (!(bar instanceof HTMLElement)) return false;
      const r = bar.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const top = document.elementFromPoint(
        Math.round(r.x + r.width / 2),
        Math.round(r.y + r.height / 2),
      );
      return top instanceof Node && bar.contains(top);
    });
    expect(
      barReachable,
      'the member tab bar is reachable under the MOVE sheet — MOVE is offering to take a member where they already are',
    ).toBe(false);

    /*
      CLOSED BY ITS OWN CONTROL, NOT BY THE BROWSER. An earlier revision of
      this leg pressed Back, which proves the router's history and says
      nothing about the sheet: a sheet with no way out of its own would have
      passed it. The Director asked for the named control (`5796776652`), so
      that is what is pressed here and in every other proof in this file.
    */
    await expect(page.getByTestId('wsf-move-close')).toBeVisible();
    await page.getByTestId('wsf-move-close').click();
    await expect(page.getByTestId('wsf-you-name')).toBeVisible({ timeout: 30_000 });
    expect(
      await markSurvives(page, 'wsf-you-name'),
      'closing MOVE came back to a rebuilt You rather than the one it opened over',
    ).toBe(true);
    expect(await sessionAlive(), 'MOVE reloaded the page').toBe(true);
  } finally {
    await context.close();
  }
});

/**
 * MOVE AS A FOCUS SHEET — the Director's actual-pixel hold (`5795268359`).
 *
 * The migration had the presentation right and the screen wrong: the outer
 * stack presented `/move` as a transparent modal, and the screen then painted
 * an opaque cream surface across the whole viewport, so the tab underneath was
 * mounted but invisible, there was no Close, and the screen still reserved the
 * tab bar's height it no longer had. It read as another page.
 *
 * These are the proofs the ruling asks for, and they are about what can be
 * SEEN and TOUCHED rather than about what is in the document.
 */
test('MOVE opens as a sheet over the tab the member was on, and Close returns to it', async ({
  browser,
}) => {
  test.setTimeout(300_000);

  const stamp = stampId();
  const email = `wsf-w9-sheet-${stamp}@example.com`;
  const password = 'Sup3rSecret!23';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `w9sheet-${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'private',
    members: [{ uid, role: 'member' }],
  });
  await seedActiveGoal({
    goalId: `w9sheetgoal-${stamp}`,
    groupId,
    ownerUid: uid,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total: 1847,
  });
  await seedActiveGoal({
    goalId: `w9sheetgoal2-${stamp}`,
    groupId,
    ownerUid: uid,
    title: 'Morning Mile Streak',
    target: 300,
    unit: 'miles',
    total: 96,
  });

  const context = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await signInVia(page, email, password);
    await page.goto('/');
    await expect(page.getByTestId('wsf-community-goal-hero')).toBeVisible({ timeout: 40_000 });

    /** Everything about the sheet that has to be true wherever it is opened from. */
    const sheetIsASheet = async (from: string) => {
      await expect(page.getByTestId('wsf-move-sheet')).toBeVisible({ timeout: 30_000 });

      // IT IS BOUNDED. A panel that starts at the top of the viewport is a
      // page with a different name; this one leaves the context above it.
      const sheetBox = (await page.getByTestId('wsf-move-sheet').boundingBox())!;
      const viewport = page.viewportSize()!;
      expect(
        Math.round(sheetBox.y),
        `${from}: the sheet starts at the top of the viewport, so nothing is behind it`,
      ).toBeGreaterThan(0);
      expect(
        Math.round(sheetBox.y + sheetBox.height),
        `${from}: the sheet does not reach the bottom of the viewport`,
      ).toBeGreaterThanOrEqual(viewport.height - 2);

      // AND THE CONTEXT SHOWS THROUGH. A scrim at full opacity hides exactly
      // what the transparent presentation exists to keep.
      const scrim = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="wsf-move-scrim"]');
        if (!(el instanceof HTMLElement)) return null;
        const r = el.getBoundingClientRect();
        const bg = getComputedStyle(el).backgroundColor;
        const alpha = /rgba?\(([^)]+)\)/.exec(bg)?.[1].split(',').map((n) => Number(n.trim()));
        return {
          w: Math.round(r.width),
          h: Math.round(r.height),
          alpha: alpha && alpha.length === 4 ? alpha[3] : 1,
        };
      });
      expect(scrim, `${from}: the sheet has no scrim`).not.toBeNull();
      expect(scrim!.alpha, `${from}: the scrim is opaque, so there is no context to see`).toBeLessThan(
        0.9,
      );
      expect(scrim!.w, `${from}: the scrim does not cover the width`).toBeGreaterThanOrEqual(
        viewport.width - 1,
      );
      expect(scrim!.h, `${from}: the scrim does not cover the height`).toBeGreaterThanOrEqual(
        viewport.height - 1,
      );

      /*
        NOTHING OF THE MEMBER CHROME CAN BE TOUCHED. Sampled along the bar
        rather than at one point: a scrim with a hole in it would pass a single
        centre reading. The top bar is asked the same question, because it
        belongs to the covered tab and must be covered with it.
      */
      for (const testId of ['wsf-member-tabs', 'wsf-member-topbar']) {
        const reachable = await page.evaluate((id) => {
          const el = document.querySelector(`[data-testid="${id}"]`);
          if (!(el instanceof HTMLElement)) return false;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          const y = Math.round(r.y + r.height / 2);
          for (let i = 1; i <= 9; i += 1) {
            const x = Math.round(r.x + (r.width * i) / 10);
            const top = document.elementFromPoint(x, y);
            if (top instanceof Node && el.contains(top)) return true;
          }
          return false;
        }, testId);
        expect(
          reachable,
          `${from}: ${testId} can still be touched under the MOVE sheet`,
        ).toBe(false);
      }

      // AND THERE IS ONE EXPLICIT WAY OUT, at a real touch size.
      const closeBox = (await page.getByTestId('wsf-move-close').boundingBox())!;
      expect(Math.round(closeBox.width), `${from}: Close is under 44px wide`).toBeGreaterThanOrEqual(
        44,
      );
      expect(
        Math.round(closeBox.height),
        `${from}: Close is under 44px tall`,
      ).toBeGreaterThanOrEqual(44);
    };

    /*
      1 · FROM HOME. The tab underneath keeps a planted mark and a planted,
      non-vacuous scroll, and Close brings back that exact screen.
    */
    expect(await markNode(page, 'wsf-community'), 'Home was marked').toBe(true);
    const homeScroll = await setScroll(page, 'wsf-community', 180);
    expect(homeScroll, 'Home has somewhere to scroll to').not.toBeNull();
    expect(homeScroll!, 'the planted Home scroll is not vacuous').toBeGreaterThan(40);

    await page.getByTestId('wsf-member-tab-move').last().click();
    await expect(page.getByTestId('wsf-move-choose')).toBeVisible({ timeout: 30_000 });
    await sheetIsASheet('from Home');
    expect(
      await markSurvives(page, 'wsf-community'),
      'from Home: MOVE replaced the tab underneath instead of opening over it',
    ).toBe(true);

    await page.getByTestId('wsf-move-close').click();
    await expect(page.getByTestId('wsf-community-goal-hero')).toBeVisible({ timeout: 30_000 });
    expect(
      await markSurvives(page, 'wsf-community'),
      'from Home: Close came back to a rebuilt screen',
    ).toBe(true);
    expect(
      await scrollOf(page, 'wsf-community'),
      'from Home: Close came back to the top instead of where the member was',
    ).toBe(homeScroll);

    /*
      2 · FROM YOU. The tab that is NOT the fallback destination, so a replaced
      screen could not be mistaken for a preserved one.
    */
    await page.getByTestId('wsf-member-tab-you').last().click();
    await expect(page.getByTestId('wsf-you-name')).toBeVisible({ timeout: 30_000 });
    expect(await markNode(page, 'wsf-you-name'), 'You was marked').toBe(true);

    await page.getByTestId('wsf-member-tab-move').last().click();
    await expect(page.getByTestId('wsf-move-choose')).toBeVisible({ timeout: 30_000 });
    await sheetIsASheet('from You');
    expect(
      await markSurvives(page, 'wsf-you-name'),
      'from You: MOVE replaced the tab underneath instead of opening over it',
    ).toBe(true);

    await page.getByTestId('wsf-move-close').click();
    await expect(page.getByTestId('wsf-you-name')).toBeVisible({ timeout: 30_000 });
    expect(
      await markSurvives(page, 'wsf-you-name'),
      'from You: Close came back to a rebuilt You, or to Home',
    ).toBe(true);

    /*
      3 · COLD. A pasted or deep-linked /move covered nothing, so there is
      nothing to go back to — and Close must still take the member somewhere
      rather than being a control that does nothing.
    */
    await page.goto('/move');
    await expect(page.getByTestId('wsf-move-choose')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-move-close')).toBeVisible();
    await page.getByTestId('wsf-move-close').click();
    await expect(page.getByTestId('wsf-community-goal-hero')).toBeVisible({ timeout: 40_000 });
    expect(
      new URL(page.url()).pathname,
      'a cold MOVE closed to something other than the canonical member destination',
    ).toMatch(/^\/(community\/[^/]+)?$/);
  } finally {
    await context.close();
  }
});

/**
 * THE OTHER STATES THIS ROUTE STAYS OPEN IN.
 *
 * MOVE resolves itself and leaves when there is exactly one open goal, so the
 * sheet is only ever ON SCREEN in three states: the chooser, "nothing is
 * running", and the error. The chooser is covered above. The Director asked
 * for the rest where the route remains open (`5796776652`), because a sheet
 * that is a sheet in one state and a page in another is not a sheet — the
 * scrim, the bounded panel and the one Close have to be the same in each.
 *
 * The working state is deliberately not asserted as a still: it exists only
 * between the two reads that resolve it, and a test that waited for it would
 * be timing a callable rather than photographing a screen.
 */
test('MOVE with nothing running is the same sheet, with the same way out', async ({ browser }) => {
  test.setTimeout(240_000);

  const stamp = stampId();
  const email = `wsf-w9-nogoal-${stamp}@example.com`;
  const password = 'Sup3rSecret!23';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `w9nogoal-${stamp}`;
  // A community with no goal at all: the state a member lands in between
  // challenges, and the one the route stays open in.
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'private',
    members: [{ uid, role: 'member' }],
  });

  const context = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await signInVia(page, email, password);
    await page.goto('/');
    await expect(page.getByTestId('wsf-community-no-goal')).toBeVisible({ timeout: 40_000 });
    expect(await markNode(page, 'wsf-community'), 'Home was marked').toBe(true);

    await page.getByTestId('wsf-member-tab-move').last().click();
    await expect(page.getByTestId('wsf-move-no-goal')).toBeVisible({ timeout: 40_000 });

    // The same three things that make the chooser a sheet.
    await expect(page.getByTestId('wsf-move-sheet')).toBeVisible();
    const sheetBox = (await page.getByTestId('wsf-move-sheet').boundingBox())!;
    expect(
      Math.round(sheetBox.y),
      'the no-goal sheet starts at the top of the viewport, so nothing is behind it',
    ).toBeGreaterThan(0);
    await expect(page.getByTestId('wsf-move-scrim')).toBeVisible();

    const closeBox = (await page.getByTestId('wsf-move-close').boundingBox())!;
    expect(Math.round(closeBox.width), 'no-goal: Close is under 44px wide').toBeGreaterThanOrEqual(
      44,
    );
    expect(Math.round(closeBox.height), 'no-goal: Close is under 44px tall').toBeGreaterThanOrEqual(
      44,
    );

    // The words this state exists to say are still its own.
    await expect(page.getByTestId('wsf-move-no-goal')).toContainText('Nothing is running right now');
    await expect(page.getByTestId('wsf-move-no-goal-community')).toBeVisible();

    expect(
      await markSurvives(page, 'wsf-community'),
      'no-goal: MOVE replaced the tab underneath instead of opening over it',
    ).toBe(true);

    await page.getByTestId('wsf-move-close').click();
    await expect(page.getByTestId('wsf-community-no-goal')).toBeVisible({ timeout: 30_000 });
    expect(
      await markSurvives(page, 'wsf-community'),
      'no-goal: Close came back to a rebuilt screen',
    ).toBe(true);
  } finally {
    await context.close();
  }
});
