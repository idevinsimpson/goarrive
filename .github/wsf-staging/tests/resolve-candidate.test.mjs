#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const GATE = path.resolve('.github/wsf-staging/resolve-candidate.mjs');
const APPROVED = '8e1a3ed485a5c0eadbcb23c1f35becad455923c7';
let passed = 0;

function approvalFile(dir, body) {
  const p = path.join(dir, 'approved.json');
  fs.writeFileSync(p, JSON.stringify(body));
  return p;
}
function run(file, requested) {
  const r = spawnSync(process.execPath, [GATE, file], {
    encoding: 'utf8',
    env: { ...process.env, WSF_REQUESTED_SHA: requested ?? '', GITHUB_OUTPUT: '' },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
function test(n, f) { f(); passed += 1; console.log(`  ok  ${n}`); }

const good = { project: 'westayfit-staging', approvedAppSha: APPROVED, packageLabel: 'Package E' };
const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-gate-'));

test('no input deploys the approved candidate', () => {
  const r = run(approvalFile(d, good), '');
  assert.equal(r.code, 0);
  assert.match(r.out, new RegExp(`CANDIDATE=${APPROVED}`));
});

test('the approved SHA supplied explicitly is accepted', () => {
  const r = run(approvalFile(d, good), APPROVED);
  assert.equal(r.code, 0);
});

test('ANOTHER SYNTACTICALLY VALID SHA IS REFUSED', () => {
  // The whole point of requirement 1: 40 hex characters is not approval.
  const other = 'a'.repeat(40);
  const r = run(approvalFile(d, good), other);
  assert.equal(r.code, 1, 'an unapproved but well-formed SHA must be refused');
  assert.match(r.err, /is NOT the approved candidate/);
  assert.match(r.err, /CANDIDATE=refused/);
});

test('a real commit from the repo that is not approved is still refused', () => {
  // d5e24b7… is this PR's own head — real, reachable, and not the candidate.
  const r = run(approvalFile(d, good), 'd5e24b76f17ebd390e22ae99a4c6728e354e0456');
  assert.equal(r.code, 1);
  assert.match(r.err, /is NOT the approved candidate/);
});

test('a malformed input is refused', () => {
  const r = run(approvalFile(d, good), 'not-a-sha');
  assert.equal(r.code, 1);
  assert.match(r.err, /40-character lowercase hex/);
});

test('a missing approval file refuses everything', () => {
  const r = run(path.join(d, 'absent.json'), '');
  assert.equal(r.code, 1);
  assert.match(r.err, /refusing to deploy anything/);
});

test('an approval file naming the wrong project is refused', () => {
  const r = run(approvalFile(d, { project: 'goarrive', approvedAppSha: APPROVED }), '');
  assert.equal(r.code, 1);
  assert.match(r.err, /does not name westayfit-staging/);
});

test('an approval file with a malformed SHA is refused', () => {
  const r = run(approvalFile(d, { project: 'westayfit-staging', approvedAppSha: 'main' }), '');
  assert.equal(r.code, 1);
});

console.log(`\nresolve-candidate: ${passed} passed`);
