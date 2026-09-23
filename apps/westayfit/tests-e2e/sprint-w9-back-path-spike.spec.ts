import { test, expect, type Browser, type Page } from '@playwright/test';

/**
 * W9 — PACKET 2: THE BACK-PATH SPIKE.
 *
 * PROPOSED / NOT ACCEPTED. Prototype only; no production route is touched.
 *
 * WHY. Checkpoint 1 measured one regression and the Director refused to ship
 * it: opening a community from the Community list crosses into the Home tab
 * (the detail IS Home), react-navigation performs a tab jump, and on web a tab
 * jump REPLACES the history entry rather than pushing one — `history.length`
 * 2 -> 2, and a browser Back from the detail leaves the app. Option 1,
 * "accept it", was refused outright.
 *
 * So this file does two things. First it MEASURES every navigation the router
 * offers for that one journey, side by side, and prints the table — including
 * the ones that fail, because a single passing method proves nothing about the
 * others and "I tried some things" is not evidence. Then it asserts the five
 * properties the Director requires, together, on whichever method the
 * prototype actually ships.
 */

const BASE = '/design-target/shell-next';
const LIST = `${BASE}/community`;
const DETAIL_PATH = `${BASE}/community/detail`;

type Probe = { mounts: Record<string, number>; navs: string[]; presses: string[] };

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const p = (globalThis as unknown as { __wsfShellNextProbe?: Probe }).__wsfShellNextProbe;
    return p ?? { mounts: {}, navs: [], presses: [] };
  });
}

async function phone(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
}

/** Which tab reports itself current. Exactly one must. */
async function litTab(page: Page): Promise<string> {
  const lit = page.locator('[data-testid^="wsf-shell-next-tab-"][data-current="true"]');
  await expect(lit, 'no tab, or more than one tab, claimed to be current').toHaveCount(1);
  const id = await lit.getAttribute('data-testid');
  return (id ?? '').replace('wsf-shell-next-tab-', '');
}

/**
 * Put the Community list into a state a rebuild would destroy: a scroll
 * position and something the member themselves changed. Property 4 is about
 * coming back to THIS list, not to a fresh one.
 */
async function dirtyTheList(page: Page) {
  await page.getByTestId('wsf-shell-next-step-community').click();
  await page.getByTestId('wsf-shell-next-step-community').click();
  await page.getByTestId('wsf-shell-next-scroll-community').evaluate((el) => {
    el.scrollTop = 200;
  });
  await page.waitForTimeout(200);
  const scroll = await page
    .getByTestId('wsf-shell-next-scroll-community')
    .evaluate((el) => Math.round(el.scrollTop));
  expect(scroll, 'the list did not actually scroll, so the check below would prove nothing').toBeGreaterThan(150);
  return scroll;
}

type Outcome = {
  method: string;
  historyBefore: number;
  historyAfter: number;
  added: number;
  litOnDetail: string;
  urlOnDetail: string;
  backLandedOn: string;
  backUrl: string;
  listStillMounted: boolean;
  stepsAfterBack: string | null;
  scrollAfterBack: number | null;
  verdict: 'REAL BACK DESTINATION' | 'NO BACK ENTRY' | 'BACK LEFT THE APP' | 'WRONG TAB ON DETAIL';
};

/**
 * Drive one method end to end and report what actually happened.
 *
 * EACH METHOD GETS ITS OWN BROWSER CONTEXT, and that is not tidiness.
 * The first run of this table shared one page across all five, and
 * `history.length` stopped growing after the first method: once you go back
 * and then navigate forward again the browser REPLACES the forward entry
 * rather than appending, so the length plateaus. Four methods that genuinely
 * produced a working back destination were reported as "NO BACK ENTRY" by an
 * instrument measuring the wrong thing. A fresh context starts the history at
 * a known depth, so the delta means what it says.
 */
async function measureMethod(browser: Browser, testId: string, label: string): Promise<Outcome> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  try {
    return await runMethod(page, testId, label);
  } finally {
    await ctx.close();
  }
}

