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
  'verify-sending',
  'verify',
  'verify-already',
  'verify-unconfigured',
  'verify-failed',
  'reset',
  'reset-sent',
  'reset-unconfigured',
  'profile',
  'error',
  'return-join',
  'return-event',
  'return-kiosk',
  'verify-carrying',
  'profile-carrying',
] as const;

const CLASSES = ['390x844', '390x640', '430x932'] as const;

test('Atlas Batch A renders at three phone classes, plus its contact sheet', async ({
  browser,
}: {
  browser: Browser;
}) => {
  test.setTimeout(600_000);
  const ctx = await browser.newContext({
    // TALL ENOUGH TO PAINT THE WHOLE CONTACT SHEET. At 1200 the second row
    // of frames was still being laid out when the shutter fired and came back
    // clipped -- the element screenshot captures what is painted, not what
    // will be.
    viewport: { width: 1800, height: 5200 },
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
        const frame = page.getByTestId(`wsf-frame-auth-${id}-${c}`);
        await frame.screenshot({ path: path.join(OUT, `TARGET-${id}-${c}.png`) });

        // Where a state runs past the frame there is a real end to show:
        // same element, same size, different scroll offset.
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
          await frame.screenshot({ path: path.join(OUT, `TARGET-${id}-${c}-end.png`) });
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
