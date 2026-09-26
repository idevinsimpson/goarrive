import path from 'node:path';

import { test, type Browser } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';

/** Captures the physical-flow board. A TARGET, not a screenshot of a surface. */
const OUT = path.resolve(__dirname, '../../../docs/design-target/review/physical-flow');

test.skip(
  !CAPTURE_FRAMES,
  'Accepted frames are evidence; set WSF_CAPTURE_FRAMES=1 to regenerate them.',
);

test('the physical-flow board renders at 1920x1080', async ({ browser }: { browser: Browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext({
    viewport: { width: 2100, height: 1400 },
    deviceScaleFactor: 1,
  });
  try {
    const page = await ctx.newPage();
    await page.goto('/design-target/physical-flow');
    await page
      .getByTestId('wsf-target-physical-flow-batch')
      .waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(2000);
    await page
      .getByTestId('wsf-frame-flow-board-1920x1080')
      .screenshot({ path: path.join(OUT, 'TARGET-physical-flow-1920x1080.png') });
  } finally {
    await ctx.close();
  }
});
