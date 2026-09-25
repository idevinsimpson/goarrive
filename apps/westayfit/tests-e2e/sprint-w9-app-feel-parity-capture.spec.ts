import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type FrameLocator, type Page, type Route } from '@playwright/test';

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
 * W9 — APP-FEEL-PARITY-1 CHECKPOINT 1: THE FRAMES.
 *
 * Same states, same fixtures, two builds, and each frame is labelled with the
 * build it shows:
 *   WSF_APP_FEEL_STAGE=MIGRATED   the development base 502b1e8d, served
 *   WSF_APP_FEEL_STAGE=CANDIDATE  this checkpoint's build, served
 * Neither is an AFTER, and nothing here is accepted.
 *
 * States, at 390x640 and 390x844:
 *   move-one-goal   Home → MOVE with one open goal: the first step
 *   move-count      the same flow, at the count
 *   move-receipt    the same flow, at the confirmed receipt
 *   home-loading    Community Home while its first read is held, top bar up
 * and, CANDIDATE only (the base does not animate), an ENTRY and an EXIT
 * timeline: the sheet's animations are paused and set to fixed times, so each
 * frame is the same moment on every run rather than wherever a screenshot
 * happened to land.
 *
 * Each frame is taken inside an easel -- a strip naming the stage, the served
 * build's commit and "NOT ACCEPTED" over an iframe of the device size -- and
 * the producer asserts all three before it writes. Writes only with
 * WSF_CAPTURE_FRAMES=1 (set it for this file only).
 *
 * Everything seeded here is SYNTHETIC. Chromium, local emulators.
 */

const OUT = path.resolve(__dirname, '../../../docs/design-target/review/app-feel-parity-1');
const STAGE = (process.env.WSF_APP_FEEL_STAGE ?? 'CANDIDATE').toUpperCase();
if (STAGE !== 'MIGRATED' && STAGE !== 'CANDIDATE') {
  throw new Error(`WSF_APP_FEEL_STAGE must be MIGRATED or CANDIDATE, not ${STAGE}`);
}
const CANDIDATE = STAGE === 'CANDIDATE';
const BASE_SHORT = '502b1e8d';
const BANNER = 18;
const PASSWORD = 'Sup3rSecret!23';
const DEVICES = [
  { key: '390x640', width: 390, height: 640 },
  { key: '390x844', width: 390, height: 844 },
] as const;
type Device = (typeof DEVICES)[number];

type Fx = { email: string; groupId: string; goalId: string };

