#!/usr/bin/env node
/**
 * Renders a canonical North Star board to PNG, deterministically, FROM THIS
 * REPOSITORY.
 *
 * WHY THIS EXISTS RATHER THAN AN IMAGE GENERATOR. Boards 02–11 were locked in
 * review and their final PNGs were never persisted, so the decisions survive
 * only as prose. Regenerating them from a prompt would produce a different
 * picture every time and could not be checked against anything. A board
 * rendered from the repo's own assets and its own calibration table is the
 * same picture on every run, and every claim on it is one the code can be
 * asked about.
 *
 * WHAT IS REAL HERE, and it is the whole point:
 *   · the wordmark and monogram are the owner-supplied derived PNGs, composited
 *     byte-faithfully — never redrawn, recoloured or approximated;
 *   · every Living WE fill height comes from `living-we-calibration.json`, the
 *     same area table `heightFractionForFill()` reads at runtime, so the green
 *     AREA matches the ratio exactly as it does in the product;
 *   · the palette, the type scale and the copy are the locked values, quoted
 *     from the board's lock verdict rather than invented.
 *
 * Usage:  node scripts/westayfit/north-star/render-board.mjs <board-module.mjs> <out.png>
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/*
  Playwright lives in the app package, not at the repo root, and an ESM
  `import` resolves from THIS FILE's directory rather than the working
  directory — so a bare specifier fails here however the script is invoked.
  Resolved explicitly against `apps/westayfit` so the renderer can be run from
  anywhere, which is what a docs tool has to survive.
*/
const HERE_DIR = path.dirname(fileURLToPath(import.meta.url));
const appRequire = createRequire(
  path.join(path.resolve(HERE_DIR, '../../..'), 'apps/westayfit/package.json')
);
const { chromium } = appRequire('playwright');

const [, , boardModulePath, outPath] = process.argv;
if (!boardModulePath || !outPath) {
  console.error('usage: render-board.mjs <board-module.mjs> <out.png>');
  process.exit(1);
}

const mod = await import(pathToFileURL(path.resolve(boardModulePath)).href);
if (typeof mod.html !== 'string' || typeof mod.width !== 'number' || typeof mod.height !== 'number') {
  console.error('board module must export { html, width, height }');
  process.exit(1);
}

const scratch = process.env.WSF_BOARD_SCRATCH || '/tmp';
mkdirSync(scratch, { recursive: true });
const htmlPath = path.join(scratch, `${path.basename(boardModulePath, '.mjs')}.html`);
writeFileSync(htmlPath, mod.html, 'utf8');

const browser = await chromium.launch({
  executablePath: process.env.WSF_PLAYWRIGHT_CHROMIUM || undefined,
});
/*
  2x by default, so the board is legible at full size AND at useful zoom,
  which the review protocol asks for explicitly. WSF_BOARD_SCALE=1 renders
  the same board at 1x — a readable REVIEW COPY for a reviewer whose tools
  cannot decode a 2560-wide binary. Same module, same layout, same pixels
  at half the density; never a different picture.
*/
const scale = Number(process.env.WSF_BOARD_SCALE || 2);
const page = await browser.newPage({
  viewport: { width: mod.width, height: mod.height },
  deviceScaleFactor: scale,
});
await page.goto(pathToFileURL(htmlPath).href);
// Every image must have decoded before the shot: a board that photographs a
// half-loaded wordmark is a board that silently ships a missing asset.
const missing = await page.evaluate(async () => {
  const imgs = Array.from(document.images);
  await Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : i.decode().catch(() => {}))));
  return imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src);
});
if (missing.length) {
  console.error('BOARD NOT RENDERED — these images did not load:');
  for (const m of missing) console.error('  ' + m);
  await browser.close();
  process.exit(1);
}
mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
await page.screenshot({ path: outPath, fullPage: false });
await browser.close();
console.log(`rendered ${outPath} (${mod.width}x${mod.height} @${scale}x)`);
