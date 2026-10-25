/* Explicit local-only acceptance. Requires existing Playwright/Chromium and a
 * generated synthetic test-pattern video, never a live credential/media file. */
const http = require('http'), fs = require('fs'), assert = require('assert');
const { renderGuestShell } = require('../generate_guest_shell.cjs');
const { chromium } = require(process.env.GUEST_PLAYWRIGHT_MODULE);
const videoBytes = fs.readFileSync(process.env.GUEST_SYNTHETIC_VIDEO);
const token = 'a'.repeat(43), revision = 'b'.repeat(64);
let enabled = false, revoked = false, failManifest = false, failChunk = false, delay = 0, ttl = 25000, api = [], external = 0, unexpected = 0;
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Permissions-Policy', 'camera=(), microphone=()');
  if (req.url === '/away') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Away</title><p>Local navigation fixture</p>'); return; }
  if (req.url === '/guest-workout') { res.setHeader('Content-Type', 'text/html'); res.end(renderGuestShell({ syntheticFixture: enabled })); return; }
  if (!['/guest-workout-api/manifest', '/guest-workout-api/chunk'].includes(req.url)) { unexpected++; res.statusCode = 404; res.end(); return; }
  api.push({ path: req.url, method: req.method, cookie: !!req.headers.cookie, referrer: !!req.headers.referer });
  if (req.headers.authorization !== 'Bearer ' + token || revoked || (failManifest && req.url.endsWith('manifest')) || (failChunk && req.url.endsWith('chunk'))) { res.statusCode = 404; res.end('unavailable'); return; }
  if (req.url.endsWith('manifest')) {
    const movement = { name: 'Synthetic test pattern', sets: 1, reps: '10', workSec: 6, restSec: 0, videoAsset: 'asset-0', thumbnailAsset: null };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ revision, serverNow: Date.now(), validUntil: Date.now() + ttl, assets: [{ id: 'asset-0', kind: 'video' }], workout: { blocks: [{ type: 'Strength', movements: [movement, { ...movement, name: 'Second test movement' }] }] } })); return;
  }
  if (delay) await new Promise(r => setTimeout(r, delay));
  const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
  if (!match || +match[2] >= videoBytes.length) { res.statusCode = 404; res.end(); return; }
  res.statusCode = 206; res.setHeader('Content-Type', 'video/webm'); res.setHeader('Content-Range', `bytes ${match[1]}-${match[2]}/${videoBytes.length}`); res.end(videoBytes.subarray(+match[1], +match[2] + 1));
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.GUEST_CHROMIUM_PATH });
  const results = [];
  try {
    const open = async () => {
      const page = await browser.newPage();
      await page.addInitScript(() => {
        window.guestTest = { urls: [], revoked: [], mediaRequests: 0 };
        const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = blob => { const url = create(blob); window.guestTest.urls.push(url); return url; };
        URL.revokeObjectURL = url => { window.guestTest.revoked.push(url); revoke(url); };
        if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { window.guestTest.mediaRequests++; throw new Error('Forbidden'); };
      });
      await page.route('**/*', route => { if (!route.request().url().startsWith(origin)) { external++; return route.abort(); } return route.continue(); });
      await page.goto(origin + '/guest-workout#key=' + token);
      await page.waitForFunction(() => location.hash === '' && location.search === '');
      return page;
    };
    let page = await open(); await page.getByText('Guest playback is not available yet.', { exact: false }).waitFor(); assert.strictEqual(api.length, 0); await page.close(); results.push('disabled shell: zero API/media requests');
    enabled = true; page = await open(); await page.getByRole('button', { name: 'Play movement video' }).waitFor(); assert(api.every(r => r.path.endsWith('manifest')));
    await page.getByRole('button', { name: 'Play movement video' }).click();
    await page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.currentTime > .2 && v.videoWidth === 160; });
    await page.evaluate(() => { const v = document.querySelector('video'); v.pause(); v.currentTime = 3; });
    await page.waitForFunction(() => { const v = document.querySelector('video'); return v && !v.seeking && Math.abs(v.currentTime - 3) < .15; });
    const decoded = await page.evaluate(() => { const v = document.querySelector('video'); return { width: v.videoWidth, height: v.videoHeight, duration: v.duration, frames: v.getVideoPlaybackQuality().totalVideoFrames }; });
    assert(decoded.frames > 0); results.push({ syntheticPlaybackAndSeek: decoded });
    await page.getByRole('button', { name: 'Next movement' }).click(); await page.getByRole('heading', { name: 'Second test movement' }).waitFor();
    assert.strictEqual(await page.evaluate(() => document.querySelector('video').hasAttribute('src')), false);
    await page.getByRole('button', { name: 'Play movement video' }).click(); await page.waitForFunction(() => document.querySelector('video').currentTime > .1);
    revoked = true; await page.getByText('Workout closed or access unavailable.', { exact: false }).waitFor({ timeout: 16000 });
    assert.strictEqual(await page.evaluate(() => window.guestTest.urls.length === window.guestTest.revoked.length && window.guestTest.mediaRequests === 0 && !document.querySelector('video')), true);
    assert.deepStrictEqual(await page.evaluate(async () => [localStorage.length, sessionStorage.length, (await caches.keys()).length]), [0, 0, 0]);
    await page.close(); results.push('revocation renewal removes media and revokes all blobs');
    revoked = false; ttl = 900; page = await open(); await page.getByText('Workout closed or access unavailable.', { exact: false }).waitFor({ timeout: 5000 }); await page.close(); results.push('independent short admission expiry closes shell'); ttl = 25000;
    failManifest = true; page = await open(); await page.getByText('Workout closed or access unavailable.', { exact: false }).waitFor(); await page.close(); failManifest = false; results.push('failed admission: safe unavailable state');
    failChunk = true; page = await open(); await page.getByRole('button', { name: 'Play movement video' }).click(); await page.getByText('Workout closed or access unavailable.', { exact: false }).waitFor(); await page.close(); failChunk = false; results.push('failed range: no fallback or partial player');
    delay = 1200; page = await open(); await page.getByRole('button', { name: 'Play movement video' }).click(); await page.getByRole('button', { name: 'Close workout' }).click();
    await page.waitForTimeout(1600); assert.strictEqual(await page.evaluate(() => !document.querySelector('video') && window.guestTest.urls.length === 0), true); await page.close(); delay = 0; results.push('close during delayed chunk: no resurrection');
    page = await open(); await page.getByRole('button', { name: 'Play movement video' }).click(); await page.waitForFunction(() => document.querySelector('video').currentTime > .1);
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))); await page.getByText('Workout closed or access unavailable.', { exact: false }).waitFor();
    await page.reload(); await page.getByText('This workout link is unavailable.', { exact: false }).waitFor(); await page.close(); results.push('pagehide/BFCache cleanup; scrubbed reload cannot restore token');
    page = await open(); await page.getByRole('button', { name: 'Play movement video' }).waitFor(); const beforeHistory = api.length;
    await page.goto(origin + '/away'); await page.goBack(); await page.getByRole('status').filter({ hasText: /closed|unavailable/ }).waitFor();
    assert.strictEqual(api.length, beforeHistory); assert.strictEqual(new URL(page.url()).hash, '');
    await page.goForward(); assert(page.url().endsWith('/away')); await page.close(); results.push('actual Back/Forward navigation does not retain capability or reload workout');
    assert.strictEqual(external, 0); assert.strictEqual(unexpected, 0); assert(api.every(r => r.method === 'POST' && !r.cookie && !r.referrer));
    console.log(JSON.stringify({ passed: true, mode: 'headless Chromium; localhost synthetic HTTP; FFmpeg test-pattern video only', results, requests: api.length, externalRequests: external, unexpectedRequestsIncludingCompletionVoiceZoom: unexpected }, null, 2));
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; server.close(); });
