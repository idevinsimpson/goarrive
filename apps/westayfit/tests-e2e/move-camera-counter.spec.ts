/**
 * MOVE-CAMERA-NATIVE-PORT-1 — the camera-assisted squat MOVE flow.
 *
 * SYNTHETIC POSES, NO CAMERA. Every test here installs the emulator-only,
 * loopback-only test pose source (`window.__WSF_TEST_POSE__`, read by
 * src/movement-camera/source.ts only on an emulator build served from
 * loopback). It draws a scripted stick figure; it is NOT evidence that the
 * counter works on a real body, only that the flow does what the frozen
 * reference says on inputs whose truth is known exactly.
 *
 * Captures (WSF_CAMERA_LABEL=before|after) are written to
 * tests-e2e/artifacts/move-camera-counter/ and are not committed by the run.
 *
 * Emulator fixture data only: synthetic accounts, a synthetic community and a
 * synthetic squat goal.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { contributionsOf, firestorePatch, openPhone, seedExpoEvent, type ExpoFixture } from './helpers/expo-attendee-fixtures';

test.describe.configure({ timeout: 240_000 });

const ARTIFACTS = path.resolve(__dirname, 'artifacts', 'move-camera-counter');
const LABEL = process.env.WSF_CAMERA_LABEL;

async function snap(page: Page, name: string): Promise<void> {
  if (!LABEL) return;
  mkdirSync(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, `${LABEL}-${name}.png`), fullPage: false });
}

type Plan = { kind: 'stand' } | { kind: 'away' } | { kind: 'squats'; n: number; start?: number };

/**
 * The scripted mover, installed before any page script. Self-contained: it is
 * serialised into the page. `plan` is changed from the test; `start` is
 * stamped on the first frame that sees a new squat plan.
 */
function installPoseHook(arg: { fail?: string }) {
  type L = { x: number; y: number; visibility: number };
  const pose = (depth: number) => {
    const H = 0.7, cx = 0.5, v = 0.95, ankleY = 0.92, shin = 0.26 * H;
    const kneeY = ankleY - shin;
    const hipY = ankleY - (2 - depth) * shin;
    const lean = Math.min(1, depth) * 0.5;
    const shoulderY = hipY - 0.36 * H * Math.cos(lean);
    const noseY = shoulderY - 0.12 * H;
    const kneeOut = 0.07 * H + depth * 0.03 * H;
    const p = (x: number, y: number): L => ({ x, y, visibility: v });
    return {
      poses: [
        {
          nose: p(cx, noseY),
          leftShoulder: p(cx + 0.08 * H, shoulderY),
          rightShoulder: p(cx - 0.08 * H, shoulderY),
          leftHip: p(cx + 0.06 * H, hipY),
          rightHip: p(cx - 0.06 * H, hipY),
          leftKnee: p(cx + kneeOut, kneeY),
          rightKnee: p(cx - kneeOut, kneeY),
          leftAnkle: p(cx + 0.06 * H, ankleY),
          rightAnkle: p(cx - 0.06 * H, ankleY),
        },
      ],
      visuals: [
        {
          leftEar: p(cx + 0.035, noseY + 0.01),
          rightEar: p(cx - 0.035, noseY + 0.01),
          leftElbow: p(cx + 0.11 * H, shoulderY + 0.15 * H),
          rightElbow: p(cx - 0.11 * H, shoulderY + 0.15 * H),
          leftWrist: p(cx + 0.1 * H, shoulderY + 0.28 * H),
          rightWrist: p(cx - 0.1 * H, shoulderY + 0.28 * H),
        },
      ],
    };
  };
  const PERIOD = 1600, REST = 400;
  const hook: Record<string, unknown> & { plan: Plan; lastT: number } = {
    plan: { kind: 'stand' },
    lastT: 0,
    fail: arg.fail,
    scene(t: number) {
      hook.lastT = t;
      const plan = hook.plan;
      if (plan.kind === 'away') return { poses: [], visuals: [] };
      if (plan.kind === 'squats') {
        if (plan.start === undefined) plan.start = t;
        const rel = t - plan.start;
        const i = Math.floor(rel / (PERIOD + REST));
        if (i < plan.n) {
          const u = rel - i * (PERIOD + REST);
          const d = u > PERIOD ? 0 : 0.95 * Math.sin((u / PERIOD) * Math.PI);
          return pose(d);
        }
      }
      return pose(0);
    },
  };
  (window as unknown as { __WSF_TEST_POSE__: unknown }).__WSF_TEST_POSE__ = hook;
}

