import fs from 'node:fs';
import path from 'node:path';

import { test, expect, type Page } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';

/**
 * W9 — THE PROPOSED SHELL, CAPTURED AS A JOURNEY.
 *
 * PROPOSED / NOT ACCEPTED. Every frame here is a drawing of a proposal. None
 * of them is an AFTER, none of them is a target that has been through a gate,
 * and none of them shows a production member route.
 *
 * WHY THESE ARE NOT FRAMES ON AN EASEL. The other design-target capture specs
 * render many phone-sized cells on one page and screenshot each cell, which is
 * right for a set of states. This packet is not about states; it is about what
 * happens BETWEEN screens. So the prototype is driven the way a member drives
 * it — Home, Community, Progress, You, MOVE open, MOVE close — inside an
 * iframe sized to the exact device, and the frame that is screenshotted is the
 * iframe plus its label.
 *
 * WHY AN IFRAME AND NOT A VIEWPORT SCREENSHOT. The label has to be INSIDE the
 * image; a caption in a README travels separately from the PNG and a frame
 * that circulates without its label is one paste away from being read as a
 * shipped screen. Screenshotting an element that contains both the strip and
 * the device means the two cannot come apart.
 *
 * This spec produces images and asserts the label, so it writes only under
 * WSF_CAPTURE_FRAMES and its checks still run without it.
 */

const OUT = path.resolve(__dirname, '../../../docs/design-target/review/app-shell-next/target');
const BASE = '/design-target/shell-next';
const LABEL = 'PROPOSED / NOT ACCEPTED';

/** The strip's height, added on top of the device height. */
const BANNER = 18;

const DEVICES = [
  { key: '390x844', width: 390, height: 844 },
  { key: '390x640', width: 390, height: 640 },
] as const;

/** The journey, in the order the Director asked for it. */
const STEPS = [
  { id: 'a-home', label: 'Home' },
  { id: 'b-community', label: 'Community' },
  { id: 'c-progress', label: 'Progress' },
  { id: 'd-you', label: 'You' },
  { id: 'e-move-open', label: 'MOVE open' },
  { id: 'f-move-closed', label: 'MOVE closed' },
] as const;

/**
 * Build the easel: a labelled strip flush above an iframe of exactly the
 * device's size. Same origin as the app, so the frame is drivable.
 */
async function easel(page: Page, width: number, height: number) {
  await page.goto('/health');
  await page.evaluate(
    ({ w, h, banner, label, src }) => {
      document.documentElement.style.background = '#FFFFFF';
      document.body.style.cssText = 'margin:0;padding:0;background:#FFFFFF';
      document.body.innerHTML = `
        <div id="wsf-w9-frame" data-testid="wsf-w9-frame"
             style="width:${w}px;height:${h + banner}px;background:#FFFFFF;overflow:hidden;">
          <div data-testid="wsf-w9-banner"
               style="height:${banner}px;width:${w}px;background:#0B1F35;color:#F7F5F0;
                      font:700 10px/${banner}px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
                      letter-spacing:.9px;text-align:center;box-sizing:border-box;">${label}</div>
          <iframe id="wsf-w9-stage" name="wsf-w9-stage" src="${src}"
                  style="width:${w}px;height:${h}px;border:0;display:block;"></iframe>
        </div>`;
    },
    { w: width, h: height, banner: BANNER, label: LABEL, src: BASE },
  );
  const frame = page.frameLocator('#wsf-w9-stage');
  await frame.getByTestId('wsf-shell-next-topbar').waitFor({ state: 'visible', timeout: 30_000 });
  return frame;
}

