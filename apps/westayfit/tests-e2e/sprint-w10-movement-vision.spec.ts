import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { chromium, expect, test, type Page } from '@playwright/test';

import { MEDIAPIPE_VERSION } from '../src/movement/web/mediapipe';
import { movementRequestViolation, type MovementLabRequest } from '../tests/helpers/movementNetworkPolicy';

/**
 * MOVEMENT-VISION-1 — BROWSER EVIDENCE FOR THE DEV LAB.
 *
 * Runs against an EMULATOR-FLAGGED web build (the lab is gated off otherwise):
 *   EXPO_PUBLIC_WSF_USE_EMULATORS=1 npm run build:web
 *   npx expo serve --port 8765
 *   WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:8765 \
 *     npx playwright test tests-e2e/sprint-w10-movement-vision.spec.ts
 * The local dist/ directory must be the exact export served at that URL. Set
 * WSF_MV_STATIC_ASSET_DIR if it is elsewhere; it supplies an a-priori list of
 * static app URLs, never a list learned from the page's own requests.
 *
 * What each block proves, and what it does NOT:
 *   - synthetic: the UI, lock and counter behave end to end in a browser on
 *     scripted landmarks. Proves nothing about real bodies.
 *   - camera refused: the manual-count fallback works when permission is denied.
 *   - fake camera: the real getUserMedia → MediaPipe → lock → counter path
 *     runs in Chromium on a camera feed built from a real photograph of a
 *     standing person (a MediaPipe test asset). The "squat" frames are that
 *     photo WARPED (thighs compressed), not a person squatting. The accepted
 *     negative fixture must count zero. This supplies no positive evidence
 *     of real squat accuracy, real crowd rejection or a real device camera.
 *
 * Downloads (not committed): the pose model and the photo, into test-results/.
 * The WASM runtime is served from node_modules, because this sandbox's proxy
 * blocks the jsDelivr CDN that the lab uses by default.
 * These are controlled pipeline tests, NOT live-host/CDN availability proof.
 * Missing required fixtures fail with BLOCKED; they never silently skip.
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
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_module_internal.js',
  'vision_wasm_module_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

function download(url: string, file: string): string {
  const p = path.join(OUT, file);
  if (existsSync(p) && statSync(p).size > 0) return p;
  const partial = `${p}.${process.pid}.partial`;
  try {
    execFileSync('curl', ['-sSfL', '--connect-timeout', '15', '--max-time', '45', '-o', partial, url], {
      stdio: 'ignore', timeout: 60_000,
    });
    if (!statSync(partial).size) throw new Error('Empty fixture');
    renameSync(partial, p);
    return p;
  } catch {
    if (existsSync(partial)) unlinkSync(partial);
    throw new Error(`BLOCKED: required controlled-camera fixture ${file} is unavailable from ${url}. No browser evidence was produced.`);
  }
}

/**
 * Exact URLs from the export under test; all requests still require GET/no
 * body and an exact URL match. In particular, sharing the app origin is never
 * permission to upload, call a dynamic endpoint or add query-carried data.
 */
function expectedStaticUrls(): Set<string> {
  const dist = path.resolve(process.env.WSF_MV_STATIC_ASSET_DIR || path.join(APP, 'dist'));
  if (!existsSync(dist) || !statSync(dist).isDirectory()) {
    throw new Error(`BLOCKED: exact app export is missing at ${dist}. Set WSF_MV_STATIC_ASSET_DIR to the export served at WSF_PLAYWRIGHT_BASE_URL.`);
  }
  const urls = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) {
        const relative = path.relative(dist, file).split(path.sep).map(encodeURIComponent).join('/');
        urls.add(new URL(`/${relative}`, BASE!).href);
      }
    }
  };
  walk(dist);
  if (!urls.size) throw new Error('BLOCKED: the exact app export contains no static assets.');
  urls.add(new URL(ROUTE, BASE!).href);
  urls.add(new URL(`${ROUTE}?delegate=cpu`, BASE!).href);
  for (const file of WASM_FILES) urls.add(`${WASM_BASE}/${file}`);
  urls.add(MODEL_URL);
  return urls;
}

