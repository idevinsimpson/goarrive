import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type FrameLocator, type Page, type Route } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';
import {
  seedActiveGoal,
  seedCommunity,
  seedMembership,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * W9 — RETURN-CONTINUITY-1: THE HOME A MEMBER LANDS ON AFTER CONTRIBUTING
 * (L0 #477 `5826542101`; Director #365 `5825324407`).
 *
 * Three states, each reached through a real return from the contribution
 * flow ("Already moved?" → record → "Back to community"), photographed at
 * 390×844 and 390×640 inside an easel that names the stage, the served
 * build's commit and "NOT ACCEPTED":
 *
 *   confirmed-return                     the write confirmed; Home must agree
 *                                        with the receipt.
 *   unknown-return-INJECTED-REQUEST-DROPPED
 *                                        the request never reached the server
 *                                        (injected); Home must exclude the
 *                                        amount and predict nothing.
 *   refresh-failed-INJECTED              after a confirmed return, every
 *                                        progress read is refused (injected)
 *                                        and Refresh is pressed.
 *
 * What each state must show is asserted before the shutter. MIGRATED asserts
 * what the base does (measured first, including the silent failure W7
 * recorded in Check 27 item 9); CANDIDATE asserts this packet's contract.
 *
 *   WSF_RETURN_CONTINUITY_STAGE=MIGRATED   the development base 6b96ba1b
 *   WSF_RETURN_CONTINUITY_STAGE=CANDIDATE  this packet's build
 *
 * Writes only with WSF_CAPTURE_FRAMES=1 (this file only). Everything seeded
 * here is SYNTHETIC. Chromium, local emulators.
 */

const OUT = path.resolve(__dirname, '../../../docs/design-target/review/return-continuity-1');

const STAGE = (process.env.WSF_RETURN_CONTINUITY_STAGE ?? 'CANDIDATE').toUpperCase();
if (STAGE !== 'MIGRATED' && STAGE !== 'CANDIDATE') {
  throw new Error(`WSF_RETURN_CONTINUITY_STAGE must be MIGRATED or CANDIDATE, not ${STAGE}`);
}
const CANDIDATE = STAGE === 'CANDIDATE';

/** The development base this packet started from, as /health prints it. */
const BASE_SHORT = '6b96ba1b';
const BANNER = 18;
const DEVICES = [
  { key: '390x844', width: 390, height: 844 },
  { key: '390x640', width: 390, height: 640 },
] as const;
type Device = (typeof DEVICES)[number];

const PASSWORD = 'Sup3rSecret!23';
const TOTAL = 1847;
const TARGET = 5000;
const ADDED = 20;

type Fx = { email: string; uid: string; groupId: string; goalId: string };

async function seed(tag: string): Promise<Fx> {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-w9-rc-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `w9rc-${stamp}`;
  const goalId = `w9rcgoal-${stamp}`;
  const dana = `w9rc-dana-${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'private',
    members: [{ uid, role: 'member' }],
  });
  await seedMembership(groupId, dana, 'foundingChampion');
  await seedProfile(dana, 'Dana Whitfield');
  await seedActiveGoal({
    goalId,
    groupId,
    ownerUid: dana,
    title: 'October Squat Challenge',
    target: TARGET,
    unit: 'squats',
    total: TOTAL,
  });
  return { email, uid, groupId, goalId };
}

/** The easel: a labelled strip flush above an iframe of the device size. */
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
        <div data-testid="wsf-w9rc-frame"
             style="width:${w}px;height:${h + banner}px;background:#FFFFFF;overflow:hidden;">
          <div data-testid="wsf-w9rc-banner"
               style="height:${banner}px;width:${w}px;background:#0B1F35;color:#F7F5F0;
                      font:700 10px/${banner}px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
                      letter-spacing:.9px;text-align:center;box-sizing:border-box;
                      border-bottom:1px solid #F7F5F0;">${label}</div>
          <iframe id="wsf-w9rc-stage" name="wsf-w9rc-stage" src="${source}"
                  style="width:${w}px;height:${h}px;border:0;display:block;"></iframe>
        </div>`;
    },
    { w: device.width, h: device.height, banner: BANNER, label, source: src },
  );
  return { stage: page.frameLocator('#wsf-w9rc-stage'), label };
}

async function shoot(page: Page, label: string, name: string, device: Device): Promise<void> {
  const frameEl = page.getByTestId('wsf-w9rc-frame');
  const box = (await frameEl.boundingBox())!;
  expect(Math.round(box.width), `${name} ${device.key}: frame width`).toBe(device.width);
  expect(Math.round(box.height), `${name} ${device.key}: frame height`).toBe(device.height + BANNER);
  await expect(page.getByTestId('wsf-w9rc-banner')).toHaveText(label);
  if (CAPTURE_FRAMES) {
    fs.mkdirSync(OUT, { recursive: true });
    await frameEl.screenshot({ path: path.join(OUT, `${STAGE}-${name}-${device.key}.png`) });
  }
}

function measure(label: string, value: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`MEASURE ${label}: ${JSON.stringify(value)}`);
  test.info().annotations.push({ type: 'measure', description: `${label}: ${JSON.stringify(value)}` });
}

