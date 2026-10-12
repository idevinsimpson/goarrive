// Renders the target mockups and the contact sheet in this folder to PNGs one
// folder up. Every image it produces is a CONCEPT: it is marked as such in the
// image itself, and nothing here is a screenshot of the product.
//
//   node docs/design-target/src/render.mjs
//
// Chromium comes from CHROMIUM_PATH when set; the default is the one this repo's
// Playwright install provides.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');
const REPO = path.resolve(HERE, '..', '..', '..');

// playwright-core is a dependency of the app workspace, not of the repo root,
// so resolve it from there rather than from this file's own folder.
const require = createRequire(path.join(REPO, 'apps/westayfit/package.json'));
const { chromium } = require('playwright-core');

// Playwright finds its own Chromium in most checkouts. Where the browser lives
// outside the usual place, CHROMIUM_PATH names it.
const EXECUTABLE = process.env.CHROMIUM_PATH
  || (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
      ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
      : undefined);

const SCREENS = [
  ['s-home',       'targets/TARGET-01-home-390x844.png'],
  ['s-home-short', 'targets/TARGET-02-home-short-390x640.png'],
  ['s-move',       'targets/TARGET-03-move-390x844.png'],
  ['s-confirmed',  'targets/TARGET-04-confirmed-celebration-390x844.png'],
  ['s-community',  'targets/TARGET-05-community-390x844.png'],
  ['s-progress',   'targets/TARGET-06-progress-390x844.png'],
  ['s-you',        'targets/TARGET-07-you-390x844.png'],
  ['s-picker',     'targets/TARGET-08-movement-picker-390x844.png'],
  ['s-shell',      'targets/TARGET-09-shell-navigation-390x844.png'],
];

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});

const screens = await browser.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
await screens.goto('file://' + path.join(HERE, 'targets.html'), { waitUntil: 'networkidle' });
await screens.waitForTimeout(1200);
for (const [id, file] of SCREENS) {
  const el = screens.locator('#' + id);
  const box = await el.boundingBox();
  await el.screenshot({ path: path.join(OUT, file) });
  console.log(`${file}  ${Math.round(box.width)}x${Math.round(box.height)}`);
}

// The contact sheet embeds the PNGs above, so it is rendered after them.
const sheet = await browser.newPage({ viewport: { width: 1500, height: 1200 }, deviceScaleFactor: 1.5 });
await sheet.goto('file://' + path.join(HERE, 'contact.html'), { waitUntil: 'networkidle' });
await sheet.waitForTimeout(1500);
const el = sheet.locator('#sheet');
const box = await el.boundingBox();
await el.screenshot({ path: path.join(OUT, 'CONTACT-SHEET-before-to-targets.png') });
console.log(`CONTACT-SHEET-before-to-targets.png  ${Math.round(box.width)}x${Math.round(box.height)}`);

await browser.close();
