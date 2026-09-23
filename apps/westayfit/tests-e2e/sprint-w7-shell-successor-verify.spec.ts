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
 * W7 — INDEPENDENT VERIFICATION of W9's migrated member shell at exactly
 * **`41f80f3`**, locally merged with app-shell `37367fd` and never pushed.
 *
 * Packet 10 FINAL, L0 `5797409315` on the Director's `5797396895`.
 *
 * WHAT THIS FILE IS FOR, GIVEN W9 ALREADY HAS 22 TESTS. Re-running another
 * lane's suite measures whether their code agrees with their tests. It does
 * not measure whether their tests would notice. So this file deliberately
 * asks the questions their suite does not, and asks the shared ones with a
 * harder instrument:
 *
 *   - **Hit-testing, not presence.** "The tab bar is covered" and "the tab bar
 *     cannot be touched" are different claims, and only the second one is the
 *     property a focus sheet exists to have. Every reachability claim here
 *     goes through `document.elementFromPoint` at a control's own centre, so
 *     an element that is present, sized and painted but sitting under a scrim
 *     is correctly reported as unreachable.
 *   - **Non-vacuous by construction.** A scroll-restoration claim on a screen
 *     scrolled to 0 is satisfied by doing nothing at all, so the fixture
 *     asserts the offset it planted is non-zero BEFORE it asserts the offset
 *     came back. The same rule governs every "unchanged" assertion here.
 *   - **The Close is a control, not a coincidence.** `≥44×44` is measured on
 *     the element that carries the accessible name, and it is exercised by
 *     CLICKING it — never by `page.goBack()`, which would prove the browser
 *     works rather than that the sheet has a way out.
 *
 * Verification only: no product file and no test of W9's is edited, no capture
 * is written, and no frame is rebaselined.
 */

const PHONE = { width: 390, height: 844 };
const MIN_TARGET = 44;

/* ── instruments ─────────────────────────────────────────────────────────── */

/**
 * WHAT THE MEMBER'S THUMB WOULD ACTUALLY REACH at a point. Returns the chain
 * of testIDs from the topmost element at that point upward, so a control that
 * is covered reports the coverer rather than itself.
 */
async function hitChainAt(page: Page, x: number, y: number): Promise<string[]> {
  return page.evaluate(
    ({ px, py }) => {
      const top = document.elementFromPoint(px, py);
      const chain: string[] = [];
      let el: Element | null = top;
      while (el) {
        const id = (el as HTMLElement).dataset?.testid;
        if (id) chain.push(id);
        el = el.parentElement;
      }
      return chain;
    },
    { px: x, py: y },
  );
}

/** Is this control reachable at its OWN centre, rather than merely present? */
async function reachableAtCentre(page: Page, testId: string): Promise<boolean> {
  const box = await page.getByTestId(testId).last().boundingBox();
  if (!box) return false;
  const chain = await hitChainAt(page, box.x + box.width / 2, box.y + box.height / 2);
  return chain.includes(testId);
}

/** Plant a mark on the host node: it cannot survive that node being rebuilt. */
async function markNode(page: Page, testId: string, mark: string): Promise<boolean> {
  return page.evaluate(
    ({ id, value }) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!(el instanceof HTMLElement)) return false;
      el.dataset.wsfW7Mark = value;
      return true;
    },
    { id: testId, value: mark },
  );
}

async function markSurvives(page: Page, testId: string, mark: string): Promise<boolean> {
  return page.evaluate(
    ({ id, value }) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      return el instanceof HTMLElement && el.dataset.wsfW7Mark === value;
    },
    { id: testId, value: mark },
  );
}

/**
 * THE ELEMENT THAT ACTUALLY SCROLLS for a screen — looked for INSIDE it as
 * well as above it.
 *
 * MEASURED, NOT ASSUMED. An ancestor-only walk (which is what this started as,
 * and what W9's own helper does) reports "nothing scrolls" on `/you`: the
 * screen node itself is 512 tall in a 512 box, and the scroller is a
 * DESCENDANT with a 522/512 range. An ancestor walk cannot see it, so the
 * instrument would have called a real scroll vacuous and the test would have
 * skipped the property rather than measuring it.
 */
