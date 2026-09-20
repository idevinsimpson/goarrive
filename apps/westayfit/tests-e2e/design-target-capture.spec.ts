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
