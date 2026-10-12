import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type FrameLocator, type Page } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';
import { seedActiveGoal, seedCommunity, seedProfile, seedVerifiedUser, signInVia, stampId } from './helpers/mobile';

/**
 * W9 — APP-FEEL-PARITY-1 CHECKPOINT 3: THE FRAMES.
 *
 *   WSF_APP_FEEL_STAGE=MIGRATED   the development base 0b460ce3, served
 *   WSF_APP_FEEL_STAGE=CANDIDATE  this checkpoint's build, served
 *
 * States at 390x640 and 390x844:
 *   community-tab     the Community tab (chips on the candidate)
 *   chose-b           after choosing the second community (a chip on the
 *                     candidate; the "ALSO YOURS" row on the base), then Home
 *   settings-open     Settings opened from the top bar's menu, settled
 * CANDIDATE only, 390x844:
 *   settings-entry-{000,120,240}ms / settings-exit-{000,090,170}ms  the
 *     panel's own CSS animations paused at fixed times; the exit's 180 ms
 *     navigation timer held while photographed, then released (labelled
 *     instrumentation, as in checkpoint 1)
 *   tab-fade-{000,070,140}ms  the entering tab's content fade (a CSS
 *     animation, `data-wsf-tab-scene`) paused at fixed times, with its 200 ms
 *     clean-up timer held while photographed, then released (labelled
 *     instrumentation). The receipt also carries the fade measured unpaused,
 *     per frame, on a separate press.
 *
 * Each frame carries its stage, the served build's commit and "NOT
 * ACCEPTED"; writes only with WSF_CAPTURE_FRAMES=1. Everything is SYNTHETIC.
 */

const OUT = path.resolve(__dirname, '../../../docs/design-target/review/app-feel-parity-3');
const STAGE = (process.env.WSF_APP_FEEL_STAGE ?? 'CANDIDATE').toUpperCase();
if (STAGE !== 'MIGRATED' && STAGE !== 'CANDIDATE') throw new Error(`bad stage ${STAGE}`);
const CANDIDATE = STAGE === 'CANDIDATE';
const BASE_SHORT = '0b460ce3';
const BANNER = 18;
const PASSWORD = 'Sup3rSecret!23';
const DEVICES = [
  { key: '390x640', width: 390, height: 640 },
  { key: '390x844', width: 390, height: 844 },
] as const;
type Device = (typeof DEVICES)[number];

async function seed(tag: string) {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-w9-afp3c-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Alex Rivera');
  const a = `w9afp3ca-${stamp}`;
  const b = `w9afp3cb-${stamp}`;
  await seedCommunity({ groupId: a, displayName: 'Alpharetta Morning Movers', joinPolicy: 'private', members: [{ uid, role: 'member' }] });
  await seedCommunity({ groupId: b, displayName: 'Roswell Lunch Walkers', joinPolicy: 'private', members: [{ uid, role: 'member' }] });
  await seedActiveGoal({
    goalId: `w9afp3cg-${stamp}`,
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
  if (CANDIDATE) expect(commit).not.toBe(BASE_SHORT);
  else expect(commit).toBe(BASE_SHORT);
  const label = `${STAGE} BUILD ${commit} / NOT ACCEPTED`;
  await page.evaluate(
    ({ w, h, banner, label, source }) => {
      document.documentElement.style.background = '#FFFFFF';
      document.body.style.cssText = 'margin:0;padding:0;background:#FFFFFF';
      document.body.innerHTML = `
        <div data-testid="wsf-w9afp3-frame" style="width:${w}px;height:${h + banner}px;background:#FFFFFF;overflow:hidden;">
          <div data-testid="wsf-w9afp3-banner"
               style="height:${banner}px;width:${w}px;background:#0B1F35;color:#F7F5F0;
                      font:700 10px/${banner}px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
                      letter-spacing:.9px;text-align:center;box-sizing:border-box;border-bottom:1px solid #F7F5F0;">${label}</div>
          <iframe id="wsf-w9afp3-stage" src="${source}" style="width:${w}px;height:${h}px;border:0;display:block;"></iframe>
        </div>`;
    },
    { w: device.width, h: device.height, banner: BANNER, label, source: src },
  );
  return { stage: page.frameLocator('#wsf-w9afp3-stage'), label };
}

const receipt: Record<string, unknown> = {};
const files: string[] = [];

async function shoot(page: Page, device: Device, label: string, name: string, settle = 800): Promise<void> {
  const frameEl = page.getByTestId('wsf-w9afp3-frame');
  await expect(page.getByTestId('wsf-w9afp3-banner')).toHaveText(label);
  if (settle) await page.waitForTimeout(settle);
  const file = `${STAGE}-${name}-${device.key}.png`;
  if (CAPTURE_FRAMES) {
    fs.mkdirSync(OUT, { recursive: true });
    await frameEl.screenshot({ path: path.join(OUT, file) });
  }
  files.push(file);
}

function writeReceipt(name: string, device: Device, data: Record<string, unknown>): void {
  if (!CAPTURE_FRAMES) return;
  const withDigests = {
    ...data,
    stage: STAGE,
    device: device.key,
    frames: files.splice(0).map((f) => ({
      file: f,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(OUT, f))).digest('hex'),
    })),
  };
  fs.writeFileSync(path.join(OUT, `${STAGE}-${name}-${device.key}.json`), `${JSON.stringify(withDigests, null, 2)}\n`);
  void receipt;
}