async function seed(tag: string): Promise<Fx> {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-w9-afpc-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `w9afpc-${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'private',
    members: [{ uid, role: 'member' }],
  });
  const goalId = `w9afpcgoal-${stamp}`;
  await seedActiveGoal({
    goalId,
    groupId,
    ownerUid: uid,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total: 1847,
    endsAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
  });
  return { email, groupId, goalId };
}

async function easel(page: Page, device: Device, src: string): Promise<{ stage: FrameLocator; label: string }> {
  await page.goto('/health');
  const commit = ((await page.getByTestId('wsf-health-commit').innerText()).match(/[0-9a-f]{7,40}/) ?? [''])[0];
  expect(commit, 'the served build carries no commit stamp').not.toBe('');
  if (CANDIDATE) expect(commit, 'CANDIDATE frames must not come from the base build').not.toBe(BASE_SHORT);
  else expect(commit, 'MIGRATED frames must come from the development base build').toBe(BASE_SHORT);
  const label = `${STAGE} BUILD ${commit} / NOT ACCEPTED`;
  await page.evaluate(
    ({ w, h, banner, label, source }) => {
      document.documentElement.style.background = '#FFFFFF';
      document.body.style.cssText = 'margin:0;padding:0;background:#FFFFFF';
      document.body.innerHTML = `
        <div data-testid="wsf-w9afp-frame" style="width:${w}px;height:${h + banner}px;background:#FFFFFF;overflow:hidden;">
          <div data-testid="wsf-w9afp-banner"
               style="height:${banner}px;width:${w}px;background:#0B1F35;color:#F7F5F0;
                      font:700 10px/${banner}px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
                      letter-spacing:.9px;text-align:center;box-sizing:border-box;border-bottom:1px solid #F7F5F0;">${label}</div>
          <iframe id="wsf-w9afp-stage" src="${source}" style="width:${w}px;height:${h}px;border:0;display:block;"></iframe>
        </div>`;
    },
    { w: device.width, h: device.height, banner: BANNER, label, source: src },
  );
  return { stage: page.frameLocator('#wsf-w9afp-stage'), label };
}

async function shoot(page: Page, device: Device, label: string, name: string, settle = 900): Promise<void> {
  const frameEl = page.getByTestId('wsf-w9afp-frame');
  const box = (await frameEl.boundingBox())!;
  expect(Math.round(box.width), `${name}: frame width`).toBe(device.width);
  expect(Math.round(box.height), `${name}: frame height`).toBe(device.height + BANNER);
  await expect(page.getByTestId('wsf-w9afp-banner')).toHaveText(label);
  if (settle) await page.waitForTimeout(settle);
  if (CAPTURE_FRAMES) {
    fs.mkdirSync(OUT, { recursive: true });
    await frameEl.screenshot({ path: path.join(OUT, `${STAGE}-${name}-${device.key}.png`), animations: 'allow' });
  }
}

async function pressMove(stage: FrameLocator): Promise<void> {
  const move = stage.locator('[data-testid="wsf-member-tab-move"]:visible').first();
  await expect(move).toBeVisible({ timeout: 40_000 });
  await move.click();
}

/** Pause the sheet's animations at `t` ms; true if there were any. */
async function holdAnimationsAt(stage: FrameLocator, t: number): Promise<number> {
  return stage.locator('body').evaluate((_b, at) => {
    const anims = document.getAnimations().filter((a) => {
      const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
      return Boolean(target?.closest('[data-wsf-sheet-panel], [data-wsf-sheet-scrim]') || target?.matches?.('[data-wsf-sheet-panel], [data-wsf-sheet-scrim]'));
    });
    anims.forEach((a) => {
      a.pause();
      a.currentTime = at;
    });
    return anims.length;
  }, t);
}

test.describe(`APP-FEEL-PARITY-1 checkpoint 1 frames · ${STAGE}`, () => {
  test.use({ viewport: { width: 600, height: 1100 }, deviceScaleFactor: 2 });

  for (const device of DEVICES) {
    test(`${device.key}: one-goal MOVE from Home, at the first step, the count and the receipt`, async ({ page }) => {
      test.setTimeout(300_000);
      const fx = await seed(`m${device.height}`);
      await signInVia(page, fx.email, PASSWORD);
      const { stage, label } = await easel(page, device, `/community/${fx.groupId}`);
      await expect(stage.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 60_000 });
      await pressMove(stage);
      await expect(stage.locator('[data-testid="wsf-contribute-move-screen"]:visible')).toBeVisible({ timeout: 40_000 });
      expect(await stage.locator('[data-testid="wsf-contribute-sheet"]').count(), 'sheet only on the candidate').toBe(
        CANDIDATE ? 1 : 0,
      );
      await shoot(page, device, label, 'move-one-goal');

      await stage.locator('[data-testid="wsf-contribute-skip-timer"]:visible').first().click();
      const entry = stage.locator('[data-testid="wsf-contribute-entry"]:visible').first();
      await expect(entry).toBeVisible({ timeout: 20_000 });
      await entry.fill('20');
      await shoot(page, device, label, 'move-count');

      await stage.locator('[data-testid="wsf-contribute-review"]:visible').first().click();
      await stage.locator('[data-testid="wsf-contribute-submit"]:visible').first().click();
      await expect(stage.locator('[data-testid="wsf-contribute-receipt"]:visible')).toBeVisible({ timeout: 40_000 });
      await shoot(page, device, label, 'move-receipt', 1_600);
    });

    test(`${device.key}: Community Home while its first read is held`, async ({ page }) => {
      test.setTimeout(300_000);
      const fx = await seed(`l${device.height}`);
      await signInVia(page, fx.email, PASSWORD);
      let release: () => void = () => undefined;
      const held = new Promise<void>((r) => (release = r));
      // Labelled delay on the one callable the first render waits on.
      await page.route('**/wsfMyCommunities', async (route: Route) => {
        await held;
        await route.continue();
      });
      const { stage, label } = await easel(page, device, `/community/${fx.groupId}`);
      await expect(stage.locator('[data-testid="wsf-member-topbar-wordmark"]:visible')).toBeVisible({ timeout: 40_000 });
      await expect(stage.locator('[data-testid="wsf-community-loading"]:visible')).toBeVisible({ timeout: 40_000 });
      await shoot(page, device, label, 'home-loading', 300);
      release();
    });
  }

  test('390x844: entry and exit timeline, paused at fixed times (CANDIDATE only)', async ({ page }) => {
    test.skip(!CANDIDATE, 'the base build has no sheet motion to record');
    test.setTimeout(300_000);
    const device = DEVICES[1];
    const fx = await seed('t');
    await signInVia(page, fx.email, PASSWORD);
    const { stage, label } = await easel(page, device, `/community/${fx.groupId}`);
    await expect(stage.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 60_000 });

    // Entry. The hand-off from the resolver keeps the dim, so the panel's own
    // travel is what the timeline shows.
    await pressMove(stage);
    await expect(stage.locator('[data-testid="wsf-contribute-sheet-panel"]')).toHaveCount(1, { timeout: 40_000 });
    await expect(stage.locator('[data-testid="wsf-contribute-move-screen"]:visible')).toBeVisible({ timeout: 40_000 });
    for (const t of [0, 60, 120, 240]) {
      const n = await holdAnimationsAt(stage, t);
      if (t === 0) test.info().annotations.push({ type: 'measure', description: `entry animations held: ${n}` });
      if (n === 0) test.info().annotations.push({ type: 'measure', description: `entry ${t}ms: animation already finished` });
      await shoot(page, device, label, `timeline-entry-${String(t).padStart(3, '0')}ms`, 0);
    }

    // Exit: Close starts the 180 ms travel; each frame holds it.
    await stage.locator('[data-testid="wsf-contribute-sheet"] [data-testid="wsf-contribute-back"]').first().click();
    for (const t of [0, 90, 170]) {
      const n = await holdAnimationsAt(stage, t);
      expect(n, `exit ${t}ms: the exit animation is running`).toBeGreaterThan(0);
      await shoot(page, device, label, `timeline-exit-${String(t).padStart(3, '0')}ms`, 0);
    }
  });
});