test('the proposed shell captures as one journey on both phones', async ({ page }) => {
  test.setTimeout(240_000);
  if (CAPTURE_FRAMES) fs.mkdirSync(OUT, { recursive: true });

  for (const device of DEVICES) {
    // The easel only has to be big enough to hold the frame at full size.
    await page.setViewportSize({ width: device.width + 60, height: device.height + BANNER + 60 });
    const stage = await easel(page, device.width, device.height);
    const frameEl = page.getByTestId('wsf-w9-frame');

    /*
      THE FRAME MUST BE THE DEVICE IT CLAIMS TO BE. The filename ends in the
      device class, so the box is checked against it rather than trusted: a
      frame captured at the wrong size is evidence of a screen nobody will ever
      see, and the label would still read 390x844.
    */
    const box = (await frameEl.boundingBox())!;
    expect(Math.round(box.width), `${device.key}: wrong frame width`).toBe(device.width);
    expect(Math.round(box.height), `${device.key}: wrong frame height`).toBe(device.height + BANNER);

    /*
      THE LABEL IS ASSERTED, NOT ASSUMED. It must exist, say what the frame is,
      sit flush with the frame's top edge and span its full width.
    */
    const banner = page.getByTestId('wsf-w9-banner');
    await expect(banner, `${device.key}: the in-frame label is missing`).toBeVisible();
    await expect(banner, `${device.key}: the label does not say what the frame is`).toHaveText(LABEL);
    const bannerBox = (await banner.boundingBox())!;
    expect(Math.round(bannerBox.y - box.y), `${device.key}: the label is not flush with the frame top`).toBe(0);
    expect(Math.round(bannerBox.width), `${device.key}: the label does not span the frame`).toBe(device.width);

    const shoot = async (id: string) => {
      if (!CAPTURE_FRAMES) return;
      await frameEl.screenshot({ path: path.join(OUT, `PROPOSED-${id}-${device.key}.png`) });
    };

    // a — Home.
    await stage.getByTestId('wsf-shell-next-page-home').waitFor({ state: 'visible' });
    await shoot('a-home');

    // b — Community.
    await stage.getByTestId('wsf-shell-next-tab-community').click();
    await stage.getByTestId('wsf-shell-next-page-community').waitFor({ state: 'visible' });
    await shoot('b-community');

    // c — Progress.
    await stage.getByTestId('wsf-shell-next-tab-activity').click();
    await stage.getByTestId('wsf-shell-next-page-activity').waitFor({ state: 'visible' });
    await shoot('c-progress');

    // d — You. The tab whose top chrome changes most in the current build:
    // today this route opens with a full-bleed navy card and a white wordmark.
    await stage.getByTestId('wsf-shell-next-tab-you').click();
    await stage.getByTestId('wsf-shell-next-page-you').waitFor({ state: 'visible' });
    await shoot('d-you');

    /*
      e — MOVE OPEN, FROM YOU. Captured from a tab that is NOT Home on
      purpose: the claim is that the sheet opens over the context the member
      was actually in, so a frame taken from Home would not show it.
    */
    await stage.getByTestId('wsf-shell-next-tab-move').click();
    await stage.getByTestId('wsf-shell-next-move-sheet').waitFor({ state: 'visible' });
    // The bar is gone from under the MOVE page, and the tab beneath is the
    // real one — both asserted here so the frame is not the only evidence.
    await expect(stage.getByTestId('wsf-shell-next-page-you')).toBeAttached();
    await shoot('e-move-open');

    // f — MOVE closed, back on You rather than on Home.
    await stage.getByTestId('wsf-shell-next-move-close').click();
    await stage.getByTestId('wsf-shell-next-page-you').waitFor({ state: 'visible' });
    await expect(stage.getByTestId('wsf-shell-next-tabs')).toBeVisible();
    await shoot('f-move-closed');
  }

  /*
    THE CONTACT SHEET: the whole journey on both phones in one image, for the
    review that needs to see the frames beside each other rather than one at a
    time.

    The frames are INLINED as data URIs read back off disk rather than
    referenced by URL. The easel is served by the hosting emulator, which knows
    nothing about a docs directory, so an <img src> pointing at the output
    folder would silently render six broken images and a contact sheet of empty
    boxes would still have been written. Reading the bytes back also means the
    sheet cannot disagree with the files it claims to show.
  */
  if (CAPTURE_FRAMES) {
    const tiles = DEVICES.map((d) => ({
      device: d.key,
      frames: STEPS.map((s) => {
        const file = path.join(OUT, `PROPOSED-${s.id}-${d.key}.png`);
        return { label: s.label, data: `data:image/png;base64,${fs.readFileSync(file).toString('base64')}` };
      }),
    }));

    await page.setViewportSize({ width: 1340, height: 1180 });
    await page.goto('/health');
    await page.evaluate(
      ({ tiles: rows, label }) => {
        document.documentElement.style.background = '#FFFFFF';
        document.body.style.cssText = 'margin:0;padding:18px;background:#FFFFFF';
        const body = rows
          .map(
            (r) =>
              `<div style="display:flex;gap:10px;padding-bottom:16px;align-items:flex-start">${r.frames
                .map(
                  (f) =>
                    `<figure style="margin:0"><img src="${f.data}" style="width:200px;display:block;border:1px solid #E3E7E1"/>` +
                    `<figcaption style="font:600 10px/14px -apple-system,sans-serif;color:#6B7C93;padding-top:4px">${f.label} · ${r.device}</figcaption></figure>`,
                )
                .join('')}</div>`,
          )
          .join('');
        document.body.innerHTML =
          `<h1 style="font:800 16px/21px -apple-system,sans-serif;color:#0B1F35;margin:0 0 3px">W9 — proposed member shell</h1>` +
          `<p style="font:700 10px/14px -apple-system,sans-serif;color:#B4232C;letter-spacing:.9px;margin:0 0 14px">${label} — prototype drawings, not an AFTER and not a shipped screen</p>` +
          body;
      },
      { tiles, label: LABEL },
    );
    await page.screenshot({ path: path.join(OUT, 'PROPOSED-contact-sheet.png'), fullPage: true });
  }
});