/** Controlled asset fulfillment; a separate real-host test must fetch them without interception. */
async function routeEngineAssets(page: Page, modelPath: string) {
  for (const name of WASM_FILES) {
    await page.route(`${WASM_BASE}/${name}`, (route) => {
      const body = readFileSync(path.join(WASM_DIR, name));
      return route.fulfill({
        body,
        contentType: name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
        headers: { 'access-control-allow-origin': '*' },
      });
    });
  }
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
    const expected = expectedStaticUrls();
    const browser = await chromium.launch({
      executablePath: process.env.WSF_PLAYWRIGHT_CHROMIUM || undefined,
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-video-capture=${feed}`,
      ],
    });
    try {
      const ctx = await browser.newContext({ baseURL: BASE, permissions: ['camera'], serviceWorkers: 'block' });
      const requests: MovementLabRequest[] = [];
      ctx.on('request', (r) => requests.push({ url: r.url(), method: r.method(), bodyBytes: r.postDataBuffer()?.byteLength ?? 0 }));
      const page = await ctx.newPage();
      page.on('websocket', (socket) => requests.push({ url: socket.url(), method: 'WEBSOCKET', bodyBytes: 0 }));
      await routeEngineAssets(page, modelPath);
      // Headless Chromium has no real GPU; its emulated one runs the model at
      // ~1 fps. The CPU (XNNPACK) path is the honest fast path here.
      await page.goto(`${ROUTE}?delegate=cpu`);
      await page.getByTestId('mv-start-camera').click();
      await expect(page.getByTestId('mv-debug-readout')).toContainText('engine: mediapipe-tasks-vision@', {
        timeout: 60_000,
      });
      const close = async () => {
        await browser.close();
        expect(requests.map((r) => movementRequestViolation(r, expected)).filter(Boolean)).toEqual([]);
      };
      return { page, close };
    } catch (error) {
      await browser.close();
      throw error;
    }
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

  test('controlled negative fixture: the real engine locks on the photo and warped cycles count exactly zero', async () => {
    test.setTimeout(180_000);
    const model = download(MODEL_URL, 'pose_landmarker_lite.task');
    const photo = download(PHOTO_URL, 'person.jpg');
    const feed = await makeFeed('one-person.mjpeg', photo, 10.5, (t) => [{ cx: 0.5, h: 0.9, squat: squatCycle(t) }]);
    const { page, close } = await openWithFeed(feed, model);
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
      // A photo warp is a negative fixture, not a ground-truth squat. The
      // previous <= 5 check could pass one through five invented counts.
      expect(await reps(page)).toBe(0);
      writeFileSync(
        path.join(OUT, 'fake-camera-one-person-trace.txt'),
        `max depth seen: ${maxDepth}\n${trace.join('\n')}\n`,
      );
    } finally {
      await close();
    }
  });

  test('two people side by side in the zone: the engine reports both, and the lock refuses to choose', async () => {
    test.setTimeout(180_000);
    const model = download(MODEL_URL, 'pose_landmarker_lite.task');
    const photo = download(PHOTO_URL, 'person.jpg');
    const feed = await makeFeed('two-people.mjpeg', photo, 2, () => [
      { cx: 0.32, h: 0.85, squat: 0 },
      { cx: 0.68, h: 0.85, squat: 0 },
    ]);
    const { page, close } = await openWithFeed(feed, model);
    try {
      await expect.poll(async () => (await readout(page)).match(/people detected: (\d+)/)?.[1], { timeout: 30_000 }).toBe('2');
      await expect(page.getByTestId('mv-state')).toContainText('More than one person', { timeout: 10_000 });
      await page.waitForTimeout(3_000);
      await expect(page.getByTestId('mv-state')).toContainText('More than one person');
      await page.screenshot({ path: path.join(OUT, 'fake-camera-03-two-people-refused.png') });
      writeFileSync(path.join(OUT, 'fake-camera-two-people.txt'), `${await readout(page)}\n`);
    } finally {
      await close();
    }
  });

  test('controlled edge-person fixture: lite misses the small bystander; this does not prove crowd rejection', async () => {
    test.setTimeout(180_000);
    const model = download(MODEL_URL, 'pose_landmarker_lite.task');
    const photo = download(PHOTO_URL, 'person.jpg');
    const feed = await makeFeed('member-and-bystander.mjpeg', photo, 10.5, (t) => [
      { cx: 0.5, h: 0.9, squat: squatCycle(t) },
      { cx: 0.9, h: 0.5, squat: 0 },
    ]);
    const { page, close } = await openWithFeed(feed, model);
    try {
      await expect(page.getByTestId('mv-state')).toHaveText('Tracking you', { timeout: 30_000 });
      await expect.poll(async () => (await readout(page)).match(/people detected: (\d+)/)?.[1], { timeout: 10_000 }).toBe('1');
      // Record the known limitation explicitly. A future model detecting both
      // people needs a new assertion and evidence, not an inherited "pass".
      await page.waitForTimeout(3_000);
      expect(await readout(page)).toContain('people detected: 1');
      expect(await reps(page)).toBe(0);
      await page.screenshot({ path: path.join(OUT, 'fake-camera-04-member-with-bystander.png') });
      writeFileSync(path.join(OUT, 'fake-camera-bystander.txt'),
        `OBSERVED LIMITATION: the engine reported one person although this fixture contains two.\nThis is NOT evidence of rejecting a detected bystander or real-person crowd safety.\n${await readout(page)}\nreps: ${await reps(page)}\n`);
    } finally {
      await close();
    }
  });
});