async function withPoses(context: BrowserContext, fail?: string) {
  await context.addInitScript(installPoseHook, { fail });
}

const setPlan = (page: Page, plan: Plan) =>
  page.evaluate((p) => {
    (window as unknown as { __WSF_TEST_POSE__: { plan: unknown } }).__WSF_TEST_POSE__.plan = p;
  }, plan);

const cameraStarts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __WSF_TEST_POSE__?: { starts?: number } }).__WSF_TEST_POSE__?.starts ?? 0);

const cameraActive = (page: Page) =>
  page.evaluate(() => (window as unknown as { __WSF_TEST_POSE__?: { active?: boolean } }).__WSF_TEST_POSE__?.active === true);

const phaseOf = (page: Page) => page.getByTestId('wsf-camera-screen').getAttribute('data-phase');

async function openMove(page: Page) {
  await page.goto('/move');
  await page.waitForURL(/\/contribute\//, { timeout: 40_000 });
}

async function setSettings(page: Page, s: { cameraCounter?: boolean; stickFigure?: boolean }) {
  await page.evaluate((v) => localStorage.setItem('wsf.moveCamera.v1', JSON.stringify(v)), s);
}

/** Up to GO: found, ready, 3-2-1, counting at 0. */
async function toCounting(page: Page) {
  await expect(page.getByTestId('wsf-camera-screen')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('wsf-camera-countdown')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('wsf-camera-count')).toHaveText('0', { timeout: 10_000 });
}

let fx: ExpoFixture;

test.beforeAll(async () => {
  fx = await seedExpoEvent({ tag: 'camflow', attendees: ['Fixture Mover', 'Fixture Second'], target: 1000, seededTotal: 120 });
});

test('Settings: MOVE section defaults ON/ON; stick figure hidden while the counter is off; both persist', async ({ browser }) => {
  const phone = await openPhone(browser, fx.attendees[0]!);
  try {
    const { page } = phone;
    await page.goto('/settings');
    const counter = page.getByTestId('wsf-settings-camera-counter');
    const figure = page.getByTestId('wsf-settings-stick-figure');
    await expect(counter).toHaveAttribute('aria-checked', 'true', { timeout: 40_000 });
    await expect(figure).toHaveAttribute('aria-checked', 'true');
    await expect(counter).toContainText('Camera rep counter');
    await expect(figure).toContainText('Show stick figure');

    await figure.click();
    await expect(figure).toHaveAttribute('aria-checked', 'false');
    await counter.click();
    await expect(counter).toHaveAttribute('aria-checked', 'false');
    await expect(figure).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId('wsf-settings-camera-counter')).toHaveAttribute('aria-checked', 'false', { timeout: 40_000 });
    await page.getByTestId('wsf-settings-camera-counter').click();
    // The stick-figure value was kept while hidden.
    await expect(page.getByTestId('wsf-settings-stick-figure')).toHaveAttribute('aria-checked', 'false');
    phone.assertNoCrash('settings');
  } finally {
    await phone.context.close();
  }
});

