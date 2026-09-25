import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type FrameLocator, type Page } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';
import { seedActiveGoal, seedCommunity, seedProfile, seedVerifiedUser, signInVia, stampId } from './helpers/mobile';

/**
 * W9 — APP-FEEL-PARITY-1 CHECKPOINT 2: THE FRAMES.
 *
 * What changed is what a member sees DURING two moments, so the frames are
 * taken as sequences from the press, not as settled end states:
 *   wordmark-home   on the Community tab, the top bar's wordmark pressed:
 *                   frames at ~0 / 150 / 400 ms and settled
 *   community-first the Community tab pressed for the first time after Home:
 *                   frames at ~0 / 150 / 400 ms and settled
 * at 390x640 and 390x844, for
 *   WSF_APP_FEEL_STAGE=MIGRATED   the development base 91392f9d, served
 *   WSF_APP_FEEL_STAGE=CANDIDATE  this checkpoint's build, served
 * The times are real clock times from the press to the shutter (each shot
 * itself takes time), recorded in the annotation; nothing is paused, because
 * what is being shown is loading versus content, not motion.
 *
 * Each frame carries its stage, the served build's commit and "NOT
 * ACCEPTED" in a strip; the producer asserts them before it writes, and only
 * writes with WSF_CAPTURE_FRAMES=1. Everything seeded is SYNTHETIC.
 */

const OUT = path.resolve(__dirname, '../../../docs/design-target/review/app-feel-parity-2');
const STAGE = (process.env.WSF_APP_FEEL_STAGE ?? 'CANDIDATE').toUpperCase();
if (STAGE !== 'MIGRATED' && STAGE !== 'CANDIDATE') {
  throw new Error(`WSF_APP_FEEL_STAGE must be MIGRATED or CANDIDATE, not ${STAGE}`);
}
const CANDIDATE = STAGE === 'CANDIDATE';
const BASE_SHORT = '91392f9d';
const BANNER = 18;
const PASSWORD = 'Sup3rSecret!23';
const DEVICES = [
  { key: '390x640', width: 390, height: 640 },
  { key: '390x844', width: 390, height: 844 },
] as const;
type Device = (typeof DEVICES)[number];
const MARKS = [0, 150, 400];

async function seed(tag: string): Promise<{ email: string; a: string; b: string }> {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-w9-afp2c-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Alex Rivera');
  const a = `w9afp2ca-${stamp}`;
  await seedCommunity({ groupId: a, displayName: 'Alpharetta Morning Movers', joinPolicy: 'private', members: [{ uid, role: 'member' }] });
  const b = `w9afp2cb-${stamp}`;
  await seedCommunity({ groupId: b, displayName: 'Roswell Lunch Walkers', joinPolicy: 'private', members: [{ uid, role: 'member' }] });
  await seedActiveGoal({
    goalId: `w9afp2cg-${stamp}`,
    groupId: a,
    ownerUid: uid,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total: 1847,
    endsAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
  });
  return { email, a, b };
}

async function easel(page: Page, device: Device, src: string): Promise<{ stage: FrameLocator; label: string }> {
  await page.goto('/health');
  const commit = ((await page.getByTestId('wsf-health-commit').innerText()).match(/[0-9a-f]{7,40}/) ?? [''])[0];
  expect(commit).not.toBe('');
  if (CANDIDATE) expect(commit, 'CANDIDATE must not be the base build').not.toBe(BASE_SHORT);
  else expect(commit, 'MIGRATED must be the base build').toBe(BASE_SHORT);
  const label = `${STAGE} BUILD ${commit} / NOT ACCEPTED`;
  await page.evaluate(
    ({ w, h, banner, label, source }) => {
      document.documentElement.style.background = '#FFFFFF';
      document.body.style.cssText = 'margin:0;padding:0;background:#FFFFFF';
      document.body.innerHTML = `
        <div data-testid="wsf-w9afp2-frame" style="width:${w}px;height:${h + banner}px;background:#FFFFFF;overflow:hidden;">
          <div data-testid="wsf-w9afp2-banner"
               style="height:${banner}px;width:${w}px;background:#0B1F35;color:#F7F5F0;
                      font:700 10px/${banner}px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
                      letter-spacing:.9px;text-align:center;box-sizing:border-box;border-bottom:1px solid #F7F5F0;">${label}</div>
          <iframe id="wsf-w9afp2-stage" src="${source}" style="width:${w}px;height:${h}px;border:0;display:block;"></iframe>
        </div>`;
    },
    { w: device.width, h: device.height, banner: BANNER, label, source: src },
  );
  return { stage: page.frameLocator('#wsf-w9afp2-stage'), label };
}

