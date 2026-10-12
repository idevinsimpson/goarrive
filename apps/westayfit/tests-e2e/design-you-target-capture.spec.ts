import path from 'node:path';

import { expect, test, type Browser } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';

/**
 * Captures the YOU targets from the gated preview route.
 *
 * TARGETS, not screenshots of a member surface: every frame carries its own
 * "TARGET / CONCEPT — NOT IMPLEMENTED" strip INSIDE the captured element, and
 * the capture asserts the strip is there rather than trusting that it is.
 */
const OUT = path.resolve(__dirname, '../../../docs/design-target/review/page-05-you');

/* Opt-in: this spec's product is PNGs in docs/, not an assertion about the
   product. Set WSF_CAPTURE_FRAMES=1 to regenerate them deliberately. */
test.skip(
  !CAPTURE_FRAMES,
  'Frame capture is evidence generation; set WSF_CAPTURE_FRAMES=1 to regenerate it.',
);

/**
 * THE FULL MATRIX, DERIVED — not a hand-listed subset.
 *
 * This list previously named ten frames while the page rendered a different
 * set, so the states added at a new device class were simply never captured
 * and the package looked complete at ten files. Deriving it from the same two
 * axes the page uses means a state added to one is captured at all three.
 */
const STATES = ['member', 'nocommunity', 'loading', 'failed', 'signedout'] as const;
const CLASSES = ['390x844', '390x640', '430x932'] as const;
const FRAMES = CLASSES.flatMap((c) => STATES.map((st) => `${st}-${c}`));

const FRAME_BANNER = 18;
const FRAME_BORDER = 1;

test('you targets render at every device class the gate asks for', async ({
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
    await page.goto('/design-target/you');
    await page.getByTestId('wsf-target-you').waitFor({ state: 'visible', timeout: 30_000 });
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
      /*
        THE STRIP IS GREEN, AND IT IS INSIDE THE FRAME.

        The assertion already required the label to be visible, to say the
        right words and to span the frame's width. It did NOT require that it
        actually renders as the concept strip — so a label that had lost its
        background, or sat outside the captured element, would still have
        passed while the committed PNG showed no strip at all.

        Whether that ever happened here is answerable either way now: the
        computed background must be the concept green and the box must sit
        wholly inside the frame on all four edges, checked immediately before
        the shutter on every state at every class.
      */
      const bg = await banner.evaluate((el: Element) => getComputedStyle(el).backgroundColor);
      expect(bg, `${id}: the concept strip is not the concept green`).toBe('rgb(34, 197, 94)');

      const bannerBox = (await banner.boundingBox())!;
      expect(bannerBox.y, `${id}: the strip starts above the frame`).toBeGreaterThanOrEqual(box.y - 1);
      expect(
        bannerBox.y + bannerBox.height,
        `${id}: the strip runs past the frame`,
      ).toBeLessThanOrEqual(box.y + box.height + 1);
      expect(bannerBox.x, `${id}: the strip starts left of the frame`).toBeGreaterThanOrEqual(box.x - 1);
      expect(
        bannerBox.x + bannerBox.width,
        `${id}: the strip runs past the frame's right edge`,
      ).toBeLessThanOrEqual(box.x + box.width + 1);
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
        return { stuck };
      });
      expect(top.stuck, `${id}: a scroll container inside the frame is not at its top`).toEqual([]);

      /*
        THE REAL WORDMARK, ASSERTED AS THE REAL WORDMARK.

        This used to look for the literal text "WE STAY FIT", which passed
        only because the target drew the letters itself. `/you` renders
        `WsfWordmark` — an Image with accessibilityLabel "We Stay Fit" — so
        the target does too, and the assertion follows the component rather
        than a string a drawing happened to contain. A check that can only
        pass against a hand-lettered stand-in is a check that would have gone
        green on the wrong thing.
      */
      const wordmark = (await frame.getByLabel('We Stay Fit').first().boundingBox())!;
      expect(wordmark, `${id}: the real wordmark is not in the frame`).toBeTruthy();
      expect(wordmark.y, `${id}: the wordmark sits above the frame`).toBeGreaterThanOrEqual(box.y);
      expect(
        Math.round(wordmark.y - (bannerBox.y + bannerBox.height)),
        `${id}: the wordmark is not just under the concept strip`,
      ).toBeLessThan(48);

      // The persistent shell is present and wholly inside the frame. The bar
      // sits outside the scroll area now, as the real shell's does.
      const tabs = (await frame.getByText('Progress', { exact: true }).first().boundingBox())!;
      expect(tabs.y, `${id}: the member tab bar is not in the frame`).toBeGreaterThan(wordmark.y);
      expect(
        tabs.y + tabs.height,
        `${id}: the member tab bar runs past the frame`,
      ).toBeLessThanOrEqual(box.y + box.height + 1);

      await frame.screenshot({ path: path.join(OUT, `TARGET-${id}.png`) });
    }

    await page.screenshot({ path: path.join(OUT, 'TARGET-contact-sheet.png'), fullPage: true });
  } finally {
    await ctx.close();
  }
});
