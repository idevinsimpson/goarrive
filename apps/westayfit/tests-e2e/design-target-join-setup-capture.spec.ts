import path from 'node:path';

import { expect, test, type Browser } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';

/**
 * Captures Atlas Batch B — the invitation and what a Champion starts — from
 * the gated preview route. TARGETS, not screenshots of a member surface.
 */
const OUT = path.resolve(__dirname, '../../../docs/design-target/review/batch-b-join-and-setup');

/*
  OPT-IN, for the reason every capture spec in this suite is. This spec asserts
  nothing about the product — its whole product is the Batch B frames in docs/.
  Run in the ordinary suite it would rewrite them on every verification pass,
  and an accepted frame would drift underneath the decision that accepted it.

  Set WSF_CAPTURE_FRAMES=1 to regenerate deliberately.
*/
test.skip(
  !CAPTURE_FRAMES,
  'Accepted frames are evidence; set WSF_CAPTURE_FRAMES=1 to regenerate them.',
);

const SCREENS = [
  // B1 · /join/[joinCode]
  'join-invite-out',
  'join-invite-in',
  'join-working',
  'join-failed',
  'join-loading',
  'join-not-valid',
  'join-too-many',
  'join-load-failed',
  'join-device-choice',
  'join-device-shared',
  // B2 · /start-community
  'start-form',
  'start-form-other',
  'start-name-missing',
  'start-working',
  'start-failed',
  'start-signin',
  'start-verify',
  // B3 · /goals/new
  'goal-form',
  'goal-custom-window',
  'goal-errors',
  'goal-working',
  'goal-failed',
  'goal-live',
  'goal-unavailable',
  'goal-no-community',
  // B3b · combined-goal setup
  'combined-setup-short',
  'combined-setup-ready',
  'combined-setup-working',
  'combined-setup-failed',
  // B4 · /combined/[setupId]
  'combined-live',
  'combined-closed',
  'combined-stale',
  'combined-unreachable',
  'combined-nothing',
] as const;

/** Three phone classes. 430x932 is in the atlas device list and Batch A did
 * not draw it; every batch from here on does. */
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

test('Atlas Batch B renders at three phone classes, plus its contact sheet', async ({
  browser,
}: {
  browser: Browser;
}) => {
  // Ninety frames plus the contact sheet, each a device-scale-2 element
  // screenshot. The default timeout is not close to enough.
  test.setTimeout(600_000);
  const ctx = await browser.newContext({
    // TALL ENOUGH TO PAINT THE WHOLE CONTACT SHEET. Batch B's is four groups
    // of full-height phones; an element screenshot captures what is painted,
    // not what is about to be.
    viewport: { width: 1800, height: 6000 },
    deviceScaleFactor: 2,
  });
  try {
    const page = await ctx.newPage();
    await page.goto('/design-target/join-setup');
    await page
      .getByTestId('wsf-target-join-setup-batch')
      .waitFor({ state: 'visible', timeout: 30_000 });
    // The wordmark is an image; let it decode before the shutter.
    await page.waitForTimeout(2500);

    await page
      .getByTestId('wsf-contact-batch-b')
      .screenshot({ path: path.join(OUT, 'CONTACT-SHEET-batch-b.png') });

    for (const c of CLASSES) {
      for (const id of SCREENS) {
        await assertStrip(page, `wsf-frame-b-${id}-${c}`, `wsf-frame-banner-b-${id}-${c}`);
        const frame = page.getByTestId(`wsf-frame-b-${id}-${c}`);
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