async function runMethod(page: Page, testId: string, label: string): Promise<Outcome> {
  // `?spike=1` reveals the instrument rig, which is hidden from the frames the
  // Director reviews.
  await page.goto(`${LIST}?spike=1`);
  await page.getByTestId('wsf-shell-next-page-community').waitFor({ state: 'visible', timeout: 30_000 });
  const scrollBefore = await dirtyTheList(page);

  const historyBefore = await page.evaluate(() => history.length);
  await page.getByTestId(testId).click();
  await page.getByTestId('wsf-shell-next-page-community-detail').waitFor({ state: 'visible', timeout: 15_000 });
  const historyAfter = await page.evaluate(() => history.length);
  const litOnDetail = await litTab(page);
  const urlOnDetail = new URL(page.url()).pathname;

  await page.goBack();
  await page.waitForTimeout(900);

  const backUrl = page.url();
  const onBlank = !backUrl.includes('/design-target/shell-next');
  let backLandedOn = 'about:blank / left the app';
  let listStillMounted = false;
  let stepsAfterBack: string | null = null;
  let scrollAfterBack: number | null = null;

  if (!onBlank) {
    listStillMounted = (await page.getByTestId('wsf-shell-next-page-community').count()) > 0;
    const listVisible = listStillMounted
      ? await page.getByTestId('wsf-shell-next-page-community').isVisible()
      : false;
    backLandedOn = listVisible ? 'the Community list' : new URL(backUrl).pathname;
    if (listVisible) {
      stepsAfterBack = await page.getByTestId('wsf-shell-next-steps-community').textContent();
      scrollAfterBack = await page
        .getByTestId('wsf-shell-next-scroll-community')
        .evaluate((el) => Math.round(el.scrollTop));
    }
  }

  const added = historyAfter - historyBefore;
  const verdict: Outcome['verdict'] =
    litOnDetail !== 'home'
      ? 'WRONG TAB ON DETAIL'
      : onBlank
        ? 'BACK LEFT THE APP'
        : added < 1
          ? 'NO BACK ENTRY'
          : 'REAL BACK DESTINATION';

  void scrollBefore;
  return {
    method: label,
    historyBefore,
    historyAfter,
    added,
    litOnDetail,
    urlOnDetail,
    backLandedOn,
    backUrl: onBlank ? 'left the app' : new URL(backUrl).pathname,
    listStillMounted,
    stepsAfterBack,
    scrollAfterBack,
    verdict,
  };
}

const METHODS: { testId: string; label: string }[] = [
  { testId: 'wsf-shell-next-nav-link-default', label: '1 Link (default)' },
  { testId: 'wsf-shell-next-nav-link-push', label: '2 Link push' },
  { testId: 'wsf-shell-next-nav-router-push', label: '3 router.push' },
  { testId: 'wsf-shell-next-nav-router-navigate', label: '4 router.navigate' },
  { testId: 'wsf-shell-next-nav-parent-navigate', label: '5 parent.navigate' },
];

test('the whole table: every navigation across the tab boundary, measured', async ({ browser }) => {
  test.setTimeout(300_000);

  const outcomes: Outcome[] = [];
  for (const m of METHODS) {
    outcomes.push(await measureMethod(browser, m.testId, m.label));
  }

  // eslint-disable-next-line no-console
  console.log(`[W9 SPIKE] cross-tab navigation table\n${outcomes
    .map(
      (o) =>
        `  ${o.method.padEnd(20)} history ${o.historyBefore}->${o.historyAfter} (+${o.added})  ` +
        `lit=${o.litOnDetail}  back=${o.backLandedOn}  steps=${o.stepsAfterBack ?? '-'}  ` +
        `scroll=${o.scrollAfterBack ?? '-'}  => ${o.verdict}`,
    )
    .join('\n')}`);

  /*
    THE SPIKE'S OWN PASS CONDITION. At least one method must give a real back
    destination, and it must also keep the detail resolving as Home. If none
    does, this fails and the table above IS the evidence the Director asked to
    be returned rather than a silent switch to the minimum-change path.
  */
  const winners = outcomes.filter((o) => o.verdict === 'REAL BACK DESTINATION');
  expect(
    winners.length,
    `no navigation across the tab boundary produced a back destination — table:\n${JSON.stringify(outcomes, null, 2)}`,
  ).toBeGreaterThan(0);

  // And the winner must land back on the list itself, not merely somewhere.
  for (const w of winners) {
    expect(w.backLandedOn, `${w.method}: back did not land on the Community list`).toBe('the Community list');
    expect(w.stepsAfterBack, `${w.method}: the list lost the state the member changed`).toBe('2');
    expect(w.scrollAfterBack ?? 0, `${w.method}: the list lost its scroll position`).toBeGreaterThan(150);
  }

  /*
    AND THE ONE THE PROTOTYPE SHIPS MUST BE AMONG THEM. A table where some
    other method works is not a fix; the control a member actually presses is
    a plain `Link`, so that row is named rather than left to be inferred.
  */
  const shipped = outcomes.find((o) => o.method.includes('Link (default)'))!;
  expect(
    shipped.verdict,
    `the navigation the list actually ships is not the fixed one: ${JSON.stringify(shipped, null, 2)}`,
  ).toBe('REAL BACK DESTINATION');
});

