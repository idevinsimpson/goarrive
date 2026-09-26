import { test, expect, type Frame, type Page } from '@playwright/test';

/**
 * W9 — THE SHELL PROTOTYPE'S BEHAVIOURAL CONTRACT.
 *
 * PROPOSED / NOT ACCEPTED. These run against the gated prototype under
 * /design-target/shell-next, never against a production member route. No
 * production behaviour is asserted or changed here.
 *
 * WHY THIS FILE IS THE DELIVERABLE AND THE SCREENSHOTS ARE NOT. Every finding
 * the owner reported from the staging recording is invisible in a still: a
 * reload on reselect, a page rebuilt from scratch on the way back, a back
 * button carrying a trail of tab presses. A capture cannot show any of it and
 * a claim about it is worth nothing. So the prototype counts its own mounts
 * and its own navigations, and this file asserts on the numbers.
 *
 * It ASSERTS, so per tests-e2e/helpers/capture.ts it runs in the ordinary
 * suite every time and writes no bytes.
 */

const BASE = '/design-target/shell-next';

/** Production URL <- prototype URL. Strip the prefix and these are today's
 *  addresses, unchanged. The mapping is the architecture claim, so it is a
 *  table the test walks rather than a sentence in a document. */
const ROUTES = [
  { proto: BASE, pathname: BASE, production: '/', page: 'home', title: 'Home', tab: 'home' },
  { proto: `${BASE}/community`, pathname: `${BASE}/community`, production: '/community', page: 'community', title: 'Community', tab: 'community' },
  {
    proto: `${BASE}/community/detail?groupId=demo-group`,
    pathname: `${BASE}/community/detail`,
    production: '/community/[groupId]',
    page: 'community-detail',
    title: 'A community',
    // Served by the HOME tab, not the Community tab — see the tab-ownership
    // test below and (home)/_layout.tsx for why.
    tab: 'home',
  },
  { proto: `${BASE}/activity`, pathname: `${BASE}/activity`, production: '/activity', page: 'activity', title: 'Your progress', tab: 'activity' },
  { proto: `${BASE}/you`, pathname: `${BASE}/you`, production: '/you', page: 'you', title: 'You', tab: 'you' },
] as const;

type Probe = { mounts: Record<string, number>; navs: string[]; presses: string[] };

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const p = (globalThis as unknown as { __wsfShellNextProbe?: Probe }).__wsfShellNextProbe;
    return p ?? { mounts: {}, navs: [], presses: [] };
  });
}

async function open(page: Page, url: string) {
  await page.goto(url);
  await page.getByTestId('wsf-shell-next-topbar').waitFor({ state: 'visible', timeout: 30_000 });
}

/** The standard phone. Set before anything that depends on the page
 *  scrolling: at the default desktop viewport the prototype's content fits,
 *  and a scroll-preservation check on a page that never scrolled proves
 *  nothing. The first run of this file failed exactly there, on its own guard. */
async function phone(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
}

/**
 * IS THIS ELEMENT COVERED AT THIS POINT?
 *
 * Playwright's `toBeHidden` asks about CSS and layout, not about what is in
 * front of what — an element under an opaque sheet is still "visible" to it.
 * When the claim is "the bottom bar disappears once MOVE opens", occlusion is
 * the actual claim, so it is hit-tested: whatever the browser would hand a
 * tap at that point must not belong to the bar.
 */
async function coveredAt(page: Page, testId: string, x: number, y: number): Promise<boolean> {
  return page.evaluate(
    ({ testId: id, x: px, y: py }) => {
      const target = document.querySelector(`[data-testid="${id}"]`);
      if (!target) return true;
      const hit = document.elementFromPoint(px, py);
      return !hit || !(target === hit || target.contains(hit));
    },
    { testId, x, y },
  );
}

