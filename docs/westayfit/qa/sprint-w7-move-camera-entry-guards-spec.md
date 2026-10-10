# W7 Check 80 instrument: MOVE-CAMERA entry guards (inert)

Inert on this branch: the spec imports `./helpers/expo-attendee-fixtures`, which exists on the development
branch and in #577's tree, not on `claude/wsf-sprint-w7-journey-qa`. Keeping it here as text keeps `ts:check`
and the W7 suite unaffected. It is evidence for **Check 80** (#577 at `d6d478793126ad53fd4f7ef8de1b64900ebbaa51`,
report §80), and it changes no product code.

## What it proves

| # | Test | Result on the head | Why it can fail |
|---|---|---|---|
| 1 | control: counter ON by default, plain squat Start moving opens the camera | pass | proves the guard tests below can see the camera open |
| 2 | a kiosk Start moving never opens the camera | pass | **killed** by the mutant "remove `!kiosk` from `cameraOpen`": the camera opens and the move screen never shows |
| 3 | logging something already done never opens the camera | pass | `mode` other than `move` starts at the entry step |
| 4 | observation: camera screen mounted while the page is hidden | pass (invariants only) | records what the camera does; asserts only that the manual route is offered and nothing is written |

Measured in test 4 on the head: `startsWhileHidden=0 cueWhileHidden="Starting camera…" startsAfterVisible=0 cueAfterVisible="Starting camera…"` (4 s after the page reports visible).

## Run it

Against the PR's own tree (a detached worktree of `d6d47879`), with the emulator stack and the emulator-flagged web build served:

```sh
cp <this spec> apps/westayfit/tests-e2e/sprint-w7-move-camera-entry-guards.spec.ts
cd apps/westayfit
WSF_PLAYWRIGHT_CHROMIUM=/opt/pw-browsers/chromium WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  npx playwright test --config=playwright.config.ts --workers=1 tests-e2e/sprint-w7-move-camera-entry-guards.spec.ts
```

## Source

