#!/usr/bin/env node
/**
 * The recovery gates for hosted run 35248719827's preserved manifest. The
 * real manifest is not in the repository (and must not be), so the accept path
 * is proven with a test manifest and a pins file that names ITS hash; the
 * committed pins file is proven to refuse anything else.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.resolve('.github/wsf-staging/recovery-35248719827.mjs');
const PINS = path.resolve('.github/wsf-staging/recovery-35248719827.json');
const pins = JSON.parse(fs.readFileSync(PINS, 'utf8'));
let passed = 0;
const test = (n, f) => { f(); passed += 1; console.log(`  ok  ${n}`); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-rec-'));
const run = (...args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function uid() {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return [...crypto.randomBytes(28)].map((b) => a[b % a.length]).join('');
}
function manifestFor(tag, users = 9, documents = 74) {
  const u = Array.from({ length: users }, uid);
  const docs = [];
  for (let i = 0; docs.length < documents; i += 1) docs.push(`wsfGoals/e5goal-${tag}-x-${i}`);
  return { project: 'westayfit-staging', runTag: tag, users: u, docs };
}
function writePins(dir, overrides) {
  const p = path.join(dir, 'pins.json');
  fs.writeFileSync(p, JSON.stringify({ ...pins, ...overrides }));
  return p;
}
function writeManifest(dir, manifest) {
  const p = path.join(dir, 'cleanup-manifest.json');
  fs.writeFileSync(p, JSON.stringify(manifest, null, 2) + '\n');
  return p;
}

test('the committed recovery record pins exactly the reviewed run, artifact, hash, project, tag and counts', () => {
  assert.equal(pins.runId, 35248719827);
  assert.equal(pins.artifactName, 'wsf-hosted-evidence');
  assert.equal(pins.manifestFile, 'cleanup-manifest.json');
  assert.equal(pins.sha256, '102a92a0fd55c51ea2566224b7a66422f09bd3691e19e92725ebfe639dc55ad0');
  assert.equal(pins.project, 'westayfit-staging');
  assert.equal(pins.runTag, 'e5h-mu5rq05h-ea157c');
  assert.equal(pins.users, 9);
  assert.equal(pins.documents, 74);
});

test('verify-manifest accepts a file whose bytes hash to the pinned value with matching project, tag and counts', () => {
  const d = tmp();
  const m = manifestFor(pins.runTag);
  const mp = writeManifest(d, m);
  const pp = writePins(d, { sha256: sha(fs.readFileSync(mp)) });
  const out = path.join(d, 'evidence', 'recovery-verification.json');
  const r = run('verify-manifest', pp, mp, out);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^RECOVERY_MANIFEST=verified sha256=[0-9a-f]{64} users=9 documents=74$/m);
  const v = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(v.runId, 35248719827);
  assert.equal(v.users, 9);
  assert.equal(v.documents, 74);
  assert.equal(fs.statSync(out).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(out)).mode & 0o777, 0o700);
});

test('the COMMITTED pins refuse a manifest with the right shape but different bytes (hash is enforced)', () => {
  const d = tmp();
  const mp = writeManifest(d, manifestFor(pins.runTag));
  const out = path.join(d, 'v.json');
  const r = run('verify-manifest', PINS, mp, out);
  assert.equal(r.code, 1);
  assert.match(r.err, /SHA-256 does not match/);
  assert.equal(fs.existsSync(out), false, 'no verification record on refusal');
});

for (const [name, mutate, expect] of [
  ['a different run tag', (m) => ({ ...m, runTag: 'e5h-someotherrun' }), /runTag does not match/],
  ['a different project', (m) => ({ ...m, project: 'goarrive' }), /project does not match/],
  ['8 users instead of 9', (m) => ({ ...m, users: m.users.slice(0, 8) }), /users count 8 != 9/],
  ['75 documents instead of 74', (m) => ({ ...m, docs: [...m.docs, `wsfGoals/e5goal-${m.runTag}-extra`] }), /documents count 75 != 74/],
  ['a duplicated document path', (m) => ({ ...m, docs: [...m.docs.slice(0, 73), m.docs[0]] }), /docs contains duplicates/],
  ['a non-string user', (m) => ({ ...m, users: [...m.users.slice(0, 8), 42] }), /users contains a non-string/],
]) {
  test(`verify-manifest refuses ${name} even when the hash is made to match`, () => {
    const d = tmp();
    const mp = writeManifest(d, mutate(manifestFor(pins.runTag)));
    const pp = writePins(d, { sha256: sha(fs.readFileSync(mp)) });
    const out = path.join(d, 'v.json');
    const r = run('verify-manifest', pp, mp, out);
    assert.equal(r.code, 1);
    assert.match(r.err, expect);
    assert.equal(fs.existsSync(out), false);
  });
}

test('a pins file that does not name the staging project is refused outright', () => {
  const d = tmp();
  const mp = writeManifest(d, { ...manifestFor(pins.runTag), project: 'goarrive' });
  const pp = writePins(d, { project: 'goarrive', sha256: sha(fs.readFileSync(mp)) });
  const r = run('verify-manifest', pp, mp, path.join(d, 'v.json'));
  assert.equal(r.code, 1);
  assert.match(r.err, /does not name the staging project/);
});

test('a missing or unreadable manifest is refused', () => {
  const d = tmp();
  const r = run('verify-manifest', PINS, path.join(d, 'absent.json'), path.join(d, 'v.json'));
  assert.equal(r.code, 1);
  assert.match(r.err, /not readable/);
});

const goodReceipt = {
  project: 'westayfit-staging', status: 'COMPLETE',
  requestedDocuments: 74, documentsDeleted: 0, documentsAlreadyAbsent: 74, profileDocumentsLinked: 6,
  requestedUsers: 9, usersVerifiedByEmail: 0, usersAlreadyAbsent: 9, usersDeleted: 0, manifestPreserved: false,
};
function receipt(dir, obj) { const p = path.join(dir, 'receipt.json'); fs.writeFileSync(p, JSON.stringify(obj)); return p; }

test('verify-receipt accepts COMPLETE for exactly the pinned counts with nothing unresolved and the manifest removed', () => {
  const d = tmp();
  const r = run('verify-receipt', PINS, receipt(d, goodReceipt));
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^RECOVERY_RECEIPT=complete requestedUsers=9 usersAlreadyAbsent=9 usersDeleted=0 requestedDocuments=74 documentsAlreadyAbsent=74 documentsDeleted=0$/m);
});

for (const [name, mutate, expect] of [
  ['INCOMPLETE', { status: 'INCOMPLETE', unresolvedUsers: 1, manifestPreserved: true }, /not COMPLETE/],
  ['MANIFEST_UNUSABLE', { status: 'MANIFEST_UNUSABLE', manifestPreserved: true }, /not COMPLETE/],
  ['NO_FIXTURES (the pinned manifest is not empty)', { status: 'NO_FIXTURES', requestedDocuments: 0, requestedUsers: 0 }, /not COMPLETE/],
  ['COMPLETE but an unresolved user', { unresolvedUsers: 1 }, /unresolvedUsers 1/],
  ['COMPLETE but an unresolved document', { unresolvedDocuments: 2 }, /unresolvedDocuments 2/],
  ['COMPLETE for 8 users (not the pinned manifest)', { requestedUsers: 8 }, /requestedUsers 8 != 9/],
  ['COMPLETE for 73 documents (not the pinned manifest)', { requestedDocuments: 73 }, /requestedDocuments 73 != 74/],
  ['COMPLETE but the manifest was kept', { manifestPreserved: true }, /manifest was not removed/],
  ['a receipt for another project', { project: 'goarrive' }, /project does not match/],
]) {
  test(`verify-receipt refuses ${name}`, () => {
    const d = tmp();
    const r = run('verify-receipt', PINS, receipt(d, { ...goodReceipt, ...mutate }));
    assert.equal(r.code, 1);
    assert.match(r.err, expect);
  });
}

test('a missing receipt is refused', () => {
  const d = tmp();
  const r = run('verify-receipt', PINS, path.join(d, 'absent.json'));
  assert.equal(r.code, 1);
});

console.log(`\nrecovery-35248719827: ${passed} passed`);
