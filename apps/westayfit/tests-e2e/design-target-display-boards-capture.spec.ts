import path from 'node:path';

import { test, type Browser } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';

/**
 * Captures Atlas Batch F — the public display across four boards — from the
 * gated preview route. TARGETS, not screenshots of a member surface.
 */
const OUT = path.resolve(__dirname, '../../../docs/design-target/review/batch-f-public-display');

/*
  OPT-IN, for the reason every capture spec in this suite is: it asserts
  nothing about the product, and run in the ordinary suite it would rewrite
  accepted evidence on every verification pass.
*/
test.skip(
  !CAPTURE_FRAMES,
  'Accepted frames are evidence; set WSF_CAPTURE_FRAMES=1 to regenerate them.',
);

const STATES = [
  'zero',
  'building',
  'near',
  'reached-open',
  'closed-reached',
  'closed-unreached',
  'stale',
  'loading',
  'unreachable',
  'not-available',
] as const;

const BOARDS = ['390x844', '800x1280', '1280x800', '1920x1080'] as const;

test('Atlas Batch F renders ten states on four boards, plus its matrix sheet', async ({
  browser,
}: {
  browser: Browser;
}) => {
  test.setTimeout(900_000);
  const ctx = await browser.newContext({
    // Wide enough for a 1920 board plus its gutters, and tall enough that the
    // matrix sheet is painted before the shutter — an element screenshot
    // captures what is painted, not what is about to be.
    viewport: { width: 2400, height: 8000 },
    /*
      SCALE 1, NOT 2, AND ON PURPOSE. Every other batch captures at device
      scale 2 because a phone frame is small on a reviewer's monitor. These
      are already room-scale canvases: a 1920x1080 board at scale 2 is a
      3840x2160 PNG per state, forty of which is a repository nobody wants to
      clone. 1:1 is the board's own resolution and is what it will actually
      be driven at.
    */
    deviceScaleFactor: 1,
  });
  try {
    const page = await ctx.newPage();
    await page.goto('/design-target/display-boards');
    await page
      .getByTestId('wsf-target-display-boards-batch')
      .waitFor({ state: 'visible', timeout: 30_000 });
    // The wordmark is an image, and the Living WE is drawn per frame; let
    // everything decode before the shutter.
    await page.waitForTimeout(3000);

    await page
      .getByTestId('wsf-contact-batch-f')
      .screenshot({ path: path.join(OUT, 'MATRIX-batch-f.png') });

    for (const board of BOARDS) {
      for (const id of STATES) {
        await page
          .getByTestId(`wsf-frame-f-${id}-${board}`)
          .screenshot({ path: path.join(OUT, `TARGET-${id}-${board}.png`) });
      }
    }
    /*
      NO -end FRAMES. The display cannot scroll on any board: the wide canvas
      is a fixed two-column page and the narrow one is a single unscrollable
      card. Anything that did not fit would be clipped, not reachable, so a
      frame IS the whole screen.
    */
  } finally {
    await ctx.close();
  }
});
