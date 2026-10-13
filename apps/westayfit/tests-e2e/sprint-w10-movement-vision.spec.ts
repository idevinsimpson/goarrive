import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { chromium, expect, test, type Page } from '@playwright/test';

/**
 * MOVEMENT-VISION-1 — BROWSER EVIDENCE FOR THE DEV LAB.
 *
 * Runs against an EMULATOR-FLAGGED web build (the lab is gated off otherwise):
 *   EXPO_PUBLIC_WSF_USE_EMULATORS=1 npm run build:web
 *   npx expo serve --port 8765
 *   WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:8765 \
 *     npx playwright test tests-e2e/sprint-w10-movement-vision.spec.ts
 *
 * What each block proves, and what it does NOT:
 *   - synthetic: the UI, lock and counter behave end to end in a browser on
 *     scripted landmarks. Proves nothing about real bodies.
 *   - camera refused: the manual-count fallback works when permission is denied.
 *   - fake camera: the real getUserMedia → MediaPipe → lock → counter path
 *     runs in Chromium on a camera feed built from a real photograph of a
 *     standing person (a MediaPipe test asset). The "squat" frames are that
 *     photo WARPED (thighs compressed), not a person squatting — so a count
 *     here shows the pipeline counts when the engine reports a squat-shaped
 *     body, not that it counts real squats accurately.
 *
 * Downloads (not committed): the pose model and the photo, into test-results/.
 * The WASM runtime is served from node_modules, because this sandbox's proxy
 * blocks the jsDelivr CDN that the lab uses by default.
 */

const BASE = process.env.WSF_PLAYWRIGHT_BASE_URL;
test.skip(!BASE, 'Set WSF_PLAYWRIGHT_BASE_URL to an emulator-flagged build (see header).');

