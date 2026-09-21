import path from 'node:path';

import { test, type Browser } from '@playwright/test';

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
