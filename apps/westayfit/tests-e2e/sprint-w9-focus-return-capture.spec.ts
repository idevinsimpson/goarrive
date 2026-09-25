import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type FrameLocator, type Page } from '@playwright/test';

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
 * W9 — FOCUS-RETURN-1: THE FRAMES WHOSE PIXELS THIS PACKET CHANGES.
 *
 * The packet changes where keyboard focus lands, and a focused control draws
 * the browser's focus ring, so the states below look different: on the base
 * nothing is focused after the exit, on the candidate the restored control
 * carries the ring. Nothing else on screen is changed, and no other state is
 * photographed.
 *
 * Each frame is taken inside an easel: an iframe of the device size under a
 * strip naming the stage, the served build's commit and "NOT ACCEPTED". The
 * producer asserts the stage's build and the focused element before the
 * shutter, and writes only with WSF_CAPTURE_FRAMES=1 (this file only).
 *
 *   WSF_FOCUS_RETURN_STAGE=MIGRATED   the development base 6b96ba1b, served
 *   WSF_FOCUS_RETURN_STAGE=CANDIDATE  this packet's build, served
 *
 * Everything seeded here is SYNTHETIC. Chromium, local emulators.
 */

const OUT = path.resolve(__dirname, '../../../docs/design-target/review/focus-return-1');

const STAGE = (process.env.WSF_FOCUS_RETURN_STAGE ?? 'CANDIDATE').toUpperCase();
if (STAGE !== 'MIGRATED' && STAGE !== 'CANDIDATE') {
  throw new Error(`WSF_FOCUS_RETURN_STAGE must be MIGRATED or CANDIDATE, not ${STAGE}`);
}
const CANDIDATE = STAGE === 'CANDIDATE';

/** The development base this packet started from, as /health prints it. */
const BASE_SHORT = '6b96ba1b';
const BANNER = 18;
const DEVICE = { key: '390x844', width: 390, height: 844 } as const;
const PASSWORD = 'Sup3rSecret!23';

type Fx = { email: string; groupId: string; goalIds: string[] };

async function seed(tag: string, goals: number): Promise<Fx> {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-w9-frc-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `w9frc-${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'private',
    members: [{ uid, role: 'member' }],
  });
  const goalIds: string[] = [];
  for (let i = 0; i < goals; i += 1) {
    const goalId = `w9frcgoal${i}-${stamp}`;
    await seedActiveGoal({
      goalId,
      groupId,
      ownerUid: uid,
      title: i === 0 ? 'October Squat Challenge' : 'Lunchtime Laps',
      target: 5000,
      unit: i === 0 ? 'squats' : 'laps',
      total: 1847,
      endsAt: new Date(Date.now() + (7 + i) * 24 * 60 * 60_000),
    });
    goalIds.push(goalId);
  }
  return { email, groupId, goalIds };
}

/** The easel: a labelled strip flush above an iframe of the device size. */
async function easel(page: Page, src: string): Promise<{ stage: FrameLocator; label: string }> {
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
        <div data-testid="wsf-w9fr-frame"
             style="width:${w}px;height:${h + banner}px;background:#FFFFFF;overflow:hidden;">
          <div data-testid="wsf-w9fr-banner"
               style="height:${banner}px;width:${w}px;background:#0B1F35;color:#F7F5F0;
                      font:700 10px/${banner}px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
                      letter-spacing:.9px;text-align:center;box-sizing:border-box;
                      border-bottom:1px solid #F7F5F0;">${label}</div>
          <iframe id="wsf-w9fr-stage" name="wsf-w9fr-stage" src="${source}"
                  style="width:${w}px;height:${h}px;border:0;display:block;"></iframe>
        </div>`;
    },
    { w: DEVICE.width, h: DEVICE.height, banner: BANNER, label, source: src },
  );
  return { stage: page.frameLocator('#wsf-w9fr-stage'), label };
}

async function focusedIn(stage: FrameLocator): Promise<string> {
  return stage.locator('body').evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || el === document.documentElement) return 'body';
    return el.getAttribute('data-testid') ?? el.tagName.toLowerCase();
  });
}

async function press(page: Page, stage: FrameLocator, testId: string): Promise<void> {
  const el = stage.locator(`[data-testid="${testId}"]:visible`).first();
  await expect(el).toBeVisible({ timeout: 40_000 });
  await el.focus();
  await page.keyboard.press('Enter');
}

