import path from 'node:path';

import { test, type Browser } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';

/**
 * Captures Atlas Batch G — the follow-along on its own route — from the gated
 * preview route. TARGETS, not screenshots of a member surface.
 */
const OUT = path.resolve(__dirname, '../../../docs/design-target/review/batch-g-follow-along');

test.skip(
  !CAPTURE_FRAMES,
  'Accepted frames are evidence; set WSF_CAPTURE_FRAMES=1 to regenerate them.',
);

const STATES = [
  'ready',
  'countdown',
  'round',
  'paused',
  'finished',
  'loading',
  'unavailable',
] as const;

const LAYOUTS = ['390x844', '1280x800'] as const;

test('Atlas Batch G renders seven states on both layouts, plus its contact sheet', async ({
  browser,
}: {
  browser: Browser;
}) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext({
    viewport: { width: 1700, height: 4200 },
    deviceScaleFactor: 2,
  });
  try {
    const page = await ctx.newPage();
    await page.goto('/design-target/follow-along');
    await page
      .getByTestId('wsf-target-follow-along-batch')
      .waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(2000);

    await page
      .getByTestId('wsf-contact-batch-g')
      .screenshot({ path: path.join(OUT, 'CONTACT-SHEET-batch-g.png') });

    for (const layout of LAYOUTS) {
      for (const id of STATES) {
        const frame = page.getByTestId(`wsf-frame-g-${id}-${layout}`);
        await frame.screenshot({ path: path.join(OUT, `TARGET-${id}-${layout}.png`) });

        // The route is a ScrollView at BOTH widths, so where a state runs
        // past the frame there is a real end to show. Same element, same
        // size, different scroll offset.
        const scrolled = await frame.evaluate((el: Element) => {
          let moved = false;
          Array.from(el.querySelectorAll('*')).forEach((n) => {
            const node = n as HTMLElement;
            if (node.scrollHeight > node.clientHeight + 4) {
              node.scrollTop = node.scrollHeight;
              moved = true;
            }
          });
          return moved;
        });
        if (scrolled) {
          await page.waitForTimeout(120);
          await frame.screenshot({ path: path.join(OUT, `TARGET-${id}-${layout}-end.png`) });
          await frame.evaluate((el: Element) => {
            Array.from(el.querySelectorAll('*')).forEach((n) => {
              (n as HTMLElement).scrollTop = 0;
            });
          });
        }
      }
    }
  } finally {
    await ctx.close();
  }
});