test('squat MOVE opens the camera; pre-GO squats excluded; Finish → Adjust → existing review; nothing written before Record', async ({ browser }) => {
  const phone = await openPhone(browser, fx.attendees[0]!);
  try {
    const { page, context } = phone;
    await withPoses(context);
    await setSettings(page, {});
    await openMove(page);
    // Straight into the camera: no chooser, no manual timer page.
    await expect(page.getByTestId('wsf-camera-screen')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-contribute-move-screen')).toHaveCount(0);
    await expect(page.getByTestId('wsf-camera-screen')).toHaveAttribute('data-figure', 'on');

    // Squat BEFORE GO: it must never reach the count.
    await setPlan(page, { kind: 'squats', n: 1 });
    await page.waitForTimeout(2_200);
    await setPlan(page, { kind: 'stand' });
    await toCounting(page);
    await expect(page.getByTestId('wsf-camera-cue')).toHaveCount(0);
    // The body guide: one figure with a head ring and its 8 chains (no neck).
    const fig = page.getByTestId('wsf-camera-figure');
    await expect(fig).toHaveAttribute('data-head', 'ring');
    await expect(fig).toHaveAttribute('data-lines', '8');
    await snap(page, 'counting-0-390x844');

    await setPlan(page, { kind: 'squats', n: 3 });
    await expect(page.getByTestId('wsf-camera-count')).toHaveText('3', { timeout: 15_000 });
    await page.waitForTimeout(800);
    await expect(page.getByTestId('wsf-camera-count')).toHaveText('3');
    await snap(page, 'counting-3-390x844');
    expect(await contributionsOf(fx.goalId, fx.attendees[0]!.uid)).toHaveLength(0);

    await page.getByTestId('wsf-camera-finish').click();
    await expect(page.getByTestId('wsf-camera-screen')).toHaveCount(0);
    expect(await cameraActive(page)).toBe(false);
    await expect(page.getByTestId('wsf-contribute-adjust-heading')).toHaveText('We counted 3 squats');
    await expect(page.getByTestId('wsf-contribute-adjust-value')).toHaveText('3');
    await snap(page, 'adjust-390x844');
    await page.getByTestId('wsf-contribute-adjust-plus').click();
    await expect(page.getByTestId('wsf-contribute-adjust-value')).toHaveText('4');
    expect(await contributionsOf(fx.goalId, fx.attendees[0]!.uid)).toHaveLength(0);

    await page.getByTestId('wsf-contribute-adjust-continue').click();
    await expect(page.getByTestId('wsf-contribute-review-quantity')).toContainText('4');
    // Edit returns to Adjust, keeping the member's number.
    await page.getByTestId('wsf-contribute-edit').click();
    await expect(page.getByTestId('wsf-contribute-adjust-value')).toHaveText('4');
    await page.getByTestId('wsf-contribute-adjust-continue').click();
    expect(await contributionsOf(fx.goalId, fx.attendees[0]!.uid)).toHaveLength(0);
    await page.getByTestId('wsf-contribute-submit').click();
    await expect.poll(async () => (await contributionsOf(fx.goalId, fx.attendees[0]!.uid)).map((c) => c.count), { timeout: 30_000 }).toEqual([4]);
    phone.assertNoCrash('camera happy path');
  } finally {
    await phone.context.close();
  }
});

test('readiness loss cancels the countdown; a brief loss while counting shows the reacquire cue and invents nothing', async ({ browser }) => {
  const phone = await openPhone(browser, fx.attendees[1]!);
  try {
    const { page, context } = phone;
    await withPoses(context);
    await setSettings(page, { stickFigure: false });
    await openMove(page);
    await expect(page.getByTestId('wsf-camera-screen')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-camera-screen')).toHaveAttribute('data-figure', 'off');
    await expect(page.getByTestId('wsf-camera-countdown')).toBeVisible({ timeout: 15_000 });
    await setPlan(page, { kind: 'away' });
    await expect(page.getByTestId('wsf-camera-countdown')).toHaveCount(0, { timeout: 3_000 });
    expect(await phaseOf(page)).toBe('acquiring');
    await expect(page.getByTestId('wsf-camera-cue')).toHaveText('Step back so I can see you');
    await snap(page, 'acquiring-390x844');
    await expect(page.getByTestId('wsf-camera-count')).toHaveCount(0);

    await setPlan(page, { kind: 'stand' });
    await toCounting(page);
    // Body guide OFF: counting identical, no overlay.
    await expect(page.getByTestId('wsf-camera-figure')).toHaveCount(0);
    await setPlan(page, { kind: 'squats', n: 1 });
    await expect(page.getByTestId('wsf-camera-count')).toHaveText('1', { timeout: 15_000 });
    await setPlan(page, { kind: 'away' });
    await expect(page.getByTestId('wsf-camera-cue')).toHaveText('Step back into view', { timeout: 5_000 });
    await expect(page.getByTestId('wsf-camera-count')).toHaveText('1');
    await page.waitForTimeout(1_500);
    await expect(page.getByTestId('wsf-camera-count')).toHaveText('1');

    // Close: camera released, nothing contributed.
    await page.getByTestId('wsf-camera-close').click();
    await expect(page.getByTestId('wsf-camera-screen')).toHaveCount(0, { timeout: 10_000 });
    expect(await cameraActive(page)).toBe(false);
    expect(await contributionsOf(fx.goalId, fx.attendees[1]!.uid)).toHaveLength(0);
  } finally {
    await phone.context.close();
  }
});

test('a hidden page releases the camera and banks the count; resume needs a fresh 3-2-1', async ({ browser }) => {
  const phone = await openPhone(browser, fx.attendees[1]!);
  try {
    const { page, context } = phone;
    await withPoses(context);
    await setSettings(page, {});
    await openMove(page);
    await toCounting(page);
    await setPlan(page, { kind: 'squats', n: 2 });
    await expect(page.getByTestId('wsf-camera-count')).toHaveText('2', { timeout: 15_000 });
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByTestId('wsf-camera-paused')).toContainText('2 squats kept so far.');
    expect(await cameraActive(page)).toBe(false);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    });
    await setPlan(page, { kind: 'stand' });
    await page.getByTestId('wsf-camera-resume').click();
    await expect(page.getByTestId('wsf-camera-countdown')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('wsf-camera-count')).toHaveText('2', { timeout: 10_000 });
    await setPlan(page, { kind: 'squats', n: 1 });
    await expect(page.getByTestId('wsf-camera-count')).toHaveText('3', { timeout: 15_000 });
    await page.getByTestId('wsf-camera-finish').click();
    await expect(page.getByTestId('wsf-contribute-adjust-value')).toHaveText('3');
    // Nothing until confirm: leave from Adjust.
    expect(await contributionsOf(fx.goalId, fx.attendees[1]!.uid)).toHaveLength(0);
  } finally {
    await phone.context.close();
  }
});