const SCROLLER = `
  (id) => {
    const root = document.querySelector('[data-testid="' + id + '"]');
    if (!root) return null;
    let up = root;
    while (up) {
      if (up.scrollHeight > up.clientHeight + 1) return up;
      up = up.parentElement;
    }
    const inner = Array.from(root.querySelectorAll('*')).find(
      (n) => n.scrollHeight > n.clientHeight + 1,
    );
    return inner ?? null;
  }
`;

async function scrollOf(page: Page, testId: string): Promise<number | null> {
  return page.evaluate(
    ({ id, fn }) => {
      const find = eval(fn) as (i: string) => HTMLElement | null;
      const el = find(id);
      return el ? Math.round(el.scrollTop) : null;
    },
    { id: testId, fn: SCROLLER },
  );
}

async function setScroll(page: Page, testId: string, top: number): Promise<number | null> {
  return page.evaluate(
    ({ id, value, fn }) => {
      const find = eval(fn) as (i: string) => HTMLElement | null;
      const el = find(id);
      if (!el) return null;
      el.scrollTop = value;
      return Math.round(el.scrollTop);
    },
    { id: testId, value: top, fn: SCROLLER },
  );
}

/** How far this screen can be scrolled at all, so a small range is stated. */
async function scrollRange(page: Page, testId: string): Promise<number | null> {
  return page.evaluate(
    ({ id, fn }) => {
      const find = eval(fn) as (i: string) => HTMLElement | null;
      const el = find(id);
      return el ? el.scrollHeight - el.clientHeight : null;
    },
    { id: testId, fn: SCROLLER },
  );
}

/* ── the scene ───────────────────────────────────────────────────────────── */

type Scene = { email: string; password: string; uid: string; groupId: string };

/**
 * A member with a community and TWO open goals, so MOVE has a question to ask
 * and resolves to the choose state rather than navigating straight out of the
 * sheet — which is the state in which the sheet's own properties exist to be
 * measured. Everything is synthetic.
 */
async function scene(tag: string): Promise<Scene> {
  const stamp = stampId();
  const email = `wsf-w7sh-${tag}-${stamp}@example.com`;
  const password = 'Sup3rSecret!23';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Robin Vale');
  const groupId = `w7sh-${tag}-${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Maple Street Movers',
    joinPolicy: 'private',
    members: [{ uid, role: 'member' }],
  });
  await seedActiveGoal({
    goalId: `w7shg1-${stamp}`,
    groupId,
    ownerUid: uid,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total: 1847,
  });
  await seedActiveGoal({
    goalId: `w7shg2-${stamp}`,
    groupId,
    ownerUid: uid,
    title: 'Morning Mile Streak',
    target: 300,
    unit: 'miles',
    total: 96,
  });
  return { email, password, uid, groupId };
}

/**
 * OPEN THE SHEET AND WAIT FOR IT TO STOP MOVING.
 *
 * MEASURED, NOT PRECAUTIONARY. The sheet slides up
 * (`animation: 'slide_from_bottom'`), and a hit test taken mid-travel reports
 * the control at coordinates it has already left — which is how this file's
 * first version passed in isolation and then failed twice inside the full
 * parallel suite, on "the Close is present but something covers its own
 * centre". The control was fine; my instrument was reading a moving box. So
 * the sheet's own box is read until two consecutive samples agree.
 */
async function openMoveSheet(page: Page): Promise<void> {
  await page.getByTestId('wsf-member-tab-move').last().click();
  const sheet = page.getByTestId('wsf-move-sheet').last();
  /*
    BOUNDED, AND IT SAYS WHERE MOVE WENT. An unbounded wait here cost a whole
    five-minute test timeout with nothing but "waiting for locator" to show for
    it, when the real answer — MOVE had resolved into a contribution because the
    fixture left exactly one actionable goal — was one URL away.
  */
  try {
    await expect(sheet).toBeVisible({ timeout: 30_000 });
  } catch {
    throw new Error(`the MOVE sheet never appeared; the page is at ${page.url()}`);
  }
  let last: string | null = null;
  for (let i = 0; i < 40; i += 1) {
    // `boundingBox()` WAITS for a re-attach, so a sheet that opens and then
    // goes away hangs here until the whole test times out. Read the geometry
    // directly instead: absent means absent, and the loop can say so.
    const now = await page.evaluate(() => {
      const all = document.querySelectorAll('[data-testid="wsf-move-sheet"]');
      const el = all[all.length - 1] as HTMLElement | undefined;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.height)}`;
    });
    if (now !== null && now === last) return;
    last = now;
    await page.waitForTimeout(50);
  }
  throw new Error(
    `the MOVE sheet never settled (last geometry ${last ?? 'ABSENT'}); the page is at ${page.url()}`,
  );
}