```ts
/**
 * W7 Check 80 (MOVE-CAMERA-NATIVE-PORT-1, #577 at d6d47879): the entry guards the packet's own spec
 * does not drive end to end. Its e2e covers counter OFF, a non-squat goal and an unresolved attempt;
 * "never on a kiosk" and "never for logging something already done" rest there on a structural unit
 * test only. This drives them against the real build, with the counter ON by default.
 *
 * A fourth test records one measured observation (camera screen mounted while the page is hidden); it
 * asserts only the safety invariants, and annotates what it measures.
 *
 * Emulator fixture data only. The synthetic pose source (window.__WSF_TEST_POSE__) is the packet's own
 * emulator + loopback hook; here it supplies an empty scene (nobody in frame), because the question is
 * only whether the camera screen opens, never whether anything is counted. Nothing is recorded.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { contributionsOf, openPhone, seedExpoEvent, type ExpoFixture } from './helpers/expo-attendee-fixtures';

test.describe.configure({ timeout: 180_000 });

let fx: ExpoFixture;

test.beforeAll(async () => {
  fx = await seedExpoEvent({ tag: 'w7camk', attendees: ['W7 Kiosk A', 'W7 Kiosk B', 'W7 Kiosk C'], target: 1000, seededTotal: 120 });
});

/** The packet's hook shape, with an empty scene: the camera screen can open, nothing is ever counted. */
function installEmptyPoseHook() {
  (window as unknown as { __WSF_TEST_POSE__: unknown }).__WSF_TEST_POSE__ = { scene: () => [], starts: 0, active: false };
}

async function withHook(context: BrowserContext) {
  await context.addInitScript(installEmptyPoseHook);
}

/** "{}" reads as the product default: counter ON, stick figure ON. */
async function productDefault(page: Page) {
  await page.evaluate(() => localStorage.setItem('wsf.moveCamera.v1', '{}'));
}

const starts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __WSF_TEST_POSE__?: { starts?: number } }).__WSF_TEST_POSE__?.starts ?? 0);

/** The contribute URL a fresh squat "Start moving" lands on. */
async function startMovingUrl(page: Page): Promise<string> {
  await page.goto('/move');
  await page.waitForURL(/\/contribute\//, { timeout: 40_000 });
  return page.url();
}

test('control: with the counter ON by default a plain squat Start moving opens the camera (so the guards below can fail)', async ({ browser }) => {
  const phone = await openPhone(browser, fx.attendees[0]!);
  try {
    await withHook(phone.context);
    await productDefault(phone.page);
    const url = await startMovingUrl(phone.page);
    await expect(phone.page.getByTestId('wsf-camera-screen')).toBeVisible({ timeout: 40_000 });
    expect(await starts(phone.page)).toBeGreaterThan(0);
    // Evidence for the next tests: the URL the member lands on, with no kiosk flag.
    expect(new URL(url).searchParams.get('kiosk')).toBeNull();
    expect(new URL(url).searchParams.get('mode')).toBe('move');
  } finally {
    await phone.context.close();
  }
});

test('a kiosk Start moving never opens the camera, even with the counter ON by default', async ({ browser }) => {
  // Learn the real landing URL from a plain member, then replay it with the kiosk flag on another device.
  const probe = await openPhone(browser, fx.attendees[0]!);
  let landing: URL;
  try {
    await withHook(probe.context);
    await productDefault(probe.page);
    landing = new URL(await startMovingUrl(probe.page));
  } finally {
    await probe.context.close();
  }
  const kioskUrl = new URL(landing.toString());
  kioskUrl.searchParams.set('kiosk', '1');

  const phone = await openPhone(browser, fx.attendees[1]!);
  try {
    await withHook(phone.context);
    await productDefault(phone.page);
    await phone.page.goto(kioskUrl.pathname + kioskUrl.search);
    await expect(phone.page.getByTestId('wsf-contribute-move-screen')).toBeVisible({ timeout: 40_000 });
    await phone.page.waitForTimeout(2_000);
    await expect(phone.page.getByTestId('wsf-camera-screen')).toHaveCount(0);
    expect(await starts(phone.page)).toBe(0);
    expect(await phone.page.evaluate(() => (window as unknown as { __WSF_TEST_POSE__?: { active?: boolean } }).__WSF_TEST_POSE__?.active === true)).toBe(false);
  } finally {
    await phone.context.close();
  }
});

test('logging something already done (not Start moving) never opens the camera, even with the counter ON by default', async ({ browser }) => {
  const probe = await openPhone(browser, fx.attendees[0]!);
  let landing: URL;
  try {
    await withHook(probe.context);
    await productDefault(probe.page);
    landing = new URL(await startMovingUrl(probe.page));
  } finally {
    await probe.context.close();
  }
  const doneUrl = new URL(landing.toString());
  doneUrl.searchParams.delete('mode');

  const phone = await openPhone(browser, fx.attendees[2]!);
  try {
    await withHook(phone.context);
    await productDefault(phone.page);
    await phone.page.goto(doneUrl.pathname + doneUrl.search);
    await expect(phone.page.getByTestId('wsf-contribute-entry')).toBeVisible({ timeout: 40_000 });
    await phone.page.waitForTimeout(2_000);
    await expect(phone.page.getByTestId('wsf-camera-screen')).toHaveCount(0);
    expect(await starts(phone.page)).toBe(0);
  } finally {
    await phone.context.close();
  }
});

test('observation: a camera screen mounted while the page is hidden; the manual route is offered and nothing is written', async ({ browser }) => {
  const who = fx.attendees[0]!;
  const phone = await openPhone(browser, who);
  try {
    await withHook(phone.context);
    // From the next navigation on, the page reports itself hidden until the test says otherwise.
    await phone.context.addInitScript(() => {
      let state = 'hidden';
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
      (window as unknown as { __w7Visible: (v: boolean) => void }).__w7Visible = (v: boolean) => {
        state = v ? 'visible' : 'hidden';
        document.dispatchEvent(new Event('visibilitychange'));
      };
    });
    await productDefault(phone.page);
    await startMovingUrl(phone.page);
    await expect(phone.page.getByTestId('wsf-camera-screen')).toBeVisible({ timeout: 40_000 });
    const startsWhileHidden = await starts(phone.page);
    const cueWhileHidden = await phone.page.getByTestId('wsf-camera-cue').textContent().catch(() => null);
    await phone.page.evaluate(() => (window as unknown as { __w7Visible: (v: boolean) => void }).__w7Visible(true));
    await phone.page.waitForTimeout(4_000);
    const startsAfterVisible = await starts(phone.page);
    const cueAfterVisible = await phone.page.getByTestId('wsf-camera-cue').textContent().catch(() => null);
    test.info().annotations.push({
      type: 'measured',
      description: `startsWhileHidden=${startsWhileHidden} cueWhileHidden=${JSON.stringify(cueWhileHidden)} startsAfterVisible=${startsAfterVisible} cueAfterVisible=${JSON.stringify(cueAfterVisible)}`,
    });
    // Safety invariants, whatever the camera does: the manual route is offered, and nothing is recorded.
    await expect(phone.page.getByTestId('wsf-camera-by-hand')).toBeVisible();
    await phone.page.getByTestId('wsf-camera-by-hand').click();
    await expect(phone.page.getByTestId('wsf-contribute-entry')).toBeVisible({ timeout: 10_000 });
    expect(await contributionsOf(fx.goalId, who.uid)).toHaveLength(0);
    console.log(`W7-MEASURED startsWhileHidden=${startsWhileHidden} cueWhileHidden=${JSON.stringify(cueWhileHidden)} startsAfterVisible=${startsAfterVisible} cueAfterVisible=${JSON.stringify(cueAfterVisible)}`);
  } finally {
    await phone.context.close();
  }
});
```