/** The write, under the journey's control. */
function contributeRoute(page: Page) {
  const control = { mode: 'pass' as 'pass' | 'drop' | 'landButDrop' };
  const ready = page.route('**/wsfContribute', async (route: Route) => {
    if (control.mode === 'drop') {
      // The request never reaches the server (labelled injection).
      await route.abort('failed');
      return;
    }
    if (control.mode === 'landButDrop') {
      // The server records it; the browser never hears back (labelled injection).
      await route.fetch();
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  return { control, ready };
}

/** "Already moved?" from the community's own hero, then 20 recorded. */
async function recordFromHome(stage: FrameLocator, fx: Fx): Promise<void> {
  const launcher = stage.getByTestId(`wsf-community-goal-record-${fx.goalId}`);
  await expect(launcher).toBeVisible({ timeout: 60_000 });
  await launcher.click();
  await expect(stage.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });
  await stage.getByTestId('wsf-contribute-entry').fill(String(ADDED));
  await stage.getByTestId('wsf-contribute-review').click();
  await expect(stage.getByTestId('wsf-contribute-review-screen')).toBeVisible({ timeout: 20_000 });
  await stage.getByTestId('wsf-contribute-submit').click();
}

async function backToCommunity(stage: FrameLocator, fx: Fx): Promise<void> {
  const exit = stage.locator('[data-testid="wsf-contribute-back"]:visible').first();
  await expect(exit).toHaveText('Back to community', { timeout: 30_000 });
  await exit.click();
  await expect(stage.locator('[data-testid="wsf-community-goal-hero"]:visible')).toBeVisible({ timeout: 40_000 });
  await expect(stage.locator(`[data-testid="wsf-community-goal-total-${fx.goalId}"]:visible`)).toBeVisible({
    timeout: 40_000,
  });
}

/** Past the settle read (2.6 s after focus) and the pulse cache. */
async function settle(stage: FrameLocator): Promise<void> {
  await stage.locator('body').evaluate(() => new Promise((r) => setTimeout(r, 4_000)));
}

type HomeReading = {
  total: string;
  updated: string | null;
  yourPart: string | null;
  momentum: string | null;
  heroText: string;
  pageText: string;
};

async function readHome(stage: FrameLocator, fx: Fx): Promise<HomeReading> {
  return stage.locator('body').evaluate((_b, goalId) => {
    const shown = (id: string) =>
      (Array.from(document.querySelectorAll(`[data-testid="${id}"]`)) as HTMLElement[]).find(
        (e) => e.getClientRects().length > 0,
      ) ?? null;
    const text = (id: string) => shown(id)?.innerText.replace(/\s+/g, ' ').trim() ?? null;
    return {
      total: text(`wsf-community-goal-total-${goalId}`) ?? '',
      updated: text('wsf-community-progress-updated'),
      yourPart: text(`wsf-community-your-part-${goalId}`),
      momentum: text('wsf-community-momentum-card'),
      heroText: text('wsf-community-goal-hero') ?? '',
      pageText: (shown('wsf-community')?.innerText ?? '').replace(/\s+/g, ' '),
    };
  }, fx.goalId);
}

const fmt = (n: number) => n.toLocaleString('en-US');

for (const device of DEVICES) {
  test.describe(`RETURN-CONTINUITY-1 frames · ${STAGE} · ${device.key}`, () => {
    test.use({ viewport: { width: 600, height: 1100 }, deviceScaleFactor: 2 });

    test('confirmed return: Home agrees with the receipt', async ({ page }) => {
      test.setTimeout(240_000);
      const fx = await seed(`c${device.height}`);
      await signInVia(page, fx.email, PASSWORD);
      const { stage, label } = await easel(page, device, `/community/${fx.groupId}`);
      await recordFromHome(stage, fx);
      const receipt = stage.getByTestId('wsf-contribute-receipt');
      await expect(receipt).toBeVisible({ timeout: 40_000 });
      const receiptShared = (await stage.getByTestId('wsf-contribute-shared-total').innerText()).trim();
      const receiptOwn = (await stage.getByTestId('wsf-contribute-own-credit').innerText()).trim();
      await backToCommunity(stage, fx);
      await settle(stage);
      const home = await readHome(stage, fx);
      measure(`${device.key} confirmed · receipt`, { receiptShared, receiptOwn });
      measure(`${device.key} confirmed · Home`, home);
      expect(receiptShared).toContain(fmt(TOTAL + ADDED));
      expect(home.total, 'Home agrees with the receipt').toContain(fmt(TOTAL + ADDED));
      expect(home.yourPart, 'the own row agrees with the receipt').toContain(`${ADDED} squats`);
      expect(home.updated ?? '').toMatch(/^Confirmed \d{1,2}:\d{2}/);
      expect(home.pageText, 'nothing reads as stale on a confirmed return').not.toMatch(/last known|couldn’t|unavailable/i);
      await stage.locator('body').evaluate(() => {
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) if (el.scrollTop > 0) el.scrollTop = 0;
      });
      await shoot(page, label, 'confirmed-return', device);
    });

    test('unknown return (request dropped): Home excludes the amount and predicts nothing', async ({ page }) => {
      test.setTimeout(240_000);
      const fx = await seed(`u${device.height}`);
      const { control, ready } = contributeRoute(page);
      await ready;
      await signInVia(page, fx.email, PASSWORD);
      const { stage, label } = await easel(page, device, `/community/${fx.groupId}`);
      control.mode = 'drop';
      await recordFromHome(stage, fx);
      await expect(stage.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 40_000 });
      control.mode = 'pass';
      await backToCommunity(stage, fx);
      await settle(stage);
      const home = await readHome(stage, fx);
      measure(`${device.key} unknown (dropped) · Home`, home);
      expect(home.total, 'the unconfirmed amount is not in the shared total').toContain(fmt(TOTAL));
      expect(home.total).not.toContain(fmt(TOTAL + ADDED));
      expect(home.yourPart ?? '', 'the unconfirmed amount is not in the own row').not.toContain(`${ADDED} squats`);
      expect(home.momentum ?? '', 'no row for an unconfirmed attempt').not.toMatch(new RegExp(`\\+\\s*${ADDED}\\b`));
      await stage.locator('body').evaluate(() => {
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) if (el.scrollTop > 0) el.scrollTop = 0;
      });
      await shoot(page, label, 'unknown-return-INJECTED-REQUEST-DROPPED', device);
    });

    test('refresh fails after the return: what the member is told', async ({ page }) => {
      test.setTimeout(240_000);
      const fx = await seed(`r${device.height}`);
      await signInVia(page, fx.email, PASSWORD);
      const { stage, label } = await easel(page, device, `/community/${fx.groupId}`);
      await recordFromHome(stage, fx);
      await expect(stage.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 40_000 });
      await backToCommunity(stage, fx);
      await settle(stage);
      const before = await readHome(stage, fx);
      // LABELLED INJECTION: every progress read is refused from here on.
      await page.route('**/wsfGoalPulse', (route) => route.abort('failed'));
      await stage.locator('[data-testid="wsf-community-progress-refresh"]:visible').first().click();
      await settle(stage);
      const after = await readHome(stage, fx);
      measure(`${device.key} refresh failed · before`, before);
      measure(`${device.key} refresh failed · after`, after);
      expect(after.total, 'the retained figure stays').toBe(before.total);
      expect(after.updated, 'the confirmation stamp does not advance').toBe(before.updated);
      if (CANDIDATE) {
        expect(after.pageText, 'the member is told the refresh did not happen').toMatch(/last known/i);
      } else {
        // THE BASE, AS W7 MEASURED IT (Check 27 item 9): silent.
        expect(after.pageText, 'the base says nothing').not.toMatch(/last known|couldn’t|unavailable|retry/i);
      }
      await stage.locator('body').evaluate(() => {
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) if (el.scrollTop > 0) el.scrollTop = 0;
      });
      await shoot(page, label, 'refresh-failed-INJECTED', device);
    });
  });
}