async function holdAnimationsAt(
  stage: FrameLocator,
  t: number,
  selector = '[data-wsf-side-panel], [data-wsf-sheet-scrim]',
): Promise<number> {
  return stage.locator('body').evaluate(
    (_b, { at, sel }) => {
      const anims = document.getAnimations().filter((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
        return Boolean(target?.matches?.(sel));
      });
      anims.forEach((a) => {
        a.pause();
        a.currentTime = at;
      });
      return anims.length;
    },
    { at: t, sel: selector },
  );
}

/** Holds every timer of exactly `ms` until `releaseTimers` (labelled instrumentation). */
async function holdTimers(stage: FrameLocator, ms: number): Promise<void> {
  await stage.locator('body').evaluate((_b, hold) => {
    const w = window as unknown as { __w9Held: (() => void)[]; __w9Orig: typeof setTimeout };
    w.__w9Held = [];
    w.__w9Orig = window.setTimeout;
    (window as unknown as { setTimeout: unknown }).setTimeout = ((fn: () => void, t?: number, ...rest: unknown[]) => {
      if (t === hold) {
        w.__w9Held.push(fn);
        return -1;
      }
      return w.__w9Orig(fn, t, ...(rest as []));
    }) as unknown;
  }, ms);
}

async function releaseTimers(stage: FrameLocator): Promise<number> {
  return stage.locator('body').evaluate(() => {
    const w = window as unknown as { __w9Held: (() => void)[]; __w9Orig: typeof setTimeout };
    (window as unknown as { setTimeout: unknown }).setTimeout = w.__w9Orig;
    const n = w.__w9Held.length;
    w.__w9Held.splice(0).forEach((fn) => fn());
    return n;
  });
}