/** What the stage document says about the journey, read inside the iframe. */
async function readState(stage: FrameLocator, scrollId: string | null) {
  return stage.locator('body').evaluate((_b, id) => {
    const vis = (n: Element) => (n as HTMLElement).getClientRects().length > 0;
    let scroll: number | null = null;
    if (id) {
      let el = Array.from(document.querySelectorAll(`[data-testid="${id}"]`)).find(vis) as HTMLElement | undefined | null;
      while (el) {
        if (el.scrollHeight > el.clientHeight + 1) {
          scroll = Math.round(el.scrollTop);
          break;
        }
        el = el.parentElement;
      }
    }
    return {
      path: location.pathname,
      moveSheets: document.querySelectorAll('[data-testid="wsf-move-sheet"]').length,
      communityInstances: document.querySelectorAll('[data-testid="wsf-community"]').length,
      tabBars: document.querySelectorAll('[data-testid="wsf-member-tab-home"]').length,
      loadingPainted: Array.from(document.querySelectorAll('[data-testid="wsf-community-loading"]')).filter(vis).length,
      scroll,
    };
  }, scrollId);
}

async function shootSequence(
  page: Page,
  device: Device,
  label: string,
  name: string,
  press: () => Promise<void>,
  settledId: string,
  stage: FrameLocator,
  scrollId: string | null = null,
): Promise<void> {
  const frameEl = page.getByTestId('wsf-w9afp2-frame');
  await expect(page.getByTestId('wsf-w9afp2-banner')).toHaveText(label);
  const before = await readState(stage, scrollId);
  // Every loading screen painted from the press on, not only at the shutters.
  await stage.locator('body').evaluate(() => {
    const w = window as unknown as { __afp2seen: string[] };
    w.__afp2seen = [];
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid="wsf-community-loading"]') as HTMLElement | null;
      if (el && el.getClientRects().length > 0 && !w.__afp2seen.includes('wsf-community-loading')) {
        w.__afp2seen.push('wsf-community-loading');
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  const frames: { file: string; mark: number; shutterMs: number; sha256?: string }[] = [];
  const t0 = Date.now();
  await press();
  for (const mark of MARKS) {
    const wait = t0 + mark - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    const at = Date.now() - t0;
    const file = `${STAGE}-${name}-${String(mark).padStart(3, '0')}ms-${device.key}.png`;
    if (CAPTURE_FRAMES) {
      fs.mkdirSync(OUT, { recursive: true });
      await frameEl.screenshot({ path: path.join(OUT, file) });
    }
    frames.push({ file, mark, shutterMs: at });
  }
  await expect(stage.locator(`[data-testid="${settledId}"]:visible`).first()).toBeVisible({ timeout: 40_000 });
  await page.waitForTimeout(1_200);
  const settledFile = `${STAGE}-${name}-settled-${device.key}.png`;
  if (CAPTURE_FRAMES) await frameEl.screenshot({ path: path.join(OUT, settledFile) });
  frames.push({ file: settledFile, mark: -1, shutterMs: Date.now() - t0 });
  const after = await readState(stage, scrollId);
  const loadingSeen = await stage.locator('body').evaluate(() => (window as unknown as { __afp2seen: string[] }).__afp2seen);
  const receipt = { stage: STAGE, label, device: device.key, journey: name, before, after, loadingSeen, frames };
  if (CAPTURE_FRAMES) {
    for (const f of frames) {
      f.sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(OUT, f.file))).digest('hex');
    }
    fs.writeFileSync(path.join(OUT, `${STAGE}-${name}-${device.key}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
  }
  test.info().annotations.push({ type: 'measure', description: JSON.stringify({ name, device: device.key, before, after, loadingSeen }) });
}

test.describe(`APP-FEEL-PARITY-1 cp2 frames · ${STAGE}`, () => {
  test.use({ viewport: { width: 600, height: 1100 }, deviceScaleFactor: 2 });

  for (const device of DEVICES) {
    test(`${device.key}: the wordmark from the Community tab`, async ({ page }) => {
      test.setTimeout(300_000);
      const fx = await seed(`w${device.height}`);
      await signInVia(page, fx.email, PASSWORD);
      const { stage, label } = await easel(page, device, `/community/${fx.a}`);
      await expect(stage.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 60_000 });
      await stage.locator('[data-testid="wsf-member-tab-community"]:visible').last().click();
      await expect(stage.locator('[data-testid="wsf-community-index-rows"]:visible')).toBeVisible({ timeout: 40_000 });
      await page.waitForTimeout(800);
      await shootSequence(
        page,
        device,
        label,
        'wordmark-home',
        () => stage.locator('[data-testid="wsf-member-topbar-wordmark-home"]:visible').last().click(),
        'wsf-community-hero-presence',
        stage,
      );
    });

    test(`${device.key}: the Community tab, first visit after Home`, async ({ page }) => {
      test.setTimeout(300_000);
      const fx = await seed(`c${device.height}`);
      await signInVia(page, fx.email, PASSWORD);
      const { stage, label } = await easel(page, device, `/community/${fx.a}`);
      await expect(stage.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(1_500);
      await shootSequence(
        page,
        device,
        label,
        'community-first',
        () => stage.locator('[data-testid="wsf-member-tab-community"]:visible').last().click(),
        'wsf-community-index-rows',
        stage,
      );
    });

    test(`${device.key}: MOVE with no open goal → “Go to your community”`, async ({ page }) => {
      test.setTimeout(300_000);
      const fx = await seed(`n${device.height}`);
      await signInVia(page, fx.email, PASSWORD);
      const { stage, label } = await easel(page, device, `/community/${fx.b}`);
      await expect(stage.locator('[data-testid="wsf-community-name"]:visible')).toHaveText('Roswell Lunch Walkers', { timeout: 60_000 });
      await page.waitForTimeout(1_000);
      await stage.locator('[data-testid="wsf-community"]:visible').evaluate((el) => {
        let n: HTMLElement | null = el as HTMLElement;
        while (n) {
          if (n.scrollHeight > n.clientHeight + 1) {
            n.scrollTop = 80;
            return;
          }
          n = n.parentElement;
        }
      });
      await page.waitForTimeout(400);
      await stage.locator('[data-testid="wsf-member-tab-move"]:visible').last().click();
      await expect(stage.locator('[data-testid="wsf-move-no-goal"]:visible')).toBeVisible({ timeout: 40_000 });
      await page.waitForTimeout(600);
      await shootSequence(
        page,
        device,
        label,
        'move-nogoal-community',
        () => stage.locator('[data-testid="wsf-move-no-goal-community"]:visible').click(),
        'wsf-community-name',
        stage,
        'wsf-community',
      );
    });

    test(`${device.key}: MOVE could not read → “Go Home” (labelled injection: the goal read fails)`, async ({ page }) => {
      test.setTimeout(300_000);
      const fx = await seed(`g${device.height}`);
      await signInVia(page, fx.email, PASSWORD);
      const { stage, label } = await easel(page, device, `/community/${fx.a}`);
      await expect(stage.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 60_000 });
      await stage.locator('[data-testid="wsf-community"]:visible').evaluate((el) => {
        let n: HTMLElement | null = el as HTMLElement;
        while (n) {
          if (n.scrollHeight > n.clientHeight + 1) {
            n.scrollTop = 120;
            return;
          }
          n = n.parentElement;
        }
      });
      await page.waitForTimeout(400);
      await page.route('**/wsfListGoals', (route) => route.abort('failed'));
      await stage.locator('[data-testid="wsf-member-tab-move"]:visible').last().click();
      await expect(stage.locator('[data-testid="wsf-move-error-home"]:visible')).toBeVisible({ timeout: 40_000 });
      await page.unroute('**/wsfListGoals');
      await page.waitForTimeout(600);
      await shootSequence(
        page,
        device,
        label,
        'move-error-home',
        () => stage.locator('[data-testid="wsf-move-error-home"]:visible').click(),
        'wsf-community-hero-presence',
        stage,
        'wsf-community',
      );
    });
  }
});
