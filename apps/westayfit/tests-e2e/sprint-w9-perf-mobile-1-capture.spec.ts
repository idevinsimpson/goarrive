import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type Frame, type Page } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';
import { seedActiveGoal, seedCommunity, seedMembership, seedProfile, seedVerifiedUser, signInVia, stampId } from './helpers/mobile';

/**
 * W9 — PERF-MOBILE-1 CHECKPOINT 1: TRANSITION TIMELINES.
 *
 *   WSF_PERF_STAGE=BASE       development `0b460ce3`, served
 *   WSF_PERF_STAGE=CANDIDATE  this checkpoint's product build, served
 *
 * At 390x640 and 390x844, from the member's Home: Home -> Progress,
 * Progress -> You, then Home -> MOVE. For each: a frame at nominally 0, 150
 * and 600 ms after the press and one settled, plus a video of the whole run.
 *
 * LABELLED INSTRUMENTATION: every callable answer is held 1.5 s at the
 * network boundary once Home has settled, so what a member sees WHILE the
 * reads are out is on screen long enough to photograph. The receipt carries
 * each frame's actual shutter time and every loading state painted.
 *
 * Each frame carries its stage, the served build's commit and "NOT
 * ACCEPTED"; writes only with WSF_CAPTURE_FRAMES=1. Everything is SYNTHETIC.
 */

const OUT = path.resolve(__dirname, '../../../docs/design-target/review/perf-mobile-1');
const STAGE = (process.env.WSF_PERF_STAGE ?? 'CANDIDATE').toUpperCase();
if (STAGE !== 'BASE' && STAGE !== 'CANDIDATE') throw new Error(`bad stage ${STAGE}`);
const BASE_SHORT = '0b460ce3';
const BANNER = 18;
const HOLD_MS = 1_500;
const PASSWORD = 'Sup3rSecret!23';
const LOADING = ['wsf-activity-loading', 'wsf-you-loading', 'wsf-move-working', 'wsf-community-loading'];
const DEVICES = [
  { key: '390x640', width: 390, height: 640 },
  { key: '390x844', width: 390, height: 844 },
] as const;

async function seed(tag: string) {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-w9-perfc-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Alex Rivera');
  const dana = `w9perfc-dana-${stamp}`;
  await seedProfile(dana, 'Dana Whitfield');
  const groupId = `w9perfcc-${stamp}`;
  await seedCommunity({ groupId, displayName: 'Alpharetta Morning Movers', joinPolicy: 'private', members: [{ uid, role: 'member' }] });
  await seedMembership(groupId, dana, 'foundingChampion');
  const goalId = `w9perfcg-${stamp}`;
  await seedActiveGoal({ goalId, groupId, ownerUid: dana, title: 'October Squat Challenge', target: 5000, unit: 'squats', total: 1847 });
  return { email, groupId };
}