test.describe(`APP-FEEL-PARITY-1 cp3 frames · ${STAGE}`, () => {
  test.use({ viewport: { width: 600, height: 1100 }, deviceScaleFactor: 2 });

  for (const device of DEVICES) {
    test(`${device.key}: the Community tab, choosing the second community, Home, and Settings`, async ({ page }) => {
      test.setTimeout(300_000);
      const fx = await seed(`s${device.height}`);
      await signInVia(page, fx.email, PASSWORD);
      const { stage, label } = await easel(page, device, `/community/${fx.a}`);
      await expect(stage.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 60_000 });
      await stage.locator('[data-testid="wsf-member-tab-community"]:visible').last().click();
      await expect(stage.locator('[data-testid="wsf-community-index-rows"]:visible')).toBeVisible({ timeout: 40_000 });
      await shoot(page, device, label, 'community-tab', 1_500);

      // Choose B: the chip on the candidate, the row (which leaves the tab) on the base.
      if (CANDIDATE) {
        await stage.locator(`[data-testid="wsf-community-index-chip-${fx.b}"]:visible`).click();
        await expect(stage.locator(`[data-testid="wsf-community-index-chip-${fx.b}"]:visible`)).toHaveAttribute('aria-pressed', 'true');
      } else {
        await stage.locator(`[data-testid="wsf-community-index-row-${fx.b}"]:visible`).click();
        await expect(stage.locator('[data-testid="wsf-community-name"]:visible')).toHaveText('Roswell Lunch Walkers', { timeout: 40_000 });
        await stage.locator('[data-testid="wsf-member-tab-community"]:visible').last().click();
      }
      await shoot(page, device, label, 'chose-b-community-tab', 1_500);
      await stage.locator('[data-testid="wsf-member-tab-home"]:visible').last().click();
      await page.waitForTimeout(1_500);
      await shoot(page, device, label, 'chose-b-home', 800);
      const homeName = await stage.locator('[data-testid="wsf-community-name"]:visible').first().innerText().catch(() => null);

      await stage.locator('[data-testid="wsf-member-topbar-menu-button"]:visible').last().click();
      await stage.locator('[data-testid="wsf-member-topbar-menu-settings"]:visible').last().click();
      await page.waitForTimeout(800);
      await shoot(page, device, label, 'settings-open', 400);
      const panelPainted = await stage.locator('[data-testid="wsf-settings-panel"]').count();
      writeReceipt('states', device, { homeAfterChoosingB: homeName, settingsPanel: panelPainted });
    });
  }

  test('390x844: the Settings panel in and out, paused; the tab fade, measured (CANDIDATE only)', async ({ page }) => {
    test.skip(!CANDIDATE, 'the base build has no panel or fade');
    test.setTimeout(300_000);
    const device = DEVICES[1];
    const fx = await seed('t');
    await signInVia(page, fx.email, PASSWORD);
    const { stage, label } = await easel(page, device, `/community/${fx.a}`);
    await expect(stage.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(800);

    await stage.locator('[data-testid="wsf-member-topbar-menu-button"]:visible').last().click();
    await stage.locator('[data-testid="wsf-member-topbar-menu-settings"]:visible').last().click();
    await expect(stage.locator('[data-testid="wsf-settings-panel"]')).toHaveCount(1, { timeout: 20_000 });
    const held: number[] = [];
    for (const t of [0, 120, 240]) {
      held.push(await holdAnimationsAt(stage, t));
      await shoot(page, device, label, `settings-entry-${String(t).padStart(3, '0')}ms`, 0);
    }
    await page.waitForTimeout(300);
    // Exit: the 180 ms navigation timer is held while the exit is photographed.
    await holdTimers(stage, 180);
    await stage.locator('[data-testid="wsf-settings-close"]:visible').click();
    for (const t of [0, 90, 170]) {
      held.push(await holdAnimationsAt(stage, t));
      await shoot(page, device, label, `settings-exit-${String(t).padStart(3, '0')}ms`, 0);
    }
    const released = await releaseTimers(stage);
    expect(released, 'exactly one exit was pending').toBe(1);
    await expect(stage.locator('[data-testid="wsf-settings-panel"]')).toHaveCount(0, { timeout: 8_000 });
    writeReceipt('settings-timeline', device, { animationsHeldPerFrame: held, exitsReleased: released });

    // The tab fade, unpaused: the entering content's opacity per frame.
    await stage.locator('[data-testid="wsf-member-tab-community"]:visible').last().click();
    await expect(stage.locator('[data-testid="wsf-community-index-rows"]:visible')).toBeVisible({ timeout: 40_000 });
    await stage.locator('[data-testid="wsf-member-tab-home"]:visible').last().click();
    await page.waitForTimeout(1_000);
    const sampler = stage.locator('body').evaluate(async () => {
      const out: { t: number; o: number }[] = [];
      const t0 = performance.now();
      while (performance.now() - t0 < 500) {
        const el = document.querySelector('[data-testid="wsf-community-index"]') as HTMLElement | null;
        if (el) {
          let o = 1;
          for (let n: HTMLElement | null = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
          out.push({ t: Math.round(performance.now() - t0), o: Math.round(o * 100) / 100 });
        }
        await new Promise((r) => requestAnimationFrame(r));
      }
      return out;
    });
    await stage.locator('[data-testid="wsf-member-tab-community"]:visible').last().click();
    const opacity = await sampler;

    // The tab fade, paused: back to Home, then Community again, held at fixed times.
    await stage.locator('[data-testid="wsf-member-tab-home"]:visible').last().click();
    await page.waitForTimeout(1_000);
    await holdTimers(stage, 200);
    await stage.locator('[data-testid="wsf-member-tab-community"]:visible').last().click();
    const fadeHeld: number[] = [];
    for (const t of [0, 70, 140]) {
      fadeHeld.push(await holdAnimationsAt(stage, t, '[data-wsf-tab-scene]'));
      await shoot(page, device, label, `tab-fade-${String(t).padStart(3, '0')}ms`, 0);
    }
    const fadeTimersReleased = await releaseTimers(stage);
    expect(fadeHeld, 'the fade was held for every frame').toEqual([1, 1, 1]);
    writeReceipt('tab-fade', device, {
      animationsHeldPerFrame: fadeHeld,
      timersReleased: fadeTimersReleased,
      measuredOpacityFromSamplerStart: opacity,
    });
  });
});