test.describe('W9 shell prototype', () => {
  test('every member URL is reachable directly, with the group segment invisible', async ({ page }) => {
    test.setTimeout(120_000);
    await phone(page);

    /*
      EVERY ONE OF THEM, COLD. `page.goto` is a fresh document each time:
      nothing was visited first, so this proves each address resolves on its
      own rather than only as the destination of a tap from Home. Browser
      refresh is the same operation and is therefore covered by the same pass.
    */
    for (const route of ROUTES) {
      await open(page, route.proto);
      await expect(
        page.getByTestId(`wsf-shell-next-page-${route.page}`),
        `${route.production}: the wrong screen answered`,
      ).toBeVisible();
      await expect(page.getByTestId(`wsf-shell-next-title-${route.page}`)).toHaveText(route.title);

      /*
        THE URL DID NOT ACQUIRE A GROUP SEGMENT. `(tabs)` is a route GROUP, so
        it contributes nothing to the address. This is the whole basis for
        saying a production migration needs no redirect and breaks no existing
        link: the files move into a directory, the addresses do not move.
      */
      const url = new URL(page.url());
      expect(url.pathname, `${route.production}: the URL changed shape`).toBe(route.pathname);
      expect(url.pathname, `${route.production}: a group segment leaked into the URL`).not.toContain('(');

      await expect(page.getByTestId('wsf-shell-next-topbar')).toBeVisible();
      await expect(page.getByTestId('wsf-shell-next-tabs')).toBeVisible();

      /*
        AND THE RIGHT TAB IS LIT ON ARRIVAL.

        This is where the mapping stops being cosmetic. `/community` lights
        Community; `/community/<detail>` lights HOME, because in the shipping
        build `/` resolves to the community detail and Home stays lit on it
        (`MEMBER_TABS[0].match` is `p === '/' || p.startsWith('/community/')`).
        Two sibling URLs, two different tabs — the arrangement that had to be
        proven rather than assumed, and it survives a cold load of either.
      */
      await expect(
        page.getByTestId(`wsf-shell-next-tab-${route.tab}`),
        `${route.production}: the wrong tab is lit`,
      ).toHaveAttribute('data-current', 'true');
      const lit = await page.locator('[data-testid^="wsf-shell-next-tab-"][data-current="true"]').count();
      expect(lit, `${route.production}: ${lit} tabs claimed to be current`).toBe(1);
    }

    /*
      OPENING A COMMUNITY FROM THE LIST MOVES TO THE HOME TAB, AND NOW LEAVES A
      REAL BACK DESTINATION BEHIND IT.

      THIS IS THE SAME ASSERTION CHECKPOINT 1 SHIPPED, TURNED AROUND. It read
      `expect(historyOnDetail).toBe(historyOnList)` and documented the defect:
      the link crosses from the Community tab to the Home tab, react-navigation
      performs a tab jump, and on web a tab jump REPLACED the history entry
      instead of pushing one, so a browser Back from the detail left the app.
      The Director refused to ship that and refused the "accept it" option.

      It is not deleted to make the suite green. It is inverted, so the same
      line now pins the fix and fails again the moment the entry stops being
      created. The fix is `backBehavior="history"` on the tab navigator — the
      router's own documented back model, not a hand-rolled history mutation;
      `sprint-w9-back-path-spike.spec.ts` measures all five navigation methods
      and `sprint-w9-back-behaviour-matrix.spec.ts` measures all six modes.
    */
    await open(page, `${BASE}/community`);
    await expect(page.getByTestId('wsf-shell-next-tab-community')).toHaveAttribute('data-current', 'true');
    const historyOnList = await page.evaluate(() => history.length);

    await page.getByTestId('wsf-shell-next-community-to-group').click();
    await page.getByTestId('wsf-shell-next-page-community-detail').waitFor({ state: 'visible' });

    expect(new URL(page.url()).pathname).toBe(`${BASE}/community/detail`);
    await expect(page.getByTestId('wsf-shell-next-tab-home')).toHaveAttribute('data-current', 'true');
    await expect(page.getByTestId('wsf-shell-next-tabs')).toBeVisible();

    await expect(page.getByTestId('wsf-shell-next-page-community')).toBeAttached();
    await expect(page.getByTestId('wsf-shell-next-page-community-detail')).toBeAttached();

    const historyOnDetail = await page.evaluate(() => history.length);
    // eslint-disable-next-line no-console
    console.log(`[W9] cross-tab link history: ${historyOnList} -> ${historyOnDetail}`);
    expect(
      historyOnDetail,
      'the cross-tab navigation stopped creating a back destination — the checkpoint-1 defect is back',
    ).toBeGreaterThan(historyOnList);

    /* And Back actually uses it. */
    await page.goBack();
    await page.getByTestId('wsf-shell-next-page-community').waitFor({ state: 'visible', timeout: 15_000 });
    expect(new URL(page.url()).pathname, 'Back did not return to the Community list').toBe(`${BASE}/community`);
    await expect(page.getByTestId('wsf-shell-next-tab-community')).toHaveAttribute('data-current', 'true');
  });

  test('the top bar and the first content sit at exactly the same place on every tab', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, BASE);

    const seen: { tab: string; bar: string; title: number }[] = [];
    for (const tab of ['home', 'community', 'activity', 'you'] as const) {
      if (tab !== 'home') {
        await page.getByTestId(`wsf-shell-next-tab-${tab}`).click();
      }
      const pageId = tab === 'home' ? 'home' : tab;
      await page.getByTestId(`wsf-shell-next-page-${pageId}`).waitFor({ state: 'visible' });
      const bar = (await page.getByTestId('wsf-shell-next-topbar').boundingBox())!;
      const title = (await page.getByTestId(`wsf-shell-next-title-${pageId}`).boundingBox())!;
      seen.push({
        tab,
        bar: `${Math.round(bar.x)},${Math.round(bar.y)},${Math.round(bar.width)},${Math.round(bar.height)}`,
        title: Math.round(title.y),
      });
    }

    /*
      ONE BAR, ONE GEOMETRY. Not "they look the same" — the same four numbers
      on all four tabs. In the shipping build these differ by construction:
      Home opens at kit.page paddingTop 16 over a 44-high chrome row,
      Community and Progress at paddingTop 10, and You at a full-bleed navy
      card with paddingTop 26 and a white 17px wordmark.
    */
    const bars = new Set(seen.map((s) => s.bar));
    expect(bars.size, `the top bar moved between tabs: ${JSON.stringify(seen)}`).toBe(1);

    /*
      AND THE TITLE DOES NOT JUMP. Same first-content origin on every tab, so
      switching does not shift the page's first line vertically.
    */
    const titles = new Set(seen.map((s) => s.title));
    expect(titles.size, `the page title jumped vertically: ${JSON.stringify(seen)}`).toBe(1);
  });

  test('tapping the tab you are already on does nothing at all', async ({ page }) => {
    test.setTimeout(120_000);
    await phone(page);
    await open(page, BASE);
    await page.getByTestId('wsf-shell-next-page-home').waitFor({ state: 'visible' });

    // Give the screen some state a reload would destroy: a scroll position and
    // something the member themselves changed.
    await page.getByTestId('wsf-shell-next-step-home').click();
    await page.getByTestId('wsf-shell-next-step-home').click();
    await page.getByTestId('wsf-shell-next-scroll-home').evaluate((el) => {
      // Assigned, not `scrollTo`: the smooth-scroll form did not land in time
      // and read back as 0, which would have made the check below vacuous.
      el.scrollTop = 200;
    });
    await page.waitForTimeout(200);

    const beforeProbe = await probe(page);
    const beforeMounts = beforeProbe.mounts.home;
    const beforeNavs = beforeProbe.navs.length;
    const beforeUrl = page.url();
    const beforeHistory = await page.evaluate(() => history.length);
    const beforeScroll = await page
      .getByTestId('wsf-shell-next-scroll-home')
      .evaluate((el) => Math.round(el.scrollTop));
    expect(beforeScroll, 'the page did not actually scroll, so the check would prove nothing').toBeGreaterThan(150);

    // Tap Home three times while already on Home.
    for (let i = 0; i < 3; i += 1) {
      await page.getByTestId('wsf-shell-next-tab-home').click();
      await page.waitForTimeout(120);
    }

    const after = await probe(page);

    /*
      ZERO NAVIGATION. The shipping bar calls `router.replace(tab.href)`
      unconditionally, so three taps are three navigations and three teardowns.
      Here the press handler returns before it can reach the router.
    */
    expect(after.navs.length, `a reselect navigated: ${JSON.stringify(after.navs)}`).toBe(beforeNavs);

    // The presses DID register, so this is a no-op rather than a dead button.
    expect(after.presses.filter((p) => p === 'home').length).toBeGreaterThanOrEqual(3);

    // ZERO REMOUNT.
    expect(after.mounts.home, 'the active tab remounted on reselect').toBe(beforeMounts);

    // And nothing the member had was lost.
    expect(await page.getByTestId('wsf-shell-next-steps-home').textContent()).toBe('2');
    const afterScroll = await page
      .getByTestId('wsf-shell-next-scroll-home')
      .evaluate((el) => Math.round(el.scrollTop));
    expect(Math.abs(afterScroll - beforeScroll), 'the scroll position moved on reselect').toBeLessThanOrEqual(2);

    // No URL change and no history entry for a tap that did nothing.
    expect(page.url()).toBe(beforeUrl);
    expect(await page.evaluate(() => history.length)).toBe(beforeHistory);
  });

  test('switching tabs keeps each tab loaded, and records the real history cost', async ({ page }) => {
    test.setTimeout(120_000);
    await phone(page);
    await open(page, BASE);
    await page.getByTestId('wsf-shell-next-step-home').click();
    await page.getByTestId('wsf-shell-next-step-home').click();
    await page.getByTestId('wsf-shell-next-scroll-home').evaluate((el) => {
      el.scrollTop = 180;
    });
    await page.waitForTimeout(200);

    const historyAtStart = await page.evaluate(() => history.length);
    /*
      THE BASELINE IS READ, NOT ASSUMED TO BE 1.

      Home reports TWO mounts before a single tab has been pressed, on a cold
      load, every time. That is the static export: expo-router renders the
      route once into the exported HTML and React mounts it again when the
      bundle hydrates. It is a property of how the page is served and has
      nothing to do with tab behaviour -- it happens before any navigation
      exists to blame. An earlier revision of this test hard-coded `toBe(1)`
      and failed on it, which would have read as "the architecture remounts
      tabs" when the architecture had not yet been asked to do anything.

      So the claim is stated as what it actually is: whatever Home cost to
      build the first time, going away and coming back costs NOTHING MORE.
    */
    const homeMountsAtStart = (await probe(page)).mounts.home;

    await page.getByTestId('wsf-shell-next-tab-community').click();
    await page.getByTestId('wsf-shell-next-page-community').waitFor({ state: 'visible' });
    await page.getByTestId('wsf-shell-next-tab-activity').click();
    await page.getByTestId('wsf-shell-next-page-activity').waitFor({ state: 'visible' });
    await page.getByTestId('wsf-shell-next-tab-home').click();
    await page.getByTestId('wsf-shell-next-page-home').waitFor({ state: 'visible' });

    const after = await probe(page);

    /*
      HOME MOUNTED ONCE. Not once per visit — once. In the shipping flat Stack
      this is impossible: a Stack holds one screen, so leaving Home unmounts it
      and coming back builds a new one, which is why the member sees a fresh
      skeleton for a page they were just looking at.
    */
    expect(after.mounts.home, 'Home was rebuilt on the way back').toBe(homeMountsAtStart);
    // And the other two tabs were each built exactly once, on first visit.
    expect(after.mounts.community, 'Community was rebuilt').toBe(1);
    expect(after.mounts.activity, 'Progress was rebuilt').toBe(1);
    /*
      ALL THREE ARE STILL IN THE DOCUMENT AT THE END. A flat Stack holds one
      screen, so this is the line that a `router.replace` shell cannot pass:
      two of these would be gone.
    */
    for (const id of ['home', 'community', 'activity']) {
      await expect(
        page.getByTestId(`wsf-shell-next-page-${id}`),
        `${id} was detached when the member moved away from it`,
      ).toBeAttached();
    }
    expect(await page.getByTestId('wsf-shell-next-steps-home').textContent()).toBe('2');
    const scroll = await page
      .getByTestId('wsf-shell-next-scroll-home')
      .evaluate((el) => Math.round(el.scrollTop));
    expect(scroll, 'Home lost its scroll position across a tab switch').toBeGreaterThan(150);

    /*
      THE HISTORY COST OF THE BACK-PATH FIX, MEASURED RATHER THAN HIDDEN.

      This number MOVED, and it moved because of the fix. Before
      `backBehavior="history"` three tab switches added ONE entry; they now add
      TWO, because the mechanism that gives the community detail a real back
      destination is precisely "a tab change is an entry in browser history".
      The two cannot be separated: `sprint-w9-back-behaviour-matrix.spec.ts`
      drives all six modes and every mode that returns Back to the list also
      makes tab switches cost entries, while every mode that keeps tab switches
      cheap leaves Back exiting the app.

      That is a genuine tension between the owner's brief ("switching primary
      tabs stacks no history trail") and the Director's property 3/4 (a
      community detail must have a real back destination). The Director's
      requirement is explicit and "accept it" was refused, so the fix is in and
      the cost is reported rather than smoothed over. The bound is 2 — three
      switches, deduplicated back to two because returning to Home collapses
      onto its earlier entry — and a third would mean something else changed.
    */
    const historyAfter = await page.evaluate(() => history.length);
    const added = historyAfter - historyAtStart;
    // eslint-disable-next-line no-console
    console.log(`[W9] history entries added by 3 tab switches: ${added}`);
    expect(added, `three tab switches added ${added} history entries`).toBeLessThanOrEqual(2);
  });

  test('MOVE opens over the member context and closes back onto it', async ({ page }) => {
    test.setTimeout(120_000);
    await phone(page);
    await open(page, `${BASE}/activity`);
    await page.getByTestId('wsf-shell-next-step-activity').click();
    const mountsBefore = (await probe(page)).mounts.activity;

    // Where the bar and the raised control are, BEFORE the sheet opens — the
    // points that must stop belonging to them once it does.
    const barBox = (await page.getByTestId('wsf-shell-next-tabs').boundingBox())!;
    const moveBox = (await page.getByTestId('wsf-shell-next-tab-move').boundingBox())!;

    await page.getByTestId('wsf-shell-next-tab-move').click();
    await page.getByTestId('wsf-shell-next-move-sheet').waitFor({ state: 'visible' });

    /*
      NO BOTTOM BAR UNDER THE MOVE PAGE, AND NO RAISED MOVE CIRCLE.

      This is the owner's finding stated as a check, and it is an OCCLUSION
      check rather than a visibility one on purpose. The sheet is a
      `transparentModal`, so the tab underneath is deliberately still mounted
      and still in the document — that is the point of it, and it is why
      `toBeHidden` is the wrong question here. The right question is what a tap
      at the bar's own coordinates would now reach, and the answer has to be
      the sheet.

      In the shipping build there is nothing to occlude the bar with, because
      '/move' is listed in SHELL_EXACT and the bar is drawn over the resolver
      by design, with the raised MOVE control sitting beneath the MOVE page.
    */
    for (const frac of [0.15, 0.5, 0.85]) {
      const x = Math.round(barBox.x + barBox.width * frac);
      const y = Math.round(barBox.y + barBox.height / 2);
      expect(
        await coveredAt(page, 'wsf-shell-next-tabs', x, y),
        `the tab bar is still reachable at ${Math.round(frac * 100)}% across while MOVE is open`,
      ).toBe(true);
    }
    expect(
      await coveredAt(
        page,
        'wsf-shell-next-tab-move',
        Math.round(moveBox.x + moveBox.width / 2),
        Math.round(moveBox.y + moveBox.height / 2),
      ),
      'the raised MOVE control is still reachable beneath the MOVE page',
    ).toBe(true);

    /*
      THE CONTEXT UNDERNEATH IS THE REAL SCREEN, STILL MOUNTED. A
      transparentModal does not tear down what it covers, so Progress is still
      there — not a screenshot of it. If this were faked the mount count would
      have moved, or the element would be gone.
    */
    const during = await probe(page);
    expect(during.mounts.activity, 'the tab underneath was torn down by the sheet').toBe(mountsBefore);
    await expect(page.getByTestId('wsf-shell-next-page-activity')).toBeAttached();

    /*
      AND IT IS ACTUALLY PAINTED THERE, NOT MERELY IN THE DOCUMENT.

      Being attached is not the claim. The claim is that the member can see the
      screen they came from behind the sheet, and the first capture of this
      frame failed it: the outer Stack's `contentStyle` gave every screen an
      opaque cream ground, the sheet's scene included, so the "context
      underneath" was cream behind a scrim — a flat grey rectangle — while this
      test still passed on attachment alone.

      `elementsFromPoint` is the honest question, because it returns the stack
      of elements the browser would actually hit at that point and skips
      anything not rendered. If the tab underneath is in that list at a point
      well above the sheet, it is laid out and painted there.
    */
    const paintedUnderneath = await page.evaluate(
      ({ x, y }) => {
        const stack = document.elementsFromPoint(x, y);
        return stack.some((el) => el.closest('[data-testid="wsf-shell-next-page-activity"]') !== null);
      },
      { x: 195, y: 180 },
    );
    expect(
      paintedUnderneath,
      'the sheet is over a blank ground rather than over the real previous tab',
    ).toBe(true);

    await page.getByTestId('wsf-shell-next-move-close').click();
    await page.getByTestId('wsf-shell-next-move-sheet').waitFor({ state: 'detached' });

    // Back on the exact tab it came from, in the exact state it was left in —
    // not on Home, and not on a rebuilt Progress.
    expect(new URL(page.url()).pathname).toBe(`${BASE}/activity`);
    const after = await probe(page);
    expect(after.mounts.activity, 'Progress was rebuilt when the sheet closed').toBe(mountsBefore);
    expect(await page.getByTestId('wsf-shell-next-steps-activity').textContent()).toBe('1');
    await expect(page.getByTestId('wsf-shell-next-tabs')).toBeVisible();
    // And the bar is reachable again at the same point that was covered.
    expect(
      await coveredAt(
        page,
        'wsf-shell-next-tabs',
        Math.round(barBox.x + barBox.width / 2),
        Math.round(barBox.y + barBox.height / 2),
      ),
      'the bar did not come back when the sheet closed',
    ).toBe(false);
  });

  test('MOVE is not a tab and can never render a selected state', async ({ page }) => {
    test.setTimeout(120_000);
    await phone(page);
    await open(page, BASE);
    /*
      STRUCTURAL, NOT COSMETIC. MOVE has no route in the tab navigator at all,
      so there is no focused state for it to inherit and nothing to suppress.
      The four destinations each carry `data-current`; the raised action does
      not carry it on any surface, because it is not one of them.
    */
    for (const url of [BASE, `${BASE}/community`, `${BASE}/activity`, `${BASE}/you`]) {
      await open(page, url);
      const move = page.getByTestId('wsf-shell-next-tab-move');
      await expect(move).toBeVisible();
      expect(await move.getAttribute('data-current'), `${url}: MOVE claimed a selected state`).toBeNull();
      // Exactly one destination is current, everywhere.
      const current = await page.locator('[data-testid^="wsf-shell-next-tab-"][data-current="true"]').count();
      expect(current, `${url}: ${current} tabs claimed to be current`).toBe(1);
    }
  });

  test('the player wears no member chrome', async ({ page }) => {
    test.setTimeout(120_000);
    await phone(page);
    /* Cold, like a member following a link straight into a round. */
    await page.goto(`${BASE}/move/player?goalId=demo-goal`);
    await page.getByTestId('wsf-shell-next-move-player').waitFor({ state: 'visible' });
    await expect(page.getByTestId('wsf-shell-next-tabs')).toHaveCount(0);
    await expect(page.getByTestId('wsf-shell-next-topbar')).toHaveCount(0);
    await expect(page.getByTestId('wsf-shell-next-tab-move')).toHaveCount(0);
  });

  test('the menu holds only controls that work, and Settings is a slot rather than a dead control', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, BASE);
    await page.getByTestId('wsf-shell-next-menu-button').click();
    await page.getByTestId('wsf-shell-next-menu').waitFor({ state: 'visible' });

    // The two real ones, both currently reachable only from the bottom of Home.
    await expect(page.getByTestId('wsf-shell-next-menu-build')).toBeVisible();
    await expect(page.getByTestId('wsf-shell-next-menu-signout')).toBeVisible();

    /*
      SETTINGS IS RENDERED AND IS NOT A CONTROL. W8 owns the real /settings
      route; until it exists there is nothing to navigate to. A greyed row that
      does nothing when tapped is a dead control; a row that is plainly not a
      control is not, so there is no pressable Settings element to find.
    */
    await expect(page.getByTestId('wsf-shell-next-menu-slot-settings')).toBeVisible();
    await expect(page.getByTestId('wsf-shell-next-menu-settings')).toHaveCount(0);

    /*
      AND NOTHING WAS INVENTED. No notification bell, no avatar, and no
      "Switch community" — there is no real switch to invoke, so the row that
      would promise one is absent rather than inert.
    */
    await expect(page.getByTestId('wsf-shell-next-menu-switch-community')).toHaveCount(0);
  });

  test('the shell does not reach the kiosk, display or event surfaces', async ({ page }) => {
    test.setTimeout(120_000);
    /*
      THE PROTOTYPE IS CONFINED TO ITS OWN PREFIX. Its chrome is rendered by
      its own layouts and by nothing in the root layout, so no route outside
      /design-target/shell-next can pick it up — including the shared-device
      surfaces. Checked on the real routes rather than reasoned about.
    */
    for (const url of ['/kiosk/demo-goal', '/display/demo-goal', '/move/demo-goal', '/']) {
      await page.goto(url);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(400);
      await expect(page.getByTestId('wsf-shell-next-topbar'), `${url} picked up the prototype top bar`).toHaveCount(0);
      await expect(page.getByTestId('wsf-shell-next-tabs'), `${url} picked up the prototype tab bar`).toHaveCount(0);
    }
  });
});
