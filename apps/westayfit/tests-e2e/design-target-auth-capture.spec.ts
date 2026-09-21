import path from 'node:path';

import { test, type Browser } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';

/**
 * Captures Atlas Batch A — identity and onboarding — from the gated preview
 * route. TARGETS, not screenshots of a member surface.
 */
const OUT = path.resolve(__dirname, '../../../docs/design-target/review/batch-a-identity');


/*
  OPT-IN. This spec asserts nothing — its whole product is the Batch A identity target frames
  in docs/, which a review has already accepted. Run in the ordinary suite it
  rewrote them on every verification pass. Nothing is lost by skipping it and
  an accepted frame stops drifting underneath the decision that approved it.

  Set WSF_CAPTURE_FRAMES=1 to regenerate deliberately.
*/
test.skip(
  !CAPTURE_FRAMES,
  'Accepted frames are evidence; set WSF_CAPTURE_FRAMES=1 to regenerate them.',
);
const SCREENS = [
  'signin',
  'signup',
  'verify',
  'reset',
  'profile',
  'error',
  'return-join',
  'return-event',
] as const;

const CLASSES = ['390x844', '390x640'] as const;

test('Atlas Batch A renders at both phone classes, plus its contact sheet', async ({
  browser,
}: {
  browser: Browser;
}) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({
    // TALL ENOUGH TO PAINT THE WHOLE CONTACT SHEET. At 1200 the second row
    // of frames was still being laid out when the shutter fired and came back
    // clipped -- the element screenshot captures what is painted, not what
    // will be.
    viewport: { width: 1700, height: 2400 },
    deviceScaleFactor: 2,
  });
  try {
    const page = await ctx.newPage();
    await page.goto('/design-target/auth');
    await page.getByTestId('wsf-target-auth-batch').waitFor({ state: 'visible', timeout: 30_000 });
    // The wordmark is an image; let it decode before the shutter.
    await page.waitForTimeout(1500);

    await page
      .getByTestId('wsf-contact-batch-a')
      .screenshot({ path: path.join(OUT, 'CONTACT-SHEET-batch-a.png') });

    for (const c of CLASSES) {
      for (const id of SCREENS) {
        await page
          .getByTestId(`wsf-frame-auth-${id}-${c}`)
          .screenshot({ path: path.join(OUT, `TARGET-${id}-${c}.png`) });
      }
    }
  } finally {
    await ctx.close();
  }
});
