#!/usr/bin/env node
/**
 * The post-operator privacy harness: how it reads transport, how rows and the
 * verdict are decided, and the ordering that keeps it from writing anything
 * while the setter is SHUT. Its end-to-end behaviour (seven rows passing on
 * the served functions, the SHUT and missing-index paths BLOCKING, and six
 * product mutants each failing its row) is proven on the emulators and
 * recorded in the delivery receipt; this suite pins the logic those runs
 * depend on.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { classifyTransport, rowStatus, verdict, SOCIAL_SERVICES } from '../social-privacy-postop.mjs';

const SRC = fs.readFileSync('.github/wsf-staging/social-privacy-postop.mjs', 'utf8');
let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

await test('a callable-shaped answer means the request reached the function', () => {
  assert.equal(classifyTransport(401, JSON.stringify({ error: { message: 'Sign in first.', status: 'UNAUTHENTICATED' } })), 'open');
  assert.equal(classifyTransport(200, JSON.stringify({ result: { ok: true } })), 'open');
  assert.equal(classifyTransport(403, JSON.stringify({ error: { message: 'Members only.', status: 'PERMISSION_DENIED' } })), 'open');
});

await test('a bare 401/403 is SHUT: Cloud Run refused before any code ran', () => {
  assert.equal(classifyTransport(403, '<html><body><h1>Error: Forbidden</h1></body></html>'), 'shut');
  assert.equal(classifyTransport(401, ''), 'shut');
  assert.equal(classifyTransport(403, JSON.stringify({ error: 'Forbidden' })), 'shut', 'an error without a callable status is not the function answering');
});

await test('anything else is UNKNOWN, never open and never shut', () => {
  assert.equal(classifyTransport(500, 'upstream connect error'), 'unknown');
  assert.equal(classifyTransport(404, '<html>Not Found</html>'), 'unknown');
  assert.equal(classifyTransport(502, ''), 'unknown');
});

await test('a row passes only when every check passes; a fail outranks a block; no checks is blocked', () => {
  const P = { status: 'PASS' }; const B = { status: 'BLOCKED' }; const F = { status: 'FAIL' };
  assert.equal(rowStatus([P, P]), 'PASS');
  assert.equal(rowStatus([P, B]), 'BLOCKED');
  assert.equal(rowStatus([P, B, F]), 'FAIL');
  assert.equal(rowStatus([]), 'BLOCKED', 'a row with no evidence is never a pass');
});

await test('the verdict: 7/7 PASS is the only pass; any FAIL fails; otherwise blocked', () => {
  const all = (s) => Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`row${i + 1}`, s]));
  assert.deepEqual(verdict(all('PASS')), { verdict: 'pass', exit: 0 });
  assert.deepEqual(verdict({ ...all('PASS'), row6: 'BLOCKED' }), { verdict: 'blocked', exit: 3 });
  assert.deepEqual(verdict({ ...all('PASS'), row3: 'BLOCKED', row5: 'FAIL' }), { verdict: 'fail', exit: 1 });
  const six = all('PASS'); delete six.row7;
  assert.deepEqual(verdict(six), { verdict: 'fail', exit: 1 }, 'a missing row can never read as a pass');
});

await test('it probes all three social services, and writes nothing before the setter is known OPEN', () => {
  assert.deepEqual([...SOCIAL_SERVICES], ['wsfSetCommunityVisibility', 'wsfCommunityMembers', 'wsfCommunityActivity']);
  const gate = SRC.indexOf("const setterOpen = transport.wsfSetCommunityVisibility === 'open';");
  assert.notEqual(gate, -1, 'the setter gate was not found');
  for (const firstWrite of ["await createUser('champion')", 'await putDoc(', "call('wsfContribute'"]) {
    const at = SRC.indexOf(firstWrite, SRC.indexOf('async function main()'));
    assert.ok(at > gate, `${firstWrite} happens before the setter's transport is known`);
  }
  assert.match(SRC, /if \(!setterOpen\) \{[\s\S]*?nothing was written/, 'a SHUT setter must BLOCK every row with no writes');
});

await test('an INTERNAL activity read BLOCKS, it never passes and never counts as a privacy failure', () => {
  assert.match(SRC, /if \(r\.error === 'INTERNAL'\) view\.activityNote = /);
  assert.match(SRC, /else add\('row3', 'BLOCKED', v3\.activityNote\)/);
});

await test('the harness changes no transport, IAM or index and deletes nothing itself', () => {
  for (const [re, what] of [
    [/gcloud/, 'gcloud'],
    [/setIamPolicy|invoker-iam|invokerIamDisabled/, 'an IAM or transport change'],
    [/\/indexes/, 'an index call'],
    [/method: 'DELETE'/, 'a delete (cleanup-synthetic.mjs owns deletion)'],
  ]) {
    assert.equal(re.test(SRC), false, `the harness must not contain ${what}`);
  }
  assert.match(SRC, /throw new Error\("WSF_PRIVACY_TARGET must be 'staging' or 'emulator'"\)/, 'no third target');
  assert.match(SRC, /project\.startsWith\('demo-'\)/, 'the emulator target is confined to demo-* projects');
});

console.log(`\nsocial-privacy-postop: ${passed} passed`);