test('the five properties, together, on the navigation the prototype ships', async ({ page }) => {
  test.setTimeout(240_000);
  await phone(page);

  /* ---- 1 · visible URLs and cold deep links unchanged ---------------- */
  for (const [url, pageId] of [
    [BASE, 'home'],
    [LIST, 'community'],
    [`${DETAIL_PATH}?groupId=demo-group`, 'community-detail'],
    [`${BASE}/activity`, 'activity'],
    [`${BASE}/you`, 'you'],
  ] as const) {
    await page.goto(url);
    await page.getByTestId(`wsf-shell-next-page-${pageId}`).waitFor({ state: 'visible', timeout: 30_000 });
    const path = new URL(page.url()).pathname;
    expect(path, `${url}: a group segment leaked into the URL`).not.toContain('(');
    expect(path, `${url}: the URL changed shape on a cold load`).toBe(new URL(url, 'http://x').pathname);
  }

  /* ---- 2 · the detail resolves as Home, with Home selected ----------- */
  await page.goto(`${DETAIL_PATH}?groupId=demo-group`);
  await page.getByTestId('wsf-shell-next-page-community-detail').waitFor({ state: 'visible' });
  expect(await litTab(page), 'the detail did not resolve as Home on a cold load').toBe('home');

  /* ---- 3 · Community-list -> detail creates a real back destination -- */
  await page.goto(LIST);
  await page.getByTestId('wsf-shell-next-page-community').waitFor({ state: 'visible' });
  expect(await litTab(page)).toBe('community');
  await dirtyTheList(page);

  /*
    THE BASELINE IS READ, NOT ASSUMED TO BE 1 — for the second time in this
    packet, and it is the same lesson as checkpoint 1. A cold `goto` mounts the
    route TWICE: the static export renders it into the HTML and React mounts it
    again on hydration. An earlier revision of this line hard-coded `toBe(1)`
    and failed on a list that had not been rebuilt at all. What is being
    claimed is that going to the detail and coming back costs NOTHING MORE, so
    that is what is measured.
  */
  const communityMountsOnList = (await probe(page)).mounts.community;

  const historyOnList = await page.evaluate(() => history.length);
  await page.getByTestId('wsf-shell-next-community-to-group').click();
  await page.getByTestId('wsf-shell-next-page-community-detail').waitFor({ state: 'visible' });
  const historyOnDetail = await page.evaluate(() => history.length);

  /*
    THE FAILING-WHEN-FIXED ASSERTION FROM CHECKPOINT 1, INVERTED AND KEPT.
    It read `toBe(historyOnList)` and documented the defect. It is not deleted
    to make the suite green — it is turned around, so the same line now pins
    the fix and would fail again the moment the entry stops being created.
  */
  // eslint-disable-next-line no-console
  console.log(`[W9 SPIKE] shipped navigation history: ${historyOnList} -> ${historyOnDetail}`);
  expect(
    historyOnDetail,
    'the cross-tab navigation still does not create a back destination',
  ).toBeGreaterThan(historyOnList);

  // Still the right tab, still the right URL.
  expect(await litTab(page), 'the detail stopped resolving as Home').toBe('home');
  expect(new URL(page.url()).pathname).toBe(DETAIL_PATH);

  /* ---- 4 · Back returns to the still-mounted list, state intact ------ */
  await page.goBack();
  await page.getByTestId('wsf-shell-next-page-community').waitFor({ state: 'visible', timeout: 15_000 });
  expect(new URL(page.url()).pathname, 'Back did not return to the Community list').toBe(LIST);
  expect(await litTab(page), 'Back returned to the list but Community is not lit').toBe('community');

  const after = await probe(page);
  expect(after.mounts.community, 'the Community list was rebuilt rather than returned to').toBe(
    communityMountsOnList,
  );
  expect(
    await page.getByTestId('wsf-shell-next-steps-community').textContent(),
    'the list lost the state the member changed',
  ).toBe('2');
  const scrollBack = await page
    .getByTestId('wsf-shell-next-scroll-community')
    .evaluate((el) => Math.round(el.scrollTop));
  expect(scrollBack, 'the list lost its scroll position').toBeGreaterThan(150);

  /* ---- 5 · no duplicate router, no fake screen background ------------ */
  /*
    ONE ROUTER. A second navigation system beside the first is explicitly
    forbidden, and it would show up as a second tab bar or a second top bar in
    the document — the shape a "keep both alive" workaround actually takes.
  */
  expect(await page.getByTestId('wsf-shell-next-tabs').count(), 'more than one tab bar is rendered').toBe(1);
  expect(await page.getByTestId('wsf-shell-next-topbar').count(), 'more than one top bar is rendered').toBe(1);
  expect(
    await page.getByTestId('wsf-member-tabs').count(),
    'the production shell is rendering beside the prototype — two navigation systems',
  ).toBe(0);

  /*
    NO FAKE BACKGROUND. The MOVE sheet's context must be the live tab, not an
    image of it. `elementsFromPoint` returns what the browser would really hit,
    and an <img> or a background-image standing in for the screen would not
    carry the page's own testID.
  */
  await page.getByTestId('wsf-shell-next-tab-move').click();
  await page.getByTestId('wsf-shell-next-move-sheet').waitFor({ state: 'visible' });
  const painted = await page.evaluate(() => {
    const stack = document.elementsFromPoint(195, 180);
    return {
      live: stack.some((el) => el.closest('[data-testid="wsf-shell-next-page-community"]') !== null),
      images: stack.filter((el) => el.tagName === 'IMG').length,
    };
  });
  expect(painted.live, 'the sheet is over a blank or faked ground, not the live tab').toBe(true);
  await page.getByTestId('wsf-shell-next-move-close').click();
  await page.getByTestId('wsf-shell-next-page-community').waitFor({ state: 'visible' });
});

