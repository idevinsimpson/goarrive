#!/usr/bin/env node
/**
 * Verifier regressions. The cases that matter are the ones where evidence is
 * absent or malformed: a verifier that treats "I could not read it" as "it is
 * fine" turns a failed deploy into a green receipt.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const VERIFY = path.resolve('.github/wsf-staging/verify-deployment.mjs');
const SHA = '8e1a3ed485a5c0eadbcb23c1f35becad455923c7';
let passed = 0;

const NAMES = [
  'wsfadjustgoal','wsfchallengepulse','wsfcheckin','wsfcontribute','wsfcreatecommunity',
  'wsfcreategoal','wsfdesignatechampion','wsfgoalpulse','wsfhealth','wsfjoincommunity',
  'wsfleavecommunity','wsflistchallenge','wsflistgoals','wsfmycommunities','wsfmycontribution',
  'wsfpreviewcommunity','wsfreinstatemember','wsfremovemember','wsfresetjoincode','wsfsaveprofile',
  'wsfsendpasswordresetemail','wsfsendverificationemail',
];
const ALL = [...NAMES, 'wsfsetgoaldisplayauthorization'];

function fn(n) { return { name: `projects/westayfit-staging/locations/us-central1/functions/${n}` }; }
function svc(n, extra = {}) {
  return { name: `projects/westayfit-staging/locations/us-central1/services/${n}`, invokerIamDisabled: true, template: { scaling: {} }, ...extra };
}
function startMock({ functions = ALL, services = null, health = SHA.slice(0, 7), healthStatus = 200, channels = [{ name: 'sites/westayfit-staging/channels/staging', url: 'https://x', expireTime: 'later' }] } = {}) {
  const svcList = services || ALL.map((n) => svc(n));
  const server = http.createServer((req, res) => {
    const j = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url.includes('/functions')) return j({ functions: functions.map(fn) });
    if (req.url.includes('/services')) return j({ services: svcList });
    if (req.url.includes('/channels')) return j({ channels });
    if (req.url.includes('/health')) { res.writeHead(healthStatus, { 'content-type': 'text/html' }); return res.end(`<html>${health}</html>`); }
    res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}');
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, base: `http://127.0.0.1:${server.address().port}` })));
}
function run(base, beforeFile, dir) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [VERIFY], { env: { ...process.env,
      WSF_GOOGLE_ACCESS_TOKEN: 't', WSF_APPROVED_SHA: SHA, WSF_STAGING_URL: `${base}`,
      WSF_INVENTORY_BEFORE: beforeFile, WSF_RESULT_DIR: dir, WSF_API_BASE: base } });
    let out = '', err = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    c.on('close', (code) => {
      let receipt = null;
      try { receipt = JSON.parse(fs.readFileSync(path.join(dir, 'wsf-package-e-deployment-verification.json'), 'utf8')); } catch {}
      resolve({ code, out, err, receipt });
    });
  });
}
function beforeFile(dir, names = NAMES) {
  const p = path.join(dir, 'before.json');
  fs.writeFileSync(p, JSON.stringify({ functions: names }));
  return p;
}
async function test(name, f) { await f(); passed += 1; console.log(`  ok  ${name}`); }

await test('a complete deploy passes and records the created function', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-v-'));
  const { server, base } = await startMock();
  const r = await run(base, beforeFile(d), d);
  server.close();
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /VERIFY=pass/);
  assert.deepEqual(r.receipt.inventory.createdThisDeploy, ['wsfsetgoaldisplayauthorization']);
});

await test('a MISSING before-inventory is an error, not an empty project', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-v-'));
  const { server, base } = await startMock();
  const r = await run(base, path.join(d, 'absent.json'), d);
  server.close();
  assert.equal(r.code, 1);
  assert.match(r.err, /no valid before-inventory/);
});

await test('a MALFORMED before-inventory is an error', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-v-'));
  const p = path.join(d, 'before.json');
  fs.writeFileSync(p, '<html>proxy error</html>');
  const { server, base } = await startMock();
  const r = await run(base, p, d);
  server.close();
  assert.equal(r.code, 1);
  assert.match(r.err, /no valid before-inventory/);
});

await test('a function that existed before and is gone now fails', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-v-'));
  const { server, base } = await startMock({ functions: ALL.filter((n) => n !== 'wsfhealth') });
  const r = await run(base, beforeFile(d), d);
  server.close();
  assert.equal(r.code, 1);
  assert.match(r.err, /now gone: wsfhealth/);
});

await test('the new callable being absent fails even at the right count', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-v-'));
  // 23 functions, but one is an unrelated extra rather than Package E's.
  const decoys = [...NAMES, 'wsfsomethingelse'];
  const { server, base } = await startMock({ functions: decoys, services: decoys.map((n) => svc(n)) });
  const r = await run(base, beforeFile(d), d);
  server.close();
  assert.equal(r.code, 1);
  assert.match(r.err, /Package E did not deploy/);
});

await test('minInstanceCount omitted with scaling present = documented default', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-v-'));
  const { server, base } = await startMock();
  const r = await run(base, beforeFile(d), d);
  server.close();
  assert.equal(r.receipt.wsfCheckIn.state, 'default_omitted');
  assert.equal(r.receipt.wsfCheckIn.value, 0);
});

await test('a MISSING template is "unavailable" and fails — never coerced to zero', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-v-'));
  const services = ALL.map((n) => (n === 'wsfcheckin' ? { name: `.../services/${n}`, invokerIamDisabled: true } : svc(n)));
  const { server, base } = await startMock({ services });
  const r = await run(base, beforeFile(d), d);
  server.close();
  assert.equal(r.code, 1);
  assert.equal(r.receipt.wsfCheckIn.state, 'unavailable');
  assert.notEqual(r.receipt.wsfCheckIn.value, 0);
});

await test('a nonzero minimum fails', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-v-'));
  const services = ALL.map((n) => (n === 'wsfcheckin' ? svc(n, { template: { scaling: { minInstanceCount: 1 } } }) : svc(n)));
  const { server, base } = await startMock({ services });
  const r = await run(base, beforeFile(d), d);
  server.close();
  assert.equal(r.code, 1);
  assert.match(r.err, /minInstances is 1/);
});

await test('existing transport drift fails', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-v-'));
  const services = ALL.map((n) => (n === 'wsfgoalpulse' ? svc(n, { invokerIamDisabled: false }) : svc(n)));
  const { server, base } = await startMock({ services });
  const r = await run(base, beforeFile(d), d);
  server.close();
  assert.equal(r.code, 1);
  assert.match(r.err, /transport drifted/);
});

await test('a wrong build marker on the hosted page fails', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-v-'));
  const { server, base } = await startMock({ health: 'deadbee' });
  const r = await run(base, beforeFile(d), d);
  server.close();
  assert.equal(r.code, 1);
  assert.match(r.err, /build marker does not match/);
});

await test('the receipt does NOT assert production was unchanged', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-v-'));
  const { server, base } = await startMock();
  const r = await run(base, beforeFile(d), d);
  server.close();
  assert.equal(r.receipt.productionResourcesChanged, undefined, 'must not prefill a production claim');
  assert.ok(r.receipt.scopeOfVerification.notQueried.some((s) => /goarrive/.test(s)));
});

await test('the new service transport is reported, not treated as a failure', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-v-'));
  const services = ALL.map((n) => (n === 'wsfsetgoaldisplayauthorization' ? svc(n, { invokerIamDisabled: false }) : svc(n)));
  const { server, base } = await startMock({ services });
  const r = await run(base, beforeFile(d), d);
  server.close();
  assert.equal(r.code, 0, 'transport state alone must not fail the deploy verification');
  assert.equal(r.receipt.newServiceTransport, 'invoker_iam_check_enabled');
  assert.equal(r.receipt.newServiceTransportRequiresSeparateApproval, true);
});

console.log(`\nverify-deployment: ${passed} passed`);
