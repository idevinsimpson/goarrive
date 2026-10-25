const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { renderGuestShell } = require('../generate_guest_shell.cjs');
test('checked-in isolated shell is generated with hard-disabled player and exact CSP hashes', () => {
  const html = renderGuestShell();
  assert.equal(html, fs.readFileSync(path.resolve(__dirname, '../../apps/goarrive/public/guest-workout.html'), 'utf8').replace(/\r\n/g, '\n'));
  assert(html.includes('{ enabled: false }'));
  for (const tag of ['script', 'style']) {
    const body = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(html)[1];
    assert(html.includes(`'sha256-${crypto.createHash('sha256').update(body).digest('base64')}'`));
  }
  assert(!/<script[^>]+src=/.test(html)); assert(!/<link[^>]+href=/.test(html));
  assert(html.includes('media-src blob:')); assert(html.includes('connect-src &#39;self&#39;') || html.includes("connect-src 'self'"));
});
test('test-only generator switch does not alter endpoint paths or normal app dependencies', () => {
  const html = renderGuestShell({ syntheticFixture: true }); assert(html.includes('{ enabled: true }'));
  assert(!html.includes('httpsCallable')); assert(!html.includes('getUserMedia(')); assert(!html.includes('localStorage.'));
  assert(!html.includes('completePlaybookSession')); assert(!html.includes('firebaseapp.com'));
});


test('Hosting routes only the two fixed media actions and sets private response headers', () => {
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../firebase.json'), 'utf8'));
  const hosting = Array.isArray(config.hosting) ? config.hosting.find(h => h.target === 'goarrive' || h.site === 'goarrive') : config.hosting;
  const actions = hosting.rewrites.filter(r => r.function?.functionId === 'guestWorkoutMedia');
  assert.deepEqual(actions.map(r => r.source).sort(), ['/guest-workout-api/chunk', '/guest-workout-api/manifest']);
  const headers = hosting.headers.find(h => h.source === '/guest-workout-api/{manifest,chunk}').headers;
  assert(headers.some(h => h.key === 'Cache-Control' && h.value.includes('no-store')));
  assert(headers.some(h => h.key === 'Referrer-Policy' && h.value === 'no-referrer'));
  assert(headers.some(h => h.key === 'Content-Security-Policy' && h.value.includes("default-src 'none'")));
});
