import path from 'node:path';

import { test, type Browser } from '@playwright/test';

/**
 * Captures the real-RN design targets at every device class the atlas asks
 * for. These are TARGETS -- drawings of where a page is going, rendered from
 * the real components so they cannot promise what the product could not build.
 * They are not screenshots of a member surface: the preview route they render
 * is gated off in any deployed artifact.
 *
 * The captures land in docs/design-target/targets/ and are committed, because
 * the point of a target is that somebody can look at it later.
 */
const OUT = path.resolve(__dirname, '../../../docs/design-target/targets');

const CLASSES = [
  { key: '390x844', width: 390, height: 844 },
  { key: '390x640', width: 390, height: 640 },
  { key: '430x932', width: 430, height: 932 },
];

test('design targets render at every device class the atlas requires', async ({
  browser,
}: {
  browser: Browser;
}) => {
  for (const c of CLASSES) {
    const ctx = await browser.newContext({
      viewport: { width: c.width, height: c.height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    try {
      const page = await ctx.newPage();
      await page.goto('/design-target/home');
      await page.getByTestId('wsf-target-home').waitFor({ state: 'visible', timeout: 30_000 });
      // The Living WE is an image; let it decode before the shutter.
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(OUT, `TARGET-home-${c.key}.png`) });
    } finally {
      await ctx.close();
    }
  }
});

test('the Home lifecycle state matrix renders every state in one frame', async ({
  browser,
}: {
  browser: Browser;
}) => {
  // Four cells across. Wide enough that each phone frame stays full size, which
  // is the point: a state matrix nobody can read is not evidence.
  const ctx = await browser.newContext({
    viewport: { width: 1688, height: 1200 },
    deviceScaleFactor: 1,
  });
  try {
    const page = await ctx.newPage();
    await page.goto('/design-target/home-states');
    const sheet = page.getByTestId('wsf-target-home-states');
    await sheet.waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(1200);
    await page.screenshot({
      path: path.join(OUT, 'TARGET-home-state-matrix.png'),
      fullPage: true,
    });
  } finally {
    await ctx.close();
  }
});

test('the MOVE-family targets render at their device classes', async ({
  browser,
}: {
  browser: Browser;
}) => {
  const OUT2 = path.resolve(__dirname, '../../../docs/design-target/review/page-02-move');
  const ctx = await browser.newContext({
    viewport: { width: 1688, height: 1200 },
    deviceScaleFactor: 2,
  });
  try {
    const page = await ctx.newPage();
    await page.goto('/design-target/move-flow');
    await page.getByTestId('wsf-target-move-flow').waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(1200);
    for (const [id, name] of [
      ['move-choose', 'TARGET-move-choose-390x844'],
      ['move-nogoal', 'TARGET-move-nogoal-390x844'],
      ['move-choose-short', 'TARGET-move-choose-390x640'],
      ['picker-one', 'TARGET-picker-one-390x844'],
      ['picker-many', 'TARGET-picker-many-390x844'],
      ['contribute', 'TARGET-contribute-390x844'],
      ['contribute-short', 'TARGET-contribute-390x640'],
      ['confirmed', 'TARGET-confirmed-390x844'],
      ['confirmed-short', 'TARGET-confirmed-390x640'],
    ] as const) {
      await page
        .getByTestId(`wsf-frame-${id}`)
        .screenshot({ path: path.join(OUT2, `${name}.png`) });
    }
  } finally {
    await ctx.close();
  }
});
