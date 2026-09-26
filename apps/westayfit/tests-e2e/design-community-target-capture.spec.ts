import path from 'node:path';

import { expect, test, type Browser } from '@playwright/test';

/**
 * Captures the COMMUNITY targets from the gated preview route.
 *
 * These are TARGETS — drawings of where the page is going, rendered from the
 * real components against the real kit so they cannot promise something the
 * product could not build. They are NOT screenshots of a member surface, and
 * every frame carries its own "TARGET / CONCEPT — NOT IMPLEMENTED" strip
 * INSIDE the captured element, so a frame that circulates on its own still
 * says what it is.
 */
const OUT = path.resolve(__dirname, '../../../docs/design-target/review/page-03-community');

/*
  OPT-IN. Same reason as the AFTER capture: this renders 23 phone-sized frames
  in one context and its product is PNGs in docs/, not an assertion about the
  product. Set WSF_CAPTURE_FRAMES=1 to regenerate them deliberately.
*/
const CAPTURE_FRAMES = /^(1|true)$/i.test(process.env.WSF_CAPTURE_FRAMES ?? '');

test.skip(
  !CAPTURE_FRAMES,
  'Frame capture is evidence generation; set WSF_CAPTURE_FRAMES=1 to regenerate it.',
);

/** Every frame the preview route publishes, by testID suffix. */
const FRAMES = [
  'list-several-390x844',
  'list-severalnocurrent-390x844',
  'list-severalnocurrent-390x640',
  'list-one-390x640',
  'list-none-390x640',
  'list-one-390x844',
  'list-none-390x844',
  'list-loading-390x844',
  'list-failed-390x844',
  'list-several-390x640',
  'list-several-430x932',
  'detail-active-390x844',
  'detail-nogoal-390x844',
  'detail-history-390x844',
  'detail-switch-390x844',
  'detail-loading-390x844',
  'detail-failed-390x844',
  'detail-active-390x640',
  'detail-nogoal-390x640',
  'detail-history-390x640',
  'detail-active-430x932',
  'detail-nogoal-430x932',
  'detail-history-430x932',
];

/** The banner strip added on top of each frame's device height. */
const FRAME_BANNER = 18;
/** The frame's own hairline. The strip sits inside it, not on top of it. */
const FRAME_BORDER = 1;

test('community targets render at every device class the gate asks for', async ({
  browser,
}: {
  browser: Browser;
}) => {
  test.setTimeout(240_000);
  // Wide enough that every frame lays out at full size; the frames are
  // captured individually, so this viewport is only the easel.
  const ctx = await browser.newContext({
    viewport: { width: 1760, height: 1400 },
    deviceScaleFactor: 2,
  });
  try {
    const page = await ctx.newPage();
    await page.goto('/design-target/community');
    await page.getByTestId('wsf-target-community').waitFor({ state: 'visible', timeout: 30_000 });
    // The Living WE is an image; let every instance decode before the shutter.
    await page.waitForTimeout(1500);

    for (const id of FRAMES) {
      const frame = page.getByTestId(`wsf-frame-${id}`);
      await expect(frame, `${id} is not rendered`).toBeVisible();

      /*
        THE FRAME MUST BE THE DEVICE IT CLAIMS TO BE. The id ends in the
        device class, so the box is checked against it rather than trusted:
        a frame captured at the wrong size is evidence of a screen nobody
        will ever see, and the label would still read 390x844.
      */
      const [, w, h] = /(\d+)x(\d+)$/.exec(id)!;
      const box = (await frame.boundingBox())!;
      expect(Math.round(box.width), `${id}: wrong frame width`).toBe(Number(w));
      expect(Math.round(box.height), `${id}: wrong frame height`).toBe(
        Number(h) + FRAME_BANNER,
      );

      /*
        `/community/[groupId]` IS HOME — `/` replaces to it (app/index.tsx),
        and it is Page 1, already targeted and accepted. Frames for it are
        therefore a PROPOSAL against an accepted page, not Community's own
        target, and they are named so nobody has to read a README to know
        the difference. Community's own route is `/community`, the list.
      */
      /*
        THE LABEL IS ASSERTED, NOT ASSUMED. A target frame that circulates
        without its strip is one paste away from being read as a shipped
        screen, and "I can see it in the PNG" is not a check that survives the
        next capture. The strip must exist, sit flush with the frame's own top
        edge, and span its full width.
      */
      // The STRIP, not the text inside it: the text node sits at its own
      // line-height offset within the strip and is narrower than the frame,
      // so asserting its box would be measuring the wrong thing — the same
      // mistake as the y<24 wordmark threshold on Page 2.
      const banner = page.getByTestId(`wsf-frame-banner-${id}`);
      await expect(banner, `${id}: the in-frame label is missing`).toBeVisible();
      await expect(
        banner,
        `${id}: the label does not say what the frame is`,
      ).toHaveText('TARGET / CONCEPT — NOT IMPLEMENTED');
      const bannerBox = (await banner.boundingBox())!;
      expect(
        Math.round(bannerBox.y - box.y),
        `${id}: the label is not flush with the frame top`,
      ).toBe(FRAME_BORDER);
      expect(Math.round(bannerBox.width), `${id}: the label does not span the frame`).toBe(
        Number(w) - 2 * FRAME_BORDER,
      );

      const prefix = id.startsWith('detail-') ? 'PROPOSAL' : 'TARGET';
      await frame.screenshot({ path: path.join(OUT, `${prefix}-${id}.png`) });
    }

    // The contact sheet: every state in one image, for the review that needs
    // to see them beside each other rather than one at a time.
    await page.screenshot({
      path: path.join(OUT, 'TARGET-contact-sheet.png'),
      fullPage: true,
    });
  } finally {
    await ctx.close();
  }
});
