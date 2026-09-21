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

      /*
        EVERY FRAME IS THE TOP OF ITS STATE.

        A frame captured mid-scroll is evidence of a screen nobody arrives at:
        the concept strip, the wordmark and the heading are the first things
        cut, and they are exactly what tells a reader this is a target rather
        than a shipped page. Asserted rather than eyeballed — twice now a
        claim about what a committed frame does or does not carry has come
        down to somebody's reading of a PNG.
      */
      const top = await frame.evaluate((el: Element) => {
        const stuck: number[] = [];
        el.querySelectorAll('*').forEach((n) => {
          if (n instanceof HTMLElement && n.scrollTop > 0) stuck.push(n.scrollTop);
        });
        const text = (el as HTMLElement).innerText ?? '';
        return { stuck, hasWordmark: text.includes('WE STAY FIT'), hasH1: text.includes('Your progress') };
      });
      expect(top.stuck, `${id}: a scroll container inside the frame is not at its top`).toEqual([]);
      expect(top.hasWordmark, `${id}: the wordmark is not in the frame`).toBe(true);
      expect(top.hasH1, `${id}: the heading is not in the frame`).toBe(true);

      // And the chrome is where arrival puts it: strip, then wordmark, then H1.
      // Exact: the failure state's sentence also begins "Your progress".
      const wordmark = (await frame.getByText('WE STAY FIT', { exact: true }).boundingBox())!;
      const heading = (await frame.getByText('Your progress', { exact: true }).boundingBox())!;
      expect(wordmark.y, `${id}: the wordmark sits above the frame`).toBeGreaterThanOrEqual(box.y);
      expect(
        Math.round(wordmark.y - (bannerBox.y + bannerBox.height)),
        `${id}: the wordmark is not just under the concept strip`,
      ).toBeLessThan(40);
      expect(heading.y, `${id}: the heading is above the wordmark`).toBeGreaterThan(wordmark.y);

      await frame.screenshot({ path: path.join(OUT, `TARGET-${id}.png`) });
    }

    await page.screenshot({ path: path.join(OUT, 'TARGET-contact-sheet.png'), fullPage: true });
  } finally {
    await ctx.close();
  }
});
