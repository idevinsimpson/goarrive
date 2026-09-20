#!/usr/bin/env node
/**
 * The recovery gate's contract.
 *
 * The recovery job hands this script a manifest it downloaded from a run id an
 * operator typed in, and then, if it passes, points a privileged cleaner at
 * it. So every refusal here is a deletion that does not happen against a
 * manifest this repository's harnesses did not write.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.resolve('.github/wsf-staging/validate-recovery-manifest.mjs');
let passed = 0;
const test = (n, f) => { f(); passed += 1; console.log(`  ok  ${n}`); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-recovery-'));
let seq = 0;
function run(manifest, { omitFile = false } = {}) {
  seq += 1;
  const target = path.join(dir, `m${seq}.json`);
  if (!omitFile) {
    fs.writeFileSync(target, typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  }
  const r = spawnSync(process.execPath, [SCRIPT, target], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
const ok = (m) => ({ project: 'westayfit-staging', runTag: 'e5j-abc123', users: ['u1'], docs: ['wsfGoals/e5jgoal-abc123-0'], linkedDocs: [], ...m });

test('a well-formed player manifest is accepted, and its scope is printed', () => {
  const r = run(ok({ users: ['u1', 'u2', 'u3'], docs: ['a/b', 'c/d'], linkedDocs: [{ path: 'x/y', via: 'u1' }] }));
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /RECOVERY_MANIFEST=accepted/);
  assert.match(r.out, /RECOVERY_MANIFEST_RUN_TAG=e5j-abc123/);
  assert.match(r.out, /RECOVERY_MANIFEST_USERS=3/);
  assert.match(r.out, /RECOVERY_MANIFEST_DOCUMENTS=2/);
  assert.match(r.out, /RECOVERY_MANIFEST_LINKED_DOCUMENTS=1/);
});

test('the 24-row suite’s own tag is accepted too — recovery is not player-only', () => {
  const r = run(ok({ runTag: 'e5h-abc123' }));
  assert.equal(r.code, 0, r.err);
});

test('a missing manifest is refused, not treated as "nothing to clean up"', () => {
  const r = run(null, { omitFile: true });
  assert.equal(r.code, 1);
  assert.match(r.out, /RECOVERY_MANIFEST=refused/);
  assert.match(r.err, /the scope of what that run created is unknown/);
});

test('unreadable JSON is refused', () => {
  const r = run('{not json');
  assert.equal(r.code, 1);
  assert.match(r.err, /not readable JSON/);
});

test('a JSON array is refused — it is not a manifest object', () => {
  const r = run('[]');
  assert.equal(r.code, 1);
  assert.match(r.err, /not a JSON object/);
});

test('another project is refused, and the message names the only project this acts on', () => {
  const r = run(ok({ project: 'westayfit-prod' }));
  assert.equal(r.code, 1);
  assert.match(r.err, /westayfit-prod/);
  assert.match(r.err, /only ever acts on westayfit-staging/);
});

test('a missing project field is refused', () => {
  const m = ok(); delete m.project;
  const r = run(m);
  assert.equal(r.code, 1);
});

for (const tag of ['e5x-abc', 'abc', '', 'e5j', 'e5j-', 'e5jgrp-abc', 'e5hj-abc', 'xe5j-abc', 'E5J-abc', '../e5j-abc']) {
  test(`a run tag this repository does not mint is refused: ${JSON.stringify(tag)}`, () => {
    const r = run(ok({ runTag: tag }));
    assert.equal(r.code, 1, `expected ${JSON.stringify(tag)} to be refused`);
    assert.match(r.err, /is not one this repository's harnesses mint/);
  });
}

test('a non-string run tag is refused rather than coerced', () => {
  const r = run(ok({ runTag: { toString: () => 'e5j-abc' } }));
  assert.equal(r.code, 1);
});

test('docs that is not an array is refused', () => {
  const r = run(ok({ docs: 'wsfGoals/e5jgoal-abc-0' }));
  assert.equal(r.code, 1);
  assert.match(r.err, /docs is present but not an array/);
});

test('an empty or non-string doc entry is refused', () => {
  assert.equal(run(ok({ docs: ['a/b', ''] })).code, 1);
  assert.equal(run(ok({ docs: ['a/b', 42] })).code, 1);
});

test('an absolute document path is refused', () => {
  const r = run(ok({ docs: ['/wsfGoals/anything'] }));
  assert.equal(r.code, 1);
  assert.match(r.err, /is absolute/);
});

test('a traversing document path is refused', () => {
  const r = run(ok({ docs: ['wsfGoals/../../etc/passwd'] }));
  assert.equal(r.code, 1);
  assert.match(r.err, /traverses upward/);
});

test('a document path with an empty segment is refused', () => {
  const r = run(ok({ docs: ['wsfGoals//e5jgoal-abc-0'] }));
  assert.equal(r.code, 1);
  assert.match(r.err, /empty segment/);
});

test('an odd-segment (collection) path is NOT refused — refusing it would block a recovery for no safety gain', () => {
  const r = run(ok({ docs: ['wsfGoals'] }));
  assert.equal(r.code, 0, r.err);
});

test('a malformed linkedDocs entry is refused', () => {
  assert.equal(run(ok({ linkedDocs: 'x' })).code, 1);
  assert.equal(run(ok({ linkedDocs: ['x/y'] })).code, 1);
  assert.equal(run(ok({ linkedDocs: [{ path: 'x/y' }] })).code, 1);
  assert.equal(run(ok({ linkedDocs: [{ via: 'u1' }] })).code, 1);
  assert.equal(run(ok({ linkedDocs: [{ path: '/x/y', via: 'u1' }] })).code, 1);
});

test('absent optional fields are treated as empty, not as a refusal', () => {
  const m = ok(); delete m.linkedDocs; delete m.users;
  const r = run(m);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /RECOVERY_MANIFEST_USERS=0/);
  assert.match(r.out, /RECOVERY_MANIFEST_LINKED_DOCUMENTS=0/);
});

test('no path is given at all', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no manifest path was given/);
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\nvalidate-recovery-manifest: ${passed} passed`);
