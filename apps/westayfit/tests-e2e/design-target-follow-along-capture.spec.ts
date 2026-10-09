import path from 'node:path';

import { expect, test, type Browser } from '@playwright/test';

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

/**
 * THE STRIP IS PROVED, NOT ASSUMED.
 *
 * Every frame carries "TARGET / CONCEPT — NOT IMPLEMENTED" inside it. That was
 * true and unasserted, and twice a review reported it missing — both times the
 * file without a strip turned out to be the package's contact sheet, which is
 * a card of frames rather than a frame. The sheets carry the label now too, so
 * no file in a package is without one, and this makes the frames' own strips
 * mechanical rather than arguable.
 *
 * Checked immediately before each shutter: visible, the exact words, spanning
 * the frame, computing to the concept green, and wholly inside the frame.
 */
async function assertStrip(
  page: import('@playwright/test').Page,
  frameId: string,
  bannerId: string,
): Promise<void> {
  const frame = page.getByTestId(frameId);
  const banner = page.getByTestId(bannerId);
  await expect(banner, `${frameId}: the in-frame label is missing`).toBeVisible();
  await expect(banner, `${frameId}: the label does not say what the frame is`).toHaveText(
    'TARGET / CONCEPT — NOT IMPLEMENTED',
  );
  const bg = await banner.evaluate((el: Element) => getComputedStyle(el).backgroundColor);
  expect(bg, `${frameId}: the strip is not the concept green`).toBe('rgb(34, 197, 94)');
  const fb = (await frame.boundingBox())!;
  const bb = (await banner.boundingBox())!;
  expect(bb.y, `${frameId}: the strip starts above the frame`).toBeGreaterThanOrEqual(fb.y - 1);
  expect(bb.y + bb.height, `${frameId}: the strip runs past the frame`).toBeLessThanOrEqual(
    fb.y + fb.height + 1,
  );
  /*
    THE FRAME HAS A 1px BORDER, so the strip spans the frame's INNER width —
    388 of an outer 390. Asserting exact equality with the outer width failed
    on every frame in every batch, which is the assertion being wrong rather
    than the strips. The border is the only allowed difference.
  */
  const FRAME_BORDER = 1;
  expect(
    Math.round(bb.width),
    `${frameId}: the strip does not span the frame's inner width`,
  ).toBe(Math.round(fb.width) - FRAME_BORDER * 2);
}

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
        await assertStrip(page, `wsf-frame-g-${id}-${layout}`, `wsf-frame-banner-g-${id}-${layout}`);
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
