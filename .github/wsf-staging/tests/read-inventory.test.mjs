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

function run(exitCode, rawBody, { expectedPrior, added, fastpath } = {}) {
  const raw = path.join(d, `raw-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(raw, rawBody);
  const out = path.join(d, `out-${Math.random().toString(36).slice(2)}.json`);
  const approval = path.join(d, `ap-${Math.random().toString(36).slice(2)}.json`);
  const body = { project: 'westayfit-staging', approvedAppSha: '8e1a3ed485a5c0eadbcb23c1f35becad455923c7' };
  if (expectedPrior !== undefined) body.expectedPriorFunctions = expectedPrior;
  if (added !== undefined) body.candidateAddedFunctions = added;
  fs.writeFileSync(approval, JSON.stringify(body));
  const env = { ...process.env };
  delete env.WSF_FASTPATH;
  if (fastpath !== undefined) env.WSF_FASTPATH = fastpath;
  const r = spawnSync(process.execPath, [READ, String(exitCode), raw, out, approval], { encoding: 'utf8', env });
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

test('FAST PATH: the baseline is the pin\'s verified inventory (prior + added); the pre-pin count is refused', () => {
  const added = ['wsfadded1', 'wsfadded2', 'wsfadded3'];
  const ok = run(0, JSON.stringify({ result: NAMES22 }), { expectedPrior: 19, added, fastpath: 'true' });
  assert.equal(ok.code, 0, ok.err);
  assert.match(ok.out, /PREFLIGHT_FASTPATH_BASELINE=22 \(the pin's verified inventory: 19 prior \+ 3 added\)/);
  const stale = run(0, JSON.stringify({ result: NAMES22.slice(0, 19) }), { expectedPrior: 19, added, fastpath: 'true' });
  assert.equal(stale.code, 1, 'staging still at the pre-pin inventory: the pin deploy was not what the fast path assumes');
  assert.match(stale.err, /has 19 WSF functions but this candidate was approved against 22/);
  const bad = run(0, JSON.stringify({ result: NAMES22 }), { expectedPrior: 19, added: 'x', fastpath: 'true' });
  assert.equal(bad.code, 1); assert.match(bad.err, /candidateAddedFunctions in the approval file is not an array/);
});

test('without WSF_FASTPATH=true (the reviewed pin path) the baseline is exactly expectedPriorFunctions, as before', () => {
  const added = ['wsfadded1', 'wsfadded2', 'wsfadded3'];
  assert.equal(run(0, JSON.stringify({ result: NAMES22.slice(0, 19) }), { expectedPrior: 19, added }).code, 0);
  assert.equal(run(0, JSON.stringify({ result: NAMES22.slice(0, 19) }), { expectedPrior: 19, added, fastpath: 'false' }).code, 0);
  assert.equal(run(0, JSON.stringify({ result: NAMES22 }), { expectedPrior: 19, added, fastpath: '1' }).code, 1, 'only the exact string true selects the fast path');
});

console.log(`\nread-inventory: ${passed} passed`);
