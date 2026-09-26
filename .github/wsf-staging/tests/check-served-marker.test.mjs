#!/usr/bin/env node
/** check-served-marker.mjs: the served build, read before any credential or fixture (CONTROL-PLANE-ACTIVATION-1). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readServedMarker } from '../check-served-marker.mjs';

const CLI = path.resolve('.github/wsf-staging/check-served-marker.mjs');
const SHA = '938e00d8c985993f69becc8924d3037f18425afc';
let passed = 0;
const test = async (n, f) => { await f(); passed += 1; console.log(`  ok  ${n}`); };
const fake = (status, body) => async () => ({ ok: status < 300, status, text: async () => body });

await test('the served marker naming the approved SHA is a match', async () => {
  const r = await readServedMarker({ stagingUrl: 'https://s.example.test/', approvedSha: SHA, fetchImpl: fake(200, `<p>Commit 938e00d</p>`) });
  assert.deepEqual([r.ok, r.status], [true, 'match']);
});
await test('another build is a mismatch', async () => {
  const r = await readServedMarker({ stagingUrl: 'https://s.example.test', approvedSha: SHA, fetchImpl: fake(200, 'Commit 74d1928') });
  assert.deepEqual([r.ok, r.status], [false, 'mismatch']);
});
await test('a non-2xx health page is unreachable, even if it names the SHA', async () => {
  const r = await readServedMarker({ stagingUrl: 'https://s.example.test', approvedSha: SHA, fetchImpl: fake(503, 'Commit 938e00d') });
  assert.deepEqual([r.ok, r.status], [false, 'unreachable']);
});
await test('a transport failure is unreachable, never a match', async () => {
  const r = await readServedMarker({ stagingUrl: 'https://s.example.test', approvedSha: SHA, fetchImpl: async () => { throw Object.assign(new Error('x'), { code: 'ECONNRESET' }); } });
  assert.deepEqual([r.ok, r.status], [false, 'unreachable']);
});
await test('a malformed approved SHA is refused before any request', async () => {
  let called = 0;
  const r = await readServedMarker({ stagingUrl: 'https://s.example.test', approvedSha: 'main', fetchImpl: async () => { called += 1; } });
  assert.deepEqual([r.ok, r.status, called], [false, 'refused', 0]);
});

async function cli(body, status = 200) {
  const server = http.createServer((req, res) => { res.writeHead(req.url === '/health' ? status : 404); res.end(req.url === '/health' ? body : ''); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-mk-'));
  const out = await new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI], { env: { ...process.env, WSF_APPROVED_SHA: SHA, WSF_STAGING_URL: `http://127.0.0.1:${server.address().port}`, WSF_RESULT_DIR: dir } });
    let text = '';
    child.stdout.on('data', (d) => { text += d; });
    child.stderr.on('data', (d) => { text += d; });
    child.on('close', (code) => resolve({ code, text }));
  });
  server.close();
  return { ...out, receipt: JSON.parse(fs.readFileSync(path.join(dir, 'served-marker.json'), 'utf8')) };
}

await test('the CLI: a match exits 0 and records the receipt in the evidence directory', async () => {
  const r = await cli(`<html>Commit ${SHA.slice(0, 7)}</html>`);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /SERVED_MARKER=match/);
  assert.equal(r.receipt.status, 'match');
  assert.equal(r.receipt.approvedSha, SHA);
});
await test('the CLI: the wrong build exits 1 and says it stopped before any credential or fixture', async () => {
  const r = await cli('<html>Commit 74d1928</html>');
  assert.equal(r.code, 1);
  assert.match(r.text, /SERVED_MARKER=mismatch/);
  assert.match(r.text, /Stopping before any credential or fixture/);
  assert.equal(r.receipt.status, 'mismatch');
});
await test('the CLI: a 5xx health page exits 1', async () => {
  const r = await cli('down', 503);
  assert.equal(r.code, 1);
  assert.equal(r.receipt.status, 'unreachable');
});

console.log(`\ncheck-served-marker: ${passed} passed`);
