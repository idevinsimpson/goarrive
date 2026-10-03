import path from 'node:path';

import { expect, test, type Browser } from '@playwright/test';

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
        await assertStrip(page, `wsf-frame-auth-${id}-${c}`, `wsf-frame-banner-auth-${id}-${c}`);
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