const APP = path.resolve(__dirname, '..');
const OUT = path.join(APP, 'test-results', 'w10-movement-vision');
const WASM_DIR = path.join(APP, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const PHOTO_URL = 'https://storage.googleapis.com/mediapipe-assets/male_full_height_hands.jpg';
const ROUTE = '/design-target/movement-vision';

function download(url: string, file: string): string | null {
  const p = path.join(OUT, file);
  if (existsSync(p)) return p;
  try {
    execFileSync('curl', ['-sSf', '-o', p, url], { stdio: 'ignore', timeout: 60_000 });
    return p;
  } catch {
    return null;
  }
}

/** Serve the MediaPipe WASM from node_modules and the model from a local copy. */
async function routeEngineAssets(page: Page, modelPath: string) {
  await page.route(/cdn\.jsdelivr\.net\/npm\/@mediapipe\/tasks-vision@[^/]+\/wasm\/(.+)$/, (route) => {
    const name = /wasm\/([^/?#]+)/.exec(route.request().url())![1];
    const body = readFileSync(path.join(WASM_DIR, name));
    return route.fulfill({
      body,
      contentType: name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
      headers: { 'access-control-allow-origin': '*' },
    });
  });
  await page.route(MODEL_URL, (route) =>
    route.fulfill({ body: readFileSync(modelPath), contentType: 'application/octet-stream' }),
  );
}

async function readout(page: Page): Promise<string> {
  return (await page.getByTestId('mv-debug-readout').textContent()) ?? '';
}

async function reps(page: Page): Promise<number> {
  return Number((await page.getByTestId('mv-reps').textContent())?.trim());
}

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

test.describe('synthetic scene (no camera)', () => {
  test('locks, counts full reps, ignores the half rep, pauses for the walker, ignores the other exerciser', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.goto(ROUTE);
    await expect(page.getByTestId('mv-privacy')).toContainText('never recorded, stored or uploaded');
    await page.getByTestId('mv-start-synthetic').click();

    await expect(page.getByTestId('mv-state')).toHaveText('Tracking you', { timeout: 5_000 });
    await expect.poll(() => reps(page), { timeout: 9_000 }).toBe(3);
    await page.screenshot({ path: path.join(OUT, 'synthetic-01-three-reps.png') });

    // The half squat (8–10 s) is seen and not counted.
    await expect.poll(async () => (await readout(page)).match(/half reps seen \(not counted\): (\d+)/)?.[1], {
      timeout: 4_000,
    }).toBe('1');
    expect(await reps(page)).toBe(3);

    // The walker (10–13 s) pauses counting instead of guessing.
    await expect(page.getByTestId('mv-state')).toHaveText(/Someone else is too close|Lost you/, { timeout: 5_000 });
    await page.screenshot({ path: path.join(OUT, 'synthetic-02-walker-paused.png') });
    expect(await reps(page)).toBe(3);

    // Re-acquired, then two more reps while a second person squats at the edge: 5, not 8.
    await expect.poll(() => reps(page), { timeout: 12_000 }).toBe(5);
    await page.screenshot({ path: path.join(OUT, 'synthetic-03-five-with-second-exerciser.png') });
    await page.waitForTimeout(1_500);
    expect(await reps(page)).toBe(5);

    // Reset really resets.
    await page.getByTestId('mv-reset').click();
    expect(await reps(page)).toBe(0);
  });
});

test.describe('freshness bound at the browser boundary', () => {
  /**
   * The Director's review case 3 (#475 5825938854), end to end: the lab's
   * frame loop is driven by requestAnimationFrame, so a hidden tab or a
   * stalled loop shows up as one frame arriving long after the last. With
   * Playwright's fake clock the loop is paused mid-rep and resumed 11.2 s
   * later, in the scene's standing window. The rep in progress must be
   * voided and the member re-acquired, with no count for the unobserved
   * completion.
   */
  test('a frame loop suspended at the bottom of a rep does not complete that rep on resume', async ({ page }) => {
    test.setTimeout(90_000);
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.goto(ROUTE);
    await page.getByTestId('mv-privacy').waitFor();
    await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
    await page.getByTestId('mv-start-synthetic').click();

    // Step the loop until the counter reports the member at the bottom of rep 1.
    let atBottom = false;
    for (let i = 0; i < 200 && !atBottom; i += 1) {
      await page.clock.runFor(50);
      atBottom = (await readout(page)).includes('phase: down');
    }
    expect(atBottom).toBe(true);
    expect(await reps(page)).toBe(0);

    // The loop stalls; one frame arrives 11.2 s later, the member now standing.
    await page.clock.fastForward(11_200);
    await page.clock.runFor(200);
    expect(await reps(page)).toBe(0);
    const after = await readout(page);
    expect(after).toMatch(/stream interruptions \(rep in progress voided\): [1-9]/);
    expect(after).not.toContain('phase: down');

    // Standing on: re-acquired, still no count for the unobserved completion.
    await page.clock.runFor(1_200);
    expect(await readout(page)).toContain('lock: locked');
    expect(await reps(page)).toBe(0);
  });
});

test.describe('camera refused', () => {
  test('refusal leads to the manual count, which works', async ({ browser }) => {
    const ctx = await browser.newContext({ permissions: [] });
    const page = await ctx.newPage();
    // Make getUserMedia refuse, as a browser does when the member says no.
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    });
    await page.goto(ROUTE);
    await page.getByTestId('mv-start-camera').click();
    await expect(page.getByTestId('mv-message')).toContainText('Camera permission was refused');
    await page.getByTestId('mv-manual').click();
    await page.getByTestId('mv-plus').click();
    await page.getByTestId('mv-plus').click();
    await page.getByTestId('mv-minus').click();
    expect(await reps(page)).toBe(1);
    await ctx.close();
  });
});