test('camera failure offers manual entry; Count by hand reaches the existing entry; the camera does not reopen behind it', async ({ browser }) => {
  const phone = await openPhone(browser, fx.attendees[1]!);
  try {
    const { page, context } = phone;
    await withPoses(context, 'permission');
    await setSettings(page, {});
    await openMove(page);
    await expect(page.getByTestId('wsf-camera-failed')).toContainText('Camera isn’t available', { timeout: 40_000 });
    await snap(page, 'failed-390x844');
    await page.getByTestId('wsf-camera-manual').click();
    await expect(page.getByTestId('wsf-camera-screen')).toHaveCount(0);
    await expect(page.getByTestId('wsf-contribute-entry')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1_000);
    await expect(page.getByTestId('wsf-camera-screen')).toHaveCount(0);
  } finally {
    await phone.context.close();
  }

  const phone2 = await openPhone(browser, fx.attendees[1]!);
  try {
    const { page, context } = phone2;
    await withPoses(context);
    await setSettings(page, {});
    await openMove(page);
    await expect(page.getByTestId('wsf-camera-by-hand')).toBeVisible({ timeout: 40_000 });
    await page.getByTestId('wsf-camera-by-hand').click();
    expect(await cameraActive(page)).toBe(false);
    await expect(page.getByTestId('wsf-contribute-entry')).toBeVisible({ timeout: 10_000 });
  } finally {
    await phone2.context.close();
  }
});

