#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const READ = path.resolve('.github/wsf-staging/read-inventory.mjs');
let passed = 0;
const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-inv-'));
const NAMES22 = Array.from({ length: 22 }, (_, i) => ({ id: `wsfFn${i}` }));

function run(exitCode, rawBody, { expectedPrior } = {}) {
  const raw = path.join(d, `raw-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(raw, rawBody);
  const out = path.join(d, `out-${Math.random().toString(36).slice(2)}.json`);
  const approval = path.join(d, `ap-${Math.random().toString(36).slice(2)}.json`);
  const body = { project: 'westayfit-staging', approvedAppSha: '8e1a3ed485a5c0eadbcb23c1f35becad455923c7' };
  if (expectedPrior !== undefined) body.expectedPriorFunctions = expectedPrior;
  fs.writeFileSync(approval, JSON.stringify(body));
  const r = spawnSync(process.execPath, [READ, String(exitCode), raw, out, approval], { encoding: 'utf8' });
  let parsed = null;
  try { parsed = JSON.parse(fs.readFileSync(out, 'utf8')); } catch {}
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', written: parsed };
}
const test = (n, f) => { f(); passed += 1; console.log(`  ok  ${n}`); };

test('a valid inventory matching the approved baseline succeeds', () => {
  const r = run(0, JSON.stringify({ result: NAMES22 }), { expectedPrior: 22 });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.written.functions.length, 22);
  assert.match(r.out, /PREFLIGHT_BEFORE=22/);
});

test('a NONZERO CLI exit fails — never an empty baseline', () => {
  const r = run(1, JSON.stringify({ result: [] }), { expectedPrior: 22 });
  assert.equal(r.code, 1);
  assert.match(r.err, /exited 1/);
  assert.equal(r.written, null, 'nothing may be written from a failed read');
});

test('a JSON ERROR OBJECT with no result fails', () => {
  const r = run(0, JSON.stringify({ status: 'error', error: { status: 'PERMISSION_DENIED' } }), { expectedPrior: 22 });
  assert.equal(r.code, 1);
  assert.match(r.err, /no result property/);
  assert.match(r.err, /PERMISSION_DENIED/);
  assert.equal(r.written, null);
});

test('a MALFORMED result (not an array) fails', () => {
  const r = run(0, JSON.stringify({ result: { functions: 'many' } }), { expectedPrior: 22 });
  assert.equal(r.code, 1);
  assert.match(r.err, /result is not an array/);
});

test('output that is not JSON at all fails', () => {
  const r = run(0, '<html>gateway timeout</html>', { expectedPrior: 22 });
  assert.equal(r.code, 1);
  assert.match(r.err, /not valid JSON/);
});

test('an EMPTY baseline fails even with exit 0 and valid JSON', () => {
  const r = run(0, JSON.stringify({ result: [] }), { expectedPrior: 22 });
  assert.equal(r.code, 1);
  assert.match(r.err, /approved against 22/);
});

test('an empty baseline with NO approved expectation is still an error', () => {
  // The permanent floor: Package E deploys into an existing project.
  const r = run(0, JSON.stringify({ result: [] }));
  assert.equal(r.code, 1);
  assert.match(r.err, /empty baseline is an error/);
});

test('a baseline that drifted from the approved count fails', () => {
  const r = run(0, JSON.stringify({ result: NAMES22.slice(0, 21) }), { expectedPrior: 22 });
  assert.equal(r.code, 1);
  assert.match(r.err, /has 21 WSF functions but this candidate was approved against 22/);
});

test('with no expectation recorded, a non-empty baseline is accepted', () => {
  // Proves the count is per-candidate policy, not a rule frozen into the script.
  const r = run(0, JSON.stringify({ result: NAMES22.slice(0, 5) }));
  assert.equal(r.code, 0, r.err);
  assert.equal(r.written.functions.length, 5);
});

console.log(`\nread-inventory: ${passed} passed`);