/* ════════════════════════════════════════════════════════════════════════ */

test.describe('W7 · item 2 — MOVE is a focus sheet, measured by hit test', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  /**
   * THE WHOLE SHEET CONTRACT FROM HOME, in one journey, because these
   * properties are only meaningful together: a Close that is reachable, a tab
   * bar that is not, a prior screen that is genuinely still mounted, and a
   * return to the exact scroll it was left at.
   */
  test('from Home: Close is a real 44x44 control, the bar underneath is unreachable, and the tab survives', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const sc = await scene('home');
    await signInVia(page, sc.email, sc.password);
    await page.goto('/');
    await expect(page.getByTestId('wsf-community').last()).toBeVisible({ timeout: 40_000 });
    /*
      SETTLE BEFORE PLANTING. My first version planted the offset as soon as
      the screen appeared and read 218 back after the sheet closed, against a
      planted 160. That was my instrument, not a lost scroll: Home's goal data
      arrives after first paint, the content grows underneath, and the offset
      moves with it. Waiting for the hero makes the number stable, so a
      difference afterwards means the SHEET moved it.
    */
    await expect(page.getByTestId('wsf-community-goal-hero').last()).toBeVisible({
      timeout: 40_000,
    });
    await page.waitForTimeout(800);

    // NON-VACUOUS BY CONSTRUCTION: a restoration claim needs somewhere to
    // restore FROM, so the planted offset is asserted non-zero first.
    expect(await markNode(page, 'wsf-community', 'home'), 'Home could not be marked').toBe(true);
    const planted = await setScroll(page, 'wsf-community', 160);
    expect(planted, 'Home had nowhere to scroll, so a scroll claim would be vacuous').not.toBeNull();
    expect(planted, 'the planted scroll offset was zero').toBeGreaterThan(0);

    // The tab bar is reachable BEFORE the sheet opens — otherwise "unreachable
    // while open" would prove nothing about the sheet.
    expect(
      await reachableAtCentre(page, 'wsf-member-tab-you'),
      'the tab bar was already unreachable before MOVE opened',
    ).toBe(true);

    await openMoveSheet(page);

    // 1 · THE CLOSE: named, visible, and at least 44x44 on the element that
    // carries the name.
    const close = page.getByTestId('wsf-move-close').last();
    await expect(close, 'the sheet has no named Close').toBeVisible();
    await expect(close).toHaveAttribute('aria-label', 'Close');
    const closeBox = await close.boundingBox();
    expect(closeBox, 'the Close has no box').not.toBeNull();
    expect(closeBox!.width, `Close is ${closeBox!.width}px wide`).toBeGreaterThanOrEqual(
      MIN_TARGET,
    );
    expect(closeBox!.height, `Close is ${closeBox!.height}px tall`).toBeGreaterThanOrEqual(
      MIN_TARGET,
    );
    expect(
      await reachableAtCentre(page, 'wsf-move-close'),
      'the Close is present but something covers its own centre',
    ).toBe(true);

    // 2 · THE CHROME UNDERNEATH IS NOT REACHABLE. Covered is not the claim;
    // untouchable is. Every tab is asked, including MOVE itself.
    for (const key of ['home', 'community', 'activity', 'you', 'move']) {
      expect(
        await reachableAtCentre(page, `wsf-member-tab-${key}`),
        `the ${key} tab is still touchable underneath the open sheet`,
      ).toBe(false);
    }

    // 3 · THE PRIOR TAB IS GENUINELY STILL THERE, not re-created behind.
    expect(
      await markSurvives(page, 'wsf-community', 'home'),
      'the tab under the sheet was rebuilt rather than kept',
    ).toBe(true);

    // 4 · THE SHEET DRAWS NO SHELL OF ITS OWN.
    const sheet = page.getByTestId('wsf-move-sheet').last();
    for (const id of [
      'wsf-member-topbar-menu-button',
      'wsf-member-topbar',
      'wsf-member-tabs',
      'wsf-member-topbar-wordmark',
    ]) {
      expect(
        await sheet.locator(`[data-testid="${id}"]`).count(),
        `the sheet drew its own ${id}`,
      ).toBe(0);
    }

    // 5 · CLOSE IS THE WAY OUT — clicked, never page.goBack().
    await close.click();
    await expect(page.getByTestId('wsf-move-sheet')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId('wsf-community').last()).toBeVisible({ timeout: 30_000 });
    expect(
      await markSurvives(page, 'wsf-community', 'home'),
      'Close rebuilt the tab instead of returning to it',
    ).toBe(true);
    expect(
      await scrollOf(page, 'wsf-community'),
      'Close returned to Home but threw its scroll away',
    ).toBe(planted);
    expect(
      await reachableAtCentre(page, 'wsf-member-tab-you'),
      'the tab bar did not become touchable again after Close',
    ).toBe(true);
  });

  /**
   * AND FROM A DIFFERENT TAB, because "opens over the tab you were on" is a
   * claim about WHICHEVER tab that was. A sheet that always returned to Home
   * would satisfy the Home journey above and be wrong.
   */
  test('from You: the sheet returns to You, at the scroll You was left at', async ({ page }) => {
    test.setTimeout(300_000);
    /*
      A SHORT VIEWPORT, ON PURPOSE. At 390x844 this fixture's You does not
      overflow — `setScroll` returned null — and a scroll-restoration claim on
      a screen that cannot scroll is satisfied by doing nothing. 390x640 gave
      only 10px, and none at all once the member had visited a community first.
      Rather than assert something vacuous, condition the assertion away, or
      quietly drop the claim, the test moves to a viewport where the page
      genuinely has a scroll and states the range it measured.
    */
    await page.setViewportSize({ width: 360, height: 480 });
    const sc = await scene('you');
    // Enough communities that You has a list long enough to scroll. A member
    // with one community is the case that cannot exercise this property.
    for (let i = 0; i < 5; i += 1) {
      const extra = `w7shy${i}-${stampId()}`;
      await seedCommunity({
        groupId: extra,
        displayName: `Extra Community ${i} — a long enough name to wrap on a short phone`,
        joinPolicy: 'private',
        members: [{ uid: sc.uid, role: 'member' }],
      });
      /*
        NO GOAL IN THE EXTRAS, DELIBERATELY. My first version gave each one a
        single active goal, and the test then hung for five minutes waiting for
        a sheet that never came: with exactly ONE actionable goal in the current
        community, MOVE resolves straight into that contribution rather than
        presenting a choice, which is correct behaviour and the wrong
        precondition for measuring the sheet. Goal-less extras lengthen the You
        list without changing what MOVE has to ask.
      */
    }
    await signInVia(page, sc.email, sc.password);
    /*
      CHOOSE A COMMUNITY FIRST, AS A MEMBER WOULD.

      MEASURED, AND IT IS THE PRODUCT BEING RIGHT. With six communities and
      none chosen, `resolveCurrentCommunity` returns null and MOVE replaces to
      Home — `app/move/index.tsx` says why: "No community, or several with none
      chosen: Home already owns both of those questions." My first fixture
      seeded the extras and went straight to You, so MOVE correctly declined to
      present a sheet and the test waited for one that was never coming. Opening
      the main community makes it current, which is what a member who had been
      using the app would have done.
    */
    await page.goto(`/community/${sc.groupId}`);
    await expect(page.getByTestId('wsf-community').last()).toBeVisible({ timeout: 40_000 });
    await page.goto('/you');
    await expect(page.getByTestId('wsf-you').last()).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(1_200);

    expect(await markNode(page, 'wsf-you', 'you'), 'You could not be marked').toBe(true);
    const range = await scrollRange(page, 'wsf-you');
    // eslint-disable-next-line no-console
    console.log(`[W7] You scroll range at 360x480: ${range}px`);
    expect(range, 'You had nowhere to scroll, so a scroll claim would be vacuous').not.toBeNull();
    expect(range, 'You cannot be scrolled at all here').toBeGreaterThan(0);
    const planted = await setScroll(page, 'wsf-you', range!);
    expect(planted, 'the planted scroll offset was zero').toBeGreaterThan(0);

    await openMoveSheet(page);
    expect(
      await markSurvives(page, 'wsf-you', 'you'),
      'You was rebuilt while the sheet was open',
    ).toBe(true);

    await page.getByTestId('wsf-move-close').last().click();
    await expect(page.getByTestId('wsf-move-sheet')).toHaveCount(0, { timeout: 30_000 });

    // The tab it returned to is the one it was opened from, and it is the SAME
    // instance rather than a fresh You.
    await expect(page.getByTestId('wsf-you').last()).toBeVisible({ timeout: 30_000 });
    expect(new URL(page.url()).pathname, 'Close landed somewhere other than You').toBe('/you');
    expect(
      await markSurvives(page, 'wsf-you', 'you'),
      'Close rebuilt You rather than returning to it',
    ).toBe(true);
    expect(await scrollOf(page, 'wsf-you'), 'Close threw away the scroll on You').toBe(planted);
  });

  /**
   * THE COLD DEEP LINK. `/move` typed or followed from outside the app has no
   * tab behind it to return to, so the sheet's Close cannot pop — it has to
   * resolve to the canonical member destination instead of stranding the
   * member on a scrim over nothing.
   */
  test('a cold /move still has a way out, and it leads somewhere real', async ({ page }) => {
    test.setTimeout(300_000);
    const sc = await scene('cold');
    await signInVia(page, sc.email, sc.password);

    await page.goto('/move');
    await expect(page.getByTestId('wsf-move-sheet').last()).toBeVisible({ timeout: 40_000 });

    const close = page.getByTestId('wsf-move-close').last();
    const box = await close.boundingBox();
    expect(box!.height, 'the cold sheet has no usable Close').toBeGreaterThanOrEqual(MIN_TARGET);
    expect(await reachableAtCentre(page, 'wsf-move-close')).toBe(true);

    await close.click();
    await expect(page.getByTestId('wsf-move-sheet')).toHaveCount(0, { timeout: 30_000 });
    // Somewhere real, and inside the shell — not a blank scrim and not /move.
    expect(new URL(page.url()).pathname, 'a cold Close left the member on /move').not.toBe('/move');
    await expect(page.getByTestId('wsf-member-tabs').last()).toBeVisible({ timeout: 30_000 });
  });
  /**
   * REDUCED MOTION KEEPS THE HIERARCHY. `app/_layout.tsx` drops the sheet's
   * travel for a member who has asked for less motion
   * (`animation: reduced ? 'none' : 'slide_from_bottom'`), and the risk in a
   * change like that is dropping the PRESENTATION with the animation — a sheet
   * that becomes an opaque page when the travel is removed is the defect this
   * commit set out to fix, reappearing for exactly the members least able to
   * tolerate it.
   *
   * So this asks for the hierarchy, not the animation: with
   * `prefers-reduced-motion: reduce` emulated, the scrim, the panel, the
   * reachable Close, the unreachable bar and the surviving tab behind must all
   * still hold.
   */
  test('with reduced motion the sheet is still a sheet, not an opaque page', async ({ page }) => {
    test.setTimeout(300_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const sc = await scene('rm');
    await signInVia(page, sc.email, sc.password);
    await page.goto('/');
    await expect(page.getByTestId('wsf-community').last()).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-community-goal-hero').last()).toBeVisible({
      timeout: 40_000,
    });
    expect(await markNode(page, 'wsf-community', 'rm'), 'Home could not be marked').toBe(true);

    await openMoveSheet(page);

    // The scrim is still painted, and still translucent — a sheet that lost
    // its scrim would report a fully opaque backdrop here.
    const scrim = page.getByTestId('wsf-move-scrim').last();
    await expect(scrim, 'the reduced-motion sheet has no scrim').toBeVisible();
    const backdrop = await scrim.evaluate((n) => getComputedStyle(n as HTMLElement).backgroundColor);
    expect(backdrop, `the scrim is ${backdrop}`).toMatch(/^rgba\(/);
    const alpha = Number(backdrop.replace(/^rgba?\(|\)$/g, '').split(',')[3] ?? '1');
    expect(alpha, 'the scrim is fully opaque, so nothing shows through').toBeLessThan(1);
    expect(alpha, 'the scrim is fully transparent, so nothing is dimmed').toBeGreaterThan(0);

    // And the rest of the hierarchy is unchanged.
    expect(await reachableAtCentre(page, 'wsf-move-close')).toBe(true);
    expect(
      await reachableAtCentre(page, 'wsf-member-tab-you'),
      'reduced motion left the bar touchable under the sheet',
    ).toBe(false);
    expect(
      await markSurvives(page, 'wsf-community', 'rm'),
      'reduced motion rebuilt the tab behind the sheet',
    ).toBe(true);
  });
});