test('the hamburger and the sheet Close are each a measured 44x44 target', async ({ page }) => {
  test.setTimeout(120_000);
  await phone(page);
  await page.goto(BASE);
  await page.getByTestId('wsf-shell-next-topbar').waitFor({ state: 'visible', timeout: 30_000 });

  /*
    THE TARGET, NOT THE GLYPH. The Director's requirement is explicitly that
    the hit target is >= 44x44 "even when the visible glyph/text is smaller" —
    so the pressable's own box is measured, and the three-rule hamburger inside
    it is allowed to be 20 wide.
  */
  const burger = (await page.getByTestId('wsf-shell-next-menu-button').boundingBox())!;
  expect(Math.round(burger.width), 'the hamburger hit target is under 44 wide').toBeGreaterThanOrEqual(44);
  expect(Math.round(burger.height), 'the hamburger hit target is under 44 tall').toBeGreaterThanOrEqual(44);

  await page.getByTestId('wsf-shell-next-tab-move').click();
  await page.getByTestId('wsf-shell-next-move-sheet').waitFor({ state: 'visible' });
  const close = (await page.getByTestId('wsf-shell-next-move-close').boundingBox())!;
  expect(Math.round(close.width), "the sheet's Close hit target is under 44 wide").toBeGreaterThanOrEqual(44);
  expect(Math.round(close.height), "the sheet's Close hit target is under 44 tall").toBeGreaterThanOrEqual(44);
});
