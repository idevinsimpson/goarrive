// YOU-PARITY-1 evidence-only diagnostic (not product code, not a test).
//
// The canonical band has no descriptor line (Director #492 5841276795: no
// filler "Community"), so it is one line shorter than the reference's band
// ("Moving together this week"). The spec's band-TOP alignment therefore
// carries that recorded offset through everything below the band. This set
// aligns at the band's BOTTOM edge instead, so the lead and the rows below it
// are measured on their own. Same comparator rules as the spec: summed channel
// difference > 48, a measured figure, not a verdict.
//
// Run from the repo root:  node docs/design-target/review/you-parity-1/tools/lead-aligned.mjs
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.resolve('apps/westayfit/package.json'));
const { chromium } = require('@playwright/test');

const OUT = path.resolve('docs/design-target/review/you-parity-1');
const TAB_BAR = 75;
const topFor = (h) => (h <= 700 ? 86 : 92);
const SHOTS = [
  ['normal', 844], ['normal', 640], ['no-own', 844], ['no-own', 640], ['no-eligible', 844],
];

const exe = fs.readdirSync('/opt/pw-browsers').filter((d) => d.startsWith('chromium-')).map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`)[0];
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage();
const dataUrl = (f) => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
const results = [];
for (const [state, h] of SHOTS) {
  const name = `you-${state}-390x${h}`;
  const ref = path.join(OUT, 'lovable-642f830b', `${name}.png`);
  const view = path.join(OUT, 'fixture', `${name}.png`);
  await page.setContent('<html><body style="margin:0"></body></html>');
  const out = await page.evaluate(async ([a, b, top, bottom]) => {
    const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const navy = (d, y) => Math.abs(d[y * 4] - 0x0b) <= 6 && Math.abs(d[y * 4 + 1] - 0x1f) <= 6 && Math.abs(d[y * 4 + 2] - 0x3a) <= 6;
    const bandBottom = (img) => {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const d = x.getImageData(5, 0, 1, img.height).data;
      let y = top; while (y < img.height && !navy(d, y)) y += 1;
      while (y < img.height && navy(d, y)) y += 1;
      return y;
    };
    const ya = bandBottom(ia); const yb = bandBottom(ib);
    const w = Math.max(ia.width, ib.width); const hh = Math.min(bottom - ya, bottom - yb);
    const cv = (cw, ch) => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; return [c, c.getContext('2d')]; };
    const [side, sx] = cv(w * 2 + 12, hh); sx.fillStyle = '#fff'; sx.fillRect(0, 0, side.width, hh);
    sx.drawImage(ia, 0, ya, w, hh, 0, 0, w, hh); sx.drawImage(ib, 0, yb, w, hh, w + 12, 0, w, hh);
    const [over, ox] = cv(w, hh); ox.drawImage(ia, 0, ya, w, hh, 0, 0, w, hh); ox.globalAlpha = 0.5; ox.drawImage(ib, 0, yb, w, hh, 0, 0, w, hh);
    const [diff, dx] = cv(w, hh); dx.drawImage(ia, 0, ya, w, hh, 0, 0, w, hh); dx.globalCompositeOperation = 'difference'; dx.drawImage(ib, 0, yb, w, hh, 0, 0, w, hh);
    const px = dx.getImageData(0, 0, w, hh).data; let n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 48) n += 1;
    return { ya, yb, h: hh, share: n / (w * hh), side: side.toDataURL('image/png'), over: over.toDataURL('image/png'), diff: diff.toDataURL('image/png') };
  }, [dataUrl(ref), dataUrl(view), topFor(h), h - TAB_BAR]);
  const write = (suffix, url) => {
    const f = path.join(OUT, 'fixture', `cmp-${name}-lead-aligned-${suffix}.png`);
    fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
    return path.relative(OUT, f);
  };
  results.push({
    state, viewport: `390x${h}`,
    referenceBandBottom: out.ya, viewBandBottom: out.yb, viewShiftPx: out.ya - out.yb, height: out.h,
    sideBySide: write('side-by-side', out.side), overlay50: write('overlay-50', out.over), difference: write('difference', out.diff),
    differingPixelShare: Number(out.share.toFixed(4)),
    lovableSha256: createHash('sha256').update(fs.readFileSync(ref)).digest('hex'),
    fixtureSha256: createHash('sha256').update(fs.readFileSync(view)).digest('hex'),
  });
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'fixture', 'lead-aligned.json'), `${JSON.stringify({ note: 'supplementary diagnostic; aligned at the community band bottom edge', frames: results }, null, 2)}\n`);
for (const r of results) console.log(r.state, r.viewport, r.viewShiftPx, r.differingPixelShare);