test.describe('W7 · item 3 — the members link, measured independently', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  /**
   * NOT A RE-RUN OF W9'S SPEC. The number is measured again here, and then the
   * harder question is asked in W7's own instrument: that the top, middle AND
   * bottom of the box all belong to this pressable rather than to an ancestor
   * whose padding merely makes the box look tall. A row that measured 44 but
   * only answered a thumb in its middle third would pass a height assertion
   * and still be the defect.
   */
  test('the members link is 44px and every third of it answers a thumb', async ({ page }) => {
    test.setTimeout(300_000);
    const sc = await scene('mlink');
    await signInVia(page, sc.email, sc.password);
    await page.goto(`/community/${sc.groupId}`);

    const link = page.getByTestId('wsf-community-members-link').last();
    await expect(link).toBeVisible({ timeout: 40_000 });
    await link.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);

    /*
      MEASURED AND RECORDED, BEFORE THE ROW IS MOVED. `scrollIntoViewIfNeeded`
      leaves the row at the foot of the viewport, and there the RAISED MOVE
      control overhangs its lower edge: a hit test at the bottom of the box
      comes back `wsf-member-tab-move`. W9's own spec scrolls clear for this
      reason and says so in its commit; this test reproduces the observation
      first so the reason for the scroll is evidence rather than folklore, then
      does the same thing. It is not a finding against the members link — the
      link is the right height — it is a note about where the raised action
      sits.
    */
    const atRest = await link.boundingBox();
    const restBottom = await hitChainAt(
      page,
      atRest!.x + atRest!.width / 2,
      atRest!.y + atRest!.height - 3,
    );
    // eslint-disable-next-line no-console
    console.log(`[W7] members link bottom at the arrival scroll belongs to: ${restBottom[0] ?? 'nothing'}`);

    // Now clear the raised action, so the measurement is of the link.
    await page.evaluate(() => {
      let el = document.querySelector('[data-testid="wsf-community-members-link"]');
      let node = el as HTMLElement | null;
      while (node) {
        if (node.scrollHeight > node.clientHeight + 1) {
          node.scrollTop += 120;
          return;
        }
        node = node.parentElement;
      }
    });
    await page.waitForTimeout(400);

    const box = await link.boundingBox();
    expect(box, 'the members link has no box').not.toBeNull();
    // eslint-disable-next-line no-console
    console.log(`[W7] members link: ${Math.round(box!.width)}x${Math.round(box!.height)}`);
    expect(
      box!.height,
      `"See everyone in this community" is ${box!.height}px tall, under the ${MIN_TARGET}px floor`,
    ).toBeGreaterThanOrEqual(MIN_TARGET);

    // Top, middle and bottom of the control's own box.
    const x = box!.x + box!.width / 2;
    for (const [label, y] of [
      ['top', box!.y + 3],
      ['middle', box!.y + box!.height / 2],
      ['bottom', box!.y + box!.height - 3],
    ] as const) {
      const chain = await hitChainAt(page, x, y);
      expect(
        chain,
        `the ${label} of the members link belongs to ${chain[0] ?? 'nothing'}, not the link`,
      ).toContain('wsf-community-members-link');
    }
  });
});

