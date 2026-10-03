import path from 'node:path';

import { expect, test, type Browser } from '@playwright/test';

/**
 * Captures the COMMUNITY-PRESENCE proposals from the gated preview route.
 *
 * These are PROPOSALS — drawings of where these screens could go, rendered
 * from real components against the real kit so they cannot promise something
 * the product could not build. They are NOT screenshots of a member surface,
 * they are NOT accepted, and none of them is an AFTER. Every frame carries its
 * own "PROPOSED — NOT ACCEPTED" strip INSIDE the captured element, so a frame
 * that circulates on its own still says what it is.
 */
const OUT = path.resolve(
  __dirname,
  '../../../docs/design-target/review/community-presence',
);

/*
  OPT-IN. This renders eleven phone-sized frames in one context and its product
  is PNGs in docs/, not an assertion about the product. Set
  WSF_CAPTURE_FRAMES=1 to regenerate them deliberately. Without it this spec
  skips and writes zero bytes, which the package README records as measured
  rather than asserted.
*/
const CAPTURE_FRAMES = /^(1|true)$/i.test(process.env.WSF_CAPTURE_FRAMES ?? '');

test.skip(
  !CAPTURE_FRAMES,
  'Frame capture is evidence generation; set WSF_CAPTURE_FRAMES=1 to regenerate it.',
);

/** Every frame the preview route publishes, by testID suffix. */
const FRAMES = [
  'community-inhabited-390x844',
  'community-inhabited-390x640',
  'community-quiettoday-390x844',
  'community-allprivate-390x844',
  'community-small-390x640',
  'members-people-390x844',
  'members-people-390x640',
  'members-allprivate-390x844',
  'settings-privacy-390x844',
  'settings-privacy-390x640',
  'you-settings-entry-390x844',
];

/** The banner strip added on top of each frame's device height. */
const FRAME_BANNER = 18;
/** The frame's own hairline. The strip sits inside it, not on top of it. */
const FRAME_BORDER = 1;
/** The exact words the strip must carry. */
const STRIP = 'PROPOSED — NOT ACCEPTED';

test('community-presence proposals render at every device class the packet asks for', async ({
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
    await page.goto('/design-target/community-presence');
    await page
      .getByTestId('wsf-target-community-presence-sheet')
      .waitFor({ state: 'visible', timeout: 30_000 });
    // The Living WE is an image; let every instance decode before the shutter.
    await page.waitForTimeout(1500);

    for (const id of FRAMES) {
      const frame = page.getByTestId(`wsf-frame-${id}`);
      await expect(frame, `${id} is not rendered`).toBeVisible();

      /*
        THE FRAME MUST BE THE DEVICE IT CLAIMS TO BE. The id ends in the device
        class, so the box is checked against it rather than trusted: a frame
        captured at the wrong size is evidence of a screen nobody will ever
        see, and the label would still read 390x844.
      */
      const [, w, h] = /(\d+)x(\d+)$/.exec(id)!;
      const box = (await frame.boundingBox())!;
      expect(Math.round(box.width), `${id}: wrong frame width`).toBe(Number(w));
      expect(Math.round(box.height), `${id}: wrong frame height`).toBe(
        Number(h) + FRAME_BANNER,
      );

      /*
        THE LABEL IS ASSERTED, NOT ASSUMED. "I can see it in the PNG" is not a
        check that survives the next capture. The strip must exist, say the
        words, sit flush with the frame's own top edge, and span its full
        width. The STRIP is measured, not the text node inside it: the text
        sits at its own line-height offset and is narrower than the frame, so
        asserting its box would measure the wrong thing.
      */
      const banner = page.getByTestId(`wsf-frame-banner-${id}`);
      await expect(banner, `${id}: the in-frame label is missing`).toBeVisible();
      await expect(
        banner,
        `${id}: the label does not say the frame is unaccepted`,
      ).toHaveText(STRIP);
      const bannerBox = (await banner.boundingBox())!;
      expect(
        Math.round(bannerBox.y - box.y),
        `${id}: the label is not flush with the frame top`,
      ).toBe(FRAME_BORDER);
      expect(Math.round(bannerBox.width), `${id}: the label does not span the frame`).toBe(
        Number(w) - 2 * FRAME_BORDER,
      );

      await frame.screenshot({ path: path.join(OUT, `PROPOSED-${id}.png`) });
    }

    // The contact sheet: every proposal in one image, for the review that needs
    // to see them beside each other rather than one at a time.
    await page.screenshot({
      path: path.join(OUT, 'PROPOSED-contact-sheet.png'),
      fullPage: true,
    });
  } finally {
    await ctx.close();
  }
});
