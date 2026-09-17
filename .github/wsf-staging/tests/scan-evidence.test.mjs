#!/usr/bin/env node
/**
 * The scanner's contract is as much about what it does NOT emit as what it
 * catches. Every case here asserts on both stdout and stderr: a scanner that
 * finds a token and prints it has failed, however correct its exit code.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCANNER = path.resolve('.github/wsf-staging/scan-evidence.mjs');
let passed = 0;

function run(dir) {
  const r = spawnSync(process.execPath, [SCANNER, dir], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', all: (r.stdout || '') + (r.subprocess || '') + (r.stderr || '') };
}
function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-scan-'));
}
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

// The canary values. If any of these ever appears in scanner output, the
// scanner is disclosing what it was built to conceal.
const SECRETS = {
  apiKey: 'AIzaSyD_CANARY_dO_nOt_DiScLoSe_12345678',
  accessToken: 'ya29.CANARY_aCcEsS_tOkEn_dO_nOt_DiScLoSe',
  oob: 'https://example.test/__/auth/action?oobCode=CANARY_OOB_dO_nOt_DiScLoSe&lang=en',
  pem: '-----BEGIN PRIVATE KEY-----\nCANARYKEYMATERIALdOnOtDiScLoSe\n-----END PRIVATE KEY-----',
  saJson: '{"type":"service_account","private_key":"CANARY_sa_dO_nOt_DiScLoSe"}',
};

test('clean evidence passes and may be uploaded', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'receipt.json'), JSON.stringify({ ok: true, functions: 23 }));
  fs.writeFileSync(path.join(d, 'notes.txt'), 'deployed 23 functions\n');
  const r = run(d);
  assert.equal(r.code, 0, 'clean evidence should exit 0');
  assert.match(r.out, /EVIDENCE_SCAN=clean/);
});

for (const [label, value] of Object.entries(SECRETS)) {
  test(`${label}: fails the run AND never prints the value`, () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'leak.json'), `{"captured":${JSON.stringify(value)}}`);
    const r = run(d);
    assert.equal(r.code, 1, `${label} should fail the scan`);
    // The heart of it: the value must appear in neither stream.
    const canary = value.replace(/^-+BEGIN[^\n]*\n/, '').split('\n')[0].slice(0, 24);
    assert.ok(!r.out.includes(canary), `${label} value leaked to stdout`);
    assert.ok(!r.err.includes(canary), `${label} value leaked to stderr`);
    // ...while still naming where to look.
    assert.match(r.err, /leak\.json/);
    assert.match(r.err, /value withheld/);
  });
}

test('unreadable input fails rather than reporting clean', () => {
  const d = tmp();
  const f = path.join(d, 'sealed.json');
  fs.writeFileSync(f, '{"a":1}');
  fs.chmodSync(f, 0o000);
  const r = run(d);
  if (process.getuid && process.getuid() === 0) {
    console.log('     (running as root — chmod cannot make a file unreadable; asserting the directory case instead)');
    const missing = path.join(d, 'no-such-dir');
    const r2 = run(missing);
    assert.equal(r2.code, 1);
    assert.match(r2.err, /EVIDENCE_SCAN=error/);
  } else {
    assert.equal(r.code, 1, 'unreadable file must fail');
    assert.match(r.err, /EVIDENCE_SCAN=error/);
  }
  fs.chmodSync(f, 0o600);
});

test('a missing evidence directory is an error, not "no matches"', () => {
  const r = run(path.join(tmp(), 'absent'));
  assert.equal(r.code, 1);
  assert.match(r.err, /EVIDENCE_SCAN=error/);
});

test('an empty evidence directory is an error, not clean', () => {
  const r = run(tmp());
  assert.equal(r.code, 1, 'zero files scanned must not report clean');
  assert.match(r.err, /unexpectedly empty/);
});

test('binary artifacts are reported UNSCANNABLE, not silently passed', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(d, 'receipt.json'), '{"ok":true}');
  const r = run(d);
  assert.equal(r.code, 0);
  assert.match(r.out, /EVIDENCE_UNSCANNABLE=shot\.png/);
});

test('a secret nested in a subdirectory is still caught', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'deep', 'deeper'), { recursive: true });
  fs.writeFileSync(path.join(d, 'deep', 'deeper', 'x.txt'), SECRETS.accessToken);
  const r = run(d);
  assert.equal(r.code, 1);
  assert.ok(!r.err.includes('ya29.CANARY'), 'nested value leaked');
});

console.log(`\nscan-evidence: ${passed} passed`);
