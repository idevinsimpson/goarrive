#!/usr/bin/env node
/**
 * Cleanup regressions, driven against a local mock of the Google APIs.
 *
 * The first case is the one that motivated the rewrite: an HTTP 200 whose body
 * is HTML. The previous implementation parsed that to {}, found no `errors`
 * key, and reported every user deleted.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const CLEANUP = path.resolve('.github/wsf-staging/cleanup-synthetic.mjs');
const RUN_TAG = 'e5h-testrun01';
let passed = 0;

function startMock(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}
function writeManifest(dir, manifest) {
  const p = path.join(dir, 'manifest.json');
  fs.writeFileSync(p, JSON.stringify(manifest));
  return p;
}
// Must be async: the mock server runs in THIS process, so a synchronous child
// would block the event loop and the server could never answer it.
function runCleanup(base, manifestPath, receiptPath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLEANUP], {
      env: {
        ...process.env,
        WSF_GOOGLE_ACCESS_TOKEN: 'test-token',
        WSF_CLEANUP_MANIFEST: manifestPath,
        WSF_CLEANUP_RECEIPT: receiptPath,
        WSF_API_BASE: base,
      },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => {
      let receipt = null;
      try { receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')); } catch {}
      resolve({ code, out, err, receipt });
    });
  });
}
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

const fullManifest = {
  project: 'westayfit-staging',
  runTag: RUN_TAG,
  docs: [`wsfCommunityGroups/${RUN_TAG}-grp`],
  users: [`uid-${RUN_TAG}-a`, `uid-${RUN_TAG}-b`],
};

await test('HTML body with HTTP 200 does NOT report success', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-cl-'));
  const { server, base } = await startMock((req, res) => {
    if (req.url.includes('accounts:batchDelete')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>Sign in to continue</body></html>');
      return;
    }
    res.writeHead(404); res.end('{}');
  });
  const r = await runCleanup(base, writeManifest(d, fullManifest), path.join(d, 'receipt.json'));
  server.close();
  assert.equal(r.code, 1, 'an HTML 200 must fail cleanup');
  assert.equal(r.receipt.status, 'INCOMPLETE');
  assert.notEqual(r.receipt.usersDeleted, 2, 'must not claim users were deleted');
  assert.ok(r.receipt.problems.some((p) => /not JSON/.test(p)), 'must name the body-shape failure');
});

await test('a genuinely successful cleanup reports COMPLETE and removes the manifest', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-cl-'));
  let deleted = false;
  const { server, base } = await startMock((req, res) => {
    if (req.url.includes('accounts:batchDelete')) { deleted = true; res.writeHead(200, {'content-type':'application/json'}); res.end('{}'); return; }
    if (req.url.includes('accounts:lookup')) { res.writeHead(200, {'content-type':'application/json'}); res.end('{}'); return; }
    if (req.method === 'DELETE') { res.writeHead(200, {'content-type':'application/json'}); res.end('{}'); return; }
    res.writeHead(404, {'content-type':'application/json'}); res.end('{"error":{"status":"NOT_FOUND"}}');
  });
  const mp = writeManifest(d, fullManifest);
  const r = await runCleanup(base, mp, path.join(d, 'receipt.json'));
  server.close();
  assert.equal(r.code, 0);
  assert.equal(r.receipt.status, 'COMPLETE');
  assert.equal(r.receipt.usersDeleted, 2);
  assert.ok(deleted);
  assert.equal(fs.existsSync(mp), false, 'manifest is removed only on a confirmed complete cleanup');
});

await test('records that survive deletion are reported, not glossed', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-cl-'));
  const { server, base } = await startMock((req, res) => {
    if (req.url.includes('accounts:batchDelete')) { res.writeHead(200,{'content-type':'application/json'}); res.end('{}'); return; }
    // read-back says one user is still there
    if (req.url.includes('accounts:lookup')) {
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({ users: [{ localId: `uid-${RUN_TAG}-b` }] })); return;
    }
    res.writeHead(200,{'content-type':'application/json'}); res.end('{}');
  });
  const mp = writeManifest(d, fullManifest);
  const r = await runCleanup(base, mp, path.join(d, 'receipt.json'));
  server.close();
  assert.equal(r.code, 1, 'a surviving record must fail cleanup');
  assert.equal(r.receipt.status, 'INCOMPLETE');
  assert.equal(r.receipt.unresolvedUsers, 1);
  assert.deepEqual(r.receipt.unresolvedUserIds, [`uid-${RUN_TAG}-b`]);
  assert.equal(fs.existsSync(mp), true, 'the recovery manifest must survive a failed cleanup');
});

await test('partial per-user failure is surfaced', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-cl-'));
  const { server, base } = await startMock((req, res) => {
    if (req.url.includes('accounts:batchDelete')) {
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({ errors: [{ index: 1, message: 'NOT_DELETED' }] })); return;
    }
    if (req.url.includes('accounts:lookup')) { res.writeHead(200,{'content-type':'application/json'}); res.end('{}'); return; }
    res.writeHead(200,{'content-type':'application/json'}); res.end('{}');
  });
  const r = await runCleanup(base, writeManifest(d, fullManifest), path.join(d, 'receipt.json'));
  server.close();
  assert.equal(r.code, 1);
  assert.equal(r.receipt.status, 'INCOMPLETE');
  assert.equal(r.receipt.usersDeleted, 1);
});

await test('a missing manifest is MANIFEST_UNUSABLE, never a clean pass', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-cl-'));
  const r = await runCleanup('http://127.0.0.1:1', path.join(d, 'absent.json'), path.join(d, 'receipt.json'));
  assert.equal(r.code, 1, 'an absent manifest must not exit 0');
  assert.equal(r.receipt.status, 'MANIFEST_UNUSABLE');
  assert.match(r.out, /CLEANUP_STATUS=MANIFEST_UNUSABLE/);
});

await test('an empty manifest is NO_FIXTURES — distinct from a missing one', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-cl-'));
  const mp = writeManifest(d, { project: 'westayfit-staging', runTag: RUN_TAG, docs: [], users: [] });
  const r = await runCleanup('http://127.0.0.1:1', mp, path.join(d, 'receipt.json'));
  assert.equal(r.code, 0);
  assert.equal(r.receipt.status, 'NO_FIXTURES');
});

await test('malformed manifest JSON is refused and preserved', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-cl-'));
  const mp = path.join(d, 'manifest.json');
  fs.writeFileSync(mp, '{not json');
  const r = await runCleanup('http://127.0.0.1:1', mp, path.join(d, 'receipt.json'));
  assert.equal(r.code, 1);
  assert.equal(r.receipt.status, 'MANIFEST_UNUSABLE');
  assert.equal(r.receipt.manifestPreserved, true);
  assert.equal(fs.existsSync(mp), true);
});

await test('an identifier not carrying this run tag is refused, not deleted', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-cl-'));
  let sawDelete = false;
  const { server, base } = await startMock((req, res) => {
    if (req.method === 'DELETE') sawDelete = true;
    res.writeHead(200,{'content-type':'application/json'}); res.end('{}');
  });
  const mp = writeManifest(d, {
    project: 'westayfit-staging', runTag: RUN_TAG,
    docs: ['wsfCommunityGroups/founder-smoke-KEEP-ME'], users: [],
  });
  const r = await runCleanup(base, mp, path.join(d, 'receipt.json'));
  server.close();
  assert.equal(r.code, 1);
  assert.equal(r.receipt.status, 'MANIFEST_UNUSABLE');
  assert.equal(sawDelete, false, 'nothing may be deleted against an untagged identifier');
});


await test('early smoke failure: no evidence dir, no manifest → a real MANIFEST_UNUSABLE receipt', async () => {
  // Run 35244445618: the smoke threw at module load, so the evidence directory
  // was never created. Cleanup then crashed with ENOENT writing its receipt,
  // and the run showed no cleanup outcome at all.
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-cl-'));
  const evidence = path.join(d, 'wsf-evidence');
  assert.equal(fs.existsSync(evidence), false);
  const receiptPath = path.join(evidence, 'cleanup-receipt.json');
  const r = await runCleanup('http://127.0.0.1:1', path.join(evidence, 'cleanup-manifest.json'), receiptPath);
  assert.equal(r.code, 1, 'must still exit nonzero');
  assert.equal(fs.existsSync(receiptPath), true, 'the receipt must be written even though its directory did not exist');
  assert.equal(r.receipt.status, 'MANIFEST_UNUSABLE');
  assert.equal(r.receipt.manifestPreserved, false);
  assert.equal('usersDeleted' in r.receipt, false, 'must not claim any deletion');
  assert.equal('docsDeleted' in r.receipt, false, 'must not claim any deletion');
  assert.match(r.out, /CLEANUP_STATUS=MANIFEST_UNUSABLE/);
  assert.equal(/CLEANUP_STATUS=(COMPLETE|NO_FIXTURES)/.test(r.out), false);
  assert.equal(fs.statSync(evidence).mode & 0o777, 0o700, 'the created directory is restrictive');
  assert.equal(fs.statSync(receiptPath).mode & 0o777, 0o600);
});

console.log(`\ncleanup-synthetic: ${passed} passed`);
