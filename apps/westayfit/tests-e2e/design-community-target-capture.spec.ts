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
