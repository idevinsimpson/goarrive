#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CHECK = path.resolve('.github/wsf-staging/check-build-stamp.mjs');
const APPROVED = '8e1a3ed485a5c0eadbcb23c1f35becad455923c7';
let passed = 0;
const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-stamp-'));
const run = (...paths) => {
  const r = spawnSync(process.execPath, [CHECK, APPROVED, ...paths], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
};
const stamp = (name, body) => { const p = path.join(d, name); fs.writeFileSync(p, body); return p; };
const test = (n, f) => { f(); passed += 1; console.log(`  ok  ${n}`); };

test('the accepted SHA succeeds', () => {
  const r = run(stamp('good.txt', APPROVED + '\n'), stamp('good2.txt', APPROVED));
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /BUILD_STAMP=verified/);
});

test('a MISSING stamp is rejected', () => {
  const r = run(path.join(d, 'absent.txt'));
  assert.equal(r.code, 1);
  assert.match(r.err, /is missing/);
});

test('a WRONG SHA is rejected', () => {
  const r = run(stamp('wrong.txt', 'b'.repeat(40)));
  assert.equal(r.code, 1);
  assert.match(r.err, /expected the approved candidate/);
});

test('a MALFORMED stamp is rejected and its content is not echoed', () => {
  const r = run(stamp('bad.txt', '<html>proxy error: token=SUPERSECRET</html>'));
  assert.equal(r.code, 1);
  assert.match(r.err, /malformed/);
  assert.ok(!r.err.includes('SUPERSECRET'), 'stamp content must not be echoed');
});

test('an empty stamp is rejected', () => {
  const r = run(stamp('empty.txt', ''));
  assert.equal(r.code, 1);
});

test('one bad stamp among good ones still fails', () => {
  const r = run(stamp('ok.txt', APPROVED), stamp('nope.txt', 'c'.repeat(40)));
  assert.equal(r.code, 1);
});

console.log(`\ncheck-build-stamp: ${passed} passed`);
