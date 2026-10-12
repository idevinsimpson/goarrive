import path from 'node:path';

import { expect, test, type Browser } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';

/**
 * Captures Atlas Batch E — the screens in the room — from the gated preview
 * route. TARGETS, not screenshots of a member surface.
 *
 * NO REAL ENROLMENT CODE IS EVER RENDERED. The station's pairing frames draw
 * the SHAPE of a code with a fixed placeholder; nothing here reads or prints
 * a live pairing code, and no QR in this batch encodes a working link.
 */
const OUT = path.resolve(__dirname, '../../../docs/design-target/review/batch-e-room-screens');

/*
  OPT-IN, for the reason every capture spec in this suite is: it asserts
  nothing about the product, and run in the ordinary suite it would rewrite
  accepted evidence on every verification pass.
*/
test.skip(
  !CAPTURE_FRAMES,
  'Accepted frames are evidence; set WSF_CAPTURE_FRAMES=1 to regenerate them.',
);

/** Each screen with the ONE device class it is actually installed at. */
const SCREENS: ReadonlyArray<readonly [string, string]> = [
  // E1 · /kiosk/[goalId] — portrait tablet on a stand
  ['kiosk-live', '800x1280'],
  ['kiosk-stale', '800x1280'],
  ['kiosk-closed', '800x1280'],
  ['kiosk-loading', '800x1280'],
  ['kiosk-unreachable', '800x1280'],
  ['kiosk-not-available', '800x1280'],
  // E2 · /contribute/[goalId]?kiosk=1 — the same tablet, mid-session
  ['kiosk-signin', '800x1280'],
  ['kiosk-entry', '800x1280'],
  ['kiosk-confirmed', '800x1280'],
  ['kiosk-refused', '800x1280'],
  ['kiosk-unresolved', '800x1280'],
  ['kiosk-finishing', '800x1280'],
  ['kiosk-finish-error', '800x1280'],
  // E3 · /station/[goalId] — landscape tablet beside a mat
  ['station-pairing-requesting', '1280x800'],
  ['station-pairing-waiting', '1280x800'],
  ['station-pairing-claiming', '1280x800'],
  ['station-pairing-expired', '1280x800'],
  ['station-pairing-failed', '1280x800'],
  ['station-attract', '1280x800'],
  ['station-called', '1280x800'],
  ['station-running', '1280x800'],
  ['station-recorded', '1280x800'],
  ['station-cleared', '1280x800'],
  ['station-stale', '1280x800'],
  ['station-queue-error', '1280x800'],
  ['station-loading', '1280x800'],
  ['station-unreachable', '1280x800'],
  ['station-not-available', '1280x800'],
] as const;

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

test('Atlas Batch E renders at both room-device classes, plus its contact sheet', async ({
  browser,
}: {
  browser: Browser;
}) => {
  test.setTimeout(600_000);
  const ctx = await browser.newContext({
    // Wide and very tall: the contact sheet is three groups of half-scale
    // tablets, and an element screenshot captures what is painted rather than
    // what is about to be.
    viewport: { width: 2100, height: 6000 },
    deviceScaleFactor: 2,
  });
  try {
    const page = await ctx.newPage();
    await page.goto('/design-target/room-screens');
    await page
      .getByTestId('wsf-target-room-screens-batch')
      .waitFor({ state: 'visible', timeout: 30_000 });
    // The wordmark is an image; let it decode before the shutter.
    await page.waitForTimeout(2500);

    await page
      .getByTestId('wsf-contact-batch-e')
      .screenshot({ path: path.join(OUT, 'CONTACT-SHEET-batch-e.png') });

    for (const [id, cls] of SCREENS) {
      await assertStrip(page, `wsf-frame-e-${id}-${cls}`, `wsf-frame-banner-e-${id}-${cls}`);
      await page
        .getByTestId(`wsf-frame-e-${id}-${cls}`)
        .screenshot({ path: path.join(OUT, `TARGET-${id}-${cls}.png`) });
    }
    /*
      NO -end FRAMES IN THIS BATCH, and the absence is the point: a venue
      screen does not scroll. If any of these overflowed its canvas there
      would be content nobody in the room can ever reach, so the frames are
      the whole screen by construction.
    */
  } finally {
    await ctx.close();
  }
});
