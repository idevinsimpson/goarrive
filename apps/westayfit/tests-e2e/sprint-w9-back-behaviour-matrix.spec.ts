import { test, expect, type Browser } from '@playwright/test';

/**
 * W9 — THE TRADE-OFF, MEASURED IN EVERY MODE.
 *
 * PROPOSED / NOT ACCEPTED. Prototype only.
 *
 * WHY THIS FILE EXISTS. Fixing the Back regression with the tab router's
 * `backBehavior` turned out to move a SECOND number: three tab switches, which
 * added one history entry before, now add two. That matters, because the
 * owner's own brief asks that switching primary tabs stack no history trail,
 * and the Director's five properties require that a community detail have a
 * real back destination. Those two pull in opposite directions through the
 * same mechanism — whether a tab change is an entry in browser history.
 *
 * So rather than pick a mode and describe the cost in prose, every mode the
 * router offers is driven and both numbers are read off the running build. The
 * table is the deliverable; the choice is the Director's.
 */

const BASE = '/design-target/shell-next';
const LIST = `${BASE}/community`;

const MODES = ['history', 'fullHistory', 'order', 'initialRoute', 'firstRoute', 'none'] as const;

type Row = {
  mode: string;
  /** Entries added by Community-list -> community detail. */
  detailEntries: number;
  /** Where the browser Back button lands from the detail. */
  backFromDetail: string;
  /** State and scroll on the list after Back, when it got there at all. */
  listStateAfterBack: string;
  /** Entries added by Home -> Community -> Progress -> Home. */
  tabSwitchEntries: number;
  /** Whether the detail still lights Home. */
  litOnDetail: string;
};

async function measure(browser: Browser, mode: string): Promise<Row> {
  const q = `?backBehavior=${mode}`;

  // --- the detail journey, in its own context so history starts clean ---
  const a = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pa = await a.newPage();
  let detailEntries = -1;
  let backFromDetail = 'unknown';
  let listStateAfterBack = 'unknown';
  let litOnDetail = 'unknown';
  try {
    await pa.goto(`${LIST}${q}`);
    await pa.getByTestId('wsf-shell-next-page-community').waitFor({ state: 'visible', timeout: 30_000 });
    await pa.getByTestId('wsf-shell-next-step-community').click();
    await pa.getByTestId('wsf-shell-next-step-community').click();
    await pa.getByTestId('wsf-shell-next-scroll-community').evaluate((el) => {
      el.scrollTop = 200;
    });
    await pa.waitForTimeout(150);

    const before = await pa.evaluate(() => history.length);
    await pa.getByTestId('wsf-shell-next-community-to-group').click();
    await pa.getByTestId('wsf-shell-next-page-community-detail').waitFor({ state: 'visible', timeout: 15_000 });
    detailEntries = (await pa.evaluate(() => history.length)) - before;

    const lit = pa.locator('[data-testid^="wsf-shell-next-tab-"][data-current="true"]');
    litOnDetail =
      (await lit.count()) === 1
        ? ((await lit.getAttribute('data-testid')) ?? '').replace('wsf-shell-next-tab-', '')
        : `${await lit.count()} tabs lit`;

    await pa.goBack();
    await pa.waitForTimeout(900);
    if (!pa.url().includes('/design-target/shell-next')) {
      backFromDetail = 'LEFT THE APP';
      listStateAfterBack = '-';
    } else {
      const listEl = pa.getByTestId('wsf-shell-next-page-community');
      const visible = (await listEl.count()) > 0 && (await listEl.isVisible());
      backFromDetail = visible ? 'the Community list' : new URL(pa.url()).pathname;
      if (visible) {
        const steps = await pa.getByTestId('wsf-shell-next-steps-community').textContent();
        const scroll = await pa
          .getByTestId('wsf-shell-next-scroll-community')
          .evaluate((el) => Math.round(el.scrollTop));
        listStateAfterBack = `steps=${steps} scroll=${scroll}`;
      } else {
        listStateAfterBack = '-';
      }
    }
  } finally {
    await a.close();
  }

  // --- the tab-switch trail, in its own context ---
  const b = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pb = await b.newPage();
  let tabSwitchEntries = -1;
  try {
    await pb.goto(`${BASE}${q}`);
    await pb.getByTestId('wsf-shell-next-page-home').waitFor({ state: 'visible', timeout: 30_000 });
    const before = await pb.evaluate(() => history.length);
    await pb.getByTestId('wsf-shell-next-tab-community').click();
    await pb.getByTestId('wsf-shell-next-page-community').waitFor({ state: 'visible' });
    await pb.getByTestId('wsf-shell-next-tab-activity').click();
    await pb.getByTestId('wsf-shell-next-page-activity').waitFor({ state: 'visible' });
    await pb.getByTestId('wsf-shell-next-tab-home').click();
    await pb.getByTestId('wsf-shell-next-page-home').waitFor({ state: 'visible' });
    tabSwitchEntries = (await pb.evaluate(() => history.length)) - before;
  } finally {
    await b.close();
  }

  return { mode, detailEntries, backFromDetail, listStateAfterBack, tabSwitchEntries, litOnDetail };
}

test('every backBehavior mode, and what each one costs', async ({ browser }) => {
  test.setTimeout(420_000);

  const rows: Row[] = [];
  for (const mode of MODES) {
    rows.push(await measure(browser, mode));
  }

  // eslint-disable-next-line no-console
  console.log(
    `[W9 MATRIX] backBehavior trade-off\n${rows
      .map(
        (r) =>
          `  ${r.mode.padEnd(13)} detail +${r.detailEntries}  back=${r.backFromDetail.padEnd(20)} ` +
          `${r.listStateAfterBack.padEnd(22)} lit=${r.litOnDetail.padEnd(10)} 3-tab-switches +${r.tabSwitchEntries}`,
      )
      .join('\n')}`,
  );

  /*
    THE SHAPE OF THE RESULT IS THE CLAIM, so it is asserted rather than just
    printed: there must be at least one mode that returns Back to the list, and
    the detail must light Home in EVERY mode (the tab a route belongs to is a
    property of the route tree, not of the back model — if that ever stops
    being true, the two concerns have become entangled and the note is wrong).
  */
  const working = rows.filter((r) => r.backFromDetail === 'the Community list');
  expect(
    working.length,
    `no backBehavior mode returned Back to the Community list:\n${JSON.stringify(rows, null, 2)}`,
  ).toBeGreaterThan(0);

  for (const r of rows) {
    expect(r.litOnDetail, `${r.mode}: the detail stopped resolving as Home`).toBe('home');
  }

  /*
    Every working mode must also bring the list back intact, not rebuilt.

    The scroll is asserted as a FLOOR, not an exact value: the list is scrolled
    to 200 but the browser clamps to the content's own maximum, which measured
    195 here. An earlier revision asserted `scroll=200` exactly and failed on a
    list that had preserved its position perfectly — the check was wrong, not
    the build.
  */
  for (const r of working) {
    const m = /^steps=(\d+) scroll=(\d+)$/.exec(r.listStateAfterBack);
    expect(m, `${r.mode}: the list came back without readable state (${r.listStateAfterBack})`).not.toBeNull();
    expect(m![1], `${r.mode}: the list lost the state the member changed`).toBe('2');
    expect(Number(m![2]), `${r.mode}: the list lost its scroll position`).toBeGreaterThan(150);
  }
});