test('Camera rep counter OFF keeps the existing manual squat flow', async ({ browser }) => {
  const phone = await openPhone(browser, fx.attendees[1]!);
  try {
    const { page, context } = phone;
    await withPoses(context);
    await setSettings(page, { cameraCounter: false });
    await openMove(page);
    await expect(page.getByTestId('wsf-contribute-move-screen')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(1_000);
    await expect(page.getByTestId('wsf-camera-screen')).toHaveCount(0);
    expect(await cameraActive(page)).toBe(false);
  } finally {
    await phone.context.close();
  }
});

test('a non-squat goal keeps its existing flow and never opens the squat counter', async ({ browser }) => {
  const other = await seedExpoEvent({ tag: 'camnonsq', attendees: ['Fixture Pusher'], target: 500, seededTotal: 40 });
  await firestorePatch(`wsfGoals/${other.goalId}`, { unit: { stringValue: 'push-ups' } });
  const phone = await openPhone(browser, other.attendees[0]!);
  try {
    const { page, context } = phone;
    await withPoses(context);
    await setSettings(page, {});
    await openMove(page);
    await expect(page.getByTestId('wsf-contribute-move-screen')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(1_000);
    await expect(page.getByTestId('wsf-camera-screen')).toHaveCount(0);
    expect(await cameraStarts(page)).toBe(0);
  } finally {
    await phone.context.close();
  }
});

test('an unresolved (pending/unknown) attempt keeps its recovery; the camera is not reopened over it', async ({ browser }) => {
  const who = fx.attendees[1]!;
  const phone = await openPhone(browser, who);
  try {
    const { page, context } = phone;
    await withPoses(context);
    await setSettings(page, {});
    await page.evaluate(
      ({ goalId, uid }) =>
        localStorage.setItem(
          `wsf.pendingContribution.${goalId}.${uid}`,
          JSON.stringify({ goalId, attemptId: `fixture-unresolved-${Date.now()}`, count: 6, ts: Date.now(), state: 'unknown' }),
        ),
      { goalId: fx.goalId, uid: who.uid },
    );
    await openMove(page);
    await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(1_000);
    await expect(page.getByTestId('wsf-camera-screen')).toHaveCount(0);
    expect(await cameraStarts(page)).toBe(0);
  } finally {
    await phone.context.close();
  }
});

test('without the test source (no on-device engine in this build) squat MOVE stays manual — fail closed', async ({ browser }) => {
  const phone = await openPhone(browser, fx.attendees[1]!);
  try {
    const { page } = phone;
    await setSettings(page, {});
    await openMove(page);
    await expect(page.getByTestId('wsf-contribute-move-screen')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(1_000);
    await expect(page.getByTestId('wsf-camera-screen')).toHaveCount(0);
  } finally {
    await phone.context.close();
  }
});

test('capture: Settings and squat MOVE at 390x844 and 390x640', async ({ browser }) => {
  test.skip(!LABEL, 'capture producer: set WSF_CAMERA_LABEL=before|after');
  const cap = await seedExpoEvent({ tag: `camcap${LABEL}`, attendees: ['Fixture Mover'], target: 1000, seededTotal: 120 });
  for (const vp of [
    { width: 390, height: 844 },
    { width: 390, height: 640 },
  ]) {
    const phone = await openPhone(browser, cap.attendees[0]!);
    try {
      if (LABEL === 'after') await withPoses(phone.context);
      await phone.page.setViewportSize(vp);
      await phone.page.goto('/settings');
      await expect(phone.page.getByTestId('wsf-settings-screen')).toBeVisible({ timeout: 40_000 });
      await expect(phone.page.getByText('Loading your communities…')).toHaveCount(0, { timeout: 40_000 });
      await phone.page.waitForTimeout(1_200);
      await snap(phone.page, `settings-${vp.width}x${vp.height}`);

      await phone.page.goto('/move');
      await phone.page.waitForURL(/\/contribute\//, { timeout: 40_000 });
      await phone.page.waitForTimeout(2_500);
      await snap(phone.page, `move-squat-${vp.width}x${vp.height}`);
    } finally {
      await phone.context.close();
    }
  }
});