test.describe(`PERF-MOBILE-1 cp1 timelines · ${STAGE}`, () => {
  for (const device of DEVICES) {
    test(`${device.key}: Home -> Progress -> You, Home -> MOVE`, async ({ browser }) => {
      test.setTimeout(300_000);
      const fx = await seed(`t${device.height}`);
      const videoDir = path.join(test.info().outputDir, 'video');
      const context = await browser.newContext({
        viewport: { width: device.width, height: device.height + BANNER },
        deviceScaleFactor: 1,
        recordVideo: CAPTURE_FRAMES ? { dir: videoDir, size: { width: device.width, height: device.height + BANNER } } : undefined,
      });
      await context.addInitScript((ids: string[]) => {
        const seen: Array<{ id: string; t: number }> = [];
        (window as unknown as { __seen: typeof seen }).__seen = seen;
        const tick = () => {
          for (const id of ids) {
            for (const el of Array.from(document.querySelectorAll(`[data-testid="${id}"]`))) {
              const r = (el as HTMLElement).getBoundingClientRect();
              if (r.width > 0 && r.height > 0) seen.push({ id, t: Date.now() });
            }
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, LOADING);
      const page = await context.newPage();
      await signInVia(page, fx.email, PASSWORD);

      await page.goto('/health');
      const commit = ((await page.getByTestId('wsf-health-commit').innerText()).match(/[0-9a-f]{7,40}/) ?? [''])[0];
      if (STAGE === 'BASE') expect(commit).toBe(BASE_SHORT);
      else expect(commit).not.toBe(BASE_SHORT);
      const label = `${STAGE} BUILD ${commit} / NOT ACCEPTED`;
      await page.evaluate(
        ({ w, h, banner, label, source }) => {
          document.documentElement.style.background = '#FFFFFF';
          document.body.style.cssText = 'margin:0;padding:0;background:#FFFFFF';
          document.body.innerHTML = `
            <div data-testid="wsf-w9perf-frame" style="width:${w}px;height:${h + banner}px;background:#FFFFFF;overflow:hidden;">
              <div data-testid="wsf-w9perf-banner" style="height:${banner}px;width:${w}px;background:#0B1F35;color:#F7F5F0;font:700 10px/${banner}px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;letter-spacing:.9px;text-align:center;box-sizing:border-box;border-bottom:1px solid #F7F5F0;">${label}</div>
              <iframe id="wsf-w9perf-stage" src="${source}" style="width:${w}px;height:${h}px;border:0;display:block;"></iframe>
            </div>`;
        },
        { w: device.width, h: device.height, banner: BANNER, label, source: `/community/${fx.groupId}` },
      );
      const stage = page.frameLocator('#wsf-w9perf-stage');
      await expect(stage.locator('[data-testid="wsf-community-goal-hero"]:visible')).toContainText('1,847', { timeout: 60_000 });
      await page.waitForTimeout(1_500);
      const frame = (): Frame => page.frames().find((f) => f.url().includes('/community/') || f.url().includes('/activity') || f.url().includes('/you') || f.url().includes('/contribute') || f.url().includes('/move')) as Frame;

      // Labelled instrumentation: every callable answer held HOLD_MS from here.
      await page.route(/:5001\//, async (route) => {
        await new Promise((r) => setTimeout(r, HOLD_MS));
        await route.continue();
      });

      const files: string[] = [];
      const journeys: Record<string, unknown> = {};
      const shoot = async (name: string) => {
        const file = `${STAGE}-${name}-${device.key}.png`;
        if (CAPTURE_FRAMES) {
          fs.mkdirSync(OUT, { recursive: true });
          await page.getByTestId('wsf-w9perf-frame').screenshot({ path: path.join(OUT, file) });
        }
        files.push(file);
      };
      const journey = async (name: string, press: () => Promise<void>, ready: string) => {
        const f = frame();
        const mark = await f.evaluate(() => (window as unknown as { __seen: unknown[] }).__seen.length);
        const t0 = Date.now();
        await press();
        const shutters: number[] = [];
        for (const nominal of [0, 150, 600]) {
          const wait = t0 + nominal - Date.now();
          if (wait > 0) await page.waitForTimeout(wait);
          shutters.push(Date.now() - t0);
          await shoot(`${name}-${String(nominal).padStart(3, '0')}ms`);
        }
        await expect(stage.locator(ready).first()).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(HOLD_MS + 800);
        shutters.push(Date.now() - t0);
        await shoot(`${name}-settled`);
        const seen = await frame().evaluate(
          ({ m, start }) =>
            (window as unknown as { __seen: Array<{ id: string; t: number }> }).__seen
              .slice(m)
              .filter((e) => e.t >= start),
          { m: mark, start: t0 },
        );
        const byId: Record<string, { firstMs: number; lastMs: number }> = {};
        for (const e of seen) {
          const cur = byId[e.id];
          byId[e.id] = { firstMs: Math.min(cur?.firstMs ?? Infinity, e.t - t0), lastMs: Math.max(cur?.lastMs ?? 0, e.t - t0) };
        }
        journeys[name] = { shutterMsFromPress: shutters, loadingPainted: byId };
      };

      await journey('progress', () => stage.locator('[data-testid="wsf-member-tab-activity"]:visible').last().click(), '[data-testid="wsf-activity-rows"]:visible, [data-testid="wsf-activity-empty"]:visible');
      await journey('you', () => stage.locator('[data-testid="wsf-member-tab-you"]:visible').last().click(), '[data-testid="wsf-you-member"]:visible');
      await stage.locator('[data-testid="wsf-member-tab-home"]:visible').last().click();
      await page.waitForTimeout(HOLD_MS + 1_500);
      await journey('move', () => stage.locator('[data-testid="wsf-member-tab-move"]:visible').last().click(), '[data-testid="wsf-contribute-timer"]:visible');

      const video = page.video();
      await context.close();
      if (CAPTURE_FRAMES) {
        const receipt: Record<string, unknown> = {
          stage: STAGE,
          commit,
          device: device.key,
          instrumentation: `every callable answer held ${HOLD_MS} ms after Home settled`,
          journeys,
          frames: files.map((f) => ({ file: f, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(OUT, f))).digest('hex') })),
        };
        if (video) {
          const dest = path.join(OUT, `${STAGE}-timeline-${device.key}.webm`);
          await video.saveAs(dest);
          receipt.video = { file: path.basename(dest), sha256: crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex') };
        }
        fs.writeFileSync(path.join(OUT, `${STAGE}-timeline-${device.key}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
      }
    });
  }
});