test.describe(`RETURN-CONTINUITY-1 · measured, no frame · ${STAGE}`, () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('unknown return (write landed, reply lost): Home shows the server’s total, adds nothing itself', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('l');
    const { control, ready } = contributeRoute(page);
    await ready;
    await signInVia(page, fx.email, PASSWORD);
    await page.goto(`/community/${fx.groupId}`);
    const launcher = page.locator(`[data-testid="wsf-community-goal-record-${fx.goalId}"]:visible`).first();
    await expect(launcher).toBeVisible({ timeout: 60_000 });
    await launcher.click();
    await page.locator('[data-testid="wsf-contribute-entry"]:visible').first().fill(String(ADDED));
    await page.locator('[data-testid="wsf-contribute-review"]:visible').first().click();
    control.mode = 'landButDrop';
    await page.locator('[data-testid="wsf-contribute-submit"]:visible').first().click();
    await expect(page.locator('[data-testid="wsf-contribute-pending"]:visible')).toBeVisible({ timeout: 40_000 });
    control.mode = 'pass';
    const exit = page.locator('[data-testid="wsf-contribute-back"]:visible').first();
    await exit.click();
    await expect(page.locator(`[data-testid="wsf-community-goal-total-${fx.goalId}"]:visible`)).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(4_000);
    const home = await page.evaluate((goalId) => {
      const shown = (id: string) =>
        (Array.from(document.querySelectorAll(`[data-testid="${id}"]`)) as HTMLElement[]).find(
          (e) => e.getClientRects().length > 0,
        ) ?? null;
      return {
        total: shown(`wsf-community-goal-total-${goalId}`)?.innerText.replace(/\s+/g, ' ') ?? '',
        yourPart: shown(`wsf-community-your-part-${goalId}`)?.innerText.replace(/\s+/g, ' ') ?? null,
      };
    }, fx.goalId);
    measure('unknown (landed, reply lost) · Home', home);
    // The server recorded it, so its own total includes it: authoritative, not
    // a prediction. Nothing beyond that is added (no double count).
    expect(home.total).toContain(fmt(TOTAL + ADDED));
    expect(home.total).not.toContain(fmt(TOTAL + 2 * ADDED));
  });
});