async function shoot(page: Page, label: string, name: string): Promise<void> {
  const frameEl = page.getByTestId('wsf-w9fr-frame');
  const box = (await frameEl.boundingBox())!;
  expect(Math.round(box.width), `${name}: frame width`).toBe(DEVICE.width);
  expect(Math.round(box.height), `${name}: frame height`).toBe(DEVICE.height + BANNER);
  await expect(page.getByTestId('wsf-w9fr-banner')).toHaveText(label);
  // Past the restore and the ring's paint.
  await page.waitForTimeout(1_200);
  if (CAPTURE_FRAMES) {
    fs.mkdirSync(OUT, { recursive: true });
    await frameEl.screenshot({ path: path.join(OUT, `${STAGE}-${name}-${DEVICE.key}.png`) });
  }
}

async function expectFocusIn(stage: FrameLocator, id: string, why: string): Promise<void> {
  await expect.poll(() => focusedIn(stage), { timeout: 8_000, message: why }).toBe(id);
}

test.describe(`FOCUS-RETURN-1 frames · ${STAGE}`, () => {
  test.use({ viewport: { width: 600, height: 1000 }, deviceScaleFactor: 2 });

  test('MOVE closed by keyboard: focus on MOVE (candidate) or nowhere (base)', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('m', 2);
    await signInVia(page, fx.email, PASSWORD);
    const { stage, label } = await easel(page, `/community/${fx.groupId}`);
    await expect(stage.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 60_000 });
    await press(page, stage, 'wsf-member-tab-move');
    await expect(stage.locator('[data-testid="wsf-move-choose"]:visible')).toBeVisible({ timeout: 40_000 });
    await press(page, stage, 'wsf-move-close');
    await expect(stage.getByTestId('wsf-move-sheet')).toHaveCount(0, { timeout: 8_000 });
    await expectFocusIn(stage, CANDIDATE ? 'wsf-member-tab-move' : 'body', 'where focus lands after Close');
    await shoot(page, label, 'move-close-keyboard');
  });

  test('Back from “Already moved?”: focus on the launcher (candidate) or nowhere (base)', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('b', 1);
    await signInVia(page, fx.email, PASSWORD);
    const { stage, label } = await easel(page, `/community/${fx.groupId}`);
    const launcher = `wsf-community-goal-record-${fx.goalIds[0]}`;
    await press(page, stage, launcher);
    await expect(stage.locator('[data-testid="wsf-contribute-entry-screen"]:visible')).toBeVisible({ timeout: 40_000 });
    await press(page, stage, 'wsf-contribute-back');
    await expect(stage.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 40_000 });
    await expectFocusIn(stage, CANDIDATE ? launcher : 'body', 'where focus lands after Back');
    await shoot(page, label, 'back-to-launcher');
  });

  test('a cold Back: focus on the community’s heading (candidate) or nowhere (base)', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('c', 1);
    await signInVia(page, fx.email, PASSWORD);
    const { stage, label } = await easel(page, `/contribute/${fx.goalIds[0]}?groupId=${fx.groupId}`);
    await expect(stage.locator('[data-testid="wsf-contribute-community"]:visible')).toBeVisible({ timeout: 60_000 });
    await press(page, stage, 'wsf-contribute-back');
    await expect(stage.locator('[data-testid="wsf-community-name"]:visible')).toBeVisible({ timeout: 40_000 });
    await expectFocusIn(stage, CANDIDATE ? 'wsf-community-name' : 'body', 'where focus lands after a cold Back');
    await shoot(page, label, 'cold-back-heading');
  });

  test('Enter on the Community tab: it opens (candidate) or nothing happens (base)', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('t', 1);
    await signInVia(page, fx.email, PASSWORD);
    const { stage, label } = await easel(page, `/community/${fx.groupId}`);
    await expect(stage.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 60_000 });
    await press(page, stage, 'wsf-member-tab-community');
    const current = stage.locator('[data-testid^="wsf-member-tab-"][data-current="true"]');
    await expect(current).toHaveAttribute(
      'data-testid',
      CANDIDATE ? 'wsf-member-tab-community' : 'wsf-member-tab-home',
      { timeout: 20_000 },
    );
    await expectFocusIn(stage, 'wsf-member-tab-community', 'focus stays on the tab the member chose');
    await shoot(page, label, 'tab-enter-community');
  });
});
