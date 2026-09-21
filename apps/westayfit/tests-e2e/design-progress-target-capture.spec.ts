import path from 'node:path';

import { expect, test, type Browser } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';

/**
 * Captures the PROGRESS targets from the gated preview route.
 *
 * TARGETS, not screenshots of a member surface: every frame carries its own
 * "TARGET / CONCEPT — NOT IMPLEMENTED" strip INSIDE the captured element, and
 * the capture asserts the strip is there rather than trusting that it is.
 */
const OUT = path.resolve(__dirname, '../../../docs/design-target/review/page-04-progress');

/* Opt-in: this spec's product is PNGs in docs/, not an assertion about the
   product. Set WSF_CAPTURE_FRAMES=1 to regenerate them deliberately. */
test.skip(
  !CAPTURE_FRAMES,
  'Frame capture is evidence generation; set WSF_CAPTURE_FRAMES=1 to regenerate it.',
);

const FRAMES = [
  'rows-390x844',
  'runningonly-390x844',
  'none-390x844',
  'loading-390x844',
  'failed-390x844',
  'rows-390x640',
  'none-390x640',
  'rows-430x932',
  'none-430x932',
];

const FRAME_BANNER = 18;
const FRAME_BORDER = 1;

test('progress targets render at every device class the gate asks for', async ({
  browser,
}: {
  browser: Browser;
}) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({
    viewport: { width: 1760, height: 1400 },
    deviceScaleFactor: 2,
  });
  try {
    const page = await ctx.newPage();
    await page.goto('/design-target/progress');
    await page.getByTestId('wsf-target-progress').waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(1500);

    for (const id of FRAMES) {
      const frame = page.getByTestId(`wsf-frame-${id}`);
      await expect(frame, `${id} is not rendered`).toBeVisible();

      // The frame must be the device it claims to be.
      const [, w, h] = /(\d+)x(\d+)$/.exec(id)!;
      const box = (await frame.boundingBox())!;
      expect(Math.round(box.width), `${id}: wrong frame width`).toBe(Number(w));
      expect(Math.round(box.height), `${id}: wrong frame height`).toBe(Number(h) + FRAME_BANNER);

      // And it must say what it is.
      const banner = page.getByTestId(`wsf-frame-banner-${id}`);
      await expect(banner, `${id}: the in-frame label is missing`).toBeVisible();
      await expect(banner, `${id}: the label does not say what the frame is`).toHaveText(
        'TARGET / CONCEPT — NOT IMPLEMENTED',
      );
      const bannerBox = (await banner.boundingBox())!;
      expect(
        Math.round(bannerBox.y - box.y),
        `${id}: the label is not flush with the frame top`,
      ).toBe(FRAME_BORDER);
      expect(Math.round(bannerBox.width), `${id}: the label does not span the frame`).toBe(
        Number(w) - 2 * FRAME_BORDER,
      );

      await frame.screenshot({ path: path.join(OUT, `TARGET-${id}.png`) });
    }

    await page.screenshot({ path: path.join(OUT, 'TARGET-contact-sheet.png'), fullPage: true });
  } finally {
    await ctx.close();
  }
});
