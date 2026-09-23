import fs from 'node:fs';
import path from 'node:path';

import { test, expect, type FrameLocator, type Page } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';
import {
  seedActiveGoal,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * W9 — THE MIGRATED SHELL, CAPTURED ON THE REAL MEMBER ROUTES.
 *
 * THE SUCCESSOR SET. The packet's `target/` frames are drawings of a proposal
 * taken from the gated prototype at /design-target/shell-next. These are not:
 * every frame here is the SHIPPING member route, running the migrated shell
 * out of the ordinary web build against the emulator. They are the successor
 * to those drawings, which is why they live under their own directory and
 * carry their own label rather than overwriting an accepted package.
 *
 * NOT ACCEPTED. A capture of the real build is still not a gate. Nothing here
 * has been through the Director, so the in-frame label says MIGRATED BUILD /
 * NOT ACCEPTED, and it is asserted rather than trusted: a frame that escapes
 * this directory still carries what it is inside the image.
 *
 * WHY AN IFRAME. Same reason as the proposal set: the label has to be part of
 * the PNG. A caption in a README travels separately from the file, and a frame
 * of a real product route circulating without its label is one paste away from
 * being read as an accepted screen. The stage is an iframe of exactly the
 * device size, same origin as the app, so the routes are driven for real and
 * the strip and the device cannot come apart.
 *
 * WHAT IT PROVES BESIDES THE PICTURES. The owner's finding was that the top of
 * the app is a different thing on every route. `before/chrome-geometry.json`
 * measured that, and sprint-w9-current-shell-before.spec.ts asserted it. This
 * spec asserts the other half on the migrated build: one top bar, at one
 * height, on all four tabs; MOVE opening over the tab the member was actually
 * in rather than replacing it; and the two focused routes wearing no member
 * chrome at all. Those checks run whether or not frames are being written, so
 * WSF_CAPTURE_FRAMES only ever gates the bytes on disk.
 *
 * Everything seeded below is SYNTHETIC: no community, member or goal is real.
 */

const OUT = path.resolve(__dirname, '../../../docs/design-target/review/app-shell-next/successor');
const LABEL = 'MIGRATED BUILD / NOT ACCEPTED';

/** The strip's height, added on top of the device height. */
const BANNER = 18;

const DEVICES = [
  { key: '390x844', width: 390, height: 844 },
  { key: '390x640', width: 390, height: 640 },
] as const;

/** Build the easel: a labelled strip flush above an iframe of the device size. */
async function easel(page: Page, width: number, height: number, src: string): Promise<FrameLocator> {
  await page.goto('/health');
  await page.evaluate(
    ({ w, h, banner, label, source }) => {
      document.documentElement.style.background = '#FFFFFF';
      document.body.style.cssText = 'margin:0;padding:0;background:#FFFFFF';
      document.body.innerHTML = `
        <div id="wsf-w9s-frame" data-testid="wsf-w9s-frame"
             style="width:${w}px;height:${h + banner}px;background:#FFFFFF;overflow:hidden;">
          <div data-testid="wsf-w9s-banner"
               style="height:${banner}px;width:${w}px;background:#0B1F35;color:#F7F5F0;
                      font:700 10px/${banner}px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
                      letter-spacing:.9px;text-align:center;box-sizing:border-box;">${label}</div>
          <iframe id="wsf-w9s-stage" name="wsf-w9s-stage" src="${source}"
                  style="width:${w}px;height:${h}px;border:0;display:block;"></iframe>
        </div>`;
    },
    { w: width, h: height, banner: BANNER, label: LABEL, source: src },
  );
  return page.frameLocator('#wsf-w9s-stage');
}

/** Drive the iframe to a route without rebuilding the easel around it. */
async function stageGoto(page: Page, to: string): Promise<void> {
  await page.evaluate((href) => {
    const frame = document.getElementById('wsf-w9s-stage') as HTMLIFrameElement | null;
    if (frame) frame.src = href;
  }, to);
}

/** The top bar's box inside the stage, so the four tabs can be compared. */
async function topBarBox(stage: FrameLocator): Promise<{ y: number; h: number }> {
  const bar = stage.getByTestId('wsf-member-topbar');
  await bar.waitFor({ state: 'visible', timeout: 30_000 });
  const box = (await bar.boundingBox())!;
  return { y: Math.round(box.y), h: Math.round(box.height) };
}

test('the migrated shell captures on the real routes, and the top of the app agrees with itself', async ({
  page,
}) => {
  test.setTimeout(300_000);
  if (CAPTURE_FRAMES) fs.mkdirSync(OUT, { recursive: true });

  const stamp = stampId();
  const email = `wsf-w9-successor-${stamp}@example.com`;
  const password = 'Sup3rSecret!23';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `w9after-${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'inviteOnly',
    groupType: 'custom',
    members: [{ uid, role: 'member' }],
  });
  /*
    TWO open goals, not one. With exactly one open goal /move resolves itself
    and replaces straight into contributing, so a single-goal fixture cannot
    photograph MOVE open at all. Two is the smallest fixture that shows the
    MOVE surface the owner was looking at.
  */
  const goalId = `w9aftergoal-${stamp}`;
  await seedActiveGoal({
    goalId,
    groupId,
    ownerUid: uid,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total: 1847,
    timezone: 'America/New_York',
  });
  await seedActiveGoal({
    goalId: `${goalId}b`,
    groupId,
    ownerUid: uid,
    title: 'Morning Mile Streak',
    target: 300,
    unit: 'miles',
    total: 96,
    timezone: 'America/New_York',
  });

  await page.setViewportSize({ width: 480, height: 940 });
  await signInVia(page, email, password);
  /*
    WAIT FOR THE MEMBERSHIP TO BE READABLE BEFORE ANY FRAME IS TAKEN.

    Home is a community: `/` resolves the member's community and opens it. That
    resolution depends on a callable read, and until it returns the member
    looks like somebody who belongs to nothing — which renders a DIFFERENT
    screen. The first cut of this spec photographed that screen at one device
    and the real Home at the other, so the "same page at two sizes" claim was
    false in the only way a reader could not see. Arriving once here, at full
    size, settles it for every frame that follows.
  */
  await page.goto('/');
  await page.getByTestId('wsf-community-name').waitFor({ state: 'visible', timeout: 60_000 });

  for (const device of DEVICES) {
    await page.setViewportSize({ width: device.width + 60, height: device.height + BANNER + 60 });
    const stage = await easel(page, device.width, device.height, '/');
    const frameEl = page.getByTestId('wsf-w9s-frame');

    /*
      THE FRAME MUST BE THE DEVICE IT CLAIMS TO BE. The filename ends in the
      device class, so the box is checked rather than trusted: a frame taken at
      the wrong size is a screen nobody will ever see, and the label would
      still read 390x844.
    */
    const box = (await frameEl.boundingBox())!;
    expect(Math.round(box.width), `${device.key}: wrong frame width`).toBe(device.width);
    expect(Math.round(box.height), `${device.key}: wrong frame height`).toBe(device.height + BANNER);

    const banner = page.getByTestId('wsf-w9s-banner');
    await expect(banner, `${device.key}: the in-frame label is missing`).toBeVisible();
    await expect(banner, `${device.key}: the label does not say what the frame is`).toHaveText(LABEL);
    const bannerBox = (await banner.boundingBox())!;
    expect(Math.round(bannerBox.y - box.y), `${device.key}: the label is not flush with the frame top`).toBe(0);
    expect(Math.round(bannerBox.width), `${device.key}: the label does not span the frame`).toBe(device.width);

    const shoot = async (id: string) => {
      if (!CAPTURE_FRAMES) return;
      await frameEl.screenshot({ path: path.join(OUT, `MIGRATED-${id}-${device.key}.png`) });
    };

    const chrome: Record<string, { y: number; h: number }> = {};

    /*
      a — HOME, WHICH IS A COMMUNITY. `/` opens the member's community rather
      than a directory of communities, so the frame that answers "what does
      Home look like" is that community, with the shell's one top bar above it.
    */
    await stage.getByTestId('wsf-community-name').waitFor({ state: 'visible', timeout: 60_000 });
    chrome.home = await topBarBox(stage);
    await shoot('a-home');

    /*
      THE TITLE IS NOT THE SCREEN. Both of these tabs paint their heading
      immediately and their content after a read returns, so waiting on the
      title photographed a page of loading skeletons at whichever device won
      the race — two of the first twelve frames came back that way. Each tab
      now waits for its own LOADED marker and for its loading state to be gone.
    */
    // b — Community.
    await stage.getByTestId('wsf-member-tab-community').click();
    await stage.getByTestId('wsf-community-index-title').waitFor({ state: 'visible', timeout: 30_000 });
    await stage.getByTestId('wsf-community-index-rows').waitFor({ state: 'visible', timeout: 60_000 });
    await stage.getByTestId('wsf-community-index-loading').waitFor({ state: 'detached', timeout: 60_000 });
    chrome.community = await topBarBox(stage);
    await shoot('b-community');

    // c — Progress.
    await stage.getByTestId('wsf-member-tab-activity').click();
    await stage.getByTestId('wsf-activity-title').waitFor({ state: 'visible', timeout: 30_000 });
    await stage.getByTestId('wsf-activity-loading').waitFor({ state: 'detached', timeout: 60_000 });
    await stage.getByTestId('wsf-activity-empty').waitFor({ state: 'visible', timeout: 60_000 });
    chrome.activity = await topBarBox(stage);
    await shoot('c-progress');

    // d — You. The route whose top chrome differed most before the migration:
    // it opened with a full-bleed navy card and a white wordmark of its own.
    await stage.getByTestId('wsf-member-tab-you').click();
    await stage.getByTestId('wsf-you-name').waitFor({ state: 'visible', timeout: 30_000 });
    chrome.you = await topBarBox(stage);
    await shoot('d-you');

    /*
      THE OWNER'S FINDING, ANSWERED. Four destinations, one top bar, at one
      height on all four. Asserted as an equality on purpose: this is the
      AFTER of the inequality `before/chrome-geometry.json` recorded, and an
      AFTER that quietly starts disagreeing with itself has stopped describing
      the build.
    */
    const tops = Object.values(chrome);
    expect(
      new Set(tops.map((c) => c.y)).size,
      `${device.key}: the top bar sits at more than one height across the four tabs: ${JSON.stringify(chrome)}`,
    ).toBe(1);
    expect(
      new Set(tops.map((c) => c.h)).size,
      `${device.key}: the top bar is more than one height across the four tabs: ${JSON.stringify(chrome)}`,
    ).toBe(1);
    expect(
      await stage.getByTestId('wsf-member-topbar-wordmark').count(),
      `${device.key}: the shell draws exactly one wordmark`,
    ).toBe(1);

    /*
      e — MOVE OPEN, FROM YOU. Taken from a tab that is NOT Home on purpose:
      the claim is that MOVE opens over the context the member was already in,
      so a frame from Home could not tell the two apart. The You page staying
      ATTACHED under the sheet is that claim, and the bar being gone from under
      it is the other half of the owner's complaint — MOVE no longer offers to
      take a member where they already are.
    */
    await stage.getByTestId('wsf-member-tab-move').click();
    await stage.getByTestId('wsf-move-choose').waitFor({ state: 'visible', timeout: 30_000 });
    await expect(
      stage.getByTestId('wsf-you-name'),
      `${device.key}: MOVE replaced the tab underneath instead of opening over it`,
    ).toBeAttached();
    /*
      OCCLUDED, NOT `toBeHidden`. The bar is still MOUNTED under the sheet —
      that is the point of a transparent modal — so it is "visible" to a
      locator while being completely covered on screen. `toBeHidden` ignores
      occlusion, so it would fail here for the right reason and pass later for
      the wrong one. The question a member asks is whether anything of the bar
      can be reached where it sits, so that is the question: whatever is at the
      bar's own centre point must not be part of the bar.
    */
    const stageFrame = page.frame({ name: 'wsf-w9s-stage' })!;
    const barAtRest = await stageFrame.evaluate(() => {
      const bar = document.querySelector('[data-testid="wsf-member-tabs"]');
      if (!(bar instanceof HTMLElement)) return { present: false, covered: true };
      const r = bar.getBoundingClientRect();
      const top = document.elementFromPoint(
        Math.round(r.x + r.width / 2),
        Math.round(r.y + r.height / 2),
      );
      return { present: true, covered: !(top instanceof Node && bar.contains(top)) };
    });
    expect(
      barAtRest.covered,
      `${device.key}: the member tab bar is reachable under the MOVE sheet — MOVE is still offering to take a member where they already are`,
    ).toBe(true);
    await shoot('e-move-open');

    /*
      f — CONTRIBUTING, FOCUSED. The one job that wants the whole screen. It
      lives outside the tab tree, so neither piece of member chrome is in the
      document at all — not merely hidden.
    */
    await stageGoto(
      page,
      `/contribute/${goalId}?groupId=${encodeURIComponent(groupId)}&mode=record`,
    );
    // The arrival state of `mode=record` — the question itself, not the
    // review that follows it. This is the screen a member lands on.
    await stage
      .getByTestId('wsf-contribute-entry-screen')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });
    expect(
      await stage.getByTestId('wsf-member-tabs').count(),
      `${device.key}: contributing is wearing the member tab bar`,
    ).toBe(0);
    expect(
      await stage.getByTestId('wsf-member-topbar').count(),
      `${device.key}: contributing is wearing the member top bar`,
    ).toBe(0);
    await shoot('f-contribute');
  }

  /*
    THE CONTACT SHEET: both phones, one image, for the review that needs the
    frames beside each other. The PNGs are INLINED as data URIs read back off
    disk rather than referenced by URL — the easel is served by the hosting
    emulator, which knows nothing about a docs directory, so an <img src>
    pointing there would render broken boxes and still write a sheet. Reading
    the bytes back also means the sheet cannot disagree with the files it
    claims to show.
  */
  if (CAPTURE_FRAMES) {
    const STEPS = [
      { id: 'a-home', label: 'Home' },
      { id: 'b-community', label: 'Community' },
      { id: 'c-progress', label: 'Progress' },
      { id: 'd-you', label: 'You' },
      { id: 'e-move-open', label: 'MOVE open' },
      { id: 'f-contribute', label: 'Contributing' },
    ] as const;
    const tiles = DEVICES.map((d) => ({
      device: d.key,
      frames: STEPS.map((s) => {
        const file = path.join(OUT, `MIGRATED-${s.id}-${d.key}.png`);
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
          `<h1 style="font:800 16px/21px -apple-system,sans-serif;color:#0B1F35;margin:0 0 3px">W9 — the migrated member shell, on the real routes</h1>` +
          `<p style="font:700 10px/14px -apple-system,sans-serif;color:#B4232C;letter-spacing:.9px;margin:0 0 14px">${label} — captures of the shipping build, not a gate and not an accepted target</p>` +
          body;
      },
      { tiles, label: LABEL },
    );
    await page.screenshot({ path: path.join(OUT, 'MIGRATED-contact-sheet.png'), fullPage: true });
  }
});