test.describe('fake camera through the real engine (MediaPipe in Chromium)', () => {
  const W = 640;
  const H = 480;

  /**
   * Render an MJPEG camera feed in a plain browser page from the photo.
   * `scene(t)` returns the people in frame at time t: centre x, height (as a
   * fraction of frame height) and squat amount 0..1 (thigh compression).
   */
  async function makeFeed(
    file: string,
    photo: string,
    seconds: number,
    scene: (t: number) => { cx: number; h: number; squat: number }[],
  ): Promise<string> {
    const out = path.join(OUT, file);
    const fps = 30;
    const frames = Array.from({ length: Math.round(seconds * fps) }, (_, i) => scene(i / fps));
    const browser = await chromium.launch({ executablePath: process.env.WSF_PLAYWRIGHT_CHROMIUM || undefined });
    try {
      const page = await browser.newPage();
      const dataUrl = `data:image/jpeg;base64,${readFileSync(photo).toString('base64')}`;
      const jpegs: string[] = await page.evaluate(
        async ({ dataUrl, frames, W, H }) => {
          const img = new Image();
          img.src = dataUrl;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = W;
          c.height = H;
          const g = c.getContext('2d')!;
          // Rows of the photo: hip ≈ 0.49, knee ≈ 0.72 of the image height.
          const HIP = 0.49;
          const KNEE = 0.72;
          const out: string[] = [];
          for (const people of frames) {
            g.fillStyle = '#d8d6d2';
            g.fillRect(0, 0, W, H);
            for (const p of people) {
              const dh = p.h * H;
              const dw = (img.width / img.height) * dh;
              const x = p.cx * W - dw / 2;
              const feet = H * 0.97;
              const top = feet - dh;
              const thighSrc = (KNEE - HIP) * img.height;
              const thighDst = (KNEE - HIP) * dh * (1 - 0.97 * p.squat);
              const drop = (KNEE - HIP) * dh - thighDst;
              // legs below the knee: unchanged
              g.drawImage(img, 0, KNEE * img.height, img.width, (1 - KNEE) * img.height, x, top + KNEE * dh, dw, (1 - KNEE) * dh);
              // thighs: compressed
              g.drawImage(img, 0, HIP * img.height, img.width, thighSrc, x, top + HIP * dh + drop, dw, thighDst);
              // head to hip: moved down by what the thighs lost
              g.drawImage(img, 0, 0, img.width, HIP * img.height, x, top + drop, dw, HIP * dh);
            }
            out.push(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
          }
          return out;
        },
        { dataUrl, frames, W, H },
      );
      writeFileSync(out, Buffer.concat(jpegs.map((b) => Buffer.from(b, 'base64'))));
    } finally {
      await browser.close();
    }
    return out;
  }

  async function openWithFeed(feed: string, modelPath: string) {
    const browser = await chromium.launch({
      executablePath: process.env.WSF_PLAYWRIGHT_CHROMIUM || undefined,
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-video-capture=${feed}`,
      ],
    });
    const ctx = await browser.newContext({ baseURL: BASE, permissions: ['camera'] });
    const page = await ctx.newPage();
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await routeEngineAssets(page, modelPath);
    // Headless Chromium has no real GPU; its emulated one runs the model at
    // ~1 fps. The CPU (XNNPACK) path is the honest fast path here.
    await page.goto(`${ROUTE}?delegate=cpu`);
    await page.getByTestId('mv-start-camera').click();
    await expect(page.getByTestId('mv-debug-readout')).toContainText('engine: mediapipe-tasks-vision@', {
      timeout: 60_000,
    });
    return { browser, page, requests };
  }

  /**
   * 3 s standing, then warped squats: down 0.7 s, hold 0.3 s, up 0.7 s, rest
   * 0.8 s. The warp compresses the thighs by up to 97%. Recorded result on
   * 2026-09-25 (CPU delegate, ~14 fps): the engine reported a peak depth of
   * about 0.45, below the 0.6 down threshold. Its body prior does not read a
   * squashed photo as a squat, so the counter logged half reps and counted 0.
   * A real squat has to be tested on a real body.
   */
  function squatCycle(t: number): number {
    if (t < 3) return 0;
    const u = (t - 3) % 2.5;
    if (u < 0.7) return u / 0.7;
    if (u < 1.0) return 1;
    if (u < 1.7) return 1 - (u - 1.0) / 0.7;
    return 0;
  }

  test('one person: the engine sees them, the lock holds, warped frames never invent a rep, nothing leaves the page', async () => {
    test.setTimeout(180_000);
    const model = download(MODEL_URL, 'pose_landmarker_lite.task');
    const photo = download(PHOTO_URL, 'person.jpg');
    test.skip(!model || !photo, 'Could not download the model or the test photo.');
    const feed = await makeFeed('one-person.mjpeg', photo!, 10.5, (t) => [{ cx: 0.5, h: 0.9, squat: squatCycle(t) }]);
    const { browser, page, requests } = await openWithFeed(feed, model!);
    try {
      await expect.poll(async () => (await readout(page)).match(/people detected: (\d+)/)?.[1], { timeout: 30_000 }).toBe('1');
      await expect(page.getByTestId('mv-state')).toHaveText('Tracking you', { timeout: 30_000 });
      await page.screenshot({ path: path.join(OUT, 'fake-camera-01-locked.png') });

      // 12 s of samples: ~4.8 warped "squat" cycles go past.
      const trace: string[] = [];
      let maxDepth = 0;
      for (let i = 0; i < 60; i += 1) {
        const r = await readout(page);
        trace.push(`${r.replace(/\n/g, ' | ')} | reps ${await reps(page)}`);
        expect(r).toContain('lock: locked');
        maxDepth = Math.max(maxDepth, Number(r.match(/depth: ([\d.]+)/)?.[1] ?? 0));
        await page.waitForTimeout(200);
      }
      const fps = Number((await readout(page)).match(/fps: (\d+)/)?.[1]);
      expect(fps).toBeGreaterThanOrEqual(5);
      // No invention: never more counts than cycles shown. (What the engine
      // reports for a WARPED photo is recorded, not asserted: see the header.)
      expect(await reps(page)).toBeLessThanOrEqual(5);
      writeFileSync(
        path.join(OUT, 'fake-camera-one-person-trace.txt'),
        `max depth seen: ${maxDepth}\n${trace.join('\n')}\n`,
      );

      // Privacy, observed: every request the page made went to the app's own
      // origin or to the two engine assets (served locally here).
      const base = new URL(BASE!).host;
      const foreign = requests.filter((u) => {
        const url = new URL(u);
        if (url.protocol === 'data:' || url.protocol === 'blob:') return false;
        if (url.host === base) return false;
        if (url.host === 'cdn.jsdelivr.net' && url.pathname.includes('/@mediapipe/tasks-vision@')) return false;
        if (u === MODEL_URL) return false;
        return true;
      });
      expect(foreign).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  test('two people side by side in the zone: the engine reports both, and the lock refuses to choose', async () => {
    test.setTimeout(180_000);
    const model = download(MODEL_URL, 'pose_landmarker_lite.task');
    const photo = download(PHOTO_URL, 'person.jpg');
    test.skip(!model || !photo, 'Could not download the model or the test photo.');
    const feed = await makeFeed('two-people.mjpeg', photo!, 2, () => [
      { cx: 0.32, h: 0.85, squat: 0 },
      { cx: 0.68, h: 0.85, squat: 0 },
    ]);
    const { browser, page } = await openWithFeed(feed, model!);
    try {
      await expect.poll(async () => (await readout(page)).match(/people detected: (\d+)/)?.[1], { timeout: 30_000 }).toBe('2');
      await expect(page.getByTestId('mv-state')).toContainText('More than one person', { timeout: 10_000 });
      await page.waitForTimeout(3_000);
      await expect(page.getByTestId('mv-state')).toContainText('More than one person');
      await page.screenshot({ path: path.join(OUT, 'fake-camera-03-two-people-refused.png') });
      writeFileSync(path.join(OUT, 'fake-camera-two-people.txt'), `${await readout(page)}\n`);
    } finally {
      await browser.close();
    }
  });

  test('member centred, a smaller person at the edge: the lock takes the member only', async () => {
    test.setTimeout(180_000);
    const model = download(MODEL_URL, 'pose_landmarker_lite.task');
    const photo = download(PHOTO_URL, 'person.jpg');
    test.skip(!model || !photo, 'Could not download the model or the test photo.');
    const feed = await makeFeed('member-and-bystander.mjpeg', photo!, 10.5, (t) => [
      { cx: 0.5, h: 0.9, squat: squatCycle(t) },
      { cx: 0.9, h: 0.5, squat: 0 },
    ]);
    const { browser, page } = await openWithFeed(feed, model!);
    try {
      await expect(page.getByTestId('mv-state')).toHaveText('Tracking you', { timeout: 30_000 });
      await page.screenshot({ path: path.join(OUT, 'fake-camera-04-member-with-bystander.png') });
      writeFileSync(path.join(OUT, 'fake-camera-bystander.txt'), `${await readout(page)}\nreps: ${await reps(page)}\n`);
    } finally {
      await browser.close();
    }
  });
});
