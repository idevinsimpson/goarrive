import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const baseUrl = process.env.COACH_DISCOVERY_URL || 'http://127.0.0.1:4173';
const artifactRoot = resolve('docs/coach-discovery/artifacts');
const screenshotDir = join(artifactRoot, 'screenshots');
const videoScratch = join(tmpdir(), 'goarrive-coach-discovery-video');

await mkdir(screenshotDir, { recursive: true });
await mkdir(videoScratch, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
});

const viewports = [
  { name: 'phone-390x844', width: 390, height: 844 },
  { name: 'tablet-820x1180', width: 820, height: 1180 },
  { name: 'desktop-1440x1000', width: 1440, height: 1000 },
];

for (const viewport of viewports) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/coach-discovery`, { waitUntil: 'networkidle' });
  await page.locator('#coach-discovery-scroll').waitFor({ state: 'visible' });
  await page.evaluate(() => globalThis.document.fonts?.ready);
  await page.screenshot({
    path: join(screenshotDir, `${viewport.name}.png`),
    animations: 'disabled',
  });
  await context.close();
}

const reviewContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  colorScheme: 'dark',
  reducedMotion: 'reduce',
});
const reviewPage = await reviewContext.newPage();
await reviewPage.goto(`${baseUrl}/coach-discovery?present=1`, { waitUntil: 'networkidle' });
await reviewPage.evaluate(() => globalThis.document.fonts?.ready);
for (const scene of [5, 9, 14, 19, 21, 27]) {
  await reviewPage.evaluate((sceneNumber) => {
    const element = globalThis.document.getElementById(`coach-discovery-scene-${sceneNumber}`);
    element?.scrollIntoView({ block: 'start' });
    if (sceneNumber === 9) {
      globalThis.document.getElementById('coach-discovery-scroll')?.scrollBy({ top: 360 });
    }
  }, scene);
  await reviewPage.waitForTimeout(250);
  await reviewPage.screenshot({
    path: join(screenshotDir, `phone-scene-${String(scene).padStart(2, '0')}.png`),
    animations: 'disabled',
  });
}
await reviewContext.close();

const videoContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  colorScheme: 'dark',
  recordVideo: { dir: videoScratch, size: { width: 390, height: 844 } },
});
const videoPage = await videoContext.newPage();
await videoPage.goto(`${baseUrl}/coach-discovery?present=1`, { waitUntil: 'networkidle' });
await videoPage.locator('#coach-discovery-scroll').waitFor({ state: 'visible' });
await videoPage.evaluate(() => globalThis.document.fonts?.ready);
const video = videoPage.video();

const videoStats = await videoPage.evaluate(async () => {
  const scroller = globalThis.document.getElementById('coach-discovery-scroll');
  if (!scroller) throw new Error('Coach discovery scroll container was not found.');
  const noSnapStyle = globalThis.document.createElement('style');
  noSnapStyle.textContent = '#coach-discovery-scroll { scroll-snap-type: none !important; }';
  globalThis.document.head.appendChild(noSnapStyle);
  const maxScroll = scroller.scrollHeight - scroller.clientHeight;
  const step = Math.max(24, maxScroll / 900);
  for (let y = 0; y <= maxScroll; y += step) {
    scroller.scrollTop = y;
    await new Promise((resolveFrame) => setTimeout(resolveFrame, 16));
  }
  scroller.scrollTop = maxScroll;
  await new Promise((resolveFrame) => setTimeout(resolveFrame, 900));
  return { maxScroll, finalScrollTop: scroller.scrollTop };
});

await videoContext.close();
if (!video) throw new Error('Playwright did not create a video handle.');
await video.saveAs(join(artifactRoot, 'coach-discovery-mobile-full.webm'));
await browser.close();

process.stdout.write(`Coach discovery captures saved to ${artifactRoot}\n`);
process.stdout.write(`Video scroll: ${videoStats.finalScrollTop} / ${videoStats.maxScroll}px\n`);