test.describe('W7 · item 5 — shell invariants on the shipping routes', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  /**
   * ONE TOP BAR, ONE BOX, ONE WORDMARK — asked on all four tabs in one pass,
   * because "the top composition jumps between routes" was the owner's actual
   * complaint and a per-route assertion cannot see a jump.
   */
  test('one top bar in one place, one wordmark, on every tab', async ({ page }) => {
    test.setTimeout(300_000);
    const sc = await scene('bar');
    await signInVia(page, sc.email, sc.password);
    await page.goto('/');
    await expect(page.getByTestId('wsf-member-tabs').last()).toBeVisible({ timeout: 40_000 });

    const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const [tab, key] of [
      ['home', 'wsf-member-tab-home'],
      ['community', 'wsf-member-tab-community'],
      ['activity', 'wsf-member-tab-activity'],
      ['you', 'wsf-member-tab-you'],
    ] as const) {
      await page.getByTestId(key).last().click();
      await page.waitForTimeout(700);

      // Exactly one bar is VISIBLE, even though a retained screen may leave a
      // second in the document — the distinction the shell helpers exist for.
      const bars = page.getByTestId('wsf-member-topbar');
      const visible: number[] = [];
      for (let i = 0; i < (await bars.count()); i += 1) {
        if (await bars.nth(i).isVisible()) visible.push(i);
      }
      expect(visible.length, `${tab} shows ${visible.length} top bars`).toBe(1);

      const b = await bars.nth(visible[0]).boundingBox();
      boxes[tab] = { x: b!.x, y: b!.y, w: b!.width, h: b!.height };

      const marks = page.getByTestId('wsf-member-topbar-wordmark');
      let visibleMarks = 0;
      for (let i = 0; i < (await marks.count()); i += 1) {
        if (await marks.nth(i).isVisible()) visibleMarks += 1;
      }
      expect(visibleMarks, `${tab} shows ${visibleMarks} wordmarks`).toBe(1);

      // The hamburger is a real target wherever it is offered.
      const menu = page.getByTestId('wsf-member-topbar-menu-button').last();
      if (await menu.isVisible()) {
        const mb = await menu.boundingBox();
        expect(mb!.width, `${tab}: the menu button is ${mb!.width}px wide`).toBeGreaterThanOrEqual(
          MIN_TARGET,
        );
        expect(
          mb!.height,
          `${tab}: the menu button is ${mb!.height}px tall`,
        ).toBeGreaterThanOrEqual(MIN_TARGET);
      }
    }

    // THE JUMP, MEASURED: the same bar in the same place on all four.
    const values = Object.values(boxes);
    for (const key of ['x', 'y', 'w', 'h'] as const) {
      const distinct = [...new Set(values.map((v) => Math.round(v[key])))];
      expect(distinct, `the top bar's ${key} differs between tabs: ${distinct.join(', ')}`).toEqual([
        distinct[0],
      ]);
    }
  });
});
