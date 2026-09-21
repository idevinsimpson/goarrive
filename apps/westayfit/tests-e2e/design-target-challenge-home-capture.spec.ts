import path from 'node:path';

import { test, type Browser } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';

/**
 * Captures Atlas Batch C — the challenge, and the door — from
 * the gated preview route. TARGETS, not screenshots of a member surface.
 */
const OUT = path.resolve(__dirname, '../../../docs/design-target/review/batch-c-challenge-and-door');

/*
  OPT-IN, for the reason every capture spec in this suite is. This spec asserts
  nothing about the product — its whole product is the Batch C frames in docs/.
  Run in the ordinary suite it would rewrite them on every verification pass,
  and an accepted frame would drift underneath the decision that accepted it.

  Set WSF_CAPTURE_FRAMES=1 to regenerate deliberately.
*/
test.skip(
  !CAPTURE_FRAMES,
  'Accepted frames are evidence; set WSF_CAPTURE_FRAMES=1 to regenerate them.',
);

const SCREENS = [
  // C1 · /community/[groupId]/challenge
  'challenge-live',
  'challenge-open-ended',
  'challenge-reached',
  'challenge-all-counted',
  'challenge-move-states',
  'challenge-none',
  'challenge-not-member',
  'challenge-signed-out',
  'challenge-error',
  'challenge-loading',
  // C2 · /
  'home-signed-out',
  'home-opening',
  'home-choose',
  'home-empty',
  'home-code-rejected',
  'home-my-loading',
  'home-my-error',
] as const;

/** Three phone classes. 430x932 is in the atlas device list and Batch A did
 * not draw it; every batch from here on does. */
const CLASSES = ['390x844', '390x640', '430x932'] as const;

test('Atlas Batch C renders at three phone classes, plus its contact sheet', async ({
  browser,
}: {
  browser: Browser;
}) => {
  // Fifty-one frames plus their end-of-scroll companions and the contact
  // sheet, each a device-scale-2 element screenshot.
  test.setTimeout(600_000);
  const ctx = await browser.newContext({
    // TALL ENOUGH TO PAINT THE WHOLE CONTACT SHEET. An element screenshot
    // captures what is painted, not what is about to be.
    viewport: { width: 1800, height: 4200 },
    deviceScaleFactor: 2,
  });
  try {
    const page = await ctx.newPage();
    await page.goto('/design-target/challenge-home');
    await page
      .getByTestId('wsf-target-challenge-home-batch')
      .waitFor({ state: 'visible', timeout: 30_000 });
    // The wordmark is an image; let it decode before the shutter.
    await page.waitForTimeout(2500);

    await page
      .getByTestId('wsf-contact-batch-c')
      .screenshot({ path: path.join(OUT, 'CONTACT-SHEET-batch-c.png') });

    for (const c of CLASSES) {
      for (const id of SCREENS) {
        const frame = page.getByTestId(`wsf-frame-c-${id}-${c}`);
        await frame.screenshot({ path: path.join(OUT, `TARGET-${id}-${c}.png`) });

        /*
          THE REST OF A SCREEN THAT DOES NOT FIT ON ONE.

          The frame above is arrival — what a phone shows when the screen
          opens, which is the thing a design has to get right first. But three
          of these destinations are genuinely longer than a phone (the goal
          form is four decisions and a summary), and a review that only ever
          sees the top of them is reviewing a third of the design.

          So where the screen's own ScrollView actually overflows, take a
          second frame with it scrolled to the end. It is the same element at
          the same size; only the scroll offset differs. Nothing is stretched
          and no layout is faked, which is why this is a second capture rather
          than a taller frame: a taller frame would change the share of the
          screen the navy field takes and show a composition the phone never
          renders.

          `scrolled` comes back false when everything already fit, and no
          second file is written for those — an -end frame exists only where
          there is an end to show.
        */
        const scrolled = await frame.evaluate((el: Element) => {
          const nodes = Array.from(el.querySelectorAll('*'));
          let moved = false;
          for (const n of nodes) {
            const node = n as HTMLElement;
            if (node.scrollHeight > node.clientHeight + 4) {
              node.scrollTop = node.scrollHeight;
              moved = true;
            }
          }
          return moved;
        });
        if (scrolled) {
          await page.waitForTimeout(120);
          await frame.screenshot({ path: path.join(OUT, `TARGET-${id}-${c}-end.png`) });
          // Put it back, so the next pass over this page starts from arrival.
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
