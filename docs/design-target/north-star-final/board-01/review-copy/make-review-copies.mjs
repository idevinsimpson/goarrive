/**
 * Lightweight, readable copies of the Board 01 candidate — for reviewers and
 * connectors that cannot decode the 1.7 MB original.
 *
 * These are LOSSY COPIES. The artifact of record is the PNG one directory up;
 * nothing here is evidence, and nothing here should be compared pixel for
 * pixel. Each copy is cut from that exact PNG — not re-rendered — at
 * coordinates measured from the board's own DOM, so a panel copy cannot drift
 * out of step with the board it claims to show.
 *
 *   node docs/design-target/north-star-final/board-01/review-copy/make-review-copies.mjs
 *
 * Set WSF_PLAYWRIGHT_CHROMIUM if chromium is not on the default path.
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../../..');
const BOARD_MODULE = path.join(REPO, 'scripts/westayfit/north-star/board-01.mjs');
const SOURCE = path.join(HERE, '..', 'WE_STAY_FIT_NORTH_STAR_BOARD_01_HOME_CANDIDATE.png');

const appRequire = createRequire(path.join(REPO, 'apps/westayfit/package.json'));
const { chromium } = appRequire('playwright');

const mod = await import(pathToFileURL(BOARD_MODULE).href);
const png = readFileSync(SOURCE);
const natW = png.readUInt32BE(16);
const natH = png.readUInt32BE(20);
// The PNG is rendered at 2x, so one board pixel is this many image pixels.
const DPR = natW / mod.width;
if (!Number.isInteger(DPR)) throw new Error(`unexpected source scale: ${natW} / ${mod.width}`);

const browser = await chromium.launch({ executablePath: process.env.WSF_PLAYWRIGHT_CHROMIUM || undefined });

/* 1. Measure the panels on the board's own DOM. */
const htmlPath = path.join(HERE, '.measure.html');
writeFileSync(htmlPath, mod.html, 'utf8');
const measurePage = await browser.newPage({ viewport: { width: mod.width, height: mod.height } });
await measurePage.goto(pathToFileURL(htmlPath).href);
const rects = await measurePage.evaluate(() => {
  const r = (sel) => {
    const b = document.querySelector(sel).getBoundingClientRect();
    return { x: Math.floor(b.left), y: Math.floor(b.top), w: Math.ceil(b.width), h: Math.ceil(b.height) };
  };
  // The first .panel in document order is the lifecycle panel; .panel.dark is
  // the seam. Both are read off the live board rather than hardcoded.
  return { lifecycle: r('.panel'), seam: r('.panel.dark') };
});
await measurePage.close();

/* 2. Cut each copy out of the committed PNG. `outWidth` is the copy's width in
      OUTPUT pixels; x/y/w/h are in board pixels. */
async function copy({ name, x, y, w, h, outWidth, quality, note }) {
  // Output pixels per BOARD pixel. The source PNG is laid out at
  // mod.width * px so that one board pixel is exactly `px` output pixels;
  // DPR only decides what a sensible outWidth is, never the geometry.
  const px = outWidth / w;
  const cropHtml = path.join(HERE, '.crop.html');
  writeFileSync(cropHtml,
    `<!doctype html><meta charset="utf-8"><style>*{margin:0;padding:0}body{overflow:hidden;background:#F7F5F0}` +
    `img{position:absolute;left:${-x * px}px;top:${-y * px}px;width:${mod.width * px}px}</style>` +
    `<img src="${pathToFileURL(SOURCE).href}">`, 'utf8');
  const page = await browser.newPage({
    viewport: { width: Math.round(w * px), height: Math.round(h * px) },
    deviceScaleFactor: 1,
  });
  await page.goto(pathToFileURL(cropHtml).href);
  const loaded = await page.evaluate(async () => {
    const i = document.images[0];
    if (!i.complete) await i.decode().catch(() => {});
    return i.naturalWidth;
  });
  if (!loaded) throw new Error('source PNG did not load');
  const out = path.join(HERE, name);
  await page.screenshot({ path: out, type: 'jpeg', quality });
  await page.close();
  const kb = Math.round(statSync(out).size / 1024);
  console.log(`${name.padEnd(46)} ${Math.round(w * px)}x${Math.round(h * px)}  ${kb} KB  — ${note}`);
  if (kb > 1024) console.error(`  WARNING: ${name} is over 1 MB, which is what these copies exist to avoid.`);
}

mkdirSync(HERE, { recursive: true });
// The whole board at 1600 reads as a composition; the two panels stay at the
// source's full 2x, because their fine print is the part under review.
await copy({ name: 'BOARD-01-review-whole.jpg', x: 0, y: 0, w: mod.width, h: mod.height,
  outWidth: 1600, quality: 80, note: 'the whole board — composition and hierarchy' });
await copy({ name: 'BOARD-01-review-lifecycle-strip.jpg', ...rects.lifecycle,
  outWidth: rects.lifecycle.w * DPR, quality: 86, note: 'lifecycle panel at 2x — eight captures and the drawn ninth' });
await copy({ name: 'BOARD-01-review-seam-panel.jpg', ...rects.seam,
  outWidth: rects.seam.w * DPR, quality: 86, note: 'seam panel at 2x — what #390 approves, and what it does not' });

await browser.close();
console.log(`\nsource: ${path.relative(REPO, SOURCE)} (${natW}x${natH})`);
